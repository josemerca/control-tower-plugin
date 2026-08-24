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
2. **El «no aplica» se declara, no se deduce de una celda vacía** (§2.2).
   Cero juicio, y la omisión por descuido deja de ser indistinguible de la
   decisión deliberada.
3. **Ningún cruce con los tests de integración**, que era el requisito. Lo que
   cabe en un test no puede acabar en la columna de travesías por descuido:
   está en otra celda.

**El criterio editorial, en una frase para la plantilla:** *si lo que quieres
comprobar cabe en un test, va en `Acepta`; si necesita el sistema en pie, va en
`E2E`.*

### 2.1 Cuánto se usa esto, medido

Aplicando ese criterio a las 8 filas de `mo-monitoring v1`:

| Slice | Celda `E2E` | Por qué |
|---|---|---|
| #1 esqueleto | `no` | sus criterios son comandos de CI |
| #2 modelo y environment | `no` | tipos y env vars: unidades |
| #3 repositorio prometheus | `no` | registry en memoria |
| #4 summary collector | `no` | exposición de un collector: unidad |
| **#5 exposición y exporter** | **sí** | hay que hacer bind de un puerto de verdad |
| #6 logging JSON | `no` | el formatter se prueba unitariamente |
| #7 instrument y guard | **frontera** | «un log dentro de una transacción APM lleva el mismo trace_id» necesita un APM alcanzable; si el repo no lo declara, es *no-verificado* |
| **#8 golden tests de paridad** | **sí** | «el example compila y **sirve** `/metrics`» |

**Dos filas de ocho, más una frontera.** Se dice aquí porque cambia cómo hay
que juzgar esta feature: en una librería el e2e estará casi siempre vacío, y el
aparato existe para los repos de producto, donde casi toda fila `ui` traerá
celda. Un diseño que produjera seis informes de relleno por epic sería la forma
más segura de que nadie leyera el séptimo.

### 2.2 El «no aplica» se declara: la celda tiene tres estados, no dos

Una celda vacía significaría dos cosas incompatibles: **(a)** se pensó y este
slice no tiene nada que atravesar, y **(b)** nadie rellenó la columna. Las dos
producen el mismo resultado —no hay e2e— y son indistinguibles, así que con
**(b)** la feature queda inerte y nadie se entera.

Es la ambigüedad que `gates.js` ya resolvió para el caso gemelo, y con el mismo
remedio:

> `GATE_LABEL_NONE` — por qué existe una label para decir "ninguno". Sin ella,
> "este issue no tiene ninguna label `gate:`" significaría a la vez dos cosas
> incompatibles: (a) este slice no exige ningún gate, y (b) este issue se
> groomeó ANTES de que los gates existieran.

Con una diferencia que decide el diseño: `gate:none` **lo deriva el plugin**,
mientras que aquí la distinción entre (a) y (b) sólo la sabe quien escribe el
spec. **No hay forma de derivarla**, así que se declara:

| Celda | Significa | Efecto |
|---|---|---|
| uno o más recorridos | hay e2e | label `gate:e2e` + sección `## E2E` |
| `no` (o `n/a`) | **se pensó y no hay** | ningún e2e, y silencio |
| vacía, `–`, `—`, `-` | **no declarado** | `/ct-groom` **aborta**, nombrando la fila |

**Y la columna sigue siendo opcional: si la pones, la rellenas.** Ausente = este
epic no usa la feature, silencio total y retrocompatible byte a byte. Presente =
el autor se ha comprometido a decidir fila por fila, y una celda sin decidir es
una fila a medias, no un defecto.

**Por qué aborta y no avisa.** Un aviso dejaría la ambigüedad viva —los avisos
se ignoran, y F14 documenta lo que pasa con los que se ignoran— y entonces el
token no habría servido para nada. El abort es lo que la elimina. Es el trato
que este repo ya da a lo que no puede desambiguar (token de gate desconocido,
contradicción en la celda `Gate`, colisión de orden), `/ct-groom` valida todo
antes de escribir nada, y `--dry-run` comprueba exactamente lo mismo.

