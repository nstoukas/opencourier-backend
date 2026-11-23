# opencourier-backend

## Overview

The API server: NestJS 9, Prisma 5 on PostgreSQL/PostGIS, Redis, MinIO, BullMQ, Socket.IO,
REST and GraphQL. Every other component talks to it.

**Read the workspace rulebook first: [`../AGENTS.md`](../AGENTS.md).** This repo sits inside the co-op workspace, and that file binds it: co-op values, locked decisions, domain language, boundaries, and the skill workflow every change goes through ("How work gets done here"). Tools that stop at this repo's git root will not find it on their own. This file only adds what is specific to this component.

## Key files

| File | Owns |
|---|---|
| `src/domains/` | Domain services; `delivery/delivery.domain.service.ts` shows how events are emitted |
| `src/services/delivery-event/delivery-event.service.ts` | `processDeliveryEvent`: persists events, applies the state machine |
| `src/shared-types/stateMachine.ts` | `STATE_MACHINE`, the legal delivery status transitions |
| `src/services/delivery-event/delivery-event.service.ts` (`endOffer`, `offerToNextCourier`) | Offer expiry and the no courier backstop, run as BullMQ jobs through `src/services/taskBus/` (spec 0002) |
| `src/services/delivery-calculation/delivery-calculation.service.ts` | Customer price and rider pay, built from the quote's stored `baseFee` + `distanceFee` (spec 0001) |
| `src/services/pushNotification/` (`OfferPushService`), `src/domains/delivery/offer-card-payload.ts` | Offers pushed to riders' phones through `firebase-admin`; the payload is an allow list that carries no more customer detail than the offer card (spec 0003) |
| `src/domains/saved-customer/` | A restaurant's saved customers and the daily retention job (`saved-customer-retention`, 04:00 Europe/Athens) (spec 0005) |
| `src/services/partner-billing/`, `src/domains/partner-billing/billing-month.ts` | What each restaurant owes: charges by Athens month, bills marked by hand (spec 0036) |
| `src/rest-api/` | Controllers for the six API namespaces |
| `prisma/schema.prisma` | Schema; changes need operator approval and a new migration |
| `src/db-seeds/`, `scripts/` | Seeds and dev logins; Volos instance setup |

## Commands

Listed in the workspace rulebook under `opencourier-backend`. Yarn 4 via Corepack, Node 20.

## Gotchas

- Jest only runs `*.active.spec.ts`; a plain `*.spec.ts` is silently skipped.
- An event with no legal transition from the current status is dropped with only a log warning.
- A delivery's pay, fee, fee % and total come from its stored `DeliveryQuote`, never from the
  current settings, so changing a pay setting only affects quotes made afterwards.
- The global `ValidationPipe` converts body fields to their declared type before any check runs,
  so `Number('')` makes an empty value a real 0. Every number setting on
  `InstanceConfigSettingsAdminInput` needs `@RefuseIfNotSentAsNumber()` and an entry in
  `NUMERIC_SETTING_RULES`; a test fails if either is missing.
- An offer (`matchedCourierId`, `offeredAt`, `offerExpiresAt`) is only ever changed through a
  conditional write (`updateIfMatches`) on what was read, so a rider's accept, the expiry job and an
  admin can race safely; a miss answers 409 "This offer has ended" (spec 0002).
- A rider holding an open offer counts as busy (`busyCourierDeliverySubQuery`): one moped, one job,
  offered or accepted.
