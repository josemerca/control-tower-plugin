// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PluginYardstick } from '../scripts/plugin-yardstick.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, PLUGIN_ROOT_TEST } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, veredicto, veredictoDeSlice, log, commits, estado, juzgar,
  juzgarSlice, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// Pasos 4, 5 y 6 del spec de la primera corrida en un repo ajeno.
describe('lo que el implementador avisa, y la telemetría, no se quedan donde nadie los lee', () => {
  it('Paso 4: `report` imprime el resumen del informe', () => {
    // El prompt del implementador le manda poner en `summary` la decisión
    // cerrada que obedeció a disgusto y el problema que vio y no tocó. Medido en
    // campo (jjponz/rust-monitoring#10): dijo que el Cargo.lock se commitea "para
    // CI reproducible" mientras el workflow corre sin --locked, y eso llegó a la
    // pull request SOLO porque aquella sesión abrió el fichero del informe por su
    // cuenta. Ningún verbo lo imprimía y ningún otro lo consultaba.
    const r = ct('report', informe(['uno.txt'], 'report.json', 'obedecí la fila del Cargo.lock y creo que se paga caro'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/obedecí la fila del Cargo.lock/)
  })

  it('Paso 4: `next` lo repite en el paso de commit, que es cuando la sesión escribe la pull request', () => {
    ct('report', informe(['uno.txt'], 'report.json', 'la decisión de la tarea 2 deja el lockfile sin hacer valer'))
    ct('controls')
    juzgar(veredicto('PASS'))
    const r = ct('next')
    expect(r.stdout).toMatch(/paso: commit/)
    expect(r.stdout).toMatch(/lockfile sin hacer valer/)
  })

  it('Paso 5: la telemetría viaja DENTRO del commit de su tarea', () => {
    tareaOk('uno.txt')
    const tocados = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(tocados).toMatch(/docs\/superpowers\/metrics\/issue-7\.jsonl/)
    const filas = readFileSync(join(repo, 'docs', 'superpowers', 'metrics', 'issue-7.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.every((f) => f.issue === 7 && f.task === 1)).toBe(true)
  })

  it('Paso 5: NO se stagea antes de los controles, o el control de alcance vetaría la tarea', () => {
    // El veredicto ya resolvió esto mismo: es un artefacto de la maquinaria, no
    // alcance del implementador, así que entra en el índice DESPUÉS de medir.
    ct('report', informe(['uno.txt']))
    ct('controls')
    const enIndice = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' })
    expect(enIndice).not.toMatch(/metrics/)
    expect(enIndice).toMatch(/uno\.txt/)
  })

  it('Paso 5: las filas del intento que el juez vetó viajan también — el coste de las vueltas es el dato', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('FAIL', [{ severity: 'high', what: 'no', path: 'uno.txt', line: 1 }]))
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    ct('commit')
    const commiteado = execFileSync('git', ['show', 'HEAD:docs/superpowers/metrics/issue-7.jsonl'], { cwd: repo, encoding: 'utf8' })
    const filas = commiteado.trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.filter((f) => f.attempt === 1).length).toBeGreaterThan(0)
    expect(filas.filter((f) => f.attempt === 2).length).toBeGreaterThan(0)
    expect(filas.find((f) => f.step === 'judge' && f.attempt === 1).ruling).toBe('FAIL')
  })

  it('Paso 6: la fila de `controls` lleva cuánto tardó, que es el único tiempo que ejecuta el programa', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const controles = filas.find((f) => f.step === 'controls')
    expect(typeof controles.duration_ms).toBe('number')
    expect(controles.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('Paso 6: no hay fila de `commit`: su sha y su hecho están enteros en git log', () => {
    tareaOk('uno.txt')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.map((f) => f.step)).toEqual(['implement', 'controls', 'judge'])
  })
})

describe('un fallo de la telemetría no puede tumbar la tarea', () => {
  it('si la ruta del veredicto está gitignoreada, `git add` falla y la tarea se comitea igual', () => {
    // Mismo defecto que el de las métricas, en código anterior (590b995, el que
    // hizo viajar el veredicto): `git add` sobre una ruta ignorada sale con 1, la
    // excepción subía y el run se quedaba atascado en exit 9 con la tarea sin
    // comitear. Decisión humana, tomada al encontrarlo: avisar y seguir. Un
    // veredicto que no puede viajar degrada el contrato de F37 y hay que verlo,
    // pero un run atascado no lo arregla — y el veredicto sigue en disco, en la
    // carpeta del run.
    writeFileSync(join(repo, '.gitignore'), 'docs/superpowers/verdicts/\n')
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora los veredictos'], { cwd: repo })
    const r = tareaOk('uno.txt')
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })).toMatch(/uno\.txt/)
  })

  it('si la ruta de las métricas está gitignoreada, `git add` falla y la tarea se comitea igual', () => {
    // El principio es del diseño y es viejo: "ninguna transición depende de la
    // medida". Al hacer que la telemetría VIAJE aparece un camino nuevo por el
    // que podía romperlo — el `git add` del fichero — y `git add` sobre una ruta
    // ignorada sale con 1. Un repo que ignore `docs/` no es raro.
    // Se ignora SOLO la ruta de las métricas, no `docs/` entero: con `docs/`
    // ignorado el que revienta primero es el `git add` del VEREDICTO, que es
    // código anterior a este cambio y tiene el mismo defecto — sale por 9 y deja
    // el run atascado. Ese hallazgo se reporta aparte; este test mide lo mío.
    writeFileSync(join(repo, '.gitignore'), 'docs/superpowers/metrics/\n')
    // Solo el .gitignore: un `git add -A` se llevaría también `uno.txt`, y
    // entonces el control de ALCANCE vetaría la tarea (un `(create)` de un
    // fichero que ya está en el commit anterior) y el fallo sería otro.
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora las metricas'], { cwd: repo })
    const r = tareaOk('uno.txt')
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })).toMatch(/uno\.txt/)
  })

  it('si el veredicto de slice PASS no puede commitearse, la entrega sigue igual', () => {
    // La misma doctrina que los dos de arriba, aplicada a la fase nueva: con
    // docs/superpowers/ entero ignorado, ni el veredicto del slice ni la
    // telemetría se pueden stagear — no hay commit del veredicto, pero el run
    // entrega: la evidencia que no viaja avisa, nunca bloquea un slice cuyo
    // trabajo ya está comiteado entero.
    writeFileSync(join(repo, '.gitignore'), 'docs/superpowers/\n')
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora la evidencia'], { cwd: repo })
    tareaOk('uno.txt')
    tareaOk('dos.txt')
    ct('reconcile')
    ct('global')
    const r = juzgarSlice(veredictoDeSlice('PASS'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(r.stderr).toMatch(/nada que commitear del veredicto del slice/)
    expect(estado().closed).toBe('delivered')
    // 1 base + 1 gitignore + 2 tareas, y NINGÚN commit de veredicto.
    expect(commits()).toBe(4)
    expect(log()).not.toMatch(/Veredicto del slice entero/)
  })
})

