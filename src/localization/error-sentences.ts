// Spec 0054 (row 47), AC-6: a specific code for every refusal a person reads. Most refusals are thrown as
// Nest's own exceptions carrying one of the fixed sentences below, and those answers had no `code` at all,
// so an app could only show the English sentence. HttpExceptionFilter now looks the sentence up here and
// adds its code to the answer (keeping the sentence, the status and the exception class as they were, so
// nothing that reads them changes). Each app shows `server.error.<code>` in its reader's language, else
// the server's sentence.
//
// The table is built from the exported constants themselves, never retyped, so editing a sentence moves
// its code with it. A sentence with numbers in it (a minute count, a leg number) is not here: those still
// answer with the English sentence until they are thrown with params (listed in the build's inventory).
import { API_KEY_DOES_NOT_WORK_MESSAGE, API_KEY_IN_URL_MESSAGE } from 'src/domains/auth/api-key'
import { CREDENTIALS_CHANGED_MESSAGE } from 'src/domains/auth/credentials-change'
import {
  RESET_BY_EMAIL_OFF_MESSAGE,
  RESET_CODE_REFUSED_MESSAGE,
  RESET_PASSWORD_LENGTH_MESSAGE,
} from 'src/domains/auth/password-reset.service'
import { COMPLAINT_PHOTO_TYPE_MESSAGE, COMPLAINT_PHOTO_UNREADABLE_MESSAGE } from 'src/domains/complaint/complaint-photo'
import {
  COMPLAINT_OUTCOME_MESSAGE,
  COMPLAINT_REPLY_MESSAGE,
  COMPLAINT_TEXT_MESSAGE,
  COMPLAINT_WITHDRAW_REASON_MESSAGE,
} from 'src/domains/complaint/complaint-rules'
import { ACCOUNT_SENTENCES, RIDER_DEACTIVATED_SENTENCE } from 'src/domains/courier/account-upkeep'
import { OFFLINE_POSITION_REFUSED_MESSAGE } from 'src/domains/courier/courier.domain.service'
import { ADD_ON_NOT_AUTOMATIC_SENTENCE } from 'src/domains/delivery/add-on'
import { PARTNER_EDIT_SENTENCES } from 'src/domains/delivery/partner-edit'
import {
  LEG_LABELS_LOCKED_SENTENCE,
  LEG_REFERENCE_REQUIRED_SENTENCE,
  SIBLING_LEG_HELD_SENTENCE,
} from 'src/domains/delivery/legs'
import { READY_SENTENCES, USUAL_PREP_MINUTES_SENTENCE } from 'src/domains/delivery/ready-signals'
import {
  STACK_CHANGED_SENTENCE,
  THIRD_DELIVERY_REFUSED_SENTENCE,
} from 'src/domains/delivery/stack'
import { PERSONAL_DATA_WARNING_MESSAGE } from 'src/domains/location-note/personal-data-check'
import {
  INVALID_PHONE_MESSAGE,
  OUTSIDE_SERVICE_AREA_MESSAGE,
} from 'src/domains/saved-customer/saved-customer.domain.service'
import { SOS_SENTENCES } from 'src/domains/sos/sos-incident-state'
import { SPLIT_SENTENCES } from 'src/domains/split/split'
import {
  BOX_SIZE_LOCKED_MESSAGE,
  COURIER_EMAIL_TAKEN_MESSAGE,
  COURIER_PHONE_TAKEN_MESSAGE,
  OFFER_HAS_ENDED_MESSAGE,
  SAVED_CUSTOMER_PHONE_CLASH_MESSAGE,
} from 'src/errors'
import { MIXED_CREDENTIALS_MESSAGE } from 'src/middleware/AuthMiddleware'
import {
  ALREADY_MOVED_MESSAGE,
  ALREADY_THERE_MESSAGE,
  WRONG_STATUS_MESSAGE,
} from 'src/rest-api/delivery/courier/dropoff-point.courier.service'
import { AT_RESTAURANT_MESSAGE, ORDER_CHANGED_MESSAGE } from 'src/rest-api/delivery/courier/hand-back.courier.service'
import { NOT_WAITING_MESSAGE } from 'src/rest-api/delivery/courier/leave-wait.courier.service'
import { ROUTE_UNAVAILABLE_MESSAGE } from 'src/rest-api/delivery/courier/route.courier.service'
import { OSRM_UNAVAILABLE_MESSAGE } from 'src/services/osrm/osrm-routing.service'
import {
  ADMIN_ORDER_CHANGED_MESSAGE,
  ALREADY_OPEN_MESSAGE,
  BOARD_STALE_MESSAGE,
  LAST_REASON_MESSAGE,
  NOTE_REQUIRED_MESSAGE,
  REASON_GONE_MESSAGE,
  REQUEST_NOT_OPEN_MESSAGE,
} from 'src/services/removal-request/removal-request.service'
import {
  REVIEW_ANSWER_MESSAGE,
  REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE,
  REVIEW_NOTE_MESSAGE,
  REVIEW_NOT_FOUND_MESSAGE,
  REVIEW_NOT_OPEN_MESSAGE,
} from 'src/services/review-request/review-request.service'
import { SHIFT_SENTENCES } from 'src/services/shift-booking/shift-booking.service'
import { OFFLINE_EVENT_SENTENCES } from 'src/services/shift-offline/shift-offline.service'

