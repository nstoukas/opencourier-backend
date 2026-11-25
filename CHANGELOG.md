# Changelog — co-op fork of `opencourier-backend`

This fork adapts [Princeton-HCI/opencourier-backend](https://github.com/Princeton-HCI/opencourier-backend)
for a Greek workers' cooperative (Συνεταιρισμός Εργαζομένων, Law 4430/2016) delivering
by moped in Volos. Restaurants pay a flat subscription; couriers are paid piece-rate per
delivery, so pricing and matching are the pay structure.

Everything below sits on top of upstream `main` on the branch `chore/aiflow-pipeline`
(192 commits, 25 July to 2 November 2026). Each entry names its commit, and the commit
message has the full reasoning and verification notes.

Scope row 162 (a key switched off by a reset is shown to admins) was built on the branch `feat/reset-key-note` and merged in on 25 November, in the unattended run. A restaurant's own password reset by email (row 153) removes its API key, and only a log line said so. The User row now keeps `apiKeyRemovedByResetAt` (migration `20261125120000_api_key_removed_by_reset`, one nullable column): set by the reset's key write, only where a key existed, and cleared by every admin write that stores or removes a key. The admin partner DTO carries it (`ea3c02a`, comment fix `3466aa0`). Tests by agy (`cf905b3`, 8549 pass; five put backs checked by hand), a live reset through Mailpit on dev, reviewed by Fable. Keys removed by a reset before the migration carry no note.

Scope row 161 (the partner edit's status check is a conditional write) was built on the branch `fix/partner-edit-conditional-write` and merged in on 25 November. A restaurant's edit (`POST partner deliveries/:id`) read the order, decided (row 152's refusals, the held order's tip, row 160's tip line) and then wrote with a plain update, so a rider's accept landing in between let a point move or a tip change through on an order the rider now held, and two identical edits at once each wrote a `TIP_CHANGED` line. Now the write lands only if the order's status, tip and drop off point are still what the edit read (`updateIfMatches`, spec 0002's race rule). A lost write reads the order again and decides again, so it gets row 152's answer for the new status; after three lost tries the restaurant reads a new refusal, `PARTNER_EDIT_CHANGED`, "This order just changed. Look again before you save." in English and Greek (`691f724`, comment fix `436c32b`). Tests by agy (`2291bf2`, `5d5e81a`, 8538 pass; thirteen put backs checked by hand). Live check on dev: three identical tip edits at once wrote one `TIP_CHANGED` line, where the old code wrote three. Reviewed by Fable. This closes row 160's double line. Still open: a lost write can leave a moved point's new location row unused, and a box size change made earlier in the same try stays, with its own event.

Scope row 160 (a restaurant's tip change is on the record, GA) was built on the branch `feat/tip-change-event` and merged in on 25 November. A restaurant's edit (`POST partner deliveries/:id`) could change the tip, which is rider pay, before a rider holds the order, and nothing recorded it. Now an edit that changes the tip writes one `TIP_CHANGED` event (migration `20261124230000_tip_changed_event`) with the old and new amounts in cents and the order's currency, under the message code `TIP_CHANGED_BY_RESTAURANT` in English and Greek. An edit that keeps the tip writes none, and a held order still keeps its tip (decision 152.4). The line shows on the admin delivery page; riders do not see it, since it is written before they hold the order (`efc49a0`, comment fix `5e305c0`). Tests by agy (`1bce4d9`, 8512 pass; six put backs checked by hand), a live check on dev, reviews by Fable and agy. Still open: two identical edits at the same moment can write the line twice (to close with row 161's conditional write), and a tip sent as an empty string reads as 0 while a fractional one answers 500 (Deferred).

Scope rows 148 to 157, built in the unattended run of 24 November and merged in that night (reviewed by Fable, the GA rows also by agy; tests by agy, every put back checked by hand):
- **Each rider is skipped for exactly the co-op's time (row 148, GA).** A delivery's skip list was one JSON array under one Redis expiry, so each new skip restarted the time for every rider on it. It is now a sorted set scored by each rider's own end time, written by one Lua script (`ZADD GT`, Redis 6.2 or newer), and read through one function by matching and both stacking checks; a new key name, `delivery-skip-list:<id>`. The rider's page drops "at least" (`0edcb0e`; tests `f51c9b4`, `7922f5f`).
- **The job records when its add on leaves (row 149, GA).** A new event type, `ADD_ON_LEFT` (migration `20261124210000_add_on_left_event`), written on the job by one rule in `saveDeliveryEvent` when an add on it joined moves out of an ongoing status before its drop off, while the job is still with the rider who took both, once per parting (`a42f33b`, review fix `f024fc8`; tests `3967a90`).
- **A restaurant's pickup point has a Location row of its own (row 150, GA).** An admin's pickup edit makes a new row instead of updating a possibly shared one; the same address (coordinates within 1e-9 degrees, since the database rounds the last digits, found by the live check) keeps its row (`85234cc`, `de80d29`; tests `8556906`, `9bca209`).
- **A partner edit on an ended or carried order (row 152).** `POST partner deliveries/:id` refuses an ended order (`PARTNER_EDIT_ORDER_ENDED`) and a drop off point move while a rider holds the order (`PARTNER_EDIT_POINT_HELD`), and keeps a held order's tip; notes and times stay editable (`bbc5f4d`, `1d40af2`; tests `1aff8fc`). A tip can no longer be negative on create or edit (`7e13e6d`; tests `7d0fc4f`, from agy's review).
- **A restaurant resets its own password by email (row 153).** Two public partner routes, `forgot-password` (always 202) and `reset-password`, use the riders' codes, limits and mail; the reset saves the password, ends older sessions and switches an API key off in one transaction, and issues no session. Run end to end on dev (`7263551`; tests `971717f`).
- **Offer ended messages (rows 154, 155).** `OfferEndedMessage` carries the ended offer's `offeredAt`, and a rider's accept or decline sends `OFFER_ENDED` with the new reason `ANSWERED` to every phone of the rider (`68d8d9e`, `a1f5e7c`; tests `644ede3`).
- **An index on `waitPayOwedAt` (row 157)** for the wait pay sweep (migration `20261124200000_wait_pay_owed_index`, `7031c00`).

Scope row 147 (how long a declined pair stays apart is a co-op setting, GA) was built on the branch `feat/pair-block-setting` and merged in on 24 November. After a rider declines or misses two orders offered together, the same two were kept from being stacked again for a fixed 20 minutes (`STACK_PAIR_BLOCK_SECONDS`, now deleted). It shapes which orders go out together, so it is now the co-op setting `stackPairBlockMinutes`, its own and not the rider skip time (the operator's choice: it keeps a pairing apart, not a rider): whole minutes 0 to 60, default 20, a missing row read quietly as 20. 0 is a real choice and writes no block at all (Redis refuses an expiry of 0); the operator kept it allowed knowing a pair nobody wants can then go round the riders as the same pair, while each order's skip list still keeps the rider who declined away. `blockStackPair` reads it at each declined or missed pair; a failed read is logged and the decline goes on without a block. It is on the rider's "What changed" list in English and Greek (`a11e2d7`, review fixes `4109a74`; tests by agy, `f6476f5`). Reviewed by Fable and by agy; the findings that held were fixed.

Scope row 146 (the job records when an add on joins it, GA) was built on the branch `feat/add-on-joined-event` and merged in on 24 November. An accepted add on (row 81) joins its rider's job, but only the add on's own OFFERED line said so; a member reading the first order's trail could not see that its rider took a second order on the way. Now the job gets an `ADD_ON_JOINED` event naming the added delivery and the rider who has taken both (message code `ADD_ON_JOINED`, English and Greek), written once the join's transaction has committed and with the job's status as that transaction saw it (`joinAcceptedAddOn` now answers that status, or null when it rolled back). A join that rolls back, a declined or expired add on, and a later step of an add on already joined record nothing; a failed write is logged with both ids and never undoes the join. No status changes, so it never goes through `processDeliveryEvent`. New enum value, migration `20261124120000_add_on_joined_event` The join also requires the added order to be ongoing, so one cancelled in the moment between its accept and the join is never grouped with the job (found by agy's review; older than this row). (`6f5b9f3`, review fixes `0acf294`, `176f818`; tests by agy, `5a49e8b`, `580b416`, `aa46215`). Reviewed by Fable and by agy; the findings that held were fixed.

Scope row 144 (how long a skipped rider waits is a co-op setting, GA) was built on the branch `feat/offer-skip-setting` and merged in on 24 November. A rider who declines or misses an offer, hands an order back, leaves a late restaurant, is removed or is reassigned goes on that order's skip list and is not offered it again for a while. That time was a fixed 20 minutes (`REJECTED_LIST_TTL_SECONDS`, now deleted); it shapes who is offered next, so it is now the co-op setting `offerSkipMinutes`: whole minutes, 1 to 60 (the operator's ceiling, decision 144.3), default 20, 0 refused because a declined order could come straight back to the same rider (decision 144.1), and a missing row read quietly as 20 (decision 144.2). Every add to and removal from the skip list reads it, and a failed read never stops a decline, an expiry, a hand back, a leave wait, a removal or a stack decline: the action goes through without a skip entry and logs it. A failed decline's undo never replaces the decline's own error, and the last rider off a list deletes its key. The rider's "How offers and pay work" page says "for at least N minutes" in English and Greek (each new skip on an order starts the time again for everyone on its list), and the setting is on the rider's "What changed" list (`50f4899`, review fixes `09c4191`, `b92e2ee`, ceiling `3fa06b6`; tests by agy, `97d369c`, `e056724`, `115c8c1`). Reviewed by Fable and by agy; the findings that held were fixed. Checked live on dev: the admin save and its refusals, the rider's page in both languages, and a skip key that ran out on time after a reassignment and after a rider's own decline.

