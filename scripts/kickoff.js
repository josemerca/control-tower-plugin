import { homedir } from 'node:os'
import { join } from 'node:path'
import { renderState } from './state.js'
import { resolveGatesForAgent, renderGateKickoffLines, resolveE2e } from './gates.js'
// F22: el kickoff SOLO lo recibe un agente de slice, así que aquí no hay
// ambigüedad que resolver — su fichero de estado es siempre `.agent/SLICE.md`.
// Se importa la constante en vez de escribir la cadena a mano para que el día
// que ese path cambie no queden mensajes mandando al agente a un fichero que
// ya no es el suyo (que es exactamente el defecto que esta ronda arregla).
import { SLICE_REL_PATH } from './state-paths.js'
// parseSenalCell (Slice 10): el MISMO clasificador que usa el groom — un solo
// discriminador de "señal declarada / exención / nada" para groom, kickoff y
// (en prosa) la rúbrica del juez de slice, que no pueda divergir entre quien
// valida la celda y quien anuncia la línea.
import { EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING, parseSenalCell } from './groom.js'
import { NO_MILESTONE_KEY } from './gh-issue-map.js'

// SENAL_AUSENTE (Slice 10): el valor del campo `senal:` cuando el issue no
// trae la sección "## Señal de observabilidad" — la ausencia se DECLARA, no
// se omite (mismo criterio que `gates:`/`blocked:`: un campo que solo existe
// cuando hay algo es un campo que nadie escribe cuando le hace falta). Es UNA
// constante única, importada también por ct-step.mjs (el otro escritor: el
// fallback del paquete del juez cuando el SLICE.md fue sembrado por un plugin
// anterior a la columna), para que los dos escritores no diverjan. Su
// apertura "(sin señal declarada" es literalmente lo que la rúbrica de
// ct-slice-judge reconoce como sin-vara.
export const SENAL_AUSENTE = '(sin señal declarada — el issue no trae la sección "## Señal de observabilidad"; el juez de slice mide su ítem observabilidad como sin-vara)'

// AGENT_BIN — el nombre del ejecutable del agente que se teclea en la sesión
// de cmux. UNO, sin cuentas: F35 se llevó ACCOUNT_MAP y toda la resolución de
// «qué cuenta hace qué», así que el agente arranca con la configuración
// ambiente de quien lanza.
//
// El override existe por lo que documentaba F29, y sigue siendo cierto: en el
// .zshrc real de la máquina `claude` era una FUNCIÓN de shell interactiva
// («¿Qué cuenta? 1/2») y un shell de login resuelve la función antes que
// cualquier PATH — el agente se quedaba colgado en el `read` para siempre
// mientras /ct-next lo daba por LANZADO (el centinela se escribe antes de
// invocar al agente, y `command -v` devuelve 0 para una función). Si eso pasa,
// la salida es apuntar CT_AGENT_BIN a un wrapper no interactivo; no volver a
// meter un mapa de cuentas.
export const AGENT_BIN = process.env.CT_AGENT_BIN || 'claude'

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

// resolveE2eRunsForAgent — TAREA 9: los recorridos, resueltos con el MISMO
// criterio de dos fuentes que `resolveGatesForAgent` (justo arriba, F21) usa
// para los gates: `mapGhIssue` (gh-issue-map.js) ya reconstruye el slice
// desde el ISSUE — el dispatcher (/ct-next) no abre el spec — y allí extrae
// la sección "## E2E" del body a un array, `slice.e2eRuns`. Cuando ese campo
// está definido (el camino real de despacho) se usa tal cual; solo se cae a
// `resolveE2e(slice.e2e).runs` —la celda cruda de la tabla §9, con comas
// escapadas— cuando NO lo está, que es el camino de /ct-groom (lee el spec
// directamente) o de un slice de test construido a mano.
//
// El resultado es SIEMPRE un array, nunca `undefined`: un slice sin
// recorridos da `[]`, el mismo criterio que `blocked: null` en state.js — un
// campo ausente sería indistinguible de una versión del plugin que todavía
// no supiera rellenarlo.
function resolveE2eRunsForAgent(slice) {
  return slice.e2eRuns !== undefined ? slice.e2eRuns : resolveE2e(slice.e2e).runs
}

