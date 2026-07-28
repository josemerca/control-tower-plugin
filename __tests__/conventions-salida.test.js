// F14 — EL DETECTOR DE F11 ERA UN GUARD QUE NO SE PODÍA SATISFACER.
//
// Verificado en campo contra el repo real (menoplus, solo lectura). El repo
// siguió el consejo del propio detector: decidió que manda el claim del plugin y
// reescribió AGENTS.md y CLAUDE.md para decirlo. **El detector siguió
// marcándolo**, porque buscaba subcadenas: casaba contra la línea de `scripts/`
// de un árbol de directorios, contra las frases nuevas que explican que el claim
// ya NO lo hace el agente, contra la documentación deliberada del uso manual, y
// contra las descripciones factuales de los hooks en una tabla de inventario.
// La única forma de ponerlo verde era borrar documentación correcta.
//
// Y al mismo tiempo se le escapaba lo único vivo que quedaba: las dos guías
// apuntaban a `docs/agentic-workflow.md` como «referencia completa», y ahí
// seguía, en imperativo directo al agente, `Claim (primer paso del agente):
// ./scripts/dispatch-check.sh <issue#>`. El detector solo miraba AGENTS.md y
// CLAUDE.md.
//
// Estos tests fijan la propiedad que faltaba: **desde cualquier estado que el
// detector señale existe un camino que lo deja verde sin empeorar el repo**, y
// el detector llega a donde la propia guía manda mirar.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  detectConventions,
  formatFindings,
  parseAcks,
  linkedDocPaths,
  ACK_PATH,
} from '../scripts/conventions.js'
import { readRepoDocs, readAck, MAX_LINKED_DOCS } from '../scripts/conventions-io.js'

const here = dirname(fileURLToPath(import.meta.url))
const detectScript = join(here, '..', 'scripts', 'detect-conventions.mjs')
const initScript = join(here, '..', 'scripts', 'ct-init.sh')

