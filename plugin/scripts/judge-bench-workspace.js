import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RunPaths } from './judge-dispatch.js'

export class BenchWorkspace {
  constructor({ root }) {
    this.root = root
    Object.freeze(this)
  }

  prepare({ benchCase, attempt, yardstick }) {
    const directory = join(this.root, benchCase.name, String(attempt))
    mkdirSync(directory, { recursive: true })
    cpSync(benchCase.repoDirectory, directory, { recursive: true })
    const paths = new RunPaths({ issue: benchCase.issue, task: benchCase.task })
    mkdirSync(join(directory, paths.runDirectory), { recursive: true })
    writeFileSync(join(directory, paths.brief), benchCase.brief + yardstick)
    writeFileSync(join(directory, paths.reviewPackage), benchCase.reviewPackage)
    return directory
  }

  verdictWrittenAt(path) {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  }
}
