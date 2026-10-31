export interface IDeliveryMarkAsPickedUp {
  note?: string
  // How long before sending the rider tapped this step, in milliseconds (spec 0009).
  tapAgeMs?: number
}
