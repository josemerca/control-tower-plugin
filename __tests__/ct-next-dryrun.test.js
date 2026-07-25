import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shQuote } from '../scripts/shquote.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')

function run(args, envOverrides = {}) {
  try {
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...envOverrides } })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// El wrapper acepta CT_NEXT_FIXTURE (JSON de {issues, mergedIssues}) para test sin red.
const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], entrega: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], entrega: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next --dry-run', () => {
  it('elige #2 e imprime worktree + cmux', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toContain('#2')
    expect(r.out).toContain('git worktree add')
    expect(r.out).toContain('cmux')
    expect(r.out).toContain('new-workspace')
    expect(r.out).toMatch(/\.claude-personal/) // account map: menoplus → personal
  })

  it('no reproduce la garantía de fixture con un slice sin ac/issue (defensivo: no crashea)', () => {
    // La forma del fixture del brief NO trae `ac`/`issue` — igual que un issue
    // real sin cuerpo de acceptance-criteria reconocible. renderKickoff/
    // buildStateSeed indexan slice.ac como array; si el wrapper no lo
    // normaliza, esto revienta con un TypeError en vez de imprimir el plan.
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/TypeError/)
  })
})

describe('ct-next — fixture atado a --dry-run', () => {
  it('CT_NEXT_FIXTURE puesto SIN --dry-run → exit 2, no decide ni lanza nada real', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_FIXTURE.*--dry-run/is)
  })
})

describe('ct-next — nada despachable', () => {
  it('imprime mensaje claro y exit 0 cuando no hay slices ready con deps mergeadas', () => {
    const fixtureNadaReady = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], entrega: 'login', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], entrega: 'refresh', type: 'backend' },
      ],
      mergedIssues: [], // #1 no mergeado todavía → #2 bloqueado por deps
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fixtureNadaReady })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no hay slices despachables/i)
  })
})

describe('ct-next — errores de uso', () => {
  it('sin --repo → exit 2', () => {
    const r = run(['--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/uso:/)
  })

  it('--repo colgante (último token, sin valor) → exit 2', () => {
    const r = run(['--cap', '1', '--dry-run', '--repo'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/uso:/)
  })

  it('--repo seguido de otro flag (sin valor real) → exit 2', () => {
    const r = run(['--repo', '--dry-run'])
    expect(r.code).toBe(2)
  })

  it('--cap no numérico → exit 2', () => {
    const r = run(['--repo', 'o/r', '--cap', 'nope', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--cap/i)
  })
})

describe('shQuote (Override 1: escapado POSIX del prompt de kickoff)', () => {
  // Verifica, contra un shell POSIX real, que el valor que le llega al
  // programa tras el round-trip de parseo de shell es byte-idéntico al
  // original — no una aproximación visual. Usamos `set --` para fijar los
  // argumentos posicionales a partir del valor citado y comprobamos que
  // produce EXACTAMENTE un argumento (si el citado estuviera roto y el shell
  // partiera la palabra, $# sería > 1 y lo detectaríamos aquí en vez de
  // limitarnos a leer $1 y enmascarar el bug).
  function shellRoundTrip(value) {
    const quoted = shQuote(value)
    const script = `set -- ${quoted}\nif [ "$#" -ne 1 ]; then echo "ARGC:$#"; exit 1; fi\nprintf '%s' "$1"`
    return execFileSync('sh', ['-c', script], { encoding: 'utf8' })
  }

  const cases = {
    'texto plano': 'hola mundo',
    'variable de entorno': 'no expandas $HOME por favor',
    backticks: 'esto `no` es un comando',
    'comilla simple literal': "el valor tiene una comilla ' suelta",
    backslash: 'una barra \\ invertida literal',
    'salto de línea': 'primera línea\nsegunda línea',
    'todo junto (caso trampa)': "cd $HOME && echo `whoami` && rm -rf ' \\ \n fin",
  }

  for (const [label, value] of Object.entries(cases)) {
    it(`round-trip byte-idéntico a través de un shell POSIX real: ${label}`, () => {
      expect(shellRoundTrip(value)).toBe(value)
    })
  }
})
