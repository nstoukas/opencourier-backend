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
