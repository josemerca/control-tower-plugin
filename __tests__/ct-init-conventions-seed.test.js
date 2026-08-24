// §3.3 del handoff (docs/prompt-juez-lo-que-queda.md): la semilla de
// `.agent/conventions.md` que `scripts/ct-init.sh` escribe. Fichero NUEVO a
// propósito — separado de __tests__/ct-init.test.js — para no rozar el test
// rojo deliberado de ese fichero (`SLICES_PRISTINE_HASHES`, decisión humana,
// no se toca ni se cuenta).
//
// Mismo idiom que ct-init.test.js: `mkdtempSync` + `execFileSync('bash', [script, dir])`.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CONVENTIONS_FILE } from '../scripts/vara.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')

describe('ct-init.sh siembra .agent/conventions.md', () => {
  it('en un dir vacío, crea el fichero y lo anuncia con "creado"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const ruta = join(dir, CONVENTIONS_FILE)
    expect(existsSync(ruta)).toBe(true)
    expect(out).toMatch(/creado.*conventions\.md/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('es idempotente: un fichero ya existente no se pisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, CONVENTIONS_FILE), 'MÍO')
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')).toBe('MÍO')
    expect(out).toMatch(/conventions\.md ya existe, no se pisa/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('la semilla se distingue de conventions-ack.md (comentario propio)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const contenido = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(contenido).toMatch(/conventions-ack\.md/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('la semilla no declara ninguna vara — sigue midiéndose sin-vara hasta que un humano confirme', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const contenido = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(contenido).toMatch(/ninguna declarada todavía/)
    rmSync(dir, { recursive: true, force: true })
  })
})
