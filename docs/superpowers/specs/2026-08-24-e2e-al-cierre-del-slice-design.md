# El e2e al cierre del slice — lo declarado se atraviesa, lo no declarado no se inventa

> 2026-08-24 · **Merge 3**, encadenada tras #32 (`un-solo-go`). Base de esta
> rama: `un-solo-go`, no `main` — así el diff es sólo su propio cambio.
> Viene de 0.40.0.
>
> **El encargo, en una frase:** cuando un slice queda terminado, que se
> atraviese de punta a punta lo que ese slice prometió. **Y su restricción, que
> manda sobre todo lo demás:** si no hay nada que atravesar, se dice y no se
> hace — nunca se inventa un flujo.

## 1. Qué se arregla

Hoy el loop verifica un slice por dos vías, y ninguna de las dos comprueba que
lo entregado se pueda **usar**:

| Vía | Qué comprueba | Qué no |
|---|---|---|
| La suite del repo | Que las unidades hacen lo que su test dice | Nada sobre el sistema en pie |
| Los gates `visual` / `apply` | Que un humano mire antes de mergear | Nada, si el humano no mira: «los gates se enseñan, no se imponen» |

Auditado sobre el árbol de 0.40.0: **cero referencias a e2e** en `scripts/`,
`commands/`, `skills/` y `README.md`. No hay nada que extender; es superficie
nueva entera.

Y hay un hueco declarado en el propio contrato de la tabla. La regla de celda
#3 dice:

> «`Gate` = residuo de los `Acepta`. Lo observable que *no* puede tener test 1:1
> es exactamente donde entra el humano.»

Ese residuo hoy tiene un solo destino: un par de ojos. Pero una parte de él
**no necesita ojos, necesita que alguien lo recorra** — levantar el servicio y
pedirle la ruta, arrancar el binario y mirar qué expone. Eso es trabajo
mecánico que hoy hace un humano, o no lo hace nadie.

## 2. Lo que ya existe, medido y no deducido

Medido sobre `jjponz/rust-monitoring`, milestone `mo-monitoring v1`, 8 slices,
leyendo sus celdas `Acepta` una por una:

| Slice | Criterios | Atravesables |
|---|---|---|
| #1 esqueleto | 3 | 0 (son comandos de CI) |
| #2 modelo y environment | 4 | 0 |
| #3 repositorio prometheus | 4 | 0 |
| #4 summary collector | 3 | 0 |
| **#5 exposición y exporter** | 4 | **2** — `GET /metrics` con su content type; el server escucha en 9115 |
| #6 logging JSON | 4 | 0 |
| #7 instrument y guard | 5 | 0 |
| **#8 golden tests de paridad** | 3 | **1** — el example compila y **sirve** `/metrics` |

**Dos filas de ocho, y tres criterios de treinta.** El «no aplica» no es el
caso borde: es el caso mayoritario, y un diseño que asuma un e2e por slice
produciría seis informes de relleno por epic — que es la forma más segura de
que se deje de leer el séptimo.

Y el dato que fija la granularidad: en el slice #5, dos de sus cuatro criterios
son atravesables y dos son test de integración. **La frontera no cae entre
filas: cae dentro de la misma celda.**

## 3. El diseño

### 3.1 La marca, en la celda `Acepta`

Un criterio de aceptación puede llevar el prefijo `[e2e]`:

```
| 5 | exposición y exporter | backend | … | #4 | [e2e] GET /metrics del router devuelve
las métricas del registry con content type text/plain; version=0.0.4; charset=utf-8, una
fuente de texto adicional registrada aparece concatenada en la respuesta, [e2e] el server
escucha en 9115 por defecto y en el puerto indicado si se pasa, en Linux la exposición
incluye las series process_* | … |
```

Cuatro criterios, dos marcados. La declaración la hace **un humano al congelar**,
en la sección que ya está leyendo, sobre el texto que ya está escribiendo.

