# Changelog

Historial de cambios de **Marble Race**. Cada cambio se publica automáticamente en
<https://jazter.github.io/marble-race/> al subirlo a `main`. Lo más reciente va arriba; entre
paréntesis, el commit correspondiente.

---

## 2026-11-16 — Rendimiento, aturdidores y reagrupaciones

### Cambiado
- **Cámara 15 % más arriba** en pantallas verticales (8 % en horizontales, que son bajas y tienen
  la barra de controles abajo): el líder queda más abajo en la pantalla y se ven las canicas que
  vienen atrás.
- **Controles en teléfonos**: la barra de controles, la clasificación, el marcador, el minimapa y
  los avisos respetan las zonas seguras de la pantalla (barra de gestos de Android de borde a
  borde, muesca, esquinas redondeadas); antes la barra de controles quedaba tapada abajo. En
  pantallas muy angostas la barra se compacta para caber en una línea (≤ 340 px oculta 0,3×) y
  las etiquetas del marcador se recortan en vez de partirse.
- **Sin zoom de página en móviles**: la página ya no se puede ampliar con dos dedos ni se amplía
  sola al tocar un campo de la configuración (ahora con texto de 16 px en pantallas táctiles).
  Ese zoom se quedaba puesto y cortaba la barra de controles, la clasificación y el minimapa por
  abajo y por la derecha. La vista previa del mapa conserva su propio zoom.
- **Hélices de reagrupación tan rápidas como los demás mecanismos**: ~1,9 rad/s en el embudo con
  hélice y ~1,5 rad/s en la cámara circular (antes ~1 rad/s, una vuelta cada ~6 s). Se verificó en
  el navegador que el giro dibujado y el del cuerpo físico coinciden con la velocidad definida;
  nada las frena (`46bcdb1`). Antes hubo dos subidas intermedias: +35 % (`82932c1`) y +15 %
  (`0d9ee18`).
- **Viento proporcional a la gravedad** (14–22 % de la gravedad). Antes soplaba con 4–8 m/s² en todo
  el mapa (hasta ~40° de inclinación efectiva) y pegaba canicas contra las paredes en las rampas
  que bajaban en contra del viento (`0d9ee18`).
- **Los aturdidores se encienden 1 s y se apagan 1 s**, cada uno a su propio ritmo: paredes y
  puntos de aturdir, bobinas de Tesla y mecanismos con «aturdir». Apagados se ven grises, sin
  brillo ni chispas, y no aturden. Al encenderse, las bobinas también aturden a las canicas que ya
  estaban dentro (`db03d18`).

### Añadido
- **Objeto aturdidor**: nuevo efecto «Aturdir» para mecanismos (hélices, brazos, triángulos,
  martillos…, dibujados en violeta) y **bobinas de Tesla**: orbes eléctricos con arcos que aturden
  a las canicas que cruzan su campo. Casilla «Aturdir» en Objetos → Efectos (`339a48d`).
- **Resolución adaptable**: si la carrera baja de ~28 cuadros por segundo, el juego reduce la
  resolución del dibujo por pasos y la vuelve a subir si sobra potencia. Recuerda el nivel para la
  próxima visita (`82932c1`, `ca3b719`).
- **Modo liviano** en dispositivos lentos, activado junto con la resolución reducida: sin sombras,
  brillos ni reflejos en las paredes, sin animaciones ni viñeta en los fondos de escenario,
  campos de Tesla planos y la mitad de partículas (`ca3b719`).

### Rendimiento
- **Simulación ~25–30 % más liviana por paso**: cálculo del avance sin crear objetos, monstruos
  que descartan con pruebas geométricas baratas antes de revisar si pueden atrapar, sin objetos
  temporales por paso, y las canicas que ya llegaron a la meta «se duermen» (`ca3b719`).
- **Dibujado**: nombres, puestos y etiquetas se rasterizan una sola vez y se copian; no se dibujan
  partículas fuera de pantalla; las chispas diminutas se dibujan como cuadros; máximo de
  partículas 1800 → 900; resolución con tope de 2× en pantallas muy densas (`ca3b719`).
