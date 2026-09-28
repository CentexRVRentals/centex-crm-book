import React, { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Loading, ErrorState } from "../components/States.jsx";
import { choosePayment, loadPayPage, payPageView } from "../lib/payments.js";
import { usePageMeta } from "../lib/meta.js";
import { AGREEMENT_WORDS, loadAgreement } from "../lib/agreement.js";
import AgreementStep, { SignedCopyLink } from "../components/AgreementStep.jsx";

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

// b0.26 - exported: /sign carries the same token and needs the same care.
export function usePrivatePage() {
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

// b0.25 (CRM v6.40) - AFTER SIGNING, BoldSign sends its window to this page
// with ?signed=1 - INSIDE the window. That copy of the page says so and tells
// the page around it (same origin), which then asks the CRM whether it is
// signed; it shows nothing else, so the guest never sees a pay page in a pay page.
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };

export default function Pay({ leave = toStripe }) {
  const { token } = useParams();
  const [params] = useSearchParams();
  usePageMeta({ title: "Choose how to pay | Centex RV Rentals", path: "/pay" });
  usePrivatePage();
  const signedInFrame = params.get("signed") === "1" && inFrame();
  useEffect(() => {
    if (signedInFrame) window.parent.postMessage({ action: "centexSigned" }, window.location.origin);
  }, [signedInFrame]);
  // b0.25 - the rental agreement (lib/agreement.js). null until asked.
  const [agreement, setAgreement] = useState(null);
  const [justSigned, setJustSigned] = useState(null);

  const [state, setState] = useState({ loading: true, error: "", page: null });
  const [picked, setPicked] = useState("");
  const [sending, setSending] = useState(false);
  const [chooseError, setChooseError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (signedInFrame) return undefined;
    loadAgreement(token).then((a) => { if (live) setAgreement(a); });
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

  if (signedInFrame) {
    return <div className="wrap"><p className="confirming" aria-live="polite">{AGREEMENT_WORDS.checking}</p></div>;
  }
  if (state.loading || agreement === null) return <div className="wrap"><Loading what="your booking" /></div>;
  if (state.error) {
    return (
      <div className="wrap">
        <ErrorState title="We couldn't open this payment page" detail={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  const view = payPageView(state.page);
  // b0.25 put the step first and held the choices back until signed.
  // b0.26 (CRM v6.41, Jesse) - SIGNED AFTER THE PAYMENT: nothing here stops a
  // guest paying. The step shows only once something is paid (`paid`), above
  // the choices, which stay - a guest paying their balance is not held up.
  const mustSign = agreement.needed && agreement.paid && !agreement.signed && !justSigned;
  const signed = agreement.signed || Boolean(justSigned);
  const hasCopy = justSigned ? justSigned.hasCopy : agreement.hasCopy;

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
        {/* b0.17 (CRM v6.12) - a Book-and-pay guest pays to book; the dates
            are theirs only while the hold lasts, and the page says until when. */}
        <h1>{view.hold ? "Pay to book" : "Choose how to pay"}</h1>
        {view.trip ? <p className="card-meta">{view.trip}</p> : null}
        {view.hold ? <p className="hold-line" role="status">{view.hold}</p> : null}

        <div className="resnum">
          <span className="k">Your reference</span>
          <strong>{view.reservationNum}</strong>
        </div>

        {/* b0.16 (CRM v6.09) - what the total is made of, the same items the
            guest was quoted on the camper page. Only for a website booking;
            an office or OTA booking shows the Total alone, as before. */}
        <ul className={view.items.length ? "specs quote-lines pay-items" : "specs"}>
          {view.items.map((l) => (
            <li key={l.key} className={`q-${l.kind}`}>
              <span className="k">
                {l.label}
                {l.detail ? <span className="q-detail">{l.detail}</span> : null}
              </span>
              <span>{l.amount}</span>
            </li>
          ))}
          {view.subtotal ? <li className="q-subtotal"><span className="k">Subtotal</span><span>{view.subtotal}</span></li> : null}
          {view.tax ? <li className="q-taxsum"><span className="k">Tax</span><span>{view.tax}</span></li> : null}
          <li className={view.items.length ? "q-total" : undefined}><span className="k">Total</span><span>{view.total}</span></li>
          {view.paid ? <li><span className="k">Paid so far</span><span>{view.paid}</span></li> : null}
        </ul>

        {mustSign ? (
          <AgreementStep token={token} agreement={agreement} onSigned={(r) => setJustSigned(r)} after />
        ) : null}
        {signed ? (
          <p className="agreement-signed" role="status">
            <strong>✓ {AGREEMENT_WORDS.signed}</strong>
            {hasCopy ? <> · <SignedCopyLink token={token} /></> : null}
          </p>
        ) : null}

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