**Por qué aquí y no en una columna nueva.** Una columna `E2E` con el recorrido
en prosa obligaría a escribir dos veces lo mismo —una en `Acepta`, otra allí— y
dos textos que dicen lo mismo divergen. La marca reutiliza el texto que ya
existe y le añade un bit.

**Por qué no un token en la columna `Gate`.** Diría SÍ/NO pero no QUÉ, y el
agente tendría que decidir cuáles de sus criterios son atravesables. Ese juicio
es exactamente el hueco por el que se inventa un flujo, y el encargo lo prohíbe.

**Lo que cambia de significado, y hay que decirlo.** El encabezado que emite
`groom.js` es `## Acceptance criteria (EARS, 1:1 con tests)`. Un criterio
marcado declara **precisamente que no tiene test 1:1**: se verifica
atravesándolo. Es la regla de celda #3 aplicada un paso más allá — el residuo
de los `Acepta` se parte en dos, lo que un agente puede recorrer y lo que sigue
necesitando ojos (`visual`).

**La renuncia es no marcar nada.** Cero marcas en una fila = ese slice no tiene
e2e, y eso no lo juzga nadie: está escrito, o no está.

### 3.2 El transporte, sin parser nuevo

| Salto | Mecánica | Estado |
|---|---|---|
| celda → criterios | `slices.js#splitEscapedCommas` + `cleanEmphasis` | **ya funciona**: `EMPHASIS_CHARS_RE` es `/[\`*]/g`, así que los corchetes sobreviven intactos |
| criterios → label | `gate:e2e`, **derivada** de que haya alguna marca en la fila | nuevo |
| criterios → issue | ya van bajo `## Acceptance criteria`; los marcados se emiten además en su propia sección | cambio en `groom.js` |
| issue → agente | `gates.js#renderGateKickoffLines` | ya existe; un texto nuevo |
| issue → agente re-hidratado | el campo `gates:` de `.agent/SLICE.md`, vía `resolveGatesForAgent` | **gratis**: viene por venir |

**Por qué la label se deriva y no se escribe.** Escrita a mano habría dos
sitios diciendo lo mismo. Derivada: sin marcas no hay label, y **no hay forma de
pedir un e2e sin decir qué atravesar**. Como alguien escribirá `Gate: e2e` de
todos modos (es el error natural, y el mismo que `stripColumnPrefix` ya tolera
para `area:`), `e2e` entra en el vocabulario cerrado de `GATES` para poder
**abortar el groom** con un mensaje que lo explique: «declaraste el gate `e2e`
pero ningún criterio de la fila lleva `[e2e]`: nadie sabría qué atravesar».
Mismo trato que el repo ya da a las contradicciones de esa columna.

`TYPE_GATES` **no se toca**: ningún `Tipo` implica `e2e`. Un slice `ui` no
tiene un e2e por ser `ui`; lo tiene si alguien marcó un criterio.

### 3.3 Lo que declara el repo destino (`AGENTS.md`)

El plugin gobierna repos ajenos y no puede saber cómo se pone en pie uno.
En `rust-monitoring` atravesar el #5 es `cargo run --example`, un puerto y un
`curl`; en el shop es un navegador contra staging con flags de Unleash.
`/ct-init` siembra la sección **vacía**, igual que ya siembra los encabezados
de build/test/lint para que los rellene el dueño del repo:

```markdown
## Cómo se atraviesa este repo (e2e)

- Levantar:      <comando>
- Listo cuando:  <señal comprobable>
- Plazo:         <segundos>   # opcional; por defecto 60
- Tirar:         <comando>
- Herramientas:  <curl | la CLI del repo | navegador>
- Fuera de límites: <lo que NO se toca>
```

Cuatro decisiones dentro de esto:

1. **Sólo el entorno, nunca el guion.** Aquí no se escribe *qué* se atraviesa:
   eso es el criterio marcado, y viaja congelado desde el spec. Si el guion
   viviera aquí, sería editable sin pasar por la Puerta 1.
