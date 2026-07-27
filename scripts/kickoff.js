import { homedir } from 'node:os'
import { join } from 'node:path'
import { renderState } from './state.js'

// ACCOUNT_MAP — qué CLAUDE_CONFIG_DIR (qué cuenta de Claude) recibe el agente
// que se despacha para un repo.
//
// FORMA DE LOS PATRONES (D4, defecto 1 — la lógica de matching vive en
// dispatch.js#matchesAccountPattern, con el porqué del cambio documentado
// allí): cada patrón es `<owner>/<repo>` — SIEMPRE las dos mitades, nunca un
// nombre suelto. Cada mitad puede ser:
//   - un literal exacto            `mercadona`, `control-tower`
//   - `*`                          cualquier owner / cualquier repo
//   - un prefijo con `*` al final  `mo.*` casa `mo.foo`, NO casa `momento`
// Un `*` en cualquier otra posición es un patrón malformado y ct-next.mjs
// aborta al arrancar (exit 2) en vez de interpretarlo a medias.
//
// La versión anterior de este mapa (`personal: ['menoplus','munger',
// 'control-tower']`, `work: ['mo.','mercadona']`) casaba por PREFIJO DE
// NOMBRE con el owner ya descartado, con tres consecuencias verificadas:
// `mercadona/algun-tool-interno` acababa en la cuenta PERSONAL, la entrada
// `'mercadona'` no podía casar jamás, y `control-tower` casaba también
// `control-tower-de-otro`. Ahora el owner cuenta.
//
// CT_ACCOUNT_PERSONAL_DIR / CT_ACCOUNT_WORK_DIR: override explícito de los
// dos directorios, para máquinas donde las cuentas de Claude no viven bajo
// $HOME (y para que los tests no dependan del $HOME de quien los corre). No
// es un modo de prueba encubierto: no cambia NINGUNA decisión, solo a qué
// ruta apunta la cuenta ya elegida, y ct-next.mjs comprueba que la ruta
// resultante exista en disco antes de lanzar nada.
const personalDir = process.env.CT_ACCOUNT_PERSONAL_DIR || join(homedir(), '.claude-personal')
const workDir = process.env.CT_ACCOUNT_WORK_DIR || join(homedir(), '.claude-work')

export const ACCOUNT_MAP = {
  personal: ['josemerca/*', '*/menoplus', '*/munger'],
  work: ['mercadona/*', '*/mo.*'],
  personalDir,
  workDir,
  // legacy: las listas EXACTAS del mapa viejo, conservadas solo para poder
  // detectar y anunciar una reclasificación de cuenta provocada por el
  // arreglo (ver dispatch.js#resolveAccountLegacy y el aviso que imprime
  // ct-next.mjs). Borrables juntas en cuanto ese aviso deje de aparecer en
  // las corridas reales.
  legacy: {
    personal: ['menoplus', 'munger', 'control-tower'],
    work: ['mo.', 'mercadona'],
  },
}

// Exportado (F3): ct-groom.mjs necesita el conjunto de valores de `Tipo`
// reconocidos para avisar cuando el spec trae un valor que no matchea
// ninguna key de aquí — `renderKickoff`, más abajo, hace
// `ADDENDA[slice.type] || ''` en silencio, así que un `Tipo` que no sea
// ninguna de estas keys deja al agente despachado SIN ningún addendum, sin
// que nada lo señale. Exportar el objeto (en vez de mantener una lista
// aparte de "tipos válidos" en ct-groom.mjs) es la única forma de que ese
// aviso derive el conjunto reconocido de la ÚNICA fuente de verdad: si
// mañana se añade un addendum nuevo aquí (o se corrige un typo en una key
// existente), el aviso de ct-groom.mjs lo refleja solo, sin tocar ese
// fichero ni arriesgarse a que las dos listas diverjan.
export const ADDENDA = {
  ui: 'Addendum UI: gate de screenshot obligatorio y respeta el design system; no cambies tokens de marca.',
  backend: 'Addendum backend: migración forward+rollback, respeta contratos, reporta el cambio de API.',
  infra: 'Addendum infra: dry-run/plan primero, nunca secretos en claro, apply solo tras review.',
  bugfix: 'Addendum bugfix: reproduce-first (test que falla con el síntoma exacto), causa raíz, fix mínimo, test de regresión.',
}

