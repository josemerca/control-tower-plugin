const SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9._-]*$/
const EXAMPLE = 'owner/name'

const isWellFormed = (text: string): boolean => SHAPE.test(text)

export const RepositoryName = {
  EXAMPLE,
  isWellFormed,
}
