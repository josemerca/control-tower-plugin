# La vara de ct, agnóstica — lo que el backend aprendió sube al plugin

> Continúa `2026-08-26-la-vara-la-dicta-ct-design.md`. Aquélla decidió que ct
> empaqueta sus propias convenciones, que viajan con el plugin y que ganan
> regla a regla sobre las del repo destino; funciona y no se relitiga nada de
> ella. Lo que esto añade es **contenido**: las reglas que `backend/` pagó una
> a una y que hoy no salen de este repositorio.
>
> El problema que cierra: **quien use el loop en su propio repo recibe una vara
> más corta que la que este repositorio se aplica a sí mismo.** Las cinco
> convenciones del plugin no dicen nada sobre qué no se añade, sobre el nombre
> de un port, sobre la invariante de un value object, sobre cortar un adaptador
> antes del sistema externo ni sobre mutar para saber qué mide la suite. Todo
> eso está escrito, medido y pagado — en `backend/conventions/`, donde no lo
> lee nadie más.

---

## 1. El problema

`backend/conventions/` tiene seis documentos y una precedencia declarada, y su
README dice por qué existe: *el harness que escribe este código no puede
aprender, así que una convención que no se carga en la sesión no mide nada*. Ese
argumento no es específico del backend. Es el mismo por el que la vara de ct
viaja con el plugin.

La consecuencia de que no viaje se ve al comparar los dos alcances. Hoy, un
slice ejecutado en un repositorio ajeno mide contra cinco documentos que
cubren: qué defectos no entran, cómo se escribe el código, dónde vive una
decisión, dónde vive cada cosa cuando el módulo es nuevo, y qué clava un test.
No mide contra nada de esto:

- La carga de la prueba de lo que se añade. Un campo, una rama, un `export` o
  una guarda que responden a una llamada que no existe entran limpios.
- El nombre de un port que habla el idioma de la herramienta que hay detrás.
- La invariante que un value object guarda para sí, y la segunda opinión que no
  le corresponde.
- Que un fallo del sistema externo vuelva como dato, salvo cuando el módulo es
  nuevo — porque esa regla vive hoy en `architecture.md`, cuyo alcance es
  `new modules`.
- Cortar el adaptador justo antes del sistema externo, y la excepción del
  adaptador que *es* la llamada.
- La barrida de mutación, que es lo único que encuentra la línea que ningún
  test mira.

Y hay un segundo problema, independiente del primero y anterior a él: **los
cinco documentos de hoy no están acoplados a JavaScript, están acoplados a un
programa de línea de comandos.** `architecture.md` tiene una sección
`The entrypoint` que mapea los errores del dominio a códigos de salida, con el
resultado en el canal estándar y el diagnóstico en el de error, y su sección del
borde exige un tope para cada llamada a un *proceso* externo. En un Django o un
FastAPI no hay ninguna de las dos cosas: hay un servidor, un manejador de
excepciones, un timeout de HTTP y un `statement_timeout`. La regla que importa
—un código por decisión de quien recibe, ningún sistema externo sin tope— es
válida en las dos formas; la redacción sólo conoce una.

## 2. La decisión

**Lo que es regla general sube a `plugin/conventions/` y viaja con el plugin;
lo que es este repositorio se queda en `backend/`; y la vara se reescribe para
que no presuponga la forma del programa.**

Tres decisiones cerradas antes de escribir esto, con su motivo:

1. **Agnóstica de lenguaje.** Nada de `vitest`, `execFile`, `.mjs` ni
   `Object.freeze` en la vara. Las reglas se escriben sobre conceptos —el
   sistema externo, el borde, el doble— y los documentos siguen en inglés, como
   el resto de la vara y como `style.md` exige.
