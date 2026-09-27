// @vitest-environment jsdom
//
// b0.18 (CRM v6.20) — AN OFFICE QUOTE, ON THIS SIDE (/quote/:token).
//
// The CRM's office-quote.test.js drives the rules: pricing, the expiry, the
// accept and its race. What only this side can get wrong:
//
//   * sending anything but action and token - an amount above all
//   * sending a credential to an endpoint whose credential is the token
//   * paraphrasing the server's sentence (an expired quote above all)
//   * offering Accept again once it is booked
//   * sending the browser anywhere but this site's own /pay/<token>
//   * saying the dates are held - they are not (Jesse, 09-26)
//   * leaving noindex behind on the next page

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ACCEPTED_NOT_PAID, NOT_HELD_YET, PAY_BY_TEXT, acceptOfficeQuote, loadOfficeQuote, officeQuoteView, payPathFrom } from "./lib/officeQuote.js";
import { FUNCTIONS } from "./lib/contract.js";
import OfficeQuote from "./pages/OfficeQuote.jsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// What quote-page `show` answers (CRM runQuotePage), for a pickup quote.
const PAGE = {
  ok: true, accepted: false, reservationNum: "QTE-260926-ABCD", unitName: "Pegasus", start: "2026-10-09", end: "2026-10-12",
  method: "pickup",
  quote: {
    items: [
      { kind: "rental", label: "Rental", addonId: null, quantity: 1, nights: 3, unitPriceCents: 15000, amountCents: 45000 },
      { kind: "prep", label: "Prep fee", addonId: null, quantity: 1, nights: null, unitPriceCents: 5000, amountCents: 5000 },
    ],
    subtotalCents: 50000, taxCents: 3713,
  },
  totalCents: 53713,
};
const PAY_TOKEN = "eyJiIjoiYiJ9.c2ln";

function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the calls", () => {
  it("CRITICAL: show sends the action and the token, nothing else, and no credential", async () => {
    fetchMock.mockResolvedValue(answer(200, PAGE));
    const r = await loadOfficeQuote("abc.def");
    expect(r).toEqual({ ok: true, page: PAGE });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/functions/v1/quote-page");
    expect(JSON.parse(init.body)).toEqual({ action: "show", token: "abc.def" });
    expect(Object.keys(init.headers)).toEqual(["Content-Type"]);
    expect(Object.keys(JSON.parse(init.body))).toEqual(FUNCTIONS["quote-page"].sends);
  });

  it("CRITICAL: the server's sentence is shown as sent - an expired quote says so", async () => {
    fetchMock.mockResolvedValue(answer(410, { ok: false, error: "This quote has expired - the dates are no longer available.", expired: true }));
    expect(await loadOfficeQuote("abc.def")).toEqual({ ok: false, error: "This quote has expired - the dates are no longer available.", status: 410, expired: true });
  });

  it("a bad-token 401 with our sentence is the guest's; a bare gateway 401 is a deployment mistake", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { ok: false, error: "This quote link isn't valid." }));
    expect((await loadOfficeQuote("x")).error).toBe("This quote link isn't valid.");
    fetchMock.mockResolvedValueOnce(answer(401, { message: "Invalid JWT" }));
    const r = await loadOfficeQuote("x");
    expect(r.misconfigured).toBe(true);
    expect(r.error).toMatch(/Something went wrong on our end/);
  });

  it("offline, or an answer that is not ours, reads as such", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect((await loadOfficeQuote("x")).unreached).toBe(true);
    fetchMock.mockResolvedValueOnce(answer(200, { hello: 1 }));
    expect((await loadOfficeQuote("x")).unreadable).toBe(true);
  });

  it("CRITICAL: accept sends the action and the token - no amount - and answers this site's pay path", async () => {
    fetchMock.mockResolvedValue(answer(200, { ...PAGE, accepted: true, payToken: PAY_TOKEN, payProblem: "" }));
    const r = await acceptOfficeQuote("abc.def");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "accept", token: "abc.def" });
    expect(r).toEqual({ ok: true, reservationNum: "QTE-260926-ABCD", payPath: `/pay/${PAY_TOKEN}`, payProblem: "" });
  });

  it("CRITICAL: the pay path is only ever this site's /pay/<token>", () => {
    expect(payPathFrom(PAY_TOKEN)).toBe(`/pay/${PAY_TOKEN}`);
    for (const bad of ["", null, "https://evil.example.com/pay", "../admin", "a.b/c", "a.b?x=1", "onlyonepart"]) {
      expect(payPathFrom(bad)).toBe("");
    }
  });

  it("an accept that did not book is not a booking", async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, accepted: false }));
    expect((await acceptOfficeQuote("abc.def")).ok).toBe(false);
  });
});

