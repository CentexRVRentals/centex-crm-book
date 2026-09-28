// b0.25 (CRM v6.40, Sprint 5) - THE RENTAL AGREEMENT, SIGNED ON THE PAY PAGE.
//
// A website booking's guest signs the rental agreement - the fleet-wide base
// agreement, the camper's Supplemental Rental Agreement and a signature page,
// merged into one PDF by the CRM - before their first payment, once the office
// has switched e-signing on. The signing itself is BoldSign's, embedded here
// in an iframe; BoldSign sends the guest no emails of its own.
//
// One Edge Function, `agreement`, deployed --no-verify-jwt like
// payment-options: the signed pay token in the URL is the credential, so it
// is called with no Authorization header.
//
//   show    { action: "show", token }                    -> needed? signed? ready? email on file?
//   start   { action: "start", token, initials, email? } -> signLink (or pending)
//   link    { action: "link", token }                    -> a new signLink for the one sent
//   status  { action: "status", token }                  -> signed yet?
//   copy    { action: "copy", token }                    -> a 10-minute link to the signed PDF
//
// THE SERVER DECIDES. The pay page's signing step is a convenience; the
// refusal of an unsigned booking's payment is the CRM's (payment-options
// choose). This file never says "signed" on a guess: only `status`/`show`
// answering signed: true does.
//
// THE ONE OUTSIDE HOST HERE is BoldSign's signing app. The iframe's address
// comes from the server; this file only checks that it is BoldSign's, and
// that a message said to come from the signing did (its origin).

const apiUrl = () => import.meta.env.VITE_SUPABASE_URL;

export const BOLDSIGN_ORIGIN = "https://app.boldsign.com";
export const INITIALS = ["each", "once"];

const OFFLINE = "We couldn't reach us just then. Check your connection and try again.";
const UNREADABLE = "Something went wrong on our end. Please call us and we'll sort it out.";

async function call(body) {
  const url = apiUrl();
  if (!url) {
    console.error("VITE_SUPABASE_URL is not set — agreement could not be called");
    return { ok: false, error: UNREADABLE, misconfigured: true };
  }
  let res;
  try {
    // Written out in full so contract-offline.test.js can see it is in the contract.
    res = await fetch(`${url}/functions/v1/agreement`, {
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
  if (!res.ok && res.status !== 202) {
    if ((res.status === 401 || res.status === 403) && !said) {
      console.error("agreement answered %s with no sentence — redeploy it with --no-verify-jwt", res.status);
      return { ok: false, error: UNREADABLE, misconfigured: true, status: res.status };
    }
    return { ok: false, error: said || UNREADABLE, status: res.status };
  }
  if (!data || typeof data !== "object") return { ok: false, error: UNREADABLE, unreadable: true };
  return { ok: true, data, status: res.status };
}

// What the page needs to know. A server without the function (an older CRM)
// or any failure reads as "not needed": the page then offers payment as
// before, and payment-options refuses an unsigned booking with its own
// sentence if it should have been signed - the page cannot let a guest past.
export async function loadAgreement(token) {
  const r = await call({ action: "show", token: String(token ?? "") });
  if (!r.ok) return { ok: false, needed: false, error: r.error };
  const d = r.data;
  return {
    ok: true,
    needed: d.needed === true,
    signed: d.signed === true,
    signedAt: typeof d.signedAt === "string" ? d.signedAt : "",
    hasCopy: d.hasCopy === true,
    ready: d.ready === true,
    emailOnFile: d.emailOnFile === true,
    sent: d.sent === true,
    initials: INITIALS.includes(d.initials) ? d.initials : "",
  };
}

// A link we will put in an iframe: BoldSign's signing app, and nothing else.
export function isSignLink(link) {
  return typeof link === "string" && link.startsWith(`${BOLDSIGN_ORIGIN}/`);
}

function signReply(r) {
  if (!r.ok) return r;
  if (r.data.signed === true) return { ok: true, signed: true };
  if (r.status === 202 || r.data.pending === true) return { ok: true, pending: true };
  if (!isSignLink(r.data.signLink)) {
    console.error("agreement answered without a BoldSign signing link:", r.data);
    return { ok: false, error: UNREADABLE, unreadable: true };
  }
  return { ok: true, signLink: r.data.signLink };
}

export async function startSigning(token, initials, email) {
  const body = { action: "start", token: String(token ?? ""), initials: String(initials ?? "") };
  if (email) body.email = String(email).trim();
  return signReply(await call(body));
}

export async function signingLink(token) {
  return signReply(await call({ action: "link", token: String(token ?? "") }));
}

export async function checkSigned(token) {
  const r = await call({ action: "status", token: String(token ?? "") });
  if (!r.ok) return { ok: false, signed: false };
  return { ok: true, signed: r.data.signed === true, hasCopy: r.data.hasCopy === true };
}

export async function signedCopy(token) {
  const r = await call({ action: "copy", token: String(token ?? "") });
  if (!r.ok) return r;
  if (typeof r.data.url !== "string" || !r.data.url.startsWith("https://")) return { ok: false, error: UNREADABLE };
  return { ok: true, url: r.data.url };
}

// What BoldSign's signing window tells the page (window.postMessage), only
// when it really came from BoldSign. "signed" | "declined" | "failed" | "".
// Our own redirect page (the pay page opened inside the window with
// ?signed=1 after signing) says "centexSigned" from this site's own origin.
export function signingEvent(event, ownOrigin) {
  if (!event || typeof event !== "object") return "";
  const action = event.data && typeof event.data === "object" ? event.data.action : event.data;
  if (event.origin === BOLDSIGN_ORIGIN) {
    if (action === "onDocumentSigned") return "signed";
    if (action === "onDocumentDeclined") return "declined";
    if (action === "onDocumentSigningFailed") return "failed";
    return "";
  }
  if (ownOrigin && event.origin === ownOrigin && action === "centexSigned") return "signed";
  return "";
}

// The guest's two ways to initial (Jesse, 09-27).
export const INITIALS_CHOICES = [
  { key: "each", title: "Initial every page", detail: "Initial the bottom of each page of both agreements as you read them." },
  { key: "once", title: "Initial all pages at once", detail: "One initial on the signature page, confirming you've read and initial every page." },
];

export const AGREEMENT_WORDS = {
  heading: "Sign the rental agreement",
  intro: "Before you pay, please read and sign the rental agreement for this camper. It opens here, and takes a couple of minutes.",
  notReady: "The rental agreement for this camper isn't ready yet. Please call us and we'll sort it out.",
  emailLabel: "Your email address",
  emailHint: "We use it to identify you on the signed agreement. We won't send you marketing.",
  open: "Open the agreement to sign",
  opening: "Opening the agreement…",
  preparing: "Preparing your agreement — one moment…",
  checking: "Signed — checking with the signing service…",
  signed: "Rental agreement signed",
  declined: "You chose not to sign. You'll need to sign the agreement to book — start again whenever you're ready, or call us with questions.",
  failed: "The signing didn't go through. Please start again, or call us.",
  slow: "We're still waiting for the signing service to confirm. Please reload this page in a minute.",
  copy: "View your signed rental agreement",
};
