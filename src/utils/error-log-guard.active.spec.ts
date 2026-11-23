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

  const SAFE_PROPERTIES = new Set(['name', 'code', 'statusCode', 'status'])
  const LOG_METHODS = new Set(['error', 'warn', 'log', 'info', 'debug', 'verbose'])

  function unwrap(node: ts.Node): ts.Node {
    let curr = node
    while (
      ts.isParenthesizedExpression(curr) ||
      ts.isAsExpression(curr) ||
      ts.isTypeAssertionExpression(curr) ||
      ts.isNonNullExpression(curr)
    ) {
      curr = curr.expression
    }
    return curr
  }

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
      /logger/i.test(callerText) ||
      callerText === 'this.log' ||
      callerText === 'log'
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
        /logger/i.test(callerText) ||
        callerText === 'this.log' ||
        callerText === 'log') &&
      LOG_METHODS.has(methodName)
    )
  }

  function isAllowedWrapperCall(node: ts.Node): boolean {
    const curr = unwrap(node)
    if (ts.isCallExpression(curr)) {
      const fn = unwrap(curr.expression)
      if (ts.isIdentifier(fn) && ALLOWED_WRAPPERS.has(fn.text)) {
        return true
      }
    }
    if (ts.isPropertyAccessExpression(curr)) {
      return isAllowedWrapperCall(curr.expression)
    }
    return false
  }

  function isSafePropertyAccess(node: ts.Node, trackedVars: Set<string>): boolean {
    const curr = unwrap(node)
    if (ts.isPropertyAccessExpression(curr)) {
      const propName = curr.name.text
      if (SAFE_PROPERTIES.has(propName)) {
        const target = unwrap(curr.expression)
        if (ts.isIdentifier(target) && trackedVars.has(target.text)) {
          return true
        }
      }
    }
    return false
  }

  function extractBindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) {
      return [name.text]
    }
    const names: string[] = []
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          names.push(...extractBindingNames(element.name))
        }
      }
    }
    return names
  }

  function isErrorParamName(name: string): boolean {
    const lower = name.toLowerCase()
    if (
      lower === 'err' ||
      lower === 'error' ||
      lower === 'reason' ||
      lower === 'cause' ||
      lower === 'exception' ||
      name === 'e'
    ) {
      return true
    }
    if (name.endsWith('Error') || name.endsWith('Err') || name.endsWith('error') || name.endsWith('err')) {
      return true
    }
    return false
  }

  function isAliasOfTrackedError(expr: ts.Expression | undefined, trackedVars: Set<string>): boolean {
    if (!expr) return false
    const curr = unwrap(expr) as ts.Expression

    if (isAllowedWrapperCall(curr)) return false
    if (isSafePropertyAccess(curr, trackedVars)) return false

    if (ts.isIdentifier(curr) && trackedVars.has(curr.text)) {
      return true
    }

    if (ts.isPropertyAccessExpression(curr)) {
      const target = unwrap(curr.expression)
      if (ts.isIdentifier(target) && trackedVars.has(target.text)) {
        if (!SAFE_PROPERTIES.has(curr.name.text)) {
          return true
        }
      }
    }

    if (ts.isElementAccessExpression(curr)) {
      const target = unwrap(curr.expression)
      if (ts.isIdentifier(target) && trackedVars.has(target.text)) {
        return true
      }
    }

    if (ts.isCallExpression(curr)) {
      if (ts.isPropertyAccessExpression(curr.expression)) {
        const target = unwrap(curr.expression.expression)
        if (ts.isIdentifier(target) && trackedVars.has(target.text)) {
          return true
        }
      }
      for (const arg of curr.arguments) {
        if (isAliasOfTrackedError(arg, trackedVars)) return true
      }
    }

    if (ts.isConditionalExpression(curr)) {
      if (isAliasOfTrackedError(curr.whenTrue, trackedVars) || isAliasOfTrackedError(curr.whenFalse, trackedVars)) {
        return true
      }
    }

    if (ts.isBinaryExpression(curr)) {
      if (isAliasOfTrackedError(curr.left, trackedVars) || isAliasOfTrackedError(curr.right, trackedVars)) {
        return true
      }
    }

    if (ts.isTemplateExpression(curr)) {
      for (const span of curr.templateSpans) {
        if (isAliasOfTrackedError(span.expression, trackedVars)) return true
      }
    }

    return false
  }

  function scanCodeForViolations(
    code: string,
    fileName = 'file.ts',
    stats?: { allowedWrapperCalls: number }
  ): { line: number; reason: string }[] {
    const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
    const violations: { line: number; reason: string }[] = []

    function countAllowedWrappersInArg(node: ts.Node) {
      if (!stats) return
      const curr = unwrap(node)
      if (ts.isCallExpression(curr)) {
        const fn = unwrap(curr.expression)
        if (ts.isIdentifier(fn) && ALLOWED_WRAPPERS.has(fn.text)) {
          stats.allowedWrapperCalls++
        }
      }
      ts.forEachChild(node, countAllowedWrappersInArg)
    }

    function checkNodeInLogArg(node: ts.Node, trackedVars: Set<string>) {
      if (isAllowedWrapperCall(node)) return
      if (isSafePropertyAccess(node, trackedVars)) return
      if (ts.isIdentifier(node) && trackedVars.has(node.text)) {
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) return
        if (ts.isTypeNode(node.parent)) return
        if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return

        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1

        let detail = ''
        let p: ts.Node | undefined = node.parent
        while (
          p &&
          (ts.isParenthesizedExpression(p) ||
            ts.isAsExpression(p) ||
            ts.isTypeAssertionExpression(p) ||
            ts.isNonNullExpression(p))
        ) {
          p = p.parent
        }

        if (p && ts.isPropertyAccessExpression(p) && (p.name.text === 'stack' || p.name.text === 'message')) {
          detail = `Direct "${node.text}.${p.name.text}"`
        } else if (p && ts.isTemplateSpan(p)) {
          detail = `\${${node.text}} interpolated in template`
        } else if (p && ts.isCallExpression(p) && p.arguments.includes(node as ts.Expression)) {
          detail = `Caught error object "${node.text}" passed directly`
        }

        const reason = detail
          ? `Tracked error identifier "${node.text}" (${detail}) passed to log call without allowed wrapper`
          : `Tracked error identifier "${node.text}" referenced in log call without allowed wrapper`

        violations.push({
          line: startLine,
          reason,
        })
        return
      }
      ts.forEachChild(node, (child) => checkNodeInLogArg(child, trackedVars))
    }

    function visit(node: ts.Node, trackedVars: Set<string>) {
      // 1. Check logger/console calls for tracked error references
      if (ts.isCallExpression(node) && isLoggerOrConsole(node.expression)) {
        for (const arg of node.arguments) {
          countAllowedWrappersInArg(arg)
          checkNodeInLogArg(arg, trackedVars)
        }
      }

      // 2. Track caught error variable in catch clause
      if (ts.isCatchClause(node)) {
        const newTracked = new Set(trackedVars)
        if (node.variableDeclaration) {
          const names = extractBindingNames(node.variableDeclaration.name)
          for (const n of names) newTracked.add(n)
        }
        if (node.block) {
          visitBlock(node.block, newTracked)
        }
        return
      }

      // 3. Track caught error variable in promise .catch((error) => ...) and unbound logger passed to .catch()
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'catch' &&
        node.arguments.length > 0
      ) {
        const firstArg = node.arguments[0]!
        if (isUnboundLogger(firstArg)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
          violations.push({
            line,
            reason: `Unbound logger method passed to .catch(): ${firstArg.getText()}`,
          })
        } else if (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg)) {
          visit(node.expression, trackedVars)
          const newTracked = new Set(trackedVars)
          for (const param of firstArg.parameters) {
            const names = extractBindingNames(param.name)
            for (const n of names) newTracked.add(n)
          }
          if (ts.isBlock(firstArg.body)) {
            visitBlock(firstArg.body, newTracked)
          } else {
            visit(firstArg.body, newTracked)
          }
          return
        }
      }

      // 4. Track caught error variable in promise .then(ok, (err) => ...) rejection handler
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'then' &&
        node.arguments.length >= 2
      ) {
        const rejArg = node.arguments[1]!
        if (isUnboundLogger(rejArg)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
          violations.push({
            line,
            reason: `Unbound logger method passed to .then(): ${rejArg.getText()}`,
          })
        } else if (ts.isArrowFunction(rejArg) || ts.isFunctionExpression(rejArg)) {
          visit(node.expression, trackedVars)
          visit(node.arguments[0]!, trackedVars)
          const newTracked = new Set(trackedVars)
          for (const param of rejArg.parameters) {
            const names = extractBindingNames(param.name)
            for (const n of names) newTracked.add(n)
          }
          if (ts.isBlock(rejArg.body)) {
            visitBlock(rejArg.body, newTracked)
          } else {
            visit(rejArg.body, newTracked)
          }
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
        const firstArg = node.arguments[0]!
        let eventName: string | undefined
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          eventName = firstArg.text
        }
        if (eventName === 'error' || eventName === 'unhandledRejection' || eventName === 'uncaughtException') {
          const handlerArg = node.arguments[1]!
          if (isUnboundLogger(handlerArg)) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
            violations.push({
              line,
              reason: `Unbound logger method passed to .on('${eventName}'): ${handlerArg.getText()}`,
            })
          } else if (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg)) {
            visit(node.expression, trackedVars)
            visit(firstArg, trackedVars)
            const newTracked = new Set(trackedVars)
            for (const param of handlerArg.parameters) {
              const names = extractBindingNames(param.name)
              for (const n of names) newTracked.add(n)
            }
            if (ts.isBlock(handlerArg.body)) {
              visitBlock(handlerArg.body, newTracked)
            } else {
              visit(handlerArg.body, newTracked)
            }
            return
          }
        }
      }

      // 6. Track callback parameters (arrow functions and function expressions) named err, error, e, reason, cause or ending in Error/Err
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const newTracked = new Set(trackedVars)
        for (const param of node.parameters) {
          const names = extractBindingNames(param.name)
          for (const n of names) {
            if (isErrorParamName(n)) {
              newTracked.add(n)
            }
          }
        }
        if (node.body) {
          if (ts.isBlock(node.body)) {
            visitBlock(node.body, newTracked)
          } else {
            visit(node.body, newTracked)
          }
          return
        }
      }

      ts.forEachChild(node, (child) => visit(child, trackedVars))
    }

    function visitBlock(block: ts.Block, trackedVars: Set<string>) {
      const currentTracked = new Set(trackedVars)
      for (const stmt of block.statements) {
        // Track simple aliases declared from a tracked identifier or its .message/.stack
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (decl.initializer && isAliasOfTrackedError(decl.initializer, currentTracked)) {
              const names = extractBindingNames(decl.name)
              for (const n of names) currentTracked.add(n)
            }
          }
        }
        // Track assignments: reason = error.message
        if (
          ts.isExpressionStatement(stmt) &&
          ts.isBinaryExpression(stmt.expression) &&
          stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ) {
          if (isAliasOfTrackedError(stmt.expression.right, currentTracked)) {
            if (ts.isIdentifier(stmt.expression.left)) {
              currentTracked.add(stmt.expression.left.text)
            }
          }
        }
        visit(stmt, currentTracked)
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
        this.logger.warn(\`Delivery \${delivery.id} has no restaurant: the split wait is not charged to anyone\`)
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

    describe('Reviewer and retry shapes (Row 139 Major finding)', () => {
      it('flags shape a: NgrokMiddleware ${(error as any).message || error}', () => {
        const code = `
          try {
            await axios.post(url, req.body)
          } catch (error) {
            this.logger.log(\`Error forwarding ngrok \${(error as any).message || error}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThan(0)
      })

      it('flags shape b: Winston defaultCallback (err) => console.error(err)', () => {
        const code = `
          new GoogleWinstonLogger({
            defaultCallback: (err) => {
              if (err) {
                console.error(err)
              }
            },
          })
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThan(0)
      })

      it('flags shape c: minioStorage ${error instanceof Error ? String(error.message) : String(error)}', () => {
        const code = `
          try {} catch (error) {
            this.logger.warn(
              \`MinIO is not ready: \${error instanceof Error ? String(error.message) : String(error)}\`
            )
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThan(0)
      })

      it('flags ${String(error)} and ${JSON.stringify(error)}', () => {
        const code = `
          try {} catch (error) {
            this.logger.error(\`Failed 1: \${String(error)}\`)
            this.logger.error(\`Failed 2: \${JSON.stringify(error)}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(2)
      })

      it('flags error.toString() and nullish coalescing ${error?.message ?? error}', () => {
        const code = `
          try {} catch (error) {
            this.logger.error('Failed: ' + error.toString())
            this.logger.error(\`Fallback: \${error?.message ?? error}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThanOrEqual(2)
      })

      it('flags aliases assigned from error.message (const reason = error.message)', () => {
        const code = `
          try {} catch (error) {
            const reason = error.message
            this.logger.error(\`OSRM table request failed: \${reason}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThan(0)
      })

      it('flags destructuring alias (const { message, stack } = error as Error)', () => {
        const code = `
          try {} catch (error) {
            const { message, stack } = error as Error
            this.logger.error(message, stack)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThan(0)
      })

      it('flags destructuring in catch clause: catch ({ message })', () => {
        const code = `
          try {} catch ({ message }) {
            this.logger.error(message)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations.length).toBeGreaterThan(0)
      })

      it('flags element access error["message"] and error.cause', () => {
        const code = `
          try {} catch (error) {
            this.logger.error(error['message'])
            this.logger.error(error.cause)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(2)
      })

      it('flags object spread { ...error } and array literal [error]', () => {
        const code = `
          try {} catch (error) {
            this.logger.error({ ...error })
            this.logger.error([error])
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(2)
      })

      it('flags nested template string: `${`nested ${error}`}`', () => {
        const code = `
          try {} catch (error) {
            this.logger.error(\`\${\`nested \${error}\`}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(1)
      })

      it('flags callback parameters named e, cause, reason, or ending in Error/Err', () => {
        const code = `
          doSomething((mailError) => {
            console.error('Mail failure', mailError)
          })
          handleSomething((cause) => {
            this.logger.error(\`Cause: \${cause}\`)
          })
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toHaveLength(2)
      })

      it('allows safe property access error.name and error.code', () => {
        const code = `
          try {} catch (error) {
            this.logger.log(\`Error name: \${error.name}, code: \${error.code}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toEqual([])
      })

      it('allows aliases assigned from allowed wrappers (const reason = errorSummaryForLog(error))', () => {
        const code = `
          try {} catch (error) {
            const reason = errorSummaryForLog(error)
            this.logger.error(\`OSRM table request failed: \${reason}\`)
          }
        `
        const violations = scanCodeForViolations(code)
        expect(violations).toEqual([])
      })
    })
  })

  describe('Full codebase scan across src/ (outside describeErrorForLog itself)', () => {
    it('finds no log call writing an error by ${error}, by its .stack, or whole outside describeErrorForLog', () => {
      const srcDir = path.resolve(__dirname, '..')
      const files = findFiles(srcDir).filter((file) => !file.endsWith('errorForLog.ts'))

      expect(files.length).toBeGreaterThan(100)

      const allViolations: { file: string; line: number; reason: string }[] = []
      const stats = { allowedWrapperCalls: 0 }

      for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8')
        const fileViolations = scanCodeForViolations(content, filePath, stats)
        for (const v of fileViolations) {
          allViolations.push({ file: path.relative(srcDir, filePath), line: v.line, reason: v.reason })
        }
      }

      // Blindness floor: scan must see at least 200 allowed wrapper calls inside log calls across src/
      expect(stats.allowedWrapperCalls).toBeGreaterThanOrEqual(200)

      if (allViolations.length > 0) {
        // eslint-disable-next-line no-console
        console.error('Logging guard violations:', allViolations)
      }

      expect(allViolations).toEqual([])
    })
  })
})
