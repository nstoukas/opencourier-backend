import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
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
import { adminDeliveryListWhere } from './queries/delivery-list-filter'
import { DeliveryFindManyAdminArgs } from './queries/delivery-find-many.admin.args'

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
      occurredAt: new Date('2026-07-28T21:58:51.940Z'),
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
      occurredAt: new Date('2026-07-28T22:10:13.423Z'),
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
      occurredAt: new Date('2026-07-30T06:48:53.413Z'),
      createdAt: new Date('2026-07-30T06:48:53.413Z'),
      updatedAt: new Date('2026-07-30T06:48:53.413Z'),
    }),
  ]

  beforeEach(() => {
    // Create minimal mock for DeliveryDomainService with write method stubs
    mockDeliveryDomainService = {
      getById: jest.fn(),
      getByIdOrThrow: jest.fn(),
      getByIdOrThrowWithQuote: jest.fn(),
      getPartnerCharge: jest.fn(),
      getMany: jest.fn(),
      update: jest.fn(),
      submitDeliveryEvent: jest.fn(),
      reassignDelivery: jest.fn(),
      getOfferViews: jest.fn(),
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
        occurredAt: new Date('2026-07-28T22:00:00.000Z'),
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

    test('getDeliveryIssues is routed at PATH :deliveryId/issues with METHOD GET', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.getDeliveryIssues)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.getDeliveryIssues)
      expect(path).toBe(':deliveryId/issues')
      expect(method).toBe(RequestMethod.GET)
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

  describe('getDeliveries (row 96)', () => {
    // Paginated delivery data fixture
    const mockDeliveriesData = {
      data: [
        {
          id: 'del-1',
          orderReference: 'ORD-101',
          pickupBusinessName: 'Souvlaki tou Nikou',
          dropoffName: 'Elena Kostopoulou',
          courierId: 'courier-1',
          status: EnumDeliveryStatus.ACCEPTED,
          createdAt: new Date('2026-10-31T20:00:00.000Z'),
          updatedAt: new Date('2026-10-31T20:00:00.000Z'),
        } as any,
      ],
      total: 1,
      page: 1,
      perPage: 10,
      totalPages: 1,
    }

    beforeEach(() => {
      mockDeliveryDomainService.getMany.mockResolvedValue(mockDeliveriesData)
      mockDeliveryDomainService.getOfferViews.mockResolvedValue(new Map())
    })

    test('passes courierId, partnerId, state, and search converted to where to deliveryDomainService.getMany with page and perPage', async () => {
      const args: DeliveryFindManyAdminArgs = {
        courierId: 'courier-1',
        partnerId: 'partner-volos-1',
        state: 'active',
        search: 'Nikou',
        page: 2,
        perPage: 15,
      }

      const result = await controller.getDeliveries(args)

      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledTimes(1)
      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledWith(
        adminDeliveryListWhere({
          courierId: 'courier-1',
          partnerId: 'partner-volos-1',
          state: 'active',
          search: 'Nikou',
        }),
        2,
        15
      )
      expect(mockDeliveryDomainService.getOfferViews).toHaveBeenCalledWith(mockDeliveriesData.data)
      expect(result.data).toHaveLength(1)
    })

    test('fails if partnerId is dropped on the way to getMany (spec 0017 AC-7)', async () => {
      await controller.getDeliveries({ partnerId: 'partner-1' })

      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledTimes(1)
      const call = mockDeliveryDomainService.getMany.mock.calls[0]
      expect(call).toBeDefined()
      const calledWhere = call![0]
      expect(calledWhere).toHaveProperty('partnerId', 'partner-1')
    })

    test('fails if state is dropped on the way to getMany', async () => {
      // Must pass state to adminDeliveryListWhere and forward resulting status rule
      await controller.getDeliveries({ state: 'active' })

      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledTimes(1)
      const call = mockDeliveryDomainService.getMany.mock.calls[0]
      expect(call).toBeDefined()
      const calledWhere = call![0]
      expect(calledWhere).toHaveProperty('status')
      expect(calledWhere.status).toEqual({
        notIn: [
          EnumDeliveryStatus.DROPPED_OFF,
          EnumDeliveryStatus.CANCELED,
          EnumDeliveryStatus.FAILED,
        ],
      })
    })

    test('fails if search is dropped on the way to getMany', async () => {
      // Must pass search to adminDeliveryListWhere and forward resulting OR rule
      await controller.getDeliveries({ search: 'ORD-101' })

      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledTimes(1)
      const call = mockDeliveryDomainService.getMany.mock.calls[0]
      expect(call).toBeDefined()
      const calledWhere = call![0]
      expect(calledWhere).toHaveProperty('OR')
      expect(calledWhere.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            orderReference: { contains: 'ORD-101', mode: 'insensitive' },
          }),
        ])
      )
    })

    test('passes empty where when no filter args are provided', async () => {
      await controller.getDeliveries({})

      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledWith({}, undefined, undefined)
    })

    test('getDeliveries handler carries @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getDeliveries)
      expect(roles).toEqual([EnumUserRole.ADMIN])
    })

    test('getDeliveries is routed at PATH "/" with METHOD GET', () => {
      const path = Reflect.getMetadata(PATH_METADATA, controller.getDeliveries)
      const method = Reflect.getMetadata(METHOD_METADATA, controller.getDeliveries)
      expect(path).toBe('/')
      expect(method).toBe(RequestMethod.GET)
    })
  })

  describe('getDelivery (Spec 0015 AC-13)', () => {
    it('carries partnerCharge on cancelled delivery when present', async () => {
      const mockCancelledDelivery = {
        id: mockDeliveryId,
        cancelledAt: new Date('2026-11-01T10:00:00Z'),
        status: EnumDeliveryStatus.CANCELED,
      }
      const mockCharge = {
        amount: 850,
        currencyCode: 'EUR',
        createdAt: new Date('2026-11-01T10:00:01Z'),
      }

      mockDeliveryDomainService.getByIdOrThrowWithQuote.mockResolvedValue({
        delivery: mockCancelledDelivery as any,
        quote: null as any,
      })
      mockDeliveryDomainService.getOfferViews.mockResolvedValue(new Map())
      mockDeliveryDomainService.getPartnerCharge.mockResolvedValue(mockCharge as any)

      const dto = await controller.getDelivery(mockDeliveryId)

      expect(mockDeliveryDomainService.getPartnerCharge).toHaveBeenCalledWith(mockDeliveryId)
      expect(dto.partnerCharge).toEqual(mockCharge)
    })

    it('returns partnerCharge as null and does not query getPartnerCharge when delivery was not cancelled', async () => {
      const mockActiveDelivery = {
        id: mockDeliveryId,
        cancelledAt: null,
        status: EnumDeliveryStatus.ACCEPTED,
      }

      mockDeliveryDomainService.getByIdOrThrowWithQuote.mockResolvedValue({
        delivery: mockActiveDelivery as any,
        quote: null as any,
      })
      mockDeliveryDomainService.getOfferViews.mockResolvedValue(new Map())

      const dto = await controller.getDelivery(mockDeliveryId)

      expect(mockDeliveryDomainService.getPartnerCharge).not.toHaveBeenCalled()
      expect(dto.partnerCharge).toBeNull()
    })
  })
})
