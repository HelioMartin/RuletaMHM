// Tapete de La Ruleta de las Harinas: datos de las casillas y dibujo del tablero.
// Las filas y columnas siguen el tapete vertical del reglamento (PDF):
// 6 filas x 3 columnas. Las casillas claras son harina blanca y las marrones, integral.

const RAW = [
  ['bizcocho', 'BIZCOCHO', 0, 0, 'bag'],
  ['integral-trigo', 'INTEGRAL DE TRIGO', 0, 1, 'sack'],
  ['hml-160', 'HML 160', 0, 2, 'truck'],
  ['sopas-delice', 'SOPAS DELICE', 1, 0, 'sack'],
  ['hml-220', 'HML 220', 1, 1, 'truck'],
  ['integral-1kg', 'INTEGRAL 1KG', 1, 2, 'bag'],
  ['mantecado', 'MANTECADO', 2, 0, 'truck'],
  ['fipal-t150', 'FIPAL T150', 2, 1, 'sack'],
  ['pizza', 'PIZZA', 2, 2, 'bag'],
  ['anitin-i10', 'ANITIN I10', 3, 0, 'sack'],
  ['reposteria', 'REPOSTERÍA', 3, 1, 'bag'],
  ['milagros-wholegrain', 'MILAGROS WHOLEGRAIN', 3, 2, 'truck'],
  ['fuerza', 'FUERZA', 4, 0, 'bag'],
  ['anitin-jerez', 'ANITIN JEREZ', 4, 1, 'truck'],
  ['hml-120', 'HML 120', 4, 2, 'sack'],
  ['anitin-carlet', 'ANITIN CARLET', 5, 0, 'truck'],
  ['rebozar', 'REBOZAR', 5, 1, 'bag'],
  ['fipal-t110', 'FIPAL T110', 5, 2, 'sack'],
];

export const FLOURS = RAW.map(([id, label, r, c, icon]) => ({
  id, label, r, c, icon, kind: 'flour',
  group: (r + c) % 2 === 0 ? 'blanca' : 'integral',
}));

export const GROUPS = [
  { id: 'blanca', label: 'HARINA BLANCA', kind: 'group', name: 'Harina blanca' },
  { id: 'integral', label: 'HARINA INTEGRAL', kind: 'group', name: 'Harina integral' },
];

export const BONUSES = [
  { id: 'semol', label: 'SEMOL', kind: 'bonus', icon: 'sack' },
  { id: 'trigo', label: 'TRIGO', kind: 'bonus', icon: 'sack' },
];

export const CELLS = Object.fromEntries(
  [...FLOURS, ...GROUPS, ...BONUSES].map((cell) => [cell.id, cell]),
);

export const BET_IDS = [...FLOURS, ...GROUPS].map((c) => c.id);
export const OUTCOME_IDS = [...FLOURS, ...BONUSES].map((c) => c.id);

export function groupName(groupId) {
  return GROUPS.find((g) => g.id === groupId)?.name ?? '';
}

// ---------- Iconos (sprite SVG compartido) ----------

const SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <g id="wheat-ear">
      <path d="M0 10V-9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <ellipse cx="-2.7" cy="4.6" rx="1.9" ry="3.3" transform="rotate(-30 -2.7 4.6)"/>
      <ellipse cx="2.7" cy="4.6" rx="1.9" ry="3.3" transform="rotate(30 2.7 4.6)"/>
      <ellipse cx="-2.7" cy="-0.6" rx="1.9" ry="3.3" transform="rotate(-30 -2.7 -0.6)"/>
      <ellipse cx="2.7" cy="-0.6" rx="1.9" ry="3.3" transform="rotate(30 2.7 -0.6)"/>
      <ellipse cx="0" cy="-6.6" rx="1.8" ry="3.1"/>
    </g>
  </defs>
  <symbol id="ico-bag" viewBox="0 0 48 48">
    <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round">
      <path d="M15 9h18l3 7v26H12V16z"/>
      <path d="M12 16h24M15 9l-1.5 7M33 9l1.5 7"/>
    </g>
    <use href="#wheat-ear" transform="translate(24 29) scale(.95)" fill="currentColor"/>
  </symbol>
  <symbol id="ico-sack" viewBox="0 0 48 48">
    <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
      <path d="M17 7c3 2.2 11 2.2 14 0l-2.5 7.5C35 18 39 25 39 32c0 6.5-5.5 9-15 9S9 38.5 9 32c0-7 4-14 10.5-17.5z"/>
      <path d="M19 14.5h10"/>
      <circle cx="24" cy="30" r="7.5"/>
    </g>
    <use href="#wheat-ear" transform="translate(24 30) scale(.62)" fill="currentColor"/>
  </symbol>
  <symbol id="ico-truck" viewBox="0 0 64 44">
    <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
      <rect x="3" y="8" width="38" height="20" rx="10"/>
      <path d="M43 13h9.5l7.5 8.5V31H43z"/>
      <path d="M46.5 16.5h5l3.8 4.5h-8.8z"/>
      <path d="M3 31h57"/>
      <circle cx="14" cy="35" r="4.2"/>
      <circle cx="27" cy="35" r="4.2"/>
      <circle cx="51" cy="35" r="4.2"/>
      <circle cx="22" cy="18" r="6"/>
    </g>
    <use href="#wheat-ear" transform="translate(22 18) scale(.5)" fill="currentColor"/>
  </symbol>
</svg>`;

export function ensureSprite() {
  if (document.getElementById('ruleta-sprite')) return;
  const holder = document.createElement('div');
  holder.id = 'ruleta-sprite';
  holder.innerHTML = SPRITE;
  document.body.prepend(holder);
}

export function iconSVG(icon, cls = 'ico') {
  const vb = icon === 'truck' ? '0 0 64 44' : '0 0 48 48';
  return `<svg class="${cls} ${cls}--${icon}" viewBox="${vb}" aria-hidden="true"><use href="#ico-${icon}"/></svg>`;
}

// ---------- Fichas ----------

const CHIP_COLORS = ['#C62828', '#1E5BB8', '#232323', '#6A2C91', '#D9730D', '#0F7F7A', '#C2185B', '#7A4E29'];

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function chipColor(pid) {
  let h = hash(`chip:${pid}`);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return CHIP_COLORS[(h >>> 0) % CHIP_COLORS.length];
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return letters.toUpperCase() || '?';
}

export function shortName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[1][0]}.`;
}

export function createChip(pid, name, extraClass = '') {
  const chip = document.createElement('div');
  chip.className = `chip ${extraClass}`.trim();
  chip.style.setProperty('--chip', chipColor(pid));
  chip.dataset.pid = pid;
  chip.title = name;
  chip.innerHTML = `<span class="chip__face">${escapeHTML(initials(name))}</span>`;
  return chip;
}

// Posición estable (pseudoaleatoria) de una ficha dentro de su casilla, en %.
// En las bandas de harina blanca/integral la ficha va fuera del rótulo.
export function chipSpot(pid, cellId, cellEl = null) {
  const h = hash(pid);
  const rx = (h & 0xff) / 255 - 0.5;
  const ry = ((h >> 8) & 0xff) / 255 - 0.5;
  const rot = ((h >> 16) % 50) - 25;
  if (CELLS[cellId]?.kind === 'group') {
    const wide = cellEl ? cellEl.offsetWidth > cellEl.offsetHeight * 1.3 : true;
    return wide ? { x: 50 + rx * 84, y: 72 + ry * 22, rot } : { x: 50 + rx * 24, y: 91 + ry * 6, rot };
  }
  return { x: 50 + rx * 58, y: 55 + ry * 46, rot };
}

