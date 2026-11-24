// Spec 0054 (row 47): the Greek of every sentence in en.ts, key for key. Drafted by Claude during the
// build; a Greek speaking member checks it (docs/translations/greek-review.md) before go live.
// Wording rules (AC-10): plain everyday Greek, the polite plural, never the familiar singular;
// "διανομέας" for rider, "κατάστημα" for restaurant, "συνεταιρισμός" for the co-op; no Greeklish.
// Times use the `clock` formatter (24 hour, Athens), never the raw ISO text the English record keeps; money
// uses `money` ("3,50 €") and a distance `decimal` ("1,2"), where the English record keeps raw cents.
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
      ACCEPTED_TOGETHER_AUTOMATICALLY:
        'Ο διανομέας {{courierId}} αποδέχτηκε την παραγγελία {{deliveryId}}, που προτάθηκε μαζί με την παραγγελία {{otherDeliveryId}} (αυτόματη αποδοχή)',
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
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}}: αναμονή {{minutes}} λεπτών με {{centsPerMinute, money}} το λεπτό· αναμονή {{waitOf}}',
      COURIER_PAID_FOR_WAIT_NOTE:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}}: {{note}}· αναμονή {{waitOf}}',

      CANCELED_BY_PARTNER:
        'Η παραγγελία {{deliveryId}} ακυρώθηκε από το κατάστημα {{partnerId}} (ακύρωση από: $t(server.enum.cancelledBy.{{cancelledBy}}))',
      CANCELED_BY_ADMIN:
        'Ο διαχειριστής ακύρωσε την παραγγελία (ακύρωση από: $t(server.enum.cancelledBy.{{cancelledBy}}))',
      CANCELLATION_PAY:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}} με τον κανόνα {{policy}} για ακύρωση από $t(server.enum.cancelledBy.{{cancelledBy}})',
      FOOD_RETURNED: 'Το φαγητό επιστράφηκε στο κατάστημα',

      ADMIN_NOTE: '{{note}}',
      RIDER_NOTE: '{{note}}',

      REASSIGNED:
        'Ο διαχειριστής μετέφερε την παραγγελία από τον διανομέα {{droppedCourierId}} στον διανομέα {{newCourierId}}· ο κανόνας πληρωμής {{policy}} δίνει {{amount, money}} στον διανομέα που την έχασε (αποζημίωση {{awardId}})',
      REASSIGNED_WITH_NOTE:
        'Ο διαχειριστής μετέφερε την παραγγελία από τον διανομέα {{droppedCourierId}} στον διανομέα {{newCourierId}}· ο κανόνας πληρωμής {{policy}} δίνει {{amount, money}} στον διανομέα που την έχασε: {{note}} (αποζημίωση {{awardId}})',

      DISPATCH_STOP_RETURNED: 'Παύση διανομών ($t(server.enum.dispatchStopReason.{{reason}}))',

      REMOVAL_REQUESTED: 'Αίτημα αποδέσμευσης: {{labelEl}}',
      REMOVAL_WITHDRAWN: 'Το αίτημα αποδέσμευσης αποσύρθηκε: {{labelEl}}',
      REMOVAL_DECLINED: 'Το αίτημα αποδέσμευσης απορρίφθηκε: {{labelEl}}',
      REMOVAL_APPROVED: 'Η αποδέσμευση εγκρίθηκε: {{labelEl}}',
      REMOVAL_APPROVED_AFTER_PICKUP: 'Η αποδέσμευση εγκρίθηκε μετά την παραλαβή, η παραγγελία ακυρώθηκε: {{labelEl}}',
      REMOVAL_CANCELLED_AFTER_PICKUP: 'Ακυρώθηκε επειδή εγκρίθηκε αποδέσμευση μετά την παραλαβή: {{labelEl}}',
      REMOVAL_APPROVAL_FAILED: 'Η έγκριση δεν έγινε: η παραγγελία είχε ήδη αλλάξει ({{labelEl}})',
      COURIER_PAID_FOR_REMOVAL:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}} με τον κανόνα {{policy}}: {{labelEl}}· αποδέσμευση {{requestId}}',
      PARTNER_CHARGED_FOR_REMOVAL:
        'Χρέωση καταστήματος {{amount, money}}: {{labelEl}}· αποδέσμευση {{requestId}}',
      COURIER_PAID_FOR_RETURN_TRIP:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}} για τη διαδρομή επιστροφής στο κατάστημα',

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
        'Χρέωση καταστήματος {{amount, money}}, η αμοιβή του διανομέα αυτού του σκέλους, για τον διαχωρισμό {{splitId}}',
      SPLIT_LEG_CHARGE_VOIDED:
        'Η χρέωση του καταστήματος για το σκέλος, {{amount, money}}, ακυρώθηκε: κανένας διανομέας δεν πήρε αυτό το σκέλος',
      COURIER_PAID_FOR_SPLIT_WAIT:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}}: αναμονή {{minutes}} λεπτών όσο ο συντονισμός χώριζε την παραγγελία, με {{centsPerMinute, money}} το λεπτό· διαχωρισμός {{splitId}}',

      REVIEW_REQUESTED: 'Αίτημα επανεξέτασης: $t(server.enum.reviewTopic.{{topic}})',
      REVIEW_ANSWERED: 'Απάντηση στην επανεξέταση: $t(server.enum.reviewOutcome.{{outcome}})',
      COURIER_PAID_FOR_REVIEW:
        'Ο διανομέας {{courierId}} πληρώθηκε {{amount, money}} για την επανεξέταση {{reviewId}}',

      DROPOFF_MOVED_BY_RIDER:
        'Ο διανομέας μετακίνησε το σημείο παράδοσης κατά {{metres}} μ., από {{from}} σε {{to}}· $t(server.enum.savedCustomerOutcome.{{outcome}})',
      DROPOFF_MOVED_BY_RESTAURANT:
        'Το κατάστημα μετακίνησε το σημείο παράδοσης κατά {{metres}} μ., από {{from}} σε {{to}}',

      PRODUCT_REPORTED:
        'Αναφορά για $t(server.enum.productReportKind.{{kind}}) ($t(server.enum.productReportSource.{{source}}))',
      PRODUCT_REPORTED_ITEM:
        'Αναφορά για $t(server.enum.productReportKind.{{kind}}): {{itemName}} ($t(server.enum.productReportSource.{{source}}))',
      PRODUCT_REPORT_RESOLVED: 'Η αναφορά επιλύθηκε ($t(server.enum.productReportKind.{{kind}}))',
      ADD_ON_JOINED:
        'Η παραγγελία {{addOnId}} προστέθηκε σε αυτή τη δουλειά ως μία ακόμα παραγγελία στον δρόμο· ο διανομέας {{courierId}} έχει αναλάβει και τις δύο',

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
      ADD_ON_FIGURES: ' (+{{extraKm, decimal}} χλμ., +{{extraMinutes}} λεπτά)',
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
      deliveryIssueReason: {
        WRONG_ADDRESS: 'Λάθος διεύθυνση',
        NO_SIGNAL: 'Χωρίς ίντερνετ, GPS ή σήμα',
        ORDER_HANDED: 'Η παραγγελία δόθηκε στον πελάτη',
        FOOD_NOT_READY: 'Δηλώθηκε έτοιμη αλλά δεν ήταν',
        OTHER: 'Άλλο',
      },
      deliveryStatus: {
        CREATED: 'δημιουργήθηκε',
        ASSIGNING_COURIER: 'αναζήτηση διανομέα',
        ACCEPTED: 'έγινε αποδεκτή',
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

    error: {
      API_KEY_DOES_NOT_WORK: 'Αυτό το κλειδί API δεν λειτουργεί. Ζητήστε νέο από τον συνεταιρισμό.',
      API_KEY_IN_URL: 'Στείλτε το κλειδί API στην κεφαλίδα x-api-key, όχι στη διεύθυνση.',
      CREDENTIALS_CHANGED: 'Ο κωδικός πρόσβασης ή το email σύνδεσής σας άλλαξε. Συνδεθείτε ξανά.',
      RESET_BY_EMAIL_OFF:
        'Η επαναφορά μέσω email δεν έχει ρυθμιστεί ακόμα. Ζητήστε από τον συνεταιρισμό να ορίσει νέο κωδικό.',
      RESET_CODE_REFUSED: 'Ο κωδικός είναι λάθος ή έχει λήξει. Ζητήστε νέο.',
      RESET_PASSWORD_LENGTH: 'Ο νέος κωδικός πρόσβασης πρέπει να έχει 8 έως 72 χαρακτήρες.',
      COMPLAINT_PHOTO_TYPE: 'Η φωτογραφία πρέπει να είναι εικόνα JPEG ή PNG.',
      COMPLAINT_PHOTO_UNREADABLE: 'Η φωτογραφία δεν διαβάστηκε. Δοκιμάστε μια άλλη.',
      COMPLAINT_OUTCOME_LENGTH: 'Γράψτε την έκβαση με 1 έως 1000 χαρακτήρες.',
      COMPLAINT_REPLY_LENGTH: 'Γράψτε την απάντησή σας με 1 έως 1000 χαρακτήρες.',
      COMPLAINT_TEXT_LENGTH: 'Γράψτε το παράπονο με 1 έως 1000 χαρακτήρες.',
      COMPLAINT_WITHDRAW_REASON_LENGTH: 'Γράψτε γιατί αποσύρεται το παράπονο, με 1 έως 1000 χαρακτήρες.',
      ACCOUNT_HOLDS_JOB: 'Ο διανομέας έχει αναλάβει μια δουλειά. Μεταφέρετέ την πρώτα.',
      ACCOUNT_IN_SOS: 'Ο διανομέας έχει ανοιχτό SOS. Κλείστε το πρώτα.',
      ACCOUNT_IS_ADMIN: 'Αυτός ο λογαριασμός είναι και διαχειριστής. Αφαιρέστε πρώτα τον ρόλο του διαχειριστή.',
      ACCOUNT_ALREADY_DEACTIVATED: 'Ο λογαριασμός του διανομέα είναι ήδη απενεργοποιημένος.',
      ACCOUNT_NOT_DEACTIVATED: 'Ο λογαριασμός του διανομέα δεν είναι απενεργοποιημένος.',
      ACCOUNT_JUST_OFFERED: 'Μόλις προτάθηκε δουλειά σε αυτόν τον διανομέα. Δοκιμάστε ξανά σε λίγο.',
      ACCOUNT_WRONG_CURRENT_PASSWORD: 'Ο τρέχων κωδικός πρόσβασης δεν είναι σωστός.',
      ACCOUNT_SAME_PASSWORD: 'Ο νέος κωδικός πρόσβασης πρέπει να διαφέρει από τον τρέχοντα.',
      ACCOUNT_TOO_MANY_TRIES: 'Πάρα πολλές λάθος προσπάθειες. Δοκιμάστε ξανά σε μία ώρα.',
      RIDER_DEACTIVATED: 'Ο λογαριασμός του διανομέα είναι απενεργοποιημένος.',
      OFFLINE_POSITION_REFUSED: 'Είστε εκτός σύνδεσης, οπότε δεν αποθηκεύεται θέση',
      ADD_ON_NOT_AUTOMATIC:
        'Μια επιπλέον παραγγελία στον δρόμο δεν γίνεται ποτέ αποδεκτή αυτόματα. Ανοίξτε την και επιλέξτε.',
      LEG_LABELS_LOCKED:
        'Αυτή η παραγγελία είναι σκέλος μιας μεγαλύτερης: ο κωδικός παραγγελίας και οι αριθμοί σκελών δεν αλλάζουν.',
      LEG_REFERENCE_REQUIRED: 'Ένα σκέλος χρειάζεται orderReference: αυτό συνδέει τα σκέλη μιας παραγγελίας.',
      SIBLING_LEG_HELD:
        'Ο διανομέας μεταφέρει ήδη άλλο σκέλος της ίδιας παραγγελίας. Κάθε σκέλος πηγαίνει σε διαφορετικό διανομέα.',
      READY_ALREADY_READY: 'Το φαγητό έχει ήδη σημειωθεί έτοιμο.',
      READY_PICKED_UP: 'Ο διανομέας έχει ήδη παραλάβει αυτή την παραγγελία.',
      READY_ORDER_ENDED: 'Αυτή η παραγγελία έχει ολοκληρωθεί.',
      READY_TOO_LATE: 'Η ώρα ετοιμότητας μπορεί να είναι έως 3 ώρες μετά την παραγγελία.',
      READY_CHANGED: 'Η ώρα ετοιμότητας μόλις άλλαξε. Ελέγξτε ξανά.',
      USUAL_PREP_MINUTES: 'Ο συνηθισμένος χρόνος προετοιμασίας είναι ακέραιος αριθμός λεπτών από 0 έως 90.',
      STACK_CHANGED:
        'Μία από τις δύο παραγγελίες άλλαξε πριν φτάσει η απάντησή σας, οπότε δεν έγινε αποδοχή. Ελέγξτε ξανά τις προτάσεις σας.',
      THIRD_DELIVERY_REFUSED:
        'Ο διανομέας έχει ήδη δύο παραγγελίες. Τρίτη δεν επιτρέπεται ποτέ· μεταφέρετε πρώτα μία από αυτές.',
      PERSONAL_DATA_WARNING:
        'Οι σημειώσεις περιγράφουν το μέρος, ποτέ το πρόσωπο. Αυτό μοιάζει να περιέχει όνομα, τηλέφωνο ή email.',
      INVALID_PHONE: 'Αυτός ο αριθμός τηλεφώνου δεν φαίνεται σωστός',
      OUTSIDE_SERVICE_AREA: 'Αυτή η διεύθυνση είναι εκτός της περιοχής που εξυπηρετεί ο συνεταιρισμός',
      SOS_NOT_FOUND: 'Αυτό το SOS δεν βρέθηκε.',
      SOS_DELIVERY_NOT_YOURS: 'Αυτή η παραγγελία δεν είναι δική σας.',
      COURIER_IN_SOS: 'Ο διανομέας έχει ενεργό SOS και δεν μπορεί να πάρει παραγγελία μέχρι να λήξει.',
      SPLIT_NOT_AT_PICKUP: 'Μπορείτε να ζητήσετε διαχωρισμό μόνο στο κατάστημα, πριν παραλάβετε την παραγγελία.',
      SPLIT_ALREADY_OPEN: 'Αυτή η παραγγελία έχει ήδη αίτημα διαχωρισμού που περιμένει τον συντονισμό.',
      SPLIT_NOT_OPEN: 'Αυτό το αίτημα διαχωρισμού έχει ήδη απαντηθεί ή κλείσει.',
      SPLIT_NO_OPEN_REQUEST: 'Αυτή η παραγγελία δεν έχει αίτημα διαχωρισμού σε αναμονή.',
      SPLIT_TOO_MANY_LEGS: 'Μια παραγγελία έχει το πολύ 4 σκέλη συνολικά.',
      SPLIT_PICKUP_BLOCKED: 'Ο συντονισμός χωρίζει αυτή την παραγγελία. Περιμένετε την απάντηση πριν την παραλάβετε.',
      SPLIT_LEAVE_WAIT_BLOCKED:
        'Ο συντονισμός χωρίζει αυτή την παραγγελία. Περιμένετε την απάντηση ή φύγετε μόλις περάσει το όριο του διαχωρισμού.',
      SPLIT_DELIVERY_CHANGED: 'Η παραγγελία άλλαξε πριν γίνει ο διαχωρισμός. Ελέγξτε ξανά.',
      BOX_SIZE_LOCKED: 'Το μέγεθος δεν αλλάζει πια: η παραγγελία έχει ήδη προταθεί σε διανομέα.',
      COURIER_EMAIL_TAKEN: 'Αυτό το email χρησιμοποιείται ήδη από άλλο λογαριασμό.',
      COURIER_PHONE_TAKEN: 'Αυτό το τηλέφωνο χρησιμοποιείται ήδη από άλλον διανομέα.',
      OFFER_HAS_ENDED: 'Αυτή η πρόταση έχει λήξει',
      SAVED_CUSTOMER_PHONE_CLASH: 'Άλλος αποθηκευμένος πελάτης έχει αυτό το τηλέφωνο',
      MIXED_CREDENTIALS: 'Στείλτε είτε κλειδί API είτε διακριτικό σύνδεσης, όχι και τα δύο',
      PIN_ALREADY_MOVED: 'Το σημείο έχει ήδη μετακινηθεί για αυτή την παραγγελία',
      PIN_ALREADY_THERE: 'Το σημείο είναι ήδη εκεί που βρίσκεστε',
      PIN_WRONG_STATUS: 'Το σημείο μετακινείται μόνο ανάμεσα στην παραλαβή και την παράδοση',
      HAND_BACK_AT_RESTAURANT:
        'Είστε στο κατάστημα. Αναφέρετε πρόβλημα ή καλέστε τον συντονισμό για να επιστρέψετε αυτή την παραγγελία.',
      ORDER_CHANGED: 'Η παραγγελία άλλαξε. Ελέγξτε τις δουλειές σας.',
      LEAVE_NOT_WAITING: 'Μπορείτε να φύγετε μόνο όσο περιμένετε στο κατάστημα.',
      ROUTE_UNAVAILABLE: 'Η διαδρομή δεν μπορεί να σχεδιαστεί αυτή τη στιγμή.',
      ROAD_DISTANCES_UNAVAILABLE:
        'Οι οδικές αποστάσεις δεν είναι διαθέσιμες αυτή τη στιγμή, οπότε δεν μπορεί να υπολογιστεί τιμή. Δοκιμάστε ξανά σε ένα λεπτό.',
      REMOVAL_ORDER_CHANGED: 'Η παραγγελία άλλαξε όσο αποφασίζατε. Δείτε ξανά τη γραμμή.',
      REMOVAL_ALREADY_OPEN: 'Υπάρχει ήδη ανοιχτό αίτημα αποδέσμευσης για αυτή την παραγγελία.',
      REMOVAL_BOARD_STALE: 'Η παραγγελία προχώρησε από τότε που φορτώθηκε ο πίνακας. Ανανεώστε και δοκιμάστε ξανά.',
      REMOVAL_LAST_REASON: 'Τουλάχιστον ένας λόγος πρέπει να μείνει στη λίστα.',
      REMOVAL_NOTE_REQUIRED: 'Αυτός ο λόγος χρειάζεται σημείωση. Γράψτε τι συνέβη.',
      REMOVAL_REASON_GONE: 'Αυτός ο λόγος δεν είναι πια στη λίστα. Επιλέξτε άλλον.',
      REMOVAL_REQUEST_NOT_OPEN: 'Αυτό το αίτημα έχει ήδη απαντηθεί ή αποσυρθεί.',
      REVIEW_ANSWER_LENGTH: 'Γράψτε την αιτιολογία της απάντησης, με 1 έως 2000 χαρακτήρες.',
      REVIEW_CORRECTION_NOT_ALLOWED:
        'Διόρθωση αμοιβής προστίθεται μόνο όταν η απάντηση είναι «άλλαξε» και το αίτημα αφορά παραγγελία.',
      REVIEW_NOTE_LENGTH: 'Γράψτε τι θέλετε να εξεταστεί ξανά, με 1 έως 1000 χαρακτήρες.',
      REVIEW_NOT_FOUND: 'Το αίτημα επανεξέτασης δεν βρέθηκε',
      REVIEW_NOT_OPEN: 'Αυτό το αίτημα επανεξέτασης έχει ήδη απαντηθεί ή αποσυρθεί.',
      SHIFTS_OFF: 'Οι βάρδιες είναι απενεργοποιημένες.',
      SHIFT_FULL: 'Αυτή η βάρδια μόλις γέμισε.',
      SHIFT_STARTED: 'Αυτή η βάρδια έχει ήδη ξεκινήσει.',
      SHIFT_OVERLAP: 'Έχετε ήδη βάρδια εκείνη την ώρα.',
      SHIFT_ALREADY_BOOKED: 'Έχετε ήδη κλείσει αυτή τη βάρδια.',
      SHIFT_NOT_YOURS: 'Αυτή η κράτηση δεν είναι πια δική σας για να την αλλάξετε.',
      SHIFT_SWAP_JUST_TAKEN: 'Αυτή η ανταλλαγή μόλις αναλήφθηκε.',
      SHIFT_OWN_SWAP: 'Δεν μπορείτε να πάρετε τη δική σας ανταλλαγή.',
      SHIFT_SLOT_REMOVED: 'Αυτή η θέση αφαιρέθηκε. Μπορείτε ακόμα να την αφήσετε.',
      SHIFT_NOT_ON_SCHEDULE: 'Αυτή η βάρδια δεν είναι στο πρόγραμμα.',
      SHIFT_NO_OPEN_SWAP: 'Δεν υπάρχει ανοιχτή ανταλλαγή εδώ.',
      OFFLINE_ITEM_MISSING: 'Αυτό το στοιχείο δεν είναι στη λίστα.',
      OFFLINE_ITEM_ALREADY_FOLLOWED_UP: 'Αυτό το στοιχείο έχει ήδη διεκπεραιωθεί.',
      BOX_OVER_CAPACITY:
        'Αυτό θα γέμιζε το κουτί του διανομέα πάνω από το όριο: μεταφέρει {{heldUnits}} από {{boxUnits}} μονάδες και αυτή η παραγγελία παίρνει {{deliveryUnits}}. Επιβεβαιώστε για να την αναθέσετε παρ’ όλα αυτά.',
      LEAVE_WAIT_TOO_SOON:
        'Μπορείτε να φύγετε {{minutes}} λεπτά μετά την ώρα που είχε υποσχεθεί το κατάστημα, ή μετά την άφιξή σας αν ήταν αργότερα.',
      SPLIT_LEAVE_TOO_SOON: 'Μπορείτε να φύγετε αν περάσουν {{minutes}} λεπτά χωρίς απάντηση από τον συντονισμό.',
      SHIFT_DROP_TOO_LATE:
        'Δεν μπορείτε πια να αποδεσμευτείτε από αυτή τη βάρδια. Μπορούσατε έως τις {{until, when}}· μπορείτε ακόμα να τη διαθέσετε για ανταλλαγή.',
      LEG_TAKEN: 'Το σκέλος {{legNumber}} από {{legCount}} αυτής της παραγγελίας έχει ήδη σταλεί.',
      LEG_COUNT_MISMATCH:
        'Αυτή η παραγγελία στάλθηκε σε {{sentCount}} σκέλη· το σκέλος {{legNumber}} από {{legCount}} δεν ταιριάζει.',
      PARTNER_DISABLED: 'Ο συνεταιρισμός έχει απενεργοποιήσει αυτό το κατάστημα: {{reason}}',
      PARTNER_DISABLED_NO_REASON: 'Ο συνεταιρισμός έχει απενεργοποιήσει αυτό το κατάστημα, χωρίς αιτιολογία',
      PARTNER_PAUSED: 'Οι παραγγελίες έχουν παυθεί έως τις {{until, clock}}.',
      DISPATCH_STOPPED_RESTAURANT: 'Οι διανομές έχουν σταματήσει έως τις {{until, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RESTAURANT_OPEN: 'Οι διανομές έχουν σταματήσει μέχρι να ξαναρχίσουν ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_ADMIN: 'Οι διανομές έχουν σταματήσει έως τις {{until, when}}.',
      DISPATCH_STOPPED_ADMIN_OPEN: 'Οι διανομές έχουν σταματήσει μέχρι να ξαναρχίσουν.',
    },

    notice: {
      DISPATCH_STOPPED_RIDER: 'Οι διανομές έχουν σταματήσει έως τις {{until, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RIDER_OPEN: 'Οι διανομές έχουν σταματήσει μέχρι να τις ξεκινήσει ξανά ο συνεταιρισμός ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RESTAURANT: 'Οι διανομές έχουν σταματήσει έως τις {{until, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPPED_RESTAURANT_OPEN: 'Οι διανομές έχουν σταματήσει μέχρι να ξαναρχίσουν ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RIDER:
        'Οι διανομές σταματούν {{startsAt, day}} {{startsAt, clock}} έως {{endsAt, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RIDER_SAME_DAY:
        'Οι διανομές σταματούν {{startsAt, day}} {{startsAt, clock}} έως {{endsAt, clock}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RIDER_OPEN:
        'Οι διανομές σταματούν {{startsAt, day}} από τις {{startsAt, clock}} μέχρι να ξαναρχίσουν ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RESTAURANT:
        'Οι διανομές σταματούν {{startsAt, day}} {{startsAt, clock}} έως {{endsAt, when}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RESTAURANT_SAME_DAY:
        'Οι διανομές σταματούν {{startsAt, day}} {{startsAt, clock}} έως {{endsAt, clock}} ($t(server.enum.dispatchStopReason.{{reason}})).',
      DISPATCH_STOPS_RESTAURANT_OPEN:
        'Οι διανομές σταματούν {{startsAt, day}} από τις {{startsAt, clock}} μέχρι να ξαναρχίσουν ($t(server.enum.dispatchStopReason.{{reason}})).',
    },

    board: {
      NOT_OFFERED_YET: 'Δεν έχει προταθεί ακόμα, το φαγητό είναι έτοιμο στις {{readyAt, clock}}',
      NO_COURIER_ACCEPTED: 'Κανένας διανομέας δεν την αποδέχτηκε',
      OFFERED: '{{rider}}: προτάθηκε, χωρίς απάντηση',
      OFFERED_PAIR: '{{rider}}: προτάθηκε μαζί με την παραγγελία {{otherOrder}}, χωρίς απάντηση',
      OFFERED_ADD_ON:
        '{{rider}}: προτάθηκε ως μία ακόμα παραγγελία στον δρόμο, μαζί με την παραγγελία {{job}} (+{{extraKm, decimal}} χλμ., +{{extraMinutes}} λεπτά), χωρίς απάντηση',
      OFFERED_ADD_ON_NO_FIGURES:
        '{{rider}}: προτάθηκε ως μία ακόμα παραγγελία στον δρόμο, μαζί με την παραγγελία {{job}}, χωρίς απάντηση',
      RESTAURANT_LATE:
        '{{rider}}: περιμένει στο κατάστημα {{restaurant}}, το φαγητό έπρεπε να είναι έτοιμο στις {{promisedAt, clock}}',
      RIDER_REPORT: '{{rider}}: αναφορά, $t(server.enum.deliveryIssueReason.{{reason}})',
      REMOVAL_PAID: '{{rider}}: ζητά αποδέσμευση από αυτή την παραγγελία, {{labelEl}} (με αμοιβή)',
      REMOVAL_NOT_PAID: '{{rider}}: ζητά αποδέσμευση από αυτή την παραγγελία, {{labelEl}} (χωρίς αμοιβή)',
      REMOVAL_PAID_PICKED_UP:
        '{{rider}}: ζητά αποδέσμευση από αυτή την παραγγελία, {{labelEl}} (με αμοιβή). Το φαγητό έχει ήδη παραληφθεί: η έγκριση ακυρώνει την παραγγελία.',
      REMOVAL_NOT_PAID_PICKED_UP:
        '{{rider}}: ζητά αποδέσμευση από αυτή την παραγγελία, {{labelEl}} (χωρίς αμοιβή). Το φαγητό έχει ήδη παραληφθεί: η έγκριση ακυρώνει την παραγγελία.',
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
