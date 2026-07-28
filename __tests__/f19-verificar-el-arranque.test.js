// ===========================================================================
// F19/H1 — EL DISPATCHER INFORMÓ DE ÉXITO SOBRE UN AGENTE QUE NUNCA ARRANCÓ.
//
// Primer despacho real del loop contra un repo de producción. `/ct-next
// --cap 1` salió con exit 0, dijo «lanzados 1/1» y añadió «verificado: la
// sesión cmux está corriendo en ese directorio». Esto es lo que había de
// verdad en esa terminal:
//
//     [oh-my-zsh] Would you like to update? [Y/n] laude --dangerously-skip-…
//     zsh: command not found: laude
//
// El `read` de un solo carácter del prompt de oh-my-zsh se comió la `c` de
// `claude` mientras cmux tecleaba el comando. Quedó un shell inactivo, en el
// directorio correcto y con el título correcto. Consecuencia medida: veinte
// minutos en `status:in-progress` reclamado por nadie, reteniendo `area:plan`
// y el carril serializante `pbxproj` de todo el repo; cero commits, cero PRs.
//
// LA RAÍZ: se comprobaba el CONTINENTE (existe una ventana de cmux con el
// título y el cwd pedidos) en vez del CONTENIDO (el comando llegó a
// ejecutarse). La ventana la abre el propio dispatcher — igual que el
// `.agent/STATE.md` "modificado" que también engañó a los humanos era su
// propia semilla. Rastro de la herramienta tomado por prueba del efecto.
//
// Estos tests fijan la propiedad que importa por encima del arreglo concreto:
// **si no se puede confirmar que el agente arrancó, el resultado no puede ser
// "lanzado" con exit 0.**
// ===========================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import {
  buildLauncherScript, buildTypedCommand, parseSentinel, sameDir,
  SENTINEL_MAGIC, LAUNCHER_FILENAME, SENTINEL_FILENAME,
} from '../scripts/launch-sentinel.js'
import { shQuote } from '../scripts/shquote.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-f19-'))
  dirs.push(d)
  return d
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, pid: r.pid, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }
}

function dispatchOne(repoRoot, envOverrides = {}) {
  return runReal(['--repo', 'o/r', '--cap', '1'], {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    ...envOverrides,
  })
}

// ---------------------------------------------------------------------------
// El hallazgo, reproducido tal cual
// ---------------------------------------------------------------------------
describe('F19/H1 — el shell se come el primer carácter del comando', () => {
  it('NUNCA dice "lanzado" ni sale con 0 cuando el comando no llegó a ejecutarse', () => {
    const repoRoot = makeRepoRoot()
    // Verificado contra el código SIN arreglar (con este mismo stub, que ya
    // ejecuta el comando): exit 0, «lanzados 1/1» y «verificado: la sesión
    // cmux está corriendo en ese directorio» — la mentira exacta del campo.
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '600',
    })
    expect(r.code).toBe(1)
    expect(r.all).not.toMatch(/verificado: la sesión cmux está corriendo/)
    expect(r.all).toMatch(/lanzados 0\/1 slice\(s\)/)
    expect(r.all).toMatch(/NO se puede confirmar que el comando llegara a ejecutarse/)
    // Los DOS casos indistinguibles se nombran: nunca se afirma cuál fue.
    expect(r.all).toMatch(/el comando nunca corrió/)
    expect(r.all).toMatch(/ese shell sigue arrancando/)
    // Y el residuo se declara, con los comandos exactos.
    expect(r.all).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(r.all).toMatch(/git worktree remove --force .*\.worktrees\/90/)
    expect(r.all).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.all).not.toMatch(/Nada quedó a medias/)
  })

  it('el camino feliz sí lo dice, y dice POR QUÉ puede decirlo', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot)
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.all).toMatch(/el comando llegó a ejecutarse de verdad \(centinela de arranque escrito por el propio shell/)
    expect(r.all).toMatch(/lanzados 1\/1 slice\(s\)/)
  })

  it('el comando que se TECLEA ya no lleva el kickoff dentro: la superficie expuesta al pty pasa de KB a una línea', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    const cmuxLine = r.out.split('\n').find((l) => l.startsWith('cmux new-workspace'))
    expect(cmuxLine).toBeTruthy()
    // El kickoff es de varios KB; la línea de cmux entera tiene que caber
    // holgadamente por debajo de eso ahora que solo lleva un `. <ruta>`.
    expect(cmuxLine.length).toBeLessThan(600)
    expect(cmuxLine).not.toMatch(/dangerously-skip-permissions/)
    // …pero el dry-run NO puede esconder lo que se va a ejecutar: el script
    // entero se imprime, con el `claude` dentro.
    expect(r.out).toMatch(/script de arranque que cmux sourcearía/)
    expect(r.out).toMatch(/claude --dangerously-skip-permissions/)
    expect(r.out).toMatch(/se espera hasta \d+ ms a que aparezca .*started/)
  })
})

