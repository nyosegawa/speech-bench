/** A DevTools protocol connection to ASIST's main window, which ASIST opens when started with --remote-debugging-port. */
export interface Cdp {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Evaluates an expression in the page and returns its value, awaiting a promise. */
  evaluate: <T>(expression: string) => Promise<T>
  on: (method: string, listener: (params: Record<string, unknown>) => void) => () => void
  close: () => void
}

interface Target {
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

export async function connectToAsist(port: number): Promise<Cdp> {
  let targets: Target[]
  try {
    targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[]
  } catch {
    throw new Error(`nothing answers the DevTools protocol on 127.0.0.1:${port}; start ASIST with --remote-debugging-port=${port}`)
  }
  // The main window loads the renderer's index.html; the other windows of ASIST load other pages.
  const pages = targets.filter((target) => target.type === 'page' && /[/\\]renderer[/\\]index\.html(?:[?#].*)?$/.test(target.url))
  if (pages.length !== 1 || !pages[0]!.webSocketDebuggerUrl) {
    throw new Error(`expected one ASIST main window on port ${port}, found ${pages.length}: ${targets.map((target) => target.url).join(', ')}`)
  }
  const socket = new WebSocket(pages[0]!.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${pages[0]!.webSocketDebuggerUrl}`)), { once: true })
  })
  let nextId = 1
  const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } }
    if (message.id !== undefined) {
      const waiting = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiting?.reject(new Error(message.error.message))
      else waiting?.resolve(message.result ?? {})
    } else if (message.method) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {})
    }
  })
  socket.addEventListener('close', () => {
    for (const waiting of pending.values()) waiting.reject(new Error('ASIST closed the DevTools connection'))
    pending.clear()
  })
  const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error('the DevTools connection to ASIST is closed'))
        return
      }
      const id = nextId++
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return {
    send,
    async evaluate<T>(expression: string): Promise<T> {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      const exception = response.exceptionDetails as { text: string; exception?: { description?: string } } | undefined
      if (exception) throw new Error(`in ASIST: ${exception.exception?.description ?? exception.text}`)
      return (response.result as { value: T }).value
    },
    on(method, listener) {
      const set = listeners.get(method) ?? new Set()
      set.add(listener)
      listeners.set(method, set)
      return () => set.delete(listener)
    },
    close: () => socket.close()
  }
}
