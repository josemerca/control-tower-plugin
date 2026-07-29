import { homedir } from 'node:os'
import { join } from 'node:path'
import { renderState } from './state.js'
import { resolveGatesForAgent, renderGateKickoffLines } from './gates.js'

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
//
// F21 — ADDENDA YA NO CONTIENE NINGÚN GATE. Hasta esta ronda, el ÚNICO gate
// humano de todo el plugin era media frase dentro de este objeto ("gate de
// screenshot obligatorio", en `ui`; "apply solo tras review", en `infra`).
// Consecuencia: `Tipo` decidía a la vez el recordatorio TÉCNICO y el GATE
// HUMANO, dos ejes que no siempre coinciden — el caso real fue un slice
// `Tipo: backend` (migración con backfill) que el spec marcaba como
// necesitado de gate visual "porque la barra es lo más visible de todo el
// spec": recibió el addendum de backend y ningún gate, y nada lo señaló.
//
// Las dos frases de gate se han MOVIDO a scripts/gates.js, que las resuelve
// por separado (ver renderKickoff, más abajo). Aquí quedan solo recordatorios
// técnicos. Que no queden también aquí es parte del arreglo, no una limpieza
// estética: un `Tipo: ui` que RENUNCIA a su gate en el spec seguiría
// recibiendo "gate de screenshot obligatorio" desde su addendum, y el kickoff
// se contradiría a sí mismo.
export const ADDENDA = {
  ui: 'Addendum UI: respeta el design system; no cambies tokens de marca.',
  backend: 'Addendum backend: migración forward+rollback, respeta contratos, reporta el cambio de API.',
  infra: 'Addendum infra: dry-run/plan primero, nunca secretos en claro.',
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

// F17 — LA RAMA BASE NO ERA UN DATO QUE EL AGENTE TUVIERA.
//
// `buildStateSeed` recibía `base` desde la primera versión; `renderKickoff`
// no. En el caso normal daba igual, porque `gh pr create` sin `--base` apunta
// a la rama por defecto del repo y ct-next resuelve esa MISMA rama cuando no
// se pasa `--base`. Pero ct-next SÍ acepta `--base <otra-rama>` y con ella
// crea el worktree (`git worktree add -b feat/<n> <wt> <resolvedBase>`): el
// agente abriría su PR contra la rama por defecto, o sea contra una base que
// no es de la que salió, con un diff que no es el suyo. El kickoff no le
// nombraba la base en ningún sitio.
//
// Sin base conocida NO se rellena con "main": el bug que W-D arregló en
// ct-next.mjs fue exactamente ese (asumir "main" en silencio). Se remite a la
// rama de la que salió el worktree, que es un hecho que el agente puede
// comprobar (`git log`), en vez de un nombre inventado.
function baseRefOf(base) {
  return typeof base === 'string' && base.length > 0
    ? `\`${base}\``
    : 'la rama base de la que salió este worktree'
}

export function renderKickoff(slice, { repo, dispatchCheckPath, base }) {
  const addendum = ADDENDA[slice.type] || ''
  // F21 — LOS GATES, POR FIN SEPARADOS DEL TIPO. `resolveGatesForAgent` (ver
  // gates.js) prefiere lo que DECLARA el issue (sus labels `gate:`, que es lo
  // que sobrevive a un redespacho) y solo cae al `Tipo` para issues anteriores
  // a esta ronda. Las líneas de gate van justo después del addendum y ANTES
  // del bloque de cierre del PR, no al final: son la condición para que ese
  // cierre pueda ocurrir.
  const gateLines = renderGateKickoffLines(resolveGatesForAgent(slice))
  return [
    `Estás implementando UN slice (${slice.name}) del repo ${repo}, issue ${issueRefOf(slice)}${orderSuffixOf(slice)}.`,
    `Es human-gated: NO empieces el siguiente slice; al terminar deja el PR listo y PARA.`,
    `Arranque verification-first: confirma pwd/rama, git log, y baseline verde ANTES de tocar nada.`,
    // F21, segundo hallazgo de la misma lente ("ninguna exigencia que el spec
    // le haga al agente puede depender de que el agente lea el spec"): la
    // columna `Protegido` SÍ llega al cuerpo del issue, pero este kickoff
    // enumeraba los criterios de aceptación uno a uno y no nombraba JAMÁS lo
    // que queda fuera de alcance. "Hidrátate del issue" es estrictamente más
    // débil que nombrar la sección: lo que se enumera se lee, y lo que se deja
    // a "ya lo verá" compite con el resto del body. No se interpola el texto
    // (a diferencia de los AC) porque `Protegido` es prosa de longitud
    // arbitraria y el kickoff se teclea entero en un pty; se nombra la sección
    // exacta, que es lo que hace falta para que la busque.
    `Hidrátate de .agent/STATE.md y del issue de GitHub; los criterios de aceptación son ${slice.ac.join(', ') || '(ver issue)'}. Lee además la sección "## Out of scope / Protected" del issue: lo que hay ahí NO se toca, aunque parezca parte del trabajo.`,
    `Sigue superpowers:subagent-driven-development (impl → spec-review → code-review) con TDD.`,
    addendum,
    ...gateLines,
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
    // F7: el agente despachado es el principal ESCRITOR de STATE.md, y hasta
    // ahora no tenía forma de decir "esto no puede continuar" salvo prosa
    // dentro de `next_action` — que la siguiente sesión lee como una orden
    // vigente. El campo existe; hay que nombrárselo aquí o no lo usará.
    `Si el trabajo queda BLOQUEADO (no puedes continuar, y no es solo "no terminado"), márcalo en .agent/STATE.md como \`blocked: {reason: "por qué", unblock: "qué haría falta"}\` — NO en prosa dentro de next_action. El hook de SessionStart lo anuncia y suspende el next_action en la siguiente sesión.`,
    // F17 — EL KICKOFF FABRICABA EL DEADLOCK QUE EL PROPIO LOOP DESCRIBE COMO
    // AVERÍA. Esta línea decía "abre PR" y nada más: no pedía `Closes #N`. La
    // cadena, entera y verificable en este repo:
    //   1. el PR se mergea y el issue se queda ABIERTO (nada lo cierra);
    //   2. desde F13, un issue abierto en `status:in-review` RETIENE sus
    //      tokens de `area:`/`touches:` hasta el merge (claim.js:52-57), y el
    //      dispatcher no puede enterarse de que ya se mergeó porque lo que
    //      mira es el estado del ISSUE;
    //   3. esos tokens quedan retenidos INDEFINIDAMENTE, porque no hay nada
    //      que cierre el issue;
    //   4. el siguiente slice que comparta cualquier token —o que necesite el
    //      carril serializante global `migration`/`ci`/`pbxproj`— no sale
    //      nunca;
    //   5. y `merge-after` se satisface EXACTAMENTE cuando el issue está
    //      cerrado con `stateReason === 'COMPLETED'`
    //      (gh-issue-map.js#filterMergedIssues), que es lo que hace GitHub al
    //      mergear un PR con `Closes #N`: sin esa línea, ningún dependiente ve
    //      jamás su dependencia satisfecha.
    // No es teórico: en el repo donde iba a correr el primer despacho real,
    // diez issues llevaban meses tapando el carril serializante por esta
    // causa exacta (trabajo mergeado, issue abierto). Y el propio dispatcher
    // YA describía ese estado como avería y daba el remedio (ct-next.mjs:726
    // /787/901: "ciérralo como completed si el PR ya se mergeó y nadie lo
    // cerró porque le faltaba el Closes #N") — que el remedio existiera y la
    // causa la produjera este mismo fichero era la contradicción a cerrar.
    //
    // "en el CUERPO del PR": GitHub solo interpreta las closing keywords en el
    // cuerpo del PR y en los mensajes de commit de la rama. Un `Closes #N` en
    // el TÍTULO no cierra nada, y "ponlo en el PR" es ambiguo justo donde no
    // puede serlo.
    //
    // El número que se interpola es `slice.n` — el de ISSUE, la MISMA fuente
    // que el comando de `--release` de esta línea. Nunca `slice.order` (ver
    // el bloque de issueRefOf, arriba): un `Closes #<orden>` cerraría el issue
    // equivocado, o ninguno.
    `Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre el PR contra ${baseRefOf(base)} con \`Closes #${slice.n}\` en el CUERPO del PR (no en el título, no en un comentario), libera el claim con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --release\`, deja el estado mergeable y PARA.`,
    // El porqué va aparte y no dentro de la línea de arriba a propósito: esa
    // línea es una lista de seis órdenes, y una orden sin motivo dentro de una
    // lista de seis es la primera que se cae cuando el agente va justo de
    // contexto. Aquí lo que se le da es la consecuencia, que es lo que hace
    // que no se caiga. `merge-after` se nombra SIN número: la sección
    // `## Dependencias` lo escribe en espacio de ORDEN §9, no de issue, y
    // escribir aquí "merge-after #<número de issue>" sería justo la confusión
    // entre los dos espacios de identificadores que este fichero ya combate.
    `Ese \`Closes #${slice.n}\` no es cosmético ni opcional: es lo ÚNICO que cierra el issue al mergear el PR. Un PR mergeado con su issue abierto deja este slice reteniendo sus tokens de \`area:\`/\`touches:\` para siempre — ningún slice vecino se despacha, el carril serializante (\`migration\`/\`ci\`/\`pbxproj\`) se queda tapado, y ningún dependiente con un \`merge-after\` sobre este slice lo ve satisfecho jamás. Si abres el PR a mano, o alguien edita su cuerpo después, comprueba que la línea sigue ahí.`,
  ].filter(Boolean).join('\n')
}

// renderStateGates: el valor del campo `gates` del STATE.md sembrado. Una
// cadena legible (no una lista YAML de tokens) porque su lector es un agente
// que se re-hidrata: "visual" a secas no le dice qué tiene que hacer ni que no
// le toca cerrarlo a él. Cuando no hay ninguno, se afirma explícitamente —
// mismo criterio que `blocked: null` (state.js): un campo que solo aparece
// cuando hay algo malo es un campo que nadie escribe cuando le hace falta.
function renderStateGates(gates) {
  const list = gates || []
  if (!list.length) return 'ninguno (este slice no exige ningún gate humano antes de mergear)'
  return `${list.join(', ')} — GATES HUMANOS pendientes: los cierra quien revisa el PR, NO tú. Detalle en la sección "## Gates" del issue.`
}

export function buildStateSeed(slice, { branch, base }) {
  const issueNum = slice.issue != null ? parseInt(String(slice.issue).replace('#', ''), 10) : null
  return renderState({
    meta: {
      task: slice.name,
      // ====================================================================
      // F20/H3 — EL REPARTO DE ROLES SOLO VIVÍA DENTRO DE UN KICKOFF.
      //
      // Hay DOS sesiones vivas por repo con papeles opuestos: la
      // COORDINADORA (corre /ct-groom y /ct-next, revisa y mergea) y la
      // DESPACHADA (implementa un slice y para). Nada en el estado
      // observable decía quién era quién: el STATE.md de la raíz habla del
      // epic, el del worktree habla del slice, y el reparto solo estaba
      // escrito dentro del kickoff — un prompt que recibió UNA de las dos y
      // que se pierde con el contexto de esa sesión. Una sesión despachada
      // que se re-hidrata de su STATE.md (un /clear, una reanudación, un
      // hook de SessionStart) no tenía forma de saber que no le toca
      // mergear ni despachar el siguiente slice.
      //
      // Va en el frontmatter y no en prosa por la misma razón que `blocked`
      // (ver state.js): lo que tiene que sobrevivir a una re-hidratación es
      // un CAMPO, no una frase dentro de otro campo. El valor es texto
      // legible y no un enum porque su lector es un agente, no un parser —
      // ningún código del plugin decide nada con él, y decir eso aquí evita
      // que alguien lo convierta en un gate por accidente.
      role: 'slice-agent (sesión DESPACHADA por /ct-next): implementas ESTE slice y PARAS. No groomeas, no mergeas, no despachas el siguiente — de eso se encarga la sesión coordinadora del checkout principal.',
      // gates (F21) — MISMO ARGUMENTO QUE `role` (F20) Y QUE `blocked` (F7):
      // lo que tiene que sobrevivir a una re-hidratación es un CAMPO, no una
      // frase dentro de un prompt. El kickoff se pierde con el contexto de su
      // sesión; el hook de SessionStart inyecta este fichero en TODA sesión
      // nueva del worktree. Sin este campo, una sesión que se re-hidrata tras
      // un /clear no tiene forma de saber que su PR lleva un gate humano
      // pendiente — y el gate volvería a ser exactamente lo que esta ronda
      // arregla: una exigencia escrita en un sitio que su destinatario ya no
      // abre.
      //
      // Es texto legible y no un enum por la misma razón que `role`: su lector
      // es un agente, no un parser. NINGÚN código del plugin decide nada con
      // este campo — decirlo aquí evita que alguien lo convierta en un gate de
      // verdad por accidente; el gate ejecutable son las labels `gate:` del
      // issue.
      gates: renderStateGates(resolveGatesForAgent(slice)),
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
      // F7: `blocked: null` se siembra EXPLÍCITO, no se omite. Un slice recién
      // despachado no está bloqueado y eso es un hecho que conviene afirmar;
      // pero sobre todo, el campo tiene que EXISTIR en el fichero que el
      // agente va a editar — un campo que solo aparece documentado en el
      // plugin es un campo que nadie escribe cuando le hace falta. Ver
      // state.js#readBlocked para la forma completa (`{reason, since,
      // unblock}`) y para por qué el silencio se lee como "no bloqueado".
      blocked: null,
      verify: '',
      tasks: [],
    },
    body: '## Current State\n(slice recién despachado, sin trabajo aún)',
  })
}
