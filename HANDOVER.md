# Centex Guest Booking — Handover

| | |
|---|---|
| **Version** | `b0.27.0` — `package.json`, injected into the header at build. **Shown top-right on every page**, with the build time on hover. |
| **Repo** | `C:\dev\centex-crm-book` |
| **Deployed** | https://book.centexrvrentals.com/ — **public since b0.8, linked from centexrvrentals.com at swap-over (b0.10)**. The netlify.app address redirects here once the domain is primary in Netlify. The origin is never written in source: `scripts/site-origin.mjs` decides it at build |
| **Stack** | Vite + React (JS, not TS), plain CSS, React Router. No Tailwind. |
| **Gates** | `npm run preship` — ESLint then vitest. Offline, fast. |
| **Contract** | `npm run contract` — **required before every push.** Needs the network, and `CONTRACT_SITE_URL` in `.env`. Checks the five views, the three Edge Functions (b0.12: `payment-options` by a bad-token probe; b0.13: `request-booking` must answer `{ quote: true }` as a quote; b0.18: `quote-page` by a bad-token probe), AND (b0.11) that the DEPLOYED SITE is reachable and names the right origin. |

**Versions are `bN.N` and belong to this repo alone.** The CRM is on its own
line (v5.91 when b0.10 shipped). Calling a release here "v3.90" would mean
that one day `App.jsx` v3.90 and a guest site v3.90 exist and have nothing to
do with each other.

---

## 1. The contract — what this repo may touch

**Five views and three functions. That is the entire interface.** (b0.12 added `payment-options`; b0.18 `quote-page`.)

