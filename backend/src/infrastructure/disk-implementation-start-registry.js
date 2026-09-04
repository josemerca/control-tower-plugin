import { join } from 'node:path'

export class DiskImplementationStartRegistry {
  static DIRECTORY = 'implementation-starts'

  constructor({ read, stat, write, root }) {
    this.read = read
    this.stat = stat
    this.write = write
    this.root = root
  }

  static pathFor({ issueNumber, repository, root }) {
    const file = `${repository.text.replace(/\//g, '__')}-${issueNumber}.json`
    return join(root, DiskImplementationStartRegistry.DIRECTORY, file)
  }

  static recordFor(watch) {
    return {
      repo: watch.repository.text,
      issue: watch.issue.number,
      agent: watch.agent,
      story: watch.story.text,
      root: watch.located.root,
      branch: watch.located.branch,
      worktree: watch.located.path,
    }
  }

  async remember(watch) {
    const path = DiskImplementationStartRegistry.pathFor({
      issueNumber: watch.issue.number,
      repository: watch.repository,
      root: this.root,
    })
    await this.write(path, `${JSON.stringify(DiskImplementationStartRegistry.recordFor(watch), null, 2)}\n`)
  }

  matches(watch) {
    const path = DiskImplementationStartRegistry.pathFor({
      issueNumber: watch.issue.number,
      repository: watch.repository,
      root: this.root,
    })
    try {
      if (!this.stat(path).isFile()) return false
      const record = JSON.parse(this.read(path))
      const expected = DiskImplementationStartRegistry.recordFor(watch)

      return record !== null && typeof record === 'object' && !Array.isArray(record) &&
        Object.keys(expected).every((field) => record[field] === expected[field])
    } catch {
      return false
    }
  }
}
