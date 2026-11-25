import { Logger } from '@nestjs/common'
import { CancellationSweepService } from './cancellation-sweep.service'

// Spec 0047, cross check 7: the existing minute sweep also finishes split legs left in CREATED (the server
// stopped between the confirm's commit and the leg's start), so a paid for leg is never stranded.
describe('CancellationSweepService - the split leg step (spec 0047)', () => {
  const now = new Date('2026-11-21T13:00:00.000Z')

  function setup(splitRequestService?: { startUnstartedLegs: jest.Mock }, settleOwedSplitWaits: jest.Mock = jest.fn().mockResolvedValue(0)) {
    const deliveryRepository = {
      findCancellationsToSettle: jest.fn().mockResolvedValue([]),
      findWaitPayToSettle: jest.fn().mockResolvedValue([]),
      findReturnTripsToSettle: jest.fn().mockResolvedValue([]),
    }
    const deliveryEventService = {
      settleCancellation: jest.fn().mockResolvedValue(undefined),
      settleWaitPay: jest.fn().mockResolvedValue(undefined),
      settleReturnTrip: jest.fn().mockResolvedValue(undefined),
      settleOwedSplitWaits,
      // Spec 0048 (cross check 8), row 172: the minute sweep completes accepts of taken orders.
      completeTakenAccepts: jest.fn().mockResolvedValue(0),
    }
    const service = new CancellationSweepService(
      deliveryRepository as any,
      deliveryEventService as any,
      { addRepeatableJob: jest.fn().mockResolvedValue(undefined) } as any,
      { registerTaskHandler: jest.fn() } as any,
      { findApprovedUnsettled: jest.fn().mockResolvedValue([]) } as any,
      { sweepApprovedUnsettled: jest.fn().mockResolvedValue(undefined) } as any,
      splitRequestService as any
    )
    return { service, deliveryRepository, deliveryEventService }
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('every sweep asks the split service to start any split leg left in CREATED, with the sweep time', async () => {
    const splitRequestService = { startUnstartedLegs: jest.fn().mockResolvedValue(0) }
    const { service } = setup(splitRequestService)

    await service.sweep(now)

    expect(splitRequestService.startUnstartedLegs).toHaveBeenCalledTimes(1)
    expect(splitRequestService.startUnstartedLegs).toHaveBeenCalledWith(now)
  })

  it('a failure in the split step is logged and never rejects the sweep', async () => {
    const error = jest.spyOn(Logger.prototype, 'error')
    const splitRequestService = { startUnstartedLegs: jest.fn().mockRejectedValue(new Error('database is down')) }
    const { service } = setup(splitRequestService)

    await expect(service.sweep(now)).resolves.toBeUndefined()

    expect(error).toHaveBeenCalled()
  })

  // Row 11 review: a split wait whose pay failed after the answer was committed is tried again every minute.
  describe('the split wait step (row 11 review)', () => {
    it('every sweep settles the split waits still owed, closed in the last day and not in the last minute', async () => {
      const settleOwedSplitWaits = jest.fn().mockResolvedValue(0)
      const { service } = setup({ startUnstartedLegs: jest.fn().mockResolvedValue(0) }, settleOwedSplitWaits)

      await service.sweep(now)

      expect(settleOwedSplitWaits).toHaveBeenCalledTimes(1)
      const [since, before] = settleOwedSplitWaits.mock.calls[0]
      // 24 hours back: after that the money is a human's job to find.
      expect(since).toEqual(new Date('2026-11-20T13:00:00.000Z'))
      // The last minute is left to the step that closed the request, which settles it inline.
      expect(before).toEqual(new Date('2026-11-21T12:59:00.000Z'))
    })

    it('a failure in the split wait step is logged and the steps after it still run', async () => {
      const error = jest.spyOn(Logger.prototype, 'error')
      const splitRequestService = { startUnstartedLegs: jest.fn().mockResolvedValue(0) }
      const { service, deliveryRepository } = setup(splitRequestService, jest.fn().mockRejectedValue(new Error('database is down')))

      await expect(service.sweep(now)).resolves.toBeUndefined()

      expect(error).toHaveBeenCalled()
      expect(deliveryRepository.findReturnTripsToSettle).toHaveBeenCalled()
      expect(splitRequestService.startUnstartedLegs).toHaveBeenCalledWith(now)
    })

    it('runs with no split request service given (the step belongs to the event service)', async () => {
      const settleOwedSplitWaits = jest.fn().mockResolvedValue(0)
      const { service } = setup(undefined, settleOwedSplitWaits)

      await service.sweep(now)

      expect(settleOwedSplitWaits).toHaveBeenCalledTimes(1)
    })
  })

  it('the split step runs even when an earlier step has nothing to do, and the earlier steps still run', async () => {
    const splitRequestService = { startUnstartedLegs: jest.fn().mockResolvedValue(2) }
    const { service, deliveryRepository } = setup(splitRequestService)

    await service.sweep(now)

    expect(deliveryRepository.findCancellationsToSettle).toHaveBeenCalled()
    expect(deliveryRepository.findWaitPayToSettle).toHaveBeenCalled()
    expect(splitRequestService.startUnstartedLegs).toHaveBeenCalled()
  })
})
