// F8 — el borrado del directorio temporal de un test es HIGIENE, no una
// aserción, y no puede tumbar un test que ya había pasado.
//
// Observado (main @ b0799f3, con otra suite de vitest corriendo a la vez):
//
//   Error: ENOTEMPTY, Directory not empty: /var/folders/…/ct-next-sig-jUC9MS
//    ❯ __tests__/ct-next-signal-interrupt.test.js:42:35
//
// Causa: cuando ct-next.mjs mata a un hijo con SIGKILL (su cota de tiempo), el
// SIGKILL alcanza al hijo pero NO a sus nietos — los stubs de `gh` que ese hijo
// había lanzado siguen vivos unos milisegundos más, y siguen escribiendo en los
// ficheros de log del directorio temporal que el `afterEach` está borrando en
// ese mismo instante. `rmSync` recorre el árbol, borra, y al intentar quitar el
// directorio se lo encuentra otra vez con contenido. `force: true` NO cubre
// esto: solo ignora "no existe", no "alguien acaba de crear algo aquí".
//
// No hay handshake posible con un proceso al que ya nadie tiene un descriptor:
// son nietos huérfanos por definición. Y no hay nada que ganar reintentando
// para siempre — el directorio vive bajo `os.tmpdir()`, así que un residuo se
// lo lleva el sistema. Lo único que importa es que un fallo de LIMPIEZA no se
// presente como un fallo del código bajo prueba.
//
// (Nota colateral sobre el producto, no sobre los tests: que el SIGKILL de
// ct-next.mjs no alcance a los nietos significa que un `gh issue edit` lanzado
// por dispatch-check puede completarse DESPUÉS de que ct-next haya dado al hijo
// por muerto. El mensaje de ct-next ya dice exactamente eso — "no se puede
// saber si el claim llegó a escribirse" — así que el producto no miente; pero
// conviene que quede escrito dónde se observó.)
import { rmSync } from 'node:fs'

export function rmSyncBestEffort(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
  } catch {
    // Residuo bajo os.tmpdir(): irrelevante para el veredicto del test.
  }
}
