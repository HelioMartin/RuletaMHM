// Mesa proyectada: tapete con las fichas en directo, ranking, historial y avisos.
import { CONFIG, carryParams } from '../assets/js/config.js';
import { GameLink, scheduler } from '../assets/js/net.js';
import {
  renderBoard, paintChips, CELLS, createChip, escapeHTML, groupName, shortName, wheelSVG,
} from '../assets/js/board.js';
import { standingsWithMovement, PHASE_TEXT } from '../assets/js/game.js';
import {
  sound, showReveal, closeReveal, banner, flip, rain, burst,
} from '../assets/js/fx.js';

const $ = (id) => document.getElementById(id);
const KEY_SEEN = `ruleta-mesa-seen:${CONFIG.namespace}`;
const seenGet = () => { try { return localStorage.getItem(KEY_SEEN); } catch { return null; } };
const seenSet = (v) => { try { localStorage.setItem(KEY_SEEN, v); } catch { /* nada */ } };

const link = new GameLink('mesa').connect();
const render = scheduler(paint);

const { cells } = renderBoard($('board'), { orientation: 'landscape' });
for (const el of Object.values(cells)) el.tabIndex = -1;
$('spin-wheel').innerHTML = wheelSVG({ labels: true });
$('lobby-wheel').innerHTML = wheelSVG({ labels: false });

// ---------- Código QR para entrar ----------
const joinUrl = carryParams('../jugar/');
function qrSVG(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: 'Código QR para jugar' });
}
$('qr-small').innerHTML = qrSVG(joinUrl);
$('qr-big').innerHTML = qrSVG(joinUrl);

// ---------- Esquina: sonido y pantalla completa ----------
const corner = document.querySelector('.corner');
corner.classList.add('is-attention');
let soundOn = false;
$('sound-btn').addEventListener('click', () => {
  sound.unlock();
  soundOn = !soundOn;
  sound.muted = !soundOn;
  $('sound-btn').textContent = soundOn ? 'Silenciar' : 'Activar sonido';
  corner.classList.remove('is-attention');
  if (soundOn) sound.confirm();
  // Si se activa el sonido con la ruleta ya girando, que se oiga la bolita.
  if (soundOn && link.state.phase === 'closed') sound.spinStart({ delay: 0.3 });
});
sound.muted = true;
let idleTimer = null;
function wake() {
  corner.classList.remove('is-idle');
  document.body.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    corner.classList.add('is-idle');
    document.body.classList.add('is-idle');
  }, 4000);
}
addEventListener('mousemove', wake);
wake();
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('fs-btn').addEventListener('click', toggleFullscreen);
addEventListener('keydown', (ev) => {
  if (ev.key === 'f' || ev.key === 'F') toggleFullscreen();
});

link.on('connection', (on) => {
  $('live').classList.toggle('is-on', on);
  $('live').textContent = on ? 'En directo' : 'Reconectando…';
});

// ---------- Cambios de fase ----------
let lastKey = null;
let lastPhase = null;
let firstPaint = true;

function announce() {
  const s = link.state;
  const key = `${s.epoch}:${s.round}:${s.phase}:${s.history.length}`;
  if (key === lastKey) return;
  const initial = lastKey === null;
  const prevPhase = lastPhase;
  lastKey = key;
  lastPhase = s.phase;

  $('lobby').hidden = s.phase !== 'lobby';
  $('spin').hidden = s.phase !== 'closed';
  if (s.phase !== 'finished') $('podium').hidden = true;
  if (s.phase !== 'result') closeReveal();
  if (s.phase !== 'closed') sound.spinStop();

  if (s.phase === 'open' && !initial) {
    banner(`Ronda ${s.round}: hagan sus apuestas`);
    sound.open();
  }
  // Gong y ruleta girando solo al cerrar de verdad las apuestas (no al deshacer un resultado).
  if (s.phase === 'closed' && !initial && prevPhase === 'open') {
    sound.close();
    sound.spinStart({ delay: 0.7 });
  }
  if (s.phase === 'result' && s.history.length) {
    const entry = s.history[s.history.length - 1];
    const id = `${s.epoch}:${entry.round}:${entry.outcome}`;
    if (seenGet() !== id) {
      seenSet(id);
      revealResult(entry);
    }
  }
  if (s.phase === 'finished') showPodium(!initial);
}

