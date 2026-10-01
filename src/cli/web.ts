import { parseArgs } from 'node:util'
import { startWebServer } from '../web/server.ts'

/** The web app on this computer only, until the process is stopped. */
export async function web(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string', default: '5280' } } })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('--port is a port number, or 0 for any free one')
  const { url } = await startWebServer(port)
  console.log(`speech-bench is at ${url}; press Ctrl-C to stop.`)
}
