// What an error may put in the log (scope row 132): enough to find the fault, never the data the call
// carried. Prisma's messages can repeat that data: a validation error prints the whole call, a recipient's
// name and phone included, and a raw query error can repeat a database value. So a Prisma error is logged
// by its name and code only, and the stack keeps its frames (the "at ..." lines), never its first lines,
// which repeat the message. Any other error keeps its message: this codebase's own messages, and the
// library errors seen so far, name ids, fields and rules, not people. A thrown value that is not an Error is logged by its type only.
export type ErrorForLog = {
  // One line: name, code when there is one, and the message when it may be logged.
  summary: string
  // The stack frames, or undefined when there are none.
  stack?: string
}

// A Prisma error, from any copy of the client (they are told apart by name, as prisma.util.ts does).
// `name` is checked to be text first: a thrown object can carry anything there, and this helper runs inside
// the error handlers, where a second error would hide the first.
function isPrismaError(error: Error): boolean {
  return typeof error.name === 'string' && (error.name.startsWith('Prisma') || error.name === 'NotFoundError')
}

// The "    at ..." lines of a stack, without the header lines that repeat the message.
function stackFrames(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined
  }
  const frames = stack.split('\n').filter((line) => /^\s+at\s/.test(line))
  return frames.length > 0 ? frames.join('\n') : undefined
}

// The error's code: Prisma's (P2002 and the like) or this codebase's ApiException code, as text.
// A Prisma initialization error keeps its code in `errorCode` (P1001: the database cannot be reached).
function codeOf(error: Error): string | undefined {
  const { code, errorCode } = error as { code?: unknown; errorCode?: unknown }
  const found = code ?? errorCode
  return typeof found === 'string' || typeof found === 'number' ? String(found) : undefined
}

// The only parts of a Prisma error's `meta` that are logged: the model and the target (field or constraint
// names, as in a P2002), and only when they are text. Values never appear there; anything else in `meta`
// might hold them, so it is left out (review of row 132).
function prismaMetaOf(error: Error): string {
  const meta = (error as { meta?: unknown }).meta
  if (typeof meta !== 'object' || meta === null) {
    return ''
  }
  const { modelName, target } = meta as { modelName?: unknown; target?: unknown }
  const parts: string[] = []
  if (typeof modelName === 'string') {
    parts.push(`model ${modelName}`)
  }
  if (typeof target === 'string') {
    parts.push(`target ${target}`)
  } else if (Array.isArray(target) && target.every((item) => typeof item === 'string')) {
    parts.push(`target ${target.join(', ')}`)
  }
  return parts.length > 0 ? ` [${parts.join('; ')}]` : ''
}

export function describeErrorForLog(error: unknown): ErrorForLog {
  if (!(error instanceof Error)) {
    // `typeof null` is 'object'; name it plainly so the line says what was thrown.
    return { summary: `A value that is not an Error was thrown (${error === null ? 'null' : typeof error})` }
  }
  const code = codeOf(error)
  const name = typeof error.name === 'string' ? error.name : 'Error'
  const head = code ? `${name} ${code}` : name
  if (isPrismaError(error)) {
    return {
      summary: `${head}${prismaMetaOf(error)} (message withheld: it can repeat the call's data)`,
      stack: stackFrames(error.stack),
    }
  }
  return {
    summary: `${head}: ${error.message}`,
    stack: stackFrames(typeof error.stack === 'string' ? error.stack : undefined),
  }
}

// The same, as one block of text for console output: the summary, then the frames.
export function errorForConsole(error: unknown): string {
  const { summary, stack } = describeErrorForLog(error)
  return stack ? `${summary}\n${stack}` : summary
}

// The summary line alone (scope row 139), for the many log lines that put the error at the end of a sentence:
// `Could not do X: ${errorSummaryForLog(error)}`. Use this, never `${error}`, `error.message` or `error.stack`,
// whenever a caught error goes into a log line.
export function errorSummaryForLog(error: unknown): string {
  return describeErrorForLog(error).summary
}
