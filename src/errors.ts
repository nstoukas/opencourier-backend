import * as common from '@nestjs/common'
import { ApiProperty, ApiResponse, ApiResponseOptions } from '@nestjs/swagger'
import { HttpExceptionOptions } from '@nestjs/common/exceptions/http.exception'
import { RIDER_BOX_UNITS } from 'src/domains/delivery/box'
import { CodedSentence } from 'src/localization/coded-sentence'

export const DEFAULT_HTTP_CODE = 418 // I'm a teapot.

export enum ErrorCode {
  UNIQUE_CONSTRAINT = 'UNIQUE_CONSTRAINT',
  VERIFICATION_CODE = 'VERIFICATION_CODE',
  VERIFICATION_LIMIT = 'VERIFICATION_LIMIT',
  NOT_FOUND = 'NOT_FOUND',
  CREATE_FAILED = 'CREATE_FAILED',
  BAD_REQUEST = 'BAD_REQUEST',
  UNKNOWN = 'UNKNOWN',
  NOT_ALLOWED = 'NOT_ALLOWED',

  // Data not found
  DELIVERY_NOT_FOUND = 'DELIVERY_NOT_FOUND',
  COURIER_NOT_FOUND = 'COURIER_NOT_FOUND',
  LOCATION_NOT_FOUND = 'LOCATION_NOT_FOUND',
  COULDNT_CALCULATE = 'COULDNT_CALCULATE',
  DELIVERY_FOR_QUOTE_EXISTS = 'DELIVERY_FOR_QUOTE_EXISTS',
  QUOTE_HAS_EXPIRED = 'QUOTE_HAS_EXPIRED',
  DELIVERY_LOCATION_DOESNT_MATCH_QUOTE = 'DELIVERY_LOCATION_DOESNT_MATCH_QUOTE',

  // Delivery
  DELIVERY_EXISTS = 'DELIVERY_EXISTS',
  // Spec 0043: an admin assignment past a full box, not yet confirmed.
  BOX_OVER_CAPACITY = 'BOX_OVER_CAPACITY',
  DELIVERY_ALREADY_MATCHED = 'DELIVERY_ALREADY_MATCHED',
  DELIVERY_CANT_BE_ACCEPTED = 'DELIVERY_CANT_BE_ACCEPTED',
  DELIVERY_CANT_BE_REJECTED = 'DELIVERY_CANT_BE_REJECTED',
  OFFER_HAS_ENDED = 'OFFER_HAS_ENDED',
  // Spec 0022: the SOS is no longer active (the phone stops sharing), or is already closed.
  SOS_NOT_ACTIVE = 'SOS_NOT_ACTIVE',
  SOS_CLOSED = 'SOS_CLOSED',

  ENV_VAR_MISSING = 'ENV_VAR_MISSING',

  // State machine
  CANT_UPDATE_DELIVERY_STATUS = 'CANT_UPDATE_DELIVERY_STATUS',

  // Authentication
  UNAUTHORIZED = 'UNAUTHORIZED',
  JWT_EXPIRED = 'JWT_EXPIRED',
  FORBIDDEN = 'FORBIDDEN',
  USER_EXISTS = 'USER_EXISTS',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  // Spec 0051 (cross check 3): the app reads these codes, not the messages, to say why a session ended.
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  CREDENTIALS_CHANGED = 'CREDENTIALS_CHANGED',

  // Data validation
  MISSING_DATA = 'MISSING_DATA',
  INVALID_DATA = 'INVALID_DATA',
  // Spec 0053 (AC-4): an address note that looks like it holds a name, phone or email, sent without
  // `confirmed: true`. The app reads this code to offer Edit or Save anyway.
  PERSONAL_DATA_WARNING = 'PERSONAL_DATA_WARNING',

  // Integrations
  INTEGRATION_ERROR = 'INTEGRATION_ERROR',

  // Normal operational errors
  CART_EXISTS = 'CART_EXISTS',
  CATALOG_ITEM_UNAVAILABLE = 'CATALOG_ITEM_UNAVAILABLE',
  NOT_ENOUGH_POINTS_IN_BALANCE = 'NOT_ENOUGH_POINTS_IN_BALANCE',
  NO_COURIERS_AVAILABLE = 'NO_COURIERS_AVAILABLE',
  MERCHANT_CLOSED = 'MERCHANT_CLOSED',

  // Bad
  MISSING_PAYMENT_INFO = 'MISSING_PAYMENT_INFO',
  PUSH_NOTIFICATION_DELIVERY_FAILED = 'PUSH_NOTIFICATION_DELIVERY_FAILED',
  INTERNAL_SERVER_ERROR = 'INTERNAL_ERROR',
  MENU_INGESTION_ERROR = 'MENU_INGESTION_ERROR',

