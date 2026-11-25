# Marble Race

Carreras de canicas procedurales en el navegador, al estilo de los *marble races* de Algodoo. Cada mapa aleatorio se simula antes de mostrarse para garantizar que al menos una canica puede llegar a la meta.

Juega en <https://jazter.github.io/marble-race/> · Historial de cambios: [CHANGELOG.md](CHANGELOG.md)

## Cómo jugar

1. **Generar un mapa**: pulsa *🎲 Generar mapa*. Cada mapa nuevo usa una semilla al azar; para repetir un mapa, escribe su semilla en *Mapa → Semilla* antes de generar.
2. **Validación**: una simulación previa corre la carrera completa sin dibujarla. Si ninguna canica llega a la meta, prueba con la semilla siguiente.
3. **Vista previa**: explora el mapa completo: arrastra para moverte y usa la rueda o pellizca para acercar.
4. **Elige tu canica**: pulsa *▶ Elegir canicas*; las canicas esperan en la salida. Toca una (o su fila en la lista) para ponerle nombre; los nombres se recuerdan entre carreras para las canicas con el mismo aspecto (*Reiniciar nombres* los borra).
5. **Carrera**: pulsa *▶ Iniciar conteo* (o espacio). Al terminar se muestra el podio.

Controles durante la carrera:

| Control | Acción |
|---|---|
| Velocidad 0.3× – 8× | Cambia la velocidad de la simulación (por defecto 1×; la cuenta atrás siempre va a 1×) |
| Pausa (barra espaciadora) | Pausa o reanuda |
| ↺ Reiniciar / Repetir carrera | Repite exactamente la misma carrera (la simulación es determinista) |
| 🔁 Revancha (en el podio) | Mismo mapa y mismas canicas, pero cambia el impulso de salida, el orden en la caja y las decisiones de los monstruos: la carrera sale distinta y se vuelve a validar. Una revancha guardada se reproduce igual |
| 🗺️ Nuevo mapa | Genera otro mapa |
| Vista previa | Zoom y desplazamiento con ratón o pantalla táctil |
| ⭐ Guardar mapa | En la vista previa, en la preparación y en el podio: guarda el mapa con el nombre que elijas (máx. 30, en el navegador) |

**Mis mapas** (panel, tras *Apariencia*; también 📂 en la pantalla de inicio): lista de mapas guardados con *▶ Cargar*, ✎ renombrar y 🗑 borrar. *⬇ Exportar* descarga todos en un `.json` y *⬆ Importar* los añade en otro dispositivo (omite repetidos). Se guarda el mapa completo, así que no cambia aunque el generador cambie; al cargarlo se vuelve a comprobar con la física actual.

## Opciones

Todas las opciones están en el panel lateral (⚙ en móvil). *Restablecer valores* devuelve los valores por defecto.

**Canicas**

| Opción | Por defecto |
|---|---|
| Cantidad | 20 (1–200) |
| Tamaño (radio) | 0.45 m |
| Aspectos (skins) | Todos: sólido, bicolor, tricolor, rayada, arcoíris, plata, oro, cristal |
| Rebote / Fricción / Densidad | 0.35 / 0.1 / 1 |
| Escala mínima / máxima | 0.5× / 2× |

**Física**

| Opción | Por defecto |
|---|---|
| Gravedad | 9.8 m/s² |
| Dirección de gravedad | 0° (hacia abajo) |
| Viento: fuerza / dirección | 0 m/s² / 90° |
| Impulso de salida | 1.5 m/s |
| Amortiguamiento | 0.05 |

**Paredes**

| Opción | Por defecto |
|---|---|
| Reacción de paredes exteriores | Mixta: cada tramo con su propia reacción (sobre todo sólida, con rebote, lenta, lanzadores que empujan a favor del recorrido y, muy rara vez, tramos cortos que aturden; nunca dos seguidos ni donde se apoyan las rampas). También: sólida, rebote, lenta, aturdir, eliminar, lanzar |
| Tipos de paredes especiales | Rebote, lenta, **aturdir** y lanzar (eliminar existe pero viene apagado) |
| Aturdimiento | 1.2 s: la canica que toca una pared o punto de aturdir pierde casi toda su velocidad y flota con estrellitas antes de seguir; no se elimina. Todos los aturdidores (paredes, puntos, bobinas y mecanismos) están **encendidos 1 s y apagados 2 s**, cada uno a su propio ritmo; apagados se ven grises y no aturden |
| Proporción de especiales | 25 % |
| Rebote / lentitud / lanzamiento | 1.1 / 85 % / 12 m/s |

