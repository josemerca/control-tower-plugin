import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-status.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (o = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...o })

const gitEn = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })

// bancada: cada test se lleva su propio checkout git, con su `origin` y su
// contenido de `.worktrees/`. El `origin` no es decorado — el comando compara
// la identidad del checkout contra `--repo` antes de mirar nada local, porque
// cruzar los issues de un repo con los worktrees de otro fabrica hallazgos
// (medido: 3, uno de ellos una acusación de abandono).
//
// FAKE_GH_COUNTER_FILE tampoco es opcional: sin él el stub devuelve SIEMPRE el
// primer elemento de FAKE_GH_LIST_SEQUENCE, así que los issues "abiertos"
// volverían otra vez como "cerrados".
function bancada({ worktrees = [], origin = 'https://github.com/o/r.git', conCommit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-st-'))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'ignore', 'pipe'] })
  if (origin) gitEn(repo, 'remote', 'add', 'origin', origin)
  if (conCommit) gitEn(repo, 'commit', '--allow-empty', '-q', '-m', 'base')
  for (const n of worktrees) mkdirSync(join(repo, '.worktrees', String(n)), { recursive: true })
  return { dir, repo, counter: join(dir, 'gh-count'), argvLog: join(dir, 'gh-argv'), cwd: repo }
}

const correr = (b, env = {}, args = ['--repo', 'o/r']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  cwd: b.cwd,
  env: fakeEnv({ FAKE_GH_COUNTER_FILE: b.counter, FAKE_GH_ARGV_LOG_FILE: b.argvLog, ...env }),
})

const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const argvDe = (b) => (existsSync(b.argvLog) ? readFileSync(b.argvLog, 'utf8') : '')
const SIN_ISSUES = JSON.stringify([[], []])
const abierto = (n, status, titulo = 'refresh') => ({ number: n, title: `#${n} ${titulo}`, body: '', labels: [{ name: `status:${status}` }] })
const enProgreso7 = () => JSON.stringify([[abierto(7, 'in-progress')], []])
const hace = (ms) => JSON.stringify([{ event: 'labeled', label: { name: 'status:in-progress' }, created_at: new Date(Date.now() - ms).toISOString() }])

