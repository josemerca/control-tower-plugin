# frontend/ — el front de la torre de control

La interfaz web que consume la API de `backend/`. Nace en este repo — repo
único, sin subtree: la decisión de 2026-09-01 que registra la nota de
divergencia en `docs/superpowers/specs/2026-08-31-fusion-con-app-companion-design.md`.
El diseño del front, endpoint a endpoint, está en
`docs/superpowers/specs/2026-09-02-frontend-primer-endpoint-design.md` (el
arranque), `docs/superpowers/specs/2026-09-02-frontend-plan-events-design.md`
(el progreso) y `docs/superpowers/specs/2026-09-03-frontend-implement-plan-design.md`
(la implementación).

Vite + React 19 + TypeScript. Hoy una pantalla sobre tres endpoints: la clave
del ticket, el repositorio y la ruta del clon local, un botón que llama a `POST /start-plan`, el
progreso del plan que llega por `GET /plan-events/:issue` (Server-Sent Events)
y, cuando el plan está listo, un botón que llama a `POST /implement-plan`.

## Lo que ya está decidido

- **Nunca se distribuye con el plugin.** El `source` del marketplace es
  `./plugin` y este directorio queda fuera de toda instalación; aquí las
  dependencias npm son legítimas.
- **Lo sirve `backend/`, en el mismo origen.** `ct-api.mjs` sirve `dist/` en
  `/` cuando existe, así que página y API comparten `http://127.0.0.1:<puerto>`.
  La API rechaza con `403` cualquier `Origin` que no sea el suyo propio, con
  `Host` de loopback: una página ajena no puede llamar a `POST /start-plan`, y
  la nuestra sí, sin CORS ni preflight.
- **El cliente es `fetch` sin envoltorio** (`src/app/start-plan/client.ts`,
  `src/app/implement-plan/client.ts`) y `EventSource` nativo para el flujo de
  eventos (`src/app/plan-events/client.ts`).
  Las librerías de la casa esperan a que CI tenga acceso al registry privado.

## El aspecto: design system de logística

La pantalla sigue el design system de logística (`mercadona/mo.staff-design`).
El paquete real vive en el Verdaccio privado y CI no lo alcanza, así que hasta
que el repo se mude a la organización:

- `src/system-ui/theme/` es una **copia literal** del tema del paquete (tokens,
  Open Sans, clases `lg-*`). No se edita; `VENDORED.md` dice cómo refrescarlo.
- `src/system-ui/{button,input,form-field,banner,top-bar,panel}` son
  **espejos** de los componentes de `logistics-ui`, con sus mismos tokens y un
  subconjunto de sus props. El día que entre el paquete, cambia el import.
- Los tokens viven bajo `[data-ds='logistics']`; el `<html>` lleva ese
  atributo y `data-theme`, que `Theme.followSystemPreference()` fija desde la
  preferencia del sistema (claro u oscuro) y sigue si cambia.

## Desarrollo

```bash
make run-frontend        # desde la raíz: instala, construye dist/ y arranca el backend sirviéndolo
make dev-frontend        # vite en el 5173 con proxy a la API (arranca antes `make run-backend`)
make test-frontend
```

O dentro de `frontend/`: `npm ci`, `npm test`, `npm run build`, `npm run dev`.

El proxy de `vite.config.ts` reenvía `/start-plan`, `/plan-events` e
`/implement-plan` y quita
la cabecera `Origin` de lo que reenvía: sin ella el backend trata la petición
como cliente no-navegador. Es una
excepción de desarrollo; en producción la página sale del propio backend.

## Convenciones

Las de la skill `frontend-engineering` (sin punto y coma, exports con nombre,
imports absolutos desde `src/`, un componente por fichero, BEM) más la vara
que `__tests__/yardstick.test.ts` mide en cada fichero: nombres en inglés,
cero prosa en comentarios, ningún `export default` salvo el que Vite exige en
su config, y ningún import que trepe con `../`. Las etiquetas de la interfaz
van en castellano; todo lo demás, en inglés.
