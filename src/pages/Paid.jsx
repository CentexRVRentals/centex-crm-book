import React, { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { checkOutcome } from "../lib/payments.js";

// Where Stripe sends the guest back to. Its own URL, for the same reason
// Requested has one: a confirmation that vanishes on reload is a confirmation
// the guest cannot show anyone.
//
// ============================================================================
// IT LOOKS NOTHING UP, AND THAT IS THE POINT
// ============================================================================
// The obvious version reads the payment row and reports its status. Two
// reasons not to, and the first is the serious one.
//
// THE WEBHOOK IS ASYNC. Stripe redirects the browser the instant the payment
// succeeds and delivers checkout.session.completed separately, over its own
// connection, whenever it gets there. Those race, and the browser usually wins.
// A page that reads the row would tell a guest who has JUST PAID that their
// payment is pending — which is the one thing it must never say.
//
// IT WOULD ALSO NEED A NEW ANON SURFACE. Reading a payment by reservation
// number means a sixth anon-reachable view, keyed on a string of the shape
// WEB-260911-PAV7. That is roughly a million combinations, which is not a
// secret; it is a speed bump. Publishing who has paid what, behind a speed
// bump, for a page that does not need it.
//
// Stripe only sends a guest to success_url AFTER the payment succeeded, so the
// redirect itself is the evidence. The page says what that supports and stops.
//
// ============================================================================
// ?cancelled=1 IS THE SAME ROUTE
// ============================================================================
// Stripe requires a cancel_url, and v4.00 pointed it at this same page — so a
// guest who backed out of checkout landed on a page thanking them for paying.
// It now carries ?cancelled=1 and this page reads it.
//
// One route rather than two, because the guest needs the same things either
// way: their reference, a way back, and no claim that is not true.
//
// ============================================================================
// b0.20 (CRM v6.26) - A BOOK-AND-PAY GUEST IS NOT TOLD THEY ARE BOOKED UNTIL
// THEY ARE (Jesse, 09-26)
// ============================================================================
// Everything above still holds for an approved guest paying a deposit or a
// balance: the redirect is the evidence, and the page looks nothing up.
//
// It does NOT hold for Book and pay any more. That guest's card is only put
// on hold when they pay; the server then books the camper and charges the
// card, or lets the hold go if the dates were taken (or it could not confirm).
// So Stripe's return is no longer evidence of a booking, and this page asks -
// with the guest's own signed pay token (`t`, added to the return address by
// the CRM), the credential the pay page already uses, so no new anon surface:
//   Confirming your booking...  ->  You're booked
//                               ->  Those dates were just taken - not charged
//                               ->  We couldn't confirm it - not charged, try again in 30 minutes
// A return with ?booked=1 and no token (a page opened before this release)
// says the payment was received and that a text will confirm the booking -
// never "you're booked" on a guess.
export const POLL_MS = 2500;
export const POLL_LIMIT = 36;

function useOutcome(token, active) {
  const [state, setState] = useState(active ? "confirming" : "");
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let tries = 0;
    let timer = null;
    const ask = async () => {
      tries += 1;
      const r = await checkOutcome(token);
      if (stopped) return;
      const outcome = r.ok ? r.outcome : "confirming";
      if (outcome !== "confirming") { setState(outcome); return; }
      if (tries >= POLL_LIMIT) { setState("slow"); return; }
      timer = setTimeout(ask, POLL_MS);
    };
    ask();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [token, active]);
  return state;
}

// What the page says for each answer. Pure, so the words are tested.
export const OUTCOME_WORDS = {
  confirming: { h1: "Confirming your booking…", p: "This only takes a few seconds. Please keep this page open." },
  booked: { h1: "You're booked", p: "Thanks — your payment has gone through and the camper is yours. We'll text you a confirmation shortly, and we'll be in touch before pick-up with everything you need." },
  taken: { h1: "Those dates were just taken", p: "Your card was not charged. Someone booked these dates moments before you did. Please pick other dates, or call us and we'll help you find another camper." },
  retry: { h1: "We couldn't confirm your booking", p: "Your card was not charged. Please try again in 30 minutes, or call us and we'll book it for you." },
  slow: { h1: "Still confirming your booking", p: "We haven't heard back yet. We'll text you shortly to say whether you're booked — your card is only charged once the booking is confirmed." },
  untracked: { h1: "Payment received", p: "Thanks — we're confirming your booking now. We'll text you in a moment to say it's booked." },
};

export default function Paid() {
  const { reservationNum } = useParams();
  const [params] = useSearchParams();
  const cancelled = params.get("cancelled") === "1";
  // b0.17 (CRM v6.12) - Book and pay returns with ?booked=1: this payment IS
  // the booking, so the page says so - and, backing out, that nothing is booked.
  const booked = params.get("booked") === "1";
  const token = params.get("t") || "";
  const outcome = useOutcome(token, booked && !cancelled && Boolean(token));
  const words = booked && !cancelled ? OUTCOME_WORDS[token ? outcome : "untracked"] : null;

  return (
    <div className="wrap">
      <div className="confirm">
        <h1>{cancelled ? "Nothing was charged" : words ? words.h1 : "Payment received"}</h1>

        {cancelled && booked ? (
          <p>
            You closed the payment page before finishing, so your card wasn't charged and
            nothing is booked. We're holding the dates for a few more minutes — go back to
            finish paying, or book again from the camper's page.
          </p>
        ) : words ? (
          <p className={outcome === "confirming" ? "confirming" : undefined} aria-live="polite">{words.p}</p>
        ) : cancelled ? (
          // NOT AN ERROR, AND NOT PHRASED AS ONE. Backing out of a checkout is
          // a normal thing to do, and a guest who reads this as a failure will
          // either try again immediately or call. Neither is necessary: the
          // link is still good.
          <p>
            You closed the payment page before finishing, so your card wasn't charged.
            Your dates are still held — the payment link in your text still works.
          </p>
        ) : (
          <p>
            Thanks — that's gone through. We'll text you a confirmation shortly, and
            we'll be in touch again before pick-up with everything you need.
          </p>
        )}

        <div className="resnum">
          <span className="k">Your reference</span>
          <strong>{reservationNum}</strong>
        </div>

        {!cancelled && (!words || outcome === "booked") ? (
          // The receipt comes from Stripe, not from us, and it arrives by
          // email. Said here so a guest who does not see one from Centex does
          // not assume the payment did not land.
          <p className="card-meta">
            Stripe emails your receipt. If your booking still shows a balance, that's
            the rest of it — we'll send a link for that closer to your dates.
          </p>
        ) : null}

        <p className="card-meta">
          Quote your reference if you call us.
        </p>

        <Link className="btn" to="/">Back to the campers</Link>
      </div>
    </div>
  );
}
