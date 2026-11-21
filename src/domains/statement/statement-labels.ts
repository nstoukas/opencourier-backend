import { EnumCourierCompensationReason } from '@prisma/types'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'

// Spec 0050 (AC-6): the statement's words in Greek (the default) and English. They live here until row 47
// moves them into the shared translations (spec 0054).

export type StatementLang = 'el' | 'en'

export const STATEMENT_LANGS: StatementLang[] = ['el', 'en']

export interface StatementLabels {
  title: string
  rider: string
  month: string
  madeAt: string
  columns: {
    date: string
    restaurant: string
    area: string
    km: string
    minutes: string
    end: string
    deliveryPay: string
    tips: string
    waiting: string
    cancellation: string
    removal: string
    returnTrip: string
    review: string
    other: string
    total: string
    note: string
  }
  noJobs: string
  unlinkedTitle: string
  unlinkedLine: (date: string) => string
  totalsTitle: string
  totals: {
    money: string
    dropOffs: string
    timeWorked: string
    jobTime: string
    paidWaiting: string
    unpaidTime: string
    perHour: string
    perPaidKm: string
    paidKm: string
  }
  notRecorded: string
  notRecordedNote: string
  addedLater: (monthEnd: string, amount: string) => string
  footer: string
  // Cross check 8: a compensation type's label, for the Other column's note.
  reasons: Record<EnumCourierCompensationReason, string>
  // How a job ended; DELIVERED when it ended in the rider's drop off (no end label).
  ends: Record<EnumJobEndLabel | 'DELIVERED', string>
}