2. **El eje es la tecnología, y hoy sólo hay backend.** Habrá convenciones de
   frontend y de nativos más adelante. Cuando lleguen, ése será el momento de
   decidir cómo se selecciona una vara por tecnología; **hoy no se construye ese
   mecanismo**, porque un selector con un solo valor no selecciona nada. Los
   documentos nuevos declaran `Applies to: every diff` y viajan siempre, como
   `defects.md` y `style.md`.
3. **La barrida de mutación sube, y el juez la exige.** Es la regla que
   encuentra lo que ocho revisiones de diff no vieron. Se acepta a sabiendas de
   que hoy el loop no muta por su cuenta: quien implementa muta a mano y lo
   declara, y el juez mide la declaración y su contenido, no la ejecución.

## 3. El mapa: qué sube y a qué documento

Tres documentos nuevos y dos que crecen. El reparto no es por origen (de qué
fichero de `backend/` venía) sino por responsabilidad, que es lo que permite que
el juez cite el documento correcto y lo que evita que un documento crezca hasta
que nadie lo lea entero.

### 3.1 `conventions/simplicity.md` — nuevo, todo diff

Una regla y las formas que toma: **la carga de la prueba está en lo que se
añade, y se descarga contra el problema que se resuelve hoy.** "Podría hacer
falta algún día" no la descarga.

- La guarda vive en la puerta por donde el valor entra desde fuera. Aguas abajo
  de esa puerta todo llamante es código propio, y una segunda opinión sobre el
  mismo contenido defiende de un llamante que no existe y trae tests que sólo
  pueden fallar si falla el lenguaje.
- Un campo que cruza una capa, un parámetro con valor por defecto, una rama para
  un estado, un método hecho público, un símbolo exportado: cada uno responde a
  un llamante que está en el árbol hoy. La pregunta que lo decide: **qué llamada
  se rompe sin esto.**
- Un check inalcanzable no es un check. Una condición sobre un estado que el
  código no puede alcanzar no protege nada y hace que el siguiente lector se
  defienda del mismo fantasma. Una mutación que sobrevive tiene dos reparaciones
  posibles, no una: el test que nadie escribió o la línea que nadie necesita, y
  cuál de las dos lo decide `testing.md`.
- La observabilidad responde a un lector que existe. Una línea de log, una
  métrica, una traza, un campo de una respuesta: cada uno nombra **quién lo lee
  y qué hace distinto por haberlo leído**. Lo que existe sólo para producirla
  —el escritor inyectado para eso, sus tests— se va con ella.
- **Una petición de una revisión, de una verificación o de un juicio no exime.**
  Nada de una revisión hace alcanzable una guarda ni le da un llamante a un
  campo. Donde la carga no se puede descargar, la petición vuelve como hallazgo
  para que la decida una persona, y no se implementa mientras tanto.
- Y el cortafuegos, porque sin él este documento se lee como permiso: **nada de
  esto autoriza saltarse una capa.** Las capas, los ports y los value objects
  son cómo se construye, no complejidad que recortar. Lo que se recorta es lo
  que defiende de lo que no puede pasar.

**Y una frontera que este documento tiene que declarar, porque si no la declara
el juez cuenta el mismo defecto dos veces.** El ítem `alcance` de la rúbrica ya
pregunta qué frase de la tarea pide cada cosa; este documento pregunta qué
llamada se rompe sin ella. Son dos preguntas distintas —un plan puede pedir un
campo que ningún llamante usa, y ése es de este documento— pero se solapan en la
superficie, y `agents/ct-judge.md` prohíbe expresamente archivar un defecto en
dos ítems porque falsea la cuenta por regla. La declaración va en la sección de
lo que otros documentos poseen. Hay además una restricción mecánica que la
redacción tiene que respetar: `conventions-vara.test.js` prohíbe que cualquier
documento de la vara contenga las palabras con las que la rúbrica describe ese
ítem, así que la frontera se escribe sin ellas.

### 3.2 `conventions/domain.md` — nuevo, todo diff

