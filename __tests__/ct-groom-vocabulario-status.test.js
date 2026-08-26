// EL VOCABULARIO `status:` TIENE QUE EXISTIR EN GITHUB ANTES DE QUE ALGUIEN LO
// ESCRIBA.
//
// EL FALLO REAL, medido en un repo recién bootstrapeado (behavior-map-studio):
// tras el primer /ct-groom, el paso humano que el propio contrato de AGENTS.md
// manda ejecutar —`gh issue edit <n> --add-label status:ready`— fallaba, y si
// creabas esa label a mano el siguiente en caer era el claim
// (`--add-label status:in-progress`), que sale por dispatch-check.mjs#setStatus
// y muere en `dieErr(…, 3)`: /ct-next reportaba exit 3, «fallo de
// infraestructura, reintenta más tarde» — un consejo que NUNCA puede funcionar,
// porque no es una carrera perdida sino una label que no existe.
//
// LA CAUSA: `wantedLabels` (ct-groom.mjs) sale de las labels que los issues
// LLEVAN, y buildLabels (groom.js) solo pone una del vocabulario:
// `status:backlog`. Las otras tres nunca las creaba nadie.
//
// POR QUÉ NO SE PUEDEN CREAR AL ESCRIBIRLAS: `gh issue edit --add-label`
// resuelve nombre -> id para la mutación GraphQL `addLabelsToLabelable`, que
// toma ids y no nombres. Verificado read-only contra la API: un nombre que no
// existe resuelve a `null`, así que el comando no puede crearla — falla.
//
// ALCANCE DELIBERADO: las CUATRO de STATUS_LADDER (harvest.js), no siete.
// `status:blocked`, `status:paused` y `status:rejected` no los escribe nada del
// plugin: gh-issue-map.js las llama «labels custom, ninguna gatea nada» y
// dispatch-check.mjs documenta por qué `status:rejected` se descartó como
// diseño. Crearlas sería inventar vocabulario que el plugin decidió no tener.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { LOOP_STATUS_LABELS } from '../scripts/groom.js'
import { STATUS_LADDER } from '../scripts/harvest.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SPEC = '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
  '|---|---|---|---|---|---|---|---|---|\n' +
  '| 1 | login | backend | modelo | – | – | – | `area:web` | – |\n'

describe('el vocabulario status: del loop', () => {
  // Se DERIVA de STATUS_LADDER, no se reescribe a mano: dos listas del mismo
  // vocabulario divergen en cuanto alguien toca una sola.
  it('LOOP_STATUS_LABELS es exactamente STATUS_LADDER con el prefijo', () => {
    expect(LOOP_STATUS_LABELS).toEqual(STATUS_LADDER.map((s) => `status:${s}`))
  })

  it('cubre las cuatro que el plugin escribe de verdad, y ninguna más', () => {
    expect(LOOP_STATUS_LABELS).toEqual(['status:backlog', 'status:ready', 'status:in-progress', 'status:in-review'])
  })
})

describe('/ct-groom crea el vocabulario status:, no solo las labels que aplica', () => {
  const groom = (extra = []) => {
    const dir = makeSpecDir('ctg-vocab-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', ...extra], { encoding: 'utf8', env: fakeEnv() })
    rmSync(dir, { recursive: true, force: true })
    return res
  }

  // El síntoma que el usuario vio: groom termina, y las labels que el paso
  // siguiente necesita no están. El reporte de labels nuevas es la ventana a
  // qué se va a crear, y se calcula igual en dry-run que en la corrida real.
  it('el dry-run anuncia las cuatro como labels a crear', () => {
    const res = groom(['--dry-run'])
    expect(res.status).toBe(0)
    for (const l of LOOP_STATUS_LABELS) {
      expect(res.stderr, `no anuncia ${l}`).toContain(l)
    }
  })

  // Las que el issue SÍ lleva siguen creándose: este arreglo AÑADE al conjunto,
  // no lo sustituye.
  it('no se lleva por delante las labels que el issue aplica', () => {
    const res = groom(['--dry-run'])
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('area:web')
    expect(plan.issues[0].labels).toContain('type:backend')
    expect(res.stderr).toContain('area:web')
    expect(res.stderr).toContain('type:backend')
  })

  // El vocabulario tiene que EXISTIR, pero el issue nace en backlog: crear
  // status:ready no puede significar aplicárselo a nadie.
  it('crear el vocabulario NO cambia el status con el que nace el issue', () => {
    const plan = JSON.parse(groom(['--dry-run']).stdout)
    const status = plan.issues[0].labels.filter((l) => l.startsWith('status:'))
    expect(status).toEqual(['status:backlog'])
  })
})
