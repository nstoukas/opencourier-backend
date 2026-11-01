import { ApiProperty } from '@nestjs/swagger'

// What the rider's job screen needs to reach the co-op (row 72). Only this one field:
// the rest of the instance settings are not the courier app's business.
export class ContactCourierDto {
  // null when no representative has set a dispatch number: the app then shows no dispatch button.
  @ApiProperty({ type: String, nullable: true })
  dispatchPhoneNumber: string | null

  constructor(data: { dispatchPhoneNumber: string | null }) {
    this.dispatchPhoneNumber = data.dispatchPhoneNumber
  }
}