// Sentence → code. The codes are the keys of `server.error` in src/localization/en.ts and el.ts (the
// English there is the same sentence, so the English screens read as before).
export const ERROR_SENTENCE_CODES: ReadonlyArray<readonly [string, string]> = [
  [API_KEY_DOES_NOT_WORK_MESSAGE, 'API_KEY_DOES_NOT_WORK'],
  [API_KEY_IN_URL_MESSAGE, 'API_KEY_IN_URL'],
  [CREDENTIALS_CHANGED_MESSAGE, 'CREDENTIALS_CHANGED'],
  [RESET_BY_EMAIL_OFF_MESSAGE, 'RESET_BY_EMAIL_OFF'],
  [RESET_CODE_REFUSED_MESSAGE, 'RESET_CODE_REFUSED'],
  [RESET_PASSWORD_LENGTH_MESSAGE, 'RESET_PASSWORD_LENGTH'],
  [COMPLAINT_PHOTO_TYPE_MESSAGE, 'COMPLAINT_PHOTO_TYPE'],
  [COMPLAINT_PHOTO_UNREADABLE_MESSAGE, 'COMPLAINT_PHOTO_UNREADABLE'],
  [COMPLAINT_OUTCOME_MESSAGE, 'COMPLAINT_OUTCOME_LENGTH'],
  [COMPLAINT_REPLY_MESSAGE, 'COMPLAINT_REPLY_LENGTH'],
  [COMPLAINT_TEXT_MESSAGE, 'COMPLAINT_TEXT_LENGTH'],
  [COMPLAINT_WITHDRAW_REASON_MESSAGE, 'COMPLAINT_WITHDRAW_REASON_LENGTH'],
  [ACCOUNT_SENTENCES.holdsJob, 'ACCOUNT_HOLDS_JOB'],
  [ACCOUNT_SENTENCES.inSos, 'ACCOUNT_IN_SOS'],
  [ACCOUNT_SENTENCES.isAdmin, 'ACCOUNT_IS_ADMIN'],
  [ACCOUNT_SENTENCES.alreadyDeactivated, 'ACCOUNT_ALREADY_DEACTIVATED'],
  [ACCOUNT_SENTENCES.notDeactivated, 'ACCOUNT_NOT_DEACTIVATED'],
  [ACCOUNT_SENTENCES.justOffered, 'ACCOUNT_JUST_OFFERED'],
  [ACCOUNT_SENTENCES.wrongCurrentPassword, 'ACCOUNT_WRONG_CURRENT_PASSWORD'],
  [ACCOUNT_SENTENCES.samePassword, 'ACCOUNT_SAME_PASSWORD'],
  [ACCOUNT_SENTENCES.tooManyTries, 'ACCOUNT_TOO_MANY_TRIES'],
  [RIDER_DEACTIVATED_SENTENCE, 'RIDER_DEACTIVATED'],
  [OFFLINE_POSITION_REFUSED_MESSAGE, 'OFFLINE_POSITION_REFUSED'],
  [ADD_ON_NOT_AUTOMATIC_SENTENCE, 'ADD_ON_NOT_AUTOMATIC'],
  [LEG_LABELS_LOCKED_SENTENCE, 'LEG_LABELS_LOCKED'],
  [PARTNER_EDIT_SENTENCES.ended, 'PARTNER_EDIT_ORDER_ENDED'],
  [PARTNER_EDIT_SENTENCES.pointHeld, 'PARTNER_EDIT_POINT_HELD'],
  [LEG_REFERENCE_REQUIRED_SENTENCE, 'LEG_REFERENCE_REQUIRED'],
  [SIBLING_LEG_HELD_SENTENCE, 'SIBLING_LEG_HELD'],
  [READY_SENTENCES.alreadyReady, 'READY_ALREADY_READY'],
  [READY_SENTENCES.pickedUp, 'READY_PICKED_UP'],
  [READY_SENTENCES.ended, 'READY_ORDER_ENDED'],
  [READY_SENTENCES.tooLate, 'READY_TOO_LATE'],
  [READY_SENTENCES.changed, 'READY_CHANGED'],
  [USUAL_PREP_MINUTES_SENTENCE, 'USUAL_PREP_MINUTES'],
  [STACK_CHANGED_SENTENCE, 'STACK_CHANGED'],
  [THIRD_DELIVERY_REFUSED_SENTENCE, 'THIRD_DELIVERY_REFUSED'],
  [PERSONAL_DATA_WARNING_MESSAGE, 'PERSONAL_DATA_WARNING'],
  [INVALID_PHONE_MESSAGE, 'INVALID_PHONE'],
  [OUTSIDE_SERVICE_AREA_MESSAGE, 'OUTSIDE_SERVICE_AREA'],
  [SOS_SENTENCES.notFound, 'SOS_NOT_FOUND'],
  [SOS_SENTENCES.deliveryNotYours, 'SOS_DELIVERY_NOT_YOURS'],
  [SOS_SENTENCES.courierInSos, 'COURIER_IN_SOS'],
  [SPLIT_SENTENCES.notAtPickup, 'SPLIT_NOT_AT_PICKUP'],
  [SPLIT_SENTENCES.alreadyOpen, 'SPLIT_ALREADY_OPEN'],
  [SPLIT_SENTENCES.notOpen, 'SPLIT_NOT_OPEN'],
  [SPLIT_SENTENCES.noOpenRequest, 'SPLIT_NO_OPEN_REQUEST'],
  [SPLIT_SENTENCES.tooManyLegs, 'SPLIT_TOO_MANY_LEGS'],
  [SPLIT_SENTENCES.pickupBlocked, 'SPLIT_PICKUP_BLOCKED'],
  [SPLIT_SENTENCES.leaveWaitBlocked, 'SPLIT_LEAVE_WAIT_BLOCKED'],
  [SPLIT_SENTENCES.deliveryChanged, 'SPLIT_DELIVERY_CHANGED'],
  [BOX_SIZE_LOCKED_MESSAGE, 'BOX_SIZE_LOCKED'],
  [COURIER_EMAIL_TAKEN_MESSAGE, 'COURIER_EMAIL_TAKEN'],
  [COURIER_PHONE_TAKEN_MESSAGE, 'COURIER_PHONE_TAKEN'],
  [OFFER_HAS_ENDED_MESSAGE, 'OFFER_HAS_ENDED'],
  [SAVED_CUSTOMER_PHONE_CLASH_MESSAGE, 'SAVED_CUSTOMER_PHONE_CLASH'],
  [MIXED_CREDENTIALS_MESSAGE, 'MIXED_CREDENTIALS'],
  [ALREADY_MOVED_MESSAGE, 'PIN_ALREADY_MOVED'],
  [ALREADY_THERE_MESSAGE, 'PIN_ALREADY_THERE'],
  [WRONG_STATUS_MESSAGE, 'PIN_WRONG_STATUS'],
  [AT_RESTAURANT_MESSAGE, 'HAND_BACK_AT_RESTAURANT'],
  [ORDER_CHANGED_MESSAGE, 'ORDER_CHANGED'],
  [NOT_WAITING_MESSAGE, 'LEAVE_NOT_WAITING'],
  [ROUTE_UNAVAILABLE_MESSAGE, 'ROUTE_UNAVAILABLE'],
  [OSRM_UNAVAILABLE_MESSAGE, 'ROAD_DISTANCES_UNAVAILABLE'],
  [ADMIN_ORDER_CHANGED_MESSAGE, 'REMOVAL_ORDER_CHANGED'],
  [ALREADY_OPEN_MESSAGE, 'REMOVAL_ALREADY_OPEN'],
  [BOARD_STALE_MESSAGE, 'REMOVAL_BOARD_STALE'],
  [LAST_REASON_MESSAGE, 'REMOVAL_LAST_REASON'],
  [NOTE_REQUIRED_MESSAGE, 'REMOVAL_NOTE_REQUIRED'],
  [REASON_GONE_MESSAGE, 'REMOVAL_REASON_GONE'],
  [REQUEST_NOT_OPEN_MESSAGE, 'REMOVAL_REQUEST_NOT_OPEN'],
  [REVIEW_ANSWER_MESSAGE, 'REVIEW_ANSWER_LENGTH'],
  [REVIEW_CORRECTION_NOT_ALLOWED_MESSAGE, 'REVIEW_CORRECTION_NOT_ALLOWED'],
  [REVIEW_NOTE_MESSAGE, 'REVIEW_NOTE_LENGTH'],
  [REVIEW_NOT_FOUND_MESSAGE, 'REVIEW_NOT_FOUND'],
  [REVIEW_NOT_OPEN_MESSAGE, 'REVIEW_NOT_OPEN'],
  [SHIFT_SENTENCES.off, 'SHIFTS_OFF'],
  [SHIFT_SENTENCES.full, 'SHIFT_FULL'],
  [SHIFT_SENTENCES.started, 'SHIFT_STARTED'],
  [SHIFT_SENTENCES.overlap, 'SHIFT_OVERLAP'],
  [SHIFT_SENTENCES.alreadyBooked, 'SHIFT_ALREADY_BOOKED'],
  [SHIFT_SENTENCES.notYours, 'SHIFT_NOT_YOURS'],
  [SHIFT_SENTENCES.justTaken, 'SHIFT_SWAP_JUST_TAKEN'],
  [SHIFT_SENTENCES.ownSwap, 'SHIFT_OWN_SWAP'],
  [SHIFT_SENTENCES.removed, 'SHIFT_SLOT_REMOVED'],
  [SHIFT_SENTENCES.notOnSchedule, 'SHIFT_NOT_ON_SCHEDULE'],
  [SHIFT_SENTENCES.noOpenSwap, 'SHIFT_NO_OPEN_SWAP'],
  [OFFLINE_EVENT_SENTENCES.missing, 'OFFLINE_ITEM_MISSING'],
  [OFFLINE_EVENT_SENTENCES.already, 'OFFLINE_ITEM_ALREADY_FOLLOWED_UP'],
]

const BY_SENTENCE = new Map<string, string>(ERROR_SENTENCE_CODES.map(([sentence, code]) => [sentence, code]))

// The specific code of a refusal's sentence, or null when the sentence is not one of the fixed ones.
export function codeForSentence(message: unknown): string | null {
  return typeof message === 'string' ? BY_SENTENCE.get(message) ?? null : null
}
