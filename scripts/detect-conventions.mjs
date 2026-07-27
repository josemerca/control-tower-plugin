#!/usr/bin/env node
// Envoltorio de IO de scripts/conventions.js: lee el repo destino y escribe el
// aviso (si lo hay) por stdout. Lo llama ct-init.sh, que lo redirige a stderr
// junto a sus demás avisos.
//
// Contrato de salida, deliberadamente pobre para que ct-init.sh no tenga que
// interpretar nada:
//   exit 0  → escaneo completado. stdout vacío = no se ha encontrado nada;
//             stdout con texto = el aviso, ya formateado.
//   exit 1  → NO se ha podido escanear (uso incorrecto, directorio ilegible).
//             stderr explica por qué. El caller NUNCA debe leer esto como
//             "repo limpio": ese es justo el falso negativo caro.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { detectConventions, formatFindings } from './conventions.js'

const target = process.argv[2]
if (!target) {
  console.error('uso: detect-conventions.mjs <dir-repo>')
  process.exit(1)
}

// Directorios que NO son convenciones del repo (o que harían el escaneo caro
// sin aportar nada):
//   - `.worktrees` es del PROPIO loop: encontrar ahí un dispatch-check sería
//     encontrar una copia del checkout, no una convención del repo;
//   - `.git`, `node_modules`, entornos y directorios de build, por coste.
const SKIP_DIRS = new Set([
  '.git', '.worktrees', 'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'target', 'vendor', 'Pods', '.next', '.ruff_cache',
  '.mypy_cache', '.pytest_cache', '.gradle', 'DerivedData',
])

// Cota dura del recorrido. Un repo grande no puede convertir un `/ct-init` en
// una espera: se corta y se DICE que se ha cortado (un escaneo incompleto que
// se presenta como completo es la misma mentira que el silencio).
const MAX_DEPTH = 5
const MAX_ENTRIES = 20000

let truncated = false
let entries = 0

// El acumulador lleva ficheros Y directorios; los directorios con `/` al
// final, que es como conventions.js los distingue.
function rel(full) {
  return relative(target, full).split(sep).join('/')
}

function walk(dir, depth, acc) {
  if (depth > MAX_DEPTH || truncated) return
  let items
  try {
    items = readdirSync(dir, { withFileTypes: true })
  } catch {
    return // un subdirectorio ilegible no invalida el resto del escaneo
  }
  for (const item of items) {
    if (entries++ > MAX_ENTRIES) { truncated = true; return }
    const full = join(dir, item.name)
    // `isDirectory()` sobre el Dirent (sin seguir symlinks a propósito: un
    // enlace a `/` convertiría el escaneo en un recorrido del disco entero).
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue
      acc.push(`${rel(full)}/`)
      // NO se desciende a un directorio de worktrees ajeno. Verificado contra
      // el repo real: `.claude/worktrees/` guarda CHECKOUTS ENTEROS, así que
      // descender duplicaba cada `scripts/dispatch-check.sh` una vez por
      // worktree vivo y esas copias desplazaban de la lista de evidencias al
      // fichero de verdad y a la línea de AGENTS.md — el aviso seguía siendo
      // correcto y era ilegible, que a efectos prácticos es lo mismo que
      // callarse. El directorio en sí ya queda registrado arriba, que es la
      // señal que importa.
      if (/^worktrees$/i.test(item.name)) continue
      walk(full, depth + 1, acc)
    } else if (item.isFile()) {
      acc.push(rel(full))
    }
  }
}

let files = []
try {
  const st = statSync(target)
  if (!st.isDirectory()) {
    console.error(`no es un directorio: ${target}`)
    process.exit(1)
  }
  walk(target, 0, files)
} catch (e) {
  console.error(`no se ha podido escanear ${target}: ${e.message}`)
  process.exit(1)
}

// Los documentos donde vive la instrucción que el agente despachado va a leer.
const DOC_NAMES = ['AGENTS.md', 'CLAUDE.md']
const docs = []
for (const name of DOC_NAMES) {
  try {
    docs.push({ path: name, content: readFileSync(join(target, name), 'utf8') })
  } catch {
    // No existe (o no se puede leer): no es una señal de nada.
  }
}

const findings = detectConventions({ docs, files })
const text = formatFindings(findings, { where: 'este repo' })
if (text) console.log(text)
if (truncated) {
  console.log(
    `  nota: el escaneo se cortó a los ${MAX_ENTRIES} ficheros (o ${MAX_DEPTH} niveles de profundidad), ` +
      'así que puede haber convenciones propias que no se hayan mirado. Ausencia de aviso aquí no es prueba de ausencia.'
  )
}
