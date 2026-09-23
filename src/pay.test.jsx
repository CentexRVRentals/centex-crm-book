// @vitest-environment jsdom
//
// b0.12 — THE "CHOOSE HOW TO PAY" PAGE.
//
// What only this side can get wrong, since the CRM's payment-options.test.js
// drives the rules and the money:
//
//   * sending an amount, or anything but action/token/option
//   * sending a credential to an endpoint whose credential is the token
//   * paraphrasing a server refusal into a second, different reason
//   * reading a bad-token 401 (ours, with a sentence) as a deployment mistake,
//     or a gateway 401 (no sentence) as a guest's problem
//   * wording: "$0.00", a missing date, a promise the server did not make
//   * sending the browser anywhere but Stripe Checkout
//   * leaving noindex behind on the next page

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { choosePayment, loadPayPage, longDate, payPageView, shortDate, usd } from "./lib/payments.js";
import { FUNCTIONS } from "./lib/contract.js";
import Pay from "./pages/Pay.jsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// What payment-options `show` answers (CRM pageBody), for a booking more than a
// week out with nothing paid.
const PAGE = {
  reservationNum: "WEB-260923-ABCD", unitName: "Sol", start: "2026-10-10", end: "2026-10-13",
  totalCents: 100000, paidCents: 0, owedCents: 100000, insideWindow: false, windowDays: 7,
  options: [
    { key: "deposit", label: "Reservation Deposit", amountCents: 30000, balanceCents: 70000, balanceDueDate: "2026-10-03" },
    { key: "full", label: "Pay in Full", amountCents: 100000 },
  ],
  security: { label: "Refundable Security Deposit", cents: 50000, date: "2026-10-08" },
  words: { balanceVerb: "is due", securityVerb: "is collected" },
};

function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
describe("the words", () => {
  it("money and dates read as a guest reads them, and never as $0.00", () => {
    expect(usd(123456)).toBe("$1,234.56");
    expect(usd(5)).toBe("$0.05");
    for (const bad of [null, undefined, "100", 1.5, -1, NaN]) expect(usd(bad)).toBe("");
    expect(longDate("2026-10-02")).toBe("Friday, October 2");
    expect(longDate("2026-02-30")).toBe("");
    expect(shortDate("2026-10-10")).toBe("Oct 10");
  });

  it("CRITICAL: Reservation Deposit says what is left and when; Pay in Full says nothing is", () => {
    const v = payPageView(PAGE);
    expect(v.choices.map((c) => c.key)).toEqual(["deposit", "full"]);
    expect(v.choices[0]).toEqual({
      key: "deposit", title: "Reservation Deposit", amount: "$300.00",
      detail: "Pay $300.00 now. The remaining $700.00 is due Saturday, October 3.",
    });
    expect(v.choices[1].title).toBe("Pay in Full");
    expect(v.choices[1].detail).toBe("Pay the whole $1,000.00 now, with nothing left to pay later.");
    expect(v.total).toBe("$1,000.00");
    expect(v.trip).toBe("Sol · Oct 10 – Oct 13");
    expect(v.paid).toBe("");
  });

  it("CRITICAL: the Refundable Security Deposit and its date are on the page", () => {
    expect(payPageView(PAGE).security)
      .toBe("A $500.00 Refundable Security Deposit is collected Thursday, October 8, and returned after your trip.");
    expect(payPageView({ ...PAGE, security: null }).security).toBe("");
  });

  it("inside the window, Pay in Full says why", () => {
    const v = payPageView({ ...PAGE, insideWindow: true, options: [{ key: "full", amountCents: 100000 }] });
    expect(v.choices).toHaveLength(1);
    expect(v.choices[0].detail).toBe("Your trip starts within 7 days, so the full $1,000.00 is due now.");
  });

  it("after a Reservation Deposit, the Balance", () => {
    const v = payPageView({ ...PAGE, paidCents: 30000, options: [{ key: "balance", amountCents: 70000 }] });
    expect(v.paid).toBe("$300.00");
    expect(v.choices[0].title).toBe("Balance");
    expect(v.choices[0].detail).toMatch(/Reservation Deposit is paid/);
  });

  it("CRITICAL: the verbs are the SERVER'S - the day its charger ships, the page says so without a release here", () => {
    const v = payPageView({ ...PAGE, words: { balanceVerb: "will be charged to your card on", securityVerb: "will be held on your card on" } });
    expect(v.choices[0].detail).toBe("Pay $300.00 now. The remaining $700.00 will be charged to your card on Saturday, October 3.");
    expect(v.security).toMatch(/will be held on your card on Thursday, October 8/);
  });

  it("CRITICAL: until then the page promises nothing automatic", () => {
    const v = payPageView(PAGE);
    const all = [...v.choices.map((c) => c.detail), v.security].join(" ");
    expect(all).not.toMatch(/charged to your card|automatically|held on your card/);
  });

  it("an option it does not know, or one with a broken amount, is not shown", () => {
    const v = payPageView({ ...PAGE, options: [{ key: "tip", amountCents: 100 }, { key: "full", amountCents: null }, { key: "full", amountCents: 100000 }] });
    expect(v.choices.map((c) => c.key)).toEqual(["full"]);
  });

  it("hostile data renders as gaps, not as [object Object] or $0.00", () => {
    const v = payPageView({ reservationNum: {}, unitName: 7, start: "x", totalCents: "1000", options: "no", security: { cents: 1, date: "no" } });
    expect(v).toEqual({ reservationNum: "", trip: "", total: "", paid: "", choices: [], security: "" });
  });
});

