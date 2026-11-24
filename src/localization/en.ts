// Spec 0054 (row 47): every sentence the server writes for people, in English. The Greek file (el.ts) has
// exactly the same keys; TypeScript refuses a key missing from either, and the completeness test refuses an
// empty value or a placeholder used in one language and not the other.
//
// Everything sits under `server`, so the apps can merge these objects into their own resources as they
// are and the nested keys (`$t(server.enum...)`) still resolve there.
//
// `server.event` must keep rendering the English event messages EXACTLY as they were written before spec
// 0054: some code still finds its own rows by their message (`wait <id>`, `removal <id>`, `(award <id>)`),
// and the tests and older readers expect the same sentences. Change one only together with its readers.
export const en = {
  server: {
    // Event messages, by code (src/shared-types/event-messages.ts).
    event: {
      CREATED: 'Delivery was created delivery {{deliveryId}} from partner {{partnerId}}, ready at {{readyAt, clock}}',
      CREATED_BUSY:
        'Delivery was created delivery {{deliveryId}} from partner {{partnerId}}, ready at {{readyAt, clock}}, busy mode +{{busyMinutes}} min',
      BOX_SIZE_ASSUMED:
        "No box size was sent, so it counts as $t(server.enum.boxSize.{{size}}) ({{units}} units), the co-op's default",
      BOX_SIZE_CHANGED_BY_RESTAURANT:
        'Box size changed by the restaurant from $t(server.enum.boxSize.{{fromSize}}) ({{fromUnits}} units) to $t(server.enum.boxSize.{{toSize}}) ({{toUnits}} units)',
      BOX_SIZE_SET_BY_SPLIT: 'Admin {{adminId}} set the size to {{size}} with the split (was {{wasSize}})',
      BOX_OVER_CAPACITY_CONFIRMED:
        '{{admin}} confirmed giving this order ({{deliveryUnits}} units) to a rider already holding {{heldUnits}} of {{boxUnits}} units, {{totalUnits}} in all',
      BOX_OVER_CAPACITY_CONFIRMED_UNNAMED:
        'an admin confirmed giving this order ({{deliveryUnits}} units) to a rider already holding {{heldUnits}} of {{boxUnits}} units, {{totalUnits}} in all',
      READY_DELAYED: '+{{minutes}} min, ready at {{readyAt, clock}}',
      FOOD_READY: 'Food ready at {{at, clock}}',

      OFFERED: 'Offered to courier {{courierId}}, {{deadline}}{{extras}}',
      ADMIN_OFFERED: 'Admin offered delivery to courier {{courierId}}',
      ADMIN_OFFERED_WITH_NOTE: 'Admin offered delivery to courier {{courierId}}: {{note}}',
      NO_COURIER_AVAILABLE: 'No rider free; the delivery waits and is matched again when one is',
      OFFER_EXPIRED_AFTER: 'Offer expired after {{seconds}} s',
      OFFER_EXPIRED_AFTER_STACK: 'Offer expired after {{seconds}} s (one of two orders offered together)',
      RIDER_WENT_OFFLINE: 'Rider went offline',
      RIDER_WENT_OFFLINE_STACK: 'Rider went offline (one of two orders offered together)',
      DISPATCH_STOP_OFFER_ENDED: 'Ended: dispatch stopped ($t(server.enum.dispatchStopReason.{{reason}}))',
      DISPATCH_STOP_OFFER_ENDED_STACK:
        'Ended: dispatch stopped ($t(server.enum.dispatchStopReason.{{reason}})) (one of two orders offered together)',
      ACCEPTED: 'Courier {{courierId}} accepted delivery {{deliveryId}}',
      ACCEPTED_AUTOMATICALLY: 'Courier {{courierId}} accepted delivery {{deliveryId}} (accepted automatically)',
      ACCEPTED_TOGETHER:
        'Courier {{courierId}} accepted delivery {{deliveryId}}, offered together with delivery {{otherDeliveryId}}',
      ACCEPTED_TOGETHER_AUTOMATICALLY:
        'Courier {{courierId}} accepted delivery {{deliveryId}}, offered together with delivery {{otherDeliveryId}} (accepted automatically)',
      ACCEPTED_BY_SWEEP:
        'Courier {{courierId}} accepted delivery {{deliveryId}} as part of two orders offered together; completed by the minute sweep',
      REJECTED: 'Courier {{courierId}} rejected delivery {{deliveryId}}',
      REJECTED_TOGETHER:
        'Courier {{courierId}} rejected delivery {{deliveryId}}, offered together with delivery {{otherDeliveryId}}',

      MARKED_DISPATCHED: 'Delivery {{deliveryId}} was marked as dispatched by courier {{courierId}}',
      ARRIVED_AT_PICKUP:
        'Delivery {{deliveryId}} was status changed: courier arrived at pickup location: {{courierId}}$t(server.enum.arrivalHow.{{how}})',
      MARKED_PICKED_UP: 'Delivery {{deliveryId}} was marked as pickedup by courier {{courierId}}',
      MARKED_ON_THE_WAY: 'Delivery {{deliveryId}} was marked as on the way by courier {{courierId}}',
      ARRIVED_AT_DROPOFF:
        'Delivery {{deliveryId}} was status changed: courier arrived at dropoff location: {{courierId}}$t(server.enum.arrivalHow.{{how}})',
      MARKED_DELIVERED: 'Delivery {{deliveryId}} was marked as delivered by courier {{courierId}}',
      TAP_TOO_LATE:
        "No transition from {{fromStatus}} via {{eventType}}; the rider's step arrived after the delivery changed",
      TRANSITION_FAILED: '{{note}}',

      HANDED_BACK: 'Handed back within the free window',
      HAND_BACK_REFUSED: 'Hand back refused: the order changed first',
      LEFT_AFTER_WAIT: 'Left the restaurant after waiting past the limit',
      LEAVE_REFUSED: 'Leaving refused: the order changed first',
      COURIER_PAID_FOR_WAIT:
        'Courier {{courierId}} paid {{amount}} {{currency}} (cents): Waited {{minutes}} min at {{centsPerMinute}} cents a minute; wait {{waitOf}}',
      COURIER_PAID_FOR_WAIT_NOTE:
        'Courier {{courierId}} paid {{amount}} {{currency}} (cents): {{note}}; wait {{waitOf}}',

      CANCELED_BY_PARTNER:
        'Delivery {{deliveryId}} was canceled by partner {{partnerId}} (cancelled by: {{cancelledBy}})',
      CANCELED_BY_ADMIN: 'order canceled by admin (cancelled by: {{cancelledBy}})',
      CANCELLATION_PAY:
        'Courier {{courierId}} paid {{amount}} {{currency}} (cents) under {{policy}} for cancellation by {{cancelledBy}}',
      FOOD_RETURNED: 'Food returned to the restaurant',

      ADMIN_NOTE: '{{note}}',
      RIDER_NOTE: '{{note}}',

      REASSIGNED:
        'Admin reassigned delivery from courier {{droppedCourierId}} to courier {{newCourierId}}; payout policy {{policy}} awards {{amount}} {{currency}} (cents) to the dropped courier (award {{awardId}})',
      REASSIGNED_WITH_NOTE:
        'Admin reassigned delivery from courier {{droppedCourierId}} to courier {{newCourierId}}; payout policy {{policy}} awards {{amount}} {{currency}} (cents) to the dropped courier: {{note}} (award {{awardId}})',

      DISPATCH_STOP_RETURNED: 'Dispatch stopped ($t(server.enum.dispatchStopReason.{{reason}}))',

      REMOVAL_REQUESTED: 'Removal requested: {{label}}',
      REMOVAL_WITHDRAWN: 'Removal request withdrawn: {{label}}',
      REMOVAL_DECLINED: 'Removal request declined: {{label}}',
      REMOVAL_APPROVED: 'Removal approved: {{label}}',
      REMOVAL_APPROVED_AFTER_PICKUP: 'Removal approved after pickup, order cancelled: {{label}}',
      REMOVAL_CANCELLED_AFTER_PICKUP: 'Cancelled because a removal was approved after pickup: {{label}}',
      REMOVAL_APPROVAL_FAILED: 'Approval did not take: the order changed first ({{label}})',
      COURIER_PAID_FOR_REMOVAL:
        'Courier {{courierId}} paid {{amount}} {{currency}} (cents) under {{policy}}: {{label}}; removal {{requestId}}',
      PARTNER_CHARGED_FOR_REMOVAL:
        'Restaurant charged {{amount}} {{currency}} (cents): {{label}}; removal {{requestId}}',
      COURIER_PAID_FOR_RETURN_TRIP:
        'Courier {{courierId}} paid {{amount}} {{currency}} (cents) for the trip back to the restaurant',

      SPLIT_REQUESTED: 'Rider asked to split the order: {{count}} boxes: {{sizes, list}} (split {{splitId}})',
      SPLIT_LEFT:
        'Rider left after {{minutes}} min with no answer to split {{splitId}}; the order goes back to the restaurant to send again',
      SPLIT_LEFT_CANCELLED:
        "Cancelled: didn't fit one box, and dispatch did not split it in time. Send it again with the right sizes.",
      SPLIT_REFUSED: 'Admin {{adminId}} refused split {{splitId}}: it fits one box',
      SPLIT_CONFIRMED:
        'Admin {{adminId}} split the order (split {{splitId}}): {{count}} boxes: {{sizes, list}}; this is leg {{legNumber}} of {{legCount}}, new legs {{newLegIds}}',
      SPLIT_VOIDED: 'Split request {{splitId}} closed: the order moved on before dispatch answered',
      SPLIT_LEG_CREATED: 'Leg {{legNumber}} made by split {{splitId}}, size {{size}}',
      SPLIT_LEG_CREATED_BY_ADMIN: 'Leg {{legNumber}} made by split {{splitId}} (admin {{adminId}}), size {{size}}',
      PARTNER_CHARGED_FOR_SPLIT:
        "Restaurant charged {{amount}} {{currency}} (cents), this leg's rider pay, for split {{splitId}}",
      SPLIT_LEG_CHARGE_VOIDED:
        "Restaurant's split leg charge of {{amount}} {{currency}} (cents) taken back: no rider ever took this leg",
      COURIER_PAID_FOR_SPLIT_WAIT:
        'Courier {{courierId}} paid {{amount}} {{currency}} (cents): Waited {{minutes}} min while dispatch split the order, at {{centsPerMinute}} cents a minute; split {{splitId}}',

      REVIEW_REQUESTED: 'Review requested: {{topic}}',
      REVIEW_ANSWERED: 'Review answered: {{outcome}}',
      COURIER_PAID_FOR_REVIEW: 'Courier {{courierId}} paid {{amount}} {{currency}} (cents) for review {{reviewId}}',

      DROPOFF_MOVED_BY_RIDER:
        'Drop off pin moved {{metres}} m by the rider, from {{from}} to {{to}}; $t(server.enum.savedCustomerOutcome.{{outcome}})',
      DROPOFF_MOVED_BY_RESTAURANT: 'Drop off pin moved {{metres}} m by the restaurant, from {{from}} to {{to}}',

      PRODUCT_REPORTED: 'Reported {{kind}} ({{source}})',
      PRODUCT_REPORTED_ITEM: 'Reported {{kind}}: {{itemName}} ({{source}})',
      PRODUCT_REPORT_RESOLVED: 'Report resolved ({{kind}})',
      ADD_ON_JOINED: 'Delivery {{addOnId}} was added to this job as one more order on the way; courier {{courierId}} has taken both',

      SEEDED_COMPLETED: 'Seeded completed delivery',
      SEEDED_REASSIGNMENT: 'Seeded reassignment fixture',
    },

    // Pieces of a message that are only sometimes there (EVENT_PART_CODES).
    eventPart: {
      OFFER_DEADLINE: 'answer by {{at}}',
      OFFER_NO_DEADLINE: 'no deadline',
      OFFER_MOVED_BY_ADMIN: '; moved by an admin from the open offer to courier {{courierId}}',
      TIMING_TRAVEL_UNKNOWN: ', ready {{readyAt, clock}}, travel unknown',
      TIMING_TRAVEL: ', ready {{readyAt, clock}}, travel ~{{travelMinutes}} min, lead {{leadMinutes}} min',
      TIMING_LEAD: ', ready {{readyAt, clock}}, lead {{leadMinutes}} min',
      STACK_PAIRED: '; offered together with delivery {{otherDeliveryId}}, stops: {{stops, comma}}',
      ADD_ON:
        '; offered as one more order on the way, added to the job of delivery {{jobId}}{{figures}}, stops: {{stops, comma}}{{calm}}{{why}}',
      ADD_ON_FIGURES: ' (+{{extraKm}} km, +{{extraMinutes}} min)',
      ADD_ON_CARRYING_FOOD: '; the rider carries food, so twice the time to answer and no insistent ring',
      ADD_ON_FREE_RIDER_FOUND: '; a free rider was found, and the co-op offers an add on whenever it fits',
      ADD_ON_NO_FREE_RIDER: '; no free rider was found',
      STOP_PICKUP: 'pickup {{shortId}}',
      STOP_DROPOFF: 'drop off {{shortId}}',
      BOX: '$t(server.enum.boxSize.{{size}})',
    },

    // Enum values as words, for the templates above (and for the apps).
    enum: {
      boxSize: { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' },
      cancelledBy: { RESTAURANT: 'the restaurant', CUSTOMER: 'the customer', COOP: 'the co-op' },
      dispatchStopReason: { HEAT: 'heat', STORM: 'storm', OTHER: 'other reasons' },
      arrivalHow: { DETECTED: ' (detected by the app)', TAPPED: ' (tapped by the rider)' },
      savedCustomerOutcome: {
        UPDATED: 'saved customer updated',
        NONE: 'no saved customer',
        CHANGED_SINCE: 'saved customer not changed: the restaurant moved its pin since the order',
      },
      reviewTopic: { OFFER: 'an offer', PAY: 'pay', OTHER: 'something else' },
      reviewOutcome: { STANDS: 'the decision stands', CHANGED: 'the decision was changed' },
      productReportKind: { WRONG_ITEM: 'a wrong item', MISSING_ITEM: 'a missing item' },
      productReportSource: { COURIER: 'by the rider', PARTNER: 'by the restaurant', ADMIN: 'by the co-op' },
      deliveryIssueReason: {
        WRONG_ADDRESS: 'Wrong address',
        NO_SIGNAL: 'No internet, GPS or signal',
        ORDER_HANDED: 'Order handed to the customer',
        FOOD_NOT_READY: 'Marked ready but not ready',
        OTHER: 'Other',
      },
      deliveryStatus: {
        CREATED: 'created',
        ASSIGNING_COURIER: 'looking for a rider',
        ACCEPTED: 'accepted',
        DISPATCHED: 'on the way to the restaurant',
        COURIER_ARRIVED_AT_PICKUP_LOCATION: 'at the restaurant',
        PICKED_UP: 'picked up',
        ON_THE_WAY: 'on the way to the customer',
        COURIER_ARRIVED_AT_DROPOFF_LOCATION: 'at the customer',
        DROPPED_OFF: 'delivered',
        CANCELED: 'cancelled',
        FAILED: 'failed',
      },
    },

    // Refusals by code (AC-6, src/localization/error-sentences.ts). The English is the server's own sentence.
    error: {
      API_KEY_DOES_NOT_WORK: 'This API key does not work. Ask the co-op for a new one.',
      API_KEY_IN_URL: 'Send the API key in the x-api-key header, not in the address.',
      CREDENTIALS_CHANGED: 'Your password or login email was changed. Log in again.',
      RESET_BY_EMAIL_OFF: "Reset by email isn't set up yet. Ask the co-op to set a new password.",
      RESET_CODE_REFUSED: 'That code is wrong or has expired. Ask for a new one.',
      RESET_PASSWORD_LENGTH: 'The new password must be 8 to 72 characters.',
      COMPLAINT_PHOTO_TYPE: 'The photo must be a JPEG or PNG image.',
      COMPLAINT_PHOTO_UNREADABLE: 'The photo could not be read. Try another one.',
      COMPLAINT_OUTCOME_LENGTH: 'Write the outcome in 1 to 1000 characters.',
      COMPLAINT_REPLY_LENGTH: 'Write your reply in 1 to 1000 characters.',
      COMPLAINT_TEXT_LENGTH: 'Write the complaint in 1 to 1000 characters.',
      COMPLAINT_WITHDRAW_REASON_LENGTH: 'Write why the complaint is withdrawn, in 1 to 1000 characters.',
      ACCOUNT_HOLDS_JOB: 'This rider holds a job. Move it first.',
      ACCOUNT_IN_SOS: 'This rider has an open SOS. Close it first.',
      ACCOUNT_IS_ADMIN: 'This login is also an admin. Take the admin role away first.',
      ACCOUNT_ALREADY_DEACTIVATED: "This rider's account is already deactivated.",
      ACCOUNT_NOT_DEACTIVATED: "This rider's account is not deactivated.",
      ACCOUNT_JUST_OFFERED: 'This rider was just offered a job. Try again in a moment.',
      ACCOUNT_WRONG_CURRENT_PASSWORD: 'Your current password is not right.',
      ACCOUNT_SAME_PASSWORD: 'Your new password must be different from the current one.',
      ACCOUNT_TOO_MANY_TRIES: 'Too many wrong passwords. Try again in an hour.',
      RIDER_DEACTIVATED: "This rider's account is deactivated.",
      OFFLINE_POSITION_REFUSED: 'You are Offline, so no position is stored',
      ADD_ON_NOT_AUTOMATIC: 'One more order on the way is never accepted automatically. Open it and choose.',
      LEG_LABELS_LOCKED: 'This delivery is one leg of an order: its order reference and leg numbers cannot change.',
      LEG_REFERENCE_REQUIRED: 'A leg needs an orderReference: it is what ties the legs of an order together.',
      SIBLING_LEG_HELD: 'This rider already carries another leg of the same order. Each leg goes to a different rider.',
      READY_ALREADY_READY: 'The food is already marked ready.',
      READY_PICKED_UP: 'The rider has already picked this order up.',
      READY_ORDER_ENDED: 'This order has ended.',
      READY_TOO_LATE: 'A ready time can be at most 3 hours after the order was placed.',
      READY_CHANGED: 'The ready time just changed. Look again.',
      USUAL_PREP_MINUTES: 'The usual prep time is a whole number of minutes from 0 to 90.',
      STACK_CHANGED:
        'One order of this pair changed before your answer arrived, so nothing was accepted. Check your offers again.',
      THIRD_DELIVERY_REFUSED:
        'This rider already holds two orders. A third is never allowed; move one of theirs first.',
      PERSONAL_DATA_WARNING:
        'Notes describe the place, never the person. This looks like it holds a name, phone or email.',
      INVALID_PHONE: 'This phone number does not look right',
      OUTSIDE_SERVICE_AREA: 'This address is outside the area the co-op serves',
      SOS_NOT_FOUND: 'This SOS was not found.',
      SOS_DELIVERY_NOT_YOURS: 'This delivery is not yours.',
      COURIER_IN_SOS: 'This rider has an active SOS and cannot be given a delivery until it ends.',
      SPLIT_NOT_AT_PICKUP: 'You can ask to split an order only at the restaurant, before you pick it up.',
      SPLIT_ALREADY_OPEN: 'This order already has a split request waiting for dispatch.',
      SPLIT_NOT_OPEN: 'This split request was already answered or closed.',
      SPLIT_NO_OPEN_REQUEST: 'This order has no split request waiting.',
      SPLIT_TOO_MANY_LEGS: 'An order has at most 4 legs in all.',
      SPLIT_PICKUP_BLOCKED: 'Dispatch is splitting this order. Wait for the answer before you pick it up.',
      SPLIT_LEAVE_WAIT_BLOCKED:
        'Dispatch is splitting this order. Wait for the answer, or leave once the split limit has passed.',
      SPLIT_DELIVERY_CHANGED: 'This order changed before the split could be made. Look again.',
      BOX_SIZE_LOCKED: 'The size cannot change any more: a rider has already been offered this order.',
      COURIER_EMAIL_TAKEN: 'That email is already used by another account.',
      COURIER_PHONE_TAKEN: 'That phone is already used by another rider.',
      OFFER_HAS_ENDED: 'This offer has ended',
      SAVED_CUSTOMER_PHONE_CLASH: 'Another saved customer has this phone',
      MIXED_CREDENTIALS: 'Send either an API key or a login token, not both',
      PIN_ALREADY_MOVED: 'The pin was already moved for this delivery',
      PIN_ALREADY_THERE: 'The pin is already where you stand',
      PIN_WRONG_STATUS: 'The pin can be moved only between pickup and drop off',
      HAND_BACK_AT_RESTAURANT: 'You are at the restaurant. Report an issue or call dispatch to give this order back.',
      ORDER_CHANGED: 'This order changed. Check your jobs.',
      LEAVE_NOT_WAITING: 'You can only leave while you are waiting at the restaurant.',
      ROUTE_UNAVAILABLE: "The route can't be drawn right now.",
      ROAD_DISTANCES_UNAVAILABLE:
        'Road distances are not available right now, so this cannot be priced. Try again in a minute.',
      REMOVAL_ORDER_CHANGED: 'This order changed while you were deciding. Look at the row again.',
      REMOVAL_ALREADY_OPEN: 'A removal request is already open for this order.',
      REMOVAL_BOARD_STALE: 'This order moved on since the board was loaded. Reload and try again.',
      REMOVAL_LAST_REASON: 'At least one reason must stay on the list.',
      REMOVAL_NOTE_REQUIRED: 'This reason needs a note. Say what happened.',
      REMOVAL_REASON_GONE: 'That reason is no longer on the list. Pick another.',
      REMOVAL_REQUEST_NOT_OPEN: 'This request has already been answered or withdrawn.',
      REVIEW_ANSWER_LENGTH: 'Write the reason for the answer, in 1 to 2000 characters.',
      REVIEW_CORRECTION_NOT_ALLOWED:
        'A pay correction can only be added when the answer is "changed" and the request is about a delivery.',
      REVIEW_NOTE_LENGTH: 'Write what you want looked at again, in 1 to 1000 characters.',
      REVIEW_NOT_FOUND: 'Review request not found',
      REVIEW_NOT_OPEN: 'This review request has already been answered or withdrawn.',
      SHIFTS_OFF: 'Shifts are off.',
      SHIFT_FULL: 'This shift just filled up.',
      SHIFT_STARTED: 'This shift has already started.',
      SHIFT_OVERLAP: 'You already have a shift at that time.',
      SHIFT_ALREADY_BOOKED: 'You already booked this shift.',
      SHIFT_NOT_YOURS: 'This booking is no longer yours to change.',
      SHIFT_SWAP_JUST_TAKEN: 'This swap was just taken.',
      SHIFT_OWN_SWAP: "You can't take your own swap.",
      SHIFT_SLOT_REMOVED: 'This slot was removed. You can still drop it.',
      SHIFT_NOT_ON_SCHEDULE: 'This shift is not on the schedule.',
      SHIFT_NO_OPEN_SWAP: 'No open swap here.',
      OFFLINE_ITEM_MISSING: 'This item is not on the list.',
      OFFLINE_ITEM_ALREADY_FOLLOWED_UP: 'This item was already followed up.',
      // Thrown with params (spec 0054, AC-6): the numbers travel in the answer's `params`.
      BOX_OVER_CAPACITY:
        'This would put the rider past a full box: they hold {{heldUnits}} of {{boxUnits}} units and this order takes {{deliveryUnits}}. Confirm to assign anyway.',
      // Thrown with params as well (spec 0054, AC-6, review of 2026-11-22): sentences with a number, a time or
      // a name in them (src/localization/coded-sentence.ts). Times are ISO in `params`, shown on Athens time.
      LEAVE_WAIT_TOO_SOON:
        'You can leave {{minutes}} min after the promised time, or after you arrived if that was later.',
      SPLIT_LEAVE_TOO_SOON: 'You can leave after {{minutes}} min without an answer from dispatch.',
      SHIFT_DROP_TOO_LATE:
        'This shift can no longer be dropped. You could drop it until {{until, when}}; you can still offer it as a swap.',
      LEG_TAKEN: 'Leg {{legNumber}} of {{legCount}} of this order was already sent.',
      LEG_COUNT_MISMATCH:
        'This order was sent as {{sentCount}} legs; leg {{legNumber}} of {{legCount}} does not match.',
      PARTNER_DISABLED: 'The co-op has disabled this restaurant: {{reason}}',
      PARTNER_DISABLED_NO_REASON: 'The co-op has disabled this restaurant: no reason given',
      PARTNER_PAUSED: 'Ordering is paused until {{until, clock}}.',
      DISPATCH_STOPPED_RESTAURANT: 'Delivery is stopped until {{until, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RESTAURANT_OPEN: 'Delivery is stopped until dispatch restarts ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_ADMIN: 'Dispatch is stopped until {{until, when}}.',
      DISPATCH_STOPPED_ADMIN_OPEN: 'Dispatch is stopped until it is restarted.',
    },

    // Sentences that are not refusals, by code (spec 0054, AC-2, review of 2026-11-22). A dispatch stop's
    // banner: the view sends `messageCode` and `messageParams` beside its English `message`.
    notice: {
      DISPATCH_STOPPED_RIDER: 'Dispatch is stopped until {{until, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RIDER_OPEN: 'Dispatch is stopped until the co-op restarts it ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RESTAURANT: 'Delivery is stopped until {{until, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RESTAURANT_OPEN: 'Delivery is stopped until dispatch restarts ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RIDER: 'Dispatch stops {{startsAt, day}} {{startsAt, clock}} to {{endsAt, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RIDER_SAME_DAY:
        'Dispatch stops {{startsAt, day}} {{startsAt, clock}} to {{endsAt, clock}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RIDER_OPEN:
        'Dispatch stops {{startsAt, day}} from {{startsAt, clock}} until dispatch restarts ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RESTAURANT:
        'Delivery stops {{startsAt, day}} {{startsAt, clock}} to {{endsAt, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RESTAURANT_SAME_DAY:
        'Delivery stops {{startsAt, day}} {{startsAt, clock}} to {{endsAt, clock}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RESTAURANT_OPEN:
        'Delivery stops {{startsAt, day}} from {{startsAt, clock}} until dispatch restarts ($t(server.enum.dispatchStopReason.{{reason}})).',
    },

    // The dispatch board's row sentences (an attention row's `detailCode` and `detailParams`, beside its
    // English `detail`). A row's `note`, when it has one, is the person's own words and goes on a second
    // line as written.
    board: {
      NOT_OFFERED_YET: 'Not offered yet, food ready {{readyAt, clock}}',
      NO_COURIER_ACCEPTED: 'No courier accepted',
      OFFERED: 'Offered to {{rider}}, unanswered',
      OFFERED_PAIR: 'Offered to {{rider}} together with {{otherOrder}}, unanswered',
      OFFERED_ADD_ON:
        'Offered to {{rider}} as one more order on the way with {{job}} (+{{extraKm, decimal}} km, +{{extraMinutes}} min), unanswered',
      OFFERED_ADD_ON_NO_FIGURES: 'Offered to {{rider}} as one more order on the way with {{job}}, unanswered',
      RESTAURANT_LATE: '{{rider}} waiting at {{restaurant}}, food was due {{promisedAt, clock}}',
      RIDER_REPORT: '{{rider}} reported: $t(server.enum.deliveryIssueReason.{{reason}})',
      REMOVAL_PAID: '{{rider}} asks to come off this order: {{label}} (Paid)',
      REMOVAL_NOT_PAID: '{{rider}} asks to come off this order: {{label}} (Not paid)',
      REMOVAL_PAID_PICKED_UP:
        '{{rider}} asks to come off this order: {{label}} (Paid). Food already picked up: approving cancels the order.',
      REMOVAL_NOT_PAID_PICKED_UP:
        '{{rider}} asks to come off this order: {{label}} (Not paid). Food already picked up: approving cancels the order.',
    },

    // Mails (cross check 8), in the reader's User.language.
    mail: {
      resetSubject: 'Password reset code for {{coop}}',
      resetBody:
        "Type this code in the app to set a new password. It works for 15 minutes. If you didn't ask for it, ignore this email.",
      emailChangedSubject: 'Your login email for {{coop}} was changed',
      emailChangedBody:
        'Your login email for {{coop}} was changed to {{newEmail}}. If you did not expect this, contact the co-op.',
      coopFallback: 'the co-op',
    },
  },
}

// The shape every language file must have: the same keys, each a string.
export type Translations = typeof en
