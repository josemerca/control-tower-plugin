# Las barandillas del §7.3 — la puerta de las closing keywords y la regla de las puertas

> F27. Cierra los dos puntos abiertos del §7.3 del feedback de campo
> (`control-tower-loop-feedback-2026-08-01.md`). El tercero, el `--status`
> canónico, lo cerró F25 y aquí sólo se verifica y se tacha.

---

## 1. Qué se arregla

El §7.3 se titula «Barandillas que se me ocurren» y pide tres. El triaje de esta
ronda las confirmó una a una contra las fuentes, que es lo que el §9 del propio
feedback exige antes de tocar nada.

| # | Pide | Estado tras el triaje |
|---|---|---|
| 1 | Un `--status` canónico | **Ya hecho.** `/ct-status`, F25 |
| 2 | Que el plugin avise si un mensaje de commit lleva una closing keyword | **Abierto.** Se construye aquí |
| 3 | Que la doc diga, donde el coordinador va a leerla, que las comprobaciones previas al merge deben ser puertas | **Abierto en parte.** Se cierra aquí |

### 1.1 El punto 1 está cerrado, con anclaje

`commands/ct-status.md` (65 líneas), `scripts/ct-status.mjs` (556) y
`__tests__/ct-status.test.js` (501), introducidos en `91bc482`. No se toca nada
de eso en esta ronda salvo una línea de documentación (§4.3).

### 1.2 Dos precisiones sobre el punto 2

**Lo que ya existe y no se reescribe.** `scripts/gh-closure.js` detecta el
**efecto** del accidente: `formatSuspectClosureWarnings` avisa cuando un issue
cerrado como *completed* lo cerró un commit que no pertenece a ningún PR
mergeado (`gh-closure.js:190`). Es un aviso y no una puerta, con el motivo
medido en su cabecera: de 97 cierres reales, 86 los hizo una persona a mano, y
cerrar a mano es además un paso **prescrito** por el contrato cuando la base no
es la rama por defecto. Un gate sobre «cerrado por PR mergeado» habría
ladrillado un epic entero por hacer lo correcto. Ese criterio sigue siendo el
bueno y esta ronda no lo cambia.

**Lo que el handoff de F27 da por abierto y ya estaba cerrado.** La advertencia
en prosa sobre las closing keywords **ya existe, y ya está en el sitio bueno**:
`scripts/ct-init.sh:623-629`, dentro del contrato §9 que se siembra en el
`AGENTS.md` de cada repo gobernado. Dice que el accidente no requiere que nadie
se equivoque a propósito, que GitHub aplica las keywords de cualquier mensaje de
commit que llegue a la rama por defecto, y que las comillas no protegen.

Es decir: de las dos mitades del punto 2 —avisar en prosa y comprobar de
verdad—, la prosa está hecha. **Lo que falta es la comprobación.** Y esa frase
del contrato queda incompleta en cuanto la comprobación exista (§5).

### 1.3 Una corrección al punto 3

El handoff afirma que la regla «verificar el EFECTO, nunca el exit code», con su
corolario «una comprobación que sólo imprime no es una comprobación», **no está
escrita en ninguna doc del plugin**.

Es falso. Está literal en `commands/ct-next.md:37`, y en cinco sitios más de
`docs/superpowers/specs/` y `plans/`.

**Pero el punto 3 sobrevive**, y el matiz es exactamente lo que decide el
trabajo:

1. Donde está escrita, está como **justificación de una puerta del plugin**
   (`dispatch-check --release`), no como regla dirigida al coordinador sobre
   **sus propias** comprobaciones a mano.
2. **No está en el contrato §9.** Verificado grepeando el heredoc entero
   (`ct-init.sh:333-838`) por `decoraci|sólo imprime|exit code|puerta`: vacío. Y
   el contrato es lo que llega al `AGENTS.md` del repo gobernado, o sea «el
   sitio donde el coordinador va a leerla».
3. El fallo real que la motiva —el `#482` del §1.1— fue **mergeando** pese a que
   la comprobación imprimió `1`. Eso es el flujo de merge, no el de despacho.