- **El dominio no habla el idioma de ninguna herramienta.** El port declara lo
  que el dominio necesita, no lo que el adaptador sabe hacer, y el nombre es
  donde esa regla se gana o se pierde. El test que lo decide: si cambiar el
  adaptador por otra implementación convierte el nombre en mentira, el nombre es
  del adaptador. Los dos casos que lo pagaron viajan en una línea y sin los
  nombres de este repositorio: un tipo nombrado por lo que reparte la
  herramienta de sesiones cuando el dominio necesitaba *quien planifica*, y otro
  nombrado por lo que vende el gestor de incidencias cuando el dominio
  necesitaba *la historia a planificar*.
- **Un port por colaborador, creciendo con métodos.** El port corta por quién
  está al otro lado, nunca por paso del flujo: cuando el flujo gana un paso
  contra un colaborador que ya tiene, el port gana un método.
- **El colaborador se identifica por lo que se le pide, no por el ejecutable o
  el servicio que responde.** Dos ports que acaban llamando al mismo binario o
  al mismo host son un solo colaborador sólo si le preguntan lo mismo; cuando
  las preguntas son distintas son dos, y unirlos juntaría lo que no comparte más
  que una ruta. Lo que nunca se duplica es la intención: la misma pregunta hecha
  desde dos sitios, o la misma regla decidida dos veces (`decisions.md`). La
  forma repetida no es el asunto; la intención repetida sí.
- **El value object guarda lo que lo hace *ese* valor y no cualquier valor**,
  citando lo que recibió, y queda congelado en construcción. Esa guarda es su
  razón de existir y se queda aunque los llamantes de hoy ya la satisfagan. Lo
  que no le corresponde es re-verificar lo que el tipo de su propio argumento ya
  garantiza: eso no añade invariante, porque el tipo que pregunta ya la lleva.
- **Las excepciones se separan en familias de dos causas**, porque se reparan en
  sitios distintos: el sistema externo falló (la razón está en su canal de
  error) y el sistema externo contestó algo que no sabemos leer (nuestro
  contrato con él se rompió). Quien no distingue captura la familia; el borde
  proyecta cada causa a su propio código.

### 3.3 `conventions/boundaries.md` — nuevo, todo diff

- **Quien llama declara si su llamada es segura de repetir.** Una lectura lo es;
  una creación no —una respuesta perdida puede ser una respuesta que creó el
  recurso, y el reintento crea el segundo—. Sólo los fallos transitorios de las
  llamadas repetibles se reintentan, y sobre el presupuesto de una policy.
- **El tronco sabe el idioma de la red; la especialización, el de su sistema.**
  Los marcadores genéricos (conexión cerrada, timeouts, DNS, 5xx) viven una vez;
  lo que sólo escribe un sistema concreto vive en su especialización. Un sistema
  sin idioma medido hereda el tronco desnudo: **inventar marcadores que nadie
  midió es una preferencia disfrazada de regla.**
- **Un rate limit no es un blip.** Reintentarlo a la cadencia del blip alarga el
  bloqueo en vez de despejarlo, así que está deliberadamente fuera de los
  marcadores transitorios.
- **El fallo del sistema externo vuelve como dato y se interpreta**: el código
  de salida de un proceso, el status y el cuerpo de una respuesta, el error del
  driver. La razón viaja en el canal de diagnóstico y un throw en el sitio de la
  llamada la borra.
- **Ningún sistema externo se llama sin tope, y el adaptador no elige el tope**:
  entra por el constructor sin valor por defecto, porque aplicarlo es trabajo de
  esta capa y decidir cuál es policy. Al agotarse falla cerrado y lo que hubiera
  escrito se descarta: media respuesta no es una respuesta.
- **La conversión al dominio vive en el modelo del borde, con una puerta**: lo
  que el sistema externo dijo entra, el objeto de dominio sale. Un modelo que
  guarda los campos del objeto de dominio y deja que el adaptador mapee a mano
  es el mismo tipo escrito dos veces. **Se proyectan sólo las claves que se
  consumen**, y una respuesta a la que le falta lo que declaramos leer falla
  citando las palabras del sistema.