// ---------------------------------------------------------------------------
// "no ha aparecido todavía" vs "no va a aparecer"
// ---------------------------------------------------------------------------
describe('F19/H1 — un centinela lento no es un centinela ausente', () => {
  it('el shell tarda, pero dentro de la cota: cuenta como lanzado', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_COMMAND_DELAY_MS: '700',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '8000',
    })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90 en .*centinela de arranque escrito/)
  })

  it('el mismo shell lento con una cota corta: NO se cuenta, y el mensaje nombra la variable con la que se ajusta', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_COMMAND_DELAY_MS: '3000',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '400',
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/NO apareció en 400 ms/)
    expect(r.all).toMatch(/sube CT_NEXT_LAUNCH_TIMEOUT_MS \(ahora 400\)/)
    expect(r.all).not.toMatch(/verificado: la sesión cmux está corriendo/)
  })

  it('CT_NEXT_LAUNCH_TIMEOUT_MS inválido aborta con exit 2 antes de tocar nada, en vez de elegir una cota por su cuenta', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { CT_NEXT_LAUNCH_TIMEOUT_MS: 'un rato' })
    expect(r.code).toBe(2)
    expect(r.all).toMatch(/CT_NEXT_LAUNCH_TIMEOUT_MS inválido/)
    expect(r.all).not.toMatch(/claimed #90/)
  })
})

// ---------------------------------------------------------------------------
// Lo que el centinela sabe y la ventana no
// ---------------------------------------------------------------------------
describe('F19/H1 — el centinela ve lo que ninguna consulta a cmux puede ver', () => {
  it('`claude` no resuelve en el shell de login: certeza negativa → se deshace TODO (claim incluido)', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { FAKE_CMUX_NO_CLAUDE_IN_SHELL: '1', CT_NEXT_LAUNCH_TIMEOUT_MS: '4000' })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/`claude` NO resuelve en ese shell de login/)
    // Este es el ÚNICO caso con certeza de que no habrá agente, así que es el
    // único donde revertir el claim no puede destruir trabajo vivo.
    expect(r.all).toMatch(/claim revertido automáticamente a status:ready|worktree y rama de #90 limpiados automáticamente/)
    expect(r.all).not.toMatch(/lanzado #90/)
  })

  it('el shell arrancó en OTRO directorio: lo delata su propio $PWD, no lo que cmux diga de su ventana — y no se borra nada', () => {
    const repoRoot = makeRepoRoot()
    const otro = mkdtempSync(join(tmpdir(), 'ct-f19-otro-'))
    dirs.push(otro)
    const r = dispatchOne(repoRoot, { FAKE_CMUX_COMMAND_CWD: otro, CT_NEXT_LAUNCH_TIMEOUT_MS: '4000' })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/el shell que lo ejecutó estaba en/)
    expect(r.all).toMatch(/NO se cuenta como lanzado con éxito, y NO se borra nada/)
    expect(r.all).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    // Un agente vivo en el sitio equivocado NO se limpia solo.
    expect(r.all).not.toMatch(/claim revertido automáticamente/)
  })

  it('cmux no se puede consultar, pero el centinela sí está: eso ya no es "beneficio de la duda", es evidencia', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { FAKE_CMUX_LIST_WINDOWS_FAIL: '1' })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/no se pudo verificar la sesión de cmux/)
    expect(r.all).toMatch(/pero el comando SÍ llegó a ejecutarse/)
  })
})

