# El gate de conformidad de alcance (`ct-scope-gate`)

> Movido desde `plugin/templates/scope-gate.yml` (sub-issue #93). La plantilla no la copiaba ningún código —`ct-init` no la vendoriza y ningún hook la importa—, así que viajaba en cada instalación del plugin sin que nadie la leyera desde ahí. El workflow se instala a mano, y el sitio de una instrucción que se sigue a mano es la documentación del repo, no el paquete que se distribuye. El bundle que ejecuta, `plugin/dist/scope-check.js`, sigue construyéndose y trackeado como siempre (`plugin/scripts/build.mjs`, `plugin/__tests__/dist-coherente-con-fuentes.test.js`).

El contenido, íntegro:

```yaml
# Gate de conformidad de alcance — Control Tower loop
#
# QUÉ HACE: falla el PR si toca ficheros FUERA del alcance que su epic declaró
# en la línea `Alcance:` de `## Contexto del epic`.
#
# POR QUÉ VIVE AQUÍ Y NO EN EL PLUGIN: el agente despachado corre con las
# credenciales de GitHub del operador, así que puede fabricar cualquier
# artefacto de GitHub — una review, una aprobación, un comentario de
# autorización. Su registro es prosa que nadie contrasta. Lo que NO puede
# falsificar sin que se vea es qué ficheros tocó. Este check juzga ese hecho.
#
# POR QUÉ NO EN `dispatch-check --release`: ese lo invoca el propio agente. Un
# guard que ejecuta el sospechoso no es un guard.
#
# CÓMO SE INSTALA:
#   1. Copia este fichero a `.github/workflows/ct-scope-gate.yml`.
#   2. Copia el bundle `dist/scope-check.js` del plugin a `.github/ct/scope-check.js`
#      (es autocontenido: no necesita el plugin ni node_modules en CI).
#   3. Añade `ct-scope-gate` como REQUIRED CHECK en la protección de la rama por
#      defecto. Sin ese paso el check se ve rojo pero deja mergear — y depender
#      de que un humano mire es justo el fallo que este gate viene a cerrar.
#
# AJUSTA `--exempt` a la contabilidad propia de tu repo (un ledger, una
# bitácora): ficheros que TUS convenciones obligan a tocar en cada slice. Las
# exenciones del propio loop (`docs/superpowers/plans/**` y
# `docs/superpowers/specs/**`) ya vienen de serie y no hay que repetirlas.
name: ct-scope-gate

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

# Solo lectura: este workflow no escribe nada en el repo ni en el PR. Su único
# producto es su propio estado (verde/rojo).
permissions:
  contents: read
  pull-requests: read
  issues: read

jobs:
  scope:
    name: ct-scope-gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Comprobar que el PR cabe en el alcance de su epic
        env:
          # `gh` usa este token. Con `permissions` de solo lectura, el propio
          # workflow no puede ampliarse los permisos desde el PR.
          GH_TOKEN: ${{ github.token }}
        run: |
          node .github/ct/scope-check.js \
            --repo "${{ github.repository }}" \
            --pr "${{ github.event.pull_request.number }}"
```