// DOS ESPACIOS DE IDENTIFICADORES, y no son intercambiables (D4, defecto 4 —
// ya nos ha mordido antes):
//   - `slice.n`     = el número de ISSUE de GitHub. Es lo que el dispatcher
//                     usa para la rama (`feat/<n>`), el worktree
//                     (`.worktrees/<n>`) y el claim (`dispatch-check <n>`).
//                     Lo produce gh-issue-map.js#mapGhIssue como `i.number`.
//   - `slice.order` = el número de ORDEN de la tabla §9 del spec (la columna
//                     "#"), el que /ct-groom escribe en el marcador
//                     `<!-- ct-order:N -->` y en el título del issue.
// Son numeraciones distintas: el slice §9 #1 de un epic puede ser el issue
// #47. Cualquier texto que se le enseñe al agente tiene que decir CUÁL de
// los dos está nombrando — un agente que confunda "#3" de issue con "#3" de
// orden se hidrata del issue equivocado. (Nota: `slices.js`, el parser de la
// tabla §9, llama `n` a su número de ORDEN — ese struct nunca llega hasta
// aquí, pero es el origen histórico de la confusión.)
function issueRefOf(slice) {
  return slice.issue || (slice.n != null ? `#${slice.n}` : '(sin número de issue)')
}

// `slice.order === slice.n` NO se anuncia. gh-issue-map.js#mapGhIssue rellena
// `order: order ?? i.number` — es decir, cuando un issue NO trae el marcador
// `<!-- ct-order:N -->` (uno creado a mano, o de antes de /ct-groom), su
// "orden" es una COPIA sintética del número de issue, no un orden real de la
// tabla §9. Anunciarlo como "slice #47 de la tabla §9" sería inventarse
// exactamente el dato que este arreglo existe para no confundir. Cuando los
// dos números coinciden de verdad (issue #3 con ct-order:3), omitirlo no
// pierde nada: el número ya está delante, como número de issue.
function orderSuffixOf(slice) {
  if (slice.order == null || slice.order === slice.n) return ''
  return ` (slice #${slice.order} de la tabla §9 del spec — numeración DISTINTA del número de issue)`
}

export function renderKickoff(slice, { repo, dispatchCheckPath }) {
  const addendum = ADDENDA[slice.type] || ''
  return [
    `Estás implementando UN slice (${slice.name}) del repo ${repo}, issue ${issueRefOf(slice)}${orderSuffixOf(slice)}.`,
    `Es human-gated: NO empieces el siguiente slice; al terminar deja el PR listo y PARA.`,
    `Arranque verification-first: confirma pwd/rama, git log, y baseline verde ANTES de tocar nada.`,
    `Hidrátate de .agent/STATE.md y del issue de GitHub; los criterios de aceptación son ${slice.ac.join(', ') || '(ver issue)'}.`,
    `Sigue superpowers:subagent-driven-development (impl → spec-review → code-review) con TDD.`,
    addendum,
    // W-C: el claim (status:ready → status:in-progress) lo hace /ct-next en
    // código, ANTES de crear este worktree — no por el prompt. El release
    // (in-progress → in-review) SÍ se deja aquí a propósito (decisión ya
    // tomada), con el Phase 3 PR conformance gate como backstop eventual. El
    // comando es LITERAL, con issue/repo ya sustituidos — no una descripción
    // que el agente tenga que traducir por su cuenta y pueda no ejecutar.
    //
    // Fix round 1 (review de W-C), finding 1: `${CLAUDE_PLUGIN_ROOT}` NO es
    // una env var del shell de la sesión del agente — solo la sustituye
    // Claude Code al renderizar `commands/*.md`/`hooks/hooks.json`. Un
    // kickoff (un prompt de texto plano, no un fichero de comando) que
    // emitiera ese token literal produciría un `Cannot find module` en TODO
    // despacho con éxito. `dispatchCheckPath` llega ya resuelto como ruta
    // absoluta real (ct-next.mjs la calcula relativa a su propia ubicación)
    // y se interpola tal cual — nunca el token sin expandir.
    `Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR, libera el claim con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --release\`, deja el estado mergeable y PARA.`,
  ].filter(Boolean).join('\n')
}

export function buildStateSeed(slice, { branch, base }) {
  const issueNum = slice.issue != null ? parseInt(String(slice.issue).replace('#', ''), 10) : null
  return renderState({
    meta: {
      task: slice.name,
      status: 'not_started',
      branch,
      base,
      last_commit: '',
      github_issue: issueNum,
      // D4, defecto 4: este campo imprimía el número de ISSUE llamándolo
      // "slice #N" — dos espacios de identificadores distintos (ver el
      // comentario de issueRefOf, arriba) fundidos en una sola etiqueta, en
      // el primer fichero que lee el agente al arrancar. Ahora dice cuál es
      // cuál, y solo nombra el orden §9 cuando de verdad se conoce.
      you_are_here: `worktree fresco para el issue ${issueRefOf(slice)} de GitHub${orderSuffixOf(slice)}`,
      next_action: `hidrátate del issue y empieza por el primer AC (${slice.ac[0] || 'ver issue'})`,
      verify: '',
      tasks: [],
    },
    body: '## Current State\n(slice recién despachado, sin trabajo aún)',
  })
}