---

## 2. Lo medido, no deducido

Tres mediciones sostienen el diseño. Ninguna es una suposición y las tres se
pueden rehacer.

### 2.1 El commit del accidente lo escribió Claude

El handoff deja abierta la pregunta de dónde engancharse, y da por hecho que un
hook de git en el repo gobernado es la opción obvia. La medición la cierra.

El commit `c4b0da66` de `menoplus-app/menoplus` —el que cerró el `#451` con un
`Closes #451` dentro de una frase de documentación que explicaba precisamente
que el kickoff *no* llevaba esa keyword— lleva este trailer:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Lo escribió Claude, por la herramienta `Bash`. **Un hook `PreToolUse` lo habría
visto.**

Y no es un caso aislado. En la ventana del periodo de campo (25-jul → 2-ago),
ese repo tiene **126** commits, de los cuales **112 llevan el trailer: el 89%**.
La barandilla cubre la clase de fallo casi entera sin sembrar un solo hook de
git en el repo gobernado, sin pelearse con un `commit-msg` preexistente y sin
que un `git init` posterior pueda pisarla.

### 2.2 Un `deny` sobrevive a `--dangerously-skip-permissions`

La documentación oficial de hooks **no dice** si un `PreToolUse` que devuelve
`permissionDecision: "deny"` sigue bloqueando en modo `bypassPermissions`. Como
los agentes despachados arrancan precisamente con ese flag, de esa respuesta
depende si la puerta cubre a los agentes o sólo al coordinador.

Se midió, verificando el **efecto** y no el exit code: un hook que deniega todo,
un `claude --dangerously-skip-permissions -p` pidiendo un `touch CENTINELA.txt`,
y después la pregunta que importa —¿existe el fichero?—.

```
stdout: "El comando fue bloqueado: el hook devolvió `DENEGADO_POR_EL_EXPERIMENTO`."
efecto: ls: CENTINELA.txt: No such file or directory
```

**El fichero no existe: un `deny` sobrevive a `--dangerously-skip-permissions`.**
Es exactamente esa pregunta, y no otra, la que este experimento contesta — un
hook que devuelve `deny` sigue bloqueando aunque el agente arranque con el flag
que los agentes despachados usan siempre.

Lo que esto NO mide, y no hay que leerlo como si lo hiciera: si la puerta
**cubre** a un agente despachado depende de una condición que este experimento
no varió — **que la sesión de ese agente tenga el plugin cargado**. Los
agentes despachados arrancan con su propio `CLAUDE_CONFIG_DIR` (ver
`resolveAccount` en `scripts/dispatch.js`), así que sólo llevan encima el
hook `PreToolUse` de esta puerta si el plugin está instalado también bajo esa
cuenta. La medición dice que el `bypassPermissions` no es el obstáculo; no dice
que todo agente despachado esté cubierto sin más.

### 2.3 Las nueve keywords, de la fuente

De la documentación de GitHub, verbatim: `close`, `closes`, `closed`, `fix`,
`fixes`, `fixed`, `resolve`, `resolves`, `resolved`. **Insensibles a
mayúsculas**, admiten dos puntos (`Closes: #10`, `CLOSES #10`), y aceptan
`#N` o `owner/repo#N`. En mensajes de commit cierran **al llegar a la rama por
defecto**.

No se implementa ninguna forma que no esté en esa lista.

---

## 3. La puerta (punto 2)

### 3.1 Dónde se engancha, y por qué no es un hook de git

El handoff enumera cuatro opciones. La medición del §2.1 las ordena, y añade una
quinta que no estaba en la lista y que gana:

