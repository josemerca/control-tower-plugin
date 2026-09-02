import { Theme } from 'system-ui/theme/Theme'

type Listener = (event: { matches: boolean }) => void

const systemPreferring = (dark: boolean) => {
  const listeners: Listener[] = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: dark,
      addEventListener: (_name: string, listener: Listener) => listeners.push(listener),
    })),
  )

  return { flipTo: (matches: boolean) => listeners.forEach((listener) => listener({ matches })) }
}

describe('Theme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should stamp light when the system does not prefer dark', () => {
    systemPreferring(false)
    const root = document.createElement('html')

    Theme.followSystemPreference(root)

    expect(root.getAttribute('data-theme')).toBe('light')
  })

  it('should stamp dark when the system prefers dark', () => {
    systemPreferring(true)
    const root = document.createElement('html')

    Theme.followSystemPreference(root)

    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('should follow the system when the preference changes while the page is open', () => {
    const system = systemPreferring(false)
    const root = document.createElement('html')
    Theme.followSystemPreference(root)

    system.flipTo(true)

    expect(root.getAttribute('data-theme')).toBe('dark')
  })
})