- **Sin cámara lenta**: un cuadro lento avanza hasta 0,25 s de carrera (antes 0,1 s), así la
  carrera va a velocidad real aunque el dispositivo no alcance (`82932c1`).
- Medido en una tablet simulada (CPU 6× más lenta): de 8–16 a 17–28 cuadros por segundo y carrera
  a velocidad real; luego ~16 % más cuadros con las optimizaciones de simulación y dibujado.

### Corregido
- Carriles anchos «rebote» / «clavos»: ya no se pone un bumper o clavo tan pegado a la pared del
  carril que una canica agrandada quede encajada (`82932c1`).
- Atascos por viento con gravedad baja (semillas 8 y 21 a 6,9 m/s²) (`0d9ee18`).

---

## 2026-11-15 — Aturdir en vez de eliminar, pinball, mapas guardados y más

### Cambiado
- **Las paredes y puntos asesinos pasan a aturdir por defecto** (`13e3a95`). La canica pierde ~90 %
  de su velocidad y flota 1,2 s con estrellitas (control «Aturdimiento»), con 1,5 s de inmunidad,
  y sigue. «Eliminar» sigue disponible pero viene apagado. Resultado en 20 carreras:
  eliminaciones por pared 2,2 → 0, canicas que terminan 8,8 → 10,3 de 20. Las configuraciones
  guardadas antes se migran a aturdir.
- Monstruos: una canica liberada no puede volver a ser atrapada durante **2 s** (`ea7e113` con 1 s,
  `af477c4` con 2 s). Las serpientes eligen la línea con más canicas y se desvían hacia ellas.
  Los brazos del pulpo llegan ~14 % más lejos.
- Mapas de 10 tramos por defecto (antes 8) (`415a742`).

### Añadido
- **Paletas de pinball**: se levantan al tocarlas y lanzan la canica; cada canica puede activarlas
  como máximo 3 veces. **Mesas de pinball** (bumpers, guías y dos paletas junto a un drenaje) y
  **techo a dos aguas** que divide en dos carriles con trampas distintas (uno arriesgado y rápido,
  otro seguro y lento). Opción «Paletas de pinball» (`415a742`).
- **Botón «Revancha»**: mismo mapa, carrera distinta (y reproducible). «Repetir carrera» repite
  exactamente la actual (`661f428`).
- **Guardar mapas favoritos** («⭐ Guardar mapa») y sección «Mis mapas»: cargar, renombrar,
  borrar, exportar e importar en `.json`. Hasta 30 mapas (`32a0c83`).
- **Mantener la pantalla encendida** (Screen Wake Lock) mientras se ve un mapa o una carrera,
  activado por defecto en Apariencia (`90e9b73`).
- **Piezas asesinas raras** en paredes exteriores mixtas (~4 % de las piezas, nunca seguidas)
  (`019197c`); desde `13e3a95` estas piezas aturden.

### Corregido
- **Canicas fuera del mapa**: una canica que se escapaba por fuera de las paredes podía caer todo
  el recorrido y la cámara la seguía. Ahora el mapa conoce su contorno y la canica que sale queda
  eliminada («salió del mapa») (`af477c4`).
- **Bucle pulpo–sombrero**: el sombrero del pulpo era un techo con hueco donde una canica quedaba
  atrapada y la liberaban y atrapaban sin fin. Ahora es un bloque sólido, y un monstruo atrapa la
  misma canica como máximo 2 veces por carrera (`d77a399`).
- **Canicas atascadas**: con un detector nuevo (50 semillas × 2 gravedades) los atascos pasaron de
  26 a 0 y la resolubilidad de 18/20 a 20/20 (`2f08c09`). Incluye:
  - trampas de los carriles del techo separadas entre sí;
  - rampas de miel a 20°;
  - interruptores con tiempo que no se extienden y descansan 4 s, inclinación de gravedad más
    suave (10–18°, ≤ 4 s);
  - un empujón más fuerte hacia el centro si la canica se vuelve a trabar.
