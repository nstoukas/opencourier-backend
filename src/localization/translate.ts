// Spec 0054 (row 47): the server's own small translator. The apps use i18next; the backend only needs to
// fill a few templates (push texts, mails, the English `message` of an event), so it reads the same
// template syntax i18next reads, without adding the library:
//   {{name}}            the param's value
//   {{name, clock}}     an ISO time shown as HH:mm in Europe/Athens
//   {{name, list}}      an array of parts as a list ("Small, Medium and Large" / "Small, Medium και Large")
//   {{name, comma}}     an array of parts joined with ", "
//   {{name, money}}     an amount in cents, with the sibling `currency` value, as the language writes money
//                       ("3,50 €" / "€3.50")
//   {{name, decimal}}   a number with the language's decimal mark, at most one decimal ("1,2" / "1.2")
//   {{name, day}}       an ISO time's day on Athens time, seen from now: "today", "tomorrow", "on 3 August"
//   {{name, when}}      an ISO time as HH:mm, followed by its day when that is not today ("09:00 tomorrow")
//   $t(server.enum.x.{{name}})   another key, looked up after the values are filled in (i18next nesting)
// A param that is a part, or an array of parts, is rendered first (see src/shared-types/event-messages.ts).
// The apps' renderers know the same formats, so a template means the same thing everywhere. The English
// event templates use none of the last four: the stored English record must read as it always has.
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { EventMessageParams, EventParamValue, EventPart } from 'src/shared-types/event-messages'
import { el } from './el'
import { en, Translations } from './en'

// The languages the co-op's apps speak. Greek is the default (AC-1).
export const LANGUAGES = ['el', 'en'] as const
// `typeof LANGUAGES[number]` is the union 'el' | 'en', taken from the list so the two never drift apart.
export type Language = (typeof LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'el'

const RESOURCES: Record<Language, Translations> = { el, en }

// A stored or sent language read safely: anything other than a known language is Greek.
export function languageOf(value: string | null | undefined): Language {
  return value === 'en' || value === 'el' ? value : DEFAULT_LANGUAGE
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'el'
}

// Each language's word for the last "and" of a list ("a, b and c"; no comma before it in either). What
// Intl.ListFormat gives for en-GB and el, written out because this project's TypeScript lib predates it.
const LIST_AND: Record<Language, string> = { el: 'και', en: 'and' }

// The locale each language formats numbers and dates with.
const LOCALE: Record<Language, string> = { el: 'el-GR', en: 'en-GB' }

// Each language's words for a day seen from today (the `day` and `when` formats).
const DAY_WORDS: Record<Language, { today: string; tomorrow: string; on: string }> = {
  el: { today: 'σήμερα', tomorrow: 'αύριο', on: 'στις' },
  en: { today: 'today', tomorrow: 'tomorrow', on: 'on' },
}

function athensDate(time: dayjs.Dayjs): string {
  return time.tz(INSTANCE_TIMEZONE).format('YYYY-MM-DD')
}

// "today", "tomorrow", or "on 3 August" (Greek "στις 3 Αυγούστου"), on Athens time.
function dayText(language: Language, time: dayjs.Dayjs): string {
  const words = DAY_WORDS[language]
  const now = dayjs()
  if (athensDate(time) === athensDate(now)) return words.today
  if (athensDate(time) === athensDate(now.add(1, 'day'))) return words.tomorrow
  const date = new Intl.DateTimeFormat(LOCALE[language], {
    day: 'numeric',
    month: 'long',
    timeZone: INSTANCE_TIMEZONE,
  }).format(time.toDate())
  return `${words.on} ${date}`
}

function listOf(language: Language, texts: string[]): string {
  if (texts.length <= 1) return texts.join('')
  return `${texts.slice(0, -1).join(', ')} ${LIST_AND[language]} ${texts[texts.length - 1]}`
}

function lookup(language: Language, key: string): string | null {
  let node: unknown = RESOURCES[language]
  for (const step of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null
    node = (node as Record<string, unknown>)[step]
  }
  return typeof node === 'string' ? node : null
}

function isPart(value: EventParamValue): value is EventPart {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A part's text in this language (its own params rendered the same way).
function renderPart(language: Language, part: EventPart): string {
  return translate(language, `server.eventPart.${part.part}`, part.params)
}

function formatValue(
  language: Language,
  value: EventParamValue | undefined,
  format: string | undefined,
  params: EventMessageParams
): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) {
    const texts = value.map((part) => renderPart(language, part))
    if (format === 'list') return listOf(language, texts)
    if (format === 'comma') return texts.join(', ')
    return texts.join('')
  }
  if (isPart(value)) return renderPart(language, value)
  if (format === 'clock' && typeof value === 'string') {
    const time = dayjs(value)
    return time.isValid() ? time.tz(INSTANCE_TIMEZONE).format('HH:mm') : value
  }
  if ((format === 'day' || format === 'when') && typeof value === 'string') {
    const time = dayjs(value)
    if (!time.isValid()) return value
    if (format === 'day') return dayText(language, time)
    const clockText = time.tz(INSTANCE_TIMEZONE).format('HH:mm')
    const day = dayText(language, time)
    return day === DAY_WORDS[language].today ? clockText : `${clockText} ${day}`
  }
  if (format === 'money' && typeof value === 'number') {
    const currency = typeof params.currency === 'string' ? params.currency : 'EUR'
    return new Intl.NumberFormat(LOCALE[language], { style: 'currency', currency }).format(value / 100)
  }
  if (format === 'decimal' && typeof value === 'number') {
    return new Intl.NumberFormat(LOCALE[language], { maximumFractionDigits: 1 }).format(value)
  }
  return String(value)
}

// The text of `key` in `language`, with its params filled in. A key missing in that language falls back
// to English, then to the key itself (what i18next shows), so a gap is visible rather than blank.
export function translate(language: Language, key: string, params: EventMessageParams = {}): string {
  const template = lookup(language, key) ?? lookup('en', key)
  if (template === null) return key
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (_match, name: string, format?: string) => formatValue(language, params[name], format, params))
  // Nested keys first, filling only the placeholders inside the key, so a value (an admin's note, say)
  // is never read as a key itself.
  const nested = template.replace(/\$t\(([^)]*)\)/g, (_match, nestedKey: string) => {
    const resolved = fill(nestedKey)
    return lookup(language, resolved) ?? lookup('en', resolved) ?? resolved
  })
  return fill(nested)
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*(?:,\s*(\w+)\s*)?\}\}/g

// An event message in a language: `server.event.<code>`.
export function renderEventMessage(language: Language, code: string, params: EventMessageParams | null): string {
  return translate(language, `server.event.${code}`, params ?? {})
}
