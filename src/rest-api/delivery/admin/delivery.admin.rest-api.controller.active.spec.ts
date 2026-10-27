import { DeliveryAdminRestApiController } from './delivery.admin.rest-api.controller'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryEventDomainService } from 'src/domains/delivery-event/delivery-event.domain.service'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { DeliveryNotFoundException } from 'src/errors'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryIssueReason,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumUserRole,
} from '@prisma/types'

describe('DeliveryAdminRestApiController', () => {
  let controller: DeliveryAdminRestApiController
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockDeliveryEventDomainService: jest.Mocked<DeliveryEventDomainService>
  let mockDeliveryIssueDomainService: jest.Mocked<DeliveryIssueDomainService>

  // Shared test fixture modelled on real delivery cms57718o0007np9uq4ayigd4 rows
  const mockDeliveryId = 'cms57718o0007np9uq4ayigd4'
  const reassignmentMessage =
    'Admin reassigned delivery from courier testing-courier to courier cmreq8leu000tnpr6h3zrkw1y; payout policy FULL_COMPENSATION awards 10185 USD (cents) to the dropped courier: Moped broke down — verified end to end'

  const mockDeliveryEvents: DeliveryEventEntity[] = [
    new DeliveryEventEntity({
      id: 'evt-1',
      deliveryId: mockDeliveryId,
      courierId: null,
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      eventSource: EnumDeliveryEventSource.PARTNER_APP,
      oldStatus: EnumDeliveryStatus.CREATED,
      newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      transitionSuccessful: true,
      message: null,
      createdAt: new Date('2026-07-28T21:58:51.940Z'),
      updatedAt: new Date('2026-07-28T21:58:51.940Z'),
    }),
    new DeliveryEventEntity({
      id: 'evt-2',
      deliveryId: mockDeliveryId,
      courierId: null,
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.COURIER,
      eventSource: EnumDeliveryEventSource.OPENCOURIER,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ACCEPTED,
      transitionSuccessful: true,
      message: null,
      createdAt: new Date('2026-07-28T22:10:13.423Z'),
      updatedAt: new Date('2026-07-28T22:10:13.423Z'),
    }),
    new DeliveryEventEntity({
      id: 'evt-3',
      deliveryId: mockDeliveryId,
      courierId: null,
      type: EnumDeliveryEventType.REASSIGNED,
      actor: EnumEventActor.ADMIN,
      eventSource: EnumDeliveryEventSource.OPENCOURIER,
      oldStatus: EnumDeliveryStatus.ACCEPTED,
      newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      transitionSuccessful: true,
      message: reassignmentMessage,
      createdAt: new Date('2026-07-30T06:48:53.413Z'),
      updatedAt: new Date('2026-07-30T06:48:53.413Z'),
    }),
  ]

  beforeEach(() => {
    // Create minimal mock for DeliveryDomainService with write method stubs
    mockDeliveryDomainService = {
      getById: jest.fn(),
      getByIdOrThrow: jest.fn(),
      getMany: jest.fn(),
      update: jest.fn(),
      submitDeliveryEvent: jest.fn(),
      reassignDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryDomainService>

    // Create minimal mock for DeliveryEventDomainService
    mockDeliveryEventDomainService = {
      getEventHistoryForDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventDomainService>

    // Create minimal mock for DeliveryIssueDomainService
    mockDeliveryIssueDomainService = {
      report: jest.fn(),
      listForDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryIssueDomainService>

    // Construct controller directly using dependency injection pattern
    controller = new DeliveryAdminRestApiController(
      mockDeliveryDomainService,
      mockDeliveryEventDomainService,
      mockDeliveryIssueDomainService
    )
  })

  describe('getDeliveryEvents', () => {
    test('returns the full history, oldest first, with every field mapped', async () => {
      // Mock delivery existence check resolving a valid delivery object
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryEventDomainService.getEventHistoryForDelivery.mockResolvedValue(mockDeliveryEvents)

      const result = await controller.getDeliveryEvents(mockDeliveryId)

      // Assert full history returned in chronological order
      expect(result).toHaveLength(3)
      expect(result.map((e) => e.type)).toEqual(['CREATED', 'ACCEPTED', 'REASSIGNED'])

      // Assert specific field mappings on the reassignment event
      const reassignedEvent = result[2]
      expect(reassignedEvent?.actor).toBe('ADMIN')
      expect(reassignedEvent?.eventSource).toBe('OPENCOURIER')
      expect(reassignedEvent?.oldStatus).toBe('ACCEPTED')
      expect(reassignedEvent?.newStatus).toBe('ASSIGNING_COURIER')
      expect(reassignedEvent?.transitionSuccessful).toBe(true)
      expect(reassignedEvent?.createdAt.toISOString()).toBe('2026-07-30T06:48:53.413Z')
    })

    test('the reassignment message survives verbatim', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryEventDomainService.getEventHistoryForDelivery.mockResolvedValue(mockDeliveryEvents)

      const result = await controller.getDeliveryEvents(mockDeliveryId)

      // Assert reassignment message is preserved without truncation
      expect(result[2]?.message).toBe(reassignmentMessage)
    })

    test('the domain service is called with the id from the URL', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryEventDomainService.getEventHistoryForDelivery.mockResolvedValue([])

      await controller.getDeliveryEvents(mockDeliveryId)

      // Verify event history domain service queried with exact delivery ID parameter
      expect(mockDeliveryEventDomainService.getEventHistoryForDelivery).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventDomainService.getEventHistoryForDelivery).toHaveBeenCalledWith(mockDeliveryId)
    })

    test('unknown delivery 404s instead of returning an empty array', async () => {
      // DeliveryDomainService returns null when delivery does not exist
      mockDeliveryDomainService.getById.mockResolvedValue(null)

      const unknownId = 'unknown-delivery-id'

      // Assert call throws DeliveryNotFoundException carrying the delivery ID
      await expect(controller.getDeliveryEvents(unknownId)).rejects.toThrow(DeliveryNotFoundException)
      await expect(controller.getDeliveryEvents(unknownId)).rejects.toThrow(`Delivery ${unknownId} not found`)

      // Assert domain service event query was not called for missing delivery
      expect(mockDeliveryEventDomainService.getEventHistoryForDelivery).not.toHaveBeenCalled()
    })

    test('a real delivery with no events returns [] with no error', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryEventDomainService.getEventHistoryForDelivery.mockResolvedValue([])

      const result = await controller.getDeliveryEvents(mockDeliveryId)

      // Empty event list for existing delivery returns empty array
      expect(result).toEqual([])
    })

    test('unsuccessful transitions are returned, not hidden', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)

      // Fixture includes a failed event where transitionSuccessful is false
      const failedEvent = new DeliveryEventEntity({
        id: 'evt-failed',
        deliveryId: mockDeliveryId,
        courierId: null,
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.ADMIN,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        oldStatus: EnumDeliveryStatus.DISPATCHED,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        transitionSuccessful: false,
        message: 'Courier ID is required for dispatching',
        createdAt: new Date('2026-07-28T22:00:00.000Z'),
        updatedAt: new Date('2026-07-28T22:00:00.000Z'),
      })

      mockDeliveryEventDomainService.getEventHistoryForDelivery.mockResolvedValue([failedEvent])

      const result = await controller.getDeliveryEvents(mockDeliveryId)

      // Assert failed transition is returned and transitionSuccessful boolean is false
      expect(result).toHaveLength(1)
      expect(result[0]?.transitionSuccessful).toBe(false)
      expect(result[0]?.message).toBe('Courier ID is required for dispatching')
    })

    test('the endpoint writes nothing', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryEventDomainService.getEventHistoryForDelivery.mockResolvedValue(mockDeliveryEvents)

      await controller.getDeliveryEvents(mockDeliveryId)

      // Verify read-only contract: no state update or event submission methods were invoked
      expect(mockDeliveryDomainService.update).toHaveBeenCalledTimes(0)
      expect(mockDeliveryDomainService.submitDeliveryEvent).toHaveBeenCalledTimes(0)
      expect(mockDeliveryDomainService.reassignDelivery).toHaveBeenCalledTimes(0)
    })
  })

  describe('getDeliveryIssues (clause 5)', () => {
    const mockIssues: DeliveryIssueWithCourier[] = [
      {
        id: 'issue-1',
        deliveryId: mockDeliveryId,
        courierId: 'courier-1',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Customer specified wrong street number',
        createdAt: new Date('2026-10-27T08:00:00.000Z'),
        courier: {
          firstName: 'Nikos',
          lastName: 'Papastamou',
        },
      },
      {
        id: 'issue-2',
        deliveryId: mockDeliveryId,
        courierId: 'courier-2',
        reason: EnumDeliveryIssueReason.NO_SIGNAL,
        note: null,
        createdAt: new Date('2026-10-27T08:30:00.000Z'),
        courier: {
          firstName: 'Maria',
          lastName: 'Oikonomou',
        },
      },
    ]

    test('answers DeliveryIssueAdminDto[] with id, reason, note, createdAt, courierId, and courierName "First Last"', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryIssueDomainService.listForDelivery.mockResolvedValue(mockIssues)

      const result = await controller.getDeliveryIssues(mockDeliveryId)

      expect(mockDeliveryDomainService.getById).toHaveBeenCalledWith(mockDeliveryId)
      expect(mockDeliveryIssueDomainService.listForDelivery).toHaveBeenCalledWith(mockDeliveryId)
      expect(result).toHaveLength(2)

      expect(result[0]?.id).toBe('issue-1')
      expect(result[0]?.reason).toBe(EnumDeliveryIssueReason.WRONG_ADDRESS)
      expect(result[0]?.note).toBe('Customer specified wrong street number')
      expect(result[0]?.createdAt.toISOString()).toBe('2026-10-27T08:00:00.000Z')
      expect(result[0]?.courierId).toBe('courier-1')
      expect(result[0]?.courierName).toBe('Nikos Papastamou')

      expect(result[1]?.id).toBe('issue-2')
      expect(result[1]?.reason).toBe(EnumDeliveryIssueReason.NO_SIGNAL)
      expect(result[1]?.note).toBeNull()
      expect(result[1]?.createdAt.toISOString()).toBe('2026-10-27T08:30:00.000Z')
      expect(result[1]?.courierId).toBe('courier-2')
      expect(result[1]?.courierName).toBe('Maria Oikonomou')
    })

    test('unknown delivery answers 404 rather than an empty list', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue(null)

      const unknownId = 'del-unknown-999'
      await expect(controller.getDeliveryIssues(unknownId)).rejects.toThrow(DeliveryNotFoundException)
      await expect(controller.getDeliveryIssues(unknownId)).rejects.toThrow(`Delivery ${unknownId} not found`)

      // Stored reports are not queried for unknown delivery
      expect(mockDeliveryIssueDomainService.listForDelivery).not.toHaveBeenCalled()
    })

    test('a real delivery with no issues returns [] with no error', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryIssueDomainService.listForDelivery.mockResolvedValue([])

      const result = await controller.getDeliveryIssues(mockDeliveryId)
      expect(result).toEqual([])
    })

    test('getDeliveryIssues handler carries @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getDeliveryIssues)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('the endpoint is read-only and writes nothing', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({ id: mockDeliveryId } as any)
      mockDeliveryIssueDomainService.listForDelivery.mockResolvedValue(mockIssues)

      await controller.getDeliveryIssues(mockDeliveryId)

      expect(mockDeliveryDomainService.update).toHaveBeenCalledTimes(0)
      expect(mockDeliveryDomainService.submitDeliveryEvent).toHaveBeenCalledTimes(0)
      expect(mockDeliveryDomainService.reassignDelivery).toHaveBeenCalledTimes(0)
    })
  })
})
