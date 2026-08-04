import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { assessLocalLiveness } from '../scripts/liveness.js'

// assessLocalLiveness responde "¿hay rastro de este slice en esta máquina?",
// que NO es lo mismo que "¿alguien está trabajando en él ahora?". La distinción
// importa y no es teórica: un slice que muere a medias deja worktree y rama en
// disco, así que esta función lo sigue viendo vivo.
describe('assessLocalLiveness', () => {
  const conRepo = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-liveness-'))
    try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  it('con worktree en disco no consulta cmux: basta UNA señal para no emitir nota', () => {
    conRepo((repoRoot) => {
      mkdirSync(join(repoRoot, '.worktrees/7'), { recursive: true })
      let consultado = false
      const r = assessLocalLiveness(7, () => { consultado = true; return [] }, { repoRoot, timeoutMs: 1000 })
      expect(r.hasWorktree).toBe(true)
      expect(consultado).toBe(false)
      expect(r.cmuxChecked).toBe(false)
    })
  })

  it('sin worktree ni rama SÍ consulta cmux, y encuentra la ventana por su número', () => {
    conRepo((repoRoot) => {
      const r = assessLocalLiveness(7, () => ['algún-repo · #7 hacer cosas'], { repoRoot, timeoutMs: 1000 })
      expect(r.hasWorktree).toBe(false)
      expect(r.hasCmuxWorkspace).toBe(true)
      expect(r.cmuxChecked).toBe(true)
    })
  })

  it('#7 no casa con #71: el número se compara como token completo', () => {
    conRepo((repoRoot) => {
      const r = assessLocalLiveness(7, () => ['repo · #71 otra cosa'], { repoRoot, timeoutMs: 1000 })
      expect(r.hasCmuxWorkspace).toBe(false)
    })
  })

  it('cmux no consultable → cmuxChecked false, y NO se afirma que no haya sesión', () => {
    conRepo((repoRoot) => {
      const r = assessLocalLiveness(7, () => null, { repoRoot, timeoutMs: 1000 })
      expect(r.cmuxChecked).toBe(false)
      expect(r.hasCmuxWorkspace).toBe(false)
    })
  })
})
