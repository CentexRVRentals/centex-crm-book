// @vitest-environment jsdom
//
// b0.2 — THE BROWSE PAGES, RENDERED.
//
// The data these pages read is written by a repo this one cannot see, on a
// deploy schedule it does not control. So the question is not "does it render
// the happy path" — it is "does it render whatever the views actually return."
//
// TWO SHAPES ARE TESTED, and only one of them is hypothetical:
//
//   * REAL — column-for-column what the contract check saw on 9 Sep 2026:
//     public_listings with 36 columns, photos with 6, busy_dates with 3, and
//     add-ons and amenities EMPTY, because both source tables have zero rows.
//     That last part is not a defensive nicety. It is the only state that has
//     ever existed.
//
//   * HOSTILE — every field as every wrong type. `row?.name` guards the key
//     being absent and says nothing about its type, and an object rendered as
//     a React child throws "Objects are not valid as a React child" — a white
//     screen, not a blank field. The CRM learned that from one malformed audit
//     row taking down the whole app.
//
// The Supabase client is mocked at the module boundary rather than the network,
// so these run offline and in milliseconds. `npm run contract` is what checks
// the real database, and it is a separate, deliberate, manual step.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ----------------------------------------------------------------------------
// The mock. One table's rows per view name.
// ----------------------------------------------------------------------------
let TABLES = {};