**Por qué la plantilla trae la columna.** El bloque del contrato que `/ct-init`
siembra en `AGENTS.md` la incluye. Así, un spec escrito con la plantilla nueva
la tiene —y por tanto obliga a declarar fila por fila—, y uno anterior no la
tiene y sigue funcionando igual. El bucle se cierra sin ningún guard sobre
intención.

## 3. El diseño

### 3.1 La columna

Undécima columna de la tabla §9, **opcional**, con `no` para «no aplica» —
nunca un guion, que significa «no declarado» y aborta (§2.2):

```
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | E2E |
```

Una celda puede declarar **varios recorridos**, separados por comas no
escapadas — el mismo troceo que ya usa `Acepta` (`splitEscapedCommas`), y por
la misma razón: un recorrido lleva comas casi siempre. O el token `no`, que es
la declaración positiva de que no hay ninguno (§2.2).

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
| issue → agente | `gates.js#renderGateKickoffLines` (el gate) + el kickoff nombra los recorridos | ya existe; un texto nuevo |
| issue → **programa** | el campo `e2e` de `.agent/SLICE.md`, sembrado por `/ct-next` | nuevo — es el que lee `ct-step` (§3.6) |
| issue → agente re-hidratado | el campo `gates:` de `.agent/SLICE.md`, vía `resolveGatesForAgent` | **gratis**: viene por venir |

Los dos últimos saltos son distintos y conviene no confundirlos: el campo
`gates` es **texto legible para un agente** —su propio comentario en
`buildStateSeed` avisa de que «ningún código del plugin decide nada con este
campo»— y el campo `e2e` nuevo sí lo lee un programa. Por eso su forma es una
lista y no una frase, y por eso `--release` no se fía de él (§3.6).

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

### 3.4 El e2e es un paso de la máquina, no una puerta al lado

La #31 (`d4-conductor-como-programa`) convirtió la fase de implementación en una
máquina de estados: `ct-step` es el oráculo y `run-machine.js` la tabla. Por
cada tarea del plan, `implement → controls → judge → commit`; al comitear la
última, el run cierra en `DELIVERED`. Y `dispatch-check --release` **ya exige
ese run entregado** (exit 7, vía `deliveredRun`), con la doctrina de siempre:
*«un prompt no es un gate; esto lo convierte en mecanismo»*.

Con esa máquina delante, un e2e enganchado al lado del `--release` serían **dos
mecanismos en paralelo verificando la misma entrega** — justo lo que la #31
acaba de quitar al hacer que la secuencia la decida una tabla. Así que el e2e es
un paso más:

```
por cada tarea:  implement → controls → judge → commit
                                                  │
                        (última tarea) ────────────┤
                                                   ├─ sin recorridos ──→ DELIVERED
                                                   └─ con recorridos ──→ e2e ──→ DELIVERED
                                                                          │
                                                                          └─ rojo ─→ BLOCKED_E2E
```

Y trae tres cosas ya construidas:

| Necesidad | Lo que ya existe |
|---|---|
| Los tres estados | `OUTCOMES.DONE` / `FAILED` / `INDETERMINATE` — verde / rojo / no-verificado, con esos nombres |
| El cierre en rojo | la familia `BLOCKED_CONTROLS` / `BLOCKED_JUDGE` / `BLOCKED_COMMIT`; se añade `BLOCKED_E2E` |
| El informe ilegible | `OUTCOMES.DISCARDED`, que en `implement` ya repite el paso sin gastar reintento |

**Y no hace falta ninguna puerta nueva para imponerlo:** sin pasar el e2e el run
no llega a `DELIVERED`, así que el exit 7 que `--release` ya tiene lo cubre. La
obediencia es estructural, no un aviso — `ct-step` rechaza con **9** cualquier
verbo que no sea el paso que toca, así que el e2e no se puede saltar ni
adelantar.

### 3.5 El verbo, y quién redacta la evidencia

```
ct-step e2e informe.json --plan <fichero> --issue <n>
```

El agente entrega **datos estructurados**, no prosa: el mismo canal que `report`
y `verdict`, validado por un esquema de `step-contracts.js`. Y el markdown
legible que va al PR **lo escribe el programa**, en
`docs/superpowers/e2e/<issue>.md`.

