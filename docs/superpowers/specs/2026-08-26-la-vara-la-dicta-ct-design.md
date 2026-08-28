# La vara la dicta ct — el plugin trae la suya, y la suya siempre gana

> Completa `2026-08-21-la-vara-del-repo-en-el-plan-design.md`. Aquélla construyó
> el transporte para que la vara del repo destino llegara al implementador y al
> juez; funciona, y se queda. Lo que faltaba es lo que se transportaba, porque
> `/ct-init` siembra la declaración vacía. Esto pone a ct a traer la suya puesta,
> y a ganar donde las dos hablen de lo mismo.
>
> El problema que cierra: **los slices entregan calidad irregular porque en la
> práctica nadie mide contra nada.** El transporte funciona; lo que no llega es
> vara, porque `/ct-init` siembra la declaración vacía y un repo que no escribe
> sus convenciones se queda `sin-vara` para siempre.

---

## 1. El problema, medido

> **Corregido por §9.2.** La consecuencia que esta sección declara observada —el
> ítem `patrones` sin veredicto slice tras slice— **no se reproduce** en
> `jjponz/rust-monitoring`, donde `rubric_sin_vara` ya era 0 antes de la vara
> porque el juez se apoyaba en `AGENTS.md`. Lo que sigue se conserva tal cual se
> escribió, con su premisa incluida, porque es el argumento con el que se decidió
> todo lo demás; lo que la medición dijo está en §9.

El mecanismo del 21 de agosto quedó completo y correcto: `.agent/conventions.md`
lo siembra `scripts/ct-init.sh`, lo confirma el humano que corre `/ct-init`,
`ct-step.mjs` lo lee del disco y lo pega verbatim al final de cada task brief, el
implementador tiene orden de abrir lo que nombre y el ítem `patrones` de
`agents/ct-judge.md` mide contra la unión de esa declaración y el
`## 3. Reference patterns` del plan.

Lo que no previó es el estado en que queda un repo recién inicializado. La
siembra escribe el fichero **vacío**:

```
Rules to obey (una ruta por línea, entre backticks; tiene que poder leerse):

- (ninguna declarada todavía — sustituye esta línea al declarar la primera)
```

Y eso fue deliberado: §5 de aquel diseño decidió expresamente no exigir un
mínimo, con el argumento de F14 —un validador que exige una vara que el repo no
tiene sólo se satisface inventándose un documento, y eso es peor que no tenerlo—.
La ausencia se mide, no se rellena: el juez responde `outcome: sin-vara` y la
cuenta viaja en `rubric_sin_vara`.

La consecuencia es la que se observa hoy en las pull requests: **el único ítem de
calidad de la rúbrica sale sin veredicto slice tras slice**, y con él se va la
única cosa que podía cazar prosa de relleno, una decisión de negocio escrita dos
veces, un test que asserta sobre un doble o andamiaje de trabajo que nadie pidió.
El `patrones` maniatado que aquel diseño desató sigue sin nada que citar, porque
lo que le falta ya no es permiso: es contenido.

## 2. La decisión: ct trae su vara, y la suya siempre gana

**ct empaqueta sus propias convenciones de código, y tienen preferencia
absoluta.** La declaración del repo destino (`.agent/conventions.md`, y el
`Rules to obey:` de §3 que la selecciona) **se queda y sigue obligando**: son dos
varas, no una, y la del repo cubre todo aquello de lo que la de ct no habla.

**La precedencia se mide por regla, no por tema.** Que ct gane no significa que
la vara del repo se anule: significa que donde una regla del repo manda hacer
algo que uno de los documentos de ct prohíbe, o prohíbe algo que exigen, no
aplica. Donde una regla del repo dice algo de lo que ninguno de ellos habla,
obliga entera.

El caso que fija la frontera, porque es el que se malinterpreta en las dos
direcciones: la convención de mayúsculas, prefijos o nombres de fichero de un
repo **obliga**, porque ningún documento de ct habla de eso. Su convención de
escribir identificadores en castellano **no**, porque `conventions/code.md` exige
inglés. Y ct sí reclama trozos concretos del naming —el idioma de los
identificadores, que un caso de uso no lleve coletilla, que un adaptador se llame
como su implementación—, así que la frontera no es «naming sí o no»: es si un
documento de ct habla de eso o no habla.

Lo que esto compra es que el estado `sin-vara` **deja de poder ocurrir** en el
ítem `patrones`. La vara de ct viaja con el plugin, así que no hay repo sin
vara y no hay nada que un humano tenga que escribir antes de que el mecanismo
mida. El argumento de F14 se queda sin sujeto: no se está exigiendo una vara que
el repo no tiene, se está trayendo puesta.

**Consecuencia aceptada:** con `patrones` incapaz de salir `sin-vara`, se pierde
la cifra que decía «este repo no ha escrito sus convenciones». Se acepta porque
ese número medía la ausencia de la única vara que había; ahora la vara nunca
falta, y lo que el repo declare o no es una elección suya y no un agujero del
mecanismo.

El origen del contenido es `docs/conventions/` de `alcaptar/agentic-skills`, un
corpus que ya está escrito, ya se aplica y ya tiene su propia meta-convención
sobre cómo se escribe una convención. Lo que se trae es la parte
que es verdad en cualquier lenguaje; lo que se queda fuera es lo que sólo es
verdad en Python.

## 3. Cómo cruza el embudo

`ct-step` sólo puede leer dos cosas: el plan y ficheros del disco. La vara del
repo ya cruza por la segunda, leída de `.agent/conventions.md`. La de ct cruza por
la misma puerta cambiando de dónde se lee: `PLUGIN_ROOT` ya existe en
`scripts/ct-step.mjs`, así que el programa puede leer un fichero del propio plugin
sin inventar ningún transporte.

