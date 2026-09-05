// ============================================================================
// STEP-CONTRACTS — lo que cruza la frontera entre la sesión y sus subagentes.
//
// La sesión despacha un implementador y un juez; lo que vuelve de ellos son
// ficheros. Este módulo dice qué se acepta como respuesta y qué escribe el
// plugin, y es PURO: no lanza procesos, no lee disco.
//
// Antes esto construía además el argv de `claude -p` —el conductor-programa que
// hacía las dos llamadas él mismo—, y eso se fue con D-4: la decisión de que el
// orquestador deje de ser una sesión de chat está aplazada y su dueño es José.
// Lo que sobrevive es la parte que vale igual con un subagente al otro lado: el
// ESQUEMA de lo que se acepta.
//
// Y el esquema importa más ahora, no menos. Con `claude -p` lo imponía el
// binario (`--json-schema`, que sólo existe en modo `--print`); con un subagente
// lo impone esta validación, y un veredicto que no cumple es un descarte — se
// vuelve a preguntar en vez de interpretar hacia el lado que convenga.
// ============================================================================

import { findClosingKeywords } from './closing-keywords.js'
import { OUTCOMES } from './run-machine.js'
// `node:crypto` no rompe el «módulo PURO» de la cabecera, y el precedente está
// escrito en go-response.js: `createHash` es una función determinista de su
// argumento —sin disco, sin red y sin reloj—, «lo mismo que un String.trim más
// caro».
import { createHash } from 'node:crypto'

export const SEVERITIES = ['high', 'medium', 'low']

// Las nueve reglas de la rúbrica del juez, en el orden en que la recorre (la
// rúbrica en sí se escribe en una tarea posterior de este mismo plan; aquí
// sólo se fija el vocabulario). Enum CERRADO, y no por la validación por la
// validación: la telemetría cuenta hallazgos por regla (`findings_by_rule` en
// run-metrics.js), y una regla inventada por el juez convertiría esa cuenta en
// ruido. Un `rule` que no está aquí descarta el veredicto igual que ya
// descarta un `ruling` inventado — el descarte no es un error, es "vuelve a
// preguntar": un hallazgo que no encaja en ninguna regla es un hallazgo que el
// juez no ha sabido justificar.
//
// El noveno entra DETRÁS de `alcance` y no intercalado entre los ítems de
// test: el orden de este array ES el orden en que el juez recorre la rúbrica
// —`reglasDelAgente()` lo ata encabezado a encabezado en
// step-contracts.test.js—, así que meterlo en medio renumera seis encabezados
// de `ct-judge.md` sin cambiar nada que se pueda medir.
//
// `test-desiderata` juzga los tests NUEVOS de la tarea como instrumento
// (determinista, aislado, y que verifique comportamiento real) y bloquea sólo
// con esas tres; lo demás avisa en `low` y nunca en `medium`, porque un
// `medium` compra una vuelta pagada al implementador sobre una tarea cuya
// suite ya está verde. Es el único ítem cuya vara NO la pone el plan: las tres
// son propiedades de un test, no gusto del repo, así que no puede volver
// `sin-vara` — un noveno ítem que en un repo sin convenciones saliera siempre
// sin vara inflaría justo la columna (`rubric_sin_vara`) que se añadió para
// medir si la vara llega. Los tests PREEXISTENTES debilitados siguen siendo de
// `manipulacion-tests`: un assert relajado en un test que ya existía es UN
// defecto y no dos, y duplicarlo falsearía `findings_by_rule`.
export const VERDICT_RULES = [
  'objetivo', 'asercion-tdd', 'contrato', 'decisiones-cerradas',
  'patrones', 'manipulacion-tests', 'fixture-theater', 'alcance',
  'test-desiderata',
]

// La rúbrica del juez de SLICE (§3.7-B del handoff
// docs/prompt-juez-lo-que-queda.md), TRES ítems y no nueve — el argumento es el
// mismo que ya cerró `boundaries` y `rollout` como absorbidos: todo lo que se
// añade compite por la atención del juez, y `agents/ct-slice-judge.md` no
// hereda ninguno de los nueve de `ct-judge.md` (ésos son por-tarea: marcadores,
// brief, paquete stageado de UNA tarea; aquí el sujeto es el slice entero, ya
// comiteado). Los dos primeros son exactamente los dos agujeros que §3.7
// nombra:
//
//   `estado-final`  — si las tareas juntas entregan el `### Desired end
//     state` del plan. Nadie lo miraba: el juez de tarea tiene ese mismo
//     texto en el brief y una línea que dice explícitamente que NO es su
//     vara (decisión cerrada del §4 del handoff, que este ítem no reabre).
//   `coherencia`    — si una tarea posterior deshace lo que estableció una
//     anterior, o si las tres dejan andamiaje de un estado intermedio que
//     alguna debía retirar. `ct-judge` juzga UNA tarea; esto no lo miraba
//     nadie.
//
// `observabilidad` (Slice 10, §3.9) es el tercero, y entra DETRÁS — el mismo
// argumento con el que `test-desiderata` entró noveno en VERDICT_RULES: el
// orden del array ES el orden del recorrido, los encabezados de la rúbrica
// están atados por test, e intercalarlo renumeraría sin medir nada. Mide las
// tres comprobaciones del §3.9 sobre la SEÑAL que la slice declaró (sección
// `## Señal` del paquete, pegada por el programa desde el SLICE.md del
// despacho) contra el diff ACUMULADO: que lo prometido lo emita código de
// producción, con la instrumentación que EL REPO ya usa, sin labels de
// cardinalidad ilimitada. Vive AQUÍ y no en `ct-judge` por tres razones
// cerradas: (a) el sujeto es la señal DE LA SLICE — una tarea puede
// legítimamente no emitirla porque la emite la siguiente, y el único diff con
// el sujeto completo es el acumulado, que solo ve este juez; (b) el argumento
// del §3.6: todo ítem compite por la atención, y `ct-judge` ya recorre 9 por
// CADA tarea y reintento mientras aquí son 3 una vez por slice; (c) es donde
// lo tiene `agentic-skills` (su ítem 9 juzga la slice entera). No se absorbe
// en `estado-final` porque mide OTRA fuente (la señal declarada, no el
// `### Desired end state`) con su propio `no-aplica`/`sin-vara`, y la
// telemetría necesita contarlo por regla.
//
// Mismo enum CERRADO que VERDICT_RULES, y por el mismo motivo: la telemetría
// cuenta hallazgos por regla, y una regla inventada por este juez ensuciaría
// esa cuenta igual que ensuciaría la del juez de tarea.
export const SLICE_VERDICT_RULES = ['estado-final', 'coherencia', 'observabilidad']