describe('/ct-status', () => {
  it('un loop limpio: exit 0, sin bloques vacíos', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/EN VUELO/)
    expect(res.stdout).not.toMatch(/ENTREGADO/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).not.toMatch(/\(ninguno\)/)
    limpiar(b)
  })

  it('un slice en vuelo sin proceso y con claim viejo: exit 3 y lo nombra', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/EN VUELO/)
    expect(res.stdout).toMatch(/#7/)
    expect(res.stdout).toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stdout).toMatch(/claim puesto hace 3 h/)
    limpiar(b)
  })

  it('un slice en vuelo con el claim recién puesto sale arrancando, no muerto: exit 0', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/arrancando/i)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    limpiar(b)
  })

  it('el timeline ilegible no acusa a nadie, y sale 1', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_FAIL: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stderr).toMatch(/timeline/)
    // El motivo se dice UNA vez: el compositor sabe que la edad falta, pero
    // sólo el CLI sabe por qué, así que su mensaje genérico se sustituye en
    // vez de acumularse — dos líneas sobre el mismo issue por una sola causa
    // se leerían como dos problemas distintos.
    expect(res.stderr.match(/#7/g)).toHaveLength(1)
    limpiar(b)
  })

  it('una lectura que falla NUNCA sale 0, aunque el resto esté limpio', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout + res.stderr).not.toMatch(/limpio/i)
    expect(res.stdout + res.stderr).not.toMatch(/reposo/i)
    limpiar(b)
  })

  it('si fallan los CERRADOS, lo de arriba no se queda vacío: el bloque EN VUELO sigue ahí', () => {
    // El informe salía vacío bajo un pie que decía «lo de arriba es sólo lo
    // que sí se ha podido comprobar»… y arriba no había nada, porque
    // `cargarIssues` lanzaba y con ello tiraba la lectura de abiertos que ya
    // estaba entera en memoria. Contradecía el contrato que este comando
    // publica: «se informa de lo que sí se sabe».
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/EN VUELO \(1\)/)
    expect(res.stdout).toMatch(/#7\s+refresh/)
    expect(res.stderr).toMatch(/no se pudieron listar issues cerrados/)
    // Y sólo se ha perdido UNA de las dos lecturas, no las dos.
    expect(res.stdout).toMatch(/exit 1 — 1 aviso\(s\)/)
    limpiar(b)
  })

  it('con los issues a medias, un worktree que SÍ está en disco se afirma: `worktree ✓`, jamás `✗`', () => {
    // Defecto nacido de la INTERACCIÓN de dos arreglos, y por eso no lo vio
    // ninguna revisión de tarea: el vaciado de `worktreesEnDisco` que protege
    // de fabricar huérfanos alimentaba también el `hasWorktree` del bloque en
    // vuelo. Era inalcanzable mientras `cargarIssues` lanzaba (sin issues no
    // había bloque en vuelo que imprimir); el informe parcial lo hizo
    // alcanzable, y el informe se contradecía en dos líneas seguidas: el aviso
    // nombraba `.worktrees/7` y el bloque decía `worktree ✗` sobre #7.
    //
    // La marca correcta aquí es `✓`, no `?`: la lectura de disco SÍ se hizo y
    // el directorio SÍ está. Lo que no se sabe es a quién pertenece, y eso no
    // es una señal del bloque en vuelo — es lo que apaga la atribución de
    // huérfanos. Un `?` sería inventarse una duda que no existe.
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/worktree ✓/)
    expect(res.stdout).not.toMatch(/worktree ✗/)
    // Y el aviso NO nombra el 7: el informe acaba de explicarlo. Ver el test
    // de aquí abajo, que es el que ata esa mitad.
    expect(res.stderr).not.toMatch(/en \.worktrees\//)
    // Sin poder atribuir, tampoco se acusa a nadie de huérfano.
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })

  it('el aviso no nombra un directorio que el informe SÍ explica', () => {
    // Segunda cara del mismo defecto: al pasar la lista real a los bloques, el
    // aviso —que no se tocó— pasó a afirmar lo contrario de lo que el informe
    // imprimía dos líneas más abajo. Sus dos mitades eran falsas para el 7: sí
    // se había cruzado, y sí se sabía quién lo reclamaba, porque la lectura
    // que SÍ funcionó es justo la que lo explica.
    const b = bancada({ worktrees: [7, 8] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/worktree ✓/) // el 7, explicado por #7 en vuelo
    const aviso = res.stderr.split('\n').find((l) => /en \.worktrees\//.test(l))
    expect(aviso).toBeDefined()
    const nombrados = /en \.worktrees\/ \(([^)]*)\)/.exec(aviso)[1].split(', ')
    expect(nombrados).toEqual(['8'])
    limpiar(b)
  })

  it('si la lectura parcial explica TODOS los worktrees, no hay aviso — pero el exit sigue siendo 1', () => {
    // El motivo de la lectura que falló no se pierde nunca: viaja aparte,
    // desde `cargarIssues`. Que no quede ningún directorio del que avisar no
    // convierte una lectura incompleta en un loop en reposo.
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000), FAKE_GH_LIST_FAIL_AT: '1' })
    expect(res.status).toBe(1)
    expect(res.stderr).not.toMatch(/en \.worktrees\//)
    expect(res.stderr).toMatch(/no se pudieron listar issues cerrados/)
    expect(res.stdout).toMatch(/exit 1 — 1 aviso\(s\)/)
    expect(res.stdout).not.toMatch(/reposo/i)
    limpiar(b)
  })

  it('si fallan los ABIERTOS, la cosecha no omite el worktree que sí está en disco', () => {
    // Colateral del mismo origen: `ENTREGADO, SIN COSECHAR` se construye con
    // los cerrados, que aquí sí se leyeron, pero el vaciado le borraba el
    // worktree — y el worktree es justo lo que hay que ir a limpiar.
    const b = bancada({ worktrees: [5] })
    const seq = JSON.stringify([[], [{ number: 5, body: '', labels: [], state_reason: 'completed' }]])
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: seq, FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/ENTREGADO, SIN COSECHAR \(1\)/)
    expect(res.stdout).toMatch(/#5\s+cerrado como completado, y todavía queda en disco: worktree \.worktrees\/5/)
    limpiar(b)
  })

  it('si la lectura de issues falla, ningún worktree se acusa de huérfano', () => {
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stderr).toMatch(/\.worktrees/)
    limpiar(b)
  })

  it('no se puede listar .worktrees/ → nunca «no hay huérfanos», y la señal sale `?` en vez de `✗`', () => {
    // El test que el §9 del diseño exige y que faltaba. Con `.worktrees/`
    // ilegible salían a la vez el `aviso:` de EACCES y un `worktree ✗` que
    // afirmaba que no hay lo que no se ha podido mirar.
    const b = bancada({ worktrees: [7] })
    chmodSync(join(b.repo, '.worktrees'), 0o000)
    try {
      const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
      expect(res.status).toBe(1)
      expect(res.stderr).toMatch(/no se pudo listar .*\.worktrees/)
      expect(res.stdout).toMatch(/worktree \?/)
      expect(res.stdout).not.toMatch(/worktree ✗/)
      // Y jamás la afirmación de limpieza sobre la lectura que no se hizo.
      expect(res.stdout).not.toMatch(/RESIDUO/)
      expect(res.stdout).not.toMatch(/reposo/i)
      // La rama SÍ se pudo leer, así que ésa sí se afirma: la duda no se
      // contagia a la señal de al lado.
      expect(res.stdout).toMatch(/rama ✗/)
    } finally {
      chmodSync(join(b.repo, '.worktrees'), 0o755)
      limpiar(b)
    }
  })

  it('un worktree de un issue ABIERTO que no está en vuelo se nombra sin afirmar que nadie lo reclama', () => {
    const b = bancada({ worktrees: [9] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto(9, 'ready', 'plan')], []]) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/RESIDUO/)
    expect(res.stdout).toMatch(/\.worktrees\/9/)
    expect(res.stdout).toMatch(/#9 sigue abierto/)
    expect(res.stdout).toMatch(/status:ready/)
    // La frase que el §6 del spec proponía sería FALSA aquí: el issue #9 está
    // abierto, o sea vivo.
    expect(res.stdout).not.toMatch(/sin issue vivo que lo reclame/)
    limpiar(b)
  })

  it('un worktree que ningún issue explica sí sale como no reclamado', () => {
    const b = bancada({ worktrees: [11] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/\.worktrees\/11/)
    expect(res.stdout).toMatch(/ning.n issue lo reclama/)
    limpiar(b)
  })

  it('el worktree de un slice EN VUELO no es residuo', () => {
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).toMatch(/worktree ✓/)
    limpiar(b)
  })

  it('un issue cerrado que conserva su label status: sale como residuo, con exit 3', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, body: '', labels: [{ name: 'status:in-review' }], state_reason: 'completed' }]]) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/RESIDUO \(1\)/)
    expect(res.stdout).toMatch(/#3\s+cerrado, pero conserva status:in-review/)
    // Sin worktrees huérfanos, la nota sobre worktrees no pinta nada aquí.
    expect(res.stdout).not.toMatch(/\.worktrees/)
    limpiar(b)
  })

  it('sin `ps` en el PATH nadie sale muerto: exit 1 y «no se pudo comprobar»', () => {
    const b = bancada()
    // Un PATH sin `ps` ni `lsof`, pero con `git` (hace falta para resolver
    // la raíz del checkout) y con `node` (el stub de `gh` es un script de node
    // y sin él fallaría TAMBIÉN la lectura de issues, que no es lo que se está
    // probando aquí): así el único fallo es el de la señal de procesos, y se
    // ve qué hace el comando cuando falta la herramienta — acusar de abandono
    // a un slice sano por eso sería su peor fallo posible.
    const bin = join(b.dir, 'bin')
    mkdirSync(bin)
    symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
    symlinkSync(process.execPath, join(bin, 'node'))
    const res = spawnSync(process.execPath, [script, '--repo', 'o/r'], {
      encoding: 'utf8',
      cwd: b.cwd,
      env: {
        ...process.env,
        PATH: `${fakeGhDir}:${bin}`,
        FAKE_GH_COUNTER_FILE: b.counter,
        FAKE_GH_LIST_SEQUENCE: enProgreso7(),
        FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000),
      },
    })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/proceso \?/)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stderr).toMatch(/no se pudo listar procesos con ps/)
    limpiar(b)
  })

  it('no muta nada: jamás llama a `gh issue edit` ni a `gh label`', () => {
    const b = bancada({ worktrees: [7] })
    correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
    const log = argvDe(b)
    // La prueba mira el argv REAL con el que se invocó a `gh`, no la ausencia
    // de errores: un comando puede mutar y salir con 0 tan campante.
    expect(log.length).toBeGreaterThan(0)
    expect(log).not.toMatch(/issue edit/)
    expect(log).not.toMatch(/label/)
    expect(log).not.toMatch(/--method (POST|PATCH|PUT|DELETE)/)
    for (const l of log.split('\n').filter(Boolean)) expect(l).toMatch(/^api /)
    limpiar(b)
  })

  it('ninguna lectura lleva --limit, y todas paginan', () => {
    const b = bancada()
    correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: '[]' })
    const lineas = argvDe(b).split('\n').filter(Boolean)
    expect(lineas.length).toBe(3) // abiertos, cerrados, timeline de #7
    for (const l of lineas) {
      expect(l).not.toMatch(/--limit/)
      expect(l).toMatch(/--paginate/)
    }
    limpiar(b)
  })

  it('--repo colgante (último token de argv) no llega a gh: exit 2', () => {
    const b = bancada()
    const res = correr(b, {}, ['--repo'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/sin valor/)
    expect(argvDe(b)).toBe('')
    limpiar(b)
  })

  it('--repo con forma inválida: exit 2, sin tocar gh', () => {
    const b = bancada()
    const res = correr(b, {}, ['--repo', 'menoplus'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/owner\/repo/)
    expect(argvDe(b)).toBe('')
    limpiar(b)
  })

  it('sin --repo: exit 2 con el uso', () => {
    const b = bancada()
    const res = correr(b, {}, [])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/uso: ct-status\.mjs/)
    limpiar(b)
  })
})

