import { EnumCourierStatus, EnumDeliveryIssueReason, EnumDeliveryStatus } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryIssueRepository } from 'src/persistence/repositories/delivery-issue.repository'
import { DispatchBoardRepository } from 'src/persistence/repositories/dispatch-board.repository'
import { DispatchStopService } from 'src/services/dispatch-stop/dispatch-stop.service'
import { SosService } from 'src/services/sos/sos.service'
import { DispatchBoardService } from './dispatch-board.service'
import { ATTENTION_KIND, removalRequestRows, todayBounds } from './dispatch-board'

describe('DispatchBoardService (spec 0034)', () => {
  let service: DispatchBoardService
  let mockDispatchBoardRepo: jest.Mocked<DispatchBoardRepository>
  let mockDeliveryIssueRepo: jest.Mocked<DeliveryIssueRepository>
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockSosService: jest.Mocked<SosService>
  let mockDispatchStopService: jest.Mocked<DispatchStopService>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockRemovalRequestRepo: any
  let mockChatDomainService: any

  const NOW = new Date('2026-11-09T14:00:00.000Z')

  beforeEach(() => {
    mockDispatchBoardRepo = {
      findLiveDeliveries: jest.fn().mockResolvedValue([]),
      findWorkingCouriers: jest.fn().mockResolvedValue([]),
      findDroppedOffBetween: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DispatchBoardRepository>

    mockDeliveryIssueRepo = {
      findOpen: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryIssueRepository>

    mockDeliveryDomainService = {
      getOfferViews: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<DeliveryDomainService>

    mockSosService = {
      listCurrent: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SosService>

    mockDispatchStopService = {
      adminOverview: jest.fn().mockResolvedValue({ current: null, scheduled: [], history: [] }),
    } as unknown as jest.Mocked<DispatchStopService>

    mockConfigDomainService = {
      instanceConfig: {
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockRemovalRequestRepo = {
      findOpenForBoard: jest.fn().mockResolvedValue([]),
    }

    mockChatDomainService = {
      unreadThreadsForBoard: jest.fn().mockResolvedValue([]),
    }

    service = new DispatchBoardService(
      mockDispatchBoardRepo,
      mockDeliveryIssueRepo,
      mockDeliveryDomainService,
      mockSosService,
      mockDispatchStopService,
      mockConfigDomainService,
      mockRemovalRequestRepo,
      mockChatDomainService as any
    )
  })

  // AC-16: Dispatch stop in force
  describe('dispatchStop (AC-16)', () => {
    test('when a stop is in force, answers active: true and until from stop.current.endsAt', async () => {
      const endsAt = new Date('2026-11-09T18:00:00.000Z')
      mockDispatchStopService.adminOverview.mockResolvedValue({
        current: {
          id: 'stop-1',
          startsAt: new Date('2026-11-09T12:00:00.000Z'),
          endsAt,
          reason: 'Heavy snow in Volos',
        } as any,
        scheduled: [],
        history: [],
      })

      const board = await service.getBoard(NOW)

      expect(board.dispatchStop).toEqual({
        active: true,
        until: endsAt,
      })
      expect(mockDispatchStopService.adminOverview).toHaveBeenCalledWith(NOW)
    })

    test('when NO stop is in force, answers active: false and until: null', async () => {
      mockDispatchStopService.adminOverview.mockResolvedValue({
        current: null,
        scheduled: [],
        history: [],
      })

      const board = await service.getBoard(NOW)

      expect(board.dispatchStop).toEqual({
        active: false,
        until: null,
      })
    })
  })

  // Full integration of repositories and attention row assembly
  describe('getBoard integration (AC-2 to AC-8, AC-11, AC-16)', () => {
    test('fetches all data in parallel, queries todayBounds for dropped off, and builds unified board', async () => {
      const { start, end } = todayBounds(NOW)

      const mockLive = [
        {
          id: 'del-waiting',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          orderReference: 'ORD-W',
          pickupBusinessName: 'Souvlaki',
          dropoffName: 'Elena',
          dropoffBusinessName: null,
          createdAt: new Date('2026-11-09T13:30:00.000Z'),
          readyAt: null,
          foodReadyAt: null,
          promisedReadyAt: null,
          undispatchedAt: null,
          pickupLocation: { latitude: 39.36, longitude: 22.94 },
          courier: null,
        },
      ]

      const mockCouriers = [
        {
          id: 'c-1',
          name: 'Nikos P',
          status: EnumCourierStatus.ONLINE,
          busy: false,
          latitude: 39.36,
          longitude: 22.94,
        },
      ]

      const mockDelivered = [
        {
          deliveryId: 'del-done',
          createdAt: new Date('2026-11-09T12:00:00.000Z'),
          occurredAt: new Date('2026-11-09T12:20:00.000Z'),
        },
      ]

      const mockSos = [
        {
          id: 'sos-1',
          courierId: 'c-sos',
          deliveryId: null,
          startedAt: new Date('2026-11-09T13:50:00.000Z'),
          courier: { firstName: 'Vasilis', lastName: 'Gkikas' },
        },
      ]

      mockDispatchBoardRepo.findLiveDeliveries.mockResolvedValue(mockLive as any)
      mockDispatchBoardRepo.findWorkingCouriers.mockResolvedValue(mockCouriers as any)
      mockDispatchBoardRepo.findDroppedOffBetween.mockResolvedValue(mockDelivered)
      mockSosService.listCurrent.mockResolvedValue(mockSos as any)

      const board = await service.getBoard(NOW)

      // Verified repository queries
      expect(mockDispatchBoardRepo.findLiveDeliveries).toHaveBeenCalledTimes(1)
      expect(mockDispatchBoardRepo.findWorkingCouriers).toHaveBeenCalledTimes(1)
      expect(mockDispatchBoardRepo.findDroppedOffBetween).toHaveBeenCalledWith(start, end)
      expect(mockDeliveryIssueRepo.findOpen).toHaveBeenCalledTimes(1)
      expect(mockSosService.listCurrent).toHaveBeenCalledTimes(1)
      expect(mockConfigDomainService.instanceConfig.getOfferTimingEnabled).toHaveBeenCalledTimes(1)
      expect(mockDeliveryDomainService.getOfferViews).toHaveBeenCalledWith(mockLive)

      // Board response shape
      expect(board.generatedAt).toEqual(NOW)
      expect(board.cards.waiting.total).toBe(1)
      expect(board.cards.couriers.total).toBe(1)
      expect(board.cards.deliveredToday.total).toBe(1)
      expect(board.cards.deliveredToday.medianMinutes).toBe(20)

      // Attention ordering: SOS first
      expect(board.attention).toHaveLength(2)
      expect(board.attention[0]?.kind).toBe(ATTENTION_KIND.SOS)
      expect(board.attention[1]?.kind).toBe(ATTENTION_KIND.WAITING_FOR_RIDER)
      expect(board.attentionMore).toBe(0)

      // Map populated
      expect(board.map.couriers).toHaveLength(1)
      expect(board.map.couriers[0]?.id).toBe('c-1')
      expect(board.map.waitingDeliveries).toHaveLength(1)
      expect(board.map.waitingDeliveries[0]?.deliveryId).toBe('del-waiting')
    })

    test('getBoard returns a RIDER_REPORT row when deliveryIssueRepository.findOpen returns an open issue (AC-7)', async () => {
      const mockIssue = {
        id: 'issue-42',
        deliveryId: 'del-10',
        courierId: 'c-1',
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Customer is around the corner',
        createdAt: new Date('2026-11-09T13:50:00.000Z'),
        handledAt: null,
        handledByUserId: null,
        courier: { firstName: 'Dimitris', lastName: 'Karras' },
        delivery: {
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'c-1',
          orderReference: 'ORD-42',
          pickupBusinessName: 'Pizza Hot',
          dropoffName: 'Customer A',
          dropoffBusinessName: null,
        },
      }
      mockDeliveryIssueRepo.findOpen.mockResolvedValue([mockIssue as any])

      const board = await service.getBoard(NOW)

      const reportRow = board.attention.find((r) => r.kind === ATTENTION_KIND.RIDER_REPORT)
      expect(reportRow).toBeDefined()
      expect(reportRow?.issueId).toBe('issue-42')
      expect(reportRow?.deliveryId).toBe('del-10')
      expect(reportRow?.riderName).toBe('Dimitris Karras')
      expect(reportRow?.detail).toBe('Dimitris Karras reported: Wrong address\nCustomer is around the corner')
    })

    test('getBoard returns an OFFER_UNANSWERED row when live delivery is offered to a courier (AC-5)', async () => {
      const offeredDelivery = {
        id: 'del-offered',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: 'c-matched',
        offeredAt: new Date('2026-11-09T13:55:00.000Z'),
        offerExpiresAt: null,
        orderReference: 'ORD-OFFER',
        pickupBusinessName: 'Souvlaki',
        dropoffName: 'Elena',
        dropoffBusinessName: null,
        createdAt: new Date('2026-11-09T13:50:00.000Z'),
        readyAt: null,
        foodReadyAt: null,
        promisedReadyAt: null,
        undispatchedAt: null,
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        courier: null,
      }
      mockDispatchBoardRepo.findLiveDeliveries.mockResolvedValue([offeredDelivery as any])
      mockDeliveryDomainService.getOfferViews.mockResolvedValue(
        new Map([['del-offered', { matchedCourierName: 'Kostas' } as any]])
      )

      const board = await service.getBoard(NOW)

      const offerRow = board.attention.find((r) => r.kind === ATTENTION_KIND.OFFER_UNANSWERED)
      expect(offerRow).toBeDefined()
      expect(offerRow?.deliveryId).toBe('del-offered')
      expect(offerRow?.riderName).toBe('Kostas')
    })

    test('getBoard returns a RESTAURANT_LATE row when courier arrived at pickup and food is overdue (AC-6)', async () => {
      const lateDelivery = {
        id: 'del-late',
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        courierId: 'c-arrived',
        matchedCourierId: null,
        offeredAt: null,
        offerExpiresAt: null,
        orderReference: 'ORD-LATE',
        pickupBusinessName: 'Souvlaki Tou Nikou',
        dropoffName: 'Customer',
        dropoffBusinessName: null,
        createdAt: new Date('2026-11-09T13:20:00.000Z'),
        readyAt: null,
        foodReadyAt: null,
        promisedReadyAt: new Date('2026-11-09T13:40:00.000Z'), // 20 min ago (before NOW 14:00)
        undispatchedAt: null,
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        courier: { firstName: 'Giorgos', lastName: 'Alexiou' },
      }
      mockDispatchBoardRepo.findLiveDeliveries.mockResolvedValue([lateDelivery as any])

      const board = await service.getBoard(NOW)

      const lateRow = board.attention.find((r) => r.kind === ATTENTION_KIND.RESTAURANT_LATE)
      expect(lateRow).toBeDefined()
      expect(lateRow?.deliveryId).toBe('del-late')
      expect(lateRow?.detail).toContain('food was due 15:40')
    })

    test('getBoard returns an UNREAD_MESSAGE row when chatDomainService.unreadThreadsForBoard returns an unread thread (spec 0034, AC-17)', async () => {
      const mockUnreadThread = {
        threadId: 'thread-rider-1',
        oldestUnreadAt: new Date('2026-11-09T13:45:00.000Z'),
        courierId: 'c-rider-1',
        name: 'Vasilis Papageorgiou',
        lastMessageBody: 'I am waiting outside the shop',
      }
      mockChatDomainService.unreadThreadsForBoard.mockResolvedValue([mockUnreadThread])

      const board = await service.getBoard(NOW)

      expect(mockChatDomainService.unreadThreadsForBoard).toHaveBeenCalledTimes(1)
      const chatRow = board.attention.find((r) => r.kind === ATTENTION_KIND.UNREAD_MESSAGE)
      expect(chatRow).toBeDefined()
      expect(chatRow?.kind).toBe(ATTENTION_KIND.UNREAD_MESSAGE)
      expect(chatRow?.threadId).toBe('thread-rider-1')
      expect(chatRow?.courierId).toBe('c-rider-1')
      expect(chatRow?.riderName).toBe('Vasilis Papageorgiou')
      expect(chatRow?.restaurantName).toBeNull()
      expect(chatRow?.since).toEqual(mockUnreadThread.oldestUnreadAt)
      expect(chatRow?.detail).toBe('Vasilis Papageorgiou: I am waiting outside the shop')
    })

    test('getBoard returns an UNREAD_MESSAGE row for a restaurant unread thread with restaurantName set (spec 0034, AC-17)', async () => {
      const mockRestaurantThread = {
        threadId: 'thread-partner-1',
        oldestUnreadAt: new Date('2026-11-09T13:50:00.000Z'),
        courierId: null,
        name: 'Souvlaki Tou Nikou',
        lastMessageBody: 'Order #12 is running 5 minutes late',
      }
      mockChatDomainService.unreadThreadsForBoard.mockResolvedValue([mockRestaurantThread])

      const board = await service.getBoard(NOW)

      const chatRow = board.attention.find((r) => r.kind === ATTENTION_KIND.UNREAD_MESSAGE)
      expect(chatRow).toBeDefined()
      expect(chatRow?.kind).toBe(ATTENTION_KIND.UNREAD_MESSAGE)
      expect(chatRow?.threadId).toBe('thread-partner-1')
      expect(chatRow?.courierId).toBeNull()
      expect(chatRow?.restaurantName).toBe('Souvlaki Tou Nikou')
      expect(chatRow?.riderName).toBeNull()
      expect(chatRow?.since).toEqual(mockRestaurantThread.oldestUnreadAt)
      expect(chatRow?.detail).toBe('Souvlaki Tou Nikou: Order #12 is running 5 minutes late')
    })
  })

  describe('removalRequestRows & getBoard integration (Spec 0035 AC-6)', () => {
    const makeOpenRemovalRequest = (overrides: Partial<any> = {}) => ({
      id: 'req-rem-1',
      deliveryId: 'del-rem-1',
      courierId: 'c-rider-1',
      reasonId: 'reason-1',
      label: 'Moped breakdown or accident',
      paidToRider: true,
      chargedToRestaurant: false,
      note: 'Engine smoking on highway',
      createdAt: new Date('2026-11-09T13:45:00.000Z'),
      courier: { firstName: 'Vasilis', lastName: 'Papageorgiou' },
      delivery: {
        id: 'del-rem-1',
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: 'c-rider-1',
        orderReference: 'ORD-REM-100',
        pickupBusinessName: 'Volos Grill',
        dropoffName: 'Customer Name',
        dropoffBusinessName: null,
      },
      ...overrides,
    })

    test('removalRequestRows maps open removal request before pickup', () => {
      const request = makeOpenRemovalRequest({
        paidToRider: true,
        delivery: {
          id: 'del-rem-1',
          status: EnumDeliveryStatus.DISPATCHED,
          courierId: 'c-rider-1',
          orderReference: 'ORD-REM-100',
          pickupBusinessName: 'Volos Grill',
          dropoffName: 'Customer Name',
          dropoffBusinessName: null,
        },
      })

      const [row] = removalRequestRows([request as any])
      expect(row).toBeDefined()
      expect(row?.kind).toBe(ATTENTION_KIND.REMOVAL_REQUEST)
      expect(row?.since).toEqual(request.createdAt)
      expect(row?.riderName).toBe('Vasilis Papageorgiou')
      expect(row?.removalRequestId).toBe('req-rem-1')
      expect(row?.pickedUp).toBe(false)
      expect(row?.detail).toContain('Vasilis Papageorgiou asks to come off this order: Moped breakdown or accident (Paid)')
      expect(row?.detail).toContain('Engine smoking on highway')
      // Does NOT claim approving cancels order
      expect(row?.detail).not.toContain('approving cancels the order')
    })

    test('removalRequestRows maps open removal request after pickup and says approving cancels order', () => {
      const request = makeOpenRemovalRequest({
        paidToRider: false,
        delivery: {
          id: 'del-rem-1',
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: 'c-rider-1',
          orderReference: 'ORD-REM-100',
          pickupBusinessName: 'Volos Grill',
          dropoffName: 'Customer Name',
          dropoffBusinessName: null,
        },
      })

      const [row] = removalRequestRows([request as any])
      expect(row).toBeDefined()
      expect(row?.kind).toBe(ATTENTION_KIND.REMOVAL_REQUEST)
      expect(row?.pickedUp).toBe(true)
      expect(row?.detail).toContain('(Not paid)')
      expect(row?.detail).toContain('Food already picked up: approving cancels the order.')
    })

    test('getBoard queries findOpenForBoard and includes REMOVAL_REQUEST rows in attention', async () => {
      const request = makeOpenRemovalRequest()
      mockRemovalRequestRepo.findOpenForBoard.mockResolvedValue([request])

      const board = await service.getBoard(NOW)

      expect(mockRemovalRequestRepo.findOpenForBoard).toHaveBeenCalled()
      const removalRow = board.attention.find((r) => r.kind === ATTENTION_KIND.REMOVAL_REQUEST)
      expect(removalRow).toBeDefined()
      expect(removalRow?.removalRequestId).toBe('req-rem-1')
      expect(removalRow?.riderName).toBe('Vasilis Papageorgiou')
    })
  })
})
