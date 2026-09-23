import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loading, ErrorState } from "../components/States.jsx";
import { choosePayment, loadPayPage, payPageView } from "../lib/payments.js";
import { usePageMeta } from "../lib/meta.js";

// b0.12 — CHOOSE HOW TO PAY. /pay/:token, reached from the approval text.
//
// ============================================================================
// WHAT A GUEST SEES
// ============================================================================
// The trip, the total, and one to two choices, each saying what it costs now
// and what is left:
//
//   more than a week out   Reservation Deposit  -or-  Pay in Full
//   a week out or less     Pay in Full
//   deposit already paid   Balance
//
// plus the Refundable Security Deposit and its date, on every one. Every
// number and date comes from the CRM (payment-options `show`); this page only
// words them. The server's own refusals are shown as sent.
//
// ============================================================================
// NOT FOR SEARCH ENGINES, AND NOT FOR REFERRERS
// ============================================================================
// The token in the URL is a bearer credential for one booking's payment page.
// robots noindex keeps a link a guest pasted somewhere public out of search
// results; referrer no-referrer keeps the full URL off every request the page
// makes. Both are REMOVED on the way out: meta.js deliberately does not reset
// tags between pages, so leaving noindex behind would de-index the next page
// the guest navigates to in the same tab.

function usePrivatePage() {
  useEffect(() => {
    const added = [];
    for (const [name, content] of [["robots", "noindex, nofollow"], ["referrer", "no-referrer"]]) {
      const el = document.createElement("meta");
      el.setAttribute("name", name);
      el.setAttribute("content", content);
      el.setAttribute("data-pay-page", "");
      document.head.appendChild(el);
      added.push(el);
    }
    return () => added.forEach((el) => el.remove());
  }, []);
}

// `leave` is how the browser gets to Stripe. A prop only so the suite can see
// where it would have gone: jsdom's location cannot be spied on.
const toStripe = (url) => window.location.assign(url);

export default function Pay({ leave = toStripe }) {
  const { token } = useParams();
  usePageMeta({ title: "Choose how to pay | Centex RV Rentals", path: "/pay" });
  usePrivatePage();

  const [state, setState] = useState({ loading: true, error: "", page: null });
  const [picked, setPicked] = useState("");
  const [sending, setSending] = useState(false);
  const [chooseError, setChooseError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadPayPage(token).then((r) => {
      if (!live) return;
      if (!r.ok) return setState({ loading: false, error: r.error, page: null });
      setState({ loading: false, error: "", page: r.page });
      // One choice needs no choosing.
      const keys = (r.page.options || []).map((o) => o.key);
      setPicked(keys.length === 1 ? keys[0] : "");
    });
    return () => { live = false; };
  }, [token, attempt]);

  if (state.loading) return <div className="wrap"><Loading what="your booking" /></div>;
  if (state.error) {
    return (
      <div className="wrap">
        <ErrorState title="We couldn't open this payment page" detail={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  const view = payPageView(state.page);

  async function go() {
    if (!picked || sending) return;
    setSending(true);
    setChooseError("");
    const r = await choosePayment(token, picked);
    if (!r.ok) {
      setSending(false);
      setChooseError(r.error);
      return;
    }
    // STAYS "sending" ON PURPOSE. The browser is leaving for Stripe; a button
    // that re-enables in the meantime is a second session a tap away (the
    // server would cancel the first, but the guest should not see a flicker).
    leave(r.url);
  }

  return (
    <div className="wrap">
      <div className="confirm pay">
        <h1>Choose how to pay</h1>
        {view.trip ? <p className="card-meta">{view.trip}</p> : null}

        <div className="resnum">
          <span className="k">Your reference</span>
          <strong>{view.reservationNum}</strong>
        </div>

        <ul className="specs">
          <li><span className="k">Total</span><span>{view.total}</span></li>
          {view.paid ? <li><span className="k">Paid so far</span><span>{view.paid}</span></li> : null}
        </ul>

        <fieldset className="choices" disabled={sending}>
          <legend className="sr">How would you like to pay?</legend>
          {view.choices.map((c) => (
            <label key={c.key} className={`choice${picked === c.key ? " on" : ""}`}>
              <input type="radio" name="option" value={c.key} checked={picked === c.key} onChange={() => setPicked(c.key)} />
              <span className="choice-body">
                <span className="choice-head"><strong>{c.title}</strong><span className="choice-amt">{c.amount}</span></span>
                <span className="card-meta">{c.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {view.security ? <p className="card-meta security">{view.security}</p> : null}

        {chooseError ? <p className="cal-errors" role="alert">{chooseError}</p> : null}

        <div className="actions">
          <button className="btn" onClick={go} disabled={!picked || sending}>
            {sending ? "Opening secure checkout…" : "Continue to payment"}
          </button>
        </div>
        <p className="card-meta">
          You'll pay on Stripe's secure checkout. We never see or store your card number.
        </p>
        <p className="card-meta">
          Questions first? Call us and quote your reference. <Link to="/">See the campers</Link>
        </p>
      </div>
    </div>
  );
}
