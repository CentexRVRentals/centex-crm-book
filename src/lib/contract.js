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

export const CONTRACT_VERSION = "b0.1";

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
    optional: ["addon_id", "description", "addon_type", "charge_by", "daily", "required", "position", "image_path"],
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
    sends: [
      "unitId", "start", "end", "name", "email", "phone",
      "method", "guests", "address", "city", "state", "zip", "notes", "company",
    ],
    // Returned. `errors` is an array of sentences written to be shown to a
    // guest verbatim — this site does not rewrite them, because the server is
    // the only thing that knows why it refused.
    returns: ["ok", "reservationNum", "errors", "duplicate"],
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
    returns: [
      "reservationNum", "unitName", "start", "end", "totalCents", "paidCents", "owedCents",
      "insideWindow", "windowDays", "options", "security", "words", "url", "error",
    ],
    // How `npm run contract` checks it is deployed without creating anything:
    // a token that cannot verify must come back 401 WITH the server's own
    // sentence. The gateway's 401 (no --no-verify-jwt) carries no `error`.
    probe: { body: { action: "show", token: "contract.check" }, status: 401, key: "error" },
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
