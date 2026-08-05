# Prompt de arranque — F27, las barandillas del §7.3

> Escrito al cerrar la sesión que despachó F26 y dejó `main` en **0.25.0**, con la
> lista de arreglos del §8 del feedback **cerrada entera**. Copiar el bloque de
> abajo tal cual en la sesión nueva.

---

```text
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin).

ESTADO EXACTO AL EMPEZAR — compruébalo, no te lo creas:

  main       0.25.0, limpio, sin ramas ni worktrees vivos
  gh pr list debería salir vacío

  git -C . log --oneline -3
  git worktree list
  gh pr list
  grep '"version"' .claude-plugin/plugin.json

LA LISTA DE ARREGLOS DEL FEEDBACK ESTÁ CERRADA ENTERA — NO LA REABRAS

El feedback de campo vive en:
  /Users/jpereag/Documents/menoplus-app/menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md

Su §8 pide seis arreglos "por orden de coste de no hacerlo". Los seis están:

  §1.1 + §1.2  F22 (0.22.x). El estado del slice pasó de `.agent/STATE.md`
               (trackeado) a `.agent/SLICE.md` (nunca trackeado).
  §2           F23 (0.23.0). El marcador ct-order acotado por milestone.
  §3.3         Ya estaba desde F18. No es deuda.
  §3.1 + §3.2  F25 (0.24.0). `/ct-status`.
  §4           F26 (0.25.0). El contexto heredado, con dos secciones de
               dueños separados. Spec y plan en docs/superpowers/.

Y dos cosas fuera de esa lista, también hechas:
  dist/↔hooks       F24 (0.23.1). Un test reconstruye los fuentes de HEAD y
                    compara con el dist commiteado.
  package-lock      PR #8, mergeado. Ya corresponde al package.json, y el
                    test de reloj de CT_CLAIM_PRECLAIM_DELAY_MS dejó de
                    caerse solo (su ruido era el arranque de node, no la
                    carga: con el nominal en 2000ms la peor muestra queda al
                    97% en vez de rozando el umbral).

--- LA TAREA: §7.3, y NO es una barandilla, son TRES ---

El §7.3 se titula «Barandillas que se me ocurren» y pide literalmente:

  1. «Un `--status` canónico (§3.2) mata la clase entera de errores
     artesanales.»
  2. «Que el plugin AVISE SI UN MENSAJE DE COMMIT LLEVA UNA CLOSING KEYWORD
     en un repo donde el loop gobierna los issues.»
  3. «Que la doc del loop diga, en el sitio donde el coordinador va a leerla,
     que LAS COMPROBACIONES PREVIAS AL MERGE DEBEN SER PUERTAS.»

LA PRIMERA YA ESTÁ HECHA: es `/ct-status`, F25. Compruébalo y táchala.

Quedan la 2 y la 3, y son de naturalezas MUY distintas — una es difícil y la
otra es barata. No las trates como un solo bloque.

TU PRIMERA TAREA NO ES ARREGLAR, ES TRIAJE. El propio feedback lo pide en su
§9: confirmar cada defecto contra las fuentes antes de tocar nada, porque
está escrito desde el lado del CONSUMIDOR y puede estar mal atribuido.

--- ANCLAJE VERIFICADO: LO QUE YA EXISTE ---

`scripts/gh-closure.js` (225 líneas) YA detecta el EFECTO del accidente, y
está bien hecho. No lo reescribas sin leer su cabecera entera primero.

Lo que hace: `formatSuspectClosureWarnings` emite un aviso cuando un issue
cerrado como *completed* lo cerró un COMMIT que no pertenece a ningún PR
mergeado (`c.kind === 'commit' && c.mergedPrs.length === 0`).

Lo que NO hace, y con razón medida: no es un GATE. De 97 issues cerrados en
el repo real, 86 los cerró una persona a mano y sólo 11 un PR. Cerrar a mano
no es la anomalía, es la práctica mayoritaria Y un paso prescrito por el
contrato cuando la base no es la rama por defecto. Un gate sobre "cerrado por
PR mergeado" habría ladrillado el epic entero por hacer lo correcto.

El incidente real que lo motivó, verificado en el timeline del issue: el
commit c4b0da66, un commit de DOCUMENTACIÓN cuyo cuerpo contenía `Closes
#451` dentro de una frase que explicaba precisamente que el kickoff NO
llevaba esa keyword. Cerró el issue. Las comillas no protegen.

Consumidor: `scripts/ct-next.mjs`. Tests: `__tests__/f18-lo-que-desaparece.test.js`.

--- LO QUE NO EXISTE, Y ES LA TAREA ---

Detectar la CAUSA antes de que ocurra: un mensaje de commit con `Closes #N`
a punto de entrar. Eso es otra cosa y más difícil que detectar el efecto.

LA PREGUNTA DE DISEÑO QUE NO ESTÁ RESUELTA, y que decide la ronda entera:
DÓNDE se engancha esa comprobación. Las opciones no son obvias:

  - un hook de git (`commit-msg`) en el repo gobernado — pero el plugin no
    instala hooks de git hoy, y `/ct-init` tendría que sembrarlo, con todo lo
    que eso implica (¿lo pisa un `git init` posterior?, ¿qué pasa con quien
    ya tiene su propio commit-msg?);
  - una comprobación dentro del propio loop, en el momento en que el
    dispatcher o el groom miran commits — pero para entonces el commit ya
    existe y el issue ya se cerró: sería otro detector de efecto, no de
    causa;
  - una línea en el kickoff que se lo diga al agente que escribe los
    commits — barata, pero el kickoff es un prompt, no un gate, y el propio
    feedback dice que el que se equivocó fue el COORDINADOR, no el agente
    despachado;
  - documentación en el sitio donde el coordinador va a leerla — que es
    literalmente el punto 3 del §7.3, y quizá la respuesta honesta para el 2
    también.

