import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = () => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` })
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

function runGroom(specMd) {
  const dir = makeSpecDir('ctg-dec-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specMd)
  try {
    return { status: 0, stdout: execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() }) }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  } finally {
    rmSyncBestEffort(dir)
  }
}

const HYP = '## Hipótesis\n\nApuesta del fixture.\n\n'
const TABLE = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

describe('ct-groom --dry-run — decisiones congeladas', () => {
  it('proyecta la sección al cuerpo, sin la procedencia', () => {
    const DEC = '## Decisiones congeladas\n- **D-1 · versión** — iOS 17. *(Procedencia: hablada.)*\n\n'
    const r = runGroom(HYP + DEC + TABLE)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('## Decisiones congeladas')
    expect(r.stdout).toContain('iOS 17')
    expect(r.stdout).not.toContain('Procedencia')
  })
  it('sin la sección, el cuerpo no la lleva', () => {
    const r = runGroom(HYP + TABLE)
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('## Decisiones congeladas')
  })
})
