class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static opened: FakeEventSource[] = []

  readonly url: string
  readyState: number = FakeEventSource.CONNECTING
  closes = 0

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.opened.push(this)
  }

  close() {
    this.closes += 1
    this.readyState = FakeEventSource.CLOSED
  }

  receive(data: string) {
    this.readyState = FakeEventSource.OPEN
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  failWith(data: string) {
    this.dispatchEvent(new MessageEvent('error', { data }))
  }

  dropConnection() {
    this.dispatchEvent(new Event('error'))
  }

  static install() {
    FakeEventSource.opened = []
    vi.stubGlobal('EventSource', FakeEventSource)
  }

  static last(): FakeEventSource {
    const last = FakeEventSource.opened.at(-1)
    if (last === undefined) throw new Error('no EventSource was opened')

    return last
  }
}

export { FakeEventSource }
