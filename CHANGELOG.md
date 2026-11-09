# Changelog — co-op fork of `opencourier-backend`

This fork adapts [Princeton-HCI/opencourier-backend](https://github.com/Princeton-HCI/opencourier-backend)
for a Greek workers' cooperative (Συνεταιρισμός Εργαζομένων, Law 4430/2016) delivering
by moped in Volos. Restaurants pay a flat subscription; couriers are paid piece-rate per
delivery, so pricing and matching are the pay structure.

Everything below sits on top of upstream `main` on the branch `chore/aiflow-pipeline`
(192 commits, 25 July to 2 November 2026). Each entry names its commit, and the commit
message has the full reasoning and verification notes.

Scope row 22 (offers timed to food readiness, spec 0031) was built on the branch `feat/offer-timing` and merged in on 9 November, behind `offerTimingEnabled`, off by default. With it on, an offer waits until the chosen rider needs to leave to arrive about when the food is ready (`foodReadyAt` or `readyAt`, less OSRM road time, less `offerLeadMinutes`), the nearest matcher compares the nearest `offerTimingCandidates` riders by road time, and the `OFFERED` event says what it was based on. Food ready brings a held delivery forward. With it off, offers are unchanged. With it the suite is at **3506 passing tests**.

Scope row 25 (the restaurant wait record, spec 0030) was built on the branch `feat/wait-record` and merged in on 9 November. `GET admin/v1/partner/:id/wait-record` and `GET partner/v1/partner/wait-record` give a restaurant's average rider wait past its ready time, late share and median real prep time over 7, 30 or 90 days, naming no rider.

Scope row 34 (restaurant busy mode and pause, spec 0029) was built on the branch `feat/busy-pause` and merged in on 9 November. A restaurant can add 5 to 30 minutes to every new order's ready time, or pause ordering for 15 minutes to 2 hours, and an admin can disable it with a reason. A paused or disabled restaurant's order and quote answer 409 with a sentence. Each change is one `PartnerAvailabilityChange` row, and busy mode's minutes are in that order's `CREATED` event. Nothing here changes pay or matching. Reviewed by Fable and agy. With it the suite is at **3348 passing tests**; typecheck is clean and lint is unchanged.

Scope row 21 (restaurant ready signals, spec 0023) was built on the branch `feat/ready-signals` and merged in on 9 November. Every order carries a `readyAt` (the restaurant's pick, or now plus `Partner.usualPrepMinutes`), a restaurant can delay it or mark the food ready, each is a `DeliveryEvent`, and the rider holding the job is told at once. Nothing here changes pay, price, matching or offer timing. Reviewed by Fable and agy. With it the suite is at **3215 passing tests**; typecheck is clean and lint is unchanged.

Scope row 102 (a partner edit moves only its own drop off point) was built on the branch `fix/partner-edit-own-dropoff` and merged in on 9 November. A partner's `POST deliveries/:id` used to rewrite the shared `Location` row, moving every other delivery and quote on it; a moved point now gets a row of its own. After agy's cross family review, the drift limit is measured from the quote's point rather than the last edit, so many small moves cannot walk the door away from what the rider is paid for, and a restaurant's move is recorded as a `DROPOFF_POINT_CORRECTED` event (actor `PARTNER`). With it the suite is at **3008 passing tests**; typecheck is clean and lint is unchanged.

Scope row 49 (zero is a valid value for every co-op setting) was built on the branch
`fix/zero-valid-settings` and merged into this one on 30 September. With it the suite is at
**292 passing tests**; typecheck is clean and lint is unchanged.

Scope row 51 (the delivery fee as a base fee plus a per km fee, spec 0001) was built on the branch
`feat/base-fee-per-km` and merged in on 1 October. With it the suite is at **315 passing tests**; typecheck
is clean and lint is unchanged.

Scope row 56 (an empty setting is refused, not saved as 0) was built on the branch
`fix/refuse-empty-settings` and merged in on 1 October. With it the suite is at **373 passing tests**;
typecheck is clean and lint is unchanged.

Scope row 62 (busy riders get no second offer) was built on the branch
`fix/busy-riders-no-second-offer` and merged in on 25 October (`3ae819c`). With it the suite is at
**381 passing tests**; typecheck is clean and lint is unchanged.

Scope row 57's backend half (courier sends go over Socket.IO again) was built on the branch
`fix/socketio-dispatcher` and merged in on 25 October (`cefdf85`). With it the suite is at
**401 passing tests**; typecheck is clean and lint is unchanged.

Scope row 61 (offers end on time, set by the co-op, spec 0002) was built on the branch
`feat/offer-expiry` and merged in on 26 October, together with its mobile and adminweb halves.
With it the suite is at **572 passing tests**; typecheck is clean and lint is unchanged.

Scope row 58's backend half (offers pushed to riders' Android phones, spec 0003) was built on the
branch `feat/android-offer-push` and merged in on 26 October, together with its mobile half. With
it the suite is at **658 passing tests**; typecheck is clean and lint is unchanged. Push ships
off: it runs only once the co-op's own Firebase project exists (scope row 1).

Scope row 26's backend half (saved customers for restaurants, spec 0005) was built on the branch
`feat/saved-customers` and merged in on 26 October, together with its request-web and adminweb
halves. With it the suite is at **786 passing tests**; typecheck is clean and lint is unchanged.

On 2 November the stack built from 27 October to 2 November was merged in, in this order:
row 66 (rider issue reports), 20 (tap time), 96 and 97 (admin list filters), 16 (admin issued
riders), 29 (dispatch stop), 33 and 72 (customer phone and contact), 32 (pay when a job is
cancelled), 31 (floor, doorbell and pin), 28 (order history), 69 (map route), 70 (offer trip)
and 71 (auto accept and the hand back), then the separate branch `fix/refresh-tokens-dto`
(decision 66.12, `c6d2cac`). With them the suite is at **1783 passing tests**; typecheck is
clean and lint is unchanged. The five GA rows (pay and matching: 20, 16, 29, 32, 71) have their
own entries under Added and in the core changes table; every other row's core change is in the
deviation ledger in the workspace's `memory.md`.

Sibling forks: `opencourier-adminweb`, `opencourier-request-web`, `opencourier-mobile`,
`opencourier-demo-registry`.

---

## Core changes to upstream ("Path A" deviations)

The co-op's rule is to avoid changing the core so upstream upgrades stay possible. These
are the exceptions, each kept additive or as narrow as possible:

| Change | Why | Commit |
| :-- | :-- | :-- |
| `EnumCountryCode` gains `GR`, `CA`, `GB`, `AU`, `MX` | It was US-only, so every Greek address returned a 500. | `b7d84e9` |
| An admin who accepts for the courier already matched to the delivery now accepts it directly | The request went down the offer path and left the delivery stuck. | `2f47613` |
| `Partner.pickupLocationId` plus admin CRUD for restaurants | A restaurant had no address at all. | `1916d0e` |
| `REASSIGNED` event, legal from every ongoing status; new `CourierCompensation` table | Mid-flight reassignment was impossible (the event was silently dropped), and the dropped rider earned nothing. | `3928443` |
| `AuthApiKeyGuard` accepts an already-authenticated request | Valid partner login tokens got a 403, which forced the web client to hold an API key. | `ed3b762` |
| Removed public `POST /api/partner/v1/auth/register` | Anyone could create a partner account with a working API key. | `ed3b762` |
| `GET /api/admin/v1/deliveries/:deliveryId/events` | Delivery events were written but nothing could read them. | `44e0250` |
| `saveDeliveryEvent` takes named options | Two same-typed status arguments were passed in reverse. | `2595d68` |
| `DeliveryQuote` gains required `baseFee` and `distanceFee`; one new migration fills older quotes (base 0, distance = the old price) | A rider's pay must be auditable from the delivery's own quote, and the co-op fee was being counted twice. | `a484994` |
| The Ably dispatcher moved out of `AblyModule` into its own `AblyDispatcherModule`; `SocketIOModule` made global; one helper picks which loads (row 57) | `AblyModule` is global and always imported, and it exported a `WebsocketDispatcher`, so the Ably one won whatever `WEBSOCKET_DISPATCHER` said, and without Ably credentials no offer or status update ever reached the courier app. A bug fix, no new behaviour. | `a579ba7` |
| New `CourierDevice` table and `EnumDevicePlatform` (migration `20261026120000_add_courier_device`), `POST`/`DELETE /api/courier/v1/devices`, `firebase-admin` 13.10.0, `PushNotificationService` filled in, `OfferPushService` called after the socket message at every offer and offer ended send, BullMQ job `offer-insist` (row 58) | Offers reached only an open app over the socket, so a locked phone or a closed app missed work. Additive; no new `DeliveryEvent` type (a push is about an offer already recorded as `OFFERED`). | `cb956aa` |
| New `SavedCustomer` table (migration `20261026150000_add_saved_customer`), partner routes `/api/partner/v1/customers` and admin routes `/api/admin/v1/partners/:partnerId/customers`, setting `savedCustomerRetentionMonths`, BullMQ repeatable job `saved-customer-retention` (`addRepeatableJob` gains a time zone), `libphonenumber-js` 1.13.15; the HTTP logger drops `/customers` query strings; `ResponseFormatMiddleware` passes `conflictingCustomerId`; `isUniqueConstraintError` matches by name and code; `SentryInterceptor` registered with `request: false` (row 26) | Restaurants retyped every customer. Customers' details are personal data, so the row brings a co-op retention setting and a real delete, and keeps those details out of logs, error bodies and error reports. Additive; no `DeliveryEvent` (a saved customer affects neither pay nor assignment). | `f972791` |
| `yarn.lock` tracked (upstream ignored it) | Without it a fresh install resolves `firebase-admin`'s tree afresh and can drift (decision 58.12). No code change. | `6b4d49d` |
| `Delivery.offeredAt` and `offerExpiresAt`, `DeliveryEvent.courierId`, event types `OFFERED`, `OFFER_EXPIRED` and `NO_COURIER_AVAILABLE`, actor `SYSTEM`; two BullMQ jobs; accept and decline written conditionally (migration `20261025120000_add_offer_expiry`, row 61) | Nothing on the server ever ended an offer, so a phone that was off held a delivery forever, and offers and "no rider free" left no event to audit. Additive: Postgres cannot drop enum values, so a revert would leave them unused. | `b364c66` |
| `DeliveryEvent.occurredAt`, backfilled from `createdAt`, with an index (migration `20261031200000_add_delivery_event_occurred_at`); optional `tapAgeMs` on the five courier job step routes; four of those routes read the delivery again after the event; earnings read `occurredAt` (row 20) | A step sent late from a phone with no signal counted on the day it arrived, and a step the state machine dropped answered with the old status. Additive; `createdAt` keeps its meaning. | `e1876d6` |
| `User.credentialsChangedAt` (migration `20261101060000_add_user_credentials_changed_at`); tokens issued before it refused with 401 in `AuthMiddleware` and the socket handshake; admin create rider and rotate password routes; public `POST /api/courier/v1/auth/register` removed (row 16) | An open sign up let strangers into the offer pool, and a new password signed nothing out. Same pattern as the partner sign up removal (`ed3b762`). | `d8d989e` |
| `DispatchStop` table and `EnumDispatchStopReason` (migration `20261101080000_add_dispatch_stop`); event type `RETURNED_TO_WAITING` from ACCEPTED, DISPATCHED and arrived at pickup; a gate in `offerToNextCourier`; a repeatable minute job (row 29) | The Ministry stops delivery in heatwaves, and nothing could stop offers or return a delivery to waiting with nobody. Additive. | `2a17d40` |
| Who cancelled, from which status and when, and the food outcome on `Delivery`; `PartnerCharge` table; `CourierCompensation.cancellationOf` and reason `CANCELLATION`; three event types recorded outside `STATE_MACHINE`; `Delivery.cancellationPayoutPolicy` (migrations `20261101120000_add_cancellation_pay`, `20261101130000_add_cancellation_policy_at_cancel`); the CANCELED write and every status write in `updateDeliveryAndSendNotifications` made conditional; the rider cancel route refuses (row 32) | A cancellation mid job paid the rider nothing and said nothing about the food. Additive except the conditional writes (a cancel that loses a race is now a failed transition) and the rider cancel route. | `1ce975f`, `e542d20`, `1399458` |
| `Delivery.acceptedAt` and `handBackUntil` (migration `20261102150000_add_hand_back`); event type `HANDED_BACK`, recorded by `DeliveryEventService.handBack` outside the switch; setting `handBackSeconds`; optional `{ automatic }` body on the courier accept; courier `POST deliveries/:id/hand-back` (row 71) | A rider could not give back a job taken by a slip or an unwanted auto accept, and an automatic accept looked like a tap on the record. Additive; no pay or charge either way. | `ca392af` |
| Setting `arrivalRadiusMetres` (0 switches detection off, else 20 to 300 m, default 50) on the admin settings and the courier `GET config/contact`; optional `{ detected }` body on the courier `arrived-at-pickup` and `arrived-at-dropoff` routes (row 19) | The rider's app now notices arrival by itself, and members must be able to tell a detected arrival from a tapped one, because waiting pay will start from it. Additive; no schema change; the mark is only the event's message. | `1a6969b` |
| New `SosIncident` and `SosLocationPoint` tables and `EnumSosOutcome` (migration `20261102230000_add_sos_incident`), setting `sosLocationRetentionDays`, BullMQ repeatable job `sos-location-retention`; the matchers' busy rule gains `activeSosCourierSubQuery`; `refuseIfCourierInSos` (409) in the admin ACCEPTED branch, `reassignDelivery` and the rider's own `acceptDelivery`; `offerToNextCourier` skips a matched rider in an SOS, STATIC included (row 73) | A rider in danger had no way to call for help. Their position is shared only while their own SOS is active, in its own tables, read only by the SOS module, and deleted after the co-op's period (value 5's safety exception, decision 73.1). A rider in an SOS is offered and given nothing (73.6, 73.10, 73.11). | `107edc8`, `b5ab24f` |
| `SavedCustomer.pinMovedByRiderAt` (migration `20261103043000_add_saved_customer_pin_moved`), stamped by the rider's pin move, cleared only by a deliberate edit to a different point; on the partner saved customer DTO (row 99) | A restaurant could not see that a rider had corrected a saved customer's pin. Additive, on the co-op's own table (spec 0005). | `fa4005a`, `baa2d00` |
| `Delivery.searchFold` and `Courier.searchFold` (migration `20261103060000_add_search_fold`), written only by the triggers `delivery_search_fold` and `courier_search_fold` through `oc_search_fold` and `oc_search_digits`; the admin list filters match them (row 98) | The admin searches missed Greek names typed without accents, in capitals or with a final sigma. Additive columns; an upstream merge must keep the triggers and functions. | `57b361c`, `1b5c7f8` |
| New `ShiftSlot` and `ShiftSlotChange` tables and `EnumShiftSlotChangeAction` (migration `20261103080000_add_shift_slots`), admin routes `admin/v1/shift-slots`, settings `shiftsEnabled` and `shiftDropNoticeHours` (row 77) | The co-op could not plan shift cover. Additive; nothing outside admin reads them until rows 78 and 79. | `ed57e16` |
| New `ShiftBooking` and `ShiftBookingEvent` tables and two enums (migration `20261103110000_add_shift_bookings`), courier routes `courier/v1/shifts`, `config/contact` gains two fields (row 78) | Riders could not book shifts. Additive; inert while Shifts are off. | `bb897b0` |
| `OrderItem.kind` (`DRINK` or `SIDE`) and its validation on the partner create input (row 103) | Riders most often forget drinks and sides; the restaurant can now mark them. Additive, inside the existing `orderItems` JSON. | `633c56f` |