2. **`Listo cuando` es obligatorio y no es un `sleep`.** Sin una señal
   comprobable el agente decide por su cuenta cuándo empezar, y un e2e que
   arranca antes de que el servicio levante falla en rojo por una razón que no
   es el código. Ese falso rojo es lo que convertiría esto en ruido. El
   `Plazo` es opcional y su defecto son **60 segundos**: tiene defecto porque
   la mayoría de los repos no necesitan pensarlo, y es declarable porque quien
   lo necesita es justo quien no puede vivir con el defecto. Agotarlo es
   *no-verificado*, nunca rojo.
3. **Sección sin rellenar + criterios marcados = *no se pudo comprobar*,** con
   el nombre de la sección que falta. No se adivina y no se afirma verde.
4. **`Fuera de límites` existe porque el shop nos da el aviso gratis.** Sus
   cuatro skills repiten «solo STAGING» como guardrail en cada nivel. A un
   agente al que le pides atravesar un flujo y le das credenciales hay que
   decirle dónde no entrar, y el sitio donde se le dice tiene que ser el mismo
   del que saca cómo levantarlo.

### 3.4 La travesía

En el worktree, con los tests ya verdes y antes de abrir el PR:

1. Lee sus criterios marcados del cuerpo del issue. Los suyos y sólo los suyos.
2. Lee la sección de `AGENTS.md`. Sin ella, todo queda *no-verificado*.
3. Levanta y **espera la señal declarada**. Si no llega en su plazo:
   *no-verificado*, **no rojo** — no ha probado el código, ha fallado el
   entorno, y confundirlos manda a buscar el error donde no está.
4. Atraviesa cada criterio con las herramientas declaradas.
5. **Tira el entorno pase lo que pase**, incluido si algo revienta a mitad
   («restore pase lo que pase», del shop, y por las mismas razones).
6. Escribe el informe, lo commitea, abre el PR y pega el informe como
   comentario del PR.

### 3.5 El informe: fichero commiteado y comentario en el PR

Las dos cosas, con precedente exacto en el repo: el plan del slice ya se
commitea en `docs/superpowers/plans/` **y** se publica como comentario del
issue para el gate `plan`. Mismo reparto — el fichero es lo que la puerta valida
mecánicamente, el comentario es para que el humano lo lea sin abrir ficheros,
en el sitio donde ya está mirando en la Puerta 3.

Vive en `docs/superpowers/e2e/<issue>.md` — **el número de issue a secas**, sin
slug. Un slug lo tendría que derivar alguien del título del slice, y dos
derivaciones distintas (la del agente al escribir, la de la puerta al buscar)
divergen: la puerta buscaría un fichero que existe con otro nombre y diría
«falta el informe». El número es el único identificador que las dos partes ya
tienen sin calcular nada — mismo criterio por el que `/ct-next` usa
`.worktrees/<n>` y `feat/<n>`. Requiere una entrada en
`scope.js#LOOP_ARTIFACT_PATTERNS`, y encaja con el criterio de esa lista («sólo
contiene lo que manda EL PLUGIN»): el kickoff lo ordena, igual que ordena el
plan.

**Y no va al «Registro de cierre (evidencia)» del spec**, aunque esa tabla
exista y `scope.js` ya exima `docs/superpowers/specs/**` para que el slice la
rellene. La razón está escrita en ese mismo fichero: «esta exención deja al
agente escribir en el spec CONGELADO sin que el gate lo vea — y en el incidente
del despacho 1 el agente metió ahí parte de su autorización falsa». Aumentar el
tráfico por un agujero ya documentado como incidente, para meter por él justo
la evidencia de que algo se verificó, es la peor combinación posible. Un
directorio nuevo no abre ningún agujero: nadie más escribe ahí.

### 3.6 Los tres estados

| Estado | Qué significa | Qué hace |
|---|---|---|
| **verde** | El criterio se cumple, atravesado | Adjunta evidencia y libera |
| **rojo** | El criterio **no** se cumple | **No libera.** Para y lo dice |
| **no-verificado** | No se pudo atravesar (entorno, credencial, sección sin rellenar) | Libera, con el motivo escrito en el PR |

