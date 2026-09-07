import { describe, it, expect } from 'vitest'
import { parseState, parseStateSafe, renderState, composeHydration, readBlocked, blockNotice, fieldReadingGuide, describeStopRelation, classifyStopState, noticeDecision, NOTICE_REPEAT_EVERY_TURNS } from '../scripts/state.js'
import { SLICE_REL_PATH } from '../scripts/state-paths.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE = `---
task: "OAuth login"
status: in_progress
last_commit: abc1234
github_issue: 482
tasks:
  - {id: T001, done: true, desc: "model"}
  - {id: T007, done: false, desc: "refresh"}
---
## Current State
Login works, refresh a medias.`

describe('parseState', () => {
  it('extrae frontmatter tipado', () => {
    const { meta } = parseState(SAMPLE)
    expect(meta.status).toBe('in_progress')
    expect(meta.github_issue).toBe(482)
    expect(meta.tasks[1].done).toBe(false)
  })
  it('extrae el cuerpo en prosa', () => {
    expect(parseState(SAMPLE).body).toContain('Login works')
  })
  it('sin frontmatter → meta vacío, body entero', () => {
    const { meta, body } = parseState('solo prosa')
    expect(meta).toEqual({})
    expect(body).toBe('solo prosa')
  })
  it('tolera BOM inicial y aún extrae el frontmatter', () => {
    const withBom = '﻿' + SAMPLE
    expect(parseState(withBom).meta.status).toBe('in_progress')
  })
  it('tolera líneas en blanco iniciales', () => {
    expect(parseState('\n\n' + SAMPLE).meta.github_issue).toBe(482)
  })
})

describe('renderState', () => {
  it('roundtrip conserva campos', () => {
    const again = parseState(renderState(parseState(SAMPLE)))
    expect(again.meta.task).toBe('OAuth login')
    expect(again.meta.tasks[0].id).toBe('T001')
  })
})

describe('composeHydration', () => {
  it('incluye estado y commits', () => {
    const out = composeHydration('ESTADO', 'abc log')
    expect(out).toContain('ESTADO')
    expect(out).toContain('abc log')
  })
  it('sin estado → cadena vacía (no inyecta ruido)', () => {
    expect(composeHydration('', 'x')).toBe('')
  })
})

// F22 — la cabecera decía "Estado del slice" SIEMPRE, también en la sesión
// coordinadora, cuyo `.agent/STATE.md` no habla de ningún slice. Ahora sale de
// `stateRel`, que es el fichero que el hook acaba de resolver.
describe('composeHydration: la cabecera nombra lo que el fichero ES', () => {
  it('con el STATE.md de la coordinadora (por defecto) NO dice "del slice"', () => {
    const out = composeHydration('ESTADO', '')
    expect(out).toContain('# Estado del repo (hidratación automática)')
    expect(out).not.toContain('Estado del slice')
  })
  it('con el SLICE.md de un worktree despachado sí dice "del slice"', () => {
    const out = composeHydration('ESTADO', '', { stateRel: SLICE_REL_PATH })
    expect(out).toContain('# Estado del slice (hidratación automática)')
  })
})

describe('parseState CRLF', () => {
  it('tolera frontmatter con CRLF', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n')
    expect(parseState(crlf).meta.status).toBe('in_progress')
  })
})

describe('composeHydration sin commits', () => {
  it('omite la sección de commits si gitLog está vacío', () => {
    const out = composeHydration('ESTADO', '')
    expect(out).toContain('ESTADO')
    expect(out).not.toContain('Últimos commits')
  })
  it('incluye la sección si hay commits', () => {
    expect(composeHydration('ESTADO', 'abc log')).toContain('Últimos commits')
  })
})

// ===========================================================================
// F7 — `blocked`: que el STATE.md pueda decir "esto no se puede hacer" en un
// dato, y que el hook lo transmita como tal.
//
// EL INCIDENTE (real): `next_action: "Lanzar la corrida REAL de /ct-groom…"`.
// La corrida se descubrió que escribiría datos falsos y quedó bloqueada, pero
// el campo seguía ahí y el hook de SessionStart lo inyecta en TODA sesión
// nueva del repo — cualquiera de ellas lo habría ejecutado. La mitigación fue
// reescribir el campo con la palabra "BLOQUEADO" en prosa: exactamente lo que
// estos tests existen para no volver a necesitar.
// ===========================================================================
const STATE_BLOQUEADO = `---
task: "Plan vs Propuestas"
status: in_progress
next_action: "Lanzar la corrida REAL de /ct-groom sobre el spec"
blocked:
  reason: "la corrida escribiría datos falsos (el spec cita issues que no existen)"
  since: "2026-07-25"
  unblock: "corregir la §9 del spec para que no invente números de issue, y revalidarla"
