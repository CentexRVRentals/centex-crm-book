// b0.18 (CRM v6.20) — AN OFFICE QUOTE'S TWO CALLS, AND HOW IT READS.
//
// A guest called and asked what a stay costs; the office priced it in the CRM
// and texted them a link to /quote/<token>. The token is signed by the CRM
// (PAY_PAGE_SECRET, under the quote key) and is the page's only credential,
// so `quote-page` is deployed --no-verify-jwt and called like payment-options:
// no Authorization header and no key.
//
//   show    { action: "show", token }    -> the camper, the dates, the money
//   accept  { action: "accept", token }  -> accepted; the pay page's token
//
// ============================================================================
// JESSE'S RULES (09-26), AS THIS PAGE MEETS THEM
// ============================================================================
//   * THE DATES ARE NOT HELD UNTIL THE GUEST HAS PAID. Anyone can book them
//     until then, and the quote then expires - the server says so ("This
//     quote has expired...") and this page shows the sentence as sent.
//   * ACCEPT, THEN PAY. The office's quote is the approval, so there is
//     nothing to wait for: accepting sends the guest straight to the pay page
//     (/pay/<payToken>), and the PAYMENT books it. With online payment off
//     there is no pay token, and the page says the office will text how to
//     pay. Three states: not accepted / accepted, not paid / paid.
//
// The page never sends an amount. The server re-reads everything when it
// accepts, and the quote's prices are the ones the office saved.

import { lineDetail, lineLabel, readPayQuote } from "./quote.js";
import { shortDate, usd } from "./payments.js";

const apiUrl = () => import.meta.env.VITE_SUPABASE_URL;

// The page's three sentences about holding, tested as written.
export const NOT_HELD_YET = "These dates aren't held for you yet. Accept and pay to book them — until your payment goes through, someone else could.";
export const ACCEPTED_NOT_PAID = "You've accepted this quote, but you're not booked until you've paid. Your dates aren't held until then.";
export const PAY_BY_TEXT = "We'll text you shortly with how to pay. Your dates aren't held until you've paid.";


const OFFLINE = "We couldn't reach us just then. Check your connection and try again.";
const UNREADABLE = "Something went wrong on our end. Please call us and we'll sort it out.";

async function call(body) {
  const url = apiUrl();
  if (!url) {
    console.error("VITE_SUPABASE_URL is not set — quote-page could not be called");
    return { ok: false, error: UNREADABLE, misconfigured: true };
  }
  let res;
  try {
    // Written out in full so contract-offline.test.js can see it is in the contract.
    res = await fetch(`${url}/functions/v1/quote-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: OFFLINE, unreached: true };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const said = data && typeof data.error === "string" && data.error.trim() ? data.error.trim() : "";
  if (!res.ok) {
    // A 401 WITH our sentence is a bad token (the guest's problem, worded for
    // them); one WITHOUT is the gateway (--no-verify-jwt missed) - ours.
    if ((res.status === 401 || res.status === 403) && !said) {
      console.error("quote-page answered %s with no sentence — redeploy it with --no-verify-jwt", res.status);
      return { ok: false, error: UNREADABLE, misconfigured: true, status: res.status };
    }
    return { ok: false, error: said || UNREADABLE, status: res.status, expired: data?.expired === true };
  }
  if (!data || typeof data !== "object" || data.ok !== true) return { ok: false, error: UNREADABLE, unreadable: true };
  return { ok: true, data };
}

export async function loadOfficeQuote(token) {
  const r = await call({ action: "show", token: String(token ?? "") });
  return r.ok ? { ok: true, page: r.data } : r;
}

// The pay page's token, only if it is one: two base64url parts, nothing that
// could make /pay/... a path somewhere else.
export function payPathFrom(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? `/pay/${token}` : "";
}

export async function acceptOfficeQuote(token) {
  const r = await call({ action: "accept", token: String(token ?? "") });
  if (!r.ok) return r;
  if (r.data.accepted !== true) return { ok: false, error: UNREADABLE, unreadable: true };
  return {
    ok: true,
    reservationNum: typeof r.data.reservationNum === "string" ? r.data.reservationNum : "",
    payPath: payPathFrom(r.data.payToken),
    payProblem: typeof r.data.payProblem === "string" ? r.data.payProblem : "",
  };
}

// ----------------------------------------------------------------------------
// How it reads. Pure, so the words are tested rather than eyeballed.
// ----------------------------------------------------------------------------
// The items are the pay page's (readPayQuote): the quote's lines less tax,
// then Subtotal and Tax, worded by the same lineLabel / lineDetail.
export function officeQuoteView(page) {
  const p = page && typeof page === "object" ? page : {};
  const q = readPayQuote(p.quote);
  const dates = shortDate(p.start) && shortDate(p.end) ? `${shortDate(p.start)} – ${shortDate(p.end)}` : "";
  return {
    accepted: p.accepted === true,
    // b0.18 - paid is booked; accepted and not paid is not.
    paid: p.accepted === true && p.paid === true,
    payPath: payPathFrom(p.payToken),
    reservationNum: typeof p.reservationNum === "string" ? p.reservationNum : "",
    trip: [typeof p.unitName === "string" ? p.unitName : "", dates].filter(Boolean).join(" · "),
    how: p.method === "delivery" ? "Delivered to you" : "Picked up from our lot in Kyle",
    items: q ? q.items.map((l, i) => ({ key: `${l.kind}-${l.addonId || ""}-${i}`, kind: l.kind, label: lineLabel(l), detail: lineDetail(l), amount: usd(l.amountCents) })) : [],
    subtotal: q && q.taxCents > 0 ? usd(q.subtotalCents) : "",
    tax: q && q.taxCents > 0 ? usd(q.taxCents) : "",
    total: usd(p.totalCents),
  };
}
