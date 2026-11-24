// Puntuación del reglamento escrita aparte de la app, para comprobar sus cálculos.
// Del tapete solo se reutiliza el dato de qué harina es blanca o integral.
import { CELLS, FLOURS, GROUPS } from '../../assets/js/board.js';

export const APOSTABLES = [...FLOURS.map((f) => f.id), ...GROUPS.map((g) => g.id)];

// Puntos de un jugador en una ronda.
//   apuesta: casilla apostada (o null) · resultado: casilla donde cae la bola
//   enLaMesa: si estaba apuntado cuando salió el resultado (para el bonus)
export function puntosRonda(apuesta, resultado, enLaMesa) {
  const r = CELLS[resultado];
  if (r.kind === 'bonus') return enLaMesa ? 2 : 0; // Semol o Trigo: +2 para todos
  if (!apuesta) return 0;
  if (apuesta === resultado) return 10; // harina exacta
  if (apuesta === r.group) return 3; // harina blanca o integral
  return 0;
}

// Puesto con empates: 1 + número de jugadores con más puntos.
export function puestos(puntos) {
  const valores = [...puntos.values()];
  return new Map([...puntos].map(([pid, p]) => [pid, 1 + valores.filter((v) => v > p).length]));
}