---

## Added

### An order item may be marked a drink or a side (scope row 103, spec 0028): `633c56f`, `21639e2`
Built on the branch `feat/item-kinds` and merged on 3 November, with the request-web and courier app halves.
- `OrderItem.kind` (`DRINK` or `SIDE`, optional), validated on the partner create route (anything else, null
  included, is a 400 with a sentence). No schema change: it lives in the delivery's `orderItems` JSON.
- Tests by a fresh Claude subagent while agy was out of quota: 2993 pass; put back by hand. Reviewed by Fable.

### Booking shifts (scope row 78, spec 0027): `bb897b0` to `997ef46`
Built on the branch `feat/shift-booking` and merged on 3 November, with the courier app half. This is a core change, listed in the table above.
- **Routes.** `courier/v1/shifts` serves the 14 day schedule (times as Athens text, places taken, open swaps
  without the giver), with book, drop (until the co-op's notice), offer and withdraw a swap, and take a swap.
- **Bookings.** `ShiftBooking` snapshots its occurrence, and `ShiftBookingEvent` records every change.
- **Races.** Book and take lock the rider, then the occurrence. Other changes are conditional writes.
  Checked live with riders racing in parallel: three for one place, then two for one swap; exactly one
  wins each time.
- **The switch.** `config/contact` carries `shiftsEnabled` and `shiftDropNoticeHours`. With Shifts off,
  every route answers 409 "Shifts are off.".
- Tests by a fresh Claude subagent while agy was out of quota: 2979 pass; put back by hand. Reviewed by Fable
  (approve with nits; fixed in `a208e05`).

### Shift slots and caps in admin (scope row 77, spec 0026): `ed57e16` to `8096776`
Built on the branch `feat/shift-slots` and merged on 3 November, with the adminweb half. This is a core change, listed in the table above.
- **Weekly slots.** `ShiftSlot` (Athens wall time, a cap from 1 to 50, soft removal) and `ShiftSlotChange`
  (the record: who, when, before and after, written in the same transaction). The admin routes are
  `admin/v1/shift-slots`. Edits and removals apply only to the slot as it was read (409 otherwise), and a
  no op writes nothing.
- **Two settings.** `shiftsEnabled` (off) and `shiftDropNoticeHours` (12, from 0 to 168). Neither is public;
  nothing outside admin reads them until shift booking (row 78).
- Tests by a fresh Claude subagent while agy was out of quota: 2798 pass; put back by hand. Reviewed by Fable
  (approve with nits; fixed in `a08989f`). Verified live.

### No customer details in an offer (scope row 101): `57e4ae4` to `1c22df8`
Built on the branch `fix/offer-customer-details` and merged on 3 November.
- An offered rider's offer (the list, a single offer, the socket message) no longer carries the customer's
  name, items, customer notes or the two drop off notes; they arrive with the accept and are gone after the
  drop off. `dropoffNotes`, whose composed line names the floor and doorbell, follows the doorbell's rule,
  free hand back included (decisions 101.1 to 101.3). No courier app change.
- Tests by a fresh Claude subagent while agy was out of quota: 2612 pass; put back by hand. Reviewed by Fable
  (changes requested: the pickup card would have lost the bag label after the hand back; fixed). The live
  verify caught the doorbell inside `dropoffNotes` during the hand back; fixed.

### No recipient details in the delivery logs (scope row 95): `0eb3cf7` to `0196f07`
Built on the branch `fix/delivery-log-privacy` and merged on 3 November.
- Delivery events are logged by ids, type, actor and source only (`eventLogLine`), never their free text
  message, including when a transition fails and when a delivery fails; the full event stays on its
  `DeliveryEvent` row. Matching logs the rider's id, not their name. Upstream's ngrok forwarder no longer
  logs request headers (the bearer token), bodies or the Axios error that carries them.
- Checked live: an order with marked contact details through creation, offer, accept, every job step, an
  out of order step, a FAILED event with a marked reason and a cancel left none of them in the log, while
  the rider still received the full offer.
- Tests by a fresh Claude subagent while agy was out of quota: 2458 pass, including an end to end privacy
  spec over every status and event type; put back by hand. Reviewed by Fable (changes requested; fixed).

### Restaurants list search (scope row 106): `745e04a` to `c5ccda1`
Built on the branch `feat/partner-list-search` and merged on 3 November, with the adminweb half.
- `GET admin/v1/partner` takes `search` (up to 100 characters): every typed word must appear in the
  restaurant's name, pickup address or sign in email, folded by row 98's `oc_search_fold` at read time
  (decision 106.1; the address and the email live in other tables, so no folded column).
- Tests by a fresh Claude subagent while agy was out of quota: 2178 pass; put back by hand. Reviewed by Fable
  (changes requested on the adminweb half's red test; fixed). Verified live.

### Greek search: accents, capitals and final sigma (scope row 98, spec 0025): `57b361c` to `56f26a2`
Built on the branch `feat/greek-search` and merged on 3 November. This is a core change, listed in the table above.
- **Found however it is typed.** The admin deliveries and couriers searches now find "Νίκος" from "νικος",
  "ΝΙΚΟΣ" or "νίκοσ", fold Latin accents, and find a rider by a phone typed "24210-10009".
- **Folded by the database.** `Delivery.searchFold` and `Courier.searchFold` are written only by triggers
  (`oc_search_fold`), so every write path, raw SQL included, keeps them right; the filters match them with a
  plain `contains` on the same fold of the typed text. The entities never carry the column, so no response
  or webhook gains a field.
- Tests by a fresh Claude subagent while agy was out of quota: 2137 pass; put back by hand. Reviewed by Fable
  (approve with nits; webhook key fixed in `1b5c7f8`). Verified live through the admin API.

### "Pin moved by a rider" on a saved customer (scope row 99, from spec 0016): `fa4005a` to `7cfb17f`
Built on the branch `feat/pin-corrections-shown` and merged on 3 November, with the adminweb and request-web
halves. This is a core change, listed in the table above.
- **The mark.** `SavedCustomer.pinMovedByRiderAt` is stamped inside the rider's existing conditional pin
  move, so a move and its mark never disagree, and carried on the partner saved customer DTO.
- **Only a deliberate edit clears it.** A restaurant's Customers page edit or a representative's admin edit
  that sets a different point clears it. An order's save never does, because its form may hold the point from
  before the rider's move (review fix, decision 99.1 amended).
- Tests by a fresh Claude subagent while agy was out of quota: 2046 pass; put back by hand. Reviewed by Fable
  (changes requested; fixed in `baa2d00`, `7e1d945`).

### The offer push carries the card's trip (scope row 100): `cec12f3` to `321b5ea`
Built on the branch `feat/offer-alert-split` and merged on 3 November, with the courier app half.
- **The same figures as the card.** The offer push now carries `toPickupMetres`, `toDropoffMetres` and
  `minutes`, worked out exactly as the offer list's `offerTrip` (spec 0019), from the rider's stored
  location and the co-op's OSRM. `distanceKm` (the quote's) stays for older apps.
- **Never held back.** The push waits at most 1.5 s for routing, then goes with unknown figures (decision
  100.1); an offer already past its deadline gets no push and pays no wait. The location is read only to
  word the rider's own alert: never sent, stored or logged (value 5).
- Tests by a fresh Claude subagent while agy was out of quota: 2021+ pass; put back by hand. Reviewed by
  Fable (approve with nits, fixed in `321b5ea`). Verified on the emulator with the push fed through the
  app's own handler (push is off on dev).

### SOS: a rider in danger alerts the co-op (scope row 73, spec 0022): `107edc8` to `a136e35`
Built on the branch `feat/sos-button` and merged on 3 November, with the courier app and adminweb
halves. This is a core change, listed in the table above.
- **The rider's routes** (`courier/v1/sos`): start (with the phone's own `clientId`, so a retried
  start never makes a second SOS, and `tapAgeMs`, so a start sent late keeps its true time), the
  active one, positions in batches of up to 120, "I'm safe" and "False alarm". Another rider's SOS
  answers the same 404 as none. An accuracy the phone sends is advisory: a missing or senseless one
  is stored as unknown and never refuses the batch.
