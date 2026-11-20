// App del jugador: entrar con nombre y apellido, apostar y ver el ranking.
import { CONFIG } from '../assets/js/config.js';
import { GameLink, scheduler, randomId } from '../assets/js/net.js';
import {
  renderBoard, CELLS, createChip, chipColor, initials, chipSpot, escapeHTML, groupName, wheelSVG,
} from '../assets/js/board.js';
import { standingsWithMovement, describeGain, PHASE_TEXT } from '../assets/js/game.js';
import {
  sound, showReveal, closeReveal, banner, burst, flip, countTo, confirmDialog, rain,
} from '../assets/js/fx.js';

// ---------- Almacenamiento local (con tolerancia a modo privado) ----------
const local = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
  },
};
const KEY_ME = `ruleta-me:${CONFIG.namespace}`;
const KEY_BET = `ruleta-bet:${CONFIG.namespace}`;
const KEY_SEEN = `ruleta-seen:${CONFIG.namespace}`;

const $ = (id) => document.getElementById(id);

let me = local.get(KEY_ME); // { pid, name, first, last, epoch }
let selection = null; // casilla elegida y aún sin confirmar
let sending = false;
let tab = 'bet';
let lastKey = null;
let myChip = null;
let nudgeUntil = 0;

const link = new GameLink('jugador').connect();
const render = scheduler(paint);

// ---------- Tablero ----------
const { board, cells } = renderBoard($('board'), { orientation: 'portrait', logos: false });
for (const cell of Object.values(cells)) {
  if (CELLS[cell.dataset.cell].kind === 'bonus') {
    cell.disabled = true;
    cell.title = 'Aquí no se puede apostar. Si sale, todos los jugadores suman 2 puntos.';
  }
}
$('join-wheel').innerHTML = wheelSVG({ labels: true });

// ---------- Entrada ----------
function showJoin(note = '') {
  $('game').hidden = true;
  $('join').hidden = false;
  $('join-note').hidden = !note;
  $('join-note').textContent = note;
  if (me) {
    $('first').value = me.first ?? '';
    $('last').value = me.last ?? '';
  }
  updateJoinButton();
}

function updateJoinButton() {
  const btn = $('join-btn');
  btn.disabled = !link.ready;
  btn.textContent = link.ready ? 'Sentarme a la mesa' : 'Conectando con la mesa…';
}

$('join-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const first = $('first').value.trim().replace(/\s+/g, ' ');
  const last = $('last').value.trim().replace(/\s+/g, ' ');
  const error = $('join-error');
  if (!first || !last) {
    error.hidden = false;
    error.textContent = 'Escribe tu nombre y tu apellido para aparecer en el ranking.';
    (!first ? $('first') : $('last')).focus();
    return;
  }
  error.hidden = true;
  sound.unlock();
  const removed = me && (link.state.removed ?? []).includes(me.pid);
  const pid = me?.pid && !removed ? me.pid : randomId(12);
  me = { pid, first, last, name: `${first} ${last}`, epoch: link.epoch };
  local.set(KEY_ME, me);
  const btn = $('join-btn');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    await link.register(me.pid, me.name);
    enterGame();
  } catch {
    error.hidden = false;
    error.textContent = 'No hemos podido conectar con la mesa. Comprueba tu conexión a internet y vuelve a intentarlo.';
    updateJoinButton();
  }
});

function enterGame() {
  $('join').hidden = true;
  $('game').hidden = false;
  $('hud-name').textContent = me.name;
  for (const chip of [$('hud-chip'), $('tray-chip')]) {
    chip.style.setProperty('--chip', chipColor(me.pid));
    chip.querySelector('.chip__face').textContent = initials(me.name);
  }
  lastKey = null;
  render();
}

// ---------- Estado de la partida ----------
function myBet() {
  if (!me) return null;
  const fromBroker = link.bets().get(me.pid);
  if (fromBroker) return fromBroker.cell;
  const saved = local.get(KEY_BET);
  if (saved && saved.epoch === link.epoch && saved.round === link.state.round) return saved.cell;
  return null;
}

function isRemoved() {
  return Boolean(me && (link.state.removed ?? []).includes(me.pid));
}

