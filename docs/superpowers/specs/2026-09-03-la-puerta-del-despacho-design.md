# La puerta del despacho — `ct-step next` prepara las entradas, así que despachar sin llamarlo se deniega

**Fecha:** 2026-09-03
**Repo:** `josemerca/control-tower-plugin`, directorio `plugin/`
**Estado:** diseño, revisado por un juez adversarial
**Alcance:** un módulo puro nuevo, dos líneas en `verboNext`, un hook nuevo y sus dos registros

---

## 1. Qué se construye

Un hook `PreToolUse` sobre el tool `Task` que **deniega el despacho de un
subagente cuando el conductor no ha pedido antes el paso con `ct-step next`**,
y el sello en el estado del run que le permite saberlo.

El conductor de un slice es una sesión de chat en la terminal de cmux. El
kickoff le dice en prosa (`plugin/scripts/kickoff.js:253`) que pregunte el paso
con `ct-step next` y obedezca literalmente lo que imprima. Obedecer prosa es lo
que falla: `next` no sólo **dice** cuál es el paso, **escribe las entradas que
el subagente de ese paso tiene que leer**, y un despacho que se lo salta deja al
subagente sin fichero.

---

## 2. La evidencia

Dos olvidos, los dos del mismo verbo y en dos pasos distintos, medidos en la
prueba de punta a punta del backend del 2026-09-03:

> «El brief no existía porque despaché al implementador antes de `ct-step next`,
> que es el verbo que prepara las entradas del paso.»

> «He anotado en `.agent/SLICE.md` el error de secuencia que cometí dos veces:
> `ct-step next` no solo dice el paso, prepara sus entradas — el brief en
> `implement` y el paquete de revisión en `judge`. Despachar sin llamarlo antes
> deja al subagente sin fichero.»

**Y el repo ya reconoció este fallo, para el paso `judge`, al recoger.** El
mensaje de `verboVerdict` (`ct-step.mjs:1586`) nombra al culpable con precisión:

> «el paquete de revisión no existe: el juez juzgó a ciegas — vuelve a
> `ct-step next`, que es el único paso que lo genera, y REDESPACHA al juez con el
> paquete nuevo» … «la telemetría contaría un juez que escribe mal en vez de un
> conductor que se saltó un paso. La causa manda sobre el síntoma.»

Lo que falta es exactamente eso mismo **al despachar** — y, en `implement`, ni
al despachar ni al recoger.

**La auditoría de los ocho pasos**, para acotar el hueco a lo que la evidencia
sostiene. El orden de los **verbos** ya es mecanismo en los ocho: `exigirPaso`
(`ct-step.mjs:459`) rechaza el verbo que no toca. Lo que no lo era es el
**despacho**:

| paso | qué prepara `next` | qué había al despachar / al recoger | veredicto |
|---|---|---|---|
| `implement` | el brief (`:481`), y en un reintento los hallazgos del juez (`:490-494`) | nada / nada | **hueco, y el más caro** |
| `controls` | nada: imprime los comandos, los ejecuta el programa | no aplica | cerrado |
| `judge` | el paquete de revisión (`:508`) | nada / el `existsSync` del paquete (`:1586`), que descarta el veredicto y nombra el fallo del conductor | **hueco al despachar** |
| `commit` | nada: comitea el programa | no aplica | cerrado |
| `reconcile` | nada: el paquete de conflicto lo escribe el propio verbo | no aplica | cerrado |
| `global` | nada: los comandos los corre el programa | no aplica | cerrado |
| `slice-judge` | el paquete del slice (`:564`) | nada / el `existsSync` del paquete (`:1457`) | **hueco al despachar, por deducción** |
| `e2e` | los recorridos, `E2E_SCHEMA` y la sección de `AGENTS.md` con el «Levantar» | `readE2eReport` valida recorridos y esquema; no impide inventarse cómo levantar | hueco menor, ya declarado falsificable por diseño y mitigado con la reproducibilidad |

El `Review token` **no** es lo que guarda estos dos pasos del olvido: cubre otra
cosa —el paquete rancio, cuyo diff ya no es el del índice (`:788`)—, y lo hace
también al recoger.

`reconcile` queda fuera porque su preparador es su propio verbo y de ese olvido
no hay ninguna evidencia. Y **`slice-judge` entra por deducción, no por
evidencia**: es el mismo verbo con la misma boca —`escribirPaqueteDeSlice` lo
invoca sólo `next` (`:1454`)— y su coste es un elemento en una lista derivada de
constantes.