verify: "\`gh issue list --milestone 'Plan vs Propuestas'\` devuelve 6 issues"
---
## Current State
Groom preparado, sin ejecutar.`

describe('readBlocked', () => {
  it('mapa con reason/since/unblock → bloqueado, con los tres campos', () => {
    const b = readBlocked(parseState(STATE_BLOQUEADO).meta)
    expect(b.state).toBe('blocked')
    expect(b.reason).toMatch(/datos falsos/)
    expect(b.since).toBe('2026-07-25')
    expect(b.unblock).toMatch(/corregir la §9/)
  })

  it('campo ausente → NO bloqueado (todo STATE.md anterior a esto lo es)', () => {
    expect(readBlocked(parseState(SAMPLE).meta).state).toBe('none')
  })

  it('null / false / cadena vacía → NO bloqueado', () => {
    for (const v of [null, false, '', '   ']) {
      expect(readBlocked({ blocked: v }).state).toBe('none')
    }
  })

  // `blocked: no` lo parsea YAML 1.2 como la CADENA "no", no como false: un
  // truthy-check ingenuo la leería como un bloqueo con motivo "no".
  it('palabras que un humano escribe queriendo decir "no bloqueado" (no/none/-/n/a) → NO bloqueado', () => {
    for (const v of ['no', 'No', 'FALSE', 'none', 'ninguno', 'nada', 'n/a', '-', '–', '--']) {
      expect(readBlocked({ blocked: v }).state, `blocked: ${v}`).toBe('none')
    }
  })

  // El simétrico, y el que importa: la comparación es de la cadena ENTERA,
  // nunca por prefijo. Un motivo real que EMPIECE por "no" es un bloqueo.
  it('un motivo que empieza por "no" sigue siendo un bloqueo (no se compara por prefijo)', () => {
    const b = readBlocked({ blocked: 'no se puede hasta que Legal responda' })
    expect(b.state).toBe('blocked')
    expect(b.reason).toBe('no se puede hasta que Legal responda')
  })

  it('cadena suelta → bloqueado, y la cadena se conserva como motivo', () => {
    expect(readBlocked({ blocked: 'la API de pagos está caída' })).toMatchObject({ state: 'blocked', reason: 'la API de pagos está caída' })
  })

  it('blocked: true → bloqueado SIN motivo (y eso se distingue de tener motivo)', () => {
    expect(readBlocked({ blocked: true })).toMatchObject({ state: 'blocked', reason: '' })
  })

  // Estrechar lo que se acepta crea una categoría nueva de rechazados: quien
  // escribe `razon:` en español tendría un STATE.md que dice el motivo y un
  // aviso que dice "no consta". Esa categoría tiene que tener voz, y no puede
  // perder el contenido.
  it('mapa con claves no reconocidas → bloqueado, y las anuncia CON su contenido', () => {
    const b = readBlocked({ blocked: { razon: 'datos falsos', motivo: 'x' } })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/razon/)
    expect(b.notes.join(' ')).toMatch(/datos falsos/) // el contenido no se traga
    expect(b.notes.join(' ')).toMatch(/`reason`/) // y dice cuál es la clave buena
  })

  it('forma no reconocida (lista) → bloqueado por seguridad, diciendo que no se reconoce', () => {
    const b = readBlocked({ blocked: ['a', 'b'] })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/no se reconoce/i)
    expect(b.notes.join(' ')).toMatch(/\["a","b"\]/)
  })

  // Poner el bloqueo en un campo propio (y no en `status`) crea una categoría
  // nueva de rechazados: quien quiere bloquear y escribe lo primero que suena
  // razonable, `status: blocked`. Tragarlo en silencio sería un bloqueo
  // escrito de buena fe que no bloquea nada — peor que el fallo original.
  it('`status: blocked` sin campo `blocked` → BLOQUEADO igual, diciendo cuál es el campo bueno', () => {
    const b = readBlocked({ status: 'blocked', next_action: 'seguir' })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/`blocked: \{reason:/) // dice el campo bueno Y su forma
    expect(b.notes.join(' ')).toMatch(/PROGRESO/)
  })

  it('variantes de "parado" en `status` (bloqueado, on_hold…) también', () => {
    for (const s of ['bloqueado', 'BLOCKED', 'on_hold', 'on-hold', 'parado']) {
      expect(readBlocked({ status: s }).state, `status: ${s}`).toBe('blocked')
    }
  })

  it('control: los `status` normales NO bloquean nada', () => {
    for (const s of ['not_started', 'in_progress', 'in_review', 'done', '']) {
      expect(readBlocked({ status: s }).state, `status: ${s}`).toBe('none')
    }
  })

  it('`status: blocked` + `blocked: null` (contradicción) → BLOQUEADO por seguridad, y se dice que es una contradicción', () => {
    const b = readBlocked({ status: 'blocked', blocked: null })
    expect(b.state).toBe('blocked')
    expect(b.notes.join(' ')).toMatch(/contradicción/i)
  })

  it('`blocked` con motivo manda sobre `status` (no se pierde el motivo ni se duplica el aviso)', () => {
    const b = readBlocked({ status: 'blocked', blocked: { reason: 'la API está caída' } })
    expect(b.reason).toBe('la API está caída')
    expect(b.notes).toEqual([])
  })

  it('frontmatter que no es un mapa → "no se sabe", nunca "no bloqueado"', () => {
    expect(readBlocked('solo texto').state).toBe('unreadable')
    expect(readBlocked(['a']).state).toBe('unreadable')
    expect(readBlocked(null).state).toBe('unreadable')
  })
})

