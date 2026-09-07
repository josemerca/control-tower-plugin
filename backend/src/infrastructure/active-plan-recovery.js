import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import { PlanWatch } from '../domain/value-objects/plan-watch.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.js'
import { ImplementationProgressFailure } from '../domain/exceptions.js'

export class CmuxActivePlan {
  static #TITLE = new RegExp(`^ct-plan-(.+)-(${CmuxPlanAgents.NO_STORY_PREFIX}[1-9]\\d*|[A-Z][A-Z0-9_]*-\\d+)$`)
  static #NO_STORY = new RegExp(`^${CmuxPlanAgents.NO_STORY_PREFIX}[1-9]\\d*$`)
  static #WORKTREE = /^(.+)\/\.worktrees\/([1-9]\d*)$/

  static parse(entry) {
    if (entry === null || typeof entry !== 'object' || entry.cwdKnown !== true) return null
    if (!CmuxPlanAgents.isHandle(entry.ref)) return null
    const named = typeof entry.title === 'string' ? entry.title.match(CmuxActivePlan.#TITLE) : null
    const located = typeof entry.cwd === 'string' ? entry.cwd.match(CmuxActivePlan.#WORKTREE) : null
    if (named === null || located === null) return null

    const repositoryText = named[1].replace('__', '/')
    if (!RepositoryName.isWellFormed(repositoryText)) return null
    const repository = new RepositoryName(repositoryText)
    const tail = named[2]
    const hasNoStory = CmuxActivePlan.#NO_STORY.test(tail)
    if (!hasNoStory && !UserStoryKey.isWellFormed(tail)) return null
    const story = hasNoStory ? null : new UserStoryKey(tail)
    if (!CheckoutRoot.isWellFormed(located[1])) return null
    const root = new CheckoutRoot(located[1])
    const issueNumber = Number(located[2])
    if (!Number.isInteger(issueNumber)) return null
    if (CmuxPlanAgents.nameFor({ story, repository, issueNumber }) !== entry.title) return null

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
  constructor({
    list, implementationStarts, goRegistry, implementationProgress, sessions, reviews, activePlans, checkouts,
  }) {
    this.list = list
    this.implementationStarts = implementationStarts
    this.goRegistry = goRegistry
    this.implementationProgress = implementationProgress
    this.sessions = sessions
    this.reviews = reviews
    this.activePlans = activePlans
    this.checkouts = checkouts
    this.conclusive = false
  }

  async #workIsUnderway(watch) {
    try {
      await this.implementationProgress.of({ root: new CheckoutRoot(watch.located.root), issue: watch.issue.number })

      return true
    } catch (cause) {
      if (cause instanceof ImplementationProgressFailure) return false
      throw cause
    }
  }

  async recover() {
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
        if (await this.#workIsUnderway(watch)) {
          this.activePlans.rememberImplementing(watch)
        } else {
          this.activePlans.rememberUncertain(watch)
        }
        continue
      }
      this.sessions.remember(watch)
      this.reviews.startRecovered(watch)
    }
    this.conclusive = true

    return true
  }
}
