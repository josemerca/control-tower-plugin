# El vigilante del merge — diseño

**Estado:** implementado (PR #37, mergeada el 2026-08-26 en `c696257`) y corregido tras revisión adversarial.

Este documento existe porque las decisiones de esta feature vivían sólo en
comentarios de código y en el cuerpo de dos pull requests. Lo pidió una revisión
adversarial, y tenía razón en la sustancia aunque no en la norma que citaba: la
tabla de artefactos del README gobierna el flujo de slices de un repo gobernado,
no toda PR al plugin. Pero el registro de decisiones sí faltaba.

## El problema

La Puerta 3 del loop es humana: cerrar los gates y mergear. Y mergear **no
producía ninguna señal mecánica**. El PR se mergeaba, el issue se cerraba, y la
cosecha de F20 —`.worktrees/<n>`, `feat/<n>` y el `claude` de ese worktree
todavía vivo— se quedaba en disco hasta que la misma persona que había mergeado
iba a la ventana de la sesión coordinadora a decírselo.

El evento estaba escrito en GitHub. Lo que disparaba la cosecha era un recado.

Es la misma avería que el README lista como propia del problema que el loop
ataca: *«el humano se convierte en el bus de mensajes»*. El loop la había
desmontado en la dirección coordinadora→slice (el kickoff, el centinela de
arranque, el vigilante del `-OK`) y no tenía nada en la dirección de vuelta.

## Lo que se descartó, y por qué

### Que el propio implementador se quede vigilando

Es la propuesta más natural —el agente que hizo el trabajo ya conoce su issue,
su rama y su worktree, y los restos que hay que recoger son los suyos— y no
funciona, por un motivo mecánico antes que doctrinal: **una sesión de agente
parada no está ejecutando nada.** Está bloqueada esperando entrada. No puede a
la vez sondear GitHub cada minuto; para hacerlo tendría que estar corriendo un
comando, y entonces no está esperando y tampoco oye a quien le escriba.

Este repo ya tenía la prueba: el vigilante del `-OK` existe exactamente por eso.
El agente que publica su plan y para no puede mirar su propio issue.

Y encima choca con tres cosas escritas:

1. **El reparto de papeles.** La despachada «implementa lo suyo y PARA» (README),
   y `--release` **se niega** (exit 5) si la rama del slice introduce
   `.agent/STATE.md`, porque un slice que se vuelve coordinadora ya llegó a
   `main` tres veces en nueve slices.
2. **F20 identifica ese estado como el defecto que vino a arreglar**, con medida:
   un agente trabajador **trece horas** vivo con su trabajo entregado, y
   `liveness.js#liveSliceProcesses` construido para cazarlo. Si los trabajadores
   tuvieran que quedarse esperando, ese detector daría falsas alarmas siempre.
3. **La escala.** El plazo son 48 horas. Una sesión interactiva abierta dos días,
   por slice.

Lo único que **no** se rompe es la contabilidad del cap: `inFlight` sale de la
label `status:in-progress`, no de los procesos vivos, y tras el `--release` la
label ya es `in-review`. Sobrevive el cálculo; muere la observabilidad.

### Un buzón durable de eventos para la coordinadora

Se consideró y se descartó al comprobar un hecho: **no hay nada que registrar.**
`/ct-next` ya cruza en cada corrida los issues mergeados contra `.worktrees/` y
`git branch --list 'feat/*'` y emite `cosecha pendiente:` con los comandos
exactos. El hecho es enteramente derivable de GitHub más el disco.

Lo que falta no es el conocimiento: **es el disparo.** Nadie hace la pregunta
hasta que una persona invoca algo. Un buzón guardaría algo que ya se sabe
calcular.

### Que la coordinadora se registre

La alternativa robusta a localizarla por directorio: que al hidratarse apunte
cuál es su workspace de cmux, y que el vigilante lea ese registro. Es la mitad
simétrica de lo que el loop ya hace con los slices, y se descarta **por ahora**:
sería estado nuevo, con su caducidad y su «¿sigue vivo eso?», construido para un
solo consumidor. Si aparece un segundo consumidor que necesite alcanzar a la
coordinadora, esto es lo que hay que construir.

### Un segundo canal de entrega (comentario en el issue, notificación)

Descartados como parches: son canales de reparto para un mensaje **que no tiene
dirección**. Añadir canales no arregla una dirección que falta, multiplica los
sitios donde hay que mirar. Y el issue está cerrado cuando esto ocurre —lo cerró
el propio merge—, así que el comentario cae en un hilo que ya nadie abre.

## La decisión

Un proceso desprendido por PR, `scripts/ct-watch-merge.mjs`, lanzado por
`dispatch-check.mjs --release`.

**Por qué lo lanza `--release` y no `/ct-next`.** Es el instante exacto en que
existe un PR abierto esperando un merge humano. Lanzarlo en el despacho pondría
un proceso preguntando por un PR que aún no existe durante toda la
implementación. Va detrás del `setStatus` y por tanto detrás de todas las
puertas, la del nonce de F38 incluida.

**Por qué localiza a la coordinadora por su directorio.** Porque no hay nada que
elegir. El título de una sesión de slice lo *calcula* el loop
(`dispatch.js#cmuxSessionName`: una función pura que `/ct-next` usa para crear la
workspace y el vigilante del `-OK` para encontrarla), y `/ct-next` además
verifica con su centinela que arrancó. A la coordinadora **no la crea el loop**:
la abre una persona en la ventana que le apetezca. No hay título que derivar; el
directorio es la única propiedad observable que queda.

**La precondición que eso impone es una regla de uso**, y está escrita en tres
sitios (la cabecera del script, `commands/ct-next.md`, la nota de la Puerta 3 del
README): la sesión coordinadora tiene que ser una workspace de cmux abierta en el
checkout principal del repo que coordina.

**Lo que la divergencia con `ct-watch-go` compra y lo que no.** Aquél se apaga si
cmux contesta que la sesión del slice no existe; éste no, porque la ausencia de
la coordinadora no es evidencia de que el trabajo haya terminado. Eso compra
sobrevivir a una ausencia **mientras espera**; **no** compra una ausencia **en el
instante de entregar**. La primera versión de la cabecera afirmaba cubrir «te vas
a dormir y el merge llega después», y era la precondición disfrazada de garantía.

**El aviso perdido no es un agujero**, y es la razón de fondo por la que la regla
se acepta en vez de construir el registro: cuando falla, se degrada al modo de
antes —te enteras en el siguiente `/ct-next`— y no a que nadie se entere nunca.
Lo que este vigilante aporta no es el conocimiento: es **el momento**.

## Lo que enseñó el primer despacho real

PR #16 de `jjponz/rust-monitoring`. El vigilante aguantó **9 h 15 min** y **cinco
`gh ETIMEDOUT`** de madrugada sin perder el hilo, y vio el merge **34 segundos**
después de ocurrir. No tuvo a quién decírselo: la ventana de quien coordinaba
estaba abierta en otro repo.

El vigilante hizo lo correcto y lo dijo. El defecto fue que la regla que se
incumplió **no estaba escrita en ninguna parte**, y que el mensaje nombraba el
hecho («no existe ninguna sesión en `<cwd>`») y no la regla — verdad, e inútil.

## Lo que enseñó la revisión adversarial

Cuatro hallazgos sobre la PR #37 ya mergeada. El grave:

**El recorrido de cmux estaba en tres sitios y sólo uno estaba bien.**
`ct-next.mjs` lo tenía endurecido por dos revisiones externas (D5, hallazgo B):
`custom_title` y `current_directory` son nombres de campo *observados*, sin
garantía de esquema, y un campo que no se reconoce degrada a **no concluyente**,
jamás a «verificado que está mal». Los dos vigilantes lo leían a pelo.

Y el remate, que es lo que lo hacía difícil de ver: **la mejora de honestidad del
mensaje empeoró el modo de fallo.** El mensaje viejo era vago; el nuevo nombra la
regla y le dice a la persona qué hizo mal. Con la lectura cruda, un renombrado de
campo convertía eso en una acusación específica, segura y falsa — la clase exacta
de mensaje contra la que existe `ct-next-honest-messages.test.js`.

**Arreglo:** `scripts/cmux.js` como única copia del recorrido, con la guarda, y
los tres consumidores apoyados en ella. El vigilante del `-OK` gana de paso una
robustez que nunca tuvo: antes, un renombrado de `custom_title` le hacía apagarse
con exit 4 declarando muerta una sesión que estaba ahí, y tirando el go de la
persona que lo había dado. Ahí duele más que en el del merge: allí se pierde un
aviso que `/ct-next` recalcula, aquí se pierde el permiso de un humano.

Con `scripts/watch-common.js` para los helpers que estaban copiados (`arg`, el
log, `plazo`, `sleep`). Los **números** de los plazos siguen siendo de cada
vigilante: 30 s / 8 h cubre que una persona duerma, 60 s / 48 h cubre que un PR
espere revisión. Fundirlos sería convertir dos decisiones medidas en una
constante que nadie vuelve a mirar.

## Lo que sigue sin construir, nombrado

- **El registro de la coordinadora** (arriba). Hoy la dirección es una
  inferencia y la precondición es una regla escrita.
- **El reloj.** Todos los hechos dirigidos a la coordinadora que el loop sabe
  computar —el residuo de F20, el «PR mergeado con issue abierto» de F18, los
  claims rancios, los cerrados que conservan su label— se computan **bajo
  demanda**, cuando una persona invoca. Este vigilante es un reloj para uno solo
  de ellos. Si algún día hace falta para varios, lo que toca no es un vigilante
  más: es un proceso por repo que haga esas preguntas y avise cuando la respuesta
  cambie. No está construido y no se propone aquí.
- **El centinela de la entrega.** No hay forma de comprobar que la coordinadora
  recibió la línea: lo único que el log afirma es que `cmux send` y `send-key`
  devolvieron 0. Un centinela de verdad exigiría que ella escribiera algo, o sea
  depender del agente al que se le entrega. Límite heredado de `ct-watch-go` y
  aceptado sin disfraz.
