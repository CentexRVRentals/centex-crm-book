import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestBooking, buildPayload } from "../lib/request.js";
import { checkDates, todayCentral } from "../lib/dates.js";

// The request form. Name, contact, delivery if wanted, submit.
//
// NOT A BOOKING. Every submission creates a `held` booking that the office
// approves or declines. The wording says so in three places, because a guest
// who believes they have booked a camper and turns up is a worse outcome than
// one who is unsure.
//
// THE DATES ARE ALREADY CHOSEN. The calendar prevents an invalid range, so by
// the time this renders the dates are known good — but they are RE-CHECKED on
// submit anyway. The page may have been open for an hour, and the week may
// have gone in that hour. The server checks too; this is so the guest hears it
// from the page rather than from a refusal.

export default function RequestForm({ listing, busy, dates, onCancel }) {
  const nav = useNavigate();
  const [guest, setGuest] = useState({
    name: "", email: "", phone: "", guests: "", notes: "", company: "",
  });
  const [delivery, setDelivery] = useState({
    wanted: false, address: "", city: "", state: "", zip: "",
  });
  const [busyState, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  const set = (k) => (e) => setGuest((g) => ({ ...g, [k]: e.target.value }));
  const setDel = (k) => (e) => setDelivery((d) => ({ ...d, [k]: e.target.value }));

  async function submit() {
    // GUARDS THE DOUBLE TAP. The server is idempotent for an identical repost
    // — it returns the first reservation number rather than making a second
    // hold — but a disabled button is what stops the guest wondering whether
    // the first tap worked.
    if (busyState) return;

    const local = localCheck();
    if (local.length) {
      setErrors(local);
      return;
    }

    setBusy(true);
    setErrors([]);
    const result = await requestBooking(
      buildPayload({ unitId: listing.unitId, dates, guest, delivery })
    );
    setBusy(false);

    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    nav(`/requested/${encodeURIComponent(result.reservationNum)}`, {
      state: { camper: listing.name, start: dates.start, end: dates.end, duplicate: result.duplicate },
    });
  }

  // Client-side checks, kept deliberately thin. Everything the SERVER decides
  // is left to the server — this catches the three things a guest can see for
  // themselves, so the page does not go quiet for a round trip to say
  // "please give us a name".
  function localCheck() {
    const out = [];
    if (guest.name.trim().length < 2) out.push("Please give us a name we can put on the reservation.");
    if (!guest.email.trim() && !guest.phone.trim()) out.push("Please give us an email address or a phone number.");
    if (delivery.wanted && delivery.address.trim().length < 5) out.push("Please give us the delivery address.");
    // The dates were valid when they were picked. Re-checked because the page
    // may have been open a while.
    const d = checkDates({
      start: dates.start, end: dates.end, busy,
      minimumNights: listing.minimumNights, today: todayCentral(),
    });
    if (!d.ok) out.push(...d.errors);
    return out;
  }

  return (
    <div className="panel">
      <h3>Request these dates</h3>
      <p className="card-meta" style={{ marginTop: 0 }}>
        This isn't a booking yet — we'll check the camper over and come back to you,
        usually within a day.
      </p>

      <div className="form">
        <label>
          <span>Your name</span>
          <input value={guest.name} onChange={set("name")} autoComplete="name" />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={guest.email} onChange={set("email")} autoComplete="email" inputMode="email" />
        </label>
        <label>
          <span>Phone</span>
          <input type="tel" value={guest.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" />
        </label>
        <p className="card-meta" style={{ margin: "-4px 0 4px" }}>Either one is enough.</p>

        <label>
          <span>How many of you?</span>
          <input type="number" min="1" max="20" value={guest.guests} onChange={set("guests")} inputMode="numeric" />
        </label>

        {listing.deliveryDollarMile ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={delivery.wanted}
                onChange={(e) => setDelivery((d) => ({ ...d, wanted: e.target.checked }))}
              />
              <span>
                Deliver it to me
                {listing.deliveryMilesMax ? ` (within ${listing.deliveryMilesMax} miles)` : ""}
              </span>
            </label>
            {delivery.wanted ? (
              <>
                <label>
                  <span>Delivery address</span>
                  <input value={delivery.address} onChange={setDel("address")} autoComplete="street-address" />
                </label>
                <div className="row">
                  <label><span>City</span><input value={delivery.city} onChange={setDel("city")} autoComplete="address-level2" /></label>
                  <label style={{ maxWidth: 90 }}><span>State</span><input value={delivery.state} onChange={setDel("state")} autoComplete="address-level1" /></label>
                  <label style={{ maxWidth: 120 }}><span>ZIP</span><input value={delivery.zip} onChange={setDel("zip")} autoComplete="postal-code" inputMode="numeric" /></label>
                </div>
                {/* NOT QUOTED HERE, deliberately. The office works the fee out
                    at approval; a distance calculation on a public page would
                    be a second opinion about money. */}
                <p className="card-meta" style={{ marginTop: -4 }}>
                  We'll work out the delivery fee and include it when we come back to you.
                </p>
              </>
            ) : null}
          </>
        ) : null}

        <label>
          <span>Anything we should know?</span>
          <textarea rows="3" value={guest.notes} onChange={set("notes")} />
        </label>

        {/* THE HONEYPOT. A human never sees this and never fills it; most bots
            fill every input they find. The server answers a filled one with a
            plausible success and writes nothing, so a bot moves on rather than
            retrying with a different payload.

            Hidden with CSS, not `type="hidden"` — a hidden input is the one
            thing a bot knows to leave alone. aria-hidden and tabIndex keep it
            away from screen readers and the tab order. */}
        <div className="hp" aria-hidden="true">
          <label>
            <span>Company</span>
            <input value={guest.company} onChange={set("company")} tabIndex={-1} autoComplete="off" />
          </label>
        </div>
      </div>

      {errors.length ? (
        <ul className="cal-errors" role="alert" style={{ marginTop: 12 }}>
          {/* SHOWN AS THE SERVER SENT THEM. Those sentences were written to be
              read by a guest; paraphrasing them here would mean two different
              reasons exist for one refusal. */}
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}

      <div className="actions">
        <button className="btn" onClick={submit} disabled={busyState}>
          {busyState ? "Sending…" : "Send request"}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={busyState}>Back</button>
      </div>
    </div>
  );
}
