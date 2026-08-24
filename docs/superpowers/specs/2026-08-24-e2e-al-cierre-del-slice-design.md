# El e2e al cierre del slice — una columna propia, sin cruce con los tests

> 2026-08-24 · **Merge 3**, encadenada tras #32 (`un-solo-go`). Base de esta
> rama: `un-solo-go`, no `main` — así el diff es sólo su propio cambio.
> Viene de 0.40.0.
>
> **El encargo, en una frase:** cuando un slice queda terminado, que se
> atraviese de punta a punta lo que ese slice prometió. **Y su restricción, que
> manda sobre todo lo demás:** si no hay nada que atravesar, se dice y no se
> hace — nunca se inventa un flujo.

## 1. Qué se arregla

Hoy el loop verifica un slice por dos vías, y ninguna comprueba que lo
entregado se pueda **usar**:

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
mecánico que hoy hace un humano, o no hace nadie.

## 2. La decisión de fondo: una columna, no una marca

La primera versión de este diseño marcaba criterios **dentro** de la celda
`Acepta` con un prefijo `[e2e]`. Se descartó al intentar aplicarlo al caso
real, y el motivo es la propiedad más importante de todo el diseño.

Los cuatro `Acepta` del slice `#5` de `mo-monitoring v1`:

1. `GET /metrics del router devuelve las métricas del registry con content type text/plain; version=0.0.4; charset=utf-8`
2. `una fuente de texto adicional registrada aparece concatenada en la respuesta`
3. `el server escucha en 9115 por defecto y en el puerto indicado si se pasa`
4. `en Linux la exposición incluye las series process_*`

Con marcas hay que decidir cuáles llevan la marca, y el 1 y el 2 **hablan de la
respuesta del mismo router**. No hay criterio que los separe: dos personas
congelando el mismo spec marcarían cosas distintas. La marca es la única
barrera contra la invención, y una barrera cuyo criterio de colocación es
difuso no falla en el agente (que sólo obedece marcas) — falla en la calidad de
lo declarado.

**Una columna propia elimina el problema en vez de resolverlo.** No se
clasifica a posteriori un texto que ya existía: se decide al escribir, y en qué
columna se escribe *es* la decisión. La misma entrega produce dos afirmaciones
distintas y ninguna sustituye a la otra:

| Columna | Del `#5` | De qué habla |
|---|---|---|
| `Acepta` | los cuatro criterios de arriba, **sin tocar** | el *router* y el *registry*: unidades |
| `E2E` | `levantado con el example, curl -i :9115/metrics responde 200 con content type text/plain; version=0.0.4 y al menos una serie del registry` | el *binario en pie* |

Y trae tres cosas gratis:

1. **`Acepta` no cambia de significado.** Sigue siendo «EARS, 1:1 con tests»,
   literalmente. Ningún repo ya gobernado hereda un cambio semántico.
2. **El «no aplica» es un guion**, el idioma que ya usan `Dep`, `Protegido`,
   `Área` y `Toca` — reconocido por `isNoValueCell`. Cero juicio.
3. **Ningún cruce con los tests de integración**, que era el requisito. Lo que
   cabe en un test no puede acabar en la columna de travesías por descuido:
   está en otra celda.

**El criterio editorial, en una frase para la plantilla:** *si lo que quieres
comprobar cabe en un test, va en `Acepta`; si necesita el sistema en pie, va en
`E2E`.*

### 2.1 Cuánto se usa esto, medido

Aplicando ese criterio a las 8 filas de `mo-monitoring v1`:

| Slice | ¿Celda `E2E`? | Por qué |
|---|---|---|
| #1 esqueleto | – | sus criterios son comandos de CI |
| #2 modelo y environment | – | tipos y env vars: unidades |
| #3 repositorio prometheus | – | registry en memoria |
| #4 summary collector | – | exposición de un collector: unidad |
| **#5 exposición y exporter** | **sí** | hay que hacer bind de un puerto de verdad |
| #6 logging JSON | – | el formatter se prueba unitariamente |
| #7 instrument y guard | **frontera** | «un log dentro de una transacción APM lleva el mismo trace_id» necesita un APM alcanzable; si el repo no lo declara, es *no-verificado* |
| **#8 golden tests de paridad** | **sí** | «el example compila y **sirve** `/metrics`» |