Ese reparto no es estético, es el mismo que la #31 razonó para el commit:
*«comitea el programa, no el implementador: un veto no deja rastro que
deshacer»*. Si el markdown lo redactara el agente, habría que validar su prosa
—y validar prosa es lo que este repo evita— mientras que un JSON contra un
esquema se comprueba en veinte líneas. De paso desaparece la clase entera de
fallos de formato: no puede faltar un encabezado ni citar mal un recorrido,
porque el programa los copia de la lista que ya tiene.

**Y no va al «Registro de cierre (evidencia)» del spec**, aunque esa tabla
exista y `scope.js` ya exima `docs/superpowers/specs/**`. La razón está escrita
en ese fichero: «esta exención deja al agente escribir en el spec CONGELADO sin
que el gate lo vea — y en el incidente del despacho 1 el agente metió ahí parte
de su autorización falsa». Meter por ese agujero justo la evidencia de que algo
se verificó es la peor combinación posible. Un directorio nuevo no abre ninguno.

### 3.6 De dónde saca el run los recorridos

`ct-step` **no invoca `gh` en ningún sitio**: es local, y sus tests no montan el
fake de `gh`. Así que el run no puede leerse el issue. Los recorridos llegan por
donde ya llegan los gates, y se verifican donde ya se verifica todo:

1. **`/ct-next` los siembra** en `.agent/SLICE.md` al despachar, junto al campo
   `gates` que ya escribe, y en el kickoff. `ct-step` los lee de ahí.
2. **`dispatch-check --release` los verifica contra el ISSUE** (vía `gh`, la
   fuente que el agente no controla): que el run entregado cubra los recorridos
   que el issue declara. **Exit 8**, libre en ese ejecutable.

Los dos, y no uno: `.agent/SLICE.md` es agent-reachable —`dispatch-check` ya
desconfía de su `base:` por eso mismo—, así que como canal de trabajo vale y
como prueba no. El paso 1 es rápido y local; el paso 2 es el que no se fía.

### 3.7 Los tres estados

| Estado | `OUTCOME` | Qué hace la tabla |
|---|---|---|
| **verde** | `DONE` | cierra en `DELIVERED`; `--release` libera |
| **rojo** | `FAILED` | cierra en `BLOCKED_E2E`; `ct-step` sale **7** y `--release` se niega con el 7 que ya tiene |
| **no-verificado** | `INDETERMINATE` | cierra en `DELIVERED` con el motivo escrito; `--release` libera y lo dice |
| informe ilegible | `DISCARDED` | repite el paso, sin gastar reintento (tope de descartes de la slice) |

El rojo corta por lo mismo que corta un control en rojo: un recorrido declarado
por el spec que no se completa no es una entrega. El *no-verificado* no corta y
es deliberado: un docker que no arranca dejaría el slice en `status:in-progress`
reteniendo `area:`/`touches:` y una plaza de `--cap` sin nadie trabajando — el
modo de fallo que F13 y F18 se dedicaron a quitar. Lo que nunca pasa es que se
afirme verde lo que no se pudo correr.

## 4. Contrato

### 4.1 La columna `E2E`

- Cabecera: `E2E` (resuelta por `col('e2e')`, case-insensitive como todas).
- Opcional. Ausente = ningún slice del epic tiene e2e. **No se avisa** (§3.1).
- Celda `no` o `n/a` = **declarado sin e2e**. Case-insensitive, marcado inline
  tolerado (`` `no` ``, `**no**`), y comparado sobre la **celda entera limpia**,
  nunca por prefijo — un recorrido que empiece por «no…» es un recorrido. El
  criterio de comparar la cadena entera y no un prefijo es el que `state.js` ya
  aplica al campo `blocked`, y por el mismo motivo.
- Celda con marcador de «sin valor» (`–`, `—`, `-`, vacía…) = **no declarado**,
  y aborta (§4.3). Ése es el significado que `parseGateCell` ya le da a ese
  marcador —«no he declarado nada aquí»—, así que no se reinterpreta: se toma
  literal y se exige una decisión.
