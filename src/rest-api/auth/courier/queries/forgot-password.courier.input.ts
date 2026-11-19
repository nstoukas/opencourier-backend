import { ApiProperty } from '@nestjs/swagger'
import { IsEmail } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Body of POST courier/v1/auth/forgot-password (row 17, spec 0039, AC-7). A malformed email is the
// only refusal that depends on the body, and it comes before any lookup.
export class ForgotPasswordCourierInput {
  @ApiProperty({ required: true, type: String })
  @RefuseIfNotSentAsString()
  @IsEmail()
  email: string
}