// ---------------------------------------------------------------------------
// El formato del centinela, en unitario
// ---------------------------------------------------------------------------
describe('F19/H1 — formato del centinela (unitario)', () => {
  const q = shQuote
  it('el script escribe el centinela ANTES de lanzar al agente: si fuera después solo aparecería al terminar', () => {
    const s = buildLauncherScript({ sentinelPath: '/tmp/s', agentCommand: 'claude --x', issue: 7, worktree: '/wt' }, q)
    expect(s.indexOf('/tmp/s')).toBeLessThan(s.indexOf('claude --x'))
    expect(s).toMatch(/command -v claude/)
  })

  it('lo que se teclea es una sola línea corta, y sourcea (no ejecuta) para conservar alias/funciones del usuario', () => {
    const t = buildTypedCommand('/tmp/x/launch.sh', q)
    expect(t).toBe(". '/tmp/x/launch.sh'")
    expect(t).not.toMatch(/\n/)
  })

  it('un centinela de otra versión, truncado, o con basura NO se interpreta: se devuelve null', () => {
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tok\t/wt`)).toEqual({ version: '1', claudeResolved: true, cwd: '/wt' })
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tmissing\t/wt`).claudeResolved).toBe(false)
    expect(parseSentinel(`${SENTINEL_MAGIC}\t2\tok\t/wt`)).toBe(null) // versión futura
    expect(parseSentinel(`otra-cosa\t1\tok\t/wt`)).toBe(null)
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tok`)).toBe(null) // truncado
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tquizá\t/wt`)).toBe(null)
    expect(parseSentinel('')).toBe(null)
  })

  it('una ruta con tabuladores dentro sobrevive: el $PWD es el ÚLTIMO campo a propósito', () => {
    expect(parseSentinel(`${SENTINEL_MAGIC}\t1\tok\t/a\tb/c`).cwd).toBe('/a\tb/c')
  })

  it('sameDir tolera symlinks (en macOS /tmp es /private/tmp): comparar cadenas a secas daría falsos "directorio equivocado"', () => {
    const real = (p) => (p === '/tmp/x' ? '/private/tmp/x' : p)
    expect(sameDir('/tmp/x', '/private/tmp/x', real)).toBe(true)
    expect(sameDir('/tmp/x', '/otro', real)).toBe(false)
    expect(sameDir('/a', '/a', () => null)).toBe(true) // igualdad literal, sin tocar disco
  })

  it('el kickoff viaja por DISCO, escapado, no tecleado: un kickoff con comillas y `$` no rompe el script', () => {
    const nasty = `no "toques" $HOME ni \`esto\` ni 'aquello'`
    const d = mkdtempSync(join(tmpdir(), 'ct-f19-sh-'))
    dirs.push(d)
    // `printf` en el sitio del agente — NUNCA `claude`: este test corre en la
    // máquina de quien lo ejecute, y un stub que se cuele por PATH invocaría
    // el `claude` de verdad. (Ocurrió al escribir este mismo test, con un
    // `replace('claude ', …)` que casó antes con el `command -v claude ` del
    // propio script: el shell acabó ejecutando el Claude real.) Lo que se está
    // probando es el ESCAPADO, y para eso el programa da igual.
    const s = buildLauncherScript(
      { sentinelPath: join(d, 'out'), agentCommand: `printf '%s' ${q(nasty)}`, issue: 1, worktree: '/wt' },
      q
    )
    const f = join(d, 'l.sh')
    writeFileSync(f, s)
    const r = spawnSync('/bin/sh', ['-c', `. ${q(f)} > ${q(join(d, 'arg'))}`], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(readFileSync(join(d, 'arg'), 'utf8')).toBe(nasty)
  })

  it('el script NO se escribe ejecutable, y eso es parte de la detección: si lo fuera, comerse el `.` seguiría lanzando el agente y la corrupción sería invisible', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot)
    expect(r.code).toBe(0)
    // El directorio de arranque es determinista: <tmpdir>/ct-next-launch-<pid del
    // ct-next.mjs>-<issue>. `spawnSync` nos da ese pid, así que se puede mirar
    // el fichero que ct-next.mjs escribió de verdad, no una reconstrucción.
    const f = join(tmpdir(), `ct-next-launch-${r.pid}-90`, LAUNCHER_FILENAME)
    dirs.push(dirname(f))
    const mode = statSync(f).mode & 0o777
    expect(mode & 0o111).toBe(0) // ni user, ni group, ni other
    expect(mode).toBe(0o600)
    // Y el centinela que el shell escribió está a su lado, con la magia dentro.
    expect(readFileSync(join(dirname(f), SENTINEL_FILENAME), 'utf8')).toMatch(new RegExp(`^${SENTINEL_MAGIC}\t`))
  })
})

