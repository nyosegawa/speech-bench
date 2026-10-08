// A worker that speaks speech.cpp's worker protocol 3 for the tests, as a recognition model of Japanese alone, whose
// language steers it when its environment says so, and which offers the decodings its environment lists. It collects
// the chunks of each request, refusing one out of its order, and answers its transcribe with progress and then, 0.1 s
// later, an end whose text tells what it received: the number of samples, the rate, the first and last sample, and the
// decoding when the request set one. The first sample of some utterances makes it stop at the model's limit, or break
// the protocol as a defective worker would.
import readline from 'node:readline'

const send = (message) => console.log(JSON.stringify(message))
const failure = (code, option, message) => ({ code, option, message })
const steers = process.env.FAKE_WORKER_STEERS === 'true'
const decodings = process.env.FAKE_WORKER_DECODINGS ? process.env.FAKE_WORKER_DECODINGS.split(',') : []
const decodingOption = decodings.length === 0 ? [] : [{ name: 'decoding', type: 'string', required: false, steers: true, default: decodings[0], choices: decodings }]

console.error('loading the model')
send({
  type: 'ready',
  protocol: 3,
  version: '0.0.0',
  model: { task: 'recognition', sample_rate: 16000, languages: ['ja'], options: [{ name: 'language', type: 'string', required: false, steers, default: 'auto', choices: ['ja'] }, ...decodingOption] }
})
const collecting = new Map()
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  const { id } = request
  if (request.type === 'cancel') return
  if (request.type === 'chunk') {
    const chunks = collecting.get(id) ?? []
    if (request.seq !== chunks.length) return send({ type: 'error', id, error: failure('invalid_argument', 'seq', `chunk ${request.seq} where chunk ${chunks.length} was due`) })
    chunks.push(Buffer.from(request.pcm, 'base64'))
    collecting.set(id, chunks)
    return
  }
  if (request.type !== 'transcribe') return send({ type: 'error', id, error: failure('unsupported', 'type', `a recognition model takes no ${request.type}`) })
  const audio = Buffer.concat(collecting.get(id) ?? [])
  collecting.delete(id)
  if (request.language !== 'ja') return send({ type: 'error', id, error: failure('out_of_range', 'language', `no ${request.language}`) })
  if (request.decoding !== undefined && !decodings.includes(request.decoding)) return send({ type: 'error', id, error: failure('invalid_argument', 'decoding', `no decoding ${request.decoding}`) })
  const first = audio.readInt16LE(0)
  const decoded = request.decoding === undefined ? '' : `, decoded ${request.decoding}`
  const text = `${audio.length / 2} samples at ${request.sample_rate} Hz, first ${first}, last ${audio.readInt16LE(audio.length - 2)}${decoded}`
  send({ type: 'progress', id, done: 0.5 })
  setTimeout(() => {
    if (first === 1) return send({ type: 'chunk', id, seq: 0, pcm: audio.toString('base64') })
    if (first === 2) return send({ type: 'end', id, stop: 'complete' })
    if (first === 3) return send({ type: 'end', id, text, stop: 'max_seconds' })
    send({ type: 'end', id, text, stop: first === 4 ? 'model_limit' : 'complete' })
  }, 100)
})
