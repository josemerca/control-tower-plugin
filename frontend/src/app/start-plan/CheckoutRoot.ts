const SHAPE = /^\/(?:[^/\n]+(?:\/[^/\n]+)*)?$/
const EXAMPLE = '/Users/you/repos/name'

const isWellFormed = (text: string): boolean => SHAPE.test(text)

export const CheckoutRoot = {
  EXAMPLE,
  isWellFormed,
}
