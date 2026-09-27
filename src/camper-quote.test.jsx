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
        ? reply({ ok: true, quote: true, lines: LINES, subtotalCents: 61600, taxCents: 0, totalCents: 61600, estimate: false })
        : reply({ ok: true, reservationNum: "WEB-260930-TEST", lines: LINES, subtotalCents: 61600, taxCents: 0, totalCents: 61600, estimate: false });
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

// ============================================================================
// b0.22 (CRM v6.32) - THE COUPON CODE, ON THE SAME PAGE
// ============================================================================
describe("a coupon code on the camper page (b0.22)", () => {
  const COUPON = { kind: "coupon", label: "Coupon SUMMER10 (10% off the rental)", addonId: null, quantity: 1, nights: null, unitPriceCents: null, amountCents: -4360 };
  const setText = (input, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => { setter.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };

  async function open(answer) {
    const bodies = [];
    vi.stubGlobal("fetch", vi.fn(async (_u, opts) => {
      const b = JSON.parse(opts.body);
      bodies.push(b);
      return reply(answer(b));
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
    const start = addDays(todayCentral(), 45);
    const end = addDays(start, 4);
    for (const iso of [start, end]) {
      for (let i = 0; i < 4 && !host.querySelector(`button[aria-label="${iso}"]`); i++) click(button(host, "›") || host.querySelector('button[aria-label="Next month"]'));
      click(host.querySelector(`button[aria-label="${iso}"]`));
    }
    const settle = async () => { await act(async () => { vi.advanceTimersByTime(QUOTE_DEBOUNCE_MS); }); await flush(); };
    await settle();
    return { host, root, bodies, settle };
  }
  const fill = (host) => {
    const setVal = (label, v) => setText([...host.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input"), v);
    setVal("Your name", "Jane Doe");
    setVal("Email", "jane@example.com");
  };

  it("CRITICAL: behind a link; applied, it is priced, shown, carried into the form and sent with the request", async () => {
    const { host, root, bodies, settle } = await open((b) => {
      const lines = b.coupon === "SUMMER10" ? [...LINES, COUPON] : LINES;
      const total = b.coupon === "SUMMER10" ? 57240 : 61600;
      return b.quote
        ? { ok: true, quote: true, lines, subtotalCents: total, taxCents: 0, totalCents: total }
        : { ok: true, reservationNum: "WEB-260930-CPN1", lines, subtotalCents: total, taxCents: 0, totalCents: total };
    });
    // A link, not a box.
    expect(host.querySelector('input[aria-label="Coupon code"]')).toBeNull();
    expect(bodies.filter((b) => b.quote).every((b) => !("coupon" in b))).toBe(true);
    click(button(host, "Have a coupon code?"));
    setText(host.querySelector('input[aria-label="Coupon code"]'), " summer 10 ");
    click(button(host, "Apply"));
    await settle();
    expect(bodies.filter((b) => b.quote).at(-1).coupon).toBe("SUMMER10");
    expect(host.textContent).toContain("Coupon SUMMER10 (10% off the rental)");
    expect(host.textContent).toContain("-$43.60");
    expect(host.textContent).toContain("$572.40");
    expect(host.textContent).toContain("Code SUMMER10 applied");

    // The form's own box prices the same code, and the request carries it.
    click(button(host, "Request these dates"));
    await settle();
    expect(bodies.filter((b) => b.quote).at(-1).coupon).toBe("SUMMER10");
    expect(host.textContent).toContain("Code SUMMER10 applied");
    fill(host);
    click(button(host, "Send request"));
    await flush();
    expect(bodies.find((b) => !b.quote).coupon).toBe("SUMMER10");
    expect(host.textContent).toContain("WEB-260930-CPN1");
    expect(host.textContent).toContain("-$43.60");
    act(() => root.unmount());
    host.remove();
  });

  it("CRITICAL: a code the server does not take - the prices stay, its sentence shows, and the request does NOT carry it", async () => {
    const { host, root, bodies, settle } = await open((b) => (b.quote
      ? { ok: true, quote: true, lines: LINES, subtotalCents: 61600, taxCents: 0, totalCents: 61600, ...(b.coupon ? { couponError: "This code has expired." } : {}) }
      : { ok: true, reservationNum: "WEB-260930-CPN2", lines: LINES, subtotalCents: 61600, taxCents: 0, totalCents: 61600 }));
    click(button(host, "Have a coupon code?"));
    setText(host.querySelector('input[aria-label="Coupon code"]'), "OLDCODE");
    const asked = bodies.filter((b) => b.quote).length;
    click(button(host, "Apply"));
    await settle();
    await settle();
    expect(host.textContent).toContain("This code has expired.");
    expect(host.querySelector('[role="alert"]').textContent).toBe("This code has expired.");
    expect(host.textContent).toContain("$616");
    // Back in the box to fix, and asked for ONCE - the server's quote without
    // the code is the quote for no code.
    expect(host.querySelector('input[aria-label="Coupon code"]').value).toBe("OLDCODE");
    expect(bodies.filter((b) => b.quote).slice(asked).map((b) => b.coupon ?? null)).toEqual(["OLDCODE"]);

    click(button(host, "Request these dates"));
    await settle();
    fill(host);
    click(button(host, "Send request"));
    await flush();
    expect(bodies.find((b) => !b.quote).coupon).toBe("");
    act(() => root.unmount());
    host.remove();
  });

  it("Remove takes the code off and prices without it", async () => {
    const { host, root, bodies, settle } = await open((b) => ({
      ok: true, quote: true, lines: b.coupon ? [...LINES, COUPON] : LINES,
      subtotalCents: b.coupon ? 57240 : 61600, taxCents: 0, totalCents: b.coupon ? 57240 : 61600,
    }));
    click(button(host, "Have a coupon code?"));
    setText(host.querySelector('input[aria-label="Coupon code"]'), "SUMMER10");
    click(button(host, "Apply"));
    await settle();
    expect(host.textContent).toContain("$572.40");
    click(button(host, "Remove"));
    await settle();
    expect(bodies.filter((b) => b.quote).at(-1)).not.toHaveProperty("coupon");
    expect(host.textContent).not.toContain("$572.40");
    expect(host.textContent).toContain("$616");
    expect(button(host, "Have a coupon code?")).toBeTruthy();
    act(() => root.unmount());
    host.remove();
  });
});
