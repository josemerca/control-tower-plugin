# frontend/ — el front de la torre de control

La interfaz web que consume la API de `backend/`. Nace en este repo — repo
único, sin subtree: la decisión de 2026-09-01 que registra la nota de
divergencia en `docs/superpowers/specs/2026-08-31-fusion-con-app-companion-design.md`.

Hoy es un hueco preparado: `package.json` privado sin dependencias y el
`.gitignore` de rigor. La elección de framework se toma al arrancar el
desarrollo del front, no antes.

## Lo único que ya está decidido

- **Nunca se distribuye con el plugin.** El `source` del marketplace es
  `./plugin` y este directorio queda fuera de toda instalación; aquí las
  dependencias npm son legítimas.
- **Lo sirve `backend/`, en el mismo origen.** `ct-api.mjs` sirve el
  contenido de `frontend/dist/` en `/` cuando ese directorio existe, así que
  página y API comparten `http://127.0.0.1:<puerto>`. La API rechaza con
  `403` cualquier `Origin` que no sea el suyo propio, con `Host` de loopback:
  una página ajena no puede llamar a `POST /start-plan`, y la nuestra sí sin
  CORS ni preflight.
- **Habla con `backend/` por HTTP.** El primer endpoint ya existe:
  `POST /start-plan` (`backend/src/infrastructure/api-server.js`).
