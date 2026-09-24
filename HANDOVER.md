# Centex Guest Booking — Handover

| | |
|---|---|
| **Version** | `b0.13.0` — `package.json`, injected into the header at build. **Shown top-right on every page**, with the build time on hover. |
| **Repo** | `C:\dev\centex-crm-book` |
| **Deployed** | https://book.centexrvrentals.com/ — **public since b0.8, linked from centexrvrentals.com at swap-over (b0.10)**. The netlify.app address redirects here once the domain is primary in Netlify. The origin is never written in source: `scripts/site-origin.mjs` decides it at build |
| **Stack** | Vite + React (JS, not TS), plain CSS, React Router. No Tailwind. |
| **Gates** | `npm run preship` — ESLint then vitest. Offline, fast. |
| **Contract** | `npm run contract` — **required before every push.** Needs the network, and `CONTRACT_SITE_URL` in `.env`. Checks the five views, both Edge Functions (b0.12: `payment-options` by a bad-token probe; b0.13: `request-booking` must answer `{ quote: true }` as a quote), AND (b0.11) that the DEPLOYED SITE is reachable and names the right origin. |

**Versions are `bN.N` and belong to this repo alone.** The CRM is on its own
line (v5.91 when b0.10 shipped). Calling a release here "v3.90" would mean
that one day `App.jsx` v3.90 and a guest site v3.90 exist and have nothing to
do with each other.

---

## 1. The contract — what this repo may touch

**Five views and two functions. That is the entire interface.** (b0.12 added `payment-options`.)

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
| `request-booking` | turns a request into a `held` booking the office approves; (b0.13) with `quote: true`, prices a stay and writes nothing - the live total |
| `payment-options` | (b0.12) the `/pay/:token` page: `show` what a guest owes and can choose; `choose` a word (`deposit` / `full` / `balance`) and get a Stripe Checkout URL |

Both deployed `--no-verify-jwt` and called with no `Authorization` header.
`request-booking` is the only write this site makes to a booking;
`payment-options` makes a Checkout Session and its pending payment row
server-side. **The token in the pay URL is the credential** — signed by the
CRM with `PAY_PAGE_SECRET`, valid to the end of the start day — so a 401 from
`payment-options` WITH a sentence is a bad link (shown to the guest), and one
WITHOUT a sentence is the gateway (a deploy missing `--no-verify-jwt`).
**The page never sends an amount**: the CRM re-derives it at the moment of
choosing.

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

**`CONTRACT_SITE_URL` must be in `.env`** for the b0.11 live check, e.g.
`CONTRACT_SITE_URL=https://book.centexrvrentals.com`. REQUIRED rather than
defaulted: a default would be the origin written down in a fifth place, the
exact thing b0.10 removed. Deliberately separate from `VITE_SITE_URL` so that
checking production cannot change what a local build stamps.

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
- **Nothing in the source names the site's origin** (`src/site-origin.test.js`,
  b0.10). `scripts/site-origin.mjs` decides it once — `VITE_SITE_URL`, else
  Netlify's `URL`, else localhost — and `vite.config.js`, `sitemap.mjs` and
  `check-bundle.mjs` all derive from it. `index.html` carries a placeholder
  in its canonical and `og:url`; `robots.txt` and `sitemap.xml` are generated
  and not in git. **`check-bundle` fails a build whose canonical, `og:url`,
  `Sitemap:` line and `<loc>` entries do not all agree** — consistency, not a
  particular hostname, so a local build passes on localhost.
- **And one guard that is NOT offline (b0.11), because it cannot be.**
  `npm run contract` fetches the deployed site and fails if it is not
  reachable or does not name the expected origin. It is the only check here
  that looks ABOVE the repo, and §6 records why it had to exist.

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

**No payments in phase 1 — and phase 2 has started.** Stripe is live in the
CRM in TEST MODE as of v4.04: a deposit link is created when the office
approves a held booking, texted to the guest, and a webhook marks the row paid.
This repo's only part in it is `/paid/:reservationNum` (b0.9), where Stripe
returns the guest. **Nothing on the browse or request path has changed** — a
guest still requests, and the office still approves.

