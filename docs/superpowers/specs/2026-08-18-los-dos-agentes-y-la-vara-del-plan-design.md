# Los dos agentes y la vara del plan

> El implementador y el juez de `ct-step` pasan a ser capas finas: delegan el
> oficio en las skills que el plugin ya trae, y miden con la vara que el plan ya
> escribió. Lo que de esa vara es una regla exacta lo comprueba el programa; al
> juez le queda lo que hace falta leer código para ver.

Estado: DRAFT · Ronda: F39 (propuesta) · Rama: `d4-conductor-como-programa`

---

## 1. Qué se construye

Cinco piezas, y ninguna es "reescribir un prompt":

1. **El contrato de datos crece.** El informe del implementador etiqueta cada
   ruta como producción o test; el veredicto del juez nombra el ítem de rúbrica
   que se incumple.
2. **`plan-tasks.js` extrae más del plan.** Hoy saca los comandos y los nombres
   de test; pasa a sacar también las rutas declaradas con su acción, el nombre
   del test del `**TDD:**`, los ficheros que cada bloque nombra y el texto
   literal de `Final text`.
3. **`ct-step controls` comprueba cinco cosas nuevas**, ordenadas de gratis a
   caro, antes de ejecutar un solo comando.
4. **El brief de la tarea crece** con las secciones del plan que son vara —
   detrás de un flag, para no tocar el camino por defecto.
5. **Los dos prompts se reescriben** sobre lo anterior: cargan las skills del
   plugin, reciben la vara y no piden nada que ya haya decidido un script.

### 1.1 Lo que NO cambia

- **La tabla no se toca.** Cuatro pasos, seis resultados, los 24 pares y su test
  exhaustivo siguen intactos. Las comprobaciones nuevas viven dentro de
  `controls` y su resultado sigue siendo `done` / `failed` / `indeterminate`.
- **D-4 sigue aplazada y sigue siendo de José.** Nada de esto mete `ct-step` en
  el camino por defecto, y `d4-sigue-siendo-de-jose.test.js` sigue en pie.
- **El juez sigue sin poder ejecutar.** Gana rúbrica, no `Bash`.
- **El gate del plan sigue siendo humano.** Esto endurece lo que pasa *después*
  del gate, no lo sustituye.

---

## 2. Lo medido, no deducido

Todo lo de aquí abajo salió de la primera corrida real de `ct-step` como
oráculo: el slice #5 de `repo-pulse` (UI shell y pulso), 8 tareas, 8 commits,
0 descartes, 45 minutos, y la suite del repo de 113 a 131 tests.

### 2.1 El juez no vetó nunca

Ocho `PASS`. Cero hallazgos `high`, cero `medium`, uno `low` — y ese decía que
`jsdom` declara `engines` más estrecho que el repo, o sea nada sobre el trabajo.

El juez hizo trabajo real: recalculó a mano los números de un test
(`199 - (1/3)*193 = 134.666… → 134.7`) para comprobar que medía la escala
compartida y no un valor copiado del código. Pero con cuatro preguntas abiertas
—hace lo que la tarea decía, es correcto, se queda dentro, encaja con el código
de alrededor— **un veredicto no dice qué se miró**. Ocho `PASS` seguidos son
indistinguibles de ocho tareas bien hechas y de un juez que no encontró dónde
agarrarse. Esa indistinguibilidad es el problema que esta ronda ataca.

### 2.2 La vara existe y no le llega a nadie

`scripts/task-brief` extrae **una tarea**, no el plan. Lo dice `plan-contract.js`
en su propio mensaje de error, al explicar por qué un bloque escrito fuera de una
tarea no sirve de nada.

Consecuencia medida: las secciones §1 *Out of scope*, §2 *Closed decisions*, §3
*Reference patterns* y §5 *Interfaces* **no llegan ni al implementador ni al
juez**. Se escriben, `--check-plan` exige que estén y que no estén vacías, un
humano las lee en el gate, y a partir de ahí no las vuelve a mirar nadie. La
tabla de decisiones cerradas es literalmente una lista de órdenes que sus
destinatarios no reciben.