Scope row 141 (failed BullMQ jobs are retried, GA) was built on the branch `fix/bullmq-retries` and merged in on 24 November. Since row 139 a job whose handler throws is marked failed, but no job was ever tried again, so one database blip could leave an offer that never expired, a delivery nobody retried, or a day's retention delete skipped. Now every job is added with the same retry options (`JOB_RETRY_OPTIONS`: 3 tries, 5 s then 10 s apart, then kept in the failed list for 7 days), and no caller can set its own. The failed list holds the described error (name and summary, never a Prisma message), and the log says which try failed. BullMQ makes each run of a repeating schedule from the run before it, options included, so a schedule saved without these options is replaced once at startup; on dev that first comparison was done as JSON text and replaced every schedule on every start, because Redis returns the keys in another order, and it now compares field by field. Every handler was read for a second run: each checks its state first or writes conditionally. When one delivery of a stacked offer ends and the other's write fails, the ended one is still followed up (its `OFFER_EXPIRED` event, the rider told, its backstop) and the other is left to its own expiry job; the offer insist lookup now retries instead of giving up (`b756ae1`, review fixes `5013d4f`, `92b87c8`, `8d5f1ef`; tests by agy, `61dd705`, `d104538`). Reviewed by Fable and by agy; the findings that held were fixed. The retry numbers are operational, so they live in code, not on Instance configuration (decision 141.1).

