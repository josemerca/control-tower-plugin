# La puerta del despacho — Execution spec

**Handoff origen:** `docs/superpowers/specs/2026-09-03-la-puerta-del-despacho-design.md`
**Fecha de congelación:** 2026-09-03
**Estado:** CONGELADA

## Hipótesis del experimento

**Apuesta:** el conductor se salta `ct-step next` porque saltárselo no tiene
consecuencia inmediata, no porque no sepa que existe. Si el despacho de un
subagente se **deniega** mientras el paso no se haya pedido, el olvido
desaparece sin coste: `next` es idempotente y no transiciona, así que obedecer
el `deny` cuesta un comando.

**Cómo sabremos que falló:** la telemetría ya deja la huella del fallo en el
paso `implement` — `medidaDeBrief` escribe `brief_bytes: null` y
`brief_vara_ct_docs: null` cuando el brief no existe (`ct-step.mjs:877`). La
apuesta se tumba si, con la puerta activa en el repo de prueba, vuelve a
aparecer una fila `implement` con `brief_bytes: null`; o si el `deny` cae sobre
despachos legítimos y hay que desactivar el hook para poder trabajar.

**La huella no cubre el caso del reintento**, y hay que saberlo: cuando el
conductor redespacha sin `next` tras un veto del juez, el brief del intento
anterior sigue en disco, `brief_bytes` no sale `null` y el único síntoma es un
`judgeRetries` gastado en rehacer lo mismo. Ese caso sólo lo ve la puerta.

**Anti-scope — qué NO hace este epic:**

- No toca `REPORT_SCHEMA` ni `plugin/prompts/task-implementer.md`: el informe del
  implementador no gana ningún campo ni ningún token.
- No toca la prosa del kickoff (`plugin/scripts/kickoff.js`).
- No cubre el paso `reconcile`, cuyo paquete de conflicto lo escribe su propio
  verbo y no `next`.
- No cubre el hueco menor de `e2e` (inventarse cómo levantar el sistema), ya
  declarado falsificable por diseño y mitigado con la reproducibilidad.
- No añade una segunda red en `ct-step report`.
- No resuelve el punto ciego de dos runs en un mismo worktree: se declara y la
  puerta se apaga en silencio.
- No convierte al conductor en programa: D-4 del epic «el conductor como
  programa» sigue aplazada y su dueño sigue siendo José.

## Decisiones congeladas

- **D-1 · Dónde corta la puerta** — al **despachar**, con un hook `PreToolUse`
  sobre el tool `Task`, y no al recoger el informe. Al recoger ya está cubierto
  en `judge` y `slice-judge` (`ct-step.mjs:1586` y `:1457`), y ahí el trabajo del
  subagente ya está hecho y tirado. *(Procedencia: hablada — «me pinta la 1, de
  hecho ya hay un hook que le obliga a comitear un estado de por donde va o algo
  similar, no?».)*
- **D-2 · El alcance son las tres bocas de `ct-step next`** — los pasos
  `implement`, `judge` y `slice-judge`, que son los únicos cuyas entradas
  escribe `next`. `implement` y `judge` tienen evidencia de campo; `slice-judge`
  entra por **deducción** —el mismo verbo, la misma boca, `escribirPaqueteDeSlice`
  lo invoca sólo `next` (`ct-step.mjs:1454`)— y su coste es un elemento en una
  lista derivada de constantes. *(Procedencia: hablada — «revisa si podría haber
  otros por si las moscas, pero si no encuentras evidencias nos quedamos
  únicamente con el de ct-step next», y el parte de la sesión en curso: «el brief
  en implement y el paquete de revisión en judge».)*
- **D-3 · El sello es la terna tarea + paso + intento** — lo apunta `verboNext`
  en el campo `nextSeal` de `.agent/run-<issue>.json`, y sólo en los tres pasos
  de D-2. El intento entra porque el brief de la tarea N ya existe del intento
  anterior y `next` lo reescribe idéntico —los hallazgos del juez los imprime, no
  los mete en el fichero—, así que sin el intento el redespacho sin `next` tras
  un veto colaría. *(Procedencia: hablada — el diseño se presentó por secciones y
  la del mecanismo se aprobó: «me encaja».)*