// Lo que un ítem del recorrido pudo hacer. El recorrido ya distinguía "no se
// miró" de "se miró", pero dentro de "se miró" seguía habiendo dos cosas que
// se leían igual, y una de ellas es un agujero:
//
//   `no-aplica` — el ítem no tiene SUJETO. No hay tests previos que debilitar,
//     no hay símbolos que comparar, la tarea es prosa. Es la rúbrica
//     funcionando: no hay nada que mirar y se dice.
//   `sin-vara`  — el ítem tiene sujeto pero le falta el INSUMO con el que
//     medirlo. El plan no nombró ningún patrón, o la sección que tenía que
//     llegar en el brief no llegó. El juez no juzgó: juzgó a ciegas.
//
// Sin este campo las dos salen como un `result` en prosa que nadie agrega, y
// `patrones: N/A` es indistinguible de `patrones: conforme`. Es la mitad de H5
// del informe de la corrida en repo ajeno, y la razón por la que dos personas
// mirando veredictos a mano sospechaban que el juez no miraba: no había forma
// de saberlo. `run-metrics.js` cuenta los `sin-vara` por intento, así que el
// agujero pasa de sospecha a columna.
//
// Enum CERRADO por el mismo motivo que VERDICT_RULES: lo que no se puede contar
// no se puede leer, y un cuarto valor inventado por el juez convierte la cuenta
// en ruido.
export const RUBRIC_OUTCOMES = ['conforme', 'no-aplica', 'sin-vara']

// El veredicto: el fallo, el RECORRIDO de la rúbrica y los hallazgos. La
// severidad es lo que separa un veto de un refunfuño, y el resto de la prosa
// del juez no la lee ningún programa.
//
// Cada hallazgo lleva además su REGLA: cuál de las nueve de la rúbrica incumple.
// Antes de esto un hallazgo decía severidad, qué y dónde, pero no POR QUÉ es un
// hallazgo — y sin eso, la telemetría no puede contar cuántos vetos vienen de
// cada regla, que es justo el dato que dice si la rúbrica está bien calibrada.
//
// Y `rubric` es el paseo por los nueve ítems, cada uno exactamente una vez con
// lo que dio. La rúbrica ya lo pedía, pero lo pedía en PROSA y para la
// respuesta conversacional del subagente, que nadie captura: lo que se validaba
// y se persistía era sólo `{ruling, findings}`. Medido en
// jjponz/rust-monitoring#10, donde los tres veredictos que viajaron
// commiteados en la pull request eran `{"ruling": "PASS", "findings": []}` —
// exactamente el artefacto que la propia rúbrica declara indistinguible de ocho
// ítems que nadie abrió. Lo peor de aquel caso es que el PASS vacío era
// CORRECTO: cuatro de los ocho ítems no tenían sujeto (un esqueleto sobre un
// repo vacío, sin patrones que citar, sin tests previos, sin contratos), y no
// había forma de saberlo leyendo el fichero. El recorrido es lo que distingue
// "no aplicaba, y por esto" de "no se miró"; por eso entra en el esquema y no
// en una línea que nadie valida.
//
// Y cada hallazgo lleva `evidence`: la CITA literal que lo sostiene — la frase
// del plan que se incumple, o la línea del diff que lo prueba. No es `what`
// (que narra el defecto) ni `path`/`line` (que ubican): es el texto que alguien
// puede contrastar sin abrir nada. La rúbrica ya exigía citar antes de bloquear
// ("evidence before blocking"), pero lo exigía en PROSA, en un fichero de
// doscientas cuarenta líneas donde compite con ocho ítems que hay que recorrer
// de verdad. Un campo obligatorio del esquema no se olvida; una frase sí. Y se
// exige en las tres severidades y no sólo en `high`: un campo condicional se
// olvida igual que la prosa, y un `medium` sin cita manda al implementador a
// una vuelta pagada sin decirle qué mirar.
//
// El enum del ítem es el MISMO array VERDICT_RULES, no una copia: dos listas de
// nueve identificadores divergen al primer renombrado, que es el desacople que
// este módulo ya pagó con JUDGE_TOOLS.
//
// Y la ubicación son DOS campos, `path` y `line`, y no la cadena `"path:line"`
// que llevaba hasta aquí. Lo que impedía la cadena es agregar: la telemetría
// cuenta hallazgos por regla (`findings_by_rule`) y no puede contarlos por
// fichero, porque partir por el último `:` una cadena que escribió un modelo es
// adivinar — un `C:\` de Windows, un `a.js:10-14`, un `src/a.js` sin línea y un
// `toda la clase Foo` son la misma cadena para el programa. Es el §3.13 del
// handoff, y es la forma que ya tiene el `Finding` de `agentic-skills`.
//
// `path` es obligatorio y `line` NO, y la asimetría es deliberada: un hallazgo
// del fichero entero (un import que sobra en todo el módulo, un fichero que no
// debería existir) no tiene línea que citar, y exigírsela al juez sólo compra
// dos cosas malas — un número inventado, o un descarte más de los seis que
// matan el run (§3.2). Ausente y `null` son lo mismo. Lo que sí se rechaza es
// una línea que no se puede leer como número: `"12"` y `12` no se agregan
// igual, y tolerar la cadena hoy es telemetría sucia mañana.
// LA FORMA DEL TOKEN, en una constante y no tecleada dos veces. El `pattern` del
// esquema es lo que el objeto DICE de sí mismo —y es el bloque que la rúbrica le
// enseña al juez— y el regex de `readVerdict` es lo que de verdad se aplica: dos
// copias a mano de la misma forma son documentación que puede mentir sin que nada
// se ponga rojo. El resto de campos de `schemaFor` ya derivan de una constante
// compartida (`enum: rules`, `enum: SEVERITIES`, `enum: RUBRIC_OUTCOMES`)
// exactamente por esto, y el slice 11 exportó REVIEW_TOKEN_LABEL para que la
// ETIQUETA no divergiera; la FORMA se quedó fuera de ese criterio.
//
// Vive aquí arriba, lejos del bloque del token, por una razón mecánica:
// VERDICT_SCHEMA se construye al CARGAR el módulo, así que un `const` declarado
// más abajo daría ReferenceError por la zona muerta.
//
// La tercera copia de la forma —la de RE_REVIEW_TOKEN, en el bloque del token— NO
// es una divergencia y no se toca: allí es sólo minúsculas a propósito (es lo que
// `reviewToken` produce) y va dentro de una línea con etiqueta y captura.
const REVIEW_TOKEN_PATTERN = '^[0-9a-fA-F]{64}$'
const RE_REVIEW_TOKEN_FORM = new RegExp(REVIEW_TOKEN_PATTERN)