**Dos filas de ocho, más una frontera.** Se dice aquí porque cambia cómo hay
que juzgar esta feature: en una librería el e2e estará casi siempre vacío, y el
aparato existe para los repos de producto, donde casi toda fila `ui` traerá
celda. Un diseño que produjera seis informes de relleno por epic sería la forma
más segura de que nadie leyera el séptimo.

## 3. El diseño

### 3.1 La columna

Undécima columna de la tabla §9, **opcional**, con `–` para «no aplica»:

```
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | E2E |
```

Una celda puede declarar **varios recorridos**, separados por comas no
escapadas — el mismo troceo que ya usa `Acepta` (`splitEscapedCommas`), y por
la misma razón: un recorrido lleva comas casi siempre.

**Opcional, y su ausencia no se avisa.** `Acepta` y `Entrega` ya son opcionales
(`missingOptionalColumns`), así que el camino existe. Pero `E2E` **no** entra en
esa lista, por el mismo razonamiento que F21 dejó escrito para `Gate`: cada
entrada de `missingOptionalColumns` produce un aviso con la *consecuencia* de
que falte la columna, y la consecuencia de que falte `E2E` es que ningún slice
del epic tiene e2e — que es exactamente el comportamiento de hoy. Avisar de eso
en todos los repos que no usan la feature es ruido puro.

**Retrocompatibilidad gratis:** un spec sin columna `E2E` se comporta byte a
byte como hoy.

**Sin colisión de cabecera.** `col()` resuelve por substring, y `e2e` no es
substring de `#`/`slice`/`tipo`/`entrega`/`dep`/`acepta`/`protegido`/`área`/
`toca`/`gate`, ni ninguna de ésas lo es de `e2e`. Es la misma comprobación que
F21 dejó anotada al añadir `Gate`.

### 3.2 El transporte

| Salto | Mecánica | Estado |
|---|---|---|
| cabecera → índice | `slices.js#col('e2e')` | camino trillado |
| celda → recorridos | `splitEscapedCommas` + `cleanEmphasis` + `isNoValueCell` | **ya funciona**, sin tocar una línea |
| celda → label | `gate:e2e`, **derivada** de que la celda tenga contenido | nuevo |
| celda → issue | sección propia `## E2E` en el cuerpo | cambio en `groom.js` |
| issue → agente | `gates.js#renderGateKickoffLines` | ya existe; un texto nuevo |
| issue → agente re-hidratado | el campo `gates:` de `.agent/SLICE.md`, vía `resolveGatesForAgent` | **gratis**: viene por venir |

**Por qué la label se deriva y no se escribe.** Escrita a mano habría dos sitios
diciendo lo mismo, y dos sitios divergen. Derivada: sin celda no hay label, y
**no hay forma de pedir un e2e sin decir qué atravesar**. Como alguien escribirá
`Gate: e2e` de todos modos (es el error natural, el mismo que
`stripColumnPrefix` ya tolera para `area:`), `e2e` entra en el vocabulario
cerrado de `GATES` para poder **abortar el groom** con un mensaje que lo
explique: «declaraste el gate `e2e` pero la celda `E2E` de esa fila está vacía:
nadie sabría qué atravesar».

`TYPE_GATES` **no se toca**: ningún `Tipo` implica `e2e`. Un slice `ui` no tiene
e2e por ser `ui`; lo tiene si alguien escribió su recorrido.

### 3.3 Lo que declara el repo destino (`AGENTS.md`)

El plugin gobierna repos ajenos y no puede saber cómo se pone en pie uno. En
`rust-monitoring` es `cargo run --example`, un puerto y un `curl`; en el shop es
un navegador contra staging con flags de Unleash. `/ct-init` siembra la sección
**vacía**, igual que ya siembra los encabezados de build/test/lint:

```markdown
## Cómo se atraviesa este repo (e2e)

- Levantar:      <comando>
- Listo cuando:  <señal comprobable>
- Plazo:         <segundos>   # opcional; por defecto 60
- Tirar:         <comando>
- Herramientas:  <curl | la CLI del repo | navegador>
- Fuera de límites: <lo que NO se toca>
```

Cuatro decisiones:

1. **Sólo el entorno, nunca el recorrido.** El recorrido es la celda `E2E`, y
   viaja congelado desde el spec. Si viviera aquí sería editable sin pasar por
   la Puerta 1.
