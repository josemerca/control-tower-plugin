const DARK_QUERY = '(prefers-color-scheme: dark)'
const ATTRIBUTE = 'data-theme'

type ThemeName = 'light' | 'dark'

const nameFor = (prefersDark: boolean): ThemeName => (prefersDark ? 'dark' : 'light')

const apply = (root: HTMLElement, prefersDark: boolean) => {
  root.setAttribute(ATTRIBUTE, nameFor(prefersDark))
}

const followSystemPreference = (root: HTMLElement = document.documentElement) => {
  const preference = window.matchMedia(DARK_QUERY)
  apply(root, preference.matches)
  preference.addEventListener('change', (event) => apply(root, event.matches))
}

export const Theme = {
  ATTRIBUTE,
  DARK_QUERY,
  followSystemPreference,
}
export type { ThemeName }
