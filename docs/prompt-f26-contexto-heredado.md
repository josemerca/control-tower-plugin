# Prompt de arranque — F26: el contexto heredado entre slices

> Handoff de José, 2026-08-04, tras cerrar F23, F24 y dejar F25 en PR.
> Pégalo tal cual en una sesión fresca. Autocontenido a propósito: aguanta un `/clear`.

```
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin). Viene de una sesión larga que
cerró tres features seguidas y dejó una cuarta en revisión.

ESTADO EXACTO AL EMPEZAR — compruébalo, no te lo creas:

  main                     0.23.1, limpio y pusheado
  PR #6 (f25-ct-status)    ABIERTO, sin mergear, lleva 0.24.0
  worktree                 /Users/jpereag/Documents/control-tower-plugin-f25 sigue vivo

  git -C . log --oneline -3
  gh pr list
  grep '"version"' .claude-plugin/plugin.json

Decisión pendiente de José: mergear el PR #6 y limpiar rama+worktree, como se
hizo con F23 y F24. Pregúntaselo antes de empezar nada.

QUÉ SE CERRÓ YA — NO LO REABRAS

  §1.1 + §1.2  F22 (0.22.x). El estado del slice pasó de `.agent/STATE.md`
               (trackeado) a `.agent/SLICE.md` (nunca trackeado).
  §2           F23 (0.23.0). El marcador ct-order acotado por milestone, con
               dos puertas que paran antes de mutar. En menoplus ya se retiró
               el rodeo (tabla §9 puede empezar en 1, --reconcile permitido).
  §3.3         Ya estaba desde F18. No es deuda.
  dist/↔hooks  F24 (0.23.1). Un test reconstruye los fuentes de HEAD y compara
               con el dist commiteado. No estaba en ningún plan.
  §3.2 + §3.1  F25, EN EL PR #6. `/ct-status`.

--- LA TAREA: §4 del feedback, el contexto heredado ---

El feedback de campo está en:
  /Users/jpereag/Documents/menoplus-app/menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md

Su §4 dice, sobre lo que el loop NO puede:

  «Ningún agente lee el PR del anterior. Esto nos obligó a añadir contexto a
  mano al cuerpo de cinco issues. Sin eso, el #455 habría construido UNA SOLA
  de las dos variantes que el spec exigía llevar al gate, y el gate no habría
  podido decidir. Funcionó siempre; es el patrón más rentable del periodo.
  Merecería soporte de primera clase.»

TRES ANCLAJES, LOS TRES VERIFICADOS EN LA SESIÓN ANTERIOR

1. LA PRESERVACIÓN YA FUNCIONA, y está comprobada empíricamente, no deducida.
   `scripts/reconcile.js#buildReconcileBody` NO reescribe el body: hace splices
   quirúrgicos sobre secciones que localiza (enlace al spec, Acceptance
   criteria, Dependencias). Cualquier sección que no conoce sobrevive intacta.

   Reproducido: un body con `## Contexto heredado` + AC divergentes pasado por
   `buildReconcileBody` sale con los AC reescritos y la sección heredada
   intacta, con su contenido. Si vas a apoyarte en esto, vuelve a correrlo —
   es media docena de líneas.

2. LO QUE FALTA EMITIRLA. `scripts/groom.js` emite hoy cuatro secciones más los
   gates: `## Descripción` (~229), `## Acceptance criteria` (~233),
   `## Dependencias` (~238), `## Out of scope / Protected` (~250). Una
   `## Contexto heredado` sería nueva.

3. Y UNA LÍNEA EN EL KICKOFF. `scripts/kickoff.js`. Léelo entero antes de
   tocarlo: tiene criterios ya tomados sobre QUÉ se interpola y qué no, y por
   qué (busca los comentarios sobre "compite con el resto del body" y sobre
   que el kickoff se pierde con el contexto de su sesión).

LA PREGUNTA DE DISEÑO QUE NO ESTÁ RESUELTA

De dónde sale el contenido de esa sección. En campo se escribió A MANO en el
cuerpo de cinco issues. Las opciones no son obvias y tienen implicaciones
distintas:

  - una columna nueva en la tabla §9 del spec (cambia el contrato, y el
    contrato se siembra en cada repo con /ct-init);
  - una sección del spec fuera de la tabla, que el groom reparta por slice;
  - que lo escriba el humano en el issue y el plugin sólo garantice que
    sobrevive y llega al agente (que es lo que ya pasa hoy, sin soporte).

