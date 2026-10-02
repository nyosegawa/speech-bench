/**
 * The message of an error followed by those of the errors that caused it, each said once. fetch reports a refused
 * or dropped connection as "fetch failed" and keeps the reason, such as "other side closed", only in its cause, and
 * a connection tried at several addresses keeps one reason for each in an AggregateError.
 */
export function describeError(error: unknown): string {
  const messages: string[] = []
  const seen = new Set<unknown>()
  const add = (message: string): void => {
    if (message !== '' && !messages.some((known) => known.includes(message))) messages.push(message)
  }
  for (let current: unknown = error; current !== undefined && !seen.has(current); current = current instanceof Error ? current.cause : undefined) {
    seen.add(current)
    add(current instanceof Error ? current.message : String(current))
    if (current instanceof AggregateError) for (const each of current.errors) add(each instanceof Error ? each.message : String(each))
  }
  return messages.join('\n  caused by: ')
}
