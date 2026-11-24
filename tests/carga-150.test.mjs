// Carga: 150 personas jugando a la vez con 1 crupier (mando en el móvil) y la mesa
// proyectada. Unos cuantos jugadores usan la app real en un navegador y el resto son
// bots que hablan con el servidor igual que la app. Se comprueba que todo llega a la
// mesa y al mando, que los puntos y puestos coinciden con el reglamento y que las
// páginas no se bloquean.
//
//   JUGADORES=150 NAVEGADORES=8 npm run test:carga
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { arrancarEntorno } from './helpers/entorno.mjs';
import { Bot, Observador, rng } from './helpers/bots.mjs';
import { APOSTABLES, puntosRonda, puestos } from './helpers/reglas.mjs';
import {
  abrirNavegador, MOVIL, PROYECTOR, SALIDA, entrarMando, entrarJugador, apostarJugador,
  accionMando, marcarResultado, esperarEn, tareasLargas,
} from './helpers/navegador.mjs';

const TOTAL = Number(process.env.JUGADORES ?? 150);
const REALES = Math.min(Number(process.env.NAVEGADORES ?? 8), TOTAL);
const ESPERA_ANUNCIO = 4000; // CONFIG.revealDelay
const RONDAS = [
  { resultado: 'pizza', que: 'harina exacta (blanca)' },
  { resultado: 'semol', que: 'bonus para todos' },
  { resultado: 'anitin-jerez', que: 'harina exacta (integral)' },
];
const NOMBRES_REALES = [
  ['Helena', 'Prieto'], ['Marcos', 'Vidal'], ['Irene', 'Cano'], ['Tomás', 'Lozano'],
  ['Laura', 'Peña'], ['Hugo', 'Rubio'], ['Clara', 'Méndez'], ['Mario', 'Ortega'],
  ['Alba', 'Iglesias'], ['Bruno', 'Garrido'], ['Eva', 'Cortés'], ['Óscar', 'Santos'],
];

const azar = rng(2026);
const elegir = () => (azar() < 0.3 ? (azar() < 0.5 ? 'blanca' : 'integral') : APOSTABLES[Math.floor(azar() * 18)]);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const contar = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());

