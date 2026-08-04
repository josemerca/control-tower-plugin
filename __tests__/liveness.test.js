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

  it('pgrep sin coincidencias (rc=1) corta antes de intentar lsof', () => {
    const llamadas = []
    const run = (cmd) => { llamadas.push(cmd); if (cmd === 'pgrep') { const e = new Error(''); e.status = 1; throw e } return '' }
    liveSliceProcesses(raiz, { run })
    expect(llamadas).toEqual(['pgrep'])
  })

  it('nunca llama a lsof con la lista de pids vacía', () => {
    // Medido: `lsof -a -p "" -d cwd -Fpn` devuelve un proceso AJENO, no vacío.
    // Este caso es distinto del de "pgrep sale 1": aquí pgrep TIENE ÉXITO
    // (rc=0) pero su salida no trae ningún pid, así que la guarda que se
    // comprueba es la del array vacío tras el parseo, no el atajo del catch.
    const llamadas = []
    const run = (cmd) => { llamadas.push(cmd); return cmd === 'pgrep' ? '\n' : '' }
    liveSliceProcesses(raiz, { run })
    expect(llamadas).toEqual(['pgrep'])
  })

  it('pgrep se acota al usuario actual con -U antes de -x claude', () => {
    const llamadas = []
    const run = (cmd, args) => {
      llamadas.push([cmd, args])
      if (cmd === 'pgrep') { const e = new Error(''); e.status = 1; throw e }
      return ''
    }
    liveSliceProcesses(raiz, { run })
    expect(llamadas).toEqual([['pgrep', ['-x', '-U', String(process.getuid()), 'claude']]])
  })

  it('sin process.getuid disponible degrada a "no se pudo comprobar", nunca a un pgrep sin acotar', () => {
    const original = process.getuid
    try {
      process.getuid = undefined
      const llamadas = []
      const run = (cmd) => { llamadas.push(cmd); return '' }
      const r = liveSliceProcesses(raiz, { run })
      expect(r.comprobado).toBe(false)
      expect(r.motivo).toMatch(/getuid|usuario/)
      expect(llamadas).toEqual([])
    } finally {
      process.getuid = original
    }
  })

  it('un PID que muere entre pgrep y lsof no rompe la señal: se lee el stdout parcial de rc=1', () => {
    // Medido: `lsof -a -p <vivos,muerto> -d cwd -Fpn` sale con rc=1 pero trae
    // en stdout los PID que sí siguen vivos.
    const run = (cmd) => {
      if (cmd === 'pgrep') return '100\n999999\n'
      const e = new Error('lsof: no such process (999999)')
      e.status = 1
      e.stdout = lsofFalso([['100', '/repo/.worktrees/7']])
      throw e
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect([...r.porSlice]).toEqual([['7', '100']])
  })

  it('si TODOS los pids mueren antes de lsof (rc=1, stdout vacío), es "nadie vivo", no un fallo', () => {
    const run = (cmd) => {
      if (cmd === 'pgrep') return '999999\n'
      const e = new Error('lsof: no such process (999999)')
      e.status = 1
      e.stdout = ''
      throw e
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toBeNull()
  })
})
