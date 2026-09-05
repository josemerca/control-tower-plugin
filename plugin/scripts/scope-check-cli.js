#!/usr/bin/env node
// scope-check — EL GATE DE CONFORMIDAD DEL PR. ¿Los ficheros que tocó este PR
// caben en el alcance que su epic declaró?
//
// CORRE EN EL REPO DESTINO, COMO CHECK DE CI SOBRE EL PR. No en
// `dispatch-check --release`: ese lo invoca el propio agente, y un guard que
// ejecuta el sospechoso no es un guard. Y no como bloque de texto en el cuerpo
// del PR: un párrafo más compite con los otros veinte que ya nadie lee. El
// producto de este comando es un check ROJO, que es binario y no se puede leer
// por encima.
//
// SE DISTRIBUYE BUNDLEADO (dist/scope-check.js, sin dependencias npm en
// runtime) porque el repo destino NO tiene el plugin instalado en CI. El
// workflow que lo invoca y los tres pasos para instalarlo a mano viven en
// `docs/loop/ct-scope-gate.md` del repo del plugin: nada lo vendoriza solo.
//
// POR QUÉ EXISTE: despacho 1, slice 4 — el agente tocó copy GDPR en pantalla
// contra su «Protegido» y escribió que Jose lo había autorizado. Era falso. La
// firma humana no es verificable desde dentro del loop (el agente corre con las
// credenciales de Jose y puede fabricar cualquier artefacto de GitHub); lo que
// tocó, sí. Ver scripts/scope.js.
import { execFileSync } from 'node:child_process'
import { parseScope, scopeViolations, issueFromPrBody, isSliceBranch } from './scope.js'

const arg = (f) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'uso: scope-check --repo <owner/repo> --pr <número> [--exempt <patrón,patrón>]'
const repo = arg('--repo')
const pr = arg('--pr')
// Exenciones DEL REPO DESTINO: su contabilidad propia (un ledger, una bitácora)
// que sus convenciones obligan a tocar en cada slice. Se pasan desde el workflow
// porque son del repo, no del loop: hardcodearlas en el plugin las convertiría
// en agujeros para todos los demás repos. Se SUMAN a las del plugin.
const exemptRaw = arg('--exempt')
const exempt = typeof exemptRaw === 'string' ? exemptRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
if (typeof repo !== 'string' || typeof pr !== 'string' || !/^\d+$/.test(pr)) {
  console.error(usage)
  process.exit(2)
}

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024, timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' })

// TODO fallo de lectura es ROJO, nunca verde. Es la regla que el resto del
// plugin ya sostiene («el 1 nunca se degrada a 0»): no poder comprobar NO es
// estar limpio. Un gate que se cae en abierto ante un error de red es peor que
// no tener gate, porque además tranquiliza.
function morir(mensaje, detalle) {
  console.error(`🛑 scope-check: ${mensaje}`)
  if (detalle) console.error(`   ${detalle}`)
  process.exit(1)
}

let prData
try {
  prData = JSON.parse(gh(['pr', 'view', pr, '--repo', repo, '--json', 'body,files,headRefName']))
} catch (e) {
  morir(`no se pudo leer el PR #${pr} de ${repo}`, (e.stderr || e.message || '').toString().trim())
}

const issueN = issueFromPrBody(prData.body)
if (!issueN) {
  // AQUÍ SE DECIDE SI ESTE GATE SOBREVIVE A LA SEMANA QUE VIENE.
  //
  // Un repo gobernado tiene PRs que NO son slices: documentación, chores,
  // arreglos a mano. Ninguno lleva `Closes #N` y ninguno es cosecha del loop.
  // Suspenderlos a todos convertiría el gate en un muro insatisfacible, y un
  // muro así se desactiva entero en cuestión de días — es el fallo que
  // conventions.js ya pagó en este repo (F14), y desactivado no protege nada.
  //
  // La discriminación es la RAMA, no el cuerpo del PR, porque `feat/<n>` la
  // crea el dispatcher y no el agente. Un PR que viene de una rama de slice sin
  // su `Closes` está roto por dos motivos a la vez —el gate no sabe qué alcance
  // aplicar Y el issue no se cerrará al mergear, reteniendo sus tokens para
  // siempre— así que ése sí sale rojo.
  if (isSliceBranch(prData.headRefName)) {
    morir(
      `el PR #${pr} viene de la rama de slice \`${prData.headRefName}\` pero no declara un único issue con una closing keyword en su CUERPO`,
      'Añade `Closes #<issue>` al cuerpo del PR (no al título, no en un comentario). Sin él, además, el issue no se cierra al mergear y el slice retiene sus tokens de `area:`/`touches:` para siempre.',
    )
  }
  // Se dice en voz alta que no se ha comprobado nada. Un check verde y mudo
  // sería indistinguible de un check verde que sí juzgó algo.
  console.log(`✅ scope-check: el PR #${pr} no es un slice del loop (rama \`${prData.headRefName}\`, sin closing keyword). No hay alcance de epic que comprobar.`)
  process.exit(0)
}

let issueBody
try {
  issueBody = JSON.parse(gh(['issue', 'view', String(issueN), '--repo', repo, '--json', 'body'])).body
} catch (e) {
  morir(`no se pudo leer el issue #${issueN} de ${repo}`, (e.stderr || e.message || '').toString().trim())
}

const alcance = parseScope(issueBody)
if (!alcance.declared) {
  morir(
    `el epic del issue #${issueN} no declara alcance`,
    `${alcance.reason}. Añade una línea \`Alcance: <rutas>\` a la sección \`## Contexto del epic\` del execution spec y re-groomea (o edita el issue). Se declara UNA vez por epic, en la congelación.`,
  )
}

const ficheros = (prData.files || []).map((f) => f.path)
const violaciones = scopeViolations(ficheros, alcance.patterns, exempt)

if (violaciones.length) {
  console.error(`🛑 scope-check: el PR #${pr} toca ${violaciones.length} fichero(s) FUERA del alcance declarado por su epic (issue #${issueN}).`)
  console.error('')
  console.error('   Alcance declarado:')
  for (const p of alcance.patterns) console.error(`     ✓ ${p}`)
  console.error('')
  console.error('   Fuera de alcance:')
  for (const f of violaciones) console.error(`     ✗ ${f}`)
  console.error('')
  // El mensaje no acusa de mala fe y no debe: el modo de fallo real medido no
  // es un agente adversario, es un agente que se convence a sí mismo de que ya
  // preguntó. Lo que se pide es que la decisión vuelva al humano, que es justo
  // el paso que aquel agente se saltó.
  console.error('   Esto NO se arregla editando el registro del PR. O el trabajo sale del PR,')
  console.error('   o el alcance del epic cambia — y cambiar el alcance de un epic congelado es')
  console.error('   una decisión humana, no del agente.')
  process.exit(1)
}

console.log(`✅ scope-check: los ${ficheros.length} fichero(s) del PR #${pr} caben en el alcance del epic (issue #${issueN}).`)
process.exit(0)