// FACTORY, no un objeto suelto: el juez de slice valida contra el MISMO
// esquema con otra rúbrica dentro (§3.7-B), y dos copias a mano de esta forma
// divergerían al primer campo añadido — el mismo desacople que ya sufrieron
// JUDGE_TOOLS y VERDICT_RULES. `rules` decide sólo el enum de `rule` y la
// cardinalidad del recorrido; el resto de la forma —`ruling`, `outcome`,
// `evidence`, la ubicación en dos campos— es la misma para un veredicto de
// tarea y uno de slice: es el mismo esquema de RESPUESTA, no una rúbrica
// distinta por dentro.
const schemaFor = (rules) => ({
  type: 'object',
  additionalProperties: false,
  required: ['ruling', 'rubric', 'findings'],
  properties: {
    ruling: { type: 'string', enum: ['PASS', 'FAIL'] },
    // EL TOKEN LO ESCRIBE EL PROGRAMA, no el juez. `ct-step verdict` lo
    // inyecta antes de validar, con el valor que él mismo acaba de calcular
    // del paquete y del corte de ahora, así que aquí NO es obligatorio: un
    // veredicto que no lo trae se acepta. Lo que se sigue rechazando es uno
    // que trae OTRO —defensa en profundidad, por si el fichero es de un juicio
    // anterior— y por eso el campo sigue en el esquema con su forma.
    //
    // Era obligatorio y lo copiaba el juez a mano: 64 hex tecleados por un
    // modelo, y un error de copia descartaba un veredicto entero de opus y
    // gastaba uno de los seis descartes que matan el run. Un valor que el
    // programa conoce no se le pide al modelo.
    review_token: { type: 'string', pattern: REVIEW_TOKEN_PATTERN },
    rubric: {
      type: 'array',
      minItems: rules.length,
      maxItems: rules.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'result', 'outcome'],
        properties: {
          rule: { type: 'string', enum: rules },
          result: { type: 'string' },
          outcome: { type: 'string', enum: RUBRIC_OUTCOMES },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'severity', 'what', 'path', 'evidence'],
        properties: {
          rule: { type: 'string', enum: rules },
          severity: { type: 'string', enum: SEVERITIES },
          what: { type: 'string' },
          path: { type: 'string' },
          line: { type: ['integer', 'null'], minimum: 1 },
          evidence: { type: 'string' },
        },
      },
    },
  },
})

export const VERDICT_SCHEMA = Object.freeze(schemaFor(VERDICT_RULES))
// El esquema del veredicto de SLICE: misma forma, la rúbrica de dos ítems.
export const SLICE_VERDICT_SCHEMA = Object.freeze(schemaFor(SLICE_VERDICT_RULES))

// El informe del implementador también lleva esquema, y el spec no lo pedía.
// La razón es la misma que hizo falta un `plan-tasks.js`: el programa necesita
// las RUTAS que se tocaron para stagearlas, y sacar rutas de un informe en
// prosa es la trampa del §2.5 otra vez, en el otro extremo del bucle.
//
// Aquí hubo un KIND por ruta ('production' o 'test'). La idea era que el
// juez —vía `escribirPaquete` en `scripts/ct-step.mjs`— viera de un vistazo si
// un diff con la suite en verde no tocaba ningún fichero de producción. Se
// quitó: el juez tiene el diff delante y distingue un fichero de test de uno
// de producción sin que nadie se lo diga, así que la etiqueta no le aportaba
// nada que no pudiera ver por sí mismo. La producía además el propio agente al
// que se juzga, no la verificaba nadie, y cuando venía mal no degradaba el
// juicio: lo DESACTIVABA — el ítem de la rúbrica que mira los ficheros de test
// dejaba de mirar un test mal etiquetado. Una capa de indirección entre el
// juez y la evidencia que sólo podía introducir error. No se vuelva a añadir
// sin resolver antes ese problema de raíz.
export const REPORT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['paths', 'summary'],
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
})

export const E2E_VERDICTS = ['verde', 'rojo', 'no-verificado']

// E2E_REQUIRED_BY_VERDICT: lo que cada veredicto exige ADEMÁS de `run` y
// `verdict`. Vive aquí, exportado y en un solo sitio, porque lo consumen DOS:
// `readE2eReport` (más abajo, que valida contra esta tabla) y
// `ct-step.mjs#verboNext` (que se lo dice al agente antes de que escriba el
// informe). Hasta la review final de rama sólo existía dentro de las ramas de
// `readE2eReport`, y `next` anunciaba únicamente `run` y `verdict`: el
// programa instruía al agente con un contrato que él mismo rechazaba, y cada
// slice pagaba al menos una vuelta de DISCARDED — que además sale del
// presupuesto de descartes de la slice entera (MAX_DISCARDS).
//
// `brought_up` es obligatorio en `verde` y en `rojo` (§8.1 del diseño). La
// evidencia de un informe de e2e es falsificable y el diseño lo dice; su ÚNICA
// mitigación es que el comando sea REPRODUCIBLE por un humano ("una salida
// inventada se cae en cuanto alguien la pega"). Un verde que documenta el
// `curl` pero no cómo se puso el sistema en pie NO es reproducible, así que la
// mitigación se evaporaba justo en el camino que importa. En `no-verificado`
// no se exige, y no es una excepción caprichosa: el motivo típico de ese
// veredicto es precisamente que no se pudo levantar.
export const E2E_REQUIRED_BY_VERDICT = Object.freeze({
  verde: Object.freeze(['brought_up', 'evidence']),
  rojo: Object.freeze(['brought_up', 'expected', 'actual', 'repro', 'refuted_by']),
  // El formato de `blocked` (state.js), no el campo: "por qué" y "qué haría
  // falta". Sin las dos, un no-verificado es un encogimiento de hombros que
  // libera el slice sin dejar a nadie sabiendo qué arreglar.
  'no-verificado': Object.freeze(['reason', 'unblock']),
})

// E2E_SCHEMA: lo que se le pide al agente que atraviesa. Declarativo y
// exportado por el mismo motivo que VERDICT_SCHEMA: el prompt lo cita, y dos
// copias a mano de la misma forma divergen (pasó con JUDGE_TOOLS).
//
// `required` es lo que lleva TODA entrada; lo condicional viaja en
// `requiredByVerdict` (la misma constante de arriba, no una copia) porque el
// validador es a mano y una tabla se lee mejor que un `if/then/else` de JSON
// Schema. Que esté DENTRO del esquema importa: quien lo cite —el prompt, el
// `next`— se lleva el contrato entero, no la mitad incondicional.
export const E2E_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['runs'],
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['run', 'verdict'],
        requiredByVerdict: E2E_REQUIRED_BY_VERDICT,
        properties: {
          run: { type: 'string' },
          verdict: { enum: E2E_VERDICTS },
          brought_up: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['command', 'output'],
              properties: { command: { type: 'string' }, output: { type: 'string' } },
            },
          },
          expected: { type: 'string' },
          actual: { type: 'string' },
          repro: { type: 'string' },
          refuted_by: { type: 'string' },
          reason: { type: 'string' },
          unblock: { type: 'string' },
        },
      },
    },
  },
})