```
conventions/*.md  (en el plugin)          .agent/conventions.md  (en el repo)
   │                                              │
   ├─ kickoff.js nombra sus rutas                  │
   │  en el primer acto del slice                  │
   │     ▼                                         │
   │  el que escribe el plan ──── selecciona ──────┤
   │  (writing-plans-prescriptive)   en §3         │
   │                                               │
   └─ ct-step.mjs las pega VERBATIM ───────────────┘
      al final del task brief, ct PRIMERO
      — ningún agente escribe ahí
         ▼
      task brief
         │
         ├──► implementador  (lo tiene delante antes de escribir)
         └──► juez           (lee ese mismo brief antes de bloquear)
```

**Dos módulos, dos sujetos.** `scripts/vara.js` se queda entero como está,
transportando la declaración del repo; la vara de ct entra en `scripts/vara-ct.js`
y `ct-step` compone las dos. Meterlas en el mismo fichero lo dejaría llevando tres
cosas —la vara de ct, la declaración del repo y el barrido de candidatos—, que es
la mezcla que `knowledge-composition` existe para evitar.

**El task brief es un fichero en disco**, `.agent/run-<issue>/task-N-brief.md` en el
worktree del slice, que `ct-step` compone a partir del plan ya commiteado: cuatro
secciones del plan y detrás la tarea. Y es el mismo fichero para los dos —el
implementador lo abre por su ruta, y `ct-step.mjs` despacha al juez con él entre
sus insumos—, así que pegar la vara al final la entrega a los dos con texto
literal idéntico.

Que sea el programa quien la pegue, y no un agente quien la cargue, es lo que hace
que no se pueda perder: `offload-deterministic` en el vocabulario de `ai-patterns`.
Por qué el que planifica también la recibe está en §7, y no es un extra: sin eso el
mecanismo se cierra en falso.

### 3.1 Las dos varas fallan distinto, y eso es deliberado

Que falte `.agent/conventions.md` **sigue siendo un estado benigno**: el brief sale
sin la parte del repo, `ct-step` avisa por stderr y no pasa nada más. Es el estado
normal de casi todo repo y no se toca.

Que falte uno de los cuatro de `conventions/` **no lo es**: no significa «este repo
no escribió sus convenciones» sino **instalación rota del plugin**. Ahí `ct-step`
**aborta** en vez de avisar, porque un brief sin la vara de ct produce un
implementador y un juez midiendo con nada, y eso es exactamente la desviación
silenciosa (`silent-misalignment`) que este mecanismo existe para cerrar: en
silencio, un ítem sin vara no se distingue de un ítem conforme.

La asimetría es la que corresponde a quién posee cada fichero. Lo que el repo
declara es suyo y puede no declarar nada; lo que el plugin trae es una promesa del
plugin, y no cumplirla es un fallo suyo.

## 4. El reparto: varios ficheros, no uno

Un documento único sería todo o nada: se carga entero o no se carga
(`knowledge-composition`). Y con la vara pegada en cada brief eso significa que
una tarea de prosa se lleva las reglas de test y las de arquitectura compitiendo
por la atención con lo que sí le toca, que es el obstáculo `limited-focus` —donde
un contexto ancho hace que hasta las reglas explícitas se ignoren—.

El reparto es por lo que mide cada fichero, no por tamaño:

| Fichero | Qué mide |
|---|---|
| `conventions/code.md` | Cómo se escribe una línea de código |
| `conventions/decisions.md` | Dónde vive una decisión, y cuántas veces se escribe |
| `conventions/architecture.md` | Dónde vive cada cosa y qué puede conocer a qué |
| `conventions/testing.md` | Qué fija un test y contra qué asserta |

### 4.1 Hoy viajan todos, y el selector es deuda declarada

El reparto no se acompaña de selección. **No hay hoy ningún campo del plan que le
permita a un programa decidir qué parte de la vara debe una tarea**, y el que más
se le parece no sirve: `**TDD:**` admite `No TDD — <reason>` con el motivo en
prosa libre, así que un refactor puro lo declara legítimamente, y gatear la vara
de arquitectura ahí la quitaría precisamente en las tareas de refactor, que son
donde se rompen los boundaries.

Un gate mal puesto no deja la vara más enfocada: la quita donde hacía falta. Así
que los cuatro viajan siempre, y la selección se declara como la vuelta
siguiente. El reparto ya paga sin ella: el juez cita `línea 34 de
conventions/testing.md` en vez de una línea de un monolito, y cada fichero se
corrige sin releer los otros. Cuando el plan traiga un campo legible por un
programa, la selección se añade sin rehacer el contenido.

### 4.2 La lista de ficheros se declara, y no se barre del disco

`PluginYardstick.FILES` (`scripts/plugin-yardstick.js`) es una lista fija de
cuatro nombres, no el resultado de recorrer el directorio `conventions/` del
plugin. La alternativa —tratar como vara cualquier `.md` que aparezca ahí—
parece más simple y es la que falla en silencio: un fichero borrado por
accidente, o movido a un subdirectorio en un refactor, reduciría la vara sin
que nada lo note, porque un directorio con tres ficheros donde antes había
cuatro no se distingue de un directorio que siempre tuvo tres.

Declarada, el borrado deja de ser invisible: falta un nombre que la lista
promete, y eso es lo que `PluginYardstick.missingDocuments` —y, tras él,
`composeSection`— convierte en un fallo que aborta en vez de en una vara más
corta que nadie pidió. `__tests__/plugin-yardstick.test.js` ata la lista al
directorio en las dos direcciones —todo lo declarado existe en disco, y todo
`.md` que hay en disco está declarado— para que la lista no pueda quedarse
atrás del directorio que describe.

### 4.3 Un documento declarado y vacío es la misma vara corta

Que el fichero exista no basta: `ct-step` pega estos cuatro documentos verbatim
al final de cada task brief, así que un documento sin su línea de `Applies to:`
o reducido a encabezados sin sustancia deja al implementador y al juez midiendo
con nada — el mismo estado que §4.2 hace visible para el borrado, pero para el
vaciado. Por eso `__tests__/conventions-vara.test.js` comprueba, para cada uno
de los cuatro, que la cabecera declara su alcance y que trae más de veinte
líneas con sustancia, no sólo títulos.