**Dos daños del mismo hueco que los dos olvidos no llegaron a cobrar:**

1. **En un reintento**, `next` es el único sitio que imprime `run.lastFindings`
   — lo que el juez ordenó arreglar. Saltárselo re-despacha al implementador sin
   los hallazgos: rehace lo mismo, el juez vuelve a vetar y ahí sí se gasta uno
   de los dos `judgeRetries`. Dos olvidos y el run muere en `blocked-judge`. Y es
   el daño **mudo**: el brief del intento anterior sigue en disco, así que
   `brief_bytes` no sale `null` y la telemetría no lo ve.
2. **El brief que no se escribió sigue sin existir en el paso `judge`**: `next`
   se lo nombra al juez (`:512`) pero no lo reescribe, y la rúbrica de `ct-judge`
   está construida encima de él — el estado final deseado, la tabla de decisiones
   cerradas, la vara de ct. Un juez sin brief juzga con media vara y nada lo
   detecta.

---

## 3. Las decisiones

- **La puerta corta al despachar, no al recoger.** El olvido se ataja antes de
  gastar el subagente. Al recoger ya está cubierto en dos de los tres pasos, y
  ahí el trabajo ya está hecho y tirado: el descarte sale del presupuesto de la
  slice entera (`MAX_DISCARDS`).
- **Obedecer es gratis, y eso es lo que la hace viable.** `verboNext` no
  transiciona: informa y prepara (`ct-step.mjs:466`). Es idempotente, así que la
  salida del `deny` es siempre «llama a `next` y sigue»: sin trabajo perdido,
  sin descarte gastado y sin reintento.
- **El sello lo pone quien prepara las entradas.** `verboNext`, y sólo en los
  tres pasos que escriben artefacto. Sellar en `controls` o en `commit`
  afirmaría que allí hay un despacho protegido, y no lo hay.
- **El sello es la terna del momento: tarea, paso e intento.** El intento entra
  porque sin él el caso del reintento no se distingue: el brief de la tarea N ya
  existe del intento anterior, y `next` lo reescribe idéntico —los hallazgos del
  juez los **imprime**, no los mete en el fichero—, así que la existencia del
  brief no prueba que el paso se haya pedido en este intento. Es inerte en
  `slice-judge`, donde el intento siempre vale 1, y eso no cuesta nada.
- **El sello sobrevive a un descarte, y así debe ser.** Las tres transiciones de
  `discarded` son autobucles sobre los tres pasos sellados
  (`run-machine.js:167`, `:211`, `:364`) y `discards` no entra en `intento()`
  (`ct-step.mjs:400`), así que la terna no cambia. **No es un agujero: es la
  decisión que `ct-step` ya tomó** — el paquete no se consume en un descarte
  (`consumirPaquete` sólo se llama en los caminos de veredicto aceptado, `:1495`
  y `:1645`), precisamente para que repreguntar por un JSON ilegible no obligue a
  regenerar nada. El artefacto de ese intento sigue en disco, así que el sello
  vigente dice la verdad. **Y por eso `discards` NO entra en la terna:** metería
  un `next` obligatorio en el único camino donde el programa decidió que no hace
  falta.
  El residuo, dicho: si el descarte lo causó el token —el índice cambió después
  de generarse el paquete (`:788`)— el sello sigue vigente sobre un paquete
  rancio y la puerta calla. Lo cubre el mensaje que ya existe en `:788`, y el
  coste son descartes, no reintentos.
- **Un run entregado no recibe decisión, y esta rama no es negociable.** Con
  `closed === 'delivered'`, `next` contesta «run delivered» y sale **antes de
  llegar a `verboNext`** (`ct-step.mjs:291-295`): un run entregado no se puede
  sellar jamás. Y un run entregado sin recorridos e2e se queda con
  `step: 'slice-judge'`, que es un paso sellado, porque `cerrado()` no toca el
  paso (`run-machine.js:355-360`). Sin esta rama —evaluada **antes** que la del
  sello— el conductor recibiría `deny` en todo `Task` justo mientras escribe la
  pull request, y el mensaje le mandaría a un `next` que no puede levantar el
  bloqueo: un `deny` inobedecible. Es el único despacho legítimo que esta puerta
  podría bloquear.