- One predicate, `liveDeliveriesWhere` in `courier.repository.ts`, is both the matchers' busy rule and
  the limit of two (`liveDeliveryCount`, the claim's `TWO_HELD`, the admin 409); a taken offer still in
  `ASSIGNING_COURIER` counts. Change it in one place. Stacking (`stackingEnabled`) is off by default,
  so on dev every rider gets one job unless a check switches it on (spec 0048).
- Add ons (`addOnOffersEnabled`, row 81) are off by default too, and the STATIC matcher never makes one
  (it is the override). An add on offer always gets its deadline and expiry job, even with
  `offerExpiryEnabled` off, doubled while the rider carries food: a live check with expiry off still
  sees `OFFER_EXPIRED` on an add on.
- Push is off unless `FIREBASE_SERVICE_ACCOUNT_PATH` names a readable service account file; off,
  it logs "push is off" once and offers go over the live connection only. Dev runs with it off.
- Saved customers are personal data: the HTTP logger drops the query string of any `/customers` path,
  `SentryInterceptor` sends no request for any route, refusals are fixed sentences, and admin
  edits log ids only. A new route carrying a customer's details must stay out of logs the same way (spec 0005, AC-9).
- `DeliveryEvent.occurredAt` is when a step happened (a rider's tap, sent late from a phone with no signal, as `tapAgeMs`), `createdAt` when it arrived; earnings count by `occurredAt`. A tapped step with no legal transition is saved as a failed row with its tap time; every other such event is still dropped silently (spec 0009, decision 20.13).
- `tapAgeMs` and any other number a client sends needs `@RefuseIfNotSentAsNumber()`: the ValidationPipe turns `""`, `true` and `false` into numbers before `@IsInt()` runs (row 20).
- The HTTP logger redacts any `search=` value on every route (row 96): a search can be a person's name. A Prisma `contains` does not escape LIKE wildcards; escape `%`, `_` and the backslash with `escapeLikeText` (`src/rest-api/common/search-fold.ts`).
- Admin searches match `searchFold` (spec 0025): a folded copy of the searched fields (lower case, no accents, every sigma as σ, a rider's phone digits) that only the database triggers write, from `oc_search_fold`. Fold the typed text with `foldSearchText` and use a plain `contains`, never insensitive mode. Prisma code never writes the column (a grep test fails), and the entities `declare` it, so it never reaches a DTO or a webhook. A new searched field means a new migration that replaces the trigger function and refolds the rows.
- Matching SQL is tested as text; no test here runs SQL against a database, so a wrong `AND`/`OR`
  inside it can pass the suite (decision 61.20).
- Riders exist only through admin `POST /api/admin/v1/courier` (or seeds and dev scripts); there is no public sign up. A
  password set by an admin stamps `User.credentialsChangedAt`, and every token issued before it is refused with 401 in
  `AuthMiddleware` (both branches) and the socket handshake. A new place that turns a token into a user must call
  `isIssuedBeforeCredentialsChange` too, and tokens must carry the stored email (spec 0013).
- A restaurant's API key (spec 0037) is stored only as `User.apiKeyHash` (SHA-256) with `apiKeyCreatedAt`, and looked up in one place: `AuthMiddleware` → `AuthDomainService.userForApiKey` → `findByApiKeyHash` (an unknown key is 401). Only an admin makes one (`POST admin/v1/partner/:id/api-key`, shown once); login never makes or returns one, and an admin's password change replaces an existing key in the same transaction. A new place that makes a key must hash it with `hashApiKey` (`src/domains/auth/api-key.ts`) and return it once; `UserEntity` `declare`s both fields so they never leave the server. `api_key` in the query string is refused first on every route and its request logged without the query string. A query that loads a restaurant's `user` for a `PartnerEntity` must select `apiKeyCreatedAt` too (typecheck enforces it).
- A dispatch stop (spec 0014) is a `DispatchStop` row; while one is on, `offerToNextCourier` answers `'STOPPED'` and
  makes no offer, and every other offer path (admin hand offer, reassign, accept, test routes) refuses with 409. A new
  way to start work must check `refuseIfDispatchStopped` too. Start and end work run from a repeatable minute tick
  (one off jobs here never retry) and are marked done only after they ran. Stop times are entered and shown in
  `INSTANCE_TIMEZONE`, and the sentences riders and restaurants read are built on the server (`dispatch-stop-time.ts`).
- The customer's phone (`dropoffPhoneNumber`) is in `DeliveryCourierDto` only while the rider holds the delivery
  (`CUSTOMER_PHONE_VISIBLE_STATUSES`, row 33); the socket dispatchers log ids and statuses, never the DTO.
- A text setting needs `@RefuseIfNotSentAsString()` (row 72): the ValidationPipe turns a JSON number into text, losing a
  phone number's `+`. A setting that is normally unset until a representative saves it (`dispatchPhoneNumber`) reads its
  missing row quietly; `getConfigValueOrDefault` warns on every read. Riders read it at `GET config/contact`, never the
  public metadata.
- Every status write `processDeliveryEvent` makes is conditional on the status it read (`updateIfMatches`, decision 32.17):
  a step that lost a race is saved as a failed transition. Pass extra fields (`courierId`, tap times) through
  `updateDeliveryAndSendNotifications`' data argument, never as a plain `update` before it, or a loser still writes them.
- A cancellation from an ongoing status pays the rider (spec 0015): a `CourierCompensation` (reason `CANCELLATION`, unique
  `cancellationOf`) under the rule recorded on the delivery at the cancel (`cancellationPayoutPolicy`, decision 32.18), a
  `PartnerCharge` when the restaurant cancelled, and the repeatable `cancellation-award-sweep` completes any missing piece
  for 24 h. Its events go through `recordCancellationEvent`, outside `STATE_MACHINE`.
- A rider's drop off pin move (spec 0016) is `POST courier deliveries/:id/dropoff-point`: once per delivery
  (`dropoffPointCorrectedAt`, claimed by a conditional write that also checks the status), recorded as
  `DROPOFF_POINT_CORRECTED` outside `STATE_MACHINE`, and moves only the restaurant's saved customer (by partner and normalised
  phone, and only if still at the delivery's point). It never touches the delivery's `Location`, which `findOrCreate` shares
  between deliveries. Floor and doorbell are the delivery's own columns and follow the phone's visibility rule.
- Since row 82 (spec 0053) the moved pin is also `Delivery.dropoffCorrectedLatitude`/`Longitude`, which the pin move's claim
  writes and a restaurant's later move nulls (`dropoffPointCorrectedAt` stays as the once-only mark). Address notes match on
  those columns; a deployment that applies `20261122230000_address_notes` must also run
  `scripts/backfillDropoffCorrectedPoint.ts` once (`--dry-run` first) to fill them for earlier moves, which only the event's
  English message holds. Notes past `addressNoteRetentionDays` are filtered out on read as well as deleted by the nightly
  `address-note-retention` job, so a missed night shows nothing stale.
- Never log a whole delivery or message: the partner webhook and `SocketIOService.publishMessage` log ids and statuses only
  (decision 31.18), because a delivery carries the customer's name, phone, floor and doorbell.
- A restaurant sees its deliveries from the last `restaurantHistoryDays` (spec 0017) plus any still open
  (`partner-history.ts`). Every partner route that takes a delivery id goes through `assertVisibleToPartner`: ownership
  first (another restaurant's order is the plain 404), then the period (an own old ended order is 404 with the period
  sentence). A new partner route by id must call it too. Admin routes have no period.

- A rider's map route (spec 0018) is `GET courier deliveries/:id/route`: the legs of an offer made to the rider or a job they
  hold (404 otherwise, unknown ids included), asked of the co-op's OSRM whatever the Geo calculation setting, 503 "The route
  can't be drawn right now." when OSRM cannot answer, never another routing server. The rider leg starts at the stored
  `currentLocation` the auth middleware's courier already carries. `OsrmRoutingService.getRoute` returns the points too
  (one URL and cache for quotes and routes), and its failure sentence names no address.
- OSRM runs at `--verbosity WARNING` (`docker-compose.osrm.yml`): at INFO it logs every request path, and a path holds a
  rider's or a customer's coordinates (value 5). Never raise it.

- Each offer in `GET courier deliveries/new` carries `offerTrip` (spec 0019): km to the restaurant from the rider's stored
  location and km to the customer, from OSRM, plus minutes when both are known. Display only: pay comes from the stored
  quote. A leg OSRM cannot give is null (`Promise.allSettled`); an offer is never held back for it. The offer push carries the same figures since row 100 (`toPickupMetres`, `toDropoffMetres`, `minutes`), worked
  out in `OfferPushService` within `OFFER_PUSH_TRIP_BUDGET_MS` (1.5 s), else sent unknown (decision 100.1).

- A rider's free hand back (spec 0020) is `POST courier deliveries/:id/hand-back`, inside `handBackUntil` (stored at the
  accept from the co-op setting `handBackSeconds`, plus the 3 s offer grace), only at ACCEPTED or DISPATCHED. It is
  recorded as `HANDED_BACK` by `DeliveryEventService.handBack` (skip list first, one conditional write, then
  `offerOrWait`); `processDeliveryEvent` refuses that type. No pay, no charge. Every write that takes a rider off a
  delivery must also null `acceptedAt` and `handBackUntil`; while the window (and its grace) runs, the courier DTO
  withholds the customer's phone, floor and doorbell. An automatic accept is marked only in the ACCEPTED message (value 5).

- Arrival detection (spec 0021): the rider's app decides arrival; the server only marks it. `ArrivedCourierInput`'s
  optional `detected` ends the ARRIVED event's message with "(detected by the app)" or "(tapped by the rider)"
  (`arrivalHow`), nothing else stores it (value 5), and admins have no arrival event to submit. `arrivalRadiusMetres`
  (0 = off, else 20 to 300, default 50) rides on the courier `GET config/contact`. A numeric setting whose 0 means "off"
  sets `zeroSwitchesOff` in `NUMERIC_SETTING_RULES` instead of `min: 0`.

- An active SOS (spec 0022) makes a rider busy: the matchers' `activeSosCourierSubQuery`, a check in `offerToNextCourier`
  for every matcher (STATIC included), and `refuseIfCourierInSos` (409) in the admin hand offer, reassign and the rider's own
  accept. A new way to give a rider work must call it too. `SosLocationPoint` is read only by the SOS repository and its
  admin DTO; no log line or error may name a coordinate (value 5), and nothing in the SOS module touches a delivery or pay.

- Restaurant delay pay (spec 0033) lives in `src/domains/delivery/wait-pay.ts`: `waitPaidFrom` and `waitLeaveFrom` are the whole rule, called by every path that pays, blocks or displays, so never restate it. `promisedReadyAt` is the first promise and is never moved. A write that takes a rider off a delivery must null `arrivedAtPickupAt` too. `waitPayOwedAt` is the marker that pay is owed: it is set in the status write and cleared only once the rider's row, the event and the charge exist, and the `cancellation-award-sweep` retries it for 24 h. `PartnerCharge` has no unique on `deliveryId`: use `cancellationOf` or `waitOf`. A rider's own taps are trusted (decision 23.19): no checks aimed at riders.

- The admin Dispatch board (spec 0034) is `GET admin/v1/dispatch/board`: one function per row kind in `src/services/dispatch-board/dispatch-board.ts`, listed in `DispatchBoardService.getBoard`; a new kind is one more of each, and its `kind` is a plain string so an older tab draws it as a plain row. Nothing there may time, count or rank a rider. Every write of `Courier.currentLocation` must set `currentLocationAt` in the same statement, or the rider drops off the map after 5 minutes; the entity `declare`s that column so it never leaves the server.

- A removal request (spec 0035) holds its own copy of the reason's label and flags, and its `payAmount` is fixed at the approve, so editing a reason never changes a sent request. An open request closes by itself on any successful event whose `newStatus` is outside `DELIVERY_ONGOING_STATUSES`, so a new way to take a rider off needs no extra code for that. The seven removal events are refused by `processDeliveryEvent`; only their own paths write them. A `REASSIGNED` event's message ends with `(award <id>)` so each attempt is unique. The skip list is in Redis for 20 minutes.

- Chat (spec 0034) lives in `src/domains/chat/` and `ChatRepository`. The courier and partner routes take no thread id (the
  session finds it), admins listen on the `admins` Socket.IO namespace (`AdminSocketGateway`), and `disconnectUser` closes a
  user's sockets on both namespaces. The server keeps no record of a rider or restaurant reading: `HttpLoggerMiddleware` drops
  the query string of the chat message routes (`QUERY_STRING_DROPPED_PATHS`), so a new route paging by message id goes there too.
- The Winston logger is fixed at `level: 'info'` (`src/services/logger/index.ts`), so a `logger.debug` line is never printed. Use debug only for what may stay silent (row 115 moved `Channel … not found` there on purpose, decision 115.2); anything someone must see goes to `log` or higher.
- Restaurant billing (spec 0036): a charge's month is the Athens calendar month of its `createdAt` (`billing-month.ts`), which never moves, so a billed month never gains or loses a charge. A charge is in at most one open bill (`PartnerCharge.billId`); a `PartnerBillLine` row links a bill to each charge it covered and is kept forever, even after an undo (`onDelete: Restrict`). `createBillIfAllUnbilled` claims every charge in one conditional write and writes nothing on a short claim or a Prisma `P2034` (deadlock between two bills), and the service rereads and answers 409 with `alreadyBilled` ids (passed through `ResponseFormatMiddleware`, charge ids only). Every new wait award must store `waitMinutes`, and its charge copies it, or the statement loses the minutes.
- Prisma 5.3.1's `distinct` is done in memory: it reads every matching row and drops duplicates in Node. For "the newest row
  per group", use `$queryRaw` with `SELECT DISTINCT ON (...) id ... ORDER BY ...` and `Prisma.join` for the values, then
  `findMany` by those ids (`ChatRepository.findNewestMessageIds`).
- Review requests and the settings record (spec 0038): the three review events are written in `ReviewRequestRepository`'s transaction with null statuses, never through `processDeliveryEvent`, so anything that reads drop offs must keep filtering by `newStatus` or type. A request leaves `OPEN` only through `answer()` or `withdrawIfOpen()` (a guard test scans all of `src`). Every Instance configuration save runs in one transaction under `pg_advisory_xact_lock` and writes a `SettingChange` per changed value in effect; a test faking that transaction must give it `$executeRaw`. A new rider facing setting goes in `RIDER_FACING_SETTINGS` with a formatter that writes every part that can change, or the rider's What changed list drops the line as unchanged. `updateCurrentLocationById` is the only writer of a courier's position, and it refuses an Offline rider with no job (409).
- Rider password reset by emailed code (spec 0039): `forgot-password` answers 202 before any lookup, for every email, and runs
  the work in a promise nobody awaits, so a change must keep the answer and its timing independent of the email. Codes live only
  as an HMAC (keyed with `JWT_SECRET_KEY`) in Redis, and every guard (`password-reset-wait`, `-count`, `-tries`, `-day-tries`)
  goes through `CacheService.setIfAbsent`, `increment` (one Lua script) or `take` (GETDEL), never a read then a write. No log
  line, error or Sentry report may carry an email, a code or a password: `describeError` logs a class and code, never a message.
- A credential change that must end a rider's other sessions calls `CourierCutOffService.cutOff` (`src/services/courier-cut-off/`,
  shared by the admin password change and the reset): sockets closed, `CourierDevice` rows deleted, Offline through the admin path.
- Mail goes through `MailService` (`src/services/mail/`, Nodemailer over SMTP). With no `SMTP_HOST` (or `MAIL_FROM`) the server
  still starts, logs "Mail is off" once and `isConfigured()` is false; callers check it first. In dev, Mailpit catches every mail.
- Time worked (spec 0040): every write of `Courier.status` goes through `CourierRepository.changeStatus(id, status, cause,
  adminUserId?)`, which locks the row and writes the `CourierStatusChange` record in the same transaction; `updateById` drops a
  `status` key at run time. Never write the status another way, or the rider's time worked silently loses that change. A new
  event type that ends a job must be added to `JOB_END_EVENT_TYPES` (`src/domains/time-worked/job-end-event-types.ts`; a guard
  test walks `STATE_MACHINE`), or the job runs on to the delivery's last event. "Shift" means a booked slot (specs 0026, 0027);
  "time worked" and `WorkedShift` mean this spec.
- Earnings (spec 0042): the rider's month, the job detail and the admin card all read `buildWorkedShifts` plus
  `summarisePeriod` (`src/domains/time-worked/`); money counts on the accept day in Athens time. A new figure goes there,
  never into a separate sum, or the screens disagree about the same day. The rider's timeline (`delivery-timeline.ts`) never
  selects an event's `message`, and a job's area is worked out in the repository so the house number never leaves it.
- There are two `NotFoundException` classes: Nest's and the project's (`src/errors.ts`, imported as `errors`).
  `ErrorLoggingInterceptor` skips any project `ApiException` answering 404 (row 121), but Nest's is not one, so an expected
  404 thrown with Nest's is still logged as an error with a stack.
- Prisma's error classes come from the generated client: `import { Prisma } from '@prisma/types'`, then
  `Prisma.PrismaClientKnownRequestError`. Never import them from `@prisma/client/runtime/library`: that is a second copy,
  `instanceof` and `@Catch` never match a real error, and every Prisma error became a 500 until row 121 (a guard test in
  `HttpExceptions.filter.active.spec.ts` fails if the filter goes back). `...OrThrow` throws `NotFoundError`, a subclass.
- Box model (spec 0043): `heldBoxDeliveriesWhere` (`courier.repository.ts`) is the one definition of what a rider holds, used by
  the matcher queries (`boxRoomCondition`), the claim and the admin check. A new way to give a rider work writes through
  `claimForRiderWithinBox` (`delivery.repository.ts`, the rider's row locked, units summed, a write conditional on the units read),
  as the automatic offer and the admin hand offer do; an admin past a full box needs `confirmOverCapacity` and leaves
  `BOX_OVER_CAPACITY_CONFIRMED`. `DeliveryEntity` and `DeliveryWithLocationsEntity` copy columns one by one in their
  constructors: a new `Delivery` column missing there is `undefined` above the repository with no type error (row 9 found it live).
- Fairness matcher (spec 0044): `FAIRNESS` is the default. Its rule is the pure `scoreCandidates` in
  `src/domains/matching/fairness-score.ts` (directions, dead bands, ties), its inputs come from `todayForFairness`
  (one read of every rider's day, tips at 0) and one OSRM `getTableSecondsTo` per offer. Every OFFERED event gets an
  `OfferReason` (`saveOfferedEvent`'s last argument): a new way to make an offer must pass a reason, or an error is
  logged and the offer has none. `OfferReason.candidates` holds other riders' figures: admin only, never a courier route.
  Quotes ask the nearest matcher (they only need to know someone is free).
- Why this offer (spec 0045): a rider reads an `OfferReason` only through `whyYouFrom` (`src/domains/matching/why-you.ts`), an
  allow list per strategy of the rider's own raw values and the weights above 0, via `findOwnLatest` (selects no `candidates`).
  A new matcher or reason key reaches riders only once it is added there; a `centsPerHour` that was the co-op mean (assumed or
  equal) is never sent, since with one qualifying rider it is another rider's pay.
- Shift priority (spec 0049): `fairnessWeightShift` joins the score only while Shifts is on and the bookings could be read
  (`onShiftNow`, "booked now" only); otherwise it is out of the score and the reason. Going Offline mid shift is written only
  by the minute sweep `ShiftOfflineService` (`shift-offline-sweep`) from `CourierStatusChange`, once per change
  (`courierStatusChangeId` unique), never from before Shifts was last switched on. Nothing that matches or pays may read
  `WENT_OFFLINE_MID_SHIFT` (a source guard test fails), and no route counts it per rider.
- Rider accounts (spec 0051): a deactivated rider (`Courier.deactivatedAt`) is refused at every door by
  `AuthDomainService.refuseIfDeactivated` (login after the password, bearer, refresh, `createSessionForUser`) and the socket
  adapter, before the credentials check, with `ACCOUNT_DEACTIVATED`; a new way in must call it too. Matching skips them in
  both candidate queries and `claimForRiderWithinBox` refuses them under the row lock; an accept re-reads the rider with
  FOR SHARE after its take. The admin courier PATCH reads named fields only, because the ValidationPipe has no whitelist and
  would pass any column to an update; every account action writes a `CourierAccountChange` row.
- Monthly statements (spec 0050): the figures are `earnings()` for the month (`StatementService`), never a second sum, so
  they equal the Earnings screen. The PDF's fonts load from `assets/fonts` under the working directory (`FONT_DIR`), not
  `__dirname`, because webpack bundles the code: start the server from the repo root, and ship `assets/` with it. `csvCell`
  guards text that starts like a formula but leaves plain numbers alone. An admin download writes `StatementDownload` and
  the rider's `STATEMENT_DOWNLOADED` change in one transaction.
- Multi leg orders (spec 0046): the rules are the pure functions in `src/domains/delivery/legs.ts`; "a rider holds another leg"
  is `siblingLegHeldSql` (`courier.repository.ts`, built on `heldBoxDeliveriesWhere`), used by the matcher queries
  (`siblingLegCondition`, fed `siblingOfDeliveryId` by every matcher), the locked claim (`SIBLING_LEG`) and the admin paths. A new
  way to give a rider work goes through `claimForRiderWithinBox` or calls `refuseIfCourierHoldsSiblingLeg`; `confirmOverCapacity`
  never bypasses it. A leg order's `orderReference` cannot change, and a leg number used with it stays taken (even cancelled).
- Split at pickup (spec 0047): the one place the backend creates deliveries (the Path A exception in `memory.md`'s ledger), only in
  `SplitRequestService.confirm`'s transaction (the claim, the kept leg, each new leg with a `SPLIT` quote copy, price 0, and its
  `SPLIT_LEG` charge). The rules are pure functions in `src/domains/split/split.ts`. One OPEN request per delivery through
  `openFor`; every close is `closeIfOpen` (conditional on OPEN) and stores `waitOwedAt` when the wait earns pay then;
  `settleSplitWait(requestId)` pays from the stored row and the minute sweep retries a stamp for a day. `saveDeliveryEvent` voids
  an open request on any successful move off `COURIER_ARRIVED_AT_PICKUP_LOCATION`, so a new way to move a delivery needs no extra
  code. The six split events are refused by `processDeliveryEvent`; the ordinary wait leaves out split windows (`splitWindowsUntil`).
- Complaint photos (spec 0052) need MinIO: `./devup.sh` starts it (`docker-compose.db.yml`, console :9001). With MinIO down,
  `MINIO_ENDPOINT` unset or a policy on the `complaints` bucket (rechecked every 5 minutes), a filing with a photo answers 503
  and nothing is saved; text only filings still work. sharp re-encodes each photo; a watcher started before `sharp` was
  installed crashes loading it, so restart only the backend's own process tree.
- The server's texts by code (spec 0054) live in `src/localization/en.ts` and `el.ts`, and each app keeps its own copy to
  word refusals and event messages in its reader's language: mobile (`src/localization`), adminweb (`src/i18n/resources`)
  and request-web (`src/i18n/resources/serverEn.ts`, `serverEl.ts`). Nothing checks the copies against these files, so a new
  code or a renamed param must be copied to all three; an app missing a code falls back to the English `message`, which the
  backend therefore always keeps word for word (binding value 1).

## Agent skills

- Declined: `davidcastagnetoa/skills@fcm-push-notifications` (2026-10-26; another app's Expo guide, its advice contradicts this repo's data only push)
- Declined: an Agent Skill or MCP search for Nodemailer and Mailpit (decision 17.19, 2026-11-19)
- MCP servers: Firebase MCP, `npx -y firebase-tools@latest mcp` (recommended, not connected; useful for row 1's live push check once the co-op has its own Firebase project)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