## 5. Qué dicen (y §9.3 los pasa a cinco)

El idioma es **inglés**, como todo el corpus del plugin que llega a un agente
(`prompts/task-implementer.md`, `agents/ct-judge.md` y las skills que
empaqueta). La vara
se cita desde esos dos documentos: en castellano quedaría en otro idioma que la
rúbrica que la invoca, y contradiría su propia regla de escribir el código en
inglés.

### 5.0 Dónde vive la regla de precedencia

**No en los cuatro documentos**, y no en cada uno: sería la misma regla escrita
cuatro veces, que es exactamente lo que `conventions/decisions.md` prohíbe.

Vive en **la cabecera del bloque que pega el programa** (`seccionDeVara`, en
`scripts/vara-ct.js`), y ahí por un motivo que no es de comodidad: el programa es
el único que sabe que las dos varas están viajando juntas en ese brief, y esa
cabecera es lo único del bloque que ningún agente puede quitar. El texto dice la
regla por-regla de §2 y trae el caso del naming como ejemplo trabajado, para que
el juez tenga delante los dos lados —uno que obliga y uno que no— en vez de una
consigna que sólo apunta en una dirección.

El bloque de ct va **antes** que el del repo en el brief: la cabecera que fija la
precedencia se lee antes de que llegue la vara sobre la que decide.

### 5.1 `conventions/code.md` — partido en §9.3 en `defects.md` y `style.md`

Alcance: **todo diff**. Un módulo que ya existía y no cumple es **deuda
declarada** sólo para lo que este documento llama estilo: cero prosa, el
idioma de los identificadores, que toda función cuelgue de un tipo. Lo que se
le añada a ese módulo puede seguir el estilo de su anfitrión ahí, y eso **no es
hallazgo**. Lo que este documento llama defecto no tiene esa exención: mapa
crudo como retorno de lógica, vocabulario cerrado colapsado en una cadena o un
booleano, dos campos que tienen que concordar, un error nombrado por dónde
pasa en vez de por qué pasa. Eso rige en todo diff, en un módulo nacido hoy
igual que en uno que ya estaba.

Y el mismo agujero que cierra `architecture.md` se cierra aquí igual: un
concepto nuevo es un módulo nuevo y nace cumpliendo, así que esconder un
concepto nuevo dentro de un fichero viejo para heredar la exención de estilo
**sí es hallazgo**.

- **Cero prosa en el código: ni comentarios ni docstrings.** Si un trozo de
  código no se entiende sin un párrafo al lado, el arreglo es el código —nombres
  que digan lo que hacen, funciones pequeñas con una responsabilidad, tipos que
  hagan imposible el mal uso, constantes con nombre en vez de literales—. Un
  condicional que necesitaba tres líneas de explicación es casi siempre una
  función con nombre esperando a nacer, y un invariante que se explicaba en prosa
  es casi siempre un test que falta.
- **El código va en inglés**: ficheros, módulos, tipos, funciones, métodos,
  variables, parámetros, constantes, miembros de vocabulario, errores, nombres de
  test y los mensajes de diagnóstico y de log —no el texto que ve un usuario final, cuyo idioma lo fija el producto—. Excepción: un dato que es parte de un
  contrato externo y viene fijado por él.
- **Ninguna función suelta a nivel de módulo: toda función cuelga de un tipo.** Lo
  que era un puñado de funciones privadas más constantes sueltas es casi siempre
  un tipo esperando a nacer, y ponerle nombre es lo que dice de quién es esa
  lógica. No es cosmética: un puñado de funciones sueltas que en realidad eran una
  sola pieza esconde que a esa pieza le falta un argumento sin el que no hace su
  trabajo; con nombre, la ausencia se ve.
- **Vocabulario cerrado en vez de cadenas y booleanos.** Una respuesta contesta
  con el vocabulario, no con un booleano derivado de él: un booleano colapsa
  estados que se arreglan distinto y quien lo consume no puede separarlos. Un
  estado ausente es un miembro del vocabulario, no un opcional. Y el reparto se
  hace con correspondencia exhaustiva sin rama genérica, para que añadir un
  miembro rompa la compilación en vez de caer en silencio.
- **Nada de mapa crudo como retorno de lógica.** Un mapa que cruza dos funciones
  propias se lee con un acceso por clave en el consumidor, y ahí una clave mal
  escrita y una ausente dan lo mismo. Un mapa crudo es frontera de
  serialización, no valor de retorno.
- **Errores nombrados por lo que pasa, no por dónde.** Jerarquía sólo cuando el
  consumidor necesita distinguir; heredan del tipo que corresponde, no del error
  raíz.
- **Dos campos que tienen que concordar dejan representable el estado que no debe
  existir; uno solo lo hace imposible.** Cuando una bandera dice lo mismo que la
  no-vacuidad de un dato, la bandera se retira y se deriva: así una ejecución que
  muera a medias no puede reanudar afirmando algo que no tiene.
- («Nada de andamiaje especulativo» se quedó fuera a propósito: ver §5.5.)

### 5.2 `conventions/decisions.md`

Alcance: **todo diff**.

Una regla de negocio se escribe **una vez**, y la primera copia ya es el fallo: no
hay umbral que la autorice, porque lo que se rompe no es la limpieza, es la
coherencia. Dos trozos parecidos que divergen dejan código feo; dos sitios que
deciden lo mismo y divergen dejan un programa que se contradice, y el síntoma no
aparece donde está la copia sino donde alguien la creyó.

- **La vara:** si esta decisión cambiara, ¿cuántos ficheros hay que tocar para que
  el programa siga siendo coherente? Uno, o está repartida. La pregunta se hace
  sobre el cambio, no sobre el texto: dos sitios que hoy dicen lo mismo con
  palabras distintas ya están repartidos, y por eso la vara no puede ser el
  parecido.
