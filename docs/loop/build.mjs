#!/usr/bin/env node
// build.mjs — genera las dos salidas compartibles del documento del loop a
// partir de la ÚNICA fuente, `loop.body.html`.
//
// Por qué hay una fuente y dos derivados, y no tres ficheros a mano: la fuente
// es también el cuerpo que se publica como Artifact (la herramienta lo envuelve
// en su propio <!doctype>/<head>/<body>, así que ese fichero no puede traerlos).
// El HTML autocontenido y el PDF son lo que se comparte fuera. Mismo criterio
// que `dist/` en este repo: el derivado va TRACKEADO, y todo cambio en la
// fuente tiene que llevar los derivados reconstruidos en el mismo commit — si
// no, se distribuye una versión vieja mientras la fuente ya dice otra cosa.
//
//   node docs/loop/build.mjs            → HTML + PDF
//   node docs/loop/build.mjs --html     → sólo HTML (no necesita navegador)
//
// El PDF se imprime con Chrome/Brave en headless. Si no hay ninguno instalado
// se dice y se sale con 1: no se emite un PDF a medias ni se finge que se pudo.

import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'loop.body.html')
const OUT_HTML = join(HERE, 'control-tower-loop.html')
const OUT_PDF = join(HERE, 'control-tower-loop.pdf')

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

// La hoja de impresión. Vive aquí y no en la fuente porque la fuente se publica
// como página web y no se imprime nunca: mezclarlas obligaría a leer reglas de
// paginación a quien sólo edita el contenido.
const PRINT_CSS = `
  /* ---------- impresión ---------- */
  @page { size: A4 portrait; margin: 11mm 10mm 13mm; }

  @media print {
    /* El PDF se imprime SIEMPRE en claro, aunque la máquina que lo genera esté
       en modo oscuro: un fondo casi negro a página completa es ilegible en
       papel y pesa en pantalla. Se re-declaran los tokens, no los componentes:
       todo el documento se pinta a través de ellos. */
    :root {
      --ground: #FFFFFF;
      --surface: #FFFFFF;
      --surface-2: #F2F6F5;
      --ink: #0E1918;
      --ink-2: #3F5150;
      --ink-3: #647674;
      --line: #C9D6D3;
      --line-strong: #A9BAB7;
      --accent: #08514C;
      --accent-soft: #E4F0EE;
      --human: #7A4E00;
      --human-soft: #F8EDDA;
      --agent: #32437C;
      --agent-soft: #E7EAF7;
      --alarm: #8E2018;
      --alarm-soft: #FAE7E4;
      --ok: #245A2E;
    }
    html, body { background: #FFFFFF; }
    body { font-size: 10.2px; line-height: 1.5; }
    .wrap { max-width: none; padding: 0; }

    /* Nada de lo que agrupa una unidad de lectura se parte entre páginas —
       pero NO las tiras ni las fichas de artefacto enteras: son altas, y
       prohibirles partirse dejaba páginas medio vacías empujándolas enteras a
       la siguiente. Se protege lo que de verdad se rompe mal (una figura, una
       tabla, un bloque de código, un aviso). */
    figure, .note, .phase-bar, .tbl-scroll, .legend, pre, .cmd,
    .io, .art-meta, .facts, .art-head { break-inside: avoid; page-break-inside: avoid; }
    .phase-bar { break-after: avoid; page-break-after: avoid; }
    h2, h3 { break-after: avoid; page-break-after: avoid; }
    .sec-head { break-before: page; page-break-before: page; }
    .masthead + section .sec-head { break-before: auto; page-break-before: auto; }
    section { margin-bottom: 30px; }
    .masthead { padding-top: 0; }

    /* En pantalla el desbordamiento se resuelve con scroll; en papel no hay
       scroll, así que lo que sobresale se pierde. Se envuelve. */
    pre { font-size: 8.9px; white-space: pre-wrap; word-break: break-word; }
    .cmd { font-size: 8.9px; white-space: pre-wrap; word-break: break-word; }
    .tbl-scroll { overflow: visible; }
    table { min-width: 0; font-size: 9.4px; }
    td code, .art-path { white-space: normal; word-break: break-word; }
    figure .svg-scroll { overflow: visible; }
    figure svg { min-width: 0; width: 100%; }
    th, td { padding: 5px 7px; }

    /* Los fondos de chips, raíles y cabeceras de tabla son información
       (quién ejecuta el paso, qué es una puerta humana), no decoración. */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    /* Un <details> cerrado en papel es contenido perdido. */
    details > *:not(summary) { display: revert; }
    summary { list-style: none; }
  }
`

