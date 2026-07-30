# Medición de slices despachados

Dos datos por slice. Nada más. Son los que deciden si el dispatcher sobrevive.

**Criterio de muerte (José, 2026-07-30):** tras 5 slices, si la intervención humana por slice
no es MENOR que hacer el mismo trabajo a mano en una sesión normal, el dispatcher se retira.
`/ct-groom` sobrevive por separado (no depende de cmux ni del despacho).

| # | Tipo | Fecha | Min. intervención humana | ¿Medio estado a mano? | Qué |
|---|------|-------|--------------------------|------------------------|-----|
| 451 | `type:ui` | 2026-07-29 | **no medido** (el slice pasó antes de existir esta tabla) | **sí** | Issue CLOSED y PR #461 mergeado, pero la label `status:in-review` sigue colgada en el issue. Verificado 2026-07-30 vía `gh issue list`. |
| 452 | `type:backend` `touches:migration` | en vuelo (desde 29-jul ~20:27) | pendiente | pendiente | Ver nota abajo. |

## Checklist del gate del PR del #452

Decisión de José (2026-07-30): **no se interrumpe la sesión en vuelo**; el aviso de convenciones se
comprueba en el gate. Al revisar el PR:

- [ ] El call-site que pasa `today` a `weekly_cycle` usa `today_madrid()`, **no** `date.today()`.
      Es el punto exacto donde reentra el bug del PR #419, y no estaba escrito aún a las 11:00.
- [ ] El gate de este slice **no es visual, es de datos**: el backfill del §7.4 corre sobre datos
      reales. Si falla el día del deploy, las usuarias ven su plan vacío y parece pérdida de datos.
      CI verde no cubre eso.
- [ ] El cuerpo del PR lleva `Closes #452` (es lo único que cierra el issue y libera sus tokens).
- [ ] `.agent/STATE.md` refleja el trabajo real antes de mergear (hoy dice `not_started`).

## Notas

### #451 — no se inventa lo que no se midió
El slice se completó y mergeó el 29-jul, antes de que existiera este registro. Los minutos de
intervención humana **no se registraron**; no se estiman aquí. N=1 sin el dato que importa.
Lo único verificable a posteriori es el medio estado: la label descolgada.

### #452 — EN VUELO (verificado 2026-07-30 ~11:00), no parado
Se fue a despacharlo asumiendo `status:ready` sin worktree ni rama. **Lo que hay es un slice vivo:**
- label `status:in-progress`, worktree `.worktrees/452`, rama local `feat/452`
- 5 commits, el último `f6bdab95` a las **10:42 de hoy** (ciclo semanal, tabla `plan_adoption` +
  backfill, fix ON DELETE CASCADE, 2 entradas de bitácora)
- **proceso `claude` vivo**: PID 35635 con `cwd = .worktrees/452` (`lsof -d cwd`)

O sea: el despacho del #452 **ya funcionó** — el arreglo F20/F21 estaba operativo desde el 29-jul
por la tarde. El prompt de arranque de esta sesión describía la foto del 29-jul 17:46 (commits
`bca683e1`/`ae8946d5`, la limpieza a mano de José); entre esa hora y ahora el slice se despachó y
avanzó dos tasks, **y ese despacho no quedó registrado en ningún STATE.md**.

**Dato del loop, no anécdota:** `.agent/STATE.md` del worktree sigue diciendo `status: not_started`
/ "slice recién despachado, sin trabajo aún" encima de 5 commits de backend. El STATE.md es la
hidratación de la siguiente sesión — mintiendo así, cualquier sesión que llegue después (o un
humano leyendo) concluye que no se ha hecho nada. Es el candidato número uno a gate, anotado en
[backlog-congelado.md](backlog-congelado.md).

**Convenciones (excepción autorizada):** el agente aplicó `JSON` en vez de `JSONB` por su cuenta y
lo documentó (`src/plan/infrastructure/models.py:4-5`). El dominio `weekly_cycle.py` recibe `today`
por parámetro y documenta que no llama a `date.today()` — correcto. **Pero el call-site que le
pasará ese `today` (el endpoint del §5.2) todavía no está escrito**: ahí es donde entraría el
off-by-one del PR #419. El worktree tiene su copia de AGENTS.md congelada al crear la rama, así
que la adición hecha hoy en `main` **no la ve**. Riesgo abierto, pendiente de decisión de José.

### Residuo de labels en menoplus, medido por el propio dispatcher (2026-07-30)
El `--dry-run` sobre `menoplus-app/menoplus` reporta **5 issues CERRADOS que conservan una label
`status:` viva**, invisibles para `/ct-next` (solo barre abiertos):
- `#161, #157, #156` en `status:ready` — se cayeron de la cola de despacho sin aviso
- `#245, #155` en `status:in-progress` — claims que nunca se soltaron; su worktree y rama pueden
  seguir en disco
- (+5 en `status:in-review`, que es el final normal de un slice, y `#158` en `status:blocked`, inerte)

Esto **precede al loop** — son de la era anterior, no medias limpiezas de estos slices. Se registra
porque cuantifica el fenómeno que sí toca a los slices nuevos: el #451 acabó igual. Cerrar un issue
y quitarle la label son dos actos distintos y nada comprueba el segundo.

### Validación del lanzamiento (2026-07-30, sandbox — no es un slice de producción)
`ct-next --repo josemerca/ct-loop-sandbox --cap 1` sobre el issue #2. Dry-run exit 0 y lanzamiento
real exit 0. Verificado en la tabla de procesos, no por la ventana: PID 39682
(`/Users/jpereag/.local/bin/claude … --dangerously-skip-permissions <kickoff #2>`) con
`cwd = /Users/jpereag/Documents/ct-loop-sandbox/.worktrees/2` vía `lsof -d cwd`. Un solo `claude`
lanzado — la guarda de idempotencia de F20/F21 aguantó el reenvío.

Medio estado que deja esta validación (a limpiar cuando José diga): worktree
`ct-loop-sandbox/.worktrees/2`, rama `feat/2`, e issue #2 del sandbox en `status:in-progress`.