describe('parseStateSafe', () => {
  it('frontmatter YAML roto → error como dato, sin lanzar', () => {
    const roto = '---\ntask: "sin cerrar\n  ]: [\n---\ncuerpo'
    expect(() => parseState(roto)).toThrow() // control: el parser estricto SÍ lanza
    const r = parseStateSafe(roto)
    expect(r.error).toBeTruthy()
    expect(r.meta).toEqual({})
  })
  it('frontmatter bueno → error null y el mismo meta que parseState', () => {
    const r = parseStateSafe(SAMPLE)
    expect(r.error).toBe(null)
    expect(r.meta.status).toBe('in_progress')
  })
})

describe('composeHydration con trabajo BLOQUEADO', () => {
  const out = composeHydration(STATE_BLOQUEADO, 'abc log')

  it('el aviso de bloqueo va PRIMERO, antes del estado (se lee de arriba abajo)', () => {
    expect(out.split('\n')[0]).toMatch(/TRABAJO BLOQUEADO/) // la PRIMERA línea
    // La cabecera es la del checkout principal (`composeHydration` sin
    // `stateRel` = `.agent/STATE.md`): "del repo", no "del slice" — F22.
    expect(out.indexOf('TRABAJO BLOQUEADO')).toBeLessThan(out.indexOf('# Estado del repo'))
  })

  it('declara el next_action SUSPENDIDO y lo cita, para que no se lea como orden vigente', () => {
    expect(out).toMatch(/SUSPENDIDO/)
    expect(out).toMatch(/Lanzar la corrida REAL/)
    expect(out).toMatch(/No lo ejecutes/i)
  })

  it('dice el motivo y qué haría falta para desbloquear', () => {
    expect(out).toMatch(/datos falsos/)
    expect(out).toMatch(/corregir la §9/)
    expect(out).toMatch(/2026-07-25/)
  })

  it('dice cómo se levanta el bloqueo, y que no lo levante la propia sesión', () => {
    expect(out).toMatch(/borra el campo `blocked`/)
    expect(out).toMatch(/no lo levantes por tu cuenta/i)
  })

  it('sigue inyectando el estado entero y los commits (no se pierde contexto)', () => {
    expect(out).toContain('Groom preparado, sin ejecutar.')
    expect(out).toContain('Últimos commits')
  })

  it('bloqueado sin reason ni unblock → lo dice como NO CONSTA, sin inventarlos', () => {
    const o = composeHydration('---\nnext_action: "x"\nblocked: true\n---\ncuerpo', '')
    expect(o).toMatch(/Motivo: NO CONSTA/)
    expect(o).toMatch(/Para desbloquear: NO CONSTA/)
  })

  it('un next_action kilométrico se recorta en el aviso (pero sigue entero en el estado)', () => {
    const largo = 'x'.repeat(900)
    const o = composeHydration(`---\nnext_action: "${largo}"\nblocked: "porque sí"\n---\ncuerpo`, '')
    const aviso = o.slice(0, o.indexOf('# Estado del repo'))
    expect(aviso).toContain('…')
    expect(aviso.length).toBeLessThan(2000)
    expect(o).toContain(largo) // el texto íntegro sigue estando, abajo
  })
})

