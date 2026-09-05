> El fin del slice, para situar esta tarea en él. NO es vara: no amplía el
> **Files:** de la tarea ni lo que ésta declara fuera de alcance, y una tarea que
> sirve al fin del slice haciendo algo que su texto no pide sigue estando fuera.

### Desired end state

- Dos despachadores lanzados a la vez sobre el mismo repo nunca se llevan el mismo issue: el
  primero que reclama escribe `.agent/claims/<issue>.lock` con su pid y el segundo recibe
  `already-taken` con el pid del primero.
- `ct-next` reclama con `IssueClaim` antes de crear el worktree, y un `already-taken` lo hace
  pasar al siguiente issue `ready` en vez de abortar.

> Estas secciones son la vara del plan: si contradicen la tarea, ganan ellas.

### Out of scope

🚫 Liberar el claim (borrar el lock) cuando el slice termina o el proceso muere: es la Task 2.
🚫 Integrarlo en `ct-next`: es la Task 3.
🚫 Cualquier lock distinto del fichero: ni `flock`, ni un ref de git, ni un label de GitHub.

## 2. Closed decisions (do NOT reopen)

| Decision | Value |
|---|---|
| Dónde vive el lock | `ClaimsDirectory.lockOf(issue)`, que ya está en `main`; `IssueClaim` recibe el `ClaimsDirectory` por el constructor y no compone rutas |
| Atomicidad del claim | Una sola llamada `writeFileSync(lock, String(pid), { flag: 'wx' })`, tratando el `EEXIST` que lanza como `already-taken`: comprobar la existencia y escribir son el mismo syscall. Nunca `existsSync` seguido de una escritura: dos despachadores a la vez pasan los dos la comprobación y el segundo pisa el lock del primero |
| Formato del lock | El pid en decimal, sin salto de línea; quien lee hace `Number(...)` del contenido entero |
| Forma de la respuesta | Un `Claim` inmutable `{ outcome, by }` con `outcome` miembro de `ClaimOutcome` (`taken`, `already-taken`) y `by` el pid que tiene el lock tras la llamada; nunca un booleano |
| Runner de tests | `node --test test/` (el de `package.json`); los tests viven en `test/` y se nombran como el módulo que prueban |

## 3. Reference patterns

Files to imitate: `src/claims-directory.js` (valor inmutable con la ruta inyectada y un
`RangeError` para la entrada que no describe) y `test/claims-directory.js` (un test por
rama, nombre en frase).

Rules to obey: ninguna propia del repo más allá de la vara de ct que cierra este brief.

### Task 1 — el claim de un issue

**Objective:** `IssueClaim.take({ issue, pid })` crea el directorio de claims si falta, escribe el lock del issue con el pid y devuelve `Claim { outcome: 'taken', by: pid }`; si el lock ya existe devuelve `Claim { outcome: 'already-taken', by: <pid del lock> }` sin tocarlo.

**Files:** `src/issue-claim.js` (create), `test/issue-claim.js` (create)

**TDD:** `it('the second claim of the same issue is refused and names who holds it')` — sobre un directorio temporal, `take({ issue: 7, pid: 100 })` y después `take({ issue: 7, pid: 200 })`; el segundo devuelve `new Claim({ outcome: ClaimOutcome.ALREADY_TAKEN, by: 100 })` y `7.lock` sigue conteniendo `100`. En rojo hoy: el módulo no existe.

**Tests:** añade `'the first claim of an issue is taken and leaves the pid in the lock'` y `'the second claim of the same issue is refused and names who holds it'`. No retira ninguno.

**Verification:**

```bash
node --test test/issue-claim.js   # exit 0
```
