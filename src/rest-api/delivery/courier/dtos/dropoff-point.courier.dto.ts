import { ApiProperty } from '@nestjs/swagger'

// The answer to a rider's pin move (spec 0016, AC-9): how far it moved, and whether the restaurant's
// saved customer moved too.
export class DropoffPointCourierDto {
  @ApiProperty({ type: Boolean })
  savedCustomerUpdated: boolean

  // How far the pin moved, in whole metres, for the app's thank you line.
  @ApiProperty({ type: Number })
  distanceMetres: number

  constructor(result: { savedCustomerUpdated: boolean; distanceMetres: number }) {
    this.savedCustomerUpdated = result.savedCustomerUpdated
    this.distanceMetres = result.distanceMetres
  }
}
