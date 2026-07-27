// Detección de convenciones PROPIAS del repo destino en el terreno que ocupa
// el loop (claim, worktrees, estado). Lógica pura: sin IO, sin subprocesos —
// quien lee el disco es scripts/detect-conventions.mjs, y quien la consume en
// el dispatch es ct-next.mjs.
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
// que arbitre. El fallo caro es concreto: `/ct-next` pone `status:in-progress`
// y crea el worktree, el agente arranca, obedece la línea vieja del AGENTS.md,
// y el script del repo se encuentra un claim activo sobre su propio issue.
//
// CRITERIO DE DISEÑO, explícito porque condiciona todos los umbrales de abajo:
// **es más valioso avisar de una sospecha que callar por no estar seguro.** Un
// falso positivo cuesta una línea de lectura; un falso negativo cuesta un
// deadlock que nadie sabe de dónde viene. Por eso las reglas son literales y
// generosas (una mención basta), y por eso la única cosa que NUNCA se hace es
// devolver "nada" cuando en realidad no se ha podido mirar — de eso se encarga
// quien llama (ver detect-conventions.mjs / ct-init.sh: sin poder escanear se
// dice que no se ha podido, jamás se pasa por "repo limpio").

export const CONTRACT_MARKER_OPEN = '<!-- ct-init:slices-contract -->'
export const CONTRACT_MARKER_CLOSE = '<!-- /ct-init:slices-contract -->'

// Rutas y nombres que el dispatcher del plugin ocupa. Se citan en los mensajes
// para que la decisión que hay que tomar sea concreta, no "revisa tu setup".
export const LOOP_WORKTREE_DIR = '.worktrees'
export const LOOP_BRANCH_PREFIX = 'feat/'

// El bloque que el PROPIO ct-init siembra se PODA antes de escanear
// (`docLines`, abajo). Imprescindible desde F11: ese bloque habla de
// `dispatch-check`, de `.worktrees/<n>`, de `status:in-progress` y de `cmux` —
// sin la poda, la SEGUNDA corrida de ct-init sobre cualquier repo se
// denunciaría a sí misma y el aviso moriría de ruido. Tolera CRLF (mismo
// motivo que ct-init.sh: un AGENTS.md editado en Windows lleva `\r` pegado a
// cada marcador y ninguna comparación de línea completa lo encontraba).

// docLines: líneas numeradas (1-based) de un documento, ya sin el bloque
// propio y sin `\r`. La numeración es la del fichero ORIGINAL — el que el
// humano va a abrir — no la del texto podado: citar "AGENTS.md:84" y que no
// sea la línea 84 sería peor que no citar nada.
function docLines(content) {
  const original = String(content ?? '').split('\n')
  const stripped = new Set()
  let inside = false
  original.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (!inside && line === CONTRACT_MARKER_OPEN) { inside = true; stripped.add(i); return }
    if (inside) { stripped.add(i); if (line === CONTRACT_MARKER_CLOSE) inside = false }
  })
  // Bloque ABIERTO y nunca cerrado (alguien borró el marcador de cierre — un
  // caso real: ct-init tiene un guardián dedicado a los rastros parciales).
  // Podar "desde la apertura hasta el final" tiraría por la borda TODO lo que
  // hubiera debajo, incluidas las convenciones propias del repo, y el aviso se
  // callaría por un marcador huérfano. Ante la duda no se poda nada: como mucho
  // el propio bloque se autodenuncia, y eso cuesta una línea de lectura.
  if (inside) return original.map((raw, i) => ({ n: i + 1, text: raw.replace(/\r$/, '') }))
  return original
    .map((raw, i) => ({ n: i + 1, text: raw.replace(/\r$/, '') }))
    .filter((_, i) => !stripped.has(i))
}

