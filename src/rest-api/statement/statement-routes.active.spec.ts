import { BadRequestException, ExecutionContext, RequestMethod, StreamableFile } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { EnumUserRole } from '@prisma/types'
import type { Response } from 'express'
import { ADMIN_API_V1_PREFIX, COURIER_API_V1_PREFIX } from 'src/constants'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { EarningsCourierRestApiController } from 'src/rest-api/time-worked/courier/earnings.courier.rest-api.controller'
import { StatementFile, StatementService } from 'src/services/statement/statement.service'
import { TimeWorkedService } from 'src/services/time-worked/time-worked.service'
import { StatementAdminRestApiController } from './admin/statement.admin.rest-api.controller'
import { statementResponse } from './statement-response'

// Spec 0050 (AC-9, AC-10, cross checks 1, 14, 15): the rider's and the admin's statement routes and the
// file answer they share.

const PDF: StatementFile = {
  body: Buffer.from('%PDF-1.3 a statement'),
  contentType: 'application/pdf',
  filename: 'statement-2026-10.pdf',
  disposition: 'inline',
}
const CSV: StatementFile = {
  body: Buffer.from('﻿"Date"\r\n', 'utf8'),
  contentType: 'text/csv; charset=utf-8',
  filename: 'statement-2026-10.csv',
  disposition: 'attachment',
}

// A stand in for Express's response that remembers the headers set on it.
function fakeResponse() {
  const headers: Record<string, string> = {}
  const res = {
    set: jest.fn((values: Record<string, string>): void => {
      Object.assign(headers, values)
    }),
  }
  return { res: res as unknown as Response, headers }
}

const bytesOf = (file: StreamableFile): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = file.getStream()
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })

function mockStatements() {
  return {
    offeredMonths: jest.fn().mockResolvedValue(['2026-10', '2026-09']),
    downloads: jest.fn().mockResolvedValue([]),
    file: jest.fn().mockResolvedValue(PDF),
    fileForAdmin: jest.fn().mockResolvedValue(CSV),
  }
}

// The custom parameter decorator at `index` of a route, run against a request.
function customArg(controller: object, method: string, index: number, request: Record<string, unknown>) {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as Record<
    string,
    { index: number; factory?: (data: unknown, ctx: ExecutionContext) => unknown }
  >
  const custom = Object.entries(args).find(([key, arg]) => key.includes('__customRouteArgs__') && arg.index === index)
  if (!custom || !custom[1].factory) throw new Error(`No custom decorator on parameter ${index} of ${method}`)
  const ctx = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
  return custom[1].factory(undefined, ctx)
}

describe('statementResponse (spec 0050 cross check 15)', () => {
  test('the PDF opens in place: its type, an inline disposition with the filename, never cached', async () => {
    const { res, headers } = fakeResponse()

    const answer = statementResponse(res, PDF)

    expect(headers['Content-Type']).toBe('application/pdf')
    expect(headers['Content-Disposition']).toBe('inline; filename="statement-2026-10.pdf"')
    expect(headers['Cache-Control']).toBe('no-store')
    expect(answer).toBeInstanceOf(StreamableFile)
    expect((await bytesOf(answer)).equals(PDF.body)).toBe(true)
  })

  test('the CSV downloads: its type, an attachment disposition with the filename, never cached', async () => {
    const { res, headers } = fakeResponse()

    const answer = statementResponse(res, CSV)

    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(headers['Content-Disposition']).toBe('attachment; filename="statement-2026-10.csv"')
    expect(headers['Cache-Control']).toBe('no-store')
    expect((await bytesOf(answer)).equals(CSV.body)).toBe(true)
  })
})