test(`${TOTAL} jugadores a la vez con 1 crupier y la mesa`, { timeout: 300_000 }, async (t) => {
  const env = await arrancarEntorno();
  const nav = await abrirNavegador();
  const obs = await new Observador(env).conectar();
  const bots = [];
  const metricas = { latenciaMesa: [], latenciaMando: [] };
  const apuestas = new Map(); // ronda -> Map(pid -> casilla)
  try {
    // ---------- Mando, mesa y jugadores ----------
    const mando = await nav.pagina('mando', MOVIL);
    await entrarMando(mando, env.url('control'));
    const mesa = await nav.pagina('mesa', PROYECTOR);
    await mesa.goto(env.url('mesa'));
    await mesa.waitForSelector('#live.is-on');
    await mesa.click('#sound-btn'); // con sonido, como en la sala
    await obs.esperar(() => obs.state?.epoch, { que: 'estado inicial del mando' });
    const epoch = obs.state.epoch;

    const reales = [];
    for (let i = 0; i < REALES; i++) reales.push(await nav.pagina(`movil${i + 1}`, MOVIL));
    for (let i = 0; i < TOTAL - REALES; i++) bots.push(new Bot({ ...env, i }));
    await Promise.all(bots.map((b) => b.conectar()));

    await t.test(`entran los ${TOTAL} jugadores en pocos segundos`, async () => {
      const inicio = Date.now();
      await Promise.all([
        ...reales.map((p, i) => entrarJugador(p, env.url('jugar'), ...NOMBRES_REALES[i % NOMBRES_REALES.length])),
        ...bots.map(async (b) => { await pausa(azar() * 4000); await b.apuntarse(epoch); }),
      ]);
      await obs.esperar(() => obs.players.get(epoch)?.size === TOTAL, { que: `${TOTAL} altas` });
      await esperarEn(mesa, (n) => document.querySelector('#lobby-count').textContent === String(n), TOTAL, { que: 'contador de la mesa' });
      await esperarEn(mando, (n) => document.querySelector('#n-players').textContent === String(n), TOTAL, { que: 'contador del mando' });
      metricas.entrada = Date.now() - inicio;
      await mesa.screenshot({ path: path.join(SALIDA, 'carga-mesa-bienvenida.png') });
    });

    // pid de cada jugador real (lo guarda la app en el móvil)
    const pidReal = await Promise.all(reales.map((p) => p.evaluate(() => {
      const k = Object.keys(localStorage).find((key) => key.startsWith('ruleta-me:'));
      return JSON.parse(localStorage.getItem(k)).pid;
    })));
    const todos = [...pidReal, ...bots.map((b) => b.pid)];
    const enMesa = new Set(todos);

    for (const [n, ronda] of RONDAS.entries()) {
      const num = n + 1;
      await t.test(`ronda ${num}: apuestan los ${TOTAL} a la vez y sale ${ronda.resultado} (${ronda.que})`, async () => {
        await accionMando(mando, 'openRound');
        await obs.esperar(() => obs.state.phase === 'open' && obs.state.round === num, { que: `ronda ${num} abierta` });

        // Todos apuestan en una ventana de 3 segundos
        const plan = new Map(todos.map((pid) => [pid, elegir()]));
        apuestas.set(num, plan);
        let ultima = 0;
        await Promise.all([
          ...reales.map(async (p, i) => {
            await pausa(azar() * 1500);
            await apostarJugador(p, plan.get(pidReal[i]));
            ultima = Math.max(ultima, Date.now());
          }),
          ...bots.map(async (b) => {
            await pausa(azar() * 3000);
            await b.apostar(epoch, num, plan.get(b.pid));
            ultima = Math.max(ultima, Date.now());
          }),
        ]);

        await esperarEn(mesa, (n) => document.querySelector('#bets-count').textContent === String(n), TOTAL, { que: `${TOTAL} fichas en la mesa` });
        metricas.latenciaMesa.push(Math.max(0, Date.now() - ultima));
        await esperarEn(mando, (n) => document.querySelector('#n-bets').textContent === String(n), TOTAL, { que: `${TOTAL} apuestas en el mando` });
        metricas.latenciaMando.push(Math.max(0, Date.now() - ultima));

        assert.equal(obs.apuestas(epoch, num).size, TOTAL, 'el servidor tiene todas las apuestas');
        assert.equal(await contar(mando, '#n-pending'), '0', 'nadie sin apostar en el mando');
        const fichas = await mesa.$$eval('#board .cell__count:not([hidden])', (els) => els.reduce((s, el) => s + Number(el.textContent), 0));
        assert.equal(fichas, TOTAL, 'las fichas del tapete suman el total');

        if (num === 1) {
          // Con la sala llena, el crupier anula la apuesta de un jugador y este reapuesta
          const pid = pidReal[0];
          await mando.click(`#players [data-clear="${pid}"]`);
          await mando.click('.modal [data-ok]');
          await esperarEn(mesa, (n) => document.querySelector('#bets-count').textContent === String(n), TOTAL - 1, { que: 'ficha anulada fuera de la mesa' });
          const nueva = plan.get(pid) === 'pizza' ? 'fuerza' : 'pizza';
          await esperarEn(reales[0], () => document.querySelector('#hint').textContent.includes('anulado'), null, { que: 'aviso de anulación' });
          await apostarJugador(reales[0], nueva);
          plan.set(pid, nueva);
          await esperarEn(mesa, (n) => document.querySelector('#bets-count').textContent === String(n), TOTAL, { que: 'nueva ficha en la mesa' });
          await mesa.screenshot({ path: path.join(SALIDA, 'carga-mesa-fichas.png') });
          await mando.screenshot({ path: path.join(SALIDA, 'carga-mando.png') });
        }

        await accionMando(mando, 'closeBets');
        await esperarEn(mesa, () => !document.querySelector('#spin').hidden, null, { que: 'ruleta girando en la mesa' });
        await marcarResultado(mando, ronda.resultado);
        const marcado = Date.now();

        // Mientras la bola cae, nadie ve el resultado
        await pausa(1500);
        assert.equal(await mesa.locator('.reveal').count(), 0, 'la mesa aún no lo anuncia');
        for (const p of reales) assert.equal(await p.locator('.reveal').count(), 0, `${p.nombre} aún no lo ve`);

        // Puntos esperados según el reglamento
        const total = new Map(todos.map((pid) => [pid, 0]));
        for (const [r, pl] of apuestas) {
          const res = RONDAS[r - 1].resultado;
          for (const pid of todos) total.set(pid, total.get(pid) + puntosRonda(pl.get(pid), res, enMesa.has(pid)));
        }
        const puesto = puestos(total);

        await esperarEn(mesa, () => document.querySelector('.reveal'), null, { timeout: ESPERA_ANUNCIO + 6000, que: 'anuncio en la mesa' });
        const anuncio = Date.now() - marcado;
        assert.ok(anuncio >= ESPERA_ANUNCIO - 300, `el anuncio respeta la espera (${anuncio} ms)`);
        (metricas.anuncio ??= []).push(anuncio);

        // El historial del servidor guarda la foto de las 150 apuestas
        const entry = obs.state.history.at(-1);
        assert.equal(entry.outcome, ronda.resultado);
        assert.equal(Object.keys(entry.bets).length, TOTAL, 'el resultado incluye todas las apuestas');
        for (const [pid, cell] of plan) assert.equal(entry.bets[pid], cell, `apuesta de ${pid}`);
        assert.equal(Object.keys(entry.players).length, TOTAL, 'todos estaban en la mesa');

        // Cada móvil real muestra sus puntos correctos
        await Promise.all(reales.map((p, i) => esperarEn(p,
          (pts) => document.querySelector('.reveal') && document.querySelector('#hud-points').textContent.trim() === String(pts),
          total.get(pidReal[i]), { timeout: 10000, que: `puntos de ${p.nombre}` })));

        // La clasificación de la mesa coincide con el reglamento (puntos y puesto)
        await pausa(1200);
        const filas = await mesa.$$eval('#ranking .rk', (els) => els.map((el) => ({
          pid: el.dataset.key,
          pos: Number(el.querySelector('.rk__pos').textContent),
          pts: Number(el.querySelector('.rk__pts').textContent),
        })));
        assert.ok(filas.length >= 10, 'la mesa enseña al menos 10 filas');
        for (const f of filas) {
          assert.equal(f.pts, total.get(f.pid), `puntos de ${f.pid} en la mesa`);
          assert.equal(f.pos, puesto.get(f.pid), `puesto de ${f.pid} en la mesa`);
        }
        const maximo = Math.max(...total.values());
        assert.equal(filas[0].pts, maximo, 'el primero de la mesa es el que más puntos tiene');
        const pagina = await contar(mesa, '#rank-page');
        assert.match(pagina, new RegExp(`${TOTAL} jugadores, página \\d+ de \\d+`), 'el ranking pasa páginas');

        // El mando lista a los 150 con los mismos puntos
        const filasMando = await mando.$$eval('#players .plist__row', (els) => els.length);
        assert.equal(filasMando, TOTAL);
        if (num === RONDAS.length) await mesa.screenshot({ path: path.join(SALIDA, 'carga-mesa-anuncio.png') });
      });
    }

    await t.test('las páginas no se bloquean y no hay errores', async () => {
      metricas.tareasMesa = await tareasLargas(mesa);
      metricas.tareasMando = await tareasLargas(mando);
      const maxMesa = Math.max(0, ...metricas.tareasMesa);
      const maxMando = Math.max(0, ...metricas.tareasMando);
      assert.ok(maxMesa < 1000, `la mesa no se queda bloqueada más de 1 s (máx. ${maxMesa} ms)`);
      assert.ok(maxMando < 1000, `el mando no se queda bloqueado más de 1 s (máx. ${maxMando} ms)`);
      assert.ok(Math.max(...metricas.latenciaMesa) < 5000, 'las fichas llegan a la mesa en menos de 5 s');
      assert.deepEqual(nav.errores, [], 'sin errores en las páginas');
    });
  } finally {
    const resumen = {
      jugadores: TOTAL,
      navegadoresReales: REALES,
      bots: TOTAL - REALES,
      entradaMs: metricas.entrada,
      ultimaApuestaHastaMesaMs: metricas.latenciaMesa,
      ultimaApuestaHastaMandoMs: metricas.latenciaMando,
      marcarHastaAnuncioMs: metricas.anuncio,
      tareasLargasMesaMs: { cuantas: metricas.tareasMesa?.length, max: Math.max(0, ...(metricas.tareasMesa ?? [])) },
      tareasLargasMandoMs: { cuantas: metricas.tareasMando?.length, max: Math.max(0, ...(metricas.tareasMando ?? [])) },
      errores: nav.errores,
    };
    await writeFile(path.join(SALIDA, 'carga-resumen.json'), JSON.stringify(resumen, null, 2)).catch(() => {});
    console.log('Resumen de carga:', JSON.stringify(resumen));
    await Promise.all(bots.map((b) => b.cerrar().catch(() => {})));
    await obs.cerrar();
    await nav.cerrar();
    await env.cerrar();
  }
});
