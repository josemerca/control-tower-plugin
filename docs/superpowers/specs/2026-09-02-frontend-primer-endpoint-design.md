# El front, endpoint a endpoint — la primera pantalla sobre `POST /start-plan`

**Fecha:** 2026-09-02
**Repo:** `josemerca/control-tower-plugin`, directorio `frontend/`
**Estado:** diseño ejecutado en la misma PR — el primer slice vive en `frontend/`
**Alcance:** una pantalla, un endpoint

---

## 1. Qué se construye, y cómo se avanza

`frontend/` deja de ser un hueco. Nace como aplicación web que consume la API
de `backend/`, y crece **endpoint a endpoint**: cada endpoint que el backend
publica trae su pantalla o su componente, en la misma cadencia de PR. No hay
un diseño de toda la interfaz por adelantado; hay una arquitectura que aguanta
que el siguiente endpoint entre sin reorganizar el anterior.

Hoy el backend publica un endpoint, así que el front tiene una pantalla:

> Un campo para la clave del ticket, un botón, y el resultado.

Nada más. No hay lista de sesiones, porque no hay endpoint que las liste, y un
estado local inventado por delante del backend envejece solo.

---

## 2. La frontera con el backend, ya resuelta

La PR #61 dejó el terreno preparado:

- `ct-api.mjs` sirve `frontend/dist/` en `/` cuando ese directorio existe.
  Página y API comparten el origen `http://127.0.0.1:<puerto>`.
- La API admite un `Origin` sólo si es exactamente `http://<Host>` y el `Host`
  es loopback. Cualquier otra página recibe `403`.

Consecuencias para el front:

- **Sin CORS, sin preflight, sin URL base.** El cliente llama a rutas
  relativas (`/start-plan`). El navegador pone el `Origin` correcto solo.
- **La build tiene que caer en `frontend/dist/`.** Es el único contrato entre
  los dos paquetes: un directorio.
- **El servidor de desarrollo de Vite es otro origen.** Con `vite dev` en el
  5173, todo `POST` llegaría con `Origin: http://localhost:5173` y el backend
  lo rechazaría. Ver §5.

### 2.1 El contrato de `POST /start-plan`, copiado del backend

Petición: `Content-Type: application/json`, cuerpo `{ "id": "ABC-123" }`. El
único campo admitido es `id`, y tiene que cumplir `^[A-Z][A-Z0-9_]*-\d+$`.

| Código | Cuerpo | Cuándo |
|---|---|---|
| `202` | `{"status":"started","id":"ABC-123","session":"workspace:4"}` | la sesión de cmux arrancó |
| `400` | `{"error":"id must be a ticket key such as ABC-123"}` | id mal formado |
| `400` | `{"error":"unknown field: …"}` / `{"error":"body must be a JSON object"}` | cuerpo mal formado |
| `403` | `{"error":"this api only serves the page it hosts"}` | origen ajeno |
| `413` | `{"error":"body must not exceed 8192 bytes"}` | cuerpo demasiado grande |
| `415` | `{"error":"Content-Type must be application/json"}` | media type incorrecto |
| `503` | `{"error":"could not start the plan session: …"}` | cmux falló |

Todo rechazo es un objeto con una sola clave `error`. Eso es lo que la
pantalla enseña cuando algo va mal: **el texto del backend, sin traducir ni
reinterpretar.** El front no inventa mensajes que el backend ya redacta.

---

## 3. Las decisiones

### 3.1 Stack: Vite + React 19 + TypeScript

Elegido por quien va a mantenerlo: el equipo trabaja con React y TypeScript, y
la skill `frontend-engineering` recoge sus convenciones. Para una pantalla es
más de lo necesario; para la quinta no. Elegirlo ahora evita una migración.

Lo que **no** entra todavía, aunque la skill lo nombre: las librerías de la
casa (`@mercadona/mo.library.web-services`, `mo.library.dashtil`, el sistema
de diseño `mo.library.gui-*`) y Unleash. Se consideraron y se aparcaron por un
motivo concreto, no por principio: salen del registry privado, y el job de CI
corre en un repo público de otra organización de GitHub. Instalarlas en CI
exige un secret con el token del registry volcado en `.npmrc` antes de
`npm ci`, y nadie lo ha creado. Hasta entonces el cliente HTTP es `fetch` sin
envoltorio y no hay feature flags. El día que exista el secret, entran en su
propio slice: el cliente de §4 está aislado en un fichero precisamente para
que ese cambio sea local.

### 3.2 Estructura: por feature, siguiendo la skill