// `Skill` está aquí porque la rúbrica del implementador
// (`prompts/task-implementer.md`) ya no lleva el ciclo TDD dentro: manda cargar
// `control-tower-loop:test-driven-development`, la copia que trae el plugin. Sin
// esta herramienta esa primera línea es imposible de cumplir y el implementador
// se queda sin el oficio que la rúbrica delega.
export const IMPLEMENTER_TOOLS = 'Read, Write, Edit, Grep, Glob, Bash, Skill'
// Con qué modelo se despacha. Omitirlo NO es neutral: el subagente hereda el
// modelo de la sesión, que es el más caro, y el implementador es el paso que
// más veces se despacha en un run —una vez por tarea, y otra por cada vuelta
// que le devuelve el juez—. Los tres agentes declarados (`agents/*.md`) fijan
// el suyo en su frontmatter y ahí lo impone el harness; al implementador no se
// le dio fichero propio, así que su modelo viaja por la línea que `ct-step
// next` imprime, y sostenerlo depende de que la sesión la obedezca.
//
// Fijo, y no escalado por complejidad como pide la costura 5 del fork
// (`skills/subagent-driven-development/SKILL.md`, "Model Selection"): esa skill
// ya no conduce aquí —lo dice `scripts/kickoff.js`—, y quien elegiría el tier
// por tarea sería la misma sesión que se ahorra el gasto. El suelo se fija a
// propósito.
export const IMPLEMENTER_MODEL = 'sonnet'
// El juez no puede EJECUTAR, y no es una promesa en prosa: se lo quita la
// declaración del agente (`agents/ct-judge.md`), igual que antes se lo quitaba
// el binario. Tampoco ve la SALIDA de los controles —se le pasan rutas— porque
// un lint sucio no debe ensuciarle el criterio al único agente cuyo valor es el
// juicio.
//
// `Write` SÍ, y no debilita lo anterior: el canal por el que entrega su
// veredicto es un fichero, así que sin `Write` el paso `judge` no se puede
// cerrar —medido en la tarea 1 del slice #5 de repo-pulse, la primera vez que
// este agente juzgó algo—. Lo que podría escribir de más no llega a ninguna
// parte: `ct-step commit` comitea las rutas que declaró el IMPLEMENTADOR, no lo
// que haya en el árbol.
//
// `Skill` SÍ, y por la misma razón por la que la tiene el implementador: la
// rúbrica le manda ejercerla. Desde `e473c97`, el `Rules to obey:` de `## 3.
// Reference patterns` admite declarar una skill como vara secundaria, y el ítem
// `patrones` manda abrirla («any skill named there — open them and read the
// rules»). Pero un nombre de skill (`backend-engineering:backend-best-practices`)
// no es una ruta: `Read` no lo abre, y `plan-contract.js` tampoco lo comprueba en
// disco A PROPÓSITO. Sin esta herramienta la vara secundaria era inalcanzable, y
// en silencio: el juez contestaría `conforme` sobre un documento que nunca pudo
// abrir, que es justo el agujero que `sin-vara` existe para cerrar. Es el defecto
// §3.1 de `docs/prompt-juez-lo-que-queda.md`, y es lo que hace `agentic-skills`
// en su `slice_verifier_judge.py`: TOOLS = ("Read", "Grep", "Glob", "Skill").
//
// No debilita el «sin shell»: `Skill` carga instrucciones, no ejecuta procesos.
// Lo que el juez no puede hacer sigue decidiéndolo la ausencia de `Bash` en la
// declaración del agente.
//
// Esta constante es una COPIA del frontmatter de `agents/ct-judge.md`, y quien
// las ata es `step-contracts.test.js`: se duplica porque este módulo es puro y
// no lee disco, no porque dé igual que divergan. Divergieron una vez, y el
// resultado fue que `ct-step next` anunciaba unas herramientas que no eran las
// del juez que se iba a despachar.
export const JUDGE_TOOLS = 'Read, Grep, Glob, Write, Skill'

// Los tres encabezados del paquete de revisión que escribe `escribirPaquete`
// en `scripts/ct-step.mjs`, en el orden en que aparecen en el fichero. La
// rúbrica del juez (`agents/ct-judge.md`) los cita por su nombre entre
// comillas invertidas en "What you are given" para decirle al juez qué trae
// cada sección — y ese cruce es el mismo desacople que ya sufrieron
// JUDGE_TOOLS y VERDICT_RULES: dos copias a mano de la misma cadena, sin nada
// que las ate. Aquí es peor que con JUDGE_TOOLS porque tampoco hay un error
// de ejecución que lo delate — un encabezado renombrado en el script deja a
// la rúbrica señalando una sección que no existe, y el juez sigue
// contestando como si la hubiera leído.
//
// `Vara de ct` abre el paquete y la escribe `PluginYardstick.composePathSection`
// (scripts/plugin-yardstick.js), no `escribirPaquete`: son las RUTAS de los
// documentos que alcanzan a esta tarea, para un juez que tiene `Read`. Va
// primero por lo mismo que `Señal` en el paquete de slice — detrás de un diff
// `-U10` quedaría enterrada.
export const PACKAGE_SECTIONS = ['Vara de ct', 'Files changed', 'Rutas tocadas', 'Diff']

// El juez de SLICE (§3.7-B, `agents/ct-slice-judge.md`), SIN `Skill`: sus dos
// ítems miden contra el plan (comiteado) y el diff acumulado de la slice
// entera, y ninguno de los dos carga una rúbrica de skill — a diferencia de
// `patrones`/`test-desiderata` en el juez de tarea, aquí no hay vara de repo
// que abrir. Menos herramientas, menos deriva: dárselas «por si acaso» sería
// la misma indirección que ya se quitó del `kind` de `REPORT_SCHEMA`.
//
// Copia del frontmatter de `agents/ct-slice-judge.md`, atada por
// `step-contracts.test.js` con el mismo criterio que `JUDGE_TOOLS`: este
// módulo es puro y no lee disco, así que lo que impide que las dos diverjan
// es el test, no el código.
export const SLICE_JUDGE_TOOLS = 'Read, Grep, Glob, Write'

