# La Ruleta de las Harinas

Juego de ruleta para la comida de empresa de MHM Grupo Harinero. La ruleta es física; estas tres web apps llevan las apuestas, los puntos y el ranking en tiempo real.

| App | Ruta | Quién la usa | Dispositivo |
|---|---|---|---|
| Jugar | `/jugar/` | Invitados: entran con nombre y apellido, apuestan y ven el ranking | Móvil |
| Mesa | `/mesa/` | Se proyecta en la sala: tapete con las fichas en directo, ranking (los 3 primeros arriba y el resto en dos columnas que pasan de página), código QR | Portátil + proyector |
| Mando del crupier | `/control/` | Crupieres: abrir ronda, "No va más", marcar el resultado | Móvil |

Con GitHub Pages activado, las direcciones son:

- Portada: `https://heliomartin.github.io/RuletaMHM/`
- Jugadores: `https://heliomartin.github.io/RuletaMHM/jugar/` (es la que abre el código QR de la mesa)
- Mesa: `https://heliomartin.github.io/RuletaMHM/mesa/`
- Mando: `https://heliomartin.github.io/RuletaMHM/control/` (PIN por defecto: `2026`)

## Reglas (del documento de normas)

- 10 partidas, una única apuesta por partida.
- Harina concreta (casillas del centro): **10 puntos** si sale.
- Harina blanca o harina integral: **3 puntos** si sale una harina de ese tipo. Las casillas claras del tapete son blancas y las marrones, integrales.
- Semol y Trigo: no se puede apostar, pero si la ruleta cae ahí, **todos los jugadores ganan 2 puntos**.
- Ganan premio los 3 jugadores con más puntos. Si hay empate, el mando permite jugar una ronda extra de desempate.

## Cómo se juega el día del evento

1. Abre la **mesa** en el portátil conectado al proyector. Pulsa *Pantalla completa* (o la tecla `F`) y *Activar sonido*.
2. Abre el **mando** en el móvil del crupier e introduce el PIN.
3. Los invitados escanean el QR que aparece en la mesa y escriben su nombre y apellido.
4. En el mando: **Abrir ronda 1**. Los móviles de los invitados avisan y pueden poner su ficha y confirmar. Cada ficha confirmada aparece al momento en la mesa.
5. Antes de girar la ruleta: **No va más**. En la mesa aparece la ruleta girando y, con el sonido activado, suena la bola girando en bucle.
6. Cuando la ruleta se pare, toca en el tapete del mando la casilla donde ha caído y confírmalo. Durante 4 segundos la bola frena, cae y se para en todas las pantallas, sin desvelar nada. Después el resultado se anuncia a la vez en la mesa y en todos los móviles, y el ranking se actualiza con las subidas y bajadas de puesto. El mando no deja abrir la siguiente ronda hasta que termina esa espera.
7. **Abrir ronda 2**, y así hasta la 10. Al final, **Terminar y mostrar el podio**.

Si te equivocas al marcar un resultado, usa **Deshacer resultado**. Mientras la ronda está abierta, el botón **Anular** de la lista de jugadores quita la ficha que ya confirmó alguien para que pueda volver a apostar; por ejemplo, si se equivocó de casilla. Con muchos jugadores, usa el buscador encima de la lista: busca por cualquier parte del nombre o del apellido, sin importar mayúsculas ni tildes. Desde el mando también puedes retirar a un jugador (nombres duplicados o de prueba) y **Reiniciar partida** después de los ensayos.

## Cómo funciona

Son páginas estáticas (HTML, CSS y JavaScript sin compilar), así que GitHub Pages las sirve tal cual. El tiempo real va por MQTT sobre WebSocket con un servidor público y gratuito (`broker.emqx.io`). Todo el estado se guarda como mensajes retenidos dentro de una "sala" única, de modo que quien entra tarde o recarga la página recupera la partida al momento.

- `<sala>/state`: estado de la partida. Lo publica solo el mando.
- `<sala>/e/<época>/p/<jugador>`: alta de cada jugador.
- `<sala>/e/<época>/b/<ronda>/<jugador>`: apuesta confirmada.