  // Critical
  INCONSISTENT_DATA = 'INCONSISTENT_DATA',

  // Payment
  RECOVERABLE_STRIPE_WEBHOOK_ERROR = 'RECOVERABLE_STRIPE_WEBHOOK_ERROR',
  UNRECOVERABLE_STRIPE_WEBHOOK_ERROR = 'UNRECOVERABLE_STRIPE_WEBHOOK_ERROR',

  // Blockchain:
  BLOCKCHAIN_TRANSACTION_ERROR = 'BLOCKCHAIN_TRANSACTION_ERROR',
  BLOCKCHAIN_CONTRACT_REVERSION_ERROR = 'BLOCKCHAIN_CONTRACT_REVERSION_ERROR',
  PAYMENT_CREATION_ERROR = 'PAYMENT_CREATION_ERROR',
}

export const ApiErrorResponse = (options: ApiResponseOptions = {}) =>
  ApiResponse({
    ...options,
    status: DEFAULT_HTTP_CODE,
  })

export class ApiException extends common.HttpException {
  @ApiProperty({
    required: true,
    enum: ErrorCode,
  })
  code!: ErrorCode

  @ApiProperty({
    required: true,
    type: String,
  })
  message!: string

  @ApiProperty({
    required: true,
    type: Number,
  })
  statusCode!: number

  // Spec 0054 (AC-6): the numbers a refusal's sentence carries, so an app can say it in its reader's
  // language (`server.error.<code>` with these values). Left out when the sentence has none.
  @ApiProperty({ required: false, type: Object })
  params?: Record<string, string | number | null>

  // Spec 0054 (AC-6, review of 2026-11-22): the code of a sentence with values of its own (a key of
  // `server.error`), sent in place of `code` by HttpExceptionFilter. Not part of the answer's shape: the
  // answer still has one `code`. Never set on UNAUTHORIZED or FORBIDDEN, which the apps sign out on.
  sentenceCode?: string

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options?: HttpExceptionOptions,
    params?: Record<string, string | number | null>
  ) {
    super(message, statusCode, options)
    this.code = code
    this.message = message
    this.statusCode = statusCode
    if (params) this.params = params
  }
}

export class VerificationCodeException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.VERIFICATION_CODE, message, 400, options)
  }
}

export class VerificationLimitException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.VERIFICATION_LIMIT, message, 401, options)
  }
}

export class JwtExpiredException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.JWT_EXPIRED, message, 401, options)
  }
}

export class UnauthorizedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.UNAUTHORIZED, message, 401, options)
  }
}

// Spec 0051: 401 for a deactivated rider at every door (login, bearer, refresh, socket, a reset session).
export class AccountDeactivatedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.ACCOUNT_DEACTIVATED, message, 401, options)
  }
}

// Spec 0051 (cross check 3): 401 for a token issued before the password or the login email changed.
export class CredentialsChangedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.CREDENTIALS_CHANGED, message, 401, options)
  }
}

export class ForbiddenException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.FORBIDDEN, message, 403, options)
  }
}

export class NotFoundException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.NOT_FOUND, message, 404, options)
  }
}

export class CalculationException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.COULDNT_CALCULATE, message, 404, options)
  }
}

export class UserExistsException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.USER_EXISTS, message, 400, options)
  }
}

export class UserNotFoundException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.USER_NOT_FOUND, message, 400, options)
  }
}

export class DeliveryExistsException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_EXISTS, message, 400, options)
  }
}

export class DeliveryOfferAlreadyMatchedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_ALREADY_MATCHED, message, 400, options)
  }
}

export class DeliveryNotFoundException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_NOT_FOUND, message, 404, options)
  }
}

export class DeliveryCantBeAcceptedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_CANT_BE_ACCEPTED, message, 404, options)
  }
}
export class DeliveryCantBeRejectedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_CANT_BE_REJECTED, message, 404, options)
  }
}

// 409 Conflict: the rider answered an offer that is no longer theirs (it expired, went to another
// rider, or the delivery was cancelled). Spec 0002, AC-5. The answer changed nothing.
export const OFFER_HAS_ENDED_MESSAGE = 'This offer has ended'
export class OfferHasEndedException extends ApiException {
  constructor(options?: HttpExceptionOptions) {
    super(ErrorCode.OFFER_HAS_ENDED, OFFER_HAS_ENDED_MESSAGE, 409, options)
  }
}

