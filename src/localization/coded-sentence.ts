// Spec 0054 (row 47), AC-6: a sentence a person reads that carries a number, a time or a name. The fixed
// sentences get their code from error-sentences.ts; these cannot, because their words change with the
// values. So they travel as three things together:
//   code     the key of the text in src/localization/en.ts and el.ts (`server.error.<code>`, or
//            `server.notice.<code>` / `server.board.<code>` for sentences that are not refusals);
//   params   the values the text fills in (ISO times stay ISO: each app shows them on Athens time);
//   message  the English sentence, exactly as the server wrote it before, for anything that reads it.
// An app that knows the code says it in its reader's language; one that does not shows `message`.
import { HttpStatus } from '@nestjs/common'

export type SentenceParams = Record<string, string | number | null>

export type CodedSentence = {
  code: string
  params: SentenceParams
  message: string
}

// The body of a refusal that carries a coded sentence: what Nest sends for its own exceptions (status and
// message), plus the code and params. HttpExceptionFilter keeps a body that already has a code, and
// ResponseFormatMiddleware passes `params` on to the apps. Used as `new ConflictException(refusalBody(...))`,
// so the thrown class (and every test or caller that checks it) stays what it was.
export function refusalBody(status: HttpStatus, sentence: CodedSentence) {
  return { statusCode: status, message: sentence.message, code: sentence.code, params: sentence.params }
}