The line that used to sit here said "the refund columns exist in the CRM and
nothing writes them yet." **That was wrong when written.** `bookings.refund_*`
has data — two cancellations, both refunded outside the app — and `App.jsx` has
written those columns through `BOOKING_COLUMN_MAP` the whole time. It matters
here because it is the reason the CRM treats `bookings.refund_*` as canonical
for refunds and the `payments` table as the Stripe subset only: OTA and cash
refunds never touch that Stripe account and never will.

**No guest accounts.** Name, email, phone, dates, pickup or delivery. A guest
portal needs payments first.

**React Router from the start.** SEO is a real reason this repo exists, and
retrofitting URLs means rewriting every navigation.

**Plain CSS, not Tailwind.** Six pages do not need the build step. The palette
is carried across so it reads as the same company.

---

## 6. Open

**The booking rules are going to be an npm package** (was planned for b0.3;
b0.3 shipped `npm run conformance` instead and this has not been revisited).
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
WARNING: the site is public and being crawled NOW, so empty galleries are
what gets indexed.

**THE SITE WAS NEVER ACTUALLY PUBLIC UNTIL 2026-09-21, AND NOTHING HERE COULD
HAVE KNOWN.** b0.8 is titled "The site is public." It removed `noindex`,
flipped `robots.txt` to Allow, and turned three tests around to assert the new
state. Every one of those was correct about everything this repo controls. But
Netlify's team -- created Aug 2 -- defaults new projects to **private**, and
this project was explicitly set to Private for production and previews. Every
visitor for six weeks got "Sign in with an invited Netlify account"; the Web
Security panel showed 30 requests in seven days, all of them ours. Found while
verifying b0.10's swap-over, by fetching the site rather than reading the repo.

**The lesson, and the reason b0.11 exists:** a guard inside the repo cannot
see a setting outside it, and green tests were never evidence the site was
reachable -- only that the two files we own said the right thing. The one
instrument that can answer "can a guest open this" is a request. Fixed by
setting the project's Visitor access to *Private / **Previews only*** --
production public, deploy previews still behind team login, which is what we
want now that every build emits `Allow: /` (a public preview would be
crawlable duplicate content competing with the real site).

**Swap-over runbook (b0.10).** In order: (1) Settings → Payments → Enabled is
OFF in the CRM until payments go live, or an approved real guest gets a
test-mode link; (2) GoDaddy DNS: CNAME `book` → `centex-crm-book.netlify.app`;
(3) Netlify → Domain management → add `book.centexrvrentals.com` and make it
**primary** — Netlify's `URL` build variable becomes the custom domain at that
point, which is what `site-origin.mjs` reads, so `VITE_SITE_URL` is an override
and not a requirement; (4) trigger a deploy — the origin is baked in at BUILD,
so changing the primary domain does nothing to the live bundle until the next
build; (5) confirm the build log says `sitemap.xml — N URL(s) at
https://book.centexrvrentals.com` and `Origin agrees everywhere`; (6) the
"Book now" button on centexrvrentals.com; (7) `BOOK_SITE_URL` in the CRM's
Edge Function secrets → the same origin, so pay links return guests here.

---

## 7. Version history

