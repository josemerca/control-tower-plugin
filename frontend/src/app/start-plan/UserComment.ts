const isWellFormed = (text: string): boolean => text.trim().length > 0

const normalize = (text: string): string => text.trim()

export const UserComment = {
  isWellFormed,
  normalize,
}
