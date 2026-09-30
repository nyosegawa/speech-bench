/** One utterance to transcribe and the text it should give. */
export interface Utterance {
  /** Unique within its dataset. */
  id: string
  audio: string
  reference: string
}

/** A set of utterances in one locale, named so that runs over the same set can be compared. */
export interface UtteranceSet {
  name: string
  locale: string
  utterances: Utterance[]
}
