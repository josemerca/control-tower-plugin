import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ADDENDA } from '../scripts/kickoff.js'
import { parseState, readBlocked } from '../scripts/state.js'

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
// CONTRACT_VERSION: la versión del contrato se LEE del propio ct-init.sh, no
// se repite a mano en cada aserción. F11 la subió de 2 a 3 y hubo que tocar
// cinco tests que la llevaban hardcodeada — un coste que no aporta ninguna
// garantía (ninguno de esos tests trata SOBRE el número, solo necesitan "la
// versión que este script emite hoy").
// (F10 llegó a la misma conclusión por su cuenta, con otro nombre; al
// integrar se conserva esta, que además trae el helper `versionLineRe`.)
const CONTRACT_VERSION = Number(initScriptSrc.match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])
const versionLineRe = () => new RegExp(`<!-- ct-init:slices-contract-version: ${CONTRACT_VERSION} -->`)

function extractBlock(agentsMd) {
  const lines = agentsMd.split('\n')
  const start = lines.indexOf(MARKER_OPEN)
  const end = lines.indexOf(MARKER_CLOSE)
  if (start === -1 || end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// ---------------------------------------------------------------------------
// F9 — el bloque del contrato cambió NUEVE veces con contenido distinto, ocho
// de ellas bajo el mismo nombre "v1" (la línea de versión no existió hasta
// F6). SLICES_PRISTINE_HASHES solo registraba dos, así que un AGENTS.md
// sembrado por el plugin 0.5.1 y jamás tocado recibía un "la has editado a
// mano" y se quedaba sin poder actualizarse. Estos helpers reconstruyen desde
// el propio historial de git TODOS los bloques que ct-init.sh llegó a emitir:
// es la lista que la suite compara contra la registrada, para que registrar el
// hash nuevo (o no borrar uno viejo) no dependa de que alguien se acuerde.
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

// extractBlockFromSource: el bloque tal cual lo emitiría ese ct-init.sh. El
// bloque vive dentro de un heredoc `<<'EOF'` sin expansión, así que las líneas
// del script entre el marcador de apertura y el de cierre (comparadas como
// línea COMPLETA, que es como nunca coinciden con las asignaciones tipo
// `SLICES_MARKER_OPEN='...'`) son literalmente lo que se escribe en el
// AGENTS.md. El test `el extractor textual coincide con lo que ct-init emite
// de verdad` lo comprueba contra una ejecución real, para que este atajo no
// pueda derivar en silencio.
function extractBlockFromSource(src) {
  const lines = src.split('\n')
  const start = lines.indexOf(MARKER_OPEN)
  if (start === -1) return null
  const end = lines.indexOf(MARKER_CLOSE, start)
  if (end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}

// historicalContractBlocks: cada bloque DISTINTO emitido por algún commit
// alcanzable desde HEAD, en orden de aparición. Criterio deliberado (ver el
// comentario de SLICES_PRISTINE_HASHES en ct-init.sh): todo commit de la
// historia, no solo los que bumpean la versión del plugin — este repo no tiene
// tags, un plugin de Claude Code se instala clonando un ref, y de todas formas
// cinco bloques distintos convivieron bajo el mismo plugin.json 0.6.0.
// No cubre el árbol de trabajo sin commitear: de eso se encarga el test del
// hash del bloque de HOY.
let historicalCache = null
function historicalContractBlocks() {
  if (historicalCache) return historicalCache
  let commits
  try {
    commits = git(['rev-list', 'HEAD']).trim().split('\n').filter(Boolean)
  } catch (err) {
    // Deliberadamente NO se salta en silencio: este es el único guardián que
    // detecta que a SLICES_PRISTINE_HASHES le falta (o le sobra) un hash, y
    // saltárselo sin decir nada es el mismo fallo que viene a evitar.
    throw new Error(
      'los tests de SLICES_PRISTINE_HASHES necesitan el historial de git del plugin ' +
        '(reconstruyen desde ahí todos los bloques del contrato que ct-init llegó a emitir). ' +
        `No se ha podido leer: ${err.message}`
    )
  }
  const oids = []
  const seenOid = new Set()
  for (const c of commits) {
    let oid
    try {
      oid = git(['rev-parse', '--verify', '--quiet', `${c}:scripts/ct-init.sh`]).trim()
    } catch {
      continue // el fichero no existía todavía en ese commit
    }
    if (oid && !seenOid.has(oid)) { seenOid.add(oid); oids.push({ oid, commit: c }) }
  }
  const blocks = []
  const seenBlock = new Set()
  for (const { oid, commit } of oids) {
    const block = extractBlockFromSource(git(['cat-file', 'blob', oid]))
    if (!block || seenBlock.has(block)) continue // pre-F2 (aún no sembraba nada), o ya visto
    seenBlock.add(block)
    blocks.push({ block, commit: commit.slice(0, 7), hash: sha256(block) })
  }
  historicalCache = blocks
  return blocks
}

// seedFreshAgentsMd: corre ct-init.sh en un dir vacío y devuelve el AGENTS.md
// que siembra — el bloque de HOY, tal cual sale del script (no leído de su
// fuente), que es contra lo que se validan tanto el registro de hashes como el
// extractor textual de arriba.
function seedFreshAgentsMd() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('bash', [script, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return agents
}

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
  // F7: el STATE.md sembrado tiene que traer el campo `blocked` — y tiene que
  // seguir siendo un STATE.md parseable con el campo dentro (no solo un
  // comentario suelto que nadie lee).
  it('el STATE.md sembrado trae `blocked: null` y explica para qué sirve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const state = readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')
    expect(state).toMatch(/^blocked: null$/m)
    expect(state).toMatch(/reason:/)
    expect(state).toMatch(/unblock:/)
    const { meta } = parseState(state)
    expect(meta.blocked).toBe(null)
    expect(readBlocked(meta).state).toBe('none')
    // Y el otro campo que se lee mal en frío queda con su tiempo verbal escrito.
    expect(state).toMatch(/PENDIENTE/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Estrechar el formato crea una categoría nueva: los STATE.md anteriores al
  // campo. Siguen funcionando (se leen como NO bloqueados) pero su dueño no se
  // enteraría nunca de que ahora existe otra forma de decirlo.
  it('STATE.md preexistente SIN el campo `blocked` → no se toca, pero se dice que existe el campo y cómo usarlo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "lo mío"\nnext_action: "seguir"\n---\ncuerpo')
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(out).toMatch(/no se pisa/)
    expect(out).toMatch(/`blocked`/)
    expect(out).toMatch(/unblock/)
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toContain('task: "lo mío"')
    rmSync(dir, { recursive: true, force: true })
  })

  it('STATE.md preexistente que YA declara `blocked` → no repite el aviso', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "lo mío"\nblocked: null\n---\ncuerpo')
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(out).toMatch(/STATE\.md ya existe, no se pisa/)
    expect(out).not.toMatch(/unblock/)
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
    expect(table).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |')
    const specDir = mkdtempSync(join(tmpdir(), 'ct-example-'))
    const specPath = join(specDir, 'spec.md')
    writeFileSync(specPath, `## 9. Desglose en slices\n${table}`)
    // F21: el ejemplo trae ahora una fila con un gate declarado, así que el
    // groom avisa por stderr (es su trabajo: un gate que no viene del Tipo se
    // dice en voz alta). Ese stderr es ESPERADO aquí — se captura en vez de
    // ecoarlo a la salida de `npm test`, igual que hace ct-groom-dryrun.test.js.
    const out = execFileSync('node', [groomScript, specPath, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeGhEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(3)
    expect(plan.issues[0].title).toBe('#1 modelo')
    expect(plan.issues[1].title).toBe('#2 barra')
    expect(plan.issues[2].title).toBe('#3 pantalla')
    expect(plan.issues[0].body).toContain('tabla `medicamentos`') // Entrega -> Descripción
    // F21: el ejemplo sembrado no solo parsea — DEMUESTRA la columna Gate. La
    // fila 2 es `backend` con `Gate: visual` (el caso real que motivó la
    // columna) y la fila 3 es `ui` sin declarar nada, que recibe su gate
    // igualmente. Si alguien cambiara el ejemplo por uno que no ejercita
    // ninguno de los dos caminos, esto se entera.
    expect(plan.issues[1].labels).toContain('gate:visual') // declarado, contra su Tipo
    expect(plan.issues[2].labels).toContain('gate:visual') // implícito, por Tipo: ui
    expect(plan.issues[0].labels).toContain('gate:none')
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
    expect(res.stderr).toMatch(new RegExp(`v${CONTRACT_VERSION}`))
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
    expect(agents).toMatch(versionLineRe())
    // Y correrlo otra vez ya no tiene nada que hacer.
    const again = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/al día/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract sobre un bloque NO RECONOCIDO → se niega, y dice que puede ser una edición a mano O una versión que no conoce (sin elegir)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    expect(edited).not.toBe(V1_BLOCK) // control: la edición se aplicó de verdad
    const before = `# AGENTS.md\n\n${edited}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(3) // se pidió actualizar y no se pudo: no es un éxito
    // F9: lo que el script SABE es que ese hash no está en su lista. Que sea
    // una edición del usuario es UNA de las dos lecturas posibles, y no puede
    // distinguirlas — así que no puede afirmar ninguna. Antes decía "la has
    // editado a mano" a secas, y con eso acusaba a quien solo tenía un
    // AGENTS.md sembrado por una versión anterior del plugin.
    expect(res.stderr).not.toMatch(/la has editado a mano/)
    expect(res.stderr).toMatch(/edición a mano/) // (a)
    expect(res.stderr).toMatch(/versión del plugin cuyo hash este ct-init no lleva registrado/) // (b)
    expect(res.stderr).toMatch(/NO hay forma de distinguirlas/)
    // Y da el dato con el que salir de dudas / conseguir que se registre.
    expect(res.stderr).toContain(sha256(extractBlock(before)))
    expect(res.stderr).toContain('--force')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract --force sobre un bloque no reconocido → lo sobrescribe, y avisa en condicional (no afirma que hubiera ediciones)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n\n${edited}`)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract', '--force'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no coincidía con ninguna versión que este ct-init sepa reconocer/)
    expect(res.stderr).toMatch(/Si había ediciones tuyas/) // condicional, no "tus cambios se han perdido"
    expect(res.stderr).not.toMatch(/EDITADA A MANO/)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).not.toContain('en ESTE repo también usamos')
    expect(agents).toMatch(versionLineRe())
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F9 — el caso real: un AGENTS.md sembrado por el plugin 0.5.1, byte a byte
  // como salió de ct-init, recibía "la has editado a mano" y exit 3. El
  // contenido del bloque cambió nueve veces (ocho de ellas llamándose todas
  // "v1"), y SLICES_PRISTINE_HASHES solo registraba dos de esos nueve.
  // ==========================================================================
  it('TODO bloque que ct-init emitió alguna vez, intacto, se actualiza con --update-slices-contract sin --force y sin acusar a nadie', () => {
    const historical = historicalContractBlocks()
    // Control: si esto no reconstruye varias versiones, el test no prueba nada.
    expect(historical.length).toBeGreaterThanOrEqual(9)
    const current = historical.find((h) => sha256(h.block) === sha256(extractBlock(seedFreshAgentsMd())))
    expect(current).toBeDefined() // el bloque de hoy también sale del historial
    for (const { block, commit } of historical) {
      const dir = mkdtempSync(join(tmpdir(), 'ct-'))
      const before = `# AGENTS.md\n\n## Gotchas\n- notas de ${commit}\n\n${block}\n## Después\n- intocable\n`
      writeFileSync(join(dir, 'AGENTS.md'), before)
      const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
      expect(res.status, `${commit}: ${res.stderr}`).toBe(0)
      expect(res.stderr, commit).not.toMatch(/editado a mano|EDITADA A MANO|no coincide/)
      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
      // Queda el contrato actual, y el resto del fichero sin tocar.
      expect(agents, commit).toContain(`- notas de ${commit}`)
      expect(agents, commit).toContain('- intocable')
      expect(agents, commit).toMatch(versionLineRe())
      expect(agents.split(MARKER_OPEN).length - 1, commit).toBe(1)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sin poder calcular el sha256 (ni shasum ni sha256sum) NO se acusa a nadie: se dice que no se ha podido comprobar, y no se toca nada', () => {
    // La comprobación de "sin editar" es lo único que separa un update seguro
    // de pisar trabajo ajeno. Si la máquina no puede hacerla, el estado no es
    // "editado a mano" — es "no se sabe", y no tiene el mismo remedio.
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = `# AGENTS.md\n\n${V1_BLOCK}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const binDir = join(dir, 'fake-bin')
    mkdirSync(binDir)
    for (const tool of ['bash', 'awk', 'grep', 'sed', 'mkdir', 'cp', 'cat', 'mktemp', 'mv', 'rm', 'touch', 'tail', 'wc', 'head', 'dirname', 'pwd']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
      if (found) symlinkSync(found, join(binDir, tool))
    }
    // Control: en este PATH no hay con qué hashear.
    for (const h of ['shasum', 'sha256sum']) {
      expect(existsSync(join(binDir, h))).toBe(false)
    }
    const env = { ...process.env, PATH: binDir }
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8', env })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/no se ha podido comprobar/)
    expect(res.stderr).toMatch(/puede estar perfectamente intacto, simplemente no se sabe/)
    expect(res.stderr).not.toMatch(/editad[oa] a mano/i)
    expect(res.stderr).toMatch(/sha256sum/) // dice cómo desbloquearlo
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el aviso de "hay una versión más nueva" dice si actualizar es seguro, en vez del genérico "podrías tenerla editada"', () => {
    // Sin el flag, ct-init solo avisa — pero ya sabe en qué estado está el
    // bloque, así que puede decir si el update va a funcionar o a negarse.
    const intact = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(intact, 'AGENTS.md'), `# AGENTS.md\n\n${V1_BLOCK}`)
    const a = spawnSync('bash', [script, intact], { encoding: 'utf8' })
    expect(a.stderr).toMatch(/Está exactamente como la dejó ct-init/)
    expect(a.stderr).not.toMatch(/podrías tenerla editada a mano/)
    rmSync(intact, { recursive: true, force: true })

    const changed = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(changed, 'AGENTS.md'), `# AGENTS.md\n\n${V1_BLOCK.replace('- **Dep**', '- **Dep** (ojo)')}`)
    const b = spawnSync('bash', [script, changed], { encoding: 'utf8' })
    expect(b.stderr).toMatch(/no coincide con ningún bloque que este ct-init reconozca/)
    expect(b.stderr).toMatch(/puede ser una edición tuya o una versión que no tiene registrada/)
    expect(b.stderr).toMatch(/[0-9a-f]{64}/) // el hash, para poder registrarlo
    rmSync(changed, { recursive: true, force: true })
  })

  // ==========================================================================
  // F9, caso que no estaba en el encargo: saltos de línea CRLF. Todos los
  // marcadores se buscaban con `grep -qxF`, que con un `\r` pegado al final no
  // encuentra nada — ni apertura, ni cierre, ni heading. El script concluía
  // "aquí no hay sección" y añadía una SEGUNDA copia entera, en silencio.
  // ==========================================================================
  it('un AGENTS.md con saltos CRLF no recibe una segunda copia de la sección: se reconoce la que ya tiene', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const crlf = `# AGENTS.md\n\n## Gotchas\n- notas\n\n${V1_BLOCK}`.replace(/\n/g, '\r\n')
    writeFileSync(join(dir, 'AGENTS.md'), crlf)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents.split(MARKER_OPEN).length - 1).toBe(1) // no una segunda copia
    expect(agents.split('## Formato de la tabla §9').length - 1).toBe(1)
    expect(agents).toBe(crlf) // no se ha tocado nada
    // Y se da el aviso que le tocaba dar (antes se lo saltaba entero).
    expect(res.stderr).toMatch(/es del contrato v1/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('un bloque intacto con CRLF se reconoce como intacto y se actualiza sin --force, conservando los saltos CRLF', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const crlf = `# AGENTS.md\n\n## Gotchas\n- notas\n\n${V1_BLOCK}`.replace(/\n/g, '\r\n')
    writeFileSync(join(dir, 'AGENTS.md'), crlf)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/actualizada/)
    expect(res.stderr).not.toMatch(/no coincide|editad/i) // los saltos no son una edición
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents.split(MARKER_OPEN).length - 1).toBe(1)
    expect(agents).toContain('- notas')
    expect(agents).toMatch(versionLineRe())
    // El bloque nuevo mantiene CRLF: nada de dejar el fichero a medias.
    expect(agents).not.toMatch(/[^\r]\n/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('una sección de una versión MÁS NUEVA que la del plugin no se llama "al día": se dice que el desactualizado es el plugin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const seeded = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    const fromFuture = seeded.replace(`slices-contract-version: ${CONTRACT_VERSION}`, `slices-contract-version: ${CONTRACT_VERSION + 1}`)
    writeFileSync(join(dir, 'AGENTS.md'), fromFuture)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/al día/)
    expect(res.stderr).toMatch(new RegExp(`v${CONTRACT_VERSION + 1}`))
    expect(res.stderr).toMatch(/más nueva del plugin/)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(fromFuture) // no se degrada
    rmSync(dir, { recursive: true, force: true })
  })

  it('la versión se lee del BLOQUE: una línea de versión citada más arriba en el AGENTS.md no secuestra el diagnóstico', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    // El usuario documenta el marcador en sus propias notas, más arriba.
    const before = `# AGENTS.md\n\n## Gotchas\n- la sección §9 la marca \`<!-- ct-init:slices-contract-version: 99 -->\`\n\n${V1_BLOCK}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/v99/) // antes: "contrato v99, al día", sin mirar el bloque
    expect(res.stderr).toMatch(/es del contrato v1/)
    expect(res.stderr).toContain('--update-slices-contract')
    rmSync(dir, { recursive: true, force: true })
  })

  it('un bloque que ya declara la versión actual pero con OTRO contenido no se despacha como "al día" cuando se pide actualizar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const seeded = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    const tweaked = seeded.replace('status:backlog', 'status:backlog-de-la-casa')
    expect(tweaked).not.toBe(seeded)
    writeFileSync(join(dir, 'AGENTS.md'), tweaked)
    // Corrida normal: se calla (el número de versión ES el actual y no hay
    // nada que ofrecer — avisar aquí sería ruido en cada sesión).
    const plain = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(plain.stdout).toMatch(/al día/)
    expect(plain.stderr).not.toMatch(/aviso/)
    // Pero si se PIDE sincronizar, decir "al día" sería tapar que el texto no
    // es el de este plugin — que es exactamente lo que pasó nueve veces bajo
    // el nombre "v1".
    const asked = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(asked.status).toBe(0)
    expect(asked.stdout).not.toMatch(/al día/)
    expect(asked.stderr).toMatch(/no hay actualización de versión que hacer/)
    expect(asked.stderr).toMatch(/NO es el que emite este plugin/)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(tweaked)
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

  // F9 — el test de arriba solo cubre el bloque de HOY, y por eso F6 pudo
  // registrar dos hashes creyendo que eran todos: la lista puede quedarse
  // corta por abajo (una variante antigua que nunca se registró) o encogerse
  // (alguien "limpia" un hash viejo creyéndolo muerto), y ninguna de las dos
  // se nota hasta que un usuario con esa variante recibe una acusación falsa.
  // Este cierra el hueco: la fuente de verdad no es la memoria de nadie, es el
  // historial de git. Entre los dos cubren todo — este, lo commiteado; el de
  // arriba, el árbol de trabajo todavía sin commitear.
  it('todo bloque que ct-init emitió alguna vez en la historia está registrado en SLICES_PRISTINE_HASHES', () => {
    const historical = historicalContractBlocks()
    expect(historical.length).toBeGreaterThanOrEqual(9) // control: se reconstruyó de verdad
    const missing = historical
      .filter(({ hash }) => !initScriptSrc.includes(hash))
      .map(({ commit, hash }) => `${commit} → ${hash}`)
    expect(
      missing,
      `Bloques del contrato que ct-init emitió y ya no sabe reconocer. Añade cada hash a ` +
        `SLICES_PRISTINE_HASHES en scripts/ct-init.sh (AÑADIR, nunca sustituir): un repo ` +
        `sembrado con esa variante y sin tocar recibe "no coincide con ninguna versión ` +
        `conocida" y no puede actualizarse sin --force.`
    ).toEqual([])
  })

  it('el extractor textual del historial coincide con lo que ct-init emite de verdad al correr', () => {
    // El test de arriba lee los bloques históricos de la FUENTE de cada
    // ct-init.sh (entre marcadores, dentro de su heredoc) en vez de ejecutar
    // cada versión. Si ese atajo dejara de ser fiel, el guardián dejaría de
    // guardar nada sin que nadie se enterase.
    const emitted = extractBlock(seedFreshAgentsMd())
    expect(extractBlockFromSource(initScriptSrc)).toBe(emitted)
  })

  it('SLICES_PRISTINE_HASHES no registra hashes de bloques que no existieron nunca', () => {
    // La otra dirección: un hash inventado (o el de una rama que no llegó a
    // main) hace que ct-init reemplace en silencio algo que no reconoce de
    // verdad. Todo hash registrado tiene que corresponder a un bloque real.
    const registered = initScriptSrc
      .split('\n')
      .map((l) => l.trim().match(/^([0-9a-f]{64})\b/))
      .filter(Boolean)
      .map((m) => m[1])
    expect(registered.length).toBeGreaterThanOrEqual(9)
    const known = new Set(historicalContractBlocks().map((h) => h.hash))
    known.add(sha256(extractBlock(seedFreshAgentsMd()))) // el árbol de trabajo
    expect(registered.filter((h) => !known.has(h))).toEqual([])
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