Los puntos se calculan en cada pantalla a partir del historial de resultados. Cada resultado guarda una foto de las apuestas y de los jugadores de ese momento, así que una apuesta que llegue tarde no puede cambiar una ronda ya resuelta.

El mando también guarda el estado en el propio móvil. Si el servidor perdiera los datos, al volver a abrir el mando se republica todo, y cada jugador vuelve a enviar su alta y su apuesta al reconectar.

## Configuración

Todo está en [`assets/js/config.js`](assets/js/config.js):

- `brokerUrl`: servidor de tiempo real. Si la wifi del local bloquea el puerto 8084, prueba `wss://mqtt.eclipseprojects.io:443/mqtt`. Todos los dispositivos tienen que usar el mismo.
- `namespace`: nombre único de la sala. Cámbialo para empezar en limpio.
- `totalRounds`, `points`: número de partidas y puntos.
- `revealDelay`: segundos de espera entre marcar el resultado y anunciarlo. Coincide con la duración de `assets/audio/ruleta-final.mp3`.
- `controlPin`: PIN del mando. Sirve para frenar a invitados curiosos, pero no es una contraseña segura, porque cualquiera puede leer este archivo.

Para probar sin tocar la partida real, añade `?sala=prueba1` a las tres direcciones (los enlaces y el QR conservan el parámetro).

## Activar GitHub Pages

En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**. Elige la rama con el código (por ejemplo, `main` cuando se fusione, o `claude/laughing-shannon-ig4sf0`) y la carpeta `/ (root)`. En uno o dos minutos la web estará en `https://heliomartin.github.io/RuletaMHM/`.

## Antes del evento: ensayo de 5 minutos

1. Abre la mesa en el portátil y el mando en un móvil.
2. Entra como jugador desde dos móviles, uno con wifi y otro con datos.
3. Haz una ronda completa: abrir, apostar, "No va más", resultado.
4. En el mando, pulsa **Reiniciar partida** para borrar el ensayo.

## Pruebas automáticas

Las pruebas arrancan su propio servidor web y un servidor MQTT local, así que no tocan la partida real.

```bash
npm install
npx playwright install chromium
npm test
```

- `tests/anular-apuesta.test.mjs`: el crupier anula una apuesta confirmada y el jugador vuelve a apostar. Cubre el caso en directo y el caso con el móvil desconectado, y comprueba que con las apuestas cerradas no se puede anular.
- `tests/carga-150.test.mjs`: 150 personas juegan a la vez con 1 crupier y la mesa durante 3 rondas: harina exacta, bonus e integral. 8 jugadores usan la app real en el navegador y el resto son bots que hablan con el servidor igual que la app. La prueba comprueba lo siguiente:
  - que todas las altas y apuestas llegan a la mesa y al mando;
  - que se puede anular una apuesta con la sala llena;
  - que nadie ve el resultado durante la caída de la bola;
  - que puntos y puestos coinciden con el reglamento;
  - que las páginas no se bloquean y que no hay errores.

  Puedes cambiar las cifras: `JUGADORES=300 NAVEGADORES=8 npm run test:carga`.

Las capturas y el resumen de tiempos se guardan en `tests/salida/`. Estos son los resultados en local con 150 jugadores:
- la última apuesta tarda unos 0,1 s en verse en la mesa y en el mando;
- el anuncio sale a los 4,2 s de marcar el resultado;
- ninguna página se queda bloqueada más de 0,15 s.

Con 300 jugadores también pasa. Estas pruebas no miden los límites del servidor público (`broker.emqx.io`), así que el ensayo con móviles reales sigue siendo necesario.

## Desarrollo local

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080/`. Para no usar el servidor público, puedes levantar un broker MQTT local con WebSocket y añadir `?broker=ws://localhost:8888&sala=dev` a las URLs.

El sonido de la ruleta está en `assets/audio/`. `ruleta-giro.wav` es el bucle de la bola girando, y `ruleta-final.mp3` es la bola frenando, cayendo y parándose. Ambos se recortaron del efecto de sonido que aportó la organización. Si faltan, la mesa usa un sonido sintetizado.

Librerías incluidas en `assets/vendor/`: [MQTT.js](https://github.com/mqttjs/MQTT.js) (MIT) y [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