El rojo corta por la misma razón por la que el paso 1 de
`finishing-a-development-branch` ya corta con los tests en rojo: un criterio
declarado del spec que no se cumple no es un PR listo para revisar.

El *no-verificado* **no** corta, y es deliberado: un docker que no arranca o una
credencial caducada dejaría el slice en `status:in-progress` reteniendo
`area:`/`touches:` y una plaza de `--cap` sin nadie trabajando — el modo de
fallo que F13 y F18 se dedicaron a quitar. Lo que nunca pasa es que se afirme
verde lo que no se pudo correr: es la misma gramática de tres estados que ya
sostiene todo el plugin.

## 4. Contrato

### 4.1 La marca

- Sintaxis: `[e2e]` al principio del criterio, tras el troceo por comas no
  escapadas. Se tolera marcado inline alrededor (`**[e2e]**`) por el mismo
  criterio con el que `cleanGateToken` tolera `` `visual` ``.
- Case-insensitive. `[E2E]` es la misma marca.
- Una marca en un criterio que no es el primero de la celda vale igual: la
  posición no significa nada.
- Un `[e2e]` **solo**, sin texto detrás, es un criterio vacío: lo rechaza el
  groom (no nombra nada que atravesar).
- Cualquier otro corchete al principio (`[api]`, `[manual]`) **no es una
  marca** y se conserva verbatim como parte del criterio: el vocabulario es
  cerrado, igual que el de gates.

### 4.2 La label

- `gate:e2e` se emite si y sólo si la fila tiene al menos un criterio marcado.
- Entra en `GATE_ORDER` después de `plan` (orden canónico:
  `visual`, `apply`, `plan`, `e2e`).
- `gatesFromLabels` la reconoce en el camino de vuelta, así que sobrevive a un
  redespacho, a un `--reopen` y a un `/clear` — como los otros tres.

### 4.3 `/ct-groom`

- Emite los criterios marcados **también** en una sección propia del cuerpo del
  issue, con su literal, para que el agente no tenga que filtrar la lista.
- **Aborta** (sin escribir nada) si la columna `Gate` trae el token `e2e` y la
  fila no tiene ninguna marca, y si un criterio es un `[e2e]` vacío.
- `--dry-run` valida exactamente lo mismo.

### 4.4 El kickoff

Un texto nuevo en `GATES.e2e.kickoff`, con las cuatro cosas que el agente tiene
que saber: cuáles son sus criterios, que el guion no lo elige él, que el
entorno lo declara `AGENTS.md`, y que el informe es un entregable commiteado.
**No va en `ADDENDA`**: ver §5.

### 4.5 El informe

Una entrada por criterio marcado:

```markdown
### [e2e] el server escucha en 9115 por defecto y en el puerto indicado si se pasa
- Veredicto: verde | rojo | no-verificado
- Cómo se levantó: <comando literal>
- Travesía:
      $ <comando ejecutado, literal>
      <su salida, literal>
- Si rojo: qué se esperaba / qué pasó / reproducción mínima copiable / qué lo refutaría
- Si no-verificado: qué faltó / qué lo desbloquearía
```

Lo que el validador exige: una entrada por criterio marcado (ni una menos), el
título citando el criterio **verbatim** como está en el issue, un veredicto de
los tres, y al menos un par comando/salida en las verdes. Los cuatro campos del
rojo salen del informe del shop, que pide las mismas cinco cosas por cada
defecto de producto porque sin ellas «el humano vuelve a preguntar».

### 4.6 Códigos de salida de `dispatch-check --release`

Los `0`-`6` están cogidos. La tercera puerta va en fila detrás de las dos que
ya hay, con el orden razonado que ese fichero ya sostiene —de la avería más cara
a la que sólo retrasa a este slice—: estado (5) → plan (6) → e2e (7/8).

| Situación | Exit | Muta |
|---|---|---|
| No se pudo determinar qué criterios marcados tiene el issue | **7** | nada — «no se afirma que no los tenga» |
| Hay criterios marcados y falta el informe, o está incompleto | **7** | nada |
| El informe da **rojo** en algún criterio | **8** | nada — sigue en `status:in-progress` |
| Todo verde, o verde y no-verificado con su motivo | 0 | libera a `in-review` |
| El issue no tiene criterios marcados | 0 | libera |