> Con paredes exteriores en **Eliminar**, sólo 1 tramo con obstáculos (2 con dificultad ≥ 0.75) tiene paredes mortales; las rampas, la salida, los cambios de carril y la meta quedan protegidos. Si todas las paredes mataran, ninguna canica podría terminar un recorrido cerrado.

**Objetos**

| Opción | Por defecto |
|---|---|
| Mecanismos | Hélice, brazo doble, sierra, triángulo, martillo, paletas de pinball, **engrane** y **elevador de escalera** (todos) |
| Paletas de pinball | Se activan al tocarlas y lanzan la canica hacia arriba (ignoran la velocidad de objetos y los interruptores). Cada canica puede activar 3 veces las paletas de cada mesa (o cada paleta suelta), así las de más abajo siguen funcionando |
| Engranes | Tramo con una o dos cámaras redondas, cada una con un engrane de latón que lleva las canicas en los huecos entre sus dientes hasta la salida. Reemplazan a las filas de hélices, triángulos y martillos, que casi no tocaban a las canicas (hélices, triángulos y martillos siguen en las trampas del techo a dos aguas y las mesas de pinball; las hélices, en los puntos de reagrupación) |
| Elevador de escalera | Una escalera que cruza el pasillo con una paleta en cada escalón: la canica rueda hasta el fondo del escalón, la paleta la lanza al de arriba (si no llega, lo vuelve a intentar) y desde el último cae por un canal al lado. Como mucho uno por mapa |
| Efectos | Agrandar, achicar, destruir, atraer, repeler y **aturdir** (todos). Los mecanismos con «aturdir» se ven violetas y aturden al tocarlos |
| Bobinas de Tesla | Con «aturdir» y zonas activas: orbes eléctricos colgados en los huecos de algunas rampas (y en tramos de zonas) que aturden a las canicas que están en su campo mientras están encendidos (al encenderse también aturden a las que ya estaban dentro) |
| Densidad / velocidad | 50 % / 1× |
| Probabilidad de efecto | 60 % |
| Zonas con efecto | Activas |
| Portales | Activos: ~1–2 por mapa en huecos por donde caen las canicas. *Atajo* (azul) te manda más adelante; *Trampa* (rojo) te regresa un poco. Cada canica puede usar cada portal una sola vez |
| Cintas transportadoras | Activas: ~30 % de las rampas de zigzag arrastran a las canicas, casi siempre a favor (más rápido) y a veces en contra |
| Trampolines | Activos: tramo con dos trampolines bajo embudos que lanzan las canicas al otro lado; cada canica recibe hasta 3 lanzamientos por trampolín |

**Monstruos** — criaturas que agarran canicas y, según una probabilidad, las devoran o las sueltan: la *araña* cuelga de un hilo y baja sobre la canica que tiene debajo, el *pulpo* sujeta hasta 8 canicas a la vez (una por tentáculo), el *pez* cruza nadando de izquierda a derecha y captura la canica que encuentra, y la *serpiente* atraviesa el mapa en cualquier ángulo para atrapar una.

| Opción | Por defecto |
|---|---|
| Tipos de monstruo | Araña, pulpo, pez, serpiente (todos) |
| Grupos por mapa | 5 (0–8; con 0 no hay monstruos) |
| Tamaño de grupo | hasta 4 (1–6): colonias de arañas, bancos de peces y nidos de serpientes; el pulpo va solo |
| Probabilidad de devorar | 40 % (si no devora, suelta a la canica) |
| Tiempo atrapada | 2 s (0.5–6 s) |
| Velocidad | 1× (0.25–3×) |

**Interruptores**

| Opción | Por defecto |
|---|---|
| Activar interruptores | Sí |
| Acciones | Gravedad baja, alta e inclinada; invertir mecanismos; mecanismos rápidos; viento (14–22% de la gravedad, a favor de la rampa del botón); modo rebote; abrir compuertas. *Gravedad invertida* viene desactivada |
| Frecuencia / duración | 35 % / 6 s |

