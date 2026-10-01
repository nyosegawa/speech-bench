// A worker that speaks speech.cpp's protocol for the tests: it reports the sample rate its environment sets, and
// answers each request with two chunks of one sample each, the length of the text and then the length of the voice.
import readline from 'node:readline'

const send = (message) => console.log(`ASIST_JSON:${JSON.stringify(message)}`)
const sample = (value) => {
  const bytes = Buffer.alloc(2)
  bytes.writeInt16LE(value)
  return bytes.toString('base64')
}
console.log('loading the model')
send({ type: 'ready', sampleRate: Number(process.env.FAKE_WORKER_RATE) })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.language !== 'ja-JP') return send({ type: 'error', id: request.id, error: `no ${request.language}` })
  send({ type: 'chunk', id: request.id, pcm: sample(request.text.length) })
  send({ type: 'chunk', id: request.id, pcm: sample(request.voice.length) })
  send({ type: 'end', id: request.id })
})
