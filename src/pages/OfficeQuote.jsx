import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loading, ErrorState } from "../components/States.jsx";
import { ACCEPTED_NOT_PAID, NOT_HELD_YET, PAY_BY_TEXT, acceptOfficeQuote, loadOfficeQuote, officeQuoteView } from "../lib/officeQuote.js";
import { usePageMeta } from "../lib/meta.js";

// b0.18 (CRM v6.20) — YOUR QUOTE. /quote/:token, reached from the Quote Text
// the office sends a guest who called and asked for a price.
//
// The trip, what it costs, and one button: Accept and pay. The office's quote
// is the approval, so accepting sends the guest straight to the pay page - but
// it is the PAYMENT that books it (Jesse, 09-26). The page says plainly that
// the dates are NOT held until then, because they are not.
//
//   not accepted      the quote, and Accept and pay
//   accepted, unpaid  "not booked until you pay", and the way to the pay page
//                     (or, with online payment off, that we'll text how)
//   paid              "You're booked"
//
// NOT FOR SEARCH ENGINES, AND NOT FOR REFERRERS - the pay page's reasons: the
// token in the URL is a bearer credential for one booking. Both tags are
// removed on the way out (meta.js does not reset between pages).

function usePrivatePage() {
  useEffect(() => {
    const added = [];
    for (const [name, content] of [["robots", "noindex, nofollow"], ["referrer", "no-referrer"]]) {
      const el = document.createElement("meta");
      el.setAttribute("name", name);
      el.setAttribute("content", content);
      el.setAttribute("data-quote-page", "");
      document.head.appendChild(el);
      added.push(el);
    }
    return () => added.forEach((el) => el.remove());
  }, []);
}

export default function OfficeQuote() {
  const { token } = useParams();
  const navigate = useNavigate();
  usePageMeta({ title: "Your quote | Centex RV Rentals", path: "/quote" });
  usePrivatePage();

  const [state, setState] = useState({ loading: true, error: "", expired: false, page: null });
  const [attempt, setAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const [acceptedNow, setAcceptedNow] = useState(null);

  useEffect(() => {
    let live = true;
    loadOfficeQuote(token).then((r) => {
      if (!live) return;
      if (!r.ok) return setState({ loading: false, error: r.error, expired: r.expired === true, page: null });
      setState({ loading: false, error: "", expired: false, page: r.page });
    });
    return () => { live = false; };
  }, [token, attempt]);

  if (state.loading) return <div className="wrap"><Loading what="your quote" /></div>;
  if (state.error) {
    return (
      <div className="wrap">
        <ErrorState
          title={state.expired ? "This quote has expired" : "We couldn't open this quote"}
          detail={state.error}
          onRetry={state.expired ? undefined : () => setAttempt((n) => n + 1)}
        />
      </div>
    );
  }

  const view = officeQuoteView(state.page);

  async function accept() {
    if (accepting) return;
    setAccepting(true);
    setAcceptError("");
    const r = await acceptOfficeQuote(token);
    if (!r.ok) {
      setAccepting(false);
      setAcceptError(r.error);
      return;
    }
    // Accepted. Straight on to paying, when there is a pay page to go to.
    if (r.payPath) return navigate(r.payPath);
    setAcceptedNow(r);
  }

  if (view.paid) {
    return (
      <div className="wrap">
        <div className="confirm">
          <h1>You're booked</h1>
          {view.trip ? <p className="card-meta">{view.trip}</p> : null}
          <div className="resnum">
            <span className="k">Your reference</span>
            <strong>{view.reservationNum}</strong>
          </div>
          <p className="card-meta">Questions? Call us and quote your reference.</p>
        </div>
      </div>
    );
  }

  // Accepted and not paid - on a second visit, or just now with online
  // payment off: the page says so rather than offering Accept again.
  if (acceptedNow || view.accepted) {
    // Just accepted here means no pay page came back (payments off); the
    // page as loaded before Accept carries no pay token either.
    const payPath = view.payPath;
    return (
      <div className="wrap">
        <div className="confirm">
          <h1>{payPath ? "Pay to book" : "Quote accepted"}</h1>
          {view.trip ? <p className="card-meta">{view.trip}</p> : null}
          <div className="resnum">
            <span className="k">Your reference</span>
            <strong>{view.reservationNum}</strong>
          </div>
          <p className="hold-line" role="note">{payPath ? ACCEPTED_NOT_PAID : PAY_BY_TEXT}</p>
          {payPath ? <div className="actions"><Link className="btn" to={payPath}>Choose how to pay</Link></div> : null}
          <p className="card-meta">Questions? Call us and quote your reference.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="confirm quote-page">
        <h1>Your quote</h1>
        {view.trip ? <p className="card-meta">{view.trip}</p> : null}
        <p className="card-meta">{view.how}</p>

        <div className="resnum">
          <span className="k">Your reference</span>
          <strong>{view.reservationNum}</strong>
        </div>

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
        </ul>

        <p className="hold-line" role="note">{NOT_HELD_YET}</p>

        {acceptError ? <p className="cal-errors" role="alert">{acceptError}</p> : null}

        <div className="actions">
          <button className="btn" onClick={accept} disabled={accepting}>
            {accepting ? "One moment…" : "Accept and pay"}
          </button>
        </div>
        <p className="card-meta">
          Next you'll choose how to pay. Once your payment goes through, the dates are yours at this price.
        </p>
        <p className="card-meta">
          Questions first? Call us and quote your reference. <Link to="/">See the campers</Link>
        </p>
      </div>
    </div>
  );
}
