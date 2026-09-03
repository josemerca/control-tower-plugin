import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DispatchCheckHarvest } from '../../src/infrastructure/dispatch-check-harvest.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { HarvestOutcome } from '../../src/domain/value-objects/harvest-outcome.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { HarvestFailure, HarvestNotRead, HarvestNotUnderstood } from '../../src/domain/exceptions.js'
import { BigQueryTable } from '../../../plugin/scripts/bigquery-load.js'

class HarvestDouble {
  static ROOT = '/repo/checkout'
  static CHECK = '/plugin/scripts/dispatch-check.mjs'
  static REPOSITORY = new RepositoryName('owner/name')
  static ISSUE = 7
  static WORKTREE = '/repo/checkout/.worktrees/7'

  static COLLECTED_LINE =
    `collected #7: cerrada la workspace de cmux, borrado el worktree ${HarvestDouble.WORKTREE}, borrada la rama feat/7\n`
  static WAITING_LINE = 'waiting on #7 (open): la PR #71 sigue abierta — no se ha tocado nada\n'
  static KEPT_LINE =
    `kept #7: el worktree ${HarvestDouble.WORKTREE} tiene cambios sin commitear — no se ha borrado nada\n`
  static PARTIAL_LINE =
    `ATENCIÓN: cosecha a medias de #7: borrado el worktree ${HarvestDouble.WORKTREE}, borrada la rama feat/7. Falló: cmux close-workspace --workspace workspace:0 failed with exit code 1: cmux: close-workspace failed. Pendiente a mano — ejecuta cada comando por separado: cmux close-workspace --workspace workspace:0\n`
  static NOT_READ_LINES = [
    'gh: could not connect to api.github.com',
    'no se pudo leer el estado de #7: gh pr list falló (exit code 1: Command failed: gh pr list --repo owner/name --head feat/7 --state all --json number,state,headRefOid --limit 10) — no se ha tocado nada, el siguiente barrido reintenta.',
    '',
  ].join('\n')
  static USAGE_LINE =
    '--settle-ms/CT_CLAIM_SETTLE_MS ya no existen: la espera de asentamiento se eliminó a propósito (ver el comentario de cabecera de dispatch-check.mjs y task-11-report.md). Quítalo de la invocación/entorno — no hace nada, y dejarlo puesto invita a creer que sigue activo.\n'
  static BLEW_UP_TRACE = [
    'file:///plugin/scripts/dispatch-check.mjs:1446',
    '  if (!proyeccion) throw new Error(`--collect no tiene proyección para el desenlace ${report.outcome}`)',
    '                   ^',
    '',
    'Error: --collect no tiene proyección para el desenlace invented',
    '',
  ].join('\n')

  constructor({ code, stdout = '', stderr = '', harvestTable = null }) {
    this.said = new ProcessOutput({ code, stdout, stderr })
    this.calls = []
    this.harvestTable = harvestTable
  }

  harvest() {
    return new DispatchCheckHarvest({
      root: HarvestDouble.ROOT,
      dispatchCheck: HarvestDouble.CHECK,
      harvestTable: this.harvestTable,
      node: (argv, options) => {
        this.calls.push([argv, options])
        return Promise.resolve(this.said)
      },
    })
  }

  asked() {
    return this.harvest().collect({
      issueNumber: HarvestDouble.ISSUE,
      repository: HarvestDouble.REPOSITORY,
    })
  }

  refusal() {
    return this.asked().catch((cause) => cause)
  }

  static collected() {
    return new HarvestDouble({ code: 0, stdout: HarvestDouble.COLLECTED_LINE })
  }

  static waiting() {
    return new HarvestDouble({ code: 1, stdout: HarvestDouble.WAITING_LINE })
  }

  static kept() {
    return new HarvestDouble({ code: 10, stdout: HarvestDouble.KEPT_LINE })
  }

