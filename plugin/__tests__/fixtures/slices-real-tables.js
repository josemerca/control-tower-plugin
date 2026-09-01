// Fixtures compartidos entre __tests__/slices.test.js (parser puro) y
// __tests__/ct-groom-dryrun.test.js (CLI end-to-end). Su valor entero como
// regresión es ser byte-exactos a las tablas reales que dispararon cada
// incidente — vivían duplicados literalmente en ambos ficheros, lo que
// garantiza que con el tiempo divergieran (alguien retoca una copia para
// que pase un test nuevo y la otra queda parafraseada sin que nadie lo
// note). Una sola fuente de verdad.

// F1 — la tabla real que disparó el incidente original: alguien que no
// había leído commands/ct-groom.md escribió "#" como "**S1**"/"**S2**"
// (numeración con prefijo de letra y negrita markdown en vez de un entero a
// secas), el Dep de S1 como un em dash "—" (que SÍ significa "sin
// dependencias", ver CRITICAL 1 de la review de F1) y el de S2 como "S1"
// (sin "#"), y el valor de Área/Toca como el nombre completo de la label
// ("`area:medicacion`"/"`touches:pbxproj`", con backticks) en vez del token
// pelado. Con el parser viejo esto producía `parseSlices() -> []` en
// absoluto silencio. No se parafrasea: son las filas exactas del informe
// del incidente.
export const REAL_FAILING_TABLE = [
  '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
  '| # | Slice | Qué entrega (visible) | Área | Toca | Depende de |',
  '|---|---|---|---|---|---|',
  '| **S1** | Segmented control + "Plan actual" | La pestaña se parte en dos… | `area:medicacion` | `touches:pbxproj` | — |',
  '| **S2** | Objetivo semanal y cumplimiento | La barra: % de la semana… | `area:medicacion` | `touches:migration` | S1 |',
  '',
].join('\n')

// F2 — la tabla con la que el coordinador verificó el fix de F1 y encontró
// el hueco adyacente: con "#" ya corregido (1, 2, 3), "Dep" sigue usando
// "S1"/"S2" en vez de "#1"/"#2" — deps: [] en silencio, exit 0, grafo de
// dependencias borrado.
export const REAL_DEP_TABLE = [
  '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | a | ui | primero | – | – | – |',
  '| 2 | b | ui | segundo | S1 | – | – |',
  '| 3 | c | ui | tercero | S1, S2 | – | – |',
  '',
].join('\n')

// F1 CRITICAL 1 (review) — REAL_FAILING_TABLE con el "#" ya corregido a un
// entero a secas (1, 2), tal como pide nuestro propio mensaje de error, sin
// tocar nada más. La fila 1 sigue usando el em dash "—" en Dep (que
// siempre significó "sin dependencias" correctamente) y la fila 2 sigue
// usando "S1" (que sigue siendo un Dep malformado de verdad). El fix debe
// dejar pasar la fila 1 sin abortar por Dep y seguir abortando por la fila
// 2 — la reproducción exacta de la secuencia que describió el coordinador:
// "la sesión de menoplus arregla la columna # exactamente como le decimos,
// vuelve a ejecutar → aborta en una celda que significa correctamente
// «ninguna dependencia»".
export const REAL_TABLE_WITH_HASH_FIXED = [
  '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
  '| # | Slice | Qué entrega (visible) | Área | Toca | Depende de |',
  '|---|---|---|---|---|---|',
  '| 1 | Segmented control + "Plan actual" | La pestaña se parte en dos… | `area:medicacion` | `touches:pbxproj` | — |',
  '| 2 | Objetivo semanal y cumplimiento | La barra: % de la semana… | `area:medicacion` | `touches:migration` | S1 |',
  '',
].join('\n')
