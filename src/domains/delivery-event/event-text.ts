// Spec 0054 (row 47), AC-4: how every DeliveryEvent message is written. A writer never types the English
// sentence itself; it names a code and its values, and this builds the three columns together:
//   messageCode    the code (src/shared-types/event-messages.ts)
//   messageParams  its values
//   message        the English sentence, rendered from the code, for logs and older readers
// Spread it into an event: `{ ..., ...eventText('FOOD_READY', { at: now.toISOString() }) }`.
import {
  EventMessageCode,
  EventMessageParams,
  EventPart,
  EventPartCode,
  ParamsOf,
  PartParamsOf,
} from 'src/shared-types/event-messages'
import { renderEventMessage } from 'src/localization/translate'

export interface EventText {
  message: string
  messageCode: EventMessageCode
  messageParams: EventMessageParams
}

// `<C extends EventMessageCode>` is a generic: C is whichever code the caller names, and `ParamsOf<C>`
// then requires exactly that code's params, so a missing or misspelt value is a type error.
export function eventText<C extends EventMessageCode>(code: C, params: ParamsOf<C>): EventText {
  // ParamsOf<C> is a plain object of EventParamValue, which is what EventMessageParams describes.
  const values = params as EventMessageParams
  return { message: renderEventMessage('en', code, values), messageCode: code, messageParams: values }
}

// A piece of a message (see EventPart), checked the same way.
export function eventPart<P extends EventPartCode>(part: P, params: PartParamsOf<P>): EventPart {
  return { part, params: params as EventMessageParams }
}

// The three columns as a repository writes them. A Json column takes no plain null, so params are left
// out when there are none (the column stays null). Rows written by a path with no text keep all three null.
export function storedEventText(text: Partial<EventText> | null | undefined): {
  message: string | null
  messageCode?: string
  messageParams?: EventMessageParams
} {
  if (!text?.message) return { message: null }
  return {
    message: text.message,
    ...(text.messageCode ? { messageCode: text.messageCode } : {}),
    ...(text.messageCode && text.messageParams ? { messageParams: text.messageParams } : {}),
  }
}
