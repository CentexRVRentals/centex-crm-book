import { FUNCTIONS } from "./contract.js";
import { readQuote } from "./quote.js";

// THE ONLY WRITE THIS SITE MAKES.
//
// `request-booking` is deployed --no-verify-jwt, so it is called with no
// Authorization header at all. The anon key is not sent either: the function
// does not read one, and sending a credential to an endpoint that ignores it
// teaches the next person that it matters.
//
// WHAT COMES BACK, and why this module hands it on almost untouched:
//
//   { ok: true,  reservationNum, quote }     a hold was created (b0.13: with
//                                            the quote the server saved, or
//                                            null if it sent none)
//   { ok: true,  duplicate: true, ... }      the same request twice — one hold
//   { ok: false, errors: [ "..." ] }         refused, with sentences to SHOW
//
// **The error sentences are written to be read by a guest, verbatim.** This
// module does not rewrite them and the form does not paraphrase them. The
// server is the only thing that knows why it refused, and a second opinion
// phrased differently is how a guest ends up reading two different reasons for
// one refusal.

// READ AT CALL TIME, not module load. Captured at load it would be fixed
// before anything could influence it — which made it untestable, and would
// also mean a deploy with the variable missing failed at import with a stack
// trace instead of at the point of use with a sentence.
//
// supabase.js does the opposite ON PURPOSE: it throws at boot, because a site
// that renders an empty fleet looks like a data problem and is not one. The
// difference is that this is needed once, at submit; that is needed on every
// page.
const apiUrl = () => import.meta.env.VITE_SUPABASE_URL;

// A refusal that never reached the server still has to read like the others,
// because the form renders them all the same way.
const OFFLINE = ["We couldn't reach us just then. Check your connection and try again."];
const UNREADABLE = ["Something went wrong on our end. Please call us and we'll sort it out."];

export async function requestBooking(payload) {
  const url = apiUrl();
  if (!url) {
    console.error("VITE_SUPABASE_URL is not set — the request could not be sent");
    return { ok: false, errors: UNREADABLE, misconfigured: true };
  }

  let res;
  try {
    res = await fetch(`${url}/functions/v1/request-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network failure, DNS, offline. Not a refusal — the request never
    // happened, so "try again" is honest advice rather than a shrug.
    return { ok: false, errors: OFFLINE, unreached: true };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  // A 401 means --no-verify-jwt was missed on the deploy. Named rather than
  // shown as a generic failure: it is a deployment mistake, not a guest one,
  // and it would otherwise present as "something went wrong" forever.
  if (res.status === 401 || res.status === 403) {
    console.error("request-booking answered %s — redeploy it with --no-verify-jwt", res.status);
    return { ok: false, errors: UNREADABLE, misconfigured: true };
  }

  if (!body || typeof body.ok !== "boolean") {
    console.error("request-booking answered an unexpected shape:", res.status, body);
    return { ok: false, errors: UNREADABLE, unreadable: true };
  }

  if (body.ok === true) {
    // b0.13 - the quote the server SAVED with the hold (CRM v6.03). A
    // duplicate answers without one: the first request's quote is the one on
    // the booking, and this site does not have it.
    return {
      ok: true,
      reservationNum: body.reservationNum || "",
      duplicate: body.duplicate === true,
      quote: readQuote(body, { requireFlag: false }),
    };
  }

  // Errors SHOWN AS SENT. If the server ever answers ok:false with no errors,
  // something is wrong with the server rather than the request, and the guest
  // still needs a sentence.
  const errors = Array.isArray(body.errors) && body.errors.length
    ? body.errors.filter((e) => typeof e === "string" && e.trim())
    : UNREADABLE;
  return { ok: false, errors };
}

// The payload, built in one place so the form cannot forget a field.
//
// `company` IS THE HONEYPOT and must always be present, even empty. The server
// answers a filled one with a plausible success and writes nothing; if this
// site stopped sending the field, the form would lose its cheapest defence and
// nothing else would notice. The contract lists it for that reason, and an
// offline guard asserts it is still there.
//
// b0.13 - `addons` is ALWAYS an array ([] for none), built by addonsPayload.
// It must never go through the blank-fill below: the server refuses
// `addons: ""` as malformed ("We couldn't read the add-ons..."), so a guest
// who picked nothing would have been refused outright.
export function buildPayload({ unitId, dates, guest, delivery, addons }) {
  const wants = FUNCTIONS["request-booking"].sends;
  const payload = {
    unitId,
    start: dates.start,
    end: dates.end,
    name: guest.name,
    email: guest.email,
    phone: guest.phone,
    guests: guest.guests,
    notes: guest.notes,
    method: delivery.wanted ? "delivery" : "pickup",
    address: delivery.wanted ? delivery.address : "",
    city: delivery.wanted ? delivery.city : "",
    state: delivery.wanted ? delivery.state : "",
    zip: delivery.wanted ? delivery.zip : "",
    company: guest.company || "",
    addons: Array.isArray(addons) ? addons : [],
  };
  // Every field the contract says this endpoint accepts is present, even when
  // blank. A missing key and an empty one are the same to the server, but a
  // missing key is how a field silently stops being sent.
  for (const k of wants) if (!(k in payload)) payload[k] = "";
  return payload;
}
