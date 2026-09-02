import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Yardstick } from './yardstick'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = join(HERE, '..')
const REPOSITORY = join(FRONTEND, '..')
const BACKEND_YARDSTICK = join('backend', '__tests__', 'yardstick.js')

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'frontend'], {
    cwd: REPOSITORY,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.replace(/^frontend\//, ''))

const backendWords = (): string[] => {
  const source = readFileSync(join(REPOSITORY, BACKEND_YARDSTICK), 'utf8')
  const declared = source.match(/SPANISH_WORDS\s*=\s*\[([\s\S]*?)\]/)
  if (declared === null) throw new Error('the backend yardstick no longer declares SPANISH_WORDS')
  return [...declared[1].matchAll(/'([^']+)'/g)].map((found) => found[1])
}

describe('every file under frontend keeps being born conforming', () => {
  const measured = Yardstick.measuredUnder(FRONTEND)

  it('should find its subjects by walking so a new file is covered without anyone listing it', () => {
    expect(measured).toContain(join('src', 'app', 'start-plan', 'client.ts'))
    expect(measured).toContain(join('src', 'pages', 'home', 'Home.tsx'))
    expect(measured).toContain(join('__tests__', 'yardstick.test.ts'))
  })

  it('should match what git sees so neither a new file nor a deleted one goes unnoticed', () => {
    const seen = tracked().filter((file) => Yardstick.MEASURED_EXTENSIONS.includes(`.${file.split('.').pop()}`))
    expect(seen.length).toBeGreaterThan(0)
    expect([...measured].sort()).toEqual(seen.sort())
  })

  it('should fail on an extension nobody classified instead of skipping it in silence', () => {
    expect(Yardstick.unclassifiedUnder(FRONTEND)).toEqual([])
  })

  it.each(measured)('%s should explain itself with names instead of prose', (file) => {
    expect(Yardstick.proseIn(FRONTEND, file)).toEqual([])
  })

  it.each(measured)('%s should export by name and never by default', (file) => {
    expect(Yardstick.defaultExportsIn(FRONTEND, file)).toEqual([])
  })

  it.each(measured)('%s should import across folders by absolute path and not by climbing', (file) => {
    expect(Yardstick.climbingImportsIn(FRONTEND, file)).toEqual([])
  })

  it.each(measured)('%s should name things in english', (file) => {
    expect(Yardstick.spanishIdentifiersIn(FRONTEND, file)).toEqual([])
    expect(Yardstick.foreignTestNamesIn(FRONTEND, file)).toEqual([])
  })

  it('should really fire the prose detector so the guard cannot pass by detecting nothing', () => {
    expect(Yardstick.proseInSource('const trap = 1 ' + '/' + '/ trailing')).toEqual([1])
    expect(Yardstick.proseInSource("const clean = '" + '/' + "/ inside a string'")).toEqual([])
    expect(Yardstick.proseInSource('/// <reference types="vitest/config" />')).toEqual([])
  })

  it('should really fire the default export detector', () => {
    expect(Yardstick.defaultExportsInSource('export default function Loose() {}')).toEqual([1])
    expect(Yardstick.defaultExportsInSource('export { Kept }')).toEqual([])
  })

  it('should exempt only the config vite itself demands a default export from', () => {
    expect(Yardstick.defaultExportsIn(FRONTEND, 'vite.config.ts')).toEqual([])
    expect(Yardstick.defaultExportsInSource(readFileSync(join(FRONTEND, 'vite.config.ts'), 'utf8'))).toHaveLength(1)
  })

  it('should treat a line of bare jsx text as interface copy and not as code', () => {
    expect(Yardstick.spanishIdentifiersInSource('      <label>\n        Clave del ticket\n      </label>')).toEqual([])
  })

  it('should really fire the climbing import detector and let same folder imports through', () => {
    expect(Yardstick.climbingImportsInSource("import { X } from '../other/X'")).toEqual([1])
    expect(Yardstick.climbingImportsInSource("import { X } from './X'")).toEqual([])
    expect(Yardstick.climbingImportsInSource("import { X } from 'app/other/X'")).toEqual([])
  })

  it('should really fire the english detector on a spanish name wherever it sits', () => {
    expect(Yardstick.spanishIdentifiersInSource('const go = ({ puerto }) => puerto')).toEqual(['puerto'])
    expect(Yardstick.spanishIdentifiersInSource('const go = ({ port }) => port')).toEqual([])
    expect(Yardstick.spanishIdentifiersInSource("const label = 'Clave del ticket'")).toEqual([])
  })

  it('should really fire the test name detector on spanish and on an inverted mark', () => {
    expect(Yardstick.foreignTestNamesInSource("it('el servidor devuelve la respuesta', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it('¿what now?', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it('a plain english name', () => {})")).toEqual([])
  })

  it('should cover the word list the backend declares so the two copies cannot drift apart', () => {
    const missing = backendWords().filter((word) => !Yardstick.SPANISH_WORDS.includes(word))
    expect(missing).toEqual([])
  })
})
