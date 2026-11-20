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
// La bolita rodando rápido por la pista de madera, a velocidad constante y en bucle
// mientras dura el "No va más" (sin frenada ni rebotes). Se precalcula un bucle de
// varias vueltas: rodadura rugosa (muchos micro-golpes + rumor), con el vaivén de
// cada vuelta y la resonancia hueca del cuenco; en estéreo la bolita da vueltas.
const SPIN = { lap: 0.46, laps: 8, maxSeconds: 45 };

let rollCache = null;

function rollLoop(ac) {
  if (rollCache && rollCache.sampleRate === ac.sampleRate && rollCache.ctx === ac) return rollCache.buffer;
  const sr = ac.sampleRate;
  const lapLen = Math.round(SPIN.lap * sr);
  const len = lapLen * SPIN.laps;
  const fade = Math.round(0.04 * sr);
  const raw = new Float32Array(len + fade);
  const gritRate = 1600 / sr;
  let brown = 0;
  let grit = 0;
  let seam = 0;
  for (let i = 0; i < raw.length; i++) {
    const phase = (i % lapLen) / lapLen;
    const near = 0.5 + 0.5 * Math.cos(2 * Math.PI * phase); // lado cercano de la pista
    const env = 0.5 + 0.5 * near ** 1.5;
    const white = Math.random() * 2 - 1;
    brown = brown * 0.982 + white * 0.07;
    if (Math.random() < gritRate) grit += (0.25 + Math.random() ** 2) * (Math.random() < 0.5 ? -1 : 1) * (0.55 + 0.6 * near);
    grit *= 0.78;
    // Un pequeño traqueteo por vuelta al pasar por la junta de la pista.
    if (i % lapLen === Math.round(lapLen * 0.62)) seam = 0.9 + Math.random() * 0.5;
    seam *= 0.9965;
    const rattle = seam > 0.02 && Math.random() < 0.08 ? (Math.random() * 2 - 1) * seam : 0;
    raw[i] = env * (brown * 0.55 + white * 0.12 + grit * 1.35) + rattle * 0.5;
  }
  // Fundido cruzado del final con el principio para que el bucle no se note.
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    raw[i] = raw[i] * k + raw[len + i] * (1 - k);
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(raw[i]));
  const buffer = ac.createBuffer(1, len, sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (raw[i] / peak) * 0.9;
  rollCache = { ctx: ac, sampleRate: sr, buffer };
  return buffer;
}

// Construye el sonido en cualquier contexto de audio (también en uno offline).
export function spinGraph(ac, dest, t0 = ac.currentTime, { duration = SPIN.maxSeconds } = {}) {
  const end = t0 + duration;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(1, t0 + 0.35);
  env.gain.setValueAtTime(1, Math.max(t0 + 0.35, end - 1.5));
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);

  // 1) La bolita: bucle de rodadura con el color de la madera del cuenco.
  const ball = ac.createBufferSource();
  ball.buffer = rollLoop(ac);
  ball.loop = true;
  const eq = [
    ['highpass', 170, 0.7, 0],
    ['peaking', 380, 1.1, 7],
    ['peaking', 1150, 1.4, 4],
    ['peaking', 3100, 1.6, 6],
    ['lowpass', 7500, 0.7, 0],
  ].map(([type, freq, q, gain]) => {
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  });
  const ballGain = ac.createGain();
  ballGain.gain.value = 0.85;
  let node = ball;
  for (const f of eq) node = node.connect(f);
  node = node.connect(ballGain);
  // En estéreo, la bolita recorre la pista de un lado a otro con cada vuelta.
  let lfo = null;
  if (typeof ac.createStereoPanner === 'function') {
    const pan = ac.createStereoPanner();
    lfo = ac.createOscillator();
    lfo.frequency.value = 1 / SPIN.lap;
    const depth = ac.createGain();
    depth.gain.value = 0.6;
    lfo.connect(depth).connect(pan.pan);
    node.connect(pan).connect(env);
    lfo.start(t0);
    lfo.stop(end + 0.05);
  } else {
    node.connect(env);
  }
  ball.start(t0);
  ball.stop(end + 0.05);

  // 2) El cilindro girando: un rumor grave y suave por debajo.
  const rotorLen = Math.floor(ac.sampleRate * 2);
  const rotorBuf = ac.createBuffer(1, rotorLen, ac.sampleRate);
  const rd = rotorBuf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < rotorLen; i++) {
    b = b * 0.995 + (Math.random() * 2 - 1) * 0.05;
    rd[i] = b;
  }
  const rotor = ac.createBufferSource();
  rotor.buffer = rotorBuf;
  rotor.loop = true;
  const rotorLp = ac.createBiquadFilter();
  rotorLp.type = 'lowpass';
  rotorLp.frequency.value = 160;
  const rotorGain = ac.createGain();
  rotorGain.gain.value = 0.1;
  rotor.connect(rotorLp).connect(rotorGain).connect(env);
  rotor.start(t0);
  rotor.stop(end + 0.05);

  return { end, sources: [ball, rotor, lfo].filter(Boolean) };
}

