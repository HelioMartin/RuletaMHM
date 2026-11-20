// Mando del crupier: abre rondas, cierra apuestas y marca el resultado de la ruleta física.
import { CONFIG, carryParams } from '../assets/js/config.js';
import { GameLink, scheduler, DEFAULT_STATE, randomId } from '../assets/js/net.js';
import {
  renderBoard, CELLS, createChip, escapeHTML, groupName,
} from '../assets/js/board.js';
import { standingsWithMovement, PHASE_TEXT } from '../assets/js/game.js';
import { sound, banner, confirmDialog } from '../assets/js/fx.js';

const $ = (id) => document.getElementById(id);
const KEY_STATE = `ruleta-control-state:${CONFIG.namespace}`;
const KEY_OK = `ruleta-control-ok:${CONFIG.namespace}`;
const local = {
  get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ } },
};

// ---------- PIN ----------
function unlocked() {
  try { return sessionStorage.getItem(KEY_OK) === '1'; } catch { return false; }
}
$('gate-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if ($('pin').value.trim() === String(CONFIG.controlPin)) {
    try { sessionStorage.setItem(KEY_OK, '1'); } catch { /* nada */ }
    start();
  } else {
    $('gate-error').hidden = false;
    $('pin').select();
  }
});

let link = null;
let render = () => {};
let cells = {};

if (unlocked()) start();
else $('pin').focus();

function start() {
  $('gate').hidden = true;
  $('app').hidden = false;
  sound.unlock();
  $('link-mesa').href = carryParams('../mesa/');
  $('link-jugar').href = carryParams('../jugar/');

  link = new GameLink('control').connect();
  render = scheduler(paint);
  link.on('connection', (on) => {
    $('live').classList.toggle('is-on', on);
    $('live').textContent = on ? 'En directo' : 'Reconectando…';
  });
  link.on('ready', initState);
  link.on('state', render);
  link.on('player', render);
  link.on('bet', render);
  buildBoard();
  // Reservamos hueco para la barra de acciones fija.
  const dock = document.querySelector('.dock');
  new ResizeObserver(() => {
    document.querySelector('.ctl').style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  }).observe(dock);
  render();
}

// Al conectar: si el servidor no tiene estado (o tiene uno más antiguo que el nuestro), lo publicamos.
function initState() {
  const saved = local.get(KEY_STATE);
  if (!link.hasState) {
    const base = saved?.epoch ? saved : { ...structuredClone(DEFAULT_STATE) };
    publish(base);
  } else if (saved && saved.epoch === link.state.epoch && saved.rev > link.state.rev) {
    publish(saved);
  } else {
    local.set(KEY_STATE, link.state);
  }
  render();
}

function publish(next) {
  link.state = next;
  link.hasState = true;
  local.set(KEY_STATE, next);
  link.publishState(next).catch(() => showError('No se ha podido enviar el cambio. Revisa la conexión; se reenviará al reconectar.'));
  render();
}

function commit(mutate) {
  const next = structuredClone(link.state);
  mutate(next);
  next.rev = (link.state.rev || 0) + 1;
  next.updatedAt = Date.now();
  publish(next);
}

