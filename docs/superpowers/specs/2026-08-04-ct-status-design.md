# `/ct-status` — una sola llamada para saber en qué estado está el loop

> F25 · 2026-08-04 · cierra el **§3.2** del feedback de campo
> (`menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md`), con el **§3.1** dentro.
> Viene de 0.23.1, tras cerrar F23 y F24.

## 1. Qué se arregla

El coordinador no tiene forma de preguntar «qué está en vuelo, qué ha entregado, qué es residuo». Se lo cocina a mano **cada vez**, cruzando `pgrep` + `lsof` + `gh issue view` + `gh pr list` + `git worktree list` + `git rev-list`.

**Eso ya costó un error real, medido:** en una de esas comprobaciones se usó `gh issue list --state closed --limit 60` sobre **99** issues cerrados y se reportaron **6 casos cuando eran 10** — con un fallback que además imprimía «(ninguno — limpio)», así que con otro corte habría dicho **cero** con la misma cara de confianza.

El §7.1 del feedback cataloga ocho comandos del coordinador que **no dieron error y no hicieron lo que parecían**. Un comando canónico elimina esa clase de error de raíz para seis de los ocho, y le da a cualquier vigilante externo **una sola cosa que llamar**.

### 1.1 El §3.1 va dentro, no suelto

Un slice que muere a medias deja **claim puesto, worktree y rama en disco**. Por eso mismo la detección de claims rancios **no se activa**: `assessLocalLiveness` (`ct-next.mjs`) pregunta «¿existe worktree, rama o ventana de cmux?», los tres responden que sí, y `stalenessNote` devuelve `null`. Sumado al `SLICE.md` en su semilla, **el sistema se queda callado para siempre**.

La señal que lo destapa es otra pregunta: **¿hay un proceso `claude` cuyo `cwd` esté dentro de `.worktrees/<n>`?** — «existen artefactos» frente a «alguien está trabajando ahora». No sustituye a `assessLocalLiveness`; responde algo que ésa no puede.

## 2. Qué es esto, en realidad

**No es maquinaria nueva.** Es una superficie de informe sobre lo que el loop ya sabe, más una señal nueva y una consulta nueva:

| Pieza | Estado |
|---|---|
| Detección de lo entregado sin cosechar | **ya existe** — `collectFinishedResidue` (`dispatch.js`, F20/H2) |
| Detección de residuo `status:` sobre issues cerrados | **ya existe** — F18/H2, con su acuse en `.agent/` |
| Carga paginada de issues, sin `--limit` | **ya existe** — `loadIssues` |
| Evaluación de vida local (worktree/rama/cmux) | **ya existe** — `assessLocalLiveness` |
| **¿Hay proceso vivo en el worktree?** | **nueva** (§4) |
| **¿Cuándo se puso el claim?** | **nueva** (§5) |
| **¿Hay worktrees que ningún issue reclama?** | **nueva** (§2.1) |

### 2.1 El worktree que nadie reclama

`collectFinishedResidue` itera sobre `mergedIssues` — los slices **ya mergeados**. Responde «¿qué slice terminado deja worktree o rama?», y **no** cubre un `.worktrees/<n>` que ningún issue reclama: uno abandonado, uno requeueado, o el de un issue cerrado sin mergear.

Ese caso importa y no es teórico: el propio comentario de `collectFinishedResidue` lo dice — **`/ct-next` se NIEGA a despachar si `.worktrees/<n>` ya existe**. Un worktree huérfano bloquea el redespacho de ese número **en silencio**, que es justo la clase de fallo que este comando viene a matar.

Es barato: listar `.worktrees/*`, restar los que explican los issues en vuelo y los mergeados, y nombrar el resto. Como todo lo demás aquí, **se nombra y no se borra**: `collectFinishedResidue` ya tomó esa decisión con argumento («borrar el worktree de alguien que sigue trabajando es irreversible»), y este comando no la contradice.

Eso acota el riesgo: la mayor parte de lo que se mueve está probado en campo. Lo que hay que construir con cuidado son **las tres piezas nuevas** —la señal de proceso, la edad del claim y el worktree huérfano— y el contrato de salida.

## 3. Dónde vive, y qué se extrae

**Comando nuevo:** `commands/ct-status.md` + `scripts/ct-status.mjs`. Es el patrón que el repo ya usa para `dispatch-check.mjs`: un script propio, no una bandera más.