- **The admin's routes** (`admin/v1/sos`): the open ones (not paged), the closed ones (paged), one
  SOS with its trail, and the close with an outcome (Rider safe, Help arrived, False alarm, Other)
  and an optional note. Who closed it and when are recorded.
- **A rider in an SOS gets no work.** The matchers leave them out, every matcher's choice is checked
  again (so the STATIC override too), and an admin's hand offer, a reassign and the rider's own
  accept (auto accept included) answer 409. A job they already hold, and its pay, never change.
- **Positions are kept only as long as the co-op decides.** `sosLocationRetentionDays` (1 to 365,
  default 30; 0 is refused with a reason). A daily job at 04:00 Volos time deletes a trail whose
  newest point is older, and stamps when. The record of each SOS stays. No log line or error names a
  coordinate.
- Tests by agy (`638f4e0`, `6ca259f`, `a136e35`): 1996 pass; every put back repeated by hand. Reviewed
  by Fable (approve with nits; rulings in the review, decisions 73.10 and 73.11 taken with the
  operator). Verified live with the courier app on an emulator and adminweb in headless Chrome.

### Auto accept on the record, and a free hand back in the first minute (scope row 71, spec 0020): `ca392af` to `640afb5`
Built on the branch `feat/auto-accept-hand-back` and merged on 2 November, with its adminweb and
mobile halves. This is a core change, listed in the table above.
- **An automatic accept is marked.** The courier accept takes an optional `{ automatic }` body; when
  it is `true`, the ACCEPTED event's message ends with "(accepted automatically)". Nothing else
  stores it, so automatic accepts cannot be counted per rider (value 5).
