import '@testing-library/jest-dom/vitest'

const localStorageOfTheJsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window
  .localStorage

if (localStorageOfTheJsdomWindow !== undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageOfTheJsdomWindow,
    configurable: true,
  })
}

afterEach(() => {
  localStorage.clear()
})