- Celda con el token `no` **y** algún recorrido = contradicción, aborta. Mismo
  trato que `visual` y `!visual` en la misma celda `Gate`.
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
- **Aborta** (sin escribir nada), nombrando la fila, en cuatro casos: la
  columna `E2E` existe y una celda está sin declarar (§2.2); la celda dice `no`
  y además trae un recorrido; `Gate` trae el token `e2e` y la celda dice `no`; y
  `Gate` trae `e2e` con la celda sin declarar. Los cuatro son la misma familia:
  el spec dice dos cosas incompatibles sobre la misma fila.
- `--dry-run` valida exactamente lo mismo.
- `--reconcile` detecta divergencia de la sección `## E2E` como ya hace con las
  demás, y **no la aplica** sin el flag.

### 4.4 El kickoff y la semilla

- Un texto nuevo en `GATES.e2e.kickoff` con las cuatro cosas que el agente tiene
  que saber: que sus recorridos están en `## E2E` de su issue y en su
  `.agent/SLICE.md`, que no los elige él, que el entorno lo declara `AGENTS.md`,
  y que el paso se cierra con `ct-step e2e`. **No va en `ADDENDA`**: ver §5.
- `buildStateSeed` gana un campo `e2e` con los recorridos, por el mismo motivo
  por el que `gates` y `role` son campos y no frases: lo que tiene que sobrevivir
  a una re-hidratación es un campo. A diferencia de `gates`, este sí lo lee un
  programa (`ct-step`), y eso se dice donde se siembra.

### 4.5 El contrato del informe

`E2E_SCHEMA` en `step-contracts.js`, una entrada por recorrido:

```json
{
  "runs": [
    {
      "run": "el server escucha en 9115 por defecto y en el puerto indicado si se pasa",
      "verdict": "verde",
      "brought_up": "cargo run --example serve",
      "evidence": [{ "command": "curl -sS -o /dev/null -w '%{http_code}' localhost:9115/metrics", "output": "200" }]
    }
  ]
}
```

Lo que `readE2eReport` exige: una entrada por recorrido sembrado (ni una menos
ni una de más), `run` **idéntico** al sembrado, `verdict` de los tres,
`evidence` con al menos un par comando/salida si es `verde`, y `reason` +
`unblock` si es `no-verificado` (el formato de `blocked`, no el campo — §5).

- Devuelve un `OUTCOME`, no un booleano: `DONE` si todo verde o
  verde+no-verificado, `FAILED` si algún rojo, `DISCARDED` si el JSON no se
  puede leer. Es la firma de `readVerdict`/`outcomeOfVerdict`, que es la que la
  tabla consume.
- **El rojo gana al mal formado.** Si hay un rojo y además falta una entrada, el
  outcome es `FAILED`: un rojo dice algo del producto y un formato roto dice
  algo del informe; emitiendo lo segundo primero, el agente arregla el formato,
  reintenta y sólo entonces descubre el rojo — dos vueltas para un dato que ya
  se tenía.

### 4.6 Códigos de salida

**`ct-step`** — el mapa salta de 6 a 8, así que el 7 está libre:

| Situación | Exit |
|---|---|
| El paso se aplicó | `0` (`OK`) |
| Algún recorrido en rojo, run en `BLOCKED_E2E` | **`7`** (`E2E_RED`) |
| Se pidió `e2e` sin ser el paso que toca | `9` (`WRONG_STEP`, ya existe) |
| El informe no se puede leer, y se agotaron los descartes | `3` (`NO_VERDICT`, ya existe) |

**`dispatch-check --release`** — los `0`-`7` están cogidos:

| Situación | Exit | Muta |
|---|---|---|
| El run no está entregado (incluye «no pasó el e2e») | `7` | nada — **ya existe** |
| El run está entregado pero no cubre los recorridos que el issue declara | **`8`** | nada |
| No se pudo leer el cuerpo del issue | **`8`** | nada — «no se afirma que no los tenga» |

Un solo exit nuevo en cada ejecutable. Y el orden de puertas de `--release` no
cambia de criterio —de la avería más cara a la que sólo retrasa a este slice—:
estado (5) → plan (6) → run entregado (7) → correspondencia del e2e (8).

