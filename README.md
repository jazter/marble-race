# Marble Race

Carreras de canicas procedurales en el navegador, al estilo de los *marble races* de Algodoo. Cada mapa aleatorio se simula antes de mostrarse para garantizar que al menos una canica puede llegar a la meta.

## Cómo jugar

1. **Generar un mapa**: pulsa *🎲 Generar mapa*. El juego crea el recorrido a partir de una semilla.
2. **Validación**: una simulación previa corre la carrera completa sin dibujarla. Si ninguna canica llega a la meta, prueba con la semilla siguiente.
3. **Vista previa**: observa el mapa completo, con zoom y desplazamiento.
4. **Elige tu canica**: pulsa *▶ Iniciar carrera*; las canicas esperan en la salida. Toca una (o su fila en la lista) para ponerle nombre; los nombres se recuerdan entre carreras para las canicas con el mismo aspecto (*Reiniciar nombres* los borra).
5. **Carrera**: pulsa *▶ Iniciar conteo* (o espacio). Al terminar se muestra el podio.

Controles durante la carrera:

| Control | Acción |
|---|---|
| Velocidad 0.3× – 8× | Cambia la velocidad de la simulación (por defecto 0.6×; la cuenta atrás siempre va a 1×) |
| Pausa (barra espaciadora) | Pausa o reanuda |
| ↺ Reiniciar | Repite exactamente la misma carrera (la simulación es determinista) |
| 🗺️ Nuevo mapa | Genera otro mapa |
| Vista previa | Zoom y desplazamiento con ratón o pantalla táctil |

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
| Reacción de paredes exteriores | Sólida (también: rebote, lenta, eliminar, lanzar) |
| Tipos de paredes especiales | Rebote, lenta, eliminar, lanzar |
| Proporción de especiales | 25 % |
| Rebote / lentitud / lanzamiento | 1.1 / 85 % / 12 m/s |

> Con paredes exteriores en **Eliminar**, sólo 1 tramo con obstáculos (2 con dificultad ≥ 0.75) tiene paredes mortales; las rampas, la salida, los cambios de carril y la meta quedan protegidos. Si todas las paredes mataran, ninguna canica podría terminar un recorrido cerrado.

**Objetos**

| Opción | Por defecto |
|---|---|
| Mecanismos | Hélice, brazo doble, sierra, triángulo, martillo (todos) |
| Efectos | Agrandar, achicar, destruir, atraer, repeler (todos) |
| Densidad / velocidad | 50 % / 1× |
| Probabilidad de efecto | 60 % |
| Zonas con efecto | Activas |

**Interruptores**

| Opción | Por defecto |
|---|---|
| Activar interruptores | Sí |
| Acciones | Gravedad baja, alta e inclinada; invertir mecanismos; mecanismos rápidos; viento; modo rebote; abrir compuertas. *Gravedad invertida* viene desactivada |
| Frecuencia / duración | 35 % / 6 s |

**Cámara**

| Opción | Por defecto |
|---|---|
| Modo | Líder (también: pelotón, camino, scroll automático) |
| Ancho de vista | 30 m |
| Eliminar canicas fuera de cámara | No (si se activa, tiempo de gracia de 2 s) |
| Velocidad de scroll | 1.5 m/s (la cámara avanza al menos a esta velocidad y nunca deja escapar al líder por abajo) |

**Carrera**

| Opción | Por defecto |
|---|---|
| Podio (puestos) | 3 |
| Tiempo límite / cuenta regresiva | 180 s / 3 s |
| Mínimo de llegadas para validar | 1 |
| Anti-atascos | Activo |
| Fin de la carrera | Al completar el podio (también: cuando terminan todas las canicas) |

**Mapa**

| Opción | Por defecto |
|---|---|
| Segmentos | 8 (2–24) |
| Ancho del pasillo | 16 m |
| Dificultad | 50 % |
| Intentos máximos | 25 |
| Semilla | 12345 |

## Cómo funciona

- **Simulación determinista**: [planck.js](https://piqnt.com/planck.js/) (Box2D) con paso fijo de 1/120 s y generador aleatorio con semilla. No se usa `Math.random` ni el reloj, así que el mismo mapa y configuración producen siempre la misma carrera.
- **Validador**: simula la carrera completa sin renderizar. Si no llegan al menos `minFinishers` canicas a la meta, prueba con `seed + 1`, hasta `maxAttempts` intentos.
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