const ids = (r) => r.map((f) => f.id).sort()
const doc = (content, path = 'AGENTS.md') => ({ path, content })

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})
function tmp(prefix = 'ct-f14-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

// ============================================================================
// A. MANDATO vs MENCIÓN. Cada caso de aquí es una LÍNEA LITERAL del repo real
// que el detector de F11 marcaba y que no se puede "arreglar" sin borrar
// documentación correcta.
// ============================================================================
describe('F14/A — el detector distingue una orden de una mención', () => {
  it('la línea de `scripts/` de un ÁRBOL DE DIRECTORIOS no es una orden (AGENTS.md:69 del repo real)', () => {
    const tree = [
      '# AGENTS.md',
      '## Project layout',
      '```',
      'apps/backend   FastAPI + Alembic + Docker',
      'scripts/       dispatch-check.sh, dependabot-*, sentry-*, workflow-models.json, tests/',
      '```',
    ].join('\n')
    expect(detectConventions({ docs: [doc(tree)], files: [] })).toEqual([])
  })

  it('la frase que explica que el claim YA NO lo hace el agente no es una orden (CLAUDE.md:221 del repo real)', () => {
    const line =
      '- **Flujo agéntico.** **El claim lo hace el dispatcher del loop (`/ct-next`), no el agente:** deja el ' +
      'issue en `status:in-progress` antes de arrancarte. `scripts/dispatch-check.sh` (anti-colisión por ' +
      'area/touches, `<issue#>` para claim y `--release <issue#>` al abrir PR) se queda para trabajar un ' +
      'issue **a mano, fuera del loop** — no lo corras por defecto.'
    expect(detectConventions({ docs: [doc(`# C\n${line}\n`, 'CLAUDE.md')], files: [] })).toEqual([])
  })

  it('documentar el uso manual FUERA del loop no es una orden, ni cuando el ámbito está en el bullet padre', () => {
    // docs/agentic-workflow.md del repo real: la orden y su ámbito viven en
    // líneas distintas. Leída sola, la línea del claim es indistinguible de la
    // versión vieja que sí mandaba al agente reclamar.
    const content = [
      '## Regla de colisión',
      '',
      '- **Dentro del loop Control Tower (por defecto):** lo hace `/ct-next` en código.',
      '- **A mano, fuera del loop:** entonces sí, lo aplicas tú con `scripts/dispatch-check.sh`:',
      '  - **Claim:** `./scripts/dispatch-check.sh <issue#>` → pone `status:in-progress`.',
      '  - **Release** (al abrir PR): `./scripts/dispatch-check.sh --release <issue#>`.',
    ].join('\n')
    expect(detectConventions({ docs: [doc(content)], files: [] })).toEqual([])
  })

  it('la descripción de un hook en una tabla de inventario no es una convención de worktrees (CLAUDE.md:267-268)', () => {
    const content = [
      '### Hooks locales del proyecto',
      '- **branch-isolation-guard.sh** (PreToolUse, Bash). Bloquea `git checkout/switch` hacia una rama ≠ `main`; empuja a `git worktree add`. Permite: `main`, restore `-- <fichero>`, detached (sha/tag).',
      '- **Resto.** `worktree-guard.sh` (bloquea `git worktree add` con dirty tree), `worktree-merge-check.sh` (advierte tras cherry-pick).',
    ].join('\n')
    expect(detectConventions({ docs: [doc(content, 'CLAUDE.md')], files: [] })).toEqual([])
  })

  it('un `git worktree add <ruta ajena>` DE VERDAD sigue avisando, también dentro de un blockquote (CLAUDE.md:149)', () => {
    const content = [
      '## Worktree Safety',
      '> ### 🛑 Política de aislamiento de ramas (ESTRICTA)',
      '> **Una sesión = un worktree = una rama.** Todo trabajo nuevo arranca creando un worktree propio:',
      '> ```',
      '> git worktree add .claude/worktrees/<slug> -b <rama> main   # y trabaja DENTRO del worktree',
      '> ```',
    ].join('\n')
    const r = detectConventions({ docs: [doc(content, 'CLAUDE.md')], files: [] })
    expect(ids(r)).toEqual(['worktrees'])
    expect(r[0].evidence[0].line).toBe(5)
  })

  it('un verbo delante convierte una mención en orden: `corre dispatch-check.sh 42` sí, el nombre suelto no', () => {
    expect(ids(detectConventions({ docs: [doc('Antes de implementar, corre dispatch-check.sh 42.')], files: [] }))).toEqual(['claim'])
    expect(detectConventions({ docs: [doc('El anti-colisión vive en scripts/dispatch-check.sh y lo mantiene Jose.')], files: [] })).toEqual([])
  })

  it('el ámbito se hereda del bullet PADRE, nunca de un bullet HERMANO', () => {
    // Si un hermano pudiera silenciar al siguiente, bastaría una frase suelta
    // "fuera del loop" en cualquier parte de la lista para apagar toda la
    // sección — y eso sería el falso negativo que cuesta el deadlock.
    const content = [
      '## Flujo',
      '- El claim lo hace `/ct-next`, no tú (fuera del loop es otra historia).',
      '- Antes de implementar corre `./scripts/dispatch-check.sh <issue#>`.',
    ].join('\n')
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['claim'])
  })

  it('una marca de ámbito NO se traga un mandato que la contiene: «ya no es opcional: corre …»', () => {
    const content = '- **Claim.** Ya no es opcional: corre `./scripts/dispatch-check.sh <issue#>` antes de implementar.'
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['claim'])
  })

  it('«a mano» a secas NO silencia — solo silencia cuando saca la orden del loop', () => {
    // Deliberado: «reclama el issue a mano con tu script» es EXACTAMENTE el
    // deadlock que originó F11.
    expect(ids(detectConventions({ docs: [doc('Reclama el issue a mano: `./scripts/dispatch-check.sh <issue#>`.')], files: [] }))).toEqual(['claim'])
  })

  // Los dos siguientes salieron del BARRIDO de falsos negativos, no de la
  // imaginación: al estrechar la regla se midió qué dejaba de detectar y estos
  // dos eran órdenes de verdad que se escapaban. Se cerraron; los otros cuatro
  // casos del barrido son el coste asumido y están en el informe de F14.
  it('una obligación declarada sin forma de comando SIGUE siendo una orden', () => {
    expect(ids(detectConventions({ docs: [doc('El claim se gestiona con `scripts/dispatch-check.sh`, que es obligatorio.')], files: [] }))).toEqual(['claim'])
    expect(ids(detectConventions({ docs: [doc('- **Claim** (primer paso del agente): `scripts/dispatch-check.sh`.')], files: [] }))).toEqual(['claim'])
    // Control: sin marca de obligación, la misma mención no avisa.
    expect(detectConventions({ docs: [doc('El claim se gestiona con `scripts/dispatch-check.sh`.')], files: [] })).toEqual([])
  })

  it('un `git worktree add` partido en varias líneas avisa: no se ve la ruta, así que no se puede descartar', () => {
    const content = '```\ngit worktree add \\\n  ../wt/foo -b x main\n```'
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['worktrees'])
  })

  it('el TEST de un script de claim y un STATE.md archivado no son convenciones vivas', () => {
    expect(detectConventions({ docs: [], files: ['scripts/tests/dispatch-check.test.sh'] })).toEqual([])
    expect(detectConventions({ docs: [], files: ['docs/archive/planning-gsd/STATE.md'] })).toEqual([])
    // Control: el script de verdad y un estado vivo siguen contando.
    expect(ids(detectConventions({ docs: [], files: ['scripts/dispatch-check.sh'] }))).toEqual(['claim'])
    expect(ids(detectConventions({ docs: [], files: ['docs/STATE.md'] }))).toEqual(['estado'])
  })
})

