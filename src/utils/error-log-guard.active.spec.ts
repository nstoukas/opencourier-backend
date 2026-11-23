import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

describe('Error Log Guard (Row 139, Clause 1 & Clause 3)', () => {
  const ALLOWED_WRAPPERS = new Set([
    'describeErrorForLog',
    'errorForConsole',
    'errorSummaryForLog',
    'describeError',
  ])

  const LOG_METHODS = new Set(['error', 'warn', 'log', 'info', 'debug', 'verbose'])

  function isLoggerOrConsole(expr: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(expr)) return false
    const method = expr.name.text
    if (!LOG_METHODS.has(method)) return false
    const callerText = expr.expression.getText()
    return (
      callerText === 'console' ||
      callerText === 'this.logger' ||
      callerText === 'logger' ||
      callerText === 'panicLogger' ||
      /logger/i.test(callerText)
    )
  }

  function isUnboundLogger(expr: ts.Expression): boolean {
    const unwrapped = unwrap(expr)
    if (!ts.isPropertyAccessExpression(unwrapped)) return false
    const callerText = unwrapped.expression.getText()
    const methodName = unwrapped.name.text
    return (
      (callerText === 'this.logger' ||
        callerText === 'logger' ||
        callerText === 'console' ||
        callerText === 'panicLogger' ||
        /logger/i.test(callerText)) &&
      LOG_METHODS.has(methodName)
    )
  }

  function unwrap(node: ts.Expression): ts.Expression {
    let curr: ts.Expression = node
    while (curr) {
      if (ts.isParenthesizedExpression(curr)) {
        curr = curr.expression
      } else if (ts.isAsExpression(curr)) {
        curr = curr.expression
      } else if (ts.isTypeAssertionExpression(curr)) {
        curr = curr.expression
      } else if (ts.isNonNullExpression(curr)) {
        curr = curr.expression
      } else {
        break
      }
    }
    return curr
  }

  function isWrappedInAllowed(node: ts.Expression): boolean {
    const unwrapped = unwrap(node)
    if (ts.isCallExpression(unwrapped)) {
      const fn = unwrap(unwrapped.expression)
      if (ts.isIdentifier(fn) && ALLOWED_WRAPPERS.has(fn.text)) {
        return true
      }
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      if (isWrappedInAllowed(unwrapped.expression)) {
        return true
      }
    }
    return false
  }

  function scanCodeForViolations(code: string, fileName = 'file.ts'): { line: number; reason: string }[] {
    const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
    const violations: { line: number; reason: string }[] = []

    function visit(node: ts.Node, caughtVars: Set<string>) {
      // 1. Check logger/console calls for caught errors passed whole, as stack, as message, or in template
      if (ts.isCallExpression(node) && isLoggerOrConsole(node.expression)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
        for (const arg of node.arguments) {
          checkLogArgument(arg, caughtVars, line)
        }
      }

      // 2. Track caught error variable in catch clause
      if (ts.isCatchClause(node)) {
        const newCaught = new Set(caughtVars)
        if (node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
          newCaught.add(node.variableDeclaration.name.text)
        }
        if (node.block) {
          visit(node.block, newCaught)
        }
        return
      }

      // 3. Track caught error variable in promise .catch((error) => ...) and unbound logger passed to .catch()
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'catch'
      ) {
        if (node.arguments.length > 0) {
          const firstArg = unwrap(node.arguments[0]!)
          if (isUnboundLogger(firstArg)) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
            violations.push({
              line,
              reason: `Unbound logger method passed to .catch(): ${firstArg.getText()}`,
            })
          } else if (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg)) {
            visit(node.expression, caughtVars)
            for (let i = 1; i < node.arguments.length; i++) {
              visit(node.arguments[i]!, caughtVars)
            }
            const newCaught = new Set(caughtVars)
            for (const param of firstArg.parameters) {
              if (ts.isIdentifier(param.name)) {
                newCaught.add(param.name.text)
              }
            }
            visit(firstArg.body, newCaught)
            return
          }
        }
      }

      // 4. Track caught error variable in promise .then(ok, (err) => ...) rejection handler
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'then' &&
        node.arguments.length >= 2
      ) {
        const rejectionArg = unwrap(node.arguments[1]!)
        if (isUnboundLogger(rejectionArg)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
          violations.push({
            line,
            reason: `Unbound logger method passed to .then(): ${rejectionArg.getText()}`,
          })
        } else if (ts.isArrowFunction(rejectionArg) || ts.isFunctionExpression(rejectionArg)) {
          visit(node.expression, caughtVars)
          visit(node.arguments[0]!, caughtVars)
          for (let i = 2; i < node.arguments.length; i++) {
            visit(node.arguments[i]!, caughtVars)
          }
          const newCaught = new Set(caughtVars)
          for (const param of rejectionArg.parameters) {
            if (ts.isIdentifier(param.name)) {
              newCaught.add(param.name.text)
            }
          }
          visit(rejectionArg.body, newCaught)
          return
        }
      }

      // 5. Track event handlers on process ('unhandledRejection', 'uncaughtException') and any .on('error', ...)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'on' ||
          node.expression.name.text === 'addListener' ||
          node.expression.name.text === 'once') &&
        node.arguments.length >= 2
      ) {
        const firstArg = unwrap(node.arguments[0]!)
        let eventName: string | undefined
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          eventName = firstArg.text
        }
        const isErrorEvent =
          eventName === 'error' ||
          eventName === 'unhandledRejection' ||
          eventName === 'uncaughtException'

        if (isErrorEvent) {
          const handlerArg = unwrap(node.arguments[1]!)
          if (isUnboundLogger(handlerArg)) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
            violations.push({
              line,
              reason: `Unbound logger method passed to .${node.expression.name.text}('${eventName}'): ${handlerArg.getText()}`,
            })
          } else if (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg)) {
            visit(node.expression, caughtVars)
            visit(firstArg, caughtVars)
            for (let i = 2; i < node.arguments.length; i++) {
              visit(node.arguments[i]!, caughtVars)
            }
            const newCaught = new Set(caughtVars)
            for (const param of handlerArg.parameters) {
              if (ts.isIdentifier(param.name)) {
                newCaught.add(param.name.text)
              }
            }
            visit(handlerArg.body, newCaught)
            return
          }
        }
      }

      ts.forEachChild(node, (child) => visit(child, caughtVars))
    }

    function checkLogArgument(arg: ts.Expression, caughtVars: Set<string>, line: number) {
      const unwrapped = unwrap(arg)
      if (isWrappedInAllowed(unwrapped)) return

      // Caught error passed directly
      if (ts.isIdentifier(unwrapped) && caughtVars.has(unwrapped.text)) {
        violations.push({
          line,
          reason: `Caught error object "${unwrapped.text}" passed directly to logger/console`,
        })
        return
      }

      // error.stack or error.message passed directly
      if (ts.isPropertyAccessExpression(unwrapped)) {
        const prop = unwrapped.name.text
        if (prop === 'stack' || prop === 'message') {
          const target = unwrap(unwrapped.expression)
          if (ts.isIdentifier(target) && caughtVars.has(target.text)) {
            violations.push({
              line,
              reason: `Direct "${target.text}.${prop}" passed to logger/console without describeErrorForLog`,
            })
            return
          }
        }
      }

      // Template expression: check spans for ${error}, ${error.stack}, ${error.message}
      if (ts.isTemplateExpression(unwrapped)) {
        for (const span of unwrapped.templateSpans) {
          checkTemplateSpan(span.expression, caughtVars, line)
        }
        return
      }

      // Object literal: check shorthand properties or values passed directly
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const prop of unwrapped.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) {
            if (caughtVars.has(prop.name.text) && !isWrappedInAllowed(prop.name)) {
              violations.push({
                line,
                reason: `Caught error object "${prop.name.text}" passed directly in object literal to logger/console`,
              })
            }
          } else if (ts.isPropertyAssignment(prop)) {
            checkLogArgument(prop.initializer, caughtVars, line)
          }
        }
        return
      }

      // Binary expression (e.g. string concatenation 'failed: ' + error)
      if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        checkLogArgument(unwrapped.left, caughtVars, line)
        checkLogArgument(unwrapped.right, caughtVars, line)
        return
      }

      // Conditional expression: check branches
      if (ts.isConditionalExpression(unwrapped)) {
        checkLogArgument(unwrapped.whenTrue, caughtVars, line)
        checkLogArgument(unwrapped.whenFalse, caughtVars, line)
      }
    }

    function checkTemplateSpan(expr: ts.Expression, caughtVars: Set<string>, line: number) {
      const unwrapped = unwrap(expr)
      if (isWrappedInAllowed(unwrapped)) return

      if (ts.isIdentifier(unwrapped) && caughtVars.has(unwrapped.text)) {
        violations.push({
          line,
          reason: `\${${unwrapped.text}} interpolated in template passed to logger/console`,
        })
        return
      }

      if (ts.isPropertyAccessExpression(unwrapped)) {
        const prop = unwrapped.name.text
        if (prop === 'stack' || prop === 'message') {
          const target = unwrap(unwrapped.expression)
          if (ts.isIdentifier(target) && caughtVars.has(target.text)) {
            violations.push({
              line,
              reason: `\${${target.text}.${prop}} interpolated in template passed to logger/console`,
            })
            return
          }
        }
      }

      if (ts.isConditionalExpression(unwrapped)) {
        checkTemplateSpan(unwrapped.whenTrue, caughtVars, line)
        checkTemplateSpan(unwrapped.whenFalse, caughtVars, line)
      }
    }

    visit(sourceFile, new Set())
    return violations
  }

  function findFiles(dir: string): string[] {
    let results: string[] = []
    const list = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of list) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results = results.concat(findFiles(full))
      } else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
        results.push(full)
      }
    }
    return results
  }

  describe('Synthetic checks: scanner bites on forbidden patterns and allows safe patterns', () => {
    it('flags ${error} in a template string', () => {
      const code = `
        try {} catch (error) {
          this.logger.error(\`Failed: \${error}\`)
        }
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.reason).toContain('${error} interpolated in template')
    })

    it('flags raw (error as Error).stack second argument', () => {
      const code = `
        try {} catch (error) {
          this.logger.error('Failed', (error as Error).stack)
        }
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.reason).toContain('Direct "error.stack"')
    })

    it('flags logger.error("text", error) passing error whole', () => {
      const code = `
        try {} catch (error) {
          this.logger.error('text', error)
        }
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.reason).toContain('Caught error object "error" passed directly')
    })

    it('flags unbound logger method passed to .catch()', () => {
      const code = `
        promise.catch(this.logger.error)
        another.catch(console.error)
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toHaveLength(2)
      expect(violations[0]!.reason).toContain('Unbound logger method passed to .catch(): this.logger.error')
      expect(violations[1]!.reason).toContain('Unbound logger method passed to .catch(): console.error')
    })

    it('flags error.message passed to logger', () => {
      const code = `
        try {} catch (err) {
          this.logger.warn('Warning', err.message)
        }
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.reason).toContain('Direct "err.message"')
    })

    it('allows describeErrorForLog(error).stack and errorSummaryForLog(error)', () => {
      const code = `
        try {} catch (error) {
          this.logger.error(
            \`Could not do X: \${errorSummaryForLog(error)}\`,
            describeErrorForLog(error).stack
          )
        }
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toEqual([])
    })

    it('allows errorForConsole and describeError', () => {
      const code = `
        try {} catch (err) {
          console.error(\`Failure: \${errorForConsole(err)}\`)
          this.logger.error(\`Mail failed: \${describeError(err)}\`)
        }
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toEqual([])
    })

    it('does not flag non-error expressions (String(serviceAccount.project_id) or deliveryIdOf(message))', () => {
      const code = `
        this.logger.log(\`push is on: Firebase project \${String(serviceAccount.project_id ?? 'unknown')}\`)
        this.logger.log(\`Publishing message to channel \${channelName}: \${messageName}, delivery \${deliveryIdOf(message) ?? '-'}\`)
      `
      const violations = scanCodeForViolations(code)
      expect(violations).toEqual([])
    })

    describe('Concise arrow functions without braces (Clause 1)', () => {
      it('flags concise .catch arrow interpolating ${error} in template', () => {
        const code = `
          result.catch((error) => this.logger.error(\`Chat live message failed: \${error}\`))
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('${error} interpolated in template')
      })

      it('flags concise .catch arrow passing raw (error as Error).stack', () => {
        const code = `
          result.catch((error) => this.logger.error('Job failed', (error as Error).stack))
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('Direct "error.stack"')
      })

      it('flags concise .catch arrow passing error whole', () => {
        const code = `
          result.catch((error) => console.error(error))
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('Caught error object "error" passed directly')
      })

      it('allows concise .catch arrow using errorSummaryForLog and describeErrorForLog(error).stack', () => {
        const code = `
          result.catch((error) =>
            this.logger.error(\`Job \${job.name} failed: \${errorSummaryForLog(error)}\`, describeErrorForLog(error).stack)
          )
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toEqual([])
      })
    })

    describe('Process event handlers (Clause 2)', () => {
      it('flags process.on unhandledRejection handler passing reason whole or in template', () => {
        const code = `
          process.on('unhandledRejection', (reason) => {
            console.error(reason, "Unhandled Rejection at Promise")
          })
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('Caught error object "reason" passed directly')
      })

      it('flags process.on uncaughtException handler passing err whole or raw err.stack', () => {
        const code = `
          process.on('uncaughtException', (err) => {
            panicLogger.error('Crash', (err as Error).stack)
          })
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('Direct "err.stack"')
      })

      it('allows process.on handlers logging through errorForConsole and describeErrorForLog', () => {
        const code = `
          process
            .on('unhandledRejection', (reason) => {
              console.error(\`Unhandled Rejection at Promise: \${errorForConsole(reason)}\`)
              const { summary, stack } = describeErrorForLog(reason)
              panicLogger.error(\`Unhandled Rejection at Promise: \${summary}\`, { stack })
            })
            .on('uncaughtException', (err) => {
              console.error(\`Uncaught Exception thrown: \${errorForConsole(err)}\`)
              const { summary, stack } = describeErrorForLog(err)
              panicLogger.error(\`Uncaught Exception thrown: \${summary}\`, { stack })
              process.exit(1)
            })
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toEqual([])
      })
    })

    describe('.on("error") event handlers (Clause 3)', () => {
      it('flags googleLogger.on("error") handler passing err whole', () => {
        const code = `
          googleLogger.on('error', (err) => {
            console.log('Logging transport error', err)
          })
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('Caught error object "err" passed directly')
      })

      it('flags concise .on("error") handler interpolating ${err} in template', () => {
        const code = `
          client.on('error', (err) => console.error(\`Redis error: \${err}\`))
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('${err} interpolated in template')
      })

      it('allows .on("error") handler logging through errorForConsole or errorSummaryForLog', () => {
        const code = `
          googleLogger.on('error', (err) => {
            console.log(\`Logging transport error: \${errorForConsole(err)}\`)
          })
          client.on('error', (error: Error) => {
            console.error('Redis connection error', errorSummaryForLog(error))
          })
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toEqual([])
      })
    })

    describe('Promise .then(ok, rejectionHandler) (Clause 4)', () => {
      it('flags .then rejection handler passing error whole', () => {
        const code = `
          promise.then(
            (value) => value,
            (err) => console.error('Promise rejected', err)
          )
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('Caught error object "err" passed directly')
      })

      it('flags concise .then rejection handler interpolating ${err} in template', () => {
        const code = `
          promise.then(
            (value) => value,
            (err) => this.logger.error(\`Rejection: \${err}\`)
          )
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
        expect(violations[0]!.reason).toContain('${err} interpolated in template')
      })

      it('allows .then rejection handler logging through errorSummaryForLog', () => {
        const code = `
          promise.then(
            (value) => value,
            (err) => this.logger.error(\`Rejection: \${errorSummaryForLog(err)}\`)
          )
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toEqual([])
      })

      it('flags unbound logger method passed to .then rejection handler or .on("error")', () => {
        const code = `
          promise.then(ok, this.logger.error)
          emitter.on('error', console.error)
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(2)
        expect(violations[0]!.reason).toContain('Unbound logger method passed to .then(): this.logger.error')
        expect(violations[1]!.reason).toContain("Unbound logger method passed to .on('error'): console.error")
      })
    })
  })

  describe('Full codebase scan across src/ (outside describeErrorForLog itself)', () => {
    it('finds no log call writing an error by ${error}, by its .stack, or whole outside describeErrorForLog', () => {
      const srcDir = path.resolve(__dirname, '..')
      const files = findFiles(srcDir).filter((file) => !file.endsWith('errorForLog.ts'))

      expect(files.length).toBeGreaterThan(100)

      const allViolations: { file: string; line: number; reason: string }[] = []

      for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8')
        const fileViolations = scanCodeForViolations(content, filePath)
        for (const v of fileViolations) {
          allViolations.push({ file: path.relative(srcDir, filePath), line: v.line, reason: v.reason })
        }
      }

      if (allViolations.length > 0) {
        // eslint-disable-next-line no-console
        console.error('Logging guard violations:', allViolations)
      }

      expect(allViolations).toEqual([])
    })
  })
})