export function escapeHTML(text = '') {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---------- Tablero ----------

function cellButton(cell) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `cell cell--${cell.kind}`;
  btn.dataset.cell = cell.id;
  if (cell.kind === 'flour') {
    btn.classList.add(`cell--${cell.group}`);
    btn.innerHTML = `<span class="cell__label">${cell.label}</span>${iconSVG(cell.icon, 'cell__icon')}`;
    btn.setAttribute('aria-label', `${cell.label}, ${groupName(cell.group).toLowerCase()}`);
  } else if (cell.kind === 'group') {
    btn.classList.add(`cell--${cell.id}`);
    btn.innerHTML = `<span class="cell__label">${cell.label}</span>`;
    btn.setAttribute('aria-label', cell.name);
  } else {
    btn.innerHTML = `<span class="cell__bonus"><span>BONUS</span><span>${cell.label}</span></span>`;
    btn.setAttribute('aria-label', `Bonus ${cell.label.toLowerCase()}`);
  }
  btn.insertAdjacentHTML('beforeend', '<span class="cell__chips" aria-hidden="true"></span><span class="cell__count" hidden></span>');
  return btn;
}

/**
 * Dibuja el tapete.
 * orientation: 'portrait' (como el PDF, para móviles) o 'landscape' (la imagen original
 * del tapete, para el proyector).
 */
export function renderBoard(host, { orientation = 'portrait', logo = '../assets/img/logo-mhm.jpg', logos = true } = {}) {
  ensureSprite();
  const board = document.createElement('div');
  board.className = `board board--${orientation}${logos ? '' : ' board--nologo'}`;
  const cells = {};
  const make = (cell) => (cells[cell.id] = cellButton(cell));

  const grid = document.createElement('div');
  grid.className = 'board__grid';
  for (const f of FLOURS) {
    const btn = make(f);
    if (orientation === 'landscape') {
      btn.style.gridColumn = String(f.r + 1);
      btn.style.gridRow = String(3 - f.c);
    } else {
      btn.style.gridColumn = String(f.c + 1);
      btn.style.gridRow = String(f.r + 1);
    }
    grid.append(btn);
  }

  const groups = document.createElement('div');
  groups.className = 'board__groups';
  groups.append(make(GROUPS[0]), make(GROUPS[1]));

  const logoImg = (pos) => {
    const wrap = document.createElement('div');
    wrap.className = `board__logo board__logo--${pos}`;
    wrap.innerHTML = `<img src="${logo}" alt="${pos === 'a' ? 'MHM Grupo Harinero' : ''}">`;
    return wrap;
  };

  const felt = document.createElement('div');
  felt.className = 'board__felt';
  if (logos) felt.append(logoImg('a'));
  felt.append(make(BONUSES[0]), groups, grid, make(BONUSES[1]));
  if (logos) felt.append(logoImg('b'));
  board.append(felt);

  host.replaceChildren(board);
  return { board, cells };
}

// Dibuja las fichas de todas las apuestas de una ronda.
// bets: Map(pid -> { cell, name }) ; options.animate: Set de pids que acaban de llegar.
export function paintChips(cells, bets, { animate = new Set(), max = 14, mine = null } = {}) {
  const byCell = new Map();
  for (const [pid, bet] of bets) {
    if (!cells[bet.cell]) continue;
    if (!byCell.has(bet.cell)) byCell.set(bet.cell, []);
    byCell.get(bet.cell).push([pid, bet]);
  }
  for (const [id, btn] of Object.entries(cells)) {
    const layer = btn.querySelector('.cell__chips');
    const count = btn.querySelector('.cell__count');
    const list = (byCell.get(id) ?? []).sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
    const keep = new Set(list.slice(-max).map(([pid]) => pid));
    for (const chip of [...layer.children]) {
      if (!keep.has(chip.dataset.pid)) chip.remove();
    }
    for (const [pid, bet] of list.slice(-max)) {
      let chip = layer.querySelector(`[data-pid="${CSS.escape(pid)}"]`);
      if (!chip) {
        chip = createChip(pid, bet.name, pid === mine ? 'chip--mine' : '');
        const spot = chipSpot(pid, id, btn);
        chip.style.left = `${spot.x}%`;
        chip.style.top = `${spot.y}%`;
        chip.style.setProperty('--rot', `${spot.rot}deg`);
        layer.append(chip);
        if (animate.has(pid)) chip.classList.add('chip--drop');
      }
    }
    count.hidden = list.length === 0;
    count.textContent = list.length;
    btn.classList.toggle('has-bets', list.length > 0);
  }
}

