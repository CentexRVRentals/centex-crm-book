// @vitest-environment jsdom
//
// b0.13 — THE GUEST PICKS ADD-ONS AND SEES A TOTAL.
//
// The server prices everything (CRM v6.03, _shared/quote.ts) and the CRM's
// suite drives the arithmetic. What is tested here is what only this side can
// get wrong:
//
//   * sending add-ons in a shape the server refuses ("" instead of [])
//   * a total that is the browser's sum instead of the server's number
//   * a slow answer for the OLD choices landing on top of the new ones
//   * a refusal paraphrased, or a non-answer shown as a price
//   * a picker that offers what the server would refuse (a required add-on
//     untickable, more than Max Quantity, an add-on with no price)
//   * any wording about fees (CRM decision 4: none, and no commentary)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import {
  addonsPayload, readQuote, quoteBooking, cents, lineDetail, lineAmount, totalAmount, deliveryDestination,
  QUOTE_UNAVAILABLE, QUOTE_DEBOUNCE_MS, ADDRESS_DEBOUNCE_MS,
} from "./lib/quote.js";
import { buildPayload, requestBooking } from "./lib/request.js";
import { FUNCTIONS } from "./lib/contract.js";
import AddonPicker from "./components/AddonPicker.jsx";
import { QuoteBox, QuoteLines } from "./components/Quote.jsx";
import Requested from "./pages/Requested.jsx";
import RequestForm from "./components/RequestForm.jsx";
import { addDays, todayCentral } from "./lib/dates.js";

// ----------------------------------------------------------------------------
// Fixtures - shaped exactly like publicQuote() in the CRM.
// ----------------------------------------------------------------------------
const LINES = [
  { kind: "rental", label: "Rental", addonId: null, quantity: 1, nights: 4, unitPriceCents: 10900, amountCents: 43600 },
  { kind: "tax", label: "Tax on rental", addonId: null, quantity: 1, nights: null, unitPriceCents: null, amountCents: 3597 },
  { kind: "prep", label: "Prep fee", addonId: null, quantity: 1, nights: null, unitPriceCents: 7500, amountCents: 7500 },
  { kind: "addon", label: "Generator", addonId: "gen", quantity: 1, nights: 4, unitPriceCents: 3500, amountCents: 14000 },
  { kind: "addon", label: "Linens", addonId: "lin", quantity: 2, nights: null, unitPriceCents: 2500, amountCents: 5000 },
];
// DELIBERATELY NOT THE SUM OF THE LINES (which is 73,697). If the page ever
// adds the lines up itself, the tests that look for $741.23 fail.
const SERVER_TOTAL = 74123;
// b0.14 - the three figures, from the SERVER, and deliberately not the
// browser's sums either: the non-tax lines add to 70,100, and the page must
// show 70,526 because that is what it was sent.
const SERVER_TAX = 3597;
const SERVER_SUBTOTAL = SERVER_TOTAL - SERVER_TAX;
const QUOTE_BODY = { ok: true, quote: true, lines: LINES, subtotalCents: SERVER_SUBTOTAL, taxCents: SERVER_TAX, totalCents: SERVER_TOTAL, estimate: false };

const ADDONS = [
  { addonId: "prep", name: "Prep kit", price: 40, daily: false, required: true, maxQuantity: 1 },
  { addonId: "gen", name: "Generator", price: 35, daily: true, required: false, maxQuantity: 1 },
  { addonId: "lin", name: "Linens", price: 25, daily: false, required: false, maxQuantity: 3 },
  { addonId: "gas", name: "Gas cans", price: 10, daily: false, required: false, maxQuantity: 50 },
  { addonId: "ask", name: "Kayak", price: null, daily: false, required: false, maxQuantity: 1 },
];

const reply = (body, status = 200) => ({ status, json: async () => body });
// A consistent quote with a different total (subtotal + tax = total holds).
const withTotal = (total, over = {}) => ({ ...QUOTE_BODY, subtotalCents: total - SERVER_TAX, totalCents: total, ...over });
const sentBody = (spy, n = 0) => JSON.parse(spy.mock.calls[n][1].body);

