// F8 — HANDSHAKE EXPLÍCITO PARA LOS STUBS, EN VEZ DE UNA VENTANA DE TIEMPO.
//
// Varios tests necesitan que el proceso bajo prueba esté PARADO en un punto
// concreto mientras el arnés hace algo (típicamente: mandarle una señal).
// Hasta F8 eso se conseguía haciendo que el stub durmiera una cantidad fija de
// milisegundos (FAKE_GH_EDIT_DELAY_MS, FAKE_GIT_WORKTREE_ADD_DELAY_MS,
// CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS) y confiando en que el arnés llegara a
// tiempo dentro de esa ventana.
//
// Eso es una carrera, no una sincronización. La ventana la fija un número
// escrito a mano; quien tiene que llegar a tiempo es un proceso de node que
// compite por CPU con el resto de la suite (y con lo que sea que esté
// corriendo en la máquina). Con la máquina ociosa el arnés reacciona en
// milisegundos y la ventana de 2000ms parece infinita; con carga, el mismo
// arnés puede no ser planificado en varios segundos y la ventana se cierra
// sola. Es exactamente el mismo error de razonamiento que este proyecto ya
// desterró del protocolo de claim cuando retiró el "settle".
//
// `waitForReleaseFile` invierte la responsabilidad: el stub se PARA y no
// continúa hasta que el propio test le dice que puede, creando un fichero
// centinela. El test ya no tiene que llegar a tiempo a ningún sitio — el
// proceso bajo prueba le espera a él, tarde lo que tarde.
//
// El tope de tiempo que sí queda (`capMs`) NO es sincronización: es un
// rescate para que un test mal escrito (que nunca cree el centinela) falle
// ruidosamente en vez de colgar el runner para siempre. Por eso sale con un
// código distintivo y escribe en stderr en vez de seguir como si nada: un
// stub que continuara en silencio al agotarse el tope reintroduciría, sin
// avisar, justo la carrera que este fichero existe para quitar.
import { existsSync } from 'node:fs'

export const RELEASE_FILE_TIMEOUT_EXIT = 97

export function waitForReleaseFile(varName, capMs = 120_000) {
  const path = process.env[varName]
  if (!path) return
  const deadline = Date.now() + capMs
  // Espera BLOQUEANTE de verdad (Atomics.wait sobre un SharedArrayBuffer):
  // estos stubs son procesos síncronos de arriba abajo, y lo que tienen que
  // simular es un binario que todavía no ha vuelto.
  const sab = new Int32Array(new SharedArrayBuffer(4))
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      console.error(`stub: ${varName}: el centinela "${path}" no apareció en ${capMs}ms — el test nunca lo creó. Se aborta en vez de continuar (continuar en silencio devolvería la carrera de temporización que este handshake quita).`)
      process.exit(RELEASE_FILE_TIMEOUT_EXIT)
    }
    Atomics.wait(sab, 0, 0, 5)
  }
}
