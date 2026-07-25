import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')

const SPEC = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
| 2 | refresh | backend | flow | #1 | AC-2.1 | – |
`

describe('ct-groom --dry-run', () => {
  it('imprime el plan sin tocar gh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8' })
    const plan = JSON.parse(out)
    expect(plan.milestone).toBe('Epic')
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues[1].labels).toContain('type:backend')
    expect(plan.issues[1].body).toContain('merge-after #1')
    rmSync(dir, { recursive: true, force: true })
  })
})