function revealResult(entry) {
  const o = CELLS[entry.outcome];
  const removed = new Set(link.state.removed ?? []);
  const nameOf = (pid) => entry.players?.[pid] ?? link.players().get(pid)?.name ?? '';
  const tags = (pids) => pids.slice(0, 24).map((pid) => {
    const chip = createChip(pid, nameOf(pid)).outerHTML;
    return `<span class="name-tag">${chip}${escapeHTML(shortName(nameOf(pid)))}</span>`;
  }).join('') + (pids.length > 24 ? `<span class="name-tag">y ${pids.length - 24} más</span>` : '');

  let body = '';
  let tone = 'lose';
  if (o.kind === 'bonus') {
    const n = Object.keys(entry.players ?? {}).filter((pid) => !removed.has(pid)).length;
    body = `<p class="reveal__result is-win">+${CONFIG.points.bonus} puntos para todos</p>
      <p class="reveal__note">${n} ${n === 1 ? 'jugador suma' : 'jugadores suman'} puntos con este bonus.</p>`;
    tone = 'bonus';
  } else {
    const bets = Object.entries(entry.bets ?? {}).filter(([pid]) => !removed.has(pid));
    const exact = bets.filter(([, cell]) => cell === entry.outcome).map(([pid]) => pid);
    const group = bets.filter(([, cell]) => cell === o.group).map(([pid]) => pid);
    if (exact.length) {
      body += `<p class="reveal__result is-win">+${CONFIG.points.exact} para ${exact.length === 1 ? 'quien ha acertado' : `los ${exact.length} que han acertado`}</p>
        <div class="winners">${tags(exact)}</div>`;
    }
    if (group.length) {
      body += `<p class="reveal__note">+${CONFIG.points.group} para ${group.length} ${group.length === 1 ? 'jugador' : 'jugadores'} de ${groupName(o.group).toLowerCase()}</p>`;
      if (!exact.length) body += `<div class="winners">${tags(group)}</div>`;
    }
    if (exact.length || group.length) tone = 'win';
    else body = '<p class="reveal__result is-lose">Nadie ha acertado esta vez</p>';
  }
  showReveal({
    outcome: entry.outcome,
    kicker: `Ronda ${entry.round}. Ha salido`,
    bodyHTML: body,
    tone,
    button: null,
    autoClose: 16000,
    onClose: render,
  });
}

function showPodium(celebrate) {
  const rows = standings();
  const steps = [1, 2, 3].map((rank) => {
    const names = rows.filter((r) => r.rank === rank);
    return { rank, names, pts: names[0]?.points ?? 0 };
  });
  const order = [steps[1], steps[0], steps[2]];
  $('podium').innerHTML = `
    <div class="podium-screen__inner">
      <p class="podium-screen__kicker">Partida terminada</p>
      <h1 class="podium-screen__title">Podio final</h1>
      <div class="podium-steps">
        ${order.map((st) => `
          <div class="step step--${st.rank}">
            <div class="step__names${st.names.length ? '' : ' is-empty'}">${st.names.length ? st.names.map((r) => escapeHTML(r.name)).join('<br>') : 'Puesto ocupado por el empate anterior'}</div>
            <div class="step__pts">${st.names.length ? `${st.pts} puntos` : ''}</div>
            <div class="step__block">${st.rank}</div>
          </div>`).join('')}
      </div>
    </div>`;
  $('podium').hidden = false;
  if (celebrate) {
    sound.win();
    rain(7);
    setTimeout(() => burst({ kind: 'confetti', count: 220, y: innerHeight * 0.55 }), 1300);
  }
}

// ---------- Datos ----------
function standings() {
  return standingsWithMovement(link.state, link.activePlayers());
}

link.on('ready', () => { announce(); render(); });
link.on('state', () => { if (link.ready) announce(); render(); });
link.on('player', render);
link.on('bet', render);

// ---------- Pintado ----------
const seenBets = new Set();
const seenNames = new Set();
let lastChipSound = 0;

function paint() {
  const s = link.state;
  const players = link.activePlayers();
  const bets = link.activeBets();
  const rows = standings();
  const last = s.history[s.history.length - 1];

  // Cabecera
  $('round-num').textContent = s.round > 0 ? `Ronda ${s.round}` : 'Bienvenida';
  $('round-of').textContent = s.round > 0 ? `de ${s.totalRounds}` : '';
  $('phase').textContent = PHASE_TEXT[s.phase] ?? '';
  $('phase').className = `phase is-${s.phase}`;

  // Fichas: animamos solo las que llegan nuevas
  const fresh = new Set();
  for (const [pid] of bets) {
    const key = `${s.epoch}:${s.round}:${pid}`;
    if (!seenBets.has(key)) {
      seenBets.add(key);
      if (!firstPaint) fresh.add(pid);
    }
  }
  paintChips(cells, bets, { animate: fresh });
  if (fresh.size && performance.now() - lastChipSound > 140) {
    lastChipSound = performance.now();
    sound.chip();
  }

  // Casilla ganadora
  const showWinner = last && (s.phase === 'result' || s.phase === 'finished') && last.round === s.round;
  for (const [id, el] of Object.entries(cells)) {
    const win = Boolean(showWinner && last.outcome === id);
    const groupWin = Boolean(showWinner && CELLS[last.outcome]?.group === id);
    el.classList.toggle('is-winner', win);
    el.classList.toggle('is-group-winner', groupWin);
    el.classList.toggle('is-dim', Boolean(showWinner && !win && !groupWin));
  }

  // Contadores y últimas apuestas
  $('bets-count').textContent = bets.size;
  $('players-count').textContent = players.size;
  paintFeed(bets, fresh);
  paintHistory(s);
  paintRanking(rows, s);
  paintLobby(players);
  firstPaint = false;
}