- **The co-op sets the window.** `handBackSeconds` (whole seconds 0 to 300, default 60; 0 switches
  the hand back off). `handBackUntil` is worked out at the accept, so changing the setting never
  moves a window already running. If the setting cannot be read, the accept still goes through
  with 60.
- **The hand back.** `POST /api/courier/v1/deliveries/:id/hand-back` returns the job to matching:
  the rider goes on the delivery's skip list, one conditional write on status and rider clears the
  rider and the window, a `HANDED_BACK` event is recorded, and a new offer round starts. No pay and
  no charge either way. Not yours is 404; at the restaurant or later is 409; after the window (plus
  a 3 second grace) is 409 with a sentence worded for the setting.
- **Details wait for the window to close.** While it runs, the customer's phone, floor and doorbell
  are withheld (decision 71.10). Each courier delivery carries `handBackUntil` and the list carries
  `serverNow`, so the phone counts down by the server's clock.
- Every write that takes the rider off a delivery (reassign, dispatch stop return, cancel, hand
  back) clears both new columns (`ae95aad`).
- Tests: by agy (`7a2d826`, `d71e26c`), 1775 passing; 20 checked by hand by putting their bug back.
  Reviewed by Fable (approve with nits, fixed) and by agy (fix needed, ruled: no fix for this row,
  decision 71.15). A known race with a reassign is decision 71.14.

### Arrival detected by the rider's app, marked on the record (scope row 19, spec 0021): `1a6969b` to `b6ca49c`
Built on the branch `feat/quicker-delivery-screens` and merged on 2 November, with the courier app,
adminweb and request-web halves. This is a core change, listed in the table above.
- **The co-op sets the radius.** `arrivalRadiusMetres` (whole metres; 0 switches detection off,
  otherwise 20 to 300; 50 when never set, read quietly). A new `zeroSwitchesOff` field in
  `NUMERIC_SETTING_RULES` lets 0 skip the range, and 1 to 19 is refused with "must be 20 or more,
  or 0 to switch detection off". Riders' apps read it from `GET config/contact`, which already
  carried the dispatch number.
- **An arrival says how it was made.** The two courier arrived routes take an optional
  `{ detected }` (refused unless sent as a JSON boolean). The event's message ends with
  "(detected by the app)" or "(tapped by the rider)". There's no column, so a rider's taps can't be
  counted (value 5). An older app that sends nothing counts as tapped.
- Tests by agy (`710a716`, `b6ca49c`): 1864 pass; 8 checked by hand by putting their bug back.
  Reviewed by Fable (approve with nits; its one test gap closed in `b6ca49c`). Verified live with
  the courier app on an emulator.

### Pay when a job is cancelled (scope row 32, spec 0015): `1ce975f` to `0480cff`
Built on the branch `feat/cancellation-pay` and merged on 2 November, with its adminweb,
request-web and mobile halves. This is a core change, listed in the table above.
- **The rider is paid** when a delivery is cancelled anywhere from accepted to arrived at drop off,
  under the co-op's `cancellationPayoutPolicy` (a key of the payout policy menu, full pay when
  unset). The rule is recorded with the cancel, so a later change of setting never reaches an award
  already owed (decision 32.18, `1399458`). The award is a `CourierCompensation` row and a
  `COURIER_PAID_FOR_CANCELLATION` event.