function showError(text) {
  document.querySelectorAll('.toast-error').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast-error';
  el.setAttribute('role', 'alert');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

// ---------- Acciones de partida ----------
const actions = {
  openRound() {
    const s = link.state;
    commit((n) => {
      n.round = s.phase === 'lobby' ? 1 : s.round + 1;
      n.phase = 'open';
    });
    sound.open();
  },
  closeBets() {
    commit((n) => { n.phase = 'closed'; });
    sound.close();
  },
  reopenBets() {
    commit((n) => { n.phase = 'open'; });
  },
  async markResult(outcome) {
    const s = link.state;
    const cell = CELLS[outcome];
    if (!cell || s.round < 1 || !['open', 'closed'].includes(s.phase)) return;
    const label = cell.kind === 'bonus' ? `Bonus ${cell.label}` : cell.label;
    const ok = await confirmDialog({
      title: `¿Ha salido ${label}?`,
      text: s.phase === 'open'
        ? 'Se cerrarán las apuestas, se anunciará el resultado en todas las pantallas y se repartirán los puntos.'
        : 'Se anunciará el resultado en todas las pantallas y se repartirán los puntos.',
      confirm: `Sí, ha salido ${label}`,
      cancel: 'Cancelar',
    });
    if (!ok) return;
    const round = link.state.round;
    const bets = {};
    const players = {};
    for (const [pid, p] of link.activePlayers()) players[pid] = p.name;
    for (const [pid, b] of link.activeBets(round)) {
      bets[pid] = b.cell;
      if (!(pid in players)) players[pid] = b.name;
    }
    commit((n) => {
      n.history = n.history.filter((e) => e.round !== round);
      n.history.push({ round, outcome, at: Date.now(), bets, players });
      n.phase = 'result';
    });
    sound.confirm();
  },
  async undoResult() {
    const s = link.state;
    if (s.phase === 'finished') {
      commit((n) => { n.phase = 'result'; });
      return;
    }
    const last = s.history[s.history.length - 1];
    if (!last) return;
    const ok = await confirmDialog({
      title: 'Deshacer el último resultado',
      text: `Se quitará "${CELLS[last.outcome]?.label}" de la ronda ${last.round} y se recalcularán los puntos. Las apuestas de esa ronda se mantienen.`,
      confirm: 'Deshacer resultado',
      danger: true,
    });
    if (!ok) return;
    commit((n) => {
      n.history = n.history.slice(0, -1);
      n.round = last.round;
      n.phase = 'closed';
    });
  },
  finish() {
    commit((n) => { n.phase = 'finished'; });
  },
  async extraRound() {
    const ok = await confirmDialog({
      title: 'Añadir una ronda de desempate',
      text: 'Se abrirá una ronda más para todos los jugadores.',
      confirm: 'Abrir ronda extra',
    });
    if (!ok) return;
    commit((n) => {
      n.totalRounds += 1;
      n.round += 1;
      n.phase = 'open';
    });
    sound.open();
  },
  async removePlayer(pid) {
    const name = link.players().get(pid)?.name ?? 'este jugador';
    const ok = await confirmDialog({
      title: `¿Retirar a ${name}?`,
      text: 'Desaparecerá del ranking y no podrá seguir apostando con este alta. Si es un error, podrá volver a entrar.',
      confirm: 'Retirar de la mesa',
      danger: true,
    });
    if (!ok) return;
    commit((n) => { n.removed = [...new Set([...(n.removed ?? []), pid])]; });
    link.unregister(pid).catch(() => {});
  },
  async reset() {
    const ok = await confirmDialog({
      title: '¿Reiniciar la partida?',
      text: 'Se borrarán todos los puntos, apuestas y jugadores. Cada invitado tendrá que confirmar su nombre otra vez. No se puede deshacer.',
      confirm: 'Reiniciar partida',
      danger: true,
    });
    if (!ok) return;
    const old = link.epoch;
    const bucket = link.bucket(old);
    for (const pid of bucket.players.keys()) link.unregister(pid, old).catch(() => {});
    for (const [round, map] of bucket.bets) {
      for (const pid of map.keys()) link.clearBet(round, pid, old).catch(() => {});
    }
    commit((n) => {
      Object.assign(n, structuredClone(DEFAULT_STATE), { epoch: `e${randomId(6)}`, totalRounds: CONFIG.totalRounds });
    });
    banner('Partida reiniciada');
  },
};

// ---------- Tablero ----------
function buildBoard() {
  ({ cells } = renderBoard($('board'), { orientation: 'portrait', logos: false }));
  for (const [id, el] of Object.entries(cells)) {
    if (CELLS[id].kind === 'group') el.disabled = true;
  }
}

$('board').addEventListener('click', (ev) => {
  const el = ev.target.closest('.cell');
  if (!el || el.disabled) return;
  const s = link?.state;
  if (!s) return;
  if (!['open', 'closed'].includes(s.phase)) {
    showError(s.phase === 'lobby'
      ? 'Primero abre la ronda 1.'
      : 'Esta ronda ya tiene resultado. Abre la siguiente ronda o deshaz el resultado.');
    return;
  }
  actions.markResult(el.dataset.cell);
});

$('primary').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  if (navigator.vibrate) navigator.vibrate(25);
  actions[btn.dataset.action]();
});
$('players').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-remove]');
  if (btn) actions.removePlayer(btn.dataset.remove);
});
$('reset-btn').addEventListener('click', () => actions.reset());

// ---------- Pintado ----------
function button(action, label, cls = '') {
  return `<button type="button" class="btn ${cls}" data-action="${action}">${escapeHTML(label)}</button>`;
}