2. **`Listo cuando` es obligatorio y no es un `sleep`.** Sin señal comprobable
   el agente decide por su cuenta cuándo empezar, y un e2e que arranca antes de
   que el servicio levante falla en rojo por una razón que no es el código. Ese
   falso rojo es lo que convertiría esto en ruido. El `Plazo` es opcional con
   defecto de **60 segundos** —defecto porque la mayoría no necesita pensarlo,
   declarable porque quien lo necesita es justo quien no puede vivir con el
   defecto— y agotarlo es *no-verificado*, nunca rojo.
3. **Sección sin rellenar + celda `E2E` con contenido = *no se pudo
   comprobar***, con el nombre de la sección que falta. No se adivina.
4. **`Fuera de límites` existe porque el shop nos da el aviso gratis.** Sus
   cuatro skills repiten «solo STAGING» como guardrail en cada nivel. A un
   agente al que le pides atravesar un flujo y le das credenciales hay que
   decirle dónde no entrar, y el sitio donde se le dice tiene que ser el mismo
   del que saca cómo levantarlo.

### 3.4 La travesía

En el worktree, con los tests ya verdes y antes de abrir el PR:

1. Lee la sección `## E2E` de su issue. Sus recorridos y sólo los suyos.
2. Lee la sección de `AGENTS.md`. Sin ella, todo queda *no-verificado*.
3. Levanta y **espera la señal declarada**. Si no llega en el plazo:
   *no-verificado*, **no rojo** — no ha probado el código, ha fallado el
   entorno, y confundirlos manda a buscar el error donde no está.
4. Recorre cada recorrido con las herramientas declaradas.
5. **Tira el entorno pase lo que pase**, incluido si algo revienta a mitad
   («restore pase lo que pase», del shop, y por las mismas razones).
6. Escribe el informe, lo commitea, abre el PR y pega el informe como
   comentario del PR.

### 3.5 El informe: fichero commiteado y comentario en el PR

Las dos cosas, con precedente exacto: el plan del slice ya se commitea en
`docs/superpowers/plans/` **y** se publica como comentario del issue para el
gate `plan`. Mismo reparto — el fichero es lo que la puerta valida
mecánicamente, el comentario es para que el humano lo lea sin abrir ficheros, en
el sitio donde ya está mirando en la Puerta 3.

Vive en `docs/superpowers/e2e/<issue>.md` — **el número de issue a secas**, sin
slug. Un slug lo derivarían dos partes distintas (el agente al escribir, la
puerta al buscar) y al divergir la puerta diría «falta el informe» sobre un
fichero que existe. El número es el único identificador que las dos partes ya
tienen sin calcular nada — mismo criterio por el que `/ct-next` usa
`.worktrees/<n>` y `feat/<n>`.

Requiere una entrada en `scope.js#LOOP_ARTIFACT_PATTERNS`, y encaja con el
criterio de esa lista («sólo contiene lo que manda EL PLUGIN»): el kickoff lo
ordena, igual que ordena el plan.

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
| **verde** | El recorrido se completa como dice la celda | Adjunta evidencia y libera |
| **rojo** | El recorrido **no** se completa | **No libera.** Para y lo dice |
| **no-verificado** | No se pudo recorrer (entorno, credencial, sección sin rellenar) | Libera, con el motivo escrito en el PR |

El rojo corta por la misma razón por la que el paso 1 de
`finishing-a-development-branch` ya corta con los tests en rojo: un recorrido
declarado del spec que no se completa no es un PR listo para revisar.

El *no-verificado* **no** corta, y es deliberado: un docker que no arranca o una
credencial caducada dejaría el slice en `status:in-progress` reteniendo
`area:`/`touches:` y una plaza de `--cap` sin nadie trabajando — el modo de
fallo que F13 y F18 se dedicaron a quitar. Lo que nunca pasa es que se afirme
verde lo que no se pudo correr: la misma gramática de tres estados que ya
sostiene todo el plugin.

## 4. Contrato

### 4.1 La columna `E2E`

- Cabecera: `E2E` (resuelta por `col('e2e')`, case-insensitive como todas).
- Opcional. Ausente = ningún slice del epic tiene e2e. **No se avisa** (§3.1).
- Celda con marcador de «sin valor» (`–`, `—`, `-`, vacía…) = sin e2e, vía
  `isNoValueCell`. Mismo idioma que `Dep`/`Protegido`/`Área`/`Toca`.
- Varios recorridos por celda, separados por comas no escapadas (`\,` es una
  coma literal). Marcado inline tolerado (`` `curl …` ``) por el mismo criterio
  que el resto de la tabla.