Se descartó una bandera `--status` en `/ct-next`: ese fichero tiene **3933 líneas** y ya mezcla bastante; y un coordinador que sólo quiere mirar tendría que fiarse de que la bandera corta antes de cualquier mutación, en vez de invocar un comando que **no puede** mutar.

**Qué se extrae de `ct-next.mjs`, y qué no.** Menos de lo que parecía: al medirlo, **dos de las cuatro piezas ya están extraídas y son puras**.

| Pieza | Estado real |
|---|---|
| `collectFinishedResidue` (cosecha) | **ya es pura** — vive en `dispatch.js`, se importa y ya está |
| `closedWithLiveStatus` (residuo de labels) | **ya es pura** — vive en `gh-issue-map.js`, se importa y ya está |
| `assessLocalLiveness` (worktree/rama/cmux) | **hay que extraerla** — cierra sobre dos globales (`repoRoot`, `childTimeoutFor`), que pasan a parámetros |
| La carga de issues | **hay que extraerla**, y con un cambio: hoy hace `process.exit(1)` dentro. Un módulo compartido no decide por su llamante — pasa a **lanzar**, y cada comando elige qué hacer con el fallo |

Lo que no comparten, no se toca. **No es un refactor de oportunidad**: `ct-next.mjs` adelgaza como efecto de compartir, no como objetivo. Un cambio de conducta de `/ct-next` durante esta extracción es un defecto, no una mejora — la extracción debe ser demostrablemente neutra.

### 3.1 Los tres cubos y de dónde sale cada uno

| Bloque del informe | Fuente |
|---|---|
| **En vuelo** | issues con `status:in-progress`, más sus señales: worktree y rama (`assessLocalLiveness`, ya existe) y **proceso vivo** (§4, nuevo), con la **edad del claim** para no acusar a uno que arranca (§5, nuevo) |
| **Entregado, sin cosechar** | `collectFinishedResidue` (ya existe) |
| **Residuo** | el detector de labels `status:` sobre issues cerrados (ya existe) **+** los worktrees que ningún issue reclama (§2.1, nuevo) |

## 4. La señal de vida

```
ps -u <uid> -o pid=,comm=             → los procesos del usuario, con la ruta invocada
   └─ se queda con los de basename exactamente `claude`  → los PID
lsof -a -p <todos> -d cwd -Fpn        → una sola llamada, el cwd de cada uno
```

Medido en esta máquina: **decenas de ms** el `ps`, y **del orden de cientos de ms** la llamada agrupada de `lsof` sobre unos cientos de PID, con salida parseable en tripletes `p<pid>` / `fcwd` / `n<ruta>`. Las dos llamadas llevan `timeout` + `killSignal`: `lsof` se cuelga indefinidamente con un montaje de red muerto, y un comando pensado para que lo invoque un vigilante en bucle no puede quedarse sin devolver código de salida.

Un PID que muere entre el `ps` y el `lsof` **no la rompe**, pero conviene saber por qué: `lsof` **no** «sale con 0 y lo omite» —eso es falso, medido—, sale con **1** en cuanto falta uno de los PID pedidos, aunque el resto se resuelva bien y venga en `stdout`. Leer ese `stdout` parcial sólo es seguro porque la lista está **acotada al usuario actual**: todo PID es propio y legible, así que la única razón de que falte es que haya muerto. Y sólo se hace con `rc=1`: un `lsof` que no existe (127) o que el `timeout` ha matado (`status: null`) puede traer un `stdout` cortado, y darlo por bueno sería afirmar «no hay nadie vivo» sobre datos a medias.

**Se identifica por la RUTA INVOCADA, no por el nombre del proceso — y `pgrep` queda descartado.** Los dos hechos que lo deciden, medidos:

1. **El nombre del proceso no es «claude».** El instalador nativo deja `~/.local/bin/claude` como symlink a `~/.local/share/claude/versions/<versión>`, y el nombre del proceso sale del ejecutable **ya resuelto**: `ps -u <uid> -o pid=,ucomm=` devuelve `18539  2.1.220`. El nombre del proceso **es el número de versión**, y cambia con cada actualización. Cualquier matcheo por nombre persigue un blanco móvil.
2. **`pgrep` excluye a sus propios ancestros.** `man pgrep`, flag `-a`: «By default, the current pgrep or pkill process and all of its ancestors are excluded». Como `/ct-status` se invoca **desde** una sesión de Claude Code, el `claude` de esa sesión es ancestro del `pgrep` y queda fuera del resultado.

