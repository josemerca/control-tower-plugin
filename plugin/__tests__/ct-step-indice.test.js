// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { deliveredRun } from '../scripts/run-machine.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, veredicto, crudo, veredictoDeSlice, log, commits, estado,
  filasDeJuez, juzgar, juzgarSlice, tareaOk, sliceOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// Slice 12 — LA TERCERA VENTANA. Las dos igualdades del slice 11 miden el
// instante del veredicto; del veredicto ACEPTADO al `commit` quedaba un hueco en
// el que un `git add` metía código no revisado en el commit, con la fila de
// telemetría afirmando el review_token del código que sí se revisó. Ahora el
// veredicto aceptado SELLA el árbol del índice y `commit` exige encontrarlo igual.
describe('lo que se comitea es lo que se aprobó: el sello del índice', () => {
  it('EL ATAQUE: código re-stageado DESPUÉS del veredicto aceptado no entra en el commit', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    expect(juzgar(veredicto('PASS')).stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('commit')
    // LA TERCERA VENTANA: el veredicto ya está aceptado y su paquete consumido.
    writeFileSync(join(repo, 'uno.txt'), 'uno, cambiado DESPUÉS del veredicto aceptado\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/el índice ya no es el que el juez aprobó/)
    expect(commits()).toBe(1)                    // no se comitea NADA
    expect(estado().step).toBe('commit')         // el run no avanza ni retrocede
    expect(estado().task).toBe(1)
    // Y sigue sin haber fila de `commit`: este fallo no la estrena.
    expect(filasDeJuez('commit')).toHaveLength(0)
  })

  it('el mensaje trae el comando que devuelve el índice aprobado, y ese comando lo devuelve', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    writeFileSync(join(repo, 'uno.txt'), 'otra versión\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    // El sha del mensaje sin acotar la longitud a 40: un repo con
    // `extensions.objectFormat = sha256` da ids de 64, y el mecanismo es
    // indiferente (compara cadenas). Lo que se fija es que el mensaje lleve EL
    // sello, entero y sin truncar, porque hay que teclearlo.
    const m = /git read-tree ([0-9a-f]+)/.exec(ct('commit').stderr)
    expect(m).not.toBeNull()
    expect(m[1]).toBe(estado().sealedTree)
    execFileSync('git', ['read-tree', m[1]], { cwd: repo })
    expect(ct('commit').status).toBe(0)
    // Lo comiteado es lo que el juez leyó...
    expect(execFileSync('git', ['show', 'HEAD:uno.txt'], { cwd: repo, encoding: 'utf8' })).toBe('uno\n')
    // ...y el worktree conserva el trabajo que se colgó después: no se pierde.
    expect(readFileSync(join(repo, 'uno.txt'), 'utf8')).toBe('otra versión\n')
  })

  it('el sello es el árbol del ÍNDICE al aceptar el veredicto, con el artefacto de la maquinaria dentro', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    // Medido desde fuera: el sello es exactamente el árbol del índice de ahora.
    const arbol = execFileSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).trim()
    expect(estado().sealedTree).toBe(arbol)
    // Y el veredicto que viaja está DENTRO de ese árbol: sellar antes de su
    // `git add` haría fallar todos los commits.
    expect(execFileSync('git', ['ls-tree', '-r', '--name-only', arbol], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/docs\/superpowers\/verdicts\/issue-7-task-1\.json/)
    expect(ct('commit').status).toBe(0)
  })

  it('un veredicto FORJADO y stageado en el hueco no viaja en la pull request', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    const rutaV = join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json')
    writeFileSync(rutaV, JSON.stringify({ issue: 7, task: 1, verdict: { ruling: 'PASS', findings: ['FORJADO'] } }))
    execFileSync('git', ['add', '--', 'docs/superpowers/verdicts/issue-7-task-1.json'], { cwd: repo })
    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/el índice ya no es el que el juez aprobó/)
    expect(commits()).toBe(1)
  })

  it('el camino feliz no cambia: el veredicto SIGUE viajando dentro del commit de su tarea', () => {
    expect(tareaOk('uno.txt').status).toBe(0)
    const enElCommit = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(enElCommit).toMatch(/docs\/superpowers\/verdicts\/issue-7-task-1\.json/)   // criterio de cierre de F37
    expect(enElCommit).toMatch(/docs\/superpowers\/metrics\/issue-7\.jsonl/)
    expect(enElCommit).toMatch(/uno\.txt/)
    expect(estado().sealedTree).toMatch(/^[0-9a-f]{40,64}$/)   // sha1 o sha256: da igual
    // Y la segunda tarea también, con su artefacto nuevo y la telemetría ya trackeada.
    expect(tareaOk('dos.txt').status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-task-2.json'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/"ruling": "PASS"/)
  })

  it('EL GEMELO DEL SLICE: código stageado antes del veredicto de slice no entra en su commit', () => {
    tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global')
    writeFileSync(join(repo, 'colado.txt'), 'nadie ha visto esto\n')
    execFileSync('git', ['add', 'colado.txt'], { cwd: repo })
    const r = juzgarSlice(veredictoDeSlice('PASS'))
    expect(r.status).toBe(0)                      // el veredicto es válido: entrega
    expect(estado().closed).toBe('delivered')
    expect(r.stderr).toMatch(/ajenas a la maquinaria \(colado\.txt\)/)
    expect(commits()).toBe(3)                     // base + 2 tareas: NINGÚN commit de veredicto
    expect(log()).not.toMatch(/Veredicto del slice entero/)
    expect(execFileSync('git', ['log', '--oneline', '--', 'colado.txt'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('')
    expect(estado().sliceCommits ?? 0).toBe(0)    // el commit que no ocurrió no se cuenta
    // La evidencia se queda STAGEADA: sacar lo ajeno y comitearla es una línea.
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/docs\/superpowers\/verdicts\/issue-7-slice\.json/)
  })

  it('un run sin sello en el estado no comitea: la ausencia no es un modo sin barandilla', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    // El run de una versión anterior del plugin: el campo no está. Se simula
    // BORRÁNDOLO, que es también el atajo que un conductor con Bash tendría.
    const s = estado(); delete s.sealedTree
    writeFileSync(join(repo, '.agent', 'run-7.json'), JSON.stringify(s, null, 2) + '\n')
    const r = ct('commit')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/no trae el sello del índice/)
    expect(commits()).toBe(1)
  })
})

