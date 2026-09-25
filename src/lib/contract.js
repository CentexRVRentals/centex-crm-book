// THE CONTRACT.
//
// This repo reads five views in the Centex CRM's database and calls two Edge
// Functions (request-booking; from b0.12, payment-options). That is the entire interface. It never reads a base table, never
// writes anything directly, and shares no code with the CRM repo.
//
// WHY THIS FILE IS DATA AND NOT PROSE. A document describing another repo's
// shape drifts the moment that repo changes, and nothing here notices. The CRM
// has a catalogue of exactly that — a schema file missing 28 columns, a lint
// config describing a codebase 15,000 lines smaller than the real one, a test
// pinning a database view that had been replaced twice.
//
// So the contract is a list the machine can check. `npm run contract` queries
// every view below against the live database and fails if a column this site
// reads is not there. HANDOVER.md §1 describes it for a person; THIS is what
// makes it true.
//
// TO ADD A COLUMN: add it here first, run `npm run contract`, and only then
// write the code that reads it. A column that fails the check does not exist
// yet, whatever the CRM's migration says.

export const CONTRACT_VERSION = "b0.13";

// ----------------------------------------------------------------------------
// The five views. Granted SELECT to `anon` and nothing else.
// ----------------------------------------------------------------------------
// `required` is what this site cannot render without. `optional` is read when
// present — the check reports it missing but does not fail, because a camper
// with no add-ons and a camper whose add-ons view lost a column are different
// problems and only one is an outage.
export const VIEWS = {
  public_listings: {
    why: "the listing grid and every camper page",
    required: ["unit_id", "name", "price_per_night"],
    optional: [
      "type", "year", "make", "model", "sleeps", "tvs",
      "interior_dimensions", "fresh_water_tank", "grey_water_tank", "black_water_tank",
      "unit_description", "minimum_nights", "security_deposit",
      "prep_fee", "prep_fee_description",
      "delivery_minimum", "delivery_miles", "delivery_dollar_mile", "delivery_miles_max",
      "check_in", "check_out", "minimum_guest_age",
      "pet_friendly", "festival_friendly", "tailgate_friendly", "beach_friendly", "smoking_allowed",
      "custom_rule_1", "custom_rule_2", "custom_rule_3", "custom_rule_4", "custom_rule_5",
      "cancellation_policy",
    ],
  },

  public_listing_photos: {
    why: "the gallery and the grid's cover image",
    required: ["unit_id", "storage_path"],
    optional: ["thumb_path", "caption", "sort_order", "is_cover"],
  },

  public_listing_addons: {
    why: "what a guest can add, and what it costs",
    required: ["unit_id", "name", "price"],
    // b0.13 (CRM v6.04): + max_quantity, - charge_by.
    //   max_quantity - the most ONE booking may take (CRM decision 7), already
    //     normalised by the view to the number request-booking prices with, so
    //     this site never re-derives it. Optional: an older view without it
    //     means "1 of each", which the picker also falls back to.
    //   charge_by - gone (decision 6: Daily is how an add-on is charged). It
    //     was mapped here and never shown.
    optional: ["addon_id", "description", "addon_type", "daily", "max_quantity", "required", "position", "image_path"],
  },

  public_listing_amenities: {
    why: "the amenity list on a camper page",
    // amenity_name IS REQUIRED, and getting that wrong is what hid this bug.
    //
    // The first version of this entry listed `name`, `category` and
    // `sort_order` — guessed, because the table was empty and no row had ever
    // come back. All three were wrong: the view selects `amenity_group` and
    // `amenity_name`. The site read `r.name`, got undefined, filtered every
    // amenity out, and the panel silently never rendered.
    //
    // AND THE CONTRACT CHECK REPORTED `ok`, because everything but unit_id was
    // marked optional. The rule at the top of this file says required means
    // "what this site cannot render without" — which amenity_name plainly is.
    // Marking it optional out of caution turned a failure into a warning, and
    // a warning is what got scrolled past.
    required: ["unit_id", "amenity_name"],
    optional: ["amenity_group"],
  },

  // THE ONE THAT MATTERS MOST. If this view is wrong, a guest books a camper
  // that is already committed. It was wrong twice before v3.88 — it lost the
  // manual calendar blocks in one rewrite, and never blocked `held` bookings in
  // any version until then.
  public_listing_busy_dates: {
    why: "which dates cannot be booked",
    required: ["unit_id", "busy_from", "busy_through"],
    optional: [],
  },
};