// ============================================================================
// B. EL ACUSE. La GARANTÍA de que hay salida. Determinista, por señal, con
// fecha y motivo: no depende de que ninguna heurística de texto acierte.
// ============================================================================
describe('F14/B — el acuse explícito da salida a UNA señal, no a todas', () => {
  const noisy = {
    docs: [doc('- corre `./scripts/dispatch-check.sh <n>`\n- `git worktree add wt/<slug> -b x main`')],
    files: ['docs/STATE.md'],
  }

  it('un acuse válido silencia SU señal y deja intactas las demás', () => {
    const { acks, problems } = parseAcks('claim: 2026-07-28 — manda el claim del plugin; el script se queda para trabajo a mano\n')
    expect(problems).toEqual([])
    const r = detectConventions({ ...noisy, acks })
    expect(ids(r)).toEqual(['claim', 'estado', 'worktrees'])
    expect(r.find((f) => f.id === 'claim').silenced).toMatchObject({ date: '2026-07-28' })
    expect(r.find((f) => f.id === 'worktrees').silenced).toBeUndefined()
    expect(r.find((f) => f.id === 'estado').silenced).toBeUndefined()
  })

  it('lo silenciado se dice en UNA línea: «se decidió no mirar esto» no es «no hay nada»', () => {
    const { acks } = parseAcks('claim: 2026-07-28 — manda el del plugin\nworktrees: 2026-07-28 — el hook admite feat/\nestado: 2026-07-28 — el otro es histórico\n')
    const text = formatFindings(detectConventions({ ...noisy, acks }))
    expect(text).not.toMatch(/ATENCIÓN/)
    expect(text).toMatch(/nota: \[claim\] silenciado por \.agent\/conventions-ack\.md \(2026-07-28: manda el del plugin\)/)
    expect(text.split('\n')).toHaveLength(3)
  })

  it('el aviso VIVO lleva la salida escrita: dice dónde y con qué forma se acusa', () => {
    const text = formatFindings(detectConventions(noisy))
    expect(text).toContain(ACK_PATH)
    expect(text).toMatch(/claim: \d{4}-\d{2}-\d{2} —/)
    expect(text).toMatch(/No hace falta borrar documentación correcta/)
  })

  it('sin fecha, sin motivo, con señal desconocida o ininteligible: NO silencia y se DICE por qué', () => {
    const { acks, problems } = parseAcks(
      [
        '# comentario, se ignora',
        'claim: manda el del plugin',        // sin fecha
        'worktrees: 2026-07-28',             // sin motivo
        'claims: 2026-07-28 — typo en la señal',
        'esto es prosa suelta',
      ].join('\n')
    )
    expect(acks.size).toBe(0)
    expect(problems.map((p) => p.line)).toEqual([2, 3, 4, 5])
    expect(problems[0].why).toMatch(/fecha/)
    expect(problems[1].why).toMatch(/motivo/)
    expect(problems[2].why).toMatch(/desconocida/)
    expect(problems[3].why).toMatch(/forma/)
    // Y el aviso lo imprime: un acuse que no silencia y no se queja es la peor
    // combinación — el humano cree que ya lo ha decidido y sigue viendo el aviso.
    const text = formatFindings(detectConventions(noisy), { ackProblems: problems })
    expect(text).toMatch(/no silencia nada/)
    expect(text).toContain('claims')
  })

  it('una señal acusada dos veces se reporta: la segunda línea no añade nada', () => {
    const { acks, problems } = parseAcks('claim: 2026-07-01 — a\nclaim: 2026-07-28 — b\n')
    expect(acks.get('claim').date).toBe('2026-07-01')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/ya estaba acusada/)
  })

  it('CRLF, BOM, viñeta delante y mayúsculas: el acuse sigue valiendo', () => {
    const { acks, problems } = parseAcks('﻿# ack\r\n- Claim: 2026-07-28 — decidido\r\n')
    expect(problems).toEqual([])
    expect(acks.get('claim')).toMatchObject({ date: '2026-07-28', reason: 'decidido' })
  })

  it('un bloque de código dentro del fichero de acuse no se toma por acuses fallidos', () => {
    const { acks, problems } = parseAcks(['# ejemplo', '```', 'claim: YYYY-MM-DD — motivo', '```', 'claim: 2026-07-28 — de verdad'].join('\n'))
    expect(problems).toEqual([])
    expect(acks.get('claim').date).toBe('2026-07-28')
  })

  it('un fichero de acuse ILEGIBLE se dice: no se pasa por «no acusaste nada»', () => {
    const root = tmp()
    mkdirSync(join(root, '.agent'))
    mkdirSync(join(root, ACK_PATH)) // un DIRECTORIO donde debería ir el fichero: EISDIR, no ENOENT
    const { acks, unreadable } = readAck(root)
    expect(acks.size).toBe(0)
    expect(unreadable).toBeTruthy()
    expect(formatFindings(detectConventions(noisy), { ackUnreadable: unreadable })).toMatch(
      /existe .* pero no se ha podido leer/
    )
  })

  it('PROPIEDAD, de punta a punta: un repo señalado llega a VERDE sin tocar su documentación', () => {
    // Este es el test que F11 no tenía y por eso salió un muro. El repo NO
    // cambia ni una línea de sus guías: solo escribe lo que ya había decidido.
    const root = tmp()
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'dispatch-check.sh'), '#!/usr/bin/env bash\n')
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# AGENTS.md\n- **Claim:** `./scripts/dispatch-check.sh <issue#>` antes de implementar.\n'
    )
    const before = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(before.status).toBe(0)
    expect(before.stdout).toMatch(/\[claim\]/)
    expect(before.stdout).toContain(ACK_PATH)

    const docsBefore = spawnSync('cat', [join(root, 'AGENTS.md')], { encoding: 'utf8' }).stdout
    mkdirSync(join(root, '.agent'), { recursive: true })
    writeFileSync(
      join(root, ACK_PATH),
      '# Convenciones ya decididas\nclaim: 2026-07-28 — manda el claim del plugin; el script del repo se queda para trabajo a mano fuera del loop\n'
    )
    const after = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(after.status).toBe(0)
    expect(after.stdout).not.toMatch(/ATENCIÓN/)
    expect(after.stdout).toMatch(/nota: \[claim\] silenciado/)
    // Y la documentación sigue exactamente igual: nadie ha tenido que borrar nada.
    expect(spawnSync('cat', [join(root, 'AGENTS.md')], { encoding: 'utf8' }).stdout).toBe(docsBefore)
  })

  it('un acuse que ya no silencia nada se señala: si no, es un agujero permanente', () => {
    // Alguien acusa `estado` en julio, en septiembre resuelve el fichero, y la
    // línea se queda tapando por adelantado cualquier estado ajeno que aparezca
    // mañana. Solo se dice en /ct-init, que es quien hace el escaneo completo.
    const root = tmp()
    mkdirSync(join(root, '.agent'), { recursive: true })
    writeFileSync(join(root, ACK_PATH), 'estado: 2026-07-28 — el otro STATE.md era histórico y ya se borró\n')
    const r = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/acusa `estado` pero ya no hay ninguna señal/)
  })

  it('ct-init respeta el acuse (misma detección en el bootstrap que en el despacho)', () => {
    const root = tmp()
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'dispatch-check.sh'), '#!/usr/bin/env bash\n')
    mkdirSync(join(root, '.agent'), { recursive: true })
    writeFileSync(join(root, ACK_PATH), 'claim: 2026-07-28 — decidido: manda el del plugin\n')
    const r = spawnSync('bash', [initScript, root], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/ATENCIÓN: este repo ya tenía convenciones/)
    expect(r.stderr).toMatch(/nota: \[claim\] silenciado/)
  })
})