Dos exits y no uno porque son dos consecuencias distintas para quien los
recibe: el 7 es «vuelve y hazlo», el 8 es «el código no cumple». Fundirlos
obligaría a desambiguar parseando texto libre, que es el defecto que el
contrato de exits de `dispatch-check` vino a cerrar.

La puerta lee el issue por `gh` (con `gh-issue-map.js#extractAc`) y **no**
`.agent/SLICE.md`, aunque sea local y gratis: ese fichero es agent-reachable —
el propio `dispatch-check` ya desconfía de su `base:` por eso mismo. Una puerta
no puede leer su condición de un sitio donde escribe quien la tiene que pasar.

**Y lee los criterios del CUERPO, no la label `gate:e2e`.** Las dos pueden
discrepar si alguien edita el issue a mano, y hay que elegir cuál manda: manda
el cuerpo, porque es el único de los dos que dice **qué** atravesar. Una label
sin criterios en el cuerpo no describe ningún trabajo: la puerta libera y lo
dice por `stderr` como aviso. Unos criterios sin label sí describen trabajo, y
la puerta los exige igual. La asimetría es deliberada y va en la dirección
prudente: el lado que puede pedir trabajo de más nunca se cree solo.

## 5. Reutilización: qué se consume y qué NO se acopla

**Se consume tal cual, misma finalidad:**

| Pieza | Para qué |
|---|---|
| `slices.js#splitEscapedCommas` · `cleanEmphasis` · `isNoValueCell` | Trocear `Acepta`. **Ya es** el parser de esa columna; no se toca una línea |
| `gates.js#GATES` · `GATE_ORDER` · `gateLabels` · `gatesFromLabels` · `renderGateKickoffLines` · `renderGatesIssueContent` | El token con sus dos textos, su label, su orden y su ida y vuelta. Ese fichero existe para esto: «añadir un gate nuevo aquí es un acto deliberado con su texto de kickoff y de issue» |
| El patrón de puerta de `--release` (`stateFilesIntroducedByBranch`, `branchIntroducedFiles`) | La tercera puerta. Ya implementan literalmente los tres estados: `{known:false, why}` → exit propio diciendo que no se ha podido comprobar; incumple → exit propio sin mutar; pasa → sigue |
| `gh-issue-map.js#extractAc` + `AC_HEADING_FORMS` | Leer los criterios del cuerpo del issue en la puerta |
| `conventions.js#CONTRACT_MARKER_OPEN/CLOSE` y la siembra de `ct-init.sh` | Meter la sección en `AGENTS.md` sin pisar nada, tolerando CRLF |
| El campo `gates:` de `buildStateSeed` | Que una sesión re-hidratada sepa que tiene un e2e pendiente. Gratis: sale de `resolveGatesForAgent` |

**No se acopla, aunque el código sirviera: el propósito es otro.**

1. **`SLICES_CONTRACT_VERSION` + `SLICES_PRISTINE_HASHES`.** Hashean el bloque
   para detectar **si el usuario lo tocó** y decidir si se puede actualizar. La
   sección de e2e es una **plantilla que el usuario tiene que rellenar**: con
   hashes de pristine, rellenarla se leería como manipulación y el plugin
   dejaría de tocarla justo cuando está bien usada. Propósito opuesto con el
   mismo código. Se toman los marcadores y la siembra; se deja fuera versión y
   pristine.
2. **`ADDENDA` de `kickoff.js`.** Es el sitio obvio, y es **el defecto que F21
   arregló**: hasta esa ronda el único gate del plugin era media frase dentro de
   ese objeto, y eso hacía que `Tipo` decidiera a la vez el recordatorio técnico
   y el gate humano. Hay veinte líneas de comentario explicando por qué se sacó.
   Volver a meter una exigencia ahí es reabrirlo con otra ropa.
