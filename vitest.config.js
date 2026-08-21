// F8 — POR QUÉ ESTE FICHERO EXISTE.
//
// Hasta ahora la suite no tenía fichero de configuración, así que corría con
// el `testTimeout` POR DEFECTO de vitest: 5000 ms. Ese número era, sin que
// nadie lo hubiera decidido, la condición de aprobado de casi toda la suite.
//
// Casi ningún test de este repo es una función pura. Los de ct-next /
// ct-groom / dispatch-check arrancan el script REAL como subproceso, y ese
// script arranca a su vez `git`, `gh` y `cmux` (stubs, sí, pero procesos node
// de verdad, con su arranque de V8 completo cada uno). Un caso `--cap 2` de
// extremo a extremo encadena del orden de veinte arranques de node. Con la
// máquina ociosa eso son 1-3 s: por debajo de los 5 s, pero por poco y sin
// que nadie lo hubiera comprobado.
//
// Medido en este repo (main @ b0799f3 SIN TOCAR, con otra suite de vitest
// completa corriendo en bucle a la vez, 6 corridas seguidas):
//   19, 23, 9, 23, 15 y 31 tests fallados de 836. Cero corridas verdes.
//   De esos 120 fallos, 116 eran literalmente "Test timed out in 5000ms" —
//   ni una sola AssertionError. Duraciones reales de tests que "fallaron":
//   17427, 16814, 16261, 15242, 12204, 10107, 9773, 9717, 8721 ms…
//
// SUBIR ESTE NÚMERO NO ES TAPAR UN TEST QUE MIENTE, y la distinción importa
// porque es justo la trampa que esta tarea venía a desmontar. Un
// `testTimeout` es un DETECTOR DE CUELGUES, no un mecanismo de
// sincronización. Ninguno de los tests que se caían por él afirma NADA sobre
// cuánto tarda algo: todas sus aserciones son sobre el exit code, el texto de
// salida y los ficheros que quedaron en disco. A 5 s el plazo no significaba
// "esto se ha colgado", significaba "la máquina estaba ocupada" — y el
// informe de fallo era indistinguible del de una aserción rota de verdad. A
// 120 s solo puede dispararlo un cuelgue real, y el veredicto ante un cuelgue
// real sigue siendo el mismo que antes: falla. Solo tarda más en llegar, que
// es exactamente lo que se le pide a una red de seguridad.
//
// Los sitios donde el reloj SÍ era la sincronización o la aserción (no un
// plazo de seguridad) NO se han arreglado subiendo ningún número — ver
// CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE en scripts/ct-next.mjs,
// FAKE_GIT_WORKTREE_ADD_WAIT_FILE en __tests__/fixtures/fake-git-bin/git, y
// las mediciones pareadas de dispatch-check-dryrun.test.js.
//
// hookTimeout: mismo razonamiento para los `afterEach` (que borran árboles de
// directorios temporales); su default es 10 s y bajo carga se queda igual de
// corto.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    // CT_WATCH_GO_BIN — NINGÚN test lanza el vigilante del `-OK` de verdad.
    //
    // `ct-next` lo lanza DESPRENDIDO tras despachar un slice con gate `plan`, o
    // sea en la mayoría de los tests que despachan algo. Medido la primera vez
    // que la suite corrió con esto puesto: 42 procesos `ct-watch-go.mjs`
    // huérfanos, cada uno sondeando cada 30 s durante ocho horas. Un `pkill`
    // después de cada corrida no es una solución: la suite no puede dejar
    // procesos detrás, punto.
    //
    // Va aquí y no en cada test porque el defecto es exactamente ese: que un
    // test que NO habla de esto lo lance sin querer. Los tres ficheros que sí
    // hablan de esto fijan su propio valor y no dependen de éste.
    //
    // La grabadora, además de no sondear nada, apunta su argv cuando el test le
    // da un FAKE_WATCH_GO_LOG — así el mismo doble sirve para no hacer daño y
    // para comprobar que el lanzamiento ocurre con los argumentos correctos.
    env: {
      CT_WATCH_GO_BIN: new URL('./__tests__/fixtures/fake-watch-go-bin/recorder.mjs', import.meta.url).pathname,
    },
  },
})