- **Un run bloqueado no necesita rama propia:** conserva su `step`, y `next`
  sigue contestando y sellando, así que quien intervenga sale por el mismo sitio
  que todos.
- **Un run que no se puede leer no recibe decisión.** No escala a `ask`. El
  precedente de `commit-keyword-guard` escala porque protege un efecto
  irreversible —cerrar un issue— cuando su sonda falla; aquí no hay nada
  irreversible en juego, y el conductor corre en una terminal de cmux que nadie
  está mirando, así que un `ask` es un loop colgado. Además la decisión no
  cambiaría nada: un `run-*.json` que no parsea mata la llamada siguiente a
  cualquier verbo en el `JSON.parse` de `ct-step.mjs:277`.
- **La puerta decide sólo con el estado del run, nunca con el `tool_input`.** La
  documentación de hooks garantiza `cwd`, `tool_name` y `tool_input` en el
  payload de `PreToolUse`, pero no publica el esquema del `tool_input` de `Task`.
  Mirar el prompt del despacho para ver si cita el brief sería además una
  heurística con falsos positivos.
- **No se toca el contrato del implementador.** La tercera vía —estampar un
  `Brief token` en el brief y exigirlo en `REPORT_SCHEMA`, simétrico al `Review
  token`— cubriría además «llamé a `next` pero no le pasé el brief», de lo que
  hoy no hay evidencia. Queda fuera.
- **No se toca la prosa del kickoff.** Ya dice lo correcto y falla igual. La
  lección la da el mensaje del `deny`, en el momento exacto en que hace falta y
  no veinte minutos antes.

---

## 4. Las piezas

**La vara manda la forma.** `plugin/conventions/style.md` liga en todo diff, y
los módulos de `plugin/scripts/` llenos de prosa en castellano son la deuda
declarada del repo, no el ejemplo a seguir: «a new concept is a new module and
is born conforming». Así que lo nuevo nace sin comentarios, en inglés y con cada
función colgando de un tipo — el ejemplar es `scripts/slice-collection.js`. Lo
que se añade a `ct-step.mjs` sigue el estilo de su anfitrión, que es lo que la
misma vara permite. Los mensajes que lee una persona siguen en castellano: son
la copia del producto, y esa excepción está escrita en la vara.

**`plugin/scripts/dispatch-gate.js`** (nuevo, puro, sin un solo I/O). Vive en
`scripts/` y no en `hooks/` porque lo importan dos consumidores y ningún fichero
de `scripts/` importa de `hooks/`: la dirección de la dependencia obliga a un
tercer módulo, igual que con `closing-keywords.js` y `governed-repo.js`.

- `StepSeal.of(run)` — la terna, como una cadena: `task`, `step` y el intento,
  que es el mismo `controlRetries + judgeRetries + correctionRetries + 1` que ya
  calcula `intento()` en `ct-step.mjs:400`.
- `StepSeal.inputWrittenFor(step)` — qué entrada escribe `next` en ese paso, o
  `null` si no escribe ninguna. **Es la única fuente de verdad**, y de sus
  claves sale `StepSeal.SEALED_STEPS`: un paso está sellado si y sólo si `next`
  le escribe un fichero, así que no hay una lista que pueda divergir del mapa.
- `DispatchGate.verdictFor(run, ctStepPath)` — un `DispatchVerdict`, que lleva
  un miembro del vocabulario `Dispatch` (`LET_THROUGH` o `DENIED`) y el motivo,
  y va congelado. **No devuelve `null` ni un objeto suelto a propósito**:
  `conventions/defects.md` liga sin exención y lista los dos antipatrones que
  eso sería — un opcional en lugar de un miembro ausente del vocabulario, y un
  mapa crudo como valor de retorno de lógica. El ejemplar del repo es
  `CollectionStep` en `slice-collection.js`, que también nombra su «no hay nada
  que hacer» dentro del vocabulario. El hook despacha sobre los dos miembros sin
  rama por defecto, y un miembro nuevo revienta ahí en vez de colarse en
  silencio.
- El `ctStepPath` entra por parámetro por la misma razón que el `probe` de
  `decidir` en `commit-keyword-guard.js`: el mensaje necesita el comando
  **ejecutable** y la función pura no debe ir a buscarlo.

