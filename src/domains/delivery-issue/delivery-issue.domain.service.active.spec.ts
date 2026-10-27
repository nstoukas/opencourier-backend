import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryIssueDomainService } from './delivery-issue.domain.service'
import {
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
})