// ============================================================================
// C. UN SALTO desde la guía. El agujero por el que se coló la orden vieja.
// ============================================================================
describe('F14/C — el detector sigue la pista que la propia guía declara autorizada', () => {
  function repoConReferencia() {
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(
      join(root, 'AGENTS.md'),
      [
        '# AGENTS.md',
        '- **El claim lo hace `/ct-next`, no tú.** No lo reclames a mano.',
        '- Referencia completa: `docs/agentic-workflow.md`.',
      ].join('\n')
    )
    writeFileSync(
      join(root, 'docs', 'agentic-workflow.md'),
      [
        '# Flujo agéntico',
        '## Regla de colisión',
        'Lo aplica `scripts/dispatch-check.sh` (claim/release vía labels):',
        '- **Claim** (primer paso del agente): `./scripts/dispatch-check.sh <issue#>` → pone `status:in-progress`.',
      ].join('\n')
    )
    return root
  }

  it('la orden vieja viva en el documento que AGENTS.md llama «referencia completa» SE DETECTA y se cita', () => {
    const root = repoConReferencia()
    const { docs } = readRepoDocs(root)
    expect(docs.map((d) => d.path)).toContain('docs/agentic-workflow.md')
    const r = detectConventions({ docs, files: [] })
    expect(ids(r)).toEqual(['claim'])
    expect(r[0].evidence[0]).toMatchObject({ path: 'docs/agentic-workflow.md', line: 4, via: 'AGENTS.md' })
    expect(formatFindings(r)).toContain('(enlazado desde AGENTS.md)')
  })

  it('la misma orden sale también en el DESPACHO, no solo en el bootstrap', () => {
    const root = repoConReferencia()
    const r = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(r.stdout).toContain('docs/agentic-workflow.md:4')
  })

  it('UN salto, no dos: el nieto no se lee (una madriguera no es un alcance)', () => {
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '- Ver [el flujo](docs/flujo.md).\n')
    writeFileSync(join(root, 'docs', 'flujo.md'), '- Detalle en [el spec](spec.md).\n')
    writeFileSync(join(root, 'docs', 'spec.md'), '- Claim: `./scripts/dispatch-check.sh <n>`.\n')
    const { docs } = readRepoDocs(root)
    expect(docs.map((d) => d.path).sort()).toEqual(['AGENTS.md', 'docs/flujo.md'])
    expect(detectConventions({ docs, files: [] })).toEqual([])
  })

  it('un enlace que sale del repo no se lee, ni por ruta ni por symlink', () => {
    const outside = tmp('ct-f14-out-')
    writeFileSync(join(outside, 'evil.md'), '- Claim: `./scripts/dispatch-check.sh <n>`.\n')
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    symlinkSync(join(outside, 'evil.md'), join(root, 'docs', 'link.md'))
    writeFileSync(join(root, 'AGENTS.md'), '- Ver `../evil.md` y también `docs/link.md`.\n')
    const { docs } = readRepoDocs(root)
    expect(docs.map((d) => d.path)).toEqual(['AGENTS.md'])
  })

  it('no se siguen enlaces al territorio del propio loop (.worktrees/, .agent/) ni a plantillas', () => {
    expect(
      linkedDocPaths([doc('- estado en `.worktrees/<n>/.agent/STATE.md`, `.agent/STATE.md`, `apps/{a,b}/CLAUDE.md`, `https://x/y.md`, `/ruta/abs.md`')])
    ).toEqual([])
  })

  it('si la guía cita más documentos de los que se pueden leer, se DICE que se ha cortado', () => {
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    const links = []
    for (let i = 0; i < MAX_LINKED_DOCS + 3; i++) {
      writeFileSync(join(root, 'docs', `d${i}.md`), '# nada\n')
      links.push(`- ver \`docs/d${i}.md\``)
    }
    writeFileSync(join(root, 'AGENTS.md'), links.join('\n'))
    const { docs, truncated } = readRepoDocs(root)
    expect(truncated).toBe(true)
    expect(docs).toHaveLength(1 + MAX_LINKED_DOCS)
    const r = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(r.stdout).toMatch(/solo se han mirado los primeros/)
  })

  it('un enlace roto no dice nada, pero un AGENTS.md ilegible sí', () => {
    const root = tmp()
    writeFileSync(join(root, 'AGENTS.md'), '- ver `docs/no-existe.md`\n')
    expect(readRepoDocs(root).failures).toEqual([])
    const root2 = tmp()
    mkdirSync(join(root2, 'AGENTS.md'))
    expect(readRepoDocs(root2).failures.join(' ')).toMatch(/AGENTS\.md/)
  })
})
