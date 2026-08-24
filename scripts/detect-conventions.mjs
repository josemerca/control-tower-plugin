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
import { statSync } from 'node:fs'
import { detectConventions, formatFindings, ACK_PATH } from './conventions.js'
import { readRepoDocs, readAck, MAX_LINKED_DOCS } from './conventions-io.js'
// El recorrido del árbol vivía aquí y se extrajo a `repo-walk.js`: lo
// comparte con `detect-vara.mjs` (§3.12 del handoff, candidatos a la vara del
// repo) para que las cotas y las exclusiones de los dos barridos no puedan
// divergir en silencio. Ver la cabecera de ese fichero para el porqué de cada
// regla; nada de lo que sigue cambia una letra de comportamiento.
import { walkRepo, MAX_DEPTH, MAX_ENTRIES } from './repo-walk.js'

const target = process.argv[2]
if (!target) {
  console.error('uso: detect-conventions.mjs <dir-repo>')
  process.exit(1)
}

let files = []
let truncated = false
try {
  const st = statSync(target)
  if (!st.isDirectory()) {
    console.error(`no es un directorio: ${target}`)
    process.exit(1)
  }
  const r = walkRepo(target)
  files = r.entradas
  truncated = r.truncated
} catch (e) {
  console.error(`no se ha podido escanear ${target}: ${e.message}`)
  process.exit(1)
}

// Los documentos donde vive la instrucción que el agente despachado va a leer:
// AGENTS.md, CLAUDE.md y —a UN salto— los `.md` del repo que ellos citan. F14:
// escanear solo los dos raíz dejaba viva la orden vieja en el documento que las
// dos guías llamaban "referencia completa", o sea a un clic del agente.
const { docs, failures, truncated: linksTruncated } = readRepoDocs(target)
const { acks, problems: ackProblems, unreadable: ackUnreadable, prosaSinAcuses: ackProsaSinAcuses } = readAck(target)

const findings = detectConventions({ docs, files, acks })
const text = formatFindings(findings, { where: 'este repo', ackProblems, ackUnreadable, ackProsaSinAcuses })
if (text) console.log(text)
for (const f of failures) {
  console.log(`  aviso: no se ha podido leer la documentación del repo (${f}). NO lo leas como "ahí no hay nada": no se ha mirado.`)
}
// Higiene del acuse, y solo aquí: /ct-init hace el escaneo COMPLETO (las tres
// señales), así que es el único momento en que "esta línea ya no silencia nada"
// es una afirmación honesta. Sin esto el fichero de acuse se convierte en un
// agujero permanente: alguien acusa `estado` en julio, en septiembre resuelve el
// fichero de estado, y la línea sigue ahí tapando cualquier estado ajeno futuro.
for (const [id, ack] of acks) {
  if (findings.some((f) => f.id === id)) continue
  console.log(
    `  nota: ${ACK_PATH}:${ack.line} acusa \`${id}\` pero ya no hay ninguna señal de ese tipo en este repo. ` +
      'Bórrala: mientras esté, silencia por adelantado cualquier convención de ese tipo que aparezca mañana.'
  )
}
if (linksTruncated) {
  console.log(
    `  nota: AGENTS.md/CLAUDE.md citan más de ${MAX_LINKED_DOCS} documentos \`.md\` del repo y solo se han ` +
      'mirado los primeros. Puede quedar una instrucción vieja en los que no se han leído.'
  )
}
if (truncated) {
  console.log(
    `  nota: el escaneo se cortó a los ${MAX_ENTRIES} ficheros (o ${MAX_DEPTH} niveles de profundidad), ` +
      'así que puede haber convenciones propias que no se hayan mirado. Ausencia de aviso aquí no es prueba de ausencia.'
  )
}
