// Detección de convenciones PROPIAS del repo destino en el terreno que ocupa
// el loop (claim, worktrees, estado). Lógica pura: sin IO, sin subprocesos —
// quien lee el disco es scripts/conventions-io.js (usado por
// scripts/detect-conventions.mjs y por ct-next.mjs).
//
// EL CASO REAL (F11, parte B). En un repo ya bootstrapeado (menoplus),
// ANTES de que llegara el plugin ya existían:
//   - `scripts/dispatch-check.sh`, un script de claim propio del repo, y una
//     línea en AGENTS.md que ordena ejecutarlo antes de implementar y con
//     `--release` al abrir PR;
//   - una convención de worktrees `git worktree add .claude/worktrees/<slug>`,
//     con un hook que la vigila.
// El plugin trae SU PROPIO `dispatch-check.mjs` y usa `.worktrees/<n>` +
// `feat/<n>`, y `ct-init` escribió su bloque de contrato al lado del que ya
// había sin mirar. Resultado: un AGENTS.md que se contradice consigo mismo, y
// DOS protocolos de claim operando sobre el mismo espacio de labels sin nadie
// que arbitre.
//
// CRITERIO DE DISEÑO — F14 CORRIGE EL DE F11. F11 se construyó con un único
// criterio: «es más valioso avisar de una sospecha que callar». Salió un
// detector sensible... y un guard QUE NO SE PODÍA SATISFACER. Verificado en
// campo contra el repo real: el repo siguió el consejo del propio detector
// (decidió que manda el claim del plugin y reescribió sus guías para decirlo)
// y el detector siguió marcándolo, porque buscaba subcadenas y casaba contra
//   - la línea de `scripts/` de un árbol de directorios en un bloque de código;
//   - las frases NUEVAS que explican que el claim ya no lo hace el agente;
//   - la documentación deliberada del uso manual del script fuera del loop;
//   - las descripciones factuales de los hooks en una tabla de inventario.
// La única forma de ponerlo verde era borrar documentación correcta. Un guard
// que solo se satisface destruyendo trabajo no es un guard, es un muro: quien
// lo obedece acaba peor, y quien no, se acostumbra a ignorar el aviso.
//
// La propiedad que este fichero sostiene ahora es: **desde cualquier estado que
// el detector señale existe un camino que lo deja verde sin empeorar el repo.**
// Se sostiene en DOS piezas, y el reparto entre ellas es deliberado:
//
//  1. ACUSE EXPLÍCITO (`.agent/conventions-ack.md`) — la garantía. Determinista,
//     por señal (`claim` / `worktrees` / `estado`), con fecha y motivo. Quien ya
//     tomó la decisión la escribe UNA vez y esa señal —solo esa— deja de avisar.
//     La garantía NO puede depender de heurísticas de texto: por eso la sostiene
//     esto, que es un fichero que o está o no está.
//  2. MANDATO vs MENCIÓN — la ergonomía. Reglas ESTRUCTURALES (¿esto es una
//     invocación de comando o el nombre de un fichero en una lista?) más un
//     conjunto ESTRECHO de marcas de ámbito («fuera del loop», «no lo corras»,
//     «lo hace /ct-next») evaluadas sobre la línea y sobre los bullets/encabezado
//     que la contienen. Baja el ruido; no se le confía la garantía, porque una
//     heurística de texto siempre se puede equivocar.
//
// El coste de (2) son falsos negativos, y está medido, no supuesto: ver el
// informe de F14. La regla que los acota es que las marcas de ámbito son pocas
// y NO ambiguas — «a mano» a secas NO silencia (una guía puede perfectamente
// mandar «reclama a mano con tu script», y eso es el deadlock), solo silencian
// las que sacan explícitamente la orden del loop o la prohíben.

export const CONTRACT_MARKER_OPEN = '<!-- ct-init:slices-contract -->'
export const CONTRACT_MARKER_CLOSE = '<!-- /ct-init:slices-contract -->'

// Rutas y nombres que el dispatcher del plugin ocupa. Se citan en los mensajes
// para que la decisión que hay que tomar sea concreta, no "revisa tu setup".
export const LOOP_WORKTREE_DIR = '.worktrees'
export const LOOP_BRANCH_PREFIX = 'feat/'