// ---------- Ruleta decorativa (SVG) ----------
// 20 casillas: las 18 harinas alternando blanca/integral y los dos bonus enfrentados.
export function wheelOrder() {
  const blancas = FLOURS.filter((f) => f.group === 'blanca');
  const integrales = FLOURS.filter((f) => f.group === 'integral');
  // Semol, 9 harinas alternas, Trigo, 9 harinas alternas.
  const first = [blancas[0], integrales[0], blancas[1], integrales[1], blancas[2], integrales[2], blancas[3], integrales[3], blancas[4]];
  const second = [integrales[4], blancas[5], integrales[5], blancas[6], integrales[6], blancas[7], integrales[7], blancas[8], integrales[8]];
  return [BONUSES[0], ...first, BONUSES[1], ...second];
}

export function wheelSVG({ labels = true, className = 'wheel' } = {}) {
  const segs = wheelOrder();
  const n = segs.length;
  const rOut = 92;
  const rIn = 38;
  const pt = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  };
  let paths = '';
  let texts = '';
  segs.forEach((cell, i) => {
    const a0 = (360 / n) * i;
    const a1 = a0 + 360 / n;
    const fill = cell.kind === 'bonus' ? '#C8A04A' : cell.group === 'blanca' ? '#F1EADB' : '#5C3A1E';
    const ink = cell.kind === 'bonus' ? '#FBF3DC' : cell.group === 'blanca' ? '#5C3A1E' : '#F1EADB';
    paths += `<path d="M${pt(rIn, a0)} L${pt(rOut, a0)} A${rOut} ${rOut} 0 0 1 ${pt(rOut, a1)} L${pt(rIn, a1)} A${rIn} ${rIn} 0 0 0 ${pt(rIn, a0)}Z" fill="${fill}" stroke="#8A6A26" stroke-width=".6"/>`;
    if (labels) {
      const mid = a0 + 180 / n;
      const label = cell.kind === 'bonus' ? cell.label : cell.label.replace('MILAGROS ', '').replace('INTEGRAL DE TRIGO', 'INT. TRIGO');
      texts += `<text transform="rotate(${mid - 90}) translate(${(rIn + rOut) / 2 + 4} 0)" fill="${ink}" font-size="${label.length > 10 ? 4.6 : 5.6}" font-family="Barlow Condensed, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>`;
    }
  });
  let bulbs = '';
  for (let i = 0; i < 40; i++) {
    bulbs += `<circle class="wheel__bulb" cx="${pt(97, i * 9).split(' ')[0]}" cy="${pt(97, i * 9).split(' ')[1]}" r="1.6" style="--i:${i}"/>`;
  }
  return `
  <svg class="${className}" viewBox="-104 -104 208 208" aria-hidden="true">
    <circle r="102" fill="#3B2410"/>
    <circle r="100" fill="none" stroke="#C8A04A" stroke-width="5"/>
    ${bulbs}
    <g class="wheel__rotor">
      ${paths}
      ${texts}
      <circle r="${rIn}" fill="#0E4D2E" stroke="#C8A04A" stroke-width="2"/>
      <circle r="24" fill="url(#wheel-hub)" stroke="#8A6A26" stroke-width="1"/>
      <g fill="#C8A04A">${[0, 90, 180, 270].map((d) => `<rect x="-2" y="-34" width="4" height="12" rx="2" transform="rotate(${d})"/>`).join('')}</g>
    </g>
    <defs>
      <radialGradient id="wheel-hub" cx="40%" cy="35%" r="70%">
        <stop offset="0" stop-color="#FFF3C9"/><stop offset=".45" stop-color="#C8A04A"/><stop offset="1" stop-color="#6E531D"/>
      </radialGradient>
    </defs>
    <path d="M0 -104 L-7 -90 L7 -90Z" fill="#F0D488" stroke="#6E531D" stroke-width="1"/>
  </svg>`;
}
