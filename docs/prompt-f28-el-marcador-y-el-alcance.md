# Prompt de arranque — F28, el marcador y el alcance de la puerta

> Escrito al cerrar F27, que mergeó en `main` como **0.26.0** (PR #9) y dejó el
> feedback de campo del 1-ago **cerrado entero**: §8 completo y §7.3 completo.
> Copiar el bloque de abajo tal cual en la sesión nueva.

---

```text
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin).

ESTADO EXACTO AL EMPEZAR — compruébalo, no te lo creas:

  main       0.26.0, limpio, sin worktrees vivos ni PRs abiertos
  contrato   §9 en v14, con 21 hashes registrados

  git -C . log --oneline -3
  git worktree list
  gh pr list
  grep '"version"' .claude-plugin/plugin.json
  grep '^SLICES_CONTRACT_VERSION=' scripts/ct-init.sh

  npx vitest run > /tmp/base.log 2>&1; echo $?
  # espera exit 0 y 59 ficheros / 1684 tests. LEE EL FICHERO, no midas por tubería.

EL FEEDBACK DE CAMPO ESTÁ CERRADO ENTERO — NO LO REABRAS

  /Users/jpereag/Documents/menoplus-app/menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md

  §8 (los seis arreglos)  cerrado en F22, F23, F25 y F26
  §7.3 (las tres barandillas)  cerrado en F25 y F27

No queda NADA de ese documento. Si algo te parece abierto, es que ya está hecho:
compruébalo antes de proponerlo.

--- LA TAREA: TRES COSAS DEL MISMO VIAJE, MEDIA SESIÓN ---

Las tres salen de la review de rama completa de F27. Ninguna es una feature
nueva: las tres cierran huecos de lo que F27 acaba de construir.

=== 1. LA TERCERA COPIA DEL MARCADOR (la que importa) ===

El literal del marcador del contrato está escrito A MANO en TRES sitios
independientes, verificado:

  scripts/ct-init.sh:156-157       el ESCRITOR (SLICES_MARKER_OPEN/CLOSE)
  scripts/governed-repo.js:15      lector — decide el ALCANCE de la puerta
  scripts/conventions.js:55-56     lector — poda el bloque antes de escanear

POR QUÉ IMPORTA, y está medido: la review de F27 demostró que cambiando SOLO el
literal de `governed-repo.js` la suite entera seguía VERDE y la puerta quedaba
APAGADA sobre un repo sembrado por el `ct-init` real. La causa era que todos los
tests escribían `CONTRACT_MARKER` y luego afirmaban que se detectaba
`CONTRACT_MARKER` — autorreferencial, incapaz de fallar.

F27 lo cerró para el par ct-init ↔ governed-repo, con un test que corre el
`ct-init.sh` REAL sobre un temporal y afirma que el lector lo ve:

  __tests__/f27-closing-keywords.test.js:443

`conventions.js` SIGUE SUELTO. Nada ata su copia al escritor. Si diverge, la
poda del bloque deja de funcionar y el escáner de convenciones empieza a leer el
contrato del plugin como si fuera texto del usuario — en silencio.

QUÉ HACER: el mismo patrón que ya funciona. Un test que corra el `ct-init.sh`
real y compruebe que `conventions.js` poda de verdad el bloque que ese script
acaba de sembrar, sin que el literal aparezca escrito en el test.

VERIFICACIÓN OBLIGATORIA: rompe a propósito el literal de `conventions.js`,
confirma que tu test se pone ROJO, deshaz, confirma VERDE. Si sigue verde, tu
test es tan autorreferencial como los que vienes a arreglar.

Y decide, con criterio y diciéndolo: ¿tres copias con un test que las ata, o UNA
constante compartida? La segunda parece obvia y puede no serlo — `ct-init.sh` es
bash y no puede importar un módulo JS, así que como mucho se unifican los dos
lectores. Mide qué cuesta cada opción antes de elegir.

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

=== 3. EL `ask` BAJO `--dangerously-skip-permissions`, SIN MEDIR ===

El §2.2 del spec de F27 midió que un `deny` SIGUE BLOQUEANDO bajo
`--dangerously-skip-permissions`, verificándolo por EFECTO (un fichero centinela
que no llegó a existir):

  docs/superpowers/specs/2026-08-05-barandillas-del-7-3-design.md §2.2

Pero el hook también devuelve `ask` — es la escalada de "no sé si este repo está
gobernado", y la propiedad que sostiene el "nunca se degrada a silencio". Bajo
`bypassPermissions` NADIE ha comprobado qué hace un `ask`. Puede que pregunte,
puede que se trate como allow. Si es lo segundo, esa propiedad es falsa para
todos los agentes despachados.

QUÉ HACER: replica el experimento del §2.2 cambiando `deny` por `ask`, y mide
por EFECTO. Después escribe el resultado donde corresponda — el spec de F27, la
cabecera del hook, y el contrato si cambia lo que la puerta promete.

Diez minutos. Y si sale que `ask` no bloquea, es un hallazgo grande: dilo antes
de seguir con lo demás.

=== 4. UN FALLO INTERMITENTE, OBSERVADO UNA VEZ Y SIN CARACTERIZAR ===

Esto NO es una tarea: es un aviso, para que no te vuelva loco si te pasa.

Al cerrar F27 se observó UNA corrida de la suite completa con 6 tests rojos:

  __tests__/conventions.test.js        3 rojos
  __tests__/ct-next-conventions.test.js  1 rojo
  __tests__/ct-init.test.js            2 rojos

La firma: el escáner de convenciones reportó señales `[claim]` en líneas del
`AGENTS.md` que están DENTRO del bloque del contrato que `ct-init` acababa de
sembrar (AGENTS.md:410, 451, 475 — los `dispatch-check.mjs --requeue/--reopen`
del propio contrato). O sea: la PODA del bloque no se aplicó. `conventions.js`
poda por coincidencia exacta de línea con sus marcadores, así que o el fichero
no estaba entero cuando se escaneó, o algo bajo carga se comió la poda.

QUÉ SE SABE, y no más:
  - Sólo se ha visto en una corrida COMPLETA (59 ficheros, en paralelo, ~110 s).
  - NO se reproduce: 3 corridas aisladas de esos mismos 3 ficheros, verdes; y la
    corrida completa siguiente, verde (59 ficheros, 1685 tests, exit 0).
  - Es PREEXISTENTE. Los cambios que había en el árbol cuando ocurrió no tocan
    ni las convenciones ni la poda (package.json, un test de manifiesto, dos
    comentarios de ct-init.sh y dos ficheros de documentación).

SI TE PASA: no lo trates como una regresión tuya. Primero aísla —corre esos 3
ficheros solos— y si pasan, es esto. Y si consigues reproducirlo, CARACTERÍZALO:
un test que falla una de cada N corridas es peor que uno que falla siempre,
porque enseña a ignorar el rojo. En un repo cuya doctrina es que una
comprobación que no puede detener la acción siguiente es decoración, una que
miente en las dos direcciones es peor que no tenerla.

--- CÓMO TRABAJARLO ---

superpowers:brainstorming -> superpowers:writing-plans ->
superpowers:subagent-driven-development, en un worktree aislado. NUNCA sobre
main. Es el proceso que ha funcionado seis rondas seguidas.

Ojo: son tres cosas pequeñas, no tres features. Si el brainstorming empieza a
crecer, para y pregunta.

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

OCHO LECCIONES DE MÉTODO, TODAS PAGADAS EN F27

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

8. LA REVIEW DE RAMA COMPLETA VE LO QUE OCHO REVIEWS DE TAREA NO VEN. En F27
   encontró tres cosas que ninguna review de tarea podía ver: el fixture
   autorreferencial, que el caso que justifica la feature entera no tenía test, y
   que una afirmación del propio spec era falsa. No la saltes, y dispárala con el
   modelo más capaz.
```