function buildHtml() {
  const body = readFileSync(SRC, 'utf8')
  const m = body.match(/<title>([\s\S]*?)<\/title>/)
  if (!m) {
    console.error('error: loop.body.html no trae <title> — es lo que nombra la pestaña y el PDF.')
    process.exit(1)
  }
  const title = m[1].trim()
  const fragment = body.replace(m[0], '').replace(/^\s*\n/, '')

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="El ciclo de desarrollo con agentes del plugin control-tower-loop, paso a paso, con el formato exacto de cada artefacto.">
<meta name="generator" content="docs/loop/build.mjs — fuente: docs/loop/loop.body.html">
<style>
  /* reset mínimo — el Artifact aporta el suyo; el fichero autocontenido no. */
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; }
  img, svg { max-width: 100%; }
</style>
<style>${PRINT_CSS}</style>
</head>
<body>
${fragment}
</body>
</html>
`
  writeFileSync(OUT_HTML, html)
  return OUT_HTML
}

function findBrowser() {
  return CHROMES.find((p) => existsSync(p)) || null
}

// buildPdf NO espera a que el navegador termine: espera al FICHERO.
//
// Medido en esta máquina: `--print-to-pdf` deja el PDF completo en disco a los
// ~2 s, pero el proceso sigue vivo dos minutos largos (despierta el updater,
// que además hereda los descriptores y hace esperar a execFileSync aunque su
// padre ya haya acabado). Esperar la salida del proceso convertía un build de
// dos segundos en uno de dos minutos, y luego en un ETIMEDOUT con el PDF
// perfectamente escrito — un fallo reportado sobre un éxito.
//
// Así que se sondea el tamaño del fichero: cuando deja de crecer entre dos
// lecturas consecutivas, la impresión terminó y se mata al navegador. La
// condición de éxito es el artefacto, que es lo que de verdad importa aquí.
async function buildPdf(htmlPath) {
  const bin = findBrowser()
  if (!bin) {
    console.error('error: no hay Chrome/Brave/Chromium/Edge instalado — no se puede imprimir el PDF.')
    console.error('       El HTML autocontenido SÍ se ha generado: ábrelo e imprime a PDF desde el navegador.')
    process.exit(1)
  }
  // Se borra el PDF anterior ANTES de imprimir: sin esto, un fallo de
  // impresión dejaría el de la corrida pasada en disco y el sondeo lo daría
  // por bueno al instante — publicando una versión vieja como si fuera nueva.
  rmSync(OUT_PDF, { force: true })

  // --user-data-dir en un temporal: sin él, headless reutiliza el perfil real
  // del usuario y falla si ese Chrome ya está abierto.
  const profile = mkdtempSync(join(tmpdir(), 'ct-loop-pdf-'))
  const child = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--no-pdf-header-footer',
    `--print-to-pdf=${OUT_PDF}`,
    `file://${htmlPath}`,
  ], { stdio: 'ignore', detached: true })
  child.unref()

  const DEADLINE_MS = 120_000
  const started = process.hrtime.bigint()
  const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6
  let prev = -1
  let stableSince = 0
  while (elapsed() < DEADLINE_MS) {
    await sleep(400)
    const size = existsSync(OUT_PDF) ? statSync(OUT_PDF).size : 0
    if (size > 0 && size === prev) {
      stableSince += 400
      if (stableSince >= 800) break   // dos lecturas seguidas sin crecer
    } else {
      stableSince = 0
    }
    prev = size
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch { /* ya no está */ }
  rmSync(profile, { recursive: true, force: true })
  return { bin, out: OUT_PDF, seconds: (elapsed() / 1000).toFixed(1) }
}

const htmlPath = buildHtml()
console.log(`html  ${htmlPath}  (${(statSync(htmlPath).size / 1024).toFixed(0)} KB)`)

if (!process.argv.includes('--html')) {
  const { bin, out, seconds } = await buildPdf(htmlPath)
  if (!existsSync(out) || statSync(out).size < 10_000) {
    console.error(`error: el PDF no se ha escrito, o ha salido sospechosamente pequeño (${out}).`)
    process.exit(1)
  }
  console.log(`pdf   ${out}  (${(statSync(out).size / 1024).toFixed(0)} KB)  vía ${bin.split('/').pop()} en ${seconds}s`)
}