// Dónde se escribe el acuse. Relativo a la raíz del repo destino. Vive bajo
// `.agent/` (el espacio que el loop ya ocupa) y no dentro de AGENTS.md, por dos
// razones: es UNA ruta conocida que los dos consumidores leen sin escanear, y
// una señal cuya evidencia es un FICHERO (`scripts/dispatch-check.sh`) no tiene
// ninguna línea de AGENTS.md al lado de la que ponerla.
export const ACK_PATH = '.agent/conventions-ack.md'
export const ACK_IDS = ['claim', 'worktrees', 'estado']

// El bloque que el PROPIO ct-init siembra se PODA antes de escanear
// (`docLines`, abajo). Imprescindible desde F11: ese bloque habla de
// `dispatch-check`, de `.worktrees/<n>`, de `status:in-progress` y de `cmux` —
// sin la poda, la SEGUNDA corrida de ct-init sobre cualquier repo se
// denunciaría a sí misma y el aviso moriría de ruido. Tolera CRLF (mismo
// motivo que ct-init.sh: un AGENTS.md editado en Windows lleva `\r` pegado a
// cada marcador y ninguna comparación de línea completa lo encontraba).

// shape: la forma MARKDOWN de una línea — nivel de anidamiento, si es bullet,
// si es encabezado. Se calcula tras quitar los marcadores de cita (`> `),
// porque una política escrita dentro de un blockquote sigue siendo una política
// (caso real: el bloque «🛑 Política de aislamiento de ramas» del CLAUDE.md de
// menoplus manda su `git worktree add` desde dentro de una cita).
function shape(raw) {
  let t = raw
  const quote = t.match(/^(\s*(?:>\s?)+)/)
  if (quote) t = t.slice(quote[0].length)
  const indent = (t.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '  ').length
  const isList = /^[ \t]*(?:[-*+]|\d+[.)])\s+/.test(t)
  const isHeading = /^[ \t]*#{1,6}\s+/.test(t)
  return { indent, isList, isHeading }
}

// docLines: líneas numeradas (1-based) de un documento, ya sin el bloque
// propio y sin `\r`. La numeración es la del fichero ORIGINAL — el que el
// humano va a abrir — no la del texto podado: citar "AGENTS.md:84" y que no
// sea la línea 84 sería peor que no citar nada.
export function docLines(content) {
  const original = String(content ?? '').split('\n')
  const stripped = new Set()
  let inside = false
  original.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (!inside && line === CONTRACT_MARKER_OPEN) { inside = true; stripped.add(i); return }
    if (inside) { stripped.add(i); if (line === CONTRACT_MARKER_CLOSE) inside = false }
  })
  const build = (raw, i) => {
    const text = raw.replace(/\r$/, '')
    return { n: i + 1, text, ...shape(text) }
  }
  // Bloque ABIERTO y nunca cerrado (alguien borró el marcador de cierre — un
  // caso real: ct-init tiene un guardián dedicado a los rastros parciales).
  // Podar "desde la apertura hasta el final" tiraría por la borda TODO lo que
  // hubiera debajo, incluidas las convenciones propias del repo, y el aviso se
  // callaría por un marcador huérfano. Ante la duda no se poda nada: como mucho
  // el propio bloque se autodenuncia, y eso cuesta una línea de lectura.
  if (inside) return original.map(build)
  return original.map(build).filter((_, i) => !stripped.has(i))
}

// --- MANDATO vs MENCIÓN, pieza 1: qué trozo de la línea es "comando" --------
//
// `commandCandidates` parte una línea de markdown en los trozos donde puede
// vivir una ORDEN ejecutable:
//   - el contenido de cada span de código (`` `...` ``), y
//   - la prosa que queda al quitar esos spans.
// Los dos, no uno: mirar solo los spans pierde `corre ./x.sh <n> y luego `git
// commit`` (la orden está en la prosa), y mirar solo la línea entera es lo que
// hacía F11 — por eso `bloquea \`git worktree add\` con dirty tree` (una
// descripción de un hook en una tabla de inventario) contaba como si el repo
// mandara crear worktrees ahí.
// Una línea SIN backticks (típica dentro de un bloque ```…```, como el árbol de
// directorios o el ejemplo de comando del blockquote) da un único candidato:
// ella misma, sin el `>` de cita ni el guion de bullet.
export function commandCandidates(text) {
  const bare = String(text ?? '')
    .replace(/^(\s*(?:>\s?)+)/, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/, '')
  if (!bare.includes('`')) return [bare]
  const spans = []
  for (const m of bare.matchAll(/`+([^`]*)`+/g)) spans.push(m[1])
  const prose = bare.replace(/`+[^`]*`+/g, ' ')
  return [...spans, prose]
}