### 2.3 El plan declara más de lo que se comprueba

`--check-plan` es severo **antes** de implementar: secciones y orden, numeración
sin huecos, presupuestos de líneas y de caracteres, que la configuración no lleve
bloque, que un test no lleve cuerpo, tokens prohibidos, y —la más afilada— que el
bloque `Current state` exista **verbatim** en el fichero real, o es cita de
memoria y el plan se rechaza.

**Después** de implementar, de todo eso solo se usan dos cosas: los comandos de
`**Verification:**` y los nombres de `**Tests:**`. El resto de lo que el plan
declaró con precisión de contrato no se contrasta contra el diff.

### 2.4 Y lo que se comprobaba, se comprobaba con el ámbito equivocado

La comprobación de tests declarados hacía `git grep --cached` sobre **todo el
índice**. Como un plan prescriptivo cita el código verbatim y vive comiteado en
`docs/`, el nombre de cualquier test está siempre presente: el retirado "seguía
estando" (falso positivo, que bloqueó la tarea 1 con el trabajo bien hecho) y el
prometido "ya estaba" aunque nadie lo escribiera (falso negativo, que es el fallo
para el que existe la comprobación). Arreglado en `e4cc3dc`, con sus dos tests en
`cc6a999`.

**La lección que hay que llevarse al diseño de abajo:** toda comprobación nueva
que busque un literal del plan tiene que nacer acotada a lo que la tarea stageó.
El plan está dentro del repo; buscar en el repo es buscar en el plan.

---

## 3. El contrato de datos

### 3.1 El informe: la ruta ya no es una cadena

> **REVERTIDO tras implementarlo (commits `f8ec2a9`, `d2515e6`, `9538af1`).** El `kind` se
> construyó, se usó y se quitó, y el motivo vale más que el campo: **el juez tiene el diff
> delante y distingue un fichero de test de uno de producción sin que nadie se lo diga**. La
> etiqueta no le aportaba nada que no pudiera ver, la producía el agente al que se juzga, no la
> verificaba nadie, y cuando venía mal no degradaba el juicio sino que lo DESACTIVABA: un test
> mal etiquetado como producción dejaba de ser mirado justo por el ítem que busca tests
> debilitados. Los dos ítems que dependían de ella (§7, `manipulacion-tests` y `fixture-theater`)
> se quedan, apuntando al diff. Lo que sigue describe lo que se construyó, no lo que hay hoy.

```
hoy       {"paths": ["web/src/App.tsx"], "summary": "..."}
propuesto {"paths": [{"path": "web/src/App.tsx", "kind": "production"}], "summary": "..."}
```

`kind` es `production` o `test`, y no es documentación: es el único insumo del
check de *fixture theater* —la suite en verde con un diff que no toca producción,
donde el efecto lo da el andamiaje del test y no el código—. Sin la etiqueta, ese
check exige adivinar por la ruta, y adivinar por la ruta es una convención por
repo que el plugin no puede conocer.

Rompe compatibilidad con el informe de hoy, y da igual: el único productor es un
prompt de este repo y el único consumidor es `ct-step report`.

### 3.2 El veredicto: el hallazgo dice qué regla incumple

```
hoy       {"severity": "...", "what": "...", "where": "..."}
propuesto {"rule": "objetivo", "severity": "...", "what": "...", "where": "..."}
```

`rule` es un **enum cerrado** con los nombres de los ítems de §7. Un `rule` que
no esté en la lista descarta el veredicto, igual que hoy lo descarta un `ruling`
inventado. Dos efectos, y el segundo importa más que el primero:

1. La telemetría gana **por qué** se veta, no solo cuánto. `findings_high: 1` no
   dice nada; `rule: manipulacion-tests` dice qué está pasando en el repo.
2. Obliga a mapear cada hallazgo a un ítem, que es lo que impide el hallazgo
   decorativo. Un juez al que se le pide encontrar cosas encuentra alguna; uno al
   que se le pide encajarla en una regla cerrada, menos.

---