- **Lo que no cuenta:** el idioma de una frontera no es una regla. La pregunta que
  los separa es si existe un cambio de negocio que obligue a tocar los dos a la
  vez; si no lo hay, es idioma, y a eso sí le aplica la regla de tres.
- **Lo que no vale:** extraer a un helper que las dos copias llamen desde donde
  estaban. La decisión sigue repartida, ahora con una indirección delante.
- **Y el que tiene el dato posee la pregunta:** si cada consumidor deriva a mano
  la condición a partir de un campo, la regla está repartida entre ellos aunque el
  campo viva en un solo sitio. El campo no es la decisión.
- **Cuando la copia es inevitable** —las dos mitades de un contrato que cruza una
  frontera de proceso— se declara y se mide con un test que compare las dos. Lo
  que no vale es dejarla implícita.

**Por qué esto es una convención y no un linter**, que es lo que lo hace
pertinente en un plugin que despacha agentes: el código lo escribe un arnés que
**no puede aprender** (`cannot-learn`). Cada invocación empieza sin memoria de las
anteriores, así que cuando necesita una regla que ya existe en otro fichero no la
reutiliza —no sabe que está—, la vuelve a derivar donde le hace falta. Lo que
produce eso no son copias literales, son redacciones distintas de la misma
decisión, y no hay herramienta que las empareje por su forma. El único sitio donde
se puede cazar es cuando alguien escribe la segunda.

### 5.3 `conventions/architecture.md`

Alcance: **los módulos nuevos**. Un módulo que ya existía y no cumple es **deuda
declarada del repo**: lo que se le añada sigue el estilo de su anfitrión, y eso
**no es hallazgo** —media migración se lee peor que ninguna—.

Y el agujero que esa exención abre se cierra en la misma frase, porque si no la
forma más barata de esquivar la vara es escribir lo nuevo dentro de un fichero
viejo: **un concepto nuevo es un módulo nuevo y nace cumpliendo.** Ampararse en el
estilo anfitrión vale sólo para lo que de verdad extiende lo que ya había;
colocar un concepto nuevo dentro de un fichero viejo para heredar la exención
**sí es hallazgo**.

Quien decide de qué lado cae cada cosa no es el implementador: es el plan, con su
línea `**Files:**` y sus marcas `(create)` / `(modify)` —que el control de alcance
comprueba contra el commit anterior—. Por eso §7 le da la vara al que planifica: es
donde este agujero se abriría.

Hexagonal entera, con el flujo de dependencias hacia dentro: infraestructura
conoce aplicación y dominio, aplicación conoce dominio, dominio no conoce a nadie.

- **Dominio**: objetos de valor, puertos, políticas y errores. Sin entrada/salida,
  sin conocer ninguna otra capa y sin serialización —convertir a las claves de un
  contrato externo es trabajo de la frontera—.
- **Aplicación**: casos de uso que orquestan. Las dependencias entran por
  constructor y por nombre; dependen de puertos, nunca de adaptadores. Sin
  coletilla en el nombre del tipo. La carpeta es el discriminador entre lo que
  muta y lo que sólo lee, no un sufijo. No traduce a formatos externos, no captura
  errores para convertirlos en códigos de salida y no decide política de reintento
  ni de presupuesto.
- **Infraestructura**: adaptadores nombrados por su implementación, modelos de
  frontera que validan lo que llega al entrar, y la traducción al contrato
  externo.
- **Un concepto por módulo**, y con él lo que no existe sin él. La vara es dura a
  propósito: si borras el concepto principal, ¿el otro tipo se queda sin ningún
  consumidor y sin sentido propio? Sólo entonces comparten fichero. Y al revés: un
  tipo con vida propia es un concepto y va a su módulo, aunque hoy se use al lado
  del otro.
- **Política**: la regla exacta es un objeto del dominio con su configuración
  inyectada, sin entrada/salida y sin conocer a nadie. Total o explícita —un par
  de entrada que no describe lanza, en vez de caer en una rama genérica— y
  devuelve el efecto entero, no un booleano ni un mapa: un consumidor que tuviera
  que recomponerlo volvería a tener la política repartida.
- **Conducir no es ejecutar**: quien dirige un flujo de punta a punta invoca sus
  pasos y no habla con los puertos que ese paso necesita. La vara: si su resultado
  se proyecta a un desenlace que el flujo recibe, es un paso; una comprobación
  previa no lo es.
- **Dejar constancia no es conducir**: quien decide el flujo no compone la
  telemetría. Decide cuándo hay que dejar constancia; cómo se deja es de otro caso
  de uso.

Y la frontera, que es donde más se cuela basura porque es la que habla con lo de
fuera:

- **Lo que llega de fuera se valida al entrar, sin excepción y sin conversión de
  tipo a la fuerza**: una conversión así no comprueba nada, sólo calla al
  comprobador de tipos.
- **Una clave desconocida es un rechazo, no un campo que se ignora.** Significa
  que el otro lado cambió de forma y nuestras suposiciones pueden estar viejas.
- **Se entra por el nombre del contrato, no por el nombre del campo**, y de ahí
  sale todo lo que el otro lado ve: el esquema que se le manda, la validación de
  lo que devuelve y lo que se emite.
- **Un formato ajeno de vocabulario abierto se valida por proyección.** Cuando lo
  que llega no es un contrato que este programa defina, exigir el rechazo de
  claves desconocidas sobre el objeto entero rompe la lectura con cada campo que
  el otro lado añada, que es justo la función que ese lector tiene: se proyecta a
  mano una estructura con exactamente las claves que se consumen y se valida ésa,
  que sigue rechazando lo desconocido. Una clave que sí declaramos conocer y que
  falta o llega con el tipo equivocado sigue rompiendo. Y una entrada que no es
  del formato esperado es corrupción, no una variante más: se lanza en vez de
  tragarse.
- **La vara para decidir cuánto apretar la validación de un campo:** ¿qué valor
  equivocado pasaría por bueno, y qué decisión tomaríamos con él? Si la respuesta
  es «ninguna que importe», laxo vale.
