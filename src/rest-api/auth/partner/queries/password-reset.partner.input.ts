import { ForgotPasswordCourierInput } from 'src/rest-api/auth/courier/queries/forgot-password.courier.input'
import { ResetPasswordCourierInput } from 'src/rest-api/auth/courier/queries/reset-password.courier.input'

// Row 153: the partner routes take exactly the rider routes' bodies and checks (spec 0039). `extends` copies
// every field with its validation, so the two can never drift apart.
export class ForgotPasswordPartnerInput extends ForgotPasswordCourierInput {}
export class ResetPasswordPartnerInput extends ResetPasswordCourierInput {}