| | |
|---|---|
| **b0.13** | **The guest picks add-ons and sees a total** (CRM v6.03 + v6.04, Sprint 3 R3). **The server prices everything; this site does no arithmetic on money.** New `lib/quote.js` asks `request-booking` with `{ quote: true, unitId, start, end, method, addons }` (debounced 400 ms, the replaced call aborted, and every answer stored WITH the request it answered so a slow old answer can never render) and words the lines: rental "$109 × 4 nights", add-ons "$35 × 4 days" / "2 × $25", tax lines as the server labels them, **delivery "from $X — We'll confirm the delivery price"** (CRM decision 5; "to confirm" when no minimum, never "$0"), total = the server's `totalCents` ("from $X" with delivery). An answer without `quote: true` is not a quote (older deploy, or the honeypot); a refusal is shown word for word; no answer says so and **does not block the request**. `components/AddonPicker.jsx` replaces the read-only add-ons panel: required = "included", no control, not sent (the server adds every required one itself); Max Quantity 1 = checkbox, more = None..N (capped at 20), from the view's `max_quantity`; "per day" / "once per booking" from `daily`; an add-on with no price is listed as "Ask us about this one" and cannot be picked. `components/Quote.jsx`: `QuoteBox` (camper page for pickup; inside the form, for pickup or delivery as ticked) and `QuoteLines` (also `/requested`, from the quote the real request returns - "What we quoted … We'll confirm the price when we come back to you. Nothing has been charged."). **Found and fixed:** (1) `buildPayload` blank-fills every `sends` field with `""`, and the server refuses `addons: ""` - so `addons` is always an array; (2) `num(null)` is 0, so an add-on the office never priced showed "$0" and would have been pickable - `fetchAddons` keeps a null price null; (3) the calendar's own "Estimate" (nightly × nights + prep) contradicted the server's total on the same page - `estimate()` retired, the calendar prices nothing. No service-fee wording anywhere (CRM decision 4), held by a render test and a source scan. Contract: `request-booking` sends `addons`, returns `lines`/`totalCents`/`estimate`, and a `quote` block (sends, returns, line shape, kinds); `public_listing_addons` gains `max_quantity`, loses `charge_by`. `npm run contract` probes `{ quote: true }` (must refuse AS a quote - fails on a pre-v6.03 deploy). `npm run conformance` prices every camper first and names the ones that cannot be priced as a CRM data problem instead of reporting them as date drift. New `src/quote.test.jsx` (36); browse +2, contract-offline +2, request re-pointed (the "we'll work out the delivery fee" sentence is gone) and made blind to the quote box's own calls; dates: the estimate tests replaced by "the calendar prices nothing". **Needs CRM v6.03 deployed (it is) and v6.04's SQL run before the push.** |
| **b0.12** | **Choose how to pay** (CRM v5.97, decisions 25-30). New route `/pay/:token`, reached from the approval text. `lib/payments.js` makes the two `payment-options` calls and words the answer (`payPageView`): outside the week before the trip, **Reservation Deposit** ("The remaining $700.00 is due Saturday, October 3.") **or Pay in Full**; inside it, Pay in Full with the reason; after a deposit, the Balance; on every one, the **Refundable Security Deposit** and its date. **The verbs ("is due", "is collected") come from the server**, so the day the CRM's charger ships the page says "will be charged to your card on" with no release here. The guest's browser is sent only to `https://checkout.stripe.com/…`. The page sets `robots: noindex, nofollow` and `referrer: no-referrer` while open and REMOVES both on unmount (meta.js never resets tags, so a leftover noindex would de-index the next page); its canonical is `/pay`, never the token. The redirect is a `leave` prop so the suite can see where it went (jsdom's location cannot be spied on). Contract: `payment-options` added with a `probe` (a token that cannot verify must answer 401 WITH its own sentence) and `npm run contract` runs it; `check-bundle.mjs` also looks for `payment-options`. `src/pay.test.jsx`, 23 tests. **Must ship before payments are switched on in the CRM**; with payments off the page answers "Online payment isn't available right now". |
| **b0.11** | **The one guard that looks above the repo.** b0.10 shipped on 09-21 and the swap-over verification found the site had been answering **401 to every visitor since it was created** -- Netlify team protection, a setting one level above anything a test here can read, while b0.8's three tests correctly asserted that the two files this repo owns said "public" (section 6). `npm run contract` now also GETs `/`, `/robots.txt` and `/sitemap.xml` from `CONTRACT_SITE_URL` and fails on a non-200 or an origin that disagrees. **The split that makes it usable: a page that ANSWERED WRONG fails the run; a page that could not be REACHED only warns** -- the same reasoning that keeps this whole script out of preship, because a gate that cries about a dropped connection is a gate people skip. The assertion logic is pure (`liveSiteProblems` in `site-origin.mjs`), so preship covers every branch offline while the fetch stays in the script. **Two faults were found by RUNNING it rather than reading it:** it announced "THE SITE IS PRIVATE" on any 403, and a sandboxed container's egress proxy returns 403 -- so 401 (Netlify's actual signature, verified live) keeps that sentence while 403 now names the alternatives including a local proxy; and three pages answering the same status printed the same paragraph three times, so one cause now prints one line. **A third was found by MUTATION TESTING:** three of the new source guards used whole-file lazy windows and stayed GREEN when the block they described was inverted, because the match ran on and found the token in a later branch -- they use brace-matched blocks now, and all six mutations were re-run red. The contract is untouched: five views, one function. |
| **b0.10** | **The origin is decided once, and swap-over is a domain change rather than a code change.** Through b0.9 `centex-crm-book.netlify.app` was written in `index.html` (canonical and `og:url` — the two tags a text-message preview reads, and previews do not run JavaScript), in `robots.txt`'s `Sitemap:` line, as a fallback in `sitemap.mjs`, and in a committed `sitemap.xml` that Netlify never used because the generator overwrites it every build. All four would have gone on naming the old host after the site got its own domain, silently. Now `scripts/site-origin.mjs` derives the origin — `VITE_SITE_URL`, else Netlify's own `URL` build variable (which becomes the custom domain the moment it is made primary), else localhost, and **never the old netlify.app fallback**: a build that cannot find its origin says localhost, which is visibly wrong in a screenshot, rather than a hostname that is wrong quietly. `vite.config.js` stamps it into `index.html`'s placeholder; `sitemap.mjs` writes `sitemap.xml` AND `robots.txt` from it (robots.txt is generated because its Sitemap line is an absolute URL); `check-bundle.mjs` **fails the build** if canonical, `og:url`, the `Sitemap:` line and every `<loc>` do not agree — that is a broken pipeline, not the thin sitemap the b0.8 rule protects, so failing is right. `robots.txt`, `sitemap.xml` and `supabase/.temp/` leave git. `src/site-origin.test.js` drives every mismatch the checker must catch (a negative test that does not fail proves nothing) and sweeps every shipped or build file for the old host. `meta.test.jsx` reads the robots template instead of the file. The contract is untouched: five views, one function. |
| **b0.9** | **`/paid/:reservationNum` — where Stripe returns a guest after checkout.** **It looks NOTHING up, and that is the release.** The obvious version reads the payment row and reports its status. The webhook is ASYNC: Stripe redirects the browser the instant payment succeeds and delivers `checkout.session.completed` separately over its own connection, and the browser usually wins that race — so a page reading the row would tell a guest who has just paid that their payment is pending, which is the one thing it must never say. It would also need a SIXTH anon view, keyed on a string shaped `WEB-260911-PAV7` — roughly a million combinations, which is not a secret but a speed bump, and publishing who paid what behind a speed bump for a page that does not need it. Stripe only redirects to `success_url` AFTER the payment succeeded, so the redirect itself is the evidence; the page says what that supports and stops. **`?cancelled=1` is the same route:** the CRM set `cancel_url` to the same URL as `success_url`, so a guest who backed out of checkout landed on a page thanking them for paying (fixed CRM-side in v4.04). One route rather than two, because the guest needs the same things either way — their reference, a way back, and no claim that is not true — and the cancelled wording is deliberately not phrased as an error, because backing out is a normal thing to do and the link still works. **The contract is untouched: still five views and one function.** |
| **b0.8** | **The site is public.** `noindex` gone from index.html and `robots.txt` flipped to Allow — both together, because a meta tag and a robots.txt that disagree fail silently and which one wins depends on the crawler. The three tests that asserted the site was hidden are now three that assert it is public, plus one that checks the two files AGREE in either direction. A sitemap is GENERATED from `public_listings` at build, not written by hand: a hand-written list of eleven campers goes wrong the first time one is retired and nothing would say so. **It never fails the build** — a thin sitemap costs a day of search visibility, a failed build costs the whole deploy. Two bugs found by running it: the generator ran AFTER vite, so the file was written to public/ and never copied into dist/ — the build passed and shipped no sitemap at all; now guarded. ⚠ **Nothing notifies you of a request.** A hold lapses at the first Central midnight 24h+ after it is placed, so a request goes stale in 25-48 hours, silently. |
| **b0.7** | **The amenities panel never rendered, and 81 passing tests agreed with it.** `public_listing_amenities` selects `amenity_group` and `amenity_name`; the contract said `name`, `category` and `sort_order` — all three GUESSED, because the table was empty and no row had ever come back. The site read `r.name`, got undefined, filtered every amenity out, and the panel silently rendered nothing. **Three things had to line up:** the guessed columns, marking everything but `unit_id` optional so the contract check said `ok` with a warning instead of failing, and test fixtures built from the same guesses so the suite agreed with itself. All three now guarded — every column the data layer reads and every column in a fixture must be in the contract, and a view requiring only `unit_id` fails. Amenities render grouped. Add-ons verified for the first time, 11 columns, exactly as contracted. |
| **b0.6** | **Swap-over prep.** The hostile-data matrix went from 396 renders per page to 83 by corrupting EVERY column at once per type rather than one at a time — both faster and harsher, with a bisect that names the guilty column only when something fails. 16.3s to about 5s on the machine that matters, against a 30s timeout it was at 54% of. Per-page titles, descriptions and Open Graph tags, so a camper link pasted into a text message carries a photo.  pins line endings. A real 404 that offers the way out. **And three tests that assert the site is STILL HIDDEN** —  and  — which must be deleted deliberately at swap-over, because forgetting them is silent and costs weeks of ranking. |
| **b0.5** | **The version is on the page.** A screenshot of the deployed site could not be told apart from the previous release — a missing button read as a bug when it was an older bundle. `package.json` is the one place the number lives; `vite.config.js` injects it and the build time. A guard fails if any source file hardcodes a version, and if HANDOVER's Version row disagrees with `package.json`. **The build time is what tells you the deploy happened**: two builds of b0.4 look identical and one may still be in Netlify's cache. |
| **b0.4** | **The request form.** Name, contact, delivery if the camper offers it, the honeypot, submit to `request-booking`, confirmation at `/requested/:reservationNum` with its own URL so it survives a refresh. Server refusals are rendered WORD FOR WORD — those sentences were written for a guest, and paraphrasing means two reasons exist for one refusal. The wording never says booked or confirmed. Two mutation checks found a missing guard: replacing `setErrors(result.errors)` with a generic sentence passed the whole suite, because the lib test proved the sentences arrive and nothing proved they reach the screen. |
| **b0.3** | **The date picker and the conformance test.** Busy days struck through and unclickable, so a guest cannot pick a week the server would refuse. `npm run conformance` builds a corpus from real availability and runs every case through BOTH this repo's `checkDates` and the live Edge Function via `dryRun`, naming any disagreement and which direction it goes. That is what justifies implementing the rules twice instead of publishing a package (CRM §4.163). |
| **b0.2** | **Browse.** The grid and the camper page, read-only. Every field coerced in one place, because optional chaining guards a key being absent and says nothing about its type. Hostile-data guards render every listing column as every wrong type. |
| **b0.1** | The harness and the contract. `contract.js` lists every column this site reads; `npm run contract` checks all five views and the Edge Function against the live database, using the ANON key — checking with a service-role key would prove the columns exist for somebody who can read everything, which is not the question. Offline guards: no CRM import, no base table, no hardcoded URL or key, every `.from()` in the contract. No UI. |