// 409 Conflict for an SOS (spec 0022). Not active: points sent after the rider or an admin ended it;
// the phone reads this as "ended by the co-op", drops its waiting points and stops sharing (AC-6).
// Closed: an admin already closed it. Fixed sentences: nothing the phone sent is repeated (AC-13).
export class SosNotActiveException extends ApiException {
  constructor() {
    super(ErrorCode.SOS_NOT_ACTIVE, 'This SOS has ended.', 409)
  }
}
export class SosClosedException extends ApiException {
  constructor() {
    super(ErrorCode.SOS_CLOSED, 'This SOS has already been closed.', 409)
  }
}

export class CourierNotFoundException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.COURIER_NOT_FOUND, message, 404, options)
  }
}

export class QuoteHasExpiredException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.QUOTE_HAS_EXPIRED, message, 400, options)
  }
}

export class DeliveryForQuoteAlreadyExistsException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_FOR_QUOTE_EXISTS, message, 400, options)
  }
}

export class DeliveryLocationDoesntMatchQuoteException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.DELIVERY_LOCATION_DOESNT_MATCH_QUOTE, message, 400, options)
  }
}

export class LocationNotFoundException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.LOCATION_NOT_FOUND, message, 404, options)
  }
}

export class EnvVarMissingException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.ENV_VAR_MISSING, message, 400, options)
  }
}

export class NotAllowedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.NOT_ALLOWED, message, 400, options)
  }
}

export class BadRequestException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.BAD_REQUEST, message, 400, options)
  }
}

export class IntegrationException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.INTEGRATION_ERROR, message, 400, options)
  }
}

export class MissingDataException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.MISSING_DATA, message, 400, options)
  }
}

export class InvalidDataException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.INVALID_DATA, message, 400, options)
  }
}

export class CreateFailedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.CREATE_FAILED, message, 422, options)
  }
}

// 422: an address note that looks like it holds personal data (spec 0053, AC-4). The message is the
// fixed warning sentence and never repeats the note, so no log records what the rider typed.
export class PersonalDataWarningException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.PERSONAL_DATA_WARNING, message, 422, options)
  }
}

// 422: a saved customer the server will not store as sent (spec 0005): a phone that cannot be a
// phone number, an empty name or address, an address outside the area the co-op serves. The message
// is shown to the restaurant as it is, so it never repeats the customer's details.
export class SavedCustomerRefusedException extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.INVALID_DATA, message, 422, options)
  }
}

// 409: another saved customer of this restaurant has this phone (spec 0005, AC-4). Deliberately not
// an ApiException: HttpExceptionFilter sends only code, message and statusCode, and the restaurant's
// Customers page needs `conflictingCustomerId` to show the other customer. Nest's own handler sends
// this object as the body. No name or phone in it, so no log ever records one.
export const SAVED_CUSTOMER_PHONE_CLASH_MESSAGE = 'Another saved customer has this phone'
// Spec 0013: an admin creating a rider whose email or phone is already taken. 409, with a message
// that names which one and holds neither value, so no log records it.
export const COURIER_EMAIL_TAKEN_MESSAGE = 'That email is already used by another account.'
export class CourierEmailTakenException extends ApiException {
  constructor() {
    super(ErrorCode.UNIQUE_CONSTRAINT, COURIER_EMAIL_TAKEN_MESSAGE, 409)
  }
}
export const COURIER_PHONE_TAKEN_MESSAGE = 'That phone is already used by another rider.'
export class CourierPhoneTakenException extends ApiException {
  constructor() {
    super(ErrorCode.UNIQUE_CONSTRAINT, COURIER_PHONE_TAKEN_MESSAGE, 409)
  }
}

export class SavedCustomerPhoneClashException extends common.ConflictException {
  constructor(conflictingCustomerId: string) {
    super({
      code: ErrorCode.UNIQUE_CONSTRAINT,
      message: SAVED_CUSTOMER_PHONE_CLASH_MESSAGE,
      statusCode: 409,
      conflictingCustomerId,
    })
  }
}

// Spec 0043 (AC-3): a restaurant's size change after a rider was offered or took the order.
export const BOX_SIZE_LOCKED_MESSAGE = 'The size cannot change any more: a rider has already been offered this order.'