| Opción | Coste | Qué fracción cubre |
|---|---|---|
| Hook de git `commit-msg` sembrado por `/ct-init` | Alto: el plugin no siembra hooks de git hoy; hay que decidir qué pasa con un `commit-msg` previo y con un `git init` posterior | Todo commit del repo, incluido el humano en su terminal |
| Comprobación dentro del loop | Bajo | **Cero de la causa**: para entonces el commit existe y el issue ya se cerró. Sería otro detector de efecto |
| Una línea en el kickoff | Muy bajo | Sólo agentes, y es un prompt, no un gate. El que se equivocó fue el coordinador |
| Documentación sola | Muy bajo | Cero mecánica. Ya existe (§1.2) y no bastó |
| **`PreToolUse` desde el propio plugin** | **Bajo**: el plugin ya tiene `hooks/hooks.json` con `SessionStart` y `Stop` | **89% de los commits medidos**, coordinador **y** agentes (§2.2) |

Se elige el `PreToolUse`. No cubre a un humano tecleando `git commit` en su
terminal, y eso se dice en el spec, en el contrato y en el mensaje: **una
barandilla que calla su propia cobertura se lee como «todo comprobado»**, que es
la mentira que este plugin persigue desde F18.

### 3.2 El orden de evaluación

El hook corre en **cada** comando `Bash` de **cada** sesión con el plugin
cargado. El orden no es cosmético: es lo que impide que un `ls` pague un
`git rev-parse`.

1. ¿Es un `git commit` con mensaje en línea? — **parseo puro, cero I/O**. Si no,
   exit 0 sin decisión. Aquí se va la práctica totalidad de los comandos.
2. ¿El mensaje trae una closing keyword? — **puro**. Si no, exit 0 sin decisión.
3. Sólo ahora, para el comando raro que es un commit **con** keyword: ¿este repo
   está gobernado por el loop? — la **única** lectura de disco.
4. Gobernado → `deny`. No gobernado → exit 0 sin decisión.

**Si el paso 3 no se puede resolver, la decisión es `ask`, nunca silencio.**
Tenemos delante un commit con una closing keyword y no sabemos si el repo está
gobernado: es exactamente la situación en la que hay que parar y preguntar. Es
la misma regla que `/ct-status` ya aplica («el `1` nunca se degrada a `0`»), y
por el orden de evaluación esa escalada sólo puede ocurrir en el caso raro y
peligroso, jamás sobre un `ls`.

### 3.3 «Repo gobernado», sin subprocesos

El predicado es: existe un `AGENTS.md` en la raíz del repo que contiene el
marcador `<!-- ct-init:slices-contract -->`. Ese marcador lo siembra `/ct-init`
y significa exactamente «aquí corre este loop».

La raíz se busca **subiendo desde el `cwd` del input del hook hasta encontrar un
`.git`**, con `fs` a secas: sin `git rev-parse`, sin depender de que `git` esté
en el `PATH`, sin subproceso.

**Y `.git` puede ser un fichero, no un directorio.** En un worktree de slice
—`.worktrees/<n>/.git`— es un fichero con un `gitdir:` dentro. Un predicado que
sólo mire directorios funcionaría para el coordinador y fallaría en silencio
para todos los agentes despachados, que es la mitad de la cobertura que el §2.2
acaba de ganar. Se contemplan los dos casos y hay un test que lo fija.

Verificado hoy: el repo del propio plugin **no** tiene `AGENTS.md` ni marcador,
así que la puerta no dispara sobre los commits de esta misma ronda —que van a
estar llenos de `Closes #N` hablando del tema—. El escape es una propiedad
comprobable, no una excepción escrita a mano.

### 3.4 El detector, acotado al mensaje de commit

El modo de fallo caro de esta ronda **no** es detectar poco: es bloquear el
camino feliz. El kickoff manda a cada agente poner `Closes #N` en el cuerpo del
PR, así que un detector que mire el comando entero rompería `gh pr create
--body "Closes #42"` — la barandilla se convertiría en ladrillo.

Por eso el registro se acota:

