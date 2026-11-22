// Spec 0054 (row 47): the Greek of every sentence in en.ts, key for key. Drafted by Claude during the
// build; a Greek speaking member checks it (docs/translations/greek-review.md) before go live.
// Wording rules (AC-10): plain everyday Greek, the polite plural, never the familiar singular;
// "διανομέας" for rider, "κατάστημα" for restaurant, "συνεταιρισμός" for the co-op; no Greeklish.
// Times use the `clock` formatter (24 hour, Athens), never the raw ISO text the English record keeps.
import { Translations } from './en'

// `: Translations` makes TypeScript refuse this object if a key of en.ts is missing or extra.
export const el: Translations = {
  server: {
    event: {
      CREATED:
        'Η παραγγελία {{deliveryId}} δημιουργήθηκε από το κατάστημα {{partnerId}}, έτοιμη στις {{readyAt, clock}}',
      CREATED_BUSY:
        'Η παραγγελία {{deliveryId}} δημιουργήθηκε από το κατάστημα {{partnerId}}, έτοιμη στις {{readyAt, clock}}, λειτουργία φόρτου +{{busyMinutes}} λεπτά',
      BOX_SIZE_ASSUMED:
        'Δεν δόθηκε μέγεθος κουτιού, οπότε μετρά ως $t(server.enum.boxSize.{{size}}) ({{units}} μονάδες), η προεπιλογή του συνεταιρισμού',
      BOX_SIZE_CHANGED_BY_RESTAURANT:
        'Το κατάστημα άλλαξε το μέγεθος κουτιού από $t(server.enum.boxSize.{{fromSize}}) ({{fromUnits}} μονάδες) σε $t(server.enum.boxSize.{{toSize}}) ({{toUnits}} μονάδες)',
      BOX_SIZE_SET_BY_SPLIT:
        'Ο διαχειριστής {{adminId}} όρισε το μέγεθος σε $t(server.enum.boxSize.{{size}}) με τον διαχωρισμό (ήταν $t(server.enum.boxSize.{{wasSize}}))',
      BOX_OVER_CAPACITY_CONFIRMED:
        'Ο/Η {{admin}} επιβεβαίωσε την ανάθεση αυτής της παραγγελίας ({{deliveryUnits}} μονάδες) σε διανομέα που ήδη μεταφέρει {{heldUnits}} από {{boxUnits}} μονάδες, {{totalUnits}} συνολικά',
      BOX_OVER_CAPACITY_CONFIRMED_UNNAMED:
        'Ένας διαχειριστής επιβεβαίωσε την ανάθεση αυτής της παραγγελίας ({{deliveryUnits}} μονάδες) σε διανομέα που ήδη μεταφέρει {{heldUnits}} από {{boxUnits}} μονάδες, {{totalUnits}} συνολικά',
      READY_DELAYED: '+{{minutes}} λεπτά, έτοιμη στις {{readyAt, clock}}',
      FOOD_READY: 'Το φαγητό ήταν έτοιμο στις {{at, clock}}',

      OFFERED: 'Προτάθηκε στον διανομέα {{courierId}}, {{deadline}}{{extras}}',
      ADMIN_OFFERED: 'Ο διαχειριστής πρότεινε την παραγγελία στον διανομέα {{courierId}}',
      ADMIN_OFFERED_WITH_NOTE: 'Ο διαχειριστής πρότεινε την παραγγελία στον διανομέα {{courierId}}: {{note}}',
      NO_COURIER_AVAILABLE:
        'Κανένας διανομέας διαθέσιμος· η παραγγελία περιμένει και θα προταθεί ξανά μόλις βρεθεί κάποιος',
      OFFER_EXPIRED_AFTER: 'Η πρόταση έληξε μετά από {{seconds}} δευτ.',
      OFFER_EXPIRED_AFTER_STACK:
        'Η πρόταση έληξε μετά από {{seconds}} δευτ. (μία από δύο παραγγελίες που προτάθηκαν μαζί)',
      RIDER_WENT_OFFLINE: 'Ο διανομέας αποσυνδέθηκε',
      RIDER_WENT_OFFLINE_STACK: 'Ο διανομέας αποσυνδέθηκε (μία από δύο παραγγελίες που προτάθηκαν μαζί)',
      DISPATCH_STOP_OFFER_ENDED: 'Έληξε: παύση διανομών ($t(server.enum.dispatchStopReason.{{reason}}))',
      DISPATCH_STOP_OFFER_ENDED_STACK:
        'Έληξε: παύση διανομών ($t(server.enum.dispatchStopReason.{{reason}})) (μία από δύο παραγγελίες που προτάθηκαν μαζί)',
      ACCEPTED: 'Ο διανομέας {{courierId}} αποδέχτηκε την παραγγελία {{deliveryId}}',
      ACCEPTED_AUTOMATICALLY: 'Ο διανομέας {{courierId}} αποδέχτηκε την παραγγελία {{deliveryId}} (αυτόματη αποδοχή)',
      ACCEPTED_TOGETHER:
        'Ο διανομέας {{courierId}} αποδέχτηκε την παραγγελία {{deliveryId}}, που προτάθηκε μαζί με την παραγγελία {{otherDeliveryId}}',
      ACCEPTED_BY_SWEEP:
        'Ο διανομέας {{courierId}} αποδέχτηκε την παραγγελία {{deliveryId}} ως μία από δύο παραγγελίες που προτάθηκαν μαζί· ολοκληρώθηκε από τον έλεγχο του λεπτού',
      REJECTED: 'Ο διανομέας {{courierId}} απέρριψε την παραγγελία {{deliveryId}}',
      REJECTED_TOGETHER:
        'Ο διανομέας {{courierId}} απέρριψε την παραγγελία {{deliveryId}}, που προτάθηκε μαζί με την παραγγελία {{otherDeliveryId}}',

      MARKED_DISPATCHED: 'Ο διανομέας {{courierId}} ξεκίνησε για το κατάστημα (παραγγελία {{deliveryId}})',
      ARRIVED_AT_PICKUP:
        'Ο διανομέας {{courierId}} έφτασε στο κατάστημα (παραγγελία {{deliveryId}})$t(server.enum.arrivalHow.{{how}})',
      MARKED_PICKED_UP: 'Ο διανομέας {{courierId}} παρέλαβε την παραγγελία {{deliveryId}}',
      MARKED_ON_THE_WAY: 'Ο διανομέας {{courierId}} είναι καθ’ οδόν προς τον πελάτη (παραγγελία {{deliveryId}})',
      ARRIVED_AT_DROPOFF:
        'Ο διανομέας {{courierId}} έφτασε στον πελάτη (παραγγελία {{deliveryId}})$t(server.enum.arrivalHow.{{how}})',
      MARKED_DELIVERED: 'Ο διανομέας {{courierId}} παρέδωσε την παραγγελία {{deliveryId}}',
      TAP_TOO_LATE:
        'Καμία μετάβαση από {{fromStatus}} με {{eventType}}· το βήμα του διανομέα έφτασε αφού είχε ήδη αλλάξει η παραγγελία',
      TRANSITION_FAILED: '{{note}}',

      HANDED_BACK: 'Επιστράφηκε μέσα στο δωρεάν διάστημα',
      HAND_BACK_REFUSED: 'Η επιστροφή δεν έγινε: η παραγγελία είχε ήδη αλλάξει',
      LEFT_AFTER_WAIT: 'Έφυγε από το κατάστημα αφού περίμενε πέρα από το όριο',
      LEAVE_REFUSED: 'Η αποχώρηση δεν έγινε: η παραγγελία είχε ήδη αλλάξει',
      COURIER_PAID_FOR_WAIT:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ): αναμονή {{minutes}} λεπτών με {{centsPerMinute}} λεπτά του ευρώ το λεπτό· αναμονή {{waitOf}}',
      COURIER_PAID_FOR_WAIT_NOTE:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ): {{note}}· αναμονή {{waitOf}}',

      CANCELED_BY_PARTNER:
        'Η παραγγελία {{deliveryId}} ακυρώθηκε από το κατάστημα {{partnerId}} (ακύρωση από: $t(server.enum.cancelledBy.{{cancelledBy}}))',
      CANCELED_BY_ADMIN:
        'Ο διαχειριστής ακύρωσε την παραγγελία (ακύρωση από: $t(server.enum.cancelledBy.{{cancelledBy}}))',
      CANCELLATION_PAY:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ) με τον κανόνα {{policy}} για ακύρωση από $t(server.enum.cancelledBy.{{cancelledBy}})',
      FOOD_RETURNED: 'Το φαγητό επιστράφηκε στο κατάστημα',

      ADMIN_NOTE: '{{note}}',
      RIDER_NOTE: '{{note}}',

      REASSIGNED:
        'Ο διαχειριστής μετέφερε την παραγγελία από τον διανομέα {{droppedCourierId}} στον διανομέα {{newCourierId}}· ο κανόνας πληρωμής {{policy}} δίνει {{amount}} {{currency}} (λεπτά του ευρώ) στον διανομέα που την έχασε (αποζημίωση {{awardId}})',
      REASSIGNED_WITH_NOTE:
        'Ο διαχειριστής μετέφερε την παραγγελία από τον διανομέα {{droppedCourierId}} στον διανομέα {{newCourierId}}· ο κανόνας πληρωμής {{policy}} δίνει {{amount}} {{currency}} (λεπτά του ευρώ) στον διανομέα που την έχασε: {{note}} (αποζημίωση {{awardId}})',

      DISPATCH_STOP_RETURNED: 'Παύση διανομών ($t(server.enum.dispatchStopReason.{{reason}}))',

      REMOVAL_REQUESTED: 'Αίτημα αποδέσμευσης: {{labelEl}}',
      REMOVAL_WITHDRAWN: 'Το αίτημα αποδέσμευσης αποσύρθηκε: {{labelEl}}',
      REMOVAL_DECLINED: 'Το αίτημα αποδέσμευσης απορρίφθηκε: {{labelEl}}',
      REMOVAL_APPROVED: 'Η αποδέσμευση εγκρίθηκε: {{labelEl}}',
      REMOVAL_APPROVED_AFTER_PICKUP: 'Η αποδέσμευση εγκρίθηκε μετά την παραλαβή, η παραγγελία ακυρώθηκε: {{labelEl}}',
      REMOVAL_CANCELLED_AFTER_PICKUP: 'Ακυρώθηκε επειδή εγκρίθηκε αποδέσμευση μετά την παραλαβή: {{labelEl}}',
      REMOVAL_APPROVAL_FAILED: 'Η έγκριση δεν έγινε: η παραγγελία είχε ήδη αλλάξει ({{labelEl}})',
      COURIER_PAID_FOR_REMOVAL:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ) με τον κανόνα {{policy}}: {{labelEl}}· αποδέσμευση {{requestId}}',
      PARTNER_CHARGED_FOR_REMOVAL:
        'Χρέωση καταστήματος {{amount}} {{currency}} (λεπτά του ευρώ): {{labelEl}}· αποδέσμευση {{requestId}}',
      COURIER_PAID_FOR_RETURN_TRIP:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ) για τη διαδρομή επιστροφής στο κατάστημα',

      SPLIT_REQUESTED:
        'Ο διανομέας ζήτησε διαχωρισμό της παραγγελίας: {{count}} κουτιά: {{sizes, list}} (διαχωρισμός {{splitId}})',
      SPLIT_LEFT:
        'Ο διανομέας έφυγε μετά από {{minutes}} λεπτά χωρίς απάντηση στον διαχωρισμό {{splitId}}· η παραγγελία επιστρέφει στο κατάστημα για να σταλεί ξανά',
      SPLIT_LEFT_CANCELLED:
        'Ακυρώθηκε: δεν χωρούσε σε ένα κουτί και ο συντονισμός δεν τη χώρισε εγκαίρως. Στείλτε την ξανά με τα σωστά μεγέθη.',
      SPLIT_REFUSED: 'Ο διαχειριστής {{adminId}} απέρριψε τον διαχωρισμό {{splitId}}: χωράει σε ένα κουτί',
      SPLIT_CONFIRMED:
        'Ο διαχειριστής {{adminId}} χώρισε την παραγγελία (διαχωρισμός {{splitId}}): {{count}} κουτιά: {{sizes, list}}· αυτό είναι το σκέλος {{legNumber}} από {{legCount}}, νέα σκέλη {{newLegIds}}',
      SPLIT_VOIDED: 'Το αίτημα διαχωρισμού {{splitId}} έκλεισε: η παραγγελία προχώρησε πριν απαντήσει ο συντονισμός',
      SPLIT_LEG_CREATED:
        'Σκέλος {{legNumber}} από τον διαχωρισμό {{splitId}}, μέγεθος $t(server.enum.boxSize.{{size}})',
      SPLIT_LEG_CREATED_BY_ADMIN:
        'Σκέλος {{legNumber}} από τον διαχωρισμό {{splitId}} (διαχειριστής {{adminId}}), μέγεθος $t(server.enum.boxSize.{{size}})',
      PARTNER_CHARGED_FOR_SPLIT:
        'Χρέωση καταστήματος {{amount}} {{currency}} (λεπτά του ευρώ), η αμοιβή του διανομέα αυτού του σκέλους, για τον διαχωρισμό {{splitId}}',
      SPLIT_LEG_CHARGE_VOIDED:
        'Η χρέωση του καταστήματος για το σκέλος, {{amount}} {{currency}} (λεπτά του ευρώ), ακυρώθηκε: κανένας διανομέας δεν πήρε αυτό το σκέλος',
      COURIER_PAID_FOR_SPLIT_WAIT:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ): αναμονή {{minutes}} λεπτών όσο ο συντονισμός χώριζε την παραγγελία, με {{centsPerMinute}} λεπτά του ευρώ το λεπτό· διαχωρισμός {{splitId}}',

      REVIEW_REQUESTED: 'Αίτημα επανεξέτασης: $t(server.enum.reviewTopic.{{topic}})',
      REVIEW_ANSWERED: 'Απάντηση στην επανεξέταση: $t(server.enum.reviewOutcome.{{outcome}})',
      COURIER_PAID_FOR_REVIEW:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount}} {{currency}} (λεπτά του ευρώ) για την επανεξέταση {{reviewId}}',

      DROPOFF_MOVED_BY_RIDER:
        'Ο διανομέας μετακίνησε το σημείο παράδοσης κατά {{metres}} μ., από {{from}} σε {{to}}· $t(server.enum.savedCustomerOutcome.{{outcome}})',
      DROPOFF_MOVED_BY_RESTAURANT:
        'Το κατάστημα μετακίνησε το σημείο παράδοσης κατά {{metres}} μ., από {{from}} σε {{to}}',

      PRODUCT_REPORTED:
        'Αναφορά για $t(server.enum.productReportKind.{{kind}}) ($t(server.enum.productReportSource.{{source}}))',
      PRODUCT_REPORTED_ITEM:
        'Αναφορά για $t(server.enum.productReportKind.{{kind}}): {{itemName}} ($t(server.enum.productReportSource.{{source}}))',
      PRODUCT_REPORT_RESOLVED: 'Η αναφορά επιλύθηκε ($t(server.enum.productReportKind.{{kind}}))',

      SEEDED_COMPLETED: 'Ολοκληρωμένη παραγγελία δοκιμής',
      SEEDED_REASSIGNMENT: 'Δοκιμαστική μεταφορά παραγγελίας',
    },

    eventPart: {
      OFFER_DEADLINE: 'απάντηση έως τις {{at, clock}}',
      OFFER_NO_DEADLINE: 'χωρίς προθεσμία',
      OFFER_MOVED_BY_ADMIN: '· ο διαχειριστής τη μετέφερε από την ανοιχτή πρόταση προς τον διανομέα {{courierId}}',
      TIMING_TRAVEL_UNKNOWN: ', έτοιμη στις {{readyAt, clock}}, άγνωστος χρόνος διαδρομής',
      TIMING_TRAVEL:
        ', έτοιμη στις {{readyAt, clock}}, διαδρομή ~{{travelMinutes}} λεπτά, περιθώριο {{leadMinutes}} λεπτά',
      TIMING_LEAD: ', έτοιμη στις {{readyAt, clock}}, περιθώριο {{leadMinutes}} λεπτά',
      STACK_PAIRED: '· προτάθηκε μαζί με την παραγγελία {{otherDeliveryId}}, στάσεις: {{stops, comma}}',
      ADD_ON:
        '· προτάθηκε ως μία ακόμα παραγγελία στον δρόμο, μαζί με τη δουλειά της παραγγελίας {{jobId}}{{figures}}, στάσεις: {{stops, comma}}{{calm}}{{why}}',
      ADD_ON_FIGURES: ' (+{{extraKm}} χλμ., +{{extraMinutes}} λεπτά)',
      ADD_ON_CARRYING_FOOD:
        '· ο διανομέας μεταφέρει φαγητό, οπότε διπλάσιος χρόνος απάντησης και χωρίς επίμονο κουδούνισμα',
      ADD_ON_FREE_RIDER_FOUND:
        '· βρέθηκε ελεύθερος διανομέας, και ο συνεταιρισμός προτείνει επιπλέον παραγγελία όποτε χωράει',
      ADD_ON_NO_FREE_RIDER: '· δεν βρέθηκε ελεύθερος διανομέας',
      STOP_PICKUP: 'παραλαβή {{shortId}}',
      STOP_DROPOFF: 'παράδοση {{shortId}}',
      BOX: '$t(server.enum.boxSize.{{size}})',
    },

    enum: {
      boxSize: { SMALL: 'Μικρό', MEDIUM: 'Μεσαίο', LARGE: 'Μεγάλο' },
      cancelledBy: { RESTAURANT: 'το κατάστημα', CUSTOMER: 'τον πελάτη', COOP: 'τον συνεταιρισμό' },
      dispatchStopReason: { HEAT: 'καύσωνας', STORM: 'καταιγίδα', OTHER: 'άλλοι λόγοι' },
      arrivalHow: { DETECTED: ' (εντοπίστηκε από την εφαρμογή)', TAPPED: ' (πατήθηκε από τον διανομέα)' },
      savedCustomerOutcome: {
        UPDATED: 'ο αποθηκευμένος πελάτης ενημερώθηκε',
        NONE: 'δεν υπάρχει αποθηκευμένος πελάτης',
        CHANGED_SINCE: 'ο αποθηκευμένος πελάτης δεν άλλαξε: το κατάστημα μετακίνησε το σημείο μετά την παραγγελία',
      },
      reviewTopic: { OFFER: 'μια πρόταση', PAY: 'την αμοιβή', OTHER: 'κάτι άλλο' },
      reviewOutcome: { STANDS: 'η απόφαση ισχύει', CHANGED: 'η απόφαση άλλαξε' },
      productReportKind: { WRONG_ITEM: 'λάθος προϊόν', MISSING_ITEM: 'προϊόν που λείπει' },
      productReportSource: { COURIER: 'από τον διανομέα', PARTNER: 'από το κατάστημα', ADMIN: 'από τον συνεταιρισμό' },
      deliveryStatus: {
        CREATED: 'δημιουργήθηκε',
        ASSIGNING_COURIER: 'αναζήτηση διανομέα',
        ACCEPTED: 'αποδεκτή',
        DISPATCHED: 'καθ’ οδόν προς το κατάστημα',
        COURIER_ARRIVED_AT_PICKUP_LOCATION: 'στο κατάστημα',
        PICKED_UP: 'παραλήφθηκε',
        ON_THE_WAY: 'καθ’ οδόν προς τον πελάτη',
        COURIER_ARRIVED_AT_DROPOFF_LOCATION: 'στον πελάτη',
        DROPPED_OFF: 'παραδόθηκε',
        CANCELED: 'ακυρώθηκε',
        FAILED: 'απέτυχε',
      },
    },

    mail: {
      resetSubject: 'Κωδικός επαναφοράς για {{coop}}',
      resetBody:
        'Πληκτρολογήστε αυτόν τον κωδικό στην εφαρμογή για να ορίσετε νέο κωδικό πρόσβασης. Ισχύει για 15 λεπτά. Αν δεν τον ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.',
      emailChangedSubject: 'Το email σύνδεσής σας για {{coop}} άλλαξε',
      emailChangedBody:
        'Το email σύνδεσής σας για {{coop}} άλλαξε σε {{newEmail}}. Αν δεν το περιμένατε, επικοινωνήστε με τον συνεταιρισμό.',
      coopFallback: 'τον συνεταιρισμό',
    },
  },
}