La combinación era el peor fallo posible de esta feature, y se reprodujo de punta a punta: con una sola sesión abierta, `pgrep -x claude` sale vacío con `rc=1`, que este comando interpretaba como «ninguna coincidencia, respuesta normal» → `comprobado: true` → **todo slice sano en vuelo salía `← SIN SEÑAL DE VIDA` con exit 3 y sin un solo `aviso:`**, y el bloque de residuo afirmaba «no hay ningún proceso trabajando dentro» sobre un worktree con un agente dentro. La degradación segura no se activaba porque, desde dentro, la lectura «había sido un éxito».

Lo que sí identifica es la columna `comm` de `ps`, que conserva la ruta con la que se invocó el proceso (`/Users/…/.local/bin/claude`) y no cambia al actualizar. Se acepta sólo si su **basename es exactamente `claude`**, comparando string contra string. El matcheo exacto deja fuera la app de escritorio sin ninguna regla adicional: `/Applications/Claude.app/Contents/MacOS/Claude` tiene basename `Claude` (mayúscula) y sus helpers `Claude Helper`, `Claude Helper (Renderer)`, `Claude Helper (Plugin)`. Un matcheo laxo afirmaría que hay un agente donde sólo hay una ventana abierta. La línea de `ps` **no se trocea por espacios** —esas rutas los llevan dentro—: el PID es el primer campo y todo el resto es la ruta.

`ps` se acota al usuario actual (`-u <uid>`) por el mismo motivo por el que lo hacía el `-U` de `pgrep`: es lo que hace segura la lectura del `stdout` parcial de `lsof`. Y `ps`, a diferencia de `pgrep`, **no excluye ancestros**, así que sí ve la sesión desde la que se le llama.

El `cwd` se mapea a `.worktrees/<n>` para saber **qué slice** está vivo, no sólo que haya algo vivo.

**Cuando no se puede comprobar, no se acusa.** Si `ps` o `lsof` no están, fallan, se cuelgan o devuelven algo ilegible: **«no se pudo comprobar»**, nunca «muerto». Acusar de abandono a un slice sano porque falta una herramienta sería el peor fallo posible de este comando, y contradice todo lo que el loop hace en otros sitios ante una lectura fallida.

## 5. La ventana de arranque

Justo después de un despacho, cmux está tecleando el comando y `claude` **aún no ha arrancado**. Un `--status` en ese hueco diría «sin señal de vida» sobre un slice perfectamente sano.

El §3.1 propone «dos lecturas consecutivas para no confundir un `lsof` transitorio». **Se descarta, y con motivo medido:** el `cwd` de un proceso no parpadea y la llamada es determinista, así que dos lecturas separadas por segundos miden medio segundo de vida — no la ventana de arranque. Un slice que lleva 20 s arrancando saldría como muerto en las dos.

**Lo que sí ataca la causa:** la edad del claim. Por debajo del presupuesto del centinela de arranque (`DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS`, hoy **15 000 ms**, configurable y con tope de 600 s) el informe dice **«arrancando»** en vez de «sin señal de vida».

**De dónde sale la edad.** Del **timeline** del issue: el evento `labeled` más reciente para `status:in-progress`. Verificado contra un issue real: el endpoint devuelve `event`, `label.name` y `created_at`. Una llamada por issue en vuelo, y «en vuelo» está acotado por el cap.

**Se descartó `updated_at` del propio issue**, que vendría gratis en el payload que ya se lee: cambia con cualquier edición —un comentario, otra label— así que un comentario reciente haría pasar por «arrancando» un claim de hace tres horas. Las labels **no llevan fecha** en el payload REST; comprobado.

Si el timeline no se puede leer: no se acusa, y cuenta como «no se pudo comprobar» (§7).

## 6. El informe

Agrupado por **lo que hay que hacer**, no por tipo de dato:

```
EN VUELO (2)
  #481  refresh de tokens
        worktree ✓  rama ✓  proceso ✓  pid 41299
  #483  migración de plan
        worktree ✓  rama ✓  proceso ✗  ← SIN SEÑAL DE VIDA
        claim puesto hace 3 h

ENTREGADO, SIN COSECHAR (1)
  #479  marca de ritmo — PR #487 mergeado
        quedan worktree y rama en disco

RESIDUO (2)
  #452  cerrado, pero conserva status:in-review
  .worktrees/9  sin issue vivo que lo reclame

exit 3 — hay 3 cosas que revisar
```

