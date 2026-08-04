# Contexto heredado entre slices — soporte de primera clase

> F26 · 2026-08-04 · cierra el **§4** del feedback de campo
> (`menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md`).
> Viene de 0.24.0, tras cerrar F23, F24 y F25.

## 1. Qué se arregla

El §4 lo dice así:

> «Ningún agente lee el PR del anterior. Esto nos obligó a **añadir contexto a mano al cuerpo de cinco issues**. Sin eso, el `#455` habría construido **una sola** de las dos variantes que el spec exigía llevar al gate, y el gate no habría podido decidir. Funcionó siempre; es el patrón más rentable del periodo. **Merecería soporte de primera clase** (¿una sección «contexto heredado» que el groom sepa preservar y que `--reconcile` no toque?).»

Ese patrón existe hoy **fuera del plugin**: alguien escribe prosa en el cuerpo del issue y confía en que sobreviva. No hay cabecera acordada, el groom no la conoce, y nada garantiza que siga ahí mañana.

### 1.1 Lo que hay en campo, leído de los issues reales

Los cinco issues del epic `menoplus-app/menoplus` (leídos el 2026-08-04) no comparten cabecera. Cada uno inventó la suya:

| issue | cabecera escrita a mano |
|---|---|
| #453 | `## Contexto heredado del slice #2 (issue #452, ya mergeado)` |
| #455 | `## Contexto heredado (añadido a mano tras cerrar los slices #1 y #2)` |
| #456 | `## Contexto heredado (añadido a mano — eres el ÚLTIMO slice del epic)` |
| #454 | `## GATE HUMANO visual…` **y** `## Convenciones que muerden aquí` |

**Ninguna igual a otra.** Ésa es la razón concreta de que el kickoff no pueda nombrar la sección hoy: no hay ningún nombre que nombrar. Fijar el nombre no es cosmética — es la precondición de todo lo demás.

### 1.2 El contenido no tiene una fuente, tiene cuatro

Clasificado leyendo los cuatro cuerpos:

| eje | de dónde sale | aparece en |
|---|---|---|
| **A** — lo que dejó montado un slice ya mergeado | PRs previos (`#452`, PR `#466`, sha `6a7eb500`) | 453, 454, 455, 456 |
| **B** — lo que el spec dice y la tabla §9 no puede contener | §6.2, §7.2, §7.3, D-5, D-8 | 455, 456 |
| **C** — convenciones del repo (`AGENTS.md`) | `today_madrid()`, sin `JSONB` | **453, 454, 455, 456** |
| **D** — hechos medidos de producción | «180 intervenciones, no las 9 del seed» | 453, 454, 456 |

Dos cosas se leen directamente de esa tabla:

**El eje C está copiado a mano cuatro veces.** Mismo texto, cuatro cuerpos.

