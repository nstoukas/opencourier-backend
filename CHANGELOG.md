# Changelog — co-op fork of `opencourier-backend`

This fork adapts [Princeton-HCI/opencourier-backend](https://github.com/Princeton-HCI/opencourier-backend)
for a Greek workers' cooperative (Συνεταιρισμός Εργαζομένων, Law 4430/2016) delivering
by moped in Volos. Restaurants pay a flat subscription; couriers are paid piece-rate per
delivery, so pricing and matching are the pay structure.

Everything below sits on top of upstream `main` on the branch `chore/aiflow-pipeline`
(31 commits, 25 July – 5 August 2026). Each entry names its commit, and the commit
message has the full reasoning and verification notes.

Scope row 49 (zero is a valid value for every co-op setting) was built on the branch
`fix/zero-valid-settings` and merged into this one on 30 September. With it the suite is at
**292 passing tests**; typecheck is clean and lint is unchanged.

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

---

## Added

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
- The partner seed gave every instance upstream's fixed API key, which is public in upstream's
  history. It now generates a random key, and a re-seed replaces the old one. `2260c39`

## Removed

- Public partner self-registration endpoint (see the core-change table). `ed3b762`
- `parsePrice`, an unused helper that hard-coded `$`. `f4add7b`

## Housekeeping

- Ignored local scratch files and pipeline artifacts (`.aiflow/`, `plan.md`). `e7e5c50`
- `AGENTS.md`, context for AI coding tools that points at the co-op workspace rulebook, and a
  `CLAUDE.md` that imports it.

---

## Known open items

- Pricing rate and pay floor await ratification by a member vote.
- The fee % has no upper limit, so a mistyped extra zero in admin would multiply every price
  (scope row 53, waiting for the co-op to choose the ceiling).
- Rotate the upstream dev credentials in `local.env` before any real deployment.
- The earnings repository query is still mocked in tests and needs an integration test.
- A `@@index([createdAt, newStatus])` on `DeliveryEvent` is worth adding (schema change).
- Making reassignment fully transactional needs a restructure of `processDeliveryEvent`.
