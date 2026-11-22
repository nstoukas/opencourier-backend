import { CHAT_QUICK_REPLIES_MAX_ENTRIES, CHAT_QUICK_REPLY_MAX_LENGTH } from 'src/constants'
import { Language } from 'src/localization/translate'
import { ChatPreset } from 'src/shared-types/config'

// Spec 0034 (chat), AC-13: the one tap presets are co-op settings. A list is at most 8 entries, each 1 to
// 100 characters after trimming. Since spec 0054 (AC-7) each entry is `{ el, en }`: one of the two may be
// empty, never both. An entry sent as plain text (an admin page from before spec 0054) is the Greek one,
// as the stored presets were written in Greek. Returns the trimmed list, or the sentence that refuses it.
export function checkChatQuickReplies(
  key: 'chatQuickRepliesDispatch' | 'chatQuickRepliesCourier',
  value: unknown
): { replies: ChatPreset[] } | { refusal: string } {
  if (!Array.isArray(value)) {
    return { refusal: `${key} must be a list of presets` }
  }
  if (value.length > CHAT_QUICK_REPLIES_MAX_ENTRIES) {
    return { refusal: `${key} can have at most ${CHAT_QUICK_REPLIES_MAX_ENTRIES} presets` }
  }
  const replies: ChatPreset[] = []
  for (const entry of value) {
    const preset = asPreset(entry)
    if (!preset) {
      return { refusal: `${key} must be a list of presets, each a text or { el, en }` }
    }
    if (preset.el === '' && preset.en === '') {
      return { refusal: `${key} cannot have an empty preset` }
    }
    if (preset.el.length > CHAT_QUICK_REPLY_MAX_LENGTH || preset.en.length > CHAT_QUICK_REPLY_MAX_LENGTH) {
      return { refusal: `${key}: each preset can be at most ${CHAT_QUICK_REPLY_MAX_LENGTH} characters` }
    }
    replies.push(preset)
  }
  return { replies }
}

// One entry, trimmed: a text (the Greek), or an object with text `el` and `en` (either may be left out).
function asPreset(entry: unknown): ChatPreset | null {
  if (typeof entry === 'string') return { el: entry.trim(), en: '' }
  if (typeof entry !== 'object' || entry === null) return null
  const { el, en } = entry as { el?: unknown; en?: unknown }
  if ((el !== undefined && typeof el !== 'string') || (en !== undefined && typeof en !== 'string')) return null
  return { el: (el ?? '').trim(), en: (en ?? '').trim() }
}

// A stored list that breaks the rule (only a hand edit of the table can do that) is read as null,
// so the caller falls back to the defaults and logs it. A list stored before spec 0054 (plain texts)
// reads as Greek presets.
export function storedChatQuickReplies(value: unknown): ChatPreset[] | null {
  const checked = checkChatQuickReplies('chatQuickRepliesDispatch', value)
  return 'replies' in checked ? checked.replies : null
}

// What a reader sees of one preset: their language, else the other one (AC-7).
export function chatPresetText(preset: ChatPreset, language: Language): string {
  return (language === 'en' ? preset.en || preset.el : preset.el || preset.en) ?? ''
}