  static partial() {
    return new HarvestDouble({ code: 4, stderr: HarvestDouble.PARTIAL_LINE })
  }

  static couldNotRead() {
    return new HarvestDouble({ code: 3, stderr: HarvestDouble.NOT_READ_LINES })
  }

  static invocationRefused() {
    return new HarvestDouble({ code: 2, stderr: HarvestDouble.USAGE_LINE })
  }

  static blewUp() {
    return new HarvestDouble({ code: 1, stderr: HarvestDouble.BLEW_UP_TRACE })
  }

  static exiting(code) {
    return new HarvestDouble({ code, stdout: HarvestDouble.WAITING_LINE, stderr: HarvestDouble.USAGE_LINE })
  }
}

class PluginContract {
  static SCRIPT = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugin', 'scripts', 'dispatch-check.mjs'
  )
  static #COLLECT = /\nif \(collect\) \{\n([\s\S]*?)\n\}\n/
  static #TABLE = /\n {2}const PROYECCION = \{\n([\s\S]*?)\n {2}\}\n/
  static #CODE = /code: (\d+)/g

  static codesTheCollectTableProjects() {
    const source = readFileSync(PluginContract.SCRIPT, 'utf8')
    const collect = source.match(PluginContract.#COLLECT)
    if (collect === null) throw new Error(`${PluginContract.SCRIPT} no longer carries a collect block`)
    const table = collect[1].match(PluginContract.#TABLE)
    if (table === null) throw new Error(`the collect block no longer projects its outcomes with a table`)

    return [...new Set([...table[1].matchAll(PluginContract.#CODE)].map((found) => Number(found[1])))]
      .sort((one, other) => one - other)
  }
}

describe('DispatchCheckHarvest', () => {
  it('the_command_it_runs_is_the_one_the_plugin_publishes_and_it_runs_in_the_checkout_that_holds_the_worktrees', async () => {
    const asked = HarvestDouble.collected()

    await asked.asked()

    expect(asked.calls[0][0]).toEqual([
      '/plugin/scripts/dispatch-check.mjs', '7', '--repo', 'owner/name', '--collect',
    ])
    expect(asked.calls[0][1]).toEqual({ cwd: '/repo/checkout' })
  })

  it('without_a_harvest_table_the_argv_is_byte_for_byte_the_one_of_today', () => {
    expect(DispatchCheckHarvest.argvFor({
      dispatchCheck: HarvestDouble.CHECK,
      issueNumber: HarvestDouble.ISSUE,
      repository: HarvestDouble.REPOSITORY,
      harvestTable: null,
    })).toEqual([HarvestDouble.CHECK, '7', '--repo', 'owner/name', '--collect'])
  })

  it('with_a_harvest_table_the_command_asks_the_plugin_to_load_the_row_after_the_five_arguments_of_today', async () => {
    const harvestTable = BigQueryTable.parse('p:d.t')

    expect(DispatchCheckHarvest.argvFor({
      dispatchCheck: HarvestDouble.CHECK,
      issueNumber: HarvestDouble.ISSUE,
      repository: HarvestDouble.REPOSITORY,
      harvestTable,
    })).toEqual([HarvestDouble.CHECK, '7', '--repo', 'owner/name', '--collect', '--bq', 'p:d.t'])

    const asked = new HarvestDouble({ code: 0, stdout: HarvestDouble.COLLECTED_LINE, harvestTable })
    await asked.asked()

    expect(asked.calls[0][0]).toEqual([HarvestDouble.CHECK, '7', '--repo', 'owner/name', '--collect', '--bq', 'p:d.t'])
  })

  it('a_slice_whose_residue_the_plugin_removed_comes_back_collected', async () => {
    expect(await HarvestDouble.collected().asked()).toBe(HarvestOutcome.COLLECTED)
  })

  it('a_slice_whose_pull_request_has_not_landed_comes_back_waiting', async () => {
    expect(await HarvestDouble.waiting().asked()).toBe(HarvestOutcome.WAITING)
  })

  it('a_slice_the_plugin_refused_to_touch_because_the_disk_disagrees_comes_back_kept', async () => {
    expect(await HarvestDouble.kept().asked()).toBe(HarvestOutcome.KEPT)
  })

  it('a_harvest_that_removed_something_and_then_failed_comes_back_partial_so_a_human_looks_at_it', async () => {
    expect(await HarvestDouble.partial().asked()).toBe(HarvestOutcome.PARTIAL)
  })

  it('a_wait_that_says_nothing_is_the_script_breaking_and_not_a_slice_worth_waiting_for', async () => {
    const refusal = await HarvestDouble.blewUp().refusal()

    expect(refusal).toBeInstanceOf(HarvestNotUnderstood)
    expect(refusal.message).toContain('without saying what it waits for')
    expect(refusal.message).toContain('no tiene proyección para el desenlace invented')
  })

  it('a_read_the_tool_could_not_do_travels_out_typed_carrying_every_line_it_wrote_and_not_only_the_last', async () => {
    const refusal = await HarvestDouble.couldNotRead().refusal()

    expect(refusal).toBeInstanceOf(HarvestNotRead)
    expect(refusal.message).toContain('gh: could not connect to api.github.com')
    expect(refusal.message).toContain('no se pudo leer el estado de #7: gh pr list falló')
    expect(refusal.message).toContain('the next sweep can try again')
  })

  it('an_invocation_the_plugin_refuses_is_configuration_and_never_something_the_next_sweep_would_fix', async () => {
    const refusal = await HarvestDouble.invocationRefused().refusal()

    expect(refusal).toBeInstanceOf(HarvestNotUnderstood)
    expect(refusal.message).toContain('retrying changes nothing')
    expect(refusal.message).toContain('CT_CLAIM_SETTLE_MS ya no existen')
  })

  it('an_exit_code_the_contract_never_declared_is_not_guessed_into_an_outcome', async () => {
    const refusal = await new HarvestDouble({ code: 7, stdout: 'half a line', stderr: 'and a half' }).refusal()

    expect(refusal).toBeInstanceOf(HarvestNotUnderstood)
    expect(refusal.message).toContain('exited 7 for #7')
    expect(refusal.message).toContain('stdout "half a line", stderr "and a half"')
  })

  it('the_two_ways_a_harvest_can_fail_are_told_apart_and_still_share_the_family_a_caller_can_catch', async () => {
    const unread = await HarvestDouble.couldNotRead().refusal()
    const unreadable = await HarvestDouble.invocationRefused().refusal()

    expect(unread).not.toBeInstanceOf(HarvestNotUnderstood)
    expect(unreadable).not.toBeInstanceOf(HarvestNotRead)
    expect(unread).toBeInstanceOf(HarvestFailure)
    expect(unreadable).toBeInstanceOf(HarvestFailure)
  })

  it('every_code_the_contract_declares_ends_in_an_outcome_or_in_a_typed_failure_and_never_in_anything_else', async () => {
    const ended = await Promise.all(
      DispatchCheckHarvest.declaredCodes().map((code) => HarvestDouble.exiting(code).refusal())
    )

    expect(DispatchCheckHarvest.declaredCodes()).toEqual([0, 1, 2, 3, 4, 10])
    expect(ended.filter((end) => HarvestOutcome.declared().includes(end))).toHaveLength(4)
    expect(ended.filter((end) => end instanceof HarvestFailure)).toHaveLength(2)
  })

  it('the_collect_block_of_the_plugin_projects_every_code_this_adapter_declares_except_the_one_it_refuses_a_bad_invocation_with', () => {
    expect(PluginContract.codesTheCollectTableProjects()).toEqual(
      DispatchCheckHarvest.declaredCodes().filter((code) => code !== DispatchCheckHarvest.USAGE_REFUSED)
    )
  })
})
