// LA REGLA DE PRECEDENCIA, UNA SOLA VEZ EN TODO EL REPO.
//
// Estaba escrita en cinco ficheros —`plugin-yardstick.js`, `kickoff.js`,
// `prompts/task-implementer.md`, `agents/ct-judge.md` y, en el backend,
// `plan-agent-brief.js`— y el juez la leía tres veces en una sola llamada. Lo
// que dos copias compran es que diverjan, y ésa no es una hipótesis: la del
// backend acabó diciendo que `architecture.md` se aplica SIEMPRE, justo lo
// contrario de lo que dice la cabecera del plugin y de lo que declara la
// cabecera `Applies to:` del propio documento.
//
// Este test es lo único que impide que vuelva a pasar: `conventions/decisions.md`
// dice que una regla se escribe una vez, y una regla escrita en prosa no la caza
// ningún detector de duplicados por parecido — sólo la caza quien busque su frase.
//
// LA FRASE NO SE TECLEA AQUÍ: se extrae de la propia cabecera, que es la
// fuente. Escribirla a mano sería la segunda copia, y encima la que decide si
// hay segunda copia.
//
// SE RECORREN `plugin/` Y `backend/src/`, que es donde vive el texto que leen
// los agentes. Los `__tests__` quedan fuera a propósito: un test que fija la
// frase —el de la cabecera, o el del kickoff que comprueba que ya NO la
// enuncia— la contiene por necesidad, y contarlos haría este test imposible de
// pasar.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(pluginRoot, '..')

// SOLO LAS PALABRAS. Se tira todo lo que no es letra o espacio y se colapsa el
// resto: las marcas de cita del markdown, los asteriscos del énfasis y —esto es
// lo que obliga a llegar tan lejos— las comillas y las comas con las que el
// propio módulo parte la frase en las líneas de un array. Buscar el texto en
// crudo no encontraría la regla ni en el fichero que la escribe, y una copia en
// otro sitio con otra puntuación tampoco.
const soloPalabras = (texto) => String(texto)
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

class ReglaDePrecedencia {
  static frase() {
    const cabecera = String(PluginYardstick.precedenceHeader()).replace(/^>\s?/gm, '').replace(/\s+/g, ' ')
    const enunciado = /\*\*Tiene preferencia sobre[^*]+\*\*/.exec(cabecera)
    return enunciado ? soloPalabras(enunciado[0]) : null
  }
}

class TextoDelRepo {
  static DIRECTORIOS_FUERA = ['node_modules', '.git', '__tests__', 'dist', 'coverage']

  static EXTENSIONES = ['.js', '.mjs', '.md', '.sh', '.json']

  static #ficherosDe(raiz) {
    if (!existsSync(raiz)) return []
    const encontrados = []
    for (const entrada of readdirSync(raiz)) {
      const ruta = join(raiz, entrada)
      if (statSync(ruta).isDirectory()) {
        if (TextoDelRepo.DIRECTORIOS_FUERA.includes(entrada)) continue
        encontrados.push(...TextoDelRepo.#ficherosDe(ruta))
        continue
      }
      if (TextoDelRepo.EXTENSIONES.some((ext) => entrada.endsWith(ext))) encontrados.push(ruta)
    }
    return encontrados
  }

  static todos() {
    return [
      ...TextoDelRepo.#ficherosDe(pluginRoot),
      ...TextoDelRepo.#ficherosDe(join(repoRoot, 'backend', 'src')),
    ].map((ruta) => relative(repoRoot, ruta))
  }

  static losQueContienen(frase) {
    return TextoDelRepo.todos()
      .filter((ruta) => soloPalabras(readFileSync(join(repoRoot, ruta), 'utf8')).includes(frase))
  }
}

describe('la regla de precedencia se escribe en un solo sitio de todo el repo', () => {
  it('la frase que la enuncia se extrae de la cabecera, no se teclea en este test', () => {
    expect(ReglaDePrecedencia.frase()).not.toBeNull()
    expect(ReglaDePrecedencia.frase().length).toBeGreaterThan(60)
  })

  it('sólo el módulo que compone la cabecera la escribe: ni plugin/ ni backend/src/ la repiten', () => {
    expect(TextoDelRepo.losQueContienen(ReglaDePrecedencia.frase()))
      .toEqual(['plugin/scripts/plugin-yardstick.js'])
  })

  it('el recorrido mira de verdad los dos árboles, o lo de arriba pasaría por vacío', () => {
    const todos = TextoDelRepo.todos()
    expect(todos).toContain('plugin/agents/ct-judge.md')
    expect(todos).toContain('plugin/prompts/task-implementer.md')
    expect(todos).toContain('plugin/scripts/kickoff.js')
    expect(todos).toContain('backend/src/infrastructure/plan-agent-brief.js')
  })
})