- **Tokenizado mínimo POSIX**: comillas simples, comillas dobles, escapes con
  `\`, y **corte por separadores** (`&&`, `||`, `;`, `|`, salto de línea). En
  `git commit -m "x" && gh pr create --body "Closes #1"` sólo se mira el primer
  segmento. El `gh pr create` queda a salvo **por construcción**, no por suerte.
- **Reconocer el commit**: primer token `git` (o una ruta acabada en `/git`),
  saltando opciones globales (`-C <ruta>`, `-c k=v`, `--git-dir=…`), y
  subcomando `commit`.
- **Extraer el mensaje**: `-m X`, `-mX`, `--message=X`, `--message X`, y varios
  `-m` a la vez (git los concatena como párrafos).
- **El patrón**: las nueve keywords del §2.3, insensible a mayúsculas,
  admitiendo los dos puntos, sobre `#N` y `owner/repo#N`.

La lógica vive en `scripts/closing-keywords.js`, **módulo puro sin I/O**, como
`anchor.js`, `argnum.js` o `gates.js`. Testeable entero sin disco ni red.

### 3.5 Lo que la puerta no ve, y quién lo cubre

El mensaje tiene que estar **en el comando**. No lo está en cuatro casos:

- `git commit` sin `-m`, que abre `$EDITOR`;
- `-F <fichero>`, con el texto en disco;
- un heredoc hacia `-F -`;
- `--amend --no-edit`, reutilizando un mensaje que ya la traía.

Y tampoco ve al humano que teclea `git commit` fuera de Claude (§3.1).

**Eso no es un agujero abierto: es reparto de trabajo.** `gh-closure.js` sigue
cazando el **efecto** de todo lo que la puerta no vea. La causa y el efecto se
cubren con piezas distintas y **ninguna de las dos afirma ser completa** — que
es justo lo que la cabecera de `gh-closure.js` ya hace bien hoy.

### 3.6 El mensaje del `deny`

Tiene que ser accionable, porque quien lo lee es un agente que va a reintentar.
Nombra la keyword y la referencia encontradas; dice que GitHub cierra el issue
al llegar el commit a la rama por defecto y que **las comillas no protegen**;
recuerda que el `Closes #N` va en el **cuerpo del PR**, no en el commit; y da
las dos salidas reales: reformular la frase, o `gh issue close <n> --reason
completed` si de verdad se quería cerrar el issue.

Comprobación contra el caso de campo: bajo esta puerta, `c4b0da66` **habría sido
denegado**, y la frase se habría reescrito sin la cadena literal. Es el
comportamiento que se busca, sobre el incidente que motivó todo.

---

## 4. La regla (punto 3)

### 4.1 El ancla en el contrato §9

El contrato termina hoy diciendo que el loop *«los **escribe y los enseña***
(kickoff, label `gate:`, sección `## Gates` del issue), **pero no impide
mergear** un PR con su gate sin cerrar. El que cierra el gate eres tú.»

Ahí se ancla, y no es arbitrario: la regla se **deduce** de la frase anterior.
Como el loop no puede gatear tu merge, **tus comprobaciones previas al merge
tienen que ser puertas** — si su resultado no puede detener el merge, es
decoración. Con el caso de campo detrás: una comprobación que imprimió `1` y se
mergeó igual, y hubo que arreglar `main` a posteriori.

### 4.2 El mecanismo de versión

`SLICES_CONTRACT_VERSION` sube de **12 a 13**, y hay que **añadir el hash del
bloque v13** a `SLICES_PRISTINE_HASHES` — nunca sustituir uno viejo.

**Precisión sobre el mecanismo, leída del código y no supuesta.** La lista
registra el hash de **todos** los bloques que este script haya emitido alguna
vez, **incluido el actual**: la v12 ya está ahí (`ct-init.sh:327`,
`f1e9f868… v12, 505 líneas — F23`). Así que los repos que hoy tengan la v12
intacta ya son reconocibles y se actualizan sin `--force` sin que haya que hacer
nada. Lo que falta es registrar la v13, para que los repos sembrados con ella
sigan siendo reconocibles en la ronda siguiente.

El hash no se escribe a ojo, y no hace falta: `__tests__/ct-init.test.js` tiene
tres autovigilancias que lo dictan — «el hash del bloque que se siembra HOY está
registrado» (línea 787), «todo bloque que ct-init emitió alguna vez está
registrado» (805) y «no se registran hashes de bloques que no existieron nunca»
(829). Al cambiar el texto del bloque, el primero se pone rojo y **dice el hash
que falta**. La secuencia correcta es: editar el bloque → correr el test → tomar
el hash del fallo → añadirlo. Escribirlo antes es imposible, y el tercer test lo
impide a propósito.

