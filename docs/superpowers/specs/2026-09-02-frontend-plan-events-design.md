# El front, endpoint a endpoint — el progreso del plan sobre `GET /plan-events/:issue`

**Fecha:** 2026-09-02
**Repo:** `josemerca/control-tower-plugin`, directorio `frontend/`
**Estado:** diseño ejecutado en la misma PR — el segundo slice vive en `frontend/`
**Alcance:** un componente nuevo, y la pantalla del primer slice puesta al día

---

## 1. Qué se construye

El backend publica su segundo endpoint: `GET /plan-events/:issue`, un flujo de
Server-Sent Events que cuenta en qué estado está el plan que arrancó
`POST /start-plan`. Este slice trae su componente: **`PlanProgress`**, que se
suscribe al flujo del issue que abrió el arranque y enseña el estado hasta que
el plan está listo o algo falla.

De paso, el primer slice se pone al día. El contrato de `POST /start-plan`
cambió después de aquella PR: `repo` es obligatorio, y el `202` ya no devuelve
`session` sino el `issue` abierto y el nombre del `agent`. Sin ese `issue` no
hay nada que vigilar, así que las dos cosas van juntas.

---

## 2. Los contratos, copiados del backend

### 2.1 `POST /start-plan` (el vigente)

Petición: `Content-Type: application/json`, cuerpo `{"id":"ABC-123","repo":"owner/name"}`.
Los dos campos son obligatorios. `id` cumple `^[A-Z][A-Z0-9_]*-\d+$`; `repo`
cumple `^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9._-]*$`.

| Código | Cuerpo | Cuándo |
|---|---|---|
| `202` | `{"status":"started","id":"ABC-123","repo":"owner/name","issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4"}` | el plan arrancó |
| `400` | `{"error":"id must be a user story key such as ABC-123"}` | id mal formado |
| `400` | `{"error":"repo must be a repository such as owner/name"}` | repo mal formado |
| `502`/`503` | `{"error":"could not start the plan: …"}` | algo del arranque falló |

### 2.2 `GET /plan-events/:issue`

Respuesta `200` con `Content-Type: text/event-stream`. Cada evento lleva un
`data` con JSON:

| Evento | `data` | Cuándo |
|---|---|---|
| `message` (sin nombre) | `{"state":"writing"}` | el agente aún escribe el plan |
| `message` (sin nombre) | `{"state":"ready"}` | el plan está comprometido; el flujo termina |
| `event: error` | `{"error":"git status could not say whether the plan is committed"}` | no se pudo leer el progreso; el flujo termina |

El backend sólo envía un estado cuando cambia, y lee cada dos segundos.

Rechazos: `400` `{"error":"the issue to watch is a number such as 42"}` si el
issue no es un número; `404` `{"error":"no plan was started for that issue"}`
si nadie arrancó un plan para ese issue; `403` si el origen es ajeno, como en
el `POST`.

### 2.3 Lo que `EventSource` hace solo, y lo que el cliente tiene que hacer

- Cuando el servidor cierra el flujo, el navegador dispara `error` y
  **reconecta**. El backend olvida la sesión al terminar, así que la
  reconexión recibe un `404`, `EventSource` dispara `error` otra vez y se
  cierra del todo. Ninguno de esos dos `error` es un fallo para el usuario.
  Por eso el cliente **cierra él mismo** el `EventSource` al recibir `ready` o
  el frame de error, e ignora cualquier `error` posterior.
- El frame `event: error` del backend es un evento **con nombre**: no llega al
  listener de `message`, llega al de `error` como un `MessageEvent` **con
  `data`**. Un fallo de red llega al mismo listener como un `Event` **sin
  `data`**. El cliente los distingue con `'data' in event`.

---

## 3. Las decisiones

- **`EventSource` nativo, envuelto en `app/plan-events/client.ts`.** Es la
  herramienta del navegador para SSE y la que el backend tiene en la cabeza
  (el `404` tras `ready` existe para que un `EventSource` deje de reconectar).
  Cuando entren las librerías de la casa, este fichero es el único que cambia.
