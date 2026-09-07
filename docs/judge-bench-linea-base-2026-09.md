# Línea base del banco del juez — septiembre de 2026

La corrida de referencia contra la que se compara cualquier cambio de la rúbrica, y en
particular la reescritura en positivo que planea #99. Cómo se ejecuta el banco y qué mide cada
columna está en [`judge-bench.md`](judge-bench.md); esto es sólo el resultado y lo que se puede
y no se puede concluir de él.

La corrida anterior era de `--runs 1`. Una corrida de N=1 no es una tasa de acierto: no
distingue un juez fiable de uno que acertó por suerte, que es la propiedad que el banco existe
para medir. Ésta es la primera con N=5.

## Qué se midió, exactamente

| | |
|---|---|
| Fecha | 2026-09-07 |
| Commit del repo | `c5b3659ae32f08f5aefffb2a9f89a52c6036d411` |
| Agente juzgado | `plugin/agents/ct-judge.md` |
| sha256 del agente | `e03c9420ce9ff52ab8d194142e30b8fd9e25a289c887aeda397ed6d7e8c7111e` |
| Versión del plugin | 0.57.0 |
| Modelo | opus (del frontmatter del agente, no heredado de quien lanza) |
| CLI | `claude` 2.1.261 |
| Comando | `node plugin/scripts/judge-bench.mjs --agent plugin/agents/ct-judge.md --runs 5` |
| Casos | los tres de `plugin/__tests__/fixtures/judge-bench/` |

El sha256 del agente es lo que hace comparable esta tabla dentro de tres meses: la corrida mide
un fichero, no el plugin instalado, y `git rev-parse` sólo dice en qué estado del repo se lanzó.

## La tabla

```
caso                       runs  aciertos   descartes  no ejecutados  high  medium  low  coste USD
-------------------------  ----  ---------  ---------  -------------  ----  ------  ---  ---------
concurrencia-sin-hallazgo  5     5 (100%)   0 (0%)     0 (0%)         5     0       0    2.8873
tarea-correcta             5     5 (100%)   0 (0%)     0 (0%)         0     0       0    2.8042
test-inexistente-en-verde  5     5 (100%)   0 (0%)     0 (0%)         5     0       0    2.6730
total                      15    15 (100%)  0 (0%)     0 (0%)         10    0       0    8.3644
```

Los quince runs aciertan: el `ruling` esperado, con un hallazgo bajo la regla que el caso exige.
Cero descartes por esquema y cero runs que no llegaran a ejecutarse.

## La varianza, que es lo que N=1 no podía dar

**Los tres casos salen 5/5. Ninguno se mueve entre corridas, y en ese sentido los tres son
estables.** No hubo un solo caso que alternara veredicto, ni uno que acertara el veredicto por
la regla equivocada, ni uno que se descartara por esquema. La varianza observada del juicio es
cero.

Lo que hay que decir junto a eso, para que la línea base no se lea como más de lo que es:

- **Cero varianza observada no es cero varianza.** Con cinco tiradas, un caso que sale 5/5 es
  indistinguible de un juez que acierta el 55 % de las veces: el límite inferior de confianza
  al 95 % para 5 de 5 es `0,05^(1/5) = 0,549`. Sobre los quince runs agregados el límite sube a
  `0,05^(1/15) = 0,819`. Es decir: esta corrida acredita que el juez acierta **al menos cuatro
  de cada cinco veces en el conjunto de los tres casos**, y poco más que la mitad en cualquiera
  de ellos por separado.
- **La resolución es de 20 puntos por caso.** 4/5 y 5/5 no son distinguibles con esta N, así
  que un solo run de diferencia entre dos corridas no es una diferencia.
- **Un banco saturado no puede mostrar mejora.** Los tres casos están en el techo, los
  descartes en cero y las severidades espurias en cero. Contra esta línea base sólo se puede
  detectar un empeoramiento; una rúbrica mejor daría exactamente la misma tabla.

Lo que sí varía, y poco, es el coste: entre 0,5130 y 0,6065 USD por juicio, un 18 % de
recorrido de extremo a extremo. `concurrencia-sin-hallazgo` es sistemáticamente el más caro
(media 0,5775) y `test-inexistente-en-verde` el más barato (media 0,5346), lo que es coherente
con lo que cada uno obliga a leer.

## Los hallazgos, por regla

Agregados sobre los quince veredictos:

| Regla | Hallazgos | Severidad | Dónde |
|---|---|---|---|
| `decisiones-cerradas` | 5 | high | los 5 runs de `concurrencia-sin-hallazgo` |
| `asercion-tdd` | 5 | high | los 5 runs de `test-inexistente-en-verde` |
| las otras siete | 0 | — | — |

**Ni un solo hallazgo bajo una regla que no fuera la esperada, y ni uno sobre el caso correcto.**
Es la mitad del banco que no aparece en la columna de aciertos: un FAIL por `alcance` sobre un
defecto de `asercion-tdd` cuenta como fallo porque la telemetría del loop agrega hallazgos por
regla, y aquí no hubo ninguno. Los cinco `PASS` de `tarea-correcta` llegan además con la lista
de hallazgos vacía: cero `medium` y cero `low`, o sea cero vetos defensivos, que es el otro
defecto que la rúbrica existe para impedir.

## El coste

| | |
|---|---|
| Coste total de la corrida | **8,3644 USD** |
| Juicios | 15 |
| Coste por juicio | **0,5576 USD** (min 0,5130, max 0,6065) |
| Coste por caso (5 juicios) | 2,67 – 2,89 USD |

