import { BadRequestException, NotFoundException } from '@nestjs/common'
import { EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import {
  RIDER_RANGE_MAX_DAYS,
  TOTALS_RANGE_MAX_DAYS,
  parseDayRange,
} from 'src/services/time-worked/time-worked.service'
import { TimeWorkedCourierRestApiController } from './courier/time-worked.courier.rest-api.controller'
import { TimeWorkedAdminRestApiController } from './admin/time-worked.admin.rest-api.controller'

describe('Time Worked - Ranges and Access (spec 0040, AC-18)', () => {
  describe('parseDayRange (AC-18)', () => {
    test('answers 400 with spec sentence for malformed day, non-strings, and 2026-02-30', () => {
      const expectedSentence = 'from and to must be days written as YYYY-MM-DD.'

      expect(() => parseDayRange('not-a-date', '2026-01-05', 31)).toThrow(
        new BadRequestException(expectedSentence)
      )
      expect(() => parseDayRange('2026-01-05', 'not-a-date', 31)).toThrow(
        new BadRequestException(expectedSentence)
      )
      // 2026 is not a leap year, and February never has 30 days
      expect(() => parseDayRange('2026-02-30', '2026-03-05', 31)).toThrow(
        new BadRequestException(expectedSentence)
      )
      expect(() => parseDayRange(123, '2026-01-05', 31)).toThrow(
        new BadRequestException(expectedSentence)
      )
      expect(() => parseDayRange('2026-01-01', null, 31)).toThrow(
        new BadRequestException(expectedSentence)
      )
      expect(() => parseDayRange(undefined, undefined, 31)).toThrow(
        new BadRequestException(expectedSentence)
      )
    })

    test('answers 400 with spec sentence when from is after to', () => {
      expect(() => parseDayRange('2026-03-02', '2026-03-01', 31)).toThrow(
        new BadRequestException('from must be on or before to.')
      )
    })

    test('answers 400 for 32 days against rider limit and accepts exactly 31', () => {
      // 2026-01-01 to 2026-02-01 is 32 days
      expect(() => parseDayRange('2026-01-01', '2026-02-01', RIDER_RANGE_MAX_DAYS)).toThrow(
        new BadRequestException('A range may cover at most 31 days.')
      )

      // 2026-01-01 to 2026-01-31 is exactly 31 days
      const result = parseDayRange('2026-01-01', '2026-01-31', RIDER_RANGE_MAX_DAYS)
      expect(result.from).toBe('2026-01-01')
      expect(result.to).toBe('2026-01-31')
      expect(result.rangeStart).toBeDefined()
      expect(result.rangeEnd).toBeDefined()
    })

    test('answers 400 for 93 days against totals limit and accepts exactly 92', () => {
      // 2026-01-01 to 2026-04-03 is 93 days
      expect(() => parseDayRange('2026-01-01', '2026-04-03', TOTALS_RANGE_MAX_DAYS)).toThrow(
        new BadRequestException('A range may cover at most 92 days.')
      )

      // 2026-01-01 to 2026-04-02 is exactly 92 days
      const result = parseDayRange('2026-01-01', '2026-04-02', TOTALS_RANGE_MAX_DAYS)
      expect(result.from).toBe('2026-01-01')
      expect(result.to).toBe('2026-04-02')
    })
  })

  describe('Route Access and Roles (AC-18)', () => {
    test('the rider controller routes take no courier id and carry @Roles(COURIER)', () => {
      const courierProto = TimeWorkedCourierRestApiController.prototype

      // Check Roles metadata
      expect(Reflect.getMetadata(ROLES_KEY, courierProto.current)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(ROLES_KEY, courierProto.coopTotals)).toEqual([EnumUserRole.COURIER])
      expect(Reflect.getMetadata(ROLES_KEY, courierProto.list)).toEqual([EnumUserRole.COURIER])

      // Verify none of the methods take an id in route path
      const currentPath = Reflect.getMetadata('path', courierProto.current)
      const coopTotalsPath = Reflect.getMetadata('path', courierProto.coopTotals)
      const listPath = Reflect.getMetadata('path', courierProto.list)

      expect(currentPath).toBe('current')
      expect(coopTotalsPath).toBe('coop-totals')
      expect(listPath).toBe('/')
    })

    test('both admin routes carry @Roles(ADMIN)', () => {
      const adminProto = TimeWorkedAdminRestApiController.prototype

      expect(Reflect.getMetadata(ROLES_KEY, adminProto.forRider)).toEqual([EnumUserRole.ADMIN])
      expect(Reflect.getMetadata(ROLES_KEY, adminProto.totals)).toEqual([EnumUserRole.ADMIN])
    })

    test('the admin rider route answers 404 for an unknown courier', async () => {
      const mockCourierRepository = {
        findById: jest.fn().mockResolvedValue(null),
      }
      const mockTimeWorkedService = {
        forRider: jest.fn(),
      }

      const controller = new TimeWorkedAdminRestApiController(
        mockTimeWorkedService as any,
        mockCourierRepository as any
      )

      await expect(
        controller.forRider('unknown-courier-id', { from: '2026-01-01', to: '2026-01-10' })
      ).rejects.toThrow(new NotFoundException('Courier not found'))

      expect(mockTimeWorkedService.forRider).not.toHaveBeenCalled()
    })
  })
})
