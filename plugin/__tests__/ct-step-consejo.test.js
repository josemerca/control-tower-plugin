// H9 — el paso `advise`, entre el SEGUNDO veto y el TERCER intento. El
// preámbulo —y por qué son varios ficheros y no uno— está en
// fixtures/ct-step-harness.js.
//
// Lo que este fichero mide es el patrón advisor-strategy tal y como el loop lo
// aplica: que el segundo fallo sobre el mismo problema ESCALE a un consejero de
// tier superior en vez de repetir a ciegas el mismo intento, que su respuesta se
// valide contra un esquema, y que un consejo ilegible no le cueste a la tarea el
// intento que le queda.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo } from './fixtures/ct-step-harness.js'
import { ADVISOR_TOOLS, ADVICE_PACKAGE_SECTIONS } from '../scripts/step-contracts.js'

let repo
const { ct, informe, veredicto, crudo, estado, juzgar, filasDeJuez } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

const HALLAZGO = { severity: 'high', what: 'la lógica está en el sitio que no es', path: 'uno.txt', line: 1 }

// Un intento entero que acaba en veto, con lo que el implementador dijo de él:
// es lo que el paquete del consejero tiene que poder enseñar después.
const intentoVetado = (dice) => {
  ct('next')
  ct('report', informe(['uno.txt'], 'report.json', dice))
  ct('controls')
  return juzgar(veredicto('FAIL', [HALLAZGO]))
}

const dosVetos = () => {
  intentoVetado('lo puse en el módulo viejo')
  intentoVetado('lo volví a poner en el módulo viejo')
}

const consejo = (over = {}, nombre = 'advice.json') => {
  const p = join(repo, nombre)
  const cuerpo = { approach: 'saca la decisión a un tipo propio y prueba por ahí', files_to_reconsider: ['uno.txt'], ...over }
  for (const [k, v] of Object.entries(cuerpo)) if (v === undefined) delete cuerpo[k]
  writeFileSync(p, JSON.stringify(cuerpo))
  return p
}

const paqueteDeConsejo = () => join(repo, '.agent', 'run-7', `task-${estado().task}-advice.md`)

// `next` es el único verbo que escribe el paquete del consejero, igual que con
// el juez: pedir el consejo es, por definición, haber preguntado antes.
const aconsejar = (...args) => { ct('next'); return ct('advice', ...args) }

describe('el segundo veto no vuelve a implementar a ciegas', () => {
  it('tras dos vetos el paso es advise, y next manda despachar al consejero y no a un implementador', () => {
    dosVetos()

    expect(estado().step).toBe('advise')
    const r = ct('next')
    expect(r.stdout).toMatch(/DESPACHA EL CONSEJERO/)
    expect(r.stdout).toContain('ct-advisor')
    expect(r.stdout).toContain(ADVISOR_TOOLS)
    expect(r.stdout).not.toMatch(/DESPACHA UN IMPLEMENTADOR/)
  })

  it('el intento sigue siendo el tercero: advise no estrena contador propio', () => {
    dosVetos()

    expect(estado().judgeRetries).toBe(2)
    expect(ct('next').stdout).toMatch(/paso: advise \(intento 3\)/)
  })

  it('el paquete del consejero trae el brief, los dos intentos y los dos veredictos', () => {
    dosVetos()

    ct('next')
    const paquete = readFileSync(paqueteDeConsejo(), 'utf8')
    for (const seccion of ADVICE_PACKAGE_SECTIONS) expect(paquete).toContain(`## ${seccion}`)
    expect(paquete).toContain('lo puse en el módulo viejo')
    expect(paquete).toContain('lo volví a poner en el módulo viejo')
    expect(paquete).toContain('la lógica está en el sitio que no es')
    // El brief de la tarea, del que salieron los dos intentos.
    expect(paquete).toContain('la primera')
  })

  it('pedir el consejo fuera de su paso se rechaza por 9, como cualquier otro verbo', () => {
    const r = ct('advice', consejo())

    expect(r.status).toBe(9)
    expect(r.stderr).toMatch(/no es el paso que toca/)
  })
})

describe('el consejo que no cumple el esquema no gasta el intento que queda', () => {
  it('un consejo sin approach se descarta, cuenta como descarte y NO como reintento', () => {
    dosVetos()

    const r = aconsejar(consejo({ approach: undefined }))

    expect(r.stdout).toMatch(/consejo descartado/)
    expect(estado().step).toBe('advise')
    expect(estado().discards).toBe(1)
    expect(estado().judgeRetries).toBe(2)
  })

  it('un JSON que no parsea también es un descarte y se vuelve a preguntar', () => {
    dosVetos()

    aconsejar(crudo('esto no es json'))

    expect(estado().step).toBe('advise')
    expect(estado().discards).toBe(1)
  })

  it('un consejo emitido sin paquete no es un consejo: el consejero aconsejó a ciegas', () => {
    dosVetos()
    ct('next')
    rmSync(paqueteDeConsejo())

    const r = ct('advice', consejo())

    expect(r.stdout).toMatch(/consejo descartado/)
    expect(estado().discards).toBe(1)
  })

  it('descartar sin parar se corta con 3 en vez de seguir preguntando', () => {
    dosVetos()
    let r
    for (let i = 0; i < 7; i++) r = aconsejar(crudo('nada'))

    expect(r.status).toBe(3)
  })
})

