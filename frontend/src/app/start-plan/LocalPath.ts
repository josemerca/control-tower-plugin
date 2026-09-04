const EXAMPLE = '/Users/tu-usuario/code/name'

const isWellFormed = (text: string): boolean => {
  const trimmed = text.trim()

  return trimmed.length > 0 && trimmed.startsWith('/')
}

export const LocalPath = {
  EXAMPLE,
  isWellFormed,
}