- Un recorrido que quede vacío tras el troceo (dos comas seguidas) se descarta
  en silencio: nunca hubo nada que reportar, mismo trato que `parseGateCell`.
- **La celda no se valida semánticamente.** El plugin no juzga si un recorrido
  es atravesable: eso es la Puerta 1. Lo que sí exige es que exista si la
  columna `Gate` lo declara (§4.3).

### 4.2 La label

- `gate:e2e` se emite si y sólo si la celda tiene al menos un recorrido.
- Entra en `GATE_ORDER` después de `plan` (orden canónico: `visual`, `apply`,
  `plan`, `e2e`).
- `gatesFromLabels` la reconoce en el camino de vuelta, así que sobrevive a un
  redespacho, a un `--reopen` y a un `/clear` — como las otras tres.

### 4.3 `/ct-groom`

- Emite una sección `## E2E` en el cuerpo del issue con los recorridos, uno por
  línea, verbatim. Se emite **sólo** si hay recorridos: a diferencia de
  `## Gates`, «este slice no tiene e2e» no es una afirmación que quien abre el
  PR necesite leer — la ausencia de la sección ya lo dice, y emitirla vacía en
  el 75% de los issues es ruido.
- **Aborta** (sin escribir nada) si `Gate` trae el token `e2e` y la celda `E2E`
  de esa fila está vacía, nombrando la fila.
- `--dry-run` valida exactamente lo mismo.
- `--reconcile` detecta divergencia de la sección `## E2E` como ya hace con las
  demás, y **no la aplica** sin el flag.

### 4.4 El kickoff

Un texto nuevo en `GATES.e2e.kickoff`, con las cuatro cosas que el agente tiene
que saber: que sus recorridos están en la sección `## E2E` de su issue, que no
los elige él, que el entorno lo declara `AGENTS.md`, y que el informe es un
entregable commiteado. **No va en `ADDENDA`**: ver §5.

### 4.5 El informe

Una entrada por recorrido declarado:

```markdown
### <el recorrido, verbatim como está en el issue>
- Veredicto: verde | rojo | no-verificado
- Cómo se levantó: <comando literal>
- Travesía:
      $ <comando ejecutado, literal>
      <su salida, literal>
- Si rojo: qué se esperaba / qué pasó / reproducción mínima copiable / qué lo refutaría
- Si no-verificado: qué faltó / qué lo desbloquearía
```

Lo que el validador exige: una entrada por recorrido declarado (ni una menos),
el título citando el recorrido **verbatim**, un veredicto de los tres, y al
menos un par comando/salida en las verdes. Los cuatro campos del rojo salen del
informe del shop, que pide las mismas cinco cosas por cada defecto de producto
porque sin ellas «el humano vuelve a preguntar».

### 4.6 Códigos de salida de `dispatch-check --release`

Los `0`-`6` están cogidos. La tercera puerta va detrás de las dos que ya hay,
con el orden razonado que ese fichero sostiene —de la avería más cara a la que
sólo retrasa a este slice—: estado (5) → plan (6) → e2e (7/8).

| Situación | Exit | Muta |
|---|---|---|
| No se pudo determinar qué recorridos declara el issue | **7** | nada — «no se afirma que no los tenga» |
| Hay recorridos y falta el informe, o está incompleto | **7** | nada |
| El informe da **rojo** en algún recorrido | **8** | nada — sigue en `status:in-progress` |
| Todo verde, o verde y no-verificado con su motivo | 0 | libera a `in-review` |
| El issue no declara recorridos | 0 | libera |

Dos exits y no uno porque son dos consecuencias distintas para quien los
recibe: el 7 es «vuelve y hazlo», el 8 es «el código no cumple». Fundirlos
obligaría a desambiguar parseando texto libre, que es el defecto que el
contrato de exits de `dispatch-check` vino a cerrar.

La puerta lee el issue por `gh` y **no** `.agent/SLICE.md`, aunque sea local y
gratis: ese fichero es agent-reachable — el propio `dispatch-check` ya
desconfía de su `base:` por eso mismo. Una puerta no puede leer su condición de
un sitio donde escribe quien la tiene que pasar.

**Y lee la sección `## E2E`, no la label `gate:e2e`.** Las dos pueden discrepar
si alguien edita el issue a mano, y manda la sección, porque es la única de las
dos que dice **qué** atravesar. Una label sin sección no describe ningún
trabajo: la puerta libera y lo dice por `stderr` como aviso. Una sección sin
label sí describe trabajo, y la puerta lo exige igual. La asimetría va en la
dirección prudente: el lado que puede pedir trabajo de más nunca se cree solo.

