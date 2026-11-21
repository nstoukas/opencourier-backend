import { Logger } from '@nestjs/common'
import { CancellationSweepService } from './cancellation-sweep.service'

// Spec 0047, cross check 7: the existing minute sweep also finishes split legs left in CREATED (the server
// stopped between the confirm's commit and the leg's start), so a paid for leg is never stranded.
describe('CancellationSweepService - the split leg step (spec 0047)', () => {
  const now = new Date('2026-11-21T13:00:00.000Z')

  function setup(splitRequestService?: { startUnstartedLegs: jest.Mock }) {
    const deliveryRepository = {
      findCancellationsToSettle: jest.fn().mockResolvedValue([]),
      findWaitPayToSettle: jest.fn().mockResolvedValue([]),
      findReturnTripsToSettle: jest.fn().mockResolvedValue([]),
    }
    const deliveryEventService = {
      settleCancellation: jest.fn().mockResolvedValue(undefined),
      settleWaitPay: jest.fn().mockResolvedValue(undefined),
      settleReturnTrip: jest.fn().mockResolvedValue(undefined),
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
    return { service, deliveryRepository }
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

  it('the split step runs even when an earlier step has nothing to do, and the earlier steps still run', async () => {
    const splitRequestService = { startUnstartedLegs: jest.fn().mockResolvedValue(2) }
    const { service, deliveryRepository } = setup(splitRequestService)

    await service.sweep(now)

    expect(deliveryRepository.findCancellationsToSettle).toHaveBeenCalled()
    expect(deliveryRepository.findWaitPayToSettle).toHaveBeenCalled()
    expect(splitRequestService.startUnstartedLegs).toHaveBeenCalled()
  })
})
