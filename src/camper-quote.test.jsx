// @vitest-environment jsdom
//
// b0.13 — THE WHOLE JOURNEY ON ONE CAMPER PAGE.
//
// quote.test.jsx drives each piece alone. This is the one test that walks a
// guest through the page as it is wired - tick an add-on, pick dates, see the
// total, request, land on /requested - because every piece passing alone says
// nothing about whether the PAGE hands the choices from one to the next. (The
// first mutation run of b0.13 proved it: the camper page could hand the form
// an empty add-on list and every other test stayed green.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { addDays, todayCentral } from "./lib/dates.js";
import { QUOTE_DEBOUNCE_MS } from "./lib/quote.js";

let TABLES = {};
vi.mock("./lib/supabase.js", () => {
  const query = (rows) => {
    const q = {
      select: () => q, eq: () => q, limit: () => q,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return { supabase: { from: (name) => query(TABLES[name] ?? []) }, photoUrl: (p) => (p ? `https://example.test/${p}` : null) };
});
const { default: Camper } = await import("./pages/Camper.jsx");
const { default: Requested } = await import("./pages/Requested.jsx");

const LISTING = { unit_id: "CHARLIE", name: "Charlie", price_per_night: 109, minimum_nights: 2, delivery_dollar_mile: 3, delivery_minimum: 75 };
const ADDONS = [
  { addon_id: "kit", unit_id: "CHARLIE", name: "Cleaning kit", price: 40, daily: false, max_quantity: 1, required: true, position: 0 },
  { addon_id: "gen", unit_id: "CHARLIE", name: "Generator", price: 35, daily: true, max_quantity: 1, position: 1 },
  { addon_id: "lin", unit_id: "CHARLIE", name: "Linen package", price: 25, daily: false, max_quantity: 3, position: 2 },
];
const LINES = [
  { kind: "rental", label: "Rental", addonId: null, quantity: 1, nights: 4, unitPriceCents: 10900, amountCents: 43600 },
  { kind: "addon", label: "Cleaning kit", addonId: "kit", quantity: 1, nights: null, unitPriceCents: 4000, amountCents: 4000 },
  { kind: "addon", label: "Generator", addonId: "gen", quantity: 1, nights: 4, unitPriceCents: 3500, amountCents: 14000 },
];
const reply = (b, s = 200) => ({ status: s, json: async () => b });

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const button = (host, text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

beforeEach(() => {
  TABLES = { public_listings: [LISTING], public_listing_addons: ADDONS };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("one camper page, start to finish", () => {
  it("CRITICAL: what is ticked is what is priced is what is sent is what /requested shows", async () => {
    const bodies = [];
    vi.stubGlobal("fetch", vi.fn(async (_u, opts) => {
      const b = JSON.parse(opts.body);
      bodies.push(b);
      return b.quote
        ? reply({ ok: true, quote: true, lines: LINES, totalCents: 61600, estimate: false })
        : reply({ ok: true, reservationNum: "WEB-260930-TEST", lines: LINES, totalCents: 61600, estimate: false });
    }));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/camper/CHARLIE"]}>
          <Routes>
            <Route path="/camper/:unitId" element={<Camper />} />
            <Route path="/requested/:reservationNum" element={<Requested />} />
          </Routes>
        </MemoryRouter>
      );
    });
    await flush();
    vi.useFakeTimers();

    // 1. Tick the generator.
    click(host.querySelector('input[aria-label="Add Generator"]'));

    // 2. Pick four nights about six weeks out, paging the calendar to them.
    const start = addDays(todayCentral(), 45);
    const end = addDays(start, 4);
    for (const iso of [start, end]) {
      for (let i = 0; i < 4 && !host.querySelector(`button[aria-label="${iso}"]`); i++) click(button(host, "›") || host.querySelector('button[aria-label="Next month"]'));
      const day = host.querySelector(`button[aria-label="${iso}"]`);
      expect(day, `no calendar button for ${iso}`).toBeTruthy();
      click(day);
    }

    // 3. The total arrives, priced with the generator - and NOT the required
    //    kit, which the server adds itself.
    await act(async () => { vi.advanceTimersByTime(QUOTE_DEBOUNCE_MS); });
    await flush();
    const firstQuote = bodies.find((b) => b.quote);
    expect(firstQuote, "the camper page never asked for a quote").toBeTruthy();
    expect(firstQuote).toMatchObject({ unitId: "CHARLIE", start, end, method: "pickup", addons: [{ id: "gen", qty: 1 }] });
    expect(host.textContent).toContain("$616");

    // 4. Request, fill in, send.
    click(button(host, "Request these dates"));
    await flush();
    const setVal = (label, v) => {
      const input = [...host.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      act(() => { setter.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    setVal("Your name", "Jane Doe");
    setVal("Email", "jane@example.com");
    click(button(host, "Send request"));
    await flush();

    const request = bodies.find((b) => !b.quote);
    expect(request, "the request was not sent").toBeTruthy();
    expect(request.addons).toEqual([{ id: "gen", qty: 1 }]);

    // 5. /requested shows the quote the server saved.
    expect(host.textContent).toContain("WEB-260930-TEST");
    expect(host.textContent).toContain("What we quoted");
    expect(host.textContent).toContain("$616");

    act(() => root.unmount());
    host.remove();
  });
});
