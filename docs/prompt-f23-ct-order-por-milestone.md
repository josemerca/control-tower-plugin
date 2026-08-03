# Prompt de arranque — F23: el `ct-order` acotado por milestone

> Handoff de José, 2026-08-03, tras cerrar F22 (0.22.1). Pégalo tal cual en una sesión fresca.
> Autocontenido a propósito: aguanta un `/clear`.

```
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin), hoy en 0.22.1, `main` limpio y
pusheado. Viene de dos milestones de uso real en menoplus-app/menoplus (9 slices
despachados) que produjeron un documento de feedback de campo:

  /Users/jpereag/Documents/menoplus-app/menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md

Ese documento se triajó entero contra el código. Resultado: 6 bloques. Uno se
cerró (F22), uno ya estaba hecho, cuatro siguen abiertos. Este prompt ataca el
siguiente.

QUÉ SE CERRÓ YA — NO LO REABRAS
  §1.1 + §1.2 → F22, versiones 0.22.0/0.22.1. El estado de un slice despachado
  dejó de vivir en `.agent/STATE.md` (trackeado, de la coordinadora) y pasó a
  `.agent/SLICE.md` (nunca trackeado). Ver
  docs/superpowers/specs/2026-08-01-state-md-del-slice-design.md.
  §3.3 (motivo del bloqueo por stdout) ya estaba documentado desde F18 en
  commands/ct-next.md §«Dónde cae la frontera». No es deuda.

--- LA TAREA: §2 del feedback ---

EL DEFECTO, con las dos caras medidas en campo:

El contrato §9 promete que los `#` de la tabla son únicos DENTRO DE SU
MILESTONE, no del repo. Es cierto en `/ct-next` y FALSO en `/ct-groom`.

  scripts/ct-groom.mjs:600  lista `repos/<o>/<r>/issues` con `state=all
                            --paginate`, SIN filtro de milestone
  scripts/gh-issues.js:35   `findByMarker` es un `includes` de substring, tres
                            líneas, sin noción de epic
  scripts/ct-groom.mjs:617-623  `knownOrders` sale sólo del plan de HOY y
                            declara huérfano todo lo demás

Cara 1 — tabla §9 nueva empezando en 1,2,3: empareja con los issues #451/#452/
#453 de un epic ANTERIOR y CERRADO, reporta el milestone distinto como
«divergencia», sale 3 y no crea nada.
Cara 2 — empezando en 7,8,9: crea bien los tres y declara HUÉRFANOS los seis
del epic viejo.

PELIGRO: con `--reconcile`, `buildReconcileEditArgs` incluye el milestone, así
que además de reescribir el body arrastraría el issue cerrado AL MILESTONE
NUEVO.

EL PATRÓN YA ESTÁ ESCRITO — CÓPIALO, NO LO DISEÑES

`/ct-next` resolvió esto en D1 y funciona:
  scripts/gh-issue-map.js:811  `epicKeyOf(rawIssue)` → milestone.number o
                               NO_MILESTONE_KEY
  scripts/gh-issue-map.js:848  `buildOrderIndex` → Map(epicKey → Map(orden →
                               issue)), con detección de colisión que EXCLUYE
                               el epic afectado en vez de resolver a ciegas

Lee esos comentarios antes de escribir nada: explican por qué se descartó
codificar el epic dentro del propio marcador.

LA ÚNICA DECISIÓN DE DISEÑO QUE QUEDA, y es la parte delicada:

Qué pasa con los issues SIN milestone en un repo que ya groomeó. Si se filtran
de golpe, un groom deja de verlos y CREA DUPLICADOS. Hay que replicar el
criterio de `NO_MILESTONE_KEY`: bucket compartido con aviso, nunca invisible.
Ojo también al orden de ejecución: en ct-groom.mjs el fetch de issues (~600)
ocurre ANTES de resolver el milestone (~970), así que en ese punto sólo tienes
el TÍTULO del milestone (el argumento `--milestone`), no su número.

QUÉ RETIRA ESTE ARREGLO

Mientras el §2 no esté, en menoplus rige: la tabla §9 de un spec nuevo empieza
en 10 o más, y NO se corre `--reconcile`. Al cerrar F23, retira esa restricción
de los dos sitios donde está escrita: el spec del 2026-07-31 de menoplus y el
§8 del documento de feedback.

--- CÓMO TRABAJARLO ---

Mismo proceso que F22, que funcionó: superpowers:brainstorming →
superpowers:writing-plans → superpowers:subagent-driven-development, en un
worktree aislado. NO trabajes sobre `main`.

CUATRO LECCIONES DE MÉTODO DE F22 — la ejecución cazó 4 defectos que la suite
no habría cazado nunca, y todos eran «verde sin haber comprobado»:

1. AUDITA POR PROPIEDAD, NUNCA POR LISTA. Pasó dos veces: un brief traía una
   tabla de tres ficheros y el call-site defectuoso vivía fuera; y una lista de
   tres tests tenía un cuarto hermano. Si escribes «arregla estos N», escribe
   también «y barre por la propiedad, y enumera lo que encuentres».
2. `dist/` ESTÁ TRACKEADO y `hooks/hooks.json` ejecuta `dist/`, no `hooks/`.
   Toda tarea que toque `hooks/` debe commitear el bundle reconstruido en el
   MISMO commit. `npm test` corre `npm run build` antes, así que la suite queda
   verde con un dist commiteado obsoleto. Ya pasó una vez en F22.
3. VERIFICA EL EFECTO, NUNCA EL EXIT CODE. Y una comprobación que no puede
   detener la acción siguiente es decoración.
4. NUNCA NOMBRES UN FICHERO QUE EL CÓDIGO NO LEYÓ. En este repo los comentarios
   y los mensajes son documentación con carga estructural.

NO TOQUES nada del §5 del documento de feedback: todo aquello se estrenó o se
arregló durante el periodo de campo y funcionó con evidencia.

--- DESPUÉS DE ESTO, EN ORDEN ---

  §3.2  un `--status` canónico. Mata la clase entera de errores artesanales del
        §7.1 y cubre 6 de los 8 errores del coordinador.
  §3.1  señal de entrega/muerte de un slice, DENTRO de `--status` (no suelta).
        Un slice muerto deja claim, worktree y rama, así que `stalenessNote`
        (ct-next.mjs:655) devuelve null y el sistema calla para siempre.
  §4    contexto heredado entre slices. Más barato de lo que parece: la
        preservación de una sección `## Contexto heredado` frente a
        `--reconcile` YA funciona (verificado). Falta sólo que el groom sepa
        emitirla y una línea en el kickoff.
  NUEVO test de coherencia `dist/` ↔ `hooks/`. Salió de F22, no estaba en
        ningún plan: nada comprueba que el bundle commiteado corresponda a los
        fuentes commiteados. Es el más barato de todos.

--- ARRANQUE ---

Empieza confirmando el estado (`git -C . log --oneline -3`, versión en
.claude-plugin/plugin.json, `npm test`), lee el §2 del documento de feedback y
los tres anclajes de código de arriba, y dime si reproduces el defecto antes de
proponer nada.
```
