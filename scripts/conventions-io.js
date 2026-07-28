// Capa de IO de scripts/conventions.js: leer los documentos del repo destino y
// leer el acuse. Vive aparte para que conventions.js siga siendo lógica pura
// (testeable sin disco) y para que ct-init (vía detect-conventions.mjs) y
// ct-next lean EXACTAMENTE lo mismo. Que el bootstrap y el despacho miren
// conjuntos de ficheros distintos es cómo se llega a "en /ct-init salía y en
// /ct-next no", que es peor que no avisar.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, relative, sep, isAbsolute } from 'node:path'
import { ACK_PATH, linkedDocPaths, parseAcks } from './conventions.js'

export { ACK_PATH }

// Los documentos donde vive la instrucción que el agente despachado va a leer
// al hidratarse. Son la PUERTA: lo que ellos declaran canónico se sigue un salto.
export const ROOT_DOC_NAMES = ['AGENTS.md', 'CLAUDE.md']

// Cotas del salto. Un repo puede tener AGENTS.md con treinta enlaces y un
// documento de 4 MB; ni /ct-init ni un despacho pueden pagar eso. Se corta y se
// DICE que se ha cortado — un escaneo incompleto presentado como completo es la
// misma mentira que el silencio.
export const MAX_LINKED_DOCS = 20
export const MAX_DOC_BYTES = 512 * 1024

function readDoc(root, rel) {
  // Ni salirse del repo ni seguir un symlink que salga: `docs/x.md → /etc/...`
  // no es documentación de este repo, y leerlo sería mirar donde no toca.
  // La raíz se resuelve a su ruta REAL antes de comparar: en macOS `/tmp` es un
  // symlink a `/private/tmp`, así que comparar la ruta real de un fichero contra
  // una raíz sin resolver declara "fuera del repo" absolutamente todo.
  let rootReal
  try {
    rootReal = realpathSync(resolve(root))
  } catch {
    rootReal = resolve(root)
  }
  const inside = (p) => {
    const r = relative(rootReal, p)
    return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)
  }
  const abs = resolve(rootReal, rel)
  if (!inside(abs)) return null
  let real
  try {
    real = realpathSync(abs)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
  if (!inside(real)) return null
  const st = statSync(real)
  // "No es un fichero" NO es lo mismo que "no existe". Para un enlace roto da
  // igual; para AGENTS.md/CLAUDE.md es una anomalía que hay que decir (caso
  // real cubierto por los tests: un DIRECTORIO llamado AGENTS.md — readFileSync
  // falla con EISDIR, no con ENOENT, y callarlo sería indistinguible de
  // "no hay conflicto").
  if (!st.isFile()) return { notFile: true }
  if (st.size > MAX_DOC_BYTES) return { oversize: true, size: st.size }
  return { content: readFileSync(real, 'utf8') }
}

// readRepoDocs: los dos documentos raíz MÁS, a un salto, los `.md` del propio
// repo que ellos citan. Devuelve también lo que NO se ha podido mirar: quien
// llama tiene que poder decirlo en vez de pasar por "no hay nada".
//
//   { docs, failures: [string], truncated: bool }
//
// `docs[i].via` marca de qué documento raíz vino el enlace; se imprime junto a
// la evidencia para que nadie tenga que preguntarse por qué se ha mirado ahí.
export function readRepoDocs(root, { follow = true } = {}) {
  const docs = []
  const failures = []
  let truncated = false
  for (const name of ROOT_DOC_NAMES) {
    try {
      const r = readDoc(root, name)
      if (!r) continue // no existe: no es señal de nada
      if (r.notFile) { failures.push(`${name}: existe pero no es un fichero`); continue }
      if (r.oversize) { failures.push(`${name}: ${Math.round(r.size / 1024)} KB, por encima del límite de lectura`); continue }
      docs.push({ path: name, content: r.content })
    } catch (e) {
      failures.push(`${name}: ${e.message}`)
    }
  }
  if (!follow) return { docs, failures, truncated }

  const rootPaths = new Set(docs.map((d) => d.path))
  const linked = []
  for (const d of docs) {
    for (const p of linkedDocPaths([d])) {
      if (rootPaths.has(p) || linked.some((l) => l.path === p)) continue
      linked.push({ path: p, via: d.path })
    }
  }
  if (linked.length > MAX_LINKED_DOCS) truncated = true
  for (const { path, via } of linked.slice(0, MAX_LINKED_DOCS)) {
    try {
      const r = readDoc(root, path)
      // Un enlace roto (o a algo que no es un fichero del repo) no dice nada de
      // las convenciones del repo: se salta en silencio, no es cosa nuestra.
      if (!r || r.notFile) continue
      if (r.oversize) { failures.push(`${path}: ${Math.round(r.size / 1024)} KB, por encima del límite de lectura`); continue }
      docs.push({ path, content: r.content, via })
    } catch (e) {
      failures.push(`${path} (enlazado desde ${via}): ${e.message}`)
    }
  }
  return { docs, failures, truncated }
}

// readAck: `{ acks, problems, unreadable }`. `unreadable` solo se rellena cuando
// el fichero EXISTE y ha fallado la lectura — si no existe simplemente no hay
// acuses, que es el estado normal. La diferencia importa: "no acusaste nada" y
// "acusaste y no he podido leerlo" llevan al humano a sitios distintos.
// `prosaSinAcuses` (F15/H3) viaja igual que `problems`: es el tercer estado
// del fichero — existe, se leyó, y no silencia nada. Cuando el fichero no
// existe es `false` (no hay nada que engañe a nadie), no `undefined`.
export function readAck(root) {
  try {
    return { ...parseAcks(readFileSync(join(root, ACK_PATH), 'utf8')), unreadable: null }
  } catch (e) {
    if (e.code === 'ENOENT') return { acks: new Map(), problems: [], prosaSinAcuses: false, unreadable: null }
    return { acks: new Map(), problems: [], prosaSinAcuses: false, unreadable: e.message }
  }
}
