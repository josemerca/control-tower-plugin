import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')

// F11, parte B. El caso REAL que originó esto (menoplus, verificado leyendo
// ese repo): antes de que llegara el plugin ya existían
//   - `scripts/dispatch-check.sh` (script propio del repo) y una línea en
//     AGENTS.md que ordena ejecutarlo antes de implementar y con `--release`
//     al abrir PR;
//   - una convención de worktrees: `git worktree add .claude/worktrees/<slug>`,
//     con un hook (`menoplus-branch-isolation-guard.sh`) que la vigila.
// El plugin trae SU PROPIO `dispatch-check.mjs` y usa `.worktrees/<n>`, y
// `ct-init` escribía su bloque al lado del que ya había sin mirar: el
// AGENTS.md acaba contradiciéndose y hay dos protocolos de claim operando
// sobre el mismo espacio de labels. Estos tests exigen que ct-init NO pueda
// dejar un repo así en silencio.
function menoplusLikeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  mkdirSync(join(dir, '.claude', 'worktrees'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'dispatch-check.sh'), '#!/usr/bin/env bash\n# claim propio del repo\n')
  writeFileSync(join(dir, '.claude', 'hooks', 'branch-isolation-guard.sh'), '#!/usr/bin/env bash\n')
  writeFileSync(
    join(dir, 'AGENTS.md'),
    [
      '# AGENTS.md',
      '## Workflow: 1 issue = 1 slice = 1 session',
      '- **Aislamiento de ramas ESTRICTO.** Trabajo nuevo:',
      '  `git worktree add .claude/worktrees/<slug> -b <rama> main`. Hay un hook que lo vigila.',
      '- **Claim anti-colisión:** `scripts/dispatch-check.sh <issue#>` antes de implementar,',
      '  `--release <issue#>` al abrir PR.',
      '',
    ].join('\n')
  )
  return dir
}

function runInit(dir, args = []) {
  return spawnSync('bash', [script, dir, ...args], { encoding: 'utf8' })
}

describe('ct-init: convenciones propias del repo en el terreno del loop', () => {
  it('avisa de que el repo YA tiene su propio claim (script + orden en AGENTS.md) que choca con el del plugin', () => {
    const dir = menoplusLikeRepo()
    const res = runInit(dir)
    expect(res.status).toBe(0)
    // Se avisa por stderr, como el resto de avisos de ct-init.
    expect(res.stderr).toMatch(/convenci/i)
    expect(res.stderr).toContain('scripts/dispatch-check.sh')
    // Y no se limita a nombrarlo: dice cuál es la decisión que hay que tomar.
    expect(res.stderr).toMatch(/dispatch-check\.mjs/)
    expect(res.stderr).toMatch(/status:/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('avisa de la convención de worktrees ajena (`.claude/worktrees/`) frente a `.worktrees/<n>` del dispatcher', () => {
    const dir = menoplusLikeRepo()
    const res = runInit(dir)
    expect(res.stderr).toContain('.claude/worktrees')
    expect(res.stderr).toContain('.worktrees/<n>')
    expect(res.stderr).toMatch(/feat\//)
    rmSync(dir, { recursive: true, force: true })
  })

  it('nombra el hook que vigila ramas/worktrees: es quien puede tumbar cada despacho', () => {
    const dir = menoplusLikeRepo()
    const res = runInit(dir)
    expect(res.stderr).toContain('branch-isolation-guard.sh')
    rmSync(dir, { recursive: true, force: true })
  })

  it('un repo limpio NO recibe ningún aviso de convenciones (sin falsos positivos de partida)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    const res = runInit(dir)
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/convenci/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('la SEGUNDA corrida no se detecta a sí misma: el bloque que siembra ct-init no cuenta como convención ajena', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    runInit(dir)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // Control: el bloque sembrado SÍ habla del terreno que la detección mira
    // (si dejara de hacerlo, este test dejaría de probar nada).
    expect(agents).toMatch(/\.worktrees\/|dispatch-check|status:in-progress/)
    const res = runInit(dir)
    expect(res.stderr).not.toMatch(/convenci/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('un AGENTS.md con saltos CRLF también se escanea (los marcadores del bloque propio se reconocen igual)', () => {
    const dir = menoplusLikeRepo()
    const lf = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    writeFileSync(join(dir, 'AGENTS.md'), lf.split('\n').join('\r\n'))
    const res = runInit(dir)
    expect(res.stderr).toContain('scripts/dispatch-check.sh')
    rmSync(dir, { recursive: true, force: true })
  })

  it('si la detección no puede correr (sin node), se dice — no se pasa por "no hay nada"', () => {
    const dir = menoplusLikeRepo()
    // PATH sin node: el detector no puede ejecutarse. El silencio aquí sería
    // indistinguible de "repo limpio", que es justo el falso negativo caro.
    const emptyBin = mkdtempSync(join(tmpdir(), 'ct-nobin-'))
    const res = spawnSync('bash', [script, dir], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${emptyBin}:/usr/bin:/bin` },
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no se ha podido comprobar si este repo ya tiene convenciones/i)
    rmSync(dir, { recursive: true, force: true })
    rmSync(emptyBin, { recursive: true, force: true })
  })

  it('no desciende a .worktrees/ ni a node_modules (worktrees del propio loop y dependencias no son convenciones del repo)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    mkdirSync(join(dir, '.worktrees', '7', 'scripts'), { recursive: true })
    writeFileSync(join(dir, '.worktrees', '7', 'scripts', 'dispatch-check.sh'), '#!/bin/sh\n')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'dispatch-check.sh'), '#!/bin/sh\n')
    const res = runInit(dir)
    expect(res.stderr).not.toMatch(/convenci/i)
    rmSync(dir, { recursive: true, force: true })
  })
})
