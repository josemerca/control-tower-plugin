> El fin del slice, para situar esta tarea en él. NO es vara: no amplía el
> **Files:** de la tarea ni lo que ésta declara fuera de alcance, y una tarea que
> sirve al fin del slice haciendo algo que su texto no pide sigue estando fuera.

### Desired end state

- El conductor lee el informe del implementador y el veredicto del juez desde disco con dos
  lectores gemelos, `ReportFile` y `VerdictFile`, que nunca lanzan: un fichero ilegible o que
  no es JSON vuelve como `{ why }` y el paso se descarta con ese motivo.
- `ct-step verdict` deja de envolver `JSON.parse` en su propio `try` y delega en `VerdictFile`.

> Estas secciones son la vara del plan: si contradicen la tarea, ganan ellas.

### Out of scope

🚫 Validar el contenido del veredicto (esquema, rúbrica, token): eso sigue en `readVerdict`.
🚫 Tocar `ReportFile` o su test: ya están en `main` y son el patrón a imitar, no el sujeto.
🚫 Cualquier cambio en `ct-step.mjs`: es la Task 3.

## 2. Closed decisions (do NOT reopen)

| Decision | Value |
|---|---|
| Forma de la respuesta | `{ verdict }` cuando se lee y parsea; `{ why }` en cualquier otro caso. Nunca una excepción fuera del lector |
| Motivo de un fichero ilegible | `verdict file not readable: <path>`, con la ruta tal cual llegó |
| Motivo de un JSON ilegible | `verdict file is not JSON: <path>` |
| Runner de tests | `node --test test/` (el de `package.json`); los tests viven en `test/` y se nombran como el módulo que prueban |

## 3. Reference patterns

Files to imitate: `src/report-file.js` (el lector gemelo: clase con un único `static read`, dos
`try` separados para leer y para parsear, un `{ why }` por cada uno) y `test/report-file.js`
(la madre `ReportsOnDisk` que escribe el fichero en un directorio temporal, un test por rama).

Rules to obey: ninguna propia del repo más allá de la vara de ct que cierra este brief.

### Task 2 — el lector del veredicto

**Objective:** `VerdictFile.read(path)` devuelve `{ verdict }` con el JSON parseado cuando el fichero se lee y parsea, `{ why: 'verdict file not readable: <path>' }` cuando no se puede leer y `{ why: 'verdict file is not JSON: <path>' }` cuando se lee pero no es JSON. No lanza en ningún caso.

**Files:** `src/verdict-file.js` (create), `test/verdict-file.js` (create)

**TDD:** `it('an unreadable verdict file is a discard, not a crash')` — `VerdictFile.read('/nope/verdict.json')` devuelve exactamente `{ why: 'verdict file not readable: /nope/verdict.json' }`. En rojo hoy: el módulo no existe.

**Tests:** añade `'a JSON verdict file is returned parsed'` y `'an unreadable verdict file is a discard, not a crash'`. No retira ninguno.

**Verification:**

```bash
node --test test/verdict-file.js   # exit 0
```