describe('composeHydration sin bloqueo (compatibilidad hacia atrás)', () => {
  it('un STATE.md sin el campo `blocked` no dispara ningún aviso de bloqueo', () => {
    const out = composeHydration(SAMPLE, 'abc log')
    expect(out).not.toMatch(/TRABAJO BLOQUEADO/)
    expect(out).not.toMatch(/SUSPENDIDO/)
    expect(out.startsWith('# Estado del repo')).toBe(true)
  })
  it('`blocked: null` (lo que siembra ct-next) tampoco', () => {
    expect(composeHydration('---\ntask: "x"\nblocked: null\n---\ncuerpo', '')).not.toMatch(/TRABAJO BLOQUEADO/)
  })
})

describe('composeHydration con un STATE.md ilegible', () => {
  const out = composeHydration('---\ntask: "sin cerrar\n  ]: [\n---\ncuerpo', '')

  it('no revienta y avisa de que NO SE PUEDE SABER si está bloqueado', () => {
    expect(out).toMatch(/NO SE PUDO LEER/)
    expect(out).toMatch(/no se puede saber si el trabajo está BLOQUEADO/i)
    expect(out).toMatch(/posiblemente bloqueado/i)
  })
  it('sigue inyectando el texto crudo del estado (es lo único que queda)', () => {
    expect(out).toContain('cuerpo')
  })
})

// El segundo síntoma del mismo agujero: `verify` decía «`gh issue list …`
// devuelve 6 issues» cuando no había ni milestone ni issues. Estaba escrito
// como la comprobación PARA DESPUÉS, pero en frío es indistinguible de la
// afirmación de un hecho.
describe('fieldReadingGuide — hecho comprobado vs. comprobación pendiente', () => {
  it('con `verify` no vacío, dice que es PENDIENTE y no un hecho', () => {
    const g = fieldReadingGuide({ verify: '`gh issue list …` devuelve 6 issues' })
    expect(g).toMatch(/PENDIENTE/)
    expect(g).toMatch(/no un hecho ya comprobado/i)
  })
  it('con `next_action` no vacío, avisa de que puede haber caducado', () => {
    expect(fieldReadingGuide({ next_action: 'seguir por el AC-2' })).toMatch(/caducad/i)
  })
  it('campos vacíos → ninguna guía (una guía que sale siempre es ruido)', () => {
    expect(fieldReadingGuide({ verify: '', next_action: '' })).toBe('')
    expect(fieldReadingGuide({})).toBe('')
  })
  it('bloqueado → no repite la coletilla de next_action (el aviso de bloqueo ya dice más)', () => {
    const g = fieldReadingGuide({ next_action: 'x', verify: 'y' }, { blocked: true })
    expect(g).toMatch(/`verify`/)
    expect(g).not.toMatch(/`next_action`/)
  })
  it('la guía llega a la hidratación de un STATE.md normal', () => {
    const out = composeHydration('---\nverify: "el test T7 pasa"\nnext_action: "seguir"\n---\ncuerpo', '')
    expect(out).toMatch(/Cómo leer estos campos/)
    expect(out).toMatch(/PENDIENTE/)
  })
})

