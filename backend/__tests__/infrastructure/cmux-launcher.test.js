import { describe, it, expect } from 'vitest'
import { CmuxLauncher } from '../../src/infrastructure/cmux-launcher.js'

describe('CmuxLauncher', () => {
  const script = () => CmuxLauncher.scriptFor({
    sentinel: '/tmp/run/started',
    errand: 'escribe el plan',
    bin: 'claude',
  })

  it('what_gets_typed_is_short_because_every_character_races_the_login_shell', () => {
    expect(CmuxLauncher.typedFor('/tmp/run/launch.sh')).toBe(". '/tmp/run/launch.sh'")
    expect(CmuxLauncher.typedFor('/tmp/run/launch.sh').length).toBeLessThan(120)
  })

  it('the_sentinel_is_written_before_the_agent_starts_because_waiting_for_it_to_finish_is_the_thing_we_cannot_do', () => {
    const written = script().indexOf('> ')
    const started = script().indexOf("claude '")

    expect(written).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(-1)
    expect(written).toBeLessThan(started)
  })

  it('a_second_sourcing_starts_nothing_because_the_line_gets_resent_when_the_pty_eats_it', () => {
    expect(script()).toContain("if [ -e '/tmp/run/started' ]; then")
  })

  it('it_records_whether_the_binary_resolves_inside_that_shell_which_is_the_only_place_it_can_be_asked', () => {
    expect(script()).toContain('command -v claude')
  })

  it('the_errand_travels_through_the_file_so_no_prompt_can_bite_it', () => {
    expect(script()).toContain('escribe el plan')
  })

  it('a_sentinel_it_wrote_reads_back_as_a_started_command', () => {
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tok\t/repo/.worktrees/42\n`)).toEqual({
      resolved: true,
      cwd: '/repo/.worktrees/42',
    })
  })

  it('a_sentinel_that_says_the_binary_was_missing_is_read_as_such_and_not_as_absent', () => {
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tmissing\t/repo/x\n`).resolved).toBe(false)
  })

  it('anything_that_is_not_one_of_ours_reads_as_nothing_instead_of_being_guessed', () => {
    expect(CmuxLauncher.read('')).toBe(null)
    expect(CmuxLauncher.read('garbage')).toBe(null)
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t9\tok\t/repo/x`)).toBe(null)
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tmaybe\t/repo/x`)).toBe(null)
  })

  it('a_directory_with_a_tab_in_it_survives_because_it_is_the_last_field', () => {
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tok\t/repo/od\td\n`).cwd).toBe('/repo/od\td')
  })
})