**b0.14 — and one outside service:** Mapbox's geocoder, for address
SUGGESTIONS on the delivery form only (`OUTSIDE.mapbox` in `contract.js`,
used only in `src/lib/address.js`), with this site's own public token
`VITE_MAPBOX_TOKEN` restricted to the site's origin. It never prices
anything; `request-booking` prices distance with its own secret token.

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
| `request-booking` | turns a request into a `held` booking the office approves; (b0.13) with `quote: true`, prices a stay and writes nothing - the live total; (b0.22) both take the guest's `coupon` code, and a quote answers `couponError` when it does not apply |
| `payment-options` | (b0.12) the `/pay/:token` page: `show` what a guest owes and can choose; `choose` a word (`deposit` / `full` / `balance`) and get a Stripe Checkout URL |
| `quote-page` | (b0.18, CRM v6.20) the `/quote/:token` page: `show` an office quote; `accept` accepts it (NOT booked until paid) and answers the pay page's token |

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
| **b0.25** | **The rental agreement, signed on the pay page** (CRM v6.40, Sprint 5; Jesse 09-27: BoldSign, embedded, sandbox first). When the office has switched e-signing on, a website booking's guest (WEB-/QTE-) signs before their first payment. `lib/agreement.js` calls the new `agreement` function with the same pay token (show / start / link / status / copy). `components/AgreementStep.jsx`: the guest picks **Initial every page** or **Initial all pages at once** (and gives an email if the CRM has none), the CRM builds the PDF and sends it to BoldSign, and BoldSign's signing window opens in the page; its `onDocumentSigned` message (checked to come from `https://app.boldsign.com`) - or this page itself, opened inside the window with `?signed=1` after signing, posting `centexSigned` to its parent - makes the page ask the CRM until it says signed. Only then do the payment choices show; the CRM refuses an unsigned booking's payment anyway (payment-options). Signed: "✓ Rental agreement signed · View your signed rental agreement" (a fresh 10-minute link at the tap), on the pay page and on /paid once a Book-and-pay booking is confirmed. Declined / failed / slow are said, with Start again. An older CRM without the function, or any failure, reads as "not needed". **Contract:** + the `agreement` function (probe: a bad token is our 401 with a sentence) and the outside host `app.boldsign.com`, held to `lib/agreement.js`; CONTRACT_VERSION b0.25. Guards: `agreement.test.jsx`; `pay.test.jsx` and `two-paths.test.jsx` now count the agreement call apart. |
| **b0.26** | **The rental agreement is signed AFTER the payment** (CRM v6.41; Jesse 09-27, after the sandbox test). Nothing on this site stops a guest paying any more (the CRM dropped its refusal). The guest is asked: **on /paid straight back from Stripe** - every return now carries the pay token `t` (the CRM adds it), and the page asks the agreement function, never the payment (a Book-and-pay guest once "You're booked"; an approved guest's deposit at once) - worded "One more step: sign your rental agreement"; **on the pay page** once something is paid (`show`'s new `paid`), above the choices, which stay; and **on the new /sign/:token page**, the link in the office's Signing Reminder Text: the trip (`show`'s new `trip`), the step, then the tick and the copy; a stale link says so in its own words. Same token and same private-page care as /pay (`usePrivatePage`, now exported). **Fixes from the sandbox:** "View your signed rental agreement" opens its window AT the tap (`openSignedCopy`; a window opened after the call was blocked), falling back to this tab; the email box is styled like the request form's. **Contract:** `show` returns + `paid`, `trip`; CONTRACT_VERSION b0.26. Guards: `agreement.test.jsx` (after payment, /paid, /sign, the window). |
| **b0.27** | **Delivery from Fleet Delivery Pricing** (CRM v6.72, Fleet Delivery Pricing R2; Jesse 10-01). The camper page and the request form read three new `public_listings` columns: `delivery_offered` (a range bound or a site), `delivery_max_miles` (the range bound's reach) and `delivery_sites` (`[{name, city, within_miles}]`: never an amount, street or point). The four v6.0x columns (minimum, miles, $/mile, max) are no longer read; CRM v6.73 drops them. New `lib/delivery.js` (pure, imports nothing, so the request form does not pull in the Supabase client). **Camper page**, still nothing about the rate (b0.16): a range bound shows "Delivery available within 75 miles."; with sites it adds "Also delivers to: Pecan Grove (Buda)."; sites only shows "Delivery to: Pecan Grove (Buda)."; neither shows nothing. **Request form:** "Deliver it to me" shows whenever `deliveryOffered` (it needed a $/mile, which hid Tier-1-only range bounds and site-only campers), with " (within 75 miles)" or " (to Pecan Grove (Buda))". The price is still the quote's (`request-booking`). **Contract:** the three columns replace the four; `VIEWS.public_listings.nested` pins the keys inside `delivery_sites`, and contract-offline counts them as known. CONTRACT_VERSION b0.27. **Order:** CRM SQL `update-public-listings-delivery-r2.sql` first, then this deploy. Guards: `delivery.test.js` (7); browse (the four page cases), request (site-only form).
| **b0.24** | **The start-day sentence where the guest sees it** (CRM v6.34, Sprint 4 fix chat; found in the live hand test 09-27). b0.23 put the sentence in `checkDates`, but the calendar only checks once there are TWO dates - and a start on the day before a busy range has no reachable return day, so the guest saw "Pick-up Mar 12, 2027 — now tap your return day." over a fully greyed month and never the sentence. Now `DatePicker` spots that start (`deadStart`: the next day is busy) and shows `busyRefusal`'s sentence at once in place of "now tap your return day", leaves later free days tappable, and the next tap anywhere starts again. Busy days stay greyed; an ordinary start still greys what it cannot reach. No contract change, no CRM change. Guards: `dates.test.jsx` "b0.24" (3 tests, rendering the picker). Gates: ESLint clean · 13 files / 277 tests; 5/5 mutations. |
| **b0.23** | **Two sentences** (CRM v6.34, Sprint 4 fix chat; Jesse 09-27). (1) **Why a start day was refused** (S4-CLOSE #9): the day just before a busy range is not greyed - a trip can END on it - but cannot be a start, and on a same-day camper it is another trip's pick-up day; the guest read "Those dates have just been taken" about a day that looked free. `busyRefusal` (`src/lib/dates.js`, used by `checkDates`) now says "This camper is booked from Tue, Nov 3, so a trip can't start on Mon, Nov 2 — it can end that day. Please pick another start date."; any other overlap keeps the old sentence (`DATES_TAKEN`). The CRM's `_shared/booking-request.ts` has its own copy, word for word, and request-booking refuses with it - `dates.test.jsx` here and `booking-request-validation.test.js` there check the same ranges against the same sentences. (2) **"We'll confirm availability"** (S4-CLOSE #23): /requested said "We'll confirm the price when we come back to you" and the quote box's no-total line "we'll confirm the price" - but since CRM v6.32 a request is saved only with its exact priced lines, so the price is not what waits. Both now say availability; "Nothing has been charged" stays. No contract change. **Deploy after CRM v6.34** (either order is safe: the sentences are the site's own). Gates: ESLint clean · 13 files / 274 tests. |
| **b0.22** | **The coupon code box** (CRM v6.32, Sprint 4 R10; Jesse 09-27). The quote box on the camper page - and the one in the request form - ends with a **"Have a coupon code?"** link (Jesse: behind a link, so most guests never see an empty box). It opens a box with **Apply**; an applied code shows as "Code SUMMER10 applied" with **Remove**, and the discount is the quote's own coupon line above it. The code is kept on the camper page (`coupon` = `{ code, error }`, like the dates and add-ons), so the page's box and the form's box are one code, and what is priced is what is sent. `quoteBooking` sends `coupon` only when there is one; `buildPayload` always sends it (`""` for none). **A code the server does not take is not a refusal** (Jesse: prices + the reason): the answer is the quote WITHOUT the code plus `couponError`, shown word for word under the box; the box keeps that quote as the quote for no code (nothing is asked twice), clears the code (a request carrying it would be refused) and leaves what was typed in the box to fix. A request whose code stopped applying between the quote and the press (its last use went, it was switched off) is refused with the server's sentence like any other refusal. Contract: `request-booking` `sends` + `coupon`; `quote.sends` + `coupon`; `quote.returns` + `couponError`. **Deploy after CRM v6.32** - an older server ignores the code and the box would show it with no discount. Gates: ESLint clean · 13 files / 270 tests. |
| **b0.21** | **The coupon line** (CRM v6.31, Sprint 4 R10; Jesse 09-26). The office can now put a coupon code on an office quote (and in Edit quote), so the pay page and the office-quote page can receive a `coupon` item: ONE line after the others, `amountCents` NEGATIVE (the only item that may be), label like "Coupon SUMMER10 (10% off the rental)". `readPayQuote` / `readQuote` accept a negative amount on a coupon line only (any other still drops the list); it has no detail (like delivery); `lineUsd` shows "-$45.00" (`usd` stays positive-only). Contract: `request-booking` kinds + `coupon`. Before b0.21 the two pages would have fallen back to the total alone. The code box on the camper page is b0.22 (CRM v6.32). Gates: ESLint clean · 13 files / 262 tests. |
| **b0.20** | **"Confirming your booking…" - a Book-and-pay guest is not told they're booked until they are** (CRM v6.26, Sprint 4 R9; Jesse 09-26). The CRM now only HOLDS a Book-and-pay card when the guest pays, then books and charges it, or lets the hold go (dates taken, or it couldn't confirm) - so Stripe's return is no longer evidence of a booking. The return address carries the guest's signed pay token (`t`); `/paid?booked=1&t=…` asks `payment-options` `{ action: "outcome", token }` every 2.5 s (up to 36 tries) and shows **Confirming your booking…** then **You're booked**, **Those dates were just taken** (card not charged) or **We couldn't confirm your booking** (not charged, try again in 30 minutes); past the limit, **Still confirming** (a text will follow). An answer it does not know is still "confirming" - never booked on a guess. `?booked=1` with no token (a page opened before the release) says **Payment received** and that a text confirms the booking. The approved guest's return is unchanged and never asks. Contract: `payment-options` returns `outcome`. Gates: ESLint clean · 13 files / 259 tests. |
| **b0.19** | **Prep Time Needed and Same Day Bookings reach the website** (CRM v6.21, Sprint 4 R8; Jesse 09-26). No code change here, on purpose: `public_listing_busy_dates` now publishes each reservation as `start - pad .. end + pad`, the camper's turnover pad (prep days widen it; a camper allowing same-day turnovers narrows it by a day each side), so `overlapsBusy` - inclusive, unchanged - and request-booking apply the camper's rule with one test. What guests see: prep days greyed like booked days; on a camper allowing same-day turnovers (the default, "with manual approval"), a return day is offered as the next pickup day - the site no longer refuses a check-out day as a rule of its own (`dates.js` "THE ONE DECISION", rewritten). A one-night trip under pad -1 publishes from > through: every overlapping stay is still refused, and no day is greyed for it. A same-day turnover on an approval camper is a REQUEST even when the camper would book and pay (the server's `path`). `npm run conformance` is the check - both sides read the same view. Gates: ESLint clean · 13 files / 251 tests. |
| **b0.18** | **An office quote: `/quote/:token`** (CRM v6.20, Sprint 4 R7; Jesse 09-26, second pass). A guest who CALLED and asked for a price is texted a link (the CRM's Quote Text, sent with Send quote from a Quote Pending booking). The page shows the camper, the dates, pickup or delivery, the items and Subtotal / Tax / Total (the pay page's shape, `readPayQuote`), and ONE button: **Accept and pay**. Jesse's rules: (1) **the dates are NOT held until the guest has PAID** - the page says so (`NOT_HELD_YET`) - and a quote whose dates went or whose start passed answers 410 `expired: true` with the server's sentence, shown as sent under "This quote has expired" (no retry); (2) **accepting does not book it**: the answer carries `payToken`, the pay page's own token, and the page goes straight to `/pay/<token>`; the PAYMENT books it, and the CRM texts "you're booked" then. Three states from the server's `accepted` / `paid`: not accepted (the quote + Accept and pay) / accepted, unpaid ("Pay to book", `ACCEPTED_NOT_PAID`, Choose how to pay - or with online payment off "Quote accepted", `PAY_BY_TEXT`) / paid ("You're booked"). The pay page for an accepted quote says `QUOTE_NOT_HELD` (payments.js) until the guest's own live hold names a time. The pay path is only ever this site's `/pay/<two base64url parts>` (`payPathFrom`). Private like the pay page (noindex, no-referrer, removed on the way out). New function in the contract: `quote-page` (`sends` action + token; a bad-token probe for `npm run contract`). Guards: `office-quote.test.jsx`, `pay.test.jsx`. Gates: ESLint clean · 13 files / 251 tests (two dummy URLs). |
| **b0.17** | **The two paths: Book and pay outside the notice window** (CRM v6.12, S4-DECISIONS "Two paths"). **Changes nothing a guest sees while payments are off** - the CRM answers every quote `path: "request"` until Settings > Payments is on with its Stripe key, pay page secret and site address (Jesse, S4 R4: "Behave as Path A"). Either deploy order works: an older server sends no `path` (every camper reads as a request) and ignores `book`; an older site never sends `book`. (1) The quote answer carries `path`; only the word "book" books (`quoteBooking`). The quote box reports it (`onPath`) only when an answer for what is on screen arrives - a refusal or an unreadable answer is "request" - so the button does not flicker while the guest types. (2) On "book" the camper page's call to action is **Book these dates** / "You'll pay to book on the next step." and the form is **Book these dates** / "Pay to book - your booking is confirmed as soon as your payment goes through..." with a **Book and pay** button; on anything else, exactly as before. (3) `book` is always a boolean in the payload (`buildPayload`), true only when the guest pressed Book and pay; the server can only narrow it to a request. (4) A booked answer (`path: "book"` WITH a `payToken`) goes straight to `/pay/<token>`; a "book" answer without a token is read as a request. (5) `switched: true` (pressed Book and pay, but the start slid inside the window) shows on /requested: "...it's a request rather than a booking. Nothing has been charged." (6) `/pay/:token` for a hold: **Pay to book**, and "We're holding these dates for you until 12:35 PM (Central)..." from `holdUntil` (`holdLine`). (7) `/paid/:ref?booked=1`: **You're booked**; `?booked=1&cancelled=1`: nothing charged AND nothing booked. Contract: request-booking `sends` + `book`, `returns` + `path`, `payToken`, `holdUntil`, `switched`; `quote.returns` + `path`; payment-options `returns` + `holdUntil`. Guards: `two-paths.test.jsx` (the whole journey both ways, switched, the calls, the pay page and /paid). Gates: ESLint clean · 12 files / 232 tests (two dummy URLs). |
| **b0.16** | **No delivery estimates; an itemised pay page** (CRM v6.09, Jesse 09-24: "If a guest can't enter an address that's in the Mapbox database then it won't be delivered"). **Deploy this BEFORE the v6.09 functions** - v6.09 refuses a delivery quote with no address, and b0.15 asks for one while the guest is still typing. (1) The quote box asks for NO price while delivery is ticked and the address is not all four parts; it says "Enter your delivery address to see your total." (2) Every delivery line and total is a price - no "from $X", no "to confirm", no "We'll confirm the delivery price" (`lineAmount` / `lineDetail` / `totalAmount`). The server's two refusals are shown word for word: "That address is unavailable. Please check the address again or select pickup instead" and "We're having trouble pricing delivery right now. Please choose pickup and contact us with the delivery address so we can update your reservation manually." (3) Send request with delivery and a part-filled address is stopped here in the CRM's own sentence (`ADDRESS_INCOMPLETE`). (4) The camper page's delivery sentence is Jesse's: "Delivery available within 75 miles." (the camper's own max), or "Delivery available." with no max - nothing about the rate. (5) `/pay/:token` lists the items the guest was quoted, then Subtotal and Tax, above the Total, for a website booking (`payment-options` `quote`, `readPayQuote`, `payPageView`); an office or OTA booking, or a v6.08 server, shows the Total alone as before. A list that does not add up to its Subtotal is not shown. Contract: request-booking `returns` lose `estimate`; payment-options `returns` + `quote`, with `quote.returns` / `quote.payLine`. `tax` stays a known quote kind for the deploy gap (v6.08 still sends the lines; skipped). Gates: ESLint clean · 11 files / 217 tests (two dummy URLs). |
| **b0.15** | **The delivery line drops "N miles, one-way"** (Jesse, 09-24, after the b0.14 hand test passed). A delivery priced by distance reads just "Delivery … $291.50" - no note under it. The miles are still in the quote the server sends and saves (the office panel shows "Delivery (41 miles)"); only the guest's line changed. The estimate line is unchanged ("from $220 · We'll confirm the delivery price."). One word in `lineDetail`; `quote.test.jsx` re-pointed with the reason, plus: no .q-detail on the line and no "mile"/"one-way" anywhere in the box. Gates: ESLint clean · 11 files / 207 tests. |
| **b0.14** | **Subtotal / Tax / Total, and delivery priced to the address** (CRM v6.05, Sprint 3 R4; Jesse 09-24). The quote shows the items, then **Subtotal / Tax / Total** - all three the server's own `subtotalCents` / `taxCents` / `totalCents` (`readQuote` refuses a quote without them or whose three do not add up, i.e. a pre-v6.05 server). The per-rate tax lines are still sent and stored but not listed; with no tax at all only the Total shows (no "$0" Tax). **Delivery by the mile:** the form sends the address with the quote only when all four parts are there (`deliveryDestination`), and waits 900 ms while an address is being typed (each complete one is a distance lookup on the server). A delivery line priced by distance reads "Delivery · 41 miles, one-way · $291.50" and the total loses its "from"; otherwise it stays "from $X · We'll confirm the delivery price." Too far is the server's refusal, word for word ("…exceeds our delivery radius. Please call us…"). **Address suggestions** (`lib/address.js`): the ONE outside service, declared in `contract.js` as `OUTSIDE.mapbox` - Mapbox Geocoding v5, `types=address`, US, near Kyle, 5 results, **this site's own public token `VITE_MAPBOX_TOKEN`** (Netlify env; restricted in Mapbox to book.centexrvrentals.com); a suggestion is only offered with all four parts; choosing one fills the four boxes. No token = no list, form as before. Suggestions never price anything - the server geocodes again with its own secret token. Camper page: "Delivery available within 75 miles: $220 for the first 30 miles, then $6.50 a mile. Add your address when you request and we'll price it." (the Pricing tab's sentence, as written). `npm run conformance` stops unless the server sends `subtotalCents` (CRM v6.05). Guards: offline, every https host in source is declared (plus checkout.stripe.com, where Pay sends the browser), Mapbox used only in `lib/address.js`, its token only from the env and no `pk.`/`sk.` literal anywhere. New `src/address.test.jsx` (8); quote +11, contract-offline +2, browse +1; b0.13 tests re-pointed for the summary. Gates: ESLint clean · **11 files / 207 tests** (two dummy URLs); **20/21 mutations**, 1 equivalent (Tax shown as total − subtotal, equal by `readQuote`'s own rule). **Needs CRM v6.05 deployed first.** |
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
