import { CHAT_QUICK_REPLIES_MAX_ENTRIES, CHAT_QUICK_REPLY_MAX_LENGTH } from 'src/constants'

// Spec 0034 (chat), AC-13: the one tap presets are co-op settings. A list is at most 8 entries, each
// 1 to 100 characters after trimming. Returns the trimmed list, or the sentence that refuses it by name.
export function checkChatQuickReplies(
  key: 'chatQuickRepliesDispatch' | 'chatQuickRepliesCourier',
  value: unknown
): { replies: string[] } | { refusal: string } {
  if (!Array.isArray(value)) {
    return { refusal: `${key} must be a list of texts` }
  }
  if (value.length > CHAT_QUICK_REPLIES_MAX_ENTRIES) {
    return { refusal: `${key} can have at most ${CHAT_QUICK_REPLIES_MAX_ENTRIES} presets` }
  }
  const replies: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { refusal: `${key} must be a list of texts` }
    }
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      return { refusal: `${key} cannot have an empty preset` }
    }
    if (trimmed.length > CHAT_QUICK_REPLY_MAX_LENGTH) {
      return { refusal: `${key}: each preset can be at most ${CHAT_QUICK_REPLY_MAX_LENGTH} characters` }
    }
    replies.push(trimmed)
  }
  return { replies }
}

// A stored list that breaks the rule (only a hand edit of the table can do that) is read as null,
// so the caller falls back to the defaults and logs it.
export function storedChatQuickReplies(value: unknown): string[] | null {
  const checked = checkChatQuickReplies('chatQuickRepliesDispatch', value)
  return 'replies' in checked ? checked.replies : null
}
