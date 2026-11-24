// El crupier anula la apuesta confirmada de un jugador para que pueda volver a apostar.
// Solo con la ronda abierta; la anulación sobrevive a que el jugador esté desconectado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { arrancarEntorno } from './helpers/entorno.mjs';
import { Observador } from './helpers/bots.mjs';
import {
  abrirNavegador, MOVIL, PROYECTOR, SALIDA, entrarMando, entrarJugador, apostarJugador,
  accionMando, marcarResultado, esperarEn,
} from './helpers/navegador.mjs';

test('el crupier anula una apuesta y el jugador vuelve a apostar', { timeout: 120_000 }, async (t) => {
  const env = await arrancarEntorno();
  const nav = await abrirNavegador();
  const obs = await new Observador(env).conectar();
  try {
    const mando = await nav.pagina('mando', MOVIL);
    await entrarMando(mando, env.url('control'));
    const mesa = await nav.pagina('mesa', PROYECTOR);
    await mesa.goto(env.url('mesa'));
    await mesa.waitForSelector('#live.is-on');

    const movilAna = await nav.contexto('ana', MOVIL);
    let ana = await movilAna.nueva();
    await entrarJugador(ana, env.url('jugar'), 'Ana', 'García');
    const epoch = () => obs.state.epoch;
    await obs.esperar(() => obs.players.get(epoch())?.size === 1, { que: 'alta de Ana' });
    const pid = [...obs.players.get(epoch())][0];
    const apuestaAna = () => obs.apuestas(epoch(), 1).get(pid);
    const anular = `#players [data-clear="${pid}"]`;

    await t.test('sin ronda abierta no aparece el botón Anular', async () => {
      assert.equal(await mando.locator(anular).count(), 0);
      await accionMando(mando, 'openRound');
      await obs.esperar(() => obs.state.phase === 'open', { que: 'ronda 1 abierta' });
      assert.equal(await mando.locator(anular).count(), 0, 'sin apuesta tampoco hay botón');
    });

    await t.test('anular en directo: la ficha desaparece y el jugador puede reapostar', async () => {
      await apostarJugador(ana, 'pizza');
      await obs.esperar(() => apuestaAna() === 'pizza', { que: 'apuesta PIZZA en el servidor' });
      await esperarEn(mesa, () => document.querySelector('#bets-count').textContent === '1', null, { que: 'ficha en la mesa' });

      // El botón está a la izquierda del de retirar jugador
      const orden = await mando.$eval(`#players li:has([data-clear="${pid}"])`, (li) => {
        const kids = [...li.children];
        return kids.indexOf(li.querySelector('[data-clear]')) < kids.indexOf(li.querySelector('[data-remove]'));
      });
      assert.ok(orden, 'Anular va a la izquierda de retirar');

      await mando.click(anular);
      await mando.click('.modal [data-ok]');
      await obs.esperar(() => !apuestaAna(), { que: 'apuesta borrada del servidor' });
      await obs.esperar(() => obs.state.voids?.[1]?.[pid] === 1, { que: 'anulación registrada en el estado' });
      await esperarEn(mesa, () => document.querySelector('#bets-count').textContent === '0', null, { que: 'ficha retirada de la mesa' });
      await esperarEn(ana, () => document.querySelector('#hint').textContent.includes('anulado'), null, { que: 'aviso en el móvil' });
      assert.equal(await ana.locator('#confirm-btn.is-done').count(), 0, 'el móvil ya no la da por confirmada');

      await apostarJugador(ana, 'fuerza');
      await obs.esperar(() => apuestaAna() === 'fuerza', { que: 'nueva apuesta FUERZA' });
      await esperarEn(mesa, () => document.querySelector('#bets-count').textContent === '1', null, { que: 'nueva ficha en la mesa' });
      await esperarEn(mando, (p) => document.querySelector('#players').textContent.includes('Apuesta: FUERZA'), null, { que: 'mando ve FUERZA' });
    });

    await t.test('anular con el jugador desconectado: al volver no se republica la apuesta vieja', async () => {
      await ana.close();
      await mando.click(anular);
      await mando.click('.modal [data-ok]');
      await obs.esperar(() => !apuestaAna() && obs.state.voids?.[1]?.[pid] === 2, { que: 'segunda anulación' });

      ana = await movilAna.nueva(); // mismo móvil: conserva su copia local de la apuesta
      await ana.goto(env.url('jugar'));
      await ana.waitForSelector('#game:not([hidden])', { timeout: 20000 });
      await ana.waitForTimeout(2500);
      assert.equal(apuestaAna(), undefined, 'la apuesta anulada no vuelve al servidor');
      assert.equal(await ana.locator('#confirm-btn.is-done').count(), 0, 'puede volver a apostar');

      await apostarJugador(ana, 'hml-160');
      await obs.esperar(() => apuestaAna() === 'hml-160', { que: 'apuesta HML 160' });
    });

    await t.test('con las apuestas cerradas ya no se puede anular', async () => {
      await accionMando(mando, 'closeBets');
      await obs.esperar(() => obs.state.phase === 'closed', { que: 'no va más' });
      await mando.waitForTimeout(400);
      assert.equal(await mando.locator('[data-clear]').count(), 0);
    });

    await t.test('el resultado usa la última apuesta', async () => {
      await marcarResultado(mando, 'hml-160');
      await obs.esperar(() => obs.state.phase === 'result', { que: 'resultado' });
      const entry = obs.state.history.at(-1);
      assert.equal(entry.bets[pid], 'hml-160');
      await esperarEn(ana, () => document.querySelector('#hud-points').textContent.trim() === '10', null, { timeout: 12000, que: '10 puntos para Ana' });
      await mesa.screenshot({ path: path.join(SALIDA, 'anular-mesa.png') });
    });

    assert.deepEqual(nav.errores, [], 'sin errores en las páginas');
  } finally {
    await obs.cerrar();
    await nav.cerrar();
    await env.cerrar();
  }
});