function checkSeat() {
  if (!me) return showJoin();
  if (!link.ready) return;
  if (isRemoved()) {
    return showJoin('El crupier te ha retirado de la mesa. Si ha sido un error, vuelve a entrar con tu nombre.');
  }
  if (me.epoch !== link.epoch) {
    return showJoin('Empieza una partida nueva. Confirma tu nombre para sentarte a la mesa.');
  }
  // Re-publicamos el alta y la apuesta por si el servidor las hubiera perdido.
  if (!link.players().has(me.pid)) link.register(me.pid, me.name).catch(() => {});
  const saved = local.get(KEY_BET);
  if (saved && saved.epoch === link.epoch && saved.round === link.state.round && !link.bets().has(me.pid)
      && ['open', 'closed'].includes(link.state.phase)) {
    link.placeBet(saved.round, me.pid, saved.cell, me.name).catch(() => {});
  }
  if ($('game').hidden) enterGame();
}

link.on('connection', (on) => {
  $('live').classList.toggle('is-on', on);
  $('live').textContent = on ? 'En directo' : 'Reconectando…';
  updateJoinButton();
});

link.on('ready', () => {
  updateJoinButton();
  if (!me) return showJoin();
  checkSeat();
  announce(true);
  render();
});

link.on('state', ({ prev }) => {
  if (!link.ready) return;
  if (prev.epoch !== link.state.epoch || (link.state.removed ?? []).length !== (prev.removed ?? []).length) checkSeat();
  if (prev.round !== link.state.round) selection = null;
  announce(false);
  render();
});

link.on('player', render);
link.on('bet', render);

// Avisos al cambiar de fase: ronda abierta, no va más, resultado y podio.
function announce(initial) {
  if (!me || $('game').hidden) return;
  const s = link.state;
  const key = `${s.epoch}:${s.round}:${s.phase}:${s.history.length}`;
  if (key === lastKey) return;
  const before = lastKey;
  lastKey = key;
  const seen = local.get(KEY_SEEN);

  if (s.phase === 'result' && s.history.length) {
    const entry = s.history[s.history.length - 1];
    const id = `${s.epoch}:${entry.round}:${entry.outcome}`;
    if (seen !== id) {
      local.set(KEY_SEEN, id);
      showResult(entry);
    }
    return;
  }
  if (s.phase === 'finished') {
    const id = `${s.epoch}:final:${s.history.length}`;
    if (seen !== id) {
      local.set(KEY_SEEN, id);
      showFinal();
    }
    return;
  }
  closeReveal();
  document.querySelectorAll('.reveal--final').forEach((el) => el.remove());
  if (initial || !before) return;
  if (s.phase === 'open') {
    banner(`Ronda ${s.round}. Hagan sus apuestas`);
    sound.open();
    if (navigator.vibrate) navigator.vibrate(40);
  } else if (s.phase === 'closed') {
    banner('No va más', { tone: 'red' });
    sound.close();
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }
}

function standings() {
  return standingsWithMovement(link.state, link.activePlayers());
}

function showResult(entry) {
  const d = describeGain(entry, me.pid);
  const rows = standings();
  const mine = rows.find((r) => r.pid === me.pid);
  let body = '';
  let tone = 'lose';
  if (d.kind === 'exact') {
    body = `<p class="reveal__result is-win">¡Has acertado! +${d.pts} puntos</p>`;
    tone = 'win';
  } else if (d.kind === 'group') {
    body = `<p class="reveal__result is-win">+${d.pts} puntos</p><p class="reveal__note">Apostaste a ${groupName(d.bet).toLowerCase()} y ha salido una de ese tipo.</p>`;
    tone = 'win';
  } else if (d.kind === 'bonus') {
    body = d.pts
      ? `<p class="reveal__result is-win">+${d.pts} puntos para todos</p>`
      : '<p class="reveal__result is-lose">Bonus para quienes ya estaban en la mesa</p>';
    tone = d.pts ? 'bonus' : 'lose';
  } else if (d.kind === 'miss') {
    body = `<p class="reveal__result is-lose">Esta vez no hay premio</p><p class="reveal__note">Tu apuesta: ${escapeHTML(CELLS[d.bet]?.label ?? '')}.</p>`;
  } else {
    body = '<p class="reveal__result is-lose">No apostaste en esta ronda</p>';
  }
  if (mine) {
    const move = mine.delta > 0 ? ` Has subido ${mine.delta} ${mine.delta === 1 ? 'puesto' : 'puestos'}.` : '';
    body += `<p class="reveal__note">Vas en el puesto ${mine.rank} de ${rows.length} con ${mine.points} puntos.${move}</p>`;
  }
  showReveal({ outcome: entry.outcome, kicker: `Ronda ${entry.round}. Ha salido`, bodyHTML: body, tone });
  if (navigator.vibrate) navigator.vibrate(tone === 'lose' ? 80 : [80, 60, 80, 60, 160]);
}

