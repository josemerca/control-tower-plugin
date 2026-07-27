import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ADDENDA } from '../scripts/kickoff.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')
const groomScript = join(root, 'scripts', 'ct-groom.mjs')

// F5: ct-groom.mjs --dry-run ahora también enumera issues existentes de
// `--repo` (lectura, para detectar divergencia) — sin un `gh` de mentira en
// el PATH, el único test de este fichero que invoca groomScript llamaría al
// `gh` real de la máquina contra el repo ficticio "o/r". Mismo stub y mismo
// criterio que __tests__/ct-groom-dryrun.test.js: sin overrides, responde
// "ningún issue existente", que es lo correcto para un plan recién creado.
const fakeGhDir = join(root, '__tests__', 'fixtures', 'fake-gh-bin')
const fakeGhEnv = { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` }

// extractWorkedExample: saca el bloque de tabla markdown bajo "Ejemplo que
// parsea tal cual" del AGENTS.md sembrado por ct-init.sh — las mismas
// líneas que empiezan por "|", contiguas, hasta la primera línea que no
// empiece por "|" (la prosa "Detalle completo..." que cierra la sección).
// F6, menor 6 — la sección sembrada lleva ahora una versión, y hay una vía
// EXPLÍCITA para actualizar un repo ya bootstrapeado. Helpers compartidos:
const MARKER_OPEN = '<!-- ct-init:slices-contract -->'
const MARKER_CLOSE = '<!-- /ct-init:slices-contract -->'
// El bloque REAL que sembraba la versión anterior del contrato (v1, sin línea
// de versión), byte a byte. Vive como fixture porque es la única forma de
// probar de verdad la migración de un repo bootstrapeado antes de F6 — que es
// justo el caso que menor 6 describe (menoplus, el sandbox, cualquier repo ya
// inicializado). Su hash está registrado en SLICES_PRISTINE_HASHES; el test
// de "hashes registrados" (más abajo) lo comprueba, así que este fichero no
// puede derivar sin que la suite se entere.
const V1_BLOCK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'slices-contract-v1.md'), 'utf8')
const initScriptSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-init.sh'), 'utf8')

function extractBlock(agentsMd) {
  const lines = agentsMd.split('\n')
  const start = lines.indexOf(MARKER_OPEN)
  const end = lines.indexOf(MARKER_CLOSE)
  if (start === -1 || end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function extractWorkedExample(agentsMd) {
  const lines = agentsMd.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('Ejemplo que parsea tal cual'))
  const tableLines = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) tableLines.push(lines[i])
    else if (tableLines.length) break
  }
  return tableLines.join('\n') + '\n'
}

describe('ct-init.sh', () => {
  it('crea .agent/STATE.md y AGENTS.md en dir vacío', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(existsSync(join(dir, '.agent', 'STATE.md'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
  it('idempotente: no pisa un STATE.md existente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), 'MÍO')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toBe('MÍO')
    rmSync(dir, { recursive: true, force: true })
  })
  it('idempotente: no pisa un AGENTS.md existente (preserva su contenido, solo añade la sección §9 si falta)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), 'MÍO-AGENTS')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // El contenido del usuario no se toca ni se reordena...
    expect(agents.startsWith('MÍO-AGENTS')).toBe(true)
    // ...pero, F2: la sección §9 (contrato con /ct-groom) se añade igual,
    // porque este AGENTS.md no la traía.
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    rmSync(dir, { recursive: true, force: true })
  })

  // F2: el contrato de la tabla §9 (qué columnas exige /ct-groom, qué
  // marcadores de "sin valor" acepta, qué genera cada una) hasta ahora solo
  // vivía en commands/ct-groom.md — un fichero que lee quien EJECUTA groom,
  // nunca quien ESCRIBE el spec. `ct-init` debe sembrar ese contrato en el
  // AGENTS.md del repo destino, que sí lee quien escribe specs.
  it('AGENTS.md nuevo: el esqueleto ya trae la sección §9 (contrato con /ct-groom)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    expect(agents).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |')
    rmSync(dir, { recursive: true, force: true })
  })

  // F3: el contrato sembrado escondía que "Tipo" decide el addendum del
  // agente despachado, y que el título del issue sale de "Slice" (no de
  // "Entrega") — ver el hallazgo del spec real que disparó este cambio.
  it('AGENTS.md nuevo: la sección §9 dice que "Slice" es obligatoria y alimenta el título, y que "Entrega" es opcional (Descripción)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/\*\*Slice\*\* \*\(obligatoria\)\*/)
    expect(agents).toMatch(/T.TULO/i)
    expect(agents).toMatch(/\*\*Entrega\*\* \*\(opcional\)\*/)
    expect(agents).toContain('Descripción')
    rmSync(dir, { recursive: true, force: true })
  })

  // Review de F3, finding 2: esta aserción antes listaba los cuatro tipos
  // como literales escritos a mano ('ui'/'backend'/'infra'/'bugfix') — si
  // alguien añade un quinto addendum a ADDENDA (kickoff.js), el aviso en
  // runtime de ct-groom.mjs lo reflejaría solo (deriva de
  // Object.keys(ADDENDA)), pero este test seguiría en VERDE con la prosa
  // sembrada diciendo solo cuatro, sin detectar la deriva. Se deriva de
  // ADDENDA en vez de hardcodear una tercera copia de la lista: el test se
  // autovigila, no hace falta tocarlo cuando se añada un tipo nuevo.
  it('AGENTS.md nuevo: la sección §9 nombra TODOS los valores de "Tipo" reconocidos (derivado de ADDENDA, no una lista hardcodeada) y que deciden el addendum', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/addendum/i)
    expect(Object.keys(ADDENDA).length).toBeGreaterThan(0) // control: si ADDENDA quedara vacío, el .every() de abajo pasaría vacío y no probaría nada
    expect(Object.keys(ADDENDA).every((t) => agents.includes(`\`${t}\``))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // Requisito explícito: el ejemplo sembrado debe seguir parseando de
  // verdad — se extrae tal cual del AGENTS.md generado (no una copia
  // parafraseada en el test) y se pasa por ct-groom.mjs --dry-run.
  it('el ejemplo sembrado ("Ejemplo que parsea tal cual") parsea de verdad con ct-groom.mjs --dry-run: 3 issues, títulos desde "Slice"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    const table = extractWorkedExample(agents)
    expect(table).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |')
    const specDir = mkdtempSync(join(tmpdir(), 'ct-example-'))
    const specPath = join(specDir, 'spec.md')
    writeFileSync(specPath, `## 9. Desglose en slices\n${table}`)
    const out = execFileSync('node', [groomScript, specPath, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeGhEnv })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(3)
    expect(plan.issues[0].title).toBe('#1 modelo')
    expect(plan.issues[1].title).toBe('#2 api')
    expect(plan.issues[2].title).toBe('#3 pantalla')
    expect(plan.issues[0].body).toContain('tabla `medicamentos`') // Entrega -> Descripción
    rmSync(dir, { recursive: true, force: true })
    rmSync(specDir, { recursive: true, force: true })
  })

  // Control de los cinco tests siguientes: el contrato ANTERIOR (fixture
  // slices-contract-v1.md, el bloque real que sembraba la versión previa) no
  // decía ninguna de estas cinco cosas. Sin esta comprobación, cualquiera de
  // esos tests podría estar pasando por una coincidencia de prosa en vez de
  // por el contenido que F6 añade.
  it('control: el contrato anterior (v1) no decía nada de esto — los cinco tests siguientes no pasan por casualidad', () => {
    expect(V1_BLOCK).not.toContain('status:backlog')
    expect(V1_BLOCK).not.toContain('status:ready')
    expect(V1_BLOCK).not.toContain('\\,')
    expect(V1_BLOCK).not.toContain('--milestone')
    expect(V1_BLOCK).not.toContain('--section')
    expect(V1_BLOCK).not.toContain('--project')
    expect(V1_BLOCK).not.toContain('gh label list')
    expect(V1_BLOCK).not.toContain('merge-after `#N`')
  })

  // F6, grave 2: el contrato no mencionaba `status:backlog` ni una sola vez.
  // Quien solo lee AGENTS.md groomeaba un epic entero y descubría después que
  // /ct-next no veía ninguno de esos issues.
  it('el contrato dice que los issues nacen en status:backlog, que promoverlos a status:ready es un paso humano, y con qué comando', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('status:backlog')
    expect(agents).toContain('status:ready')
    expect(agents).toMatch(/humano/i)
    expect(agents).toContain('gh issue edit')
    expect(agents).toMatch(/ct-next/)
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, importante 3: "coma-separados" sin decir qué pasa con una coma
  // DENTRO de un criterio — y la sección que genera se llama "Acceptance
  // criteria (EARS…)", donde la coma es casi obligatoria.
  it('el contrato explica que la coma separa siempre en "Acepta" y cómo escaparla', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('\\,')
    expect(agents).toMatch(/Protegido[\s\S]{0,400}la coma\s+\*\*no\*\*/i) // y dónde NO separa
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, importante 4: el contrato hablaba de "la tabla §9" como si fuera un
  // sitio fijo, sin decir de dónde sale el número de sección, si el milestone
  // es obligatorio, ni por qué --project tiene las restricciones que tiene.
  it('el contrato explica qué decisiones del autor dependen de --milestone/--section/--project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('--milestone')
    expect(agents).toContain('--section')
    expect(agents).toContain('--project')
    expect(agents).toMatch(/únicos \*\*dentro de su milestone\*\*/i) // el alcance real de los "#"
    expect(agents).toMatch(/cabecera/i) // la tabla se localiza por cabecera, no por el número de sección
    expect(agents).toContain('Sprint')
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, menor 5: "reutiliza el vocabulario que ya exista" sin decir cómo
  // comprobarlo.
  it('el contrato dice cómo comprobar qué labels existen ya en el repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('gh label list')
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, grave 1: quien escribe la tabla tiene que saber que el "#N" que verá
  // en el cuerpo del issue NO es un número de issue.
  it('el contrato avisa de que el "#N" de merge-after es el orden de la tabla, no un issue de GitHub', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('merge-after `#N`')
    expect(agents).toMatch(/nunca un número de issue/i)
    expect(agents).toContain('ct-order')
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md existente SIN la sección §9 → se añade sin tocar el resto (caso "muy editado a mano")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const heavilyEdited = [
      '# AGENTS.md',
      '',
      '## Project overview',
      'Mi proyecto rarísimo con notas personales de Jose que no se deben perder.',
      '',
      '## Gotchas',
      '- ojo con el símbolo `#` en mis propias notas, no es un slice',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), heavilyEdited)
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Mi proyecto rarísimo con notas personales de Jose que no se deben perder.')
    expect(agents).toContain('ojo con el símbolo `#` en mis propias notas, no es un slice')
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    // La sección añadida va DESPUÉS del contenido existente, no lo desplaza.
    expect(agents.indexOf('notas personales')).toBeLessThan(agents.indexOf('<!-- ct-init:slices-contract -->'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md existente SIN salto de línea final → añade la sección §9 sin corromper la última línea del usuario', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), '## Gotchas\n- última línea sin salto') // sin \n final, a propósito
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('- última línea sin salto')
    expect(agents).not.toMatch(/salto<!--/) // nunca fusionadas en la misma línea
    expect(agents).not.toMatch(/salto##/)
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md ya trae la sección §9 (editada a mano por el usuario) → no se duplica ni se pisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const customSection = [
      '# AGENTS.md',
      '',
      '<!-- ct-init:slices-contract -->',
      '## Formato de la tabla §9 (versión editada por Jose, con una columna extra)',
      'Texto completamente distinto al que generaría ct-init.',
      '<!-- /ct-init:slices-contract -->',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), customSection)
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(customSection) // ni una letra tocada
    const occurrences = agents.split('<!-- ct-init:slices-contract -->').length - 1
    expect(occurrences).toBe(1) // no duplicada
    rmSync(dir, { recursive: true, force: true })
  })

  // Review de F2, punto 2: si alguien se carga el marcador de APERTURA pero
  // deja el heading y el cuerpo (y el marcador de cierre), el `grep -qF` del
  // marcador de apertura no encuentra nada → el script cree que la sección
  // no está y añade una SEGUNDA copia entera, en silencio, exit 0: dos
  // headings "## Formato de la tabla §9...", un marcador de cierre huérfano.
  // Debe, en su lugar, detectar el rastro parcial (heading O cierre sin el
  // par completo) y avisar sin añadir nada.
  it('AGENTS.md con el marcador de APERTURA borrado (heading + cuerpo + cierre intactos) → avisa, no duplica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const orphan = [
      '# AGENTS.md',
      '',
      '## Formato de la tabla §9 (contrato con /ct-groom)',
      'cuerpo custom, el usuario borró el marcador de apertura sin querer.',
      '<!-- /ct-init:slices-contract -->',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), orphan)
    const output = execFileSync('bash', ['-c', `bash '${script}' '${dir}' 2>&1`], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(orphan) // ni una letra tocada
    const headingOccurrences = agents.split('## Formato de la tabla §9').length - 1
    expect(headingOccurrences).toBe(1) // no duplicado
    expect(output.toLowerCase()).toMatch(/aviso|warning/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md con el marcador de CIERRE borrado (apertura + heading + cuerpo intactos) → avisa, no duplica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const orphan = [
      '# AGENTS.md',
      '',
      '<!-- ct-init:slices-contract -->',
      '## Formato de la tabla §9 (contrato con /ct-groom)',
      'cuerpo custom, el usuario borró el marcador de cierre sin querer.',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), orphan)
    const output = execFileSync('bash', ['-c', `bash '${script}' '${dir}' 2>&1`], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(orphan) // ni una letra tocada
    const headingOccurrences = agents.split('## Formato de la tabla §9').length - 1
    expect(headingOccurrences).toBe(1) // no duplicado
    expect(output.toLowerCase()).toMatch(/aviso|warning/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('correrlo tres veces seguidas es idempotente: la sección §9 aparece una sola vez', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    const occurrences = agents.split('<!-- ct-init:slices-contract -->').length - 1
    expect(occurrences).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F6, menor 6 — una corrección del contrato no llegaba a los repos ya
  // bootstrapeados: ct-init detecta la sección entre sus marcadores y no la
  // toca (correcto por defecto, para no pisar ediciones a mano), así que todo
  // lo arreglado aquí se quedaba en el plugin para siempre.
  // ==========================================================================
  it('la sección sembrada declara su versión, y una segunda corrida dice que está al día (sin avisar de nada)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/<!-- ct-init:slices-contract-version: \d+ -->/)
    const again = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/al día/)
    expect(again.stderr).not.toMatch(/aviso/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sección de una versión ANTERIOR (v1, sin línea de versión) → lo dice y explica cómo actualizarla; no toca nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = `# AGENTS.md\n\n## Gotchas\n- mis notas\n\n${V1_BLOCK}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0) // avisar no es fallar
    expect(res.stderr).toMatch(/v1/)
    expect(res.stderr).toMatch(/v2/)
    expect(res.stderr).toContain('--update-slices-contract')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before) // ni una letra
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract sobre una sección v1 SIN TOCAR → la reemplaza por la actual y deja intacto el resto del fichero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n\n## Gotchas\n- mis notas irremplazables\n\n${V1_BLOCK}\n## Lo que va después\n- tampoco se toca\n`)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/actualizada/)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('- mis notas irremplazables')
    expect(agents).toContain('## Lo que va después')
    expect(agents).toContain('- tampoco se toca')
    expect(agents).toContain('status:ready') // contenido nuevo, de verdad
    expect(agents.split(MARKER_OPEN).length - 1).toBe(1) // exactamente un bloque
    expect(agents.split(MARKER_CLOSE).length - 1).toBe(1)
    expect(agents).toMatch(/<!-- ct-init:slices-contract-version: 2 -->/)
    // Y correrlo otra vez ya no tiene nada que hacer.
    const again = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/al día/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract sobre una sección EDITADA A MANO → se niega, lo distingue de "sin tocar", y no cambia nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    expect(edited).not.toBe(V1_BLOCK) // control: la edición se aplicó de verdad
    const before = `# AGENTS.md\n\n${edited}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(3) // se pidió actualizar y no se pudo: no es un éxito
    expect(res.stderr).toMatch(/editad[oa] a mano/i)
    expect(res.stderr).toContain('--force')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract --force sobre una sección editada a mano → la sobrescribe, avisando de que se pierde lo editado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n\n${edited}`)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract', '--force'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/EDITADA A MANO/)
    expect(res.stderr).toMatch(/perdid/i)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).not.toContain('en ESTE repo también usamos')
    expect(agents).toMatch(/<!-- ct-init:slices-contract-version: 2 -->/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin --update-slices-contract, --force por sí solo no toca una sección desactualizada (el opt-in es el otro flag)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = `# AGENTS.md\n\n${V1_BLOCK}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir, '--force'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('una opción desconocida aborta en vez de ignorarse en silencio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const res = spawnSync('bash', [script, dir, '--updat-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/no reconocida/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Autovigilancia: la detección de "sin tocar" se apoya en una lista de
  // hashes DENTRO del script. Si alguien edita el bloque y olvida registrar
  // el hash nuevo, la versión siguiente no podría reconocer a esta como
  // intacta (y ningún repo con ella podría actualizarse sin --force) — un
  // fallo que no se vería hasta la próxima ronda, en el repo de un usuario.
  it('el hash del bloque que se siembra HOY está registrado en SLICES_PRISTINE_HASHES (y el del fixture v1 también)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const block = extractBlock(readFileSync(join(dir, 'AGENTS.md'), 'utf8'))
    expect(block).not.toBeNull()
    expect(initScriptSrc).toContain(sha256(block))
    expect(initScriptSrc).toContain(sha256(V1_BLOCK))
    rmSync(dir, { recursive: true, force: true })
  })

  // Finding 6 de la review final: ct-next.mjs escribe cada worktree de slice
  // en <repoRoot>/.worktrees/<n>, DENTRO del propio checkout del repo
  // destino. Si ese repo no ignora `.worktrees/`, un `git add -A` en el
  // checkout principal se traga un working tree anidado entero, y un `git
  // clean -fdx` destruye worktrees vivos.
  it('añade .worktrees/ a .gitignore (crea el fichero si no existe)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  it('.gitignore ya existe con otro contenido → añade .worktrees/ sin pisar lo que ya había', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gi).toContain('node_modules/')
    expect(gi).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  it('idempotente: correrlo dos veces no duplica la línea .worktrees/ en .gitignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' }) // segunda corrida
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    const occurrences = gi.split('\n').filter((l) => l === '.worktrees/').length
    expect(occurrences).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  // Bloqueante de la re-review: un `.gitignore` que YA tiene contenido pero
  // no termina en salto de línea (p.ej. escrito a mano con `printf`, sin
  // `\n` final) hacía que `echo '.worktrees/' >> .gitignore` concatenara la
  // línea nueva en la MISMA línea que la última regla del usuario —
  // "node_modules/.worktrees/" — corrompiendo esa regla (deja de ignorar
  // node_modules/) y sin que .worktrees/ quedara ignorado de verdad tampoco
  // (el propósito entero del finding 6, incumplido en silencio). Reproduce
  // exactamente el caso reportado y comprueba que, tras el fix, las DOS
  // reglas quedan intactas en líneas separadas.
  it('.gitignore existente SIN salto de línea final → normaliza antes de añadir, sin corromper la regla previa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/') // sin \n final, a propósito
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    const lines = gi.split('\n').filter((l) => l.length > 0)
    expect(lines).toContain('node_modules/')
    expect(lines).toContain('.worktrees/')
    expect(gi).not.toMatch(/node_modules\/\.worktrees\//) // nunca concatenadas en la misma línea
    rmSync(dir, { recursive: true, force: true })
  })
})