- **The restaurant is charged** for its own cancellations (`PartnerCharge`). Who cancelled travels in
  the partner cancel body (default RESTAURANT) and the admin CANCELED event (default COOP).
- **Races are settled by the database.** The cancel writes only if the status and rider are still
  what it read, so a drop off or pickup that got there first wins and nothing is paid or charged.
  Every status write in `updateDeliveryAndSendNotifications` is now conditional the same way
  (decision 32.17, `badde22`).
- **Nothing is lost.** A repeatable minute job, `cancellation-award-sweep`, completes any
  cancellation from the last 24 hours still missing its award, event or charge.
- **Rider routes.** `GET /api/courier/v1/deliveries/cancelled-jobs` (an allow list, nothing about the
  customer) and `POST :id/food-outcome` (once, only after a pickup; `FOOD_RETURNED` or
  `FOOD_NOT_RETURNED` with a note). A `JOB_CANCELLED` push. The rider's own cancel route now
  answers 409 (decision 32.14).
- Fixed by the live verify: the earnings day list dropped each line's kind (`f38279d`), and a late
  award paid under the rule in force when the sweep ran (`1399458`).
- Tests: by agy (`3f91764`, `c861973`, `1ffd3bf`, `6c5ca25`, `99ece61`), 1426 passing; every put
  the bug back check repeated by hand. Reviewed by Fable (3 majors, fixed) and by agy (2 findings
  fixed in `180f0c2`, 1 did not hold).

### Stop dispatch for heat and storms (scope row 29, spec 0014): `2a17d40` to `5a68225`
Built on the branch `feat/dispatch-stop` and merged on 2 November, with its adminweb, request-web
and mobile halves. This is a core change, listed in the table above.
- **Stop now, or a window in Athens time.** `GET/POST /api/admin/v1/dispatch-stops`, a preview of
  what a stop would touch, and `POST .../:id/end`. A time that does not exist (the hour skipped in
  spring) is refused. Two admins stopping at once cannot both pass the overlap check (an advisory
  lock).
- **While a stop is on, no offer goes out.** `offerToNextCourier`, the one place every automatic
  offer is made, answers `'STOPPED'`. An admin's hand offer, a reassignment and the test routes
  answer 409; a restaurant's quote and order answer 503 with the sentence and the end time.
