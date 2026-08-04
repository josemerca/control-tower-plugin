import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { assessLocalLiveness, liveSliceProcesses } from '../scripts/liveness.js'

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

// La salida de `lsof -Fpn` son tripletes: p<pid> / fcwd / n<ruta>.
const lsofFalso = (pares) => pares.map(([pid, cwd]) => `p${pid}\nfcwd\nn${cwd}`).join('\n') + '\n'

describe('liveSliceProcesses', () => {
  const raiz = '/repo'

  it('mapea cada proceso a su slice por el segmento que sigue a .worktrees/', () => {
    const run = (cmd) => cmd === 'pgrep' ? '100\n200\n' : lsofFalso([
      ['100', '/repo/.worktrees/7'],
      ['200', '/otro/sitio'],
    ])
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect([...r.porSlice]).toEqual([['7', '100']])
  })

  it('un cwd MÁS PROFUNDO que la raíz del worktree cuenta igual', () => {
    const run = (cmd) => cmd === 'pgrep' ? '100\n' : lsofFalso([['100', '/repo/.worktrees/9/apps/backend']])
    expect([...liveSliceProcesses(raiz, { run }).porSlice]).toEqual([['9', '100']])
  })

  it('sin procesos claude (pgrep sale 1) es una respuesta VÁLIDA, no un fallo', () => {
    const run = (cmd) => {
      if (cmd === 'pgrep') { const e = new Error('sin coincidencias'); e.status = 1; throw e }
      throw new Error('no se debe llamar a lsof con la lista vacía')
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toBeNull()
  })

  it('pgrep que falla de VERDAD (rc distinto de 1) sí es "no se pudo comprobar"', () => {
    const run = () => { const e = new Error('pgrep: not found'); e.status = 127; throw e }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(false)
    expect(r.motivo).toMatch(/pgrep/)
  })

  it('lsof que falla es "no se pudo comprobar", nunca "no hay nadie vivo"', () => {
    const run = (cmd) => {
      if (cmd === 'pgrep') return '100\n'
      const e = new Error('lsof: command not found'); e.status = 127; throw e
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(false)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toMatch(/lsof/)
  })

  it('nunca llama a lsof con la lista de pids vacía', () => {
    // Medido: `lsof -a -p "" -d cwd -Fpn` devuelve un proceso AJENO, no vacío.
    const llamadas = []
    const run = (cmd) => { llamadas.push(cmd); if (cmd === 'pgrep') { const e = new Error(''); e.status = 1; throw e } return '' }
    liveSliceProcesses(raiz, { run })
    expect(llamadas).toEqual(['pgrep'])
  })
})
