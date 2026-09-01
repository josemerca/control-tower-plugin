// Parseo ESTRICTO de argumentos numéricos de línea de comandos (D4, defecto
// 2). Existe como módulo propio, y no duplicado en cada wrapper, porque el
// bug que arregla es exactamente el de dos sitios que interpretan el MISMO
// tipo de valor con criterios distintos: `ct-next.mjs --cap` y el `<issue#>`
// posicional de `dispatch-check.mjs` usaban ambos `parseInt(x, 10)`, que es
// un parser TOLERANTE — se traga el prefijo numérico y descarta el resto en
// silencio:
//
//   parseInt('1e3', 10)     === 1     (el usuario pidió 1000)
//   parseInt('3perros', 10) === 3
//   parseInt('2.9', 10)     === 2
//   parseInt(' 3', 10)      === 3
//   parseInt('+2', 10)      === 2
//
// Verificado por construcción contra el código sin arreglar: `--cap 1e3`
// despachaba UN slice, `--cap 3perros` despachaba TRES, y `--cap 2.9`
// despachaba DOS — sin una sola línea de aviso en ninguno de los tres casos.
// Un cap silenciosamente MÁS BAJO se lee como "el dispatcher no encuentra
// trabajo"; uno más alto lanza agentes de más. En dispatch-check.mjs el
// mismo patrón es peor: `dispatch-check.mjs 42x` reclamaría el issue 42 —
// mutando un issue REAL que el usuario no nombró.
//
// `Number(x)` tampoco sirve tal cual: es fiel con la basura de cola
// (`Number('3perros')` es NaN) pero acepta formas que un argumento entero de
// CLI no debería aceptar y que cambian el valor de forma no obvia —
// `Number('1e3')` es 1000 (correcto, pero nadie escribe eso a propósito en
// un --cap), `Number('0x10')` es 16, `Number(' 3 ')` es 3, y `Number('')` es
// 0. La regla aquí es la más estrecha posible: SOLO dígitos decimales, sin
// signo, sin espacios, sin exponente, sin punto, sin base alternativa.
// Cualquier otra cosa es `null` — nunca un número "parecido".
//
// D5, hallazgo I — POR QUÉ SE RECHAZA TAMBIÉN EL SIGNO (antes el regex era
// `/^[+-]?\d+$/`). D4 aceptó `+2` a propósito, con el criterio "¿el valor
// diverge de lo que el usuario escribió?" — y `+2` es fielmente 2, así que
// no divergía. Pero los TRES call-sites de este módulo prometen, en el
// texto de su propio error, "dígitos decimales a secas" / "dígitos a
// secas": `--cap` de ct-next.mjs, `--project` de ct-groom.mjs y el
// `<issue#>` de dispatch-check.mjs. `+2` no es eso, y se aceptaba igual —
// es decir, el mensaje afirmaba una regla y el código aplicaba otra, que es
// exactamente la familia de defectos que esta tanda de trabajo persigue.
// Verificado por construcción antes del cambio: `--cap +2` salía con exit 0
// y despachaba con cap 2, y `--project +7` pasaba la validación.
//
// Se rechaza el signo ENTERO, no solo el `+`: un `-1` tampoco es "dígitos
// decimales a secas", y ninguno de los tres call-sites admite un valor
// negativo (los tres exigen >= 1). Consecuencia deliberada: `--cap -1` deja
// de dar el mensaje de RANGO ("debe ser >= 1") y pasa a dar el de FORMA —
// el `0`, que sí es una forma válida fuera de rango, sigue dando el de
// rango, así que la distinción entre los dos mensajes (que D4 introdujo a
// propósito) se conserva donde de verdad significa algo.
//
// El rango (>= 1, etc.) NO se decide aquí a propósito: un valor bien
// formado pero fuera de rango merece un mensaje distinto ("debe ser >= 1")
// del de un valor que ni siquiera es un número ("no es un entero"), y solo
// el call-site conoce su propio rango.
const STRICT_INT_RE = /^\d+$/

export function parseStrictInt(raw) {
  if (typeof raw !== 'string') return null
  if (!STRICT_INT_RE.test(raw)) return null
  const n = Number(raw)
  // Number.isSafeInteger (no solo Number.isInteger): '99999999999999999999'
  // pasa el regex y `Number(...)` lo redondea a 100000000000000000000 — un
  // valor DISTINTO del que el usuario escribió, que es justo la clase de
  // divergencia silenciosa que este módulo existe para impedir.
  if (!Number.isSafeInteger(n)) return null
  return n
}
