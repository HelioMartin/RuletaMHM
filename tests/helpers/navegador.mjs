// Navegador para las pruebas: Chromium sin ventana, captura de errores de consola y
// medición de tareas largas (bloqueos de la página).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ } from './entorno.mjs';

export const SALIDA = path.join(RAIZ, 'tests', 'salida');

// Errores de red de las fuentes de Google no dependen de la app (sin internet en CI).
const RUIDO = /fonts\.googleapis\.com|fonts\.gstatic\.com|ERR_TUNNEL|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/;

export const MOVIL = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
export const PROYECTOR = { viewport: { width: 1920, height: 1080 } };

export async function abrirNavegador() {
  const proxy = process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }
    : undefined;
  const browser = await chromium.launch({ proxy });
  await mkdir(SALIDA, { recursive: true });
  const errores = [];

  // Un contexto es como un móvil o un portátil: sus pestañas comparten almacenamiento.
  async function contexto(nombre, opciones = {}) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opciones });
    // Registra las tareas largas (> 50 ms) que bloquean la página.
    await ctx.addInitScript(() => {
      window.__tareasLargas = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__tareasLargas.push(Math.round(e.duration));
        }).observe({ type: 'longtask', buffered: true });
      } catch { /* sin soporte */ }
    });
    async function nueva() {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errores.push(`[${nombre}] ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !RUIDO.test(m.text())) errores.push(`[${nombre}] ${m.text()}`);
      });
      page.on('requestfailed', (r) => {
        const why = r.failure()?.errorText ?? '';
        if (!RUIDO.test(r.url()) && !RUIDO.test(why) && !why.includes('ERR_ABORTED')) {
          errores.push(`[${nombre}] petición fallida ${r.url()} ${why}`);
        }
      });
      page.nombre = nombre;
      return page;
    }
    return { ctx, nueva };
  }

  async function pagina(nombre, opciones = {}) {
    return (await contexto(nombre, opciones)).nueva();
  }

  return {
    contexto,
    pagina,
    errores,
    async cerrar() { await browser.close(); },
  };
}

export async function tareasLargas(page) {
  return page.evaluate(() => window.__tareasLargas ?? []);
}

// Espera hasta que una función evaluada en la página devuelva un valor "verdadero".
export async function esperarEn(page, fn, arg, { timeout = 20000, que = 'condición' } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (err) {
    throw new Error(`[${page.nombre}] tiempo agotado esperando: ${que}`, { cause: err });
  }
}

// Entra en el mando con el PIN y espera a estar en directo.
export async function entrarMando(page, url, pin = '2026') {
  await page.goto(url);
  await page.fill('#pin', pin);
  await page.click('#gate-form button');
  await page.waitForSelector('#live.is-on', { timeout: 20000 });
  await page.waitForTimeout(1200); // margen para publicar el estado inicial
}

// Un jugador real entra con su nombre desde la app.
export async function entrarJugador(page, url, nombre, apellido) {
  await page.goto(url);
  await page.waitForSelector('#join-btn:not([disabled])', { timeout: 20000 });
  await page.fill('#first', nombre);
  await page.fill('#last', apellido);
  await page.click('#join-btn');
  await page.waitForSelector('#game:not([hidden])', { timeout: 20000 });
}

// Un jugador real pone su ficha y confirma.
export async function apostarJugador(page, cell) {
  await page.click(`.cell[data-cell="${cell}"]`);
  await page.waitForTimeout(600); // la ficha vuela hasta la casilla
  await page.click('#confirm-btn');
  await page.waitForSelector('#confirm-btn.is-done', { timeout: 10000 });
}

// El crupier pulsa una acción de la barra inferior del mando.
export async function accionMando(page, action) {
  const sel = `[data-action="${action}"]:not([disabled])`;
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.click(sel);
}

// El crupier marca el resultado tocando la casilla y confirmando.
export async function marcarResultado(page, cell) {
  await page.click(`#board .cell[data-cell="${cell}"]`);
  await page.click('.modal [data-ok]');
}