**`verboNext`** gana un bloque de dos líneas **en un solo sitio**, no en los tres
`case`: al final del verbo, si `inputWrittenFor` dice que este paso tiene
entrada, apunta `nextSeal` y guarda. Un paso al que `next` no escribe nada no se
sella, porque sellarlo afirmaría que allí hay un despacho protegido.

**`plugin/hooks/dispatch-guard.js`** (nuevo). Matcher `Task`.

- `RunFile.onlyOneIn(cwd)` — el único `.agent/run-<n>.json` del worktree, ya
  parseado, o `null` si no hay ninguno, hay más de uno o no se puede leer. Todo
  el I/O está aquí. Los tres casos se colapsan en un `null` y no en un
  vocabulario de tres miembros porque **ninguno tiene consumidor que los
  separe**: los tres son silencio, y nombrarlos sería inventar estados que nadie
  lee.
- `DispatchGuard.decide(input, readRun, ctStepPath)` — pura, con el lector
  inyectado, así que un espía puede medir la propiedad que importa: un `Bash`
  no paga ni una lectura de disco. Traduce el veredicto al JSON del harness, y
  ese sí es un mapa: es la frontera de serialización, el último paso antes del
  cable y uno solo, que es justo lo que `defects.md` admite.
- `DispatchGuard.ctStepBesideThisHook(import.meta.url)` — la ruta de
  `ct-step.mjs` derivada de dónde corre el propio hook. La misma expresión vale
  para las fuentes y para el bundle, porque `hooks/../scripts` y
  `dist/../scripts` son el mismo directorio. Hace falta porque `ct-step` a secas
  no existe como comando, y el propio kickoff lo advierte («donde diga
  `ct-step`, es `node ${ctStepPath}`», `kickoff.js:253`): un `deny` que no deja
  un comando pegable reintroduce la fricción que viene a cerrar.

Sus decisiones:

| situación | decisión |
|---|---|
| no es `Task` | ninguna |
| no hay `.agent/run-*.json`, o no hay exactamente uno | ninguna |
| el run no parsea | ninguna |
| el run está entregado (`closed`) | ninguna — se evalúa antes que el sello |
| paso no sellado | ninguna |
| paso sellado, sello vigente | ninguna |
| paso sellado, sello ausente o de otro intento | `deny` |

El texto del `deny` no se escribe de cero: los mensajes de `:1586` y `:1457` ya
dicen lo que hay que decir —«vuelve a `ct-step next`, que es el único paso que lo
genera, y REDESPACHA»— y sólo hay que ponerlos en tiempo futuro y añadir el
comando.

**Dos registros**, y el segundo es el que se olvida: `matcher: "Task"` en
`hooks/hooks.json`, y `'dispatch-guard': 'hooks/dispatch-guard.js'` en
`entryPoints` de `scripts/build.mjs`. Los hooks corren desde `dist/`, así que sin
esa línea el fichero existe y no lo ejecuta nadie.

---

## 5. Tests

En tres capas, con el reparto de `__tests__/f27-commit-keyword-guard.test.js`, y
51 casos en total.

1. **`dispatch-gate.test.js` — la decisión, sin proceso ni disco.** Los tres
   pasos sellados sin sello → `deny`, cada uno nombrando el artefacto que le
   falta y el comando que lo escribe. El caso del reintento: sello del intento
   anterior → `deny`. Sello del momento → `null`, en un caso derivado de
   `SEALED_STEPS`. Un descarte → `null`. Run entregado en un paso sellado →
   `null`. Y **un solo caso derivado** para los pasos que `next` no prepara
   (`Object.values(STEPS)` menos `SEALED_STEPS`) en vez de cinco escritos a mano:
   es la doctrina que el propio `hooks-json.test.js:15-17` tiene escrita —«no
   sobre una lista escrita a mano: enumerarlos hacía que un hook nuevo quedara
   sin comprobar y el test siguiera verde»— y así el día que la tabla estrene un
   paso, este test lo cubre solo.
2. **`dispatch-guard.test.js` — el hook.** La parte pura con un espía, que mide
   que un `Bash` no paga ni una lectura de disco. Y el proceso de verdad contra
   directorios temporales: sin run → silencio; dos runs → silencio; run que no
   parsea → silencio y salida limpia; `stdin` que no es JSON → silencio; el
   camino del `deny` con la forma exacta que contesta un `PreToolUse`. Más el
   caso que el precedente enseña a no olvidar: **el bundle que se distribuye
   decide igual que las fuentes**, que aquí es lo único que prueba que la ruta
   de `ct-step.mjs` se resuelve bien desde `dist/`.