- **El texto que viene de otro sistema entra en un documento ajeno con su
  sintaxis activa aquietada.** Medido: una descripción copiada de un gestor de
  incidencias autoenlazó un issue de un tercero en su cronología, y una mención
  habría notificado a una persona.
- **La proyección de un vocabulario cerrado hacia fuera es exhaustiva y devuelve
  un value object**, nunca un literal; un miembro sin mapear levanta en vez de
  adivinar.
- **El código de una respuesta se declara explícitamente, junto al detalle con
  el que viaja**, nunca derivado del nombre de la clase de una excepción:
  derivarlo ataría la respuesta a un nombre del dominio, y renombrar esa
  excepción cambiaría en silencio lo que recibe el cliente.
- **El borde exterior es el único que ensambla el grafo de dependencias**: elige
  los adaptadores concretos y los inyecta, sin contenedor de inyección —un
  adaptador por port— y con el constructor como costura de test. Y **traduce los
  errores del dominio al vocabulario que su invocador entiende**, que tiene dos
  formas: en un programa que termina, el código de salida, con el resultado en
  el canal estándar y el diagnóstico en el de error, siempre separados; en un
  servicio que atiende, la respuesta, y el traductor se llama manejador. La
  regla es la misma en las dos: **un código por decisión de quien recibe, no uno
  por error** — la vara es qué hace distinto el receptor por haberlo recibido.

### 3.4 Lo que gana `conventions/architecture.md` (sigue en `new modules`)

- **Las capas y sus habitantes se ven en el árbol**: una carpeta por capa, y
  dentro de cada capa una carpeta por clase de habitante —los value objects, los
  ports, las policies; las acciones y las consultas; los adaptadores y los
  controladores—. **Dentro de una capa el discriminador es la carpeta, nunca un
  sufijo en el nombre.** Esto refuerza lo que ya dice el documento sobre que
  mutación y lectura se distinguen por dónde viven; el nombre de la carpeta raíz
  y los nombres de fichero son del repositorio y no de esta regla.
- **Un tipo nuevo tiene la carga de la prueba.** La respuesta por defecto a un
  comportamiento nuevo es un método en un tipo que ya existe, y la respuesta por
  defecto a un tipo nuevo es dentro del módulo que lo consume. Un tipo gana
  módulo propio cuando algo más lo construye, cuando otro módulo lo consume o
  cuando lleva su álgebra propia — y **"los tests lo construyen" no concede
  nada**: un doble no es un consumidor y los tests no son una capa. Se pagó:
  tres tipos se entregaron en su propio módulo y tuvieron que volver a casa, y
  la cuenta de clases decía "sobrediseñado" mientras la de conceptos no.
- **El payload que sólo su dueño construye comparte el fichero de su dueño**: la
  salida de un proceso con quien lo ejecuta, un rechazo con las proyecciones que
  lo construyen, el presupuesto de una policy con la policy. Un modelo de borde
  comparte el fichero de su adaptador mientras el adaptador sea su único
  consumidor, y se extrae el día que aparece el segundo.
- **Una clase que nadie instancia es un namespace**, tolerada sólo porque
  `style.md` prohíbe las funciones sueltas, y nunca una razón para concederle un
  módulo. Si tiene un solo consumidor, vive dentro de él.
- **Un cliente por sistema externo, nunca un cliente por llamada.**
- **Un controlador por endpoint**: la ruta, su modelo de petición con el
  vocabulario cerrado de resultados, y las proyecciones que convierten cada
  resultado y cada fallo en una respuesta, viajan en un módulo. El endpoint
  siguiente es un fichero nuevo y una línea de montaje. Lo que todo endpoint
  repetiría vive en un solo módulo y en ningún otro sitio.

### 3.5 Lo que gana `conventions/testing.md` (todo diff)