function paintFeed(bets, fresh) {
  const feed = $('feed');
  const recent = [...bets].sort((a, b) => b[1].at - a[1].at).slice(0, 3);
  if (!recent.length) {
    const s = link.state;
    feed.innerHTML = `<li class="feed__empty">${s.phase === 'open' ? 'Esperando las primeras apuestas…' : s.phase === 'lobby' ? 'La partida empieza en breve.' : ''}</li>`;
    return;
  }
  feed.innerHTML = recent.map(([pid, bet]) => `
    <li class="feed__item${fresh.has(pid) ? ' is-new' : ''}">${createChip(pid, bet.name).outerHTML}
      <span>${escapeHTML(shortName(bet.name))} apuesta a <b>${escapeHTML(CELLS[bet.cell]?.label ?? '')}</b></span></li>`).join('');
}

let historyLen = 0;
function paintHistory(s) {
  const slots = [];
  for (let n = 1; n <= s.totalRounds; n++) {
    const entry = s.history.find((e) => e.round === n);
    const o = entry && CELLS[entry.outcome];
    const cls = ['history__slot'];
    if (o) cls.push(o.kind === 'bonus' ? 'is-bonus' : `is-${o.group}`);
    if (n === s.round && !entry) cls.push('is-current');
    if (entry && s.history.length > historyLen && entry === s.history[s.history.length - 1]) cls.push('is-new');
    slots.push(`<li class="${cls.join(' ')}" title="Ronda ${n}">
      <span class="history__n">R${n}</span>
      <span class="history__label">${o ? escapeHTML(o.label) : n === s.round ? '?' : ''}</span></li>`);
  }
  $('history').innerHTML = slots.join('');
  historyLen = s.history.length;
}

// Ranking con páginas si no caben todos: los 3 primeros siempre fijos.
let rankPage = 0;
let rankPages = 1;
setInterval(() => {
  if (rankPages > 1) {
    rankPage = (rankPage + 1) % rankPages;
    render();
  }
}, 9000);

function rowHTML(r, s, pinned) {
  const move = r.delta > 0 ? `<span class="rk__move is-up">▲${r.delta}</span>`
    : r.delta < 0 ? `<span class="rk__move is-down">▼${-r.delta}</span>` : '<span class="rk__move"></span>';
  const showGain = (s.phase === 'result' || s.phase === 'finished') && r.last > 0;
  const top = pinned && r.points > 0 ? ` is-top is-top${Math.min(r.rank, 3)}` : '';
  return `<li class="rk${top}${showGain ? ' is-gainer' : ''}" data-key="${escapeHTML(r.pid)}">
    <span class="rk__pos">${r.rank}</span>
    ${createChip(r.pid, r.name).outerHTML}
    <span class="rk__name">${escapeHTML(r.name)}</span>
    ${move}
    <span class="rk__gain">${showGain ? `+${r.last}` : ''}</span>
    <span class="rk__pts">${r.points}</span>
  </li>`;
}

function paintRanking(rows, s) {
  const list = $('ranking');
  if (!rows.length) {
    list.innerHTML = '<li class="ranking__empty">Aún no hay jugadores. Escanea el código QR para sentarte a la mesa.</li>';
    $('rank-page').textContent = '';
    rankPages = 1;
    return;
  }
  const vh = innerHeight / 100;
  const pinned = rows.slice(0, 3);
  const rest = rows.slice(3);
  const free = list.clientHeight - pinned.length * (6.55 * vh) - (rest.length ? 1.4 * vh : 0);
  const cap = Math.max(1, Math.floor(free / (4.85 * vh)));
  rankPages = Math.max(1, Math.ceil(rest.length / cap));
  if (rankPage >= rankPages) rankPage = 0;
  const pageRows = rest.slice(rankPage * cap, rankPage * cap + cap);
  $('rank-page').textContent = rankPages > 1
    ? `${rows.length} jugadores, página ${rankPage + 1} de ${rankPages}`
    : `${rows.length} ${rows.length === 1 ? 'jugador' : 'jugadores'}`;
  flip(list, '.rk', () => {
    list.innerHTML = pinned.map((r) => rowHTML(r, s, true)).join('')
      + (rest.length ? '<li class="ranking__divider" aria-hidden="true"></li>' : '')
      + pageRows.map((r) => rowHTML(r, s, false)).join('');
  });
}

function paintLobby(players) {
  if ($('lobby').hidden) return;
  $('lobby-count').textContent = players.size;
  $('lobby-count-label').textContent = players.size === 1 ? 'jugador en la mesa' : 'jugadores en la mesa';
  const list = [...players.values()].sort((a, b) => b.at - a.at).slice(0, 36);
  $('lobby-names').innerHTML = list.map((p) => {
    const isNew = !seenNames.has(p.pid);
    seenNames.add(p.pid);
    return `<span class="name-tag${isNew ? ' is-new' : ''}">${createChip(p.pid, p.name).outerHTML}${escapeHTML(shortName(p.name))}</span>`;
  }).join('');
}

addEventListener('resize', render);
render();
