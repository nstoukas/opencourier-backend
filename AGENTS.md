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
- Push is off unless `FIREBASE_SERVICE_ACCOUNT_PATH` names a readable service account file; off,
  it logs "push is off" once and offers go over the live connection only. Dev runs with it off.
- Saved customers are personal data: the HTTP logger drops the query string of any `/customers` path,
  `SentryInterceptor` sends no request for any route, refusals are fixed sentences, and admin
  edits log ids only. A new route carrying a customer's details must stay out of logs the same way (spec 0005, AC-9).
- `DeliveryEvent.occurredAt` is when a step happened (a rider's tap, sent late from a phone with no signal, as `tapAgeMs`), `createdAt` when it arrived; earnings count by `occurredAt`. A tapped step with no legal transition is saved as a failed row with its tap time; every other such event is still dropped silently (spec 0009, decision 20.13).
- `tapAgeMs` and any other number a client sends needs `@RefuseIfNotSentAsNumber()`: the ValidationPipe turns `""`, `true` and `false` into numbers before `@IsInt()` runs (row 20).
- The HTTP logger redacts any `search=` value on every route (row 96): a search can be a person's name. A Prisma `contains` does not escape LIKE wildcards; escape `%`, `_` and the backslash yourself, as `delivery-list-filter.ts` does.
- Matching SQL is tested as text; no test here runs SQL against a database, so a wrong `AND`/`OR`
  inside it can pass the suite (decision 61.20).
- Riders exist only through admin `POST /api/admin/v1/courier` (or seeds and dev scripts); there is no public sign up. A
  password set by an admin stamps `User.credentialsChangedAt`, and every token issued before it is refused with 401 in
  `AuthMiddleware` (both branches) and the socket handshake. A new place that turns a token into a user must call
  `isIssuedBeforeCredentialsChange` too, and tokens must carry the stored email (spec 0013).
- A dispatch stop (spec 0014) is a `DispatchStop` row; while one is on, `offerToNextCourier` answers `'STOPPED'` and
  makes no offer, and every other offer path (admin hand offer, reassign, accept, test routes) refuses with 409. A new
  way to start work must check `refuseIfDispatchStopped` too. Start and end work run from a repeatable minute tick
  (one off jobs here never retry) and are marked done only after they ran. Stop times are entered and shown in
  `INSTANCE_TIMEZONE`, and the sentences riders and restaurants read are built on the server (`dispatch-stop-time.ts`).

## Agent skills

- Declined: `davidcastagnetoa/skills@fcm-push-notifications` (2026-10-26; another app's Expo guide, its advice contradicts this repo's data only push)
- MCP servers: Firebase MCP, `npx -y firebase-tools@latest mcp` (recommended, not connected; useful for row 1's live push check once the co-op has its own Firebase project)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