// ============================================================================
describe("the two calls", () => {
  it("CRITICAL: show posts ONLY action and token, with no credential, to payment-options", async () => {
    fetchMock.mockResolvedValue(answer(200, PAGE));
    const r = await loadPayPage("tok.sig");
    expect(r).toEqual({ ok: true, page: PAGE });
    const [url, init] = fetchMock.mock.calls[0];
    // From the environment, whatever it is - never a project URL written here
    // (the first version pinned the container's dummy .env and failed on the
    // dev box, which has the real one).
    expect(url).toBe(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-options`);
    expect(url.endsWith("/functions/v1/payment-options")).toBe(true);
    expect(Object.keys(init.headers)).toEqual(["Content-Type"]);
    expect(JSON.parse(init.body)).toEqual({ action: "show", token: "tok.sig" });
  });

  it("CRITICAL: choose sends a WORD, never an amount", async () => {
    fetchMock.mockResolvedValue(answer(200, { url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
    const r = await choosePayment("tok.sig", "deposit");
    expect(r).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "choose", token: "tok.sig", option: "deposit" });
    expect(FUNCTIONS["payment-options"].sends).toEqual(["action", "token", "option"]);
  });

  it("CRITICAL: the browser is only ever sent to Stripe Checkout", async () => {
    for (const url of ["https://evil.example/pay", "http://checkout.stripe.com/x", "javascript:alert(1)", 42, undefined]) {
      fetchMock.mockResolvedValueOnce(answer(200, { url }));
      const r = await choosePayment("t", "full");
      expect(r.ok, String(url)).toBe(false);
    }
  });

  it("CRITICAL: the server's sentence is shown as sent - a bad or expired link is not 'something went wrong'", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { error: "This payment link isn't valid. Please use the link from your text, or contact us." }));
    expect((await loadPayPage("x")).error).toBe("This payment link isn't valid. Please use the link from your text, or contact us.");
    fetchMock.mockResolvedValueOnce(answer(410, { error: "This payment link has expired. Please contact us and we'll send you a new one." }));
    expect((await loadPayPage("x")).error).toMatch(/expired/);
    fetchMock.mockResolvedValueOnce(answer(409, { error: "A payment for this booking may already be in progress." }));
    expect((await choosePayment("x", "full")).error).toBe("A payment for this booking may already be in progress.");
  });

  it("CRITICAL: a 401 with NO sentence is the gateway - a deployment mistake, named in the console", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { code: 401, message: "Missing authorization header" }));
    const r = await loadPayPage("x");
    expect(r.misconfigured).toBe(true);
    expect(r.error).toMatch(/call us/);
    expect(console.error.mock.calls.flat().join(" ")).toMatch(/--no-verify-jwt/);
  });

  it("offline, unreadable, or a page with nothing to pay are all sentences", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await loadPayPage("x")).error).toMatch(/connection/);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("html"); } });
    expect((await loadPayPage("x")).ok).toBe(false);
    fetchMock.mockResolvedValueOnce(answer(200, { ...PAGE, options: [] }));
    expect((await loadPayPage("x")).ok).toBe(false);
  });
});

// ============================================================================
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

async function mountPay(leave) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/pay/tok.sig"]}>
        <Routes><Route path="/pay/:token" element={<Pay leave={leave} />} /></Routes>
      </MemoryRouter>
    );
  });
  await flush();
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

const click = async (el) => { await act(async () => { el.click(); }); await flush(); };

describe("the page", () => {
  it("CRITICAL: shows the trip, both choices and the security deposit; Continue waits for a choice", async () => {
    fetchMock.mockResolvedValue(answer(200, PAGE));
    const { host, cleanup } = await mountPay(vi.fn());
    try {
      const text = host.textContent;
      expect(text).toContain("Choose how to pay");
      expect(text).toContain("WEB-260923-ABCD");
      expect(text).toContain("Reservation Deposit");
      expect(text).toContain("Pay in Full");
      expect(text).toContain("The remaining $700.00 is due Saturday, October 3.");
      expect(text).toContain("Refundable Security Deposit is collected Thursday, October 8");
      expect(host.querySelector("button.btn").disabled).toBe(true);
    } finally { cleanup(); }
  });

  it("CRITICAL: choosing sends the word and leaves for the URL the server returned", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, PAGE));
    fetchMock.mockResolvedValueOnce(answer(200, { url: "https://checkout.stripe.com/c/pay/cs_test_9" }));
    const leave = vi.fn();
    const { host, cleanup } = await mountPay(leave);
    try {
      await click(host.querySelector('input[value="full"]'));
      await click(host.querySelector("button.btn"));
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "choose", token: "tok.sig", option: "full" });
      expect(leave).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_9");
      // Still "sending": nothing to tap twice while the browser leaves.
      expect(host.querySelector("button.btn").disabled).toBe(true);
    } finally { cleanup(); }
  });

  it("one choice is already chosen", async () => {
    fetchMock.mockResolvedValue(answer(200, { ...PAGE, insideWindow: true, options: [{ key: "full", amountCents: 100000 }] }));
    const { host, cleanup } = await mountPay(vi.fn());
    try {
      expect(host.querySelector('input[value="full"]').checked).toBe(true);
      expect(host.querySelector("button.btn").disabled).toBe(false);
    } finally { cleanup(); }
  });

  it("CRITICAL: a refused choice shows the server's sentence and lets the guest try again", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, PAGE));
    fetchMock.mockResolvedValueOnce(answer(409, { error: "That choice isn't available for this booking any more. Please reload the page." }));
    const leave = vi.fn();
    const { host, cleanup } = await mountPay(leave);
    try {
      await click(host.querySelector('input[value="deposit"]'));
      await click(host.querySelector("button.btn"));
      expect(host.querySelector('[role="alert"]').textContent).toBe("That choice isn't available for this booking any more. Please reload the page.");
      expect(leave).not.toHaveBeenCalled();
      expect(host.querySelector("button.btn").disabled).toBe(false);
    } finally { cleanup(); }
  });

  it("a link that will not open says why, in the server's words", async () => {
    fetchMock.mockResolvedValue(answer(410, { error: "This payment link has expired. Please contact us and we'll send you a new one." }));
    const { host, cleanup } = await mountPay(vi.fn());
    try {
      expect(host.textContent).toContain("We couldn't open this payment page");
      expect(host.textContent).toContain("This payment link has expired.");
    } finally { cleanup(); }
  });

  it("CRITICAL: noindex and no-referrer while the page is open, and gone after it", async () => {
    fetchMock.mockResolvedValue(answer(200, PAGE));
    const { cleanup } = await mountPay(vi.fn());
    expect(document.head.querySelector('meta[name="robots"][data-pay-page]').getAttribute("content")).toBe("noindex, nofollow");
    expect(document.head.querySelector('meta[name="referrer"][data-pay-page]').getAttribute("content")).toBe("no-referrer");
    // The canonical URL is /pay, never the token.
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute("href")).not.toMatch(/tok\.sig/);
    cleanup();
    expect(document.head.querySelector("meta[data-pay-page]")).toBe(null);
  });
});

describe("the wiring", () => {
  it("CRITICAL: /pay/:token is a route", () => {
    const app = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");
    expect(app).toMatch(/<Route path="\/pay\/:token" element=\{<Pay \/>\} \/>/);
  });

  it("the live contract check knows how to probe it without paying for anything", () => {
    expect(FUNCTIONS["payment-options"].probe).toEqual({ body: { action: "show", token: "contract.check" }, status: 401, key: "error" });
  });
});
