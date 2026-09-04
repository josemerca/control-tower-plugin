// El backend valida esta misma forma en CheckoutRoot: barra inicial, y
// segmentos sin barras ni saltos de línea dentro. La barra final y los
// espacios de los extremos se quitan antes de mandar, porque es lo que dan
// el autocompletado del shell y «Copiar como nombre de ruta» del Finder.
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
