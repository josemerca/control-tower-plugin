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

// La salida de `ps -o pid=,comm=`: el pid alineado a la derecha, un espacio, y
// TODO el resto de la línea es la ruta con la que se invocó el proceso —
// espacios incluidos. Reproducida tal cual la emite macOS.
const psFalso = (pares) => pares.map(([pid, ruta]) => `${String(pid).padStart(6, ' ')} ${ruta}`).join('\n') + '\n'

// Las rutas REALES de la app de escritorio en esta máquina, copiadas de
// `ps -u <uid> -o pid=,comm=`. Ninguna es un agente trabajando en un worktree:
// son una ventana abierta y sus helpers de Electron.
const APP_DE_ESCRITORIO = [
  [69229, '/Applications/Claude.app/Contents/MacOS/Claude'],
  [69266, '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper'],
  [69292, '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer)'],
  [69380, '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Plugin).app/Contents/MacOS/Claude Helper (Plugin)'],
  [90823, '/Applications/Claude.app/Contents/Helpers/chrome-native-host'],
]

describe('liveSliceProcesses', () => {
  const raiz = '/repo'

  it('mapea cada proceso a su slice por el segmento que sigue a .worktrees/', () => {
    const run = (cmd) => cmd === 'ps' ? psFalso([[100, '/Users/x/.local/bin/claude'], [200, '/Users/x/.local/bin/claude']]) : lsofFalso([
      ['100', '/repo/.worktrees/7'],
      ['200', '/otro/sitio'],
    ])
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect([...r.porSlice]).toEqual([['7', '100']])
  })

  it('un cwd MÁS PROFUNDO que la raíz del worktree cuenta igual', () => {
    const run = (cmd) => cmd === 'ps' ? psFalso([[100, '/Users/x/.local/bin/claude']]) : lsofFalso([['100', '/repo/.worktrees/9/apps/backend']])
    expect([...liveSliceProcesses(raiz, { run }).porSlice]).toEqual([['9', '100']])
  })

  it('lo que identifica es la RUTA invocada, no el nombre del proceso: el del instalador nativo es el número de versión', () => {
    // Medido en macOS: `~/.local/bin/claude` es un symlink a
    // `~/.local/share/claude/versions/<versión>`, y el nombre de proceso
    // (`ps -o ucomm=`) sale como "2.1.221" — el número de versión, que cambia
    // en cada actualización. La columna `comm` conserva la ruta invocada, y
    // ésa sí dice `claude`. Es el caso que `pgrep -x claude` no cubría.
    const run = (cmd) => cmd === 'ps' ? psFalso([[18539, '/Users/jpereag/.local/bin/claude']]) : lsofFalso([['18539', '/repo/.worktrees/7']])
    expect([...liveSliceProcesses(raiz, { run }).porSlice]).toEqual([['7', '18539']])
  })

  it('la app de ESCRITORIO no cuenta como agente, y ni siquiera llega a lsof', () => {
    // `Claude` (mayúscula) y `Claude Helper` no son basename `claude`, así que
    // el matcheo exacto los deja fuera sin ninguna regla especial. Un matcheo
    // laxo afirmaría que hay un agente donde sólo hay una ventana abierta.
    const llamadas = []
    const run = (cmd) => {
      llamadas.push(cmd)
      return cmd === 'ps' ? psFalso(APP_DE_ESCRITORIO) : ''
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(llamadas).toEqual(['ps'])
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
  })

  it('una ruta CON ESPACIOS no se parte: sólo cuenta su basename', () => {
    // La línea de `ps` no se puede trocear por espacios (las rutas de los
    // helpers de escritorio los llevan dentro). El pid es el primer campo y
    // todo lo demás es la ruta.
    const run = (cmd) => cmd === 'ps'
      ? psFalso([...APP_DE_ESCRITORIO, [777, '/Users/x/Mis Herramientas/claude']])
      : lsofFalso([['777', '/repo/.worktrees/4']])
    expect([...liveSliceProcesses(raiz, { run }).porSlice]).toEqual([['4', '777']])
  })

  it('sin ningún proceso claude es una respuesta VÁLIDA, no un fallo', () => {
    const run = (cmd) => {
      if (cmd === 'ps') return psFalso([[1, '/sbin/launchd'], [2, '/usr/bin/ssh']])
      throw new Error('no se debe llamar a lsof con la lista vacía')
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toBeNull()
  })

  it('ps que falla es "no se pudo comprobar", nunca una lista vacía dada por buena', () => {
    const run = () => { const e = new Error('ps: not found'); e.status = 127; throw e }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(false)
    expect(r.motivo).toMatch(/ps/)
  })

  it('lsof que falla es "no se pudo comprobar", nunca "no hay nadie vivo"', () => {
    const run = (cmd) => {
      if (cmd === 'ps') return psFalso([[100, '/Users/x/.local/bin/claude']])
      const e = new Error('lsof: command not found'); e.status = 127; throw e
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(false)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toMatch(/lsof/)
  })

  it('nunca llama a lsof con la lista de pids vacía', () => {
    // Medido: `lsof -a -p "" -d cwd -Fpn` NO devuelve nada vacío — devuelve el
    // cwd de todos los procesos legibles de la máquina, con rc=0 (399 entradas
    // en la corrida medida), porque una lista de PID vacía no restringe nada.
    // Sin esta guarda, cada worktree saldría con un proceso "vivo" dentro.
    const llamadas = []
    const run = (cmd) => { llamadas.push(cmd); return cmd === 'ps' ? '\n' : '' }
    liveSliceProcesses(raiz, { run })
    expect(llamadas).toEqual(['ps'])
  })

  it('ps se acota al usuario actual y pide pid+comm, con timeout y killSignal', () => {
    // `-u <uid>`: sin acotar, la lista traería procesos de otros usuarios, y
    // eso es justo lo que hace segura la lectura del stdout parcial de lsof.
    // `timeout`+`killSignal`: `lsof` se cuelga con un montaje de red muerto, y
    // un comando pensado para correr en bucle no puede quedarse sin devolver
    // código de salida.
    const llamadas = []
    const run = (cmd, args, opciones) => {
      llamadas.push([cmd, args, opciones])
      return cmd === 'ps' ? psFalso([[100, '/Users/x/.local/bin/claude']]) : lsofFalso([['100', '/repo/.worktrees/7']])
    }
    liveSliceProcesses(raiz, { run })
    expect(llamadas[0][0]).toBe('ps')
    expect(llamadas[0][1]).toEqual(['-u', String(process.getuid()), '-o', 'pid=,comm='])
    expect(llamadas[1][0]).toBe('lsof')
    for (const [, , opciones] of llamadas) {
      expect(opciones.killSignal).toBe('SIGKILL')
      expect(opciones.timeout).toBeGreaterThan(0)
    }
  })

  it('sin process.getuid disponible degrada a "no se pudo comprobar", nunca a un listado sin acotar', () => {
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

  it('un PID que muere entre ps y lsof no rompe la señal: se lee el stdout parcial de rc=1', () => {
    // Medido: `lsof -a -p <vivos,muerto> -d cwd -Fpn` sale con rc=1 pero trae
    // en stdout los PID que sí siguen vivos.
    const run = (cmd) => {
      if (cmd === 'ps') return psFalso([[100, '/Users/x/.local/bin/claude'], [999999, '/Users/x/.local/bin/claude']])
      const e = new Error('lsof: no such process (999999)')
      e.status = 1
      e.stdout = lsofFalso([['100', '/repo/.worktrees/7']])
      throw e
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(true)
    expect([...r.porSlice]).toEqual([['7', '100']])
  })

  it('sólo rc=1 habilita leer el stdout parcial: un lsof matado por el timeout NO se da por bueno', () => {
    // Un `timeout` de execFileSync llega con `status: null` y puede traer un
    // `stdout` cortado a la mitad. Sin la mitad `status === 1` de la condición,
    // ese stdout truncado se leería como una lectura completa y el informe
    // afirmaría "no hay nadie vivo" sobre datos a medias.
    const run = (cmd) => {
      if (cmd === 'ps') return psFalso([[100, '/Users/x/.local/bin/claude'], [200, '/Users/x/.local/bin/claude']])
      const e = new Error('spawnSync lsof ETIMEDOUT')
      e.status = null
      e.killed = true
      e.stdout = lsofFalso([['100', '/repo/.worktrees/7']])
      throw e
    }
    const r = liveSliceProcesses(raiz, { run })
    expect(r.comprobado).toBe(false)
    expect(r.porSlice.size).toBe(0)
    expect(r.motivo).toMatch(/lsof/)
  })

  it('si TODOS los pids mueren antes de lsof (rc=1, stdout vacío), es "nadie vivo", no un fallo', () => {
    const run = (cmd) => {
      if (cmd === 'ps') return psFalso([[999999, '/Users/x/.local/bin/claude']])
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