- **`addEventListener`, no `onmessage`/`onerror`.** Permite que el doble de
  los tests sea un `EventTarget` corriente.
- **El estado sube a `Home`.** `StartPlanForm` recibe `onStarted(plan)` y ya
  no pinta el éxito; `Home` guarda el plan arrancado y monta
  `<PlanProgress key={issue.number} plan={…}>`. Las dos features no se importan
  entre sí, como pedía el §7 del primer diseño. La `key` por número de issue
  garantiza una suscripción nueva si arranca otro plan, y el desmontaje de la
  anterior cierra su flujo.
- **Una sola `Banner` cuyo aspecto sigue la fase.** La descripción es
  constante: el issue con enlace, el repo y el agente.
- **El campo `Repositorio`** valida en el navegador con el mismo patrón que
  `RepositoryName` del backend. La autoridad sigue siendo el `400`.

---

## 4. La máquina de estados y la copia

| Fase | Llega | Pasa a | Flujo |
|---|---|---|---|
| connecting | `{"state":"writing"}` | writing | abierto |
| connecting / writing | `{"state":"ready"}` | ready | lo cerramos |
| connecting / writing | `event: error` con `data` | failed(error) | lo cerramos |
| connecting / writing | `error` sin `data` | unreachable | lo cerramos |
| ready / failed / unreachable | cualquier `error` | sin cambio | ya cerrado |
| cualquiera | desmontaje | — | lo cierra el efecto |

| Fase | `Banner` | Título |
|---|---|---|
| connecting | informative, `role=status` | «Plan arrancado» |
| writing | informative, `role=status` | «Escribiendo el plan…» |
| ready | success, `role=status` | «Plan listo» |
| failed | error, `role=alert` | el texto de `error` del backend, tal cual |
| unreachable | error, `role=alert` | «No se pudo contactar con el backend» |

Debajo del título, siempre: «Issue #7 en `owner/name` · agente `workspace:4`»,
con `#7` enlazando a la URL del issue.

---

## 5. Tests

- **`StartPlanMother`** lleva el `202` literal nuevo y los rechazos vigentes,
  copiados de `backend/__tests__/infrastructure/api-server.test.js`.
  **`PlanEventsMother`** lleva sólo los `data` de cada evento: el prefijo
  `data:` y los `\n\n` son el envoltorio que `EventSource` quita antes de
  entregar nada a la página, así que no son payload del front.
- **`FakeEventSource`** (`pages/home/__tests__/`) extiende `EventTarget`:
  registra la URL abierta y las llamadas a `close()`, y deja al test empujar un
  `data` (`receive`), un frame de error con nombre (`failWith`) o una caída de
  conexión (`dropConnection`). jsdom no trae `EventSource`, así que `openHome`
  lo instala siempre con `vi.stubGlobal`.
- **Outside-in desde `Home`**: se arranca un plan y se comprueba lo que el
  usuario ve. Cubre: la URL `/plan-events/7`; writing → ready y que ready
  cierra; el frame de error tal cual, con `role=alert`, y que cierra; la caída
  antes de ningún frame; la caída después de ready, ignorada; el desmontaje.

---

## 6. Desarrollo local

`vite.config.ts` reenvía `/start-plan` y `/plan-events` al backend quitando
`Origin`. `EventSource` envía `Origin` siempre, así que sin la segunda entrada
el `GET` recibiría `403` en el 5173. http-proxy encadena la respuesta sin
almacenarla, y ni Vite ni el backend comprimen, así que los frames llegan según
se escriben.

---

## 7. Lo que queda nombrado para después

- **Reanudar un plan tras recargar la página.** Hoy el issue vive en memoria
  de React; una recarga lo pierde. Hace falta un endpoint que liste los planes
  vigilados, o guardar el issue en el navegador. Se decide cuando exista el
  endpoint.
- **Lo del §7 del primer diseño** sigue en pie: el test de frontera con el
  `ApiServer` real, y las librerías de la casa.
