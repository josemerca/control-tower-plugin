import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const SPANISH_WORDS = [
  'cita', 'citas', 'nombre', 'nombres', 'texto', 'fila', 'filas', 'vara', 'documento', 'documentos',
  'encontrados', 'medir', 'medida', 'paso', 'pasos', 'regla', 'reglas', 'hallazgo', 'hallazgos',
  'intento', 'cuerpo', 'previos', 'comentario', 'comentarios', 'recorrido', 'alcance', 'sujeto',
  'servidor', 'puerto', 'puertos', 'peticion', 'peticiones', 'respuesta', 'respuestas', 'arranque',
  'identificador', 'ruta', 'rutas', 'fichero', 'ficheros', 'longitud', 'tamano', 'devuelve',
  'lanzar', 'lanzado', 'guardian', 'prueba', 'pruebas', 'campo', 'campos', 'clave', 'claves',
]

const MEASURED_EXTENSIONS = ['.ts', '.tsx']
const UNMEASURED_EXTENSIONS = ['.css', '.html', '.json', '.md', '.woff2', '.svg']
const SKIPPED_DIRECTORIES = ['node_modules', 'dist', '.git']

const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g
const JSX_TEXT = />[^<{]+</g
const REGEXES = /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\\/\n])+\/[dgimsuvy]*/g
const REFERENCE_DIRECTIVE = /^\/\/\/\s*<reference\b.*$/
const JSX_TEXT_LINE = /^\s*[^<>{}()=;[\]'"`]+$/
const PROSE = /\/\/|\/\*|^\s*\*(?!\/)/
const DEFAULT_EXPORT_REQUIRED_BY_TOOLING = ['vite.config.ts']
const DEFAULT_EXPORT = /^\s*export\s+default\b/
const CLIMBING_IMPORT = /^\s*import\s[^'"]*['"]\.\.\//
const IDENTIFIER = /[A-Za-z_$][\w$]*/g
const TEST_NAME = /^\s*(?:describe|it|test)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/
const INVERTED_MARKS = ['¿', '¡']

const filesUnder = (root: string, directory = root): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.includes(entry.name) ? [] : filesUnder(root, full)
    }
    return [relative(root, full)]
  })

const measuredUnder = (root: string): string[] =>
  filesUnder(root).filter((file) => MEASURED_EXTENSIONS.includes(extname(file)))

const unclassifiedUnder = (root: string): string[] =>
  filesUnder(root).filter((file) => {
    const extension = extname(file)
    return extension !== '' && !MEASURED_EXTENSIONS.includes(extension) && !UNMEASURED_EXTENSIONS.includes(extension)
  })

const linesOf = (root: string, file: string): string[] => readFileSync(join(root, file), 'utf8').split('\n')

const codeOnly = (line: string): string => {
  if (JSX_TEXT_LINE.test(line) || REFERENCE_DIRECTIVE.test(line)) return ''
  return line.replace(STRINGS, "''").replace(REGEXES, '/re/').replace(JSX_TEXT, '><')
}

const offendingLines = (lines: string[], offends: (code: string) => boolean): number[] =>
  lines.flatMap((line, index) => (offends(codeOnly(line)) ? [index + 1] : []))

const proseInSource = (source: string): number[] => offendingLines(source.split('\n'), (code) => PROSE.test(code))

const defaultExportsInSource = (source: string): number[] =>
  offendingLines(source.split('\n'), (code) => DEFAULT_EXPORT.test(code))

const climbingImportsInSource = (source: string): number[] =>
  source.split('\n').flatMap((line, index) => (CLIMBING_IMPORT.test(line) ? [index + 1] : []))

const spanishIdentifiersInSource = (source: string): string[] => {
  const found = new Set<string>()
  for (const line of source.split('\n')) {
    for (const identifier of codeOnly(line).match(IDENTIFIER) ?? []) {
      if (SPANISH_WORDS.includes(identifier.toLowerCase())) found.add(identifier)
    }
  }
  return [...found]
}

const foreignTestNamesInSource = (source: string): number[] =>
  source.split('\n').flatMap((line, index) => {
    const named = line.match(TEST_NAME)
    if (named === null) return []
    const name = named[2]
    const words = name.toLowerCase().match(IDENTIFIER) ?? []
    const isForeign = words.some((word) => SPANISH_WORDS.includes(word)) || INVERTED_MARKS.some((mark) => name.includes(mark))
    return isForeign ? [index + 1] : []
  })

const sourceOf = (root: string, file: string): string => linesOf(root, file).join('\n')

export const Yardstick = {
  SPANISH_WORDS,
  MEASURED_EXTENSIONS,
  measuredUnder,
  unclassifiedUnder,
  proseIn: (root: string, file: string) => proseInSource(sourceOf(root, file)),
  defaultExportsIn: (root: string, file: string) =>
    DEFAULT_EXPORT_REQUIRED_BY_TOOLING.includes(file) ? [] : defaultExportsInSource(sourceOf(root, file)),
  climbingImportsIn: (root: string, file: string) => climbingImportsInSource(sourceOf(root, file)),
  spanishIdentifiersIn: (root: string, file: string) => spanishIdentifiersInSource(sourceOf(root, file)),
  foreignTestNamesIn: (root: string, file: string) => foreignTestNamesInSource(sourceOf(root, file)),
  proseInSource,
  defaultExportsInSource,
  climbingImportsInSource,
  spanishIdentifiersInSource,
  foreignTestNamesInSource,
}
