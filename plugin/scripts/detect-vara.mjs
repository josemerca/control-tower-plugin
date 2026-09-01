#!/usr/bin/env node
// Envoltorio de IO de scripts/vara.js: barre el repo destino y escribe por
// stdout los candidatos a su vara (`.agent/conventions.md`), si los hay.
// Lo llama ct-init.sh, que lo imprime SIN redirigir a stderr — a diferencia de
// su hermano `detect-conventions.mjs`.
//
// TRAMPA DE NOMBRE, documentada a propósito: este fichero NO es
// `detect-conventions.mjs`. Ese otro barre COLISIONES DE PROTOCOLO entre el
// loop y el repo destino (claim, worktrees, fichero de estado) y su salida es
// una alarma (va a stderr). Este barre CANDIDATOS A LA VARA DE CÓDIGO del
// repo (§3.12, docs/prompt-juez-lo-que-queda.md) y su salida es material para
// una decisión humana (va a stdout). Confundirlos por el nombre sería la
// tercera trampa — la primera y la segunda son `scripts/conventions.js` y
// `conventions-io.js`, que tampoco son esto.
//
// Contrato de salida, deliberadamente pobre, calcado del hermano:
//   exit 0  → barrido completado. stdout vacío = nada que proponer (o bien no
//             hay ningún candidato, o bien todos los que hay ya están
//             declarados — los dos son estados benignos); stdout con texto =
//             los candidatos, ya formateados.
//   exit 1  → NO se ha podido barrer (uso incorrecto, directorio ilegible).
//             stderr explica por qué. El caller NUNCA debe leer esto como
//             "este repo no tiene convenciones": no se ha mirado.
//
// Este script NUNCA escribe en `.agent/conventions.md`. Sólo lee (el árbol y,
// si existe, la propia declaración) y propone.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { walkRepo } from './repo-walk.js'
import {
  CONVENTIONS_FILE,
  candidatosDeVara,
  declaradasEn,
  pareceEsqueleto,
  formatCandidatos,
} from './vara.js'

const target = process.argv[2]
if (!target) {
  console.error('uso: detect-vara.mjs <dir-repo>')
  process.exit(1)
}

let entradas = []
let truncated = false
try {
  const st = statSync(target)
  if (!st.isDirectory()) {
    console.error(`no es un directorio: ${target}`)
    process.exit(1)
  }
  const r = walkRepo(target)
  entradas = r.entradas
  truncated = r.truncated
} catch (e) {
  console.error(`no se ha podido barrer ${target}: ${e.message}`)
  process.exit(1)
}

// Si `.agent/conventions.md` no existe todavía (ENOENT), no hay nada
// declarado: se propone todo. Si existe y no se puede LEER (permisos), no es
// lo mismo — se dice, para que el humano sepa que la lista de abajo puede
// repetir algo que ya está declarado.
let declaradas = new Set()
let notaLectura = ''
try {
  declaradas = declaradasEn(readFileSync(join(target, CONVENTIONS_FILE), 'utf8'))
} catch (e) {
  if (e.code !== 'ENOENT') {
    notaLectura =
      `  nota: ${CONVENTIONS_FILE} existe y no se ha podido leer (${String(e.message).trim()}): ` +
      'puede que alguno de los candidatos de abajo ya esté declarado.'
  }
}

const { candidatos, omitidos } = candidatosDeVara({ entradas, declaradas })
for (const c of candidatos) {
  try {
    c.esqueleto = pareceEsqueleto(readFileSync(join(target, c.ruta), 'utf8'))
  } catch {
    c.esqueleto = false
  }
}

const texto = formatCandidatos(candidatos, { omitidos, truncated })
if (texto) console.log(texto)
if (notaLectura && texto) console.log(notaLectura)
