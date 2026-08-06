// F29 — EL BINARIO QUE SE TECLEA SALE DE LA CUENTA, NO DE UNA CONSTANTE.
//
// El hallazgo que originó esto se midió contra el `.zshrc` real de la máquina:
// `claude` era una FUNCIÓN de shell que preguntaba «¿Qué cuenta? 1/2» sin
// mirar `CLAUDE_CONFIG_DIR` y que además lo pisaba con su propio `export`. Un
// shell de login resuelve la función antes que cualquier PATH, así que el
// agente despachado se quedaba en el `read` para siempre — y `/ct-next` lo
// daba por LANZADO, con exit 0, porque el centinela se escribe antes de
// invocar al agente y `command -v claude` devuelve 0 para una función.
//
// El arreglo es teclear el wrapper NO INTERACTIVO de la cuenta ya resuelta.
// Lo que estos tests defienden no es el nombre concreto, es que sea LA CUENTA
// quien lo elija: clavar `claude-personal` habría arrancado un repo de
// `mercadona/*` con la cuenta personal mientras ct-next.mjs imprimía
// «(trabajo)» — el defecto de D4, reintroducido por la puerta de al lado.
//
// Cada bloque se comprobó contra el código sin arreglar. Los tres que pueden
// hacerlo sin PATH ni subprocesos van como unitarios; el de extremo a extremo
// existe porque el nombre tiene que llegar a DOS sitios (la línea del agente y
// el `command -v` del launcher) y un unitario solo cubre uno.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_MAP } from '../scripts/kickoff.js'
import { resolveAccount, validateAccountMap, DEFAULT_AGENT_BIN } from '../scripts/dispatch.js'
import { buildLauncherScript } from '../scripts/launch-sentinel.js'
import { shQuote } from '../scripts/shquote.js'
import { hermeticEnv, ACCOUNT_ENV } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')

const FIXTURE_ONE_READY = JSON.stringify({
  issues: [{ n: 42, order: 1, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: ['AC-1'], issue: '#42' }],
  mergedIssues: [],
})