export function renderKickoff(slice, { repo, dispatchCheckPath, ctStepPath, conventionsDir, base }) {
  // `dispatchCheckPath` y `ctStepPath` van dentro de comandos que el agente
  // EJECUTA: si el llamador los omite, el fallo es ruidoso (un comando que no
  // arranca). `conventionsDir` en cambio solo se interpola en una frase de
  // prosa — omitido, produciría "los cuatro documentos de undefined" y nadie
  // lo vería fallar. Se cierra la asimetría en el origen: sin este dato no
  // hay kickoff, y el error es de quien llama (ct-next.mjs debe resolverlo
  // como ruta absoluta, igual que sus dos hermanas), no de renderKickoff.
  if (!conventionsDir) {
    throw new Error(
      'renderKickoff: falta conventionsDir — fallo de cableado del llamador (ct-next.mjs), no del kickoff.'
    )
  }
  const addendum = ADDENDA[slice.type] || ''
  // F21 — LOS GATES, POR FIN SEPARADOS DEL TIPO. `resolveGatesForAgent` (ver
  // gates.js) prefiere lo que DECLARA el issue (sus labels `gate:`, que es lo
  // que sobrevive a un redespacho) y solo cae al `Tipo` para issues anteriores
  // a esta ronda. Las líneas de gate van justo después del addendum y ANTES
  // del bloque de cierre del PR, no al final: son la condición para que ese
  // cierre pueda ocurrir.
  const gateLines = renderGateKickoffLines(resolveGatesForAgent(slice))
  // TAREA 9 — los recorridos, NOMBRADOS literalmente. `gateLines` ya dice
  // "atraviesa los recorridos que trae la sección ## E2E de tu issue"
  // (gates.js#GATES.e2e), así que aquí NO se repite esa prosa: solo se
  // listan los recorridos tal cual y se los ata al comando que cierra el
  // paso (`ct-step e2e`, que es el que ct-step.mjs espera — ver
  // ct-step.mjs:221 y el brief de esta tarea). Cuando no hay ninguno, esta
  // línea no se añade — ni una sección vacía ni un "no aplica": el .filter(Boolean)
  // de más abajo la descarta.
  const e2eRuns = resolveE2eRunsForAgent(slice)
  const e2eLine = e2eRuns.length
    ? `Recorridos e2e de este slice (ejecútalos tal cual, ni uno más ni uno menos): ${e2eRuns.map((r) => `"${r}"`).join('; ')}. Al terminarlos, cierra el paso con \`ct-step e2e\` — es el comando que registra el veredicto, no una descripción.`
    : ''
  return [
    `Estás implementando UN slice (${slice.name}) del repo ${repo}, issue ${issueRefOf(slice)}${orderSuffixOf(slice)}.`,
    // F32 — las dos prohibiciones nuevas viven AQUÍ y no solo en los skills
    // forkados, porque el kickoff es el único texto que el agente despachado
    // lee SEGURO (la costura 3 de finishing-a-development-branch impone lo
    // mismo, pero solo si el agente llega a invocar ese skill). "NO crees
    // worktrees nuevos" existe porque using-git-worktrees viaja en el fork y
    // le diría que se cree uno: el aislamiento ya lo puso el dispatcher. El
    // "al terminar deja el PR listo y PARA" que cerraba esta línea se fue a
    // cambio: lo dice ya, con el comando literal, la línea de cierre de abajo.
    `Es human-gated: NO mergees el PR (el merge es de la sesión coordinadora), NO empieces el siguiente slice, y NO crees worktrees nuevos — ya estás en el que te preparó el dispatcher.`,
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
    `Hidrátate de ${SLICE_REL_PATH} y del issue de GitHub; los criterios de aceptación son ${slice.ac.join(', ') || '(ver issue)'}. Lee además la sección "## Out of scope / Protected" del issue: lo que hay ahí NO se toca, aunque parezca parte del trabajo.`,
    // Mismo criterio que la línea de "Out of scope / Protected", justo encima,
    // y por los mismos dos motivos: se NOMBRAN las secciones y no se interpola
    // su texto —es prosa de longitud arbitraria y esto se teclea entero en un
    // pty—, y se enumeran en vez de confiar en "hidrátate del issue", porque
    // lo que se enumera se lee y lo que se deja a "ya lo verá" compite con el
    // resto del cuerpo.
    //
    // La frase final cubre los dos casos distintos en que no hay nada que
    // leer: la sección está y está vacía, o no está en absoluto (un issue
    // creado antes de que estas secciones existieran nunca recibe la
    // heredada). Sin ella, un agente que no encuentra lo que se le acaba de
    // nombrar lo busca fuera del issue, que es justo lo que no puede hacer.
    `Lee también las secciones "${EPIC_CONTEXT_HEADING}" y "${INHERITED_CONTEXT_HEADING}" del issue: traen lo que el spec y los slices ya mergeados condicionan sobre este trabajo y que no cabe en los criterios de aceptación. Si alguna está vacía o no aparece, no hay nada que heredar — no lo busques fuera del issue.`,
    `Lee también la sección "${FROZEN_DECISIONS_HEADING}" del issue: son decisiones del epic con consecuencia sobre este trabajo, que DEBES respetar (no las reinterpretes ni las cambies) y que van a "## 2. Closed decisions" de tu plan. Si no aparece, no hay ninguna — no la busques fuera del issue.`,
    // Slice 10 — la señal, NOMBRADA cuando el issue la declara: "ninguna
    // exigencia que el spec le haga al agente puede depender de que el agente
    // lea el spec" — sin esta línea, el juez de slice exigiría lo que al
    // implementador nadie nombró. Condicional como las líneas de gate: con
    // exención razonada o sin declaración, NINGUNA línea (nada que exigir; el
    // silencio cuando no hay nada que decir es lo que mantiene útiles a las
    // líneas que sí salen). El discriminador es parseSenalCell, el MISMO del
    // groom — no una segunda lectura de la celda que pueda divergir.
    parseSenalCell(slice.senal || '').kind === 'senal'
      ? 'Este slice declara una SEÑAL DE OBSERVABILIDAD (sección "## Señal de observabilidad" del issue): lo que esa señal promete tiene que emitirlo el código de PRODUCCIÓN de este slice, instrumentado como ya instrumenta este repo y sin labels de cardinalidad ilimitada — el juez del slice entero lo comprueba contra el diff acumulado antes del PR.'
      : '',
    // F32 — el modelo de dos niveles (§4.3 del handoff): nivel epic = CT,
    // nivel slice = los skills FORKADOS en este plugin (control-tower-loop:*,
    // ver skills/FORK.md) — nunca el namespace superpowers:, que la tarea 6
    // desinstala. El plan del slice se escribe AQUÍ y no en el spec porque se
    // escribe contra el código real, en el momento correcto; el issue trae
    // los AC (EARS), "Protegido" y el "Contexto del epic" — exactamente la
    // entrada que writing-plans pide como spec. Y con el plan commiteado, la
    // conducción ya NO es de subagent-driven-development: en este fork D-4
    // está tomada — la secuencia la dicta ct-step, la máquina consultada. La
    // línea de abajo es el enchufe que `d4-sigue-siendo-de-jose.test.js`
    // guardaba, y ese test se borró en el mismo commit que esta línea, como
    // su propia cabecera pedía. `ctStepPath` llega resuelto como ruta
    // absoluta desde ct-next.mjs, por el mismo motivo que `dispatchCheckPath`
    // (el token ${CLAUDE_PLUGIN_ROOT} no existe en un prompt de texto plano).
    // §7 del diseño: el plan se escribe ANTES de que ct-step exista en el ciclo,
    // así que si la vara de ct sólo se pegara en el task brief el plan saldría
    // sin ella — y un plan que la ignora deja al implementador entre el veto del
    // juez y el del control de alcance. Aquí es donde alcanza al que planifica.
    // La del REPO ya le llegaba: la skill le manda arrancar de
    // `.agent/conventions.md` y seleccionar en §3.
    `Antes de escribir el plan, LEE la vara de ct: los cuatro documentos de ${conventionsDir} (code.md, decisions.md, architecture.md, testing.md). El programa se los pega al implementador y al juez en cada tarea, así que un plan que no las respete produce tareas que el juez va a bloquear. TIENEN PREFERENCIA sobre las convenciones de este repo, y la preferencia se mide regla a regla, no por tema: donde una regla del repo manda lo que uno de esos documentos prohíbe, o prohíbe lo que uno de esos documentos manda, no aplica; donde el repo habla de algo de lo que ninguno habla —mayúsculas, prefijos, nombres de fichero—, obliga entera y la sigues. La vara del repo no desaparece: la sigues seleccionando en el \`Rules to obey:\` de §3 como hasta ahora.`,
    `Y una de ellas decide cómo reparten trabajo tus tareas: \`architecture.md\` rige los MÓDULOS NUEVOS. Un módulo que ya existía y no cumple es deuda declarada del repo —lo que le añadas sigue el estilo de su anfitrión y eso no es hallazgo—, pero un concepto nuevo es un módulo nuevo y nace cumpliendo. De qué lado cae cada cosa lo decides tú al repartir \`**Files:**\` entre \`(create)\` y \`(modify)\`.`,
    `Primer acto, con el baseline verde: escribe el plan del slice con control-tower-loop:writing-plans-prescriptive usando el issue como spec (sus AC, "Protegido", "${EPIC_CONTEXT_HEADING}" y "${FROZEN_DECISIONS_HEADING}" son la entrada que la skill pide; vuelca cada decisión congelada en "## 2. Closed decisions" del plan — son del epic y las DEBES respetar, no reinterpretar). SOLO bloques esenciales, cada uno con su etiqueta de rol: contratos, call sites y el tramo que cambia — los cuerpos de los módulos y los ficheros de test los escribe el implementador con TDD, y la configuración se describe en prosa. Guárdalo como docs/superpowers/plans/YYYY-MM-DD-issue-${slice.n}-<slug>.md, valídalo con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --check-plan\` hasta exit 0, y commitéalo: viaja en el PR, y el --release del final se negará (exit 6) sin un plan válido commiteado.`,
    `Con el plan commiteado y el gate 'plan' con OK humano, la implementación NO la conduces con subagent-driven-development ni con su ledger: la secuencia la dicta la máquina. Pregunta el paso con \`node ${ctStepPath} next --plan docs/superpowers/plans/<el-plan-que-commiteaste>.md --issue ${slice.n}\` y obedece LITERALMENTE lo que imprima en cada paso (donde diga \`ct-step\`, es \`node ${ctStepPath}\`): despacha el implementador como subagente con la rúbrica y el brief que te indique, luego \`ct-step report\`, \`ct-step controls\`, despacha el juez como subagente ct-judge (declarado sin Bash), \`ct-step verdict\` y \`ct-step commit\` — comitea ct-step, nunca tú ni el implementador. Tras el commit de la última tarea quedan dos pasos más, que \`next\` también dicta: \`ct-step global\` (la Global verification del plan la ejecuta el programa, no un agente) y el juicio del slice entero — despacha ct-slice-judge como subagente (declarado sin Bash) y entrega su JSON con \`ct-step slice-verdict\`. Vuelve a \`next\` tras cada paso hasta "run delivered".`,
    addendum,
    ...gateLines,
    e2eLine,
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
    // F7: el agente despachado es el principal ESCRITOR de su fichero de
    // estado, y hasta ahora no tenía forma de decir "esto no puede continuar"
    // salvo prosa dentro de `next_action` — que la siguiente sesión lee como
    // una orden vigente. El campo existe; hay que nombrárselo aquí o no lo usará.
    `Si el trabajo queda BLOQUEADO (no puedes continuar, y no es solo "no terminado"), márcalo en ${SLICE_REL_PATH} como \`blocked: {reason: "por qué", unblock: "qué haría falta"}\` — NO en prosa dentro de next_action. El hook de SessionStart lo anuncia y suspende el next_action en la siguiente sesión.`,
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
    `Al acabar: commit refs al issue, actualiza ${SLICE_REL_PATH}, abre el PR contra ${baseRefOf(base)} con \`Closes #${slice.n}\` en el CUERPO del PR (no en el título, no en un comentario), libera el claim con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --release\`, deja el estado mergeable y PARA.`,
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

// renderStateGates: el valor del campo `gates` del SLICE.md sembrado. Una
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

// renderStateSenal (Slice 10): el valor del campo `senal:` — el texto de la
// sección del issue, verbatim (señal o exención `N/A — <razón>`, tal cual: el
// lector distingue la exención solo por su prefijo), o SENAL_AUSENTE cuando
// el issue no declara nada. Nunca un hueco: la ausencia se declara, no se
// omite — ver el comentario de SENAL_AUSENTE.
function renderStateSenal(senal) {
  return (senal || '').trim() || SENAL_AUSENTE
}

export function buildStateSeed(slice, { branch, base, baseSha = '' }) {
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
      // observable decía quién era quién: el `.agent/STATE.md` de la raíz
      // habla del epic, el estado del worktree —desde F22, `.agent/SLICE.md`—
      // habla del slice, y el reparto solo estaba
      // escrito dentro del kickoff — un prompt que recibió UNA de las dos y
      // que se pierde con el contexto de esa sesión. Una sesión despachada
      // que se re-hidrata de su estado (un /clear, una reanudación, un
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
      // senal (Slice 10) — MISMO ARGUMENTO QUE `gates` (F21): lo que tiene
      // que sobrevivir a una re-hidratación es un CAMPO, no una frase dentro
      // de un prompt que se pierde con el contexto de su sesión. Se siembra
      // SIEMPRE (texto verbatim del issue, o SENAL_AUSENTE — la ausencia se
      // declara, no se omite). Sus lectores: ct-step, que lo pega como
      // primera sección del paquete del juez de slice —leído del disco, sin
      // agente en medio, la doctrina del §3.3— y el propio agente al
      // re-hidratarse.
      senal: renderStateSenal(slice.senal),
      // e2e (TAREA 9) — los recorridos que declara la columna E2E del spec. A
      // diferencia de `gates` (texto legible, y de la que su propio comentario
      // de arriba avisa que "ningún código del plugin decide nada con este
      // campo") ESTE campo SÍ lo lee un programa: `ct-step` lo necesita
      // porque no habla con GitHub — lee esta semilla y lo pasa como
      // `e2eRuns` a `newRun` (ct-step.mjs:221). Por eso es una LISTA y no una
      // frase: un programa no analiza prosa.
      //
      // Y por eso mismo `dispatch-check --release` NO se fía de él: este
      // fichero es agent-reachable (lo puede editar el propio agente
      // despachado). La semilla es el canal de trabajo; la prueba de verdad
      // se hace contra el issue (Tarea 10).
      //
      // Resuelto con `resolveE2eRunsForAgent` (arriba), que prefiere
      // `slice.e2eRuns` — lo que trae el ISSUE, vía mapGhIssue — y solo cae a
      // la celda cruda del spec cuando el slice no vino de un issue. Ausente
      // o vacío da `[]`, nunca `undefined`.
      e2e: resolveE2eRunsForAgent(slice),
      status: 'not_started',
      branch,
      base,
      // ------------------------------------------------------------------
      // `base_sha` (slice 1 de los apuntes de Capde) — EL SHA DEL CORTE, EN
      // UN CAMPO QUE NADIE REESCRIBE.
      //
      // Es el SHA exacto al que apuntaba `origin/<base>` cuando ct-next cortó
      // este worktree (`git rev-parse --verify --quiet origin/<base>^{commit}`,
      // ct-next.mjs:1676, justo después del fetch que demuestra que la ref
      // existe). Recibe el MISMO valor que `last_commit` aquí abajo, y aun así
      // tiene que ser un campo aparte: `last_commit` es del guard de cierre de
      // turno y el agente lo SOBREESCRIBE en cada commit de trabajo — por
      // diseño, ver state.js ("`last_commit` se entiende como el último commit
      // DE TRABAJO"). O sea que el único rastro del corte que hoy se siembra
      // desaparece del fichero en el primer commit del slice.
      //
      // `base_sha` no lo reescribe NADIE después del despacho: ningún verbo de
      // ct-step, ningún hook, y el mensaje del guard de cierre que le pide al
      // agente refrescar su estado enumera los campos a tocar (you_are_here,
      // next_action, tasks[], last_commit) sin nombrarlo (state.js:617).
      //
      // Y `base` no sirve para esto: `base` es un NOMBRE DE RAMA (`develop`,
      // nunca `origin/develop` ni un sha) porque de ahí sale el `--base` de
      // `gh pr create`. Resolver ese nombre más tarde, dentro del worktree,
      // apunta a la copia LOCAL de la rama — que es exactamente lo que midió
      // el diff de `dispatch-check --release` en la corrida del slice 10, con
      // el `main` local 7 commits por detrás de su remoto.
      //
      // LA AUSENCIA SE OMITE, no se declara vacía: si ct-next no pudo resolver
      // `origin/<base>` a un sha (ct-next.mjs:1679) el campo no aparece en el
      // YAML y quien lo lea cae a su propio fallback. Es una asimetría
      // deliberada con `last_commit`, que sí se siembra `""`: a `last_commit`
      // lo lee `describeStopRelation`, que ya distingue el vacío ("unset",
      // callar) de un valor; a `base_sha` lo leerá un regex sobre el TEXTO del
      // fichero, y un campo presente con el valor vacío es un campo que afirma
      // tener un valor. El campo que no está no engaña a nadie.
      ...(baseSha ? { base_sha: baseSha } : {}),
      // F22: el sha de la base, NO el nombre de la rama. Con el campo vacío
      // —lo que se sembraba hasta ahora— `describeStopRelation` devuelve
      // `unset` y `classifyStopState` sale en silencio: el hook `Stop` que
      // obliga a refrescar el estado en cada turno quedaba DESARMADO durante
      // toda la vida del slice. Medido en campo: 21 horas y 7 commits con la
      // semilla intacta.
      //
      // Y tiene que ser un SHA, no `main`: un nombre de rama es un blanco
      // móvil, y en cuanto la base avanzara el conteo de "commits por encima
      // de tu last_commit" dejaría de significar nada. Si no se pudo resolver,
      // se siembra vacío a propósito — un sha inventado sería peor que ninguno.
      last_commit: baseSha,
      // D-4 — el epic, sembrado en el despacho y no preguntado en cada run.
      // La ausencia se DECLARA con la constante que ya existe, no se rellena
      // ni se deja vacía: es la misma regla que impidió que ct-next asumiera
      // `main` en silencio cuando no conocía la base. Su lector es la
      // telemetría de ct-step, que agrega por epic.
      epic: slice.epic || NO_MILESTONE_KEY,
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
