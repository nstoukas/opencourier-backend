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

  it('a failure is logged with the delivery id and never with coordinates (Value 5)', async () => {
    const osrm = {
      getRoute: jest.fn().mockRejectedValue(new Error('Route timeout')),
    }

    await offerTripFor(baseInput, osrm)

    expect(warnSpy).toHaveBeenCalled()
    const allWarnCalls = warnSpy.mock.calls.map((c) => c[0] as string).join(' ')

    // Warning includes deliveryId
    expect(allWarnCalls).toContain(deliveryId)
    // Warning must NOT contain any coordinate values
    expect(allWarnCalls).not.toContain(String(riderLocation.latitude))
    expect(allWarnCalls).not.toContain(String(riderLocation.longitude))
    expect(allWarnCalls).not.toContain(String(pickupLocation.latitude))
    expect(allWarnCalls).not.toContain(String(pickupLocation.longitude))
    expect(allWarnCalls).not.toContain(String(dropoffLocation.latitude))
    expect(allWarnCalls).not.toContain(String(dropoffLocation.longitude))
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
