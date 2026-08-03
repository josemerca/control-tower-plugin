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
  entryPoints: ['hooks/session-start.js', 'hooks/stop.js'],
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
// valor es `undefined`, y sin ella lanzarían las dos llamadas de abajo
// —`realpathSync(undefined)` con ENOENT y `pathToFileURL(undefined)` con
// ERR_INVALID_ARG_TYPE— en vez de limitarse a no construir.
//
// `realpathSync` NO es cosmético, y esta comparación falla EN ABIERTO sin él:
// `process.argv[1]` conserva la ruta TAL COMO SE INVOCÓ, mientras que
// `import.meta.url` la trae siempre con los symlinks ya resueltos. Si el repo
// se alcanza por una ruta que atraviesa un symlink, las dos cadenas difieren,
// la condición sale falsa y `npm run build` NO CONSTRUYE NADA Y SALE 0 — un
// fallo silencioso que deja al desarrollador en bucle, porque el test de
// coherencia le pedirá un rebuild que el build se niega a hacer sin decirlo.
// Medido: argv1 = .../sym/scripts/build.mjs frente a import.meta =
// file:///.../real/scripts/build.mjs. No lo "simplifiques" quitándolo.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await build(buildOptions)
}