describe("the rider's statement routes (spec 0050 AC-8, AC-10, cross check 1)", () => {
  const courier = new CourierEntity({ id: 'courier-session-1', firstName: 'Nikos', lastName: 'Rider' } as any)
  const proto = EarningsCourierRestApiController.prototype

  const build = () => {
    const statements = mockStatements()
    const controller = new EarningsCourierRestApiController(
      {} as unknown as TimeWorkedService,
      statements as unknown as StatementService
    )
    return { controller, statements }
  }

  test('they live under courier/v1/earnings, for couriers only, by GET', () => {
    expect(Reflect.getMetadata(PATH_METADATA, EarningsCourierRestApiController)).toBe(
      `${COURIER_API_V1_PREFIX}/earnings`
    )
    expect(Reflect.getMetadata(PATH_METADATA, proto.statementMonths)).toBe('statements')
    expect(Reflect.getMetadata(METHOD_METADATA, proto.statementMonths)).toBe(RequestMethod.GET)
    expect(Reflect.getMetadata(ROLES_KEY, proto.statementMonths)).toEqual([EnumUserRole.COURIER])
    expect(Reflect.getMetadata(PATH_METADATA, proto.statement)).toBe('statements/:month')
    expect(Reflect.getMetadata(METHOD_METADATA, proto.statement)).toBe(RequestMethod.GET)
    expect(Reflect.getMetadata(ROLES_KEY, proto.statement)).toEqual([EnumUserRole.COURIER])
  })

  test('AC-10: no route path takes a rider id, and the rider comes from the session, never the request', () => {
    expect(Reflect.getMetadata(PATH_METADATA, proto.statementMonths)).not.toContain(':')
    expect(Reflect.getMetadata(PATH_METADATA, proto.statement)).toBe('statements/:month')
    const request = {
      currentCourier: { id: 'courier-from-auth' },
      currentUser: { id: 'u1' },
      body: { courierId: 'forged' },
      query: { courierId: 'forged', id: 'forged' },
      params: { id: 'forged' },
    }

    expect(customArg(EarningsCourierRestApiController, 'statementMonths', 0, request)).toBe(request.currentCourier)
    expect(customArg(EarningsCourierRestApiController, 'statement', 0, request)).toBe(request.currentCourier)
  })

  test("AC-8: the months are the session rider's own", async () => {
    const { controller, statements } = build()

    expect(await controller.statementMonths(courier)).toEqual({ months: ['2026-10', '2026-09'] })
    expect(statements.offeredMonths).toHaveBeenCalledWith('courier-session-1')
  })

  test("AC-10: the file is the session rider's own, with the month, format and language asked", async () => {
    const { controller, statements } = build()
    const { res, headers } = fakeResponse()

    const answer = await controller.statement(courier, '2026-10', 'pdf', 'en', res)

    expect(statements.file).toHaveBeenCalledTimes(1)
    expect(statements.file).toHaveBeenCalledWith('courier-session-1', '2026-10', 'pdf', 'en')
    expect(statements.fileForAdmin).not.toHaveBeenCalled()
    expect(headers['Content-Type']).toBe('application/pdf')
    expect(headers['Content-Disposition']).toBe('inline; filename="statement-2026-10.pdf"')
    expect(headers['Cache-Control']).toBe('no-store')
    expect((await bytesOf(answer)).equals(PDF.body)).toBe(true)
  })

  test('AC-6: with no lang the statement is in Greek', async () => {
    const { controller, statements } = build()

    await controller.statement(courier, '2026-10', 'csv', undefined, fakeResponse().res)
    await controller.statement(courier, '2026-10', 'csv', 'de', fakeResponse().res)

    expect(statements.file).toHaveBeenNthCalledWith(1, 'courier-session-1', '2026-10', 'csv', 'el')
    expect(statements.file).toHaveBeenNthCalledWith(2, 'courier-session-1', '2026-10', 'csv', 'el')
  })

  test.each([['xlsx'], [''], [undefined], ['PDF']])('a format of %p answers 400 and makes no file', async (format) => {
    const { controller, statements } = build()
    const { res, headers } = fakeResponse()

    await expect(controller.statement(courier, '2026-10', format as string, 'el', res)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(statements.file).not.toHaveBeenCalled()
    expect(headers).toEqual({})
  })

  test('AC-10: a month the service refuses stays a 400 and sets no file headers', async () => {
    const { controller, statements } = build()
    statements.file.mockRejectedValue(new BadRequestException('There is no statement for that month'))
    const { res, headers } = fakeResponse()

    await expect(controller.statement(courier, '2026-11', 'pdf', 'el', res)).rejects.toBeInstanceOf(BadRequestException)
    expect(headers).toEqual({})
  })
})

describe("the admin's statement routes (spec 0050 AC-9, cross check 14)", () => {
  const admin = new UserEntity({ id: 'admin-user-9', email: 'anna@coop.gr' } as any)
  const proto = StatementAdminRestApiController.prototype

  const build = () => {
    const statements = mockStatements()
    const controller = new StatementAdminRestApiController(statements as unknown as StatementService)
    return { controller, statements }
  }

  test('they live under admin/v1/courier/:id/statements, by GET, for admins only', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StatementAdminRestApiController)).toBe(
      `${ADMIN_API_V1_PREFIX}/courier/:id/statements`
    )
    expect(Reflect.getMetadata(METHOD_METADATA, proto.list)).toBe(RequestMethod.GET)
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toEqual([EnumUserRole.ADMIN])
    expect(Reflect.getMetadata(PATH_METADATA, proto.file)).toBe(':month')
    expect(Reflect.getMetadata(METHOD_METADATA, proto.file)).toBe(RequestMethod.GET)
    expect(Reflect.getMetadata(ROLES_KEY, proto.file)).toEqual([EnumUserRole.ADMIN])
  })

  test('every route on the admin controller is admin only', () => {
    const routes = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, (proto as any)[name]) !== undefined
    )

    expect(routes.sort()).toEqual(['file', 'list'])
    for (const name of routes) {
      expect(Reflect.getMetadata(ROLES_KEY, (proto as any)[name])).toEqual([EnumUserRole.ADMIN])
    }
  })

  test('cross check 14: the list is the same months the rider gets, with the past downloads', async () => {
    const { controller, statements } = build()
    const downloads = [
      {
        id: 'dl-1',
        month: '2026-10',
        format: 'pdf',
        createdAt: new Date('2026-11-20T09:00:00Z'),
        adminEmail: 'anna@coop.gr',
      },
    ]
    statements.downloads.mockResolvedValue(downloads)

    const answer = await controller.list('courier-7')

    expect(answer).toEqual({ months: ['2026-10', '2026-09'], downloads })
    expect(statements.offeredMonths).toHaveBeenCalledWith('courier-7')
    expect(statements.downloads).toHaveBeenCalledWith('courier-7')
  })

  test('AC-9: the file goes through the recorded path, with the admin taken from the session', async () => {
    const { controller, statements } = build()
    const { res, headers } = fakeResponse()

    const answer = await controller.file('courier-7', '2026-10', 'csv', 'en', admin, res)

    expect(statements.fileForAdmin).toHaveBeenCalledTimes(1)
    expect(statements.fileForAdmin).toHaveBeenCalledWith('courier-7', '2026-10', 'csv', 'en', 'admin-user-9')
    // Never the unrecorded path.
    expect(statements.file).not.toHaveBeenCalled()
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(headers['Content-Disposition']).toBe('attachment; filename="statement-2026-10.csv"')
    expect(headers['Cache-Control']).toBe('no-store')
    expect((await bytesOf(answer)).equals(CSV.body)).toBe(true)
  })

  test("the admin is the session's user, not anything the request names", () => {
    const request = {
      currentUser: { id: 'admin-from-auth' },
      body: { adminUserId: 'forged' },
      query: { adminUserId: 'forged' },
    }

    expect(customArg(StatementAdminRestApiController, 'file', 4, request)).toBe(request.currentUser)
  })

  test("cross check 14: with no lang the admin's file is in Greek", async () => {
    const { controller, statements } = build()

    await controller.file('courier-7', '2026-10', 'pdf', undefined, admin, fakeResponse().res)

    expect(statements.fileForAdmin).toHaveBeenCalledWith('courier-7', '2026-10', 'pdf', 'el', 'admin-user-9')
  })

  test.each([['xlsx'], [''], [undefined]])('a format of %p answers 400 and records nothing', async (format) => {
    const { controller, statements } = build()

    await expect(
      controller.file('courier-7', '2026-10', format as string, 'el', admin, fakeResponse().res)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(statements.fileForAdmin).not.toHaveBeenCalled()
  })
})