- **D-4 · `discards` NO entra en la terna, y el sello sobrevive a un descarte** —
  las tres transiciones de `discarded` son autobucles sobre los tres pasos
  sellados (`run-machine.js:167`, `:211`, `:364`) y `discards` no cuenta en
  `intento()`, así que un descarte deja el sello vigente. Es correcto: el
  artefacto de ese mismo intento sigue en disco porque `ct-step` decidió no
  consumir el paquete en un descarte (`consumirPaquete` sólo corre en los caminos
  de veredicto aceptado). Meter `discards` obligaría a un `next` en el único
  camino donde el programa decidió que no hace falta. *(Procedencia: deducida de
  la tabla de `run-machine.js`; el juez adversarial refutó la formulación
  anterior, que afirmaba que toda transición invalida el sello.)*
- **D-5 · La puerta decide sólo con el estado del run** — nunca con el
  `tool_input` del `Task`. La documentación de hooks garantiza `cwd`, `tool_name`
  y `tool_input`, pero no publica el esquema del `tool_input` de `Task`; y mirar
  el prompt para ver si cita el brief sería una heurística con falsos positivos.
  *(Procedencia: deducida de D-1.)*
- **D-6 · Un run que no se puede leer no recibe decisión** — silencio, no `ask`.
  El `ask` de `commit-keyword-guard` protege un efecto irreversible cuando su
  sonda falla; aquí no hay nada irreversible, el conductor corre en una terminal
  de cmux que nadie mira —un `ask` ahí es un loop colgado— y la decisión no
  cambiaría nada, porque un `run-*.json` que no parsea mata la llamada siguiente
  a cualquier verbo en `ct-step.mjs:277`. *(Procedencia: deducida; el juez
  adversarial tumbó el `ask` que llevaba la versión anterior.)*
- **D-7 · Un run entregado no recibe decisión, y la rama no es negociable** — se
  evalúa **antes** que la del sello. Con `closed === 'delivered'`, `next` sale
  antes de llegar a `verboNext` (`ct-step.mjs:291-295`), así que un run entregado
  no se puede sellar jamás; y si el slice no declaró recorridos e2e, se queda con
  `step: 'slice-judge'` —un paso sellado— porque `cerrado()` no toca el paso
  (`run-machine.js:355-360`). Sin la rama, el conductor recibiría un `deny`
  inobedecible justo mientras escribe la pull request. Un run **bloqueado** no
  necesita rama: conserva su paso y `next` sigue contestando y sellando.
  *(Procedencia: deducida del código; el juez adversarial identificó este
  camino como el único despacho legítimo que la puerta podía bloquear.)*
- **D-8 · El contrato del implementador no se toca** — se descartó la vía del
  `Brief token` estampado en el brief y exigido en `REPORT_SCHEMA`, simétrica al
  `Review token`: cubriría además «llamé a `next` pero no le pasé el brief», de
  lo que no hay evidencia. *(Procedencia: hablada — el usuario eligió la opción
  del hook frente a esa, que se le presentó como tercera.)*
- **D-9 · El kickoff no se toca** — su prosa ya dice lo correcto y falla igual;
  la lección la da el mensaje del `deny`, en el momento exacto. *(Procedencia:
  deducida de D-1.)*

## Enfoque técnico

El corazón es un módulo puro nuevo, `plugin/scripts/dispatch-gate.js`, sin un
solo I/O: `StepSeal.of(run)` calcula la terna, `StepSeal.inputWrittenFor(step)`
dice qué entrada escribe `next` en ese paso —y de sus claves sale
`StepSeal.SEALED_STEPS`, así que un paso está sellado si y sólo si `next` le
escribe un fichero y no hay lista que pueda divergir del mapa— y
`DispatchGate.verdictFor(run, ctStepPath)` devuelve un `DispatchVerdict`
congelado que lleva un miembro del vocabulario `Dispatch` (`LET_THROUGH` o
`DENIED`) y el motivo — no un `null` ni un objeto suelto, porque las dos cosas
están en la lista de `conventions/defects.md`, que liga sin exención. Vive en
`scripts/` y no en `hooks/` porque ningún fichero de `scripts/` importa de
`hooks/`: la dirección de la dependencia obliga a un tercer módulo, igual que
`closing-keywords.js` y `governed-repo.js`. El `ctStepPath` entra por parámetro
por la misma razón que el `probe` de `decidir` en `commit-keyword-guard.js`: el
mensaje del `deny` necesita el comando **ejecutable** y la función pura no debe
ir a buscarlo. El hook lo deriva de su propio `import.meta.url`, y la misma
expresión vale para las fuentes y para el bundle porque `hooks/../scripts` y
`dist/../scripts` son el mismo directorio.

