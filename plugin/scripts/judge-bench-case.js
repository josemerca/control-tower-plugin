import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_SECTIONS, VERDICT_RULES, reviewToken, reviewTokenOf } from './step-contracts.js'

export const Agreement = Object.freeze({
  HIT: 'hit',
  RULING_DIFFERS: 'ruling-differs',
  RULE_NOT_FOUND: 'rule-not-found',
})

export class CorruptCase extends Error {
  constructor({ name, detail }) {
    super(`the bench case "${name}" cannot be used: ${detail}`)
    this.caseName = name
    this.detail = detail
  }
}

export class UnknownCase extends Error {
  constructor({ name, known }) {
    super(`no bench case is named "${name}"; the cases are ${known.join(', ')}`)
    this.caseName = name
    this.known = Object.freeze([...known])
  }
}

export class Comparison {
  constructor({ agreement, detail }) {
    if (!Object.values(Agreement).includes(agreement)) {
      throw new Error(`agreement must be an Agreement member, got ${JSON.stringify(agreement)}`)
    }
    this.agreement = agreement
    this.detail = detail
    Object.freeze(this)
  }
}

export class ExpectedVerdict {
  static #KNOWN_KEYS = Object.freeze(['ruling', 'must_find', 'incident'])
  static #RULINGS = Object.freeze(['PASS', 'FAIL'])

  constructor({ ruling, mustFind, incident }) {
    if (!ExpectedVerdict.#RULINGS.includes(ruling)) {
      throw new Error(`ruling must be PASS or FAIL, got ${JSON.stringify(ruling)}`)
    }
    const unknown = mustFind.filter((rule) => !VERDICT_RULES.includes(rule))
    if (unknown.length) {
      throw new Error(`must_find names rules the rubric does not have: ${unknown.join(', ')}`)
    }
    this.ruling = ruling
    this.mustFind = Object.freeze([...mustFind])
    this.incident = incident
    Object.freeze(this)
  }

  static parse(text) {
    let raw
    try {
      raw = JSON.parse(text)
    } catch (error) {
      throw new Error(`expected.json is not JSON: ${error.message}`)
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected.json is not an object')
    const unknown = Object.keys(raw).filter((key) => !ExpectedVerdict.#KNOWN_KEYS.includes(key))
    if (unknown.length) throw new Error(`expected.json carries keys the bench does not read: ${unknown.join(', ')}`)
    if (!Array.isArray(raw.must_find) || !raw.must_find.every((rule) => typeof rule === 'string')) {
      throw new Error('expected.json must carry must_find as a list of rule names')
    }
    if (raw.incident !== undefined && typeof raw.incident !== 'string') {
      throw new Error('expected.json carries an incident that is not text')
    }
    return new ExpectedVerdict({ ruling: raw.ruling, mustFind: raw.must_find, incident: raw.incident ?? '' })
  }

  compare(verdict) {
    if (verdict.ruling !== this.ruling) {
      return new Comparison({
        agreement: Agreement.RULING_DIFFERS,
        detail: `expected ${this.ruling}, the judge ruled ${verdict.ruling}`,
      })
    }
    const found = new Set(verdict.findings.map((finding) => finding.rule))
    const absent = this.mustFind.filter((rule) => !found.has(rule))
    if (absent.length) {
      return new Comparison({
        agreement: Agreement.RULE_NOT_FOUND,
        detail: `no finding under ${absent.join(', ')}; the judge reported ${found.size ? [...found].join(', ') : 'none'}`,
      })
    }
    return new Comparison({ agreement: Agreement.HIT, detail: `${this.ruling} with the expected findings` })
  }
}

export class BenchCase {
  static BRIEF = 'brief.md'
  static PACKAGE = 'package.md'
  static EXPECTED = 'expected.json'
  static REPO = 'repo'
  static #HEADER = /^# Review package: task (\d+)\/(\d+) of issue #(\d+) /

  constructor({ name, directory, brief, reviewPackage, expected, issue, task, tasksTotal, token }) {
    this.name = name
    this.directory = directory
    this.brief = brief
    this.reviewPackage = reviewPackage
    this.expected = expected
    this.issue = issue
    this.task = task
    this.tasksTotal = tasksTotal
    this.token = token
    Object.freeze(this)
  }

  get repoDirectory() {
    return join(this.directory, BenchCase.REPO)
  }

  static load(directory, name) {
    const read = (file) => {
      const path = join(directory, file)
      if (!existsSync(path)) throw new CorruptCase({ name, detail: `${file} is missing` })
      return readFileSync(path, 'utf8')
    }
    const brief = read(BenchCase.BRIEF)
    const reviewPackage = read(BenchCase.PACKAGE)
    let expected
    try {
      expected = ExpectedVerdict.parse(read(BenchCase.EXPECTED))
    } catch (error) {
      throw new CorruptCase({ name, detail: error.message })
    }
    if (!existsSync(join(directory, BenchCase.REPO))) throw new CorruptCase({ name, detail: `${BenchCase.REPO}/ is missing` })
    const header = BenchCase.#HEADER.exec(reviewPackage)
    if (!header) throw new CorruptCase({ name, detail: `${BenchCase.PACKAGE} does not open with the review package header ct-step writes` })
    const token = reviewTokenOf(reviewPackage)
    if (token === null) throw new CorruptCase({ name, detail: `${BenchCase.PACKAGE} declares no review token` })
    if (token !== reviewToken(BenchCase.diffOf(reviewPackage))) {
      throw new CorruptCase({ name, detail: `the review token of ${BenchCase.PACKAGE} is not the sha256 of its diff section` })
    }
    return new BenchCase({
      name,
      directory,
      brief,
      reviewPackage,
      expected,
      task: Number(header[1]),
      tasksTotal: Number(header[2]),
      issue: Number(header[3]),
      token,
    })
  }

  static diffOf(reviewPackage) {
    const marker = `\n## ${PACKAGE_SECTIONS[2]}\n`
    const at = reviewPackage.indexOf(marker)
    return at === -1 ? null : reviewPackage.slice(at + marker.length)
  }
}

export class BenchCases {
  static load(root, { only = null } = {}) {
    if (!existsSync(root)) throw new Error(`the bench cases directory does not exist: ${root}`)
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    if (only !== null && !names.includes(only)) throw new UnknownCase({ name: only, known: names })
    const chosen = only === null ? names : [only]
    if (chosen.length === 0) throw new Error(`the bench cases directory has no cases: ${root}`)
    return chosen.map((name) => BenchCase.load(join(root, name), name))
  }
}
