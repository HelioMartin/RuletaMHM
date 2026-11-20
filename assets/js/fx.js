// Efectos de casino: sonidos sintetizados, partículas (confeti dorado y polvo de harina),
// revelación del resultado, avisos y diálogos.
import { CELLS, iconSVG, escapeHTML, groupName } from './board.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Sonido ----------

let ctx = null;
let master = null;
let muted = (() => {
  try { return localStorage.getItem('ruleta-muted') === '1'; } catch { return false; }
})();

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { at = 0, dur = 0.18, type = 'triangle', gain = 0.22, slide = null } = {}) {
  const ac = audio();
  if (!ac || muted) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ at = 0, dur = 0.05, gain = 0.3, freq = 2600, q = 1.2 } = {}) {
  const ac = audio();
  if (!ac || muted) return;
  const t = ac.currentTime + at;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

// ---------- Ruleta girando con la bolita ----------
// Tiempos en segundos: la bolita rueda por la pista frenándose, cae, rebota por las
// casillas y se queda en una mientras el cilindro sigue girando y se apaga.
const SPIN = { roll: 9, settle: 1.4, tail: 2.6 };

function noiseBuffer(ac, seconds) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Golpe seco de la bolita (marfil contra metal o madera).
function ballClick(ac, dest, at, { gain = 0.3, freq = 3600, q = 4, ping = 2500 } = {}) {
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(dest);
  src.start(at);
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(ping, at);
  osc.frequency.exponentialRampToValueAtTime(ping * 0.86, at + 0.045);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, at);
  og.gain.exponentialRampToValueAtTime(gain * 0.3, at + 0.002);
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(og).connect(dest);
  osc.start(at);
  osc.stop(at + 0.06);
}

// Construye el sonido completo en cualquier contexto de audio (también en uno offline).
export function spinGraph(ac, dest, t0 = ac.currentTime) {
  const { roll, settle, tail } = SPIN;
  const end = t0 + roll + settle + tail;
  const noise = noiseBuffer(ac, 2);

  // 1) La bolita rodando por la pista: siseo que late con cada vuelta y se va frenando.
  const ball = ac.createBufferSource();
  ball.buffer = noise;
  ball.loop = true;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 700;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(3400, t0);
  bp.frequency.exponentialRampToValueAtTime(1500, t0 + roll);
  const lap = ac.createGain();
  lap.gain.value = 0.55;
  const lfo = ac.createOscillator();
  lfo.frequency.setValueAtTime(3.6, t0);
  lfo.frequency.exponentialRampToValueAtTime(0.9, t0 + roll);
  const depth = ac.createGain();
  depth.gain.value = 0.45;
  lfo.connect(depth).connect(lap.gain);
  const rollGain = ac.createGain();
  rollGain.gain.setValueAtTime(0.0001, t0);
  rollGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.3);
  rollGain.gain.linearRampToValueAtTime(0.36, t0 + roll - 0.5);
  rollGain.gain.exponentialRampToValueAtTime(0.0001, t0 + roll + 0.2);
  ball.connect(hp).connect(bp).connect(lap).connect(rollGain).connect(dest);
  ball.start(t0);
  ball.stop(t0 + roll + 0.3);
  lfo.start(t0);
  lfo.stop(t0 + roll + 0.3);

  // 2) Rumor grave del cilindro de madera, que sigue girando hasta el final.
  const wheel = ac.createBufferSource();
  wheel.buffer = noise;
  wheel.loop = true;
  wheel.playbackRate.value = 0.7;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(260, t0);
  lp.frequency.linearRampToValueAtTime(150, end);
  const wheelGain = ac.createGain();
  wheelGain.gain.setValueAtTime(0.0001, t0);
  wheelGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.5);
  wheelGain.gain.linearRampToValueAtTime(0.45, t0 + roll + settle);
  wheelGain.gain.exponentialRampToValueAtTime(0.0001, end);
  wheel.connect(lp).connect(wheelGain).connect(dest);
  wheel.start(t0);
  wheel.stop(end + 0.05);

  // 3) Toques contra los rombos cuando la bolita empieza a perder velocidad.
  [0.6, 0.71, 0.8, 0.87, 0.92, 0.96].forEach((k, i) => {
    ballClick(ac, dest, t0 + roll * k, { gain: 0.12 + i * 0.04, freq: 4300, ping: 3200 });
  });

  // 4) Cae, rebota por las casillas y se queda en una.
  const bounces = [0, 0.3, 0.52, 0.68, 0.8, 0.9, 0.98, 1.05, 1.11, 1.16, 1.2, 1.235, 1.262, 1.285];
  bounces.forEach((dt, i) => {
    const fade = 1 - i / bounces.length;
    ballClick(ac, dest, t0 + roll + dt, {
      gain: 0.07 + 0.75 * fade ** 1.4,
      freq: 3100 - i * 70,
      ping: 2350 - i * 45,
    });
  });

  return { end, sources: [ball, lfo, wheel] };
}