### 4.3 El segundo sitio: `/ct-status`

`commands/ct-status.md`, bloque `ENTREGADO, ESPERANDO MERGE`, que hoy dice «lo
único que hay que hacer con este bloque es mergear los PRs». Es el segundo
exacto antes del merge, y es donde el coordinador está mirando cuando toma la
decisión que el `#482` tomó mal.

---

## 5. El barrido que la ronda se genera a sí misma

Lección 1 del handoff: *un arreglo vuelve falsa una frase que no toca*. En F26
fueron once de doce rondas de fix. Aquí están las tres identificadas **antes**
de escribir código, y ninguna vive en los ficheros que se tocan por el motivo
principal:

1. **`scripts/ct-init.sh:628-629`** — «Cuidado con escribir esas keywords en
   cualquier commit, aunque sea entrecomillándolas.» Escrito cuando nada
   protegía. Con la puerta existiendo, esa frase pide una vigilancia que ya no
   toca **y calla que ahora hay algo que bloquea**. Tiene que decir que la
   puerta existe **y sus límites del §3.5** — si no, al mes siguiente alguien
   confía en una cobertura que no tiene.
2. **`.claude-plugin/plugin.json`** — la `description` enumera lo que hace el
   plugin (hidratación, estado, gates, dispatch, informe). Una puerta que
   deniega comandos no puede quedarse fuera de esa lista.
3. **`__tests__/hooks-json.test.js:15`** — aplana **sólo** `SessionStart` y
   `Stop` para comprobar que cada comando apunta a un `dist/` existente. Con un
   hook nuevo, ese test pasaría igual **aunque el `dist/` del guard no
   existiera**: es la lección 5, un test que no puede fallar. Se hace genérico
   sobre todos los eventos del `hooks.json`, no se le añade un tercer literal.

Y el corolario operativo: después de cada arreglo se barre **la zona entera**,
no la línea señalada, y se comprueban los comentarios **que no se tocaron**.

---

## 6. Lo que hace falta construir

| Fichero | Qué |
|---|---|
| `scripts/closing-keywords.js` | **Nuevo.** Módulo **puro**: tokenizado, reconocimiento del `git commit`, extracción de mensajes, detección de keywords |
| `scripts/governed-repo.js` | **Nuevo.** El predicado del §3.3. Vive aparte porque hace I/O, y `closing-keywords.js` tiene que poder testearse sin tocar disco |
| `hooks/commit-keyword-guard.js` | **Nuevo.** El hook: stdin JSON → decisión JSON. Sólo cableado y mensajes |
| `scripts/build.mjs` | Añadir el hook a `buildOptions.entryPoints` |
| `hooks/hooks.json` | Entrada `PreToolUse` con `matcher: "Bash"` |
| `dist/commit-keyword-guard.js` | Generado por `npm run build`, commiteado como los otros |
| `scripts/ct-init.sh` | La regla del §4.1; versión 12→13; hash de la v12; el barrido del §5.1 |
| `commands/ct-status.md` | La regla en el bloque `ENTREGADO, ESPERANDO MERGE` |
| `.claude-plugin/plugin.json` | `description` + versión 0.25.0 → **0.26.0** |
| `__tests__/hooks-json.test.js` | Genérico sobre todos los eventos |
| `.gitignore` | `.claude/worktrees/` — un `git add -A` en el checkout principal se tragaría el worktree de sesión entero |

---

## 7. Tests que fijan las propiedades

**Los negativos son los que más importan**, porque el fallo caro es bloquear el
camino feliz:

- `gh pr create --body "Closes #42"` → **sin decisión**
- `git commit -m "x" && gh pr create --body "Closes #1"` → **sin decisión**
- un mensaje con `#42` sin keyword → **sin decisión**
- `closes the door` sin referencia → **sin decisión**

