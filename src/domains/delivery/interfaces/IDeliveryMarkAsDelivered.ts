export interface IDeliveryMarkAsDelivered {
  note?: string
  // How long before sending the rider tapped this step, in milliseconds (spec 0009).
  tapAgeMs?: number
  imageData?: Buffer
  imageName?: string
  imageType?: string
}
