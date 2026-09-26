/**
 * CMU lists sounds but not senses. These usage labels help the model select a
 * listed pronunciation by grammar/meaning, rather than reason from IPA alone.
 * Every key must match the bundled dictionary; labels never introduce new IPA.
 * Sense references: https://dictionary.cambridge.org/dictionary/english/{word}
 */
export const PRONUNCIATION_USAGE: Record<string, Record<string, string>> = {
  read: {
    '/ˈɹɛd/': 'past tense or past participle of read; e.g. I read yesterday; I have read it',
    '/ˈɹid/': 'base form, infinitive, or present tense of read; e.g. I read every day; also the noun a good read'
  },
  live: {
    '/ˈɫaɪv/': 'adjective or adverb: alive, active, or happening in real time; e.g. live music',
    '/ˈɫɪv/': 'verb: reside or remain alive; e.g. I live here'
  },
  lead: {
    '/ˈɫɛd/': 'noun: the metal, or material in a pencil',
    '/ˈɫid/': 'verb: guide; noun: a leading position, clue, or leash'
  },
  wind: {
    '/ˈwaɪnd/': 'verb: turn, twist, wrap, or follow a curving course; e.g. wind a clock',
    '/ˈwɪnd/': 'noun: moving air; verb: make someone breathless'
  },
  record: {
    '/ˈɹɛkɝd/': 'noun: stored information, a recording, or a best achievement',
    '/ɹəˈkɔɹd/': 'verb: capture or write down information or sound',
    '/ɹɪˈkɔɹd/': 'verb: capture or write down information or sound'
  }
}