describe('/ct-status — la identidad del checkout', () => {
  it('un --repo que no es el de este checkout no fabrica hallazgos: avisa y sale 1', () => {
    // El checkout es de o/r, con tres worktrees y un claim; se pregunta por
    // OTRO repo. Sin esta comprobación salían 3 hallazgos con cero avisos y
    // exit 3 — uno la acusación de abandono sobre #7, y dos worktrees (8 y 9)
    // marcados como candidatos a `git worktree remove`. Que el comando no
    // escriba no ayuda: escribe el humano, por indicación suya.
    const b = bancada({ worktrees: [7, 8, 9] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) }, ['--repo', 'otro/repo'])
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/es el checkout de o\/r, no de otro\/repo/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stdout).not.toMatch(/worktree ✗/)
    expect(res.stdout).toMatch(/worktree \?/)
    limpiar(b)
  })

  it('un checkout sin remote origin no se da por bueno: avisa y sale 1, sin acusar a nadie', () => {
    const b = bancada({ worktrees: [9], origin: null })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no tiene remote "origin"/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })

  it('invocado DESDE DENTRO de un worktree, mira el checkout principal', () => {
    // `git rev-parse --show-toplevel` devolvería aquí el propio worktree: no
    // hay ningún `.worktrees/` dentro (todo saldría `worktree ✗`) y el prefijo
    // con el que se mapea el cwd de cada proceso quedaría mal (todo `proceso
    // ✗`) — el informe negaría justo el directorio en el que estás parado.
    const b = bancada({ conCommit: true })
    gitEn(b.repo, 'worktree', 'add', '-q', '-b', 'feat/7', join(b.repo, '.worktrees', '7'))
    b.cwd = join(b.repo, '.worktrees', '7')
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.stdout).toMatch(/worktree ✓/)
    expect(res.stdout).toMatch(/rama ✓/)
    expect(res.status).toBe(0)
    limpiar(b)
  })
})