- **Las tres reglas, y de ellas se sigue el resto:**
  1. Un caso de uso es una caja negra, probado de fuera adentro: sus ports se
     doblan en el constructor y las aserciones son sobre lo que cada port
     recibió y lo que volvió. El dominio no tiene tests propios. Una guarda que
     ningún caso de uso alcanza no es un test pendiente de escribir: es código
     muerto o una invariante que se defiende sola.
  2. Un adaptador se prueba **cortando justo antes del sistema externo**,
     asertando la interacción: la petición literal enviada y el parseo de una
     salida literal grabada. La única excepción es el adaptador que *es* la
     llamada —un repositorio de base de datos, veinte líneas alrededor de una
     invocación— donde una vez doblado el sistema no queda nada que asertar:
     ésos corren lo real, y son los únicos.
  3. La integración desde el borde cubre el camino feliz, y sólo eso: una
     petición entera llegando al primer sistema real. Los rechazos, las
     colisiones y los cortes se miden en la capa que los posee, o no se miden.
- **La tabla de qué se asserta en cada capa.** Controlador: el status y el
  cuerpo literal de la respuesta, a través de un servidor escuchando de verdad y
  un cliente real, nunca llamando al handler como función. Aplicación: qué
  recibió cada port y qué devolvió, con el orden clavado por los cortes — cuando
  un paso falla, a los ports posteriores no se les preguntó. Dominio: nada, se
  cubre por los dos caminos de arriba. Adaptadores: la petición literal y el
  parseo de salida grabada real, no de formas inventadas. Payloads de borde:
  leídos por el lector real del otro lado cuando ese lector vive en el
  repositorio.
- **Un rechazo nunca llega a un doble**: el test de una petición rechazada
  asserta además que al caso de uso no se le preguntó.
- **Las dos causas de fallo de cada adaptador se distinguen en sus tests**, y el
  test prueba que una no es instancia de la otra.
- **La barrida de mutación.** Tras cada ronda, mutar el código de producción un
  cambio a la vez, correr la suite entera y cazar **las mutaciones que la dejan
  verde**: cada una es una línea que ningún test mira. Con su disciplina, que se
  aprendió de sus propios falsos verdes: una sustitución que no encaja falla
  ruidosamente, porque un fallo silencioso es un verde que no midió nada; el
  fichero se restaura y se verifica idéntico después, así que el árbol se
  comitea antes y nada más corre mientras la barrida corre; y una mutación que
  cuelga la suite en vez de hacerla fallar es un hallazgo por sí misma.
- **Lo que se deja sin medir a propósito se declara, con su motivo**, para que
  nadie lo persiga: los valores de los presupuestos son policy y no mecanismo —el
  mecanismo se mide, los números son decisiones—, y una aserción que sólo puede
  fallar si falla el lenguaje no se escribe.

### 3.6 Lo que `architecture.md` PIERDE, y por qué eso es la mitad del trabajo

`architecture.md` se vacía de todo lo que es borde: la sección `The entrypoint`
entera, y de la sección del boundary el cast, la clave desconocida, la
validación por proyección, la conversión al dominio, el adaptador nombrado por
su implementación, el adaptador que no decide policy, el tope sin valor por
defecto y el código de salida que es dato. Todo eso pasa a `boundaries.md`.

No es una mudanza cosmética, y tiene dos consecuencias buscadas:

1. **Les amplía el alcance de `new modules` a todo diff.** Hoy un diff que sólo
   modifica un adaptador que ya existía no recibe ni una regla sobre bordes,
   porque el único documento que las tiene no viaja en esa tarea. Ése es el
   alcance que corresponde a esas reglas y el que tendrán.
2. **Evita el defecto que prohíbe `decisions.md`.** Si las reglas del borde no
   se quitan de `architecture.md` al escribirlas en `boundaries.md`, quedan
   escritas dos veces y las dos copias divergen. El vaciado no es opcional: es
   la misma operación.

## 4. Qué queda en `backend/`