function showFinal() {
  closeReveal();
  const rows = standings();
  const mine = rows.find((r) => r.pid === me.pid);
  const top = rows.filter((r) => r.rank <= 3);
  const el = document.createElement('div');
  el.className = 'reveal reveal--final';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="reveal__rays"></div>
    <div class="reveal__card">
      <p class="reveal__kicker">Partida terminada</p>
      <h2 class="reveal__name">Podio final</h2>
      <div class="podium">
        ${top.map((r) => `<div class="podium__row"><span>${r.rank}º</span><span>${escapeHTML(r.name)}</span><b>${r.points}</b></div>`).join('')}
      </div>
      ${mine ? `<p class="reveal__note">Has quedado en el puesto ${mine.rank} de ${rows.length} con ${mine.points} puntos. Gracias por jugar.</p>` : ''}
      <div class="reveal__actions"><button type="button" class="btn">Ver el ranking</button></div>
    </div>`;
  document.body.append(el);
  el.querySelector('.btn').addEventListener('click', () => {
    el.remove();
    setTab('rank');
  });
  sound.win();
  rain(5);
}

// ---------- Apostar ----------
board.addEventListener('click', (ev) => {
  const cellEl = ev.target.closest('.cell');
  if (!cellEl || cellEl.disabled || !me) return;
  sound.unlock();
  const id = cellEl.dataset.cell;
  const s = link.state;
  if (s.phase !== 'open') {
    const msg = {
      lobby: 'La partida aún no ha empezado. Podrás apostar cuando el crupier abra la ronda 1.',
      closed: 'No va más: las apuestas de esta ronda ya están cerradas.',
      result: 'Espera a que el crupier abra la siguiente ronda.',
      finished: 'La partida ha terminado.',
    }[s.phase];
    return nudge(msg);
  }
  if (myBet()) return nudge('Ya has confirmado tu apuesta de esta ronda.');
  if (sending || id === selection) return;
  const from = selection ? myChip : $('tray-chip');
  selection = id;
  flyChipTo(from, cells[id]);
  render();
});

function nudge(msg) {
  nudgeUntil = Date.now() + 3500;
  setTimeout(render, 3600);
  const hint = $('hint');
  hint.textContent = msg;
  hint.classList.remove('is-alert');
  void hint.offsetWidth;
  hint.classList.add('is-alert');
}

function chipTarget(cellEl) {
  const rect = cellEl.getBoundingClientRect();
  const spot = chipSpot(me.pid, cellEl.dataset.cell, cellEl);
  return { x: rect.left + (rect.width * spot.x) / 100, y: rect.top + (rect.height * spot.y) / 100, rot: spot.rot };
}

function placeMyChip(cellEl, land = false) {
  if (!myChip) myChip = createChip(me.pid, me.name, 'chip--mine');
  const spot = chipSpot(me.pid, cellEl.dataset.cell, cellEl);
  myChip.style.left = `${spot.x}%`;
  myChip.style.top = `${spot.y}%`;
  myChip.style.setProperty('--rot', `${spot.rot}deg`);
  cellEl.querySelector('.cell__chips').append(myChip);
  if (land) {
    myChip.classList.remove('chip--land');
    void myChip.offsetWidth;
    myChip.classList.add('chip--land');
  }
}

function flyChipTo(fromEl, cellEl) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fromRect = fromEl?.isConnected ? fromEl.getBoundingClientRect() : null;
  if (!fromRect || reduce) {
    placeMyChip(cellEl, true);
    sound.chip();
    return;
  }
  const target = chipTarget(cellEl);
  const boardChipSize = (board.getBoundingClientRect().width * 8.6) / 100;
  const ghost = createChip(me.pid, me.name, 'chip--flying');
  ghost.style.setProperty('--size', `${fromRect.width}px`);
  ghost.style.left = `${fromRect.left + fromRect.width / 2}px`;
  ghost.style.top = `${fromRect.top + fromRect.height / 2}px`;
  document.body.append(ghost);
  if (myChip && fromEl === myChip) myChip.remove();
  $('tray').classList.add('is-empty');

  const dx = target.x - (fromRect.left + fromRect.width / 2);
  const dy = target.y - (fromRect.top + fromRect.height / 2);
  const scale = boardChipSize / fromRect.width;
  const lift = Math.min(90, Math.abs(dy) * 0.25 + 30);
  ghost.animate([
    { transform: 'translate(0, 0) scale(1)' },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) scale(${Math.max(scale, 1) * 1.12})`, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
  ], { duration: 480, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }).finished
    .catch(() => {})
    .then(() => {
      ghost.remove();
      if (selection === cellEl.dataset.cell) placeMyChip(cellEl, true);
      sound.chip();
      render();
    });
}