**Los 3 USD que estimaba #112 se quedaron cortos por un factor de tres.** La estimación tomó el
coste por juicio de la corrida de N=1 (unos 0,6 USD) y lo multiplicó por cinco, cuando `--runs
5` son 5 juicios **por caso**: quince llamadas a opus, no cinco. La cifra que hay que presupuestar
para repetir este banco es **8,4 USD**, y hay que contarla dos veces —antes y después— cada vez
que se toque la rúbrica.

Sirve también de cota para el loop real, donde el juez corre con opus una vez por tarea y una
vez más por cada reintento: **más de medio dólar por juicio**, y un preámbulo más largo se paga
en cada uno.

## Lo que la corrida reveló del banco

### Uno arreglado: el banco le pedía al juez un token que su agente le prohíbe escribir

El primer intento de esta corrida murió en el primer run con un `TypeError`, después de pagar su
llamada a opus (≈0,55 USD, no recogidos en la tabla de arriba) y antes de escribir una fila.

`judge-dispatch.js` despachaba al juez con una línea que le ordenaba copiar el `Review token:`
del paquete en `review_token`. `ct-judge.md` le dice lo contrario con todas las letras —«There
is no `review_token` for you to write»— desde que `ct-step verdict` pasó a inyectar ese campo él
mismo. El juez obedeció a su agente, omitió el campo, `readVerdict` devolvió `null`, y el banco
comparó ese `null` con el token del caso para componer un mensaje de descarte con `.slice(0, 12)`.

Eran dos defectos en uno: un cráter (un veredicto correcto reventaba el proceso entero) y una
métrica que no medía lo que decía medir (el banco daba al juez una orden que su propio agente le
prohíbe obedecer, y habría contado como descarte lo que en el camino real no lo es). Arreglado en
`c5b3659`: la línea sale del prompt —el banco despacha ahora las mismas tres rutas que anuncia
`ct-step next`, ni una más— y un token ausente vale, mientras que uno **distinto** se sigue
descartando, que es la comprobación que esa línea existe para hacer.

Esta línea base se midió con el banco ya arreglado.

### Uno sin arreglar: el recorrido de la rúbrica dice `conforme` de la regla que acaba de incumplir

En los quince veredictos, **los nueve pasos del recorrido salen `conforme` o `no-aplica`, sin una
sola excepción** — incluidos los diez veredictos en los que el juez archivó un hallazgo `high` bajo
una de esas mismas reglas. `concurrencia-sin-hallazgo` dice `decisiones-cerradas: conforme` y a
continuación bloquea por `decisiones-cerradas`.

No es que el juez se contradiga: es que no tiene dónde ponerlo. `RUBRIC_OUTCOMES` son
`conforme`, `no-aplica` y `sin-vara`, y `ct-judge.md` define `conforme` como «you measured it and
it holds». **No hay valor para «lo medí y no se sostiene».** El enum se diseñó para separar «no se
miró» de «se miró», y esa mitad funciona: `no-aplica` aparece exactamente donde debe (`contrato` y
`manipulacion-tests` en los tres casos, que no tienen sujeto). Pero dentro de «se miró» el
resultado del juicio no cabe, y la consecuencia es que la columna del recorrido de `run-metrics`
lee «nueve ítems que se sostienen» también en los intentos en los que el juez vetó.

No se arregla aquí: el enum es cerrado, lo comparte el juez de slice y lo agrega la telemetría, y
la rúbrica es justo lo que #99 va a reescribir. Queda anotado como insumo de esa issue.

## Qué significa esta línea base para #99

#99 reescribe las nueve reglas en positivo y su criterio de aceptación es que la tasa de acierto
no baje. Con esta línea base en el techo, ese criterio se lee así:

- **Empeora, y no se mergea, si aparece un solo fallo o un solo descarte.** Con la referencia en
  15/15, un único run que falle baja el límite inferior de confianza del 82 % al 68 %, y no hay
  forma de atribuirlo al azar sin gastar otra corrida. Un `medium` o un `low` sobre
  `tarea-correcta` cuenta igual aunque el acierto no se mueva: es un veto defensivo, una vuelta
  pagada al implementador sin defecto que arreglar, y la referencia son cero.
- **No cambia si vuelve a salir 15/15, con cero descartes, cero severidades sobre
  `tarea-correcta` y un coste por juicio dentro del ruido de 0,5576 USD** (el rango observado va
  de 0,5130 a 0,6065; una media fuera de esa banda ya es una señal, en la dirección que sea).
- **Mejora: esta línea base no lo puede demostrar.** Los cuatro ejes que el banco compara
  —acierto, descartes, severidades espurias, coste— están tres de ellos en su suelo o su techo.
  Lo único que queda medible al alza es el coste: una rúbrica más corta que mantenga 15/15 y baje
  el coste por juicio es una mejora demostrable con este banco. Cualquier otra afirmación de
  mejora de #99 exige **casos nuevos y más duros** —los que hoy el juez fallaría— y ésos hay que
  escribirlos antes de tocar la rúbrica, no después de ver el resultado.

Dicho de una vez: **este banco es hoy una barandilla contra la regresión, no una vara para la
mejora.** Es exactamente lo que #99 necesita para no mergear a ciegas, y no basta para poder
afirmar que la reescritura mejoró nada.

## Cómo reproducirla

```bash
npm ci --prefix plugin
git show c5b3659:plugin/agents/ct-judge.md > /tmp/ct-judge-linea-base.md
node plugin/scripts/judge-bench.mjs --agent /tmp/ct-judge-linea-base.md --runs 5
```

Son 15 llamadas a opus y unos 8,4 USD. La salida íntegra de esta corrida, run a run con su
coste, es la de la sección «La tabla» más los quince renglones de progreso que el banco escribe
por `stderr`; los briefs, paquetes y veredictos quedan en el directorio temporal que el banco
imprime al terminar.
