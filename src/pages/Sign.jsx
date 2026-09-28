import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loading } from "../components/States.jsx";
import { usePageMeta } from "../lib/meta.js";
import { AGREEMENT_WORDS as W, loadAgreement } from "../lib/agreement.js";
import AgreementStep, { SignedCopyLink } from "../components/AgreementStep.jsx";
import { usePrivatePage } from "./Pay.jsx";

// b0.26 (CRM v6.41, Jesse 09-27) - /sign/:token, THE SIGNING REMINDER'S PAGE.
//
// A guest who paid and has not signed the rental agreement gets the office's
// Signing Reminder Text ("Send signing reminder" on the booking), and its link
// lands here: the trip, the signing step, and once signed the tick and their
// copy. Nothing about payment - a guest who has paid in full has no pay page
// to go back to, which is why this is its own page and not /pay.
//
// The token is the pay page's own (the CRM's _shared/sign-link.ts), the
// credential the agreement function already reads, so this page is the same
// kind of private page as /pay: noindex, no referrer (usePrivatePage).
//
// Everything it shows comes from the agreement function's `show`; a token that
// does not verify, or a booking with nothing to sign, is said plainly.
export default function Sign() {
  const { token } = useParams();
  usePageMeta({ title: "Sign your rental agreement | Centex RV Rentals", path: "/sign" });
  usePrivatePage();
  const [agreement, setAgreement] = useState(null);
  const [justSigned, setJustSigned] = useState(null);

  useEffect(() => {
    let live = true;
    loadAgreement(token).then((a) => { if (live) setAgreement(a); });
    return () => { live = false; };
  }, [token]);

  if (agreement === null) return <div className="wrap"><Loading what="your rental agreement" /></div>;

  const signed = agreement.ok && (agreement.signed || Boolean(justSigned));
  const hasCopy = justSigned ? justSigned.hasCopy : agreement.hasCopy;
  const trip = agreement.trip;

  return (
    <div className="wrap">
      <div className="confirm pay">
        <h1>{W.signTitle}</h1>
        {trip ? (
          <>
            <p className="card-meta">{[trip.unitName, tripDates(trip)].filter(Boolean).join(" · ")}</p>
            <div className="resnum">
              <span className="k">Your reference</span>
              <strong>{trip.reservationNum}</strong>
            </div>
          </>
        ) : null}

        {!agreement.ok ? (
          // A token that no longer verifies (401 bad, 410 past the trip) is
          // the reminder's link gone stale: said as that, not as a pay link.
          <p className="cal-errors" role="alert">{[400, 401, 410].includes(agreement.status) ? W.badLink : agreement.error || W.badLink}</p>
        ) : signed ? (
          <p className="agreement-signed" role="status">
            <strong>✓ {W.signed}</strong>
            {hasCopy ? <> · <SignedCopyLink token={token} /></> : null}
          </p>
        ) : agreement.needed ? (
          <AgreementStep token={token} agreement={agreement} onSigned={(r) => setJustSigned(r)} />
        ) : (
          <p className="card-meta">{W.nothingToSign}</p>
        )}

        <p className="card-meta">
          Questions? Call us and quote your reference. <Link to="/">See the campers</Link>
        </p>
      </div>
    </div>
  );
}

// "Jan 12 – Jan 14", in the site's own short style; blank if a date is odd.
function tripDates(trip) {
  const fmt = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const a = fmt(trip.start);
  const b = fmt(trip.end);
  return a && b ? `${a} – ${b}` : "";
}
