// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, recorridoDeSlice, PLUGIN_ROOT_TEST } from './fixtures/ct-step-harness.js'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

let repo
const { ct, informe, veredicto, crudo, veredictoDeSlice, commits, estado,
  paqueteDeTarea, paqueteDeSlice, filasDeJuez, tokenDelPaquete, sellar, juzgar,
  juzgarSlice, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// El juez tiene `Read` (JUDGE_TOOLS), así que la vara de ct le llega por RUTA
// y no pegada: es el mismo criterio con el que ya le llegan el plan y los
// ficheros que el diff toca. Lo que la ruta compra sobre el texto es que el
// juez abra sólo lo que va a citar, en vez de leer 24 KB delante del diff.
describe('el paquete de revisión da la vara de ct por ruta, no pegada', () => {
  const paquete = () => readFileSync(paqueteDeTarea(), 'utf8')

  it('la sección abre el paquete y lista la ruta de cada documento que alcanza a la tarea', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const texto = paquete()
    expect(texto).toContain('## Vara de ct')
    for (const nombre of PluginYardstick.FILES) {
      expect(texto, `${nombre} no llega ni por ruta`).toContain(join(PLUGIN_ROOT_TEST, 'conventions', nombre))
    }
    expect(texto.indexOf('## Vara de ct')).toBeLessThan(texto.indexOf('## Diff'))
  })

  it('no pega el texto de ningún documento', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const style = readFileSync(join(PLUGIN_ROOT_TEST, 'conventions', 'style.md'), 'utf8')
    expect(paquete()).not.toContain(style.trim())
  })

  // Sin `(create)` en sus **Files:** — aquí sin acción declarada, que es lo
  // que este fixture puede escribir sin que el control de alcance vete la
  // tarea: el fichero se crea de verdad, así que declararlo `(modify)` sería
  // un plan que miente.
  it('la tarea que no estrena módulo tampoco recibe la ruta de architecture.md', () => {
    const plan = readFileSync(join(repo, 'plan.md'), 'utf8').replace('`uno.txt` (create)', '`uno.txt`')
    writeFileSync(join(repo, 'plan.md'), plan)
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    expect(paquete()).not.toContain(join(PLUGIN_ROOT_TEST, 'conventions', 'architecture.md'))
  })
})