describe('blockNotice', () => {
  it('sin bloqueo → cadena vacía', () => {
    expect(blockNotice({ state: 'none' })).toBe('')
    expect(blockNotice(null)).toBe('')
  })
  it('sin next_action que suspender, no se inventa uno', () => {
    const n = blockNotice({ state: 'blocked', reason: 'r' }, { nextAction: '' })
    expect(n).toMatch(/no dice nada/)
    expect(n).not.toMatch(/SUSPENDIDO/)
  })
})

// F12: `shouldBlockStop` comparaba los dos SHA por igualdad y quien lo usaba
// afirmaba «hay commits más nuevos» — una ancestría que la igualdad no
// comprueba. Lo sustituyen `describeStopRelation` (le pregunta a git) y
// `classifyStopState` (decide y redacta).
const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

// Runner de mentira: `plan` mapea cada consulta a su respuesta, para poder
// probar cada rama sin montar un repo. Claves: `rev-parse`, `rev-list`,
// `merge-base`, `is-ancestor:<a>:<b>`, `branch` (ramas locales) y `branch-r`
// (remotas). Los tests de integración contra git de verdad están en
// __tests__/stop.test.js.
function fakeGit(plan, log) {
  return (args) => {
    log?.push(args)
    const key = args[0] === 'merge-base' && args[1] === '--is-ancestor'
      ? `is-ancestor:${args[2]}:${args[3]}`
      : args[0] === 'branch' && args[1] === '-r' ? 'branch-r' : args[0]
    const v = plan[key]
    if (v === undefined) return { status: 1, stdout: '' }
    return typeof v === 'number' ? { status: v, stdout: '' } : { status: 0, stdout: v }
  }
}