// ===========================================================================
// F19/H2 — EL AVISO AGREGADO ES CORRECTO PERO ESTÁTICO.
//
// F18 añadió un aviso agregado de issues CERRADOS que conservan una label
// `status:` viva. La forma es la correcta (un párrafo, agrupado por estado,
// con los `in-review` contados aparte por no ser anomalía) y aun así se lo va
// a saltar cualquiera a partir de la tercera corrida: esos diez casos no
// cambian solos, así que el aviso imprime el MISMO párrafo para siempre. Una
// tercera forma de que un aviso deje de servir, distinta del muro
// insatisfacible (F14) y del ruido por volumen (F16): la repetición sin
// novedad. Y entonces el día que aparezca uno nuevo, no se ve.
//
// Dos arreglos: (1) el gradiente de severidad que estaba aplastado dentro del
// agregado, y (2) un acuse POR CASO reusando `.agent/conventions-ack.md`.
// ===========================================================================
function closedWith(n, status) {
  return { number: n, state_reason: 'completed', body: `<!-- ct-order:${n} -->`, labels: [{ name: `status:${status}` }] }
}
const abierto42 = { number: 42, title: '#42 x', body: '<!-- ct-order:99 -->', labels: [{ name: 'status:ready' }, { name: 'touches:ui' }] }

function runResiduo(repoRoot, cerrados) {
  return runReal(['--repo', 'o/r', '--dry-run'], {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto42], cerrados]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
  })
}
function lineaResiduo(r) {
  return r.err.split('\n').find((l) => /^aviso: \d+ issue\(s\) CERRADOS/.test(l)) || ''
}
function escribirAck(repoRoot, texto) {
  mkdirSync(join(repoRoot, '.agent'), { recursive: true })
  writeFileSync(join(repoRoot, '.agent', 'conventions-ack.md'), texto)
}