No des por hecho que la respuesta es un hook. Mide qué cuesta cada opción y
qué fracción del modo de fallo cubre de verdad. El §7.1 cuenta OCHO comandos
del coordinador que no dieron error y no hicieron lo que parecían; la closing
keyword es UNO. Puede que la barandilla rentable no sea la que el §7.3
imagina.

Y la 3 (la doc) conecta con la regla más útil del periodo, del §7.1:
«verificar el EFECTO, nunca el exit code», con su corolario «una comprobación
que sólo imprime no es una comprobación — si su resultado no puede detener la
acción siguiente, es decoración». Esa regla NO está escrita en ninguna doc
del plugin. Es barata de arreglar y puede que sea lo más rentable de la
ronda.

--- DESPUÉS DE ESTO ---

  Eje B del §4  Que el spec pueda dirigir texto a UN slice concreto. Se
                apartó explícitamente en el §8 del spec de F26
                (docs/superpowers/specs/2026-08-04-contexto-heredado-design.md),
                con el motivo escrito. Es el que evitaría el fallo que el §4
                usa como ejemplo. Cambio de contrato mayor.

  Límites de F26, documentados y no bloqueantes: los lectores de dependencias
  no son zone-aware (un bloque de deps pegado dentro del contexto heredado da
  un exit 3 estable hasta que un humano lo mueva — deliberado, unificar esos
  dominios fue el arreglo de una ronda anterior); `extractOrder` lee el primer
  `ct-order`; y en un cuerpo de finales de línea mezclados se preserva el
  texto, no sus terminadores.

--- CÓMO TRABAJARLO ---

Mismo proceso que las cinco anteriores, que funcionó:
superpowers:brainstorming → superpowers:writing-plans →
superpowers:subagent-driven-development, en un worktree aislado. NUNCA sobre
main.

OJO: si el triaje concluye que la 2 no es abordable con una relación
coste/beneficio razonable, DILO Y NO LA CONSTRUYAS. Cerrar la 3 sola es un
resultado legítimo. El §7.3 abre con «barandillas que se me ocurren», no con
un contrato.

SIETE LECCIONES DE MÉTODO, TODAS PAGADAS EN LAS SESIONES ANTERIORES

1. UN ARREGLO VUELVE FALSA UNA FRASE QUE NO TOCA. Es el defecto que más veces
   aparece, y no deja de aparecer: en F26 fueron ONCE de las DOCE rondas de
   fix. Ninguna era un fallo de comportamiento — la suite estuvo verde todo el
   tiempo; lo que cambiaba era la VERDAD de una frase.

   Y TRES VECES el arreglo DESPLAZÓ la frase falsa en vez de eliminarla:
   comentario de constantes → comentario del test → mensaje al usuario. Dos de
   esas veces ocurrió DENTRO de una oleada de fix que existía para cazar
   justamente eso.

   Corolario operativo: después de cada arreglo, BARRE LA ZONA ENTERA, no la
   línea señalada. Y comprueba los comentarios que NO tocaste y que tu cambio
   pueda haber falsificado.

2. LA REVIEW DE RAMA COMPLETA VE LO QUE SIETE REVIEWS DE TAREA NO VEN. En F26
   encontró que dos requisitos del propio spec eran incompatibles bajo el
   mismo predicado: `/ct-groom` decidía si escribir con `hasDrift`, que
   excluye a propósito la sección nueva para que no llegue al exit 3 — así que
   el escenario principal de la feature calculaba el cuerpo nuevo y LO TIRABA,
   salía 0, y el mensaje decía al usuario que sí lo había escrito. No lo vio
   ninguna review de tarea, ni el plan, ni la suite.

3. VERIFICA TÚ LAS REPRODUCCIONES, no te fíes del informe. En F26, la review
   final trajo tres Critical con reproducciones; las reproduje todas antes de
   mover un dedo, y después de la primera oleada de fix una SEGUIA ROTA en un
   caso que el informe daba por cerrado. Reproducir cuesta minutos.

4. CUANDO UN IMPLEMENTADOR DISCREPA CON UNA MEDICIÓN, ESCÚCHALO. Acertó las
   tres veces en F25 y las dos de F26. Una de ellas evitó que un arreglo de
   una línea —que yo mismo había propuesto— dejara la línea de éxito sin
   título, milestone ni labels.

5. UN TEST QUE NO PUEDE FALLAR NO PRUEBA NADA. En F26 hubo uno que pasaba un
   campo que la función no lee: habría pasado igual borrando la feature
   entera. Cuando escribas un test de una propiedad, ROMPE LA IMPLEMENTACIÓN A
   PROPÓSITO, confirma que se pone rojo, deshaz y confirma que vuelve a verde.

6. NO MIDAS A TRAVÉS DE UNA TUBERÍA. `cmd | tail; echo $?` da el código de
   `tail`. Es el bug que F24 vino a arreglar, y se ha vuelto a cometer después.

7. UNA CIFRA MEDIDA ENVEJECE, Y UN PLAN QUE MANDA CITAR UNA TAREA FUTURA ES UN
   DEFECTO. Si escribes un comentario, que describa la PROPIEDAD, no que cite
   al vecino ni afirme un mecanismo que aún no existe. El fichero se lee solo
   dentro de seis meses; el plan no estará. En F26, tres rondas de fix salieron
   de frases que el propio plan dictaba literalmente.
```
