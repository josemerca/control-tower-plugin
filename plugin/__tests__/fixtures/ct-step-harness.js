// La máquina de estados como ORÁCULO (scripts/ct-step.mjs): la sesión sigue
// conduciendo, pero no decide la secuencia — la pregunta.
//
// Este test no necesita fixtures de proceso ni --dry-run, y eso no es una
// comodidad: el informe del implementador y el veredicto del juez SON ficheros
// JSON, así que el test escribe exactamente lo que escribirá un subagente. Lo
// único que no se simula es git, que corre de verdad contra un repo temporal —
// la mitad de las propiedades de aquí (comitea el programa, sólo entra lo
// declarado, un veto no deja rastro) no existen si git es un doble.
//
// EL PREÁMBULO VIVE AQUÍ y los 24 describes en nueve ficheros
// `__tests__/ct-step-*.test.js`: vitest paraleliza ENTRE ficheros y nunca
// dentro de uno, así que los 111 tests en un solo fichero corrían en serie en
// un worker con el resto de cores parados — 530 de los 533 s que tardaba la
// suite entera. Repartidos, 260 s.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VERDICT_RULES, SLICE_VERDICT_RULES } from '../../scripts/step-contracts.js'
// Slice 10: renderState siembra el SLICE.md de los tests de señal por el
// mismo camino que buildStateSeed (pliega/entrecomilla los valores largos —
// la razón de que ct-step lea `senal:` con parseStateSafe y no con regex), y
// SENAL_AUSENTE es la constante única con la que declara la ausencia el
// paquete del juez de slice.
import { renderState } from '../../scripts/state.js'

const here = dirname(fileURLToPath(import.meta.url))
export const SCRIPT = join(here, '..', '..', 'scripts', 'ct-step.mjs')
export const PLUGIN_ROOT_TEST = join(here, '..', '..')
export const F = '```'

// El §8 va aparte para que los tests de la fase global puedan sustituirlo de
// una pieza. Desde §3.7-A el plan sin "## 8. Global verification" ejecutable
// no es ejecutable (exit 6), así que TODO fixture la declara.
export const GLOBAL_VERIFICATION = [
  '## 8. Global verification',
  '',
  F + 'bash',
  'test -f uno.txt && test -f dos.txt',
  F,
  '',
].join('\n')

export const PLAN = [
  '# #7 — dos tareas de mentira',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 7. Tasks',
  '',
  '### Task 1 — la primera',
  '**Objective:** un fichero.',
  '**Files:** `uno.txt` (create).',
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** el fichero está.',
  '',
  F + 'bash',
  'test -f uno.txt',
  F,
  '',
  '### Task 2 — la segunda',
  '**Objective:** otro fichero.',
  '**Files:** `dos.txt` (create).',
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** el otro fichero está.',
  '',
  F + 'bash',
  'test -f dos.txt',
  F,
  '',
  GLOBAL_VERIFICATION,
].join('\n')

