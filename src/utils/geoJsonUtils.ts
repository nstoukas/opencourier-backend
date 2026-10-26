import { GeoPosition } from 'src/shared-types'

/**
 * Converts a FeatureCollection to a single Geometry (Polygon or MultiPolygon)
 * suitable for PostGIS storage via ST_GeomFromGeoJSON
 */
export function normalizeRegionForPostGIS(region: any): any {
  if (!region || typeof region !== 'object') {
    return region
  }

  // Handle FeatureCollection - extract and merge geometries
  if (region.type === 'FeatureCollection' && region.features?.length > 0) {
    const geometries = region.features
      .map((f: any) => f.geometry)
      .filter((g: any) => g) // Filter out null geometries

    if (geometries.length === 0) {
      return null
    }

    if (geometries.length === 1) {
      // Single geometry - return as-is
      return geometries[0]
    }

    // Multiple geometries - check if all are Polygons
    const allPolygons = geometries.every((g: any) => g.type === 'Polygon')

    if (allPolygons) {
      // Create a MultiPolygon from all polygon geometries
      return {
        type: 'MultiPolygon',
        coordinates: geometries.map((g: any) => g.coordinates),
      }
    }

    // Mixed geometry types - fall back to first geometry
    return geometries[0]
  }

  // Handle single Feature - extract geometry
  if (region.type === 'Feature') {
    return region.geometry
  }

  // Assume it's already a geometry object (Polygon, MultiPolygon, etc.)
  return region
}

// Whether a point lies inside the area this instance serves (`Config.details.region`). Quotes and
// saved customers (spec 0005, AC-10) use this same test, so a saved address never fails at quote time.
// No region set means everywhere is served. A region of a type other than Polygon or MultiPolygon
// is treated as served too, and reported through `onUnsupportedType` so the caller can log it.
export function isPositionInRegion(
  region: unknown,
  position: GeoPosition,
  onUnsupportedType?: (type: string) => void
): boolean {
  const normalizedRegion = normalizeRegionForPostGIS(region)

  if (!normalizedRegion) {
    return true
  }

  if (normalizedRegion.type === 'Polygon') {
    return isPointInPolygon(position, normalizedRegion.coordinates)
  }

  if (normalizedRegion.type === 'MultiPolygon') {
    return normalizedRegion.coordinates.some((polygonCoordinates: number[][][]) =>
      isPointInPolygon(position, polygonCoordinates)
    )
  }

  onUnsupportedType?.(String(normalizedRegion.type))
  return true
}

function isPointInPolygon(position: GeoPosition, polygonCoordinates: number[][][]): boolean {
  const [outerRing, ...holes] = polygonCoordinates
  if (!outerRing) {
    return false
  }
  const isInOuterRing = isPointInRing(position, outerRing)

  if (!isInOuterRing) {
    return false
  }

  return !holes.some((hole) => isPointInRing(position, hole))
}

function isPointInRing(position: GeoPosition, ring: number[][]): boolean {
  if (ring.length < 3) {
    return false
  }

  const pointX = position.longitude
  const pointY = position.latitude
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const vertexI = ring[i]
    const vertexJ = ring[j]
    if (!vertexI || !vertexJ) {
      continue
    }

    const vertexIX = vertexI[0]
    const vertexIY = vertexI[1]
    const vertexJX = vertexJ[0]
    const vertexJY = vertexJ[1]
    if (
      vertexIX === undefined ||
      vertexIY === undefined ||
      vertexJX === undefined ||
      vertexJY === undefined
    ) {
      continue
    }

    const intersects =
      vertexIY > pointY !== vertexJY > pointY &&
      pointX < ((vertexJX - vertexIX) * (pointY - vertexIY)) / (vertexJY - vertexIY) + vertexIX

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}
