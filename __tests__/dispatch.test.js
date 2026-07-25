import { describe, it, expect } from 'vitest'
import { selectNext, resolveAccount, buildCmuxArgv } from '../scripts/dispatch.js'

const ISSUES = [
  { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'] },
  { n: 2, order: 2, status: 'ready',     deps: [1], touches: ['api'] },
  { n: 3, order: 3, status: 'ready',     deps: [],  touches: ['ui'] },
  { n: 4, order: 4, status: 'ready',     deps: [],  touches: ['migration'] },
  { n: 5, order: 5, status: 'ready',     deps: [],  touches: ['migration'] },
]

describe('selectNext', () => {
  it('no elige un slice cuya dep no está mergeada', () => {
    const out = selectNext(ISSUES, { mergedIssues: [], runningTouches: [], concurrencyCap: 5 })
    expect(out.find((i) => i.n === 2)).toBeUndefined() // dep #1 no mergeada
  })
  it('elige el slice con dep mergeada', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 5 })
    expect(out.some((i) => i.n === 2)).toBe(true)
  })
  it('paraleliza touches disjuntos hasta el cap', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 2 })
    expect(out).toHaveLength(2)
  })
  it('serializa touches:migration (solo uno de #4/#5)', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 9 })
    const migs = out.filter((i) => i.touches.includes('migration'))
    expect(migs).toHaveLength(1)
    expect(migs[0].n).toBe(4) // el de menor orden
  })
  it('no elige si su touches choca con runningTouches', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: ['api'], concurrencyCap: 9 })
    expect(out.find((i) => i.n === 2)).toBeUndefined()
  })
  it('respeta orden ascendente', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 9 })
    expect(out.map((i) => i.n)).toEqual([...out.map((i) => i.n)].sort((a, b) => a - b))
  })
  it('serialización cross-type: solo uno de touches:ci o touches:migration', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['ci'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['migration'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: 9 })
    const serializingCount = out.filter((i) => i.touches.some((t) => ['ci', 'migration'].includes(t))).length
    expect(serializingCount).toBe(1)
    expect(out[0].n).toBe(1) // menor orden
  })
  it('runningTouches:migration bloquea candidato con touches:ci', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: ['migration'], concurrencyCap: 9 })
    expect(out.find((i) => i.n === 1)).toBeUndefined()
  })
  it('no-serializing disjuntos se paralelizan (control negativo)', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(out).toHaveLength(2)
  })
})

describe('resolveAccount', () => {
  const MAP = { personal: ['menoplus', 'control-tower'], work: ['mo.foo'], personalDir: '/p', workDir: '/w' }
  it('repo personal → personalDir', () => expect(resolveAccount('menoplus', MAP)).toBe('/p'))
  it('repo work → workDir', () => expect(resolveAccount('mo.foo', MAP)).toBe('/w'))
  it('desconocido → personalDir (default)', () => expect(resolveAccount('otro', MAP)).toBe('/p'))
})

describe('buildCmuxArgv', () => {
  it('devuelve argv sin shell, prompt como un solo elemento', () => {
    const argv = buildCmuxArgv({ name: 'r · #7 x', cwd: '/wt', command: "claude 'a b'\n#2" })
    expect(argv[0]).toBe('new-workspace')
    expect(argv).toContain('--name'); expect(argv).toContain('r · #7 x')
    expect(argv).toContain('--cwd'); expect(argv).toContain('/wt')
    expect(argv).toContain('--command')
    const ci = argv.indexOf('--command')
    expect(argv[ci + 1]).toBe("claude 'a b'\n#2") // intacto, sin escapar
  })

  // T10, hallazgo en vivo contra el sandbox: `cmux` es un cliente que habla
  // con un daemon ya en marcha por socket Unix — un env var puesto en
  // `execFileSync('cmux', argv, {env})` muere con ese proceso cliente y
  // NUNCA llega al pty real que crea el daemon. Sin pasar `--env
  // KEY=VALUE` explícitamente en el argv, CLAUDE_CONFIG_DIR no llega a la
  // sesión y esta se queda colgada en el selector interactivo de cuenta.
  it('sin env → ningún --env en el argv (compat con llamadas previas)', () => {
    const argv = buildCmuxArgv({ name: 'x', cwd: '/wt', command: 'claude' })
    expect(argv).not.toContain('--env')
  })
  it('con env → un --env KEY=VALUE por entrada, ANTES de --command', () => {
    const argv = buildCmuxArgv({ name: 'x', cwd: '/wt', command: 'claude', env: { CLAUDE_CONFIG_DIR: '/Users/x/.claude-personal' } })
    const ei = argv.indexOf('--env')
    expect(ei).toBeGreaterThan(-1)
    expect(argv[ei + 1]).toBe('CLAUDE_CONFIG_DIR=/Users/x/.claude-personal')
    expect(argv.indexOf('--env')).toBeLessThan(argv.indexOf('--command'))
  })
  it('con varias entradas de env → un --env por cada una', () => {
    const argv = buildCmuxArgv({ command: 'claude', env: { A: '1', B: '2' } })
    const envPairs = argv.reduce((acc, tok, i) => (tok === '--env' ? [...acc, argv[i + 1]] : acc), [])
    expect(envPairs).toEqual(['A=1', 'B=2'])
  })
})