Un vistazo basta para saber si hay algo que hacer. Los bloques vacíos no se imprimen; un loop limpio produce un informe corto, no tres encabezados con «(ninguno)».

**Canal.** El informe va por **stdout** — es el producto del comando. Los `aviso:` de lecturas que no se pudieron completar van por **stderr**, como en el resto del plugin.

## 7. Códigos de salida

| Código | Significa |
|---|---|
| `0` | limpio: nada en vuelo sin señales de vida, ningún residuo, ningún aviso |
| `3` | hay algo que revisar: residuo, un claim sin proceso vivo, labels huérfanas, entregas sin cosechar |
| `1` | **no se pudo comprobar**: falló una lectura de `gh`, de `cmux` o de los procesos |

Misma convención de tres estados que ya usa `/ct-groom`, así que no se inventa vocabulario.

**El `1` nunca se degrada a `0`.** Es la regla dura de este comando y es literalmente el bug del §3.2: un fallback que imprimió «(ninguno — limpio)» sobre datos truncados. Una lectura incompleta **no es** un loop limpio, y quien reciba la señal tiene que poder distinguirlas.

**Un hallazgo parcial no oculta el resto.** Si falla la lectura de procesos pero la de issues va bien, se informa de lo que sí se sabe, se avisa de lo que no, y se sale con `1`.

## 8. Qué NO entra

- **Ninguna mutación.** El comando no toca labels, ni worktrees, ni ramas. El §3.1 lo dice para la señal de muerte —«avisando, nunca revirtiendo el claim solo»— y aquí se generaliza al comando entero: es la propiedad que permite invocarlo sin pensárselo.
- **Nada de `--json`.** Con los tres códigos de salida un vigilante externo ya puede gatear sin parsear texto. Añadir un formato de máquina antes de que alguien lo necesite es adivinar qué campos querrá.
- **Ningún `--limit`, en ninguna lectura.** Todo paginado. Es el defecto que originó el §3.2.
- **No se toca `/ct-next` más allá de la extracción**, y ésa debe ser neutra en conducta.
- **No entra el §4 del feedback** (contexto heredado entre slices): va después.

## 9. Tests

**De las piezas extraídas:** cada módulo que salga de `ct-next.mjs` llega con tests propios — hoy sólo están cubiertos indirectamente, a través del comportamiento de `/ct-next`.

**Neutralidad de la extracción:** la suite de `/ct-next` debe pasar sin tocar una sola aserción. Si un test de `ct-next` necesita cambiar, la extracción no fue neutra y hay que pararse.

**De la señal de vida:**
- un worktree con proceso vivo → se reporta vivo;
- un worktree **sin** proceso, con claim antiguo → sale como sin señal de vida;
- un worktree sin proceso, con claim **reciente** → sale como «arrancando», no como muerto;
- `ps`/`lsof` ausentes o fallando → «no se pudo comprobar», exit `1`, y **nunca** «muerto»;
- un proceso de la **app de escritorio** (`…/MacOS/Claude`, `…/Claude Helper`) → **no** cuenta como agente;
- el timeline ilegible → no se acusa, exit `1`.

**Del worktree huérfano (§2.1):**
- un `.worktrees/<n>` que ningún issue en vuelo ni mergeado explica → sale como residuo;
- un `.worktrees/<n>` de un issue **en vuelo** → NO sale como huérfano (es el caso normal);
- un `.worktrees/<n>` de un issue **mergeado** → sale por el cubo de cosecha, no duplicado en residuo;
- no se puede listar `.worktrees/` → «no se pudo comprobar», exit `1`, **nunca** «no hay huérfanos».

**Del contrato de salida:**
- loop limpio → `0`, informe corto, sin bloques vacíos;
- un hallazgo de cada clase → `3`;
- una lectura parcial → `1`, **con** el resto del informe impreso;
- **el caso que da nombre a todo esto:** una lectura truncada o fallida **nunca** produce `0`.

## 10. Lo que este comando retira

Las seis órdenes que el coordinador encadenaba a mano cada vez, y con ellas seis de los ocho errores del §7.1 — los que venían de componer comprobaciones artesanales con `--limit`, globs sin comillas, y fallbacks que imprimían «limpio» sin haber comprobado.
