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
function isPrismaError(error: Error): boolean {
  return error.name.startsWith('Prisma') || error.name === 'NotFoundError'
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
function codeOf(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined
}

export function describeErrorForLog(error: unknown): ErrorForLog {
  if (!(error instanceof Error)) {
    // `typeof null` is 'object'; name it plainly so the line says what was thrown.
    return { summary: `A value that is not an Error was thrown (${error === null ? 'null' : typeof error})` }
  }
  const code = codeOf(error)
  const head = code ? `${error.name} ${code}` : error.name
  if (isPrismaError(error)) {
    return { summary: `${head} (message withheld: it can repeat the call's data)`, stack: stackFrames(error.stack) }
  }
  return { summary: `${head}: ${error.message}`, stack: stackFrames(error.stack) }
}

// The same, as one block of text for console output: the summary, then the frames.
export function errorForConsole(error: unknown): string {
  const { summary, stack } = describeErrorForLog(error)
  return stack ? `${summary}\n${stack}` : summary
}