// §3.3 del handoff: `.agent/conventions.md` es la vara del REPO, no del plan.
// `ct-step` la lee directo del disco y la pega al final de cada task brief —
// sin ningún agente en medio, así que un repo con el fichero y otro sin él se
// comportan distinto sólo por lo que hay en disco, nunca por lo que un agente
// decidió copiar.
describe('la vara del repo viaja en el brief, sin agente en medio', () => {
  it('con .agent/conventions.md, el brief lleva el banner y el contenido, DETRÁS de la tarea', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '# La vara\n\n- `AGENTS.md`\n')
    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).toMatch(/leída directo de `\.agent\/conventions\.md`/)
    expect(brief).toContain('- `AGENTS.md`')
    expect(brief.indexOf('Task 1')).toBeLessThan(brief.indexOf('leída directo'))
  })

  it('sin el fichero, el brief no lo menciona — el camino de hoy, intacto', () => {
    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).not.toMatch(/conventions\.md/)
  })

  it('con el fichero en blanco, el brief no lleva el banner — vacío no es vara', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '\n')
    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).not.toMatch(/leída directo de/)
  })
})

// La vara la dicta ct (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md).
// La vara de ct viaja SIEMPRE, va DELANTE de la del repo —su cabecera fija la
// precedencia y hay que leerla antes de que llegue la vara sobre la que decide— y
// que falte es una instalación rota, no un estado del repo: se aborta.
describe('la vara de ct viaja en el brief, y va delante de la del repo', () => {
  const briefDeLaUno = () => readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')

  it('el brief termina con los cinco documentos, DETRÁS de la tarea', () => {
    ct('next')
    const brief = briefDeLaUno()
    expect(brief).toMatch(/\*\*La vara de ct\*\*/)
    for (const nombre of PluginYardstick.FILES) {
      expect(brief).toContain(`## Vara de ct: conventions/${nombre}`)
    }
    expect(brief.indexOf('Task 1')).toBeLessThan(brief.indexOf('La vara de ct'))
  })

  it('pega el contenido real de los documentos, no un resumen', () => {
    ct('next')
    for (const nombre of PluginYardstick.FILES) {
      const documento = readFileSync(join(PLUGIN_ROOT_TEST, 'conventions', nombre), 'utf8')
      expect(briefDeLaUno(), `${nombre} no viaja verbatim`).toContain(documento.trim())
    }
  })

  it('con declaración del repo, la de ct va PRIMERO', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '# La vara del repo\n\n- `AGENTS.md`\n')
    ct('next')
    const brief = briefDeLaUno()
    expect(brief.indexOf('La vara de ct')).toBeLessThan(brief.indexOf('leída directo de `.agent/conventions.md`'))
  })

  // EL ALCANCE DE CADA DOCUMENTO decide si viaja. `architecture.md` rige los
  // MÓDULOS NUEVOS —lo dice su propia cabecera `Applies to:`— así que a una
  // tarea que sólo modifica lo que ya estaba no le llega: son 9,3 KB que el
  // implementador lee en cada tarea sin que ninguno de sus párrafos pueda
  // medir su diff.
  const conLaUnoModificando = () => {
    const plan = readFileSync(join(repo, 'plan.md'), 'utf8').replace('`uno.txt` (create)', '`uno.txt` (modify)')
    writeFileSync(join(repo, 'plan.md'), plan)
  }

  it('una tarea que no estrena módulo no se lleva architecture.md, y sí los otros cuatro', () => {
    conLaUnoModificando()
    ct('next')
    const brief = briefDeLaUno()
    expect(brief).not.toContain('## Vara de ct: conventions/architecture.md')
    for (const nombre of ['defects.md', 'style.md', 'decisions.md', 'testing.md']) {
      expect(brief, `${nombre} tendría que seguir viajando`).toContain(`## Vara de ct: conventions/${nombre}`)
    }
  })

  it('una tarea que estrena módulo sí se lleva architecture.md', () => {
    ct('next')
    expect(briefDeLaUno()).toContain('## Vara de ct: conventions/architecture.md')
  })

  it('la cabecera dice por qué architecture.md puede no estar, para que su ausencia no se lea como un olvido', () => {
    conLaUnoModificando()
    ct('next')
    expect(briefDeLaUno()).toMatch(/MÓDULOS NUEVOS/)
  })

  it('sin declaración del repo, la de ct viaja igual: son dos varas independientes', () => {
    ct('next')
    const brief = briefDeLaUno()
    expect(brief).toContain('## Vara de ct: conventions/defects.md')
    expect(brief).not.toMatch(/leída directo de `\.agent\/conventions\.md`/)
  })

  it('sin el directorio de la vara, aborta nombrando lo que falta y no entrega brief', () => {
    // Un plugin FALSO: se copian `scripts/` y `skills/` y se omite `conventions/`,
    // que es exactamente el estado de una instalación rota. `PLUGIN_ROOT` sale de
    // la ubicación del propio script, así que copiarlo es la única forma de moverlo.
    const fake = mkdtempSync(join(tmpdir(), 'ct-plugin-roto-'))
    try {
      cpSync(join(PLUGIN_ROOT_TEST, 'scripts'), join(fake, 'scripts'), { recursive: true })
      cpSync(join(PLUGIN_ROOT_TEST, 'skills'), join(fake, 'skills'), { recursive: true })
      // `scripts/state.js` importa el paquete npm `yaml`. Copiado fuera del repo
      // (aquí, bajo tmpdir()), la resolución de módulos ESM no encuentra
      // `node_modules/yaml` subiendo directorios y el proceso muere con
      // MODULE_NOT_FOUND (exit 1) antes de llegar a la comprobación de la vara.
      // El mismo problema ya lo resuelve `ct-next-claim.test.js` con un symlink
      // a `node_modules` en vez de copiar el repo entero.
      symlinkSync(join(PLUGIN_ROOT_TEST, 'node_modules'), join(fake, 'node_modules'), 'dir')
      const r = spawnSync('node', [join(fake, 'scripts', 'ct-step.mjs'), 'next', '--plan', 'plan.md', '--issue', '7'], {
        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CONFIG_DIR: join(repo, '.telemetria') },
      })
      expect(r.status).toBe(8)
      expect(r.stderr).toMatch(/defects\.md/)
      expect(r.stderr).toMatch(/instalación/)
      expect(existsSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'))).toBe(false)
    } finally {
      rmSyncBestEffort(fake)
    }
  })
})
