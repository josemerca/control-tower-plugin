// §3.12 del handoff (docs/prompt-juez-lo-que-queda.md): `reference-paths`
// prueba que lo que §3 citó EXISTE (caza la invención) — nada probaba que se
// citara TODO lo relevante (la omisión). Este fichero protege el barrido que
// cierra esa asimetría: `candidatosDeVara`, `declaradasEn`, `pareceEsqueleto`
// y `formatCandidatos` en scripts/vara.js, más el envoltorio ejecutable
// scripts/detect-vara.mjs y su enganche en scripts/ct-init.sh.
//
// La propiedad que estos tests protegen, por encima de cualquier detalle de
// formato: EL BARRIDO PROPONE Y JAMÁS DECLARA. No escribe nunca en
// `.agent/conventions.md` — sólo el humano que corre `/ct-init` decide qué
// entra ahí.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  CONVENTIONS_FILE,
  CANDIDATOS_HEADER,
  MAX_CANDIDATOS,
  MAX_POR_DIRECTORIO,
  candidatosDeVara,
  declaradasEn,
  pareceEsqueleto,
  formatCandidatos,
} from '../scripts/vara.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const detectVaraScript = join(root, 'scripts', 'detect-vara.mjs')
const initScript = join(root, 'scripts', 'ct-init.sh')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})
function tmp(prefix = 'vara-cand-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
const rutas = (r) => r.candidatos.map((c) => c.ruta)

// ---------------------------------------------------------------------------
// candidatosDeVara (puro)
// ---------------------------------------------------------------------------
describe('candidatosDeVara', () => {
  it('propone las guías de la raíz y no un homónimo bajo un subdirectorio', () => {
    const r = candidatosDeVara({
      entradas: ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CONTRIBUTING', 'docs/', 'docs/AGENTS.md'],
    })
    expect(rutas(r)).toContain('AGENTS.md')
    expect(rutas(r)).toContain('CLAUDE.md')
    expect(rutas(r)).toContain('CONTRIBUTING.md')
    expect(rutas(r)).not.toContain('docs/AGENTS.md')
    const agents = r.candidatos.find((c) => c.ruta === 'AGENTS.md')
    expect(agents.motivo).toBe('guía del repo en la raíz')
  })

  it('de un directorio que casa "convention|rules" propone SUS FICHEROS y no el directorio', () => {
    const r = candidatosDeVara({
      entradas: [
        'docs/', 'docs/conventions/', 'docs/conventions/backend.md', 'docs/conventions/frontend.md',
        '.cursor/', '.cursor/rules/', '.cursor/rules/style.md',
      ],
    })
    expect(rutas(r)).toContain('docs/conventions/backend.md')
    expect(rutas(r)).toContain('docs/conventions/frontend.md')
    expect(rutas(r)).toContain('.cursor/rules/style.md')
    // el directorio en sí NUNCA es candidato: una ruta acabada en "/" no se puede leer
    expect(rutas(r).some((x) => x.endsWith('/'))).toBe(false)
    const m = r.candidatos.find((c) => c.ruta === 'docs/conventions/backend.md').motivo
    expect(m).toContain('docs/conventions/')
    expect(m).toContain('convention|rules')
  })

  it('propone skills de proyecto por su SKILL.md', () => {
    const r = candidatosDeVara({ entradas: ['.claude/', '.claude/skills/', '.claude/skills/oc-review/', '.claude/skills/oc-review/SKILL.md'] })
    expect(rutas(r)).toContain('.claude/skills/oc-review/SKILL.md')
    const m = r.candidatos.find((c) => c.ruta === '.claude/skills/oc-review/SKILL.md').motivo
    expect(m).toContain('Skills')
  })

  it('nunca propone nada bajo .agent/ — ni la propia declaración ni el acuse, ni aunque un subdirectorio case la regla de reglas', () => {
    const r = candidatosDeVara({
      entradas: [
        '.agent/', '.agent/conventions.md', '.agent/conventions-ack.md',
        '.agent/rules/', '.agent/rules/x.md',
      ],
    })
    expect(rutas(r)).toEqual([])
  })

  it('filtra los que ya están declarados', () => {
    const r = candidatosDeVara({
      entradas: ['AGENTS.md', 'CLAUDE.md'],
      declaradas: new Set(['AGENTS.md']),
    })
    expect(rutas(r)).toEqual(['CLAUDE.md'])
  })

  it('orden determinista: da igual el orden de entrada, y no hay duplicados aunque una ruta case dos reglas', () => {
    const entradas = [
      'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md',
      'docs/', 'docs/conventions/', 'docs/conventions/rules/',
      'docs/conventions/rules/x.md', 'docs/conventions/b.md',
      '.claude/', '.claude/skills/', '.claude/skills/oc-review/', '.claude/skills/oc-review/SKILL.md',
    ]
    const a = candidatosDeVara({ entradas })
    const b = candidatosDeVara({ entradas: [...entradas].reverse() })
    expect(a).toEqual(b)
    // docs/conventions/rules/x.md casa DOS directorios que casan la regla
    // (docs/conventions/ Y docs/conventions/rules/) — una sola vez en la lista.
    expect(rutas(a).filter((x) => x === 'docs/conventions/rules/x.md').length).toBe(1)
  })

  it('omitidos cuenta lo que no cupo en MAX_POR_DIRECTORIO, y lo ya declarado no cuenta como omitido', () => {
    const ficheros = Array.from({ length: 15 }, (_, i) => `docs/conventions/f${String(i + 1).padStart(2, '0')}.md`)
    const entradas = ['docs/', 'docs/conventions/', ...ficheros]
    const sinDeclarar = candidatosDeVara({ entradas })
    expect(rutas(sinDeclarar).length).toBe(MAX_POR_DIRECTORIO)
    expect(sinDeclarar.omitidos).toBe(15 - MAX_POR_DIRECTORIO)

    const conUnoDeclarado = candidatosDeVara({ entradas, declaradas: new Set(['docs/conventions/f01.md']) })
    expect(rutas(conUnoDeclarado)).not.toContain('docs/conventions/f01.md')
    expect(rutas(conUnoDeclarado).length).toBe(MAX_POR_DIRECTORIO)
    // quedan 14 candidatas tras filtrar la declarada; se cortan a 12 → 2 omitidas
    expect(conUnoDeclarado.omitidos).toBe(14 - MAX_POR_DIRECTORIO)
  })

  it('MAX_CANDIDATOS corta la lista global ya agrupada, y cuenta el resto como omitidos', () => {
    const skills = Array.from({ length: 50 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return [`.claude/skills/s${n}/`, `.claude/skills/s${n}/SKILL.md`]
    }).flat()
    const r = candidatosDeVara({ entradas: ['.claude/', '.claude/skills/', ...skills] })
    expect(r.candidatos.length).toBe(MAX_CANDIDATOS)
    expect(r.omitidos).toBe(50 - MAX_CANDIDATOS)
  })
})

// ---------------------------------------------------------------------------
// declaradasEn
// ---------------------------------------------------------------------------
describe('declaradasEn', () => {
  it('extrae los tokens entre backticks y normaliza "./" y la barra final', () => {
    const s = declaradasEn('- `AGENTS.md`\n- `./docs/CONTRIBUTING.md`\n- `docs/conventions/`\n- ``\n- prosa sin backticks')
    expect(s.has('AGENTS.md')).toBe(true)
    expect(s.has('docs/CONTRIBUTING.md')).toBe(true)
    expect(s.has('docs/conventions')).toBe(true)
    expect(s.size).toBe(3)
  })

  it('la semilla que siembra ct-init.sh no declara nada — el conjunto sale vacío', () => {
    const dir = tmp()
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const contenido = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(declaradasEn(contenido).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// pareceEsqueleto
// ---------------------------------------------------------------------------
describe('pareceEsqueleto', () => {
  it('un AGENTS.md de solo encabezados, en el vacío, es esqueleto', () => {
    const soloEncabezados = [
      '# AGENTS.md',
      '<!-- Guía durable del repo (≤150 líneas). Procedimientos → Skills. -->',
      '## Project overview',
      '## Setup commands',
      '## Build, test & lint',
      '## Code style & conventions',
      '## Project layout',
      '## Workflow: 1 issue = 1 slice = 1 session',
      '## Commit & PR rules',
      '## Security & data handling',
      '## Do NOT touch',
      '## Gotchas',
      '## Skills (load on demand)',
      '',
    ].join('\n')
    expect(pareceEsqueleto(soloEncabezados)).toBe(true)
  })

  // Ronda 2 del veredicto del juez: el test de arriba mide un literal escrito
  // a mano, no el fichero que `ct-init.sh` deja REALMENTE en disco — y ese
  // fichero real no se queda en "solo encabezados": el propio script le
  // añade siempre la sección del contrato de slices (cientos de líneas de
  // prosa). Este test corre `ct-init.sh` de verdad y mide sobre su salida,
  // para que una regresión en el descuento del bloque del contrato (ver
  // `sinBloqueDeContratoDeSlices` en scripts/vara.js) se note aquí.
  it('el AGENTS.md que ct-init.sh deja REALMENTE en disco es esqueleto, pese a que el propio script le añade el contrato de slices', () => {
    const dir = tmp()
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const contenido = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // Confirma que el escenario es el real y no un caso degenerado: el
    // fichero de verdad trae mucha prosa (el contrato de slices), no un
    // puñado de encabezados sueltos.
    expect(contenido.split('\n').length).toBeGreaterThan(100)
    expect(pareceEsqueleto(contenido)).toBe(true)
  })

  it('un documento con tres reglas de verdad no es esqueleto', () => {
    const conReglas = [
      '# Convenciones',
      'Usa siempre inyección de dependencias en el constructor.',
      'Los objetos de frontera son Pydantic, nunca dicts sueltos.',
      'Ningún caso de uso importa infraestructura directamente.',
    ].join('\n')
    expect(pareceEsqueleto(conReglas)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatCandidatos
// ---------------------------------------------------------------------------
describe('formatCandidatos', () => {
  it('sin candidatos, devuelve la cadena vacía', () => {
    expect(formatCandidatos([])).toBe('')
  })

  it('con candidatos, trae la cabecera, cada ruta entre backticks y la frase de que propone y no declara — y nunca "aviso"/"ATENCIÓN"/"unblock"', () => {
    const texto = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'guía del repo en la raíz' }])
    expect(texto).toContain(CANDIDATOS_HEADER)
    expect(texto).toContain('`AGENTS.md`')
    expect(texto).toMatch(/PROPONE.*humano DECLARA|el humano DECLARA/s)
    expect(texto.toLowerCase()).not.toContain('aviso')
    expect(texto).not.toContain('ATENCIÓN')
    expect(texto).not.toContain('unblock')
  })

  it('con un candidato marcado esqueleto, explica que declararlo mide contra un documento vacío', () => {
    const texto = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'guía del repo en la raíz', esqueleto: true }])
    expect(texto).toContain('[esqueleto: sólo encabezados]')
    expect(texto).toMatch(/documento vacío/)
    expect(texto).toContain('sin-vara')
  })

  it('con omitidos, dice cuántos candidatos más hay sin listar', () => {
    const texto = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'guía del repo en la raíz' }], { omitidos: 5 })
    expect(texto).toMatch(/\+5 candidatos más/)
  })

  it('con truncated, avisa de que la ausencia no es prueba de ausencia', () => {
    const texto = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'guía del repo en la raíz' }], { truncated: true })
    expect(texto).toContain('Ausencia aquí no es prueba de ausencia')
  })
})

