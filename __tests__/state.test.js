import { describe, it, expect } from 'vitest'
import { parseState, parseStateSafe, renderState, composeHydration, readBlocked, blockNotice, fieldReadingGuide, shouldBlockStop } from '../scripts/state.js'

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
    expect(out.indexOf('TRABAJO BLOQUEADO')).toBeLessThan(out.indexOf('# Estado del slice'))
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
    const aviso = o.slice(0, o.indexOf('# Estado del slice'))
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
    expect(out.startsWith('# Estado del slice')).toBe(true)
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

describe('shouldBlockStop', () => {
  it('bloquea si HEAD avanzó más allá del STATE', () => {
    expect(shouldBlockStop({ headSha: 'def', stateSha: 'abc' })).toBe(true)
  })
  it('no bloquea si están a la par', () => {
    expect(shouldBlockStop({ headSha: 'abc', stateSha: 'abc' })).toBe(false)
  })
  it('no bloquea sin STATE previo', () => {
    expect(shouldBlockStop({ headSha: 'def', stateSha: '' })).toBe(false)
  })
  it('anti-bucle: no bloquea si stop_hook_active', () => {
    expect(shouldBlockStop({ headSha: 'def', stateSha: 'abc', stopHookActive: true })).toBe(false)
  })
})
