// @vitest-environment jsdom
//
// b0.17 (CRM v6.12) — THE TWO PATHS, ON THIS SIDE.
//
// The CRM decides which path a camper is on (its booking-path.test.js drives
// that rule). This site only listens and words it: the quote says `path`, the
// camper page and the form say Book and pay or Send request, a booking goes to
// the pay page, and every page after says what actually happened. Walked
// through the page as it is wired, like camper-quote.test.jsx, because every
// piece passing alone says nothing about whether the PAGE passes the path on.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { addDays, todayCentral } from "./lib/dates.js";
import { QUOTE_DEBOUNCE_MS, quoteBooking } from "./lib/quote.js";
import { buildPayload, requestBooking } from "./lib/request.js";
import { holdLine, payPageView } from "./lib/payments.js";
import { FUNCTIONS } from "./lib/contract.js";

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
const { default: Paid } = await import("./pages/Paid.jsx");
const { default: Pay } = await import("./pages/Pay.jsx");

const LISTING = { unit_id: "CHARLIE", name: "Charlie", price_per_night: 109, minimum_nights: 2 };
const LINES = [{ kind: "rental", label: "Rental", addonId: null, quantity: 1, nights: 4, unitPriceCents: 10900, amountCents: 43600 }];
const QUOTE = { ok: true, quote: true, lines: LINES, subtotalCents: 43600, taxCents: 0, totalCents: 43600 };
const reply = (b, s = 200) => ({ status: s, ok: s < 400, json: async () => b });

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const button = (host, text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

function PayStub() {
  const { token } = useParams();
  return <p>PAY PAGE {token}</p>;
}

beforeEach(() => {
  TABLES = { public_listings: [LISTING], public_listing_addons: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Walks the camper page: dates, the quote, the call to action, the form,
// submit. `answers(body)` is the server.
async function journey(answers, { cta, submit }) {
  const bodies = [];
  vi.stubGlobal("fetch", vi.fn(async (_u, opts) => {
    const b = JSON.parse(opts.body);
    bodies.push(b);
    return reply(answers(b));
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
          <Route path="/pay/:token" element={<PayStub />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await flush();
  vi.useFakeTimers();
  const start = addDays(todayCentral(), 45);
  const end = addDays(start, 4);
  for (const iso of [start, end]) {
    for (let i = 0; i < 4 && !host.querySelector(`button[aria-label="${iso}"]`); i++) click(host.querySelector('button[aria-label="Next month"]'));
    click(host.querySelector(`button[aria-label="${iso}"]`));
  }
  await act(async () => { vi.advanceTimersByTime(QUOTE_DEBOUNCE_MS); });
  await flush();
  const ctaText = host.textContent;
  const opener = button(host, cta);
  expect(opener, `no "${cta}" button - the page says: ${host.textContent.slice(0, 400)}`).toBeTruthy();
  click(opener);
  await flush();
  // Before the form's own quote box has asked anything: what it opens saying.
  const openedText = host.textContent;
  await act(async () => { vi.advanceTimersByTime(QUOTE_DEBOUNCE_MS); });
  await flush();
  const formText = host.textContent;
  const setVal = (label, v) => {
    const input = [...host.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => { setter.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  setVal("Your name", "Jane Doe");
  setVal("Email", "jane@example.com");
  const send = button(host, submit);
  expect(send, `no "${submit}" button - the form says: ${host.textContent.slice(0, 400)}`).toBeTruthy();
  click(send);
  await flush();
  const out = { bodies, ctaText, openedText, formText, text: host.textContent };
  act(() => root.unmount());
  host.remove();
  return out;
}

describe("Path B - book and pay", () => {
  it("CRITICAL: the quote says book, the page says book, the form sends book, the guest lands on the pay page", async () => {
    const r = await journey(
      (b) => (b.quote ? { ...QUOTE, path: "book" } : { ok: true, path: "book", reservationNum: "WEB-1", payToken: "tok.sig", holdUntil: "2026-10-01T17:35:00.000Z", ...QUOTE, quote: undefined }),
      { cta: "Book these dates", submit: "Book and pay" },
    );
    expect(r.ctaText).toContain("You'll pay to book on the next step.");
    expect(r.ctaText).not.toContain("No payment now");
    // The form opens on the camper page's answer - no "Send request" flash
    // while its own quote box asks again.
    expect(r.openedText).toContain("Book and pay");
    expect(r.openedText).not.toContain("Send request");
    expect(r.formText).toContain("Book these dates");
    expect(r.formText).toContain("Pay to book");
    expect(r.formText).not.toContain("This isn't a booking yet");
    const request = r.bodies.find((b) => !b.quote);
    expect(request.book).toBe(true);
    expect(r.text).toContain("PAY PAGE tok.sig");
  });

  it("CRITICAL: a request said so on the day, not a booking - the page says it was switched", async () => {
    const r = await journey(
      (b) => (b.quote ? { ...QUOTE, path: "book" } : { ok: true, path: "request", switched: true, reservationNum: "WEB-2", ...QUOTE, quote: undefined }),
      { cta: "Book these dates", submit: "Book and pay" },
    );
    expect(r.text).toContain("Request sent");
    expect(r.text).toContain("it's a request rather than a booking. Nothing has been charged.");
    expect(r.text).not.toContain("PAY PAGE");
  });
});

describe("Path A - as before", () => {
  it("CRITICAL: no path (an older server) or path request: Request these dates, Send request, book false", async () => {
    for (const path of [undefined, "request", "BOOK", 1]) {
      const r = await journey(
        (b) => (b.quote ? { ...QUOTE, path } : { ok: true, reservationNum: "WEB-3", ...QUOTE, quote: undefined }),
        { cta: "Request these dates", submit: "Send request" },
      );
      expect(r.ctaText, String(path)).toContain("No payment now — we'll confirm first.");
      expect(r.formText).toContain("This isn't a booking yet");
      expect(r.bodies.find((b) => !b.quote).book).toBe(false);
      expect(r.text).toContain("Request sent");
      expect(r.text).not.toContain("rather than a booking");
    }
  });

  it("a refused quote is a request - the safe button", async () => {
    const r = await journey(
      (b) => (b.quote ? { ok: false, quote: true, errors: ["That address is unavailable."] } : { ok: true, reservationNum: "WEB-4" }),
      { cta: "Request these dates", submit: "Send request" },
    );
    expect(r.bodies.find((b) => !b.quote).book).toBe(false);
  });
});

describe("the calls", () => {
  it("CRITICAL: `book` is always a boolean, never blank-filled", () => {
    const base = { unitId: "U", dates: { start: "a", end: "b" }, guest: { name: "n" }, delivery: { wanted: false }, addons: [] };
    expect(buildPayload(base).book).toBe(false);
    expect(buildPayload({ ...base, book: true }).book).toBe(true);
    for (const junk of ["true", 1, "yes", {}]) expect(buildPayload({ ...base, book: junk }).book, String(junk)).toBe(false);
    expect(FUNCTIONS["request-booking"].sends).toContain("book");
  });

  it("CRITICAL: a 'book' answer without a pay token is a request - nowhere to send the guest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, path: "book", reservationNum: "WEB-5" })));
    const r = await requestBooking({});
    expect(r).toMatchObject({ ok: true, path: "request", payToken: "", holdUntil: "", switched: false });
  });

  it("a booked answer carries its token and hold; switched only ever on a request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, path: "book", payToken: " t.s ", holdUntil: "2026-10-01T17:35:00.000Z", switched: true, reservationNum: "WEB-6" })));
    expect(await requestBooking({})).toMatchObject({ path: "book", payToken: "t.s", holdUntil: "2026-10-01T17:35:00.000Z", switched: false });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ok: true, path: "request", switched: true, reservationNum: "WEB-7" })));
    expect(await requestBooking({})).toMatchObject({ path: "request", payToken: "", switched: true });
  });

  it("the quote's path: only the word 'book' books", async () => {
    for (const [path, want] of [["book", "book"], ["request", "request"], [undefined, "request"], ["Book", "request"], [true, "request"]]) {
      vi.stubGlobal("fetch", vi.fn(async () => reply({ ...QUOTE, path })));
      const r = await quoteBooking({ unitId: "U", start: "a", end: "b", method: "pickup", addons: [] });
      expect(r.ok).toBe(true);
      expect(r.path, String(path)).toBe(want);
    }
  });

  it("the contract lists what v6.12 sends back", () => {
    const rb = FUNCTIONS["request-booking"];
    for (const k of ["path", "payToken", "holdUntil", "switched"]) expect(rb.returns).toContain(k);
    expect(rb.quote.returns).toContain("path");
    expect(FUNCTIONS["payment-options"].returns).toContain("holdUntil");
  });
});

describe("the pay page for a hold", () => {
  it("CRITICAL: the hold as a Central time, and nothing for anything that is not a time", () => {
    // 17:35 UTC on Oct 1 is 12:35 PM Central (CDT).
    expect(holdLine("2026-10-01T17:35:00.000Z")).toBe("We're holding these dates for you until 12:35 PM (Central). Finish paying before then to book them.");
    // After the clocks change: 18:05 UTC on Nov 5 is 12:05 PM Central (CST).
    expect(holdLine("2026-11-05T18:05:00.000Z")).toContain("until 12:05 PM (Central)");
    for (const junk of [null, undefined, "", "soon", 7, {}]) expect(holdLine(junk), String(junk)).toBe("");
    expect(payPageView({ holdUntil: null }).hold).toBe("");
  });

  it("CRITICAL: rendered - 'Pay to book' and the hold line, above the choices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({
      reservationNum: "WEB-1", unitName: "Charlie", start: "2026-10-10", end: "2026-10-13",
      totalCents: 43600, paidCents: 0, owedCents: 43600, insideWindow: false, windowDays: 7,
      options: [{ key: "full", label: "Pay in Full", amountCents: 43600 }], security: null,
      words: { balanceVerb: "is due", securityVerb: "is collected" }, quote: null, holdUntil: "2026-10-01T17:35:00.000Z",
    })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<MemoryRouter initialEntries={["/pay/tok.sig"]}><Routes><Route path="/pay/:token" element={<Pay />} /></Routes></MemoryRouter>);
    });
    await flush();
    expect(host.querySelector("h1").textContent).toBe("Pay to book");
    const line = host.querySelector(".hold-line");
    expect(line.textContent).toContain("until 12:35 PM (Central)");
    expect(host.textContent.indexOf("holding these dates")).toBeLessThan(host.textContent.indexOf("Pay in Full"));
    act(() => root.unmount());
    host.remove();
  });

  it("an approved booking's page is exactly as before", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({
      reservationNum: "WEB-1", totalCents: 43600, paidCents: 0, owedCents: 43600, windowDays: 7,
      options: [{ key: "full", label: "Pay in Full", amountCents: 43600 }], quote: null, holdUntil: null,
    })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<MemoryRouter initialEntries={["/pay/tok.sig"]}><Routes><Route path="/pay/:token" element={<Pay />} /></Routes></MemoryRouter>);
    });
    await flush();
    expect(host.querySelector("h1").textContent).toBe("Choose how to pay");
    expect(host.querySelector(".hold-line")).toBe(null);
    act(() => root.unmount());
    host.remove();
  });
});

describe("where Stripe returns a Book-and-pay guest", () => {
  const render = (url) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => {
      root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/paid/:reservationNum" element={<Paid />} /></Routes></MemoryRouter>);
    });
    const out = { h1: host.querySelector("h1").textContent, text: host.textContent };
    act(() => root.unmount());
    return out;
  };

  it("CRITICAL: paid - 'You're booked'", () => {
    const r = render("/paid/WEB-1?booked=1");
    expect(r.h1).toBe("You're booked");
    expect(r.text).toContain("the camper is yours");
    expect(r.text).toContain("WEB-1");
  });

  it("CRITICAL: backed out - nothing charged AND nothing booked, not 'your link still works'", () => {
    const r = render("/paid/WEB-1?booked=1&cancelled=1");
    expect(r.h1).toBe("Nothing was charged");
    expect(r.text).toContain("nothing is booked");
    expect(r.text).not.toContain("payment link in your text still works");
  });

  it("an approved guest's return reads exactly as before", () => {
    expect(render("/paid/WEB-1").h1).toBe("Payment received");
    const c = render("/paid/WEB-1?cancelled=1");
    expect(c.h1).toBe("Nothing was charged");
    expect(c.text).toContain("payment link in your text still works");
  });
});