function paint() {
  if (!link) return;
  const s = link.state;
  const players = link.activePlayers();
  const bets = link.activeBets();
  const last = s.history[s.history.length - 1];

  $('round-label').textContent = s.round > 0 ? `Ronda ${s.round} de ${s.totalRounds}` : 'Sin empezar';
  $('phase').textContent = PHASE_TEXT[s.phase] ?? '';
  $('phase').className = `ctl__phase is-${s.phase}`;
  $('n-players').textContent = players.size;
  $('n-bets').textContent = bets.size;
  $('n-pending').textContent = Math.max(0, players.size - bets.size);

  let step = '';
  let html = '';
  let hint = '';
  if (!link.ready) {
    step = 'Conectando con la mesa…';
  } else if (s.phase === 'lobby') {
    step = 'Los invitados entran con el código QR de la mesa. Cuando estéis listos, abre la primera ronda.';
    html = button('openRound', 'Abrir ronda 1', 'is-go');
    hint = 'Podrás marcar el resultado cuando abras la ronda.';
  } else if (s.phase === 'open') {
    step = `<strong>Ronda ${s.round} abierta.</strong> Cierra las apuestas justo antes de girar la ruleta.`;
    html = button('closeBets', 'No va más', 'is-stop');
    hint = 'Los números indican cuántas fichas hay en cada casilla. Si marcas el resultado ahora, las apuestas se cierran solas.';
  } else if (s.phase === 'closed') {
    step = '<strong>No va más.</strong> Gira la ruleta y toca en el tapete la casilla donde ha caído.';
    html = button('reopenBets', 'Reabrir apuestas', 'btn--ghost');
    hint = 'Toca la casilla ganadora: te pediremos confirmación antes de anunciarla.';
  } else if (s.phase === 'result') {
    const o = CELLS[last?.outcome];
    const count = last ? Object.values(last.bets ?? {}).filter((c) => c === last.outcome).length : 0;
    const groupCount = last && o?.kind === 'flour' ? Object.values(last.bets ?? {}).filter((c) => c === o.group).length : 0;
    const detail = o?.kind === 'bonus'
      ? `Bonus: +${CONFIG.points.bonus} puntos para todos.`
      : `${count} ${count === 1 ? 'acierto' : 'aciertos'} exactos y ${groupCount} de ${groupName(o?.group).toLowerCase()}.`;
    step = `<strong>Ronda ${s.round}: ha salido ${escapeHTML(o?.label ?? '')}.</strong> ${detail}`;
    html = s.round < s.totalRounds
      ? button('openRound', `Abrir ronda ${s.round + 1}`, 'is-go')
      : button('finish', 'Terminar y mostrar el podio', 'is-go');
    html += button('undoResult', 'Deshacer resultado', 'btn--ghost');
    hint = 'Resultado anunciado en todas las pantallas.';
  } else if (s.phase === 'finished') {
    step = '<strong>Partida terminada.</strong> El podio está en la pantalla. Si hay empate en los premios, podéis jugar una ronda extra.';
    html = button('extraRound', 'Ronda extra de desempate', 'is-go') + button('undoResult', 'Volver al último resultado', 'btn--ghost');
    hint = '';
  }
  $('step-text').innerHTML = step;
  $('primary').innerHTML = html;
  $('board-hint').textContent = hint;
  $('board-title').textContent = ['open', 'closed'].includes(s.phase) ? '¿Dónde ha caído la ruleta?' : 'Tapete';

  // Tapete: recuento de apuestas por casilla y casilla ganadora
  const counts = new Map();
  for (const [, b] of bets) counts.set(b.cell, (counts.get(b.cell) ?? 0) + 1);
  const pickable = ['open', 'closed'].includes(s.phase);
  $('board').classList.toggle('is-pickable', pickable);
  const showWinner = last && last.round === s.round && ['result', 'finished'].includes(s.phase);
  for (const [id, el] of Object.entries(cells)) {
    const n = counts.get(id) ?? 0;
    const badge = el.querySelector('.cell__count');
    badge.hidden = n === 0;
    badge.textContent = n;
    el.classList.toggle('is-winner', Boolean(showWinner && last.outcome === id));
    el.classList.toggle('is-group-winner', Boolean(showWinner && CELLS[last.outcome]?.group === id));
    if (CELLS[id].kind !== 'group') el.setAttribute('aria-disabled', String(!pickable));
  }

  paintPlayers(players, bets);
}

function paintPlayers(players, bets) {
  const rows = standingsWithMovement(link.state, players);
  if (!rows.length) {
    $('players').innerHTML = '<li class="plist__empty">Todavía no hay nadie. Proyecta la mesa para que los invitados escaneen el código QR.</li>';
    return;
  }
  $('players').innerHTML = rows.map((r) => {
    const bet = bets.get(r.pid);
    const betText = bet ? `Apuesta: ${CELLS[bet.cell]?.label}` : link.state.phase === 'open' ? 'Sin apostar' : '';
    return `<li class="plist__row">
      <span class="plist__pos">${r.rank}</span>
      ${createChip(r.pid, r.name).outerHTML}
      <span class="plist__name"><strong>${escapeHTML(r.name)}</strong><small class="${bet ? 'has-bet' : ''}">${escapeHTML(betText)}</small></span>
      <span class="plist__pts">${r.points}</span>
      <button class="plist__del" type="button" data-remove="${escapeHTML(r.pid)}" aria-label="Retirar a ${escapeHTML(r.name)}">✕</button>
    </li>`;
  }).join('');
}