async function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  await act(async () => { await Promise.resolve(); });
  return { host, root, rerender: (next) => act(() => root.render(next)), cleanup: () => { act(() => root.unmount()); host.remove(); } };
}
// Run the debounce and let the fetch promise settle.
async function tick(ms = QUOTE_DEBOUNCE_MS) {
  await act(async () => { vi.advanceTimersByTime(ms); });
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ----------------------------------------------------------------------------
describe("what is sent", () => {
  it("CRITICAL: add-ons are ALWAYS an array - [] for none, never the blank-filled \"\"", () => {
    // buildPayload blank-fills every text field the contract names. The server
    // refuses `addons: ""` as malformed, so a guest who picked nothing would
    // have been refused outright. The one field that must never be blank-filled.
    const base = {
      unitId: "u1", dates: { start: "2026-11-01", end: "2026-11-05" },
      guest: { name: "Jane", email: "j@example.com", phone: "", guests: "", notes: "", company: "" },
      delivery: { wanted: false, address: "", city: "", state: "", zip: "" },
    };
    expect(buildPayload(base).addons).toEqual([]);
    expect(buildPayload({ ...base, addons: undefined }).addons).toEqual([]);
    expect(buildPayload({ ...base, addons: "" }).addons).toEqual([]);
    expect(buildPayload({ ...base, addons: [{ id: "gen", qty: 1 }] }).addons).toEqual([{ id: "gen", qty: 1 }]);
    expect(FUNCTIONS["request-booking"].sends).toContain("addons");
  });

  it("CRITICAL: addonsPayload sends the guest's choices as [{ id, qty }] and drops the rest", () => {
    expect(addonsPayload({}, ADDONS)).toEqual([]);
    expect(addonsPayload(null, ADDONS)).toEqual([]);
    expect(addonsPayload({ gen: 1, lin: 2, gas: 0, ask: "", x: 1.5, y: -1 }, ADDONS))
      .toEqual([{ id: "gen", qty: 1 }, { id: "lin", qty: 2 }]);
  });

  it("CRITICAL: required add-ons are NOT sent - the server puts each one on itself, hidden ones too", () => {
    expect(addonsPayload({ prep: 1, gen: 1 }, ADDONS)).toEqual([{ id: "gen", qty: 1 }]);
  });

  it("CRITICAL: a quote asks with quote:true and the stay only - no name, contact or honeypot", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    await quoteBooking({ unitId: "u1", start: "2026-11-01", end: "2026-11-05", method: "delivery", addons: [{ id: "gen", qty: 1 }] });
    expect(spy.mock.calls[0][0]).toBe(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-booking`);
    const body = sentBody(spy);
    // Every key is one the contract names; with no complete address there is
    // no address at all (b0.14 - the server then quotes "from $minimum").
    for (const k of Object.keys(body)) expect(FUNCTIONS["request-booking"].quote.sends).toContain(k);
    for (const k of ["address", "city", "state", "zip"]) expect(body).not.toHaveProperty(k);
    expect(body.quote).toBe(true);
    expect(body.method).toBe("delivery");
    expect(body.addons).toEqual([{ id: "gen", qty: 1 }]);
    expect(spy.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("anything but delivery is asked as pickup", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    await quoteBooking({ unitId: "u1", start: "a", end: "b", method: "teleport", addons: [] });
    expect(sentBody(spy).method).toBe("pickup");
  });
});

// ----------------------------------------------------------------------------
describe("what comes back", () => {
  it("CRITICAL: a quote is read field by field, and the total is the SERVER's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(QUOTE_BODY)));
    const r = await quoteBooking({ unitId: "u1", start: "a", end: "b", method: "pickup", addons: [] });
    expect(r.ok).toBe(true);
    expect(r.quote.totalCents).toBe(SERVER_TOTAL);
    expect(r.quote.lines).toHaveLength(LINES.length);
  });

  it("CRITICAL: an answer without quote:true is NOT a quote (older deploy, or the honeypot's empty success)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, quote: true })));
    expect((await quoteBooking({ unitId: "u1", addons: [] })).unavailable).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, dryRun: true, lines: LINES, totalCents: 1 })));
    expect((await quoteBooking({ unitId: "u1", addons: [] })).unavailable).toBe(true);
  });

  it("CRITICAL: a refusal comes through WORD FOR WORD", async () => {
    const sent = ["You can add up to 3 of Linens to one booking."];
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: false, quote: true, errors: sent }, 400)));
    const r = await quoteBooking({ unitId: "u1", addons: [] });
    expect(r).toEqual({ ok: false, errors: sent });
  });

  it("a refusal that does not say it was a quote refusal is not shown as one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: false, errors: ["x"] }, 400)));
    expect((await quoteBooking({ unitId: "u1", addons: [] })).unavailable).toBe(true);
  });

  it("CRITICAL: a network failure is 'unavailable', never a refusal and never a throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await quoteBooking({ unitId: "u1", addons: [] })).toEqual({ ok: false, unavailable: true });
  });

  it("an aborted call resolves { aborted } so the page can ignore it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }));
    expect(await quoteBooking({ unitId: "u1", addons: [] })).toEqual({ aborted: true });
  });

  it("readQuote refuses a malformed quote rather than showing part of one", () => {
    expect(readQuote(QUOTE_BODY)).toBeTruthy();
    expect(readQuote({ ...QUOTE_BODY, totalCents: 741.23 })).toBeNull();
    expect(readQuote({ ...QUOTE_BODY, lines: [] })).toBeNull();
    expect(readQuote({ ...QUOTE_BODY, lines: [{ ...LINES[0], kind: "service" }] })).toBeNull();
    expect(readQuote({ ...QUOTE_BODY, lines: [{ ...LINES[0], amountCents: "436" }] })).toBeNull();
    expect(readQuote({ ...QUOTE_BODY, ok: false })).toBeNull();
  });

  it("CRITICAL: a real request hands on the quote the server SAVED; a duplicate has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, reservationNum: "WEB-1", lines: LINES, subtotalCents: SERVER_SUBTOTAL, taxCents: SERVER_TAX, totalCents: SERVER_TOTAL, estimate: false })));
    const r = await requestBooking({});
    expect(r.quote.totalCents).toBe(SERVER_TOTAL);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, reservationNum: "WEB-1", duplicate: true })));
    const d = await requestBooking({});
    expect(d.ok).toBe(true);
    expect(d.quote).toBeNull();
  });
});

// ----------------------------------------------------------------------------
describe("the words", () => {
  it("money is written the way a price tag writes it", () => {
    expect(cents(10900)).toBe("$109");
    expect(cents(74123)).toBe("$741.23");
    expect(cents(123456700)).toBe("$1,234,567");
    expect(cents(5)).toBe("$0.05");
    expect(cents(null)).toBe("");
  });

  it("each line says what it is from the server's own numbers", () => {
    expect(lineDetail(LINES[0])).toBe("$109 × 4 nights");
    expect(lineDetail(LINES[3])).toBe("$35 × 4 days");
    expect(lineDetail(LINES[4])).toBe("2 × $25");
    expect(lineDetail({ ...LINES[4], nights: 3 })).toBe("2 × $25 × 3 days");
    expect(lineDetail({ ...LINES[3], nights: null, quantity: 1 })).toBe("");
    expect(lineDetail(LINES[1])).toBe("");
    expect(lineDetail({ ...LINES[0], nights: 1 })).toBe("$109 × 1 night");
  });

  it("CRITICAL: delivery is 'from $minimum', confirmed by the office (CRM decision 5)", () => {
    const d = { kind: "delivery", label: "Delivery (from - the office confirms the distance)", addonId: null, quantity: 1, nights: null, unitPriceCents: 7500, amountCents: 7500 };
    expect(lineAmount(d)).toBe("from $75");
    expect(lineDetail(d)).toBe("We'll confirm the delivery price.");
    // No minimum set: a promise to confirm, never "$0".
    expect(lineAmount({ ...d, amountCents: 0 })).toBe("to confirm");
    expect(totalAmount({ totalCents: 50000, estimate: true })).toBe("from $500");
    expect(totalAmount({ totalCents: 50000, estimate: false })).toBe("$500");
  });
});

// ----------------------------------------------------------------------------
describe("the picker", () => {
  const picker = (value = {}, onChange = () => {}, items = ADDONS) => <AddonPicker items={items} value={value} onChange={onChange} />;

  it("CRITICAL: an empty catalogue still says so (anti-vacuity for the panel)", async () => {
    const m = await mount(picker({}, () => {}, []));
    expect(m.host.textContent).toContain("Nothing to add on this one just yet");
    m.cleanup();
  });

  it("CRITICAL: a required add-on is 'included' and has NO control", async () => {
    const m = await mount(picker());
    const row = [...m.host.querySelectorAll(".addon")].find((r) => r.textContent.includes("Prep kit"));
    expect(row.textContent).toContain("included");
    expect(row.querySelector("input, select")).toBeNull();
    m.cleanup();
  });

  it("CRITICAL: Max Quantity 1 is a checkbox; more is a None..N choice, capped at 20", async () => {
    const m = await mount(picker());
    expect(m.host.querySelector('input[aria-label="Add Generator"]')).toBeTruthy();
    const lin = m.host.querySelector('select[aria-label="How many Linens"]');
    expect([...lin.options].map((o) => o.textContent)).toEqual(["None", "1", "2", "3"]);
    const gas = m.host.querySelector('select[aria-label="How many Gas cans"]');
    expect(gas.options).toHaveLength(21);
    m.cleanup();
  });

  it("CRITICAL: an add-on with no price cannot be chosen - the server would refuse the whole request", async () => {
    const m = await mount(picker());
    const row = [...m.host.querySelectorAll(".addon")].find((r) => r.textContent.includes("Kayak"));
    expect(row.querySelector("input, select")).toBeNull();
    expect(row.textContent).toContain("Ask us about this one");
    m.cleanup();
  });

  it("says per day or once per booking from `daily`, and the per-booking limit", async () => {
    const m = await mount(picker());
    expect(m.host.textContent).toContain("$35 per day");
    expect(m.host.textContent).toContain("$25 once per booking · up to 3 per booking");
    m.cleanup();
  });

  it("CRITICAL: ticking and choosing report { id: qty }; unticking and None remove it", async () => {
    const seen = [];
    const m = await mount(picker({}, (v) => seen.push(v)));
    act(() => { m.host.querySelector('input[aria-label="Add Generator"]').click(); });
    expect(seen.at(-1)).toEqual({ gen: 1 });
    m.rerender(picker({ gen: 1 }, (v) => seen.push(v)));
    const lin = m.host.querySelector('select[aria-label="How many Linens"]');
    act(() => { lin.value = "2"; lin.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(seen.at(-1)).toEqual({ gen: 1, lin: 2 });
    m.rerender(picker({ gen: 1, lin: 2 }, (v) => seen.push(v)));
    act(() => { m.host.querySelector('input[aria-label="Add Generator"]').click(); });
    expect(seen.at(-1)).toEqual({ lin: 2 });
    m.cleanup();
  });
});

// ----------------------------------------------------------------------------
describe("the quote box", () => {
  const DATES = { start: "2026-11-01", end: "2026-11-05" };
  const box = (over = {}) => <QuoteBox unitId="u1" dates={DATES} method="pickup" addons={[]} ready {...over} />;
  beforeEach(() => { vi.useFakeTimers(); });

  it("CRITICAL: nothing is asked, and nothing shown, until the dates are good", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    const m = await mount(box({ ready: false }));
    await tick(5000);
    expect(spy).not.toHaveBeenCalled();
    expect(m.host.textContent).toBe("");
    m.cleanup();
  });

  it("CRITICAL: shows the server's lines and the SERVER's total - not a sum done here", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(QUOTE_BODY)));
    const m = await mount(box());
    expect(m.host.textContent).toContain("Working out your total");
    await tick();
    const t = m.host.textContent;
    expect(t).toContain("$109 × 4 nights");
    // b0.14 - ONE Tax figure under a Subtotal; the per-rate tax lines are not
    // listed (Jesse, 09-24). All three are the server's numbers.
    expect(t).not.toContain("Tax on rental");
    expect(t).toContain("Generator");
    expect(m.host.querySelector(".q-subtotal").textContent).toBe("Subtotal$705.26");
    expect(m.host.querySelector(".q-taxsum").textContent).toBe("Tax$35.97");
    expect(m.host.querySelector(".q-total").textContent).toBe("Total$741.23");
    expect(t).not.toContain("$736.97"); // the browser's sum of the lines
    expect(t).not.toContain("$701"); // the browser's sum of the non-tax lines
    m.cleanup();
  });

  it("CRITICAL: rapid changes are ONE call - the debounce", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    const m = await mount(box({ addons: [] }));
    for (let q = 1; q <= 4; q++) {
      await act(async () => { vi.advanceTimersByTime(100); });
      m.rerender(box({ addons: [{ id: "lin", qty: q }] }));
    }
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sentBody(spy).addons).toEqual([{ id: "lin", qty: 4 }]);
    m.cleanup();
  });

  it("CRITICAL: a slow answer for the OLD choices never lands on the new ones", async () => {
    // The first call hangs until released; the second answers at once. The
    // first must be aborted, and even if it resolves it must not render.
    let releaseFirst;
    const first = new Promise((r) => { releaseFirst = r; });
    const spy = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => reply(withTotal(99900)));
    vi.stubGlobal("fetch", spy);
    const m = await mount(box({ addons: [] }));
    await tick();
    m.rerender(box({ addons: [{ id: "gen", qty: 1 }] }));
    await tick();
    expect(m.host.textContent).toContain("$999");
    await act(async () => { releaseFirst(reply(withTotal(11100))); for (let i = 0; i < 6; i++) await Promise.resolve(); });
    expect(m.host.textContent).toContain("$999");
    expect(m.host.textContent).not.toContain("$111");
    expect(spy.mock.calls[0][1].signal.aborted).toBe(true);
    m.cleanup();
  });

  it("CRITICAL: after a change, the old total is shown as STALE until the new one lands", async () => {
    // The answer is stored with the request it answered; a change makes it an
    // answer to a question nobody is asking any more. It may stay on screen,
    // dimmed and marked "Updating", but never as the current total.
    const spy = vi.fn()
      .mockImplementationOnce(async () => reply(QUOTE_BODY))
      .mockImplementationOnce(async () => reply(withTotal(99900)));
    vi.stubGlobal("fetch", spy);
    const m = await mount(box({ addons: [] }));
    await tick();
    expect(m.host.querySelector(".quote").getAttribute("aria-busy")).toBe("false");
    m.rerender(box({ addons: [{ id: "lin", qty: 2 }] }));
    expect(m.host.querySelector(".quote").getAttribute("aria-busy")).toBe("true");
    expect(m.host.querySelector(".quote-stale")).toBeTruthy();
    expect(m.host.textContent).toContain("Updating");
    await tick();
    expect(m.host.querySelector(".quote-stale")).toBeNull();
    expect(m.host.textContent).toContain("$999");
    m.cleanup();
  });

  it("CRITICAL: a refusal is shown WORD FOR WORD, as an alert", async () => {
    const sent = ["You can add up to 3 of Linens to one booking."];
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: false, quote: true, errors: sent }, 400)));
    const m = await mount(box());
    await tick();
    expect(m.host.querySelector('[role="alert"]').textContent).toBe(sent[0]);
    m.cleanup();
  });

  it("CRITICAL: no answer says so, and does not stop the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const m = await mount(box());
    await tick();
    expect(m.host.textContent).toContain(QUOTE_UNAVAILABLE);
    expect(QUOTE_UNAVAILABLE).toMatch(/still send the request/);
    m.cleanup();
  });

  it("CRITICAL: delivery reads 'from $X - we'll confirm the delivery price', and so does the total", async () => {
    const delivery = { kind: "delivery", label: "Delivery (from - the office confirms the distance)", addonId: null, quantity: 1, nights: null, unitPriceCents: 7500, amountCents: 7500 };
    const spy = vi.fn(async () => reply(withTotal(81623, { lines: [...LINES, delivery], estimate: true })));
    vi.stubGlobal("fetch", spy);
    const m = await mount(box({ method: "delivery" }));
    await tick();
    const t = m.host.textContent;
    expect(sentBody(spy).method).toBe("delivery");
    expect(t).toContain("from $75");
    expect(t).toContain("We'll confirm the delivery price.");
    expect(t).toContain("from $816.23");
    // The server's own label is office wording; the page says it for the guest.
    expect(t).not.toContain("office confirms the distance");
    m.cleanup();
  });

  it("CRITICAL: no word about fees the server did not name (CRM decision 4)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(QUOTE_BODY)));
    const m = await mount(box());
    await tick();
    expect(m.host.textContent).not.toMatch(/service fee|booking fee|no fees|fee-free|without fees|commission/i);
    m.cleanup();
  });
});

// ----------------------------------------------------------------------------
describe("the request form prices what it sends", () => {
  const soon = (n) => addDays(todayCentral(), n);
  const LISTING = { unitId: "u1", name: "Charlie", pricePerNight: 109, minimumNights: 2, deliveryDollarMile: 3, deliveryMilesMax: 100 };
  const form = (addons) => (
    <MemoryRouter>
      <RequestForm listing={LISTING} busy={[]} dates={{ start: soon(30), end: soon(34) }} addons={addons} onCancel={() => {}} />
    </MemoryRouter>
  );
  beforeEach(() => { vi.useFakeTimers(); });

  it("CRITICAL: the form's total is for pickup until delivery is ticked, then for delivery", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    const m = await mount(form([{ id: "gen", qty: 1 }]));
    await tick();
    expect(sentBody(spy, 0)).toMatchObject({ quote: true, method: "pickup", addons: [{ id: "gen", qty: 1 }] });
    expect(m.host.textContent).toContain("$741.23");
    act(() => { m.host.querySelector('input[type="checkbox"]').click(); });
    // b0.14 - with delivery ticked the box waits longer (an address may be
    // being typed, and every complete one is a distance lookup).
    await tick(QUOTE_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    await tick(ADDRESS_DEBOUNCE_MS - QUOTE_DEBOUNCE_MS);
    expect(sentBody(spy, 1).method).toBe("delivery");
    m.cleanup();
  });

  it("CRITICAL: Send request carries the same add-ons the total was priced with", async () => {
    const bodies = [];
    vi.stubGlobal("fetch", vi.fn(async (_u, opts) => {
      const b = JSON.parse(opts.body);
      bodies.push(b);
      return b.quote ? reply(QUOTE_BODY) : reply({ ok: true, reservationNum: "WEB-9", lines: LINES, subtotalCents: SERVER_SUBTOTAL, taxCents: SERVER_TAX, totalCents: SERVER_TOTAL });
    }));
    const m = await mount(form([{ id: "lin", qty: 2 }]));
    await tick();
    const setVal = (label, v) => {
      const input = [...m.host.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      act(() => { setter.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    setVal("Your name", "Jane Doe");
    setVal("Email", "jane@example.com");
    const send = [...m.host.querySelectorAll("button")].find((b) => b.textContent === "Send request");
    act(() => { send.click(); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    const request = bodies.find((b) => !b.quote);
    expect(request, "the request was not sent").toBeTruthy();
    expect(request.addons).toEqual([{ id: "lin", qty: 2 }]);
    expect(bodies.find((b) => b.quote).addons).toEqual(request.addons);
    m.cleanup();
  });
});

// ----------------------------------------------------------------------------
describe("the confirmation shows what was quoted", () => {
  const page = (state) => (
    <MemoryRouter initialEntries={[{ pathname: "/requested/WEB-1", state }]}>
      <Routes><Route path="/requested/:reservationNum" element={<Requested />} /></Routes>
    </MemoryRouter>
  );

  it("CRITICAL: with a quote it shows it - and says the office confirms the price", async () => {
    const m = await mount(page({ camper: "Charlie", quote: readQuote(QUOTE_BODY) }));
    expect(m.host.textContent).toContain("What we quoted");
    expect(m.host.textContent).toContain("$741.23");
    const panel = [...m.host.querySelectorAll(".panel")].find((p) => p.textContent.includes("What we quoted"));
    expect(panel.textContent).toMatch(/confirm the price/);
    // Not a price the guest has been promised, and not a charge.
    expect(panel.textContent).not.toMatch(/\bbooked\b|is confirmed|your price is|charged to/i);
    m.cleanup();
  });

  it("without one (a refresh, a duplicate) it reads correctly and shows no total", async () => {
    const m = await mount(page(undefined));
    expect(m.host.textContent).toContain("WEB-1");
    expect(m.host.textContent).not.toContain("What we quoted");
    m.cleanup();
  });

  it("QuoteLines renders the server's total even when it disagrees with the lines", async () => {
    const m = await mount(<QuoteLines quote={readQuote(QUOTE_BODY)} />);
    expect(m.host.querySelector(".q-total").textContent).toBe("Total$741.23");
    m.cleanup();
  });
});

// ----------------------------------------------------------------------------
describe("the source says nothing about fees either", () => {
  it("CRITICAL: no guest-facing file mentions a service or booking fee (CRM decision 4)", () => {
    // Rendered-text checks only see the states a test happens to render. This
    // reads every non-test source file, comments stripped, for the words.
    const SRC = path.join(process.cwd(), "src");
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx|css|html)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
      }
    };
    walk(SRC);
    files.push(path.join(process.cwd(), "index.html"));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => {
      const code = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n")
        .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
      return /service fee|booking fee|no fees|fee-free|without fees|commission-free/i.test(code);
    });
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});

// ============================================================================
// b0.14 (CRM v6.05) - Subtotal / Tax / Total, and delivery by the mile.
// ============================================================================
describe("b0.14 - what is read", () => {
  it("CRITICAL: a quote without the three figures, or whose figures do not add up, is not a quote", () => {
    const { subtotalCents, taxCents, ...old } = QUOTE_BODY;
    expect(subtotalCents + taxCents).toBe(SERVER_TOTAL);
    expect(readQuote(old)).toBeNull(); // a pre-v6.05 server
    expect(readQuote({ ...QUOTE_BODY, taxCents: 1 })).toBeNull();
    expect(readQuote({ ...QUOTE_BODY, subtotalCents: 70526.5 })).toBeNull();
    // Halves that DO add up are still not cents.
    expect(readQuote({ ...QUOTE_BODY, subtotalCents: SERVER_SUBTOTAL + 0.5, taxCents: SERVER_TAX - 0.5 })).toBeNull();
    expect(readQuote(QUOTE_BODY)).toMatchObject({ subtotalCents: SERVER_SUBTOTAL, taxCents: SERVER_TAX, totalCents: SERVER_TOTAL });
  });

  it("miles are kept on a delivery line only, and only as a whole number", () => {
    const d = { kind: "delivery", label: "Delivery (41 miles)", addonId: null, quantity: 1, nights: null, unitPriceCents: 29150, amountCents: 29150, miles: 41 };
    const q = readQuote(withTotal(SERVER_TOTAL, { lines: [...LINES, d, { ...LINES[0], miles: 9 }] }));
    expect(q.lines.find((l) => l.kind === "delivery").miles).toBe(41);
    expect(q.lines.filter((l) => l.kind !== "delivery").every((l) => l.miles === null)).toBe(true);
    expect(readQuote(withTotal(SERVER_TOTAL, { lines: [{ ...d, miles: 4.5 }] })).lines[0].miles).toBeNull();
  });
});

describe("b0.14 - the address, sent only when it is whole", () => {
  const FULL = { address: "285 Cold Spring", city: "Buda", state: "TX", zip: "78610" };

  it("CRITICAL: all four parts or nothing", () => {
    expect(deliveryDestination(FULL)).toEqual(FULL);
    expect(deliveryDestination({ ...FULL, city: "  Buda " })).toEqual(FULL);
    for (const k of Object.keys(FULL)) expect(deliveryDestination({ ...FULL, [k]: "" }), k).toBeNull();
    expect(deliveryDestination({ ...FULL, address: "285" })).toBeNull();
    expect(deliveryDestination(null)).toBeNull();
  });

  it("CRITICAL: a delivery quote carries it; a pick-up quote never does", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    await quoteBooking({ unitId: "u1", start: "a", end: "b", method: "delivery", addons: [], destination: FULL });
    expect(sentBody(spy, 0)).toMatchObject(FULL);
    await quoteBooking({ unitId: "u1", start: "a", end: "b", method: "pickup", addons: [], destination: FULL });
    await quoteBooking({ unitId: "u1", start: "a", end: "b", method: "delivery", addons: [], destination: { ...FULL, zip: "" } });
    for (const n of [1, 2]) for (const k of Object.keys(FULL)) expect(sentBody(spy, n)).not.toHaveProperty(k);
  });
});

describe("b0.14 - the box", () => {
  const DATES = { start: "2026-11-01", end: "2026-11-05" };
  const FULL = { address: "285 Cold Spring", city: "Buda", state: "TX", zip: "78610" };
  const box = (over = {}) => <QuoteBox unitId="u1" dates={DATES} method="delivery" addons={[]} ready destination={{ ...FULL, zip: "" }} {...over} />;
  beforeEach(() => { vi.useFakeTimers(); });

  it("CRITICAL: typing an incomplete address does not re-ask; completing it does", async () => {
    const spy = vi.fn(async () => reply(QUOTE_BODY));
    vi.stubGlobal("fetch", spy);
    const m = await mount(box());
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    m.rerender(box({ destination: { ...FULL, zip: "", address: "285 Cold Spring Rd" } }));
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    m.rerender(box({ destination: FULL }));
    await tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sentBody(spy, 1)).toMatchObject(FULL);
    m.cleanup();
  });

  it("CRITICAL: delivery priced by the mile reads exact - miles, the amount, and no 'from' on the total", async () => {
    const d = { kind: "delivery", label: "Delivery (41 miles)", addonId: null, quantity: 1, nights: null, unitPriceCents: 29150, amountCents: 29150, miles: 41 };
    vi.stubGlobal("fetch", vi.fn(async () => reply(withTotal(103273, { lines: [...LINES, d], estimate: false }))));
    const m = await mount(box({ destination: FULL }));
    await tick();
    const row = m.host.querySelector(".q-delivery");
    expect(row.textContent).toBe("Delivery41 miles, one-way$291.50");
    expect(m.host.querySelector(".q-total").textContent).toBe("Total$1,032.73");
    expect(m.host.textContent).not.toMatch(/from \$|confirm the delivery price/);
    m.cleanup();
  });

  it("CRITICAL: too far is the server's sentence, word for word", async () => {
    const sent = ["That address is about 82 miles away which exceeds our delivery radius. Please call us and we can check to see if we have a driver available for an exception."];
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: false, quote: true, errors: sent }, 400)));
    const m = await mount(box({ destination: FULL }));
    await tick();
    expect(m.host.querySelector('[role="alert"]').textContent).toBe(sent[0]);
    m.cleanup();
  });

  it("no tax at all: no Subtotal and no '$0' Tax - just the Total", async () => {
    const lines = LINES.filter((l) => l.kind !== "tax");
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ...QUOTE_BODY, lines, subtotalCents: 70100, taxCents: 0, totalCents: 70100 })));
    const m = await mount(box({ method: "pickup" }));
    await tick();
    expect(m.host.querySelector(".q-subtotal")).toBeNull();
    expect(m.host.querySelector(".q-taxsum")).toBeNull();
    expect(m.host.querySelector(".q-total").textContent).toBe("Total$701");
    m.cleanup();
  });
});
