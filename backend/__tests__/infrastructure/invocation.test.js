import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Invocation, InvocationOutcome } from '../../src/infrastructure/invocation.js'

class PluginEnvironment {
  static SCRIPT = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugin', 'scripts', 'dispatch-check.mjs'
  )
  static #CLAIM_VARIABLE = /process\.env\.(CT_CLAIM_[A-Z_]+)/g

  static claimVariablesRead() {
    const named = [...readFileSync(PluginEnvironment.SCRIPT, 'utf8').matchAll(PluginEnvironment.#CLAIM_VARIABLE)]
      .map((found) => found[1])
    if (named.length === 0) throw new Error(`${PluginEnvironment.SCRIPT} no longer reads any CT_CLAIM_ variable`)

    return [...new Set(named)].sort()
  }

  static inheritedFromAClaimingShell() {
    return Object.fromEntries(PluginEnvironment.claimVariablesRead().map((named) => [named, 'inherited']))
  }
}

class Invoked {
  static HOME = '/home/someone'
  static SECONDS_FOR_GH = 60

  static withPort(given) {
    return Invocation.from([], { [Invocation.PORT_VARIABLE]: given }, Invoked.HOME)
  }

  static bare() {
    return Invocation.from([], {}, Invoked.HOME)
  }

  static withConfigDirectory(given) {
    return Invocation.from([], { [Invocation.CONFIG_VARIABLE]: given }, Invoked.HOME)
  }

  static withHome(given) {
    return Invocation.from([], {}, given)
  }

  static withHarvestTable(given) {
    return Invocation.from([], { [Invocation.HARVEST_TABLE_VARIABLE]: given }, Invoked.HOME)
  }

  static harvesting(environment) {
    return Invocation.harvestEnvironment(environment, { ghTimeoutMs: Invoked.SECONDS_FOR_GH * 1000 })
  }
}

describe('Invocation', () => {
  it('with_nothing_asked_for_it_settles_on_the_port_the_documentation_promises', () => {
    expect(Invoked.bare().port).toBe(8787)
  })

  it('the_port_asked_for_is_the_one_it_carries_so_the_caller_can_pick_one', () => {
    expect(Invoked.withPort('9001').port).toBe(9001)
  })

  it('port_zero_is_carried_through_because_that_is_how_an_ephemeral_port_is_asked_for', () => {
    expect(Invoked.withPort('0').port).toBe(0)
  })

  it('a_port_that_is_not_a_whole_number_is_refused_instead_of_being_coerced_into_one', () => {
    const refused = ['abc', '', ' ', '0x22', '1e3', '+8919', '-1', '8919abc']
      .map((given) => Invoked.withPort(given).outcome)

    expect(refused).toEqual(Array(8).fill(InvocationOutcome.MALFORMED_PORT))
  })

  it('a_port_above_the_last_one_that_exists_is_refused_before_anything_tries_to_bind_it', () => {
    expect(Invoked.withPort('70000').outcome).toBe(InvocationOutcome.MALFORMED_PORT)
    expect(Invoked.withPort('65535').outcome).toBe(InvocationOutcome.READY)
  })

  it('the_refusal_names_the_variable_and_the_value_so_the_reader_can_fix_it_without_guessing', () => {
    expect(Invoked.withPort('abc').reason).toBe(
      'CT_API_PORT must be an integer between 0 and 65535, got "abc"'
    )
  })

  it('an_argument_is_refused_because_this_program_takes_none_and_would_otherwise_ignore_it', () => {
    const refused = Invocation.from(['--port', '9000'], {})

    expect(refused.outcome).toBe(InvocationOutcome.UNEXPECTED_ARGUMENT)
    expect(refused.reason).toBe('unexpected argument: "--port"')
  })

  it('an_argument_is_refused_before_the_port_is_even_read_so_the_first_wrong_thing_is_the_one_named', () => {
    const refused = Invocation.from(['--port'], { [Invocation.PORT_VARIABLE]: 'abc' })

    expect(refused.outcome).toBe(InvocationOutcome.UNEXPECTED_ARGUMENT)
  })

  it('a_refused_invocation_carries_no_port_that_a_consumer_could_bind_by_mistake', () => {
    expect(Invoked.withPort('abc').port).toBe(null)
  })

  it('a_ready_invocation_cannot_be_built_carrying_a_reason_to_refuse_it', () => {
    expect(() =>
      new Invocation({ outcome: InvocationOutcome.READY, port: 8787, reason: 'why' })
    ).toThrow(/disagrees with its reason/)
  })

  it('an_outcome_outside_the_vocabulary_raises_instead_of_travelling_on_as_a_string', () => {
    expect(() => new Invocation({ outcome: 'invented', port: null, stateRoot: null, reason: 'x' }))
      .toThrow(/InvocationOutcome member/)
  })

  it('a_claim_variable_the_api_inherited_never_reaches_a_harvest_it_would_make_the_plugin_refuse', () => {
    const composed = Invoked.harvesting({ CT_CLAIM_SETTLE_MS: '500', CT_CLAIM_FIXTURE: '{"pr":{}}' })

    expect(composed.CT_CLAIM_SETTLE_MS).toBe(undefined)
    expect(composed.CT_CLAIM_FIXTURE).toBe(undefined)
  })

  it('the_harvest_caps_the_gh_the_plugin_launches_even_when_the_api_inherited_a_longer_cap', () => {
    const composed = Invoked.harvesting({ CT_CLAIM_CHILD_TIMEOUT_MS: '600000' })

    expect(composed.CT_CLAIM_CHILD_TIMEOUT_MS).toBe('60000')
  })

  it('everything_the_api_was_started_with_that_is_not_a_claim_variable_travels_on_untouched', () => {
    const started = { PATH: '/usr/bin', HOME: '/home/ct', CT_CLAIM_FIXTURE: '{"pr":{}}' }

    expect(Invoked.harvesting(started)).toEqual({
      PATH: '/usr/bin', HOME: '/home/ct', CT_CLAIM_CHILD_TIMEOUT_MS: '60000',
    })
    expect(started.CT_CLAIM_FIXTURE).toBe('{"pr":{}}')
  })

  it('the_budget_variable_it_fixes_is_the_one_the_plugin_reads_so_the_two_halves_of_that_contract_cannot_drift', () => {
    expect(PluginEnvironment.claimVariablesRead()).toContain(Invocation.CHILD_TIMEOUT_VARIABLE)
  })

  it('every_claim_variable_the_plugin_reads_is_stripped_by_the_prefix_except_the_budget_the_harvest_fixes', () => {
    const composed = Invoked.harvesting(PluginEnvironment.inheritedFromAClaimingShell())

    expect(Object.keys(composed)).toEqual([Invocation.CHILD_TIMEOUT_VARIABLE])
    expect(composed[Invocation.CHILD_TIMEOUT_VARIABLE]).toBe('60000')
  })
})

describe('Invocation resolving where Control Tower keeps its state', () => {
  it('with_nothing_asked_for_the_state_root_hangs_off_the_home_of_whoever_runs_it', () => {
    expect(Invoked.bare().stateRoot).toBe('/home/someone/.claude/control-tower')
  })

  it('the_configuration_directory_asked_for_wins_over_the_home_because_that_is_what_the_plugin_honours', () => {
    expect(Invoked.withConfigDirectory('/elsewhere/cfg').stateRoot)
      .toBe('/elsewhere/cfg/control-tower')
  })

  it('a_configuration_directory_asked_for_as_empty_falls_back_to_the_home_instead_of_a_relative_path', () => {
    expect(Invoked.withConfigDirectory('').stateRoot).toBe('/home/someone/.claude/control-tower')
  })

  it('a_home_that_resolves_to_nothing_is_refused_by_name_instead_of_writing_the_go_where_nobody_reads', () => {
    const refused = Invoked.withHome('')

    expect(refused.outcome).toBe(InvocationOutcome.UNKNOWN_STATE_HOME)
    expect(refused.reason).toBe(
      'the home directory of whoever runs this could not be resolved, so there is no absolute path for the state Control Tower shares with its plugin: set HOME, or CLAUDE_CONFIG_DIR to an absolute path'
    )
  })

  it('a_configuration_directory_that_is_not_absolute_is_refused_for_the_same_reason', () => {
    expect(Invoked.withConfigDirectory('relative/cfg').outcome)
      .toBe(InvocationOutcome.UNKNOWN_STATE_HOME)
  })

  it('a_refused_invocation_carries_no_state_root_a_consumer_could_write_into_by_mistake', () => {
    expect(Invoked.withPort('abc').stateRoot).toBe(null)
    expect(Invoked.withHome('').stateRoot).toBe(null)
  })

  it('an_argument_is_refused_before_the_state_root_is_even_resolved', () => {
    expect(Invocation.from(['--port'], {}, '').outcome)
      .toBe(InvocationOutcome.UNEXPECTED_ARGUMENT)
  })
})

describe('Invocation resolving the BigQuery harvest table', () => {
  it('a_well_formed_harvest_table_in_the_environment_reaches_the_invocation_parsed', () => {
    const ready = Invoked.withHarvestTable('p:d.t')

    expect(ready.outcome).toBe(InvocationOutcome.READY)
    expect(ready.harvestTable).toBe('p:d.t')
    expect(ready.stateRoot).toBe('/home/someone/.claude/control-tower')
  })

  it('without_the_variable_or_with_it_empty_there_is_no_harvest_table_and_the_port_still_settles', () => {
    expect(Invoked.bare().harvestTable).toBe(null)
    expect(Invoked.bare().port).toBe(8787)
    expect(Invoked.withHarvestTable('').harvestTable).toBe(null)
    expect(Invoked.withHarvestTable('').port).toBe(8787)
  })

  it('a_malformed_harvest_table_refuses_the_start_naming_the_variable_and_what_it_got', () => {
    const refused = Invoked.withHarvestTable('not-a-table')

    expect(refused.outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
    expect(refused.reason).toBe(
      'CT_HARVEST_BQ_TABLE must look like project:dataset.table, got "not-a-table"'
    )
  })

  it('a_project_that_starts_with_a_hyphen_is_refused_here_because_it_would_reach_the_plugin_as_a_flag', () => {
    const refused = Invoked.withHarvestTable('-o:d.t')

    expect(refused.outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
    expect(refused.reason).toBe('CT_HARVEST_BQ_TABLE must look like project:dataset.table, got "-o:d.t"')
  })

  it('a_table_whose_dataset_or_whose_name_is_missing_is_refused_before_it_can_reach_an_argv', () => {
    expect(Invoked.withHarvestTable('p:d').outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
    expect(Invoked.withHarvestTable('p.d.t').outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
    expect(Invoked.withHarvestTable('p:d.t extra').outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
  })
})