**El eje D ya divergió, y el propio issue lo documenta:** *«Leer `corpus_seed.py` y concluir "3 suplementos" es un error de premisa ya cometido en este epic»* (issue #456). Una copia envejeció respecto de otra y alguien construyó sobre la vieja.

### 1.3 El ejemplo que motiva el §4 no viene del PR anterior

El §4 justifica la petición con el `#455` y sus dos variantes. Ese punto está en el cuerpo del issue real, y su fuente es **el §6.2 del spec**, no el PR del slice previo: el spec deja abierta la alternativa y pide decidirla en el gate visual «con ambas versiones delante». La tabla §9 comprime eso a una fila y el cuerpo del issue nunca lo llevó.

Es decir: **el agente no lo vio porque no estaba en su issue**, no porque no leyera el PR del vecino. Se hace constar porque cambia qué arregla de verdad cada opción de diseño — y porque el eje que cubriría ese caso concreto (el **B**) queda **fuera** de F26 (§8).

## 2. Lo que ya funciona, medido y no deducido

`scripts/reconcile.js#buildReconcileBody` **no reescribe el body**: hace splices acotados sobre las secciones que localiza (enlace al spec, Acceptance criteria, Dependencias). Cualquier sección que no conoce sobrevive.

Reproducido sobre el árbol de 0.24.0, con un cuerpo que lleva `## Contexto heredado` + AC divergentes: salen los AC reescritos y la sección heredada **intacta byte a byte**, incluidas sus subcabeceras `###` y sus tablas.

Y no hay ningún camino que lo desmienta: `buildIssueBody` alimenta **sólo** `gh issue create`; para un issue que ya existe, el único escritor de cuerpo es `buildReconcileBody`.

**Lo que falta, entonces, no es la preservación.** Es que exista una cabecera fija, que el groom la emita, que el agente sepa que tiene que leerla, y que «sobrevive» deje de ser un accidente afortunado del que ningún test se ocupa.

## 3. El diseño: dos secciones, dos dueños

La tensión a resolver: el §4 pide que lo escrito a mano **no se toque nunca**, y a la vez el eje C/D pide que el plugin **mantenga al día** un texto común del epic. Las dos cosas no caben bajo un solo dueño.

Se separan en dos secciones, cada una con un dueño único. **No hay ningún parser de zonas dentro de una sección** — la mitad de aplicación de `--reconcile` está documentada como experimental tras cinco rondas de review, cada una encontrando una forma nueva de corromper un cuerpo real; añadirle marcadores internos iría en la dirección contraria.

| sección | dueño | el plugin la… | admite cabeceras dentro |
|---|---|---|---|
| `## Contexto del epic` | el spec, vía `/ct-groom` | escribe al crear **y** reescribe con `--reconcile` | **no** (§3.3) |
| `## Contexto heredado` | la sesión coordinadora | emite vacía al crear y **no la toca nunca más** | sí |

### 3.1 De dónde sale `## Contexto del epic`

De una sección del fichero de spec **con esa misma cabecera literal**, fuera de la tabla §9. Su contenido se copia **tal cual, idéntico, en todos los issues del epic**.

Se localiza **por texto de cabecera, nunca por número de sección**. Es el mismo criterio con el que `slices.js#analyzeSlicesTable` localiza la tabla por sus columnas (`Slice` + `Dep`) y no por «§9»: los números de sección de un spec se mueven cuando alguien inserta una sección antes.

Se reusa `gh-issue-map.js#extractSectionContent` sobre el texto del spec — comprobado que funciona tal cual sobre un fichero de spec, sin adaptación. **No se escribe un segundo escáner de secciones:** el que existe lleva encima el endurecimiento de vallas de código, comentarios HTML multilínea y cabeceras ATX de las rondas 4 y 5 de F5, y una segunda implementación divergiría de él.

**Si el spec no trae la sección**, no se emite nada en los issues y se avisa una vez por corrida — mismo trato que las columnas opcionales ausentes de la tabla §9. Un spec sin esta sección es un spec válido.

**Una sección presente pero vacía cuenta como ausente**, con su propio aviso (que dice que la cabecera está y no tiene contenido, para no confundirla con la anterior). Es el criterio que `renderDescripcion` ya aplica a la columna `Entrega`: sin contenido real, la sección no debería existir en el cuerpo.

### 3.2 De dónde sale `## Contexto heredado`

De nadie: el groom la emite **vacía**, con una línea que dice qué va ahí y quién la rellena. Nunca vuelve a tocarla — ni al re-groomear, ni con `--reconcile`.

Se emite aunque esté vacía por el mismo motivo por el que `## Gates` se emite siempre (F21): una sección que sólo existe cuando alguien se acordó de crearla es una sección que nadie crea cuando hace falta. Y en este caso hay evidencia directa: las tres cabeceras distintas del §1.1 son lo que pasa cuando no hay sitio fijo.

### 3.3 La restricción que descubre la propia maquinaria

`locateSection` termina una sección en **cualquier** cabecera ATX, incluidas `###` y `####` (endurecimiento de F5, ronda 5, Critical 2 — sin él, el contenido de una subcabecera se tragaba en el splice de la sección anterior).

Consecuencia medida sobre 0.24.0: un splice sobre una sección que lleva `### 1 ·` dentro reemplaza sólo hasta esa primera subcabecera y **deja el resto huérfano bajo el texto nuevo**. El cuerpo queda sintácticamente vivo y semánticamente falso.

Por eso las dos secciones se comportan distinto, y no por gusto:

- `## Contexto heredado` **puede** llevar `###` y tablas — es exactamente lo que hizo el campo (issues #455 y #456) — porque **nadie la splicea**.
- `## Contexto del epic` **no puede**, porque sí se splicea.

**Guardarraíl:** si el texto del spec trae una cabecera ATX dentro de esta sección, `/ct-groom` **no la emite** y lo dice, nombrando la línea ofensora. Se corta en el productor y no se deja que el consumidor se defienda — mismo criterio que `groom.js#findDuplicateOrders`. No aborta la corrida entera: la sección es opcional, y bloquear un groom completo por una sección opcional malformada sería desproporcionado; el remedio va en el aviso.

Ese contenido no necesita cabeceras: lo que el campo puso en el eje C/D son bullets (`today_madrid()`, sin `JSONB`, el corpus real de producción).

### 3.4 Posición en el cuerpo

Las dos van **después de `## Descripción` y antes de `## Acceptance criteria`**:

```
enlace al spec → Descripción → Contexto del epic → Contexto heredado
              → Acceptance criteria → Dependencias → Gates → Out of scope / Protected
```

Es contexto para interpretar los criterios de aceptación; leerlo después de ellos es leerlo tarde. En campo acabaron al final del cuerpo, pero por ser el sitio más cómodo para pegar a mano en un issue ya creado, no por una decisión de lectura.

Comprobado sobre 0.24.0 que con las dos secciones nuevas en esa posición, `extractAc`, `extractDepsInSection`, `extractStrayDeps` y `extractSectionContent` siguen localizando lo suyo, `diffIssue` no inventa divergencias, y un `--reconcile` que reescribe AC y dependencias deja ambas secciones intactas.

## 4. Contrato

### 4.1 Cabeceras

Dos constantes exportadas desde `groom.js`, junto a `GATES_HEADING` y por el mismo motivo que ella: las nombran el que escribe, el que compara y sus tests, y una cabecera tecleada en tres sitios acaba divergiendo en uno.

- `## Contexto del epic`
- `## Contexto heredado`

La cabecera es **la misma en el spec y en el issue** para la primera: una sola cadena que aprender.

### 4.2 `/ct-groom` al crear un issue

- Emite `## Contexto del epic` con el texto del spec, **sólo si** el spec trae la sección y pasa el guardarraíl de §3.3.
- Emite `## Contexto heredado` **siempre**, vacía, con su línea de placeholder.

### 4.3 `/ct-groom --reconcile` sobre un issue existente

- `## Contexto del epic`: se compara y **se reescribe**, con el mismo splice acotado que ya usa para Acceptance criteria. Si la cabecera no existe en el issue (uno anterior a F26), se inserta entera **justo antes de `## Acceptance criteria`** — la posición de §3.4, con la cabecera de AC como único ancla seguro. Sin ese ancla, se rinde sin escribir nada, misma forma que la inserción de `## Dependencias` cuando le falta el suyo.

> **Corrección (review final de rama, menor).** Anclar en AC es lo que pone la sección en el sitio equivocado cuando el issue ya tiene `## Contexto heredado`: aterriza **detrás** de ella e invierte el orden que este mismo §3.4 fija. El ancla preferente pasa a ser `## Contexto heredado` (se inserta justo **antes** de su cabecera, sin tocar un byte de su contenido), con AC como respaldo cuando esa sección no existe. Sin ninguna de las dos, se sigue rindiendo sin escribir nada.
- `## Contexto heredado`: **no se compara, no se reescribe, no se inserta.** El plugin no tiene ninguna opinión sobre su contenido.

Que esta sección sí se reescriba siendo prosa —cuando Descripción y Protegido no— tiene un motivo que las distingue: Descripción y Protegido son prosa que un humano edita de forma rutinaria y legítima en un issue suelto. `## Contexto del epic` no: es texto del epic, idéntico en los N issues, y editarlo a mano en uno solo es precisamente lo que produce la divergencia que esto viene a matar. Quien quiera contexto propio de un slice tiene la sección de al lado, que es intocable — y el propio placeholder lo dice.

### 4.4 Códigos de salida

Ninguna de las dos secciones cuenta jamás para el `3`. Ni una divergencia, ni un duplicado.

Mismo criterio que Descripción/Protegido/Gates: anclar el exit code a esto haría que **todo** issue groomeado antes de F26 saliera `3` en cada corrida hasta que alguien reescribiera su cuerpo a mano, y eso entrena a ignorar el resto del informe. Se reportan como `nota:`, siempre que apliquen.

Las dos cabeceras se añaden a `DUPLICATE_CHECKS` con `machine: false`: un duplicado se avisa, no cuenta.

### 4.5 El kickoff

Una línea nueva que **nombra las dos secciones sin interpolar su texto**.

El criterio ya está tomado y escrito en `kickoff.js`, donde F21 resolvió este mismo problema para `## Out of scope / Protected`, con sus dos motivos: la prosa es de longitud arbitraria y el kickoff se teclea entero en un pty; y *«lo que se enumera se lee, y lo que se deja a "ya lo verá" compite con el resto del body»*. Nombrar la sección es estrictamente más fuerte que «hidrátate del issue».

La línea es honesta con los dos casos en que no hay nada que leer, que son distintos: la sección **está vacía**, o **no está** (un issue anterior a F26 nunca recibe `## Contexto heredado`, porque `--reconcile` no la inserta). En ambos, no hay nada que heredar y se dice — para que el agente no salga a buscarlo fuera del issue ni lo dé por perdido.

## 5. Lo que hace falta construir

| Pieza | Dónde |
|---|---|
| Las dos constantes de cabecera | `scripts/groom.js` |
| Lectura de la sección del spec + guardarraíl de cabeceras internas | `scripts/groom.js` (puro), llamado desde `scripts/ct-groom.mjs` |
| Emisión de ambas secciones al crear | `scripts/groom.js#buildIssueBody` |
| El texto del epic viajando en el plan | `scripts/groom.js#groomPlan` |
| Comparación de `## Contexto del epic` | `scripts/reconcile.js#diffIssue` |
| Nota en el informe | `scripts/reconcile.js#formatDrift` |
| Splice + inserción anclada | `scripts/reconcile.js#buildReconcileBody` |
| Duplicados, `machine: false` | `scripts/reconcile.js#DUPLICATE_CHECKS` |
| La línea que nombra las dos secciones | `scripts/kickoff.js#renderKickoff` |
| Contrato de la sección del spec | `commands/ct-groom.md` |

## 6. Tests que fijan las propiedades

Lo que convierte esto en soporte de primera clase no es el código nuevo: es que las propiedades de las que depende dejen de sostenerse solas.

1. **`## Contexto heredado` sobrevive** a un `--reconcile` que reescribe enlace al spec, AC y dependencias — byte a byte, con subcabeceras y tablas dentro. *Hoy esto es cierto y ningún test lo protege.*
2. **`--reconcile` nunca inserta ni borra** `## Contexto heredado`, ni siquiera cuando falta del cuerpo.
3. **`## Contexto del epic` se reescribe** cuando el spec cambia, y **sólo ella**.
4. **La inserción se rinde** sin `## Acceptance criteria` como ancla, en vez de escribir a ciegas.
5. **El guardarraíl corta**: una sección del spec con `###` dentro no se emite, y el aviso nombra la línea.
6. **Ninguna de las dos mueve el exit code**, ni divergiendo ni duplicada.
7. **El kickoff nombra las dos secciones**, con las cabeceras exactas que emite el groom — leídas de las constantes, no tecleadas en el test.
8. **El cuerpo con las dos secciones nuevas no altera** lo que extraen `extractAc` / `extractDepsInSection` / `extractStrayDeps`.

## 7. Riesgos

**El splice de una sección de prosa es escritura nueva en la parte frágil del plugin.** Mitigación: es exactamente la misma forma que el splice de Acceptance criteria, probado; el guardarraíl de §3.3 elimina la única forma conocida de que parta un cuerpo; y se rinde en vez de adivinar cuando falta el ancla.

**Un texto del epic largo se copia en N issues.** Es el precio de que cada agente lo tenga delante sin leer otro fichero. El campo ya pagó ese precio a mano; la diferencia es que ahora las N copias no pueden divergir.

**El aviso del guardarraíl puede no leerse**, y entonces alguien cree que el contexto se emitió. Se acepta: no emitir nada es fail-safe (no corrompe ningún cuerpo), y el repo ya trata así las columnas opcionales ausentes.

> **Corrección (review final de rama, I1).** «No emitir nada es fail-safe» era cierto al CREAR y falso al reconciliar, y este §7 no lo vio: los modos de fallo del guardarraíl colapsaban todos en «sin texto», que es exactamente la señal con la que el §4.3 pide RETIRAR la sección. Con eso, un `###` de más en el spec borraba el contexto de los N issues del epic en el `--reconcile` siguiente. Se separa el motivo: «el epic no tiene contexto» (sección ausente o vacía) autoriza a retirar; «no he podido leer un texto válido» (truncada, o con un delimitador sin cerrar) no autoriza nada y deja los cuerpos como están.

## 8. Lo que F26 no hace

**El eje B — dirigir texto del spec a un slice concreto.** Es el caso del `#455` y su §6.2 (§1.3): el spec dice algo que afecta a *un* slice y la tabla §9 no puede llevarlo. Requiere decidir cómo el spec direcciona texto por slice, que es una decisión de contrato mayor que todo lo demás de esta ronda junta. Se deja fuera **explícitamente**, y no se insinúa que el §4 quede cerrado del todo: queda cerrado el transporte y el eje C/D.

**Leer el PR del slice anterior.** Nada aquí abre PRs ni los resume. El eje A lo sigue escribiendo la sesión coordinadora, que es quien tiene el PR delante cuando mergea; lo que gana es un sitio fijo donde ponerlo y la garantía de que llega.

**Tocar `## Contexto heredado` de cualquier forma.** Es la petición literal del §4 y se cumple sin excepciones.

## 9. Versión

`0.25.0` — cambio de contrato aditivo: el cuerpo de los issues gana dos secciones y el spec gana una sección opcional. Nada de lo que hoy funciona deja de funcionar: un spec sin la sección nueva produce los mismos issues de hoy más una `## Contexto heredado` vacía.