`backend/conventions/` se queda con **un solo documento**,
`this-repository.md`, y pierde el README —ordenaba una precedencia de tres
niveles que ya no existe, y la cabecera que pega el programa ya dice cómo se
resuelve el choque—. El nombre evita a propósito los ocho de la vara: un
`domain.md` aquí y otro allí haría ambigua cualquier cita del juez. Ese
documento lleva lo que ningún otro repositorio hereda:

- **El lenguaje ubicuo de este backend**, entero: historia de usuario, issue del
  plan, agente de plan, GO, nombre de repositorio, raíz del clon, espacio
  preparado, cosecha, libro de cosecha.
- **`plugin/` no importa nunca de `backend/`**, y la copia declarada se mide con
  un test que renderiza la salida del propio plugin y compara.
- **El layout concreto**: la raíz, los nombres de los ficheros de infraestructura
  y el patrón de nombre de un controlador. La regla que encarna sube a
  `architecture.md` (§3.4); la materialización se queda.
- **La política de respuestas de esta API**: toda negativa que juzgó la
  aplicación responde 400 con `{code, detail}`, la negativa del protocolo
  conserva su status, y un `Origin` se admite sólo cuando es la página que este
  servidor sirve, avalado por un `Host` de loopback. Es la decisión de un backend
  para un solo frontend, y otro repositorio puede decidir otra cosa con razón.

Lo que se va sin sustituto: **desde dónde corre la suite y cuál es el
subconjunto rápido**. Es operativo, no vara, y su regla general —un test que
lanza un subproceso se marca para que exista un subconjunto rápido— ya está en
`testing.md`.

Y lo que se pierde de verdad al no tener ya seis documentos aquí: **las
facturas**. Cada regla de `backend/conventions/` venía con el caso concreto que
la pagó, con su ruta y su pull request, y eso es lo que impide que se
relitigue. Al subir, cada regla conserva su caso resumido en una línea y sin
nombres de este repositorio (§3.2 y §3.4 lo hacen así); lo que no viaja es el
rastro hasta el commit. Es el precio declarado de esta decisión.

## 5. El contrato del programa

### 5.1 `PluginYardstick.FILES` pasa de cinco a ocho, y el orden es una decisión

Esa lista fija el orden en que se componen los documentos, tanto pegados como
por ruta. El orden nuevo va de lo que prohíbe a lo que mide:

```
defects.md  style.md  simplicity.md  decisions.md  domain.md  architecture.md  boundaries.md  testing.md
```

De ahí sale gratis lo que más importa: `yardstick-citation.js` construye el
regex de citas válidas **desde `FILES`**, así que una cita a
`conventions/simplicity.md` se reconoce sin tocar ese módulo. Y
`ct-step.mjs` sigue abortando si falta o está vacío cualquiera de los ocho, con
el mismo mensaje de instalación incompleta.

### 5.2 Los ocho sitios que clavan el número cinco en prosa

| Sitio | Qué dice hoy |
|---|---|
| `run-metrics.js:213` | el techo de documentos citados es 5 |
| `ct-next.mjs:53` | "estos cinco documentos" |
| `kickoff.js:154`, `:254` | "los cinco documentos" en el kickoff del plan |
| `ct-step.mjs:1459` | "los cinco documentos enteros son 24 KB" |
| `agents/ct-reconciler.md:46` | "the five documents of the plugin's `conventions/`" |
| `writing-plans-prescriptive/SKILL.md:59`, `:248` | "the five documents of `conventions/`" |
| `kickoff.test.js:400` | asserta que el kickoff NO diga "los cinco documentos de" |
| `ct-step-vara-y-telemetria.test.js:198` | "el brief termina con los cinco documentos" |

Dos de ellos no son un número que cambiar:

