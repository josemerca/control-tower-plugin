const SHAPE = /^[A-Z][A-Z0-9_]*-\d+$/
const EXAMPLE = 'ABC-123'

const isWellFormed = (text: string): boolean => SHAPE.test(text)

export const TicketKey = {
  EXAMPLE,
  isWellFormed,
}