Alrededor sólo hay cableado: un bloque de dos líneas en `verboNext` —en **un**
sitio, al final del verbo, condicionado por `inputWrittenFor`, no repartido por
los tres `case`—, el hook `plugin/hooks/dispatch-guard.js` con todo su I/O en
`RunFile.onlyOneIn(cwd)`, y **dos** registros: `matcher: "Task"` en
`hooks/hooks.json` y la entrada en `entryPoints` de `scripts/build.mjs`, sin la
cual el hook existe en fuentes y no lo ejecuta nadie porque los hooks corren
desde `dist/`.

**La forma la manda `plugin/conventions/style.md`, que liga en todo diff:** los
módulos nuevos nacen conformes —sin comentarios, en inglés, cada función
colgando de un tipo, con `scripts/slice-collection.js` como ejemplar—, mientras
que lo añadido a `ct-step.mjs` sigue el estilo de su anfitrión, que es lo que la
propia vara permite para un módulo con deuda declarada. Los mensajes que lee una
persona siguen en castellano por la excepción que la vara escribe para la copia
del producto.

Un solo slice: partirlo dejaría un primer trozo que no bloquea nada, y por tanto
sin nada observable que entregar.

## Contexto del epic

- Stack: Node con ESM, `vitest` como framework de test, cero dependencias npm en
  el runtime de los hooks (se bundlean a `dist/` con esbuild y sólo pueden
  importar builtins `node:*`).
- Los hooks del plugin corren desde `dist/`. Un hook nuevo sin su entrada en
  `entryPoints` de `scripts/build.mjs` no se ejecuta nunca, y `dist/` va
  commiteado: hay un test que exige que sea coherente con las fuentes.
- La lógica de un hook se escribe como **función pura** que recibe el payload ya
  parseado y devuelve la decisión, con el cuerpo ejecutable guardado detrás de la
  comparación `import.meta.url === pathToFileURL(realpathSync(process.argv[1]))`
  para que un test pueda importarla sin disparar el `readFileSync(0)`. El
  precedente entero está en `plugin/hooks/commit-keyword-guard.js`.
- Un hook que no tiene nada que decir sale en silencio con código 0. Una decisión
  se emite como `hookSpecificOutput` con `permissionDecision` y
  `permissionDecisionReason`, y el `process.exit` espera al callback de `write`
  para que un mensaje largo no salga cortado por el buffer de la tubería.
- Ninguna constante se teclea dos veces: los pasos salen de `run-machine.js` y
  las rutas de estado de `state-paths.js`.
- Un test que enumera casos a mano se queda atrás en silencio. Cuando el
  conjunto se puede derivar de una constante, se deriva: la doctrina está escrita
  en `__tests__/hooks-json.test.js:15-17`.
- Los comentarios del repo explican **por qué**, con la evidencia de campo que
  motivó cada decisión, y están en castellano.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |
|---|-------|------|---------|-----|--------|-----------|------|------|------|
| 1 | La puerta del despacho | bugfix | El despacho de un subagente se deniega mientras el paso sellado no se haya pedido con `ct-step next`, y `next` deja el sello que lo permite saber | – | `ct-step next` apunta `nextSeal` en el run en `implement`\, `judge` y `slice-judge` y no lo apunta en ningún otro paso, un `Task` en un paso sellado sin sello vigente recibe `deny` con el artefacto que falta y el comando que lo genera, un `Task` con sello del intento anterior recibe `deny`, un descarte deja el sello vigente, un `Task` en un paso no sellado no recibe decisión y el caso se deriva de las constantes en vez de enumerarse, un run entregado no recibe decisión aunque su paso sea sellado, un `cwd` sin exactamente un `.agent/run-*.json` no recibe decisión, un run que no parsea no recibe decisión, `hooks.json` registra el `PreToolUse` sobre `Task` y `build.mjs` lo bundlea a `dist/` | `REPORT_SCHEMA`\, `prompts/task-implementer.md`\, `scripts/kickoff.js`\, el paso `reconcile` y el paso `e2e` | plugin | – | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|

*(Vacía a propósito: lo que no entra está en el anti-scope, que no promete nada
para después.)*

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
| 1 | – | – | – | – |
