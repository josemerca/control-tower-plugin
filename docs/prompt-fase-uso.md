# Prompt de arranque — fase de uso (congelación del plugin)

> Decisión de José, 2026-07-30. Pégalo tal cual en la sesión que desarrolla el plugin.
> Autocontenido a propósito: aguanta un `/clear`.

```
CAMBIO DE FASE: el plugin queda CONGELADO. Pasas de construirlo a usarlo.

Decisión tomada (José, 2026-07-30): control-tower-loop se queda en la versión
actual (0.20.0 + F21). Las siete rondas de endurecimiento se alimentaron de
fallos encontrados CONSTRUYENDO el loop; los fallos del slice 20 serán otros y
no se adivinan desde el sofá. Solo ha pasado UN slice completo por el loop
(#451, mergeado y cerrado el 29-jul). Todo lo demás está inferido de ese N=1.
Lo que toca ahora es volumen de slices reales, no otra ronda a ciegas.

--- TAREA 1 (ahora, minutos) ---
Validar el lanzamiento contra el sandbox:

  node scripts/ct-next.mjs --repo josemerca/ct-loop-sandbox --cap 1 --dry-run
  node scripts/ct-next.mjs --repo josemerca/ct-loop-sandbox --cap 1

Criterio de éxito: LAS DOS COSAS, no una.
  (a) el dispatcher dice "lanzado" con exit 0;
  (b) hay un proceso claude vivo con su cwd DENTRO del worktree del sandbox
      (compruébalo en la tabla de procesos, no por la ventana abierta: la
      ventana la abre el propio dispatcher y no prueba nada).
Contexto: el despacho anterior del #452 falló porque cmux TECLEA el comando en
el pty y el prompt de oh-my-zsh se comía el primer carácter (6 de 6 medidos).
El prompt ya está desactivado y el lanzamiento reintenta con guarda de
idempotencia. Esto valida ese arreglo. Si falla, es bug bloqueante: ver abajo.

Nota: screencapture no funciona (falta permiso de Grabación de Pantalla), así
que la comprobación visual de la ventana es de José, no tuya. La evidencia de
proceso descarta el modo de fallo; no afirmes lo que no puedas ver.

--- TAREA 2 (después) ---
Despachar el epic ya groomeado de menoplus-app/menoplus: #452 al #456, uno a
uno, SIN TOCAR una línea del plugin. Estado real de partida: el #452 está en
status:ready, sin worktree, sin rama y sin claim — no está en vuelo.

Pendiente de decidir con José antes del primer despacho: .worktrees/451 y
feat/451 siguen en disco a propósito, como evidencia del primer ciclo. Si se
cosechan, con los comandos que el propio aviso "cosecha pendiente:" imprime.

--- REGLA DE ORO ---
La única razón para tocar código del plugin es un BUG QUE BLOQUEA UN DESPACHO.
Cuando pase: diagnostica la causa raíz, arregla mínimo, añade el test, y sigue.
Nada de refactors vecinos, nada de "y ya que estoy", nada de abrir una ronda F22.

--- PROHIBIDO EN ESTA FASE ---
- Features nuevas, rondas de endurecimiento, mejoras de mensajes de error.
- Tocar --reconcile (es experimental y escribe en bodies reales).
- Convertir los gates en hooks bloqueantes. Es una idea buena y NO es ahora.
- Más arqueología de cmux: ya está medido que no hay vía de exec.
- Back-portear nada al spec de control-tower. El spec queda congelado como
  registro de diseño con fecha; los 50 ficheros de test son el contrato.
- Groomear epics nuevos.
- Publicar nada (repo público, marketplace, post).
Si se te ocurre una mejora, ANÓTALA en docs/backlog-congelado.md (créalo si no
existe: una línea, qué y por qué) y sigue. No la implementes.

--- LO QUE SÍ HAY QUE MEDIR ---
Crea docs/medicion-slices.md y apunta, por cada slice despachado, solo esto:
  - nº de issue, tipo, fecha;
  - MINUTOS DE INTERVENCIÓN HUMANA (todo lo que José tuvo que hacer: promover,
    revisar el gate, mergear, y cualquier cosa a mano);
  - ¿hubo medio estado que limpiar a mano? (claim huérfano, worktree
    bloqueando, label descolgada) — sí/no + qué.
Nada más. Son los dos únicos datos que deciden el futuro de esto.

--- CRITERIO DE MUERTE (explícito, para que no dependa del ánimo del día) ---
Tras los 5 slices: si la intervención humana por slice no es MENOR que hacer el
mismo trabajo a mano en una sesión normal, el dispatcher no se sostiene y se
retira. /ct-groom sobrevive por separado (no depende de cmux ni del despacho) y
se queda como validador de tabla §9 → GitHub. El valor de rescate es alto: por
eso seguir es barato y decidir ahora sería decidir sin datos.

--- EXCEPCIÓN AUTORIZADA (no es plugin, protege el siguiente slice) ---
Leyendo el kickoff del #452 se detectó que el spec da por sentado el helper
today_madrid() de shared/domain/clock.py, y AGENTS.md de menoplus no lo
menciona (cero ocurrencias de today_madrid / clock.py / Europe/Madrid), ni la
convención "sin JSONB". Ese repo YA pagó ese bug: date.today() en contenedor
UTC daba off-by-one de ~2h tras medianoche en Madrid, arreglado en el PR #419.
El #452 es type:backend con touches:migration y escribe fronteras de semana:
lo reproduce. Añade las dos convenciones a AGENTS.md de menoplus ANTES de
despacharlo. Verifica primero que el helper existe donde digo — no lo
documentes de memoria.

--- CÓMO REPORTAR ---
Evidencia antes que aserción, siempre. No marques nada como hecho sin output
real (exit code, fichero en disco, estado del issue en GitHub). Si algo no lo
has comprobado, dilo: "no se ha mirado" y "no hay nada" no son lo mismo.
```
