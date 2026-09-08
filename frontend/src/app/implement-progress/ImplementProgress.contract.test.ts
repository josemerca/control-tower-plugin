import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'

const BACKEND_VOCABULARY = join(process.cwd(), '..', 'backend', 'src', 'domain', 'value-objects', 'implementation-state.js')
const DECLARATION = /export const ImplementationStep = Object\.freeze\(\{([^}]*)\}\)/
const MEMBER = /^\s*[A-Z0-9_]+:\s*'([^']+)',?\s*$/

const backendSteps = (): string[] => {
  const source = readFileSync(BACKEND_VOCABULARY, 'utf8')
  const declared = source.match(DECLARATION)
  if (declared === null) throw new Error(`${BACKEND_VOCABULARY} no longer declares ImplementationStep as this reads it`)

  return declared[1]
    .split('\n')
    .map((line) => line.match(MEMBER))
    .filter((member): member is RegExpMatchArray => member !== null)
    .map((member) => member[1])
}

describe('the steps this frontend paints and the backend sends', () => {
  it('should carry the same vocabulary on both halves, because a step the backend adds arrives here as a red refusal', () => {
    expect([...Object.values(ImplementationStep)].sort()).toEqual(backendSteps().sort())
  })

  it('should read the backend declaration it compares against, so a rename cannot leave this test vacuous', () => {
    expect(backendSteps()).toContain(ImplementationStep.IN_REVIEW)
  })
})