// El reconciliador (Reconciliación de ramas, Tarea 9, `agents/ct-reconciler.md`)
// invierte la asimetría de los dos jueces de arriba en vez de repetirla:
// `Edit` en lugar de `Write`, y ni `Bash` ni `Write`. Git no da por resuelto un
// fichero en conflicto hasta que alguien corre `git add`, y el único que corre
// ese comando es el programa (`BranchReconciliation.conclude()`,
// `scripts/branch-reconciliation.js`) — nunca el agente. Sin `Write` no puede
// crear un fichero nuevo para rodear un conflicto que no quiso tocar
// directamente, y sin `Bash` no puede stagear, comitear ni abortar la fusión
// por su cuenta. Lo único que puede hacer es abrir los ficheros que git ya
// marcó en conflicto y editar su contenido: la higiene deja de ser una
// comprobación y pasa a ser una propiedad de lo que el agente puede alcanzar.
//
// Copia del frontmatter de `agents/ct-reconciler.md`, atada por
// `step-contracts.test.js` con el mismo criterio que `JUDGE_TOOLS` y
// `SLICE_JUDGE_TOOLS`: este módulo es puro y no lee disco, así que lo que
// impide que las dos diverjan es el test, no el código.
export const RECONCILER_TOOLS = 'Read, Grep, Glob, Edit'

// Los cuatro encabezados del paquete de SLICE que escribe `escribirPaqueteDeSlice`
// en `scripts/ct-step.mjs`: la señal de observabilidad que el issue del slice
// declaró (Slice 10 — PRIMERA porque es la vara del ítem `observabilidad`:
// detrás del diff `-U10` quedaría enterrada), el registro de commits de la
// slice (que no existe en el paquete por tarea, porque una tarea es UN commit
// sin historia propia que mostrar), el resumen de ficheros tocados y el diff
// acumulado desde la base. Mismo cruce que `PACKAGE_SECTIONS`: la rúbrica de
// `agents/ct-slice-judge.md` los cita por su nombre, y sin este test un
// encabezado renombrado deja al juez señalando una sección que no existe — el
// test que los ata obliga a que paquete y agente cambien en la MISMA tarea.
export const SLICE_PACKAGE_SECTIONS = ['Señal', 'Commits', 'Files changed', 'Diff']

// ---------------------------------------------------------------------------
// EL TOKEN DEL PAQUETE — el paquete ata su PRODUCTO, no sólo su insumo.
//
// EL DEFECTO QUE CIERRA. El slice 6 hizo el paquete de un solo uso, así que un
// veredicto no puede volver a gastar un insumo ya gastado. Lo que seguía sin
// atar nada es el otro sentido: NADA ligaba el `verdict.json` al paquete.
// Reproducido en dos vías, las dos MUDAS en la telemetría:
//
//   (a) el veredicto RECICLADO. Tras un veredicto aceptado que devuelve la
//       tarea, el mensaje manda volver a `next` — y no dice «y redespacha al
//       juez». Obedeciendo esa mitad, `next` regenera el paquete y el fichero
//       del juicio ANTERIOR (misma ruta: `task-<N>-verdict.json`) se acepta.
//       Medido: tres filas de juez indistinguibles, `correctionRetries`
//       agotado, y la tarea COMITEADA con el veredicto de otro diff dentro.
//   (b) el HUECO DEL DESCARTE. El descarte por JSON ilegible no consume el
//       paquete —bien: el reintento tiene que poder repreguntar— y eso se
//       justificaba con «el reintento juzga el mismo diff», que es una
//       asunción sobre la conducta del agente. Si el índice cambia en ese
//       hueco, el `PASS` siguiente entra sobre código no revisado.
//
// LA FORMA. El paquete declara en su cabecera el sha256 del DIFF QUE CAPTURÓ;
// el juez lo copia en `review_token`; el verbo del veredicto exige que
// coincidan el del veredicto, el del paquete y el recomputado del corte de ese
// instante. (a) muere porque un veredicto reciclado trae el token de otro
// paquete; (b) muere porque el código cambiado no reproduce el sha capturado.
//
// CONTENT-ADDRESSED Y NO UN NONCE SORTEADO, y la diferencia con el nonce del
// `go` (go-response.js) es la razón: aquél es SECRETO y no adivinable, y su
// propiedad es que el agente no pueda fabricar el permiso. Éste es público y
// derivable —está en el fichero que el juez lee, y cualquiera con shell lo
// recomputa—, así que NO autentica al juez: ata el veredicto a un estado del
// código. Un nonce aleatorio cerraría (a) y no (b) (en el hueco el paquete no
// se regenera, así que el nonce sigue valiendo), y además castigaría al
// obediente: un veredicto reemitido sobre un paquete regenerado con el MISMO
// diff se descartaría por traer el nonce viejo. Con el contenido como
// dirección, «no cambió el código» y «vale el veredicto» son la misma frase.
//
// La ETIQUETA se exporta y el lector se construye con ella: quien escribe la
// línea (`escribirPaquete`), quien la lee (`reviewTokenOf`), las dos rúbricas
// que se la citan al juez y los tests son cuatro copias de la misma cadena, y
// eso es exactamente lo que ya divergió con JUDGE_TOOLS, VERDICT_RULES y
// PACKAGE_SECTIONS. Aquí el fallo sería mudo por partida doble: el juez copia
// de una línea que no existe, y todo veredicto se descarta.
// ---------------------------------------------------------------------------
export const REVIEW_TOKEN_LABEL = 'Review token'

// El token: sha256 hex del texto del diff. Función del ARGUMENTO y de nada
// más — quien decide QUÉ diff es el sujeto es ct-step.mjs, que es quien tiene
// git delante.
export const reviewToken = (diff) => createHash('sha256').update(String(diff ?? ''), 'utf8').digest('hex')

// La línea, en una sola función: la pantalla que se la dicta al juez (la
// rúbrica) y el matcher que la reconoce no pueden divergir en un espacio.
export const reviewTokenLine = (token) => `${REVIEW_TOKEN_LABEL}: ${token}`

// La RegExp se construye con la etiqueta y no se teclea: la etiqueta no lleva
// metacaracteres, así que interpolarla es seguro y ata el lector al escritor.
// Minúsculas y 64 exactos: es lo que `reviewToken` produce, y un paquete cuya
// línea no cumpla eso NO declara ningún token (null), que es lo que el verbo
// trata como «paquete de una versión anterior o editado a mano».
const RE_REVIEW_TOKEN = new RegExp(`^${REVIEW_TOKEN_LABEL}: ([0-9a-f]{64})$`, 'm')
export function reviewTokenOf(textoDelPaquete) {
  const m = RE_REVIEW_TOKEN.exec(String(textoDelPaquete ?? ''))
  return m ? m[1] : null
}

const esTexto = (v) => typeof v === 'string' && v.trim() !== ''

