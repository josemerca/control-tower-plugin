// F35 — FUERA LA RESOLUCIÓN DE CUENTA.
//
// Decisión del usuario (hablada con José): el loop deja de evaluar «qué cuenta
// hace qué». Se van el mapa de proyectos (ACCOUNT_MAP), la resolución
// (resolveAccount), el mapa viejo conservado para detectar reclasificaciones
// (resolveAccountLegacy + legacy) y toda su cascada en ct-next.mjs: el
// preflight de CLAUDE_CONFIG_DIR, el `--env CLAUDE_CONFIG_DIR` que viajaba al
// daemon de cmux, y los cuatro avisos que anunciaban cuenta, fallback,
// conflicto y reclasificación.
//
// Lo que queda: se teclea UN binario, `claude`, con la configuración ambiente
// de quien lanza. `CT_AGENT_BIN` sobrevive como único override — no es una
// cuenta, es el nombre del ejecutable, y existe por la razón que documentaba
// F29: en el .zshrc real de la máquina `claude` era una FUNCIÓN de shell
// interactiva («¿Qué cuenta? 1/2») que dejaba al agente colgado en un `read`
// mientras ct-next lo daba por lanzado. Sin cuentas, ese riesgo vuelve, y este
// override es la única salida que no reintroduce el mapa.
//
// parseRepoSlug NO se va: vive en el mismo bloque pero tiene tres consumidores
// ajenos a las cuentas (ct-status.mjs, ct-harvest.mjs y ct-next.mjs validando
// `--repo`).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as kickoff from '../scripts/kickoff.js'
import * as dispatch from '../scripts/dispatch.js'
import { hermeticEnv } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')

const FIXTURE_ONE_READY = JSON.stringify({
  issues: [{ n: 42, order: 1, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: ['AC-1'], issue: '#42' }],
  mergedIssues: [],
})

function run(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...hermeticEnv(), ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

describe('F35 — el mapa de cuentas ya no existe', () => {
  it('kickoff.js no exporta ACCOUNT_MAP', () => {
    expect(kickoff.ACCOUNT_MAP).toBeUndefined()
  })

  it('dispatch.js no exporta nada de la resolución de cuenta', () => {
    for (const sym of ['resolveAccount', 'resolveAccountLegacy', 'validateAccountMap', 'matchesAccountPattern', 'accountPatternError', 'DEFAULT_AGENT_BIN']) {
      expect(dispatch[sym], `dispatch.js sigue exportando ${sym}`).toBeUndefined()
    }
  })

  // El corte no se lleva por delante al vecino: parseRepoSlug vivía en el
  // mismo bloque y lo usan ct-status, ct-harvest y ct-next para validar --repo.
  it('parseRepoSlug sobrevive y sigue validando `owner/repo`', () => {
    expect(dispatch.parseRepoSlug('o/r')).toEqual({ owner: 'o', name: 'r' })
    expect(dispatch.parseRepoSlug('sin-owner')).toBeNull()
  })

  // Este test mira CÓDIGO EJECUTABLE, no comentarios. Dos referencias
  // sobreviven a propósito y no son deuda escondida:
  //   - los comentarios de buildCmuxArgv en dispatch.js, que documentan con
  //     evidencia medida cómo se comporta el `--env` de cmux (el mecanismo
  //     sigue existiendo y sigue testeado; lo que ya no hay es un caller que
  //     le pase nada);
  //   - ct-init.sh, donde la mención vive DENTRO del bloque del contrato de
  //     slices que se siembra en el AGENTS.md de cada repo. Cambiar ese texto
  //     altera su hash y obliga a subir SLICES_CONTRACT_VERSION, que es un
  //     protocolo con opt-in explícito del usuario (--update-slices-contract):
  //     no es algo que se cuele de rebote en este borrado.
  it('ningún módulo importa ya los símbolos de cuenta', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const dir = join(here, '..', 'scripts')
    const offenders = []
    for (const f of readdirSync(dir)) {
      if (!/\.(js|mjs)$/.test(f)) continue
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (line.trimStart().startsWith('//')) continue
        for (const sym of ['ACCOUNT_MAP', 'resolveAccount', 'resolveAccountLegacy', 'validateAccountMap', 'CT_ACCOUNT_']) {
          if (line.includes(sym)) offenders.push(`${f}: ${sym} en \`${line.trim().slice(0, 60)}\``)
        }
      }
    }
    expect(offenders).toEqual([])
  })

})

describe('F35 — el dry-run ya no habla de cuentas', () => {
  const dry = () => run(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })

  it('no anuncia cuenta resuelta, ni fallback, ni CLAUDE_CONFIG_DIR', () => {
    const { out } = dry()
    expect(out).not.toMatch(/cuenta resuelta/)
    expect(out).not.toMatch(/CLAUDE_CONFIG_DIR/)
    expect(out).not.toMatch(/ACCOUNT_MAP/)
    expect(out).not.toMatch(/CAMBIO DE CUENTA/)
  })

  // El argv de cmux llevaba `--env CLAUDE_CONFIG_DIR=<dir>`. Sin cuenta que
  // resolver no hay nada que exportar: la sesión hereda la config ambiente.
  it('el argv de cmux no lleva ningún --env', () => {
    const { out } = dry()
    const cmuxLine = out.split('\n').find((l) => l.includes('cmux') && l.includes('new-workspace'))
    expect(cmuxLine, 'no se encontró la línea de cmux en el dry-run').toBeTruthy()
    expect(cmuxLine).not.toMatch(/--env/)
  })

  it('el comando del agente teclea `claude`, y CT_AGENT_BIN lo puede cambiar', () => {
    expect(dry().out).toMatch(/claude --dangerously-skip-permissions/)
    const { out } = run(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY, CT_AGENT_BIN: 'claude-otro' })
    expect(out).toMatch(/claude-otro --dangerously-skip-permissions/)
  })
})