- **At the start**, open offers end (not counted as the rider's miss) and every delivery accepted
  but not picked up gets `RETURNED_TO_WAITING`; its rider is paid by the co-op's reassignment
  setting, after the return, so a pickup tapped at the same moment wins. **At the end**, every
  waiting delivery gets an offer or a recorded "nobody free".
- A repeatable minute job runs each stop's start and end work once, and retries by design. Stop now
  is blocked only by a stop already on, never by one scheduled later (decision 29.6, `0bf4a2f`).
- `GET /api/courier/v1/dispatch-state` and `/api/partner/v1/dispatch-state` give the reason, times
  and sentence, never who stopped it.
- Tests: by agy (`fad6255`, `f6fc9be`, `76fa2a2`, `5a68225`), 1203 passing; every put the bug back
  check repeated by hand. Reviewed by a fresh model (`/check review`, fixes `3711e77`) and by agy (fixes `2756da5`).

### Rider accounts issued by the co-op (scope row 16, spec 0013): `d8d989e` to `841ad98`
Built on the branch `feat/admin-issued-riders` and merged on 2 November, with its adminweb and
mobile halves. This is a core change, listed in the table above.
- **Only an admin creates a rider.** `POST /api/admin/v1/courier` creates the login and the courier
  in one write; the email is stored lower cased, and a taken email or phone is a 409 naming which.
  The public `POST /api/courier/v1/auth/register` is gone.
- **A new password cuts the old phone off.** `POST /api/admin/v1/courier/:id/rotate-password` sets
  `credentialsChangedAt`; every token issued before it answers 401 "Your password was changed. Log
  in again." (access, refresh and socket). The rider's sockets close, their push devices are
  deleted, and they go Offline. A restaurant's password change sets the time too, and spares admins
  (`b2273a3`).
- Login tries the email as typed, then trimmed and lower cased. Logs carry ids only.
- Tests: by agy (`be86e99`, `048f600`, `bfc8351`), 1114 passing; every put the bug back check
  repeated by hand. Reviewed by a fresh model (`/check review`, fixes `f50d059`) and by agy (fixes `b2273a3`).

### The time a rider tapped, on every delivery event (scope row 20, spec 0009): `e1876d6` to `20c6273`
Built on the branch `feat/bad-signal-tap-time` and merged on 2 November, with its mobile half (the
phone's outbox). This is a core change, listed in the table above.
- **The phone sends an age, not a date.** The five courier job step routes take an optional
  `tapAgeMs` ("I tapped this 90 seconds ago"), a whole number from 0 to 7 days, refused unless sent
  as a real JSON number (`3ac6edd`). The server subtracts it from its own clock, raised to the
  previous step and capped at the arrival, so a wrong phone clock cannot move pay.
- **`occurredAt` on every event**, and earnings count a delivery on the day it was tapped. A
  Delivered tapped at 23:50 and sent at 00:20 counts on the right day. `pickupReadyAt` and
  `dropoffReadyAt` take the tap.
- **The answer tells the truth.** Four step routes used to answer with the delivery as it was before
  the event; they now read it again, so the app sees when a step was refused. A repeated step stores
  its note once; a late step that no longer applies is kept as a failed row (`bd06404`).
- The admin events list carries `occurredAt`.
- Tests: by agy (`b21b8ab`, `83446fb`), 919 passing; 20 checked by hand by putting their bug back.

### Saved customers for restaurants (scope row 26, spec 0005): `f972791` to `e7746b7`
Built on the branch `feat/saved-customers` and merged on 26 October, together with the request-web
and adminweb halves of the row. This is a core change, listed in the table above.
- **A restaurant's own list.** `GET /api/partner/v1/customers` lists and searches the logged in
  restaurant's saved customers, most recently used first (name anywhere, or 2 or more digits of the
  phone; `%`, `_` and `\` are escaped, since Prisma's `contains` does not escape them). `POST`
  saves one (`onPhoneClash: update` from an order, `refuse` from the Customers page), `PATCH`
  changes one, `POST /:id/used` marks it used by an order, `DELETE` removes it for good. Every query
  carries the restaurant in its WHERE, so another restaurant's id is a 404 like an unknown one
  (`94166ba`).
- **One customer per phone.** Phones are stored in the international form (`+306912345678`; a
  number with no country code is read as Greek, landlines and foreign numbers are fine), unique per
  restaurant. A clash answers 409 naming the other customer by id only. A save from an order is one
  `INSERT … ON CONFLICT`, so two orders saving the same new phone end as one customer.
- **Addresses inside the area the co-op serves** (AC-10): the quote's region test, now shared in
  `geoJsonUtils`, refuses an address outside it with a plain 422.
- **Admins** see, edit and delete any restaurant's list through `/api/admin/v1/partners/:partnerId/customers`;
  each edit and delete is logged with the admin's, the restaurant's and the customer's ids, never a
  name, phone or address.
- **The co-op decides how long unused customers are kept** (AC-7): `savedCustomerRetentionMonths`
  (default 12, whole months 1 to 36, refused by name otherwise), shown in `/metadata`. A daily job at
  04:00 Volos time deletes every customer unused for that long in one statement and logs only the count.
- **No customer detail leaves the table** (AC-9): the request log drops the query string of any
  `/customers` path; error messages are fixed sentences; error reports to Sentry carry no request at
  all (body, query string, cookies or headers), for every route (`0c80f39`).
- Fixed along the way: a phone clash answered 500 (`isUniqueConstraintError` never matched the
  generated client's errors), the response formatter dropped `conflictingCustomerId`, a `PATCH`
  with `null` for a required field answered 500 (now 422), and a `PATCH` with only `markUsed`
  answered 404 (`0c80f39`, `e7746b7`).
- Tests: 112 new (`4858be1`, `725dd6c`, `b342379`); 44 checked by hand by putting their bug back.
  Reviewed by Fable and by agy; every finding ruled in `docs/reviews/2026-10-26-*saved-customers*`.

### Offers pushed to riders' Android phones (scope row 58, spec 0003): `cb956aa` to `f37d8bf`
Built on the branch `feat/android-offer-push` and merged on 26 October, together with the mobile
half of the row. This is a core change, listed in the table above. It does nothing until the
co-op's Firebase project exists (row 1).
- **Phones register for push.** `POST /api/courier/v1/devices` stores the logged in rider's push
  token (`CourierDevice`, one row per token; the same token posted by another rider moves to them,
  and a rider keeps at most their newest 10). `DELETE /api/courier/v1/devices/:token` removes it at
  logout. The request log shows `/devices/:token`, never the token (`083ead1`, `70fc638`).
- **Push is off unless configured.** `FIREBASE_SERVICE_ACCOUNT_PATH` points at the co-op's service
  account file. Unset, the server logs "push is off" once at startup and everything else behaves as
  before (AC-11). The key file is kept out of git.
- **Every offer, and every offer that ends, goes to the rider's phones** as a high priority data
  message, after the socket message, at all five places an offer is sent (`61bf6eb`). A push that
  fails is logged and never blocks, delays or undoes the offer; a token Firebase reports dead is
  deleted. The time to live is the seconds left to the offer's deadline (300 s without one); an
  offer already past its deadline is not pushed (decision 58.10).
- **The offer card's facts only** (`388417e`, AC-10). `buildOfferCardPayload` builds the message
  from an allow list: pay, restaurant, a street or town, distance, minutes, the deadline. Never the
  customer's name, phone, house number, notes or items; a test fails if a field outside the list
  appears.
- **A 2 minute reminder when offers don't expire** (`902e7b6`, AC-7). With expiry off, a delayed
  `offer-insist` job re sends the offer with `insistent: '1'` after 120 s if it is still the same
  offer waiting for the same rider. A failed lookup is logged and failed jobs are dropped from
  Redis (`0f009b3`).
- **Nothing about a push is stored per rider** (AC-13, value 5): no delivered, opened or answered
  times.
- Tests: 86 new (`ebe5790`, `e27776b`, `f37d8bf`); 33 of them checked by hand by putting their bug back.

### Offers end on time, set by the co-op (scope row 61, spec 0002): `b364c66`, `d26de74` to `0be071e`
Built on the branch `feat/offer-expiry` and merged on 26 October, together with the mobile
and adminweb halves of the row. This is a core change, listed in the table above.
- **Three co-op settings** on Instance configuration and in public `/metadata`:
  `offerExpiryEnabled` (default off, so nothing changes until the co-op switches it on),
  `offerExpirySeconds` (whole number 20 to 300, default 60) and `noCourierRetrySeconds` (whole
  number 10 to 300, default 30). An empty, fractional, out of range or wrongly typed value is
  refused with a message naming the setting, and a boolean has its own guard. A running offer
  keeps the deadline it was given.
- **Every automatic offer is recorded.** It is written in one update with its amounts, and an
  `OFFERED` event (actor `SYSTEM`, the rider in the new `courierId` column) goes to the audit
  trail.
- **The `offer-expiry` job** ends an unanswered offer 3 s after its deadline, even with the
  phone off: `OFFER_EXPIRED` is recorded, the rider goes on the 20 minute skip list like a
  decline, gets `OFFER_ENDED` over the socket, and the delivery goes to the next rider. An
  admin's own offer never expires.
- **Accept and decline are conditional.** Whatever answers first wins; a late accept or
  decline gets a 409 "This offer has ended" and changes nothing, and a stale expiry job does
  nothing. The admin offer and `REASSIGNED` write the same conditional way.
- **Going Offline ends the rider's open offers at once** ("Rider went offline"), from the
  rider's own status change, an admin's courier update or Last call, with expiry on or off.
  `PATCH courier/status` now answers without waiting for that matching.
- **Nobody free:** the triggering event is still saved, `NO_COURIER_AVAILABLE` is recorded
  once per waiting spell, waiting deliveries are offered again the moment a rider becomes
  free, and one `no-courier-retry` backstop job runs every `noCourierRetrySeconds`.
- **One rider, one offer:** a rider holding an open offer counts as busy, and a rider coming
  free is offered one delivery, not every waiting one. An ended offer always leaves its event
  and a backstop, even if a later step fails.
- **An offer an admin moves** tells the rider who held it `OFFER_ENDED` with the reason
  `MOVED`; it is not recorded as their expiry.
- **Partners are not told about offers:** `OFFERED`, `OFFER_EXPIRED` and
  `NO_COURIER_AVAILABLE` never go out in partner webhooks.
- **Admin events carry `courierId`**, so a delivery's own timeline can name the rider offered.
- **Value 5 guard:** a test fails if anything groups or counts events by rider. An expiry is
  never written as a decline and never changes a rider's status.
- The two upstream test routes now offer through the real offer step, and the partner one
  refuses another partner's delivery.
- Tests written by agy bring the suite to 572 passing; typecheck is clean. `34f6f9f`, `7c5c00e`,
  `162e6d0`, `21ac9e1`

### Courier earnings (pay transparency)
- **`GET /courier/earnings-summary`**: per-day compensation, tips and delivery count for
  the signed-in courier. `56d7339`
  - Built from the `DeliveryEvent` ledger. A delivery counts on the day of its successful
    `DROPPED_OFF` event, so the figures match the audit trail.
  - Day boundaries use the courier's own timezone, so evening deliveries don't slip into
    another day.
  - The window is capped at 366 days, because `DeliveryEvent` has no `createdAt` index.
  - The currency comes from the member-votable `Config`, not a literal.
- **`GET /courier/earnings/day`** and **`GET /courier/earnings/delivery/:deliveryId`**: the
  drill-down from a day's total to the deliveries behind it. `208a23f`
  - Uses the same deduplication rule as the summary (`dedupeEarliestDropOff`). A test
    asserts that the drill-down and the summary always agree.
  - A courier only sees their own deliveries. Another courier's delivery id returns 404, so
    ids can't be probed.
  - Impossible dates such as `2026-02-30` are rejected (dayjs used to roll them over into
    March).
  - When `date` is missing, the error now says "date is required" instead of a format
    error. `bae1f63`

### Restaurants (partners) managed by the co-op (Unit 1)
- Admin CRUD for restaurants, with a single fixed pickup `Location` per restaurant. `1916d0e`
  - The login user and the partner row are created in one atomic statement.
  - Passwords are bcrypt-hashed. Neither passwords nor API keys are ever echoed back.
  - The partner namespace has exactly one related route,
    `GET /partner/v1/partner/profile`, and it is read-only. Restaurants cannot edit their
    own details.
  - Fixed: `formattedAddress` going stale on partial updates, and names, streets or cities
    being settable to the empty string.

### Mid-flight courier reassignment with pay protection (Unit 2)
- New `REASSIGNED` event. It returns the delivery to `ASSIGNING_COURIER` with the new rider
  matched, so that rider still has to accept. `3928443`
- Every reassignment writes a `CourierCompensation` row, and the earnings endpoints add
  these rows to drop-off earnings, so the dropped rider actually gets paid.
- The payout menu and its default live in the votable `Config`, and both are validated when
  written.
- The payout write can no longer be lost. It is written first and unwound step by step if a
  later step fails, and every log line carries enough to recreate the payout by hand.
  `e5a1538`
- Instance config is validated in full before any of it is written, so a rejected update no
  longer leaves the table half-written. Narrowing the payout menu can no longer strand the
  default policy. `3d635d4`
- Error messages now distinguish a stored default from the in-code fallback. `7b2cfb3`

### Audit trail readable by admins (Unit 6)
- `GET /api/admin/v1/deliveries/:deliveryId/events` returns a delivery's full event
  history in order. It includes failed transitions and the `oldStatus`, `newStatus` and
  `transitionSuccessful` fields. `44e0250`

### OSRM road routing with a moped profile
- New `OSRM` option for both distance and duration calculation. `f1328c3`
- `moped.lua` builds on OSRM's `car` profile with a 45 km/h cap and no motorways.
- There is no silent fallback: if OSRM is unreachable, the quote fails with a 503 instead
  of quietly using straight-line distance, which underpays riders.
- New env vars: `OSRM_URL`, `OSRM_PORT`, `OSRM_REQUEST_TIMEOUT_MS`, `OSRM_CACHE_TTL_SECONDS`.
- This is opt-in: the seeded defaults stay `HAVERSINE`/`SIMPLE`.

### Dev tooling and fixtures
- Volos seed scripts: instance config, 10 online couriers, a test partner with a generated
  API key, and a courier relocation helper. `fd84d9b`
- Seed script for completed deliveries, with matching backdated `DROPPED_OFF` events. It is
  idempotent. `67b709c`
- Re-runnable pickup address for the seeded partner "Nosh" (inside the Volos polygon).
  `587767b`
- Re-runnable seed for the "Souvlaki tou Nikou" test restaurant, which was first made by hand
  and lost on every `db:fresh`. `e107d16`
- `aiflow` cross-model pipeline script (Claude plans and reviews, `agy` executes). It was
  later moved to the workspace root. `b2c5305`, `1640d57`, `8f15f9d`, `77c9eda`,
  `84c68c8`, `4287155`, `fc6a3a6`, `64cfee3`

---

## Changed

- **The delivery fee is now a base fee plus a per km fee** (scope row 51, spec 0001).
  `a484994`, `579109d`
  - Each quote stores its two parts in whole cents: `baseFee`, from the new `quoteBaseFee`
    setting, and `distanceFee`, the distance times `quoteRatePerDistanceUnit`. The customer
    price is the two parts plus the co-op fee %, added once on top. Worked example: base 200,
    0.71 km at 150 per km, 10% fee gives 338 charged and 307 paid.
  - The rider is paid exactly the two parts, read from the stored quote. The co-op fee is
    never inside rider pay. Before, the fee was counted twice: the quote price already
    included it, the rider was paid that whole price, and the offer added the fee again on
    top for the customer.
  - A delivery's pay, fee, fee % and total all come from its quote, on every path (the
    matcher's offer, an admin's offer and a reassignment). Changing a setting after the quote
    no longer changes that delivery.
  - `quoteBaseFee` is editable from admin. `0` is allowed; a negative, a fraction of a cent or
    an empty value is refused with a message naming the setting. It is seeded as 200, with the
    fallback `DEFAULT_QUOTE_BASE_FEE=200`. ⚠ 200 is a placeholder awaiting a member vote.
  - A bad stored base fee (possible only by editing the database) stops quoting with an
    error, so it can never be paid out. The admin settings and public metadata still load,
    showing the base fee as empty, so it can be fixed from admin. `579109d`
  - The public `/metadata` now shows `quoteBaseFee` and `quoteRatePerDistanceUnit`, so riders
    can read how their pay is built.
  - The admin delivery detail (`GET /api/admin/v1/deliveries/:deliveryId`) adds `baseFee`,
    `distanceFee` and `feePercentage`. The list endpoint sends `null` for the two parts.
  - `SURGE` quotes store a base fee of 0, so their whole price is the distance part (surge
    itself is removed in scope row 52).
  - Older quotes read as base 0 and distance equal to their old price. Older deliveries keep
    the amounts they were given.
- **Pricing is now distance-based instead of random.** `0dedb32`
  - The live instance used to quote with `Math.random()`, and with
    `FROM_QUOTE_FROM` that random number was also the rider's pay. `BY_DISTANCE` is now
    the seeded default. `CUSTOM` still exists, but it logs a warning on every quote.
  - The rate moved from the `DELIVERY_QUOTE_PER_MILE` env var to the votable Config key
    `quoteRatePerDistanceUnit`. The env fallback is now
    `DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT`.
  - Fixed a unit bug: a per-mile rate was being multiplied by kilometres. The effective rate
    is unchanged at €1.50/km.
  - **Minimum courier pay floor**: `defaultMinimumCourierPay` is now enforced on
    compensation. The co-op absorbs the difference on short trips and logs it per delivery.
  - ⚠ The numbers (150 minor units per km, 250 floor) are placeholders awaiting a member
    vote.
- **New instances are seeded in EUR.** Fixtures read the instance currency instead of
  hard-coding USD, and re-seeding never overwrites a currency the members voted in.
  `local.env` `DEFAULT_CURRENCY` is now EUR. `159d56e`
- Yarn is pinned to 4.14.1 (`packageManager`, `.yarnrc.yml`). `marked` is downgraded to v4
  (v17 is ESM-only and broke the build). `@nestjs/config` is raised to ^2.3.0. `c5fbf87`
- Migration history is baselined against the live schema. A fresh database can be built from
  migrations alone, and `prisma migrate dev` no longer offers to wipe data. `9edbe8d`

## Fixed

- **Courier offers and status updates reach the app again** (scope row 57). The courier
  sends went through the Ably dispatcher whatever `WEBSOCKET_DISPATCHER` said, and without
  Ably credentials they failed, so nothing reached the courier app over the socket. Socket.IO
  is now the dispatcher unless `WEBSOCKET_DISPATCHER=ably`, and exactly one dispatcher exists.
  A core change, listed in the table above. `a579ba7`; tests `6f5f9d4`
- **The socket login token is no longer written to the debug log** (row 57 review). Row 57
  made this path live; the log level is info today, so nothing leaked, but lowering it would
  have written bearer tokens to the log. `2062d3c`; tests `d82f23c`, which also fail if
  `AblyModule` stops exporting `AblyService`

- **Failed transitions recorded their two statuses the wrong way round** in the audit
  table. The signature now uses named fields. Existing wrong rows are deliberately left
  as-is and documented (no pay was affected, because earnings only read successful rows).
  `2595d68`
- The `getConfigValueOrDefault` fallback never worked: Prisma 5.3.1 throws `NotFoundError`,
  which the guard didn't recognise. The spec that would have caught this was misnamed, so
  Jest never ran it. `3928443`
- A saved minimum-pay value of `0` was silently ignored. `0dedb32`
- **A `0` is now kept for every co-op number setting, or refused with the reason** (scope
  row 49). Six settings were saved with `if (data.x)`, so a `0` was dropped while admin said
  "saved": a vote for a 0% fee never reached a quote. `8840ce2`
  - Fee %, courier pay rate and drift distance save `0` and read it back as `0` (the admin
    response used to turn a stored `0` into `null`).
  - Max assignment distance, quote expiry and max working hours refuse `0` with a message
    that says why. For the distance it is not "zero km": the courier search reads `0` as no
    limit at all, so deliveries would be offered to couriers at any distance.
  - All eight number settings (those six plus the quote rate and minimum pay) refuse a
    negative or an empty value. Everything is checked before anything is written, so a
    refused request changes nothing.
  - One table in the config service, `NUMERIC_SETTING_RULES`, holds every number setting and
    whether `0` is allowed. The tests are generated from it, so a setting added to the table
    gets its checks automatically. `3fa465c`
- **An empty number setting is refused instead of saved as `0`** (scope row 56). The global
  `ValidationPipe` converts each field to its declared type before any check runs, and
  `Number('')` is `0`, so `{"quoteBaseFee": ""}` sent to the admin config API was saved as a base
  fee of 0 and reported as saved. Only the admin page's own field stopped it. `25736ff`
  - All eight number settings now answer an empty or blank value with a 400 that names the
    setting, for example `quoteBaseFee cannot be empty`, and nothing is saved.
  - ⚠ A value that is not a real JSON number is refused too, with `<setting> must be sent as a
    number`. That covers `false` and `[]`, which also turned into `0`, and a number sent as a
    string, such as `"5"`, which used to be converted and saved. The admin page always sends
    real numbers.
  - A real `0` still saves wherever row 49 allows it.
  - The row 49 and row 51 entries above say an empty value is refused. Through the API that
    was only true of `null`, not of an empty string, until this fix.
  - A test reads every number field from the admin input class and fails if one lacks the
    check, or is missing from `NUMERIC_SETTING_RULES`. `72a6757`, `5f6feba`
- **A rider on a delivery is no longer offered a second one** (scope row 62). The two
  matchers each kept their own list of busy statuses, and both had gaps. The nearest rider
  matcher counted only `CREATED`, `DISPATCHED` and `PICKED_UP`, so a rider who had just
  accepted, was waiting at the restaurant, was on the way or was at the door looked free. The
  seniority matcher had `ACCEPTED` but missed the other three. `5f5cc9e`
  - Both matchers now share one subquery, `busyCourierDeliverySubQuery()`, built from
    `DELIVERY_ONGOING_STATUSES`: accepted, dispatched, arrived at pickup, picked up, on the
    way and arrived at drop off. The same list already drives admin reassignment and the
    courier app's in progress list.
  - A rider whose deliveries are all dropped off, cancelled or failed can be offered work
    again. A reassigned rider is free again too, since `REASSIGNED` clears `courierId`.
  - `CREATED` left the busy check. It never mattered, because a `CREATED` delivery has no
    rider yet.
  - Tests check that both matchers send exactly the six statuses, and an existing test ties
    the list to every status in the enum, so a new status must be placed on one side.
    `cca5310`
- Both matchers returned the rider's `courierLocation` with latitude and longitude swapped.
  PostGIS lists a point as `[longitude, latitude]`, which `getCurrentLocation` already read
  correctly. Nothing reads `courierLocation` yet, so no match or price was affected; the row 62
  test had pinned the swap with mock data in the same wrong order, and now uses real GeoJSON
  order. `56ec681`
- The partner seed gave every instance upstream's fixed API key, which is public in upstream's
  history. It now generates a random key, and a re-seed replaces the old one. `2260c39`

## Removed

- **The minimum courier pay floor** (`defaultMinimumCourierPay`): the setting, its fallback,
  the seed and the public metadata field. The base fee now protects short trips. A 0.14 km
  trip pays 200 + 21 = 221, where the floor used to make it 250. `a484994`
- Public partner self-registration endpoint (see the core-change table). `ed3b762`
- `parsePrice`, an unused helper that hard-coded `$`. `f4add7b`

## Housekeeping

- Ignored local scratch files and pipeline artifacts (`.aiflow/`, `plan.md`). `e7e5c50`
- `AGENTS.md`, context for AI coding tools that points at the co-op workspace rulebook, and a
  `CLAUDE.md` that imports it.
- Jest runs at most 4 test processes (`maxWorkers: 4` in `jest.config.js`). Its default, one per
  core minus one, peaked at 12.1 GB on a 16 core machine and took 15 s; 4 workers take 8 s and
  4.5 GB. The uncapped suite was the largest share of the dev machine running out of memory.

---

## Known open items

- The quote rate and the base fee (150 per km and 200 per delivery) await ratification by a
  member vote.
- The base fee has no upper limit. Above 2147483647 cents it would save, then make every quote
  fail on the 32 bit column (deferred to scope row 53 with the fee % ceiling).
- A bad stored base fee makes a partner's quote request return a generic 500; the message
  naming `quoteBaseFee` is only in the server log.
- The fee % has no upper limit, so a mistyped extra zero in admin would multiply every price
  (scope row 53, waiting for the co-op to choose the ceiling).
- The busy check's open offer clause is tested by reading its SQL, not
  by running it: swapping its AND for OR passes every test. It needs a test against a real
  database.
- Partner webhooks still send `REJECTED`, and every payload carries the whole delivery,
  including `matchedCourierId` (the rider offered). Upstream behaviour partners may read, left
  for a small row of its own.
- Each offer and retry reads every delayed job to find the pending backstop. Fine at co-op
  scale; storing the pending job id on the delivery is the cleaner fix if the queue grows.
- The public `api/tasks/v1/execute` route now reaches live handlers and needs locking before
  going live (scope row 94). Since row 26 it also runs the saved customer retention job on demand
  (it deletes only what the daily run would).
- `Delivery` has no index on `courierId`, which the busy subquery runs for every rider in
  range. `@@index([courierId, status])` is worth adding (schema change).
- Rotate the upstream dev credentials in `local.env` before any real deployment.
- The earnings repository query is still mocked in tests and needs an integration test.
- A `@@index([createdAt, newStatus])` on `DeliveryEvent` is worth adding (schema change).
- Making reassignment fully transactional needs a restructure of `processDeliveryEvent`.
