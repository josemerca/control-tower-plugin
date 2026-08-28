// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, veredicto, crudo, veredictoDeSlice, commits, estado, juzgar, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('el veto no deja rastro que deshacer', () => {
  const veta = () => juzgar(veredicto('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))

  it('tres vetos agotan el presupuesto, salen por 1 y NO comitean', () => {
    for (let i = 0; i < 3; i++) {
      ct('report', informe(['uno.txt']))
      ct('controls')
      var r = veta()
    }
    expect(r.status).toBe(1)
    expect(commits()).toBe(1)
  })

  it('un PASS con hallazgos medios corrige y luego entrega igual', () => {
    const queja = () => juzgar(veredicto('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'uno.txt', line: 1 }]))
    for (let i = 0; i < 3; i++) {
      ct('report', informe(['uno.txt']))
      ct('controls')
      queja()
    }
    expect(estado().step).toBe('commit')     // agotado el presupuesto: entrega
    expect(ct('commit').status).toBe(0)
    expect(commits()).toBe(2)
  })
})

describe('el veredicto que no se puede leer no es un veredicto', () => {
  const preparar = () => { ct('report', informe(['uno.txt'])); ct('controls') }

  it('un JSON que no parsea es un DESCARTE, no un error de uso', () => {
    preparar()
    const r = juzgar(crudo('esto no es json'))
    expect(r.stdout).toMatch(/veredicto descartado/)
    expect(estado().discards).toBe(1)
    expect(estado().step).toBe('judge')      // se le vuelve a preguntar
  })

  it('un ruling inventado se descarta', () => {
    preparar()
    expect(juzgar(veredicto('QUIZÁS')).stdout).toMatch(/ruling desconocido/)
  })

  it('un PASS con hallazgo grave se descarta: se contradice a sí mismo', () => {
    preparar()
    const r = juzgar(veredicto('PASS', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(r.stdout).toMatch(/contradice la rúbrica/)
  })

  it('descartar sin parar se corta con 3 en vez de seguir preguntando', () => {
    preparar()
    let r
    for (let i = 0; i < 7; i++) r = juzgar(crudo('nada'))
    expect(r.status).toBe(3)
    expect(r.stderr).toMatch(/descartes en este run/)
  })
})

// Slice 3 de los apuntes de Capde. En una corrida real un agente encadenó
// report→controls→verdict sin volver a pasar por `next`, que es el ÚNICO paso
// que genera el paquete que el juez juzga: el juez juzgó a ciegas y su PASS
// sólo no entró porque él mismo declaró que no encontraba el paquete. Sin esa
// confesión, el PASS entraba y la fila de telemetría quedaba apuntando a un
// fichero inexistente. Un paso que exige un insumo y no comprueba que llegó
// delega su garantía en la honestidad del agente.
describe('un veredicto emitido sin paquete de revisión no es un veredicto', () => {
  it('verdict sin el .diff en disco descarta, no avanza el paso, y lo mide como discarded', () => {
    // El modo de fallo exacto, sin trucos: se llega a `verdict` SIN pasar por
    // `next`. No se borra nada — el fichero no existe porque nadie lo generó.
    ct('report', informe(['uno.txt']))
    ct('controls')
    expect(existsSync(join(repo, '.agent', 'run-7', 'task-1-review.diff'))).toBe(false)

    const r = ct('verdict', veredicto('PASS'))
    expect(r.status).toBe(0)                 // descarte, no cierre: se vuelve a preguntar
    expect(r.stdout).toMatch(/veredicto descartado: el paquete de revisión no existe/)
    expect(r.stdout).toContain('el juez juzgó a ciegas')
    expect(r.stdout).toContain('vuelve a "ct-step next"')
    expect(estado().step).toBe('judge')      // NO avanza el paso
    expect(estado().discards).toBe(1)        // y cuenta para MAX_DISCARDS
    expect(commits()).toBe(1)                // el PASS a ciegas no comitea nada
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)

    // RESERVA 3 de la revisión: la FILA del descarte, no sólo el descarte. La
    // telemetría es la capa que dejó ver el hueco (una fila de juez nombrando
    // un .diff inexistente), así que es la que tiene que fijarlo.
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const juez = filas.filter((f) => f.step === 'judge')
    expect(juez).toHaveLength(1)
    expect(juez[0].outcome).toBe('discarded')
    expect(juez[0].why).toMatch(/paquete de revisión no existe/)
    // Un descarte NO es un veredicto: sin `ruling`, aggregateVerdictMeasures no
    // lo cuenta como tal (run-metrics.js), y sin `review_package` la fila no
    // afirma un fichero que no existe.
    expect(juez[0].ruling).toBeUndefined()
    expect(juez[0].review_package).toBeUndefined()
  })

  it('slice-verdict sin el slice-review.diff en disco descarta, no avanza el paso, y lo mide como discarded', () => {
    // Las dos tareas comiteadas y la Global verification en verde, pero sin
    // volver a `next`: `escribirPaqueteDeSlice` no ha corrido nunca.
    tareaOk('uno.txt')
    tareaOk('dos.txt')
    ct('global')
    expect(existsSync(join(repo, '.agent', 'run-7', 'slice-review.diff'))).toBe(false)

    const r = ct('slice-verdict', veredictoDeSlice('PASS'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto de slice descartado: el paquete de revisión del slice no existe/)
    expect(r.stdout).toContain('vuelve a "ct-step next"')
    expect(estado().step).toBe('slice-judge')
    expect(estado().discards).toBe(1)
    expect(estado().closed ?? null).toBeNull()   // un run no ENTREGA a ciegas
    expect(commits()).toBe(3)                    // 1 base + 2 tareas: ningún commit de veredicto
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'))).toBe(false)

    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const juez = filas.filter((f) => f.step === 'slice-judge')
    expect(juez).toHaveLength(1)
    expect(juez[0].outcome).toBe('discarded')
    expect(juez[0].why).toMatch(/paquete de revisión del slice no existe/)
    expect(juez[0].ruling).toBeUndefined()
  })
})
