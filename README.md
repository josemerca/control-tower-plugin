# control-tower-plugin — el repo único

Tres piezas, un repo, y solo una de ellas se distribuye:

| Directorio | Qué es | ¿Se distribuye? |
|---|---|---|
| [`plugin/`](plugin/) | El plugin **control-tower-loop** de Claude Code: el loop entero (hidratación, gates, dispatch, jueces) y su suite | **Sí** — es el `source` del marketplace |
| [`backend/`](backend/) | La API HTTP local que la interfaz consume (`POST /start-plan`, `GET /plan-events/:issue`, `POST /implement-plan`); además barre el checkout cada minuto y cosecha con `dispatch-check --collect` lo que dejó cada slice cuya PR ya se mergeó | No |
| [`frontend/`](frontend/) | El front que consume esa API | No |

La unidad de distribución de un plugin es el directorio `source` de
`.claude-plugin/marketplace.json`, entero y sin mecanismo de exclusión. Por eso
el plugin vive en un subdirectorio: lo que queda fuera de `plugin/` no llega
jamás a una instalación, y `backend/` y `frontend/` pueden tener dependencias
npm sin imponérselas a ningún repo gobernado. Un test lo vigila
(`plugin/__tests__/manifest.test.js`): si el `source` vuelve a `"./"`, falla.

La documentación del plugin está en [`plugin/README.md`](plugin/README.md).
El diseño de la fusión con la app companion, con su nota de divergencia, en
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Instalar el plugin

```
/plugin marketplace add josemerca/control-tower-plugin
/plugin install control-tower-loop@control-tower
```

## Desarrollar

Cada pieza es un paquete npm independiente, con su lockfile y su suite:

```
cd plugin  && npm ci && npm test    # build de los hooks + ~3.000 tests
cd backend && npm ci && npm test    # la API y su vara
```

CI corre las dos por separado (`.github/workflows/continuous-integration.yml`).

Y un `Makefile` en la raíz las junta sin sustituirlas. Cada objetivo nombra
su paquete: `make test-backend`, `make build-frontend`, `make run-backend`…
y `make run-frontend` construye el front y arranca el backend sirviéndolo en
`http://127.0.0.1:8787/`. `make help` lista los objetivos.
