import { isPositionInRegion, normalizeRegionForPostGIS } from './geoJsonUtils'
import { GeoPosition } from 'src/shared-types'

describe('geoJsonUtils - isPositionInRegion (AC-10)', () => {
  // A simple square polygon around Volos center (lat: 39.35 to 39.40, lng: 22.90 to 23.00)
  // GeoJSON polygon coordinates are [longitude, latitude]
  const samplePolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [22.90, 39.35],
        [23.00, 39.35],
        [23.00, 39.40],
        [22.90, 39.40],
        [22.90, 39.35],
      ],
    ],
  }

  // Polygon with a hole in the middle (hole: lat 39.37 to 39.38, lng 22.94 to 22.96)
  const polygonWithHole = {
    type: 'Polygon',
    coordinates: [
      // Outer ring
      [
        [22.90, 39.35],
        [23.00, 39.35],
        [23.00, 39.40],
        [22.90, 39.40],
        [22.90, 39.35],
      ],
      // Hole
      [
        [22.94, 39.37],
        [22.96, 39.37],
        [22.96, 39.38],
        [22.94, 39.38],
        [22.94, 39.37],
      ],
    ],
  }

  const multiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      // First polygon
      [
        [
          [22.90, 39.35],
          [22.95, 39.35],
          [22.95, 39.40],
          [22.90, 39.40],
          [22.90, 39.35],
        ],
      ],
      // Second polygon
      [
        [
          [23.00, 39.35],
          [23.05, 39.35],
          [23.05, 39.40],
          [23.00, 39.40],
          [23.00, 39.35],
        ],
      ],
    ],
  }

  it('treats missing or null region as everywhere served (returns true)', () => {
    const pos: GeoPosition = { latitude: 39.36, longitude: 22.95 }
    expect(isPositionInRegion(null, pos)).toBe(true)
    expect(isPositionInRegion(undefined, pos)).toBe(true)
  })

  it('correctly determines whether a point is inside a Polygon', () => {
    const insidePoint: GeoPosition = { latitude: 39.37, longitude: 22.95 }
    const outsidePoint: GeoPosition = { latitude: 39.50, longitude: 22.95 }

    expect(isPositionInRegion(samplePolygon, insidePoint)).toBe(true)
    expect(isPositionInRegion(samplePolygon, outsidePoint)).toBe(false)
  })

  it('returns false when a point is inside a polygon hole', () => {
    // Point inside the hole
    const holePoint: GeoPosition = { latitude: 39.375, longitude: 22.95 }
    // Point inside outer ring but outside the hole
    const validPoint: GeoPosition = { latitude: 39.36, longitude: 22.92 }

    expect(isPositionInRegion(polygonWithHole, holePoint)).toBe(false)
    expect(isPositionInRegion(polygonWithHole, validPoint)).toBe(true)
  })

  it('correctly checks points against a MultiPolygon', () => {
    const insideFirst: GeoPosition = { latitude: 39.37, longitude: 22.92 }
    const insideSecond: GeoPosition = { latitude: 39.37, longitude: 23.02 }
    const betweenPolygons: GeoPosition = { latitude: 39.37, longitude: 22.98 }

    expect(isPositionInRegion(multiPolygon, insideFirst)).toBe(true)
    expect(isPositionInRegion(multiPolygon, insideSecond)).toBe(true)
    expect(isPositionInRegion(multiPolygon, betweenPolygons)).toBe(false)
  })

  it('treats unsupported geometry type as served and reports it through callback', () => {
    const unsupportedRegion = {
      type: 'LineString',
      coordinates: [
        [22.90, 39.35],
        [23.00, 39.40],
      ],
    }
    const onUnsupportedType = jest.fn()
    const pos: GeoPosition = { latitude: 39.37, longitude: 22.95 }

    const result = isPositionInRegion(unsupportedRegion, pos, onUnsupportedType)
    expect(result).toBe(true)
    expect(onUnsupportedType).toHaveBeenCalledWith('LineString')
  })

  it('handles Feature and FeatureCollection input through normalizeRegionForPostGIS', () => {
    const feature = {
      type: 'Feature',
      geometry: samplePolygon,
      properties: {},
    }
    const insidePoint: GeoPosition = { latitude: 39.37, longitude: 22.95 }
    expect(isPositionInRegion(feature, insidePoint)).toBe(true)

    const featureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: samplePolygon, properties: {} },
      ],
    }
    expect(isPositionInRegion(featureCollection, insidePoint)).toBe(true)
  })

  describe('normalizeRegionForPostGIS', () => {
    it('returns null for FeatureCollection with no valid geometries', () => {
      expect(normalizeRegionForPostGIS({ type: 'FeatureCollection', features: [{ geometry: null }] })).toBeNull()
    })

    it('merges multiple Polygons into a MultiPolygon', () => {
      const fc = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: samplePolygon },
          { type: 'Feature', geometry: samplePolygon },
        ],
      }
      const normalized = normalizeRegionForPostGIS(fc)
      expect(normalized.type).toBe('MultiPolygon')
      expect(normalized.coordinates.length).toBe(2)
    })
  })
})
