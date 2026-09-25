import React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

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

export default function Paid() {
  const { reservationNum } = useParams();
  const [params] = useSearchParams();
  const cancelled = params.get("cancelled") === "1";
  // b0.17 (CRM v6.12) - Book and pay returns with ?booked=1: this payment IS
  // the booking, so the page says so - and, backing out, that nothing is booked.
  const booked = params.get("booked") === "1";

  return (
    <div className="wrap">
      <div className="confirm">
        <h1>{cancelled ? "Nothing was charged" : booked ? "You're booked" : "Payment received"}</h1>

        {cancelled && booked ? (
          <p>
            You closed the payment page before finishing, so your card wasn't charged and
            nothing is booked. We're holding the dates for a few more minutes — go back to
            finish paying, or book again from the camper's page.
          </p>
        ) : booked ? (
          <p>
            Thanks — your payment has gone through and the camper is yours. We'll text you a
            confirmation shortly, and we'll be in touch before pick-up with everything you need.
          </p>
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

        {!cancelled ? (
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