## 4. Lo mecánico: cinco comprobaciones nuevas dentro de `controls`

Van **antes** de los comandos y en este orden, que es de gratis a caro. El
patrón ya existe en el fichero: hoy los nombres de test se comprueban primero
"porque son gratis" y los comandos después.

| # | Comprobación | Insumo del plan | Falla cuando |
|---|---|---|---|
| M1 | las rutas tocadas son las declaradas | `**Files:**` | se tocó algo que el plan no declara, o no se tocó algo que sí |
| M2 | `(create)` es un fichero que no existía; `(modify)`, uno que sí | `**Files:**` + git | el plan y el repo no cuentan lo mismo |
| M3 | todo fichero nombrado por un bloque está entre los stageados | `Contract` / `Call site` / `Final text` / `Current state` | se declaró un contrato o un call site que nadie tocó |
| M4 | el test que nombra `**TDD:**` existe en lo que la tarea tocó | `**TDD:**` | el ciclo rojo-verde se declaró y su test no está |
| M5 | el texto de `Final text` aparece verbatim | `Final text` | el entregable textual no es el que el plan fijó |
| M6 | los comandos pasan | `**Verification:**` | lo de siempre |

M6 y los nombres de `**Tests:**` ya existen y se quedan como están: la tabla los
lista para que se vea el orden completo, no porque haya que construirlos.

**Todas se acotan a `run.lastPaths`**, por §2.4.

### 4.1 Lo que deliberadamente NO se mecaniza

**Los símbolos del `Contract`.** Sería el check más apetecible —el plan declara
tipos, firmas y constantes exactas— y exige parsear cualquier lenguaje que use
cualquier repo. Un extractor de identificadores por heurística produce falsos
positivos, y un falso positivo en `controls` bloquea una tarea correcta: es
exactamente el daño de §2.4, otra vez y por gusto. La fidelidad del contrato se
la queda el juez, que sabe leer código.

**Que el tramo de `Current state` ya no esté literal.** Es tentador —si el trozo
que la tarea venía a cambiar sigue idéntico, no se cambió— y la plantilla dice
"ONLY the tramo que changes". Pero nada impide citar dos líneas de contexto
alrededor, y entonces el check dispara con el trabajo bien hecho. Queda fuera de
esta ronda, anotado como candidato si alguna vez `--check-plan` llega a exigir
que la cita sean exclusivamente líneas que cambian.

---

## 5. El brief crece, y detrás de un flag

`task-brief` pasa a aceptar un flag —`--with-plan-context`— que, además de la
tarea, copia al brief las secciones que son vara: §1 *Out of scope*, §2 *Closed
decisions* y §3 *Reference patterns*. Caben: las tres son cortas por contrato del
propio validador.

**El flag no es cosmética, es la frontera.** `task-brief` lo llaman dos caminos:
`ct-step.mjs:297` y el camino por defecto de `subagent-driven-development`. Sin
flag, hacerlo crecer cambia el brief que reciben los implementadores del camino
por defecto — un cambio de comportamiento en el territorio de la decisión que
está aplazada, colado como efecto colateral de un experimento. Con flag, el
camino por defecto recibe byte a byte lo que recibe hoy, y quien quiera adoptar
esto lo adopta como decisión propia.

---

## 6. El implementador

`prompts/task-implementer.md`, reescrito. Cambia en cuatro sitios y en ninguno
más:

