// scripts/repo-walk.js
//
// Este repo tiene DOS barridos deterministas y offline sobre el mismo árbol
// de ficheros: `scripts/detect-conventions.mjs` (colisiones de PROTOCOLO entre
// el loop y el repo destino — claim, worktrees, fichero de estado) y
// `scripts/detect-vara.mjs` (§3.12 del handoff, docs/prompt-juez-lo-que-queda.md:
// candidatos a la vara de CÓDIGO del repo). Son sujetos distintos, pero
// recorren el mismo árbol con las mismas cotas y las mismas exclusiones —y si
// cada uno llevara su propia copia del recorrido, las cotas (`MAX_DEPTH`,
// `MAX_ENTRIES`), las exclusiones (`SKIP_DIRS`) y las dos reglas raras de
// abajo podrían divergir EN SILENCIO entre los dos barridos, exactamente el
// tipo de desacople que este repo ya ata con tests en otras partes
// (`CONVENTIONS_FILE`, `JUDGE_TOOLS`, `buildOptions`). Este módulo es el único
// recorrido: los dos barridos lo importan y no llevan copia propia.
//
// El código de aquí abajo es el que vivía en `detect-conventions.mjs`
// (extraído, no reescrito) y las tres reglas que parecen raras están medidas
// contra un repo real, no simplificadas por elegancia:
//   - `SKIP_DIRS` incluye `.worktrees`: es del PROPIO loop, y encontrar ahí un
//     `dispatch-check.sh` sería encontrar una copia del checkout, no una
//     convención (o candidato a vara) del repo destino.
//   - No se sigue NINGÚN symlink de directorio: un enlace a `/` convertiría el
//     escaneo en un recorrido del disco entero.
//   - Un directorio llamado `worktrees` (sin punto — el que el repo destino
//     pueda tener por su cuenta) se REGISTRA pero no se desciende a él: bajar
//     duplicaba cada fichero de interés una vez por worktree vivo, y esas
//     copias desplazaban de la lista al fichero de verdad — el aviso seguía
//     siendo correcto y se volvía ilegible, que a efectos prácticos es lo
//     mismo que callarse. El directorio en sí, registrado arriba, ya es la
//     señal que importa.
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Directorios que nunca son convenciones ni vara del repo, o que harían el
// recorrido caro sin aportar nada. Ver la nota de `.worktrees` arriba.
export const SKIP_DIRS = new Set([
  '.git', '.worktrees', 'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'target', 'vendor', 'Pods', '.next', '.ruff_cache',
  '.mypy_cache', '.pytest_cache', '.gradle', 'DerivedData',
])

// Cota dura del recorrido. Un repo grande no puede convertir un `/ct-init` en
// una espera: se corta y se DICE que se ha cortado (un escaneo incompleto que
// se presenta como completo es la misma mentira que el silencio).
export const MAX_DEPTH = 5
export const MAX_ENTRIES = 20000

// walkRepo: recorre `target` y devuelve `{ entradas, truncated }`.
//   - `entradas`: rutas relativas a `target`, separador `/` siempre (aunque se
//     corra en una plataforma con `path.sep` distinto). Los directorios
//     llevan `/` final — contrato de hoy, del que depende `conventions.js` — y
//     los ficheros no.
//   - `truncated`: `true` si el recorrido se cortó por `maxEntries` antes de
//     terminar. La profundidad (`maxDepth`) corta esa rama en silencio: no es
//     un truncado del escaneo entero, es la cota de cuánto se baja.
//
// No hace `statSync` del `target` ni valida que sea un directorio: eso es
// responsabilidad de cada envoltorio (`detect-conventions.mjs`,
// `detect-vara.mjs`), que necesitan decidir POR SU CUENTA el mensaje de error
// exacto — y así ninguno de los dos cambia de texto por venir de aquí.
export function walkRepo(target, { maxDepth = MAX_DEPTH, maxEntries = MAX_ENTRIES } = {}) {
  const entradas = []
  let truncated = false
  let entries = 0

  const rel = (full) => relative(target, full).split(sep).join('/')

  function walk(dir, depth) {
    if (depth > maxDepth || truncated) return
    let items
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // un subdirectorio ilegible no invalida el resto del recorrido
    }
    for (const item of items) {
      if (entries++ > maxEntries) { truncated = true; return }
      const full = join(dir, item.name)
      // `isDirectory()` sobre el Dirent (sin seguir symlinks a propósito: un
      // enlace a `/` convertiría el recorrido en el disco entero).
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue
        entradas.push(`${rel(full)}/`)
        // NO se desciende a un directorio de worktrees ajeno — ver la nota de
        // cabecera. El directorio en sí ya queda registrado arriba.
        if (/^worktrees$/i.test(item.name)) continue
        walk(full, depth + 1)
      } else if (item.isFile()) {
        entradas.push(rel(full))
      }
    }
  }

  walk(target, 0)
  return { entradas, truncated }
}
