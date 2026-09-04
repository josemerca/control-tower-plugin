# El front, endpoint a endpoint — implementar el plan sobre `POST /implement-plan`

**Fecha:** 2026-09-03
**Repo:** `josemerca/control-tower-plugin`, directorio `frontend/`
**Estado:** diseño ejecutado en la misma PR — el tercer slice vive en `frontend/`
**Alcance:** un componente nuevo, y un hueco en el componente del segundo slice

---

## 1. Qué se construye

El backend publica su tercer endpoint: `POST /implement-plan`. Recibe el
`agent` que devolvió `POST /start-plan` y el número del `issue`, y pide a ese
mismo agente que implemente el plan que acaba de escribir. Este slice trae su
componente: **`ImplementPlanAction`**, un botón «Implementar plan» que aparece
sólo cuando `PlanProgress` dice «Plan listo», y que enseña el resultado de la
llamada.

La página ya tiene todo lo que el endpoint pide: el `agent` y el `issue` llegan
en el `202` del arranque y viven en el `StartedPlan` que guarda `Home`. No hay
formulario nuevo; sólo el botón.

---

## 2. El contrato, copiado del backend

Fuente: `backend/src/infrastructure/implement-plan-route.js` y
`backend/__tests__/infrastructure/implement-plan-route.test.js`.

Petición: `Content-Type: application/json`, cuerpo `{"agent":"workspace:4","issue":7}`.
Los dos campos son obligatorios. `agent` es una cadena sin espacios; `issue` es
un **número** JSON, entero, desde uno. Cualquier otro campo se rechaza.

> **Nota (2026-09-04):** se revisó el contrato contra
> `backend/src/infrastructure/implement-plan-route.js` y `repo` es un tercer
> campo obligatorio (cuerpo real: `{"agent":…,"issue":…,"repo":…}`). El
> frontend enviaba sólo `agent` e `issue` y el backend lo rechazaba con
> `400`. Se corrigió el frontend para enviar los tres campos.

| Código | Cuerpo | Cuándo |
|---|---|---|
| `202` | `{"status":"implementing","agent":"workspace:4","issue":7}` | el agente recibió la orden |
| `400` | `{"error":"agent must be the handle start-plan answered with"}` | agent mal formado |
| `400` | `{"error":"issue must be a whole number from one"}` | issue mal formado |
| `400` | `{"error":"unknown field: …"}` | un campo que el contrato no declara |
| `400` | `{"error":"body must be a JSON object"}` | el cuerpo no es un objeto JSON |
| `503` | `{"error":"could not implement the plan: cmux send failed: no such workspace"}` | el agente no se pudo reanudar (`PlanAgentNotResumed`) |
| `403` | — | origen ajeno, como en las otras rutas |

El texto tras `could not implement the plan: ` es el mensaje de la causa; el
que lleva la Mother es el literal que usa el test del backend.

---

## 3. Las decisiones

- **Misma forma de cliente que `start-plan`.** `app/implement-plan/client.ts`
  es un objeto con nombre y un método `implement({ agent, issue })` que hace
  `fetch` a una ruta relativa y devuelve un resultado discriminado:
  `implementing`, `refused` (con el `error` del backend tal cual) o
  `backend-unreachable`. Nunca lanza.
- **`plan-events` no conoce `implement-plan`.** `PlanProgress` gana una prop
  opcional `whenReady?: ReactNode` y la pinta bajo su `Banner` sólo cuando la
  fase es `ready`. Es `Home` quien compone:
  `<PlanProgress plan={started} whenReady={<ImplementPlanAction plan={started} />} />`.
  Las tres features siguen sin importarse entre sí; la única que las junta es
  la página.
- **El botón desaparece al aceptar.** Un `202` sustituye el botón por una
  `Banner` de éxito. El backend no ofrece hoy forma de seguir la
  implementación, así que la página no promete más de lo que sabe.
- **Un rechazo deja el botón.** `400` o `503` pintan el texto del backend en
  una `Banner` de error con `role=alert` y el botón sigue habilitado, para
  reintentar.
- **El literal «No se pudo contactar con el backend» se repite** en el
  componente, como ya hacen `StartPlanForm` y `PlanProgress`. Tres copias
  locales antes que un módulo compartido de textos.

---

## 4. La pantalla y la copia

| Estado | Qué se ve |
|---|---|
| plan en `connecting` / `writing` / `failed` / `unreachable` | nada nuevo |
| plan `ready` | `Button` primario «Implementar plan», habilitado |
| petición en vuelo | el mismo botón, deshabilitado |
| `202` | `Banner` success, `role=status`: «Implementación arrancada» · «El agente `workspace:4` implementa el plan»; el botón ya no está |
| `4xx` / `5xx` | el botón habilitado + `Banner` error, `role=alert`, con el `error` del backend tal cual |
| fallo de red | el botón habilitado + `Banner` error, `role=alert`: «No se pudo contactar con el backend» |

Un nuevo clic tras un rechazo limpia la `Banner` anterior antes de enviar.

---

## 5. Tests

- **`ImplementPlanMother`** (`src/__scenarios__/`) lleva el cuerpo de la
  petición y los literales del `202`, un `400` y el `503`, copiados de los
  tests del backend.
- **Outside-in desde `Home`**, en `Home.implementPlan.test.tsx`: se arranca
  un plan con `StartPlanMother.started()`, se empuja `{"state":"ready"}` por
  el `FakeEventSource`, se cambia el doble de `fetch` por la respuesta de
  `/implement-plan` y se pulsa el botón. Cubre: el botón no está en `writing`
  y sí en `ready`; la URL, el método, las cabeceras y el cuerpo exactos; el
  `202` con el agente y sin botón; el `503` tal cual con el botón habilitado;
  el fallo de red; el botón deshabilitado mientras la petición está en vuelo.
- **`backendPending`** (`helpers.tsx`) es un doble de `fetch` que no responde
  hasta que el test lo pide. Sirve para mirar la pantalla en mitad de la
  petición.

---

## 6. Desarrollo local

`vite.config.ts` reenvía también `/implement-plan` al backend quitando
`Origin`, como las otras dos rutas. Con la página servida por el propio
backend (`make run-frontend`) no hace falta nada más.

---

## 7. Lo que queda nombrado para después

- **Seguir la implementación.** Hoy el `202` es el final de la historia en la
  página. Cuando el backend publique un flujo de progreso de la
  implementación, este componente lo escuchará como `PlanProgress` escucha
  `/plan-events`.
- **Lo del §7 de las dos notas anteriores** sigue en pie: reanudar tras
  recargar, el test de frontera con el `ApiServer` real, y las librerías de la
  casa.
