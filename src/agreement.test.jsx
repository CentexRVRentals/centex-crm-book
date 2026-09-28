// @vitest-environment jsdom
//
// b0.25 (CRM v6.40) - THE RENTAL AGREEMENT ON THE PAY PAGE (lib/agreement.js,
// components/AgreementStep.jsx). The CRM's v640-agreement-sign.test.js drives
// the signing itself; what only this side can get wrong:
//
//   * b0.26: holding the payment choices back - the guest signs AFTER paying
//   * not asking on /paid and /sign, or asking before a booking is confirmed
//   * putting anything but BoldSign's signing app in the iframe
//   * believing a "signed" message from anywhere but BoldSign (or ourselves)
//   * sending more than action / token / initials / email
//   * not asking for an email the CRM does not have

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  AGREEMENT_WORDS, BOLDSIGN_ORIGIN, isSignLink, loadAgreement, openSignedCopy, signingEvent, startSigning,
} from "./lib/agreement.js";
import { FUNCTIONS, OUTSIDE } from "./lib/contract.js";
import Pay from "./pages/Pay.jsx";
import Paid from "./pages/Paid.jsx";
import Sign from "./pages/Sign.jsx";

const PAGE = {
  reservationNum: "WEB-260928-ABCD", unitName: "Pegasus", start: "2026-10-10", end: "2026-10-13",
  totalCents: 100000, paidCents: 0, owedCents: 100000, insideWindow: false, windowDays: 7,
  options: [{ key: "deposit", amountCents: 30000, balanceCents: 70000, balanceDueDate: "2026-10-03" }, { key: "full", amountCents: 100000 }],
  security: null, words: { balanceVerb: "is due", securityVerb: "is collected" },
};
const NEEDED = { ok: true, needed: true, signed: false, hasCopy: false, ready: true, emailOnFile: true, sent: false, initials: null };
const LINK = "https://app.boldsign.com/document/sign/?documentId=doc-1";
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let agreementCalls;
let agreementAnswers;
beforeEach(() => {
  agreementCalls = [];
  agreementAnswers = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    if (String(url).includes("/functions/v1/agreement")) {
      const body = JSON.parse(opts.body);
      agreementCalls.push(body);
      const next = agreementAnswers.find((a) => a.action === body.action && !a.used);
      if (next) { next.used = true; return answer(next.status ?? 200, next.body); }
      return answer(200, { ok: true, needed: false });
    }
    return answer(200, PAGE);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const reply = (action, body, status) => agreementAnswers.push({ action, body, status });

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
async function mountPay() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/pay/tok.sig"]}>
        <Routes><Route path="/pay/:token" element={<Pay leave={vi.fn()} />} /></Routes>
      </MemoryRouter>,
    );
  });
  await flush();
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}
const click = async (el) => { await act(async () => { el.click(); }); await flush(); };
const button = (host, text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

// ============================================================================
describe("the calls and the checks", () => {
  it("CRITICAL: start sends action, token, the initials word - and an email only when given", async () => {
    reply("start", { ok: true, signLink: LINK });
    expect(await startSigning("tok.sig", "once", "")).toEqual({ ok: true, signLink: LINK });
    reply("start", { ok: true, signLink: LINK });
    await startSigning("tok.sig", "each", " sam@example.com ");
    expect(agreementCalls).toEqual([
      { action: "start", token: "tok.sig", initials: "once" },
      { action: "start", token: "tok.sig", initials: "each", email: "sam@example.com" },
    ]);
    const call = fetch.mock.calls[0];
    expect(call[1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("CRITICAL: only BoldSign's signing app goes in the iframe", async () => {
    expect(isSignLink(LINK)).toBe(true);
    for (const bad of ["https://app.boldsign.com.evil.example/x", "http://app.boldsign.com/x", "https://evil.example/", "", null]) expect(isSignLink(bad)).toBe(false);
    reply("start", { ok: true, signLink: "https://evil.example/sign" });
    expect((await startSigning("tok.sig", "each")).ok).toBe(false);
  });

  it("CRITICAL: 'signed' is believed only from BoldSign, or from this site's own page", () => {
    expect(signingEvent({ origin: BOLDSIGN_ORIGIN, data: { action: "onDocumentSigned" } }, "https://book.example")).toBe("signed");
    expect(signingEvent({ origin: BOLDSIGN_ORIGIN, data: { action: "onDocumentDeclined" } })).toBe("declined");
    expect(signingEvent({ origin: "https://evil.example", data: { action: "onDocumentSigned" } }, "https://book.example")).toBe("");
    expect(signingEvent({ origin: "https://book.example", data: { action: "centexSigned" } }, "https://book.example")).toBe("signed");
    expect(signingEvent({ origin: "https://book.example", data: { action: "onDocumentSigned" } }, "https://book.example")).toBe("");
  });

  it("an older CRM (no function) or any failure reads as not needed - payment-options still refuses if it should", async () => {
    reply("show", { error: "Not found" }, 404);
    expect((await loadAgreement("tok.sig")).needed).toBe(false);
  });

  it("CRITICAL: the contract declares the function and the one new outside host", () => {
    expect(FUNCTIONS.agreement.sends).toEqual(["action", "token", "initials", "email"]);
    expect(FUNCTIONS.agreement.probe).toEqual({ body: { action: "show", token: "contract.check" }, status: 401, key: "error" });
    expect(OUTSIDE.boldsign).toMatchObject({ host: BOLDSIGN_ORIGIN, file: "src/lib/agreement.js" });
  });
});

// b0.26 (CRM v6.41, Jesse 09-27) - SIGNED AFTER THE PAYMENT. The pay page
// never holds the choices back: the step shows only once something is paid.
describe("the pay page", () => {
  const PAID = { ...NEEDED, paid: true };

  it("CRITICAL: needed but nothing paid yet - no step, and the choices as always", async () => {
    reply("show", NEEDED);
    const { host, done } = await mountPay();
    try {
      expect(host.textContent).not.toContain(AGREEMENT_WORDS.afterHeading);
      expect(host.textContent).not.toContain("Initial every page");
      expect(host.querySelector('input[name="option"]')).not.toBeNull();
    } finally { done(); }
  });

  it("CRITICAL: paid and unsigned - 'One more step' above the choices, which stay", async () => {
    reply("show", PAID);
    const { host, done } = await mountPay();
    try {
      expect(host.textContent).toContain(AGREEMENT_WORDS.afterHeading);
      expect(host.textContent).toContain(AGREEMENT_WORDS.afterIntro);
      expect(host.textContent).toContain("Initial all pages at once");
      expect(host.querySelector('input[name="option"]')).not.toBeNull();
      expect(button(host, AGREEMENT_WORDS.open).disabled).toBe(true);
      const step = host.querySelector("section.agreement");
      const choices = host.querySelector('input[name="option"]').closest("fieldset");
      expect(step.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Shown, not merely present: nothing about the signing holds a payment back.
      expect(choices.closest("[hidden]")).toBeNull();
      const go = button(host, "Continue to payment");
      expect(go && !go.hidden && go.closest("[hidden]") === null).toBe(true);
    } finally { done(); }
  });

  it("CRITICAL: the whole way - choose, BoldSign's window, its 'signed', the CRM agrees, then the tick", async () => {
    reply("show", PAID);
    reply("start", { ok: true, signLink: LINK });
    reply("status", { ok: true, signed: true, hasCopy: true });
    const { host, done } = await mountPay();
    try {
      await click(host.querySelector('input[value="once"]'));
      await click(button(host, AGREEMENT_WORDS.open));
      const frame = host.querySelector("iframe");
      expect(frame.getAttribute("src")).toBe(LINK);
      expect(agreementCalls.find((c) => c.action === "start")).toEqual({ action: "start", token: "tok.sig", initials: "once" });
      // A message from anywhere else changes nothing.
      await act(async () => { window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", data: { action: "onDocumentSigned" } })); });
      await flush();
      expect(host.querySelector("iframe")).not.toBeNull();
      expect(agreementCalls.some((c) => c.action === "status")).toBe(false);
      await act(async () => { window.dispatchEvent(new MessageEvent("message", { origin: BOLDSIGN_ORIGIN, data: { action: "onDocumentSigned" } })); });
      await flush();
      expect(agreementCalls.some((c) => c.action === "status")).toBe(true);
      expect(host.textContent).toContain(`✓ ${AGREEMENT_WORDS.signed}`);
      expect(host.textContent).toContain(AGREEMENT_WORDS.copy);
      expect(host.querySelector('input[name="option"]')).not.toBeNull();
      expect(host.querySelector("iframe")).toBeNull();
    } finally { done(); }
  });

  it("CRITICAL: no email on file - asked for, and sent with the start", async () => {
    reply("show", { ...PAID, emailOnFile: false });
    reply("start", { ok: true, signLink: LINK });
    const { host, done } = await mountPay();
    try {
      await click(host.querySelector('input[value="each"]'));
      expect(button(host, AGREEMENT_WORDS.open).disabled).toBe(true);
      const input = host.querySelector(`input[aria-label="${AGREEMENT_WORDS.emailLabel}"]`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "sam@example.com");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(button(host, AGREEMENT_WORDS.open));
      expect(agreementCalls.find((c) => c.action === "start")).toEqual({ action: "start", token: "tok.sig", initials: "each", email: "sam@example.com" });
    } finally { done(); }
  });

  it("CRITICAL: the CRM's refusal is shown as sent, and the guest can try again", async () => {
    reply("show", PAID);
    reply("start", { ok: false, error: "The rental agreement for this camper isn't ready yet. Please contact us and we'll sort it out." }, 409);
    const { host, done } = await mountPay();
    try {
      await click(host.querySelector('input[value="each"]'));
      await click(button(host, AGREEMENT_WORDS.open));
      expect(host.querySelector('section.agreement [role="alert"]').textContent).toBe("The rental agreement for this camper isn't ready yet. Please contact us and we'll sort it out.");
      expect(button(host, AGREEMENT_WORDS.open).disabled).toBe(false);
    } finally { done(); }
  });

  it("already signed - the tick and the copy, and the choices", async () => {
    reply("show", { ...PAID, needed: false, signed: true, hasCopy: true });
    const { host, done } = await mountPay();
    try {
      expect(host.textContent).toContain(`✓ ${AGREEMENT_WORDS.signed}`);
      expect(host.querySelector('input[name="option"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Initial every page");
    } finally { done(); }
  });

  it("not needed (switched off, or an office booking) - the page exactly as before", async () => {
    const { host, done } = await mountPay();
    try {
      expect(host.textContent).not.toContain(AGREEMENT_WORDS.afterHeading);
      expect(host.textContent).not.toContain(AGREEMENT_WORDS.signed);
      expect(host.querySelector('input[name="option"]')).not.toBeNull();
    } finally { done(); }
  });

  it("not ready (a document missing) - says so and offers no signing; paying is not held up", async () => {
    reply("show", { ...PAID, ready: false });
    const { host, done } = await mountPay();
    try {
      expect(host.textContent).toContain(AGREEMENT_WORDS.notReady);
      expect(button(host, AGREEMENT_WORDS.open)).toBeUndefined();
      expect(host.querySelector('input[name="option"]')).not.toBeNull();
    } finally { done(); }
  });
});

// ============================================================================
// b0.26 - /paid: straight back from Stripe
// ============================================================================
async function mountAt(url, path, element) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path={path} element={element} /></Routes>
      </MemoryRouter>,
    );
  });
  await flush();
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe("/paid - straight after the payment", () => {
  it("CRITICAL: an approved guest's deposit return - 'One more step' at once, with the returned token", async () => {
    reply("show", { ...NEEDED, paid: false });
    reply("start", { ok: true, signLink: LINK });
    const { host, done } = await mountAt("/paid/WEB-260928-ABCD?t=tok.sig", "/paid/:reservationNum", <Paid />);
    try {
      expect(host.querySelector("h1").textContent).toBe("Payment received");
      expect(host.textContent).toContain(AGREEMENT_WORDS.afterHeading);
      await click(host.querySelector('input[value="each"]'));
      await click(button(host, AGREEMENT_WORDS.open));
      expect(host.querySelector("iframe").getAttribute("src")).toBe(LINK);
      expect(agreementCalls.map((c) => c.action)).toEqual(["show", "start"]);
      expect(agreementCalls[0].token).toBe("tok.sig");
    } finally { done(); }
  });

  it("CRITICAL: a Book-and-pay return asks only once the booking is confirmed", async () => {
    let outcome = "confirming";
    fetch.mockImplementation(async (url, opts) => {
      if (String(url).includes("/functions/v1/agreement")) {
        agreementCalls.push(JSON.parse(opts.body));
        return answer(200, { ...NEEDED, paid: true });
      }
      return answer(200, { outcome });
    });
    const { host, done } = await mountAt("/paid/WEB-260928-ABCD?booked=1&t=tok.sig", "/paid/:reservationNum", <Paid />);
    try {
      expect(host.querySelector("h1").textContent).toBe("Confirming your booking…");
      expect(agreementCalls).toEqual([]);
      outcome = "booked";
      await act(async () => { await new Promise((r) => setTimeout(r, 2600)); });
      await flush();
      expect(host.querySelector("h1").textContent).toBe("You're booked");
      expect(agreementCalls).toEqual([{ action: "show", token: "tok.sig" }]);
      expect(host.textContent).toContain(AGREEMENT_WORDS.afterHeading);
    } finally { done(); }
  }, 10000);

  it("CRITICAL: already signed - the tick and the copy; no token or a cancel - nothing asked", async () => {
    reply("show", { ...NEEDED, needed: false, signed: true, hasCopy: true });
    let m = await mountAt("/paid/WEB-1?t=tok.sig", "/paid/:reservationNum", <Paid />);
    try {
      expect(m.host.textContent).toContain(`✓ ${AGREEMENT_WORDS.signed}`);
      expect(m.host.textContent).toContain(AGREEMENT_WORDS.copy);
      expect(m.host.textContent).not.toContain(AGREEMENT_WORDS.afterHeading);
    } finally { m.done(); }
    agreementCalls = [];
    for (const url of ["/paid/WEB-1", "/paid/WEB-1?t=tok.sig&cancelled=1"]) {
      m = await mountAt(url, "/paid/:reservationNum", <Paid />);
      try {
        expect(m.host.textContent).not.toContain(AGREEMENT_WORDS.afterHeading);
      } finally { m.done(); }
    }
    expect(agreementCalls).toEqual([]);
  });
});

// ============================================================================
// b0.26 - /sign/:token: the office's Signing Reminder Text
// ============================================================================
describe("/sign - the reminder's page", () => {
  const TRIP = { reservationNum: "QTE-260927-UW2L", unitName: "Charlie", start: "2027-01-12", end: "2027-01-14" };

  it("CRITICAL: the trip, then the step - worded as the agreement, not a payment", async () => {
    reply("show", { ...NEEDED, paid: true, trip: TRIP });
    const { host, done } = await mountAt("/sign/tok.sig", "/sign/:token", <Sign />);
    try {
      expect(host.querySelector("h1").textContent).toBe(AGREEMENT_WORDS.signTitle);
      expect(host.textContent).toContain("Charlie · Jan 12 – Jan 14");
      expect(host.textContent).toContain("QTE-260927-UW2L");
      expect(host.textContent).toContain(AGREEMENT_WORDS.heading);
      expect(host.textContent).toContain("Initial all pages at once");
      expect(host.querySelector('input[name="option"]')).toBeNull();
      expect(document.querySelector('meta[name="robots"][data-pay-page]').getAttribute("content")).toBe("noindex, nofollow");
    } finally { done(); }
  });

  it("CRITICAL: signed - the tick and the copy", async () => {
    reply("show", { ...NEEDED, needed: false, signed: true, hasCopy: true, trip: TRIP });
    const { host, done } = await mountAt("/sign/tok.sig", "/sign/:token", <Sign />);
    try {
      expect(host.textContent).toContain(`✓ ${AGREEMENT_WORDS.signed}`);
      expect(host.textContent).toContain(AGREEMENT_WORDS.copy);
      expect(host.textContent).not.toContain("Initial every page");
    } finally { done(); }
  });

  it("CRITICAL: a link that no longer verifies says so in the reminder's words; nothing to sign says that", async () => {
    reply("show", { ok: false, error: "This payment link has expired. Please contact us and we'll send you a new one." }, 410);
    let m = await mountAt("/sign/tok.sig", "/sign/:token", <Sign />);
    try {
      expect(m.host.querySelector('[role="alert"]').textContent).toBe(AGREEMENT_WORDS.badLink);
      expect(m.host.textContent).not.toContain("payment link");
    } finally { m.done(); }
    reply("show", { ok: true, needed: false, signed: false, trip: TRIP });
    m = await mountAt("/sign/tok.sig", "/sign/:token", <Sign />);
    try {
      expect(m.host.textContent).toContain(AGREEMENT_WORDS.nothingToSign);
    } finally { m.done(); }
  });
});

// ============================================================================
// b0.26 - the signed copy's window (the sandbox test: it was blocked)
// ============================================================================
describe("openSignedCopy - the window is opened at the tap", () => {
  const COPY = "https://files.example/signed/b1/doc.pdf";

  it("CRITICAL: opened blank BEFORE the call, then pointed at the copy", async () => {
    const order = [];
    const tab = { opener: "page", location: { href: "" }, close: vi.fn() };
    const win = { open: vi.fn(() => { order.push("open"); return tab; }), location: { assign: vi.fn() } };
    fetch.mockImplementation(async () => { order.push("fetch"); return answer(200, { ok: true, url: COPY }); });
    expect(await openSignedCopy("tok.sig", win)).toEqual({ ok: true, url: COPY });
    expect(order).toEqual(["open", "fetch"]);
    expect(win.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(COPY);
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it("CRITICAL: no window allowed - this tab goes; a failure closes the blank one", async () => {
    const win = { open: vi.fn(() => null), location: { assign: vi.fn() } };
    fetch.mockImplementation(async () => answer(200, { ok: true, url: COPY }));
    await openSignedCopy("tok.sig", win);
    expect(win.location.assign).toHaveBeenCalledWith(COPY);
    const tab = { location: { href: "" }, close: vi.fn() };
    const win2 = { open: vi.fn(() => tab), location: { assign: vi.fn() } };
    fetch.mockImplementation(async () => answer(404, { ok: false, error: "There's no signed copy yet." }));
    expect(await openSignedCopy("tok.sig", win2)).toMatchObject({ ok: false, error: "There's no signed copy yet." });
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });
});
