import * as fs from 'fs'
import * as path from 'path'
import { ExecutionContext, CallHandler } from '@nestjs/common'
import { throwError } from 'rxjs'
import * as Sentry from '@sentry/node'
import { SentryInterceptor } from './sentry.interceptor'

describe('SentryInterceptor (AC-9, Privacy)', () => {
  let capturedScope: Sentry.Scope | null
  let withScopeSpy: jest.SpyInstance
  let captureExceptionSpy: jest.SpyInstance

  beforeEach(() => {
    capturedScope = null
    withScopeSpy = jest.spyOn(Sentry, 'withScope').mockImplementation((cb: any) => {
      const scope = new Sentry.Scope()
      capturedScope = scope
      cb(scope)
    })
    captureExceptionSpy = jest.spyOn(Sentry, 'captureException').mockImplementation(() => 'event-id')
  })

  afterEach(() => {
    withScopeSpy.mockRestore()
    captureExceptionSpy.mockRestore()
  })

  const makeMockContext = (req: any): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => () => {},
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
    } as unknown as ExecutionContext)

  const makeMockCallHandler = (error: Error): CallHandler => ({
    handle: () => throwError(() => error),
  })

  it('attaches no request (no body, query string, cookies, headers) to scope when constructed with { request: false }', (done) => {
    const interceptor = new SentryInterceptor({ request: false })

    const customerName = 'Sensitive Customer'
    const customerPhone = '+306912345678'
    const customerStreet = 'Sensitive Street 42'

    const req = {
      method: 'POST',
      url: '/api/partner/v1/customers',
      body: {
        name: customerName,
        phone: customerPhone,
        addressLine1: customerStreet,
      },
      query: { q: 'Sensitive Search' },
      headers: { cookie: 'session_token=sensitive_secret' },
    }

    const context = makeMockContext(req)
    const callHandler = makeMockCallHandler(new Error('Simulated database failure'))

    interceptor.intercept(context, callHandler).subscribe({
      error: () => {
        expect(capturedScope).not.toBeNull()
        const extra = (capturedScope as any)._extra
        // req extra is undefined because request: false disables parsing request details
        expect(extra?.req).toBeUndefined()

        // Verify serialized scope data contains no sensitive customer fields
        const serialized = JSON.stringify(extra)
        expect(serialized).not.toContain(customerName)
        expect(serialized).not.toContain(customerPhone)
        expect(serialized).not.toContain(customerStreet)
        expect(serialized).not.toContain('Sensitive Search')
        expect(serialized).not.toContain('sensitive_secret')
        done()
      },
    })
  })

  it('proves that without { request: false }, SentryInterceptor would leak customer details to scope', (done) => {
    const interceptor = new SentryInterceptor({}) // default options without request: false

    const customerName = 'Sensitive Customer'
    const customerPhone = '+306912345678'

    const req = {
      method: 'POST',
      url: '/api/partner/v1/customers',
      body: {
        name: customerName,
        phone: customerPhone,
      },
      query: { q: 'SearchQuery' },
      headers: {},
    }

    const context = makeMockContext(req)
    const callHandler = makeMockCallHandler(new Error('Simulated failure'))

    interceptor.intercept(context, callHandler).subscribe({
      error: () => {
        const extra = (capturedScope as any)._extra
        expect(extra?.req).toBeDefined()
        const serialized = JSON.stringify(extra)
        expect(serialized).toContain(customerName)
        expect(serialized).toContain(customerPhone)
        done()
      },
    })
  })

  it('registers SentryInterceptor with { request: false } in src/main.ts (AC-9)', () => {
    const mainPath = path.resolve(__dirname, '../../main.ts')
    const mainContent = fs.readFileSync(mainPath, 'utf-8')
    expect(mainContent).toMatch(/new\s+SentryInterceptor\(\s*\{\s*request:\s*false\s*\}\s*\)/)
  })
})