describe('el sitio en el que va está en disco, no en la conversación', () => {
  it('el estado sobrevive entre invocaciones: cada verbo es un proceso nuevo', () => {
    ct('report', informe(['uno.txt']))
    expect(estado().step).toBe('controls')
    ct('controls')
    expect(estado().step).toBe('judge')
  })

  it('si el estado y git no cuentan lo mismo, para en vez de seguir', () => {
    tareaOk('uno.txt')
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'a mano'], { cwd: repo })
    const r = ct('next')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/no cuentan lo mismo/)
  })

  it('escribe telemetría con el epic sembrado en todas sus filas', () => {
    // La SECUENCIA de pasos la fija el test del Paso 6, al final del fichero:
    // ahí se retiró la fila de `commit` y ese es el sitio donde consta el motivo.
    tareaOk('uno.txt')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.length).toBeGreaterThan(0)
    expect(filas.every((f) => f.epic === '12')).toBe(true)
  })

  it('la fila de implement lleva el resumen del informe: es el único canal por el que se cuenta', () => {
    // El resumen muere en el estado si nadie lo lee (run.lastSummary no lo
    // consulta ningún otro verbo): la telemetría es lo único que lo saca.
    ct('report', informe(['uno.txt']))
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas[0].step).toBe('implement')
    expect(filas[0].summary).toBe('hecho')
  })

  it('un informe descartado no tiene resumen que contar', () => {
    ct('report', crudo(JSON.stringify({ paths: ['/etc/passwd'], summary: 'ups' })))
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas[0].outcome).toBe('discarded')
    expect(filas[0].summary).toBeNull()
  })
})

// Review de capde (2026-08-19), punto 2: el índice acumulaba entre intentos y
// el control de alcance miraba la lista del informe, no lo que de verdad se
// comitea. Las dos mitades del arreglo, cada una con su test.
describe('el índice no acumula entre intentos', () => {
  it('la ruta fuera de alcance del intento 1 NO viaja en el commit del intento 2', () => {
    // Intento 1: el implementador toca de más; se stagea y el control lo caza.
    ct('report', informe(['uno.txt', 'dos.txt']))
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    // Intento 2: reporta solo lo legítimo. El reset de `report` vacía el
    // índice, así que el dos.txt del intento 1 no queda stageado a escondidas.
    ct('report', informe(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: done/)
    juzgar(veredicto('PASS'))
    expect(ct('commit').status).toBe(0)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/uno\.txt/)
    expect(files).not.toMatch(/dos\.txt/)
  })

  it('el alcance mide el ÍNDICE, no la lista del informe: lo stageado sin declarar es rojo', () => {
    ct('report', informe(['uno.txt']))
    // Algo stagea dos.txt por fuera del informe — da igual quién.
    execFileSync('git', ['add', 'dos.txt'], { cwd: repo })
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    const registro = readFileSync(join(repo, '.agent', 'run-7', 'task-1-controls-1.log'), 'utf8')
    expect(registro).toMatch(/dos\.txt.*no la declara/)
  })
})

// Review de capde (2026-08-19), punto 1: un prompt no es un gate. La mitad
// ct-step: el cierre bueno se persiste y deliveredRun (que lee el gate de
// dispatch-check --release) lo acepta o explica por qué no.
describe('el cierre bueno se persiste, y el gate del release lo lee', () => {
  it('run delivered → closed: "delivered" en el fichero, y deliveredRun lo acepta', () => {
    sliceOk()
    expect(estado().closed).toBe('delivered')
    expect(deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)).toEqual({ ok: true })
  })

  it('sobre un run entregado, next dice "ya está" y los verbos que transicionan salen por 9', () => {
    sliceOk()
    const n = ct('next')
    expect(n.status).toBe(0)
    expect(n.stdout).toMatch(/run delivered/)
    expect(ct('report', informe(['uno.txt'])).status).toBe(9)
  })

  it('deliveredRun rechaza el run ausente, el de otro issue y el no entregado', () => {
    expect(deliveredRun(null, 7).ok).toBe(false)
    expect(deliveredRun(JSON.stringify({ issue: 8, closed: 'delivered' }), 7).ok).toBe(false)
    expect(deliveredRun('esto no es json', 7).ok).toBe(false)
    tareaOk('uno.txt') // 1 de 2: el run va bien pero NO está entregado
    const parcial = deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)
    expect(parcial.ok).toBe(false)
    expect(parcial.why).toMatch(/no está entregado/)
  })

  it('las dos tareas comiteadas SIN global ni juicio de slice tampoco es entregado', () => {
    // §3.7: "delivered" pasa a significar tareas + punta a punta verde +
    // slice juzgado. Este es el caso que antes cerraba y ya no.
    tareaOk('uno.txt')
    tareaOk('dos.txt')
    const parcial = deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)
    expect(parcial.ok).toBe(false)
  })
})
