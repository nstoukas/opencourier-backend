import { ResponseFormatMiddleware } from './ResponseFormatMiddleware'
import { Request, Response } from 'express'

describe('ResponseFormatMiddleware (AC-4, AC-9, Decision 26.2)', () => {
  let middleware: ResponseFormatMiddleware

  beforeEach(() => {
    middleware = new ResponseFormatMiddleware()
  })

  it('passes conflictingCustomerId through when error body has one', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 409,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    const next = jest.fn()
    middleware.use(req, res, next)
    expect(next).toHaveBeenCalled()

    // Trigger intercepted json method on error with conflictingCustomerId
    res.json({
      code: 'UNIQUE_CONSTRAINT',
      message: 'Another saved customer has this phone',
      conflictingCustomerId: 'cust-clash-123',
      extraSecretData: 'leaked-password',
    })

    expect(responseBody).toEqual({
      error: true,
      result: [
        {
          code: 'UNIQUE_CONSTRAINT',
          message: 'Another saved customer has this phone',
          statusCode: 409,
          conflictingCustomerId: 'cust-clash-123',
        },
      ],
    })
    // Ensure no unknown/extra fields leak
    expect(responseBody.result[0].extraSecretData).toBeUndefined()
  })

  // Spec 0036, AC-6 wire: ResponseFormatMiddleware keeps alreadyBilled (an array) on an error body
  it('passes alreadyBilled array through on an error body', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 409,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    const next = jest.fn()
    middleware.use(req, res, next)
    expect(next).toHaveBeenCalled()

    res.json({
      code: 'UNIQUE_CONSTRAINT',
      message: 'Some of these charges are already billed.',
      alreadyBilled: ['charge-1', 'charge-2'],
      extraSecretData: 'do-not-leak',
    })

    expect(responseBody).toEqual({
      error: true,
      result: [
        {
          code: 'UNIQUE_CONSTRAINT',
          message: 'Some of these charges are already billed.',
          statusCode: 409,
          alreadyBilled: ['charge-1', 'charge-2'],
        },
      ],
    })
    expect(responseBody.result[0].extraSecretData).toBeUndefined()
  })

  it('does not add alreadyBilled when absent or not an array', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 409,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    middleware.use(req, res, () => {})

    // Non-array alreadyBilled should not be passed through
    res.json({
      code: 'UNIQUE_CONSTRAINT',
      message: 'Error without array alreadyBilled',
      alreadyBilled: 'not-an-array',
    })

    expect(responseBody.result[0].alreadyBilled).toBeUndefined()
  })

  it('does not add conflictingCustomerId or extra fields when error does not have conflictingCustomerId', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 404,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    middleware.use(req, res, () => {})

    res.json({
      code: 'NOT_FOUND',
      message: 'Saved customer not found',
      unexpectedField: 'do-not-leak',
    })

    expect(responseBody).toEqual({
      error: true,
      result: [
        {
          code: 'NOT_FOUND',
          message: 'Saved customer not found',
          statusCode: 404,
        },
      ],
    })
    expect(responseBody.result[0].conflictingCustomerId).toBeUndefined()
    expect(responseBody.result[0].unexpectedField).toBeUndefined()
  })

  // Spec 0054 (AC-6, decision 47.45): ResponseFormatMiddleware passes params through on an error body
  it('passes params object through on an error body (AC-6)', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 409,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    const next = jest.fn()
    middleware.use(req, res, next)
    expect(next).toHaveBeenCalled()

    res.json({
      code: 'LEAVE_TOO_SOON',
      message: 'Wait at least 10 minutes before leaving',
      params: { minutes: 10 },
      extraSecretData: 'do-not-leak',
    })

    expect(responseBody).toEqual({
      error: true,
      result: [
        {
          code: 'LEAVE_TOO_SOON',
          message: 'Wait at least 10 minutes before leaving',
          statusCode: 409,
          params: { minutes: 10 },
        },
      ],
    })
    expect(responseBody.result[0].extraSecretData).toBeUndefined()
  })

  it('does not add params when absent or not an object', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 409,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    middleware.use(req, res, () => {})

    res.json({
      code: 'LEAVE_TOO_SOON',
      message: 'Wait at least 10 minutes before leaving',
      params: 'not-an-object',
    })

    expect(responseBody.result[0].params).toBeUndefined()
  })

  it('wraps successful response in { error: false, result: data }', () => {
    const req = {} as Request
    let responseBody: any
    const res = {
      statusCode: 200,
      json: function (body: any) {
        responseBody = body
      },
    } as unknown as Response

    middleware.use(req, res, () => {})

    res.json({ id: 'cust-1', name: 'Nikos' })

    expect(responseBody).toEqual({
      error: false,
      result: { id: 'cust-1', name: 'Nikos' },
    })
  })
})
