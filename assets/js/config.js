// Configuración de La Ruleta de las Harinas.
// Las tres apps (jugar, mesa y control) leen este mismo archivo.

const params = new URLSearchParams(location.search);

export const CONFIG = {
  // Servidor de tiempo real (MQTT sobre WebSocket seguro). Todos los dispositivos
  // tienen que usar el mismo. Alternativas públicas si este fallara:
  //   'wss://broker.hivemq.com:8884/mqtt'
  //   'wss://mqtt.eclipseprojects.io:443/mqtt'
  brokerUrl: params.get('broker') || 'wss://broker.emqx.io:8084/mqtt',

  // Nombre único de esta mesa dentro del servidor. Cámbialo para empezar en una sala limpia.
  namespace: params.get('sala') || 'mhm-ruleta-harinas/o4s7uvnqve',

  // Partidas por defecto (el crupier puede añadir rondas de desempate).
  totalRounds: 10,

  // Puntos según el reglamento.
  points: { exact: 10, group: 3, bonus: 2 },

  // Segundos de espera ("la bola está cayendo") desde que el crupier marca el resultado
  // hasta que se anuncia en la mesa y en los móviles. Coincide con el final del sonido.
  revealDelay: 4,

  // PIN del mando de los crupieres. Es un filtro para invitados curiosos, no una
  // contraseña segura: cualquiera que lea este archivo puede verlo.
  controlPin: '2026',
};

// Mantiene ?broker y ?sala al enlazar entre apps (útil para pruebas).
export function carryParams(path) {
  const url = new URL(path, location.href);
  for (const key of ['broker', 'sala']) {
    if (params.has(key)) url.searchParams.set(key, params.get(key));
  }
  return url.toString();
}