**La comprobación del 8 lee la sección `## E2E`, no la label `gate:e2e`.** Las
dos pueden discrepar si alguien edita el issue a mano, y manda la sección porque
es la única que dice **qué** atravesar: una label sin sección no describe ningún
trabajo (se libera, con aviso por `stderr`), y una sección sin label sí lo
describe (se exige igual). La asimetría va en la dirección prudente.

## 5. Reutilización: qué se consume y qué NO se acopla

**Se consume tal cual, misma finalidad:**

| Pieza | Para qué |
|---|---|
| `slices.js#col` y el patrón de columna opcional | Resolver la cabecera `E2E`. `Entrega` y `Acepta` ya recorren ese camino |
| `slices.js#splitEscapedCommas` · `cleanEmphasis` · `isNoValueCell` | Trocear la celda, y reconocer el guion **con el significado que ya tiene** («no he declarado nada aquí», el que documenta `parseGateCell`) para exigir la decisión |
| `gates.js#GATES` · `GATE_ORDER` · `gateLabels` · `gatesFromLabels` · `renderGateKickoffLines` · `renderGatesIssueContent` | El token con sus dos textos, su label, su orden y su ida y vuelta. Ese fichero existe para esto |
| `run-machine.js#after` y su tabla · `OUTCOMES` · `RUN_STATES` | El paso, sus tres resultados y su cierre. **La coincidencia es exacta**: `DONE`/`FAILED`/`INDETERMINATE` ya son verde/rojo/no-verificado, y `BLOCKED_*` ya es la familia del cierre en fallo |
| `step-contracts.js#readVerdict` / `readReport` / `outcomeOfVerdict` | El patrón del artefacto de paso: JSON del agente → esquema a mano (cero dependencias) → un `OUTCOME` que la tabla consume. `readE2eReport` es un hermano, no una copia |
| `ct-step.mjs#EXIT` y su `codigoDe` | El código de salida del paso, con el 7 que está libre en ese mapa |
| `run-metrics.js#metricRow` / `metricLine` | El paso se mide como los otros tres, sin instrumentación nueva |
| `gh-issue-map.js#locateSection` · `extractSectionContent` | Leer la sección `## E2E` del cuerpo del issue, en `--release` y en `--reconcile` |
| `buildStateSeed` | El campo `e2e` en `.agent/SLICE.md`, junto al `gates` que ya siembra |
| `conventions.js#CONTRACT_MARKER_OPEN/CLOSE` y la siembra de `ct-init.sh` | La sección de `AGENTS.md`, sin pisar nada y tolerando CRLF |

**No se acopla, aunque el código sirviera: el propósito es otro.**

1. **`SLICES_CONTRACT_VERSION` + `SLICES_PRISTINE_HASHES`.** Hashean su bloque
   para detectar **si el usuario lo tocó** y decidir si se puede actualizar. La
   sección de e2e de `AGENTS.md` es una **plantilla que el usuario tiene que
   rellenar**: con hashes de pristine, rellenarla se leería como manipulación y
   el plugin dejaría de tocarla justo cuando está bien usada. Propósito opuesto
   con el mismo código. Se toman los marcadores y la siembra. (La versión del
   **contrato de tabla** sí sube: ése es su uso legítimo.)
2. **`ADDENDA` de `kickoff.js`.** Es el sitio obvio, y es **el defecto que F21
   arregló**: hasta esa ronda el único gate del plugin era media frase dentro de
   ese objeto, y eso hacía que `Tipo` decidiera a la vez el recordatorio técnico
   y el gate humano. Volver a meter una exigencia ahí es reabrirlo con otra ropa.
3. **`state.js#readBlocked` / `blockNotice`.** Tienta para *no-verificado*: ya
   hay un canal `{reason, unblock}` que el dispatcher lee y reporta. Pero
   `blocked` significa «este slice no avanza», y *no-verificado* **sí** cierra en
   `DELIVERED`. Marcarlo `blocked` lo dejaría retenido — el fallo de F18. Se toma
   el **formato** `{reason, unblock}`, no el campo.
4. **El paso `controls`.** Ejecuta los comandos que el plan declara y los mide:
   parece el sitio natural para «ejecutar algo y ver si pasa». Pero `controls` es
   **por tarea** y mide lo que el plan prometió (tests, lint) contra el árbol; el
   e2e es **por slice**, contra el sistema levantado, y su guion viene del spec y
   no del plan. Colgarlo de `controls` obligaría a que cada tarea arrastrara un
   e2e que no le corresponde, o a un `controls` especial en la última — que es
   una rama de la tabla que no describe ningún estado real.
