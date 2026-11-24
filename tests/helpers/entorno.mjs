// Entorno de pruebas: servidor web estático para las tres apps y servidor MQTT local
// (por WebSocket), los dos en puertos libres. Así las pruebas no tocan el servidor
// público ni la partida real.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aedesFactory from 'aedes';
import { createServer as createBrokerServer } from 'aedes-server-factory';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8',
};

function escuchar(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

export async function arrancarEntorno() {
  const web = http.createServer(async (req, res) => {
    try {
      const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(RAIZ, ruta);
      if (!file.startsWith(RAIZ)) throw new Error('fuera de la raíz');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
    }
  });
  const webPort = await escuchar(web);

  const aedes = aedesFactory();
  const broker = createBrokerServer(aedes, { ws: true });
  const brokerPort = await escuchar(broker);

  const sala = `prueba-${Date.now().toString(36)}`;
  const brokerUrl = `ws://127.0.0.1:${brokerPort}`;
  const query = `?broker=${encodeURIComponent(brokerUrl)}&sala=${sala}`;

  return {
    brokerUrl,
    sala,
    url: (app) => `http://127.0.0.1:${webPort}/${app}/${query}`,
    async cerrar() {
      await new Promise((r) => web.close(r));
      await new Promise((r) => broker.close(r));
      await new Promise((r) => aedes.close(r));
    },
  };
}