- **La conversión al dominio vive en el modelo de frontera**, en las dos
  direcciones. Nunca un helper de mapeo en el caso de uso.
- **El error de validación no sale de la capa**: se traduce al error del dominio
  que el entrypoint sabe mapear.
- **El adaptador se llama como su implementación, no como el puerto**, así que el
  par se lee en el nombre y caben dos implementaciones sin renombrar nada.
- **Un adaptador no decide política** —reintentos, presupuestos, qué hacer con un
  fallo—. Un adaptador que decide política es antipatrón de esta capa.
- **Ninguna llamada a un proceso externo se lanza sin tope, y el tope no lo elige
  el adaptador**: entra por constructor y sin valor por omisión, porque aplicar un
  tope es trabajo de esta capa y decidir cuál es política. Al agotarse se falla en
  cerrado y lo que el proceso hubiera escrito se descarta: media respuesta no es
  una respuesta.
- **Un código de salida distinto de cero es un dato, no una excepción**: se
  interpreta, porque el motivo está en el canal de diagnóstico y una excepción lo
  borra.
- **Un puerto para un valor constante es indirección; un invariante entre varios
  valores pide un objeto.**
- **El entrypoint es el único sitio que monta el grafo de dependencias**: elige
  los adaptadores concretos y los inyecta. No hay contenedor de inyección —un
  adaptador por puerto— y la costura de test la da el constructor.
- **El entrypoint mapea los errores del dominio a códigos de salida**, con el
  resultado por la salida estándar y el diagnóstico por la de error, siempre
  separados. **Un código por decisión de quien invoca, no uno por excepción**, y
  la vara es qué hace distinto quien lo recibe.

### 5.4 `conventions/testing.md`

Alcance: **todo diff**.

- **Cero prosa aquí también**: el nombre del test es la frase, y dice qué se
  garantiza, no qué método se llama.
- **Los objetos los construye un mother**, con escenarios con nombre, no el propio
  test: así el test nombra sólo lo que su caso cambia, que es lo que hace legible
  el assert.
- **El assert va sobre el efecto observable** —qué recibió el puerto, qué devolvió
  el caso de uso—, nunca sobre la llamada a un doble.
- **En una frontera, el assert es la carga literal**, no un modelo de ella
  reimplementado en el test: comparar contra tu propio modelo del formato es
  reescribir el mapeo y aprobarlo por construcción.
- **Un doble dobla lo que su nombre dice y nada más**, y los objetos de valor no
  se doblan: se usan instancias reales.
- **El arrange no se construye con la pieza bajo prueba.**
- **Outside-in**: primero aplicación con los puertos doblados, luego
  infraestructura. Lo de dentro del dominio se cubre por ese camino, no con tests
  propios; un test que sólo comprueba que un contenedor de datos guarda lo que le
  pasas mide el lenguaje, no el código.
- **Antes de añadir un test, comprobar si el comportamiento ya está cubierto.**
  Sólo entra si aporta una dimensión distinta.

### 5.5 Lo que se queda fuera, y por qué

| Fuera | Motivo |
|---|---|
| Reglas de lenguaje: contenedores inmutables por palabra clave, el tipo concreto de enumerado, la librería de validación de frontera, el linter, el comprobador de tipos, el runner de tests, el gestor del toolchain | La vara viaja a cualquier repo. Una regla que nombra una herramienta de un lenguaje es una regla que ese repo no puede cumplir |
| El flujo de trabajo: ramas, commits, pull requests, merge | No es del implementador, que no toca `git`: lo conduce el loop |
| La meta-convención sobre cómo se escribe una convención | La leen las personas que editan estos cuatro ficheros, no el implementador ni el juez. Si hace falta, va a `docs/`, no a `conventions/` |
| Dónde vive el porqué de una decisión | Decidido fuera: la regla se queda en cero prosa y no dice adónde va el porqué |
| «Nada de andamiaje especulativo» | Ya la posee el ítem `alcance` de la rúbrica del juez: código que ninguna frase de la tarea pide. Repetirla en `code.md` duplicaría el mismo hallazgo entre dos ítems, y un test lo prohíbe expresamente |

El test `ninguno repite una regla que ya posee un ítem de la rúbrica`
(`__tests__/conventions-vara.test.js`) generaliza esta fila a los tres ítems
que ya cazan una regla antes de que la vara de ct la repita: `alcance`,
`manipulacion-tests` y `test-desiderata`. Que uno de los cuatro documentos
repita lo que un ítem ya posee no es cosmético: `decisions.md` prohíbe escribir
una regla dos veces, y el recuento por severidad del veredicto se infla cuando
dos ítems cazan el mismo defecto.

## 6. Qué se toca, y qué no

Esta es la parte que la primera versión de este diseño se equivocó por completo:
proponía retirar la vara del repo entera. Con la precedencia de §2, casi nada de
aquello hace falta.

### 6.1 Se queda como está

| Pieza | Por qué |
|---|---|
| Siembra de `.agent/conventions.md` en `scripts/ct-init.sh` | El repo sigue teniendo declaración propia, y sigue siendo suya |
| `scripts/vara.js` entero | Sigue siendo el transporte de la declaración del repo, con el mismo sujeto que ya tenía |
| `scripts/detect-vara.mjs` y el barrido de candidatos | Sigue habiendo algo que un humano declara, así que sigue habiendo candidatos que proponerle |
| `Rules to obey:` de `## 3. Reference patterns` | Sigue seleccionando la vara del repo por slice |
| `scripts/plan-contract.js`, regla `reference-paths` y su mensaje | §3 sigue siendo una vara de reglas: la del repo |
| `commands/ct-init.md` | El ritual de confirmación de la declaración del repo sigue teniendo sujeto |
| `scripts/conventions.js` y `conventions-io.js` | Otro sujeto —colisiones de protocolo del loop—, con su propio `.agent/conventions-ack.md`. Nunca estuvieron en cuestión |
| Los nueve `VERDICT_RULES` | Este diseño no añade ítem a la rúbrica: cambia contra qué mide `patrones` |

