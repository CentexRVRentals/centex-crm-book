import React, { useEffect, useState } from "react";
import {
  quoteBooking, lineLabel, lineDetail, lineAmount, totalAmount, itemLines, cents, deliveryDestination,
  QUOTE_UNAVAILABLE, QUOTE_DEBOUNCE_MS,
} from "../lib/quote.js";

// b0.13 — the quote, shown. QuoteBox asks; QuoteLines words the answer and is
// also what /requested shows after a request goes through.

// Asks request-booking for `{ quote: true }` whenever what it depends on
// changes, once `ready` (the dates pass the same checkDates the calendar
// uses). Nothing is shown before that - a total for a range the server will
// refuse is a number that means nothing.
//
// STALE ANSWERS NEVER SHOW. Every answer is stored WITH the request it
// answered, and only an answer for the request on screen now is rendered; the
// call it replaced is also aborted. Without that, a slow answer for 2 nights
// could land after a fast one for 5 and sit there under the wrong dates.
// `inForm` drops the panel frame: inside the request form it would be a box
// in a box.
//
// b0.14 - `destination` is the delivery address as typed; it joins the request
// (and the key) only when it is complete and delivery is chosen, so typing a
// street does not re-ask on every letter.
export function QuoteBox({ unitId, dates, method, addons, destination = null, ready, inForm = false, debounceMs = QUOTE_DEBOUNCE_MS }) {
  const dest = method === "delivery" ? deliveryDestination(destination) : null;
  const key = JSON.stringify({ unitId, start: dates.start, end: dates.end, method, addons, destination: dest });
  const [answer, setAnswer] = useState({ key: null, result: null });
  // The last good quote, shown dimmed while a new one is on its way, so the
  // box does not flash empty on every tick of a quantity.
  const [lastQuote, setLastQuote] = useState(null);

  useEffect(() => {
    if (!ready) return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      let result;
      try {
        result = await quoteBooking(JSON.parse(key), { signal: ctrl.signal });
      } catch {
        // quoteBooking never throws by design; this is the belt to that brace,
        // because a throw here is an unhandled rejection in a timer.
        result = { ok: false, unavailable: true };
      }
      if (result.aborted || ctrl.signal.aborted) return;
      setAnswer({ key, result });
      if (result.ok) setLastQuote(result.quote);
    }, debounceMs);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [key, ready, debounceMs]);

  if (!ready) return null;
  const current = answer.key === key ? answer.result : null;

  return (
    <div className={inForm ? "quote in-form" : "panel quote"} aria-live="polite" aria-busy={current ? "false" : "true"}>
      <h3>Your total</h3>
      {!current ? (
        lastQuote ? (
          <div className="quote-stale">
            <QuoteLines quote={lastQuote} />
            <p className="card-meta" style={{ margin: "8px 0 0" }}>Updating…</p>
          </div>
        ) : (
          <p className="card-meta" style={{ margin: 0 }}>Working out your total…</p>
        )
      ) : current.ok ? (
        <QuoteLines quote={current.quote} />
      ) : current.errors ? (
        // SHOWN AS THE SERVER SENT THEM, like a request's refusal.
        <ul className="cal-errors" role="alert" style={{ marginTop: 0 }}>
          {current.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : (
        <p className="card-meta" style={{ margin: 0 }}>{QUOTE_UNAVAILABLE}</p>
      )}
    </div>
  );
}

// The lines and the total, exactly as the server priced them. The total is
// the server's totalCents - never a sum done here.
//
// b0.14 (Jesse, 09-24) - the items, then Subtotal / Tax / Total, all three the
// server's own numbers. The per-rate tax lines are not listed. With no tax at
// all there is nothing to split, so the Subtotal and a "$0" Tax are left out
// and only the Total shows.
export function QuoteLines({ quote }) {
  const taxed = quote.taxCents > 0;
  return (
    <ul className="specs quote-lines">
      {itemLines(quote).map((l, i) => {
        const detail = lineDetail(l);
        return (
          <li key={`${l.kind}-${l.addonId || ""}-${i}`} className={`q-${l.kind}`}>
            <span className="k">
              {lineLabel(l)}
              {detail ? <span className="q-detail">{detail}</span> : null}
            </span>
            <span>{lineAmount(l)}</span>
          </li>
        );
      })}
      {taxed ? (
        <li className="q-subtotal">
          <span className="k">Subtotal</span>
          {/* "from" belongs on the delivery line and the Total, where the
              guest reads it; saying it three times reads as a hedge. */}
          <span>{cents(quote.subtotalCents)}</span>
        </li>
      ) : null}
      {taxed ? (
        <li className="q-taxsum">
          <span className="k">Tax</span>
          <span>{cents(quote.taxCents)}</span>
        </li>
      ) : null}
      <li className="q-total">
        <span>Total</span>
        <strong>{totalAmount(quote)}</strong>
      </li>
    </ul>
  );
}
