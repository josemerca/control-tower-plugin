# La vara la dicta ct — las convenciones viajan con el plugin, no con el repo

> Cierra la mitad que `2026-08-21-la-vara-del-repo-en-el-plan-design.md` dejó
> abierta, y la cierra **al revés** de como aquélla la planteaba. Aquélla
> construyó el transporte para que la vara del repo destino llegara al
> implementador y al juez. Esto retira la vara del repo y pone en su sitio la de
> ct.
>
> El problema que cierra: **los slices entregan calidad irregular porque en la
> práctica nadie mide contra nada.** El transporte funciona; lo que no llega es
> vara, porque `/ct-init` siembra la declaración vacía y un repo que no escribe
> sus convenciones se queda `sin-vara` para siempre.

---

## 1. El problema, medido

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

## 2. La decisión: ct dicta cómo se programa

**Las convenciones dejan de ser una propiedad del repo destino y pasan a ser una
propiedad del plugin.** No un suelo que la vara del repo pueda completar ni una
vara secundaria que ceda en caso de contradicción: la única vara de reglas. Una
convención del repo que la contradiga no aplica.

Lo que esto compra es que el estado `sin-vara` **deja de poder ocurrir** en el
ítem `patrones`. La vara viaja con el plugin, así que no hay repo sin ella, no
hay declaración que se quede vacía y no hay nada que un humano tenga que
escribir antes de que el mecanismo mida. El argumento de F14 se queda sin sujeto:
no se está exigiendo una vara que el repo no tiene, se está trayendo puesta.

El origen del contenido es `docs/conventions/` de `alcaptar/agentic-skills`, un
corpus que ya está escrito, ya se aplica y ya tiene su propia meta-convención
sobre cómo se escribe una convención. Lo que se trae es la parte
que es verdad en cualquier lenguaje; lo que se queda fuera es lo que sólo es
verdad en Python.

## 3. Cómo cruza el embudo

`ct-step` sólo puede leer dos cosas: el plan y ficheros del disco. La vara del
repo cruzaba por la segunda, leída de `.agent/conventions.md`. La vara de ct cruza
por la misma puerta, cambiando de dónde se lee: `PLUGIN_ROOT` ya existe en
`scripts/ct-step.mjs`, así que el programa puede leer un fichero del propio
plugin sin inventar ningún transporte.

```
conventions/*.md  (en el plugin)
   │
   ├─ kickoff.js nombra sus rutas en el primer acto del slice
   │     ▼
   │  el que escribe el plan  (writing-plans-prescriptive)
   │
   └─ ct-step.mjs las lee con PLUGIN_ROOT y las pega VERBATIM
      al final del task brief — ningún agente lo escribe ahí
         ▼
      task brief
         │
         ├──► implementador  (lo tiene delante antes de escribir)
         └──► juez           (lee ese mismo brief antes de bloquear)
```

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

### 3.1 El fallo cambia de doctrina, y es lo más importante de este apartado

Hoy, si `.agent/conventions.md` falta, es un estado benigno: el brief sale sin
vara, `ct-step` avisa por stderr y el juez lo mide `sin-vara`. Cuando la vara
viaja con el plugin, faltar ya no significa «este repo no escribió sus
convenciones» sino **instalación rota**.

Así que ahí `ct-step` **aborta** en vez de avisar. Un brief sin la vara produciría
un implementador y un juez midiendo con nada, y eso es exactamente la desviación
silenciosa (`silent-misalignment`) que todo este mecanismo existe para cerrar: en
silencio, un ítem sin vara no se distingue de un ítem conforme.

## 4. El reparto: cuatro ficheros, no uno

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

### 4.1 Hoy viajan los cuatro, y el selector es deuda declarada

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

## 5. Qué dicen los cuatro

El idioma es **inglés**, como todo el corpus del plugin que llega a un agente
(`prompts/task-implementer.md`, `agents/ct-judge.md` y las skills que
empaqueta). La vara
se cita desde esos dos documentos: en castellano quedaría en otro idioma que la
rúbrica que la invoca, y contradiría su propia regla de escribir el código en
inglés.