describe('el consejo aceptado abre el tercer intento', () => {
  it('done → implement, con el consejo guardado en el estado', () => {
    dosVetos()

    const r = aconsejar(consejo())

    expect(r.status).toBe(0)
    expect(estado().step).toBe('implement')
    expect(estado().lastAdvice.approach).toMatch(/saca la decisión a un tipo propio/)
  })

  it('el tercer veto ya no consulta a nadie: cierra en blocked-judge por 1', () => {
    dosVetos()
    aconsejar(consejo())

    const r = intentoVetado('lo intenté por el camino que dijo el consejero')

    expect(r.status).toBe(1)
    expect(estado().step).toBe('judge')
  })
})

// AC 2 y 3 del issue: el tercer intento no arranca encima de los dos anteriores,
// y no arranca sin el consejo.
describe('el tercer intento arranca con el árbol limpio y con el consejo delante', () => {
  // Lo que se mira es el estado de las rutas DE LA TAREA: el fichero del run,
  // su carpeta y la maquinaria siguen sin trackear a propósito, y contarlos aquí
  // mediría el andamio en vez del árbol que el tercer intento hereda.
  const estadoDeGit = (...rutas) =>
    execFileSync('git', ['status', '--porcelain', '--', ...rutas], { cwd: repo, encoding: 'utf8' })

  it('el árbol vuelve al último commit para las rutas de la tarea', () => {
    dosVetos()
    writeFileSync(join(repo, 'uno.txt'), 'lo que dejó el segundo intento')
    writeFileSync(join(repo, 'sobra.txt'), 'un fichero que el segundo intento se inventó')

    aconsejar(consejo())

    expect(estadoDeGit('uno.txt', 'sobra.txt')).toBe('')
    expect(existsSync(join(repo, 'sobra.txt'))).toBe(false)
  })

  it('lo que limpia son las rutas de la tarea: el fichero del run y su carpeta siguen ahí', () => {
    dosVetos()
    writeFileSync(join(repo, 'uno.txt'), 'lo que dejó el segundo intento')

    aconsejar(consejo())

    expect(existsSync(join(repo, '.agent', 'run-7.json'))).toBe(true)
    expect(existsSync(paqueteDeConsejo())).toBe(true)
    expect(estado().step).toBe('implement')
  })

  it('el brief del tercer intento lleva dentro el enfoque del consejero', () => {
    dosVetos()
    aconsejar(consejo())

    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).toContain('saca la decisión a un tipo propio')
    expect(brief).toContain('uno.txt')
  })

  it('el consejo no se hereda: la tarea siguiente estrena brief sin él', () => {
    dosVetos()
    aconsejar(consejo())
    ct('next')
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    ct('commit')

    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-2-brief.md'), 'utf8')
    expect(brief).not.toContain('saca la decisión a un tipo propio')
  })
})

describe('lo que el consejo deja medido', () => {
  it('la fila del paso advise dice cuánto pesó el consejo y en qué acabó', () => {
    dosVetos()
    aconsejar(consejo())

    const [fila] = filasDeJuez('advise')
    expect(fila.outcome).toBe('done')
    expect(fila.advice_bytes).toBeGreaterThan(0)
    expect(fila.task).toBe(1)
    expect(fila.attempt).toBe(3)
    // El material del papel, como en cualquier otro paso que despacha a alguien.
    expect(fila.agent_bytes).toBeGreaterThan(0)
    expect(fila.package_bytes).toBeGreaterThan(0)
  })

  it('el consejo descartado también deja fila, con el porqué y sin afirmar un tamaño que no midió', () => {
    dosVetos()
    aconsejar(crudo('nada'))

    const [fila] = filasDeJuez('advise')
    expect(fila.outcome).toBe('discarded')
    expect(fila.why).toMatch(/no se pudo leer/)
  })
})

describe('el consejero no puede quedarse sin lo que se le prometió', () => {
  it('el sello del despacho cubre advise: sin pasar por next, el guard lo deniega', () => {
    dosVetos()

    ct('next')
    expect(estado().nextSeal).toBe('1:advise:3')
  })

  it('el paquete sobrevive a un descarte: no hay que regenerarlo para volver a preguntar', () => {
    dosVetos()
    ct('next')
    ct('advice', crudo('nada'))

    expect(existsSync(paqueteDeConsejo())).toBe(true)
  })
})