let spin = null;

export const sound = {
  unlock() { audio(); },
  get muted() { return muted; },
  set muted(value) {
    muted = Boolean(value);
    try { localStorage.setItem('ruleta-muted', muted ? '1' : '0'); } catch { /* sin almacenamiento */ }
    if (muted) sound.spinStop();
  },
  // La ruleta girando con la bolita (mientras dura el "No va más").
  spinStart({ delay = 0 } = {}) {
    const ac = audio();
    if (!ac || muted) return;
    sound.spinStop();
    const out = ac.createGain();
    out.connect(master);
    const graph = spinGraph(ac, out, ac.currentTime + delay);
    const current = { out, ...graph };
    spin = current;
    setTimeout(() => {
      if (spin === current) spin = null;
      out.disconnect();
    }, (graph.end - ac.currentTime + 0.6) * 1000);
  },
  // Corta el giro con un fundido corto (p. ej. cuando el crupier marca el resultado).
  spinStop() {
    if (!spin || !ctx) return;
    const { out, sources } = spin;
    spin = null;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    for (const src of sources) {
      try { src.stop(t + 0.25); } catch { /* ya parada */ }
    }
    setTimeout(() => out.disconnect(), 400);
  },
  // Ficha sobre el tapete: dos golpes secos.
  chip() {
    noise({ dur: 0.035, gain: 0.5, freq: 3200 });
    tone(190, { dur: 0.06, type: 'sine', gain: 0.18 });
    noise({ at: 0.07, dur: 0.025, gain: 0.25, freq: 3800 });
  },
  confirm() {
    tone(988, { dur: 0.12, gain: 0.16 });
    tone(1319, { at: 0.08, dur: 0.28, gain: 0.16 });
  },
  open() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.085, dur: 0.22, gain: 0.14 }));
  },
  close() {
    tone(147, { dur: 1.4, type: 'sine', gain: 0.35 });
    tone(294, { dur: 1.0, type: 'sine', gain: 0.12 });
    tone(441, { at: 0.01, dur: 0.6, type: 'sine', gain: 0.06 });
  },
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.24, gain: 0.17 }));
    [523, 659, 784, 1047].forEach((f) => tone(f, { at: 0.72, dur: 0.9, gain: 0.08 }));
  },
  bonus() {
    for (let i = 0; i < 9; i++) tone(1200 + i * 160, { at: i * 0.045, dur: 0.16, type: 'sine', gain: 0.08 });
    tone(784, { at: 0.42, dur: 0.6, gain: 0.12 });
    tone(1047, { at: 0.42, dur: 0.7, gain: 0.1 });
  },
  lose() {
    tone(392, { dur: 0.22, type: 'sine', gain: 0.14 });
    tone(330, { at: 0.18, dur: 0.4, type: 'sine', gain: 0.12 });
  },
  reveal() {
    for (let i = 0; i < 14; i++) noise({ at: i * 0.05, dur: 0.04, gain: 0.08 + i * 0.012, freq: 900, q: 0.8 });
    tone(523, { at: 0.72, dur: 0.5, gain: 0.14 });
    tone(784, { at: 0.72, dur: 0.6, gain: 0.12 });
  },
  tick() { tone(1800, { dur: 0.03, type: 'square', gain: 0.03 }); },
};

