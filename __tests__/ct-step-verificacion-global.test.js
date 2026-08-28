// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, PLAN, GLOBAL_VERIFICATION } from './fixtures/ct-step-harness.js'

let repo
const { ct, commits, estado, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// §3.7-A del handoff: `## 8. Global verification` la ejecuta el PROGRAMA, tras
// la última tarea comiteada. Hasta este slice no la corría nadie: `controls`
// sólo mide el bloque **Verification:** de cada tarea.
describe('la Global verification la corre el programa (§3.7-A)', () => {
  const dosTareas = () => { tareaOk('uno.txt'); tareaOk('dos.txt') }

  it('tras el último commit, next anuncia la fase global con los comandos del §8', () => {
    dosTareas()
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/las 2 tareas comiteadas/)
    expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    expect(r.stdout).toMatch(/test -f uno\.txt && test -f dos\.txt/)
  })

  it('en verde avanza a slice-judge y deja el log en la carpeta del run', () => {
    dosTareas()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/global: done/)
    expect(estado().step).toBe('slice-judge')
    expect(readFileSync(estado().lastGlobalLog, 'utf8')).toMatch(/test -f uno\.txt && test -f dos\.txt/)
  })

  it('un comando en rojo cierra el run A LA PRIMERA por 11: todo está comiteado y no hay a quién devolvérselo', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', 'test -f no-existe.txt'))
    dosTareas()
    const r = ct('global')
    expect(r.status).toBe(11)
    expect(commits()).toBe(3)   // nada se descomitea: el rojo es para el humano
  })

  it('un comando que no se pudo MEDIR cierra por 12, que no es el mismo rojo', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt && test -f dos.txt', 'comando-que-no-existe-en-esta-maquina'))
    dosTareas()
    expect(ct('global').status).toBe(12)
  })

  it('con "N/A — <razón>" registra y avanza sin ejecutar nada', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(GLOBAL_VERIFICATION, '## 8. Global verification\n\nN/A — fixture sin punta a punta.\n'))
    dosTareas()
    const r = ct('global')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/N\/A/)
    expect(estado().step).toBe('slice-judge')
    expect(estado().lastGlobalLog ?? null).toBeNull()
  })

  it('un plan SIN §8 ejecutable sale por 6 antes de dar un solo paso', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(GLOBAL_VERIFICATION, '## 8. Global verification\n\nQue todo siga en verde.\n'))
    const r = ct('next')
    expect(r.status).toBe(6)
    expect(r.stderr).toMatch(/no ejecuta prosa/)
  })
})
