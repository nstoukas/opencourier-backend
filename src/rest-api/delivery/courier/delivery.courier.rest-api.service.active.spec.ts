import { EnumDeliveryIssueReason } from '@prisma/types'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { LocationNoteReactionDomainService } from 'src/domains/location-note-reaction/location-note-reaction.domain.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'

describe('DeliveryRestApiCourierService.reportIssue (clauses 1 & 6)', () => {
  let service: DeliveryRestApiCourierService
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockDeliveryIssueDomainService: jest.Mocked<DeliveryIssueDomainService>

  const deliveryId = 'del-assigned-101'
  const courierId = 'courier-assigned-202'

  const mockStoredIssue: DeliveryIssueWithCourier = {
    id: 'issue-xyz-1',
    deliveryId,
    courierId,
    reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
    note: 'Wrong buzzer on street',
    createdAt: new Date('2026-10-27T08:00:00.000Z'),
    courier: {
      firstName: 'Nikos',
      lastName: 'Papastamou',
    },
  }

  beforeEach(() => {
    mockDeliveryDomainService = {
      getById: jest.fn(),
      update: jest.fn(),
      submitDeliveryEvent: jest.fn(),
    } as unknown as jest.Mocked<DeliveryDomainService>

    mockDeliveryIssueDomainService = {
      report: jest.fn().mockResolvedValue(mockStoredIssue),
      listForDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryIssueDomainService>

    service = new DeliveryRestApiCourierService(
      mockDeliveryDomainService,
      {} as LocationNoteDomainService,
      {} as LocationNoteReactionDomainService,
      mockDeliveryIssueDomainService
    )
  })

  test('stores a DeliveryIssue for a delivery assigned to the calling rider', async () => {
    // Delivery domain service finds delivery matching deliveryId AND courierId filter
    mockDeliveryDomainService.getById.mockResolvedValue({
      id: deliveryId,
      courierId: courierId,
    } as any)

    const input = {
      reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
      note: 'Wrong buzzer on street',
    }

    const result = await service.reportIssue(deliveryId, courierId, input)

    expect(mockDeliveryDomainService.getById).toHaveBeenCalledWith(deliveryId, { courierId })
    expect(mockDeliveryIssueDomainService.report).toHaveBeenCalledWith({
      deliveryId,
      courierId,
      reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
      note: 'Wrong buzzer on street',
    })
    expect(result).toBe(mockStoredIssue)
  })

  test('answers 404 DeliveryNotFoundException and stores nothing when delivery is not assigned to rider or unknown', async () => {
    // getById returns null when delivery does not belong to courierId or does not exist
    mockDeliveryDomainService.getById.mockResolvedValue(null)

    const input = {
      reason: EnumDeliveryIssueReason.OTHER,
      note: 'Cannot find restaurant',
    }

    await expect(service.reportIssue('del-other-courier', courierId, input)).rejects.toThrow(
      DeliveryNotFoundException
    )
    await expect(service.reportIssue('del-other-courier', courierId, input)).rejects.toThrow(
      'Delivery not found'
    )

    // Critical: nothing stored when delivery is not found/not assigned to this courier
    expect(mockDeliveryIssueDomainService.report).not.toHaveBeenCalled()
  })

  test('clause 6: emits no DeliveryEvent, updates no status, and writes neither undeliverableAction nor undeliverableReason', async () => {
    mockDeliveryDomainService.getById.mockResolvedValue({
      id: deliveryId,
      courierId: courierId,
      undeliverableAction: null,
      undeliverableReason: null,
    } as any)

    const input = {
      reason: EnumDeliveryIssueReason.ORDER_HANDED,
      note: 'Handed directly to recipient at gate',
    }

    await service.reportIssue(deliveryId, courierId, input)

    // Must NOT call update or submitDeliveryEvent on deliveryDomainService
    expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
    expect(mockDeliveryDomainService.submitDeliveryEvent).not.toHaveBeenCalled()
  })
})
