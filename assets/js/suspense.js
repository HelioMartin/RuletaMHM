// Espera antes de anunciar un resultado: mientras la bola cae, cada pantalla sigue
// mostrando "No va más" y no deja ver puntos, ranking ni casilla ganadora nuevos.
import { CONFIG } from './config.js';

export const REVEAL_DELAY_MS = CONFIG.revealDelay * 1000;

export function entryId(state, entry) {
  return `${state.epoch}:${entry.round}:${entry.outcome}:${entry.at}`;
}

export class Suspense {
  constructor(onReveal) {
    this.pending = null;
    this.onReveal = onReveal;
  }

  // Empieza la espera para un resultado recién llegado.
  hold(state, entry, ms = REVEAL_DELAY_MS) {
    this.cancel();
    const id = entryId(state, entry);
    const timer = setTimeout(() => {
      if (this.pending?.id !== id) return;
      this.pending = null;
      this.onReveal(entry);
    }, ms);
    this.pending = { id, timer, until: Date.now() + ms };
  }

  cancel() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  get active() {
    return Boolean(this.pending);
  }

  // Estado que se pinta: durante la espera, el último resultado aún no existe.
  // Si el resultado cambia (p. ej. el crupier lo deshace), la espera se anula.
  view(state) {
    if (!this.pending) return state;
    const last = state.history[state.history.length - 1];
    if (state.phase !== 'result' || !last || entryId(state, last) !== this.pending.id) {
      this.cancel();
      return state;
    }
    return { ...state, phase: 'closed', history: state.history.slice(0, -1), falling: true };
  }
}