describe('describeStopRelation', () => {
  const rel = (lastCommit, plan, branch = 'main') =>
    describeStopRelation({ headSha: HEAD, lastCommit, git: fakeGit(plan), branch })

  it('sin last_commit → unset', () => {
    expect(rel(null, {}).kind).toBe('unset')
    expect(rel('', {}).kind).toBe('unset')
    expect(rel('   ', {}).kind).toBe('unset')
  })
  it('un valor que git no resuelve → unresolvable (y no se inventa un SHA)', () => {
    const r = rel('sha_viejo', { 'rev-parse': 1 })
    expect(r.kind).toBe('unresolvable')
    expect(r.stateSha).toBe('')
    expect(r.raw).toBe('sha_viejo')
  })
  it('un valor con pinta de opción de git ni siquiera llega a git', () => {
    let llamado = false
    const r = describeStopRelation({
      headSha: HEAD, lastCommit: '--output=pwned', branch: 'main',
      git: () => { llamado = true; return { status: 0, stdout: HEAD } },
    })
    expect(r.kind).toBe('unresolvable')
    expect(llamado).toBe(false)
  })
  it('mismo commit → same', () => {
    expect(rel(HEAD, { 'rev-parse': HEAD }).kind).toBe('same')
  })
  it('ancestro de HEAD → behind, con el número de commits contado por git', () => {
    const r = rel(OTHER, { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: 0, 'rev-list': '3\n' })
    expect(r.kind).toBe('behind')
    expect(r.count).toBe(3)
  })
  it('HEAD es ancestro del state → ahead', () => {
    const r = rel(OTHER, {
      'rev-parse': OTHER,
      [`is-ancestor:${OTHER}:${HEAD}`]: 1,
      [`is-ancestor:${HEAD}:${OTHER}`]: 0,
      branch: 'otra\nmain\n',
    })
    expect(r.kind).toBe('ahead')
    expect(r.containers).toEqual(['otra'])
  })
  it('sin ancestría en ninguna dirección → diverged, con merge-base y rama que lo contiene', () => {
    const r = rel(OTHER, {
      'rev-parse': OTHER,
      [`is-ancestor:${OTHER}:${HEAD}`]: 1,
      [`is-ancestor:${HEAD}:${OTHER}`]: 1,
      branch: 'polish-v2-geometria\n',
      'merge-base': 'c'.repeat(40),
    })
    expect(r.kind).toBe('diverged')
    expect(r.containers).toEqual(['polish-v2-geometria'])
    expect(r.mergeBase).toBe('c'.repeat(40))
  })
  // Preferencia local → remota: `origin/*` es ruido cuando ya hay una rama
  // local que responde, y la única respuesta posible cuando no la hay.
  const noAncestro = { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: 1, [`is-ancestor:${HEAD}:${OTHER}`]: 1, 'merge-base': 'c'.repeat(40) }

  it('con rama local que lo contiene, ni se pregunta por las remotas', () => {
    const log = []
    const r = describeStopRelation({ headSha: HEAD, lastCommit: OTHER, branch: 'main', git: fakeGit({ ...noAncestro, branch: 'local-viva\n', 'branch-r': 'origin/local-viva\n' }, log) })
    expect(r.containers).toEqual(['local-viva'])
    expect(log.some((a) => a[0] === 'branch' && a[1] === '-r')).toBe(false)
  })
  it('sin rama local, se cae a las remotas y se nombra origin/…', () => {
    const r = rel(OTHER, { ...noAncestro, branch: '', 'branch-r': 'origin/polish-v2\norigin/HEAD\n' })
    expect(r.kind).toBe('diverged')
    expect(r.containers).toEqual(['origin/polish-v2'])
    expect(r.containersKnown).toBe(true)
  })
  it('ni local ni remota lo contienen → orphan (venga de ahead o de diverged)', () => {
    const desdeDiverged = rel(OTHER, { ...noAncestro, branch: '', 'branch-r': '' })
    expect(desdeDiverged.kind).toBe('orphan')
    expect(desdeDiverged.fromKind).toBe('diverged')
    const desdeAhead = rel(OTHER, { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: 1, [`is-ancestor:${HEAD}:${OTHER}`]: 0, branch: '', 'branch-r': '' })
    expect(desdeAhead.kind).toBe('orphan')
    expect(desdeAhead.fromKind).toBe('ahead')
  })
  // "git no ha contestado" no es "ninguna rama lo contiene": declarar huérfano
  // un commit porque `git branch` falló sería inventarse la respuesta.
  it('si git falla al listar ramas NO se declara huérfano', () => {
    const r = rel(OTHER, { ...noAncestro, branch: -1 })
    expect(r.kind).toBe('diverged')
    expect(r.containersKnown).toBe(false)
    expect(r.containers).toEqual([])
  })
  it('git falla al responder la ancestría (código != 0/1) → unknown, no se supone nada', () => {
    const r = rel(OTHER, { 'rev-parse': OTHER, [`is-ancestor:${OTHER}:${HEAD}`]: -1 })
    expect(r.kind).toBe('unknown')
  })
})