5. **`plan-contract.js#checkPlans`.** Valida que el plan cumpla su contrato:
   bloques prescriptivos, presupuestos de línea, citas verbatim contra la base.
   Valida una *promesa*; aquí hay que validar una *evidencia*, y el hermano
   correcto es `readVerdict` (arriba), no éste.
6. **`ct-watch-go.mjs` y `launch-sentinel.js`.** Los dos sondean con timeout
   distinguiendo «no» de «no se pudo preguntar» — la forma que pide
   `Listo cuando`. Pero uno comprueba que un comando arrancó dentro de un pty de
   cmux y el otro sondea la API de GitHub; ninguno es «espera a que un servicio
   local responda». Se hereda el **criterio**, no el código.
7. **El «Registro de cierre (evidencia)» del spec.** Ver §3.5.
8. **La columna `Acepta`.** Ver §2: son dos afirmaciones distintas, y mezclarlas
   obliga a un juicio que nadie puede hacer de forma reproducible.

## 6. Lo que hace falta construir

| Fichero | Cambio |
|---|---|
| `scripts/slices.js` | La columna `E2E`: índice, celda cruda, `e2eColumnPresent`; **no** en `missingOptionalColumns` |
| `scripts/gates.js` | `resolveE2e`, el token `no`, el gate `e2e` derivado y sus dos textos |
| `scripts/groom.js` | La sección `## E2E` del cuerpo del issue |
| `scripts/ct-groom.mjs` | Los cuatro aborts, también en `--dry-run` |
| `scripts/reconcile.js` | Divergencia de la sección `## E2E` |
| `scripts/run-machine.js` | `STEPS.E2E`, `RUN_STATES.BLOCKED_E2E`, la transición terminal y `trasElE2e` |
| `scripts/step-contracts.js` | `E2E_SCHEMA` y `readE2eReport` |
| `scripts/ct-step.mjs` | El verbo `e2e`, su `EXIT.E2E_RED = 7`, y la redacción del markdown |
| `scripts/kickoff.js` | El campo `e2e` de `buildStateSeed` |
| `scripts/ct-next.mjs` | Sembrar los recorridos al despachar |
| `scripts/dispatch-check.mjs` | La comprobación de correspondencia (exit 8) |
| `scripts/scope.js` | `docs/superpowers/e2e/**` en `LOOP_ARTIFACT_PATTERNS` |
| `scripts/ct-init.sh` | La sección de `AGENTS.md`; contrato de tabla a v19 |
| `commands/ct-groom.md` · `ct-next.md` · `ct-step.md` · `README.md` | Documentar, incluido el límite de §8.1 |

**Cero ficheros nuevos.** Cada pieza cae en el módulo que ya hace ese trabajo: la
columna en el parser de la tabla, el paso en la tabla de la máquina, el esquema
en la familia de esquemas de paso, el verbo en el oráculo.

**Y `skills/finishing-a-development-branch/SKILL.md` NO se toca**, al contrario
de lo que decía la versión anterior de este diseño. Esa skill dejó de conducir
el tramo interno cuando la #31 puso a `ct-step` a hacerlo: el carril del e2e lo
impone la tabla, no una lista de pasos en prosa. De paso, esta PR deja de tocar
una de las tres costuras vigiladas del fork.

## 7. Tests que fijan las propiedades

**La columna y su transporte**

1. `col('e2e')` resuelve la columna y no colisiona con ninguna de las diez
   existentes, ni al revés.
2. Un spec **sin** columna `E2E` produce exactamente los mismos issues que hoy,
   y **ningún aviso** por columna ausente.
3. El token `no` (y `n/a`, `NO`, `` `no` ``) no produce `gate:e2e` ni sección
   `## E2E`, y **no** aborta.
4. Un marcador de sin-valor **aborta**, nombrando la fila — pero sólo si la
   columna existe.