function evidenceFromDocs(docs, predicate) {
  const out = []
  for (const doc of docs || []) {
    for (const { n, text } of docLines(doc.content)) {
      if (predicate(text)) out.push({ path: doc.path, line: n, text: text.trim() })
    }
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

// --- Regla 1: CLAIM -------------------------------------------------------
// Un `dispatch-check` que no es el del plugin (un fichero propio del repo), o
// una instrucción en la documentación del repo que manda ejecutarlo. Cualquiera
// de las dos basta: el fichero sin la instrucción sigue siendo un protocolo
// vivo que alguien puede invocar, y la instrucción sin el fichero sigue siendo
// una orden que el agente despachado leerá y obedecerá.
const CLAIM_FILE_RE = /(^|\/)dispatch-check[^/]*$/i
const CLAIM_DOC_RE = /dispatch-check/i

// --- Regla 2: WORKTREES ---------------------------------------------------
// Un `git worktree add` documentado que NO apunta a `.worktrees/`; un
// directorio de worktrees propio; o un hook cuyo nombre delata que vigila
// ramas/worktrees (es quien puede tumbar cada despacho del loop).
//
// La regla mira la LÍNEA ENTERA en vez de intentar extraer la ruta del
// comando, y es deliberado: `git worktree add` acepta la ruta en posiciones
// distintas según los flags (`add <path> -b <rama>` y `add -b <rama> <path>`
// son ambos válidos), así que un capturador posicional se equivoca de token en
// la mitad de los casos — capturaría el nombre de RAMA y lo compararía contra
// una ruta. "La línea documenta un worktree add y no menciona `.worktrees/`"
// es la misma pregunta, sin ninguna gramática que acertar.
const WORKTREE_ADD_RE = /git\s+worktree\s+add\b/i
const LOOP_WORKTREE_MENTION_RE = /(^|[^\w.])\.worktrees\//
const HOOK_GUARD_RE = /(^|\/)\.claude\/hooks\/[^/]*(worktree|branch|rama)[^/]*$/i

// --- Regla 3: ESTADO ------------------------------------------------------
// Un fichero de estado que no es `.agent/STATE.md`. El loop entero (hook de
// SessionStart, seed de `/ct-next`, `blocked`) está atado a esa ruta: si el
// repo ya llevaba el suyo en otro sitio, van a convivir dos y nadie sabrá cuál
// es el vigente.
const STATE_FILE_RE = /(^|\/)(STATE|STATUS)\.md$/i

export function detectConventions({ docs = [], files = [] } = {}) {
  const paths = (files || []).map(normalizePath)
  const findings = []

  // --- claim ---
  const claimFiles = paths.filter((p) => !isDir(p) && CLAIM_FILE_RE.test(p))
  const claimDocs = evidenceFromDocs(docs, (t) => CLAIM_DOC_RE.test(t))
  if (claimFiles.length || claimDocs.length) {
    findings.push({
      id: 'claim',
      title: 'este repo ya tiene su PROPIO protocolo de claim',
      // Las líneas de AGENTS.md/CLAUDE.md van PRIMERO, antes que los ficheros:
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
  const foreignAdds = evidenceFromDocs(docs, (t) => WORKTREE_ADD_RE.test(t) && !LOOP_WORKTREE_MENTION_RE.test(t))
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
  const foreignState = paths.filter((p) => !isDir(p) && STATE_FILE_RE.test(p) && p !== '.agent/STATE.md')
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

  return findings
}

// formatFindings: el aviso, ya listo para stderr. Una función y no dos
// (ct-init y ct-next lo imprimen igual) para que el texto no pueda divergir
// entre el bootstrap y el despacho.
export function formatFindings(findings, { where = 'este repo' } = {}) {
  if (!findings.length) return ''
  const out = [
    `ATENCIÓN: ${where} ya tenía convenciones propias en el terreno que ocupa el loop de Control Tower. ` +
      'No se ha cambiado nada por ti — pero esto NO se resuelve solo, y dejarlo así es como se llega a ' +
      'un AGENTS.md que se contradice consigo mismo y a dos protocolos de claim sobre las mismas labels.',
  ]
  for (const f of findings) {
    out.push(`  · [${f.id}] ${f.title}`)
    for (const e of f.evidence.slice(0, 6)) {
      out.push(`      ${e.path}${e.line ? `:${e.line}` : ''} — ${e.text}`)
    }
    if (f.evidence.length > 6) out.push(`      (+${f.evidence.length - 6} más)`)
    out.push(`      decisión: ${f.decision}`)
  }
  out.push(
    '  Si alguna de estas señales es un falso positivo, ignórala: se avisa de la sospecha a propósito, ' +
      'porque callarla cuesta un deadlock y leerla cuesta una línea.'
  )
  return out.join('\n')
}
