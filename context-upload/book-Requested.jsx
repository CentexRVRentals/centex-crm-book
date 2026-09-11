import React from "react";
import { Link, useParams, useLocation } from "react-router-dom";

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
