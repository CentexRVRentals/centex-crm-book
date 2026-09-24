import React, { useEffect, useState } from "react";
import {
  quoteBooking, lineLabel, lineDetail, lineAmount, totalAmount, QUOTE_UNAVAILABLE, QUOTE_DEBOUNCE_MS,
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
export function QuoteBox({ unitId, dates, method, addons, ready, inForm = false, debounceMs = QUOTE_DEBOUNCE_MS }) {
  const key = JSON.stringify({ unitId, start: dates.start, end: dates.end, method, addons });
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
export function QuoteLines({ quote }) {
  return (
    <ul className="specs quote-lines">
      {quote.lines.map((l, i) => {
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
      <li className="q-total">
        <span>Total</span>
        <strong>{totalAmount(quote)}</strong>
      </li>
    </ul>
  );
}
