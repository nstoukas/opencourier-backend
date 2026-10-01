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
| `src/services/delivery-calculation/delivery-calculation.service.ts` | Customer price and rider pay, built from the quote's stored `baseFee` + `distanceFee` (spec 0001) |
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

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