// `e2e` siembra los recorridos en el SLICE.md, que es de donde ct-step los lee
// al crear el run (no hay `gh` en este programa). Se escribe con `renderState`
// y no a mano por el mismo motivo por el que se escribe así el de la señal: el
// que parsea es un YAML de verdad, y un recorrido es una frase con comas y dos
// puntos dentro.
export function montarRepo({ e2e = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ct-step-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@e.com')
  g('config', 'user.name', 'T')
  g('config', 'commit.gpgsign', 'false')
  mkdirSync(join(d, '.agent'), { recursive: true })
  writeFileSync(join(d, '.agent', 'SLICE.md'), e2e
    ? renderState({ meta: { issue: 7, epic: 12, e2e }, body: '# slice de mentira' })
    : '---\nissue: 7\nepic: 12\n---\n\n# slice de mentira\n')
  writeFileSync(join(d, 'plan.md'), PLAN)
  // LO QUE ESTE FIXTURE ESCRIBE DENTRO DEL REPO Y NO ES TRABAJO DE NINGUNA
  // TAREA: el JSON que hace de respuesta del subagente (en un run de verdad lo
  // dicta `next` dentro de `.agent/run-<n>/`) y la telemetría, que aquí se
  // desvía a `.telemetria/` para poder leerla y en un run de verdad vive en
  // CLAUDE_CONFIG_DIR, fuera del repo. Desde que `ct-step report` mide el
  // árbol con `git status`, un fichero del andamio contaría como trabajo de la
  // tarea y el control de alcance la vetaría por algo que el implementador no
  // escribió.
  writeFileSync(join(d, '.gitignore'), '.telemetria/\n/*.json\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'base del slice')
  // El paso `reconcile` (Fase B, Tarea 8) habla con git de verdad —
  // `BranchReconciliation.merge` hace `git fetch origin <rama>` y mide cuántos
  // commits trae— así que el repo necesita un `origin` real. Un bare que
  // arranca AQUÍ MISMO y nunca se vuelve a tocar es, por construcción, "la
  // base que no se ha movido": lo que miden por defecto los tests que llegan
  // a `reconcile` a través de este fixture.
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  g('remote', 'add', 'origin', origin)
  g('push', '-q', 'origin', 'main')
  // LOS FICHEROS NO SE SIEMBRAN AQUÍ. Los escribe `informe(...)`, que es el
  // helper que hace de implementador: desde que `ct-step report` mide las
  // rutas con `git status` en vez de creerse la declaración, sembrar los dos
  // ficheros de las dos tareas al montar el repo dejaría el árbol de la tarea
  // 1 con el trabajo de la 2 dentro — y el control de alcance la vetaría, con
  // razón. Un implementador de verdad toca los ficheros de SU tarea.
  return d
}

// A estos tests no les importa la regla: la tarea 4 la añadió al contrato, y
// una regla válida cualquiera basta para que el veredicto siga siendo válido
// sin reescribir cada llamada de este fichero. Lo mismo vale para el RECORRIDO
// de la rúbrica, que el contrato exige entero desde el Paso 3: se compone aquí
// a partir de la lista de reglas del propio módulo, así que ni se teclea ocho
// veces ni se queda atrás el día que la rúbrica cambie de tamaño.
// Y lo mismo con los dos campos que el contrato añadió después: la CLASE del
// resultado de cada paso y la CITA de cada hallazgo. A estos tests tampoco les
// importan —lo que miden es la máquina, no el juicio—, así que se rellenan aquí
// con un valor válido en vez de en cada una de las veinte llamadas del fichero.
export const recorridoCompleto = () => VERDICT_RULES.map((rule) => ({ rule, result: `mirado en el test: ${rule}`, outcome: 'conforme' }))

// El veredicto del juez de SLICE (§3.7-B): el recorrido se compone desde
// SLICE_VERDICT_RULES (map), nunca una lista a mano, por el mismo motivo que
// `recorridoCompleto` — que el fixture no se quede atrás si la rúbrica cambia
// de tamaño (Slice 10 la subió de dos a tres ítems sin tocar estas líneas).
export const recorridoDeSlice = () => SLICE_VERDICT_RULES.map((rule) => ({ rule, result: `mirado en el test: ${rule}`, outcome: 'conforme' }))

// Los helpers de abajo CIERRAN sobre el repo temporal del test: uno distinto en
// cada `beforeEach`, y hay un `beforeEach` anidado que además lo REASIGNA. Por
// eso se entregan por fábrica y no como funciones de módulo — `ref` es un
// accesor (`() => repo`) que lee el binding vivo del fichero de test, nunca la
// copia del valor que tuviera al importarse.
export function crearHelpers(ref) {
  const ct = (...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
    cwd: ref(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(ref(), '.telemetria') },
  })

  // Lo que escribiría un subagente, a fichero. `paths` es una lista de rutas
  // simples: el informe no distingue producción de test (ver step-contracts.js).
  // Escribe también los ficheros que declara, si no están: un implementador
  // que declara una ruta la ha tocado, y desde que el programa mide el árbol
  // en vez de creerse la lista, un fichero que no existe no se stagea. Lo que
  // ya está escrito NO se pisa — hay tests que preparan el contenido antes.
  const informe = (paths, nombre = 'report.json', summary = 'hecho') => {
    for (const ruta of paths) {
      const destino = join(ref(), ruta)
      if (!existsSync(destino)) writeFileSync(destino, `${ruta}\n`)
    }
    const p = join(ref(), nombre)
    writeFileSync(p, JSON.stringify({ paths, summary }))
    return p
  }
  const veredicto = (ruling, findings = [], nombre = 'verdict.json') => {
    const p = join(ref(), nombre)
    const conRegla = findings.map((f) => ({ rule: 'alcance', evidence: 'la línea que lo prueba', ...f }))
    writeFileSync(p, JSON.stringify({ ruling, rubric: recorridoCompleto(), findings: conRegla }))
    return p
  }
  const crudo = (texto, nombre = 'crudo.json') => {
    const p = join(ref(), nombre)
    writeFileSync(p, texto)
    return p
  }
  const veredictoDeSlice = (ruling, findings = [], nombre = 'slice-verdict.json') => {
    const p = join(ref(), nombre)
    const conRegla = findings.map((f) => ({ rule: 'coherencia', evidence: 'la línea que lo prueba', ...f }))
    writeFileSync(p, JSON.stringify({ ruling, rubric: recorridoDeSlice(), findings: conRegla }))
    return p
  }

  const log = () => execFileSync('git', ['log', '--oneline'], { cwd: ref(), encoding: 'utf8' })
  const commits = () => log().trim().split('\n').filter(Boolean).length
  const estado = () => JSON.parse(readFileSync(join(ref(), '.agent', 'run-7.json'), 'utf8'))

  const paqueteDeTarea = (n = estado().task) => join(ref(), '.agent', 'run-7', `task-${n}-review.diff`)
  const paqueteDeSlice = () => join(ref(), '.agent', 'run-7', 'slice-review.diff')
  const filasDeJuez = (paso = 'judge') => readFileSync(join(ref(), '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l)).filter((f) => f.step === paso)

  // Slice 11 — el juez COPIA de la cabecera del paquete la línea `Review token:`
  // al campo `review_token` de su veredicto. El fixture hace exactamente eso, y
  // por eso SELLA DESPUÉS de `next`: cuando `veredicto(...)` escribe el fichero,
  // el paquete todavía no existe (`escribirPaquete` sólo corre en `next`). Un
  // fichero que no es JSON (`crudo`) se deja intacto — es el reintento por JSON
  // ilegible, que tiene que seguir descartándose por ESA razón y no por el token.
  const tokenDelPaquete = (ruta) => {
    const m = /^Review token: ([0-9a-f]{64})$/m.exec(readFileSync(ruta, 'utf8'))
    return m ? m[1] : null
  }
  const sellar = (json, paquete) => {
    const token = existsSync(paquete) ? tokenDelPaquete(paquete) : null
    if (token === null) return json
    let v
    try { v = JSON.parse(readFileSync(json, 'utf8')) } catch { return json }
    writeFileSync(json, JSON.stringify({ ...v, review_token: token }))
    return json
  }

  // Slice 3 — `next` es el ÚNICO verbo que escribe el paquete que el juez juzga
  // (`escribirPaquete` / `escribirPaqueteDeSlice` en ct-step.mjs), y desde este
  // slice `verdict` sin paquete en disco se DESCARTA. Un run de verdad pasa
  // siempre por `next` antes de despachar al juez —lo manda el kickoff: "vuelve a
  // next tras cada paso"—, así que estos tests lo hacen también: pedir el
  // veredicto es, por definición, haber preguntado antes. Los dos helpers
  // existen para que el paso no se olvide en el sitio veintiuno.
  //
  // Slice 11: y ahora también sellan el veredicto con el token del paquete que
  // `next` acaba de escribir — un juez honesto copia esa línea, y estos helpers
  // son ese juez.
  const juzgar = (...args) => { ct('next'); sellar(args[0], paqueteDeTarea()); return ct('verdict', ...args) }
  const juzgarSlice = (...args) => { ct('next'); sellar(args[0], paqueteDeSlice()); return ct('slice-verdict', ...args) }

  // Una tarea entera por el camino feliz.
  const tareaOk = (fichero) => {
    ct('report', informe([fichero]))
    ct('controls')
    juzgar(veredicto('PASS'))
    return ct('commit')
  }
  // El slice entero por el camino feliz: las dos tareas, la reconciliación con
  // la base (Fase B, Tarea 8 — el fixture deja la base sin mover, así que sale
  // en la primera ronda), la Global verification y el juicio del slice (§3.7).
  const sliceOk = () => {
    tareaOk('uno.txt')
    tareaOk('dos.txt')
    ct('reconcile')
    ct('global')
    return juzgarSlice(veredictoDeSlice('PASS'))
  }

  return {
    ct, informe, veredicto, crudo, veredictoDeSlice, log, commits, estado,
    paqueteDeTarea, paqueteDeSlice, filasDeJuez, tokenDelPaquete, sellar,
    juzgar, juzgarSlice, tareaOk, sliceOk,
  }
}
