const SHAPE = /^\/(?:[^/\n]+(?:\/[^/\n]+)*)?$/
const EXAMPLE = '/Users/tu-usuario/code/name'

const normalize = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed === '') return ''

  const withoutTrailing = trimmed.replace(/\/+$/, '')

  return withoutTrailing === '' ? '/' : withoutTrailing
}

const isWellFormed = (text: string): boolean => SHAPE.test(normalize(text))

export const LocalPath = {
  EXAMPLE,
  normalize,
  isWellFormed,
}
