import React from "react";
import { Link } from "react-router-dom";

// Loading, empty and error, in one place.
//
// WHY ERROR TAKES A `detail`. The CRM spent an afternoon on a save that said
// "Couldn't save that task." and nothing else, because the handler threw the
// reason away. The lesson stuck: a message that names no cause is
// indistinguishable from a broken button.
//
// A GUEST still sees a sentence they can act on. The detail is rendered small
// and monospaced underneath — enough for you to diagnose from a screenshot,
// ignorable by everyone else. It is never the database's raw error text: those
// can name columns, and a stranger should not learn the schema from a bad day.

export function Loading({ what = "campers" }) {
  return (
    <div className="state" role="status" aria-live="polite">
      Loading {what}…
    </div>
  );
}

export function ErrorState({ title = "We couldn't load that", detail, onRetry }) {
  return (
    <div className="state" role="alert">
      <h2>{title}</h2>
      <p>
        Give it another go — and if it keeps happening, call us and we'll book you in
        the old-fashioned way.
      </p>
      {detail ? <div className="why">{detail}</div> : null}
      {onRetry ? (
        <div>
          <button className="btn" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}

export function NotFound({ what = "camper" }) {
  return (
    <div className="state">
      <h2>We couldn't find that {what}</h2>
      <p>It may have been taken off the site.</p>
      <Link className="btn" to="/">See what's available</Link>
    </div>
  );
}

export function Header() {
  return (
    <header className="site-head">
      <div className="wrap">
        <h1><Link to="/">Centex RV Rentals</Link></h1>
        <span className="tag">Kyle, TX</span>
      </div>
    </header>
  );
}
