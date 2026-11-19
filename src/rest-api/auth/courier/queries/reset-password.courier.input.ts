import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, Length, Matches } from 'class-validator'
import { RESET_CODE_REFUSED_MESSAGE, RESET_PASSWORD_LENGTH_MESSAGE } from 'src/domains/auth/password-reset.service'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Body of POST courier/v1/auth/reset-password (row 17, spec 0039, AC-10 and AC-11). Every refusal
// here happens in the validation pipe, before the handler runs, so none of them spends a try.
// A malformed email or code gets the same sentence as a wrong code (`message` on each check).
export class ResetPasswordCourierInput {
  @ApiProperty({ required: true, type: String })
  @RefuseIfNotSentAsString({ message: RESET_CODE_REFUSED_MESSAGE })
  @IsEmail({}, { message: RESET_CODE_REFUSED_MESSAGE })
  email: string

  // Text, never a number: the JSON number 4219 would lose the leading zeros of "004219".
  @ApiProperty({ required: true, type: String, example: '004219' })
  @RefuseIfNotSentAsString({ message: RESET_CODE_REFUSED_MESSAGE })
  @Matches(/^\d{6}$/, { message: RESET_CODE_REFUSED_MESSAGE })
  code: string

  // 72 is bcrypt's limit: it ignores anything longer.
  @ApiProperty({ required: true, type: String, minLength: 8, maxLength: 72 })
  @RefuseIfNotSentAsString({ message: RESET_PASSWORD_LENGTH_MESSAGE })
  @IsString({ message: RESET_PASSWORD_LENGTH_MESSAGE })
  @Length(8, 72, { message: RESET_PASSWORD_LENGTH_MESSAGE })
  password: string
}
