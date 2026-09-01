// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, PLAN, F } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, commits, estado } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('el alcance de la tarea lo decide el plan', () => {
  it('una ruta tocada que el plan no declara para esa tarea es rojo', () => {
    // La tarea 1 declara sólo uno.txt; el informe trae también dos.txt.
    ct('report', informe(['uno.txt', 'dos.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dos\.txt.*sobra/)
  })

  it('una ruta declarada que la tarea no tocó es rojo', () => {
    // El informe no trae nada: uno.txt, que la tarea 1 declara, se queda sin tocar.
    ct('report', informe([]))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/uno\.txt.*no está entre lo que tocó/)
  })

  it('(create) sobre un fichero que ya existía es rojo', () => {
    writeFileSync(join(repo, 'existente.txt'), 'ya estaba\n')
    execFileSync('git', ['add', 'existente.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'ya existía'], { cwd: repo, stdio: 'ignore' })
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('`uno.txt` (create)', '`existente.txt` (create)'))
    // El implementador lo cambia de verdad: el alcance se mide sobre el
    // ÍNDICE, y un fichero declarado pero sin cambios no stagea nada.
    writeFileSync(join(repo, 'existente.txt'), 'ya estaba, y ahora cambia\n')
    ct('report', informe(['existente.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/existente\.txt.*ya existía en el commit anterior/)
  })
})

describe('lo que los bloques del plan prometen tiene que estar', () => {
  it('un fichero que un bloque nombra y la tarea no tocó es rojo', () => {
    const conBloque = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create).', '', 'Contract (falta.txt):', '', F + 'ts', 'function foo(): void', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), conBloque)
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/bloque Contract \(falta\.txt\).*no está entre lo que tocó/)
  })

  it('el test que declara el TDD tiene que estar en lo stageado', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(
      '**TDD:** No TDD — fixture.',
      "**TDD:** `it('uno se sabe de memoria')`",
    ))
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dijo que añadía el test 'uno se sabe de memoria' y no está en lo stageado/)
  })

  it('el texto de Final text tiene que aparecer verbatim', () => {
    const conFinalText = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create), `doc.md` (create).', '', 'Final text (doc.md):', '', F + 'md', 'línea uno', 'línea dos', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), conFinalText)
    // El implementador stagea doc.md con una de las dos líneas cambiada.
    writeFileSync(join(repo, 'doc.md'), 'línea uno\nlínea distinta\n')
    ct('report', informe(['uno.txt', 'doc.md']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/Final text \(doc\.md\).*'línea dos'.*no está verbatim/)
  })

  // ==========================================================================
  // EL CASO ADVERSARIAL de la comprobación anterior. `git show :<path>`
  // devuelve contenido para CUALQUIER fichero del índice, esté o no entre lo
  // que la tarea tocó — así que por sí sola esa comprobación no cierra el
  // hueco: un `Final text` que cite un fichero ya comiteado, con el texto ya
  // verbatim ahí desde antes, la pasaría aunque la tarea no lo haya tocado.
  // Lo que cierra el hueco es que todo bloque `Final text (path):` entra
  // TAMBIÉN en `blockPaths`, y ese bucle sí exige pertenencia a `run.lastPaths`
  // (ver la nota sobre `bloquesDeclarados` en ct-step.mjs). La garantía es
  // real pero implícita: nada la fijaba hasta este test, así que simplificar
  // ese bucle por parecer redundante con `finalTexts` reintroduciría en
  // silencio el fallo que este test existe para cazar — el mismo tipo de
  // falso negativo que ya sufrió `testsDeclarados` (ver `planComiteado` más
  // abajo): el plan vive comiteado en `docs/`, así que buscar en el repo es
  // buscar en el plan.
  // ==========================================================================
  it('un Final text que cita un fichero YA COMITEADO, y la tarea no lo toca, es rojo aunque el contenido ya esté verbatim', () => {
    writeFileSync(join(repo, 'ya-existe.md'), 'línea uno\nlínea dos\n')
    execFileSync('git', ['add', 'ya-existe.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'ya existía con el texto'], { cwd: repo, stdio: 'ignore' })

    const conFinalText = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create).', '', 'Final text (ya-existe.md):', '', F + 'md', 'línea uno', 'línea dos', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), conFinalText)
    execFileSync('git', ['add', 'plan.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'el plan del slice'], { cwd: repo, stdio: 'ignore' })

    // La tarea sólo declara y toca uno.txt: ya-existe.md queda fuera.
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/bloque Final text \(ya-existe\.md\).*no está entre lo que tocó/)
  })
})

describe('los controles los mide el programa, no el implementador', () => {
  it('un control en rojo devuelve la tarea y, agotado, sale por 4', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt', 'test -f no-existe.txt'))
    for (let i = 0; i < 3; i++) {
      ct('report', informe(['uno.txt']))
      var r = ct('controls')
    }
    expect(r.status).toBe(4)
    expect(commits()).toBe(1)
  })

  it('un control que no se pudo MEDIR cierra a la primera, por 5', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt', 'comando-que-no-existe-en-esta-maquina'))
    ct('report', informe(['uno.txt']))
    expect(ct('controls').status).toBe(5)
  })

  it('los tests que la tarea prometió tienen que existir en lo stageado', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(
      '**Tests:** N/A — fixture.\n**Verification:** el fichero está.',
      "**Tests:** añade `'uno pinta uno'`.\n**Verification:** el fichero está.",
    ))
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dijo que añadía el test 'uno pinta uno'/)
  })

  // ==========================================================================
  // EL ÁMBITO DE ESA COMPROBACIÓN — los dos de abajo son el mismo bug por sus
  // dos caras, y el de arriba no cazaba ninguna: reescribe el plan SIN
  // comitearlo, así que el nombre del test no llega al índice y
  // `git grep --cached` no lo encuentra mire donde mire.
  //
  // En la vida real el plan SÍ está comiteado —lo exige el gate— y un plan
  // prescriptivo CITA el código verbatim. Medido en el slice #5 de repo-pulse:
  // el nombre de cada test de cada tarea vive dentro de `docs/`. Por eso el
  // plan de estos dos se comitea: sin eso, el test pasa con el bug puesto.
  // ==========================================================================
  const planComiteado = (texto) => {
    writeFileSync(join(repo, 'plan.md'), texto)
    execFileSync('git', ['add', 'plan.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'el plan del slice'], { cwd: repo, stdio: 'ignore' })
  }
  const conLineaDeTests = (linea) => PLAN.replace(
    '**Tests:** N/A — fixture.\n**Verification:** el fichero está.',
    `**Tests:** ${linea}\n**Verification:** el fichero está.`,
  )

  it('un test RETIRADO que sigue nombrado en el plan comiteado no es un test que siga estando', () => {
    // El falso positivo: el trabajo bien hecho y los controles en rojo, así que
    // la tarea no se podía cerrar por mucho que el implementador insistiera.
    planComiteado(conLineaDeTests("retira `'uno pinta uno'`."))
    ct('report', informe(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: done/)
  })

  it('un test PROMETIDO que sólo está en el plan, y no en lo que la tarea tocó, es rojo', () => {
    // El falso negativo, que es el grave: sin acotar el ámbito, esta
    // comprobación aprueba una tarea que prometió un test y no lo escribió
    // —exactamente el fallo para el que existe— porque el nombre está en el plan.
    planComiteado(conLineaDeTests("añade `'uno pinta uno'`."))
    ct('report', informe(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dijo que añadía el test 'uno pinta uno'/)
  })
})
