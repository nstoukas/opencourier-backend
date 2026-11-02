import { haversineDistanceInMetres, haversineDistanceInMiles } from './distance'

describe('haversineDistanceInMetres (Spec 0016)', () => {
  it('returns 0 for the exact same point', () => {
    const dist = haversineDistanceInMetres(39.3622, 22.9425, 39.3622, 22.9425)
    expect(dist).toBe(0)
  })

  it('calculates known distance: 0.001 deg latitude is about 111 m', () => {
    // 1 degree of latitude on Earth is approx 111.195 km, so 0.001 deg latitude is approx 111 m
    const dist = haversineDistanceInMetres(39.362, 22.945, 39.363, 22.945)
    expect(Math.round(dist)).toBe(111)
  })

  it('matches haversineDistanceInMiles converted to metres', () => {
    const lat1 = 39.3622
    const lon1 = 22.9425
    const lat2 = 39.3645
    const lon2 = 22.948
    const metres = haversineDistanceInMetres(lat1, lon1, lat2, lon2)
    const miles = haversineDistanceInMiles(lat1, lon1, lat2, lon2)
    const metresFromMiles = (miles / 0.621371) * 1000
    expect(metres).toBeCloseTo(metresFromMiles, 5)
  })
})