## 5. Reutilización: qué se consume y qué NO se acopla

**Se consume tal cual, misma finalidad:**

| Pieza | Para qué |
|---|---|
| `slices.js#col` y el patrón de columna opcional | Resolver la cabecera `E2E`. `Entrega` y `Acepta` ya recorren ese camino |
| `slices.js#splitEscapedCommas` · `cleanEmphasis` · `isNoValueCell` | Trocear la celda y reconocer el guion. **Ya es** el parser de esta tabla; no se toca una línea |
| `gates.js#GATES` · `GATE_ORDER` · `gateLabels` · `gatesFromLabels` · `renderGateKickoffLines` · `renderGatesIssueContent` | El token con sus dos textos, su label, su orden y su ida y vuelta. Ese fichero existe para esto: «añadir un gate nuevo aquí es un acto deliberado con su texto de kickoff y de issue» |
| El patrón de puerta de `--release` (`stateFilesIntroducedByBranch`, `branchIntroducedFiles`) | La tercera puerta. Ya implementan literalmente los tres estados: `{known:false, why}` → exit propio diciendo que no se ha podido comprobar; incumple → exit propio sin mutar; pasa → sigue |
| `gh-issue-map.js#locateSection` · `extractSectionContent` | Leer la sección `## E2E` del cuerpo del issue, en la puerta y en `--reconcile` |
| `conventions.js#CONTRACT_MARKER_OPEN/CLOSE` y la siembra de `ct-init.sh` | Meter la sección en `AGENTS.md` sin pisar nada, tolerando CRLF |
| El campo `gates:` de `buildStateSeed` | Que una sesión re-hidratada sepa que tiene un e2e pendiente. Gratis: sale de `resolveGatesForAgent` |

**No se acopla, aunque el código sirviera: el propósito es otro.**

1. **`SLICES_CONTRACT_VERSION` + `SLICES_PRISTINE_HASHES`.** Hashean el bloque
   para detectar **si el usuario lo tocó** y decidir si se puede actualizar. La
   sección de e2e de `AGENTS.md` es una **plantilla que el usuario tiene que
   rellenar**: con hashes de pristine, rellenarla se leería como manipulación y
   el plugin dejaría de tocarla justo cuando está bien usada. Propósito opuesto
   con el mismo código. Se toman los marcadores y la siembra; se deja fuera
   versión y pristine. (La versión del **contrato de tabla** sí sube: eso es
   otra cosa, y es su uso legítimo.)
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
7. **La columna `Acepta`.** La tentación era meter el e2e dentro. Ver §2: son
   dos afirmaciones distintas y mezclarlas obliga a un juicio que nadie puede
   hacer de forma reproducible.

## 6. Lo que hace falta construir

| Fichero | Cambio |
|---|---|
| `scripts/slices.js` | La columna `E2E`: índice, troceo, `–`; **no** en `missingOptionalColumns` |
| `scripts/gates.js` | Token `e2e` con sus dos textos; derivar la label de la celda |
| `scripts/groom.js` | La sección `## E2E` del cuerpo del issue |
| `scripts/ct-groom.mjs` | El abort de token-sin-celda, también en `--dry-run` |
| `scripts/reconcile.js` | Divergencia de la sección `## E2E` |
| `scripts/e2e-report.js` (nuevo, puro) | El contrato del informe → `{ok, message, code}` |
| `scripts/dispatch-check.mjs` | La tercera puerta (exits 7 y 8) |
| `scripts/scope.js` | `docs/superpowers/e2e/**` en `LOOP_ARTIFACT_PATTERNS` |
| `scripts/ct-init.sh` | La sección de `AGENTS.md`; contrato de tabla a v19 |
| `skills/finishing-a-development-branch/SKILL.md` | El paso 0, de cinco pasos a seis |
| `commands/ct-groom.md` · `ct-next.md` · `README.md` | Documentar, incluido el límite de §8.1 |

Un solo fichero nuevo: la columna la parsea `slices.js`, que es donde se
parsean las diez que ya hay.

**El paso 0 del carril fijo** pasa a:

```
tests verdes → e2e → commitear informe → push → PR (+ informe pegado) → --release → PARA
                ↓
          rojo: PARA aquí
```

## 7. Tests que fijan las propiedades

1. `col('e2e')` resuelve la columna y no colisiona con ninguna de las diez
   existentes, ni al revés.