La tercera es la más barata y puede que suficiente. No la descartes por
pequeña: el §4 dice que el patrón «funcionó siempre».

--- DESPUÉS DE ESTO ---

  §7.3  barandillas. OJO: está PARCIALMENTE HECHO y hay que triarlo de nuevo
        antes de planificar. `scripts/gh-closure.js` ya detecta el EFECTO del
        accidente de las closing keywords —un issue cerrado por un commit que
        no pertenece a ningún PR mergeado, con el discriminante verificado
        contra datos reales— y lo emite como aviso, nunca como gate. Lo que NO
        existe es detectar la CAUSA antes de que ocurra (un mensaje de commit
        con `Closes #N` a punto de entrar). Eso es otra cosa y más difícil.
  package-lock.json  no corresponde al package.json commiteado (declara `yaml`
        como dependencia de runtime y le falta `engines`), así que cualquier
        `npm install` lo regenera. Desde F24 importa más: puede poner en rojo
        el test de coherencia sin que nadie toque un fuente. Rama propia.

--- CÓMO TRABAJARLO ---

Mismo proceso que las tres anteriores, que funcionó:
superpowers:brainstorming → superpowers:writing-plans →
superpowers:subagent-driven-development, en un worktree aislado. NUNCA sobre
main.

SEIS LECCIONES DE MÉTODO, TODAS PAGADAS EN LA SESIÓN ANTERIOR

1. UN ARREGLO VUELVE FALSA UNA FRASE QUE NO TOCA. Es el defecto que más veces
   apareció: cuatro rondas seguidas encontraron que un arreglo había DESPLAZADO
   un defecto en vez de eliminarlo. Una afirmación se movió de un bloque a un
   aviso; el aviso, al arreglarse, dejó falsos seis comentarios. La suite
   estuvo verde todo el tiempo: lo que cambiaba era la VERDAD de una frase, no
   el comportamiento.

   Y se escondió siempre en el mismo sitio: un comentario que explica POR QUÉ
   algo se apaga, escrito cuando lo que se apagaba era otra cosa.

   Corolario operativo: después de cada arreglo, BARRE LA ZONA ENTERA, no la
   línea señalada. Los tres primeros de esos hallazgos sólo se cazaron así.

2. NO MIDAS A TRAVÉS DE UNA TUBERÍA. `cmd | tail; echo $?` da el código de
   `tail`. Un prototipo de la sesión anterior midió así y escribió en un plan
   que `lsof` sale con 0 cuando falta un PID; sale con 1. Es exactamente el
   bug que F24 vino a arreglar, cometido dos features después.

3. UN PLAN QUE MANDA CITAR UNA TAREA FUTURA ES UN DEFECTO. Seis apariciones en
   tres features: comentarios que nombran una función o un comando que aún no
   existe. Si escribes un comentario en un plan, que describa la PROPIEDAD, no
   que cite al vecino. El fichero se lee solo dentro de seis meses; el plan no
   estará.

4. UNA CIFRA MEDIDA ENVEJECE. Seis cifras de comentarios no reproducían al
   remedirlas. Si el número no aporta, pon el orden de magnitud.

5. VERIFICA CONTRA EL BINARIO REAL, NO CONTRA UN FIXTURE QUE TÚ FABRICAS. El
   defecto Critical de F25 sobrevivió a toda la suite porque el test montaba un
   proceso llamado literalmente `claude`, que es la única forma que el
   instalador real nunca produce.

6. LOS SUBAGENTES CAZAN LOS DEFECTOS DEL PLAN. En F25, la mayoría de los
   hallazgos serios fueron errores del propio plan —una contradicción interna,
   cifras falsas, un diagnóstico de causa raíz equivocado—, no de la ejecución.
   Cuando un implementador se desvíe del brief con un argumento medido,
   escúchalo: acertó las tres veces que pasó.

--- ARRANQUE ---

Empieza confirmando el estado (los tres comandos de arriba), pregunta a José
qué hacer con el PR #6, lee el §4 del feedback y los tres anclajes, y dime si
la afirmación 1 sigue siendo cierta antes de proponer nada.
```