$('confirm-btn').addEventListener('click', async () => {
  if (!selection || sending || myBet()) return;
  if (link.state.phase !== 'open') return nudge('No va más: las apuestas de esta ronda ya están cerradas.');
  sending = true;
  render();
  const { round } = link.state;
  const cell = selection;
  try {
    await link.placeBet(round, me.pid, cell, me.name);
    local.set(KEY_BET, { epoch: link.epoch, round, cell });
    selection = null;
    sound.confirm();
    if (navigator.vibrate) navigator.vibrate(30);
    const r = myChip?.getBoundingClientRect();
    if (r) burst({ kind: 'confetti', count: 36, x: r.left + r.width / 2, y: r.top + r.height / 2, spread: 0.45 });
  } catch {
    nudge('No hemos podido enviar tu apuesta. Revisa tu conexión y pulsa otra vez «Confirmar apuesta».');
  } finally {
    sending = false;
    render();
  }
});

// ---------- Pestañas ----------
function setTab(next) {
  tab = next;
  for (const btn of document.querySelectorAll('.tabs__btn')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  }
  $('tab-bet').hidden = tab !== 'bet';
  $('tab-rank').hidden = tab !== 'rank';
  $('betbar').hidden = tab !== 'bet';
  render();
}
document.querySelector('.tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tabs__btn');
  if (btn) setTab(btn.dataset.tab);
});

$('rules-btn').addEventListener('click', () => {
  confirmDialog({
    title: 'Cómo se juega',
    text: `Harina exacta: ${CONFIG.points.exact} puntos. Harina blanca o integral: ${CONFIG.points.group} puntos si sale una de ese tipo. Semol y Trigo: no se apuesta, pero si sale, todos suman ${CONFIG.points.bonus} puntos. Una apuesta por ronda; los 3 con más puntos ganan premio.`,
    confirm: 'Entendido',
    cancel: 'Cerrar',
  });
});