// stripMarkup: para las preguntas SEMÁNTICAS (¿esta línea saca la orden del
// loop?) el énfasis estorba. Caso real: AGENTS.md dice «trabajar un issue
// **fuera** del loop» — con los asteriscos dentro, ninguna expresión que
// buscara "fuera del loop" lo encontraba.
function stripMarkup(text) {
  return String(text ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ')
}

// --- MANDATO vs MENCIÓN, pieza 2: marcas de ÁMBITO -------------------------
//
// Lista corta y deliberadamente NO ambigua. Cada entrada tiene que significar
// «esto no es una orden para el agente del loop», no solo «aquí se habla de
// otra cosa». Lo que NO está aquí, y es la omisión importante: «a mano» /
// «manualmente» a secas. Una guía puede perfectamente decir «reclama el issue a
// mano con ./scripts/dispatch-check.sh» — eso es exactamente el deadlock, y
// silenciarlo sería el falso negativo caro. Solo cuenta cuando la frase saca la
// orden del loop («a mano, FUERA DEL LOOP») o la prohíbe.
const SCOPE_OUT_RES = [
  /fuera del loop/i,
  /outside (?:the )?(?:loop|control tower)/i,
  /sin (?:usar |pasar por )?\/?ct-next/i,
  /without \/?ct-next/i,
  /no (?:lo |la |los |las )?(?:corras|ejecutes|reclames|invoques|uses|lances)\b/i,
  /nunca (?:lo |la )?(?:corras|ejecutes|reclames|invoques)\b/i,
  /do ?n[o']?t run|do not run|never run/i,
  // «ya no ES» a secas queda FUERA a propósito: «ya no es opcional: corre
  // ./scripts/dispatch-check.sh» es una frase perfectamente normal y silenciarla
  // sería exactamente el falso negativo caro. Solo las formas que dicen que la
  // cosa dejó de hacerse.
  /ya no (?:se usa|se usan|se corre|lo hace|lo hacen|aplica|aplican|hace falta|es necesario|es obligatorio)/i,
  /no longer/i,
  /deprecad|obsolet/i,
  // «el claim lo hace /ct-next, no tú» y variantes: la frase con la que un repo
  // declara que la orden vieja dejó de dirigirse al agente.
  /(?:lo hace|lo pone|lo hará) (?:el |la )?(?:dispatcher|\/ct-next|ct-next)/i,
  /el agente no (?:reclama|lo reclama|hace el claim)/i,
  /no (?:lo )?reclames? (?:nada |el issue )?a mano/i,
]

function scopedOut(text) {
  const t = stripMarkup(text)
  return SCOPE_OUT_RES.some((re) => re.test(t))
}

// ancestorTexts: los bullets que CONTIENEN a esta línea (subiendo por
// anidamiento) más el encabezado más cercano. El ámbito de una orden casi nunca
// está en su propia línea. Caso real, `docs/agentic-workflow.md`:
//
//     - **A mano, fuera del loop:** entonces sí, lo aplicas tú con `…`      ← ámbito
//       - **Claim:** `./scripts/dispatch-check.sh <issue#>` → …            ← la orden
//
// La línea de la orden, leída sola, es indistinguible de la versión VIEJA que
// sí mandaba al agente reclamar. Lo que las separa está un nivel arriba.
// Ventana acotada (40 líneas, 4 ancestros): un documento largo no puede hacer
// que una orden herede el ámbito de algo que quedó a media página.
function ancestorTexts(lines, i) {
  const out = []
  let need = lines[i].indent
  for (let j = i - 1; j >= 0 && i - j <= 40 && out.length < 4; j--) {
    const L = lines[j]
    if (!L.text.trim()) continue
    if (L.isHeading) { out.push(L.text); break }
    if (L.indent < need && L.isList) { out.push(L.text); need = L.indent }
  }
  return out
}

// evidenceFromDocs: recorre los documentos y aplica `predicate(candidatos,
// línea)`. Antes de aceptar una línea comprueba el ámbito: si la propia línea o
// alguno de sus ancestros la saca del loop, no es una orden que el agente
// despachado vaya a obedecer.
function evidenceFromDocs(docs, predicate) {
  const out = []
  for (const doc of docs || []) {
    const lines = docLines(doc.content)
    lines.forEach((line, i) => {
      if (!predicate(commandCandidates(line.text), line.text)) return
      if (scopedOut(line.text)) return
      if (ancestorTexts(lines, i).some(scopedOut)) return
      out.push({ path: doc.path, line: line.n, text: line.text.trim(), via: doc.via || null })
    })
  }
  return out
}

// normalizePath: separadores a `/` y sin `./` inicial, para que las reglas de
// ruta no dependan de cómo las haya construido quien llame.
function normalizePath(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

// `files` mezcla ficheros y directorios; los directorios llevan `/` al final
// (así los emite detect-conventions.mjs). Un directorio llamado `worktrees` es
// una señal por sí mismo — no hace falta que tenga nada dentro, y de hecho no
// se desciende a él.
const isDir = (p) => p.endsWith('/')

// Rutas que no son convenciones VIVAS del repo: lo archivado y lo que es el
// test de otra cosa. Caso real: el detector marcaba
// `docs/archive/planning-gsd/STATE.md` (un estado histórico, explícitamente
// archivado) y `scripts/tests/dispatch-check.test.sh` (el test del script, no
// un segundo protocolo). Ninguno de los dos se puede "resolver": borrar un
// archivo histórico o el test de un script es exactamente el "empeorar el repo"
// que este fichero ya no puede pedir.
const ARCHIVED_PATH_RE = /(^|\/)(archive|archives|archived|archivo|historico|historicos|histórico|históricos|old|deprecated|attic|backup|backups|\.trash)\//i
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec|specs)\/|(^|\/)[^/]*[._-](test|spec)\.[^/]*$/i
const isLivePath = (p) => !ARCHIVED_PATH_RE.test(p) && !TEST_PATH_RE.test(p)

// --- Regla 1: CLAIM -------------------------------------------------------
// Un `dispatch-check` que no es el del plugin (un fichero propio del repo), o
// una INSTRUCCIÓN en la documentación del repo que manda ejecutarlo. Cualquiera
// de las dos basta: el fichero sin la instrucción sigue siendo un protocolo
// vivo que alguien puede invocar, y la instrucción sin el fichero sigue siendo
// una orden que el agente despachado leerá y obedecerá.
const CLAIM_FILE_RE = /(^|\/)dispatch-check[^/]*$/i

// isClaimInvocation: la parte estructural del arreglo. `dispatch-check` aparece
// como COMANDO cuando (a) se ejecuta explícitamente — `./x`, `bash x`, `node x`
// — o (b) lleva un argumento pegado detrás (`x <issue#>`, `x 42`, `x --release`).
// Lo que ya NO cuenta, y era la mitad de los falsos positivos del repo real:
//   `scripts/       dispatch-check.sh, dependabot-*, sentry-*`   ← árbol de dirs
//   `` `scripts/dispatch-check.sh` sigue en el repo para… ``     ← mención
//   `` `scripts/dispatch-check.sh` (anti-colisión por area…) ``  ← mención
const CLAIM_ARG_RE = /^(--?[\w-]|<[^\s]|\d|#\d|\$)/
// Además del intérprete, los verbos con los que una guía manda ejecutar algo.
// Sin ellos se escapaba «antes de implementar, corre dispatch-check.sh» (sin
// `./` y sin argumento), que es una orden como una casa. Un verbo NO convierte
// una mención en orden por sí solo: tiene que ir pegado delante del token.
const CLAIM_RUNNER_RE =
  /^(bash|sh|zsh|dash|node|python3?|source|exec|\.|\$|>|corre|corres|ejecuta|ejecutas|lanza|lanzas|invoca|invocas|usa|usas|run|runs|execute|call)$/i
// Tercera vía, medida y añadida DESPUÉS del barrido de falsos negativos: una
// línea que NO tiene forma de comando pero declara una OBLIGACIÓN sobre el
// script («el claim se gestiona con `scripts/dispatch-check.sh`, que es
// obligatorio», «primer paso del agente») sigue siendo una orden que el agente
// va a obedecer, y sin esto se escapaba. Se evalúa sobre la línea entera, no
// sobre el token, porque es el contexto el que obliga. No reintroduce ninguno de
// los falsos positivos del repo real: ninguna de sus cuatro líneas problemáticas
// contiene una marca de obligación (y las que la contuvieran caerían igual por
// `scopedOut`, que se comprueba después).
const CLAIM_DUTY_RE =
  /\b(obligatori|imprescindible|debes\b|deberás|tienes que|hay que|primer paso|antes de implementar|antes de empezar|is required|must run|mandatory)/i

function isClaimInvocation(cand, line = '') {
  if (/dispatch-check/i.test(cand) && CLAIM_DUTY_RE.test(stripMarkup(line))) return true
  const toks = String(cand).trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < toks.length; i++) {
    if (!/dispatch-check/i.test(toks[i])) continue
    const tok = toks[i]
    // Un elemento de lista (`dispatch-check.sh,` / `dispatch-check.sh;`) nunca
    // es una invocación: es una enumeración.
    if (/[,;]$/.test(tok)) continue
    if (/^(\.{1,2})?\//.test(tok)) return true // ./x, ../x, /abs/x
    if (CLAIM_RUNNER_RE.test(toks[i - 1] || '')) return true
    const next = toks[i + 1]
    if (next && CLAIM_ARG_RE.test(next)) return true
  }
  return false
}

// --- Regla 2: WORKTREES ---------------------------------------------------
// Un `git worktree add` documentado que NO apunta a `.worktrees/`; un
// directorio de worktrees propio; o un hook cuyo nombre delata que vigila
// ramas/worktrees (es quien puede tumbar cada despacho del loop).
//
// La regla NO intenta extraer la ruta por posición — `add <path> -b <rama>` y
// `add -b <rama> <path>` son ambos válidos y un capturador posicional se
// equivoca de token en la mitad de los casos. Salta banderas y se queda con el
// primer operando; si NO hay operando, esto no es un comando sino una mención,
// y esa distinción es la que mata los dos falsos positivos del repo real:
//   `` …; empuja a `git worktree add`. Permite: `main`, restore… ``
//   `` `menoplus-worktree-guard.sh` (bloquea `git worktree add` con dirty tree) ``
const LOOP_WORKTREE_MENTION_RE = /(^|[^\w.])\.worktrees\//
const HOOK_GUARD_RE = /(^|\/)\.claude\/hooks\/[^/]*(worktree|branch|rama)[^/]*$/i
function foreignWorktreeAdd(cand) {
  const m = /git\s+worktree\s+add\b(.*)$/i.exec(String(cand))
  if (!m) return false
  const rest = m[1].trim()
  if (!rest) return false
  // Comando partido en varias líneas (`git worktree add \` + la ruta debajo):
  // no se ve el operando, así que NO se puede descartar que apunte a otro sitio.
  // Ante "no lo sé" se avisa — para eso está el acuse, que es la salida.
  if (rest === '\\') return true
  const toks = rest.split(/\s+/).filter(Boolean)
  let operand = null
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (/^--?[\w-]/.test(t)) { if (/^-[bB]$/.test(t)) i++; continue }
    operand = t
    break
  }
  // Sin operando, o con un operando que no parece una ruta (puntuación de
  // prosa: `add`. Permite: …), no hay comando que contradiga nada.
  if (!operand || !/[\w~$]/.test(operand) || /^[.,;:!?)]+$/.test(operand)) return false
  return !LOOP_WORKTREE_MENTION_RE.test(rest)
}

// --- Regla 3: ESTADO ------------------------------------------------------
// Un fichero de estado que no es `.agent/STATE.md`. El loop entero (hook de
// SessionStart, seed de `/ct-next`, `blocked`) está atado a esa ruta: si el
// repo ya llevaba el suyo en otro sitio, van a convivir dos y nadie sabrá cuál
// es el vigente.
const STATE_FILE_RE = /(^|\/)(STATE|STATUS)\.md$/i

export function detectConventions({ docs = [], files = [], acks = null } = {}) {
  const paths = (files || []).map(normalizePath)
  const findings = []

  // --- claim ---
  const claimFiles = paths.filter((p) => !isDir(p) && CLAIM_FILE_RE.test(p) && isLivePath(p))
  const claimDocs = evidenceFromDocs(docs, (cands, line) => cands.some((c) => isClaimInvocation(c, line)))
  if (claimFiles.length || claimDocs.length) {
    findings.push({
      id: 'claim',
      title: 'este repo ya tiene su PROPIO protocolo de claim',
      // Las líneas de la documentación van PRIMERO, antes que los ficheros:
      // son la orden que el agente despachado va a leer y obedecer, así que son
      // la evidencia que decide. (La lista se trunca al imprimir; que lo que
      // sobreviva al corte sea lo importante no es un detalle cosmético.)
      evidence: [
        ...claimDocs,
        ...claimFiles.map((p) => ({ path: p, line: null, text: 'script de claim propio del repo' })),
      ],
      decision:
        'El plugin trae su propio `dispatch-check.mjs` y `/ct-next` lo invoca EN CÓDIGO ' +
        '(status:ready → status:in-progress) antes de crear el worktree. Con los dos vivos hay ' +
        'DOS protocolos sobre el mismo espacio de labels y nadie arbitrando: /ct-next reclama, el ' +
        'agente arranca, obedece la línea vieja de tu AGENTS.md, y tu script se encuentra un claim ' +
        'activo sobre su propio issue. Decide cuál manda: (a) quedarte con el del plugin y borrar ' +
        'la instrucción vieja de AGENTS.md/CLAUDE.md, (b) quedarte con el tuyo y no usar /ct-next ' +
        'para despachar, o (c) hacer que el tuyo sea un envoltorio del otro. Lo que no puede ' +
        'quedarse es la contradicción.',
    })
  }

  // --- worktrees ---
  const foreignAdds = evidenceFromDocs(docs, (cands) => cands.some(foreignWorktreeAdd))
  const foreignWorktreeDirs = [
    ...new Set(
      paths
        .filter((p) => isDir(p) && /(^|\/)worktrees\/$/i.test(p))
        .map((p) => p.slice(0, -1))
        .filter((d) => d !== LOOP_WORKTREE_DIR)
    ),
  ]
  const guardHooks = paths.filter((p) => !isDir(p) && HOOK_GUARD_RE.test(p))
  if (foreignAdds.length || foreignWorktreeDirs.length || guardHooks.length) {
    findings.push({
      id: 'worktrees',
      title: 'este repo ya tiene una convención de worktrees/ramas propia',
      evidence: [
        ...foreignAdds,
        ...foreignWorktreeDirs.map((d) => ({ path: `${d}/`, line: null, text: 'directorio de worktrees propio del repo' })),
        ...guardHooks.map((p) => ({ path: p, line: null, text: 'hook que vigila ramas/worktrees' })),
      ],
      decision:
        `/ct-next crea cada slice en \`${LOOP_WORKTREE_DIR}/<n>\` sobre la rama ` +
        `\`${LOOP_BRANCH_PREFIX}<n>\` (\`<n>\` = número de ISSUE), y esas dos rutas están fijadas en ` +
        'el dispatcher: no son configurables. Si un hook del repo exige otra ruta o otro nombre de ' +
        'rama, tumbará cada despacho DESPUÉS de que el claim ya esté escrito. Decide: ensancha el ' +
        `hook para admitir \`${LOOP_WORKTREE_DIR}/\` y \`${LOOP_BRANCH_PREFIX}\`, o no uses /ct-next ` +
        'en este repo. Y quita de AGENTS.md/CLAUDE.md la instrucción que mande la otra ruta: el ' +
        'agente despachado la va a leer.',
    })
  }

  // --- estado ---
  const foreignState = paths.filter(
    (p) => !isDir(p) && STATE_FILE_RE.test(p) && p !== '.agent/STATE.md' && isLivePath(p)
  )
  if (foreignState.length) {
    findings.push({
      id: 'estado',
      title: 'este repo ya tiene un fichero de estado fuera de `.agent/STATE.md`',
      evidence: foreignState.map((p) => ({ path: p, line: null, text: 'fichero de estado propio del repo' })),
      decision:
        'El loop entero está atado a `.agent/STATE.md`: el hook de SessionStart hidrata desde ahí, ' +
        '/ct-next siembra ahí el STATE.md de cada worktree, y el campo `blocked` solo se lee ahí. ' +
        'Con dos ficheros de estado nadie sabrá cuál es el vigente. Decide cuál es la fuente de ' +
        'verdad y deja el otro como histórico (o bórralo).',
    })
  }

  // El acuse no BORRA el finding: lo marca. Quien imprime decide (formatFindings
  // lo baja a una nota de una línea). Devolverlo marcado y no desaparecido es lo
  // que permite que ct-next filtre por id y siga sabiendo que estaba silenciado.
  if (acks) {
    for (const f of findings) {
      const ack = acks.get ? acks.get(f.id) : acks[f.id]
      if (ack) f.silenced = ack
    }
  }

  return findings
}

// --- ENLACES QUE LA PROPIA GUÍA DECLARA AUTORIZADOS -------------------------
//
// Segundo defecto de F11: se escaneaban SOLO `AGENTS.md` y `CLAUDE.md`. En el
// repo real las dos guías apuntaban a `docs/agentic-workflow.md` como
// «referencia completa», y ahí seguía viva la orden vieja en imperativo directo
// al agente (`Claim (primer paso del agente): ./scripts/dispatch-check.sh
// <issue#>`). Se limpiaron los dos ficheros que el detector miraba y la orden
// quedó a un clic, en el que no miraba. Un agente que lee AGENTS.md y sigue el
// enlace que ese fichero llama autorizado la encuentra igual.
//
// ALCANCE: UN SALTO, desde los documentos raíz. Ni cero (el agujero de arriba)
// ni transitivo (una madriguera: `agentic-workflow.md` ya enlaza a un spec de
// 2026-05 que enlaza a otros). El criterio es que AGENTS.md/CLAUDE.md son la
// puerta de entrada del agente, y un documento que ELLOS declaran canónico es,
// a efectos de lo que el agente obedecerá, parte de ellos. El nieto ya no.
export function linkedDocPaths(docs) {
  const out = []
  const seen = new Set()
  const push = (raw) => {
    let p = String(raw).trim().replace(/^<|>$/g, '')
    if (!p || !/\.md$/i.test(p)) return
    if (/^[a-z][\w+.-]*:/i.test(p)) return // http:, https:, mailto:…
    if (p.startsWith('/') || p.startsWith('~')) return // fuera del repo
    if (/[<>{}*?|"']/.test(p)) return // plantillas: `.worktrees/<n>/…`, `apps/{a,b}/…`
    p = normalizePath(p)
    // `..` no se resuelve aquí (esto es lógica pura): se rechaza. Salir del repo
    // es justo lo que no queremos, y quien lee el disco lo vuelve a comprobar.
    if (p.split('/').includes('..')) return
    const first = p.split('/')[0]
    // Territorio del propio loop y ruido conocido: no son documentación del repo.
    if (['.worktrees', '.agent', 'node_modules', '.git'].includes(first)) return
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }
  for (const doc of docs || []) {
    for (const { text } of docLines(doc.content)) {
      for (const m of text.matchAll(/\]\(\s*([^)\s#]+\.md)(?:#[^)]*)?\s*\)/gi)) push(m[1])
      for (const m of text.matchAll(/`([^`\n]+?\.md)`/gi)) push(m[1])
      for (const m of text.matchAll(/(?:^|[\s(])((?:\.{1,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)*\.md)\b/gi)) push(m[1])
    }
  }
  return out
}

// --- ACUSE EXPLÍCITO --------------------------------------------------------
//
// Formato, una línea por señal:
//     claim: 2026-07-28 — manda el claim del plugin; el script del repo se
//     queda solo para trabajo a mano fuera del loop
// Se exigen las TRES cosas (qué señal, cuándo, por qué) porque un acuse sin
// fecha ni motivo es indistinguible de un `# TODO` que alguien dejó y nadie
// recuerda — y esto silencia un aviso de verdad.
//
// Todo lo que no sea un comentario `#` o una línea en blanco TIENE que parsear.
// Una línea que no se entiende se REPORTA, nunca se ignora: el modo de fallo que
// no nos podemos permitir es que alguien crea que ha silenciado algo y no lo
// haya hecho (vuelve a ver el aviso y concluye que el acuse no sirve) o al revés.
export function parseAcks(content) {
  const acks = new Map()
  const problems = []
  const raw = String(content ?? '').replace(/^﻿/, '') // BOM: editores de Windows
  let fenced = false
  raw.split('\n').forEach((rawLine, i) => {
    const line = rawLine.replace(/\r$/, '')
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) { fenced = !fenced; return }
    if (fenced || !t || t.startsWith('#') || t.startsWith('<!--')) return
    const n = i + 1
    const m = /^(?:[-*+]\s+)?([A-Za-zÁ-Úá-ú][\w-]*)\s*:\s*(.*)$/.exec(t)
    if (!m) {
      problems.push({ line: n, text: t, why: 'no tiene la forma `señal: YYYY-MM-DD — motivo`' })
      return
    }
    const id = m[1].toLowerCase()
    const rest = m[2].trim()
    if (!ACK_IDS.includes(id)) {
      problems.push({ line: n, text: t, why: `señal desconocida \`${m[1]}\` (las válidas: ${ACK_IDS.join(', ')})` })
      return
    }
    const d = /^(\d{4}-\d{2}-\d{2})\b[\s—–-]*(.*)$/.exec(rest)
    if (!d) {
      problems.push({ line: n, text: t, why: 'falta la fecha en formato YYYY-MM-DD justo después de los dos puntos' })
      return
    }
    const reason = d[2].trim()
    if (!reason) {
      problems.push({ line: n, text: t, why: 'falta el motivo: qué se decidió y por qué' })
      return
    }
    if (acks.has(id)) {
      problems.push({ line: n, text: t, why: `la señal \`${id}\` ya estaba acusada más arriba; esta línea no añade nada` })
      return
    }
    acks.set(id, { id, date: d[1], reason, line: n })
  })
  return { acks, problems }
}

// formatFindings: el aviso, ya listo para stderr. Una función y no dos
// (ct-init y ct-next lo imprimen igual) para que el texto no pueda divergir
// entre el bootstrap y el despacho.
//
// Tres bloques, en este orden: los avisos VIVOS, las señales silenciadas (una
// línea cada una — se dice que se han callado, porque «no se ha encontrado
// nada» y «se decidió no mirar esto» no son lo mismo y confundirlos es la
// mentira que este fichero lleva desde F11 intentando no contar), y los
// problemas del propio fichero de acuse.
export function formatFindings(findings, { where = 'este repo', ackProblems = [], ackUnreadable = null } = {}) {
  const live = (findings || []).filter((f) => !f.silenced)
  const silenced = (findings || []).filter((f) => f.silenced)
  const out = []
  if (live.length) {
    out.push(
      `ATENCIÓN: ${where} ya tenía convenciones propias en el terreno que ocupa el loop de Control Tower. ` +
        'No se ha cambiado nada por ti — pero esto NO se resuelve solo, y dejarlo así es como se llega a ' +
        'un AGENTS.md que se contradice consigo mismo y a dos protocolos de claim sobre las mismas labels.'
    )
    for (const f of live) {
      out.push(`  · [${f.id}] ${f.title}`)
      for (const e of f.evidence.slice(0, 6)) {
        const via = e.via ? ` (enlazado desde ${e.via})` : ''
        out.push(`      ${e.path}${e.line ? `:${e.line}` : ''}${via} — ${e.text}`)
      }
      if (f.evidence.length > 6) out.push(`      (+${f.evidence.length - 6} más)`)
      out.push(`      decisión: ${f.decision}`)
    }
    // LA SALIDA. Va con los avisos vivos y no en un README, porque el momento en
    // que hace falta es este. Sin ella el aviso vuelve a ser un muro: el repo
    // real ya había tomado la decisión correcta y el detector seguía marcándola.
    out.push(
      `  Si una de estas señales YA está decidida y no la vas a cambiar, escríbelo en \`${ACK_PATH}\` — una ` +
        'línea por señal, con la fecha y el motivo:'
    )
    out.push(`      ${live[0].id}: 2026-01-31 — <qué se decidió y por qué>`)
    out.push(
      '  Esa señal —y solo esa— deja de avisar; las demás siguen. No hace falta borrar documentación ' +
        'correcta para callar el aviso: si lo que documentas es el uso manual fuera del loop, acúsalo y ya.'
    )
  }
  for (const f of silenced) {
    const n = f.evidence.length
    out.push(
      `  nota: [${f.id}] silenciado por ${ACK_PATH} (${f.silenced.date}: ${f.silenced.reason}) — ` +
        `${n} señal${n === 1 ? '' : 'es'} sin revisar.`
    )
  }
  if (ackUnreadable) {
    out.push(
      `  aviso: existe \`${ACK_PATH}\` pero no se ha podido leer (${ackUnreadable}). Ningún acuse está ` +
        'aplicándose: lo que veas arriba puede ser algo que ya habías decidido.'
    )
  }
  for (const p of ackProblems || []) {
    out.push(`  aviso: ${ACK_PATH}:${p.line} no silencia nada — ${p.why}: «${p.text}»`)
  }
  return out.join('\n')
}
