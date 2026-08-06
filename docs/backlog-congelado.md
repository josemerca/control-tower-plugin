# Backlog congelado — CERRADO

Ideas de mejora surgidas durante la **fase de uso** del plugin. El congelado empezó en 0.21.0
(2026-07-30) y **terminó**: desde entonces el plugin ha ido de 0.21.0 a 0.26.0 en seis rondas
(F22 a F27), guiadas por el documento de feedback de campo del 1-ago.

**Este documento ya no está vigente.** Se conserva porque sus dos entradas se resolvieron, y
saber dónde aterrizó cada una vale más que borrar el fichero. No añadas entradas nuevas aquí:
el backlog vivo es el handoff de cada ronda (`docs/prompt-f*.md`).

---

- **~~`STATE.md` puede quedarse en `not_started` sobre un worktree ya trabajado~~** — visto en
  el `#452` de menoplus: 3 commits de backend y el `STATE.md` sin actualizar ni commitear.
  **Cerrado en dos partes.** F22 movió el estado del slice a `.agent/SLICE.md`, ignorado por dos
  vías, así que ya no contamina `main` al mergear; y el hook de `Stop` (`hooks/stop.js`) compara
  el `last_commit` del fichero de estado contra `HEAD` y lo dice al cerrar el turno, así que un
  estado que miente deja de ser invisible.

- **~~La label de estado puede quedarse colgada tras el merge~~** — el `#451` quedó CLOSED con
  `status:in-review` puesta. **Cerrado en F25**: `/ct-status` lo reporta en su bloque `RESIDUO`,
  nombrando el issue y dando el comando exacto para quitarla. No se **previene** —cerrar el issue
  y quitarle la label siguen siendo dos actos distintos y nada comprueba el segundo— pero deja de
  ser silencioso, que era el problema.
