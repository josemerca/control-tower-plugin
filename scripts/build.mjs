// Bundlea los hooks (session-start.js, stop.js) en dist/*.js, autocontenidos
// (sin dependencias npm en runtime; solo imports node:*).
//
// El banner `createRequire` de abajo es IMPRESCINDIBLE, no cosmético:
// la librería `yaml` usa internamente un `require()` de CommonJS. Al
// bundlear en formato ESM, ese `require` no existe de forma nativa en un
// módulo ESM (no hay `require` global) y el bundle revienta en runtime
// con "require is not defined". El shim `createRequire(import.meta.url)`
// reconstruye un `require` válido dentro del bundle para que la parte
// inlineada de `yaml` seguir funcionando. Si quitas el banner, los hooks
// compilan pero fallan al ejecutarse. Ver __tests__/bundle.test.js, que
// verifica que el bundle resultante solo importa builtins `node:*`.
import { build } from 'esbuild'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// buildOptions se exporta (F24) para que haya UNA sola fuente de verdad de la
// configuración de build: quien necesite reconstruir los fuentes y comparar el
// resultado con el `dist/` commiteado la importa de aquí en vez de llevar su
// propia copia, que se quedaría atrás en silencio y daría por buena una
// configuración que ya no es la del proyecto.
export const buildOptions = {
  entryPoints: ['hooks/session-start.js', 'hooks/stop.js', 'hooks/commit-keyword-guard.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
}

// Construye solo al EJECUTARSE (`npm run build`), nunca al importarse — el
// test importa este módulo y no debe disparar un build como efecto colateral.
// La guarda de `process.argv[1]` no es defensiva de más: bajo `node -e` ese
// valor es `undefined`, y sin ella lanzaría `realpathSync(undefined)` con
// ENOENT —y, si no estuviese ese, `pathToFileURL(undefined)` con
// ERR_INVALID_ARG_TYPE— en vez de limitarse a no construir.
//
// `realpathSync` NO es cosmético: sin él la comparación falla EN ABIERTO —no
// construye nada y sale 0— cuando la ruta que Node acaba resolviendo para
// `argv[1]` atraviesa un symlink. `argv[1]` conserva la ruta TAL COMO SE
// INVOCÓ; `import.meta.url` llega, POR DEFECTO, con los symlinks ya resueltos.
//
// No lo dispara cualquier symlink, y conviene saber cuál. Medido en macOS con
// Node 25, sin este `realpathSync`:
//   - `cd` a un symlink del repo y ruta RELATIVA (`node scripts/build.mjs`,
//     que es justo lo que hace `npm run build`): SÍ construye. Node resuelve
//     lo relativo contra el cwd FÍSICO —`process.cwd()` ya viene con los
//     symlinks resueltos—, así que las dos cadenas coinciden.
//   - ruta ABSOLUTA que pasa por el symlink: NO construye.
//   - `scripts/build.mjs` siendo él mismo un symlink: NO construye, y este
//     caso sí muerde al `npm run build` de toda la vida.
// Los dos últimos son el fallo silencioso que deja al desarrollador en bucle:
// el test de coherencia le pide un rebuild que el build se niega a hacer sin
// decirlo. Con `realpathSync`, los tres construyen.
//
// Dos límites conocidos y aceptados. Bajo `--preserve-symlinks-main`
// —flag que `npm run build` no usa— `import.meta.url` NO resuelve los
// symlinks, el desajuste se invierte y este arreglo deja de casar; comprobado:
// exit 0 sin construir. Y si `argv[1]` fuese truthy apuntando a algo
// inexistente, `realpathSync` lanzaría ENOENT donde antes simplemente no se
// construía; no lo alcanza ninguna invocación real de node/npm/vitest, porque
// cuando `argv[1]` está definido el fichero existe.
// No lo "simplifiques" quitándolo.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await build(buildOptions)
}
