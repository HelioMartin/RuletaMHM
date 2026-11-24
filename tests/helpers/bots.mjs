// Jugadores simulados: cada bot abre su propia conexión MQTT y publica exactamente lo
// mismo que la app de jugadores (alta y apuesta confirmada, como mensajes retenidos).
// Un "observador" lee el estado y las apuestas tal y como los guarda el servidor.
import mqtt from 'mqtt';

const NOMBRES = ['Ana', 'Luis', 'Carmen', 'Javier', 'Marta', 'Pedro', 'Lucía', 'Sergio', 'Elena', 'Pablo',
  'Rocío', 'Diego', 'Nuria', 'Álvaro', 'Inés', 'Raúl', 'Sara', 'Jorge', 'Paula', 'Iván'];
const APELLIDOS = ['García', 'Martín', 'Ruiz', 'Sánchez', 'López', 'Gómez', 'Díaz', 'Moreno', 'Romero', 'Navarro',
  'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Serrano', 'Molina', 'Blanco', 'Suárez', 'Castro'];

export function nombreBot(i) {
  return `${NOMBRES[i % NOMBRES.length]} ${APELLIDOS[(i * 7 + Math.floor(i / 20)) % APELLIDOS.length]}`;
}

function conectar(brokerUrl, clientId) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, { clientId, clean: true, reconnectPeriod: 0, connectTimeout: 15000 });
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

function publicar(client, topic, obj) {
  return new Promise((resolve, reject) => {
    client.publish(topic, obj == null ? '' : JSON.stringify(obj), { qos: 1, retain: true }, (err) => (err ? reject(err) : resolve()));
  });
}

export class Bot {
  constructor({ brokerUrl, sala, i }) {
    this.brokerUrl = brokerUrl;
    this.sala = sala;
    this.pid = `bot${String(i).padStart(3, '0')}`;
    this.name = nombreBot(i);
  }

  async conectar() {
    this.client = await conectar(this.brokerUrl, `ruleta-bot-${this.pid}`);
    return this;
  }

  apuntarse(epoch) {
    return publicar(this.client, `${this.sala}/e/${epoch}/p/${this.pid}`, { name: this.name, at: Date.now() });
  }

  apostar(epoch, round, cell) {
    return publicar(this.client, `${this.sala}/e/${epoch}/b/${round}/${this.pid}`, { cell, name: this.name, at: Date.now() });
  }

  cerrar() {
    return new Promise((r) => this.client.end(false, {}, r));
  }
}

// Lee del servidor el estado de la partida, los jugadores y las apuestas.
export class Observador {
  constructor({ brokerUrl, sala }) {
    this.brokerUrl = brokerUrl;
    this.sala = sala;
    this.state = null;
    this.players = new Map(); // epoca -> Set(pid)
    this.bets = new Map(); // `${epoca}|${ronda}` -> Map(pid -> cell)
  }

  async conectar() {
    this.client = await conectar(this.brokerUrl, `ruleta-observador-${Date.now()}`);
    this.client.on('message', (topic, payload) => {
      const parts = topic.slice(this.sala.length + 1).split('/');
      const data = payload.length ? JSON.parse(payload.toString()) : null;
      if (parts[0] === 'state') this.state = data;
      else if (parts[0] === 'e' && parts[2] === 'p') {
        if (!this.players.has(parts[1])) this.players.set(parts[1], new Set());
        if (data) this.players.get(parts[1]).add(parts[3]); else this.players.get(parts[1]).delete(parts[3]);
      } else if (parts[0] === 'e' && parts[2] === 'b') {
        const key = `${parts[1]}|${parts[3]}`;
        if (!this.bets.has(key)) this.bets.set(key, new Map());
        if (data) this.bets.get(key).set(parts[4], data.cell); else this.bets.get(key).delete(parts[4]);
      }
    });
    await new Promise((r) => this.client.subscribe(`${this.sala}/#`, { qos: 1 }, r));
    return this;
  }

  apuestas(epoch, round) {
    return this.bets.get(`${epoch}|${round}`) ?? new Map();
  }

  // Espera a que se cumpla una condición sobre lo que hay en el servidor.
  async esperar(cond, { timeout = 20000, que = 'condición' } = {}) {
    const fin = Date.now() + timeout;
    while (Date.now() < fin) {
      if (cond(this)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Tiempo agotado esperando: ${que}`);
  }

  cerrar() {
    return new Promise((r) => this.client.end(false, {}, r));
  }
}

// Generador pseudoaleatorio con semilla, para que las apuestas sean reproducibles.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