- **`run-metrics.js:213` cambia lo que la métrica significa.** El techo de
  `rubric_vara_ct_docs` —cuántos documentos distintos llegaron a usarse— pasa de
  5 a 8, así que un juez que cita cinco ya no ha citado todo lo que podía. El
  techo no está en el código sino en la prosa que explica cómo se lee la
  columna, así que el cambio es de lectura y no de cálculo.
- **`ct-step.mjs:1459` refuerza su propio argumento.** Ahí está escrito por qué
  el reconciliador recibe rutas y no documentos pegados: cinco documentos
  enteros son 24 KB delante de un conflicto. Con ocho son unos 41 KB, y el
  argumento se refuerza. La estimación que esta sección llevaba mientras el plan
  corría (35 KB) se hizo antes de que las dos últimas tareas hicieran crecer
  `architecture.md` y `testing.md`, y quedó corta: es el motivo por el que §5.3
  ya no cita bytes exactos.

Y uno que ya está resuelto de antemano, comprobado: `briefVaraCtMeasures`
(`run-metrics.js:375`) cuenta las cabeceras `## Vara de ct: conventions/` que
escribe `composeSection` **en vez de comparar contra `FILES.length`**, y su
propio comentario dice que por eso el quinto documento se contó sin tocar la
función. El octavo tampoco la toca. Es la única pieza del contrato que este
diseño no tiene que modificar, y su test lo deja clavado.

### 5.3 Los tres nuevos viajan pegados al implementador

Como el resto. Se consideró darlos por ruta para no engordar el brief, y se
descarta: el que escribe el código es el único rol que no puede permitirse no
haber abierto la vara, y una ruta se puede no abrir. El tamaño se controla por
el otro lado, **escribiendo corto**: los tres documentos nuevos son del orden de
sesenta líneas cada uno, con la regla y la pregunta que la decide, sin las
facturas largas. El juez de tarea y el reconciliador siguen recibiéndolos por
ruta.

**Lo que costó de verdad, y por qué esta sección no lleva la cifra exacta.** El
"orden de sesenta líneas" no se cumplió: los tres documentos nuevos rondan las
250 líneas entre ellos, y la vara pegada de una tarea que no estrena módulo
pasó de 22 KB a unos 32, la de una que sí a unos 43. **Las cifras exactas se
miden, no se citan aquí**: este documento las tuvo tres veces y las tres
envejecieron en la misma rama —dos veces porque una tarea posterior hizo crecer
un documento, y la tercera por 183 bytes que entraron en la última ola de
arreglos, después de que yo corrigiera el número—. Quien necesite el dato lo
saca del disco:

```
wc -c plugin/conventions/*.md
```

La decisión se mantiene con la magnitud delante: lo que se compró es que el
borde rija todo diff, y `boundaries.md` se aceptó entero en su ronda de revisión
con la instrucción expresa de no recortar ninguna regla pagada para cumplir un
presupuesto de líneas puesto a ojo.

## 6. Los roles

Inventario de quién recibe la vara hoy, que es donde aparecen los dos huecos:

| Rol | Qué recibe |
|---|---|
| Implementador (`prompts/task-implementer.md`, `ct-step.mjs:691`) | los documentos pegados, filtrados por alcance |
| Juez de tarea (`agents/ct-judge.md`, `ct-step.mjs:753`) | las rutas, en `Vara de ct`, primera sección del paquete |
| Reconciliador (`agents/ct-reconciler.md`, `ct-step.mjs:1462`) | las rutas |
| Plan (`writing-plans-prescriptive`, `ct-next.mjs:54` + `kickoff.js:254`) | la ruta del directorio, y una invitación explícita a no leerlos |
| Juez de slice (`agents/ct-slice-judge.md`) | nada: su paquete es `Señal`, `Commits`, `Files changed`, `Diff` |

### 6.1 El plan deja de estar invitado a no leer