### 5.1 `conventions/code.md`

Alcance: **todo diff**.

- **Cero prosa en el código: ni comentarios ni docstrings.** Si un trozo de
  código no se entiende sin un párrafo al lado, el arreglo es el código —nombres
  que digan lo que hacen, funciones pequeñas con una responsabilidad, tipos que
  hagan imposible el mal uso, constantes con nombre en vez de literales—. Un
  condicional que necesitaba tres líneas de explicación es casi siempre una
  función con nombre esperando a nacer, y un invariante que se explicaba en prosa
  es casi siempre un test que falta.
- **El código va en inglés**: ficheros, módulos, tipos, funciones, métodos,
  variables, parámetros, constantes, miembros de vocabulario, errores, nombres de
  test y los mensajes que ve una persona. Excepción: un dato que es parte de un
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
- **Nada de andamiaje especulativo**: lo mínimo para lo que hay delante.

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

## 6. Qué se retira

| Pieza | Qué le pasa |
|---|---|
| Siembra de `.agent/conventions.md` en `scripts/ct-init.sh` | Fuera, sin sustituto. La primera versión de este diseño ponía ahí un aviso; se retiró al ver que avisaba de un deadlock que §7 elimina. Un anuncio sobre el que nadie decide nada es ruido, y el sitio donde se decide si una migración cabe en un slice es el gate `plan`, que ya existe |
| `scripts/detect-vara.mjs` y la mitad de candidatos de `scripts/vara.js` | Fuera enteros, con `__tests__/vara-candidatos.test.js`. El barrido existía para proponer candidatos a un humano que ya no tiene nada que declarar |
| La mitad de transporte de `scripts/vara.js` | Se queda, cambiando de sujeto: `CONVENTIONS_FILE` deja de ser una ruta relativa al repo y pasa a ser la del plugin, la rama de «no hay vara» de `seccionDeVara` desaparece, y el encabezado que se pega deja de decir «la vara del REPO» |
| `Rules to obey:` de `## 3. Reference patterns` | Fuera, en `plan-template.md` y en `SKILL.md`. §3 se queda sólo con `Files to imitate:`, que no son reglas sino código real de este repo cuyo idiom se copia |
| Regla `reference-paths` de `scripts/plan-contract.js` | **Se queda**, comprobando que las rutas que §3 cita existen. Lo que cambia es su mensaje de fallo, que hoy dice «§3 es la vara con la que el implementador escribe y el juez bloquea»: eso deja de ser verdad en cuanto §3 son sólo ejemplares |
| Ítem `patrones` de `agents/ct-judge.md` | Reescrito: deja de medir la unión de dos varas y mide los ejemplares de §3 más la vara de ct que trae el brief. Pierde el outcome `sin-vara`, que ya no puede ocurrir, y conserva `no-aplica` para un diff sin código que comparar |
| `prompts/task-implementer.md`, punto 3 | Reescrito simétricamente, para que el que escribe y el que bloquea lean el mismo texto |
| `scripts/kickoff.js` | Gana las rutas de los cuatro ficheros en el primer acto del slice, junto a las que ya calcula (`dispatchCheckPath`, `ctStepPath`) |
| `skills/writing-plans-prescriptive/SKILL.md` | Además de perder el `Rules to obey:`, gana la orden de leer la vara **antes** de escribir el plan. Ver §7 |
| `scripts/conventions.js` y `scripts/conventions-io.js` | **Intactos.** Son otro sujeto —colisiones de protocolo entre el loop y el repo destino: claim, worktrees, fichero de estado—, con su propio `.agent/conventions-ack.md`. La trampa de nombre ya está documentada en la cabecera de los dos ficheros y sigue valiendo |

## 7. La vara llega al que planifica, no sólo al que escribe

`scripts/kickoff.js` manda escribir el plan del slice con
`writing-plans-prescriptive` como **primer acto**, antes de que `ct-step` entre en
el ciclo. Si la vara sólo se pegara en el task brief, el plan se escribiría sin
ella:

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
- **No trae `git-workflow.md` ni la meta-convención.** Ver §5.5.