describe('/ct-status — entregado, esperando merge', () => {
  it('tres in-review con sus worktrees: bloque propio, sin residuo y exit 0', () => {
    const b = bancada({ worktrees: [11, 12, 13] })
    const res = correr(b, {
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto(11, 'in-review', 'refresh de tokens'), abierto(12, 'in-review', 'marca de ritmo'), abierto(13, 'in-review', 'pie de plan')], []]),
    })
    // Un loop sano con tres PRs abiertos devolvía 3 de forma permanente: el
    // coordinador aprende a ignorar el código de salida, y un vigilante que
    // gatee sobre él queda inservible.
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/ENTREGADO, ESPERANDO MERGE \(3\)/)
    expect(res.stdout).toMatch(/#11\s+refresh de tokens — status:in-review/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })

  it('no se confunde con la cosecha: los dos bloques pueden salir a la vez', () => {
    const b = bancada({ worktrees: [11, 5] })
    const res = correr(b, {
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto(11, 'in-review')], [{ number: 5, body: '', labels: [], state_reason: 'completed' }]]),
    })
    expect(res.status).toBe(3) // lo mergeado sin cosechar SÍ es hallazgo
    expect(res.stdout).toMatch(/ENTREGADO, ESPERANDO MERGE \(1\)/)
    expect(res.stdout).toMatch(/ENTREGADO, SIN COSECHAR \(1\)/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    limpiar(b)
  })
})