**Apariencia**

| Opción | Por defecto |
|---|---|
| Fondo | Automático (tema liso del mapa). También: fondo del mar, espacio, nubes, dinosaurios y castillo: escenas dibujadas por código con capas de paralaje. Solo cambia el aspecto: se aplica al instante, incluso en plena carrera, y no obliga a regenerar el mapa. Con «reducir movimiento» activo en el sistema no hay animaciones ambientales |
| Resolución adaptable | Automática: si el dispositivo no alcanza ~28 cuadros por segundo durante la carrera, el juego baja la resolución del dibujo por pasos y pasa a un modo más liviano (sin sombras ni brillos en las paredes, sin animaciones del fondo, la mitad de partículas); la vuelve a subir si sobra potencia y recuerda el nivel para la próxima visita. Un cuadro lento nunca pone la carrera en cámara lenta |
| Mantener la pantalla encendida | Sí: en teléfonos y tablets la pantalla no se apaga mientras se ve el mapa o la carrera (Screen Wake Lock; Chrome/Android, Safari iOS 16.4+, Firefox 126+) |

**Cámara**

| Opción | Por defecto |
|---|---|
| Modo | Líder (también: pelotón, camino, scroll automático) |
| Ancho de vista | 30 m |
| Velocidad de scroll | 1.5 m/s (la cámara avanza al menos a esta velocidad y nunca pierde al líder) |

**Carrera**

| Opción | Por defecto |
|---|---|
| Podio (puestos) | 3 |
| Tiempo límite / cuenta regresiva | 180 s / 3 s |
| Mínimo de llegadas para validar | 3 (nunca más que las canicas ni, en modo podio, que el tamaño del podio) |
| Anti-atascos | Activo |
| Fin de la carrera | Al completar el podio (también: cuando terminan todas las canicas) |

**Mapa**

| Opción | Por defecto |
|---|---|
| Segmentos | 10 (2–24) |
| Ancho del pasillo | 16 m |
| Dificultad | 50 % |
| Intentos máximos | 25 |
| Semilla | Al azar en cada mapa nuevo (escribe una para repetir un mapa) |

## Cómo funciona

- **Simulación determinista**: [planck.js](https://piqnt.com/planck.js/) (Box2D) con paso fijo de 1/120 s y generador aleatorio con semilla. No se usa `Math.random` ni el reloj, así que el mismo mapa y configuración producen siempre la misma carrera.
- **Validador**: simula la carrera completa sin renderizar. Si no llegan al menos `minFinishers` canicas a la meta (acotado al número de canicas y al tamaño del podio), prueba con `seed + 1`, hasta `maxAttempts` intentos.
- **Carrera visible**: vuelve a simular exactamente la carrera validada, por eso lo que se valida es lo que se ve.

Estructura de `src/`:

- `core/`: configuración (`config.ts`), tipos del mapa, matemáticas, RNG y datos de prueba.
- `gen/`: generador procedural de mapas (`MapDef`).
- `sim/`: simulación planck.js; `api.ts` define el contrato.
- `validate/`: generación con validación por intentos.
- `render/`: dibujo en canvas (mapa, mecanismos, canicas, partículas, cámara).
- `ui/`: panel de configuración, HUD y podio.
- `main.ts`: orquestación.

Los tests headless viven en `tests/`.

## Desarrollo

Requiere Node.js 22 o superior.

```bash
npm install            # instala dependencias
npm run dev            # servidor de desarrollo (Vite)
npm test               # tests con Vitest
npm run typecheck      # comprobación de tipos
npm run build          # build de producción en dist/
npm run build:single   # dist-single/index.html: un único archivo autocontenido
npx tsx scripts/sim-bench.ts   # benchmark de la simulación (opcional: número de canicas)
```

## Publicar en GitHub Pages

El juego se publica en **https://jazter.github.io/marble-race/**. El workflow `.github/workflows/pages.yml` lo despliega automáticamente en cada push a `main` (también se puede lanzar a mano desde la pestaña **Actions → Deploy to GitHub Pages → Run workflow**).

Requisitos (ya configurados): repositorio público y **Settings → Pages → Source: GitHub Actions**.

## Licencia

MIT. Ver [LICENSE](LICENSE).
