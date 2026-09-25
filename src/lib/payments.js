// b0.12 — THE "CHOOSE HOW TO PAY" PAGE'S TWO CALLS, AND HOW IT READS.
//
// The page at /pay/:token is reached from the approval text. The token in the
// URL is signed by the CRM (PAY_PAGE_SECRET) and is the ONLY credential: this
// site has no login, and `payment-options` is deployed --no-verify-jwt for
// exactly that reason (CRM decision 28). So, like request-booking, it is
// called with no Authorization header and no key.
//
//   show    { action: "show", token }          -> what the page displays
//   choose  { action: "choose", token, option } -> a Stripe Checkout URL
//
// ============================================================================
// THE PAGE NEVER SAYS HOW MUCH
// ============================================================================
// `option` is a word — deposit, full or balance. The server re-derives the
// amount from the database at the moment of choosing, so a page left open
// while the office edits the total charges the new total (or is refused).
// Nothing here sends a number, and pay.test.jsx asserts the body's keys.
//
// ============================================================================
// THE SERVER'S SENTENCES ARE SHOWN AS SENT
// ============================================================================
// Same rule as request.js: every refusal from payment-options is written for a
// guest ("This payment link has expired. Please contact us..."), and a second
// wording here is how a guest ends up reading two reasons for one refusal.
//
// ONE DIFFERENCE FROM request.js. A 401 there always means --no-verify-jwt was
// missed. Here a 401 is ALSO the honest answer to a bad token — so a 401 that
// carries our `error` sentence is shown, and only a 401 WITHOUT one (the
// gateway's, not ours) is treated as a deployment mistake.

import { lineDetail, lineLabel, readPayQuote } from "./quote.js";

const apiUrl = () => import.meta.env.VITE_SUPABASE_URL;

const OFFLINE = "We couldn't reach us just then. Check your connection and try again.";
const UNREADABLE = "Something went wrong on our end. Please call us and we'll sort it out.";

async function call(body) {
  const url = apiUrl();
  if (!url) {
    console.error("VITE_SUPABASE_URL is not set — payment-options could not be called");
    return { ok: false, error: UNREADABLE, misconfigured: true };
  }
  let res;
  try {
    // Written out in full so contract-offline.test.js can see it is in the contract.
    res = await fetch(`${url}/functions/v1/payment-options`, {
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
    if ((res.status === 401 || res.status === 403) && !said) {
      console.error("payment-options answered %s with no sentence — redeploy it with --no-verify-jwt", res.status);
      return { ok: false, error: UNREADABLE, misconfigured: true, status: res.status };
    }
    return { ok: false, error: said || UNREADABLE, status: res.status };
  }
  if (!data || typeof data !== "object") return { ok: false, error: UNREADABLE, unreadable: true };
  return { ok: true, data };
}

export async function loadPayPage(token) {
  const r = await call({ action: "show", token: String(token ?? "") });
  if (!r.ok) return r;
  if (!Array.isArray(r.data.options) || !r.data.options.length) {
    console.error("payment-options show answered with no options:", r.data);
    return { ok: false, error: UNREADABLE, unreadable: true };
  }
  return { ok: true, page: r.data };
}

export async function choosePayment(token, option) {
  const r = await call({ action: "choose", token: String(token ?? ""), option: String(option ?? "") });
  if (!r.ok) return r;
  // Stripe Checkout, and only Stripe Checkout. Anything else in `url` is not
  // somewhere a guest's browser should be sent with their card in hand.
  const url = r.data.url;
  if (typeof url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    console.error("payment-options choose answered without a Stripe Checkout URL:", r.data);
    return { ok: false, error: UNREADABLE, unreadable: true };
  }
  return { ok: true, url };
}

// ----------------------------------------------------------------------------
// How it reads. Pure, so the words are tested rather than eyeballed.
// ----------------------------------------------------------------------------
// Cents in, "$1,234.56" out. A missing or broken amount is "" rather than
// "$0.00": a page promising a guest they owe nothing is worse than a gap.
export function usd(cents) {
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) return "";
  const dollars = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}

// "2026-10-02" -> "Friday, October 2". The CRM's pay-page rules format the
// same way; this is this repo's own copy, because the two share no code.
export function longDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return "";
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}

export function shortDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