describe('/ct-status — la señal de vida en el bloque de residuo', () => {
  it('con un proceso vivo dentro, NO se dice que no hay ninguno', () => {
    const b = bancada({ worktrees: [9] })
    // Un proceso de verdad con su cwd dentro del worktree: es la única forma
    // de ejercitar `liveSliceProcesses` de punta a punta.
    //
    // Montado COMO LO MONTA EL INSTALADOR NATIVO, que es lo que hace decisiva
    // esta prueba: `bin/claude` es un SYMLINK a un ejecutable guardado bajo
    // `versions/<versión>`, igual que `~/.local/bin/claude` apunta a
    // `~/.local/share/claude/versions/2.1.221`. El nombre de proceso que ve el
    // kernel es el del ejecutable RESUELTO (medido: `ps -o ucomm=` de un
    // Claude Code real devuelve "2.1.221", no "claude"), así que lo único que
    // dice `claude` aquí es la RUTA con la que se invocó — que es justo lo que
    // este comando mira. Un symlink a /bin/sleep, no una copia: copiar un
    // binario de sistema en macOS le rompe la firma y el SO lo mata con
    // SIGKILL (comprobado).
    const bin = join(b.dir, 'bin')
    mkdirSync(join(bin, 'versions'), { recursive: true })
    symlinkSync('/bin/sleep', join(bin, 'versions', '2.1.221'))
    symlinkSync(join(bin, 'versions', '2.1.221'), join(bin, 'claude'))
    const hijo = spawn(join(bin, 'claude'), ['30'], { cwd: join(b.repo, '.worktrees', '9'), stdio: 'ignore' })
    try {
      execFileSync('sh', ['-c', 'sleep 0.5'])
      // El nombre de proceso NO es "claude": es el del binario resuelto. Si
      // alguien vuelve a identificar por nombre, esta línea lo delata antes
      // que la aserción de abajo.
      const nombreDeProceso = execFileSync('ps', ['-o', 'ucomm=', '-p', String(hijo.pid)], { encoding: 'utf8' }).trim()
      expect(nombreDeProceso).not.toBe('claude')
      const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
      // LA afirmación que no se puede hacer sin mirar: la primera versión
      // imprimía «nadie lo está trabajando ahora» sin consultar
      // `procesos.porSlice`, que ya estaba en memoria.
      expect(res.stdout).not.toMatch(/no hay ning.n proceso trabajando dentro/)
      // La rama positiva sólo se exige si la comprobación de procesos se pudo
      // hacer de verdad en esta máquina: si falta `lsof`, el comando calla, y
      // eso es justo lo que la aserción de arriba ya protege.
      if (!/no se pudo (listar procesos|leer el directorio)/.test(res.stderr)) {
        expect(res.stdout).toMatch(new RegExp(`OJO: hay un proceso trabajando dentro ahora mismo \\(pid ${hijo.pid}\\)`))
      }
    } finally {
      hijo.kill('SIGKILL')
      limpiar(b)
    }
  })

  it('si la comprobación de procesos falló, no se dice NADA sobre procesos', () => {
    const b = bancada({ worktrees: [9] })
    const bin = join(b.dir, 'bin')
    mkdirSync(bin)
    symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
    symlinkSync(process.execPath, join(bin, 'node'))
    const res = spawnSync(process.execPath, [script, '--repo', 'o/r'], {
      encoding: 'utf8',
      cwd: b.cwd,
      env: { ...process.env, PATH: `${fakeGhDir}:${bin}`, FAKE_GH_COUNTER_FILE: b.counter, FAKE_GH_LIST_SEQUENCE: SIN_ISSUES },
    })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/\.worktrees\/9/)
    expect(res.stdout).not.toMatch(/no hay ning.n proceso trabajando dentro/)
    expect(res.stdout).not.toMatch(/OJO: hay un proceso/)
    limpiar(b)
  })
})

describe('/ct-status — el informe entero llega al otro lado de la tubería', () => {
  it('un informe largo capturado por un padre no se trunca a 65536 bytes', () => {
    const b = bancada()
    // `process.stdout` es asíncrono hacia una tubería en POSIX: con
    // `process.exit()` el proceso muere sin esperar a vaciarlo, y el informe
    // llegaba cortado a mitad de línea al tamaño del buffer del pipe del SO —
    // con el exit code intacto, así que nada delataba el corte.
    const cerrados = Array.from({ length: 2000 }, (_, i) => ({ number: i + 1, body: '', labels: [{ name: 'status:in-review' }], state_reason: 'completed' }))
    const seqFile = join(b.dir, 'seq.json')
    writeFileSync(seqFile, JSON.stringify([[], cerrados]))
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE_FILE: seqFile })
    expect(res.status).toBe(3)
    expect(res.stdout.length).toBeGreaterThan(65536)
    const ultima = res.stdout.trimEnd().split('\n').pop()
    expect(ultima).toMatch(/^exit 3 — hay 2000 cosa\(s\) que revisar$/)
    limpiar(b)
  })
})