```
frontend/
  index.html
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    app/
      start-plan/
        client.ts                  # StartPlanClient.start(ticketKey)
        StartPlan.types.ts         # StartPlanResult, StartPlanRefusal
        components/
          start-plan-form/
            StartPlanForm.tsx
            StartPlanForm.css
            index.ts
    pages/
      home/
        Home.tsx
        __tests__/
          Home.startPlan.test.tsx
    __scenarios__/
      StartPlanMother.ts           # los payloads literales del backend
```

Reglas de la skill que se adoptan tal cual: sin punto y coma, comillas
simples, exports con nombre y nunca `default`, imports absolutos desde `src/`,
`null` para la ausencia intencionada, sin `else`, un componente por fichero,
props tipadas como `<Componente>Props`, CSS colocado junto al componente con
clases BEM. Etiquetas de la interfaz en castellano; todo lo demás en inglés.

### 3.3 La vara: qué se hereda del backend y qué no

`backend/__tests__/yardstick.test.js` mide tres cosas en cada fichero:
nombres en inglés, cero prosa en comentarios, y **toda función colgando de una
clase**. Las dos primeras se heredan. La tercera **no**: un componente de React
es una función suelta por definición, y forzarlo a una clase sería pelear con
el framework para cumplir una regla que nació para otro paquete.

El front tendrá su propio `yardstick` con las dos reglas heredadas y las de la
skill que se pueden medir mecánicamente (sin `export default`, sin imports
relativos entre carpetas). No comparte código con el del backend: cada paquete
mide lo suyo, y la copia de la lista de palabras castellanas se vigila igual
que hoy la vigila el backend contra `plugin/`.

### 3.4 Tests: la frontera con el payload literal, no un modelo del payload

La regla del repo (`plugin/conventions/testing.md`): en una frontera se prueba
con el payload literal que se envía o recibe. Aplicado aquí:

- `StartPlanMother` contiene **las mismas cadenas** que devuelve el backend,
  copiadas de `backend/__tests__/infrastructure/api-server.test.js`. Si el
  backend cambia un texto, hay que cambiarlo en dos sitios, y eso es lo que se
  quiere: que el cambio de contrato se vea.
- Los tests de la pantalla son **outside-in**: se renderiza `Home`, se escribe
  en el campo, se pulsa, y se comprueba lo que el usuario ve. La red se
  intercepta a nivel de `fetch` con los payloads de la Mother. Testing Library
  y `user-event`; `wrapito` sólo si su interceptor de red aporta algo sobre un
  `fetch` falso, que para un endpoint no aporta.
- Un test comprueba **el payload que sale**: método `POST`, ruta `/start-plan`,
  `Content-Type: application/json`, cuerpo exactamente `{"id":"ABC-123"}`. Es
  la mitad de la frontera que sólo el front puede vigilar.

**Lo que este diseño no hace:** levantar el `ApiServer` real desde los tests
del front. Sería la prueba más fuerte, pero acopla las dos instalaciones de
`node_modules` y los dos jobs de CI. Queda nombrado como slice futuro (§7).

### 3.5 La pantalla

Un formulario, tres estados.

| Estado | Qué se ve |
|---|---|
| Reposo | Campo «Clave del ticket» con placeholder `ABC-123`, botón «Arrancar plan» |
| Enviando | Botón deshabilitado, campo bloqueado. Sin spinner: la respuesta del backend es inmediata (cmux abre la ventana y responde) |
| Resultado | Éxito: «Sesión arrancada: `workspace:4`». Rechazo: el texto de `error` del backend. Red caída: «No se pudo contactar con el backend» |

Detalles que sí importan:

- El campo valida la forma de la clave **en el navegador**, con el mismo patrón
  que `TicketKey`, para que el botón no se habilite con `abc-1`. Pero la
  autoridad es el backend: si el patrón divergiera, gana el `400` y se enseña.
- La región del resultado lleva `aria-live="polite"`: quien no ve la pantalla
  se entera igual.
- Tras un `202`, el campo **no se vacía**. La clave sigue ahí por si el usuario
  quiere arrancar otra sesión del mismo ticket o corregirla.

---

### 3.6 El aspecto: el design system de logística, vendido a mano

La pantalla sigue el **design system de logística** de Mercadona
(`staff-design.prod.monline/logistica`, repo `mercadona/mo.staff-design`,
paquete `@mercadona/mo.library.logistics-ds`). El paquete y su peer
`mo.library.icons` viven en el Verdaccio privado, que resuelve a una IP interna:
un desarrollador lo alcanza, un runner de GitHub no, con token o sin él. Hay
planes de mudar el repo a la organización; hasta entonces **los paquetes no
entran** y el aspecto se reproduce a mano:

- **El tema, copiado literal.** `src/system-ui/theme/` es una copia de
  `packages/logistics-ui/src/theme/` (commit `466bfd3`): tokens primitivos y
  semánticos, radios, tamaños, elevación, layout, Open Sans autoalojada y las
  clases de tipo `lg-*`. Son ficheros generados con cabecera `READONLY`; no se
  editan. `VENDORED.md` dice de dónde salen y cómo refrescarlos.
