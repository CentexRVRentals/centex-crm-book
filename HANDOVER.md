# Centex Guest Booking — Handover

| | |
|---|---|
| **Version** | `b0.5.0` — `package.json`, injected into the header at build. **Shown top-right on every page**, with the build time on hover. |
| **Repo** | `C:\dev\centex-crm-book` |
| **Deployed** | https://centex-crm-book.netlify.app/ — **reviewable, linked from nowhere** until swap-over |
| **Stack** | Vite + React (JS, not TS), plain CSS, React Router. No Tailwind. |
| **Gates** | `npm run preship` — ESLint then vitest. Offline, fast. |
| **Contract** | `npm run contract` — **required before every push.** Needs the network. |

**Versions are `bN.N` and belong to this repo alone.** The CRM is on its own
line at `3.89`. Calling a release here "v3.90" would mean that one day
`App.jsx` v3.90 and a guest site v3.90 exist and have nothing to do with each
other.

---

## 1. The contract — what this repo may touch

**Five views and one function. That is the entire interface.**

This repo shares NO code with the CRM. Not a package, not a copied helper, not
an import. If both need to format a date, they each have one.

| View | For |
|---|---|
| `public_listings` | the grid and every camper page |
| `public_listing_photos` | the gallery and cover images |
| `public_listing_addons` | what a guest can add, and what it costs |
| `public_listing_amenities` | the amenity list |
| `public_listing_busy_dates` | **which dates cannot be booked** |

| Function | For |
|---|---|
| `request-booking` | turns a request into a `held` booking the office approves |

Deployed `--no-verify-jwt`. It is the only write path this site has, and it is
called with no `Authorization` header.

### THE PROSE ABOVE IS NOT THE CONTRACT

`src/lib/contract.js` is. It lists every column this site reads, and
`npm run contract` queries the live database and fails if one is missing.

That split is deliberate and it is the lesson this repo starts with. **A
document describing another repo's shape drifts the moment that repo changes,
and nothing here notices.** The CRM has a catalogue of exactly that: a schema
file missing 28 columns, a lint config describing a codebase 15,000 lines
smaller than the real one, a test pinning a database view that had been
replaced twice, a workflow document describing two booking statuses nothing
ever wrote.

So the contract is a list a machine checks, and this section is a summary of a
thing that is already enforced.

**To add a column:** add it to `contract.js`, run `npm run contract`, and only
then write the code that reads it. A column that fails the check does not
exist yet, whatever the CRM's migration says.

### Anything not on that list has to be added to a view first

In the CRM repo, in its own release, with its own guard. `public_listings`
excludes VIN, plate, keys, storage location, every driver-payout column, and
all of customers, employees and delivery jobs — by design. If this site needs
something, the question is whether a stranger should see it.

---

## 2. Keys

**The anon key is public by design.** It ships in the bundle; that is what it
is for. Its entire reach is the five views granted to `anon` — which is why the
CRM asserts that grant list is exactly five and nothing more.

**The service role key must never appear in this repo.** Not in `.env`, not in
Netlify, not in a variable nothing reads. `request-booking` reads it from
Supabase's own environment. A guard fails preship if any JWT-shaped string
appears in source.

**Netlify bakes `VITE_` variables in at BUILD time.** Adding one to an existing
site does nothing until the next build — trigger one.

---

## 3. Releases

Same discipline as the CRM, and for the same reason: every rule below exists
because its absence cost real time somewhere.

**One behaviour change plus its guard.** Not two.

**Every bug gets a permanent regression test**, not a throwaway script.

**Delivery format:** prose first — what changed and why, decisions made on
your behalf, anything found during the work that changed the approach, anything
to verify by hand that tests cannot cover. Then gate results with expected
counts. Then a complete PowerShell script.

**`npm run contract` is a required step in the delivery script**, in the same
position the SQL steps hold in the CRM's — before the push, and again any time
the CRM ships a migration.

### Why the contract check is NOT in preship

It needs the network and a live database. **A preship that fails when the wifi
drops is a preship people learn to ignore, and a gate people ignore is worse
than no gate at all.** Preship stays offline and fast; the contract check is
deliberate and manual.

---

## 4. What the guards enforce (`src/contract-offline.test.js`)

All offline, all in preship:

- **Nothing imports from the CRM repo**, and no import escapes this repo. The
  whole point of the split — an import across the boundary would ship the
  authenticated CRM into a bundle strangers download.
- **No source file names a base table.** Belt and braces over the anon grant.
  The grant is the real defence; this turns a silently-empty list into a
  visible error.