export const STATEMENT_LABELS: Record<StatementLang, StatementLabels> = {
  el: {
    title: 'Μηνιαία κατάσταση',
    rider: 'Διανομέας',
    month: 'Μήνας',
    madeAt: 'Συντάχθηκε',
    columns: {
      date: 'Ημερομηνία',
      restaurant: 'Κατάστημα',
      area: 'Περιοχή παράδοσης',
      km: 'Πληρωμένα χλμ',
      minutes: 'Λεπτά',
      end: 'Κατάληξη',
      deliveryPay: 'Αμοιβή διανομής',
      tips: 'Φιλοδωρήματα',
      waiting: 'Αναμονή',
      cancellation: 'Ακύρωση',
      removal: 'Αφαίρεση',
      returnTrip: 'Επιστροφή',
      review: 'Διόρθωση',
      other: 'Άλλο',
      total: 'Σύνολο',
      note: 'Σημείωση',
    },
    noJobs: 'Καμία διανομή αυτόν τον μήνα.',
    unlinkedTitle: 'Ποσά χωρίς διανομή',
    unlinkedLine: (date) => `Ποσό χωρίς διανομή, ${date}`,
    totalsTitle: 'Σύνολα μήνα',
    totals: {
      money: 'Χρήματα',
      dropOffs: 'Παραδόσεις',
      timeWorked: 'Χρόνος εργασίας',
      jobTime: 'Χρόνος σε διανομή',
      paidWaiting: 'Πληρωμένη αναμονή',
      unpaidTime: 'Απλήρωτος χρόνος',
      perHour: 'Ανά ώρα εργασίας',
      perPaidKm: 'Ανά πληρωμένο χλμ',
      paidKm: 'Πληρωμένα χλμ',
    },
    notRecorded: 'δεν καταγράφηκε',
    notRecordedNote: 'Ο χρόνος εργασίας δεν καταγραφόταν ακόμη για όλο τον μήνα, οπότε οι ώρες δεν εμφανίζονται.',
    addedLater: (monthEnd, amount) => `Προστέθηκε μετά τις ${monthEnd}: ${amount}`,
    footer: 'Το αρχείο της εργασίας σας. Δεν είναι τιμολόγιο.',
    reasons: {
      REASSIGNMENT: 'Αλλαγή διανομέα',
      CANCELLATION: 'Ακύρωση',
      WAITING: 'Αναμονή',
      REMOVAL: 'Αφαίρεση',
      RETURN_TRIP: 'Επιστροφή',
      REVIEW: 'Διόρθωση',
    },
    ends: {
      DELIVERED: 'Παραδόθηκε',
      CANCELLED_AFTER_PICKUP: 'Ακυρώθηκε μετά την παραλαβή',
      CANCELLED: 'Ακυρώθηκε',
      REMOVED: 'Αφαιρέθηκε',
      HANDED_BACK: 'Επιστράφηκε',
      REASSIGNED: 'Άλλαξε διανομέας',
      FAILED: 'Απέτυχε',
      ENDED: 'Έληξε',
      IN_PROGRESS: 'Σε εξέλιξη',
    },
  },
  en: {
    title: 'Monthly statement',
    rider: 'Rider',
    month: 'Month',
    madeAt: 'Made at',
    columns: {
      date: 'Date',
      restaurant: 'Restaurant',
      area: 'Drop off area',
      km: 'Paid km',
      minutes: 'Minutes',
      end: 'Ended',
      deliveryPay: 'Delivery pay',
      tips: 'Tips',
      waiting: 'Waiting',
      cancellation: 'Cancellation',
      removal: 'Removal',
      returnTrip: 'Return trip',
      review: 'Review correction',
      other: 'Other',
      total: 'Total',
      note: 'Note',
    },
    noJobs: 'No jobs this month.',
    unlinkedTitle: 'Money not linked to a job',
    unlinkedLine: (date) => `Money not linked to a job, ${date}`,
    totalsTitle: 'Month totals',
    totals: {
      money: 'Money',
      dropOffs: 'Drop offs',
      timeWorked: 'Time worked',
      jobTime: 'Job time',
      paidWaiting: 'Paid waiting',
      unpaidTime: 'Unpaid time',
      perHour: 'Per hour worked',
      perPaidKm: 'Per paid km',
      paidKm: 'Paid km',
    },
    notRecorded: 'not recorded',
    notRecordedNote: 'Time worked was not yet recorded for the whole month, so the hours are not shown.',
    addedLater: (monthEnd, amount) => `Added after ${monthEnd}: ${amount}`,
    footer: 'Your record of work. It is not an invoice.',
    reasons: {
      REASSIGNMENT: 'Reassignment',
      CANCELLATION: 'Cancellation',
      WAITING: 'Waiting',
      REMOVAL: 'Removal',
      RETURN_TRIP: 'Return trip',
      REVIEW: 'Review correction',
    },
    ends: {
      DELIVERED: 'Delivered',
      CANCELLED_AFTER_PICKUP: 'Cancelled after pickup',
      CANCELLED: 'Cancelled',
      REMOVED: 'Removed',
      HANDED_BACK: 'Handed back',
      REASSIGNED: 'Reassigned',
      FAILED: 'Failed',
      ENDED: 'Ended',
      IN_PROGRESS: 'In progress',
    },
  },
}

// Amounts in the language's form: "12,50 €" in Greek, "€12.50" in English; a code for any other currency.
export function formatMoney(cents: number, currencyCode: string, lang: StatementLang): string {
  const value = (Math.abs(cents) / 100).toFixed(2)
  const sign = cents < 0 ? '-' : ''
  const number = lang === 'el' ? value.replace('.', ',') : value
  if (currencyCode === 'EUR') return lang === 'el' ? `${sign}${number} €` : `${sign}€${number}`
  return `${sign}${number} ${currencyCode}`
}

// Euros with the language's decimal mark and no symbol, for the CSV (AC-5).
export function formatAmount(cents: number, lang: StatementLang): string {
  const value = (cents / 100).toFixed(2)
  return lang === 'el' ? value.replace('.', ',') : value
}

export function langOf(value: unknown): StatementLang {
  return value === 'en' ? 'en' : 'el'
}
