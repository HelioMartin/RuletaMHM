// Conexión en tiempo real entre las tres apps (MQTT sobre WebSocket).
//
// Temas (todos con "retain", así quien llega tarde recibe el estado completo):
//   <sala>/state                         estado de la partida (lo publica el mando)
//   <sala>/e/<epoca>/p/<jugador>         alta de un jugador
//   <sala>/e/<epoca>/b/<ronda>/<jugador> apuesta confirmada de un jugador
// La "época" cambia al reiniciar la partida, así los datos viejos dejan de contar.

import mqttModule from '../vendor/mqtt.esm.js';
import { CONFIG } from './config.js';

const mqtt = typeof mqttModule.connect === 'function' ? mqttModule : mqttModule.default;

export const DEFAULT_STATE = Object.freeze({
  v: 1,
  epoch: 'e1',
  rev: 0,
  round: 0,
  totalRounds: CONFIG.totalRounds,
  phase: 'lobby',
  history: [],
  removed: [],
  updatedAt: 0,
});

export function randomId(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

const decoder = new TextDecoder();

export class GameLink extends EventTarget {
  constructor(role) {
    super();
    this.role = role;
    this.ns = CONFIG.namespace;
    this.state = structuredClone(DEFAULT_STATE);
    this.hasState = false;
    this.connected = false;
    this.ready = false;
    this.epochs = new Map(); // epoca -> { players: Map, bets: Map(ronda -> Map) }
  }

  on(type, fn) {
    this.addEventListener(type, (ev) => fn(ev.detail));
    return this;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get epoch() {
    return this.state.epoch;
  }

  bucket(epoch = this.epoch) {
    if (!this.epochs.has(epoch)) this.epochs.set(epoch, { players: new Map(), bets: new Map() });
    return this.epochs.get(epoch);
  }

  players(epoch = this.epoch) {
    return this.bucket(epoch).players;
  }

  // Jugadores apuntados que no han sido retirados.
  activePlayers() {
    const removed = new Set(this.state.removed ?? []);
    const out = new Map();
    for (const [pid, p] of this.players()) if (!removed.has(pid)) out.set(pid, p);
    return out;
  }

  bets(round = this.state.round, epoch = this.epoch) {
    const b = this.bucket(epoch).bets;
    if (!b.has(round)) b.set(round, new Map());
    return b.get(round);
  }

  activeBets(round = this.state.round) {
    const removed = new Set(this.state.removed ?? []);
    const out = new Map();
    for (const [pid, bet] of this.bets(round)) if (!removed.has(pid)) out.set(pid, bet);
    return out;
  }

  connect() {
    const client = mqtt.connect(CONFIG.brokerUrl, {
      clientId: `ruleta-${this.role}-${randomId(8)}`,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 2500,
      connectTimeout: 12000,
      protocolVersion: 4,
    });
    this.client = client;

    client.on('connect', () => {
      this.connected = true;
      this.emit('connection', true);
      client.subscribe(`${this.ns}/#`, { qos: 1 }, () => {
        // Damos un margen para que lleguen los mensajes retenidos.
        setTimeout(() => {
          const first = !this.ready;
          this.ready = true;
          this.emit('ready', { first });
        }, 900);
      });
    });
    const down = () => {
      if (!this.connected) return;
      this.connected = false;
      this.emit('connection', false);
    };
    client.on('close', down);
    client.on('offline', down);
    client.on('error', (err) => this.emit('error', err));
    client.on('message', (topic, payload) => this.handle(topic, payload));
    return this;
  }

  handle(topic, payload) {
    if (!topic.startsWith(`${this.ns}/`)) return;
    const parts = topic.slice(this.ns.length + 1).split('/');
    const text = payload?.length ? decoder.decode(payload) : '';
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { return; }
    }

    if (parts[0] === 'state' && parts.length === 1) {
      if (!data || typeof data !== 'object' || !data.epoch) return;
      // Un eco atrasado de la misma partida no debe pisar un estado más nuevo.
      if (this.hasState && data.epoch === this.state.epoch && (data.rev ?? 0) < (this.state.rev ?? 0)) return;
      const prev = this.state;
      this.state = { ...structuredClone(DEFAULT_STATE), ...data };
      this.hasState = true;
      this.emit('state', { prev, state: this.state });
      return;
    }

    if (parts[0] !== 'e' || parts.length < 4) return;
    const epoch = parts[1];
    const kind = parts[2];
    const bucket = this.bucket(epoch);

    if (kind === 'p' && parts.length === 4) {
      const pid = parts[3];
      if (data?.name) bucket.players.set(pid, { pid, name: String(data.name).slice(0, 60), at: data.at ?? 0 });
      else bucket.players.delete(pid);
      this.emit('player', { epoch, pid, data });
      return;
    }

    if (kind === 'b' && parts.length === 5) {
      const round = Number(parts[3]);
      const pid = parts[4];
      if (!bucket.bets.has(round)) bucket.bets.set(round, new Map());
      const map = bucket.bets.get(round);
      if (data?.cell) map.set(pid, { cell: data.cell, name: String(data.name ?? '').slice(0, 60), at: data.at ?? Date.now() });
      else map.delete(pid);
      this.emit('bet', { epoch, round, pid, data });
    }
  }

  publish(rel, obj, { retain = true, timeout = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client) return reject(new Error('Sin conexión'));
      const timer = setTimeout(() => reject(new Error('Tiempo de espera agotado')), timeout);
      const body = obj == null ? '' : JSON.stringify(obj);
      this.client.publish(`${this.ns}/${rel}`, body, { qos: 1, retain }, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  publishState(state) {
    return this.publish('state', state);
  }

  register(pid, name, epoch = this.epoch) {
    return this.publish(`e/${epoch}/p/${pid}`, { name, at: Date.now() });
  }

  unregister(pid, epoch = this.epoch) {
    return this.publish(`e/${epoch}/p/${pid}`, null);
  }

  placeBet(round, pid, cell, name, epoch = this.epoch) {
    return this.publish(`e/${epoch}/b/${round}/${pid}`, { cell, name, at: Date.now() });
  }

  clearBet(round, pid, epoch = this.epoch) {
    return this.publish(`e/${epoch}/b/${round}/${pid}`, null);
  }
}

// Agrupa repintados: muchas actualizaciones seguidas -> un solo repintado por fotograma.
export function scheduler(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}