- **Every `.from()` names a view in the contract**, which catches the typo
  the grant would only turn into a swallowed error.
- **No project URL and no key appear in source.** Multi-tenancy is why this is
  a separate repo; a hardcoded project ref makes tenant two a code change
  instead of a config value.
- **The honeypot field stays in the request contract.** If this site stops
  sending `company`, the form loses its cheapest defence and nothing else
  would notice.

### jsdom is the global test environment here

The opposite of the CRM's choice, for the opposite reason. The CRM defaults to
`node` because almost all of its test files read source text, and the two that
render declare their own environment — and the one time a container set jsdom
globally there, a test passed on that machine and failed on the real one. This
repo is nothing but components.

---

## 5. Decisions already made, so they are not re-litigated

**Separate repo, not a second entry point in the CRM.** Repo layout barely
touches multi-tenancy — that is a data and identity problem. What argues for
the split is that each tenant wants their own domain and branding, that the CRM
is the most privileged surface in the system and this is the least, and that
SEO matters for a booking site and cannot be retrofitted onto a tab inside an
authenticated app.

**Request-to-book, not instant-book, in phase 1.** Every request lands as
`held` and the office approves with the flow that already exists.
`auto_accept_days` is enforced later, once the request path has seen real
traffic.

**No payments in phase 1.** Phase 2. The refund columns exist in the CRM and
nothing writes them yet.

**No guest accounts.** Name, email, phone, dates, pickup or delivery. A guest
portal needs payments first.

**React Router from the start.** SEO is a real reason this repo exists, and
retrofitting URLs means rewriting every navigation.

**Plain CSS, not Tailwind.** Six pages do not need the build step. The palette
is carried across so it reads as the same company.

---

## 6. Open

**The booking rules are going to be an npm package** (planned for b0.3).
`overlapsBusy`, `nightsBetween` and the minimum-nights rule exist in the CRM's
`_shared/booking-request.ts`, in two copies. This site needs them to grey out
dates before a guest submits.

Worth knowing before that release: for ONE mechanism to serve the Deno Edge
Function, the CRM's vitest and this site, it has to be a **real published npm
package** — git URLs do not work with Deno's `npm:` specifier. So publishing
becomes a step in any CRM release that touches those rules. That cost is the
thing to weigh at b0.3.

**Nine of eleven listed campers are sitting in `turnover` or
`customerReturn`.** Does not affect the listing — only `retired` gates it — but
it is either genuine end-of-season or campers stuck because a last card never
got ticked. Worth a look before swap-over.

**No camper has listing photos yet**, as far as anyone has checked. The grid
handles it; the gallery will be empty until photos are uploaded in the CRM.

---

## 7. Version history

| | |
|---|---|
| **b0.5** | **The version is on the page.** A screenshot of the deployed site could not be told apart from the previous release — a missing button read as a bug when it was an older bundle. `package.json` is the one place the number lives; `vite.config.js` injects it and the build time. A guard fails if any source file hardcodes a version, and if HANDOVER's Version row disagrees with `package.json`. **The build time is what tells you the deploy happened**: two builds of b0.4 look identical and one may still be in Netlify's cache. |
| **b0.4** | **The request form.** Name, contact, delivery if the camper offers it, the honeypot, submit to `request-booking`, confirmation at `/requested/:reservationNum` with its own URL so it survives a refresh. Server refusals are rendered WORD FOR WORD — those sentences were written for a guest, and paraphrasing means two reasons exist for one refusal. The wording never says booked or confirmed. Two mutation checks found a missing guard: replacing `setErrors(result.errors)` with a generic sentence passed the whole suite, because the lib test proved the sentences arrive and nothing proved they reach the screen. |
| **b0.3** | **The date picker and the conformance test.** Busy days struck through and unclickable, so a guest cannot pick a week the server would refuse. `npm run conformance` builds a corpus from real availability and runs every case through BOTH this repo's `checkDates` and the live Edge Function via `dryRun`, naming any disagreement and which direction it goes. That is what justifies implementing the rules twice instead of publishing a package (CRM §4.163). |
| **b0.2** | **Browse.** The grid and the camper page, read-only. Every field coerced in one place, because optional chaining guards a key being absent and says nothing about its type. Hostile-data guards render every listing column as every wrong type. |
| **b0.1** | The harness and the contract. `contract.js` lists every column this site reads; `npm run contract` checks all five views and the Edge Function against the live database, using the ANON key — checking with a service-role key would prove the columns exist for somebody who can read everything, which is not the question. Offline guards: no CRM import, no base table, no hardcoded URL or key, every `.from()` in the contract. No UI. |
