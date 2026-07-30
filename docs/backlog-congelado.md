# Backlog congelado

Ideas de mejora surgidas durante la **fase de uso** del plugin (congelado en 0.21.0 desde
2026-07-30). Una línea cada una: qué y por qué. **No se implementan.** Existen aquí para no
perderse y para no convertirse en una ronda F22 a ciegas.

La única razón para tocar código del plugin en esta fase es un **bug que bloquea un despacho**.

---

- **STATE.md puede quedarse en `not_started` sobre un worktree ya trabajado** — visto en el #452
  de menoplus: 3 commits de backend y el STATE.md sin actualizar ni commitear. Por qué importa:
  el STATE.md es la hidratación de la siguiente sesión; si miente, la sesión arranca con el
  cuadro equivocado. No es bug del dispatcher (él lo siembra bien; es el agente quien no lo
  mantiene), así que no bloquea despacho — pero es el candidato número uno a gate.

- **La label de estado puede quedarse colgada tras el merge** — el #451 quedó CLOSED con
  `status:in-review` puesta. Por qué importa: si algún día una consulta filtra por label en vez
  de por estado del issue, cuenta slices en revisión que no existen.