3. **`state.js#readBlocked` / `blockNotice`.** Tienta para *no-verificado*: ya
   hay un canal `{reason, unblock}` que el dispatcher lee y reporta. Pero
   `blocked` significa «este slice no avanza», y *no-verificado* **sí libera**.
   Marcarlo `blocked` lo dejaría retenido — el fallo de F18. Se toma el
   **formato** `{reason, unblock}`, no el campo.
4. **`plan-contract.js#checkPlans`.** Valida un artefacto contra un contrato y
   devuelve `{ok, message, code}`. Se copia esa **convención de retorno**
   porque es la del repo; el código no: su contrato son bloques prescriptivos,
   presupuestos de líneas y citas verbatim contra la base de la rama. Valida una
   *promesa*; aquí hay que validar una *evidencia*.
5. **`ct-watch-go.mjs` y `launch-sentinel.js`.** Los dos sondean con timeout
   distinguiendo «no» de «no se pudo preguntar» — la forma que pide
   `Listo cuando`. Pero uno comprueba que un comando arrancó dentro de un pty de
   cmux y el otro sondea la API de GitHub; ninguno es «espera a que un servicio
   local responda». Se hereda el **criterio**, no el código.
6. **El «Registro de cierre (evidencia)» del spec.** Ver §3.5.

## 6. Lo que hace falta construir

| Fichero | Cambio |
|---|---|
| `scripts/e2e-marks.js` (nuevo, puro) | Detectar marcas sobre criterios ya troceados; derivar la label; validar `[e2e]` vacío |
| `scripts/e2e-report.js` (nuevo, puro) | El contrato del informe → `{ok, message, code}` |
| `scripts/gates.js` | Token `e2e` con sus dos textos; el abort de token-sin-marcas |
| `scripts/groom.js` | La sección propia de los criterios marcados en el cuerpo del issue |
| `scripts/ct-groom.mjs` | Los dos aborts nuevos, también en `--dry-run` |
| `scripts/dispatch-check.mjs` | La tercera puerta (exits 7 y 8) |
| `scripts/scope.js` | `docs/superpowers/e2e/**` en `LOOP_ARTIFACT_PATTERNS` |
| `scripts/ct-init.sh` | Sembrar la sección de `AGENTS.md`; subir el contrato de tabla |
| `skills/finishing-a-development-branch/SKILL.md` | El paso 0, de cinco pasos a seis |
| `commands/ct-groom.md` · `ct-next.md` · `README.md` | Documentar, incluido el límite de §8.1 |

**El paso 0 del carril fijo** pasa a:

```
tests verdes → e2e → commitear informe → push → PR (+ informe pegado) → --release → PARA
                ↓
          rojo: PARA aquí
```

## 7. Tests que fijan las propiedades

1. Un criterio marcado sobrevive el troceo y la limpieza de énfasis con sus
   corchetes intactos, incluido `**[e2e]**` y `[E2E]`.
2. Una fila sin marcas no produce `gate:e2e` — con las 8 filas de
   `mo-monitoring v1` como caso de mesa: exactamente 2 la producen.
3. `Gate: e2e` sin marcas aborta el groom, sin escribir nada, nombrando la fila.
4. Un `[e2e]` vacío aborta el groom.
5. `[api]` al principio de un criterio **no** es una marca y se conserva.
6. `TYPE_GATES` sigue sin implicar `e2e` para ningún `Tipo`.
7. La label sobrevive la ida y vuelta por `gateLabels`/`gatesFromLabels`.
8. `--release` con criterios marcados y sin informe sale **7** y no mueve la
   label (comprobado sobre el `argv` real de `gh`, como ya se comprueba que
   `/ct-status` no escribe).
9. `--release` con informe en rojo sale **8** y no mueve la label.
10. `--release` con informe verde libera; con verde + no-verificado, libera.
11. `--release` sin criterios marcados libera sin mirar ningún informe.
12. Un informe al que le falta la entrada de un criterio marcado es incompleto,
    aunque las que trae estén verdes.
