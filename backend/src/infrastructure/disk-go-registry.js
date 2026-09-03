import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { GoRegistry } from '../domain/ports/go-registry.js'
import { GoNotRecorded } from '../domain/exceptions.js'

export class DiskGoRegistry extends GoRegistry {
  static NONCE_BYTES = 4
  static DIRECTORY = 'go'

  constructor({ random, write, root }) {
    super()
    if (typeof root !== 'string' || !isAbsolute(root)) {
      throw new Error(
        `the registry writes where dispatch-check reads, named by an absolute path, got ${JSON.stringify(root)}`
      )
    }
    this.random = random
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
}
