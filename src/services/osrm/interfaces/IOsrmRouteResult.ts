// OSRM always answers in metres and seconds, whatever Config.distanceUnit says.
// The field names say so, so a caller cannot forget to convert.
export interface IOsrmRouteResult {
  distanceMetres: number
  durationSeconds: number
}
