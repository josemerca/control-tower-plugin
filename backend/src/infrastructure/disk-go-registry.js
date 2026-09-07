import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { GoRegistry } from '../domain/ports/go-registry.js'
import { GoNotRecorded } from '../domain/exceptions.js'

export class DiskGoRegistry extends GoRegistry {
  static NONCE_BYTES = 4
  static DIRECTORY = 'go'

  constructor({ random, read = null, stat = null, write, root }) {
    super()
    this.random = random
    this.read = read
    this.stat = stat
    this.write = write
    this.root = root
  }

  static nonceFrom(bytes) {
    return Buffer.from(bytes).toString('hex')
  }

  static commitmentOf(nonce) {
    return createHash('sha256').update(nonce, 'utf8').digest('hex')
  }

  static fileNameFor({ issueNumber, repository }) {
    return `${repository.text.replace(/\//g, '__')}-${issueNumber}.json`
  }

  static pathFor({ issueNumber, repository, root }) {
    return join(root, DiskGoRegistry.DIRECTORY, DiskGoRegistry.fileNameFor({ issueNumber, repository }))
  }

  static contentFor({ issueNumber, repository, commitment }) {
    return `${JSON.stringify({ repo: repository.text, issue: issueNumber, commitment }, null, 2)}\n`
  }

  async mint({ issueNumber, repository }) {
    const nonce = DiskGoRegistry.nonceFrom(this.random(DiskGoRegistry.NONCE_BYTES))
    const path = DiskGoRegistry.pathFor({ issueNumber, repository, root: this.root })
    try {
      await this.write(path, DiskGoRegistry.contentFor({
        issueNumber, repository, commitment: DiskGoRegistry.commitmentOf(nonce),
      }))
    } catch (failure) {
      throw new GoNotRecorded(
        `the go of ${repository.text}#${issueNumber} could not be written to ${path}: ${failure.message}`
      )
    }

    return nonce
  }

  matches(watch) {
    if (this.read === null || this.stat === null) return false
    const path = DiskGoRegistry.pathFor({
      issueNumber: watch.issue.number,
      repository: watch.repository,
      root: this.root,
    })
    try {
      if (!this.stat(path).isFile()) return false
      const record = JSON.parse(this.read(path))

      return record !== null && typeof record === 'object' && !Array.isArray(record) &&
        record.repo === watch.repository.text && record.issue === watch.issue.number &&
        typeof record.commitment === 'string' && /^[0-9a-f]{64}$/.test(record.commitment)
    } catch {
      return false
    }
  }
}
