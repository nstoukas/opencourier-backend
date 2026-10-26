# Changelog — co-op fork of `opencourier-backend`

This fork adapts [Princeton-HCI/opencourier-backend](https://github.com/Princeton-HCI/opencourier-backend)
for a Greek workers' cooperative (Συνεταιρισμός Εργαζομένων, Law 4430/2016) delivering
by moped in Volos. Restaurants pay a flat subscription; couriers are paid piece-rate per
delivery, so pricing and matching are the pay structure.

Everything below sits on top of upstream `main` on the branch `chore/aiflow-pipeline`
(79 commits, 25 July – 26 October 2026). Each entry names its commit, and the commit
message has the full reasoning and verification notes.

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
| `yarn.lock` tracked (upstream ignored it) | Without it a fresh install resolves `firebase-admin`'s tree afresh and can drift (decision 58.12). No code change. | `6b4d49d` |
| `Delivery.offeredAt` and `offerExpiresAt`, `DeliveryEvent.courierId`, event types `OFFERED`, `OFFER_EXPIRED` and `NO_COURIER_AVAILABLE`, actor `SYSTEM`; two BullMQ jobs; accept and decline written conditionally (migration `20261025120000_add_offer_expiry`, row 61) | Nothing on the server ever ended an offer, so a phone that was off held a delivery forever, and offers and "no rider free" left no event to audit. Additive: Postgres cannot drop enum values, so a revert would leave them unused. | `b364c66` |

---

## Added

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
  going live (scope row 94).
- `Delivery` has no index on `courierId`, which the busy subquery runs for every rider in
  range. `@@index([courierId, status])` is worth adding (schema change).
- Rotate the upstream dev credentials in `local.env` before any real deployment.
- The earnings repository query is still mocked in tests and needs an integration test.
- A `@@index([createdAt, newStatus])` on `DeliveryEvent` is worth adding (schema change).
- Making reassignment fully transactional needs a restructure of `processDeliveryEvent`.
