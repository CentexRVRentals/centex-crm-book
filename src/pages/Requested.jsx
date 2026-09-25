import React from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { QuoteLines } from "../components/Quote.jsx";

// After a request lands. Its own URL so it survives a refresh and can be sent
// to somebody — a confirmation that vanishes on reload is a confirmation the
// guest cannot show anyone.
//
// The camper and the dates come through router state, which is LOST on a
// refresh. That is fine and is why the reservation number is the thing in the
// URL: it is the part that matters, and the page reads sensibly without the
// rest.

export default function Requested() {
  const { reservationNum } = useParams();
  const { state } = useLocation();

  return (
    <div className="wrap">
      <div className="confirm">
        <h1>Request sent</h1>

        {/* THE WORDING IS DELIBERATE. Not "booked", not "confirmed". A guest
            who believes they have a camper and turns up is a worse outcome
            than one who is unsure, so this says what actually happened in
            three different ways. */}
        <p>
          We've got it. Nothing is booked yet — we'll check the camper over and come
          back to you, usually within a day.
        </p>

        <div className="resnum">
          <span className="k">Your reference</span>
          <strong>{reservationNum}</strong>
        </div>

        {state?.camper ? (
          <p className="card-meta">
            {state.camper}{state.start && state.end ? ` · ${state.start} to ${state.end}` : ""}
          </p>
        ) : null}

        {/* b0.13 - the quote the server saved with this request. Only in
            router state: after a refresh it is gone, and the page reads
            correctly without it. NOT "your price" - the office still approves
            the request. (b0.16: delivery on it is priced by the mile; there
            are no minimums any more.) */}
        {state?.quote?.lines?.length ? (
          <div className="panel" style={{ textAlign: "left", marginTop: 16 }}>
            <h3>What we quoted</h3>
            <QuoteLines quote={state.quote} />
            <p className="card-meta" style={{ margin: "8px 0 0" }}>
              We'll confirm the price when we come back to you. Nothing has been charged.
            </p>
          </div>
        ) : null}

        {/* b0.17 (CRM v6.12) - they pressed Book and pay, and by the time it
            reached us the start was inside the camper's notice window, so it
            is a request. Said plainly: they did not book, and were not charged. */}
        {state?.switched ? (
          <p className="card-meta switched">
            Your dates are now close enough that we need to check this one over ourselves,
            so it's a request rather than a booking. Nothing has been charged.
          </p>
        ) : null}

        {state?.duplicate ? (
          // The server is idempotent: an identical repost returns the FIRST
          // reservation number rather than making a second hold. Said plainly,
          // because a guest who tapped twice needs to know they have one
          // request and not two.
          <p className="card-meta">
            You'd already sent this one — it's the same request, not a second one.
          </p>
        ) : null}

        <p className="card-meta">
          Quote a reference number if you call us. We hold these dates for you in the
          meantime, so nobody else can take them while we're looking.
        </p>

        <Link className="btn" to="/">Back to the campers</Link>
      </div>
    </div>
  );
}
