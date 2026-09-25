import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestBooking, buildPayload } from "../lib/request.js";
import { checkDates, todayCentral } from "../lib/dates.js";
import { QuoteBox } from "./Quote.jsx";
import { suggestAddresses, suggestionsEnabled, SUGGEST_DEBOUNCE_MS } from "../lib/address.js";
import { ADDRESS_DEBOUNCE_MS, ADDRESS_INCOMPLETE, QUOTE_DEBOUNCE_MS, deliveryDestination } from "../lib/quote.js";

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

// b0.17 (CRM v6.12) - OR A BOOKING. The quote box says which path this camper
// is on for these dates. On "book" (outside its notice window, with payments
// on) the form is Book and pay: the server makes a short hold and the guest
// goes to the pay page to book by paying. The wording changes with it - this
// form never calls a request a booking, nor a booking a request. Until a quote
// says "book", it is a request: that is the safe thing to have said.
//
// b0.13 - `addons` is the guest's choices as the server wants them
// ([{ id, qty }], from addonsPayload on the camper page). The form sends them
// and shows the live total above the send button, priced for pickup or
// delivery as the box below is ticked.
export default function RequestForm({ listing, busy, dates, addons = [], initialPath = "request", onCancel }) {
  const nav = useNavigate();
  const [guest, setGuest] = useState({
    name: "", email: "", phone: "", guests: "", notes: "", company: "",
  });
  const [delivery, setDelivery] = useState({
    wanted: false, address: "", city: "", state: "", zip: "",
  });
  const [busyState, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  // Starts from what the camper page's quote said, then follows the form's
  // own quote box (delivery or an address can change nothing about the path
  // today, but the box is the one asking now).
  const [path, setPath] = useState(initialPath === "book" ? "book" : "request");
  const booking = path === "book";

  // b0.14 - address suggestions. Stored WITH the text they answer, so a list
  // for "285 Col" never shows under "285 Cold Spring Rd"; `picked` is the line
  // just chosen, so choosing one does not immediately ask again.
  const [suggest, setSuggest] = useState({ query: "", list: [] });
  const [picked, setPicked] = useState("");
  useEffect(() => {
    const q = delivery.address.trim();
    if (!delivery.wanted || !suggestionsEnabled() || q.length < 4 || q === picked) return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const list = await suggestAddresses(q, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setSuggest({ query: q, list });
    }, SUGGEST_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [delivery.wanted, delivery.address, picked]);
  const shownSuggestions = suggest.query === delivery.address.trim() && suggest.query !== picked ? suggest.list : [];
  function pickAddress(s) {
    setPicked(s.address);
    setDelivery((d) => ({ ...d, address: s.address, city: s.city, state: s.state, zip: s.zip }));
  }

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
      buildPayload({ unitId: listing.unitId, dates, guest, delivery, addons, book: booking })
    );
    setBusy(false);

    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    // b0.17 - booked by paying: straight to the pay page, which says how long
    // the dates are held. The token is the page's own credential.
    if (result.path === "book") {
      nav(`/pay/${encodeURIComponent(result.payToken)}`);
      return;
    }
    nav(`/requested/${encodeURIComponent(result.reservationNum)}`, {
      state: {
        camper: listing.name, start: dates.start, end: dates.end, duplicate: result.duplicate,
        // b0.13 - the quote the server SAVED with the hold, shown on /requested.
        quote: result.quote || null,
        // b0.17 - they pressed Book and pay, and today it is a request.
        switched: result.switched === true,
      },
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
    // b0.16 (CRM v6.09) - all four parts, the server's own rule and sentence:
    // a delivery is priced by the mile, and the miles need the whole address.
    if (delivery.wanted && !deliveryDestination(delivery)) out.push(ADDRESS_INCOMPLETE);
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
      <h3>{booking ? "Book these dates" : "Request these dates"}</h3>
      {booking ? (
        <p className="card-meta form-intro" style={{ marginTop: 0 }}>
          Pay to book — your booking is confirmed as soon as your payment goes through.
          We'll hold the dates for you while you pay.
        </p>
      ) : (
        <p className="card-meta form-intro" style={{ marginTop: 0 }}>
          This isn't a booking yet — we'll check the camper over and come back to you,
          usually within a day.
        </p>
      )}

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
                  <input
                    value={delivery.address}
                    onChange={setDel("address")}
                    autoComplete="street-address"
                    placeholder={suggestionsEnabled() ? "Start typing your address…" : undefined}
                  />
                </label>
                {/* b0.14 - suggestions. Buttons, so a tap and a keyboard both
                    choose; choosing fills all four boxes. */}
                {shownSuggestions.length ? (
                  <ul className="addr-suggest" aria-label="Suggested addresses">
                    {shownSuggestions.map((s) => (
                      <li key={s.label}>
                        <button type="button" onClick={() => pickAddress(s)}>{s.label}</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="row">
                  <label><span>City</span><input value={delivery.city} onChange={setDel("city")} autoComplete="address-level2" /></label>
                  <label style={{ maxWidth: 90 }}><span>State</span><input value={delivery.state} onChange={setDel("state")} autoComplete="address-level1" /></label>
                  <label style={{ maxWidth: 120 }}><span>ZIP</span><input value={delivery.zip} onChange={setDel("zip")} autoComplete="postal-code" inputMode="numeric" /></label>
                </div>
                {/* b0.16 - the quote box below prices delivery once all
                    four parts are filled in (the server measures the drive,
                    never this page), or says why it cannot. */}
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

      <QuoteBox
        unitId={listing.unitId}
        dates={dates}
        method={delivery.wanted ? "delivery" : "pickup"}
        addons={addons}
        destination={delivery}
        debounceMs={delivery.wanted ? ADDRESS_DEBOUNCE_MS : QUOTE_DEBOUNCE_MS}
        inForm
        onPath={setPath}
        ready={checkDates({
          start: dates.start, end: dates.end, busy,
          minimumNights: listing.minimumNights, today: todayCentral(),
        }).ok}
      />

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
          {booking ? (busyState ? "Holding your dates…" : "Book and pay") : (busyState ? "Sending…" : "Send request")}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={busyState}>Back</button>
      </div>
    </div>
  );
}