// Spec 0043 (AC-6): an admin assignment that would put the rider past a full box. The admin page
// shows both numbers in its confirm dialog, so the 409 carries them (ResponseFormatMiddleware passes
// them through). Sent again with confirmOverCapacity: true, the assignment goes ahead.
export class BoxOverCapacityException extends common.ConflictException {
  constructor(heldUnits: number, deliveryUnits: number) {
    super({
      code: ErrorCode.BOX_OVER_CAPACITY,
      message: `This would put the rider past a full box: they hold ${heldUnits} of ${RIDER_BOX_UNITS} units and this order takes ${deliveryUnits}. Confirm to assign anyway.`,
      statusCode: 409,
      heldUnits,
      deliveryUnits,
      // Spec 0054 (AC-6): the same numbers where every coded refusal puts them, and the box's size, so the
      // translated text never types in a limit of its own.
      params: { heldUnits, deliveryUnits, boxUnits: RIDER_BOX_UNITS },
    })
  }
}

// Spec 0036, AC-6: a bill that names a charge another bill already covers. The page reloads its
// lines and names these ones, so the 409 carries their ids.
export class PartnerChargesAlreadyBilledException extends common.ConflictException {
  constructor(alreadyBilled: string[]) {
    super({
      code: ErrorCode.UNIQUE_CONSTRAINT,
      message: 'Some of these charges are already billed.',
      statusCode: 409,
      alreadyBilled,
    })
  }
}

// Spec 0036, AC-7: undoing a bill that is already undone changes nothing.
export class PartnerBillAlreadyUndoneException extends common.ConflictException {
  constructor() {
    super({ code: ErrorCode.NOT_ALLOWED, message: 'This bill is already undone.', statusCode: 409 })
  }
}

export class GenericException extends ApiException {
  constructor(code: ErrorCode, message: string, options?: HttpExceptionOptions) {
    super(code, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * A relationship that in theory must exist in the DB does not
 */
export class InconsistentDataError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.INCONSISTENT_DATA, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Trying to add an item using points but balance is not sufficient.
 */
export class NotEnoughPointsInBalance extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.NOT_ENOUGH_POINTS_IN_BALANCE, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Trying to add an item that is no longer actively available or does not exist
 */
export class CartExistsError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.CART_EXISTS, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Trying to add an item that is no longer actively available or does not exist
 */
export class ItemUnavailableError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.CATALOG_ITEM_UNAVAILABLE, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Placing an order with a closed merchant
 */
export class MerchantClosedError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.MERCHANT_CLOSED, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Either due to distance for some other reason couriers are not available for this order
 */
export class NoCouriersAvailableError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.NO_COURIERS_AVAILABLE, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Delivering one or more push notifications failed
 */
export class PushNotificationDeliveryFailed extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.PUSH_NOTIFICATION_DELIVERY_FAILED, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Error when ingesting menu from integration
 */
export class MenuIngestionError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.MENU_INGESTION_ERROR, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Generic server error.
 */
export class InternalServerError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.INTERNAL_SERVER_ERROR, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * An error which cannot be fixed by our system, for example transfer_group being missing.
 * If this happens then we should return 200 to stripe and log the error.
 */
export class UnrecoverableStripeWebhookError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.UNRECOVERABLE_STRIPE_WEBHOOK_ERROR, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * An error which is either temporary or should be fixed in our system.
 * If this type of error happens we return and error in the webhook and let stripe retry
 * until the error either resolves or we fix the root cause.
 */
export class RecoverableStripeWebhookError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.UNRECOVERABLE_STRIPE_WEBHOOK_ERROR, message, DEFAULT_HTTP_CODE, options)
  }
}

export class PaymentCreationError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.PAYMENT_CREATION_ERROR, message, DEFAULT_HTTP_CODE, options)
  }
}

/**
 * Blockchain Contract Errors
 */
export class BlockchainContractReversionError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.BLOCKCHAIN_CONTRACT_REVERSION_ERROR, message, 409, options)
  }
}
export class BlockchainTransactionError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.BLOCKCHAIN_TRANSACTION_ERROR, message, 409, options)
  }
}

/**
 * Delivery state errors.
 */

export class CantUpdateDeliveryStatusError extends ApiException {
  constructor(message: string, options?: HttpExceptionOptions) {
    super(ErrorCode.CANT_UPDATE_DELIVERY_STATUS, message, 409, options)
  }
}

// Spec 0014 (AC-4) and spec 0054 (AC-6): an admin's hand offer or reassignment during a dispatch stop. Still a
// CantUpdateDeliveryStatusError for every caller that checks the class; its answer names the stop's own code
// and the time it ends, so the admin page can say it in its reader's language.
export class DispatchStoppedError extends CantUpdateDeliveryStatusError {
  constructor(sentence: CodedSentence) {
    super(sentence.message)
    this.sentenceCode = sentence.code
    this.params = sentence.params
  }
}
