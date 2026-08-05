import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTRACT_MARKER, probeGovernedRepo } from '../scripts/governed-repo.js'
import { decidir } from '../hooks/commit-keyword-guard.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = join(root, 'hooks/commit-keyword-guard.js')

const hechos = []
function repoGobernado() {
  const d = mkdtempSync(join(tmpdir(), 'f27g-')); hechos.push(d)
  mkdirSync(join(d, '.git'))
  writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
  return d
}
function repoNormal() {
  const d = mkdtempSync(join(tmpdir(), 'f27n-')); hechos.push(d)
  mkdirSync(join(d, '.git'))
  return d
}
afterAll(() => { for (const d of hechos) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

function correr(command, cwd, bin = hook) {
  const r = spawnSync('node', [bin], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
  })
  const out = (r.stdout || '').trim()
  return { status: r.status, out, json: out ? JSON.parse(out) : null }
}

// La propiedad que más importa —sólo el comando que ya resultó ser un commit
// CON keyword paga el I/O de `probe`— medida DIRECTAMENTE sobre la función
// pura, con un espía que cuenta sus propias invocaciones. Esto es lo que un
// `chmod 000` sólo podía insinuar por efecto secundario (y, para el camino
// `ls`, ni eso: un `ls` sale limpio tanto si `probe` se llama y falla en
// silencio como si no se llama nunca, así que ese camino no se puede
// verificar mirando sólo la salida del proceso).
describe('F27 — decidir (funcion pura, sin proceso)', () => {
  it('ls -la: sin decision Y el probe NO se invoca', () => {
    let llamadas = 0
    const espia = () => { llamadas++; return { governed: true } }
    const r = decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' }, cwd: '/x' }, espia)
    expect(r).toBeNull()
    expect(llamadas).toBe(0)
  })

  it('commit sin keyword: sin decision Y el probe NO se invoca', () => {
    let llamadas = 0
    const espia = () => { llamadas++; return { governed: true } }
    const r = decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "arregla el parser"' }, cwd: '/x' }, espia)
    expect(r).toBeNull()
    expect(llamadas).toBe(0)
  })

  it('commit con keyword y repo gobernado: DENY Y el probe se invoca UNA vez', () => {
    let llamadas = 0
    const espia = () => { llamadas++; return { governed: true } }
    const r = decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, espia)
    expect(llamadas).toBe(1)
    expect(r.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('commit con keyword y probe que no puede saber: ASK, nunca silencio', () => {
    const r = decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, () => ({ error: 'lo que sea' }))
    expect(r.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('commit con keyword y repo NO gobernado: sin decision', () => {
    const r = decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, () => ({ governed: false }))
    expect(r).toBeNull()
  })

  // El evento tiene que ser el que se espera: un `tool_name: 'Bash'` que
  // llegase colgado de OTRO evento (o sin `hook_event_name`) no es este hook.
  it('hook_event_name distinto de PreToolUse: sin decision, aunque el resto encaje', () => {
    let llamadas = 0
    const espia = () => { llamadas++; return { governed: true } }
    const r = decidir({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, espia)
    expect(r).toBeNull()
    expect(llamadas).toBe(0)
  })

  // LA ruptura deliberada: si se llamase a `probe` ANTES de saber que hay una
  // closing keyword, este test se pondria rojo porque `llamadas` dejaria de
  // ser 0 aqui, para un comando compuesto sin ninguna keyword.
  it('el orden importa: para un comando sin closing keyword, el probe nunca corre', () => {
    let llamadas = 0
    const espia = () => { llamadas++; return { governed: true } }
    decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status && ls -la /etc' } }, espia)
    expect(llamadas).toBe(0)
  })

  // Un `cwd` ausente, `null` o vacio NO se sustituye por el cwd del PROCESO
  // del hook: eso contestaria sobre un directorio que quien invoco nunca
  // nombro. `probeGovernedRepo` (el probe real, no un espia) ya convierte
  // eso en `{error}`, y aqui debe salir `ask`, nunca silencio.
  it.each([
    ['ausente', undefined],
    ['null', null],
    ['cadena vacia', ''],
  ])('cwd %s en el payload: ASK, nunca silencio', (_etiqueta, cwd) => {
    const r = decidir({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #451"' }, cwd }, probeGovernedRepo)
    expect(r.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})

describe('F27 — el hook (extremo a extremo sobre el binario, via stdin)', () => {
  it('repo gobernado + commit con keyword => DENY, nombrando keyword y referencia', () => {
    const r = correr('git commit -m "no dice \\"Closes #451\\" el kickoff"', repoGobernado())
    expect(r.status).toBe(0)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
    const motivo = r.json.hookSpecificOutput.permissionDecisionReason
    expect(motivo).toContain('Closes')
    expect(motivo).toContain('#451')
    // El enfasis en mayusculas de "CUERPO DEL PR" es deliberado -lo lee un
    // agente que va a reintentar- asi que la asercion es insensible a caja.
    expect(motivo).toMatch(/cuerpo del PR/i)
  })

  it('repo NO gobernado => sin decision', () => {
    const r = correr('git commit -m "Closes #451"', repoNormal())
    expect(r.status).toBe(0)
    expect(r.out).toBe('')
  })

  // El camino feliz que el contrato EXIGE.
  it('gh pr create con el cierre en el cuerpo => sin decision', () => {
    const r = correr('gh pr create --body "Closes #42"', repoGobernado())
    expect(r.out).toBe('')
  })

  it('commit limpio encadenado con gh pr create => sin decision', () => {
    const r = correr('git commit -m limpio && gh pr create --body "Closes #1"', repoGobernado())
    expect(r.out).toBe('')
  })

  it('un commit sin keyword => sin decision', () => {
    const r = correr('git commit -m "arregla el parser"', repoGobernado())
    expect(r.out).toBe('')
  })

  it('una herramienta que no es Bash => sin decision', () => {
    const r = spawnSync('node', [hook], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { command: 'git commit -m "Closes #1"' }, cwd: repoGobernado() }),
      encoding: 'utf8',
    })
    expect((r.stdout || '').trim()).toBe('')
  })

  it('stdin malformado => salida vacia, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })

  // Esto prueba UNA cosa concreta: que un cwd que no se puede leer produce
  // ASK y no silencio. NO prueba "cero I/O en el camino comun" -para un `ls`,
  // la salida es identica se llame o no se llame a `probe`, porque
  // `probeGovernedRepo` atrapa el EACCES y el camino `ls` ni siquiera llega a
  // mirar el resultado- esa propiedad la prueba el bloque de arriba, sobre
  // `decidir` con un espia.
  it('con un cwd ilegible, un commit con keyword sale ASK (nunca silencio)', () => {
    const d = mkdtempSync(join(tmpdir(), 'f27y-')); hechos.push(d)
    const dentro = join(d, 'dentro'); mkdirSync(dentro)
    chmodSync(d, 0o000)
    const r = correr('git commit -m "Closes #7"', dentro)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  // El bug real: `process.argv[1]` conserva la ruta tal como se invoco,
  // `import.meta.url` llega con los symlinks ya resueltos. Sin resolverlos
  // los dos antes de comparar, el cuerpo ejecutable no corre por esta ruta y
  // la puerta entera se apaga en silencio (exit 0, stdout vacio),
  // indistinguible de "no habia nada que denegar".
  it('invocado a traves de un symlink de DIRECTORIO al repo: sigue denegando', () => {
    const enlaces = mkdtempSync(join(tmpdir(), 'f27link-')); hechos.push(enlaces)
    const enlaceRepo = join(enlaces, 'repo-enlazado')
    symlinkSync(root, enlaceRepo, 'dir')
    const hookViaEnlace = join(enlaceRepo, 'hooks', 'commit-keyword-guard.js')
    const r = correr('git commit -m "Closes #451"', repoGobernado(), hookViaEnlace)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('invocado por una ruta donde el propio FICHERO es un symlink: sigue denegando', () => {
    const enlaces = mkdtempSync(join(tmpdir(), 'f27link-')); hechos.push(enlaces)
    const hookEnlazado = join(enlaces, 'guard-enlazado.js')
    symlinkSync(hook, hookEnlazado, 'file')
    const r = correr('git commit -m "Closes #451"', repoGobernado(), hookEnlazado)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('el BUNDLE de produccion decide igual que el fuente', () => {
    const bundle = join(root, 'dist/commit-keyword-guard.js')
    const r = correr('git commit -m "Closes #451"', repoGobernado(), bundle)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })
})
