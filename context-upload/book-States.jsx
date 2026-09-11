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
  // Deliberately offers the way out rather than only stating the problem. A
  // guest who followed a stale link is one click from the fleet; a dead end
  // is a lost booking.
  //
  // NOT A REAL 404 STATUS. Netlify serves index.html with a 200 for every path
  // so the router can handle it — that is what public/_redirects does, and it
  // is what makes /camper/:id work on a refresh. A crawler therefore sees 200
  // here. Acceptable while the site is noindex; worth revisiting at swap-over
  // if stale links to removed campers ever become a real problem.
  const isPage = what === "page";
  return (
    <div className="state">
      <h2>{isPage ? "That page isn't here" : `We couldn't find that ${what}`}</h2>
      <p>
        {isPage
          ? "The link may be out of date."
          : "It may have been taken off the site, or booked and retired."}
      </p>
      <Link className="btn" to="/">See what's available</Link>
      <p className="card-meta" style={{ marginTop: 18 }}>
        Or call us — we know the fleet better than the website does.
      </p>
    </div>
  );
}

export function Header() {
  // VERSION AND BUILD TIME, ON EVERY PAGE.
  //
  // Added because a screenshot of the deployed site could not be told apart
  // from a screenshot of the previous release — a missing button read as a bug
  // when it was simply an older bundle. Both numbers are injected from
  // package.json and the build clock by vite.config.js; neither is written
  // down anywhere a person could forget to update.
  //
  // The build time is what tells you the DEPLOY happened. Two builds of the
  // same version look identical, and one of them might be the one still in
  // Netlify's cache.
  return (
    <header className="site-head">
      <div className="wrap">
        <h1><Link to="/">Centex RV Rentals</Link></h1>
        <span className="tag">Kyle, TX</span>
        <span className="ver" title={`built ${__BUILD_TIME__} UTC`}>
          b{__APP_VERSION__}
        </span>
      </div>
    </header>
  );
}