- **Los componentes, espejo.** `Button`, `Input`, `FormField`, `Banner`,
  `TopBar` y `Panel` en `src/system-ui/` reproducen la geometría y los tokens de
  logistics-ui con CSS plano BEM (la skill manda CSS colocado, no módulos). Sus
  props son un **subconjunto** de las del paquete real: nada que el paquete no
  tenga, para que el cambio sea un import cuando llegue.
- **Los cuatro iconos de estado** (`StatusIcons.tsx`) se extrajeron del bundle
  del propio sitio del design system, con `fill` en `currentColor` para que
  hereden el color del tipo del banner.
- **El scope.** Los tokens viven bajo `[data-ds='logistics']` y el modo oscuro
  bajo `[data-theme='dark']`; los dos atributos van en el `<html>`, y
  `Theme.followSystemPreference()` fija `data-theme` desde
  `prefers-color-scheme` y lo sigue si cambia con la página abierta.
- **La página**, como el DS prescribe para una aplicación de un solo destino:
  `TopBar` con el nombre del producto y sin menú lateral, contenido centrado a
  `--layout-container-sm` (640 px), y un `Panel` con el `h1` de la pantalla
  envolviendo el formulario. El resultado es un `Banner` `success` (rol
  `status`) o `error` (rol `alert`, con el texto del backend tal cual).

## 4. El cliente

```ts
type StartPlanResult = { status: 'started'; id: string; session: string }
type StartPlanRefusal = { error: string }

const start = (ticketKey: string): Promise<StartPlanOutcome>

export const StartPlanClient = { start }
```

Sigue el patrón de la skill: `client.ts` en la feature, un objeto con nombre
y métodos flecha. Por debajo, `fetch` (§3.1). Cuando entren las librerías de
la casa, este fichero es el único que cambia.

Dos ajustes al patrón, por el contrato de este backend:

- **Sin barra final.** La skill pide `/products/`; este backend declara
  `/start-plan` sin barra, y el cliente escribe la ruta como está declarada.
- **`start` no lanza por un rechazo HTTP.** Un `400` o un `503` son respuestas
  del contrato, no excepciones: se devuelven como outcome discriminado. Sólo un
  fallo de red (el `fetch` que rechaza) se traduce a `backend-unreachable`. La
  pantalla hace `switch` sobre el outcome y no toca códigos HTTP.

---

## 5. Desarrollo local

Dos modos, y los dos acaban en el mismo backend.

**Con recarga en caliente:** `vite dev` en el 5173 con un `server.proxy` que
reenvía `/start-plan` a `http://127.0.0.1:8787` y **quita la cabecera
`Origin`** de la petición reenviada. Sin `Origin` el backend trata la petición
como cliente no-navegador y la acepta. Es una excepción de desarrollo, vive en
`vite.config.ts` y no existe en producción, donde la página sale del backend.

**Como en producción:** `vite build` deja `frontend/dist/` y `node
backend/src/infrastructure/ct-api.mjs` lo sirve en `http://127.0.0.1:8787/`.
Es el modo con el que se prueba antes de abrir una PR.

---

## 6. CI

Un cuarto job `frontend` en `continuous-integration.yml`, simétrico al de
`backend`: `working-directory: frontend`, caché sobre su lockfile, `npm ci`,
`npm test`, y además `npm run build` para que una build rota no llegue a
`main`. El job `ci` que agrega resultados lo añade a su `needs`.

---

## 7. Lo que queda nombrado para después

- **Un test de frontera con el `ApiServer` real** (§3.4), cuando merezca su
  coste de CI.
- **El siguiente endpoint.** Cuando exista, su pantalla o componente entra en
  `src/app/<feature>/` con la misma estructura, y `Home` compone. Si dos
  features necesitan compartir estado, entonces —y no antes— se decide cómo.
- **Las librerías de la casa y Unleash** (§3.1), cuando el repo se mude a la
  organización y CI alcance el Verdaccio. Entran juntas en un slice:
  `services/http`, `@mercadona/mo.library.logistics-ds` en lugar de
  `src/system-ui/` (§3.6), y `services/feature-flags/constants.ts`.
- **Instalación para el desarrollador: resuelta con el `Makefile` de la raíz.**
  `make run-frontend` instala y construye el front y arranca el backend
  sirviéndolo; `make dev-frontend` levanta Vite con el proxy de §5. Lo que queda es que existan los
  scripts `build` y `dev` en `frontend/package.json`, cosa del primer slice.

---

## 8. Lo que este diseño no hace, a propósito

- No añade routing. Una página.
- No persiste nada en el navegador.
- No toca `backend/` ni `plugin/`.
