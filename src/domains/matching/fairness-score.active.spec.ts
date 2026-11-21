import {
  FairnessCandidate,
  FairnessWeights,
  ROAD_TIME_DEAD_BAND_SECONDS,
  WAITING_DEAD_BAND_SECONDS,
  EARNINGS_DEAD_BAND_CENTS_PER_HOUR,
  coopMeanCentsPerHour,
  estimatedRoadSeconds,
  scoreCandidates,
} from './fairness-score'

describe('Fairness Score (Spec 0044: AC-4, AC-9, AC-10)', () => {
  const defaultWeights: FairnessWeights = {
    roadTime: 50,
    earnings: 30,
    waiting: 20,
  }

  const baseCandidate = (overrides: Partial<FairnessCandidate> = {}): FairnessCandidate => ({
    courierId: 'courier-1',
    straightMetres: 1000,
    roadSeconds: 300,
    roadEstimated: false,
    centsPerHour: 1200,
    earningsAssumed: false,
    earningsEqual: false,
    waitingSeconds: 600,
    ...overrides,
  })

  describe('AC-4 & AC-10: Factor directions (lower score is better)', () => {
    test('shorter road time gives lower score and ranks higher', () => {
      const candidates = [
        baseCandidate({ courierId: 'rider-slow', roadSeconds: 600 }),
        baseCandidate({ courierId: 'rider-fast', roadSeconds: 120 }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      expect(scored[0]!.courierId).toBe('rider-fast')
      expect(scored[0]!.scaled.roadTime).toBe(0)
      expect(scored[1]!.scaled.roadTime).toBe(1)
      expect(scored[0]!.score).toBeLessThan(scored[1]!.score)
    })

    test('lower earnings gives lower score and ranks higher', () => {
      const candidates = [
        baseCandidate({ courierId: 'rider-rich', centsPerHour: 2000 }),
        baseCandidate({ courierId: 'rider-poor', centsPerHour: 500 }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      expect(scored[0]!.courierId).toBe('rider-poor')
      expect(scored[0]!.scaled.earnings).toBe(0)
      expect(scored[1]!.scaled.earnings).toBe(1)
      expect(scored[0]!.score).toBeLessThan(scored[1]!.score)
    })

    test('longer waiting gives lower score and ranks higher', () => {
      const candidates = [
        baseCandidate({ courierId: 'rider-just-arrived', waitingSeconds: 60 }),
        baseCandidate({ courierId: 'rider-waiting-long', waitingSeconds: 1800 }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      expect(scored[0]!.courierId).toBe('rider-waiting-long')
      expect(scored[0]!.scaled.waiting).toBe(0)
      expect(scored[1]!.scaled.waiting).toBe(1)
      expect(scored[0]!.score).toBeLessThan(scored[1]!.score)
    })
  })

  describe('AC-4: Weighted average & zero weights', () => {
    test('score is exact weighted average of scaled values divided by sum of weights', () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 100, centsPerHour: 500, waitingSeconds: 1200 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 400, centsPerHour: 1500, waitingSeconds: 300 }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)
      const weightSum = defaultWeights.roadTime + defaultWeights.earnings + defaultWeights.waiting

      for (const c of scored) {
        const expectedScore =
          (defaultWeights.roadTime * c.scaled.roadTime +
            defaultWeights.earnings * c.scaled.earnings +
            defaultWeights.waiting * c.scaled.waiting) /
          weightSum
        expect(c.score).toBeCloseTo(expectedScore, 5)
      }
    })

    test('weight 0 for a factor completely removes it from the score', () => {
      // rider-1 has higher earnings but weights.earnings = 0
      const weights: FairnessWeights = { roadTime: 50, earnings: 0, waiting: 50 }
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 100, centsPerHour: 5000, waitingSeconds: 1000 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 100, centsPerHour: 100, waitingSeconds: 1000 }),
      ]
      const scored = scoreCandidates(candidates, weights)

      // Identical road and waiting with earnings ignored -> identical score
      expect(scored[0]!.score).toBe(0)
      expect(scored[1]!.score).toBe(0)
    })

    test('all weights 0 produces score 0 for all without division by zero NaN', () => {
      const weights: FairnessWeights = { roadTime: 0, earnings: 0, waiting: 0 }
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 100 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 500 }),
      ]
      const scored = scoreCandidates(candidates, weights)
      expect(scored[0]!.score).toBe(0)
      expect(scored[1]!.score).toBe(0)
    })

    test('empty candidate list returns empty array', () => {
      expect(scoreCandidates([], defaultWeights)).toEqual([])
    })
  })

  describe('AC-4 & Cross check 6: Dead bands', () => {
    test(`road time differences within ${ROAD_TIME_DEAD_BAND_SECONDS}s count as equal to the best`, () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 200 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 250 }), // diff 50s <= 60s
        baseCandidate({ courierId: 'c3', roadSeconds: 400 }), // diff 200s > 60s
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      const c1 = scored.find((c) => c.courierId === 'c1')!
      const c2 = scored.find((c) => c.courierId === 'c2')!
      const c3 = scored.find((c) => c.courierId === 'c3')!

      expect(c1.scaled.roadTime).toBe(0)
      expect(c2.scaled.roadTime).toBe(0) // within dead band -> 0
      expect(c3.scaled.roadTime).toBe(1)
    })

    test(`waiting time differences within ${WAITING_DEAD_BAND_SECONDS / 60} minutes count as equal to the best`, () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', waitingSeconds: 1800 }), // 30 min (longest wait)
        baseCandidate({ courierId: 'c2', waitingSeconds: 1600 }), // 26.6 min (diff 200s <= 300s)
        baseCandidate({ courierId: 'c3', waitingSeconds: 600 }), // 10 min (diff 1200s > 300s)
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      const c1 = scored.find((c) => c.courierId === 'c1')!
      const c2 = scored.find((c) => c.courierId === 'c2')!
      const c3 = scored.find((c) => c.courierId === 'c3')!

      expect(c1.scaled.waiting).toBe(0)
      expect(c2.scaled.waiting).toBe(0) // within dead band -> 0
      expect(c3.scaled.waiting).toBe(1)
    })

    test(`earnings differences within ${EARNINGS_DEAD_BAND_CENTS_PER_HOUR} c/h count as equal to the best`, () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', centsPerHour: 800 }),
        baseCandidate({ courierId: 'c2', centsPerHour: 840 }), // diff 40 c/h <= 50 c/h
        baseCandidate({ courierId: 'c3', centsPerHour: 1200 }), // diff 400 c/h > 50 c/h
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      const c1 = scored.find((c) => c.courierId === 'c1')!
      const c2 = scored.find((c) => c.courierId === 'c2')!
      const c3 = scored.find((c) => c.courierId === 'c3')!

      expect(c1.scaled.earnings).toBe(0)
      expect(c2.scaled.earnings).toBe(0) // within dead band -> 0
      expect(c3.scaled.earnings).toBe(1)
    })

    test('all candidates within dead band gives scaled 0 to all', () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 100 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 130 }), // diff 30s <= 60s
      ]
      const scored = scoreCandidates(candidates, defaultWeights)
      expect(scored[0]!.scaled.roadTime).toBe(0)
      expect(scored[1]!.scaled.roadTime).toBe(0)
    })

    test('with road times 100, 160, 161 s (band 60), the 161 s rider scaled road time is small (excess divided by at least the band), not 1', () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 100 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 160 }), // diff 60s <= 60s
        baseCandidate({ courierId: 'c3', roadSeconds: 161 }), // diff 61s > 60s, excess 1s
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      const c1 = scored.find((c) => c.courierId === 'c1')!
      const c2 = scored.find((c) => c.courierId === 'c2')!
      const c3 = scored.find((c) => c.courierId === 'c3')!

      expect(c1.scaled.roadTime).toBe(0)
      expect(c2.scaled.roadTime).toBe(0)
      // Excess is 1s, divided by at least the dead band (60s) = 1/60 ~= 0.0167, NOT 1.0 (the cliff-edge bug)
      expect(c3.scaled.roadTime).toBeCloseTo(1 / 60, 4)
      expect(c3.scaled.roadTime).toBeLessThan(0.05)
      expect(c3.scaled.roadTime).not.toBe(1)
    })

    test('with a large spread (0, 600 s) the farthest still scales to 1', () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', roadSeconds: 0 }),
        baseCandidate({ courierId: 'c2', roadSeconds: 600 }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      const c1 = scored.find((c) => c.courierId === 'c1')!
      const c2 = scored.find((c) => c.courierId === 'c2')!

      expect(c1.scaled.roadTime).toBe(0)
      expect(c2.scaled.roadTime).toBe(1)
    })
  })

  describe('AC-4: Tie breaking rules', () => {
    test('ties in score are broken by shorter road time', () => {
      // Same waiting and earnings, but c1 has shorter road time
      const candidates = [
        baseCandidate({ courierId: 'c2', roadSeconds: 300, centsPerHour: 1000, waitingSeconds: 600 }),
        baseCandidate({ courierId: 'c1', roadSeconds: 100, centsPerHour: 1000, waitingSeconds: 600 }),
      ]
      // Use weights where score is identical (e.g. roadTime weight 0)
      const weights: FairnessWeights = { roadTime: 0, earnings: 50, waiting: 50 }
      const scored = scoreCandidates(candidates, weights)

      expect(scored[0]!.score).toBe(scored[1]!.score)
      expect(scored[0]!.courierId).toBe('c1')
      expect(scored[1]!.courierId).toBe('c2')
    })

    test('ties in score and road time are broken by longer waiting', () => {
      const candidates = [
        baseCandidate({ courierId: 'c2', roadSeconds: 200, centsPerHour: 1000, waitingSeconds: 300 }),
        baseCandidate({ courierId: 'c1', roadSeconds: 200, centsPerHour: 1000, waitingSeconds: 900 }),
      ]
      const weights: FairnessWeights = { roadTime: 50, earnings: 50, waiting: 0 }
      const scored = scoreCandidates(candidates, weights)

      expect(scored[0]!.score).toBe(scored[1]!.score)
      expect(scored[0]!.roadSeconds).toBe(scored[1]!.roadSeconds)
      expect(scored[0]!.courierId).toBe('c1')
      expect(scored[1]!.courierId).toBe('c2')
    })

    test('ties in score, road time, and waiting are broken by courierId alphabetical ascending', () => {
      const candidates = [
        baseCandidate({ courierId: 'courier-zebra', roadSeconds: 200, centsPerHour: 1000, waitingSeconds: 600 }),
        baseCandidate({ courierId: 'courier-alpha', roadSeconds: 200, centsPerHour: 1000, waitingSeconds: 600 }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      expect(scored[0]!.courierId).toBe('courier-alpha')
      expect(scored[1]!.courierId).toBe('courier-zebra')
    })
  })

  describe('AC-4: earningsEqual', () => {
    test('when all candidates have earningsEqual true, earnings factor is 0 for all', () => {
      const candidates = [
        baseCandidate({ courierId: 'c1', centsPerHour: 0, earningsEqual: true }),
        baseCandidate({ courierId: 'c2', centsPerHour: 2000, earningsEqual: true }),
      ]
      const scored = scoreCandidates(candidates, defaultWeights)

      expect(scored[0]!.scaled.earnings).toBe(0)
      expect(scored[1]!.scaled.earnings).toBe(0)
    })
  })

  describe('AC-2 & AC-3: Helper functions', () => {
    test('coopMeanCentsPerHour computes arithmetic mean of qualifying rates', () => {
      expect(coopMeanCentsPerHour([1000, 2000, 3000])).toBe(2000)
      expect(coopMeanCentsPerHour([1500])).toBe(1500)
    })

    test('coopMeanCentsPerHour returns null for empty array', () => {
      expect(coopMeanCentsPerHour([])).toBeNull()
    })

    test('estimatedRoadSeconds estimates road time from straight line distance at 20 km/h', () => {
      // 20 km/h = 20000 m / 3600 s = 5.5555... m/s
      // 1000 m / 5.5555... = 180 seconds
      expect(estimatedRoadSeconds(1000)).toBe(180)
      expect(estimatedRoadSeconds(500)).toBe(90)
      expect(estimatedRoadSeconds(0)).toBe(0)
    })
  })

  describe('AC-9: Deterministic evening replay (20 riders, 150 orders)', () => {
    test('runs deterministic simulation under FAIRNESS (50/30/20) and NEAREST (100/0/0) and prints spreads', () => {
      interface SimRider {
        id: string
        location: { lat: number; lon: number }
        busyUntilSeconds: number
        totalEarnedCents: number
        totalOnlineSeconds: number
        lastJobEndSeconds: number
        onlineStartSeconds: number
        completedOrders: number
      }

      function runReplay(weights: FairnessWeights) {
        // 20 riders initialized across a grid in Volos (lat 39.35..39.38, lon 22.93..22.96)
        const riders: SimRider[] = Array.from({ length: 20 }, (_, i) => ({
          id: `rider-${String(i + 1).padStart(2, '0')}`,
          location: {
            lat: 39.355 + (i % 5) * 0.006,
            lon: 22.935 + Math.floor(i / 5) * 0.006,
          },
          busyUntilSeconds: 0,
          totalEarnedCents: 0,
          totalOnlineSeconds: 4 * 3600, // 4 hours online
          lastJobEndSeconds: 0,
          onlineStartSeconds: 0,
          completedOrders: 0,
        }))

        const totalOrders = 150
        const totalRoadSecondsList: number[] = []

        // 150 orders arriving every 90 seconds (over 3.75 hours)
        for (let orderIdx = 0; orderIdx < totalOrders; orderIdx++) {
          const orderTimeSeconds = orderIdx * 90
          // Order pickup location around restaurants in center
          const pickup = {
            lat: 39.362 + ((orderIdx * 17) % 10) * 0.0015,
            lon: 22.942 + ((orderIdx * 23) % 10) * 0.0015,
          }
          const jobPayCents = 350 + (orderIdx % 4) * 50 // 350c to 500c
          const deliveryDurationSeconds = 12 * 60 + (orderIdx % 5) * 60 // 12-16 minutes

          // Free riders at orderTime
          const availableRiders = riders.filter((r) => r.busyUntilSeconds <= orderTimeSeconds)
          // If none free, take the one that finishes earliest
          const pool: SimRider[] =
            availableRiders.length > 0
              ? availableRiders
              : [riders.slice().sort((a, b) => a.busyUntilSeconds - b.busyUntilSeconds)[0]!]

          // Build candidates
          const candidates: FairnessCandidate[] = pool.map((r) => {
            // Straight line distance approximation (metres)
            const dLat = (r.location.lat - pickup.lat) * 111000
            const dLon = (r.location.lon - pickup.lon) * 85000
            const straightMetres = Math.round(Math.sqrt(dLat * dLat + dLon * dLon))
            const roadSeconds = estimatedRoadSeconds(straightMetres)
            const hoursWorked = Math.max(0.25, r.totalOnlineSeconds / 3600)
            const centsPerHour = Math.round(r.totalEarnedCents / hoursWorked)
            const waitingSeconds = Math.max(0, orderTimeSeconds - Math.max(r.lastJobEndSeconds, r.onlineStartSeconds))

            return {
              courierId: r.id,
              straightMetres,
              roadSeconds,
              roadEstimated: true,
              centsPerHour,
              earningsAssumed: false,
              earningsEqual: false,
              waitingSeconds,
            }
          })

          const scored = scoreCandidates(candidates, weights)
          const chosen = scored[0]!
          expect(chosen).toBeDefined()

          totalRoadSecondsList.push(chosen.roadSeconds)

          const winner = riders.find((r) => r.id === chosen.courierId)!
          winner.completedOrders++
          winner.totalEarnedCents += jobPayCents
          const finishTime =
            Math.max(orderTimeSeconds, winner.busyUntilSeconds) + chosen.roadSeconds + deliveryDurationSeconds
          winner.busyUntilSeconds = finishTime
          winner.lastJobEndSeconds = finishTime
          // Move rider to dropoff location
          winner.location = {
            lat: pickup.lat + ((orderIdx * 11) % 7) * 0.002 - 0.006,
            lon: pickup.lon + ((orderIdx * 13) % 7) * 0.002 - 0.006,
          }
        }

        // Metrics across all 20 riders
        const hourlyRates = riders.map((r) => r.totalEarnedCents / (r.totalOnlineSeconds / 3600))
        const minRate = Math.min(...hourlyRates)
        const maxRate = Math.max(...hourlyRates)
        const spread = maxRate - minRate
        const meanRate = hourlyRates.reduce((s, r) => s + r, 0) / hourlyRates.length
        const variance = hourlyRates.reduce((s, r) => s + Math.pow(r - meanRate, 2), 0) / hourlyRates.length
        const stdDev = Math.sqrt(variance)
        const meanRoadTime = totalRoadSecondsList.reduce((s, t) => s + t, 0) / totalRoadSecondsList.length

        return { minRate, maxRate, spread, stdDev, meanRoadTime, totalOrdersCompleted: totalOrders }
      }

      const fairnessResults = runReplay(defaultWeights)
      const nearestResults = runReplay({ roadTime: 100, earnings: 0, waiting: 0 })

      // Cross check 11: reported figures, not a gate; assert that it runs and prints
      console.log('\n--- AC-9 Deterministic Replay Results (20 riders, 150 orders) ---')
      console.log(
        `FAIRNESS (50/30/20): spread = ${(fairnessResults.spread / 100).toFixed(2)} €/h, stdDev = ${(
          fairnessResults.stdDev / 100
        ).toFixed(2)} €/h, mean road time = ${fairnessResults.meanRoadTime.toFixed(1)} s`
      )
      console.log(
        `NEAREST (100/0/0):   spread = ${(nearestResults.spread / 100).toFixed(2)} €/h, stdDev = ${(
          nearestResults.stdDev / 100
        ).toFixed(2)} €/h, mean road time = ${nearestResults.meanRoadTime.toFixed(1)} s`
      )
      console.log('-----------------------------------------------------------------\n')

      expect(fairnessResults.totalOrdersCompleted).toBe(150)
      expect(nearestResults.totalOrdersCompleted).toBe(150)
      expect(Number.isFinite(fairnessResults.spread)).toBe(true)
      expect(Number.isFinite(nearestResults.spread)).toBe(true)
      expect(Number.isFinite(fairnessResults.meanRoadTime)).toBe(true)
      expect(Number.isFinite(nearestResults.meanRoadTime)).toBe(true)
    })
  })
})
