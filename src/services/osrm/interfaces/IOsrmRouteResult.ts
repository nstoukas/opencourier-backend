// OSRM always answers in metres and seconds, whatever Config.distanceUnit says.
// The field names say so, so a caller cannot forget to convert.
export interface IOsrmRouteResult {
  distanceMetres: number
  durationSeconds: number
  // The road the route follows, simplified by OSRM, as latitude and longitude pairs in order
  // (spec 0018). Quotes ignore it; the courier route endpoint draws it.
  points: IOsrmRoutePoint[]
}

export interface IOsrmRoutePoint {
  latitude: number
  longitude: number
}
