# Marble Race — Plan v0.1

Juego web de carreras de canicas procedurales al estilo de los *marble races* de Algodoo.

## Stack

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript + Vite | build rápido, tipos compartidos entre módulos |
| Física | [planck.js](https://piqnt.com/planck.js/) 1.5 (port de Box2D) | determinista, colisiones continuas (`bullet`) para canicas rápidas, cuerpos cinemáticos para mecanismos |
| Render | Canvas 2D | sin dependencias, skins con gradientes cacheados |
| Tests | Vitest (Node, headless) | la simulación es pura y se puede correr sin navegador |

## Idea central: determinismo + validación

1. `generateMap(config, seed)` crea un `MapDef` (datos puros, JSON).
2. El **validador** corre la carrera completa *sin render* (rápido, por bloques para no congelar la UI).
3. Si ninguna canica llega a la meta (o menos de `race.minFinishers`), se descarta el mapa y se prueba con `seed + 1` (hasta `map.maxAttempts`).
4. La carrera visible re-simula **exactamente** la misma carrera (paso fijo `SIM_DT = 1/120`, RNG con semilla, sin `Math.random`, cámara de simulación en unidades de mundo). Por eso lo que se validó es lo que se ve.

## Arquitectura

```
src/
  core/        contratos compartidos (config, tipos del mapa, math, rng, fixtures, roster)
  gen/         generador procedural de mapas  -> MapDef
  sim/         simulación planck.js determinista (api.ts = contrato)
  validate/    generación + validación por intentos
  render/      dibujo en canvas (mapa, mecanismos, canicas, partículas, cámara)
  ui/          panel de configuración, HUD, podio
  main.ts      orquestación
tests/         tests headless (determinismo, generador, validación)
```

Contratos (no se rompen, sólo se extienden con campos opcionales):
- `src/core/config.ts` — `GameConfig` + `defaultConfig()`
- `src/core/types.ts` — `MapDef`, `Mechanism`, `Switch`, `Zone`, `MarbleProfile`…
- `src/sim/api.ts` — `Simulation`, `MarbleState`, `SimEvent`, `RaceResult`

## Funcionalidades v0.1

- **Canicas**: número configurable (1–200); skins sólido, bicolor, tricolor, multicolor (arcoíris), plata, oro, cristal, rayada; nombres en español.
- **Física**: gravedad (magnitud y dirección), viento (fuerza y dirección), impulso de salida, amortiguamiento, rebote/fricción de canicas. El recorrido se genera alineado con la dirección de la gravedad.
- **Reacción de paredes**: sólida, rebote, lenta, eliminar, lanzar. Configurable para las paredes exteriores y para paredes especiales interiores (proporción y tipos).
- **Objetos modificadores con puntos de movimiento**: hélices (1 pivote), brazos de 2 articulaciones, sierras giratorias, triángulos giratorios, martillos oscilantes. Efectos: agrandar, achicar, destruir, atraer, repeler. Además zonas estáticas con efecto.
- **Interruptores**: gravedad baja/alta/inclinada/invertida, invertir o acelerar mecanismos, viento, modo rebote, abrir compuertas (atajos).
- **Cámara**: modos líder / pelotón / camino / scroll automático; opción de eliminar las canicas fuera de cámara (con tiempo de gracia) o dejarlas seguir.
- **Meta y podio**: línea de meta, podio de las primeras N (default 3), tabla en vivo.
- **Mapas aleatorios validados**: semilla visible y reutilizable.

## Reparto de trabajo (agentes)

| Agente | Modelo | Alcance |
|---|---|---|
| sim | Sonnet | `src/sim/**`, `src/validate/**`, tests de determinismo |
| gen | Sonnet | `src/gen/**`, tests del generador |
| ui | Sonnet | `src/render/**`, `src/ui/**`, `src/core/roster.ts`, `src/main.ts`, `index.html` |
| docs | Haiku | README, workflow de GitHub Pages |
| (yo) | — | contratos, integración, revisión, QA con Playwright, git |

## Próximas versiones (ideas)

- Editor de mapas / guardar y compartir semillas con configuración.
- Más segmentos (elevadores, cintas transportadoras, portales).
- Validación en Web Worker y "calidad" del mapa (duración mínima, mezcla de posiciones).
- Equipos, torneos por rondas, sonido.