### 6.2 Se crea

| Pieza | Qué es |
|---|---|
| `conventions/{code,decisions,architecture,testing}.md` | La vara de ct (§5) |
| `scripts/vara-ct.js` | Su transporte: la lista, qué falta, y la sección que se pega con la cabecera de precedencia |

### 6.3 Se modifica

| Pieza | Qué le pasa |
|---|---|
| `scripts/ct-step.mjs` | `escribirBrief` pega **las dos** varas, la de ct primero, y aborta si falta alguno de los cuatro |
| `scripts/kickoff.js` y `scripts/ct-next.mjs` | El primer acto del slice nombra las rutas de la vara de ct, para que el plan se escriba con ella delante (§7) |
| `skills/writing-plans-prescriptive/SKILL.md` | Gana la orden de leer la vara de ct antes de escribir el plan, y de que su §3 selecciona la del repo, que es otra cosa |
| Ítem `patrones` de `agents/ct-judge.md` | Mide contra las dos varas con la precedencia de §2. Pierde el outcome `sin-vara`, que ya no puede ocurrir, y conserva `no-aplica` |
| `prompts/task-implementer.md`, punto 3 | Lo mismo, para que el que escribe y el que bloquea lean el mismo texto |

## 7. La vara llega al que planifica, no sólo al que escribe

De las dos varas, la del repo **ya llega** al que planifica: la skill le manda
arrancar de `.agent/conventions.md` y seleccionar en §3. La de ct es la que no, y
este apartado va de ella.

`scripts/kickoff.js` manda escribir el plan del slice con
`writing-plans-prescriptive` como **primer acto**, antes de que `ct-step` entre en
el ciclo. Si la vara de ct sólo se pegara en el task brief, el plan se escribiría
sin ella:

```
kickoff  →  plan (sin vara)  →  --check-plan  →  gate `plan`  →  ct-step  →  brief (con vara)
```

Y entonces el implementador queda encajonado entre dos vetos. Si obedece la línea
`**Files:**` del plan, el juez le bloquea la forma; si construye la forma que la
vara pide, el control de alcance le veta por tocar rutas que el plan no declaró.
`run-machine.js` da `judgeRetries: 2`, así que son tres llamadas y un run cerrado
en `VETOED` — y el fallo no sería del repo, sería de haber metido la vara un paso
demasiado abajo.

Así que **son tres consumidores, no dos**: el que planifica, el que escribe y el
que bloquea. Es la propiedad que el diseño del 21 de agosto ya valoraba —que la
vara del que escribe y la del que bloquea sean el mismo texto— extendida un paso
antes, y sin ella el mecanismo se cierra en falso.

Con la vara delante, el plan nombra módulos nuevos donde la vara pide módulos
nuevos, decide qué es `(create)` y qué es `(modify)`, y el humano lo ve en el gate
`plan` que ya existe. El juez mide entonces contra algo que el plan ya perseguía,
que es lo que hace que no sea una sorpresa.

### 7.1 Por qué esto no obliga a migrar el repo entero

Porque el alcance de `architecture.md` son los módulos nuevos (§5.3). Un repo plano
no incurre por ser plano: incurre si escribe **nuevo** sin la vara. Lo que ya
estaba es deuda declarada y no produce hallazgo, así que no hay migración que un
slice tenga que arrastrar para poder aterrizar.

La consecuencia aceptada es que un repo así **no acaba de migrar solo**: convive
con dos formas, la vieja congelada y la nueva conforme. Se acepta porque la
alternativa —migrar al tocar— hace que el tamaño de un slice dependa de lo viejo
que sea el fichero que le toque, y eso lo decide el azar, no el trabajo.

Esta afirmación era cierta sólo de `architecture.md`, y conviene dejarlo escrito
en vez de corregirlo en silencio: `code.md` no traía esta cláusula hasta ahora,
su alcance era todo diff sin excepción alguna, así que una línea que sólo seguía
el estilo del fichero anfitrión —un comentario en el idioma de alrededor, por
ejemplo— incumplía `code.md` igual que si el módulo fuera nuevo. El
implementador que la escribía para no romper el estilo circundante y el juez que
la bloqueaba citando el mismo documento estaban los dos siguiendo la vara al
pie de la letra: eso es el interbloqueo de §7, y este apartado lo cerraba para
`architecture.md` mientras lo dejaba abierto para `code.md`. La cláusula nueva
de §5.1 lo cierra ahora del mismo modo, con su misma asimetría: lo que es
estilo se exime igual que en `architecture.md`; lo que es defecto sigue rigiendo
todo diff, así que tampoco ahí hay migración que un slice tenga que arrastrar.

## 8. Lo que esto NO hace

- **No selecciona qué parte de la vara viaja en cada brief.** Los cuatro ficheros
  van siempre. El motivo está en §4.1 y el arreglo necesita un campo nuevo en el
  plan, no un gate sobre los que hay.
- **No añade un ítem a la rúbrica.** El ítem que hace falta ya existe: `patrones`.
  Lo que cambia es contra qué mide.
- **No añade una cuarta puerta humana, ni un anuncio nuevo en `/ct-init`.** El
  gate `plan` es donde se ve el tamaño de lo que un slice va a construir, y sigue
  donde estaba.
- **No toca el ítem de observabilidad ni el de patrón de entrega.** El segundo ya
  vive dentro de `patrones` desde el diseño del 21 de agosto; el primero sigue
  siendo material de después.
- **No migra ningún repo a hexagonal.** Lo viejo es deuda declarada por regla
  (§5.3), no por omisión: lo nuevo nace conforme y lo que ya estaba se queda.
- **No retira la vara del repo destino, ni la subordina en bloque.** Sigue
  obligando en todo aquello de lo que la de ct no habla, y la precedencia se mide
  regla a regla (§2).
