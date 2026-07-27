import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'

// F10 — el enlace al spec, de punta a punta y por la CLI.
//
// El defecto que cierra, reproducido antes de tocar nada y verificado contra
// GitHub de verdad (no contra una lectura del markdown):
//
//   > Slice `#1` del epic. Spec: [docs/x-design.md#9](docs/x-design.md#9)
//
//   1. `gh api /markdown -X POST` con mode:gfm y context:owner/repo devuelve
//      el href TAL CUAL: `<a href="docs/x-design.md#9">`. En la página de un
//      issue (github.com/owner/repo/issues/N) eso resuelve contra esa URL y
//      da 404. En un README funcionaría; en un issue, que es donde vive esta
//      línea, no.
//   2. El ancla no existe: el encabezado real es "## 9. Slices" y el id que
//      GitHub genera es "9-slices" — comprobado en el HTML renderizado del
//      propio fichero.
//
// Estos tests son los que fallan contra el código sin arreglar: comprueban
// que la línea que se escribe lleve una URL ABSOLUTA y el ancla del
// encabezado REAL, no un "#9".

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const env = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SPEC = `# Plan actual vs propuestas — design

## 8. Contexto

Texto.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

function run(dir, spec, extra = [], overrides = {}) {
  return spawnSync('node', [script, spec, '--milestone', 'Epic', '--dry-run', ...extra], { encoding: 'utf8', env: env(overrides) })
}

function planOf(res) {
  return JSON.parse(res.stdout)
}

describe('ct-groom — el enlace al spec es absoluto y con el ancla real (F10)', () => {
  it('la línea lleva una URL absoluta de GitHub, no una ruta relativa (una relativa da 404 desde la página de un issue)', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const plan = planOf(run(dir, spec))
    const link = plan.issues[0].specLink
    expect(link).toContain('](https://github.com/o/r/blob/main/spec.md')
    // Y NADA de la forma vieja: destino relativo.
    expect(link).not.toMatch(/\]\((?!https:\/\/)/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el ancla es la del encabezado real ("## 9. Slices" → "#9-slices"), nunca el número de sección', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const link = planOf(run(dir, spec)).issues[0].specLink
    expect(link).toContain('#9-slices')
    expect(link).not.toMatch(/#9\)/) // el "#9" pelado de antes
    rmSync(dir, { recursive: true, force: true })
  })

  it('el ancla sale del TEXTO del encabezado, no de su número: un spec cuya §9 se llama de otra forma produce otra ancla', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, SPEC.replace('## 9. Slices', '## Desglose en slices'))
    const link = planOf(run(dir, spec, [], { FAKE_GH_CONTENTS_ANCHORS: 'desglose-en-slices' })).issues[0].specLink
    expect(link).toContain('#desglose-en-slices')
    expect(link).toContain('§ Desglose en slices')
    rmSync(dir, { recursive: true, force: true })
  })

  it('el enlace se escribe en el BODY de cada issue, no solo en el campo specLink del plan', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const plan = planOf(run(dir, spec))
    expect(plan.issues[0].body.split('\n')[0]).toBe(plan.issues[0].specLink)
    expect(plan.issues[0].body).toContain(specUrl('spec.md'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('el ancla se COMPRUEBA contra la copia publicada: si no está, se enlaza el fichero y se avisa — nunca un ancla inventada', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec, [], { FAKE_GH_CONTENTS_ANCHORS: 'otra-cosa' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/el ancla "9-slices".*no existe en la copia de spec\.md publicada/s)
    const link = planOf(res).issues[0].specLink
    expect(link).toContain(specUrl('spec.md', null))
    expect(link).not.toContain('#9-slices')
    rmSync(dir, { recursive: true, force: true })
  })

  it('la ruta del enlace es la relativa a la raíz del repo, no la del directorio de trabajo', () => {
    const dir = makeSpecDir('ctg-link-')
    mkdirSync(join(dir, 'docs', 'specs'), { recursive: true })
    const spec = join(dir, 'docs', 'specs', 'plan.md'); writeFileSync(spec, SPEC)
    const link = planOf(run(dir, spec)).issues[0].specLink
    expect(link).toContain('/blob/main/docs/specs/plan.md#9-slices')
    expect(link).toContain('[docs/specs/plan.md § 9. Slices]')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — cuando no se puede construir un enlace bueno, no pasa callado (F10)', () => {
  // "El spec escrito pero todavía sin empujar" es el caso más común de todos
  // en la vida real. Un enlace absoluto a algo no publicado es el mismo
  // defecto con otra cara.
  it('spec sin publicar en la rama por defecto → referencia SIN enlace, con el motivo en el body y aviso por stderr', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec, [], { FAKE_GH_CONTENTS_FAIL: '1' })
    expect(res.status).toBe(0) // se sigue pudiendo groomear: el enlace no es el trabajo
    expect(res.stderr).toMatch(/se queda SIN enlace/)
    const link = planOf(res).issues[0].specLink
    expect(link).toContain('sin enlace: el spec no está publicado en la rama por defecto del repositorio (o/r, rama main)')
    expect(link).not.toMatch(/\]\(/) // ni un enlace markdown a medias
    expect(link).not.toContain('https://')
    rmSync(dir, { recursive: true, force: true })
  })

  it('spec fuera de cualquier repo git → referencia SIN enlace, con el motivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-nogit-')) // a propósito: NO es un repo
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/se queda SIN enlace.*no está dentro de un repositorio git/s)
    expect(planOf(res).issues[0].specLink).toContain('sin enlace: el spec no está dentro de un repositorio git')
    rmSync(dir, { recursive: true, force: true })
  })

  it('repo sin remoto "origin" → referencia SIN enlace, con el motivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-noremote-'))
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' })
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(planOf(res).issues[0].specLink).toContain('sin enlace: el repositorio del spec no tiene remoto "origin"')
    rmSync(dir, { recursive: true, force: true })
  })

  it('tabla §9 sin ningún encabezado encima → enlace al fichero (que sí sirve) y aviso de que no aterriza en la sección', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, '| # | Slice | Dep |\n|---|---|---|\n| 1 | login | – |\n')
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no vive bajo ningún encabezado/)
    const link = planOf(res).issues[0].specLink
    // El destino del enlace no lleva fragmento: ni el ancla inventada de
    // antes ni un "#" colgante. (El "#1" del principio de la línea es el
    // orden del slice, y va en código inline desde F6.)
    expect(link).toMatch(/\]\((https:\/\/[^)#]+)\)$/)
    expect(link).toContain(specUrl('spec.md', null))
    rmSync(dir, { recursive: true, force: true })
  })

  it('encabezado sin ancla utilizable ("## ...") → enlace al fichero, aviso, y NUNCA un "#" colgante', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, SPEC.replace('## 9. Slices', '## ...'))
    const res = run(dir, spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no produce ningún ancla/)
    const link = planOf(res).issues[0].specLink
    expect(link).toContain(specUrl('spec.md', null))
    expect(link).not.toMatch(/spec\.md#\)/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Un ancla VÁLIDA que aterriza en el sitio equivocado es peor que ninguna:
  // no falla, no avisa, y quien la pincha cree que está leyendo su §9. Pasa
  // en cuanto el documento repite el texto del encabezado (un resumen arriba,
  // el desarrollo abajo), porque GitHub sufija la segunda aparición.
  it('encabezado repetido en el documento: la tabla bajo la SEGUNDA copia enlaza al ancla sufijada, no a la primera', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md')
    writeFileSync(spec, `## 9. Slices\n\n(resumen)\n\n${SPEC.slice(SPEC.indexOf('## 9. Slices'))}`)
    const link = planOf(run(dir, spec, [], { FAKE_GH_CONTENTS_ANCHORS: '9-slices 9-slices-1' })).issues[0].specLink
    expect(link).toContain('#9-slices-1')
    rmSync(dir, { recursive: true, force: true })
  })

  it('un spec con finales de línea CRLF resuelve el mismo encabezado y el mismo ancla', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC.replace(/\n/g, '\r\n'))
    expect(planOf(run(dir, spec)).issues[0].specLink).toContain('#9-slices')
    rmSync(dir, { recursive: true, force: true })
  })

  // El enlace apunta a donde vive el SPEC, que no tiene por qué ser el repo
  // donde se crean los issues (--repo). Usar --repo para construirlo daría un
  // enlace a un fichero que no está ahí.
  it('el enlace apunta al repo del SPEC, no al de --repo', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'otro/destino', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: env() })
    expect(planOf(res).issues[0].specLink).toContain('https://github.com/o/r/blob/main/spec.md#9-slices')
    rmSync(dir, { recursive: true, force: true })
  })

  // Idempotencia: dos corridas seguidas sobre el mismo spec producen la misma
  // línea. Si no, F5 reportaría divergencia en cada corrida y --reconcile
  // (EXPERIMENTAL, ya ha corrompido bodies reales) se dedicaría a reescribir
  // issues sanos indefinidamente.
  it('dos corridas seguidas producen EXACTAMENTE la misma línea (ni con enlace ni degradada hay ping-pong)', () => {
    const dir = makeSpecDir('ctg-link-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    for (const overrides of [{}, { FAKE_GH_CONTENTS_FAIL: '1' }]) {
      const a = planOf(run(dir, spec, [], overrides)).issues[0].specLink
      const b = planOf(run(dir, spec, [], overrides)).issues[0].specLink
      expect(a).toBe(b)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})