// ---------- Pintado ----------
function paint() {
  if (!me || $('game').hidden) return;
  const s = link.state;
  const bet = myBet();
  const rows = standings();
  const mine = rows.find((r) => r.pid === me.pid);

  // HUD
  countTo($('hud-points'), mine?.points ?? 0);
  $('hud-rank').textContent = mine && rows.length ? `${mine.rank}º de ${rows.length}` : '';

  // Ronda y fase
  $('round-label').textContent = s.round > 0 ? `Ronda ${s.round} de ${s.totalRounds}` : 'Antes de empezar';
  const phase = $('phase-label');
  phase.textContent = PHASE_TEXT[s.phase] ?? '';
  phase.className = `roundbar__phase is-${s.phase}`;

  // Fichas y casillas
  const last = s.history[s.history.length - 1];
  const showWinner = last && (s.phase === 'result' || s.phase === 'finished');
  for (const [id, el] of Object.entries(cells)) {
    el.classList.toggle('is-selected', id === (bet ?? selection));
    el.classList.toggle('is-winner', Boolean(showWinner && last.outcome === id));
    el.classList.toggle('is-group-winner', Boolean(showWinner && CELLS[last.outcome]?.group === id));
  }
  const chipCell = bet ?? selection;
  if (chipCell && !document.querySelector('.chip--flying')) {
    if (!myChip || myChip.parentElement !== cells[chipCell].querySelector('.cell__chips')) placeMyChip(cells[chipCell]);
  } else if (!chipCell && myChip) {
    myChip.remove();
  }
  myChip?.classList.toggle('chip--confirmed', Boolean(bet));
  $('board').classList.toggle('is-locked', s.phase !== 'open' || Boolean(bet));
  $('tray').classList.toggle('is-empty', Boolean(chipCell) || s.phase !== 'open');

  // Barra de apuesta y ayuda
  const btn = $('confirm-btn');
  btn.classList.toggle('is-done', Boolean(bet));
  const target = CELLS[bet ?? selection];
  const pays = target ? (target.kind === 'group' ? CONFIG.points.group : CONFIG.points.exact) : 0;
  let title = '';
  let sub = '';
  let hint = '';
  if (s.phase === 'lobby') {
    title = 'Aún no se apuesta';
    sub = 'Espera a que el crupier abra la ronda 1';
    btn.textContent = 'Confirmar apuesta';
    btn.disabled = true;
    hint = 'Ya estás en la mesa. Mira el tapete mientras empieza la partida.';
  } else if (s.phase === 'open') {
    if (bet) {
      title = target.label;
      sub = `Apuesta confirmada. Si sale, ganas ${pays} puntos`;
      btn.textContent = 'Confirmada';
      btn.disabled = true;
      hint = 'Apuesta confirmada. Ahora, a esperar a la ruleta.';
    } else if (selection) {
      title = target.label;
      sub = `Si sale, ganas ${pays} puntos`;
      btn.textContent = sending ? 'Enviando…' : 'Confirmar apuesta';
      btn.disabled = sending;
      hint = 'Puedes cambiar de casilla hasta que confirmes.';
    } else {
      title = 'Elige una casilla';
      sub = 'Toca el tapete para poner tu ficha';
      btn.textContent = 'Confirmar apuesta';
      btn.disabled = true;
      hint = `Ronda ${s.round}: una apuesta por partida.`;
    }
  } else if (s.phase === 'closed') {
    title = bet ? target.label : 'Sin apuesta';
    sub = bet ? `Si sale, ganas ${pays} puntos` : 'Esta ronda no has apostado';
    btn.textContent = 'No va más';
    btn.disabled = true;
    hint = 'No va más. La ruleta está girando…';
  } else if (s.phase === 'result') {
    const d = last ? describeGain(last, me.pid) : null;
    title = last ? `Salió ${CELLS[last.outcome]?.label ?? ''}` : '';
    sub = d && d.pts ? `Has ganado ${d.pts} puntos` : 'Esta ronda sin premio';
    btn.textContent = 'Confirmar apuesta';
    btn.disabled = true;
    hint = 'Espera a que el crupier abra la siguiente ronda.';
  } else if (s.phase === 'finished') {
    title = 'Partida terminada';
    sub = mine ? `Has quedado en el puesto ${mine.rank}` : '';
    btn.textContent = 'Confirmar apuesta';
    btn.disabled = true;
    hint = 'Gracias por jugar. Mira el ranking final.';
  }
  $('bet-title').textContent = title;
  $('bet-sub').textContent = sub;
  if (Date.now() >= nudgeUntil) {
    $('hint').textContent = hint;
    $('hint').classList.remove('is-alert');
  }

  if (tab === 'rank') paintRanking(rows, mine);
}

function paintRanking(rows, mine) {
  const card = $('me-card');
  if (mine) {
    card.innerHTML = `
      <span class="me-card__pos">${mine.rank}º</span>
      <span class="me-card__text">Tu puesto<small>de ${rows.length} jugadores</small></span>
      <span class="me-card__pts">${mine.points} pts</span>`;
  } else {
    card.innerHTML = '<span class="me-card__text">Aún no apareces en el ranking.</span>';
  }
  const list = $('ranklist');
  if (!rows.length) {
    list.innerHTML = '<li class="ranklist__empty">Todavía no hay jugadores en la mesa.</li>';
    return;
  }
  flip(list, '.rank-row', () => {
    list.innerHTML = rows.map((r) => {
      const move = r.delta > 0 ? `<span class="rank-row__move is-up" aria-label="sube ${r.delta}">▲${r.delta}</span>`
        : r.delta < 0 ? `<span class="rank-row__move is-down" aria-label="baja ${-r.delta}">▼${-r.delta}</span>`
          : '<span class="rank-row__move"></span>';
      const top = r.rank <= 3 && r.points > 0 ? ` is-top is-top${r.rank}` : '';
      return `<li class="rank-row${top}${r.pid === me.pid ? ' is-me' : ''}" data-key="${escapeHTML(r.pid)}">
        <span class="rank-row__pos">${r.rank}</span>
        <span class="rank-row__name">${escapeHTML(r.name)}${r.pid === me.pid ? ' (tú)' : ''}</span>
        ${move}
        <span class="rank-row__pts">${r.points}</span>
      </li>`;
    }).join('');
  });
}

// Primer pintado
if (!me) showJoin();
else {
  $('join').hidden = true;
  $('game').hidden = true;
  showJoin();
  $('join-note').hidden = false;
  $('join-note').textContent = `Hola de nuevo, ${me.first}. Conectando con la mesa…`;
}
