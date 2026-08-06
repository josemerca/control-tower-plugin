# Prompt de arranque — F28, el marcador y el alcance de la puerta

> Escrito al cerrar F27, que mergeó en `main` como **0.26.0** (PR #9) y dejó el
> feedback de campo del 1-ago **cerrado entero**: §8 completo y §7.3 completo.
> Copiar el bloque de abajo tal cual en la sesión nueva.
>
> **Revisado el 2026-08-06 con el triaje ya hecho contra las fuentes.** De las
> tres tareas que listaba, la 1 resultó no existir (medido) y la 3 quedó medida
> en el propio triaje; sólo sigue abierta la 2. La §4 que avisaba de un fallo
> intermitente se ha borrado: no existía tal fallo — ver la lección 9.

---

```text
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin).

ESTADO EXACTO AL EMPEZAR — compruébalo, no te lo creas:

  main       0.26.0 (48e45b8), limpio, sin worktrees vivos ni PRs abiertos
  contrato   §9 en v14, con 21 hashes registrados

  git -C . log --oneline -3
  git worktree list
  gh pr list
  grep '"version"' .claude-plugin/plugin.json
  grep '^SLICES_CONTRACT_VERSION=' scripts/ct-init.sh

  npx vitest run > /tmp/base.log 2>&1; echo $?
  # espera exit 0 y 59 ficheros / 1685 tests. LEE EL FICHERO, no midas por tubería.

  Y ANTES DE ROMPER NADA A PROPÓSITO, COMPRUEBA QUE ESTÁS SOLO EN EL ÁRBOL:

    ls -lt ~/.claude*/projects/-Users-jpereag-Documents-control-tower-plugin/*.jsonl | head -3

  Si hay un transcript escrito en los últimos minutos que no es el tuyo, hay
  otra sesión en este mismo checkout. Ver la lección 9.

EL FEEDBACK DE CAMPO ESTÁ CERRADO ENTERO — NO LO REABRAS

  /Users/jpereag/Documents/menoplus-app/menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md

  §8 (los seis arreglos)  cerrado en F22, F23, F25 y F26
  §7.3 (las tres barandillas)  cerrado en F25 y F27

No queda NADA de ese documento. Si algo te parece abierto, es que ya está hecho:
compruébalo antes de proponerlo.

--- LA TAREA: UNA COSA, Y UN CUARTO DE SESIÓN ---

Salen de la review de rama completa de F27. Ninguna es una feature nueva:
cierran huecos de lo que F27 construyó. De las tres que este documento listaba
al escribirse, la 1 resultó no existir y la 3 ya está medida — queda la 2.

=== 1. LA TERCERA COPIA DEL MARCADOR — NO EXISTE EL HUECO. NO LO TRABAJES ===

Este documento afirmaba que `conventions.js` estaba SUELTO, que nada ataba su
copia del literal al escritor. **Es falso, y está medido.**

El literal sí está escrito a mano en tres sitios, eso es cierto:

  scripts/ct-init.sh:156-157       el ESCRITOR (SLICES_MARKER_OPEN/CLOSE)
  scripts/governed-repo.js:15      lector — decide el ALCANCE de la puerta
  scripts/conventions.js:55-56     lector — poda el bloque antes de escanear

Pero los dos literales de `conventions.js` YA están atados al escritor real.
Medido rompiéndolos, que es la única forma que vale (lección 7):

  CONTRACT_MARKER_OPEN  roto  ->  6 tests rojos en 3 ficheros
  CONTRACT_MARKER_CLOSE roto  ->  los mismos 6

    __tests__/conventions.test.js         3 — «la SEGUNDA corrida no se detecta
                                              a sí misma» siembra con el
                                              `ct-init.sh` REAL y escanea con el
                                              lector real, sin el literal en el
                                              test. Es exactamente el patrón que
                                              este documento pedía escribir.
    __tests__/ct-init.test.js             2
    __tests__/ct-next-conventions.test.js 1

POR QUÉ ESTE DOCUMENTO SE EQUIVOCÓ, que es lo que hay que aprender: quien lo
escribió buscó el literal con `grep` dentro de `__tests__/` y no lo encontró
—correcto, no aparece— y concluyó que no había cobertura. Pero la ausencia del
literal en el test es justo la SEÑAL DE QUE EL TEST ES BUENO, no de que falte.
La cobertura no se audita leyendo: se audita rompiendo. Es la lección 7 aplicada
al propio triaje y no sólo a los tests que uno escribe.

Lo que SIGUE siendo cierto del análisis original: el par ct-init ↔ governed-repo
lo cerró F27 en `__tests__/f27-closing-keywords.test.js:443`, y unificar las tres
copias en UNA constante es imposible mientras `ct-init.sh` sea bash y no pueda
importar un módulo JS. Con los dos lectores atados al escritor por tests que
fallan si divergen, el duplicado ya no puede morir en silencio. No hay nada que
hacer aquí.

=== 2. `git -C <ruta>` DECIDE SOBRE EL REPO EQUIVOCADO ===

El hook sondea `input.cwd` — el cwd de la SESIÓN:

  hooks/commit-keyword-guard.js:90    const sonda = probe(input.cwd)

Pero `git -C <ruta> commit -m ...` y `cd <ruta> && git commit -m ...` apuntan a
OTRO repo. La puerta juzga el de la sesión, y eso corta en los dos sentidos:

  - sesión en repo gobernado, `<ruta>` fuera  ->  bloquea de más
  - sesión fuera, `<ruta>` en repo gobernado  ->  no protege nada

F27 lo DECLARÓ en el contrato §9 y en la cabecera del hook, sin arreglarlo,
porque era un cambio de comportamiento fuera de su spec. Ahora toca decidir si
se arregla.

Lo que YA está resuelto y puedes reusar: `scripts/closing-keywords.js` ya parsea
`-C`, `--git-dir` y `--work-tree` para saltarlos (necesita reconocerlos para
encontrar el subcomando `commit`), y hoy TIRA ese valor. Recuperarlo y
resolverlo contra `input.cwd` es la mitad del trabajo.

Lo que NO se puede resolver, y hay que seguir declarando: `cd <ruta> && git
commit`. Interpretar un `cd` sería empezar a ejecutar el shell mentalmente, y
eso no lo hace este módulo.

SI LO ARREGLAS, el texto del contrato §9 y la cabecera del hook dejan de ser
ciertos y hay que actualizarlos — lo que arrastra SLICES_CONTRACT_VERSION de 14
a 15 y un hash nuevo. Lee el mecanismo del hash antes de tocar nada (está en el
comentario de SLICES_PRISTINE_HASHES, scripts/ct-init.sh). Regla dura: se AÑADE
un hash, nunca se sustituye — salvo que la versión no haya salido nunca de tu
rama, que no es este caso porque la v14 ya está en main.

=== 3. EL `ask` BAJO `--dangerously-skip-permissions` — MEDIDO. BLOQUEA ===

La pregunta era si un `ask` —la escalada de «no sé si este repo está gobernado»,
la que sostiene el «nunca se degrada a silencio»— sobrevive al flag con el que
arrancan todos los agentes despachados, o si se trata como un allow.

**Sobrevive.** Replicado el experimento del §2.2 del spec de F27 cambiando
`deny` por `ask`, medido por EFECTO y con control:

  hook `ask` + `claude --dangerously-skip-permissions -p "... touch CENTINELA"`
    -> CENTINELA.txt NO existe. La sesión reportó que la llamada devolvió
       `PREGUNTA_DEL_EXPERIMENTO` en vez de ejecutarse.
  permission_mode que RECIBIÓ el hook: `bypassPermissions`
    -> no es una suposición del flag: el hook lo escribió a fichero.
  control sin ningún hook, mismo montaje y mismo prompt
    -> CENTINELA.txt SÍ existe. Sin el control, «el fichero no está» también
       sería compatible con «el modelo no lo intentó».

El «nunca se degrada a silencio» se sostiene bajo `bypassPermissions`.

LO QUE ESTO NO DICE, y no hay que leerlo como si lo dijera. Igual que el §2.2:
que la puerta CUBRA a un agente despachado sigue dependiendo de que el plugin
esté instalado bajo la cuenta con la que ese agente arranca (`resolveAccount`,
scripts/dispatch.js). Y se midió en `-p`, donde no hay humano a quien preguntar,
así que el `ask` se resuelve BLOQUEANDO; en una sesión interactiva —como las de
cmux— lo esperable es que pregunte y se quede parada. Las dos cosas son «no
silencio», que es la propiedad que importa, pero no son la misma cosa.

REGALO DEL EXPERIMENTO, y este sí es un hueco de verdad: durante el montaje un
hook quedó con un `SyntaxError` y murió con **exit 1 y stderr**. El `touch` se
ejecutó igual. Es decir: un PreToolUse que REVIENTA no bloquea — abre la puerta,
no la cierra. Es la lección 5 con otra ropa (allí el fallo era exit 0 y stdout
vacío; aquí, exit 1 y un stack trace), y `hooks/commit-keyword-guard.js` hereda
la propiedad: si algún día lanza, la puerta se apaga sola. Nadie lo ha medido
sobre el hook real ni hay test que lo ate. Candidato claro para la ronda que
venga.

--- CÓMO TRABAJARLO ---

superpowers:brainstorming -> superpowers:writing-plans ->
superpowers:subagent-driven-development, en un worktree aislado. NUNCA sobre
main. Es el proceso que ha funcionado seis rondas seguidas.

Ojo: lo que queda es UNA cosa pequeña, no una feature. Si el brainstorming
empieza a crecer, para y pregunta.

--- DESPUÉS DE ESTO ---

  Eje B del §4  Que el spec pueda dirigir texto a UN slice concreto. Se apartó
                con su motivo escrito en el §8 del spec de F26
                (docs/superpowers/specs/2026-08-04-contexto-heredado-design.md).
                Cambio de contrato mayor. Es lo único grande que queda.

  Deuda cosmética: YA CERRADA al terminar F27, no la busques.
    - package.json pasó a 0.26.0, y hay un test en __tests__/manifest.test.js que
      lo ata a plugin.json para que el duplicado no pueda divergir en silencio
    - los dos comentarios de scripts/ct-init.sh que citaban "finding 6" y "la
      review final" describen ahora la propiedad
    - docs/backlog-congelado.md dice la verdad: está cerrado, y cada una de sus
      dos entradas lleva escrito dónde aterrizó

  Lo que NO es del plugin: siete de los ocho comandos silenciosos del §7.1
  (MULTIOS de zsh, word-splitting, backticks en commit -m, --limit corto,
  declare -A en bash 3.2, glob sin comillas). Son del shell del coordinador.
  F27 cubrió el octavo porque el plugin sí controlaba ese punto.

LO MÁS IMPORTANTE QUE PUEDES DECIRLE A JOSÉ: desde F22 el plugin ha ido de 0.20
a 0.26 —seis versiones— construido desde UN documento de feedback del 1-ago y
validado con tests, no operando. Lo que más valor tiene ahora no es código: es
despachar slices reales con 0.26.0. Dos preguntas que sólo el campo contesta:

  1. ¿La puerta dispara de verdad en la sesión de un agente despachado? Depende
     de bajo qué cuenta esté instalado el plugin (los agentes arrancan con su
     propio CLAUDE_CONFIG_DIR — ver resolveAccount en scripts/dispatch.js).
  2. ¿Se notan los 61,5 ms que el hook añade a cada comando Bash? (medido, con
     timeout de 5 s, así que no es un riesgo de corte: es ergonomía)

NUEVE LECCIONES DE MÉTODO. LAS OCHO PRIMERAS, PAGADAS EN F27; LA NOVENA, AL
ABRIR F28 — Y ES LA QUE MÁS CARA SALIÓ

1. EL DEFECTO CARACTERÍSTICO DE ESTE REPO NO ES ESCRIBIR COSAS FALSAS: ES
   DUPLICAR LA MISMA VERDAD EN SITIOS QUE LUEGO DIVERGEN. En F27 aparecieron
   TRES listas escritas a mano de los mismos bundles, DOS enumeraciones gemelas
   de los mismos hooks, y TRES copias del literal del marcador. Cada arreglo
   cerró una y dejó las otras.

   Corolario: un barrido guiado por `grep` NO las encuentra, porque la copia
   gemela rara vez comparte las palabras que buscas. Busca por CONCEPTO, no por
   cadena, y cuando arregles una enumeración pregúntate dónde vive su gemela.

2. UN TEST QUE ESCRIBE X Y LUEGO AFIRMA QUE SE DETECTA X NO PRUEBA NADA. Ata al
   ESCRITOR con el LECTOR en la misma aserción, y que el literal no aparezca en
   el test. Es lo que dejó la puerta de F27 a una edición de cadena de morir en
   silencio con la suite verde.

3. VERIFICA SOBRE EL COMMIT, NUNCA SOBRE EL ÁRBOL DE TRABAJO. En F27 un
   implementador reportó "38/38 verdes" sobre un commit que estaba ROJO: había
   medido antes de commitear. Comprueba `git status --porcelain` vacío antes de
   dar por buena cualquier medición.

4. CUANDO UN IMPLEMENTADOR DISCREPA CON UNA MEDICIÓN, ESCÚCHALO. Acertó las
   CUATRO veces en F27. La más cara: paró en seco porque el test de orden de
   evaluación que el plan le mandaba escribir NO PODÍA FALLAR, y tenía razón —
   hubo que rediseñar la pieza (extraer una función pura que recibe el probe)
   para que la propiedad fuera medible.

5. `realpathSync` SOBRE `process.argv[1]`. Este repo ya se comió ese bug en
   `scripts/build.mjs` y escribió 25 líneas explicándolo — y volvió a cometerlo
   40 líneas más allá, en el hook de F27, donde el efecto era apagar la puerta
   ENTERA con exit 0 y stdout vacío. Si escribes un guardián
   `argv[1] === import.meta.url`, resuelve los symlinks.

6. NO MIDAS A TRAVÉS DE UNA TUBERÍA. `cmd | tail; echo $?` da el código de
   `tail`, y en zsh `${PIPESTATUS[0]}` tampoco es lo que crees. Redirige a
   fichero y lee el fichero. Es el bug que F24 vino a arreglar y sigue cayendo.

7. EL PASO DE ROMPER LA IMPLEMENTACIÓN A PROPÓSITO ES LO QUE CAZA LOS TESTS
   INÚTILES. En F27 destapó dos: el de orden de evaluación y el del marcador. Un
   test que sigue verde con la implementación rota hay que rehacerlo, no
   aceptarlo.

   Corolario que costó una sección entera de este documento (ver §1): esto
   también vale AL REVÉS. Para afirmar que algo NO tiene cobertura, rómpelo y
   mira. Un `grep` que no encuentra el literal en los tests no prueba que no
   haya test — en los tests BUENOS el literal justamente no aparece.

8. LA REVIEW DE RAMA COMPLETA VE LO QUE OCHO REVIEWS DE TAREA NO VEN. En F27
   encontró tres cosas que ninguna review de tarea podía ver: el fixture
   autorreferencial, que el caso que justifica la feature entera no tenía test, y
   que una afirmación del propio spec era falsa. No la saltes, y dispárala con el
   modelo más capaz.

9. UN WORKING TREE, UNA SESIÓN. COMPRUÉBALO ANTES DE ROMPER NADA.

   Lo que pasó, y merece contarse entero porque el fallo no fue de nadie en
   particular: la sesión que cerró F27 seguía viva en este mismo checkout,
   cerrando la deuda cosmética sobre `main`, cuando la sesión de F28 arrancó y
   —aplicando la lección 7— rompió a propósito el literal de `conventions.js`
   para medir su cobertura.

   La otra sesión corrió la suite justo en esa ventana. Vio 6 tests rojos que no
   tenían nada que ver con sus cambios, hizo un triaje impecable (aisló los 3
   ficheros, volvieron verdes; repitió la suite completa, verde; comprobó que sus
   ficheros no tocaban la poda) y concluyó lo único que los datos permitían: un
   fallo intermitente preexistente. Lo dejó escrito en este documento como §4,
   avisando a la sesión siguiente de que no lo tratara como regresión suya.

   Ese aviso era un fantasma, y estuvo en `main` en el commit 9378784. Un
   documento cuya doctrina es que una comprobación que miente es peor que no
   tenerla acabó enseñando a ignorar un rojo real. Ése es el daño, no los veinte
   minutos.

   NADIE RAZONÓ MAL. La sesión de F28 no comprobó si estaba sola; la de F27 no
   podía saber que sus datos estaban envenenados. Dos sesiones sobre el mismo
   checkout convierten cualquier medición en no reproducible, y lo hacen en
   silencio — que es la categoría de fallo que este plugin entero existe para
   perseguir. El aislamiento por worktree no es higiene de proceso: es la
   condición para que una medición signifique algo.

   ANTES de romper nada a propósito, y antes de dar por buena cualquier corrida:
   mira si hay otro transcript vivo en este proyecto (el comando está arriba, en
   ESTADO EXACTO AL EMPEZAR). Y si vas a romper, hazlo en TU worktree — no en el
   checkout principal, aunque sea sólo un minuto y aunque lo vayas a revertir.

   Un descuido cercano que conviene tener presente: la revertida se hizo con
   `git checkout -- scripts/conventions.js`, y esa ruta no estaba entre las que
   la otra sesión tenía a medias. Si lo hubiera estado, le habría borrado el
   trabajo sin dejar rastro ni en el reflog.
```