// b0.16 (CRM v6.09) - what the total is made of, for a website booking: the
// items the guest was quoted, then Subtotal and Tax, worded by the SAME
// lineLabel / lineDetail as the quote box and /requested. Amounts are in this
// page's own format (usd, always cents), so every figure on the page reads
// alike. No quote (office or OTA booking, or a server from before v6.09): no
// items, and the page shows the total alone, as before. No tax: no Subtotal
// or Tax rows either - there is nothing to split.
function payItems(raw) {
  const q = readPayQuote(raw);
  if (!q) return { items: [], subtotal: "", tax: "" };
  return {
    items: q.items.map((l, i) => ({
      key: `${l.kind}-${l.addonId || ""}-${i}`,
      kind: l.kind,
      label: lineLabel(l),
      detail: lineDetail(l),
      amount: usd(l.amountCents),
    })),
    subtotal: q.taxCents > 0 ? usd(q.subtotalCents) : "",
    tax: q.taxCents > 0 ? usd(q.taxCents) : "",
  };
}

// b0.17 (CRM v6.12) - a Book-and-pay guest's hold, as a time on the camper's
// clock (US Central, where every date in this business is reckoned). "" for an
// approved booking (holdUntil null) or anything that is not a time: a page
// that promised "held until" a nonsense time is worse than one that says
// nothing.
export function holdLine(holdUntil) {
  if (typeof holdUntil !== "string" || !holdUntil) return "";
  const t = new Date(holdUntil);
  if (Number.isNaN(t.getTime())) return "";
  const time = t.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return `We're holding these dates for you until ${time} (Central). Finish paying before then to book them.`;
}

// The page as sentences. `words` comes from the server (balanceVerb,
// securityVerb) so the day the CRM's charger ships, the page stops saying
// "is due" and starts saying what really happens without a release here.
export function payPageView(page) {
  const p = page && typeof page === "object" ? page : {};
  const words = p.words && typeof p.words === "object" ? p.words : {};
  const balanceVerb = typeof words.balanceVerb === "string" && words.balanceVerb ? words.balanceVerb : "is due";
  const securityVerb = typeof words.securityVerb === "string" && words.securityVerb ? words.securityVerb : "is collected";
  const windowDays = Number.isInteger(p.windowDays) ? p.windowDays : 7;

  const choices = (Array.isArray(p.options) ? p.options : [])
    .filter((o) => o && ["deposit", "full", "balance"].includes(o.key) && usd(o.amountCents))
    .map((o) => {
      if (o.key === "deposit") {
        const rest = usd(o.balanceCents);
        const when = longDate(o.balanceDueDate);
        return {
          key: "deposit",
          title: "Reservation Deposit",
          amount: usd(o.amountCents),
          detail: rest && when
            ? `Pay ${usd(o.amountCents)} now. The remaining ${rest} ${balanceVerb} ${when}.`
            : `Pay ${usd(o.amountCents)} now to hold your dates.`,
        };
      }
      if (o.key === "balance") {
        return {
          key: "balance",
          title: "Balance",
          amount: usd(o.amountCents),
          detail: `Your Reservation Deposit is paid. This is the rest: ${usd(o.amountCents)}.`,
        };
      }
      return {
        key: "full",
        title: "Pay in Full",
        amount: usd(o.amountCents),
        detail: p.insideWindow
          ? `Your trip starts within ${windowDays} days, so the full ${usd(o.amountCents)} is due now.`
          : `Pay the whole ${usd(o.amountCents)} now, with nothing left to pay later.`,
      };
    });

  const s = p.security && typeof p.security === "object" ? p.security : null;
  const security = s && usd(s.cents) && longDate(s.date)
    ? `A ${usd(s.cents)} Refundable Security Deposit ${securityVerb} ${longDate(s.date)}, and returned after your trip.`
    : "";

  const dates = shortDate(p.start) && shortDate(p.end) ? `${shortDate(p.start)} – ${shortDate(p.end)}` : "";
  return {
    reservationNum: typeof p.reservationNum === "string" ? p.reservationNum : "",
    // b0.17 - "" unless this is a Book-and-pay guest's hold.
    hold: holdLine(p.holdUntil),
    trip: [typeof p.unitName === "string" ? p.unitName : "", dates].filter(Boolean).join(" · "),
    ...payItems(p.quote),
    total: usd(p.totalCents),
    paid: Number.isInteger(p.paidCents) && p.paidCents > 0 ? usd(p.paidCents) : "",
    choices,
    security,
  };
}
