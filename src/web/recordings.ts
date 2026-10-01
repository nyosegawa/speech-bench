import type http from 'node:http'
import { isLanguageTag } from '../core/language.ts'
import { loadPrompts } from '../datasets/prompts.ts'
import { isSafeName, readManifest, recordedSpeakers, recordingFile, saveRecording, type RecordingFolder } from '../datasets/recordings.ts'
import type { UrlOf } from '../pages/listen.ts'
import type { RecordingSession, SavedRecording, SpeakerRow } from './api.ts'
import { RequestError } from './request-error.ts'

/** A recording is at most this large: 60 s of 16 kHz 16-bit audio, with room for the header. */
const MAX_BODY_BYTES = 60 * 16_000 * 2 + 1_024

export function folderOf(locale: string, speaker: string): RecordingFolder {
  if (!isLanguageTag(locale)) throw new RequestError(`${locale} is not a BCP 47 tag such as ja-JP`)
  if (!isSafeName(speaker)) throw new RequestError('a speaker is named in lower-case letters, digits, - and _')
  return { locale, speaker }
}

export const speakerRows = (): SpeakerRow[] => recordedSpeakers().map((folder) => ({ ...folder, recordings: readManifest(folder).length }))

/** What the recording page needs for one speaker: the locale's prompts and the recordings so far. */
export function recordingSession(folder: RecordingFolder, urlOf: UrlOf): RecordingSession {
  return {
    ...folder,
    prompts: loadPrompts('record', folder.locale),
    recorded: readManifest(folder).map((entry) => ({ ...entry, url: urlOf(recordingFile(folder, entry)) }))
  }
}

/**
 * Saves the recording a request carries: the WAVE file is the body, so the text travels URI-encoded in a header.
 * A body that is not audio/wav is refused, since a page of another site can send other types without asking.
 */
export async function saveFrom(request: http.IncomingMessage, folder: RecordingFolder, id: string, urlOf: UrlOf): Promise<SavedRecording> {
  if (request.headers['content-type'] !== 'audio/wav') throw new RequestError('a recording is sent as audio/wav')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new RequestError('the recording is longer than 60 s')
    chunks.push(chunk as Buffer)
  }
  const text = decodeURIComponent(String(request.headers['x-recording-text'] ?? ''))
  const entry = saveRecording(folder, id, text, Buffer.concat(chunks))
  return { ...entry, url: urlOf(recordingFile(folder, entry)) }
}