1. **Gana la herramienta `Skill`** y con ella la primera línea del ciclo: *carga
   `control-tower-loop:test-driven-development` y síguelo*. Hoy el ciclo son ocho
   palabras dentro del prompt ("escribe el test primero cuando el brief nombre
   uno"); la skill del plugin lo dice entero, incluida su referencia de escribir
   buenos tests. **Se carga la copia del plugin, no la instalada**: el plugin
   promete lo que trae, y en una máquina sin superpowers el prompt no puede pedir
   una skill que no existe.
2. **Recibe la vara y sabe qué manda.** Las decisiones cerradas de §2 son
   órdenes, no opciones: si cree que una se equivoca, la obedece y lo dice en su
   informe. Los patrones de §3 son los ficheros reales a imitar. En conflicto
   entre la tarea y esas secciones, ganan ellas.
3. **Etiqueta cada ruta** con `production` o `test`.
4. **Sabe qué va a medir el programa**, nombrando las comprobaciones de §4. No
   como amenaza: para que no gaste su presupuesto haciendo a mano lo que el
   programa hará igual en cuanto termine. Es la línea de `agentic-skills` que
   merece copiarse entera: una pasada final de la suite completa "por si acaso"
   no añade garantía y sí se come el contexto que necesita hasta el final.

Y lo que **no** gana, aunque el prompt del camino por defecto lo tenga: la
sección de auto-revisión de cuatro bloques. En un flujo donde el implementador se
medía a sí mismo, esa sección es la única red. Aquí mide un programa y juzga otro
agente, así que pedirle además que se auto-evalúe es gastar sus tokens en un
juicio que no vale — el mismo argumento por el que el juez no re-ejecuta los
controles. Lo que sí se conserva es la vía de escape: lo que no se puede hacer
dentro de la tarea se declara en el informe, no se hace a escondidas.

---

## 7. La rúbrica del juez

`agents/ct-judge.md`, reescrito: de cuatro preguntas abiertas a una rúbrica
cerrada que se recorre entera y se reporta ítem a ítem. Los `rule` del enum de
§3.2 son estos ocho:

| `rule` | Qué juzga | Vara |
|---|---|---|
| `objetivo` | el diff entrega el comportamiento que la tarea prometió | `**Objective:**` |
| `asercion-tdd` | el test asserta lo que el plan dijo que fijaba, no una versión debilitada | `**TDD:**` |
| `contrato` | firmas, tipos, errores y valores de constantes son los declarados | `Contract` |
| `decisiones-cerradas` | ninguna decisión de §2 se ha reabierto | §2 |
| `patrones` | se imitó lo que §3 nombra | §3 |
| `manipulacion-tests` | ningún test preexistente se debilitó (líneas `-` de ficheros de test) | regla de hierro |
| `fixture-theater` | el efecto lo da producción, no el andamiaje del test | `kind` del informe |
| `alcance` | nada que la tarea no pidiera, nada de §1 *Out of scope* | `**Files:**` + §1 |

`asercion-tdd` es el ítem que más gana con esto y el que ningún otro flujo puede
tener: el plan escribió **la aserción que fija el límite**, así que el juez no
interpreta un criterio, contrasta contra una frase literal. Es la diferencia
entre "¿este test es bueno?" y "¿este test es el que el plan pidió?".

### 7.1 Las tres reglas de calibración

Portadas de la rúbrica de `agentic-skills`, que las tiene medidas:

- **Un defecto, un hallazgo.** Si un cambio incumple varios ítems, se reporta una
  vez bajo el más específico y los demás se mencionan en el texto. Duplicarlo
  falsea el recuento por severidad, que es lo que alimenta la telemetría.
- **Evidencia antes de bloquear.** Un `high` exige regla, ruta, línea y por qué.
  Si no se puede citar, **se degrada la severidad en vez de bloquear**. A un
  verificador al que se le pide encontrar fallos siempre encuentra alguno; exigir
  la cita es lo que separa el veto real del defensivo.
- **Frontera con lo mecánico.** No se juzga lo que ya decidió un script.

### 7.2 Lo que el prompt prohíbe explícitamente

Cada una de estas produce ruido en **todas** las tareas si no se prohíbe, y un
aviso que sale siempre es un aviso que nadie lee:

- **Re-ejecutar o re-derivar los controles.** Ya corrieron, con código de salida
  autoritativo, antes de invocarlo. "Habría que correr los tests" no es un
  hallazgo.
- **Juzgar el historial de commits.** Una tarea es **un** commit, así que la
  precedencia test-implementación no es observable. Pedirla produce un "no puedo
  constatarlo" en todas las tareas. El ciclo rojo-verde lo garantiza en origen el
  implementador con la skill.
- **Juzgar la higiene del diff o el mensaje del commit.** Lo hace el programa, y
  el mensaje lo compone y valida él.
- **Creerse la narrativa del implementador.** El `summary` del informe explica
  intenciones; lo que se juzga es el diff.

---

## 8. Fronteras y lo que hay que anotar en `FORK.md`

Que el implementador cargue una skill del fork **crea una costura nueva**: a
partir de esto, un cherry-pick de upstream que cambie
`test-driven-development` cambia el comportamiento del implementador de
`ct-step`. Hoy `FORK.md` registra cinco costuras y `skills-fork.test.js` las
vigila; esta es la sexta y necesita su entrada y su guardia.

Dato para quien haga ese cherry-pick algún día: el fork se tomó de superpowers
**6.0.3** y la instalación de esta máquina va por **6.3.0**. Actualizarlo es un
trabajo aparte, con su propio riesgo, y no es este.

---

## 9. Tests que fijan las propiedades

Con los idiomas del repo: `vitest`, un fichero por concepto, fixtures herméticas.
Y con la lección de §2.4 metida en el diseño del test, no solo en el del código:
**el plan de un test que busque literales del plan tiene que estar comiteado**, o
el test pasa con el bug puesto.

| Test | Propiedad |
|---|---|
| `plan-tasks.test.js` | lo que se extrae de más —rutas con acción, nombre del TDD, ficheros de cada bloque, texto de `Final text`— contra el plan real del slice #5 como fixture, no contra la plantilla |
| `ct-step.test.js` | una por comprobación de §4, cada una con su caso rojo y su caso verde; y que **todas** se acotan a lo stageado |
| `step-contracts.test.js` | un informe sin `kind` se descarta; un `kind` inventado se descarta; un `rule` fuera del enum se descarta |
| `task-brief` (nuevo) | sin flag, la salida es **byte a byte** la de hoy; con flag, añade §1, §2 y §3 |
| `skills-fork.test.js` | la costura 6: el implementador sigue cargando la skill del plugin y no la de upstream |
| `d4-sigue-siendo-de-jose.test.js` | sin cambios, y sigue verde |

---

## 10. Riesgos

1. **M1 es el check con más filo y el que más puede molestar.** Un plan que
   olvide listar un fichero en `**Files:**` bloquea una tarea correcta. Es el
   comportamiento deseado —el plan es la vara y arreglarlo es barato— pero la
   primera vez que pase parecerá un bug. El mensaje de error tiene que decir
   claramente que se arregla el plan, no el código.
2. **El juez con rúbrica cerrada puede volverse más ruidoso, no más útil.** Ocho
   ítems por tarea son ocho oportunidades de encontrar algo. La red contra eso
   son las tres reglas de §7.1, y sobre todo la de degradar sin evidencia. Hay
   que medirlo: si la ronda siguiente sale con `medium` en todas las tareas, la
   rúbrica está mal calibrada, no el repo.
3. **Cargar una skill cuesta contexto.** El implementador que carga TDD arranca
   con menos presupuesto para la tarea. Compensa si la skill mejora el trabajo;
   no hay dato todavía, y es lo primero que hay que mirar en la corrida de
   validación.
4. **Nada de esto detecta lo que la corrida del slice #5 no detectó**, porque no
   sabemos qué era. Ocho `PASS` sobre trabajo que parece bueno no prueban que la
   rúbrica vieja fallara. La forma honrada de validar esta ronda es meter a
   propósito una tarea mal implementada y ver si la caza.

---

## 11. Lo que esto NO hace

- No mecaniza los símbolos del contrato (§4.1) ni la desaparición del `Current
  state`.
- No toca la máquina de estados, ni el gate humano del plan, ni el camino por
  defecto.
- No arregla el tercer bug de la corrida: un run entregado sigue dejando el
  estado en `task: N` con `N` commits, así que `next` sobre un run cerrado sigue
  saliendo por 8. Está anotado y es de otra ronda.
- No resuelve D-4. Sigue aplazada y sigue siendo de José.
- No mide dinero. Sin llamadas headless no hay `total_cost_usd`, y eso no cambia
  aquí.