vi.mock("./lib/supabase.js", () => {
  const query = (rows) => {
    const q = {
      select: () => q,
      eq: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return {
    supabase: { from: (name) => query(TABLES[name] ?? []) },
    photoUrl: (p) => (p ? `https://example.test/storage/${p}` : null),
  };
});

const { default: Listings } = await import("./pages/Listings.jsx");
const { default: Camper } = await import("./pages/Camper.jsx");

// ----------------------------------------------------------------------------
// Fixtures, taken from what the contract check actually returned.
// ----------------------------------------------------------------------------
const LISTING = {
  unit_id: "mt1yujz87zxzve", name: "Titan", price_per_night: 119,
  type: "Travel Trailer", year: 2021, make: "Grand Design", model: "Imagine",
  sleeps: 6, tvs: 1, interior_dimensions: "26 ft", unit_description: "A good one.",
  fresh_water_tank: "50 gal", grey_water_tank: "40 gal", black_water_tank: "30 gal",
  minimum_nights: 2, security_deposit: 500, prep_fee: 75, prep_fee_description: "Prep & sanitise",
  delivery_minimum: 50, delivery_miles: 20, delivery_dollar_mile: 3, delivery_miles_max: 100,
  check_in: "10:00", check_out: "16:00", minimum_guest_age: 25,
  pet_friendly: true, festival_friendly: false, tailgate_friendly: true,
  beach_friendly: false, smoking_allowed: false,
  custom_rule_1: "No smoking inside.", custom_rule_2: null, custom_rule_3: null,
  custom_rule_4: null, custom_rule_5: null,
  cancellation_policy: "Moderate",
};

const PHOTO = {
  unit_id: "mt1yujz87zxzve", storage_path: "u1/a.jpg", thumb_path: "u1/a-thumb.jpg",
  caption: "Front", sort_order: 0, is_cover: true,
};

// UNMOUNTS. The first version of this helper mounted a root and never tore it
// down, so the hostile-data cases below — 36 columns x 11 types = 396 renders
// each — left 396 live React roots in one test, every one of them making the
// next render slower. It passed in the container it was written in and timed
// out at 5s on the machine that mattered, which is §4.159 again: green because
// of the machine, not because of the code.
async function renderAsync(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  // React's development build re-throws an error a boundary already handled,
  // and jsdom reports it as an uncaught window error. Swallowed for the
  // duration of the render only.
  const swallow = (e) => e.preventDefault();
  window.addEventListener("error", swallow);
  let html = "";
  try {
    act(() => { root.render(ui); });
    // The pages fetch in an effect. Flush the microtasks the mock resolves on.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    html = host.innerHTML;
  } finally {
    window.removeEventListener("error", swallow);
    act(() => { root.unmount(); });
    host.remove();
  }
  // `html` is a STRING captured before unmount, not a function reading a
  // detached node. A caller that read host.innerHTML after teardown would get
  // an empty string and a passing assertion that checked nothing.
  return { html: () => html };
}

const listingsPage = () => <MemoryRouter><Listings /></MemoryRouter>;
const camperPage = (id) => (
  <MemoryRouter initialEntries={[`/camper/${id}`]}>
    <Routes><Route path="/camper/:unitId" element={<Camper />} /></Routes>
  </MemoryRouter>
);

beforeEach(() => {
  TABLES = {};
  // React logs a warning per malformed render. At ~800 renders that is ~800
  // RPC round trips to the vitest worker, which is both the slowness and the
  // "Closing rpc while onUserConsoleLog was pending" teardown error. Silenced
  // here, not suppressed globally: a genuine console.error in a normal test
  // still surfaces.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

// ----------------------------------------------------------------------------

describe("the grid", () => {
  it("CRITICAL: renders a camper with a photo and a price (anti-vacuity)", async () => {
    // Without this, a component that rendered nothing would satisfy every
    // other case in this file.
    TABLES = { public_listings: [LISTING], public_listing_photos: [PHOTO] };
    const { html } = await renderAsync(listingsPage());
    expect(html()).toContain("Titan");
    expect(html()).toContain("$119");
    expect(html()).toContain("storage/u1/a-thumb.jpg");
  });

  it("CRITICAL: a camper with NO photo still renders", async () => {
    // The state every camper was in until recently, and the state a new camper
    // is in for as long as it takes somebody to upload one.
    TABLES = { public_listings: [LISTING], public_listing_photos: [] };
    const { html } = await renderAsync(listingsPage());
    expect(html()).toContain("Titan");
    expect(html()).toContain("Photos coming soon");
  });

  it("CRITICAL: an empty fleet is not an error", async () => {
    // A data state, not a fault. Saying "something went wrong" would send
    // somebody looking for a bug that is not there.
    TABLES = { public_listings: [] };
    const { html } = await renderAsync(listingsPage());
    expect(html()).toContain("Nothing available just now");
    expect(html()).not.toContain("couldn't load");
  });

  it("CRITICAL: only the cover photo is used, not the first row returned", async () => {
    TABLES = {
      public_listings: [LISTING],
      public_listing_photos: [
        { ...PHOTO, storage_path: "u1/z.jpg", thumb_path: "u1/z-thumb.jpg", is_cover: false, sort_order: 5 },
        { ...PHOTO, storage_path: "u1/cover.jpg", thumb_path: "u1/cover-thumb.jpg", is_cover: true, sort_order: 9 },
      ],
    };
    const { html } = await renderAsync(listingsPage());
    expect(html()).toContain("cover-thumb.jpg");
    expect(html()).not.toContain("z-thumb.jpg");
  });
});

describe("the camper page", () => {
  it("CRITICAL: renders the whole page from the real listing shape", async () => {
    TABLES = {
      public_listings: [LISTING],
      public_listing_photos: [PHOTO],
      public_listing_addons: [],
      public_listing_amenities: [],
    };
    const { html } = await renderAsync(camperPage("mt1yujz87zxzve"));
    const h = html();
    expect(h).toContain("Titan");
    expect(h).toContain("$119");
    expect(h).toContain("2-night minimum");
    expect(h).toContain("$500");            // deposit
    expect(h).toContain("Prep &amp; sanitise");
    expect(h).toContain("Moderate");        // cancellation policy
    expect(h).toContain("No smoking inside.");
    expect(h).toContain("25 or older");
    expect(h).toContain("Grand Design");
  });

  it("CRITICAL: add-ons and amenities EMPTY — the only state that exists today", async () => {
    // Both source tables have zero rows. This is not a hypothetical.
    TABLES = {
      public_listings: [LISTING], public_listing_photos: [PHOTO],
      public_listing_addons: [], public_listing_amenities: [],
    };
    const { html } = await renderAsync(camperPage("mt1yujz87zxzve"));
    // Add-ons says so plainly; amenities renders nothing rather than an empty
    // heading, because a section title with nothing under it reads as broken.
    expect(html()).toContain("Nothing to add on this one just yet");
    expect(html()).not.toContain("What's on board");
  });

  it("renders add-ons once they exist, required first", async () => {
    TABLES = {
      public_listings: [LISTING], public_listing_photos: [],
      public_listing_addons: [
        { addon_id: "a2", unit_id: LISTING.unit_id, name: "Generator", price: 45, daily: true, position: 2 },
        { addon_id: "a1", unit_id: LISTING.unit_id, name: "Linen package", price: 30, required: true, position: 9 },
      ],
      public_listing_amenities: [{ unit_id: LISTING.unit_id, name: "Air conditioning", sort_order: 0 }],
    };
    const { html } = await renderAsync(camperPage("mt1yujz87zxzve"));
    const h = html();
    expect(h.indexOf("Linen package")).toBeLessThan(h.indexOf("Generator"));
    expect(h).toContain("included");
    expect(h).toContain("Air conditioning");
  });

  it("CRITICAL: an unknown camper is Not Found, not an error", async () => {
    TABLES = { public_listings: [] };
    const { html } = await renderAsync(camperPage("does-not-exist"));
    expect(html()).toContain("couldn't find that camper");
  });
});

describe("hostile data — every field as every wrong type", () => {
  const HOSTILE = [undefined, null, "", 0, 42, true, [], {}, { a: 1 }, ["x"], "  "];

  it("CRITICAL: no listing column of any type white-screens the grid", async () => {
    for (const key of Object.keys(LISTING)) {
      for (const v of HOSTILE) {
        TABLES = { public_listings: [{ ...LISTING, [key]: v }], public_listing_photos: [] };
        await expect(
          renderAsync(listingsPage()),
          `public_listings.${key} = ${JSON.stringify(v)}`
        ).resolves.toBeTruthy();
      }
    }
  });

  it("CRITICAL: no listing column of any type white-screens the camper page", async () => {
    for (const key of Object.keys(LISTING)) {
      for (const v of HOSTILE) {
        TABLES = {
          public_listings: [{ ...LISTING, [key]: v }],
          public_listing_photos: [], public_listing_addons: [], public_listing_amenities: [],
        };
        await expect(
          renderAsync(camperPage(LISTING.unit_id)),
          `camper page: public_listings.${key} = ${JSON.stringify(v)}`
        ).resolves.toBeTruthy();
      }
    }
  });

  it("CRITICAL: malformed photo, add-on and amenity rows are survivable", async () => {
    TABLES = {
      public_listings: [LISTING],
      public_listing_photos: [null, undefined, {}, { storage_path: 42 }, { storage_path: { a: 1 } }],
      public_listing_addons: [null, {}, { name: {} }, { name: "Real", price: "not a number" }],
      public_listing_amenities: [null, {}, { name: ["array"] }],
    };
    const { html } = await renderAsync(camperPage(LISTING.unit_id));
    expect(html()).toContain("Titan");
    // The one valid add-on survives; the malformed ones are dropped rather
    // than rendered as "[object Object]".
    expect(html()).toContain("Real");
    expect(html()).not.toContain("[object Object]");
  });

  it("CRITICAL: a query error is an error state, not a blank page", async () => {
    // A blank page looks like an empty fleet, which sends somebody looking at
    // the data instead of the connection.
    const { supabase } = await import("./lib/supabase.js");
    vi.spyOn(supabase, "from").mockImplementation(() => {
      throw new Error("relation \"public_listings\" does not exist");
    });
    const { html } = await renderAsync(listingsPage());
    expect(html()).toContain("couldn't load");
    // And the reason is on the page — small, but present. "Something went
    // wrong" with no detail is the message that cost the CRM an afternoon.
    expect(html()).toContain("does not exist");
  });
});