- Configuraciones guardadas antes de los grupos de monstruos adoptan los nuevos valores por
  defecto (`16063ea`).
- Brazos del pulpo con curvas naturales, en vez de espirales con quiebre (`b24dce4`).
- Panel de configuración fácil de cerrar en tablets y en todos los tamaños: botón «✕ Cerrar»,
  tecla Esc, fondo que se toca para cerrar y botón «⚙ Configurar» en la pista (`9161b53`).

---

## 2026-11-14 — Primera versión y primeras mejoras

### Añadido
- **Juego base** (`f9d53ba` … `01807da`):
  - simulación física determinista (planck.js);
  - validador que reintenta semillas hasta que suficientes canicas llegan a la meta;
  - render en canvas con skins (sólida, bicolor, tricolor, rayada, arcoíris, plata, oro, cristal);
  - panel de configuración en español guardado en el navegador, marcador, minimapa y podio.
- **Generador de recorridos** alineado con la gravedad (`7f96f4b`):
  - tramos de zigzag, embudo, clavos, hélices, brazos, sierras, triángulos, martillos, zonas e
    interruptores con trampillas;
  - caja de salida a la medida, embudo y depósito de meta;
  - todo el recorrido gira con el ángulo de la gravedad.
- **Despliegue automático** a GitHub Pages en cada push a `main`, y CI (`fd23b9c`, `01807da`).
- **Música adaptable** (Web Audio): tensa pero fácil de escuchar, en re menor. La intensidad sigue
  la carrera, con remate en la primera llegada y resolución en el podio. Botón de silencio,
  volumen y tecla M (`7708813`).
- **Cada canica con un aspecto único y estable**, y **nombres de espectadores** que se recuerdan
  por aspecto (`e5b43d5`).
- **Fase «Elige tu canica»** antes del conteo: tocar una canica para ponerle nombre, botón
  «Iniciar conteo» y «Reiniciar nombres» (`ed2b0d4`).
- **Puntos de reagrupación**: embudo con hélice y cámara circular que juntan a las canicas y las
  dejan pasar por tandas (`1d33b5f`).
- **Monstruos** (`53af634` … `19f0fa2`):
  - araña que baja por su hilo, pulpo con 8 tentáculos, pez que cruza de izquierda a derecha y
    serpiente que cruza en cualquier ángulo;
  - atrapan, sostienen y devoran o liberan según una probabilidad;
  - todos animados, con avisos y marcas en el minimapa.
- **Monstruos en grupos**: cardúmenes de peces, nidos de serpientes y colonias de arañas
  («Grupos por mapa», «Tamaño de grupo») (`499cfcd`).
- **Tableros de Galton**, **carriles divididos** (2–5, uno más lento) y rampas que siempre se
  alternan (`466caeb`).
- **Paredes exteriores mixtas** (nuevo valor por defecto): cada tramo con su reacción (sólida,
  rebote, lenta, lanzador) (`466caeb`, `560bf0c`).
- **Fondos de escenario** seleccionables: mar, espacio, nubes, dinosaurios y castillo, con
  paralaje y paleta de paredes propia (`8132935`).

### Cambiado
- Podio completo por defecto: al menos 3 canicas deben poder terminar para validar un mapa
  (`7321689`).
- Velocidad inicial 1× (0,6× sigue disponible) (`ed2b0d4`, `785c029`).
- Minimapa arriba a la izquierda (`9bf7f25`); en teléfonos solo se muestran los dos avisos más
  recientes y compactos (`d493b84`).
- Cámara «scroll» que persigue al líder sin dejarlo escapar (`24f2cb0`).

### Quitado
- Opción «eliminar fuera de cámara», para simplificar (`560bf0c`).

### Corregido
- Mapas con paredes exteriores asesinas que no se podían validar: ahora solo algunos tramos son
  letales (`cb8950f`).
- Las canicas con nombre ya no desaparecen al bajar el número de canicas (`73affaa`).