2. Un spec **sin** columna `E2E` produce exactamente los mismos issues que hoy,
   y **ningún aviso** por columna ausente.
3. Una celda con `–` (y las seis variantes de `isNoValueCell`) no produce
   `gate:e2e` ni sección `## E2E`.
4. Una celda con dos recorridos separados por coma produce dos; con `\,`
   produce uno con coma literal dentro.
5. `Gate: e2e` con celda vacía aborta el groom, sin escribir nada, nombrando la
   fila.
6. `TYPE_GATES` sigue sin implicar `e2e` para ningún `Tipo`.
7. La label sobrevive la ida y vuelta por `gateLabels`/`gatesFromLabels`.
8. Las 8 filas de `mo-monitoring v1` como caso de mesa: exactamente 2 producen
   `gate:e2e`.
9. `--release` con recorridos y sin informe sale **7** y no mueve la label
   (comprobado sobre el `argv` real de `gh`, como ya se comprueba que
   `/ct-status` no escribe).
10. `--release` con informe en rojo sale **8** y no mueve la label.
11. `--release` con informe verde libera; con verde + no-verificado, libera.
12. `--release` sin recorridos libera sin mirar ningún informe.
13. Un informe al que le falta la entrada de un recorrido es incompleto, aunque
    las que trae estén verdes.
14. Un título que no cita el recorrido verbatim es incompleto.
15. Label sin sección libera con aviso por `stderr`; sección sin label se exige
    igual (§4.6).
16. La sección sembrada en `AGENTS.md` no se pisa si ya existe, y rellenarla
    **no** hace que el plugin deje de reconocerla.
17. La costura del fork sigue vigilada: `skills-fork.test.js` actualizado a
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

Un `Listo cuando` mal escrito produce rojos que no son del código, y un gate que
da falsos rojos se deja de mirar en dos semanas. Mitigación: la señal es
obligatoria y comprobable, y agotar el plazo es *no-verificado*, no rojo. Si en
campo aparecen rojos de entorno, el arreglo es la sección del repo, no relajar
la puerta.

### 8.3 El agente que se examina a sí mismo

Quien implementa aporta la evidencia. Acotado igual que el gate `visual`: el
agente **no cierra el gate**, lo cierra quien revisa. Lo que sí puede es
declarar rojo y pararse — como con los tests.

### 8.4 Un slice atascado por un e2e que no arranca

Cerrado por diseño: *no-verificado* libera. El único estado que retiene es el
rojo, y un rojo es trabajo real pendiente.

### 8.5 La columna se rellena mal, o no se rellena

El riesgo que queda tras separar las columnas no es el cruce: es la **omisión**.
Un epic de producto cuyo autor no rellene `E2E` en ninguna fila pasa por la
Puerta 1 sin que nada lo señale, y esta feature queda inerte para ese epic. No
se cierra en esta fase a propósito: un aviso del tipo «este epic tiene filas
`ui` y ninguna celda `E2E`» es una heurística de texto sobre intención, y F14
dejó documentado lo que pasa con los detectores sensibles («un guard que sólo se
satisface destruyendo trabajo no es un guard»). Se apunta como candidato a la
ronda siguiente, con datos de campo.

### 8.6 Fontanería, dicha antes de empezar

- La rama ya está reasentada sobre `un-solo-go` (`5990363`), y es una rama
  propia: el commit del diseño no está en `un-solo-go` ni en `main`. Si #31 o
  #32 cambian, hay que rebasar otra vez.
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
- **Gestión de flags.** Ni Unleash, ni GrowthBook, ni fases, ni restore. Si un
  recorrido necesita una flag puesta, es *no-verificado* con su motivo.
- **E2E por epic.** Sólo por slice. El e2e del flujo completo cuando el
  milestone cierra es otra decisión y otra ronda.
- **La barandilla contra la falsificación** (§8.1).
- **El aviso por columna sin rellenar** (§8.5).
- **Tocar `visual` ni `apply`.** El residuo que necesita ojos sigue siendo del
  humano.
- **Ejecutar nada contra un entorno real.** Lo que `Fuera de límites` prohíbe se
  respeta, y `apply` sigue siendo el gate de eso.
- **Verificar que el agente respetó el recorrido.** Se valida la forma del
  informe, no la fidelidad de la travesía.

## 10. Versión

Plugin a **0.41.0**. Contrato de la tabla de slices a **v19** (columna `E2E`,
opcional).
