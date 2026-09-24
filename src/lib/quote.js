// b0.13 — THE LIVE QUOTE.
//
// The site never prices anything. request-booking does (CRM v6.03,
// _shared/quote.ts), from the CRM's own tables, and this file only asks and
// then words what came back. Three rules follow from that:
//
//   * NO ARITHMETIC ON MONEY HERE. The total shown is the server's totalCents,
//     never a sum of lines done in the browser. Two sums are two opinions.
//   * A REFUSAL IS SHOWN WORD FOR WORD, the same rule as a request's refusal:
//     the server is the only thing that knows why it said no.
//   * NOTHING ABOUT FEES THE SERVER DID NOT NAME. No service fee is charged on
//     the direct site and the site says nothing about it either way (CRM
//     decision 4, Jesse: "leave off the commentary"). request.test.jsx /
//     quote.test.jsx hold the source and the rendered page to that.

import { FUNCTIONS } from "./contract.js";

const apiUrl = () => import.meta.env.VITE_SUPABASE_URL;

// What the guest sees when a total could not be worked out. It does NOT stop
// the request: the server re-prices every request anyway, and a guest who
// cannot see a total can still ask for the dates.
export const QUOTE_UNAVAILABLE =
  "We couldn't work out a total just now. You can still send the request — we'll confirm the price.";

// The guest's choices as the server wants them: [{ id, qty }], ALWAYS an
// array. `selections` is { [addonId]: qty }. Zero, blank and non-numbers are
// dropped (unticked); required add-ons are not sent - the server puts every
// required one on the quote itself, hidden ones included.
export function addonsPayload(selections, addons = []) {
  const required = new Set(addons.filter((a) => a.required).map((a) => a.addonId));
  const out = [];
  for (const [id, raw] of Object.entries(selections || {})) {
    const qty = Number(raw);
    if (!id || required.has(id) || !Number.isInteger(qty) || qty < 1) continue;
    out.push({ id, qty });
  }
  return out;
}

// A quote the server sent, or null. Checked field by field: a body without
// `quote: true` is not a quote (an older deploy, or the honeypot's plausible
// nothing), and a total that is not a whole number of cents is not a price.
//
// b0.14 (CRM v6.05): a quote also carries subtotalCents and taxCents, and
// they must add up to the total - the page shows Subtotal / Tax / Total and
// adds up nothing itself. A server from before v6.05 sends neither, and its
// answer is not a quote this page can show.
export function readQuote(body, { requireFlag = true } = {}) {
  if (!body || body.ok !== true) return null;
  if (requireFlag && body.quote !== true) return null;
  if (!Array.isArray(body.lines) || !body.lines.length) return null;
  if (!Number.isInteger(body.totalCents)) return null;
  if (!Number.isInteger(body.subtotalCents) || !Number.isInteger(body.taxCents)) return null;
  if (body.subtotalCents + body.taxCents !== body.totalCents) return null;
  const kinds = FUNCTIONS["request-booking"].quote.kinds;
  const lines = [];
  for (const l of body.lines) {
    if (!l || !kinds.includes(l.kind) || !Number.isInteger(l.amountCents)) return null;
    lines.push({
      kind: l.kind,
      label: typeof l.label === "string" ? l.label : "",
      addonId: typeof l.addonId === "string" ? l.addonId : null,
      quantity: Number.isInteger(l.quantity) ? l.quantity : 1,
      nights: Number.isInteger(l.nights) ? l.nights : null,
      unitPriceCents: Number.isInteger(l.unitPriceCents) ? l.unitPriceCents : null,
      amountCents: l.amountCents,
      // b0.14 - one-way miles on a delivery line priced by distance, else null.
      miles: l.kind === "delivery" && Number.isInteger(l.miles) && l.miles >= 0 ? l.miles : null,
    });
  }
  return {
    lines,
    subtotalCents: body.subtotalCents,
    taxCents: body.taxCents,
    totalCents: body.totalCents,
    estimate: body.estimate === true,
  };
}

// b0.14 - the delivery address, ONLY when all four parts are there (the same
// rule the server prices by: a street with no town geocodes somewhere,
// confidently and wrongly). Anything less sends no address, and the server
// quotes delivery as "from $minimum".
export function deliveryDestination(d) {
  const t = (v) => (typeof v === "string" ? v.trim() : "");
  const out = { address: t(d?.address), city: t(d?.city), state: t(d?.state), zip: t(d?.zip) };
  return out.address.length >= 5 && out.city && out.state && out.zip ? out : null;
}