// Slice 6 de los apuntes de Capde — el hallazgo ALTO del review de la PR #36,
// reproducido con un ataque real. La guarda del slice 3 cubría el intento 1 y
// dejaba abierto el 2: con el `.diff` del intento 1 todavía en disco, un PASS
// emitido sobre el diff VIEJO entraba, y la fila de telemetría apuntaba a un
// paquete que existe y es el equivocado — un fallo mudo, peor que el ruidoso
// que el slice 3 arregló. El insumo pasa a consumirse: lo gasta el veredicto
// que lo lee. La regla sale de run-machine.js — el paquete vale mientras el
// paso siga siendo el del juez, así que un veredicto ACEPTADO (que siempre
// cambia de paso) lo consume y un DESCARTE (que no lo cambia) no.
describe('el paquete de revisión es de un solo uso: lo consume el veredicto que lo lee', () => {
  // `paqueteDeTarea`/`paqueteDeSlice` viven ahora a nivel de módulo (Slice 11,
  // firma compatible: mismo valor por defecto para la tarea 1).

  it('EL ATAQUE: tras un FAIL, encadenar report→controls→verdict sin next se DESCARTA', () => {
    // INTENTO 1, por el flujo real: `next` genera el paquete y el juez VETA.
    ct('report', informe(['uno.txt']))
    ct('controls')
    const r1 = juzgar(veredicto('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(r1.stdout).toMatch(/veredicto FAIL/)
    expect(estado().step).toBe('implement')      // el veto devuelve la tarea
    expect(estado().judgeRetries).toBe(1)
    // El veredicto se llevó su insumo. Ésta es la línea que estaba ROJA antes
    // del arreglo, y con ella todo lo que sigue.
    expect(existsSync(paqueteDeTarea())).toBe(false)

    // INTENTO 2: el implementador cambia el fichero y el conductor encadena
    // report→controls→verdict SIN volver a `next` — el ataque, literal.
    writeFileSync(join(repo, 'uno.txt'), 'uno, ahora arreglado\n')
    ct('report', informe(['uno.txt']))
    ct('controls')
    const r2 = ct('verdict', veredicto('PASS'))
    expect(r2.status).toBe(0)                    // descarte, no cierre
    expect(r2.stdout).toMatch(/veredicto descartado: el paquete de revisión no existe/)
    expect(r2.stdout).toContain('El paquete es de UN SOLO USO')
    expect(estado().step).toBe('judge')          // NO avanza: se vuelve a preguntar
    expect(estado().discards).toBe(1)
    expect(commits()).toBe(1)                    // el PASS rancio no comitea nada
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)

    // La TELEMETRÍA, que es la capa donde el fallo era mudo: dos filas de juez,
    // y la del intento 2 no afirma ningún paquete.
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const juez = filas.filter((f) => f.step === 'judge')
    expect(juez).toHaveLength(2)
    expect(juez[0].ruling).toBe('FAIL')          // el intento 1 sí juzgó, y sobre su diff
    expect(juez[1].outcome).toBe('discarded')
    expect(juez[1].ruling).toBeUndefined()
    expect(juez[1].review_package).toBeUndefined()

    // Y el camino honesto sigue abierto: `next` regenera el paquete del índice
    // NUEVO, el juez lo ve, y el PASS entra.
    const r3 = juzgar(veredicto('PASS'))
    expect(r3.stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('commit')
    expect(ct('commit').status).toBe(0)
    expect(commits()).toBe(2)
  })

  it('el DESCARTE no consume: el reintento por JSON ilegible juzga el MISMO .diff, sin volver a next', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const antes = readFileSync(paqueteDeTarea(), 'utf8')

    const r1 = ct('verdict', crudo('esto no es json'))
    expect(r1.stdout).toMatch(/veredicto descartado: no se pudo leer/)
    expect(estado().step).toBe('judge')
    expect(estado().discards).toBe(1)
    expect(existsSync(paqueteDeTarea())).toBe(true)
    expect(readFileSync(paqueteDeTarea(), 'utf8')).toBe(antes)   // byte a byte: el mismo insumo

    // Se le repregunta al juez SIN pasar por `next`, que es legítimo: el paso no
    // ha cambiado y el paquete que iba a juzgar sigue siendo el bueno. Y como
    // el paquete sigue siendo el mismo, el juez honesto copia el MISMO token
    // (Slice 11): por eso se sella aquí y no antes de escribirlo.
    const r2 = ct('verdict', sellar(veredicto('PASS'), paqueteDeTarea()))
    expect(r2.stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('commit')
    expect(existsSync(paqueteDeTarea())).toBe(false)             // aceptado: ahora sí se gasta
  })

  it('el camino feliz no cambia: cada tarea vuelve por next, y su paquete se gasta al aprobarla', () => {
    expect(tareaOk('uno.txt').status).toBe(0)
    expect(existsSync(paqueteDeTarea(1))).toBe(false)
    expect(estado().task).toBe(2)
    expect(tareaOk('dos.txt').status).toBe(0)
    expect(existsSync(paqueteDeTarea(2))).toBe(false)
    expect(commits()).toBe(3)
  })

  it('EL GEMELO DE SLICE: el descarte conserva el paquete y el veredicto aceptado lo gasta', () => {
    tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const antes = readFileSync(paqueteDeSlice(), 'utf8')

    expect(ct('slice-verdict', crudo('ni json ni nada')).stdout).toMatch(/veredicto de slice descartado/)
    expect(estado().step).toBe('slice-judge')
    expect(existsSync(paqueteDeSlice())).toBe(true)
    expect(readFileSync(paqueteDeSlice(), 'utf8')).toBe(antes)

    // Repreguntado sin `next` (legítimo: el paso no cambió) y aceptado: entrega
    // y se lleva su insumo. Sellado con el token del MISMO paquete (Slice 11).
    const r = ct('slice-verdict', sellar(veredictoDeSlice('PASS'), paqueteDeSlice()))
    expect(r.status).toBe(0)
    expect(estado().closed).toBe('delivered')
    expect(existsSync(paqueteDeSlice())).toBe(false)
  })

  it('EL GEMELO DE SLICE: un FAIL también gasta el paquete — también es un veredicto leído', () => {
    tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global')
    const r = juzgarSlice(veredictoDeSlice('FAIL', [{ severity: 'high', what: 'la tarea 2 deshace la 1', path: 'uno.txt', line: 1 }]))
    expect(r.status).toBe(1)                       // el veto de slice cierra el run
    expect(existsSync(paqueteDeSlice())).toBe(false)
  })
})

// Slice 11 de los apuntes de Capde — las dos vías que quedaban abiertas después
// de hacer el paquete de un solo uso, las dos MUDAS en la telemetría y
// reproducidas contra el HEAD anterior a este arreglo. El insumo se ataba; el
// producto no: nada ligaba el verdict.json al paquete. El paquete declara ahora
// en su cabecera el sha256 del diff que capturó, el juez lo copia, y el verbo
// exige que coincidan el del veredicto, el del paquete y el recomputado del
// corte de ese instante.
describe('el veredicto se ata al paquete: el token content-addressed que el juez copia', () => {
  it('el paquete declara el sha256 del diff staged que captura, y el veredicto que lo copia entra', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const token = tokenDelPaquete(paqueteDeTarea())
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    // CONTENT-ADDRESSED, y aquí se fija QUÉ se hashea: el diff staged crudo,
    // que es byte a byte lo que va en la sección `## Diff`.
    const diff = execFileSync('git', ['diff', '--cached', '-U10'], { cwd: repo, encoding: 'utf8' })
    expect(token).toBe(createHash('sha256').update(diff, 'utf8').digest('hex'))
    expect(readFileSync(paqueteDeTarea(), 'utf8').split('\n')[1]).toBe(`Review token: ${token}`)

    expect(ct('verdict', sellar(veredicto('PASS'), paqueteDeTarea())).stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('commit')
    expect(ct('commit').status).toBe(0)
    // El token viaja en el veredicto de la pull request y en su fila.
    const guardado = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-task-1.json'], { cwd: repo, encoding: 'utf8' }))
    expect(guardado.verdict.review_token).toBe(token)
    expect(filasDeJuez().at(-1).review_token).toBe(token)
    expect(filasDeJuez().at(-1).ruling).toBe('PASS')
  })

  it('EL ATAQUE (a): el veredicto de un juicio anterior no cuela por volver sólo a next', () => {
    // JUICIO 1, legítimo, sobre el código A: un PASS con hallazgo medium es un
    // veredicto ACEPTADO que devuelve la tarea al implementador, y deja el
    // fichero del veredicto en disco (misma ruta en todos los intentos).
    ct('report', informe(['uno.txt']))
    ct('controls')
    const v = veredicto('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'uno.txt', line: 1 }])
    expect(juzgar(v).stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('implement')

    // El implementador cambia el código y el conductor obedece SÓLO la mitad
    // del mensaje: vuelve a `next` (que regenera el paquete del índice nuevo) y
    // NO redespacha al juez — entrega otra vez el fichero del juicio 1.
    writeFileSync(join(repo, 'uno.txt'), 'uno, una versión que ningún juez ha visto\n')
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const r = ct('verdict', v)
    expect(r.status).toBe(0)                     // descarte, no cierre
    expect(r.stdout).toMatch(/veredicto descartado: el veredicto no es de este paquete/)
    expect(r.stdout).toContain('REDESPACHA al juez')
    expect(estado().step).toBe('judge')          // NO avanza
    expect(estado().discards).toBe(1)            // y cuenta para MAX_DISCARDS
    expect(commits()).toBe(1)                    // el veredicto reciclado no comitea nada

    // La TELEMETRÍA, que es donde el fallo era mudo: la fila del reciclado no
    // afirma juicio ni insumo.
    const juez = filasDeJuez()
    expect(juez).toHaveLength(2)
    expect(juez[1].outcome).toBe('discarded')
    expect(juez[1].ruling).toBeUndefined()
    expect(juez[1].review_package).toBeUndefined()
    expect(juez[1].review_token).toBeUndefined()

    // Y el camino honesto sigue abierto: se redespacha al juez, que copia el
    // token del paquete NUEVO.
    expect(juzgar(veredicto('PASS')).stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('commit')
  })

  it('EL ATAQUE (b): el código cambiado en el hueco del descarte no cuela con el paquete viejo', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    expect(ct('verdict', crudo('esto no es json')).stdout).toMatch(/veredicto descartado: no se pudo leer/)
    expect(existsSync(paqueteDeTarea())).toBe(true)   // el descarte sigue sin consumir

    // EL HUECO: el implementador toca el fichero y lo RE-STAGEA. El `git add`
    // es la mitad que importa — `ct-step commit` comitea el ÍNDICE, así que una
    // edición sin stagear no llega al commit y no invalida ningún juicio.
    writeFileSync(join(repo, 'uno.txt'), 'uno, código que ningún juez ha visto\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })

    // El juez copia HONESTAMENTE el token del paquete que se le dio: es el del
    // código viejo, y eso es todo lo que hace falta para que no entre.
    const r = ct('verdict', sellar(veredicto('PASS'), paqueteDeTarea()))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto descartado: el paquete de revisión ya no describe el código de ahora/)
    expect(estado().step).toBe('judge')
    expect(estado().discards).toBe(2)
    expect(commits()).toBe(1)
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
    const juez = filasDeJuez()
    expect(juez).toHaveLength(2)
    expect(juez[1].review_package).toBeUndefined()

    // El camino honesto: `next` regenera el paquete del índice de AHORA y el
    // PASS entra sobre el código que de verdad se va a comitear.
    expect(juzgar(veredicto('PASS')).stdout).toMatch(/veredicto PASS/)
    expect(estado().step).toBe('commit')
  })

  it('con el paquete rancio Y el JSON ilegible, la fila cuenta el paquete: la causa manda sobre el síntoma', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    writeFileSync(join(repo, 'uno.txt'), 'otra cosa\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    const r = ct('verdict', crudo('esto tampoco es json'))
    expect(r.stdout).toMatch(/ya no describe el código de ahora/)
    expect(r.stdout).not.toMatch(/no se pudo leer/)
    expect(filasDeJuez()[0].why).toMatch(/ya no describe el código de ahora/)
  })

  it('el reintento legítimo por JSON ilegible sigue entrando sin pasar por next', () => {
    // El mismo insumo, el mismo corte: el token coincide y no hay round trip
    // de más. Es la propiedad que hace que NO consumir en el descarte siga
    // valiendo la pena.
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const antes = readFileSync(paqueteDeTarea(), 'utf8')
    expect(ct('verdict', crudo('nada de json')).stdout).toMatch(/descartado/)
    expect(readFileSync(paqueteDeTarea(), 'utf8')).toBe(antes)
    const r = ct('verdict', sellar(veredicto('PASS'), paqueteDeTarea()))
    expect(r.stdout).toMatch(/veredicto PASS/)
    expect(estado().discards).toBe(1)             // el reintento no gastó un segundo descarte
    expect(existsSync(paqueteDeTarea())).toBe(false)
  })

  it('un veredicto sin review_token se descarta, y el motivo nombra la línea de la que se copia', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const r = ct('verdict', veredicto('PASS'))    // nadie lo sella: el juez no copió el token
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto descartado: el veredicto no copia el "Review token"/)
    expect(r.stdout).toContain('review_token')
    expect(estado().step).toBe('judge')
    expect(estado().discards).toBe(1)
  })

  it('un juez que NUNCA copia el token no cuela nada y para por 3: atascado se ve, mudo no', () => {
    // El riesgo principal del diseño, fijado como propiedad: el pipeline se
    // detiene con el exit de "no hay veredicto de fiar" y el motivo escrito en
    // seis filas, no se queda colgado ni deja pasar nada.
    ct('report', informe(['uno.txt']))
    ct('controls')
    let r
    for (let i = 0; i < 7; i++) { ct('next'); r = ct('verdict', veredicto('PASS')) }
    expect(r.status).toBe(3)
    expect(r.stderr).toMatch(/descartes en este run/)
    expect(commits()).toBe(1)
    expect(filasDeJuez().every((f) => f.outcome === 'discarded')).toBe(true)
  })

  it('un paquete sin la línea del token (plugin anterior, o editado) se descarta y manda a next', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const sinCabecera = readFileSync(paqueteDeTarea(), 'utf8').split('\n').filter((l) => !l.startsWith('Review token: ')).join('\n')
    writeFileSync(paqueteDeTarea(), sinCabecera)
    const r = ct('verdict', veredicto('PASS'))
    expect(r.stdout).toMatch(/no declara su "Review token"/)
    expect(estado().step).toBe('judge')
    expect(estado().discards).toBe(1)
    // Y se cura en una vuelta: `next` lo regenera CON token.
    expect(juzgar(veredicto('PASS')).stdout).toMatch(/veredicto PASS/)
  })

  it('EL GEMELO DE SLICE: el token sale del diff del RANGO y viaja en el veredicto comiteado', () => {
    tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const token = tokenDelPaquete(paqueteDeSlice())
    const diff = execFileSync('git', ['diff', '-U10', estado().baseSha, 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(token).toBe(createHash('sha256').update(diff, 'utf8').digest('hex'))
    const r = ct('slice-verdict', sellar(veredictoDeSlice('PASS'), paqueteDeSlice()))
    expect(r.status).toBe(0)
    expect(estado().closed).toBe('delivered')
    const guardado = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-slice.json'], { cwd: repo, encoding: 'utf8' }))
    expect(guardado.verdict.review_token).toBe(token)
    expect(filasDeJuez('slice-judge').at(-1).review_token).toBe(token)
  })

  it('EL GEMELO DE SLICE: un veredicto de slice con el token de otro paquete no entrega el run', () => {
    tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const p = join(repo, 'sv.json')
    writeFileSync(p, JSON.stringify({ ruling: 'PASS', rubric: recorridoDeSlice(), findings: [], review_token: 'f'.repeat(64) }))
    const r = ct('slice-verdict', p)
    expect(r.stdout).toMatch(/veredicto de slice descartado: el veredicto no es de este paquete/)
    expect(estado().step).toBe('slice-judge')
    expect(estado().discards).toBe(1)
    expect(estado().closed ?? null).toBeNull()
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'))).toBe(false)
  })

  it('EL GEMELO DE SLICE: un commit REESCRITO en el hueco del descarte invalida el paquete', () => {
    // La variante de (b) que la invariante de commits del estado NO caza: un
    // `--amend` deja la cuenta igual (`hechos === esperados`) y el contenido
    // distinto. Sin el token, esto entra.
    tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    expect(ct('slice-verdict', crudo('ni json ni nada')).stdout).toMatch(/descartado/)
    writeFileSync(join(repo, 'dos.txt'), 'dos, reescrito después del juicio\n')
    execFileSync('git', ['add', 'dos.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], { cwd: repo })
    const r = ct('slice-verdict', sellar(veredictoDeSlice('PASS'), paqueteDeSlice()))
    expect(r.stdout).toMatch(/ya no describe el código de ahora/)
    expect(estado().closed ?? null).toBeNull()
    expect(estado().step).toBe('slice-judge')
  })
})
