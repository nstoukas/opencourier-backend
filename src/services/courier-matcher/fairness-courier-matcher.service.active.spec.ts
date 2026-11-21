import { FairnessCourierMatcherService } from './fairness-courier-matcher.service'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OsrmRoutingService } from '../osrm/osrm-routing.service'
import { TimeWorkedService, FairnessDayFigures } from '../time-worked/time-worked.service'
import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { estimatedRoadSeconds } from 'src/domains/matching/fairness-score'

describe('FairnessCourierMatcherService (Spec 0044: AC-1, AC-2, AC-3, AC-6)', () => {
  let service: FairnessCourierMatcherService
  let mockCourierDomainService: jest.Mocked<CourierDomainService>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockOsrmRoutingService: jest.Mocked<OsrmRoutingService>
  let mockTimeWorkedService: jest.Mocked<TimeWorkedService>
  let mockInstanceConfig: any

  const pickupLocation = { latitude: 39.3621, longitude: 22.9421 }
  const dropoffLocation = { latitude: 39.3701, longitude: 22.9501 }

  beforeEach(() => {
    mockInstanceConfig = {
      getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
      getFairnessCandidateLimit: jest.fn().mockResolvedValue(10),
      getFairnessMinOnlineMinutes: jest.fn().mockResolvedValue(30),
      getFairnessWeightRoadTime: jest.fn().mockResolvedValue(50),
      getFairnessWeightEarnings: jest.fn().mockResolvedValue(30),
      getFairnessWeightWaiting: jest.fn().mockResolvedValue(20),
    }

    mockConfigDomainService = {
      instanceConfig: mockInstanceConfig,
    } as unknown as jest.Mocked<ConfigDomainService>

    mockCourierDomainService = {
      getNearestAvailableCandidates: jest.fn(),
    } as unknown as jest.Mocked<CourierDomainService>

    mockOsrmRoutingService = {
      getTableSecondsTo: jest.fn(),
    } as unknown as jest.Mocked<OsrmRoutingService>

    mockTimeWorkedService = {
      todayForFairness: jest.fn(),
    } as unknown as jest.Mocked<TimeWorkedService>

    service = new FairnessCourierMatcherService(
      mockCourierDomainService,
      mockConfigDomainService,
      mockOsrmRoutingService,
      mockTimeWorkedService
    )
  })

  test('reads the five settings at call time from instanceConfig', async () => {
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce([])

    await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(mockInstanceConfig.getMaxAssignmentDistanceInKM).toHaveBeenCalled()
    expect(mockInstanceConfig.getFairnessCandidateLimit).toHaveBeenCalled()
    expect(mockInstanceConfig.getFairnessMinOnlineMinutes).toHaveBeenCalled()
    expect(mockInstanceConfig.getFairnessWeightRoadTime).toHaveBeenCalled()
    expect(mockInstanceConfig.getFairnessWeightEarnings).toHaveBeenCalled()
    expect(mockInstanceConfig.getFairnessWeightWaiting).toHaveBeenCalled()
  })

  test('returns null when no riders are in range', async () => {
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce([])

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).toBeNull()
  })

  test('scores at most fairnessCandidateLimit of the nearest, while ridersInRange counts all in range', async () => {
    mockInstanceConfig.getFairnessCandidateLimit.mockResolvedValue(2) // limit to 2

    // 4 riders in range
    const inRange = [
      { courierId: 'c1', distance: 300, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'c2', distance: 500, courierLocation: { latitude: 39.364, longitude: 22.944 } },
      { courierId: 'c3', distance: 800, courierLocation: { latitude: 39.365, longitude: 22.945 } },
      { courierId: 'c4', distance: 1200, courierLocation: { latitude: 39.366, longitude: 22.946 } },
    ]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([120, 200]) // Only 2 queried
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(new Map())

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).not.toBeNull()
    expect(result!.reason!.candidateCount).toBe(2)
    expect(result!.reason!.ridersInRange).toBe(4)
    expect(result!.reason!.candidates?.length).toBe(2)
  })

  test('successful OSRM table call uses road seconds, sets roadEstimated: false and travelSeconds to roadSeconds', async () => {
    const inRange = [
      { courierId: 'c1', distance: 400, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'c2', distance: 700, courierLocation: { latitude: 39.365, longitude: 22.945 } },
    ]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([150, 280])

    const now = new Date('2026-11-21T12:00:00Z')
    jest.useFakeTimers()
    jest.setSystemTime(now)

    const todayFigures = new Map<string, FairnessDayFigures>([
      [
        'c1',
        {
          workSeconds: 3600,
          centsPerHour: 1000,
          lastJobEndAt: new Date('2026-11-21T11:45:00Z'),
          onlineSpellStartAt: new Date('2026-11-21T10:00:00Z'),
        },
      ],
      [
        'c2',
        {
          workSeconds: 3600,
          centsPerHour: 1000,
          lastJobEndAt: new Date('2026-11-21T11:45:00Z'),
          onlineSpellStartAt: new Date('2026-11-21T10:00:00Z'),
        },
      ],
    ])
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(todayFigures)

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    jest.useRealTimers()

    expect(result).not.toBeNull()
    expect(result!.courierId).toBe('c1')
    expect(result!.travelSeconds).toBe(150)
    expect(result!.reason!.values.roadEstimated).toBe(false)
    expect(result!.reason!.values.roadSeconds).toBe(150)
  })

  test('failed OSRM table call or any null entry estimates EVERY rider at 20 km/h with roadEstimated: true and travelSeconds: null', async () => {
    const inRange = [
      { courierId: 'c1', distance: 500, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'c2', distance: 1000, courierLocation: { latitude: 39.365, longitude: 22.945 } },
    ]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    // Table returns a null entry for one rider
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([150, null])
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(new Map())

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).not.toBeNull()
    expect(result!.travelSeconds).toBeNull() // null because estimated
    expect(result!.reason!.values.roadEstimated).toBe(true)
    expect(result!.reason!.values.roadSeconds).toBe(estimatedRoadSeconds(500))

    // Every candidate in the reason should be estimated
    for (const cand of result!.reason!.candidates!) {
      expect(cand.roadEstimated).toBe(true)
    }
  })

  test('OSRM table exception caught, estimates every rider with roadEstimated: true and travelSeconds: null', async () => {
    const inRange = [{ courierId: 'c1', distance: 600, courierLocation: { latitude: 39.363, longitude: 22.943 } }]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockRejectedValueOnce(new Error('OSRM network failure'))
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(new Map())

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).not.toBeNull()
    expect(result!.travelSeconds).toBeNull()
    expect(result!.reason!.values.roadEstimated).toBe(true)
    expect(result!.reason!.values.roadSeconds).toBe(estimatedRoadSeconds(600))
  })

  test('rider under fairnessMinOnlineMinutes takes co-op mean with earningsAssumed: true', async () => {
    mockInstanceConfig.getFairnessMinOnlineMinutes.mockResolvedValue(30) // 30 minutes = 1800s

    const inRange = [
      { courierId: 'junior', distance: 400, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'senior', distance: 400, courierLocation: { latitude: 39.363, longitude: 22.943 } },
    ]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([100, 100])

    const now = new Date('2026-11-21T12:00:00Z')
    const todayFigures = new Map<string, FairnessDayFigures>([
      [
        'senior',
        {
          workSeconds: 3600, // 60 min >= 30 min (qualifying)
          centsPerHour: 1800,
          lastJobEndAt: null,
          onlineSpellStartAt: new Date('2026-11-21T11:00:00Z'),
        },
      ],
      [
        'junior',
        {
          workSeconds: 600, // 10 min < 30 min (under limit)
          centsPerHour: 5000, // Very high but under limit
          lastJobEndAt: null,
          onlineSpellStartAt: new Date('2026-11-21T11:50:00Z'),
        },
      ],
    ])
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(todayFigures)

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).not.toBeNull()
    const juniorCandidate = result!.reason!.candidates?.find((c) => c.courierId === 'junior')
    const seniorCandidate = result!.reason!.candidates?.find((c) => c.courierId === 'senior')

    expect(seniorCandidate?.earningsAssumed).toBe(false)
    expect(seniorCandidate?.centsPerHour).toBe(1800)

    expect(juniorCandidate?.earningsAssumed).toBe(true)
    // Co-op mean is senior's rate (1800)
    expect(juniorCandidate?.centsPerHour).toBe(1800)
  })

  test('when nobody qualifies for co-op mean, sets earningsEqual: true for all candidates', async () => {
    mockInstanceConfig.getFairnessMinOnlineMinutes.mockResolvedValue(60) // 60 min required

    const inRange = [
      { courierId: 'c1', distance: 300, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'c2', distance: 500, courierLocation: { latitude: 39.365, longitude: 22.945 } },
    ]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([100, 150])

    const todayFigures = new Map<string, FairnessDayFigures>([
      [
        'c1',
        {
          workSeconds: 900, // 15 min < 60 min
          centsPerHour: 1500,
          lastJobEndAt: null,
          onlineSpellStartAt: new Date('2026-11-21T11:45:00Z'),
        },
      ],
      [
        'c2',
        {
          workSeconds: 1200, // 20 min < 60 min
          centsPerHour: 800,
          lastJobEndAt: null,
          onlineSpellStartAt: new Date('2026-11-21T11:40:00Z'),
        },
      ],
    ])
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(todayFigures)

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).not.toBeNull()
    expect(result!.reason!.values.earningsEqual).toBe(true)
    for (const cand of result!.reason!.candidates!) {
      expect(cand.earningsEqual).toBe(true)
    }
  })

  test('waiting time is now minus the later of lastJobEndAt and onlineSpellStartAt', async () => {
    const inRange = [
      { courierId: 'c1', distance: 300, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'c2', distance: 300, courierLocation: { latitude: 39.363, longitude: 22.943 } },
      { courierId: 'c3', distance: 300, courierLocation: { latitude: 39.363, longitude: 22.943 } },
    ]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([100, 100, 100])

    const now = new Date('2026-11-21T12:00:00Z')
    jest.useFakeTimers()
    jest.setSystemTime(now)

    const todayFigures = new Map<string, FairnessDayFigures>([
      [
        'c1',
        {
          // lastJobEndAt (11:40) is later than onlineSpellStartAt (10:00) -> waited 20 min (1200s)
          workSeconds: 7200,
          centsPerHour: 1000,
          lastJobEndAt: new Date('2026-11-21T11:40:00Z'),
          onlineSpellStartAt: new Date('2026-11-21T10:00:00Z'),
        },
      ],
      [
        'c2',
        {
          // No job today (lastJobEndAt null), onlineSpellStartAt is 11:30 -> waited 30 min (1800s)
          workSeconds: 1800,
          centsPerHour: 1000,
          lastJobEndAt: null,
          onlineSpellStartAt: new Date('2026-11-21T11:30:00Z'),
        },
      ],
      // c3 not in today's map -> waits from now = 0s
    ])
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(todayFigures)

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    jest.useRealTimers()

    expect(result).not.toBeNull()
    const c1 = result!.reason!.candidates?.find((c) => c.courierId === 'c1')
    const c2 = result!.reason!.candidates?.find((c) => c.courierId === 'c2')
    const c3 = result!.reason!.candidates?.find((c) => c.courierId === 'c3')

    expect(c1?.waitingSeconds).toBe(1200)
    expect(c2?.waitingSeconds).toBe(1800)
    expect(c3?.waitingSeconds).toBe(0)
  })

  test('reason matches the exact required structure (AC-6)', async () => {
    const inRange = [{ courierId: 'c1', distance: 500, courierLocation: { latitude: 39.363, longitude: 22.943 } }]
    mockCourierDomainService.getNearestAvailableCandidates.mockResolvedValueOnce(inRange as any)
    mockOsrmRoutingService.getTableSecondsTo.mockResolvedValueOnce([180])
    mockTimeWorkedService.todayForFairness.mockResolvedValueOnce(new Map())

    const result = await service.findCourierForDelivery({
      pickupLocation,
      dropoffLocation,
      rejectedCourierIds: [],
    })

    expect(result).not.toBeNull()
    expect(result!.reason!.strategy).toBe(EnumCourierMatcherType.FAIRNESS)
    expect(result!.reason!.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20 })
    expect(result!.reason!.candidateCount).toBe(1)
    expect(result!.reason!.ridersInRange).toBe(1)
    expect(result!.reason!.score).toBeDefined()
    expect(result!.reason!.values).toMatchObject({
      roadSeconds: 180,
      roadEstimated: false,
      centsPerHour: 0,
      earningsAssumed: true,
      earningsEqual: true,
      waitingSeconds: 0,
      straightMetres: 500,
      scaled: { roadTime: 0, earnings: 0, waiting: 0 },
      score: expect.any(Number),
    })
    expect(result!.reason!.candidates).toHaveLength(1)
    expect(result!.reason!.candidates![0]).toMatchObject({
      courierId: 'c1',
      roadSeconds: 180,
    })
  })
})