// Validación a mano y no con una librería de esquemas: el spec exige cero
// dependencias nuevas, y lo que hay que comprobar cabe en veinte líneas.
//
// `rules` es el segundo parámetro, no un módulo aparte: el veredicto de tarea
// y el de slice comparten TODA esta validación —esquema, cardinalidad,
// coherencia PASS/high— y sólo difieren en qué enum de `rule` aceptan y
// cuántos pasos exige el recorrido. Parametrizar es lo que evita una segunda
// función que copiara estas veinte líneas y divergiera en el primer arreglo
// que se aplicara a una sola de las dos.
export function readVerdict(structured, rules = VERDICT_RULES) {
  if (!structured || typeof structured !== 'object') return { why: 'el juez no devolvió structured_output' }
  const { ruling, rubric, findings, review_token: token } = structured
  if (ruling !== 'PASS' && ruling !== 'FAIL') return { why: `ruling desconocido: ${JSON.stringify(ruling)}` }
  if (!Array.isArray(findings)) return { why: 'findings no es una lista' }
  for (const [i, f] of findings.entries()) {
    if (!f || typeof f !== 'object') return { why: `el hallazgo ${i} no es un objeto` }
    if (!SEVERITIES.includes(f.severity)) return { why: `el hallazgo ${i} tiene una severidad desconocida: ${JSON.stringify(f.severity)}` }
    if (!esTexto(f.what) || !esTexto(f.path)) return { why: `el hallazgo ${i} no dice qué o dónde: hacen falta 'what' y 'path'` }
    // `line` es opcional y `null` vale: un hallazgo del fichero entero no tiene
    // línea, y exigirla sería pedir un número inventado o gastar un descarte de
    // los seis que matan el run. Lo que no vale es una línea que no es un
    // número: la cadena `"12"` pasa el `typeof` y rompe cualquier agregación.
    if (f.line !== undefined && f.line !== null && !(Number.isInteger(f.line) && f.line > 0)) {
      return { why: `el hallazgo ${i} trae una línea que no es un número: ${JSON.stringify(f.line)} — un entero, o null (u omitida) si el hallazgo es del fichero entero` }
    }
    // La cita, con el mismo trato que el qué y el dónde: sin ella el hallazgo
    // no se puede contrastar, y un veto que no se puede contrastar es el veto
    // defensivo que la calibración de la rúbrica existe para impedir.
    if (!esTexto(f.evidence)) return { why: `el hallazgo ${i} no cita la evidencia que lo sostiene` }
    // La regla es el enum CERRADO: no se asume ninguna por defecto, porque una
    // regla inventada por el juez ensuciaría el conteo por regla de la
    // telemetría tanto como un `rule` ausente.
    if (!rules.includes(f.rule)) return { why: `el hallazgo ${i} incumple una regla desconocida: ${JSON.stringify(f.rule)}` }
  }
  // El recorrido de la rúbrica, con el mismo criterio que el `rule` de un
  // hallazgo: enum CERRADO y descarte, no interpretación. Aquí el descarte
  // cubre además la CARDINALIDAD, que en un hallazgo no aplica — la rúbrica se
  // recorre entera y se contesta entera, así que un recorrido corto, uno con un
  // ítem repetido y uno con un identificador que nadie reconoce son el mismo
  // fallo: un veredicto del que no se puede afirmar que la rúbrica se recorrió.
  if (!Array.isArray(rubric)) return { why: 'el veredicto no trae el recorrido de la rúbrica' }
  const recorridos = []
  for (const [i, paso] of rubric.entries()) {
    if (!paso || typeof paso !== 'object') return { why: `el paso ${i} del recorrido no es un objeto` }
    if (!rules.includes(paso.rule)) return { why: `el recorrido nombra un ítem desconocido de la rúbrica: ${JSON.stringify(paso.rule)}` }
    // Un ítem nombrado sin resultado son los identificadores sin nada
    // detrás: el mismo PASS vacío de rust-monitoring#10, sólo más largo.
    if (!esTexto(paso.result)) return { why: `el ítem ${paso.rule} del recorrido no dice lo que dio` }
    // El resultado en prosa dice lo que dio; `outcome` dice de qué CLASE fue,
    // que es lo único agregable. Sin él, "no había con qué medir" y "medí y
    // está bien" son el mismo dato.
    if (!RUBRIC_OUTCOMES.includes(paso.outcome)) return { why: `el ítem ${paso.rule} del recorrido no dice de qué clase fue su resultado: ${JSON.stringify(paso.outcome)}` }
    if (recorridos.includes(paso.rule)) return { why: `el recorrido repite el ítem ${paso.rule} de la rúbrica` }
    recorridos.push(paso.rule)
  }
  const sinRecorrer = rules.filter((regla) => !recorridos.includes(regla))
  // El número sale del array y no de la prosa: el noveno ítem dejó obsoleto de
  // golpe un "ocho" escrito a mano, y este `why` es el texto que el juez lee
  // para volver a contestar tras un descarte.
  if (sinRecorrer.length) return { why: `el recorrido no pasa por ${sinRecorrer.join(', ')}: la rúbrica son ${rules.length} ítems y se contestan los ${rules.length}` }
  // La coherencia que el original comprueba en el propio agregado: un PASA con
  // un hallazgo grave se contradice a sí mismo. No se "interpreta" hacia el
  // lado prudente — se descarta y se vuelve a preguntar, porque un juez que no
  // se entiende a sí mismo no ha juzgado.
  if (ruling === 'PASS' && findings.some((f) => f.severity === 'high')) {
    return { why: 'un PASS con un hallazgo de severidad high contradice la rúbrica: un hallazgo grave es FAIL' }
  }
  // EL TOKEN DEL PAQUETE, copiado — y LA ÚLTIMA de las comprobaciones a
  // propósito. Las de arriba deciden si esto es un veredicto; ésta decide de
  // QUÉ es. Un recorrido incompleto o un ruling inventado tienen que seguir
  // leyendo el `why` de su propio defecto: es el texto con el que el juez
  // vuelve a contestar, y adelantarla lo mandaría a arreglar el campo
  // equivocado.
  //
  // Se acepta en mayúsculas y se devuelve en minúsculas, con el precedente
  // literal de `matchesGo`: quien copia un hex de 64 caracteres puede
  // reformatearlo, y «el peor rato de todos es teclear el permiso correcto y
  // que no pase nada». Lo que este módulo NO puede decidir es si el token es
  // EL DEL PAQUETE: eso exige leer el paquete y volver a medir el corte, y lo
  // hace ct-step.mjs (`tokenVigente`).
  // AUSENTE VALE, porque quien lo escribe es el programa: `ct-step verdict` lo
  // inyecta con el valor que acaba de calcular antes de llamar aquí, así que
  // en el camino real este campo llega siempre. Un veredicto que llega hasta
  // aquí sin él es uno que nadie ató a ningún corte, y quien puede decidir eso
  // no es este módulo (no lee el paquete): se devuelve `null` y lo resuelve
  // ct-step, que es el que compara.
  //
  // Lo que sigue descartándose es un token con FORMA de token que no lo es:
  // una cadena que no son 64 hex no se puede comparar con nada, y tolerarla
  // sería telemetría sucia mañana.
  if (token === undefined || token === null) {
    return { verdict: { ruling, rubric, findings, review_token: null } }
  }
  if (typeof token !== 'string' || !RE_REVIEW_TOKEN_FORM.test(token)) {
    return { why: `el veredicto trae un "${REVIEW_TOKEN_LABEL}" que no tiene su forma (64 hex): ${JSON.stringify(token)}. El programa escribe ese campo por su cuenta, así que no hay nada que copiar — un valor que no es un token sólo puede venir de otro sitio` }
  }
  return { verdict: { ruling, rubric, findings, review_token: token.toLowerCase() } }
}

