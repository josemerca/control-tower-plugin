import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const STEP = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-step.mjs')

const FENCE = '```'

const planOfOneTaskWithBacktickedFiles = () => [
  '# #99 — fixture slice',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Fixture.',
  '### Desired end state',
  'Work done.',
  '### Out of scope',
  'N/A — fixture.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| fixture | yes |',
  '## 3. Reference patterns',
  'N/A — fixture.',
  '## 4. Inventory',
  'work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the work is committed.',
  '**Files:** `work.txt` (create).',
  'Final text (work.txt):',
  FENCE,
  'trabajo',
  FENCE,
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.',
  FENCE + 'bash',
  'git log --oneline -1',
  FENCE,
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'None.',
  '',
].join('\n')

class RepoMother {
  static #aBareRemoteWithACloneSoOriginMainReallyExists(prefijo, issue) {
    const remote = mkdtempSync(join(tmpdir(), `${prefijo}-remote-`))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote })

    const seed = mkdtempSync(join(tmpdir(), `${prefijo}-seed-`))
    const seedGit = (...a) => execFileSync('git', a, { cwd: seed, encoding: 'utf8' })
    seedGit('init', '-q', '-b', 'main')
    seedGit('config', 'user.email', 'coordinadora@x.z')
    seedGit('config', 'user.name', 'coordinadora')
    writeFileSync(join(seed, 'f.txt'), 'base\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'corte')
    seedGit('remote', 'add', 'origin', remote)
    seedGit('push', '-q', '-u', 'origin', 'main')

    const work = mkdtempSync(join(tmpdir(), `${prefijo}-work-`))
    execFileSync('git', ['clone', '-q', remote, '.'], { cwd: work })
    const workGit = (...a) => execFileSync('git', a, { cwd: work, encoding: 'utf8' })
    workGit('config', 'user.email', 'slice@x.z')
    workGit('config', 'user.name', 'slice')
    workGit('switch', '-q', '-c', `feat/${issue}`)

    return { remote, seed, work, seedGit, workGit }
  }

  static #laBaseAvanzaYElSliceLaMergea(seed, seedGit, workGit) {
    writeFileSync(join(seed, 'g.txt'), 'avance\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'la base avanza')
    seedGit('push', '-q', 'origin', 'main')

    workGit('fetch', '-q', 'origin', 'main')
    workGit('merge', '-q', '--no-edit', 'origin/main')
  }

  static #escribeElRunParadoEnGlobal(work, issue, baseSha) {
    writeFileSync(join(work, '.agent', `run-${issue}.json`), JSON.stringify({
      plan: 'docs/superpowers/plans/plan.md', issue, baseSha,
      task: 1, tasksTotal: 1, step: 'global',
      controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0, spendUsd: 0,
    }, null, 2))
  }

  static #escribeElPlanYLaSemilla(work, issue) {
    mkdirSync(join(work, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(work, 'docs', 'superpowers', 'plans', 'plan.md'), planOfOneTaskWithBacktickedFiles())
    mkdirSync(join(work, '.agent'), { recursive: true })
    writeFileSync(join(work, '.agent', 'SLICE.md'), `---\nissue: ${issue}\nbase: main\n---\n# s\n`)
  }

  static aSliceWhoseBaseShaIsTheCutAndMergedAnAdvancedBase(issue) {
    const { remote, seed, work, seedGit, workGit } = RepoMother.#aBareRemoteWithACloneSoOriginMainReallyExists('ct-step-mb', issue)
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()

    RepoMother.#escribeElPlanYLaSemilla(work, issue)
    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'tarea 1')

    RepoMother.#laBaseAvanzaYElSliceLaMergea(seed, seedGit, workGit)
    RepoMother.#escribeElRunParadoEnGlobal(work, issue, baseSha)

    return { remote, seed, work }
  }

  static aRunBornAfterThePlanCommit(issue) {
    const { remote, seed, work, seedGit, workGit } = RepoMother.#aBareRemoteWithACloneSoOriginMainReallyExists('ct-step-plan', issue)
    const cut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()

    RepoMother.#escribeElPlanYLaSemilla(work, issue)
    const baseSha = RepoMother.#commitThePlanAndCaptureBaseShaAsProductionDoesAtRunBirth(work, workGit)

    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'tarea 1')

    RepoMother.#laBaseAvanzaYElSliceLaMergea(seed, seedGit, workGit)
    RepoMother.#escribeElRunParadoEnGlobal(work, issue, baseSha)

    return { remote, seed, work, cut, baseSha }
  }

  static #commitThePlanAndCaptureBaseShaAsProductionDoesAtRunBirth(work, workGit) {
    workGit('add', '-A')
    workGit('commit', '-qm', 'plan: la slice, planificada')
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()
  }
}

const next = (cwd, issue) => spawnSync(process.execPath, [
  STEP, 'next', '--plan', 'docs/superpowers/plans/plan.md', '--issue', String(issue),
], { cwd, encoding: 'utf8' })

const limpia = (...dirs) => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) }

describe('the run commit count', () => {
  it('counts_neither_the_plan_commit_that_precedes_the_run_nor_what_the_merge_of_the_base_brought', () => {
    const { remote, seed, work, cut, baseSha } = RepoMother.aRunBornAfterThePlanCommit(99)
    const cuenta = (...a) => Number(execFileSync('git', ['rev-list', '--count', ...a], { cwd: work, encoding: 'utf8' }).trim())
    try {
      expect(cuenta(`${baseSha}..HEAD`)).toBe(3)
      expect(cuenta('--no-merges', `${cut}..HEAD`, '^origin/main')).toBe(2)
      expect(cuenta('--no-merges', `${baseSha}..HEAD`, '^origin/main')).toBe(1)
    } finally {
      limpia(work, seed, remote)
    }
  })
})

describe('ct-step for a run whose slice merged an advanced base', () => {
  const issue = 99

  it('a_run_paused_at_a_slice_step_after_merging_an_advanced_base_is_not_rejected_as_out_of_sync', () => {
    const { remote, seed, work } = RepoMother.aSliceWhoseBaseShaIsTheCutAndMergedAnAdvancedBase(issue)
    try {
      const r = next(work, issue)
      expect(r.stderr).not.toMatch(/no cuentan lo mismo/)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    } finally {
      limpia(work, seed, remote)
    }
  })
})

describe('ct-step for a run born after the plan commit', () => {
  const issue = 99

  it('the_plan_commit_made_before_the_run_was_born_is_not_counted_as_work_this_run_did', () => {
    const { remote, seed, work } = RepoMother.aRunBornAfterThePlanCommit(issue)
    try {
      const r = next(work, issue)
      expect(r.stderr).not.toMatch(/no cuentan lo mismo/)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    } finally {
      limpia(work, seed, remote)
    }
  })
})
