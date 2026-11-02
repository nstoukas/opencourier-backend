import { ApiProperty } from '@nestjs/swagger'

// What the rider's job screen needs from the co-op's settings (row 72, spec 0021): the dispatch line
// and the arrival radius. The rest of the instance settings are not the courier app's business.
export class ContactCourierDto {
  // null when no representative has set a dispatch number: the app then shows no dispatch button.
  @ApiProperty({ type: String, nullable: true })
  dispatchPhoneNumber: string | null

  // Spec 0021: metres from the restaurant or the customer that the app counts as arrived; 0 = off.
  @ApiProperty({ type: Number })
  arrivalRadiusMetres: number

  constructor(data: { dispatchPhoneNumber: string | null; arrivalRadiusMetres: number }) {
    this.dispatchPhoneNumber = data.dispatchPhoneNumber
    this.arrivalRadiusMetres = data.arrivalRadiusMetres
  }
}