// ---------------------------------------------------------------------------
// De punta a punta: scripts/detect-vara.mjs
// ---------------------------------------------------------------------------
describe('detect-vara.mjs de punta a punta', () => {
  it('repo con docs/conventions/backend.md → exit 0 y stdout con esa ruta', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'backend.md'), '# reglas\nusa DI\n')
    const r = spawnSync('node', [detectVaraScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('docs/conventions/backend.md')
  })

  it('repo sin nada → exit 0 y stdout vacío', () => {
    const dir = tmp()
    const r = spawnSync('node', [detectVaraScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  it('la misma ruta ya declarada entre backticks en .agent/conventions.md → stdout vacío', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'backend.md'), '# reglas\nusa DI\n')
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'conventions.md'), 'Rules to obey:\n- `docs/conventions/backend.md`\n')
    const r = spawnSync('node', [detectVaraScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  it('target que no es un directorio → exit 1, stderr lo explica, stdout vacío', () => {
    const dir = tmp()
    const fichero = join(dir, 'no-es-dir.txt')
    writeFileSync(fichero, 'x')
    const r = spawnSync('node', [detectVaraScript, fichero], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stdout.trim()).toBe('')
    expect(r.stderr).toMatch(/no es un directorio/)
  })

  // Ronda 2 del veredicto del juez: nada probaba que `detect-vara.mjs`
  // realmente LEYERA cada candidato del disco y llamara a `pareceEsqueleto` —
  // los tests de `formatCandidatos` inyectan `esqueleto: true` a mano, así
  // que ese cableado se podía borrar sin que la suite se enterara. Este test
  // corre el script de verdad contra ficheros de verdad, uno esqueleto y uno
  // con reglas, para que mutar esa línea (o borrarla) SÍ tumbe algo.
  it('lee cada candidato del disco y marca [esqueleto: sólo encabezados] SOLO al que de verdad lo es', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'esqueleto.md'), '# Reglas\n## Sección\n')
    writeFileSync(
      join(dir, 'docs', 'conventions', 'real.md'),
      ['# Reglas', 'Usa siempre inyección de dependencias.', 'No importes infraestructura desde el dominio.', 'Los DTOs son inmutables.'].join('\n')
    )
    const r = spawnSync('node', [detectVaraScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/`docs\/conventions\/esqueleto\.md` — [^\n]*\[esqueleto: sólo encabezados\]/)
    expect(r.stdout).not.toMatch(/`docs\/conventions\/real\.md`[^\n]*\[esqueleto/)
  })
})

// ---------------------------------------------------------------------------
// De punta a punta: scripts/ct-init.sh — los dos que de verdad protegen el diseño
// ---------------------------------------------------------------------------
describe('ct-init.sh invoca el barrido de candidatos', () => {
  it('con docs/conventions/x.md en el repo: el bloque de candidatos sale por STDOUT, y .agent/conventions.md sigue siendo la semilla byte a byte', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'x.md'), '# reglas\n')
    const r = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(CANDIDATOS_HEADER)
    expect(r.stdout).toContain('docs/conventions/x.md')
    expect(r.stderr).not.toContain(CANDIDATOS_HEADER)
    const conventions = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(conventions).toMatch(/ninguna declarada todavía/)
    expect(conventions).not.toContain('docs/conventions/x.md')
  })

  it('idempotencia: la segunda corrida sigue proponiendo lo mismo sin tocar el fichero; declararla a mano hace que la tercera corrida ya no la proponga y no pise la edición', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'x.md'), '# reglas\n')

    spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    const segunda = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(segunda.status).toBe(0)
    expect(segunda.stdout).toContain('docs/conventions/x.md')
    expect(readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')).toMatch(/ninguna declarada todavía/)

    const conventionsPath = join(dir, CONVENTIONS_FILE)
    const editado = 'Rules to obey (una ruta por línea, entre backticks; tiene que poder leerse):\n\n- `docs/conventions/x.md`\n'
    writeFileSync(conventionsPath, editado)

    const tercera = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(tercera.status).toBe(0)
    expect(tercera.stdout).not.toContain('docs/conventions/x.md')
    expect(readFileSync(conventionsPath, 'utf8')).toBe(editado)
  })

  // Ronda 2 del veredicto del juez: el caso que motiva `pareceEsqueleto`
  // (decisión 11 del diseño) es exactamente este — un repo nuevo, corriendo
  // `/ct-init` por primera vez, donde el AGENTS.md que el propio scaffolder
  // acaba de crear se propone como candidato. Tiene que salir marcado, o el
  // humano lo declararía creyendo que trae reglas de verdad.
  it('en un repo nuevo, el AGENTS.md que el propio ct-init.sh acaba de crear sale marcado [esqueleto: sólo encabezados]', () => {
    const dir = tmp()
    const r = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/`AGENTS\.md` — guía del repo en la raíz \[esqueleto: sólo encabezados\]/)
  })
})

// ---------------------------------------------------------------------------
// Ties: el texto que le dice al agente qué buscar no puede divergir del
// bloque que el script realmente imprime.
// ---------------------------------------------------------------------------
describe('el barrido no diverge de los textos que lo describen', () => {
  const leer = (...partes) => readFileSync(join(root, ...partes), 'utf8')

  it('commands/ct-init.md contiene CANDIDATOS_HEADER literal', () => {
    expect(leer('commands', 'ct-init.md')).toContain(CANDIDATOS_HEADER)
  })

  it('scripts/ct-init.sh menciona detect-vara.mjs', () => {
    expect(leer('scripts', 'ct-init.sh')).toContain('detect-vara.mjs')
  })
})