- **No declara los temas de cada documento como una lista mantenida.** La
  frontera se lee de lo que cada documento dice, no de un índice al lado que
  habría que actualizar cada vez que un documento crezca — y que, desactualizado,
  daría permiso a lo que la regla prohíbe.
- **No trae `git-workflow.md` ni la meta-convención.** Ver §5.5.

---

## 9. La primera corrida, y los seis huecos que midió

El slice #7 de `jjponz/rust-monitoring` (logging JSON, cinco tareas y un
reintento, pull request 18) es la primera corrida con la vara puesta. Lo que
midió obliga a corregir cosas de este mismo documento, así que van aquí y no en
un anexo.

### 9.1 Lo que funcionó, con número

El transporte, entero: `brief_vara_ct_docs = 4` en los **seis** briefs, entre
35,6 y 39,3 KB cada uno. El juez no sólo los recibió — los cita por su nombre y
razona documento a documento, tres o cuatro de los cuatro por tarea. `patrones`
salió `conforme` en las cinco tareas y `rubric_sin_vara` fue 0 en todas.

### 9.2 La premisa de §1 no se reproduce en ese repo

`rubric_sin_vara` **ya era 0 antes de la vara**: `[0,0,0,0]` en el slice #5 y
`[0,0,0,0,0,0,0]` en el #6. En ese repo el ítem `patrones` nunca volvía sin
veredicto, porque el juez se apoyaba en `AGENTS.md` — y el propio veredicto lo
dice: «Vara leída: `AGENTS.md`, el design doc, `ci.yml`». La consecuencia que §1
declara observada («el único ítem de calidad sale sin veredicto slice tras
slice») no es lo que ese repo enseña.

Y el antes/después es **nulo en todas las columnas de salida**: el #6 y el #7 son
idénticos hasta en `findings_total`, `[0,0,0,1,0,0,0]` los dos. Sólo se movió la
columna de entrada.

Lo único atribuible: `main` tiene **funciones sueltas en cinco ficheros de
producción** y los siete módulos nuevos no tienen ninguna, con cero comentarios
en 589 líneas. Es una de las tres reglas de estilo, y es todo lo que se puede
demostrar. Lo demás no es atribuible porque el repo ya venía conforme: un solo
comentario en todo `src/`, y puerto más adaptador (`MetricRepository`) desde
antes del slice, que es de donde el #7 copió `LogOriginSource`.

**Consecuencia para la próxima prueba:** hace falta un repo con comentarios y
funciones sueltas. Contra `rust-monitoring` no se puede medir el efecto de esta
vara, sólo su llegada.

### 9.3 `code.md` se parte en `defects.md` y `style.md`

El único defecto real del slice lo cazó el juez —un evento con `message` que
salía escondido bajo `{app}_data`— y **no citó `code.md` para ello**. La causa
está en el diff: `EventFields` guarda el mensaje como texto y usa la cadena vacía
para decir «no hay mensaje», que es exactamente el defecto «dos campos que tienen
que concordar» del §5.1. El arreglo embudó la pregunta y dejó la representación
intacta: un evento sin mensaje sigue emitiendo `"message":""`.

Por qué se escapó: el juez **sí** leyó el documento, y extrajo sus tres reglas de
estilo. Las cuatro de defecto no se preguntaron. El documento se titula por el
estilo, abre con la cláusula de deuda —que habla de estilo— y pone las reglas de
estilo primero; las de defecto eran la minoría de un documento sobre otra cosa.
Es `selective-hearing` de los ai-patterns, cuyo diagnóstico es explícito: **no se
arregla prompteando**, ni con mayúsculas ni con negritas. El arreglo es
estructural, y es `knowledge-composition`: un documento cuyo único asunto son
esas cuatro reglas no puede tener su asunto filtrado como ruido, porque no hay
nada más dentro que leer.

Así que la vara pasa a **cinco documentos**, y `defects.md` viaja **primero**: la
exención se lee después de la regla que no la admite, nunca antes.

`defects.md` cierra además el hueco que el juez usó para dar por bueno el mapa
crudo: la frontera de serialización es **el último paso antes del cable, y es uno
solo**, así que un módulo que recibe un mapa y todavía decide algo con él comete
el defecto por cerca del cable que esté. Y nombra el valor centinela —la cadena
vacía para «no hay mensaje», el cero para «nunca pasó»— como el segundo campo
disfrazado del primero.

### 9.4 La telemetría medía dónde se archivó el hallazgo, no qué lo produjo

`findings_patrones_vara_ct` sólo miraba hallazgos del ítem `patrones`, con el
argumento de que es el único que mide contra las varas. El run lo refutó: la vara
de ct salió citada **dos veces bajo `decisiones-cerradas`**, y la regla de
mutación de `testing.md` se contestó bajo `test-desiderata`. Un hallazgo que la
vara produjo y se archivó en otro ítem era invisible.

Se sustituye por dos columnas que separan lo que aquélla mezclaba:

| columna | pregunta |
|---|---|
| `rubric_vara_ct_docs` | cuántos documentos llegaron a usarse, sobre el `result` de **todos** los ítems — «la leyeron» |
| `findings_vara_ct` | cuántos hallazgos los citan, en **cualquier** regla — «cazó algo» |

Se leen juntas y en ese orden: `5 docs · 0 hallazgos` slice tras slice es el caso
a vigilar, y con una sola cifra «conformaba» y «se nombró de adorno» son el mismo
número.

> **Corregido por §10.** `rubric_vara_ct_docs` nació midiendo la FORMA de la cita
> y no el uso: exigía el prefijo `conventions/`, y el juez del slice #8 citó los
> cinco documentos por su nombre a secas. Contó cero.

### 9.5 Un control de ct peleando contra una convención de ct

El plan clavaba «52 tests verdes» en cuatro controles. El juez exigió con razón
un test más, y el número caducado hubo que corregirlo en siete sitios del plan
—dos briefs se generaron con el valor viejo—. El daño mayor no es ése: con el
total clavado no quedaba hueco para conducir en rojo lo que `testing.md` exige, y
`record_error` y la rama sin mensaje **se entregaron sin un solo test** para que
un control siguiera verde.