// Asks. Resolves to { ok: true, quote } | { ok: false, errors } |
// { ok: false, unavailable: true } - never throws, never rejects, and an
// aborted call (the guest changed something) resolves { aborted: true } so the
// caller can ignore it.
export async function quoteBooking({ unitId, start, end, method, addons, destination }, { signal } = {}) {
  const url = apiUrl();
  if (!url) {
    console.error("VITE_SUPABASE_URL is not set — the quote could not be asked for");
    return { ok: false, unavailable: true };
  }
  let res;
  try {
    res = await fetch(`${url}/functions/v1/request-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quote: true, unitId, start, end, method: method === "delivery" ? "delivery" : "pickup", addons,
        // b0.14 - only a complete address, and only for delivery.
        ...(method === "delivery" && deliveryDestination(destination) ? deliveryDestination(destination) : {}),
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return { aborted: true };
    return { ok: false, unavailable: true };
  }
  if (!res || typeof res.json !== "function") return { ok: false, unavailable: true };
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (signal?.aborted) return { aborted: true };
  const quote = readQuote(body);
  if (quote) return { ok: true, quote };
  // A refusal - ONLY if it says it was a quote refusal, with sentences.
  if (body && body.ok === false && body.quote === true && Array.isArray(body.errors)) {
    const errors = body.errors.filter((e) => typeof e === "string" && e.trim());
    if (errors.length) return { ok: false, errors };
  }
  if (res.status === 401 || res.status === 403) {
    console.error("request-booking answered %s — redeploy it with --no-verify-jwt", res.status);
  } else {
    console.error("request-booking did not answer a quote:", res.status, body);
  }
  return { ok: false, unavailable: true };
}

// ----------------------------------------------------------------------------
// Words.
// ----------------------------------------------------------------------------

// Cents to "$1,234" or "$1,234.50". Whole dollars drop the cents, the way
// listings.js's money() shows a nightly price, so a quote and a price tag
// agree on how $109 is written.
export function cents(n) {
  if (!Number.isInteger(n)) return "";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = abs % 100 === 0;
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What the line is, in the guest's words. Built from the server's own
// numbers - quantity, nights, unit price - never recomputed.
export function lineLabel(line) {
  if (line.kind === "delivery") return "Delivery";
  return line.label || (line.kind === "rental" ? "Rental" : "");
}

export function lineDetail(line) {
  const unit = cents(line.unitPriceCents);
  if (line.kind === "rental") {
    return line.nights && unit ? `${unit} × ${plural(line.nights, "night", "nights")}` : "";
  }
  if (line.kind === "addon") {
    const parts = [];
    if (line.quantity > 1 && unit) parts.push(`${line.quantity} × ${unit}`);
    else if (line.nights && unit) parts.push(unit);
    if (line.nights) parts.push(plural(line.nights, "day", "days"));
    return parts.join(" × ");
  }
  if (line.kind === "delivery") {
    // b0.15 (Jesse, 09-24) - priced by distance: no note at all, just the
    // amount. The miles stay in the quote (the office panel shows them as
    // "Delivery (41 miles)"); the guest is not shown them. Otherwise the
    // minimum, which the office confirms.
    return Number.isInteger(line.miles) ? "" : "We'll confirm the delivery price.";
  }
  return "";
}

// The amount column. A delivery line is the camper's MINIMUM, so it reads
// "from $X" (CRM decision 5); with no minimum set it is only a promise to
// confirm, not a "$0".
export function lineAmount(line) {
  if (line.kind === "delivery") {
    if (Number.isInteger(line.miles)) return cents(line.amountCents);
    return line.amountCents > 0 ? `from ${cents(line.amountCents)}` : "to confirm";
  }
  return cents(line.amountCents);
}

// The total, the server's own. With delivery on it the delivery part is a
// minimum, so the total is too: "from $X".
export function totalAmount(quote) {
  return quote.estimate ? `from ${cents(quote.totalCents)}` : cents(quote.totalCents);
}

// b0.14 - the lines a guest is shown: everything but the per-rate tax lines,
// which the server still sends (and stores) but which are shown as ONE Tax
// figure under the Subtotal (Jesse, 09-24).
export function itemLines(quote) {
  return quote.lines.filter((l) => l.kind !== "tax");
}

// How long the quote box waits after the last change before asking. Long
// enough that stepping a quantity 1 -> 4 is one call, short enough to feel live.
export const QUOTE_DEBOUNCE_MS = 400;
// b0.14 - longer while an address is being typed: every pause with a complete
// address is a distance lookup on the server, and the office app waits 900 ms
// for the same reason.
export const ADDRESS_DEBOUNCE_MS = 900;