**Positivos**: las nueve keywords, variantes de mayúsculas, forma con dos
puntos, `#N` y `owner/repo#N`, y las cuatro formas de `-m` más el caso de varios
`-m`.

**La propiedad del orden de evaluación se testea, no se promete** — y hay que
tener cuidado con CÓMO, porque el test obvio no puede fallar. Como el predicado
del §3.3 no lanza ningún subproceso, afirmar «el fake `git` no fue invocado»
sería verdad aunque el camino común hiciera I/O a mansalva: pasaría igual
borrando la propiedad entera. Es exactamente la lección 5.

Lo que sí la fija es un test de **efecto**: se invoca el hook con un `ls` y con
un `cwd` **cuyo directorio padre es ilegible** (`chmod 000`), y se afirma que
sale `0` sin decisión y sin un solo aviso. Si el camino común intentara subir
buscando el `.git`, ese ascenso fallaría y se notaría. Y el control en la otra
dirección, que es lo que lo vuelve honesto: con el **mismo** `cwd` ilegible pero
un comando que **sí** es un commit con keyword, la decisión tiene que ser `ask`
— probando que la lectura ocurre cuando toca y sólo cuando toca.

**Del predicado**: un repo gobernado cuyo `.git` es un **fichero** (worktree) se
reconoce igual que uno cuyo `.git` es un directorio. Es la mitad de la cobertura
del §2.2 y fallaría en silencio sin este test.

**End-to-end contra `dist/`**: gobernado + commit + keyword → `deny` con la
keyword y la referencia nombradas; no gobernado → sin decisión; raíz o
`AGENTS.md` ilegibles → `ask`, jamás silencio.

**Del contrato**: que la v13 lleve la regla, y que un repo con el bloque v12
**intacto** se actualice a la v13 limpiamente **sin `--force`** y sin acusar a
nadie. Las tres autovigilancias del §4.2 ya existen y no hay que escribirlas:
basta con no dejarlas rojas.

**Método, lección 5**: cada test de propiedad se valida rompiendo la
implementación a propósito, confirmando el rojo, deshaciendo y confirmando el
verde. Un test que no puede fallar no prueba nada.

---

## 8. Riesgos

- **Falso positivo sobre el camino feliz.** El más caro. Mitigado por el corte
  por separadores (§3.4) y por los tests negativos, que se escriben antes.
- **El hook rompe la sesión.** Si el JSON de stdin no se puede parsear, no hay
  comando que leer: exit 0 sin decisión. Bloquear cada `Bash` por un fallo de
  parseo sería catastrófico, y no se puede escalar lo que ni siquiera se ha
  podido identificar. Es un límite declarado, no un descuido.
- **Cobertura sobreestimada.** El 89% del §2.1 es de un repo y una ventana. Se
  cita con su fecha y su alcance, nunca como propiedad general — lección 7: una
  cifra medida envejece.
- **El contrato v13 no llega.** Un repo bootstrapeado que no corra
  `--update-slices-contract` se queda con la v12. `/ct-init` lo avisa; es el
  mecanismo que F9 construyó y aquí no se cambia.

---

## 9. Lo que F27 NO hace

- **No toca `gh-closure.js`.** Su criterio de avisar-y-no-gatear está medido y
  sigue siendo el bueno (§1.2).
- **No mueve el motivo del bloqueo a stderr** (§3.3 del feedback): se revisó y
  se decidió dejarlo.
- **No ataca los otros siete comandos silenciosos del §7.1** (MULTIOS,
  word-splitting de zsh, `declare -A`, globs sin comillas…). La closing keyword
  es uno de ocho; los demás son del shell del coordinador y no del dominio del
  plugin. Se deja dicho, no se construye.
- **No aborda el eje B del §4** (que el spec dirija texto a un slice concreto),
  apartado con su motivo en el §8 del spec de F26.

---

## 10. Versión

Plugin **0.25.0 → 0.26.0**. Contrato de la §9 **v12 → v13**.

Línea base de la rama, medida sin tubería: **57 ficheros, 1595 tests, exit 0**.
