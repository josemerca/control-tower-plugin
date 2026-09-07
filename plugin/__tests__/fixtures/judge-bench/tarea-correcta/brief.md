> El fin del slice, para situar esta tarea en él. NO es vara: no amplía el
> **Files:** de la tarea ni lo que ésta declara fuera de alcance, y una tarea que
> sirve al fin del slice haciendo algo que su texto no pide sigue estando fuera.

### Desired end state

- Cada presupuesto de la máquina de estados —descartes, intentos, correcciones— es una política
  con su tope inyectado que devuelve el efecto entero (`{ step, n }`), y la máquina no lleva
  ningún `if (n >= MAX)` propio.
- `run-machine.js` consume `DiscardBudget`, `AttemptBudget` y `CorrectionBudget` por el mismo
  camino, y el tope de cada uno se lee de la configuración del run.

> Estas secciones son la vara del plan: si contradicen la tarea, ganan ellas.

### Out of scope

🚫 `CorrectionBudget`: es la Task 4.
🚫 Enchufar el presupuesto en `run-machine.js` o leer el tope de la configuración: es la Task 5.
🚫 Tocar `DiscardBudget` o su test: ya están en `main` y son el patrón a imitar, no el sujeto.

## 2. Closed decisions (do NOT reopen)

| Decision | Value |
|---|---|
| El tope | Entra por el constructor como `cap`, sin valor por defecto; un `cap` que no sea entero positivo es un `RangeError` al construir |
| El efecto | Un `AttemptEffect` inmutable `{ step, attempt }` con `step` miembro de `AttemptStep` (`retry`, `blocked`); nunca un booleano ni un objeto suelto |
| Bajo el tope | `next(attempt)` devuelve `retry` con `attempt + 1` |
| En el tope | `next(cap)` devuelve `blocked` con el mismo `attempt` |
| Más allá del tope | `next(attempt > cap)` lanza `AttemptBeyondCap`, que hereda de `RangeError`: una entrada que la política no describe no cae en una rama por defecto |
| Runner de tests | `node --test test/` (el de `package.json`); los tests viven en `test/` y se nombran como el módulo que prueban |

## 3. Reference patterns

Files to imitate: `src/discard-budget.js` (la política gemela: vocabulario cerrado, error
propio para la entrada fuera de rango, efecto inmutable declarado al lado, tope inyectado sin
default) y `test/discard-budget.js` (madre `Budgets`, un test por rama, nombre en frase).

Rules to obey: ninguna propia del repo más allá de la vara de ct que cierra este brief.

### Task 3 — el presupuesto de intentos

**Objective:** `AttemptBudget` recibe `cap` por el constructor y `next(attempt)` devuelve el efecto entero: `AttemptEffect { step: 'retry', attempt: attempt + 1 }` bajo el tope, `AttemptEffect { step: 'blocked', attempt }` en el tope, y lanza `AttemptBeyondCap` más allá de él.

**Files:** `src/attempt-budget.js` (create), `test/attempt-budget.js` (create)

**TDD:** `it('the attempt at the cap is blocked instead of retried')` — `new AttemptBudget({ cap: 3 }).next(3)` devuelve `new AttemptEffect({ step: AttemptStep.BLOCKED, attempt: 3 })`. En rojo hoy: el módulo no existe.

**Tests:** añade `'an attempt under the cap retries with the next number'`, `'the attempt at the cap is blocked instead of retried'` y `'an attempt beyond the cap is an error, not a silent block'`. No retira ninguno.

**Verification:**

```bash
node --test test/attempt-budget.js   # exit 0
```