5. Un recorrido que empieza por «no…» es un recorrido, no el token.
6. `no` + un recorrido en la misma celda aborta.
7. Dos recorridos separados por coma son dos; con `\,`, uno con coma dentro.
8. `Gate: e2e` sin recorridos aborta (las dos variantes: celda `no` y celda sin
   declarar).
9. `TYPE_GATES` sigue sin implicar `e2e` para ningún `Tipo`.
10. La label sobrevive la ida y vuelta por `gateLabels`/`gatesFromLabels`.
11. Las 8 filas de `mo-monitoring v1` como caso de mesa: con `no` en las seis sin
    recorrido, exactamente 2 producen `gate:e2e` y el groom no aborta.
12. `buildStateSeed` siembra los recorridos, y sobreviven a un redespacho.

**La tabla de la máquina** (pura: se prueba sin disco ni procesos)

13. Comitear la última tarea **con** recorridos deja el run en `step: e2e`,
    `state: open`; **sin** recorridos cierra en `DELIVERED`, como hoy.
14. `e2e` + `DONE` cierra en `DELIVERED`.
15. `e2e` + `FAILED` cierra en `BLOCKED_E2E`.
16. `e2e` + `INDETERMINATE` cierra en `DELIVERED`.
17. `e2e` + `DISCARDED` repite el paso y suma un descarte, sin gastar reintento.
18. `e2e` + `CORRECTIONS_ORDERED` **lanza** — el par que la tabla no describe no
    cae en una rama genérica (la propiedad `_impossible` que el fichero ya
    sostiene).
19. `deliveredRun` sigue exigiendo `closed: 'delivered'`: un run parado en `e2e`
    no está entregado.

**El esquema y el verbo**

20. `readE2eReport` devuelve `DONE` con todo verde; `FAILED` con un rojo;
    `DONE` con verde+no-verificado; `DISCARDED` con JSON ilegible.
21. Falta la entrada de un recorrido → `DISCARDED`, aunque las demás estén
    verdes.
22. Una entrada de más (recorrido que el issue no declara) → `DISCARDED`.
23. Un `run` que no es idéntico al sembrado → `DISCARDED`.
24. Un verde sin `evidence` → `DISCARDED`.
25. **El rojo gana al mal formado**: rojo + entrada que falta → `FAILED`.
26. `ct-step e2e` fuera de su paso sale **9** y dice cuál toca.
27. `ct-step e2e` con un rojo sale **7** y persiste `BLOCKED_E2E`.
28. `ct-step e2e` en verde escribe `docs/superpowers/e2e/<issue>.md` con un
    apartado por recorrido y su evidencia, y el fichero queda stageado.

**La puerta del release**

29. Run entregado que cubre los recorridos del issue → libera.
30. Run entregado que **no** los cubre → **8**, y ninguna llamada de escritura a
    `gh` (comprobado sobre el `argv` real).
31. Cuerpo del issue ilegible → **8**, y el mensaje no afirma que no haya
    recorridos.
32. Issue sin sección `## E2E` → libera sin mirar nada.
33. Label `gate:e2e` sin sección → libera, con aviso por `stderr`.
34. El orden se respeta: una rama que introduce `.agent/STATE.md` sale **5**,
    no 8, aunque además falte el e2e.

**El repo destino**

35. La sección de `AGENTS.md` se siembra con sus campos; rellenarla no hace que
    el plugin deje de reconocerla; no se duplica al correr `/ct-init` dos veces.

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

### 8.5 El `no` que se escribe por inercia

La omisión dentro de un epic que usa la columna está cerrada por §2.2: una celda
sin declarar aborta. Lo que queda es más blando y no tiene arreglo mecánico:
**una columna que exige rellenar diez filas se rellena copiando el `no` de
arriba.** Un `no` escrito sin pensar es indistinguible de uno pensado, y ningún
parser puede separarlos.

Se acota, no se cierra: el `no` es una palabra que hay que **teclear en la fila**
mientras se decide esa fila, no un defecto que se hereda del silencio. Eso es
todo lo que un contrato de tabla puede hacer; el resto es la Puerta 1, que es
humana por diseño. Y hay un límite honesto en la otra dirección: **un epic que no
ponga la columna en absoluto sigue siendo silencioso** — por diseño, porque es
lo que hace esto retrocompatible. Lo compensa que la plantilla del contrato que
`/ct-init` siembra ya la trae (§2.2), así que los epics nuevos nacen con ella.

