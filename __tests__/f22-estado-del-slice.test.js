// ============================================================================
// F22 — EL ESTADO DEL SLICE DEJA DE SER PRODUCTO.
//
// El dispatcher sembraba el estado del slice SOBRE `.agent/STATE.md`, que está
// TRACKEADO y es el fichero de la sesión coordinadora. Tres veces en un
// periodo de 9 slices ese fichero entró en un PR; una llegó a `main`, que se
// quedó con `task: <nombre del slice>` y un gate pendiente de un PR ya
// mergeado — cualquier sesión nueva del repo se hidrataba creyendo que era el
// agente de ese slice.
//
// Y el mismo fichero era una foto falsa mientras tanto: 21 horas y 7 commits
// con la semilla intacta (`status: not_started`). La causa NO era que el
// kickoff pidiera actualizarlo al final: el hook `Stop` YA obligaba a
// refrescarlo en cada turno, y estaba desarmado porque la semilla escribía
// `last_commit: ''` — con el campo vacío, `describeStopRelation` devuelve
// `unset` y `classifyStopState` sale en silencio.
//
// Los dos van juntos porque arreglar el segundo empeora el primero: un agente
// obligado a refrescar su estado en cada turno es un agente con más papeletas
// de commitearlo.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATE_REL_PATH, SLICE_REL_PATH, NEVER_IN_A_SLICE_PR, resolveStatePath } from '../scripts/state-paths.js'

const mkRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-'))
  mkdirSync(join(dir, '.agent'), { recursive: true })
  return dir
}

describe('F22 — precedencia de lectura del estado', () => {
  it('con los DOS ficheros, gana SLICE.md: es el estado del slice, no el de la coordinadora', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    writeFileSync(join(dir, SLICE_REL_PATH), 'slice')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('slice')
    expect(r.path).toBe(join(dir, SLICE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin SLICE.md cae a STATE.md — el checkout de la coordinadora, y los worktrees del esquema anterior', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('coordinator')
    expect(r.path).toBe(join(dir, STATE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguno de los dos devuelve path null, y no inventa una ruta que no existe', () => {
    const dir = mkRepo()
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('none')
    expect(r.path).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('los paths que un PR de slice no puede introducir son EXACTAMENTE esos dos, no `.agent/` entero', () => {
    expect(NEVER_IN_A_SLICE_PR).toEqual([STATE_REL_PATH, SLICE_REL_PATH])
    expect(NEVER_IN_A_SLICE_PR).not.toContain('.agent/conventions-ack.md')
  })
})
