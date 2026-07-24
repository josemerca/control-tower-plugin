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

await build({
  entryPoints: ['hooks/session-start.js', 'hooks/stop.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
})