Un aviso del tipo «este epic tiene filas `ui` y ninguna celda `E2E`» queda
descartado, y no por falta de tiempo: es una heurística de texto sobre intención,
y F14 dejó documentado cómo acaban («un guard que sólo se satisface destruyendo
trabajo no es un guard»). Peor aquí: la única forma de callarlo sería inventarse
un recorrido, que es lo que este diseño existe para evitar.

### 8.6 Esta PR toca la máquina de la #31

`run-machine.js`, `ct-step.mjs` y `step-contracts.js` los introdujo la #31, que
está **abierta y por debajo** en la cadena. Si esa PR se mueve, aquí hay
conflicto — y no en un fichero periférico, sino en la tabla de transiciones.

Se acepta a cambio de no montar un segundo mecanismo en paralelo (§3.4), y se
acota así: la tabla se toca **sólo** para añadir un paso terminal y su estado de
cierre, sin cambiar ninguna transición existente. Un conflicto en un `switch` al
que sólo se le ha añadido un `case` se resuelve leyendo; uno en una transición
reescrita, no.

### 8.7 Fontanería, dicha antes de empezar

- La rama ya está reasentada sobre `un-solo-go` (`5990363`), y es una rama
  propia: el commit del diseño no está en `un-solo-go` ni en `main`.
- **El árbol de `un-solo-go` no es el de `main`.** Trae `ct-step.mjs`,
  `run-machine.js`, `step-contracts.js`, `plan-tasks.js`, `run-metrics.js`,
  `go-response.js` y `ct-watch-go.mjs`, y `--release` ya tiene la puerta del run
  entregado. La primera versión de este diseño se escribió contra la foto de
  `main` y por eso proponía exits ya ocupados y una puerta en paralelo. Antes de
  cada tarea, mirar el fichero real y no este documento.
- `npm test` da **2198/2199** en árbol limpio (medido el 2026-08-24; el
  2185/2186 de la descripción de la #32 es anterior a sus tres últimos commits).
  El fallo de `SLICES_PRISTINE_HASHES` es **preexistente** y toca justo
  `ct-init.sh`, que este cambio modifica: su mensaje lista un hash huérfano, y
  si al acabar lista dos, el segundo es de este trabajo. Un worktree nuevo
  necesita `npm install` antes de cualquier cosa.
- Nada de `hooks/`, así que no hay que reconstruir `dist/`. Si eso cambia,
  aplica la regla del `dist/`.

## 9. Lo que esta fase NO hace

- **Multiplataforma.** El shop tiene tres skills de plataforma coordinadas por un
  padre con hijos persistentes, barreras por grupo de flags y un solo escritor.
  Aquí hay un agente en un worktree. Cuando haga falta, el patrón está descrito y
  probado ahí.
- **Gestión de flags.** Ni Unleash, ni GrowthBook, ni fases, ni restore. Si un
  recorrido necesita una flag puesta, es *no-verificado* con su motivo.
- **E2E por epic.** Sólo por slice. El e2e del flujo completo cuando el milestone
  cierra es otra decisión y otra ronda.
- **La barandilla contra la falsificación** (§8.1).
- **Reintentos del paso e2e.** `controls` y `judge` tienen presupuesto de
  reintento; `e2e` no lo estrena en esta fase: un rojo cierra en `BLOCKED_E2E` y
  lo arregla una persona. Reintentar una travesía contra un entorno que puede
  tener estado sucio es una decisión que merece datos de campo antes que código.
- **Tocar `visual` ni `apply`.** El residuo que necesita ojos sigue siendo del
  humano.
- **Ejecutar nada contra un entorno real.** Lo que `Fuera de límites` prohíbe se
  respeta, y `apply` sigue siendo el gate de eso.
- **Verificar que el agente respetó el recorrido.** Se valida la forma del
  informe, no la fidelidad de la travesía.

## 10. Versión

Plugin a **0.41.0**. Contrato de la tabla de slices a **v19** (columna `E2E`,
opcional).
