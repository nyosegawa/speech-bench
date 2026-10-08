// A worker that speaks speech.cpp's worker protocol 3 for the tests. It reports the protocol and the sample rate its
// environment sets, and answers a synthesis with progress and then, 0.1 s later, chunks of one sample each: the
// length of the text, the length of the voice, the seed and the steps it was sent, or -1 for one it was not. Some
// texts make it break the protocol as a defective worker would.
import readline from 'node:readline'

const send = (message) => console.log(JSON.stringify(message))
const sample = (value) => {
  const bytes = Buffer.alloc(2)
  bytes.writeInt16LE(value)
  return bytes.toString('base64')
}
const failure = (code, option, message) => ({ code, option, message })

console.error('loading the model')
send({ type: 'ready', protocol: Number(process.env.FAKE_WORKER_PROTOCOL ?? 3), version: '0.0.0', model: { task: 'synthesis', sample_rate: Number(process.env.FAKE_WORKER_RATE) } })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  const { id } = request
  if (request.type === 'cancel') return
  if (request.type !== 'synthesize') return send({ type: 'error', id, error: failure('unsupported', 'type', `a synthesis model takes no ${request.type}`) })
  if (request.language !== 'ja-JP') return send({ type: 'error', id, error: failure('out_of_range', 'language', `no ${request.language}`) })
  if (request.text === 'anonymous') return send({ type: 'error', error: failure('invalid_argument', 'id', 'a request needs an id') })
  if (request.text === 'cancelled') return send({ type: 'cancelled', id })
  const samples = [request.text.length, request.voice.length, request.seed ?? -1, request.steps ?? -1]
  send({ type: 'progress', id, done: 0.5 })
  setTimeout(() => {
    samples.forEach((value, seq) => send({ type: 'chunk', id, seq, pcm: sample(value) }))
    const end = { type: 'end', id, seed: request.seed ?? 7, samples: samples.length, stop: 'complete' }
    send(end)
    if (request.text === 'twice') send(end)
  }, 100)
})
