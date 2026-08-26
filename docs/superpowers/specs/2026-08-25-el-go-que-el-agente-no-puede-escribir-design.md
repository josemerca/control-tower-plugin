# F38 — El go que el agente no puede escribir

**Estado:** implementado. Plugin a `0.42.0`. Sin cambio de contrato de la tabla.

## 1. Procedencia

La barandilla estaba **nombrada y sin construir**, y su enunciado existía en dos
versiones que no dicen lo mismo:

- `commands/ct-next.md` (v0.41.0, de la PR #32): *«la barandilla que lo cerraría
  —que `--release` se niegue sin un `-OK` en el issue— no está construida»*.
- El informe de convergencia de Juanjo (25-ago-2026): *«que `--release` se niegue
  sin un `-OK` **que el agente no pueda emitir**»*.

La diferencia entre las dos ES el trabajo de esta ronda: la primera le da
consecuencia a un comentario que el gateado puede escribir él; la segunda exige
que no pueda. Se ha construido la segunda.

Y un dato que corrige la urgencia con la que el informe lo presenta: el gate
`plan` **no es opt-in** en `main`, es implicado por defecto en todo slice
(`gates.js#gatesForType`, F-jjponz-2, con renuncia `!plan` por fila). O sea que
el agujero no estaba esperando a que se encendiera nada.

## 2. El defecto, en una frase

El agente despachado tiene `gh` y corre con las credenciales del operador, así
que podía escribir `-OK` en su propio issue: la puerta la abría el gateado. Y
`--release` no exigía ningún go, así que el gate entero se podía ignorar sin
consecuencia — el kickoff que manda parar es un prompt, no un gate. El resultado
peor no es el trabajo sin revisar: es el **registro** de una revisión humana que
no ocurrió.

## 3. La decisión, y las dos que se descartaron

Tres formas de cerrarlo, y por qué esta:

| Forma | Qué cierra | Por qué no |
|---|---|---|
| `-OK` desnudo exigido por `--release` | Que el agente **ignore** el gate | No cierra la falsificación: el agente escribe el token con un comando. Media barandilla. |
| **`-OK <nonce>` por despacho** (elegida) | Ignorarlo **y** fabricarlo | — |
| Identidad separada (token de bot + allowlist humana) | Lo mismo, por autoría | Exige infra de credenciales y no cierra más: el agente tiene shell y puede caer al `gh auth` del keychain del operador. |

El argumento de fondo de la elegida: falsificar el go deja de ser *«un `gh issue
comment` en mi propio issue»* —un comando dentro del repertorio normal del
agente, que el kickoff ya le manda usar, con una traza indistinguible de la
legítima— y pasa a exigir manipular el estado privado de la coordinadora fuera
del repo. Esa es **la línea detrás de la que ya están todos los demás gates de
este repo**: ninguno sobrevive a un agente que reescribe el plugin que lo juzga.
Lo que esta ronda hace es sacar el go de la lista de cosas que se saltan sin
salirse del guion.

## 4. Las piezas

| Fichero | Papel |
|---|---|
| `scripts/go-response.js` | El módulo puro: `goBody`, `goCommitment` (sha256 del nonce), `newGoNonce` (bytes inyectados), `matchesGo` — **la misma** función para el vigilante y para `--release`. `hasGo` exige compromiso: sin él no hay go, ni el `-OK` de ayer. |
| `scripts/go-registry.js` | Dónde vive el compromiso: `~/.claude/control-tower/go/<owner>__<repo>-<issue>.json`, `0600`, un fichero por issue. **No** en GitHub: todo lo que vive ahí lo escribe el agente. Tres respuestas de lectura (hay / no hay / no se pudo leer). |
| `scripts/go-channel.js` | El último tramo hasta la persona. Por defecto `stdout`; `CT_GO_CHANNEL=notify` lo manda por `osascript` y no lo imprime. |
| `scripts/ct-next.mjs` | Sortea el nonce (único proceso que corre en la sesión de quien despacha), registra el compromiso **antes** de lanzar el vigilante, y le pasa sólo `--go-hash`. |
| `scripts/ct-watch-go.mjs` | Exige `--go-hash` (exit 2 sin él): un vigilante que cayera al token fijo sería una puerta que se abre **omitiendo un argumento**. |
| `scripts/ct-go.mjs` | Reemitir el go de un despacho en vuelo (el nonce se pierde: sesión cerrada, despacho de ayer). No relanza el vigilante, y lo dice. |
| `scripts/dispatch-check.mjs` | La **puerta 9** de `--release`. |

## 5. La puerta 9

- Va **la última** de la escalera (5 estado → 6 plan → 7 run → 8 e2e → 9 go). El
  orden de esta escalera es «qué mensaje debe ganar»: con el run a medias,
  preguntar por el go es ruido sobre un slice que no ha terminado; con todo en
  verde, un go que falta ya no es un «todavía no», es trabajo entero hecho sin
  permiso.
- Se niega **sin mutar nada** (comprobado sobre el `argv` real de `gh`).
- **Sin ventana**, al contrario que el vigilante: el nonce es por despacho, así
  que un go heredado no encaja por construcción.
- No libera: sin compromiso registrado con el gate en pie, con el registro
  ilegible, o si no se pueden leer los comentarios. *Doctrina de siempre: no se
  afirma limpio lo que no se ha podido mirar.*
- Sí libera: la renuncia **explícita** (`gate:none` / `!plan`). Un issue que no
  declara **ningún** gate no libera — silencio no es renuncia, y sería el camino
  que abriría un agente borrándose las labels.
- Imprime **quién** dio el go por `stderr`: es la única señal que delataría un go
  dado por la misma identidad con la que corre el agente.

## 6. Lo que esta ronda NO hace

- **Cerrar la falsificación de verdad.** Agente y coordinadora corren con el
  mismo uid en la misma máquina. Nada de esto es criptografía contra un
  adversario. El cierre completo exige un verificador que no corra bajo ese uid
  —CI, u otra identidad—, y el repo todavía no tiene CI (D-6, abierta).
- **Proteger de la coordinadora por defecto.** Con el canal por defecto el nonce
  pasa por `stdout`, que cuando `/ct-next` lo corre una sesión de Claude es su
  contexto. Protege del **implementador**, que es quien tiene el incentivo.
  `CT_GO_CHANNEL=notify` lo cierra también para la coordinadora, y no es el
  defecto porque un canal que puede no existir dejaría el slice sin go.
- **Relanzar el vigilante desde `ct-go`.** Haría falta el título de la workspace
  de cmux y duplicar el arranque del hijo desprendido, para ahorrar un empujón
  manual que ya está documentado.
- **Tocar los otros gates.** `visual`, `apply` y `e2e` siguen enseñándose sin
  imponerse.