describe("the words", () => {
  it("the trip, how, the items, Subtotal / Tax / Total", () => {
    const v = officeQuoteView(PAGE);
    expect(v.trip).toBe("Pegasus · Oct 9 – Oct 12");
    expect(v.how).toBe("Picked up from our lot in Kyle");
    expect(officeQuoteView({ ...PAGE, method: "delivery" }).how).toBe("Delivered to you");
    expect(v.items.map((l) => [l.label, l.amount])).toEqual([["Rental", "$450.00"], ["Prep fee", "$50.00"]]);
    expect([v.subtotal, v.tax, v.total]).toEqual(["$500.00", "$37.13", "$537.13"]);
  });

  it("b0.21 (CRM v6.31) - an office quote with a coupon code: the coupon line, minus sign and all", () => {
    const quote = {
      items: [...PAGE.quote.items, { kind: "coupon", label: "Coupon FALL-15 ($50 off)", addonId: null, quantity: 1, nights: null, unitPriceCents: null, amountCents: -5000 }],
      subtotalCents: PAGE.quote.subtotalCents - 5000, taxCents: PAGE.quote.taxCents,
    };
    const v = officeQuoteView({ ...PAGE, quote, totalCents: PAGE.totalCents - 5000 });
    expect(v.items.map((l) => [l.label, l.detail, l.amount]).pop()).toEqual(["Coupon FALL-15 ($50 off)", "", "-$50.00"]);
    expect(v.total).toBe("$487.13");
  });

  it("CRITICAL: paid is booked; accepted alone is not (b0.18, CRM v6.20)", () => {
    expect(officeQuoteView(PAGE)).toMatchObject({ accepted: false, paid: false, payPath: "" });
    expect(officeQuoteView({ ...PAGE, accepted: true, paid: false, payToken: "a.b" })).toMatchObject({ accepted: true, paid: false, payPath: "/pay/a.b" });
    expect(officeQuoteView({ ...PAGE, accepted: true, paid: true })).toMatchObject({ paid: true });
    // "paid" without "accepted" is not a thing the server says - and not booked.
    expect(officeQuoteView({ ...PAGE, paid: true }).paid).toBe(false);
    expect(officeQuoteView({ ...PAGE, accepted: true, payToken: "../x" }).payPath).toBe("");
  });

  it("a quote whose items do not add up shows the total alone", () => {
    const v = officeQuoteView({ ...PAGE, quote: { ...PAGE.quote, subtotalCents: 1 } });
    expect(v.items).toEqual([]);
    expect(v.total).toBe("$537.13");
  });
});

// ============================================================================
let container;
let root;
async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/quote/abc.def"]}>
        <Routes>
          <Route path="/quote/:token" element={<OfficeQuote />} />
          <Route path="/pay/:token" element={<p>PAY PAGE</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
});
const button = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

