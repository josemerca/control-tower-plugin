import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import { PlanWatch } from '../domain/value-objects/plan-watch.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.js'

export class CmuxActivePlan {
  static #TITLE = /^ct-plan-(.+)-([A-Z][A-Z0-9_]*-\d+)$/
  static #WORKTREE = /^(.+)\/\.worktrees\/([1-9]\d*)$/

  static parse(entry) {
    if (entry === null || typeof entry !== 'object' || entry.cwdKnown !== true) return null
    if (!CmuxPlanAgents.isHandle(entry.ref)) return null
    const named = typeof entry.title === 'string' ? entry.title.match(CmuxActivePlan.#TITLE) : null
    const located = typeof entry.cwd === 'string' ? entry.cwd.match(CmuxActivePlan.#WORKTREE) : null
    if (named === null || located === null) return null

    const repositoryText = named[1].replace('__', '/')
    if (!RepositoryName.isWellFormed(repositoryText) || !UserStoryKey.isWellFormed(named[2])) return null
    const repository = new RepositoryName(repositoryText)
    const story = new UserStoryKey(named[2])
    if (CmuxPlanAgents.nameFor(story, repository) !== entry.title) return null
    if (!CheckoutRoot.isWellFormed(located[1])) return null
    const root = new CheckoutRoot(located[1])
    const issueNumber = Number(located[2])
    if (!Number.isInteger(issueNumber)) return null

    return new PlanWatch({
      story,
      issue: new PlanIssue({
        number: issueNumber,
        url: `https://github.com/${repository.text}/issues/${issueNumber}`,
      }),
      located: new WorkspaceLocation({ root: root.text, path: entry.cwd, branch: `feat/${issueNumber}` }),
      repository,
      agent: entry.ref,
    })
  }
}

export class ActivePlanRecovery {
  constructor({ list, implementationStarts, goRegistry, sessions, reviews, activePlans, checkouts }) {
    this.list = list
    this.implementationStarts = implementationStarts
    this.goRegistry = goRegistry
    this.sessions = sessions
    this.reviews = reviews
    this.activePlans = activePlans
    this.checkouts = checkouts
    this.conclusive = false
  }

  recover() {
    if (this.conclusive) return true
    const entries = this.list()
    if (entries === null) return false
    const recovered = new Set()
    for (const entry of entries) {
      const watch = CmuxActivePlan.parse(entry)
      if (watch === null) continue
      const key = `${watch.repository.text}#${watch.issue.number}`
      if (recovered.has(key)) continue
      recovered.add(key)
      this.checkouts.remember(new CheckoutRoot(watch.located.root))
      if (this.activePlans.find({ issue: watch.issue.number, repository: watch.repository }) !== null) continue
      if (this.implementationStarts.matches(watch)) {
        this.activePlans.rememberImplementing(watch)
        continue
      }
      if (this.goRegistry.matches(watch)) {
        this.activePlans.rememberUncertain(watch)
        continue
      }
      this.sessions.remember(watch)
      this.reviews.startRecovered(watch)
    }
    this.conclusive = true

    return true
  }
}
