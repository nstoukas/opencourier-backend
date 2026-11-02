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

  it('gives about 111 m for 0.001 degree of latitude and about 86 m for 0.001 degree of longitude at latitude 39.36 (Volos)', () => {
    // 0.001 deg latitude in Volos is approx 111 m
    const latDist = haversineDistanceInMetres(39.36, 22.94, 39.361, 22.94)
    expect(Math.round(latDist)).toBe(111)

    // 0.001 deg longitude at latitude 39.36 (Volos) is approx 86 m
    const lonDist = haversineDistanceInMetres(39.36, 22.94, 39.36, 22.941)
    expect(Math.round(lonDist)).toBe(86)
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