13. Un título que no cita el criterio verbatim es incompleto.
14. La sección sembrada en `AGENTS.md` no se pisa si ya existe, y rellenarla
    **no** hace que el plugin deje de reconocerla (el anti-test de §5.1).
15. La costura del fork sigue vigilada: `skills-fork.test.js` actualizado a
    propósito, con el paso 0 de seis pasos.

## 8. Riesgos

### 8.1 La evidencia es falsificable, y se dice

Nada impide que un agente **invente** la salida de un comando. Es la misma clase
de agujero que la #32 ya reconoce sobre el `-OK` («el agente tiene `gh`, así que
puede escribir `-OK` en su propio issue»), y no hay barandilla barata que lo
cierre: el validador comprueba la **forma** del informe, no la veracidad de un
`stdout`.

Lo único que lo acota es que se exige el comando **reproducible por el humano**:
una salida inventada se cae en cuanto alguien lo pega. Va escrito en el README y
en el propio informe. Un límite dicho es operable; uno implícito, no.

### 8.2 El falso rojo por entorno frágil

Un `Listo cuando` mal escrito produce rojos que no son del código, y un gate
que da falsos rojos se deja de mirar en dos semanas. Mitigación: la señal es
obligatoria y comprobable, y el fallo de espera es *no-verificado*, no rojo. Si
en campo aparecen rojos de entorno, el arreglo es la sección del repo, no
relajar la puerta.

### 8.3 El agente que se examina a sí mismo

Quien implementa aporta la evidencia. Acotado igual que el gate `visual`: el
agente **no cierra el gate**, lo cierra quien revisa. Lo que sí puede es
declarar rojo y pararse — como con los tests.

### 8.4 Un slice atascado por un e2e que no arranca

Cerrado por diseño: *no-verificado* libera. El único estado que retiene es el
rojo, y un rojo es trabajo real pendiente.

### 8.5 `Acepta` cambia de significado para todo el mundo

Sube el contrato de la tabla, así que un repo con el contrato viejo y un spec
con marcas produciría criterios con `[e2e]` literal en el issue y ningún gate.
Lo cubre la maquinaria de versión que `ct-init.sh` ya tiene para eso.

### 8.6 Fontanería, dicha antes de empezar

- Esta rama ya está reasentada sobre `un-solo-go` (`5990363`). Si #31 o #32
  cambian, hay que rebasar otra vez.
- `npm test` da **2185/2186** en árbol limpio: el fallo de
  `SLICES_PRISTINE_HASHES` es **preexistente** y toca justo `ct-init.sh`, que
  este cambio modifica. Se verifica antes y después para no atribuirse un rojo
  que ya estaba.
- Nada de `hooks/`, así que no hay que reconstruir `dist/`. Si eso cambia,
  aplica la regla del `dist/`.

## 9. Lo que esta fase NO hace

- **Multiplataforma.** El shop tiene tres skills de plataforma coordinadas por
  un padre con hijos persistentes, barreras por grupo de flags y un solo
  escritor. Aquí hay un agente en un worktree. Cuando haga falta, el patrón está
  descrito y probado ahí.
- **Gestión de flags.** Ni Unleash, ni GrowthBook, ni fases, ni restore de
  flags. Si un criterio necesita una flag puesta, es *no-verificado* con su
  motivo.
- **E2E por epic.** Sólo por slice. El e2e del flujo completo cuando el
  milestone cierra es otra decisión y otra ronda.
- **La barandilla contra la falsificación** (§8.1).
- **Tocar `visual` ni `apply`.** El residuo que necesita ojos sigue siendo del
  humano.
- **Ejecutar nada contra un entorno real.** Lo que `Fuera de límites` prohíbe se
  respeta, y `apply` sigue siendo el gate de eso.
- **Verificar que el agente respetó el guion.** Se valida la forma del informe,
  no la fidelidad de la travesía.

## 10. Versión

Plugin a **0.41.0**. Contrato de la tabla de slices a **v19** (`Acepta` admite
marcas `[e2e]`).