La precedencia de §2 arbitra la vara del repo contra la de ct. No previó que las
dos en conflicto fuesen las dos de ct: su propio control contra su propia
convención. Se cierra en tres sitios, cada uno con lo que sólo él puede hacer:

- **`writing-plans-prescriptive`** — ningún control puede clavar el total de
  tests de la suite. Es el único sitio que lo previene, porque es quien los
  escribe.
- **`plan-contract.js`** — lo rechaza, medido sobre el literal (`52 passed`,
  `7 passing`), que es la forma que imprimen cargo, pytest, jest y mocha. Un
  recuento acotado al módulo de la tarea no la tiene, y es la alternativa que el
  mensaje ofrece.
- **`ct-judge.md`** — un choque así se **declara** y no se cuenta como hallazgo,
  igual que el choque con el linter del repo: el implementador no podía
  satisfacer los dos, y el defecto está en el plan, que no es lo que se juzga.

### 9.6 El go mal formado dejaba al humano a ciegas

En el issue #7: `-OK` pelado a las 10:50, silencio, y el go bueno a las 10:58. El
silencio es deliberado y no se toca —el gate sigue abriéndose sólo con el token
exacto, porque un token reconocido de más arrancaría lo que se quería frenar—,
pero `go-response.js` daba por hecho la otra mitad: «un token que no se reconoce
te deja esperando, y lo notas: vas a mirar». Miró, y no tenía nada que mirar: el
formato está en el CUERPO del issue y quien contesta está leyendo el comentario
del plan.

El vigilante publica ahora el formato **una vez por vigilancia** cuando ve un
comentario nuevo que empieza por el token y no es un go — el token en minúsculas
incluido, que es justo el error que hay que explicar. No cita lo que se escribió:
un intento puede llevar un nonce mal tecleado, y repetirlo publicaría casi todo
el permiso. Y el gate `plan` manda además al agente no publicar `<nonce>` como si
fuera el formato entero, que es de donde salía la confusión.

### 9.7 Lo que esta ronda NO arregla

- **El selector de qué parte de la vara viaja.** Ya tiene precio medido: ~220 KB
  en seis briefs para producir cero citas en hallazgos. Sigue siendo deuda
  declarada de §4.1.
- **`architecture.md`** se queda entera. En ese repo no se pudo probar ni a favor
  ni en contra: sus módulos nuevos son valores de dominio y su puerto con
  adaptador ya venía de `main`.
- **El trinquete de `SKILL.md`** cede otra vez, de 16.616 a 17.207. Se paga
  además la deuda de la subida anterior: se medía siempre contra el tope previo y
  nunca contra el primero, que es cómo un trinquete cede por acumulación sin que
  ninguna subida parezca grande. El acumulado desde 16.314 son +893 bytes, un
  5,5 %, y queda escrito para que la próxima subida tenga que mirarlo.


---

## 10. La columna medía la grafía, no el uso

El slice #8 de `jjponz/rust-monitoring` (instrument y guard, pull request 19) es
la primera corrida con las correcciones de §9. Lo que enseñó del propio
instrumento va aquí.

`rubric_vara_ct_docs` salió `5, 4, 5, 5, 0` en las cinco tareas. El cero de la
tarea 5 es **falso**: su `patrones` discute los cinco documentos por su nombre,
uno a uno, y el conteo no los vio porque el juez escribió `style.md` y no
`conventions/style.md`. §9.4 sustituyó una columna que medía **dónde se archivaba
el hallazgo** por otra que medía **cómo se escribía el nombre del documento**: el
mismo defecto una capa más arriba, y las dos veces un proxy.

El arreglo acepta las dos formas. La de la ruta se queda intacta —es la que no
depende de los nombres de hoy, y es la que contó `defects.md` sin que nadie
tocara nada—. La del nombre a secas se resuelve contra `PluginYardstick.FILES`,
que no es «la lista de hoy» elegida a dedo sino la **definición** de lo que la
vara contiene: un documento que no está en ella no viaja en el brief, así que
nadie puede haberlo citado como vara. Y el nombre se normaliza al devolverlo, o
las dos grafías del mismo documento contarían dos.

Lo que cuesta, dicho: una cita **a secas** de un documento **renombrado** deja de
contar hasta que `FILES` lo nombre. Es aceptable por el mismo argumento —
renombrarlo sin tocar `FILES` significa que ha dejado de viajar— y la forma con
prefijo sigue cubriendo ese caso. El riesgo que queda es un repo que nombre a
secas un fichero propio llamado igual que uno de los nuestros; se acepta, porque
el ítem donde esto se mide está hablando de la vara de ct cuando lo escribe.

Remedido sobre los veredictos reales del #8: `5, 4, 5, 5, 5`. El **4** de la
tarea 2 sobrevive al arreglo y es verdadero — omite `testing.md` —, que es
exactamente lo que la columna tiene que poder distinguir de un artefacto de
grafía.

### 10.1 Lo que §9 sí demostró

Para que quede junto al defecto: el corte de `code.md` funcionó. Los cinco
veredictos contestan las cuatro reglas de `defects.md` una por una —las tareas 1
a 4 numeradas, la 5 con letras— y donde una regla no tiene sujeto lo dicen. En el
#7 esas cuatro reglas no se preguntaron ni una vez en cinco tareas. La cláusula
del centinela que §9.3 añadió se aplica con nombre propio: la tarea 1 juzga
`TraceId` como enum con la ausencia (`Untraced`) dentro del vocabulario, «no como
`Option<String>` ni cadena vacía».

Y el resto: ningún control clava el total de la suite (con la misma trampa de 52
tests delante), y el gate `plan` ya no publica `<nonce>` como si fuera el formato
entero. Cero hallazgos en cinco tareas, así que `findings_vara_ct` sigue sin
poder decir nada: no había nada que cazar.