function run(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...hermeticEnv(), ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

describe('F29 — el defecto del mapa son los wrappers, no `claude`', () => {
  // Este test mira el ACCOUNT_MAP de verdad, sin el entorno hermético
  // delante: es el único sitio donde se puede afirmar qué se teclearía en
  // esta máquina si nadie pone un override.
  it('ACCOUNT_MAP trae un binario por cuenta, y son los wrappers no interactivos', () => {
    expect(ACCOUNT_MAP.personalBin).toBe('claude-personal')
    expect(ACCOUNT_MAP.workBin).toBe('claude-work')
  })

  it('los dos nombres del mapa real pasan la validación', () => {
    expect(validateAccountMap(ACCOUNT_MAP)).toEqual([])
  })
})

describe('F29 — resolveAccount elige el binario por la MISMA regla que el config dir', () => {
  const MAP = {
    personal: ['josemerca/*', '*/menoplus'],
    work: ['mercadona/*', '*/mo.*'],
    personalDir: '/p',
    workDir: '/w',
    personalBin: 'claude-personal',
    workBin: 'claude-work',
  }

  it('un repo de trabajo se teclea con el wrapper de TRABAJO (clavar claude-personal lo habría roto en silencio)', () => {
    const r = resolveAccount('mercadona/algun-tool-interno', MAP)
    expect(r.account).toBe('work')
    expect(r.dir).toBe('/w')
    expect(r.bin).toBe('claude-work')
  })

  it('un repo personal se teclea con el wrapper personal', () => {
    const r = resolveAccount('josemerca/lo-que-sea', MAP)
    expect(r.dir).toBe('/p')
    expect(r.bin).toBe('claude-personal')
  })

  it('el fallback por defecto (ningún patrón casa) también trae binario, no undefined', () => {
    const r = resolveAccount('desconocido/otro', MAP)
    expect(r.matched).toBe(false)
    expect(r.bin).toBe('claude-personal')
  })

  it('un slug malformado no deja el binario sin resolver: se despacharía con `undefined` como comando', () => {
    expect(resolveAccount('menoplus', MAP).bin).toBe('claude-personal')
  })

  it('un mapa ANTERIOR a F29 (sin binarios) cae a `claude` — el defecto conserva el comportamiento viejo, no lo adivina', () => {
    const viejo = { personal: ['josemerca/*'], work: ['mercadona/*'], personalDir: '/p', workDir: '/w' }
    expect(resolveAccount('josemerca/x', viejo).bin).toBe(DEFAULT_AGENT_BIN)
    expect(resolveAccount('mercadona/x', viejo).bin).toBe(DEFAULT_AGENT_BIN)
    expect(validateAccountMap(viejo)).toEqual([])
  })
})

describe('F29 — validateAccountMap: el binario viaja SIN COMILLAS a un script que se sourcea', () => {
  const OK = { personal: ['a/b'], work: ['c/d'], personalDir: '/p', workDir: '/w' }

  it('un nombre con espacio se rechaza nombrando la clave', () => {
    const errs = validateAccountMap({ ...OK, personalBin: 'claude personal' })
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatch(/personalBin/)
  })

  it('inyección de shell: un `;` no es un nombre de comando raro, es otra orden', () => {
    expect(validateAccountMap({ ...OK, workBin: 'claude; rm -rf /' }).join(' ')).toMatch(/workBin/)
  })

  it('tampoco una ruta: quien necesite una, que ponga su directorio en el PATH del shell de login', () => {
    expect(validateAccountMap({ ...OK, personalBin: '/usr/local/bin/claude' }).join(' ')).toMatch(/personalBin/)
  })

  it('vacío y no-string se rechazan (un `bin` vacío dejaría `command -v` sin argumento)', () => {
    expect(validateAccountMap({ ...OK, personalBin: '' }).join(' ')).toMatch(/personalBin/)
    expect(validateAccountMap({ ...OK, workBin: 42 }).join(' ')).toMatch(/workBin/)
  })

  it('un nombre normal pasa, y la ausencia también (mapa anterior a F29)', () => {
    expect(validateAccountMap({ ...OK, personalBin: 'claude-personal', workBin: 'claude_work.2' })).toEqual([])
    expect(validateAccountMap(OK)).toEqual([])
  })
})

describe('F29 — el launcher comprueba el binario que de verdad va a teclear', () => {
  it('`command -v` usa el binario recibido, no `claude` a secas', () => {
    const s = buildLauncherScript(
      { sentinelPath: '/tmp/s', agentCommand: 'claude-work --x', agentBin: 'claude-work', issue: 7, worktree: '/wt' },
      shQuote,
    )
    expect(s).toMatch(/command -v claude-work /)
    // La comprobación del binario EQUIVOCADO ya no aparece: si apareciera, el
    // centinela diría `ok` sobre un `claude` que existe mientras el agente
    // muere con "command not found" — o, peor, ct-next.mjs borraría worktree y
    // claim por un binario que no era el que se iba a usar.
    expect(s).not.toMatch(/command -v claude /)
  })

  it('sin agentBin NO se construye un launcher a medias: se lanza', () => {
    expect(() => buildLauncherScript(
      { sentinelPath: '/tmp/s', agentCommand: 'claude --x', issue: 7, worktree: '/wt' },
      shQuote,
    )).toThrow(/agentBin/)
  })
})

describe('F29 — de extremo a extremo: el nombre llega a la línea del agente y al preflight', () => {
  it('un repo de TRABAJO teclea el wrapper de trabajo, y el preflight busca ese mismo nombre', () => {
    const r = run(
      ['--repo', 'mercadona/algun-tool-interno', '--cap', '1', '--dry-run'],
      { CT_NEXT_FIXTURE: FIXTURE_ONE_READY, CT_AGENT_BIN_WORK: 'claude-work', CT_AGENT_BIN_PERSONAL: 'claude-personal' },
    )
    expect(r.code).toBe(0)
    // La cuenta y el binario se dicen en la MISMA línea: son las dos mitades
    // de «con qué cuenta se despacha», y separarlas es lo que dejaba pasar una
    // discrepancia entre lo que el mapa elige y lo que el wrapper exporta.
    expect(r.out).toMatch(/cuenta resuelta:.*\(trabajo\).*Binario del agente: claude-work\./)
    expect(r.out).toMatch(/^claude-work --dangerously-skip-permissions '/m)
    expect(r.out).not.toMatch(/^claude --dangerously-skip-permissions '/m)
  })

  // Deliberadamente un nombre que NO puede existir en ninguna máquina. La
  // primera versión de este test usaba `claude-work` y pasaba en verde por el
  // motivo equivocado: el PATH hermético lleva el PATH real detrás y en la
  // máquina de desarrollo hay un `~/.local/bin/claude-work` de verdad, así que
  // el preflight lo ENCONTRABA. Un test sobre la ausencia de un binario no
  // puede depender de que quien lo corra no lo tenga instalado.
  it('el preflight avisa con el nombre del wrapper, no con `claude` — y avisa, no aborta', () => {
    const r = run(
      ['--repo', 'josemerca/lo-que-sea', '--cap', '1', '--dry-run'],
      { CT_NEXT_FIXTURE: FIXTURE_ONE_READY, CT_AGENT_BIN_PERSONAL: 'claude-f29-no-instalado' },
    )
    expect(r.out).toMatch(/`claude-f29-no-instalado` no aparece en el PATH/)
    expect(r.out).not.toMatch(/`claude` no aparece en el PATH/)
    expect(r.code).toBe(0)
  })

  it('el mismo fixture con un repo PERSONAL teclea el otro wrapper — es la cuenta la que decide', () => {
    const r = run(
      ['--repo', 'josemerca/lo-que-sea', '--cap', '1', '--dry-run'],
      { CT_NEXT_FIXTURE: FIXTURE_ONE_READY, CT_AGENT_BIN_WORK: 'claude-work', CT_AGENT_BIN_PERSONAL: 'claude-personal' },
    )
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cuenta resuelta:.*\(personal\).*Binario del agente: claude-personal\./)
    expect(r.out).toMatch(/^claude-personal --dangerously-skip-permissions '/m)
  })

  it('un binario malformado en el override aborta al arrancar (exit 2), antes de tocar nada', () => {
    const r = run(
      ['--repo', 'josemerca/lo-que-sea', '--cap', '1', '--dry-run'],
      { CT_NEXT_FIXTURE: FIXTURE_ONE_READY, CT_AGENT_BIN_PERSONAL: 'claude; touch /tmp/ct-f29-pwned' },
    )
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/personalBin/)
  })

  it('el entorno hermético de la suite usa `claude` por override, no por defecto del código', () => {
    // Si alguien borra CT_AGENT_BIN_* de hermetic-env.js, este test se cae y
    // deja claro por qué 40 tests se pusieron rojos: el stub del PATH se llama
    // `claude` y el código ya no busca ese nombre por su cuenta.
    expect(ACCOUNT_ENV.CT_AGENT_BIN_PERSONAL).toBe('claude')
    expect(ACCOUNT_ENV.CT_AGENT_BIN_WORK).toBe('claude')
  })
})