El kickoff dice hoy, literalmente, *"no hace falta que abras los cinco
documentos ahora... abre de ahí el que necesites"*. Eso era razonable cuando la
vara no hablaba de qué se añade. Ya no: **un plan que prescribe un campo, una
guarda o un símbolo público sin haber leído `simplicity.md` prescribe
exactamente lo que el juez marcará después**, y el implementador tiene orden de
no desviarse del plan, así que el defecto entra blindado por el propio contrato.
La regla "una petición de una revisión no exime" no sirve de nada si fue el plan
quien lo pidió.

El kickoff nombra los dos que un plan no puede no haber abierto —`simplicity.md`
y `decisions.md`, porque el plan es quien decide qué se añade y dónde vive cada
decisión— y deja el resto a demanda por su ruta. Es un cambio de instrucción, no
de mecanismo.

### 6.2 El juez de slice gana una sola ruta

Que no reciba vara es deliberado y está argumentado en `step-contracts.js`: sus
ítems miden el estado final, la coherencia entre tareas y la señal, no la calidad
del código regla a regla, y se le dan menos herramientas a propósito. Eso no se
toca. La única excepción es exacta: su ítem `observabilidad` juzga la señal
declarada, y `simplicity.md` lleva justo esa regla —una traza, una métrica o un
campo de una respuesta nombran quién los lee y qué hace distinto por haberlos
leído—. Su paquete gana **una sola ruta, `simplicity.md`**, por eso y por nada
más.

## 7. Lo que esto NO hace

- **No construye el eje de tecnología.** No hay selector, no hay declaración de
  stack en `/ct-init`, no hay campo nuevo en el plan. Cuando existan las
  convenciones de frontend y de nativos, se decidirá entonces con dos casos
  delante en vez de con uno.
- **No amplía la misión del juez de slice** más allá de la ruta de §6.2.
- **No toca la vara del repo destino** ni la cabecera de precedencia: siguen
  siendo dos varas y la de ct sigue ganando regla a regla, como decidió el
  diseño del 26 de agosto.
- **No hace que el loop ejecute la barrida de mutación.** La vara la exige y el
  juez la mide por lo que se declara; automatizarla es otro trabajo.
- **No cambia la regla de que toda función cuelga de un tipo**, aunque en Python
  sea contra-idiomática. Es una decisión declarada de este repositorio y la
  cabecera de precedencia ya resuelve el choque cuando el repo destino tiene una
  herramienta propia que exige lo contrario.
- **No migra ningún repositorio.** Un repo que ya usaba el loop recibe tres
  documentos más en la vara de su siguiente slice; lo que ya está escrito en él
  sigue siendo deuda declarada exactamente donde lo era.

## 8. Tests

Se mueven, por el cambio de `FILES` y de la prosa: `conventions-vara.test.js`,
`ct-step-vara-y-telemetria.test.js`, `kickoff.test.js`, `run-metrics.test.js`,
`judge-bench.test.js`, `step-contracts.test.js` y `plan-contract.test.js`.

Y se escribe uno por cada afirmación que este diseño introduce y que hoy nadie
mide:

- Los ocho documentos declaran su `Applies to:`, y `PluginYardstick.scopeOf` lo
  lee en los ocho.
- Los tres nuevos alcanzan a una tarea que no crea ninguna ruta — es lo que
  distingue su alcance del de `architecture.md`.
- **Después del vaciado, ninguna regla de borde quedó en `architecture.md`**: ni
  `exit code`, ni el tope de la llamada externa, ni el cast, ni la clave
  desconocida. Este test es el que defiende §3.6 de una fusión a medias.
- La vara no nombra ninguna herramienta ni ningún lenguaje: el barrido busca
  `vitest`, `execFile`, `npx`, `Object.freeze`, extensiones de fichero y
  `exit code` sobre los ocho documentos.
- El paquete del juez de slice lleva la ruta de `simplicity.md`.
- El kickoff del plan nombra `simplicity.md` y `decisions.md`, y ya no dice que
  no hace falta abrirlos.
- `backend/conventions/` no restata ninguna regla que subió: el test cruza el
  documento que queda contra los ocho de la vara.