// ----------------------------------------------------------------------------
// The functions.
// ----------------------------------------------------------------------------
// Deployed --no-verify-jwt, so it is called with no Authorization header. It is
// the only write path this site has.
export const FUNCTIONS = {
  "request-booking": {
    why: "turns a request into a held booking the office approves",
    method: "POST",
    // Sent. `company` is a honeypot: it is rendered hidden, a human never fills
    // it, and the server answers a filled one with a plausible success while
    // writing nothing. It must stay in the form.
    //
    // b0.13: `addons` is [{ id, qty }] - the guest's choices, ALWAYS an array
    // (empty for none). The server refuses anything else, "" included, so it is
    // never blank-filled like the text fields.
    //
    // b0.17 (CRM v6.12): `book` - true when the guest pressed Book and pay on a
    // camper whose quote said `path: "book"`, false otherwise. It can only ever
    // NARROW to a request: the server books only when its own path for that
    // camper, today, is "book".
    sends: [
      "unitId", "start", "end", "name", "email", "phone",
      "method", "guests", "address", "city", "state", "zip", "notes", "company",
      "addons", "book",
    ],
    // Returned. `errors` is an array of sentences written to be shown to a
    // guest verbatim — this site does not rewrite them, because the server is
    // the only thing that knows why it refused.
    //
    // b0.13 (CRM v6.03): a real request also returns the quote it saved -
    // `lines`, `totalCents`, `estimate` - which /requested shows.
    //
    // b0.14 (CRM v6.05): + subtotalCents and taxCents - Subtotal / Tax / Total.
    //
    // b0.16 (CRM v6.09): - `estimate`. There are no estimates: a delivery is
    // priced by the mile or refused, in one of Jesse's sentences.
    //
    // b0.17 (CRM v6.12) - THE TWO PATHS. `path` is "book" or "request".
    //   book     a short checkout hold was made: `payToken` opens /pay/<token>,
    //            `holdUntil` (ISO) is when the dates stop being held.
    //   request  a Held request, as before. `switched` is true when the guest
    //            pressed Book and pay but today it is a request (the start slid
    //            inside the notice window while the page sat open).
    returns: [
      "ok", "reservationNum", "errors", "duplicate", "lines", "subtotalCents", "taxCents", "totalCents",
      "path", "payToken", "holdUntil", "switched",
    ],

    // b0.13 - THE LIVE QUOTE. The same function with `quote: true`: the camper,
    // dates, method and add-ons are checked exactly as a request checks them,
    // priced by the server, and nothing is written. Every refusal carries
    // `quote: true` too, so an answer without it is not a quote (an older
    // deploy, or the honeypot's plausible nothing).
    //
    // A line: { kind, label, addonId, quantity, nights, unitPriceCents,
    // amountCents }. kind is rental | prep | addon | delivery | tax. No tax
    // rate is ever sent - a rate is a business detail the guest sees as an
    // amount. `estimate` is true when delivery is on it: the delivery line is
    // the camper's minimum and the office confirms the distance.
    //
    // b0.14 (CRM v6.05): a delivery quote may carry the address (all four
    // parts, or none) and is then priced BY THE MILE - the delivery line gets
    // `miles` and `estimate` goes false. Too far is a refusal in Jesse's
    // words. `subtotalCents + taxCents = totalCents`; the page shows those three
    // and not the per-rate tax lines.
    //
    // b0.16 (CRM v6.09, Jesse 09-24): NO ESTIMATES. "If a guest can't enter an
    // address that's in the Mapbox database then it won't be delivered." A
    // delivery quote is asked for only with all four address parts, and is
    // priced by the mile or REFUSED ("That address is unavailable..." or "We're
    // having trouble pricing delivery right now..."). `estimate` is gone, and
    // the per-rate tax lines are no longer sent. `tax` stays a known kind: this
    // site deploys BEFORE v6.09, and v6.08 still sends them (they are skipped).
    quote: {
      sends: ["quote", "unitId", "start", "end", "method", "addons", "address", "city", "state", "zip"],
      // b0.17 (CRM v6.12): + `path` - which button the form shows. Anything
      // but "book" (an older server included) is a request.
      returns: ["ok", "quote", "lines", "subtotalCents", "taxCents", "totalCents", "errors", "path"],
      line: ["kind", "label", "addonId", "quantity", "nights", "unitPriceCents", "amountCents", "miles"],
      kinds: ["rental", "prep", "addon", "delivery", "tax"],
    },
  },

  // b0.12 — the "choose how to pay" page (/pay/:token). Deployed
  // --no-verify-jwt like request-booking: the signed token in the URL is the
  // credential (CRM decision 28), so it is called with no Authorization header.
  "payment-options": {
    why: "the pay page: what a guest owes and how they can pay it, then a Stripe Checkout",
    method: "POST",
    // `option` is a WORD (deposit | full | balance), never an amount — the
    // server re-derives what to charge at the moment of choosing.
    sends: ["action", "token", "option"],
    // b0.16 (CRM v6.09): + `quote` - what the total is made of, for a website
    // booking: { items, subtotalCents, taxCents }, each item a quote line
    // (quote.payLine below, the quote box's own shape less miles). null for an
    // office or OTA booking, which has no lines; the page then shows the total
    // alone, as before. Absent from a v6.08 server - the same as null.
    returns: [
      "reservationNum", "unitName", "start", "end", "totalCents", "paidCents", "owedCents",
      "insideWindow", "windowDays", "options", "security", "words", "quote", "url", "error",
      // b0.17 (CRM v6.12): until when a Book-and-pay guest's dates are held
      // (ISO), or null for every other booking.
      "holdUntil",
    ],
    quote: {
      returns: ["items", "subtotalCents", "taxCents"],
      payLine: ["kind", "label", "addonId", "quantity", "nights", "unitPriceCents", "amountCents"],
    },
    // How `npm run contract` checks it is deployed without creating anything:
    // a token that cannot verify must come back 401 WITH the server's own
    // sentence. The gateway's 401 (no --no-verify-jwt) carries no `error`.
    probe: { body: { action: "show", token: "contract.check" }, status: 401, key: "error" },
  },
};

