import { Logger } from '@nestjs/common'
import { GeoPosition } from 'src/shared-types'
import { IOsrmRouteResult } from 'src/services/osrm/interfaces/IOsrmRouteResult'
import { offerTripFor, UNKNOWN_OFFER_TRIP, OfferTripInput } from './offer-trip'

/**
 * Spec 0019 (AC-1) & Decision 70.1 - 70.8: Offer trip figures from OSRM.
 *
 * Tests the helper offerTripFor which requests both legs (rider -> pickup, pickup -> dropoff)
 * in parallel via Promise.allSettled and computes rounded metres and ceil minutes.
 */
describe('offerTripFor (Spec 0019 AC-1, Row 70)', () => {
  const riderLocation: GeoPosition = { latitude: 39.362, longitude: 22.942 }
  const pickupLocation: GeoPosition = { latitude: 39.365, longitude: 22.945 }
  const dropoffLocation: GeoPosition = { latitude: 39.371, longitude: 22.951 }
  const deliveryId = 'del-test-70'

  const baseInput: OfferTripInput = {
    deliveryId,
    rider: riderLocation,
    pickup: pickupLocation,
    dropoff: dropoffLocation,
  }

  const makeRouteResult = (distanceMetres: number, durationSeconds: number): IOsrmRouteResult => ({
    distanceMetres,
    durationSeconds,
    points: [],
  })

  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('exports UNKNOWN_OFFER_TRIP with all null figures', () => {
    expect(UNKNOWN_OFFER_TRIP).toEqual({
      toPickupMetres: null,
      toDropoffMetres: null,
      minutes: null,
    })
  })

  it('both legs known gives whole metres (rounded) and minutes = ceil((seconds1 + seconds2) / 60)', async () => {
    // 873.4m + 94s for rider leg; 1014.8m + 120s for dropoff leg
    // 94s + 120s = 214s; ceil(214 / 60) = 4 minutes
    const osrm = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(873.4, 94))
        .mockResolvedValueOnce(makeRouteResult(1014.8, 120)),
    }

    const trip = await offerTripFor(baseInput, osrm)

    expect(trip).toEqual({
      toPickupMetres: 873,
      toDropoffMetres: 1015,
      minutes: 4,
    })
  })

  it('offerTripFor rounds minutes UP: legs of 100 s and 100 s give 4 minutes (200 s is 3.33 min), and 60 s + 60 s give exactly 2', async () => {
    // 100 s + 100 s = 200 s (3.33 min): Math.ceil rounds up to 4 minutes, while Math.round would give 3
    const osrmCeil = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(500, 100))
        .mockResolvedValueOnce(makeRouteResult(800, 100)),
    }
    const tripCeil = await offerTripFor(baseInput, osrmCeil)
    expect(tripCeil.minutes).toBe(4)

    // Exact whole minute boundary: 60 s + 60 s = 120 s gives exactly 2 minutes
    const osrmExact = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(500, 60))
        .mockResolvedValueOnce(makeRouteResult(800, 60)),
    }
    const tripExact = await offerTripFor(baseInput, osrmExact)
    expect(tripExact.minutes).toBe(2)
  })

  it('rider to restaurant leg uses rider then pickup, the other pickup then dropoff (argument order to getRoute)', async () => {
    const osrm = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(500, 60))
        .mockResolvedValueOnce(makeRouteResult(800, 100)),
    }

    await offerTripFor(baseInput, osrm)

    expect(osrm.getRoute).toHaveBeenCalledTimes(2)
    // Leg 1: rider to restaurant
    expect(osrm.getRoute).toHaveBeenNthCalledWith(1, {
      fromLocation: riderLocation,
      toLocation: pickupLocation,
    })
    // Leg 2: restaurant to customer
    expect(osrm.getRoute).toHaveBeenNthCalledWith(2, {
      fromLocation: pickupLocation,
      toLocation: dropoffLocation,
    })
  })

  it('no rider location gives toPickupMetres null, no getRoute call for that leg, minutes null, toDropoffMetres still set', async () => {
    const osrm = {
      getRoute: jest.fn().mockResolvedValue(makeRouteResult(1200.4, 180)),
    }

    const inputWithoutRider: OfferTripInput = {
      ...baseInput,
      rider: null,
    }

    const trip = await offerTripFor(inputWithoutRider, osrm)

    // Only 1 call for pickup -> dropoff, rider leg skipped
    expect(osrm.getRoute).toHaveBeenCalledTimes(1)
    expect(osrm.getRoute).toHaveBeenCalledWith({
      fromLocation: pickupLocation,
      toLocation: dropoffLocation,
    })
    expect(trip).toEqual({
      toPickupMetres: null,
      toDropoffMetres: 1200,
      minutes: null,
    })
  })

  it('one leg rejecting leaves the other (allSettled, not all) and minutes null', async () => {
    // Rider leg rejects, dropoff leg succeeds
    const osrmRiderFails = {
      getRoute: jest
        .fn()
        .mockRejectedValueOnce(new Error('NoRoute: rider to pickup'))
        .mockResolvedValueOnce(makeRouteResult(1500, 200)),
    }

    const trip1 = await offerTripFor(baseInput, osrmRiderFails)
    expect(trip1).toEqual({
      toPickupMetres: null,
      toDropoffMetres: 1500,
      minutes: null,
    })

    // Rider leg succeeds, dropoff leg rejects
    const osrmDropoffFails = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(600, 70))
        .mockRejectedValueOnce(new Error('NoRoute: pickup to dropoff')),
    }

    const trip2 = await offerTripFor(baseInput, osrmDropoffFails)
    expect(trip2).toEqual({
      toPickupMetres: 600,
      toDropoffMetres: null,
      minutes: null,
    })
  })

  it('both rejecting gives all null and never throws', async () => {
    const osrm = {
      getRoute: jest.fn().mockRejectedValue(new Error('OSRM service unavailable')),
    }

    const trip = await offerTripFor(baseInput, osrm)

    expect(trip).toEqual({
      toPickupMetres: null,
      toDropoffMetres: null,
      minutes: null,
    })
  })

  it('when both legs succeed it logs nothing', async () => {
    const osrm = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(500, 60))
        .mockResolvedValueOnce(makeRouteResult(800, 60)),
    }

    await offerTripFor(baseInput, osrm)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('when rider leg fails, logs exactly one warning naming the delivery id and unknown rider to restaurant without coordinates or error message', async () => {
    const errorMessage = 'OSRM connection timeout on rider leg'
    const osrm = {
      getRoute: jest
        .fn()
        .mockRejectedValueOnce(new Error(errorMessage))
        .mockResolvedValueOnce(makeRouteResult(800, 120)),
    }

    await offerTripFor(baseInput, osrm)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warnMessage = warnSpy.mock.calls[0][0]
    expect(warnMessage).toBe(`Offer trip for delivery ${deliveryId}: unknown rider to restaurant`)
    // Must NOT contain the failure's own error message
    expect(warnMessage).not.toContain(errorMessage)
    // Must NOT contain any coordinates (Value 5)
    expect(warnMessage).not.toContain(String(riderLocation.latitude))
    expect(warnMessage).not.toContain(String(riderLocation.longitude))
    expect(warnMessage).not.toContain(String(pickupLocation.latitude))
    expect(warnMessage).not.toContain(String(pickupLocation.longitude))
    expect(warnMessage).not.toContain(String(dropoffLocation.latitude))
    expect(warnMessage).not.toContain(String(dropoffLocation.longitude))
  })

  it('when dropoff leg fails, logs exactly one warning naming the delivery id and unknown restaurant to customer without coordinates or error message', async () => {
    const errorMessage = 'NoRoute: pickup to dropoff'
    const osrm = {
      getRoute: jest
        .fn()
        .mockResolvedValueOnce(makeRouteResult(500, 60))
        .mockRejectedValueOnce(new Error(errorMessage)),
    }

    await offerTripFor(baseInput, osrm)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warnMessage = warnSpy.mock.calls[0][0]
    expect(warnMessage).toBe(`Offer trip for delivery ${deliveryId}: unknown restaurant to customer`)
    // Must NOT contain the failure's own error message
    expect(warnMessage).not.toContain(errorMessage)
    // Must NOT contain any coordinates (Value 5)
    expect(warnMessage).not.toContain(String(riderLocation.latitude))
    expect(warnMessage).not.toContain(String(riderLocation.longitude))
    expect(warnMessage).not.toContain(String(pickupLocation.latitude))
    expect(warnMessage).not.toContain(String(pickupLocation.longitude))
    expect(warnMessage).not.toContain(String(dropoffLocation.latitude))
    expect(warnMessage).not.toContain(String(dropoffLocation.longitude))
  })

  it('when both legs fail, logs exactly one warning naming the delivery id and both legs joined by "and" without coordinates or error messages', async () => {
    const error1 = 'Rider leg connection reset'
    const error2 = 'Dropoff leg timeout'
    const osrm = {
      getRoute: jest
        .fn()
        .mockRejectedValueOnce(new Error(error1))
        .mockRejectedValueOnce(new Error(error2)),
    }

    await offerTripFor(baseInput, osrm)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warnMessage = warnSpy.mock.calls[0][0]
    expect(warnMessage).toBe(
      `Offer trip for delivery ${deliveryId}: unknown rider to restaurant and restaurant to customer`
    )
    // Must NOT contain the failures' own error messages
    expect(warnMessage).not.toContain(error1)
    expect(warnMessage).not.toContain(error2)
    // Must NOT contain any coordinates (Value 5)
    expect(warnMessage).not.toContain(String(riderLocation.latitude))
    expect(warnMessage).not.toContain(String(riderLocation.longitude))
    expect(warnMessage).not.toContain(String(pickupLocation.latitude))
    expect(warnMessage).not.toContain(String(pickupLocation.longitude))
    expect(warnMessage).not.toContain(String(dropoffLocation.latitude))
    expect(warnMessage).not.toContain(String(dropoffLocation.longitude))
  })

  it('a null pickup or dropoff gives null for the legs that need it', async () => {
    const osrm = {
      getRoute: jest.fn().mockResolvedValue(makeRouteResult(500, 60)),
    }

    // When pickup is null: neither leg can be computed
    const tripNoPickup = await offerTripFor(
      {
        ...baseInput,
        pickup: null,
      },
      osrm
    )
    expect(osrm.getRoute).not.toHaveBeenCalled()
    expect(tripNoPickup).toEqual({
      toPickupMetres: null,
      toDropoffMetres: null,
      minutes: null,
    })

    // When dropoff is null: rider leg can be computed, dropoff leg is null
    const tripNoDropoff = await offerTripFor(
      {
        ...baseInput,
        dropoff: null,
      },
      osrm
    )
    expect(osrm.getRoute).toHaveBeenCalledTimes(1)
    expect(osrm.getRoute).toHaveBeenCalledWith({
      fromLocation: riderLocation,
      toLocation: pickupLocation,
    })
    expect(tripNoDropoff).toEqual({
      toPickupMetres: 500,
      toDropoffMetres: null,
      minutes: null,
    })
  })
})