// ---------- Sonido real de la ruleta (si está en assets/audio) ----------
// ruleta-giro.wav: bucle de la bola girando. ruleta-final.mp3: la bola frena, cae y se para.
// Si no se pueden cargar, se usa el sonido sintetizado de arriba.
const SAMPLE_URLS = [
  new URL('../audio/ruleta-giro.wav', import.meta.url),
  new URL('../audio/ruleta-final.mp3', import.meta.url),
];
let samples = null;

function loadSamples(ac) {
  if (!samples) {
    samples = Promise.all(SAMPLE_URLS.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ac.decodeAudioData(await res.arrayBuffer());
    }))
      .then(([loop, end]) => ({ loop, end }))
      .catch(() => null);
  }
  return samples;
}

// Sonidos de giro en curso: el bucle mientras gira y el final cuando se marca el resultado.
const spinning = new Set();

function fadeOutHandle(handle, seconds = 0.2) {
  spinning.delete(handle);
  if (!ctx) return;
  const t = ctx.currentTime;
  handle.stopped = true;
  handle.out.gain.cancelScheduledValues(t);
  handle.out.gain.setValueAtTime(Math.max(handle.out.gain.value, 0.0001), t);
  handle.out.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  for (const src of handle.sources) {
    try { src.stop(t + seconds + 0.05); } catch { /* ya parada */ }
  }
  setTimeout(() => handle.out.disconnect(), (seconds + 0.3) * 1000);
}

function newHandle(ac, kind) {
  const out = ac.createGain();
  out.connect(master);
  const handle = { kind, out, sources: [], stopped: false };
  spinning.add(handle);
  return handle;
}

export const sound = {
  unlock() { audio(); },
  get muted() { return muted; },
  set muted(value) {
    muted = Boolean(value);
    try { localStorage.setItem('ruleta-muted', muted ? '1' : '0'); } catch { /* sin almacenamiento */ }
    if (muted) sound.spinStop();
  },
  // Carga por adelantado el sonido real de la ruleta.
  preloadSpin() {
    const ac = audio();
    if (ac) loadSamples(ac);
  },
  // La bola girando, en bucle, mientras dura el "No va más".
  spinStart({ delay = 0 } = {}) {
    const ac = audio();
    if (!ac || muted) return;
    sound.spinStop();
    const handle = newHandle(ac, 'loop');
    const startAt = ac.currentTime + delay;
    loadSamples(ac).then((smp) => {
      if (handle.stopped) return;
      const t0 = Math.max(ac.currentTime, startAt);
      if (smp) {
        const src = ac.createBufferSource();
        src.buffer = smp.loop;
        src.loop = true;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(1, t0 + 0.4);
        src.connect(g).connect(handle.out);
        src.start(t0);
        handle.sources.push(src);
        // Por seguridad, si nadie marca resultado se apaga sola a los 45 s.
        handle.out.gain.setValueAtTime(1, t0 + 43);
        handle.out.gain.exponentialRampToValueAtTime(0.0001, t0 + 45);
        src.stop(t0 + 45.1);
      } else {
        handle.sources.push(...spinGraph(ac, handle.out, t0).sources);
      }
    });
  },
  // El crupier ha marcado el resultado: la bola frena, cae y se para.
  spinFinish(seconds) {
    const ac = audio();
    if (!ac || muted) return;
    for (const h of [...spinning]) fadeOutHandle(h, 0.35);
    const handle = newHandle(ac, 'finish');
    loadSamples(ac).then((smp) => {
      if (handle.stopped) return;
      const t0 = ac.currentTime;
      if (smp) {
        const src = ac.createBufferSource();
        src.buffer = smp.end;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(1, t0 + 0.15);
        src.connect(g).connect(handle.out);
        src.start(t0);
        handle.sources.push(src);
        src.onended = () => spinning.delete(handle);
      } else {
        handle.sources.push(...spinGraph(ac, handle.out, t0, { duration: seconds }).sources);
      }
    });
  },
  // Corta cualquier giro con un fundido corto.
  spinStop() {
    for (const h of [...spinning]) fadeOutHandle(h, 0.2);
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