// El veredicto del SLICE entero (§3.7-B): misma validación, la rúbrica de
// `agents/ct-slice-judge.md`. Una función con nombre propio y no una llamada
// suelta a `readVerdict(x, SLICE_VERDICT_RULES)` en cada sitio que lo usa: es
// lo que hace que `ct-step.mjs` no tenga que importar `SLICE_VERDICT_RULES`
// sólo para pasarla, y lo que deja un único punto donde "leer un veredicto de
// slice" significa una cosa.
export const readSliceVerdict = (structured) => readVerdict(structured, SLICE_VERDICT_RULES)

// De veredicto a resultado de la tabla. Las tres salidas son las tres que
// `run-machine.js` sabe atender desde el paso `judge`.
export function outcomeOfVerdict(verdict) {
  if (verdict.ruling === 'FAIL') return 'failed'
  // Un PASA con hallazgos que no son de severidad baja no bloquea, pero tampoco
  // se ignora: vuelve al implementador con presupuesto propio.
  return verdict.findings.some((f) => f.severity !== 'low') ? 'corrections-ordered' : 'done'
}

// De veredicto de SLICE a resultado de la tabla — sólo DOS salidas, las que
// `trasElJuezDeSlice` sabe atender. `PASS` es SIEMPRE `done`, con hallazgos o
// sin ellos: a diferencia de una tarea, aquí no queda ningún implementador con
// trabajo stageado al que devolver — el slice entero ya está comiteado, tarea
// a tarea. Un medium no compra una vuelta pagada que no hay a quién cobrarle:
// viaja DENTRO del veredicto que este mismo verbo comitea, y lo lee quien
// revisa la pull request — una puerta que YA existe, no una cuarta.
export function outcomeOfSliceVerdict(verdict) {
  return verdict.ruling === 'FAIL' ? 'failed' : 'done'
}

// `path:line` a partir de los dos campos, en UN solo sitio. El hallazgo los
// lleva separados para que un programa pueda agrupar por fichero, pero quien
// lee el aviso de corrección quiere la ubicación de una pieza. Vive aquí,
// pegado al esquema, para que el próximo lector no invente su propia
// recomposición: dos formatos de la misma ubicación es la divergencia que este
// módulo ya pagó con JUDGE_TOOLS. Sin línea imprime sólo el fichero, que es
// exactamente lo que ese hallazgo dice.
export function findingLocation(finding) {
  const { path, line } = finding || {}
  return line === undefined || line === null ? String(path ?? '') : `${path}:${line}`
}

export function readReport(structured) {
  if (!structured || typeof structured !== 'object') return { why: 'el implementador no devolvió structured_output' }
  const { paths, summary } = structured
  if (!Array.isArray(paths) || !paths.every(esTexto)) return { why: 'el informe no trae la lista de rutas tocadas' }
  if (!esTexto(summary)) return { why: 'el informe no trae resumen' }
  // Una ruta absoluta o que sube de directorio no se stagea: el programa hace
  // `git add` de lo que diga esta lista, así que la lista es una superficie de
  // ataque, no un dato de confianza.
  const fuera = paths.filter((p) => p.startsWith('/') || p.split('/').includes('..'))
  if (fuera.length) return { why: `el informe declara rutas fuera del worktree: ${fuera.join(', ')}` }
  // La misma ruta dos veces YA NO DESCARTA. Descartaba cuando esta lista era
  // la fuente de lo que se stagea: dos declaraciones de la misma ruta no se
  // podían arbitrar. Desde que las rutas las MIDE el programa contra el árbol
  // previo a la tarea, la lista es una comprobación cruzada, y en una
  // comprobación un duplicado no deja nada indecidible: dice lo mismo dos
  // veces. Descartar el informe entero —y gastar uno de los seis descartes que
  // matan el run— por una repetición que no cambia nada era el precio más caro
  // por el defecto más barato.
  return { report: { paths: [...new Set(paths)], summary } }
}

// readE2eReport: el informe -> un OUTCOME. Validación a mano y no con una
// librería de esquemas, igual que readVerdict y por lo mismo: el spec exige
// cero dependencias nuevas y lo que hay que comprobar cabe aquí.
//
// LA COMPARACIÓN DE `run` ES IDÉNTICA, sólo colapsando espacios. El recorrido
// llega al agente verbatim desde la celda del spec precisamente para que esto
// sea posible; normalizar más (minúsculas, quitar puntuación) haría pasar por
// "el mismo recorrido" dos textos que un humano escribió distintos, y ese
// título es la única prueba de que se atravesó lo que se pidió y no otra cosa.
//
// LO QUE NO COMPRUEBA: que la salida sea real. Ver la cabecera del test.
const colapsa = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// nombraCampo: el nombre del campo tal cual va en el JSON, con la aclaración
// que hace falta cuando el nombre solo no basta. `evidence` es el único caso:
// una lista vacía —o con pares a los que les falta el comando o la salida— es
// tan insuficiente como no ponerla, y decir sólo "falta `evidence`" mandaría a
// un agente que YA la puso a mirar dónde no está el problema.
const nombraCampo = (campo) => (campo === 'evidence' ? '`evidence` (al menos un par comando/salida, los dos con texto)' : `\`${campo}\``)
const tieneEvidencia = (e) => (Array.isArray(e.evidence) ? e.evidence.filter((x) => x && esTexto(x.command) && esTexto(x.output)) : []).length > 0