// ----------------------------------------------------------------------------
// b0.14 — the ONE outside service. Not the CRM, so not a view or a function:
// Mapbox's geocoder, for address SUGGESTIONS on the delivery form, with this
// site's own public token (restricted to the site's origin in Mapbox). It
// decides nothing - the server prices distance with its own secret token. An
// offline guard holds every other host out of the source.
// ----------------------------------------------------------------------------
export const OUTSIDE = {
  mapbox: {
    why: "address suggestions on the delivery form - never a price",
    host: "https://api.mapbox.com",
    env: "VITE_MAPBOX_TOKEN",
    file: "src/lib/address.js",
  },
};

// ----------------------------------------------------------------------------
// What this site must NEVER touch.
// ----------------------------------------------------------------------------
// Named so the offline guard can check for them by name. Reading any of these
// would mean the anon grant is wider than it should be, and the failure would
// be silent — a successful query returning data no guest should see.
export const FORBIDDEN_TABLES = [
  "fleet", "bookings", "customers", "employees", "delivery_jobs",
  "maintenance_items", "unit_photos", "unit_documents", "unit_pricing",
  "unit_policies", "unit_amenities", "unit_addons", "unit_listing_photos",
  "workflow_checklists", "workflow_task_completions", "audit_log", "app_settings",
  "unit_calendar_rules", "backups", "kv_store",
];
