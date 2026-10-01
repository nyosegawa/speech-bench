/** Whether a value has the shape of a BCP 47 language tag with an optional region, such as ja-JP or es-419. */
export const isLanguageTag = (value: string): boolean => /^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$/.test(value)

const parts = (tag: string): [string, string | undefined] => {
  const [language, region] = tag.split('-')
  return [(language ?? '').toLowerCase(), region?.toUpperCase()]
}

export const languageOf = (tag: string): string => parts(tag)[0]

/**
 * Whether a BCP 47 tag a model declares covers a locale. A tag without a region, such as `pt`, covers
 * every region of the language; `pt-BR` covers Brazil only, so it does not cover `pt-PT`.
 */
export function tagCovers(tag: string, locale: string): boolean {
  const [tagLanguage, tagRegion] = parts(tag)
  const [localeLanguage, localeRegion] = parts(locale)
  return tagLanguage === localeLanguage && (tagRegion === undefined || tagRegion === localeRegion)
}

/**
 * Languages whose errors are counted per character (CER) rather than per word (WER). Japanese and Chinese
 * write no spaces between words; Korean is scored by character in the public comparisons this follows.
 */
export const scoredByCharacter = (locale: string): boolean => ['ja', 'ko', 'zh', 'yue', 'th'].includes(languageOf(locale))

/** The English name of a language, which Qwen3-ASR is told at the start of its answer. */
export const ENGLISH_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ja: 'Japanese',
  en: 'English',
  fr: 'French',
  de: 'German',
  hi: 'Hindi',
  id: 'Indonesian',
  it: 'Italian',
  ko: 'Korean',
  pt: 'Portuguese',
  es: 'Spanish',
  zh: 'Chinese'
}