describe('classifyStopState', () => {
  const verdict = (kind, extra = {}) =>
    classifyStopState({ relation: { kind, headSha: HEAD, stateSha: OTHER, branch: 'main', count: 0, containers: [], raw: '', ...extra }, stopHookActive: false })

  it('behind bloquea y dice cuántos commits hay, porque los ha contado', () => {
    const v = verdict('behind', { count: 2 })
    expect(v.block).toBe(true)
    expect(v.reason).toMatch(/2 commits/)
    expect(v.reason).toMatch(/`blocked`/)
  })
  it('behind con un solo commit no dice "1 commits"', () => {
    // F15/H4: el conteo es ahora de commits DE TRABAJO (los que solo tocan
    // .agent/STATE.md no cuentan), y el texto lo dice.
    expect(verdict('behind', { count: 1 }).reason).toMatch(/hay 1 commit de trabajo en/)
  })
  it('behind con apuntes por medio los nombra aparte, para que el conteo cuadre con git log', () => {
    const v = verdict('behind', { count: 1, bookkeeping: 2 })
    expect(v.reason).toMatch(/1 commit de trabajo/)
    expect(v.reason).toMatch(/2 commits que solo tocan/)
  })
  it('behind-bookkeeping ni bloquea ni avisa: es el estado normal de un turno registrado', () => {
    const v = verdict('behind-bookkeeping', { count: 0, bookkeeping: 1 })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toBe('')
    expect(v.kind).toBe('behind-bookkeeping')
  })
  it('unresolvable bloquea, cita el valor y NO afirma que sea más viejo', () => {
    const v = verdict('unresolvable', { raw: 'sha_viejo', stateSha: '' })
    expect(v.block).toBe(true)
    expect(v.reason).toMatch(/sha_viejo/)
    expect(v.reason).not.toMatch(/más nuevos|más viejo/)
    expect(v.reason).toMatch(/`blocked`/)
  })
  it('same y unset no dicen nada', () => {
    for (const k of ['same', 'unset']) {
      expect(verdict(k)).toMatchObject({ block: false, reason: '', systemMessage: '' })
    }
  })
  it('ahead no bloquea pero avisa, y desaconseja reapuntar last_commit', () => {
    const v = verdict('ahead', { containers: ['adelantada'] })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/descendiente de HEAD/)
    expect(v.systemMessage).toMatch(/hacia atrás/)
  })
  it('diverged no bloquea, explica por qué, y nombra la salida (un STATE.md por worktree)', () => {
    const v = verdict('diverged', { containers: ['polish-v2-geometria'], mergeBase: 'c'.repeat(40) })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/divergentes/)
    expect(v.systemMessage).toMatch(/polish-v2-geometria/)
    expect(v.systemMessage).toMatch(/ct-next/)
    expect(v.systemMessage).not.toMatch(/más nuevos/)
  })
  // Los avisos salen en CADA turno mientras dure la anomalía. Esa insistencia
  // es deliberada, y el precio se paga en brevedad: si vuelven a engordar,
  // esto se pone rojo.
  it('los avisos que se repiten cada turno se mantienen cortos', () => {
    expect(verdict('diverged', { containers: ['polish-v2-geometria'], mergeBase: 'c'.repeat(40) }).systemMessage.length).toBeLessThan(340)
    expect(verdict('ahead', { containers: ['adelantada'] }).systemMessage.length).toBeLessThan(280)
    expect(verdict('orphan').systemMessage.length).toBeLessThan(340)
  })
  it('sin ninguna rama conocida (git calló) la frase no se queda coja', () => {
    const v = verdict('diverged', { containers: [], containersKnown: false, mergeBase: 'c'.repeat(40) })
    expect(v.systemMessage).toMatch(/no está en la historia de la rama `main`/)
    expect(v.systemMessage).not.toMatch(/vive en ,|vive en :/)
    expect(verdict('ahead', { containers: [] }).systemMessage).not.toMatch(/vive en /)
  })
  // Un `last_commit` que no alcanza ningún ref no es "el estado va por
  // delante": es el estado apuntando a trabajo que dejó de existir.
  it('orphan no bloquea (un bloqueo no resucita un commit) y no se confunde con ahead', () => {
    const v = verdict('orphan', { fromKind: 'ahead' })
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/huérfano/)
    expect(v.systemMessage).toMatch(/ni local ni remota/)
    expect(v.systemMessage).toMatch(/git gc/)
    expect(v.systemMessage).not.toMatch(/va por delante|hacia atrás|divergentes/)
  })
  it('unknown no bloquea y admite que no sabe', () => {
    const v = verdict('unknown')
    expect(v.block).toBe(false)
    expect(v.systemMessage).toMatch(/no ha podido determinar/)
  })
  it('anti-bucle: con stop_hook_active no bloquea NI avisa, sea cual sea el caso', () => {
    for (const kind of ['behind', 'unresolvable', 'diverged', 'ahead', 'orphan', 'unknown']) {
      const v = classifyStopState({ relation: { kind, headSha: HEAD, stateSha: OTHER, count: 9 }, stopHookActive: true })
      expect(v).toMatchObject({ block: false, reason: '', systemMessage: '' })
    }
  })
  it('HEAD desprendido: no se inventa una rama', () => {
    const v = verdict('behind', { count: 1, branch: '' })
    expect(v.reason).toMatch(/desprendido/)
    expect(v.reason).not.toMatch(/rama `/)
  })
})

// ===========================================================================
// #95/H10 — la hidratación inyectaba el frontmatter ENTERO, comentarios
// incluidos: unos 1.200 B de `#` de la plantilla que el modelo pagaba en cada
// startup|resume|clear|compact sin que le dijeran nada que `fieldReadingGuide`
// no diga ya cuando aplica.
// ===========================================================================
describe('composeHydration: los comentarios del frontmatter no viajan', () => {
  const CON_COMENTARIOS = [
    '---',
    'task: "X"',
    '# role: quién eres en el loop. Hay DOS sesiones vivas por repo',
    '#   - Este fichero es el del CHECKOUT PRINCIPAL',
    'role: "coordinador"',
    'verify: "grep \'#\' fichero devuelve 3 líneas"',
    '---',
    '## Current State',
    '# esto es un encabezado del cuerpo, no un comentario',
    'voy por T7',
  ].join('\n')

  it('las líneas que empiezan por # dentro del frontmatter desaparecen', () => {
    const out = composeHydration(CON_COMENTARIOS, '')
    expect(out).not.toContain('quién eres en el loop')
    expect(out).not.toContain('CHECKOUT PRINCIPAL')
  })
  it('los campos del frontmatter y el cuerpo siguen enteros, incluido un # dentro de un valor y un encabezado del cuerpo', () => {
    const out = composeHydration(CON_COMENTARIOS, '')
    expect(out).toContain('task: "X"')
    expect(out).toContain('role: "coordinador"')
    expect(out).toContain('verify: "grep \'#\' fichero devuelve 3 líneas"')
    expect(out).toContain('# esto es un encabezado del cuerpo, no un comentario')
    expect(out).toContain('voy por T7')
  })
  it('la plantilla vacía hidrata en menos de 1.000 bytes', () => {
    const tpl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'state-template', 'STATE.template.md'), 'utf8')
    expect(Buffer.byteLength(tpl, 'utf8')).toBeGreaterThan(1000)
    expect(Buffer.byteLength(composeHydration(tpl, ''), 'utf8')).toBeLessThan(1000)
  })
})

// ===========================================================================
// #95/H8 — el aviso no bloqueante salía en CADA turno mientras durase la
// anomalía. La insistencia era deliberada, pero el propio proyecto ya tiene
// escrita la sentencia que la desmonta: «un aviso que sale siempre es un aviso
// que nadie lee» (la cabecera de `blocked`, en este mismo módulo).
// ===========================================================================
describe('noticeDecision: el aviso sale la primera vez, cuando cambia, y cada N turnos', () => {
  const rel = { kind: 'ahead', stateSha: OTHER }

  it('el primer turno de la anomalía siempre avisa', () => {
    expect(noticeDecision({ relation: rel, previous: null }).emit).toBe(true)
  })

  it('los turnos siguientes callan hasta que se cumple el periodo', () => {
    let previous = null
    const emitidos = []
    for (let turno = 1; turno <= 5; turno++) {
      const d = noticeDecision({ relation: rel, previous })
      if (d.emit) emitidos.push(turno)
      previous = d.next
    }
    expect(emitidos).toEqual([1])
  })

  it('a los N turnos vuelve a salir, y el periodo empieza de nuevo', () => {
    let previous = null
    const emitidos = []
    for (let turno = 1; turno <= NOTICE_REPEAT_EVERY_TURNS * 2; turno++) {
      const d = noticeDecision({ relation: rel, previous })
      if (d.emit) emitidos.push(turno)
      previous = d.next
    }
    expect(emitidos).toEqual([1, NOTICE_REPEAT_EVERY_TURNS + 1])
  })

  it('cambiar de relación avisa aunque el periodo no se haya cumplido: es otra anomalía', () => {
    const primera = noticeDecision({ relation: rel, previous: null })
    const segunda = noticeDecision({ relation: { kind: 'diverged', stateSha: OTHER }, previous: primera.next })
    expect(segunda.emit).toBe(true)
  })

  it('el mismo tipo apuntando a OTRO commit también es otra anomalía', () => {
    const primera = noticeDecision({ relation: rel, previous: null })
    const segunda = noticeDecision({ relation: { kind: 'ahead', stateSha: HEAD }, previous: primera.next })
    expect(segunda.emit).toBe(true)
  })

  it('un marcador ilegible o de otra forma no silencia nada: se avisa', () => {
    for (const previous of ['no es json', 42, {}, { kind: 'ahead' }]) {
      expect(noticeDecision({ relation: rel, previous }).emit).toBe(true)
    }
  })
})
