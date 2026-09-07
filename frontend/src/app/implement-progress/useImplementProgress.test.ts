import { renderHook } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'

const answerWith = (answer: { status: number; body: string }) =>
  vi.fn(async () => new Response(answer.body, { status: answer.status }))

describe('useImplementProgress', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('should poll again after the interval while the run is still in progress', async () => {
    const fetching = answerWith(ImplementProgressMother.progress())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => useImplementProgress(ImplementProgressMother.ISSUE, ImplementProgressMother.ROOT, ImplementProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('should stop polling once the run is delivered', async () => {
    const fetching = answerWith(ImplementProgressMother.delivered())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => useImplementProgress(ImplementProgressMother.ISSUE, ImplementProgressMother.ROOT, ImplementProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(15000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should stop polling once the backend refuses the request for good', async () => {
    const fetching = answerWith(ImplementProgressMother.malformedRoot())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => useImplementProgress(ImplementProgressMother.ISSUE, ImplementProgressMother.ROOT, ImplementProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(15000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should stop polling once the component unmounts', async () => {
    const fetching = answerWith(ImplementProgressMother.notRead())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    const { unmount } = renderHook(() => useImplementProgress(ImplementProgressMother.ISSUE, ImplementProgressMother.ROOT, ImplementProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(15000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })
})