Scope row 143 (a failed transition's event note keeps the raw error message) was built on the branch `fix/transition-failed-note` and merged in on 24 November. A step that could not be applied is recorded as a `TRANSITION_FAILED` event whose note riders and admins read; it held the raw error message, and a Prisma error's message can repeat a name and phone. The note now goes through `errorNoteForRecord`: this codebase's own sentence unchanged, a Prisma error by its name and code only (`36748ad`; tests by agy, `f774184`).

Scope row 140 (the drop off business name in offers), the backend part, was built on the branch `fix/business-name-in-offers` and merged in on 24 November. `DeliveryCourierDto` sends `dropoffBusinessName` only once the rider has accepted, like the customer's name (decision 140.1): request-web used to copy the customer's name into it, so offers named the customer before an accept. The admin dispatch board's customer label falls back to the customer's name when the business name is empty or only spaces (`6bfcadd`, review nit `fa58c24`; tests by agy, `5ee4f9f`). Reviewed by Fable.

Scope row 139 (errors in the other log calls) was built on the branch `fix/error-log-calls` and merged in on 24 November. Row 132 cleaned the three central places; now every log call in the backend writes an error through `errorSummaryForLog` and `describeErrorForLog`, never by `${error}`, its `.stack` or the whole object, so no Prisma message (which can repeat a name or phone) reaches a log line, including the two calls on people's text (an issue report and chat). The BullMQ processor, which logged nothing (its `.catch(this.logger.error)` lost its `this` and threw), now logs the job's name and the summary, then fails the job. A compiler based guard test over `src/` fails on any new raw use of a caught error (`528adf2`, review fixes `b1e1728`, nits `7cdffd0`; tests by agy, `0cb9374`, `1acdbc8`, `9a0d0e2`). Reviewed by Fable; the major (the first guard missed three shapes) was fixed by a second agy run.

Scope row 137 (the screenshot tour's leftovers), the backend part, was built on the branch `fix/how-it-works-greek` and merged in on 23 November. The rider's "How offers and pay work" page and its "What changed" list can now be read in Greek: `GET courier/v1/how-it-works` and `GET courier/v1/setting-changes` take `?lang=el` or `?lang=en`, and anything else, or nothing, reads English exactly as before, so older apps see no change. Every sentence of the page is one entry of a words object per language (`EN_WORDS`, word for word the old English, and `EL_WORDS` in `work-rules.el.ts`), and every rider facing setting has a Greek label and value wording (`RIDER_FACING_SETTINGS_EL`, the same 46 keys, a test compares them). The Greek uses the app's own words, Greek money ("2,00 €") and each removal reason's Greek label (`0c31fd3`, review fixes `3250f0b`; tests by agy, `6469534`, and by a Fable subagent while agy was out of quota, `52d31e9`). Reviewed by Fable; both majors (the "What changed" list, the Earnings figure names) were fixed.

Scope row 132 (whole error objects in the error logs) was built on the branch `fix/error-log-details` and merged in on 23 November. Errors are now logged by one helper, `describeErrorForLog`: the error's name and code, its message only when it is not a Prisma error (a Prisma validation error repeats the call's data, a recipient's name and phone included), the model and field names of a Prisma error when they are text, and the stack's frames without its header. The request interceptor, the global filter and the crash handlers use it, and the unhandled rejection handler no longer prints the promise. A new catch all filter (`UnknownErrorsFilter`) answers as Nest's default handler did and logs through the helper, because Nest's handler logged an uncaught Prisma error whole (found by review, proved in a real Nest app: the name and phone twice before, never after). (`bcadc8f`, review fixes `06d15cc`; tests by agy, `17b2ced`, `d582af2`, `072c325`). Reviewed by Fable; the blocker and four minors were fixed; the other service log calls and Sentry are queued in the scope.

Scope row 128 (auto accept takes stacked pairs, GA) was built on the branch `feat/auto-accept-pairs` and merged in on 23 November, on the operator's decision. An accept with `automatic: true` on a stacked offer now takes both orders, like a single order: both `ACCEPTED` events go through `processDeliveryEvent` with the new message code `ACCEPTED_TOGETHER_AUTOMATICALLY` naming the other order, and the partner order is read after the pair is taken, so an order that changed in between is never left out. An add on is still refused (409), and the box limit and the cap of two were already checked when the pair was offered. `STACK_NOT_AUTOMATIC` is gone; the rider's work rules say auto accept takes a pair; spec 0048's AC-8 is amended (`0362ff8`, review fixes `e4c6e98`; tests by agy, `92873d3`). Reviewed by Fable and by agy; the findings that held were fixed.

Scope row 126 (a reply taken by phone keeps its admin) was built on the branch `fix/reply-entered-by-admin` and merged in on 23 November. An admin can enter a deactivated rider's complaint reply heard by phone, but `replyEnteredByUserId` goes null when that admin's account is deleted, and the reply then read as the rider's own words. A new column, `Complaint.replyEnteredForRider` (migration `20261124010000_complaint_reply_entered_for_rider`, with a backfill and a CHECK that a named admin means the flag is set), is written with the admin's id, and both the rider's and the admin's complaint replies read it (`8e90cb9`; tests by agy, `8f63fd9`). Reviewed by Fable: Approve with nits, no code change.

Scope rows 47 (Greek interface, spec 0054, Beta) and 124 (its loose ends) were built on the branches `feat/greek-interface` and `fix/greek-loose-ends` and merged in on 23 November. Each person now has a language, `User.language` (`el` by default, migration `20261124000000_greek_interface`): a rider sets it with `PUT courier/v1/courier/language`, the web apps with `PUT partner/v1/auth/language` and `PUT admin/v1/auth/language`, and every login and `/me` answer carries it. The delivery record is kept as codes: every `DeliveryEvent` writer names one of the codes in `src/shared-types/event-messages.ts` with its values (new `messageCode` and `messageParams`), and still writes the English `message`, rendered from the same code word for word as before, so logs and older readers keep working while each app shows the record in its reader's language. The server's own texts live in `src/localization/en.ts` and `el.ts`: the email change notice goes out in the reader's language, and the reset code mail leads with it (both languages kept, the Greek now in the polite plural). Refusals answer with a specific code (the 89 fixed sentences, mapped in `src/localization/error-sentences.ts`; a generic code on a known sentence becomes the specific one, UNAUTHORIZED and FORBIDDEN never change), and the ones carrying a number, a time or a name send it in `params`, as do the dispatch stop banners, a restaurant's not accepting reason and the Dispatch board's rows. Push notices needed no change: they carry codes and ids, and the phone words them. Removal reasons gain a Greek label (`labelEl`; the migration fills the seven defaults), and the two chat preset settings hold `{ el, en }` per preset (a plain text from an older admin page is taken as the Greek). Row 124 adds `shiftStartsAt` and `shiftEndsAt` to the admin "Offline during a booked shift" item, so adminweb words the shift in its reader's language; `shiftText` stays, unchanged. Two guard tests come with it: no hand typed event message, and both languages complete with every code a template. Commits `a495a16` to `a282402` and `010f055`; tests by agy, `f26c209`, `fa3354d`. Reviewed by Fable (row 47) and a fresh Opus session (row 124); the findings that held were fixed. The Greek waits for a Greek speaking member's check before go live (scope row 127).

Scope row 81 (mid job add on offers, spec 0048, GA) was built on the branch `feat/add-on-offers` and merged in on 22 November. A rider already on a job can be offered one more waiting order on the way, with the km and minutes it adds; declining is free and leaves the job as it was, the phone never accepts it by itself, and each add on is paid its own full fee from its own quote, as full fee per leg is a safety rule. The switch is off by default: the co-op settings `addOnOffersEnabled` (false) and `addOnMoment` (`BEFORE_PICKUP` | `BEFORE_DROPOFF` | `SAME_RESTAURANT`, default `BEFORE_PICKUP`); the Fixed courier matcher (the override) never makes add ons, an add on offer always has a deadline even with offer expiry off, and while the rider carries food it comes calmly with twice the time to answer. Each offer records an `ADD_ON` `OfferReason` saying why (the policy and whether a free rider was passed over), an accepted add on joins the job under one `offerGroupId` and stop list or goes on alone, and row 80's box and two order limits apply. Migration `20261123030000_add_on_offers` (`c9d9286` to `666644d`, Fable review fixes `8a0df67` to `2a1fcf0`, agy review fixes `eaf23ca`, `6a3720c`; tests by agy, `0fdf7fa`, `bb70bb0`, `f9f65d0`). Reviewed by Fable and, as a GA row, by agy; every finding was ruled and the ones that held were fixed.

Scope row 80 (stacked orders, spec 0048, GA) was built on the branch `feat/stacked-orders` and merged in on 22 November. In a busy hour two waiting orders can be offered together to one free rider, who sees both pickups and both drop offs in order and takes or declines the pair; each order in a stack is paid its own full fee, as full fee per leg is a safety rule. A pair must fit one box, never be two legs of one order, come from one restaurant or two whose food is already marked ready, and delay neither customer more than the co-op's limit; no rider ever holds more than two orders, and a pair is never accepted automatically. Both switches are off by default: the co-op settings `stackingEnabled` (false), `twoOrderPolicy` (`SHORTAGE_ONLY` | `WHENEVER_FITS`, default `SHORTAGE_ONLY`) and `twoOrderDelayLimitMinutes` (0 to 30, default 10); the add on settings come with row 81. A stack's two deliveries share an `offerGroupId` and each gets its OFFERED event with a `STACK` `OfferReason`; accepting either accepts both in one transaction or answers 409 and changes nothing, declining or expiry ends both, and a partner that leaves another way leaves the other order offered alone. The stored `stopSequence` feeds the courier route endpoint's numbered stops, one push goes per stack, and the dispatch board and the delivery page show the pair. The limit of two counts with the matchers' own busy rule, a taken offer included while its ACCEPTED lands. Migrations `20261123010000_stacked_orders` and `20261123020000_stack_stop_sequence` (`e87dd35` to `a598685`, Fable review fixes `4d43d83` to `7b709ba`, agy review fixes `79902bc`, `c04c08f`; tests by agy, `5850796`, `2871216`, `7a00158`). Reviewed by Fable and, as a GA row, by agy; every finding was ruled and the ones that held were fixed.

Scope row 82 (courier notes on addresses, spec 0053, Beta) was built on the branch `feat/address-notes` and merged in on 22 November. A note about a place now sits on the drop off point as riders corrected it (new `Delivery.dropoffCorrectedLatitude`/`dropoffCorrectedLongitude`, written by the rider's pin move, cleared by a restaurant's later move, and filled for earlier moves by the one off `scripts/backfillDropoffCorrectedPoint.ts`) and shows on the job card of every rider holding a job within 30 m, at most 10 per stop, newest confirmed first, never with its author; upstream's courier `POST location-notes` takes `deliveryId` + `stop` on a held job and answers 422 `PERSONAL_DATA_WARNING` when the text looks like a phone, an email or a first name unless the rider confirms, `react` refuses a downvote, and a rider can flag a note once. A note no rider other than its author upvotes within the co-op setting `addressNoteRetentionDays` (30 to 730, default 182) leaves the job cards and is deleted by the nightly BullMQ job `address-note-retention` (03:30 Athens), which logs counts only; admins find, dismiss flags on and delete notes at `admin/v1/address-notes`, each deletion recorded without its text. Migration `20261122230000_address_notes` (`239d76f` to `e19d3a8`, review fixes `1cc64de` to `346c243`; tests by agy, `0539703`, `4fb0dc1`).

The cross family review (agy, `/crosscheck review`) that rows 79, 10 and 11 owed was given on 22 November, and its fixes, built on the branch `fix/agy-owed-reviews`, were merged in the same day. Row 79: the shift offline sweep judged every Offline change without a record again each minute for 6 hours, so a lowered `shiftBreakMinutes` could turn a break already judged into a `WENT_OFFLINE_MID_SHIFT` record. It now keeps the end of the window it last judged in Redis (`shift-offline-sweep:judged-up-to`, 24 hours) and judges each change once; a change whose check fails holds that mark 1 ms before it, so the next tick tries it again, and with no mark (first run, Redis emptied, a server down over a day) the 6 hour look back applies as before. Rows 10 and 11 needed no backend change (`cfe6caf`; tests by agy, `7a8d4a8`).

Scope row 83 (complaints both ways with no ratings, spec 0052, Beta) was built on the branch `feat/complaints` and merged in on 22 November. A rider files a complaint about the restaurant or the customer of a past job (`POST courier/v1/complaints`: a fixed category per party, 1 to 1000 characters, one optional JPEG or PNG photo up to 5 MB, re-encoded with sharp so its metadata goes and stored in a private MinIO bucket, read only through the rider's and the admins' photo routes); a restaurant (`partner/v1/complaints`) or an admin files one about a rider, who is told by a quiet push and replies once (`POST courier/v1/complaints/:id/reply`), and no admin can record a decision before that reply (409), though an admin may withdraw a complaint at any time or enter the reply for a deactivated rider. The rider, the filer and the admins see the outcome; nothing counts, lists or scores complaints per rider (the rider's own page pages by has-more with no total, and a guard test fails if the courier admin DTO or any matcher, fairness or pay code reads complaints), and every step is recorded on the complaint row with who and when, no `DeliveryEvent`, as a complaint changes no status, pay or assignment. `StorageProvider` is now put / getStream / delete with a MinIO implementation that refuses a bucket carrying an access policy (rechecked every 5 minutes); MinIO joins the dev docker set, pinned by digest. Migrations `20261122100000_add_complaints` and `20261122200000_complaint_photo`; new package `sharp` 0.34.5 (`91a5fc8` to `deec55b`, review fixes `bda671e` to `0e47f6a`; tests by agy, `c6480a2`, `c464087`).

Scope row 11 (split at pickup, spec 0047, GA) was built on the branch `feat/split-at-pickup` and merged in on 21 November. The one human exception queue the locked decisions keep, and the declared exception to Path A: the backend creates the extra legs itself. A rider at the restaurant flags an order that does not fit one box (`POST courier/v1/deliveries/:id/split-requests`, 2 to 4 boxes with a size each; 409 off the restaurant, with one already open, or past 4 legs in all); while it is open their Picked up and leave wait answer 409. Admins answer from a queue (`admin/v1/split-requests`, a count, each row's leave time): confirm as proposed or changed, or refuse ("It fits", with a sentence for the rider). A confirm, in one transaction, claims the request, keeps leg 1 with the rider (its size rechecked against their box), creates each other leg as a new delivery with a `SPLIT` copy of the quote (customer price 0, the same rider pay), and charges the restaurant that pay per leg (`SPLIT_LEG`, taken back with an event if the leg ends never accepted); the legs go to matching after the commit, and the minute sweep starts any left in CREATED. The rider's wait from the flag is paid at the wait rate with no free minutes (`SPLIT_WAIT`), charged to the restaurant on a confirm or a leave and paid by the co-op on a refusal or a void; the ordinary wait leaves those minutes out. Past the co-op's `splitAnswerMinutes` (default 10) the rider may leave: the order is cancelled as the restaurant's, with spec 0015's pay and charge. Any step that moves the delivery off the restaurant status closes an open request as VOID and pays its wait. A stamp (`waitOwedAt`) keeps the wait owed until pay, event and charge exist, and the minute sweep retries it for a day. Answers reach the rider by socket and push; the restaurant reads `splitOutcome`; every request, answer, close, payment and charge is an event. Migrations `20261121200000_split_at_pickup` and `20261121230000_split_wait_owed` (`c6fbcb7` to `3ad1635`, review fixes `a696724`, `e90dbeb`; tests by a Fable subagent while agy was out of quota, `869bc12`, `1278171`). Owes a cross family review (`/crosscheck review`) once agy is back.

Scope row 10 (multi leg orders, spec 0046, GA) was built on the branch `feat/multi-leg-orders` and merged in on 21 November. An order too big for one box is sent as N ordinary deliveries ("legs") sharing the restaurant's `orderReference`, each with its own quote, rider and full pay (full fee per leg is a safety rule). `Delivery` gains `legNumber` and `legCount` (both null, or 2 to 4 legs; a CHECK and a unique index on partner, reference and leg number; migrations `20261121150000_multi_leg_orders` and `20261121180000_multi_leg_labels_check`). The partner create answers 400 for one label alone, out of range or with an empty reference, and 409 for a leg already sent or a count that disagrees with its siblings (two creates of one leg at the same instant: one 201, one 409). A leg's reference cannot change. No rider holds two legs of one order at once: the matcher queries leave such a rider out, the locked claim refuses it (the Static matcher's leg waits; an admin hand offer is 409 whatever `confirmOverCapacity` says), and reassign checks before writing. The offer push and the courier, partner and admin answers carry the labels (`''` in the push for a single delivery); the admin delivery page lists the order's legs and the leg numbers never sent; `GET partner/v1/deliveries/:id/order-legs` gives request-web the same (`6e5dd4e`, `4753c02`, review fixes `ce8d7fe`; tests by a Fable subagent while agy was out of quota, `d1997fb`, `62d05eb`). Known open: reassign's check is not under the rider lock (as decision 9.11). Owes a cross family review (`/crosscheck review`) once agy is back.

Scope row 76 (monthly statements, spec 0050, Beta) was built on the branch `feat/monthly-statements` and merged in on 21 November. A rider downloads a statement for any finished month since they joined (and since the time record began): `GET courier/v1/earnings/statements` lists the months, `GET courier/v1/earnings/statements/:month?format=pdf|csv&lang=el|en` streams the file (`no-store`, named `statement-YYYY-MM.*`); the current month, a month before joining or a bad format answer 400. The figures are row 75's earnings for the month, so they equal the Earnings screen: each job (day, restaurant, drop off area, paid km only on a job paid by km, minutes, how it ended, delivery pay, tips, each kind of extra payment, total), money not linked to a job per day, the month's totals, € per hour and € per paid km, and time worked ("not recorded" when there is none). The PDF is A4 landscape with Noto Sans embedded so Greek prints (`pdfkit` 0.20.2, the font's OFL licence in `assets/fonts`); the CSV has a BOM, every cell quoted, text that starts like a formula guarded and plain numbers left as numbers. An admin reads the same months and files for a rider; each admin download writes a `StatementDownload` and, in the same transaction, a `STATEMENT_DOWNLOADED` account change the rider sees. Migration `20261121120000_statement_downloads` (`f79b256`, review fixes `9a5c626`, `4f1ce1b`; tests by a Fable subagent while agy was out of quota, `38d08e3`, `d394233`). Not built: a note for amounts in another currency, and a per payment list of compensations (decision 76.3).

Scope row 108 (rider account upkeep, spec 0051, Beta) was built on the branch `feat/rider-account-upkeep` and merged in on 21 November. An admin can deactivate a rider who left (`POST admin/v1/courier/:id/deactivate`, a reason required): refused while they hold a job, have an open SOS or are an admin; otherwise in one transaction under the rider's row lock their sessions end, bookings that have not ended are dropped with an event naming the admin, and the change is recorded; then the cut off sets them Offline (cause DEACTIVATED). Every door (login, bearer, refresh, socket, a reset) refuses them with `ACCOUNT_DEACTIVATED`; matching skips them and the offer claim refuses them under the lock; an accept already in flight re-reads the rider under FOR SHARE and gives the take back. Reactivate clears the password and sets Offline. The admin edit now copies only named fields (it passed the whole body to the update before) and records each change in `CourierAccountChange`, which riders read as "the co-op"; a changed login email ends sessions and mails the old address. Riders change their own password (`POST auth/change-password`) and keep their emergency contact on the server. `CREDENTIALS_CHANGED` is now its own code. Migration `20261121090000_rider_account_upkeep` (`fb58d07`, review fixes `78f1681`; tests by a Fable subagent while agy was out of quota, `fb0bbb2`, `cd63807`).

Scope row 79 (shift priority in dispatch, spec 0049, GA) was built on the branch `feat/shift-priority` and merged in on 21 November. A fourth fairness weight, `fairnessWeightShift` (0 to 100, default 0), applies only while Shifts is on: riders on a BOOKED shift covering the moment get 0 on the factor, others 1, never scaled; off, or when the bookings cannot be read, it is out of the score and the recorded reason, and it never counts toward the "not all three 0" rule. The reason records `onShift`, which riders may read. Going Offline during a booked shift is recorded by a minute sweep (`shift-offline-sweep`) as `WENT_OFFLINE_MID_SHIFT` when the rider stayed Offline past the break limit, outside the shift's last 10 minutes, and never from a time Shifts was off; one event per status change (unique). Admins follow items up (`admin/v1/shifts/offline-events`), riders read their own in the shift schedule (`offlineRecords`); nothing that matches or pays reads them. Migration `20261121060000_shift_offline_event` (`cb2cf00`, `70f0320`, `4aab1ea`, review fixes `da3216f`; tests by a Fable subagent while agy was out of quota, `3c10192` and the review fix tests). Owes a cross family review (`/crosscheck review`) once agy is back.

Scope row 14 (why this offer, for couriers, spec 0045, Beta) was built on the branch `feat/why-this-offer` and merged in on 21 November. A rider's job detail in Earnings (`GET courier/v1/earnings/deliveries/:id`) carries `whyYou`: the reason recorded for the offer they last accepted (up to that accept plus 5 seconds), cut down by an allow list per matcher to the rider's own raw figures and the weights above 0. Never another rider's figures, a score, a scaled value or a count of riders compared; the read never selects `candidates`, and a pay per hour that was the co-op mean (assumed or equal) is not sent. How offers and pay work now ends each matcher's text with "See why a job came to you on its page in Earnings" (`85a0aab`, review fixes `0a8b59a`; tests by a Fable subagent while agy was out of quota, `5d1555a`, `bc2555a`).

Scope rows 12 and 13 (the fairness matcher and its weights, spec 0044, GA) were built on the branch `feat/fairness-matcher` and merged in on 21 November. A new matcher, `FAIRNESS`, is the default (a data migration moved the stored Nearest or Seniority to it, with a `SettingChange` row). Among the nearest free riders (10 by default) it scores road time to the restaurant (one OSRM table call; every rider estimated at 20 km/h if it fails), what the co-op paid the rider per hour online today (tips never count; under 30 minutes online counts as the co-op mean) and the waiting since their last job or going Online, each scaled across the riders compared with small differences counted equal, weighted by five co-op settings (road 50, pay 30, waiting 20; the three cannot all be 0). Every offer, from any matcher or an admin, now writes an `OfferReason` beside its OFFERED event: the matcher, the weights, the chosen rider's numbers and every rider compared (admin only), shown on the admin delivery answer. The How offers and pay work page words the matcher from the live settings, and two of its promises were reworded to say how riders are compared. A replay of 20 riders and 150 orders narrows the spread of pay per hour from 14.25 €/h (nearest only) to 1.63 €/h, with the mean road time about the same. Reviews fixed waiting across midnight, the dead band's edge, quotes (they ask the nearest matcher) and a fallback when the day's figures cannot be read (`6e76f51`, `b37d4d8`; tests by agy `9f40791`, `a984121`). Known open: a retention rule for the distances kept in `OfferReason.candidates` (decision 12.10).

Scope row 9 (the box model, spec 0043, GA) was built on the branch `feat/box-model` and merged in on 21 November. Every delivery now carries its box size (Small, Medium or Large, picked by the restaurant) and the box units it takes out of a rider's 100, copied from the co-op's settings when it is made (`boxUnitsSmall` 30, `boxUnitsMedium` 50, `boxUnitsLarge` 100, placeholders until the field study; `boxDefaultSize` Medium). An order sent with no size counts as the default and is recorded as `BOX_SIZE_ASSUMED`; a restaurant may change the size until a rider is offered the order (`BOX_SIZE_CHANGED`, 409 after). The matcher never offers a rider more than a full box: held units (accepted jobs up to the drop off, the open offer, food carried back after a cancellation) are a condition in both matcher queries and are summed again at the claim under a lock on the rider's row, which the admin hand offer now goes through too. An admin who assigns past a full box gets 409 `BOX_OVER_CAPACITY` with both numbers, and only a confirmed retry goes ahead, recorded as `BOX_OVER_CAPACITY_CONFIRMED` naming the admin. Migration `20261120180000_box_model` adds the three columns and backfills old orders as assumed Medium, 50 units. The live check found two bugs no test could (`make_interval` refusing a bigint, and the entity not copying the new columns); the reviews found an unlocked admin path and an accept window, both fixed (`87710a3`, `348ae67`, `7537019`; tests by agy `d368fe7`, `172c9d3`). Known open: the admin reassign still checks before its write (decision 9.11).

Scope row 121 (the global error filter matches Prisma's errors) was built on the branch `fix/prisma-error-filter` and merged in on 20 November. `HttpExceptionFilter` and `prisma.util` compared errors with the `PrismaClientKnownRequestError` from `@prisma/client/runtime/library`, but the client is generated into `prisma/client` with its own copy of that class, so the filter never matched a real Prisma error and Nest answered 500. They now use the generated client's class (`Prisma` from `@prisma/types`), so a "no such row" from any `...OrThrow` read or an update of a missing row answers 404 `NOT_FOUND`, and a unique constraint answers HTTP 400 `UNIQUE_CONSTRAINT` (it sent status 404 with a body saying 400). Probed on dev with the fix stashed and back: admin `GET deliveries/:id`, courier `POST deliveries/:id/accept` and `/reject`, courier `GET location-notes/:id`, partner `POST deliveries/:id/food-ready` and partner `GET delivery-quotes/:id` went from 500 to 404 for an unknown id, and an admin courier edit to another rider's phone from 500 to 400. Any other Prisma error the filter answers now carries code `UNKNOWN` where Nest's default gave `ERROR`; no client keys on either. `isRecordNotFoundError` also recognises a P2025 by name and code. Logging: `ErrorLoggingInterceptor` no longer logs any `ApiException` answering 404 (it skipped only `NotFoundException`); a Prisma missing row leaves one warning with the method and the route pattern, never the URL; a failed accept (`DeliveryCantBeAcceptedException`) warns where it is thrown; the filter prints only the unexpected 500 case. Reviewed by Fable (approve with nits, both minors fixed); tests by agy, including a guard that fails if the filter's class stops matching the generated client, each important one shown to fail with its bug put back. Commits `ff72723` to `d6ee929`. With it the suite is at **5173 passing tests**.

Scope row 119 (a rider's unknown delivery answers 404, decision 75.40) was built on the branch `fix/unknown-delivery-404` and merged in on 20 November. `GET courier/v1/deliveries/:deliveryId` let Prisma's "no such row" error escape as a 500 for an id that is not one of the rider's deliveries (an unknown id, another rider's delivery, or the deleted `deliveries/done` path). It now answers 404 `DELIVERY_NOT_FOUND` "Delivery not found", with the same catch `getRoute` uses, so both routes give the same body; any other error is thrown on unchanged. Seen live: own delivery 200, the three others 404, and 500 again with the fix stashed. Reviewed by Fable (approve with nits, ruled); tests by agy, each shown to fail with its bug put back. Commits `d5b0636` to `b1f4a73`. With it the suite is at **5141 passing tests**.

Scope row 75 (earnings and one merged history, spec 0042) was built on the branch `feat/earnings-history` and merged in on 20 November. Earnings now reads from row 36's shift builder, so money counts on the day a job was accepted, in Athens time, the same day rule as time worked. `GET courier/v1/earnings?month=YYYY-MM` gives each day and each week of the month with four figures (€ per hour worked, € per hour on a job, € per paid km, the median pickup wait) and every job row: accept time, restaurant, drop off area (the town, never the house number), paid km (a quote in miles converted), minutes, money and an end label; a week is worked out from its own jobs, never as an average of its days. A rider reaches back 2 months (`reachFrom`); a month wholly before it, after this month, or not `YYYY-MM` answers 400 with a sentence. `GET courier/v1/earnings/deliveries/:deliveryId` gives the pay breakdown (base and distance fee only when they add up to the pay, tips, each extra payment, "added later" when paid after the shift ended) and the delivery's timeline as the rider may see it: their own steps, the restaurant, dispatch and the system, another rider's accept as one line naming nobody, and never an event's message. A delivery the rider never held, or held last before the reach, answers 404, logged as the project's own `NotFoundException` rather than as an error (review fix). The admin route `admin/v1/courier/:id/time-worked` carries the same figures and job fields with no reach; the co-op totals, `time-worked/current` and the courier admin answer carry none of them, and guard tests keep it so. How it works gains `earningsFigures`. The five old routes are deleted with what only they used: `courier/earnings-summary`, `courier/earnings/day`, `courier/earnings/delivery/:id`, `deliveries/done` and `time-worked?from&to` (`deliveries/done` now answers 500 through the older `deliveries/:id` bug, decision 75.40, listed below). No migration. Reviewed by Fable (approve with nits), every finding ruled and the accepted ones fixed; tests by agy, each important one shown to fail with its bug put back. Commits `e21e63a` to `001e320`; decisions 75.30 to 75.46. With it the suite is at **5132 passing tests**.

Scope row 53 (an upper limit on the co-op fee %, spec 0041, GA) was built on the branch `feat/fee-ceiling` and merged in on 20 November. The co-op fee % is added to every customer's delivery price and any number from 0 up used to save, so a typo (100 for 10) would have multiplied every price. A new co-op setting, `feePercentageCeiling` (whole numbers 0 to 100, default 25), caps it: a save that would leave the fee above the ceiling is refused with "feePercentageAmount can be at most 25, the co-op's fee ceiling (feePercentageCeiling). Raise the ceiling first if the co-op decided a higher fee.", and a save that lowers the ceiling below the fee in effect is refused naming the fee. The check (`assertFeeWithinCeiling`) runs inside the settings save's transaction, after its advisory lock and before any write, against the values in effect after the save, and only when the save sends the fee or the ceiling, so a stored fee above the ceiling never blocks an unrelated save and quoting never refuses. The ceiling is itself a setting, so the co-op raises it from admin when the assembly votes a higher fee. Decisions 53.1 to 53.3; reviewed by Fable and agy, whose fixes are in `72b5ca2`.

Scope row 36 (paid and unpaid time per shift, spec 0040) was built on the branch `feat/time-worked` and merged in on 20 November. Every change of a rider's status now writes one `CourierStatusChange` row (from, to, cause, the admin when one acted) in the same transaction as the change, through `CourierRepository.changeStatus`, now the only writer of `Courier.status` (migration `20261119200000_courier_status_changes`, which opens the shifts already running with `SYSTEM_START` rows). `ACCEPTED` events keep the accepting rider in `courierId`. From those records `buildWorkedShifts` works out, on read and never stored, each rider's worked shifts, breaks shorter than the co-op setting `shiftBreakMinutes` (0 to 240, default 30), and the split of work time into job time, paid waiting and unpaid time, with the money of each shift and Europe/Athens day totals. Five routes: `courier/v1/time-worked`, `/current` (the home counter) and `/coop-totals` (a week with fewer than 3 riders shows no figure), `admin/v1/courier/:id/time-worked` and `admin/v1/time-worked-totals` (no rider id in any row). The How offers and pay work page says how time worked is counted and that admins can see it. A fresh model review asked for four fixes (`8f15bce`): a job cancelled after pickup whose return was never answered now ends at the cancel instead of at the delivery's last event; a job from before recording began is dropped; a zero length job outside every shift has its money counted as money outside a recorded shift; and an admin's Offline ends the rider's open offers before the other fields are saved. Decisions 36.35 to 36.49. The two indexes the review suggested for these reads, `DeliveryEvent(courierId, type)` and `DeliveryEvent(deliveryId)`, were added afterwards with the operator's yes (migration `20261120120000_delivery_event_indexes`, decision 36.47).

Scope row 17 (the courier app locked to the co-op instance, spec 0039) was built on the branch `feat/coop-instance-reset` and merged in on 19 November. A rider who forgot their password can reset it by an emailed 6 digit code. `POST api/courier/v1/auth/forgot-password` answers 202 with an empty body at once, for any email, and does the work afterwards, so neither the answer nor its timing tells whether an email belongs to a rider; only a rider (not an admin, not a restaurant) gets a code, mailed to the stored address in Greek then English, never in the subject. The code is kept only as a keyed hash in Redis for 15 minutes: one code a minute and five an hour per account, five tries per code and ten tries per account per day (decision 17.21, added after the review), every guard one step in Redis so parallel requests cannot pass one twice. `POST .../reset-password` claims the code once, saves the new password, cuts the old phones off the way an admin password change does (sockets closed, push devices removed, set Offline; a held delivery stays theirs) and answers like login. That cut off moved unchanged into its own `CourierCutOffModule`, shared with the admin route. Mail goes over SMTP with Nodemailer; with no `SMTP_HOST` the server starts, says "Mail is off" once and the route answers 503. In dev, Mailpit catches every mail (`./devup.sh` starts it, inbox on :8025). No log line carries an email, a code or a password. Checked live on the dev instance, reviewed by Fable, every finding ruled; tests by agy, each important one shown to fail with its bug put back. With it the suite is at **5012 passing tests**; typecheck passes.

Scope row 30 (Platform Work Directive readiness, spec 0038, GA) was built on the branch `feat/platform-work-directive` and merged in on 19 November. A rider can ask a person to review any decision about their work (`POST`/`GET api/courier/v1/review-requests`, `POST .../:id/withdraw`): about a delivery they were offered or held (any other answers 404), or in general, with a topic and a note. Its due date is fixed when it is sent (`reviewAnswerDays`, a co-op setting, 1 to 14 days, default 14), a second open request on the same delivery answers 409, and overdue is worked out when read, never by a job: nothing answers, closes or decides a request on its own. Admins list, count and answer them (`api/admin/v1/review-requests`, `/count`, `/:id`, `/:id/answer`) with an outcome (`STANDS` or `CHANGED`) and a reason; on a changed answer about a delivery they may add a pay correction, above 0 and at most `reviewCorrectionMaxCents` (default €50), paid to the rider who asked, in the delivery's currency. The answer, the `REVIEW_ANSWERED` event, the `CourierCompensation` (reason `REVIEW`, unique `reviewOf`, so one review pays at most once) and the `COURIER_PAID_FOR_REVIEW` event are written in one transaction behind a conditional write on `OPEN`; a second answer or one racing a withdrawal gets 409. The three review events are saved with null statuses, so no drop off or transition reader counts them, and no event, log line or push carries the rider's note or the admin's answer. A correction shows in the rider's earnings on the answer day as `REVIEW_CORRECTION` and as `reviewPay` on the delivery, never counted as a delivery and without the customer's address. A `REVIEW_ANSWERED` push (the request id only) goes to the rider's phones unless they are Offline. `GET api/courier/v1/how-it-works` builds the explanation page's sentences from the settings in effect. Every save of Instance configuration now runs in one transaction under an advisory lock and writes a `SettingChange` for each value that really changed, compared with the value in effect; removal reasons and shift slots record theirs too. Riders read the changes to the settings that affect their work in plain units, credited to "a representative" (`api/courier/v1/setting-changes`, `RIDER_FACING_SETTINGS`); admins read every change with the login (`api/admin/v1/setting-changes`). The server refuses a position from a rider who is Offline and holds no job (409, "You are Offline, so no position is stored") and erases the stored position when a rider goes Offline with no job or when an Offline rider's last job ends. Migration `20261119120000_platform_work_directive`. Reviewed by Fable and by agy; the findings that held were fixed and agy's tests for them bite. Checked live on dev; the answer push itself could not be seen there, since push is off on dev until the co-op's Firebase project exists. Decisions 30.2 to 30.11. With it the suite is at **4919 passing tests**; typecheck is clean.

Scope row 110 (a restaurant's API key and its password, spec 0037) was built on the branch `fix/restaurant-api-key` and merged in on 19 November. A password change set by an admin used to leave the restaurant's API key working, and the partner login answer handed the key to anyone with the password. Now the login neither makes nor returns a key; an admin makes, replaces or removes one (`POST`/`DELETE api/admin/v1/partner/:id/api-key`) and sees it once; and `rotate-password` answers 200 `{ apiKey }`, replacing an existing key in the same transaction as the password (`apiKey: null` when there was none). Only a SHA-256 hash is stored (`User.apiKeyHash`, `apiKeyCreatedAt`; migration `20261118204528_restaurant_api_key_hash` drops the old column and every key with it), looked up in one place, and an unknown key answers 401 "This API key does not work. Ask the co-op for a new one." A key in the address (`api_key` in the parsed query, any spelling) is refused on every route and its request is logged without the query string. New restaurants, seeds and dev scripts get no key. `PartnerAdminDto` carries `apiKeyCreatedAt`, required wherever a restaurant's user is loaded. Reviewed by Fable; checked live on dev. Decisions 110.1 to 110.7. With it the suite is at **4734 passing tests**; typecheck is clean.

Scope row 109 (what each restaurant owes, spec 0036, GA) was built on the branch `feat/restaurant-charges` and merged in on 18 November. Admins list every restaurant charge (`PartnerCharge`) by Athens calendar month, and bill some or all of one restaurant's month by hand in one `PartnerBill` (migration `20261118220000_add_partner_bills`): its lines, one per charge it covered, are kept forever, a charge sits in at most one open bill, and a bill is all or nothing (400 for a charge that is unknown or of another restaurant or month, else 409 naming the ids another bill already holds). A bill can be undone with a reason, which frees its charges, and has a printable statement. Routes are under `api/admin/v1` (`partner-charges`, `partner-bills`), admins only; restaurants see nothing new. Wait awards now store their paid minutes and the wait charge copies them; the migration backfills both from the award message. No amount, rule or setting that pays a rider moves. After agy's cross family review, a deadlock between two bills claiming the same charges in a different order (Prisma `P2034`) answers that 409 instead of a 500. Reviewed by Fable and agy; verified 13 of 14 criteria live, the 14th (minutes on a new wait award) waits on a check with delay pay switched on. Decisions 109.1 to 109.7. With it the suite is at **4676 passing tests**.

Scope row 115 (chat loose ends) was built on the branch `fix/chat-loose-ends` and merged in on 18 November. A first chat message from a rider or a restaurant whose order tag was refused (404) used to leave an empty thread behind; the thread is now made only once the message is allowed (`ChatDomainService.send`, `existingThreadFor`), with the AC-19 retry check still first. `Channel <name> not found` in `SocketIOService.publishMessage` moves from error to debug, since a rider who is not connected is normal; at the logger's `info` level it is no longer printed (decision 115.2). Reviewed by Fable. Decisions 115.1 and 115.2. With it the suite is at **4576 passing tests**.

Scope row 94 (lock the public tasks endpoint, GA) was built on the branch `fix/lock-tasks-endpoint` and merged in on 18 November. `POST api/tasks/v1/execute` ran any registered job handler by name with no login. It now needs the shared secret `TASK_RUNNER_SECRET` in an `x-task-secret` header (`TaskRunnerSecretGuard`, compared over SHA-256 digests), trimmed and at least 32 characters; unset or too short, it refuses everyone, which is the co-op's case, since its jobs run in process through BullMQ. A too short secret is warned about at startup. The Google Cloud Tasks scheduler sends the header and no longer logs whole requests. Reviewed by Fable and agy. Decisions 94.1 and 94.2. With it the suite is at **4560 passing tests**.

Scope row 112 (honest labels for jobs the rider did not deliver) was built on the branch `fix/honest-job-labels` and merged in on 18 November. The courier earnings day endpoint counted every pay line as a delivery; it now counts only drop offs, as the summary already did, so a day of one wait payment no longer says "1 delivery". Deploy it before the courier app's half. Decision 112.1. With it the suite is at **4498 passing tests**.

Scope row 113 (an API key beside another login, found by row 111's verify) was built on the branch `fix/api-key-beside-login` and merged in on 18 November. `AuthMiddleware` read a restaurant's API key before the login token, while a route's login guard only checks that some valid token came, so any login plus restaurant B's key reached every session only partner route as B. A request carrying an API key beside any `Authorization` header or a refresh token is now refused with 401 before anything is looked up, and the Bearer scheme is read as the login guard (passport-jwt) reads it, in any case and spacing, so no spelling skips the password change check. A key alone still works where `@ApiKeyAuth()` allows it. Reviewed by Fable, whose blocker (a lowercase `bearer`) is fixed. Decisions 113.1 and 113.2. With it the suite is at **4488 passing tests**.

Scope row 111 (chat between dispatch, riders and restaurants, spec 0034) was built on the branch `feat/chat` and merged in on 18 November. Each rider and each restaurant has one thread with the co-op's dispatch (`ChatThread`, `ChatMessage`, migration `20261117120000_add_chat`), read and written through `admin`, `courier` and `partner` routes and live over a new `admins` Socket.IO namespace and the riders' existing one. Riders and restaurants see dispatch as "Dispatch"; admins see which colleague wrote. A rider or restaurant sees "read" once any admin opened the thread after their message; dispatch only sees "Sent", and the server keeps no record of a rider or restaurant reading, nor any count or timing of one person's messages (the request log drops the chat routes' paging cursors for the same reason). A retry with the same `clientMessageId` never makes a second message, even after the tagged delivery moved on. A message from dispatch to a rider who is not Offline sends a data only push with no text. An unread thread is an `UNREAD_MESSAGE` row on the Dispatch board, previewing the rider's or restaurant's own words. The quick replies for each side and the days messages are kept (`chatRetentionDays`, cleared by a daily job) are co-op settings. Restaurant chat takes the signed in session: the ordering API key alone is refused, and a key beside a login is refused by row 113. Reviewed by Fable; every finding ruled and the fixes tested with put backs by hand. Decisions 111.1 to 111.15. With it the suite is at **4449 passing tests**; typecheck is clean.

Scope row 24 (a rider asks dispatch to come off an order, spec 0035) was built on the branch `feat/removal-requests` and merged in on 10 November. A rider holding a job can send a removal request with a reason from a list the co-op edits in admin (`RemovalReason`, with the seven starting reasons in the migration) and can withdraw it. The request appears on the Dispatch board as a `REMOVAL_REQUEST` row, where an admin approves or declines it. Approved before pickup, the rider comes off and the order is offered again. Approved after pickup, the order is cancelled and the rider gets the usual cancelled job screen. Whether a reason pays the rider and whether it bills the restaurant are set per reason, and the amount is fixed at the approve under the existing payout rules. A food return after pickup now pays a return trip on any cancellation: the quote's distance fee times the new `returnTripPayPercent` setting. A rider moved from the pickup by a removal, an admin reassignment or a dispatch stop now has their wait paid, which row 23 left open. An admin reassignment whose event was lost keeps its award when the rider really is off the delivery. Missed writes are completed by the minute sweep for 24 hours. The earnings detail lists each kind of pay as its own line. Every step is a `DeliveryEvent`. Nothing counts or ranks requests per rider, and the rider's note stays out of logs and events. Decisions 24.1 to 24.59.

Scope row 90 (the admin Dispatch board, spec 0034) was built on the branch `feat/dispatch-board` and merged in on 9 November. `GET api/admin/v1/dispatch/board` answers one board for an admin to poll every 10 s: four co-op totals, the Needs attention list and the latest position of working riders. A rider's position stays off the map once it is more than 5 minutes old, and no history is kept. A rider's report can be marked handled once. Nothing on the board times, counts or ranks a rider.

Scope row 23 (restaurant delay pay and leaving a late order, spec 0033) was built on the branch `feat/wait-pay` and merged in on 9 November, behind `waitPayEnabled`, off by default. From the moment a rider arrives, the wait is recorded. With delay pay on, the rider is paid per minute from the later of their arrival and the restaurant's first promise (`Delivery.promisedReadyAt`, which a delay cannot move) plus `waitPayFreeMinutes`, until the pickup or until they leave, and the restaurant is charged the same amount; a rider who arrives after those free minutes to food already marked ready earns nothing and the restaurant is not charged. The pay is a `CourierCompensation` and a `PartnerCharge` (reason `WAITING`, one per wait through `waitOf`) and a `COURIER_PAID_FOR_WAIT` event; `settleWaitPay` and the minute sweep finish a half written payment, and `waitPayOwedAt` stays set until every piece exists. `POST courier/v1/deliveries/:id/leave-wait` lets a rider leave from `waitLimitMinutes` after the later of the promise and their arrival (`WAIT_UNDISPATCHED`, which admins cannot post); the order is then held until `foodReadyAt` is set or `readyAt` less the offer lead has come, even with Timed offers off. The job list carries `arrivedAt`, `leaveFrom` and `paidFrom`, earnings a `WAITING` kind and `waitingPay`, the admin delivery `waitCharges`, and a rider can report `FOOD_NOT_READY`. `PartnerCharge` loses its unique on `deliveryId` for unique `cancellationOf` and `waitOf`, and `PICKED_UP` events now name the rider. Migrations `20261109100000_add_wait_pay` and `20261109120000_add_food_not_ready_issue`.

Scope row 15 (report a wrong or missing product, spec 0032) was built on the branch `feat/product-reports` and merged in on 9 November. A rider at the door, a restaurant once delivered, or an admin at any time can report one against a delivery; each report is a `ProductReport` row and a `PRODUCT_REPORTED` `DeliveryEvent`, and admins list and resolve them. Nothing here changes pay or status. Reviewed by Fable. With it the suite is at **3658 passing tests**.

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
| New append only `CourierStatusChange` table and `EnumCourierStatusChangeCause` (migration `20261119200000_courier_status_changes`); `CourierRepository.changeStatus` the only writer of `Courier.status` (`updateStatus` and `setOfflineAndClearLocationIfFree` removed, `status` gone from `ICourierUpdate`); `ACCEPTED` keeps its rider in `courierId`; five time worked routes; setting `shiftBreakMinutes` (row 36) | Unpaid time between deliveries was invisible: nothing recorded when a rider was Online. One writer, so no status path can forget the record. | `f5cd00a`, `eabe304`, `8f15bce` |
| Setting `feePercentageCeiling` (0 to 100, default 25); `setInstanceConfigSettings` refuses a fee above it, or a ceiling below the fee, inside its transaction (row 53) | An extra zero in the fee % would have multiplied every customer's price. No schema change. | `a594b20`, `49df9e7`, `72b5ca2` |

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