// ---------- Partículas ----------

let canvas = null;
let c2d = null;
let particles = [];
let running = false;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  c2d = canvas.getContext('2d');
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
}

const CONFETTI = ['#F0D488', '#C8A04A', '#FFF3C9', '#E3262B', '#2B8ED3', '#F1EADB'];

/**
 * kind: 'confetti' (dorado) o 'flour' (nube de harina).
 * x, y: origen en píxeles (por defecto, centro de la pantalla).
 */
export function burst({ kind = 'confetti', count = 140, x = innerWidth / 2, y = innerHeight * 0.42, spread = 1 } = {}) {
  if (reduceMotion()) return;
  ensureCanvas();
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    if (kind === 'flour') {
      const speed = (1.2 + Math.random() * 4.5) * spread;
      particles.push({
        kind, x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        r: 3 + Math.random() * 14,
        life: 0, max: 70 + Math.random() * 70,
        alpha: 0.25 + Math.random() * 0.35,
      });
    } else {
      const speed = (5 + Math.random() * 10) * spread;
      particles.push({
        kind, x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 7,
        w: 6 + Math.random() * 7,
        h: 9 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: CONFETTI[i % CONFETTI.length],
        life: 0, max: 150 + Math.random() * 80,
      });
    }
  }
  if (!running) {
    running = true;
    requestAnimationFrame(step);
  }
}

// Lluvia de confeti desde arriba (podio final).
export function rain(seconds = 4) {
  if (reduceMotion()) return;
  const end = performance.now() + seconds * 1000;
  const drop = () => {
    for (let i = 0; i < 6; i++) {
      burst({ kind: 'confetti', count: 1, x: Math.random() * innerWidth, y: -20, spread: 0.25 });
    }
    if (performance.now() < end) setTimeout(drop, 60);
  };
  drop();
}