describe("the page", () => {
  // b0.18 (CRM v6.20, Jesse 09-26): accepting holds nothing - the PAYMENT
  // books it. Three states: not accepted / accepted, unpaid / paid.
  it("CRITICAL: shows the quote, says the dates are NOT held until paid, and offers Accept and pay", async () => {
    fetchMock.mockResolvedValue(answer(200, PAGE));
    await mount();
    expect(container.textContent).toMatch(/Your quote/);
    expect(container.textContent).toMatch(/Pegasus · Oct 9 – Oct 12/);
    expect(container.textContent).toMatch(/QTE-260926-ABCD/);
    expect(container.textContent).toMatch(/Total\$537\.13/);
    expect(container.textContent).toContain(NOT_HELD_YET);
    expect(NOT_HELD_YET).toMatch(/until your payment goes through/);
    expect(container.textContent).not.toMatch(/we're holding|held until/i);
    expect(container.textContent).toMatch(/Once your payment goes through, the dates are yours at this price/);
    expect(button("Accept and pay")).toBeTruthy();
    expect(document.head.querySelector('meta[name="robots"][data-quote-page]').getAttribute("content")).toBe("noindex, nofollow");
  });

  it("CRITICAL: Accept and pay goes straight to the pay page", async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, PAGE))
      .mockResolvedValueOnce(answer(200, { ...PAGE, accepted: true, paid: false, payToken: PAY_TOKEN, payProblem: "" }));
    await mount();
    await act(async () => { button("Accept and pay").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.textContent).toMatch(/PAY PAGE/);
    // And the private-page tags went with it.
    expect(document.head.querySelector("meta[data-quote-page]")).toBeNull();
  });

  it("CRITICAL: accepted with online payment off: NOT booked, and we'll text how to pay", async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, PAGE))
      .mockResolvedValueOnce(answer(200, { ...PAGE, accepted: true, paid: false, payToken: "", payProblem: "Online payment isn't available right now." }));
    await mount();
    await act(async () => { button("Accept and pay").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.textContent).toMatch(/Quote accepted/);
    expect(container.textContent).toContain(PAY_BY_TEXT);
    expect(container.textContent).not.toMatch(/You're booked/);
    expect(button("Accept and pay")).toBeUndefined();
  });

  it("CRITICAL: a lost race is the server's sentence, and no booking", async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, PAGE))
      .mockResolvedValueOnce(answer(410, { ok: false, error: "This quote has expired - the dates are no longer available.", expired: true }));
    await mount();
    await act(async () => { button("Accept and pay").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector('[role="alert"]').textContent).toBe("This quote has expired - the dates are no longer available.");
    expect(container.textContent).not.toMatch(/You're booked/);
  });

  it("CRITICAL: reopened after accepting, not paid: 'not booked until you've paid', with its pay page - no second Accept", async () => {
    fetchMock.mockResolvedValue(answer(200, { ...PAGE, accepted: true, paid: false, payToken: PAY_TOKEN }));
    await mount();
    expect(container.textContent).toMatch(/Pay to book/);
    expect(container.textContent).toContain(ACCEPTED_NOT_PAID);
    expect(container.textContent).not.toMatch(/You're booked/);
    expect(button("Accept and pay")).toBeUndefined();
    expect(container.querySelector("a.btn").getAttribute("href")).toBe(`/pay/${PAY_TOKEN}`);
  });

  it("CRITICAL: reopened after paying: 'You're booked', and nothing to pay or accept", async () => {
    fetchMock.mockResolvedValue(answer(200, { ...PAGE, accepted: true, paid: true }));
    await mount();
    expect(container.textContent).toMatch(/You're booked/);
    expect(container.querySelector("a.btn")).toBeNull();
    expect(button("Accept and pay")).toBeUndefined();
  });

  it("an expired quote: its own title, the server's sentence, and nothing to retry", async () => {
    fetchMock.mockResolvedValue(answer(410, { ok: false, error: "This quote has expired - the dates are no longer available.", expired: true }));
    await mount();
    expect(container.textContent).toMatch(/This quote has expired/);
    expect(button("Try again")).toBeUndefined();
  });
});

describe("the wiring", () => {
  it("CRITICAL: the route exists, and quote-page is in the contract with a probe", () => {
    const app = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");
    expect(app).toMatch(/<Route path="\/quote\/:token" element=\{<OfficeQuote \/>\} \/>/);
    expect(FUNCTIONS["quote-page"].sends).toEqual(["action", "token"]);
    expect(FUNCTIONS["quote-page"].probe).toEqual({ body: { action: "show", token: "contract.check" }, status: 401, key: "error" });
  });
});