export function readE2eReport(structured, declaredRuns) {
  // Los recorridos declarados se DEDUPLICAN. Dos celdas idénticas son el mismo
  // recorrido, y sin esto el informe no tenía ninguna forma correcta de
  // escribirse: `find` devolvía la MISMA entrada para las dos, `buenos` la
  // duplicaba (y con ella el apartado en docs/superpowers/e2e/<issue>.md),
  // mientras que mandar dos entradas iguales hacía que la segunda cayera en
  // "una entrada que esta slice no declara". Un recorrido repetido no es una
  // contradicción que haya que rechazar —es una redundancia—, así que se
  // colapsa en vez de abortar el paso.
  const declared = [...new Set((declaredRuns || []).map(colapsa).filter(Boolean))]
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return { outcome: OUTCOMES.DISCARDED, why: 'el agente no devolvió structured_output' }
  }
  if (!Array.isArray(structured.runs)) {
    return { outcome: OUTCOMES.DISCARDED, why: '`runs` no es una lista' }
  }
  const problemas = []
  const buenos = []
  const vistos = new Set()
  for (const run of declared) {
    const e = structured.runs.find((x) => x && colapsa(x.run) === run)
    if (!e) { problemas.push(`falta la entrada del recorrido "${run}"`); continue }
    vistos.add(e)
    if (!E2E_VERDICTS.includes(e.verdict)) {
      problemas.push(`el recorrido "${run}" trae un veredicto desconocido: ${JSON.stringify(e.verdict)}`)
      continue
    }
    // Los tres veredictos se validan contra UNA tabla (E2E_REQUIRED_BY_VERDICT,
    // arriba), no contra tres ramas escritas a mano — es la misma tabla que
    // `ct-step next` le enseña al agente antes de escribir el informe, así que
    // no pueden divergir. Sin ella divergieron: `next` anunciaba `run y
    // verdict` y aquí se exigía además la evidencia, el motivo o los cuatro
    // campos del rojo.
    //
    // Por qué cada veredicto exige lo suyo: un verde sin evidencia (ni cómo se
    // levantó) es una afirmación sin nada detrás; un no-verificado sin `reason`
    // y `unblock` es un encogimiento de hombros que libera el slice sin dejar a
    // nadie sabiendo qué arreglar; y un rojo a medias colaba "undefined"
    // literal en `docs/superpowers/e2e/<issue>.md` —un artefacto de la pull
    // request— porque `escribirInformeE2e` (ct-step.mjs) confía en que lo que
    // llega aquí ya está validado y no vuelve a comprobar nada.
    const faltan = E2E_REQUIRED_BY_VERDICT[e.verdict].filter((campo) => (campo === 'evidence' ? !tieneEvidencia(e) : !esTexto(e[campo])))
    if (faltan.length) {
      problemas.push(`el recorrido "${run}" se declara ${e.verdict} sin ${faltan.map(nombraCampo).join(', ')}: ese veredicto no se sostiene sin eso. Añádelo al informe y vuelve a cerrar el paso con "ct-step e2e"`)
      continue
    }
    buenos.push(e)
  }
  for (const e of structured.runs) {
    if (!vistos.has(e)) problemas.push(`el informe trae una entrada que esta slice no declara: "${colapsa(e && e.run)}"`)
  }
  // EL ROJO GANA AL MAL FORMADO: ver el test homónimo.
  //
  // `why` se OMITE aquí cuando no hay problemas — no se pone a `null` — para
  // no divergir de `readVerdict`/`readReport`, que en su camino feliz tampoco
  // llevan la clave `why`. Poner `null` explícito habría sido un tercer valor
  // sin motivo: el llamante (`ct-step.mjs#verboE2e`) ya normaliza con
  // `why || null`, así que omitirla no cambia ningún comportamiento.
  if (buenos.some((e) => e.verdict === 'rojo')) {
    return problemas.length
      ? { outcome: OUTCOMES.FAILED, runs: buenos, why: problemas.join('; ') }
      : { outcome: OUTCOMES.FAILED, runs: buenos }
  }
  if (problemas.length) return { outcome: OUTCOMES.DISCARDED, why: problemas.join('; ') }
  return { outcome: OUTCOMES.DONE, runs: buenos }
}

// ============================================================================
// LO QUE EL PROGRAMA ESCRIBE
//
// EL IMPLEMENTADOR NO COMITEA: COMITEA EL PROGRAMA. Es lo que hace que un veto
// no deje rastro que deshacer, y aquí encaja sin fricción porque en Control
// Tower una tarea ya es un commit.
//
// Y por eso este módulo valida su propio mensaje: el hook `commit-keyword-guard`
// es un PreToolUse sobre la herramienta Bash de una SESIÓN, así que un
// `git commit` lanzado por un programa no pasa por esa puerta. Si el programa no
// se mira el mensaje, la barandilla que el repo construyó en F27 no cubre este
// camino.
// ============================================================================
export function commitMessage({ issue, task, tasksTotal, name }) {
  const titulo = `${sanear(name)} (#${issue}, tarea ${task}/${tasksTotal})`
  const cuerpo = [
    '',
    `Tarea ${task} de ${tasksTotal} del plan del slice, implementada y juzgada paso a paso con ct-step.`,
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n')
  const mensaje = titulo + '\n' + cuerpo
  const keywords = findClosingKeywords(mensaje)
  if (keywords.length) {
    throw new Error(`el mensaje de commit contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría un issue sin que nadie lo haya decidido`)
  }
  return mensaje
}

// El nombre de la tarea viene del plan, o sea de un agente. "fixes #12" en el
// título de una tarea es exactamente el accidente de F27, así que la keyword se
// desactiva rompiendo la referencia, no borrando la palabra: el título sigue
// leyéndose igual.
function sanear(name) {
  return String(name || 'tarea sin nombre').replace(/#(\d+)/g, 'issue $1').trim()
}

// El veredicto de SLICE no tiene tarea de la que colgar: el de tarea viaja
// DENTRO del commit de su tarea, y el del slice entero se comitea después de
// la última — así que estrena su propio commit, con el mismo precedente
// exacto que el resto de este módulo ya obedece: comitea el PROGRAMA, y el
// programa se mira su propio mensaje porque `commit-keyword-guard` no ve un
// `git commit` que no lanzó una sesión.
export function sliceVerdictCommitMessage({ issue, tasksTotal }) {
  const titulo = `Veredicto del slice entero (#${issue})`
  const cuerpo = [
    '',
    `Las ${tasksTotal} tareas comiteadas, la Global verification en verde y el slice juzgado de una vez por ct-slice-judge.`,
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n')
  const mensaje = titulo + '\n' + cuerpo
  const keywords = findClosingKeywords(mensaje)
  if (keywords.length) {
    throw new Error(`el mensaje de commit del veredicto de slice contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría un issue sin que nadie lo haya decidido`)
  }
  return mensaje
}
