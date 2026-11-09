import { NotFoundException } from '@nestjs/common'
import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueDomainService } from './delivery-issue.domain.service'
import {
  DeliveryIssueForAdmin,
  DeliveryIssueRepository,
  DeliveryIssueWithCourier,
} from 'src/persistence/repositories/delivery-issue.repository'

describe('DeliveryIssueDomainService (clause 3)', () => {
  let service: DeliveryIssueDomainService
  let mockRepository: jest.Mocked<DeliveryIssueRepository>

  const mockCreatedIssue: DeliveryIssueWithCourier = {
    id: 'issue-101',
    deliveryId: 'del-101',
    courierId: 'courier-202',
    reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
    note: 'Customer is at second entrance',
    createdAt: new Date('2026-10-27T08:15:00.000Z'),
    courier: {
      firstName: 'Dimitris',
      lastName: 'Nikolaou',
    },
  }

  beforeEach(() => {
    mockRepository = {
      create: jest.fn().mockResolvedValue(mockCreatedIssue),
      findForDelivery: jest.fn().mockResolvedValue([mockCreatedIssue]),
      markHandled: jest.fn(),
    } as unknown as jest.Mocked<DeliveryIssueRepository>

    service = new DeliveryIssueDomainService(mockRepository)
  })

  describe('report', () => {
    test('trims leading and trailing whitespace from the note', async () => {
      await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: '   Customer is at second entrance   ',
      })

      expect(mockRepository.create).toHaveBeenCalledWith({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Customer is at second entrance',
      })
    })

    test.each([
      ['empty string', ''],
      ['spaces only', '     '],
      ['whitespace with tabs and newlines', ' \t \n  '],
      ['null', null],
      ['undefined', undefined],
    ])('stores %s note as null', async (_desc, noteValue) => {
      await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.NO_SIGNAL,
        note: noteValue,
      })

      expect(mockRepository.create).toHaveBeenCalledWith({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.NO_SIGNAL,
        note: null,
      })
    })

    test('returns the stored DeliveryIssue from repository', async () => {
      const result = await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Customer is at second entrance',
      })

      expect(result).toBe(mockCreatedIssue)
    })
  })

  describe('listForDelivery', () => {
    test('delegates deliveryId to repository.findForDelivery', async () => {
      const result = await service.listForDelivery('del-101')

      expect(mockRepository.findForDelivery).toHaveBeenCalledWith('del-101')
      expect(result).toEqual([mockCreatedIssue])
    })
  })

  describe('markHandled (spec 0034, AC-7)', () => {
    test('delegates to repository with current timestamp and returns handled issue', async () => {
      const mockHandled: DeliveryIssueForAdmin = {
        id: 'issue-101',
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: null,
        createdAt: new Date('2026-11-09T10:00:00.000Z'),
        handledAt: new Date('2026-11-09T12:00:00.000Z'),
        handledByUserId: 'admin-1',
        handledBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
        courier: { firstName: 'Dimitris', lastName: 'Nikolaou' },
      }
      mockRepository.markHandled.mockResolvedValue(mockHandled)

      const result = await service.markHandled('del-101', 'issue-101', 'admin-1')

      expect(mockRepository.markHandled).toHaveBeenCalledWith('del-101', 'issue-101', 'admin-1', expect.any(Date))
      expect(result).toEqual(mockHandled)
    })

    test('throws NotFoundException when repository returns null (unknown issue or delivery)', async () => {
      mockRepository.markHandled.mockResolvedValue(null)

      await expect(service.markHandled('del-unknown', 'issue-unknown', 'admin-1')).rejects.toThrow(
        NotFoundException
      )
      await expect(service.markHandled('del-unknown', 'issue-unknown', 'admin-1')).rejects.toThrow(
        'Report issue-unknown not found on delivery del-unknown'
      )
    })
  })
})
