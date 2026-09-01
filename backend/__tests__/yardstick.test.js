import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Yardstick } from './yardstick.js'

class Subjects {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static BACKEND = join(Subjects.HERE, '..')
  static REPOSITORY = join(Subjects.BACKEND, '..')
  static ROOT_GUARD = join('__tests__', 'modulos-conformes.test.js')

  static measured() {
    return Yardstick.measuredUnder(Subjects.BACKEND)
  }

  static tracked() {
    const listing = ['ls-files', '--cached', '--others', '--exclude-standard', 'backend']
    return execFileSync('git', listing, { cwd: Subjects.REPOSITORY, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/^backend\//, ''))
  }

  static rootGuardWords() {
    const source = readFileSync(join(Subjects.REPOSITORY, Subjects.ROOT_GUARD), 'utf8')
    const declared = source.match(/PALABRAS_CASTELLANAS\s*=\s*\[([\s\S]*?)\]/)
    if (declared === null) throw new Error('the root guard no longer declares PALABRAS_CASTELLANAS')
    return [...declared[1].matchAll(/'([^']+)'/g)].map((found) => found[1])
  }
}

describe('every file under backend keeps being born conforming', () => {
  const measured = Subjects.measured()

  it('the_guard_finds_its_subjects_by_walking_so_a_new_file_is_covered_without_anyone_listing_it', () => {
    expect(measured).toContain(join('src', 'api-server.js'))
    expect(measured).toContain(join('src', 'plan-request.js'))
    expect(measured).toContain(join('__tests__', 'yardstick.js'))
    expect(measured).toContain(join('__tests__', 'yardstick.test.js'))
  })

  it('the_census_matches_what_git_sees_so_neither_a_new_file_nor_a_deleted_one_goes_unnoticed', () => {
    const tracked = Subjects.tracked()
    expect(tracked.length).toBeGreaterThan(0)
    expect([...measured].sort()).toEqual(
      tracked.filter((file) => Yardstick.MEASURED_EXTENSIONS.includes(`.${file.split('.').pop()}`)).sort()
    )
  })

  it('a_file_with_an_extension_nobody_classified_fails_instead_of_being_skipped_in_silence', () => {
    expect(Yardstick.unclassifiedUnder(Subjects.BACKEND)).toEqual([])
  })

  it.each(measured)('%s explains itself with names instead of prose', (file) => {
    expect(Yardstick.proseIn(Subjects.BACKEND, file)).toEqual([])
  })

  it.each(measured)('%s hangs every function off a type', (file) => {
    expect(Yardstick.looseFunctionsIn(Subjects.BACKEND, file)).toEqual([])
  })

  it.each(measured)('%s names things in english', (file) => {
    expect(Yardstick.spanishIdentifiersIn(Subjects.BACKEND, file)).toEqual([])
    expect(Yardstick.foreignTestNamesIn(Subjects.BACKEND, file)).toEqual([])
  })

  it('the_prose_detector_really_fires_so_the_guard_cannot_pass_by_detecting_nothing', () => {
    expect(Yardstick.proseInSource('const trap = 1 ' + '/' + '/ trailing')).toEqual([1])
    expect(Yardstick.proseInSource('const clean = String.raw`' + '/' + '/ inside a string`')).toEqual([])
  })

  it('the_loose_function_detector_really_fires_on_every_shape_a_function_can_hide_in', () => {
    expect(Yardstick.looseFunctionsInSource('export default function loose() {}')).toEqual([1])
    expect(Yardstick.looseFunctionsInSource('export const loose = x => x')).toEqual([1])
    expect(Yardstick.looseFunctionsInSource('const loose = async () => 1')).toEqual([1])
    expect(Yardstick.looseFunctionsInSource('class Kept { static go() { return 1 } }')).toEqual([])
  })

  it('the_english_detector_really_fires_on_a_spanish_name_wherever_it_sits', () => {
    expect(Yardstick.spanishIdentifiersInSource('class Trap { static go({ puerto }) { return puerto } }'))
      .toEqual(['puerto'])
    expect(Yardstick.spanishIdentifiersInSource('class Trap { static go({ port }) { return port } }'))
      .toEqual([])
  })

  it('the_test_name_detector_really_fires_on_spanish_and_on_an_inverted_mark', () => {
    expect(Yardstick.foreignTestNamesInSource("it('el servidor devuelve la respuesta', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it('\u00bfwhat now?', () => {})")).toEqual([1])
    expect(Yardstick.foreignTestNamesInSource("it('a plain english name', () => {})")).toEqual([])
  })

  it('the_word_list_covers_the_one_the_root_guard_declares_so_the_two_copies_cannot_drift_apart', () => {
    const missing = Subjects.rootGuardWords().filter((word) => !Yardstick.SPANISH_WORDS.includes(word))

    expect(missing).toEqual([])
  })
})