function step() {
  c2d.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life < p.max);
  for (const p of particles) {
    p.life++;
    const fade = 1 - p.life / p.max;
    if (p.kind === 'flour') {
      p.vx *= 0.955;
      p.vy = p.vy * 0.955 - 0.015;
      p.x += p.vx;
      p.y += p.vy;
      p.r += 0.22;
      const g = c2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(250, 246, 236, ${p.alpha * fade})`);
      g.addColorStop(1, 'rgba(250, 246, 236, 0)');
      c2d.fillStyle = g;
      c2d.beginPath();
      c2d.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c2d.fill();
    } else {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.32;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      c2d.save();
      c2d.globalAlpha = Math.min(1, fade * 1.6);
      c2d.translate(p.x, p.y);
      c2d.rotate(p.rot);
      c2d.scale(1, Math.cos(p.life * 0.18 + p.w));
      c2d.fillStyle = p.color;
      c2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c2d.restore();
    }
  }
  if (particles.length) requestAnimationFrame(step);
  else {
    running = false;
    c2d.clearRect(0, 0, innerWidth, innerHeight);
  }
}

// ---------- Revelación del resultado ----------

let currentReveal = null;

export function closeReveal() {
  if (!currentReveal) return;
  const el = currentReveal;
  currentReveal = null;
  clearTimeout(el._timer);
  el.classList.add('is-leaving');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

/**
 * Muestra el resultado de una tirada a pantalla completa.
 * opts: { outcome, kicker, bodyHTML, tone: 'win'|'bonus'|'lose'|'neutral', autoClose (ms), button }
 */
export function showReveal({ outcome, kicker = '', bodyHTML = '', tone = 'neutral', autoClose = 0, button = 'Continuar', onClose } = {}) {
  closeReveal();
  const cell = CELLS[outcome];
  if (!cell) return null;
  const medalClass = cell.kind === 'bonus' ? 'is-bonus' : `is-${cell.group}`;
  const title = cell.kind === 'bonus' ? `Bonus ${cell.label.toLowerCase()}` : cell.label;
  const sub = cell.kind === 'bonus' ? 'Todos los jugadores suman puntos' : groupName(cell.group);

  const el = document.createElement('div');
  el.className = `reveal reveal--${tone}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Ha salido ${title}`);
  el.innerHTML = `
    <div class="reveal__rays"></div>
    <div class="reveal__card">
      <p class="reveal__kicker">${escapeHTML(kicker)}</p>
      <div class="reveal__medallion ${medalClass}">${iconSVG(cell.icon ?? 'sack')}</div>
      <h2 class="reveal__name">${escapeHTML(cell.kind === 'bonus' ? `BONUS ${cell.label}` : cell.label)}</h2>
      <p class="reveal__group">${escapeHTML(sub)}</p>
      <div class="reveal__body">${bodyHTML}</div>
      ${button ? `<div class="reveal__actions"><button type="button" class="btn">${escapeHTML(button)}</button></div>` : ''}
    </div>`;
  document.body.append(el);
  currentReveal = el;
  const btn = el.querySelector('.reveal__actions .btn');
  btn?.addEventListener('click', () => {
    closeReveal();
    onClose?.();
  });
  setTimeout(() => btn?.focus({ preventScroll: true }), 700);

  sound.reveal();
  setTimeout(() => {
    burst({ kind: 'flour', count: 70 });
    if (tone === 'win' || tone === 'bonus') {
      burst({ kind: 'confetti', count: tone === 'win' ? 170 : 120 });
      tone === 'win' ? sound.win() : sound.bonus();
    } else if (tone === 'lose') {
      sound.lose();
    }
  }, 700);

  if (autoClose) {
    el._timer = setTimeout(() => {
      if (currentReveal === el) {
        closeReveal();
        onClose?.();
      }
    }, autoClose);
  }
  return el;
}

// ---------- Avisos ----------

export function banner(text, { tone = 'gold', ms = 2600 } = {}) {
  document.querySelectorAll('.banner').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = `banner${tone === 'red' ? ' banner--red' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ---------- Diálogo de confirmación ----------

export function confirmDialog({ title, text = '', confirm = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="modal__card plaque">
        <h2 class="modal__title">${escapeHTML(title)}</h2>
        ${text ? `<p class="modal__text">${escapeHTML(text)}</p>` : ''}
        <div class="modal__actions">
          <button type="button" class="btn ${danger ? 'btn--danger' : ''}" data-ok>${escapeHTML(confirm)}</button>
          <button type="button" class="btn btn--ghost" data-cancel>${escapeHTML(cancel)}</button>
        </div>
      </div>`;
    const done = (value) => {
      el.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') done(false); };
    el.addEventListener('click', (ev) => {
      if (ev.target === el) done(false);
      if (ev.target.closest('[data-ok]')) done(true);
      if (ev.target.closest('[data-cancel]')) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(el);
    el.querySelector('[data-ok]').focus();
  });
}

// ---------- Animación FLIP para listas que se reordenan ----------

export function flip(container, selector, mutate) {
  const before = new Map();
  container.querySelectorAll(selector).forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect()));
  mutate();
  if (reduceMotion()) return;
  container.querySelectorAll(selector).forEach((el) => {
    const old = before.get(el.dataset.key);
    if (!old) {
      el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      return;
    }
    const now = el.getBoundingClientRect();
    const dy = old.top - now.top;
    if (Math.abs(dy) < 1) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
      duration: 700,
      easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
    });
  });
}

// Cuenta animada de un número (puntos).
export function countTo(el, to, ms = 900) {
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = to;
  if (from === to || reduceMotion()) {
    el.textContent = to;
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
