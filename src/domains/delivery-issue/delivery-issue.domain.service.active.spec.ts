import { NotFoundException } from '@nestjs/common'
import { EnumDeliveryIssueReason, Prisma } from '@prisma/types'
import { DeliveryIssueDomainService } from './delivery-issue.domain.service'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import {
  DeliveryIssueForAdmin,
  DeliveryIssueRepository,
  DeliveryIssueWithCourier,
} from 'src/persistence/repositories/delivery-issue.repository'

describe('DeliveryIssueDomainService (clause 3)', () => {
  let service: DeliveryIssueDomainService
  let mockRepository: jest.Mocked<DeliveryIssueRepository>
  let mockChatDomainService: jest.Mocked<ChatDomainService>

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

    mockChatDomainService = {
      addSystemLine: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ChatDomainService>

    service = new DeliveryIssueDomainService(mockRepository, mockChatDomainService)
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

    test('AC-16: adds a SYSTEM line "Reported: <reason words>" with note on its own line', async () => {
      await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Customer is at second entrance',
      })

      expect(mockChatDomainService.addSystemLine).toHaveBeenCalledWith(
        'courier-202',
        'del-101',
        'Reported: Wrong address\nCustomer is at second entrance'
      )
    })

    test('AC-16: adds a SYSTEM line without note when note is null or empty', async () => {
      mockRepository.create.mockResolvedValueOnce({
        ...mockCreatedIssue,
        reason: EnumDeliveryIssueReason.FOOD_NOT_READY,
        note: null,
      })

      await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.FOOD_NOT_READY,
      })

      expect(mockChatDomainService.addSystemLine).toHaveBeenCalledWith(
        'courier-202',
        'del-101',
        'Reported: Marked ready but not ready'
      )
    })

    test('AC-16: if addSystemLine throws, the report still succeeds', async () => {
      mockChatDomainService.addSystemLine.mockRejectedValueOnce(new Error('chat db failed'))

      const result = await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Some note',
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

  describe('Row 139 (Clause 2): Logging privacy when adding report to rider chat fails', () => {
    const recipientName = 'Kostas Varnalis'
    const recipientPhone = '+306949876543'

    test('withholds recipient name and phone when chatDomainService.addSystemLine throws a Prisma error', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
      const validationMessage = `Invalid \`prisma.delivery.create()\` invocation:\n{\n  recipientName: "${recipientName}",\n  phone: "${recipientPhone}"\n}`
      const prismaError = new Prisma.PrismaClientValidationError(validationMessage, {
        clientVersion: '5.3.1',
      })

      mockChatDomainService.addSystemLine.mockRejectedValue(prismaError)

      const result = await service.report({
        deliveryId: 'del-101',
        courierId: 'courier-202',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Customer address issue',
      })

      // The report itself still succeeds (AC-16)
      expect(result).toEqual(mockCreatedIssue)

      // The logger was called without the customer details
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      const callArgs = loggerErrorSpy.mock.calls[0]!
      const loggedText = callArgs.map(String).join(' ')
      expect(loggedText).not.toContain(recipientName)
      expect(loggedText).not.toContain(recipientPhone)
      expect(loggedText).toContain('PrismaClientValidationError')
      expect(loggedText).toContain(`Could not add report ${mockCreatedIssue.id} to the rider's chat`)

      loggerErrorSpy.mockRestore()
    })
  })
})