3. **`ct-step-dispatch-seal.test.js` — el sello sobre el programa real.** Tras
   `next` en `implement` el run trae `1:implement:1`; en `judge`, `1:judge:1`;
   en la segunda tarea, `2:implement:1`; y `next` en `controls` no sella. Y
   luego la puerta decidiendo sobre el estado **que ct-step acaba de escribir**:
   un informe descartado se deja pasar otra vez porque su brief sigue en disco,
   y una tarea vetada queda denegada hasta que vuelve a pedir el paso — que es,
   de punta a punta y con el programa de verdad, el caso que paga el intento en
   la terna.

Más una línea en `hooks-json.test.js` para el matcher `Task`. El olvido de
`entryPoints` en `build.mjs` ya tenía red desde antes: el test genérico de ese
mismo fichero comprueba que el `command` de cada hook apunte a un fichero que
existe, y el de este apunta a `dist/dispatch-guard.js`.

**Y la otra mitad de la vara, la que no es el ciclo rojo-verde:** cada aserción
se ha visto caer rompiendo a mano lo que su nombre promete. Metiendo `discards`
en la terna caen los cinco casos del descarte; quitando la rama del run
entregado cae el suyo y sólo el suyo; sacando el intento del sello caen los tres
del reintento; sellando en todos los pasos cae el de `controls`; aceptando un
run cualquiera en vez de exactamente uno cae el de los dos runs; quitando la
comprobación del tool cae el del `Bash`; y quitando el `catch` del parseo cae el
del run ilegible.

---

## 6. Lo que este diseño no hace

- No toca `REPORT_SCHEMA` ni `prompts/task-implementer.md`.
- No toca la prosa del kickoff.
- No cubre `reconcile`, cuyo paquete escribe su propio verbo.
- No cubre el hueco menor de `e2e`, que ya está declarado falsificable por
  diseño y mitigado con la reproducibilidad del comando.
- No añade una segunda red en `ct-step report`: con la puerta puesta, un informe
  huérfano no llega a existir.

---

## 7. Los límites y los puntos ciegos, dichos

- **Dos runs en el mismo worktree apagan la puerta en silencio.**
  `.agent/run-*.json` está ignorado (`ct-init.sh:171`) y nadie lo borra, así que
  dos runs coexisten si un mismo directorio conduce dos slices. No es un caso
  resuelto: es un punto ciego, y el código se limita a no inventarse cuál de los
  dos manda.
- **Ve sólo lo que despacha el tool `Task`.** Ninguna vía del guion lo esquiva,
  pero la afirmación general sería falsa: `ct-next` arranca los agentes con
  `claude --dangerously-skip-permissions` a través de `Bash`
  (`ct-next.mjs:2385`), y eso no pasa por el matcher `Task`.
- **La puerta sigue siendo puerta bajo `--dangerously-skip-permissions`**, el
  flag con el que arrancan los agentes despachados: está medido por efecto para
  `commit-keyword-guard` (F27/F28) y el mecanismo es el mismo. Lo que **no**
  hereda de esa medida es la cobertura: proteger a un agente despachado sigue
  dependiendo de que el plugin esté instalado bajo la cuenta con la que ese
  agente arranca (`resolveAccount`, `scripts/dispatch.js`).
- **No protege la prueba en curso hasta que la caché del plugin se refresque.**
  El plugin corre de una copia en `~/.claude/plugins/cache/control-tower/…`, así
  que hasta que el marketplace apunte a la rama con este cambio, todo lo
  anterior está verde en tests y ausente en la sesión de cmux.
- **El plan B, si el sello empieza a pedir excepciones:** decidir por la
  existencia del artefacto en disco (`task-N-brief.md`, `task-N-review.diff`,
  `slice-review.diff`), sin campo nuevo ni semántica de intento, que es el
  espejo del `existsSync` que el programa ya hace al recoger. Lo que pierde es
  el caso verificado del reintento —el brief del intento anterior está ahí, así
  que el redespacho sin `next` pasaría la puerta— que es justo el daño mudo para
  la telemetría. Por eso hoy manda el sello.
