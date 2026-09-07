# La rúbrica en positivo (#99), medida contra la línea base

La corrida del banco con la rúbrica reescrita en positivo, al lado de la de
[`judge-bench-linea-base-2026-09.md`](judge-bench-linea-base-2026-09.md). Cómo se ejecuta el banco
y qué mide cada columna está en [`judge-bench.md`](judge-bench.md).

Las dos corridas miden **ficheros de agente distintos**, y por eso cada tabla viaja con el sha256
del suyo: el banco mide un fichero, no el plugin instalado, y `git rev-parse` sólo dice en qué
estado del repo se lanzó.

## Qué se midió, exactamente

| | Línea base | #99 |
|---|---|---|
| Fecha | 2026-09-07 | 2026-09-07 |
| Agente juzgado | `plugin/agents/ct-judge.md` | `plugin/agents/ct-judge.md` |
| sha256 del agente | `e03c9420…d6e8c7111e` | `432eb0fb565d911ace273b32bc2ebf67e43e406eac468aee92478ae3ae451864` |
| Tamaño del agente | 27.260 bytes | 27.494 bytes (+0,9 %) |
| Commit del repo | `c5b3659` | `5acabe3` (rama de #99; el agente quedó fijado en `17b13c3`) |
| Versión del plugin | 0.57.0 | 0.57.0 |
| Modelo | opus (del frontmatter) | opus (del frontmatter) |
| CLI | `claude` 2.1.261 | `claude` 2.1.261 |
| Comando | `--agent plugin/agents/ct-judge.md --runs 5` | `--agent plugin/agents/ct-judge.md --runs 5` |
| Casos | los tres de `plugin/__tests__/fixtures/judge-bench/` | los mismos |

**Una sola corrida por versión, y ninguna repetición.** Son 15 llamadas a opus y unos 8,4–8,9 USD
cada una: repetir la de #99 para desempatar un run habría costado otro tanto, así que lo que este
documento afirma se sostiene con N=5 por caso y nada más.

## Las dos tablas

Línea base (`e03c9420…`):

```
caso                       runs  aciertos   descartes  no ejecutados  high  medium  low  coste USD
-------------------------  ----  ---------  ---------  -------------  ----  ------  ---  ---------
concurrencia-sin-hallazgo  5     5 (100%)   0 (0%)     0 (0%)         5     0       0    2.8873
tarea-correcta             5     5 (100%)   0 (0%)     0 (0%)         0     0       0    2.8042
test-inexistente-en-verde  5     5 (100%)   0 (0%)     0 (0%)         5     0       0    2.6730
total                      15    15 (100%)  0 (0%)     0 (0%)         10    0       0    8.3644
```

#99, la rúbrica en positivo (`432eb0fb…`):

```
caso                       runs  aciertos   descartes  no ejecutados  high  medium  low  coste USD
-------------------------  ----  ---------  ---------  -------------  ----  ------  ---  ---------
concurrencia-sin-hallazgo  5     5 (100%)   0 (0%)     0 (0%)         5     0       0    3.0964
tarea-correcta             5     5 (100%)   0 (0%)     0 (0%)         0     0       0    3.0198
test-inexistente-en-verde  5     5 (100%)   0 (0%)     0 (0%)         5     0       0    2.7667
total                      15    15 (100%)  0 (0%)     0 (0%)         10    0       0    8.8829
```

## Caso a caso, y regla a regla

| Eje | Línea base | #99 | Lectura |
|---|---|---|---|
| Aciertos | 15/15 | 15/15 | Igual, en el techo |
| Aciertos por caso | 5/5, 5/5, 5/5 | 5/5, 5/5, 5/5 | Ninguno se mueve |
| Descartes por esquema | 0 | 0 | Igual |
| Runs no ejecutados | 0 | 0 | Igual |
| `high` | 10 | 10 | Igual |
| `medium` / `low` sobre `tarea-correcta` | 0 / 0 | 0 / 0 | Cero vetos defensivos |
| Coste por juicio | 0,5576 USD | 0,5922 USD | +6,2 %, dentro de la banda observada |

Los hallazgos, agregados sobre los quince veredictos de #99:

| Regla | Hallazgos | Severidad | Dónde |
|---|---|---|---|
| `decisiones-cerradas` | 5 | high | los 5 runs de `concurrencia-sin-hallazgo` |
| `asercion-tdd` | 5 | high | los 5 runs de `test-inexistente-en-verde` |
| las otras siete | 0 | — | — |

**Es exactamente el reparto de la línea base**: ni un hallazgo bajo una regla que no fuera la
esperada, ni uno sobre el caso correcto, y los cinco `PASS` de `tarea-correcta` con la lista de
hallazgos vacía.

### El recorrido de la rúbrica: una diferencia, en un run de quince

El paseo por los nueve ítems sale idéntico en catorce de los quince veredictos. En uno
—`concurrencia-sin-hallazgo` run 1— el ítem `contrato` salió **`sin-vara` en vez de `no-aplica`**,
con este `result`:

> El brief no trae ningún bloque 'Contract (path):', 'Current state (path):' ni 'Call site
> (path):'. Hay símbolos que comparar en el diff (ClaimOutcome, Claim, IssueClaim.take) pero la
> sección del brief que fija su firma nombre a nombre no llegó, así que este ítem no tiene con qué
> medirse.

Es una lectura defendible, y probablemente la más fiel al enum: el ítem **tiene** sujeto (hay
símbolos en el diff) y le falta el insumo con el que medirlo, que es la definición literal de
`sin-vara`. La línea base leyó ese mismo caso como `no-aplica` las cinco veces.

**No toca ninguno de los cuatro ejes que el banco compara** —acierto, descarte, severidad, coste—,
pero sí mueve una columna de la telemetría: `rubric_sin_vara` pasa de 0 a 1 en ese intento. Se deja
anotado porque una corrida futura con más `sin-vara` en `contrato` tendría aquí su primer
antecedente, y porque con N=5 un run de diferencia **no es una diferencia**: la resolución del
banco es de 20 puntos por caso.

## El coste, que es el único eje medible al alza

| | Línea base | #99 | Δ |
|---|---|---|---|
| Coste total de la corrida | 8,3644 USD | **8,8829 USD** | +6,2 % |
| Coste por juicio | 0,5576 USD | **0,5922 USD** | +0,0346 USD |
| Rango por juicio | 0,5130 – 0,6065 | 0,5265 – 0,6861 | |
| `concurrencia-sin-hallazgo` (media) | 0,5775 | 0,6193 | +7,2 % |
| `tarea-correcta` (media) | 0,5608 | 0,6040 | +7,7 % |
| `test-inexistente-en-verde` (media) | 0,5346 | 0,5533 | +3,5 % |

La media por juicio, 0,5922, **cae dentro de la banda que la línea base declaró como ruido**
(0,5130–0,6065), así que por su propio criterio esto es «no cambia». Lo que hay que decir junto a
eso, porque es lo que la tabla enseña:

- **Los tres casos suben, y suben a la vez.** Tres medias por encima de su homóloga no es lo que se
  espera del ruido, aunque cada una por separado quepa en la banda.
- **El preámbulo no explica la subida.** Los dos agentes miden casi lo mismo —27.260 bytes contra
  27.494, un 0,9 % más— así que los 0,03 USD de más por juicio se gastan en otro sitio. El candidato
  que la corrida deja sobre la mesa es la SALIDA del juez: una rúbrica que pregunta «cuándo cumple»
  invita a un `result` que **describe lo que se midió**, mientras que una que enumera ausencias
  admite el «no encontré nada» de una línea. Es una hipótesis: comprobarla exige comparar la
  longitud de los `result` de las dos corridas, y los veredictos de la línea base ya no están.
- **El eje que el banco podía premiar es justo éste, y no lo premia.** La línea base decía que «una
  rúbrica más corta que mantenga 15/15 y baje el coste por juicio es una mejora demostrable con este
  banco». Ésta mantiene 15/15 y **sube** el coste: la reescritura de #99 **no** es una mejora
  demostrable, y este documento no la presenta como tal.

## El veredicto sobre el criterio de #99

El criterio, tal y como la línea base lo dejó escrito:

- **Empeora si aparece un solo fallo, un solo descarte o un `medium`/`low` sobre `tarea-correcta`.**
  No aparece ninguno de los tres. → **No empeora.**
- **No cambia si vuelve a salir 15/15 con cero descartes, cero severidades sobre `tarea-correcta` y
  el coste por juicio dentro de la banda.** Las cuatro condiciones se cumplen. → **No cambia.**
- **Mejora: este banco no la puede demostrar**, y la corrida lo confirma por el lado del coste, que
  era el único eje libre.

**La reescritura se mergea porque no empeora nada medible, y su valor se afirma como hipótesis, no
como resultado.** Lo que sí es un hecho comprobable fuera del banco: `ct-judge.md` pasa de 151 a 40
negaciones (`not`/`never`/`cannot`/`no`, sin contar el literal `no-aplica` del enum ni el marcador
`No TDD`), `ct-slice-judge.md` de 88 a 29, `prompts/task-implementer.md` de 56 a 17, y el kickoff
renderizado de 2 a 0 negaciones en mayúsculas. `plugin/__tests__/prompts-en-positivo.test.js` fija
esos recuentos con un umbral.

### Lo que el banco no puede ver, y aquí se declara como hipótesis

Ninguna de estas afirmaciones está medida. Se escriben para que, el día que existan casos más
duros, alguien sepa qué se creía:

1. **La varianza del juez en un repo ajeno.** Los tres casos del banco están saturados; la promesa
   del obstáculo `negative-bleedthrough` es sobre el juicio marginal —el diff que no se parece a
   ninguno de los tres—, y ahí es donde una rúbrica que describe el objetivo debería producir menos
   vetos defensivos. El banco no tiene un solo caso de esa clase.
2. **El coste de un veredicto en el loop real.** Si la hipótesis del `result` más largo es cierta,
   el sobrecoste del 6 % viaja a cada juicio de cada tarea, y a cambio la telemetría recibe un
   recorrido más informativo. Ninguna de las dos mitades está medida.
3. **La rúbrica sigue siendo la más cara de leer del loop.** 27,5 KB de agente por juicio, y el
   juez corre una vez por tarea y otra por reintento.

## Lo que #99 decidió sobre `RUBRIC_OUTCOMES`, y por qué

La línea base dejó anotado, como insumo de esta issue, que `RUBRIC_OUTCOMES`
(`conforme`/`no-aplica`/`sin-vara`) **no tiene valor para «lo medí y no se sostiene»**.

**La corrida de #99 lo confirma sin ambigüedad: en los diez veredictos que archivan un `high`, el
paso de esa misma regla sale `conforme`.** Cinco veces `decisiones-cerradas: conforme` sobre el caso
que bloquea por `decisiones-cerradas`, y cinco veces `asercion-tdd: conforme` sobre el que bloquea
por `asercion-tdd`. La reescritura en positivo **no lo arregla**, y era previsible que no lo
arreglara: el juez no se contradice, es que el enum no tiene dónde ponerlo.

**#99 lo deja fuera a propósito**, por tres razones:

1. **Confundiría la única medida que esta issue tenía.** El criterio de #99 es «no empeora» contra
   una línea base saturada, y se comprueba con **una** corrida de 8,4–8,9 USD. Un cuarto valor en el
   enum cambia el contrato de salida contra el que el juez escribe: si en esa corrida hubiera
   aparecido un descarte o un fallo, no habría forma de atribuirlo entre la reescritura y el enum, y
   no hay presupuesto para una segunda tanda que los separe. Dos variables en un experimento de una
   sola medida es no medir ninguna.
2. **Es un cambio de contrato con su propio radio.** Toca `step-contracts.js` (el enum lo comparten
   `VERDICT_SCHEMA` y `SLICE_VERDICT_SCHEMA`), los dos agentes, `run-metrics.js` y la proyección a
   BigQuery de `harvest-table.js`. Y el precedente del repo dice cómo se hace: un contador nuevo
   nace con su **gemela `*_legacy`** —`rubric_sin_vara` / `rubric_sin_vara_legacy`,
   `findings_severity_legacy`, `rubric_vara_ct_docs_legacy`— para que una fila escrita antes de que
   la columna existiera se lea como «sin medir» y no como un cero. Un `rubric_incumple` sin su
   `rubric_incumple_legacy` haría que todo el histórico afirmara que nunca hubo un ítem incumplido.
3. **Es otro defecto.** El de #99 es de redacción (`negative-bleedthrough`). El del enum es de
   vocabulario: `conventions/defects.md` lo nombra con todas las letras — «un estado ausente es un
   miembro del vocabulario». Merece su issue, su TDD y su propia corrida del banco.

**Lo que debería recoger esa issue**, para quien la escriba: el cuarto valor (`incumple`, o el
nombre que se acuerde) en `RUBRIC_OUTCOMES`; la frase de los dos agentes que lo define y lo separa
de `conforme`; `rubric_incumple` con su gemela `*_legacy` en `run-metrics.js` y en
`harvest-table.js`; y el test que ata el enum del código con el texto de las dos rúbricas, que ya
existe (`step-contracts.test.js`, «los tres valores de outcome están en la rúbrica»). Su criterio de
aceptación natural es que un veredicto con un `high` bajo una regla y `conforme` en el paso de esa
misma regla **se descarte por esquema**, que es la comprobación que hoy no existe.

## Cómo reproducir cada una

```bash
npm ci --prefix plugin
# La línea base
git show c5b3659:plugin/agents/ct-judge.md > /tmp/ct-judge-linea-base.md
node plugin/scripts/judge-bench.mjs --agent /tmp/ct-judge-linea-base.md --runs 5
# La de #99
git show 17b13c3:plugin/agents/ct-judge.md > /tmp/ct-judge-99.md
node plugin/scripts/judge-bench.mjs --agent /tmp/ct-judge-99.md --runs 5
```

Cada una son 15 llamadas a opus. La de la línea base costó 8,3644 USD y la de #99, 8,8829.
