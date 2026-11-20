// Reglas y puntuación de La Ruleta de las Harinas.
import { CELLS } from './board.js';
import { CONFIG } from './config.js';

export const PHASE_TEXT = {
  lobby: 'Esperando a que empiece la partida',
  open: 'Hagan sus apuestas',
  closed: 'No va más',
  result: 'Resultado',
  finished: 'Partida terminada',
};

// Puntos que gana una apuesta concreta con un resultado (sin contar el bonus).
export function pointsFor(betCell, outcome) {
  const o = CELLS[outcome];
  const b = CELLS[betCell];
  if (!o || !b || o.kind === 'bonus') return 0;
  if (betCell === outcome) return CONFIG.points.exact;
  if (b.kind === 'group' && o.group === betCell) return CONFIG.points.group;
  return 0;
}

// Puntos que gana un jugador en una ronda ya resuelta (entrada del historial).
export function gainFor(entry, pid) {
  const o = CELLS[entry.outcome];
  if (!o) return 0;
  if (o.kind === 'bonus') return entry.players && pid in entry.players ? CONFIG.points.bonus : 0;
  return pointsFor(entry.bets?.[pid], entry.outcome);
}

export function describeGain(entry, pid) {
  const o = CELLS[entry.outcome];
  const bet = entry.bets?.[pid];
  const pts = gainFor(entry, pid);
  if (o?.kind === 'bonus') return { pts, kind: 'bonus', bet };
  if (!bet) return { pts: 0, kind: 'nobet', bet };
  if (pts === CONFIG.points.exact) return { pts, kind: 'exact', bet };
  if (pts > 0) return { pts, kind: 'group', bet };
  return { pts: 0, kind: 'miss', bet };
}

/**
 * Clasificación. registry: Map(pid -> { name }) de los jugadores apuntados ahora.
 * upto: cuántas rondas del historial contar (para calcular el puesto anterior).
 */
export function computeStandings(state, registry, upto = state.history.length) {
  const removed = new Set(state.removed ?? []);
  const names = new Map();
  for (const entry of state.history) {
    for (const [pid, name] of Object.entries(entry.players ?? {})) names.set(pid, name);
  }
  for (const [pid, p] of registry) names.set(pid, p.name);

  const history = state.history.slice(0, upto);
  const rows = [];
  for (const [pid, name] of names) {
    if (removed.has(pid)) continue;
    let points = 0;
    let last = 0;
    history.forEach((entry, i) => {
      const g = gainFor(entry, pid);
      points += g;
      if (i === history.length - 1) last = g;
    });
    rows.push({ pid, name, points, last });
  }
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'es'));
  let rank = 0;
  let prevPoints = null;
  rows.forEach((row, i) => {
    if (row.points !== prevPoints) {
      rank = i + 1;
      prevPoints = row.points;
    }
    row.rank = rank;
  });
  return rows;
}

// Clasificación con el cambio de puesto respecto a la tirada anterior.
export function standingsWithMovement(state, registry) {
  const now = computeStandings(state, registry);
  if (state.history.length === 0) {
    now.forEach((r) => { r.delta = 0; });
    return now;
  }
  const before = computeStandings(state, registry, state.history.length - 1);
  const prev = new Map(before.map((r) => [r.pid, r.rank]));
  now.forEach((r) => {
    const p = prev.get(r.pid);
    r.delta = p ? p - r.rank : 0;
  });
  return now;
}

export function ordinal(n) {
  return `${n}º`;
}