describe('F19/H2 — el gradiente de severidad que estaba aplastado', () => {
  it('un cerrado con status:blocked es inerte: no entra en el recuento de anomalías, se cuenta aparte', () => {
    const repoRoot = makeRepoRoot()
    const r = runResiduo(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'blocked')])
    const l = lineaResiduo(r)
    // Verificado contra el código sin arreglar: decía «2 issue(s) CERRADOS»,
    // metiendo en el mismo saco al que se cayó de la cola de despacho y al
    // que no le importa a nadie.
    expect(l).toMatch(/^aviso: 1 issue\(s\) CERRADOS/)
    expect(l).toMatch(/#101/)
    expect(l).toMatch(/#102/) // sale, pero como recuento inerte, no como anomalía
    expect(l).toMatch(/inerte|no bloquea|no le pasa nada/i)
  })

  it('ready va primero y se dice que es el grave; in-progress después', () => {
    const repoRoot = makeRepoRoot()
    const r = runResiduo(repoRoot, [closedWith(101, 'in-progress'), closedWith(102, 'ready')])
    const l = lineaResiduo(r)
    expect(l).toMatch(/^aviso: 2 issue\(s\) CERRADOS/)
    expect(l.indexOf('#102')).toBeLessThan(l.indexOf('#101'))
  })

  it('si TODO lo que queda es inerte o terminal, no hay anomalía y no se grita', () => {
    const repoRoot = makeRepoRoot()
    const r = runResiduo(repoRoot, [closedWith(101, 'blocked'), closedWith(102, 'in-review')])
    expect(lineaResiduo(r)).toBe('')
    expect(r.err).not.toMatch(/CERRADOS conservan una label `status:` viva/)
  })
})

describe('F19/H2 — acuse POR CASO: cállate sobre estos números, sigue avisando de los nuevos', () => {
  it('los números acusados desaparecen del aviso y los nuevos siguen saliendo', () => {
    const repoRoot = makeRepoRoot()
    escribirAck(repoRoot, 'residuo-status: 2026-07-28 — #101, #102 revisados: slices descartados, las labels se quedan.\n')
    const r = runResiduo(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'ready'), closedWith(103, 'ready')])
    const l = lineaResiduo(r)
    expect(l).toMatch(/^aviso: 1 issue\(s\) CERRADOS/)
    expect(l).toMatch(/#103/)
    expect(l).not.toMatch(/#101/)
    expect(l).not.toMatch(/#102/)
    // El acuse se reconoce, y se dice cuántos calla — pero solo cuando hay
    // algo vivo que decir; si no, sería el mismo ruido estático otra vez.
    expect(l).toMatch(/2 más ya acusados/)
  })

  it('con TODOS acusados el aviso desaparece entero: ése es el punto', () => {
    const repoRoot = makeRepoRoot()
    escribirAck(repoRoot, '# decisiones\n\nresiduo-status: 2026-07-28 — #101, #102 son slices descartados.\n')
    const r = runResiduo(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'in-progress')])
    expect(lineaResiduo(r)).toBe('')
    expect(r.err).not.toMatch(/2 más ya acusados/)
  })

  it('el acuse acumula entre líneas (una decisión por fecha), en vez de tratarlas como duplicadas', () => {
    const repoRoot = makeRepoRoot()
    escribirAck(repoRoot, 'residuo-status: 2026-07-01 — #101 descartado.\nresiduo-status: 2026-07-28 — #102 también.\n')
    const r = runResiduo(repoRoot, [closedWith(101, 'ready'), closedWith(102, 'ready')])
    expect(lineaResiduo(r)).toBe('')
    expect(r.err).not.toMatch(/ya estaba acusada más arriba/)
  })

  it('un acuse SIN números no silencia nada y se dice: creer haber callado algo y no haberlo hecho es el fallo que no nos podemos permitir', () => {
    const repoRoot = makeRepoRoot()
    escribirAck(repoRoot, 'residuo-status: 2026-07-28 — ya lo he mirado todo, da igual.\n')
    const r = runResiduo(repoRoot, [closedWith(101, 'ready')])
    expect(lineaResiduo(r)).toMatch(/^aviso: 1 issue\(s\) CERRADOS/)
    expect(r.err).toMatch(/no silencia nada/)
  })

  it('el aviso enseña cómo acusar: sin eso, la salida existe pero nadie la encuentra', () => {
    const repoRoot = makeRepoRoot()
    const r = runResiduo(repoRoot, [closedWith(101, 'ready')])
    expect(lineaResiduo(r)).toMatch(/\.agent\/conventions-ack\.md/)
    expect(lineaResiduo(r)).toMatch(/residuo-status: \d{4}-\d{2}-\d{2}/)
  })
})
