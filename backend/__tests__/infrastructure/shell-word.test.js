import { describe, it, expect } from 'vitest'
import { ShellWord } from '../../src/infrastructure/shell-word.js'

describe('ShellWord', () => {
  it('a_plain_word_comes_back_wrapped_so_a_space_added_later_cannot_split_it', () => {
    expect(ShellWord.quote('/tmp/launch.sh')).toBe("'/tmp/launch.sh'")
  })

  it('a_single_quote_inside_is_closed_and_reopened_instead_of_ending_the_word', () => {
    expect(ShellWord.quote("it's")).toBe("'it'\\''s'")
  })

  it('what_a_shell_would_expand_travels_literal', () => {
    expect(ShellWord.quote('$HOME `id` "x"')).toBe('\'$HOME `id` "x"\'')
  })
})
