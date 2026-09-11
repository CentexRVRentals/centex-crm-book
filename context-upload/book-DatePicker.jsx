import React, { useMemo, useState } from "react";
import {
  monthGrid, MONTH_NAMES, busyDaySet, todayCentral,
  addDays, nightsBetween, checkDates, estimate,
} from "../lib/dates.js";
import { money } from "../lib/listings.js";

// The calendar. Busy days are not clickable, so a guest cannot pick a week
// that will be refused — which is the whole reason this repo implements the
// date rules at all rather than letting the server say no after the fact.
//
// TWO CLICKS: first sets the pick-up, second sets the return. A third starts
// over. No drag, no range widget — on a phone, two taps beats a drag every
// time, and this will mostly be used on a phone.

export default function DatePicker({ listing, busy, value, onChange }) {
  const today = todayCentral();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  // Recomputed only when the ranges change. Expanding every busy range into
  // individual days on every render would be work per keystroke for a set that
  // changes once per page load.
  const busyDays = useMemo(() => busyDaySet(busy), [busy]);

  const { start, end } = value;
  const verdict = start && end
    ? checkDates({ start, end, busy, minimumNights: listing.minimumNights, today })
    : null;
  const quote = verdict?.ok ? estimate({ ...listing, nights: verdict.nights }) : null;

  function pick(iso) {
    if (busyDays.has(iso) || iso < today) return;
    // No start yet, or a completed range, or a click before the start: begin
    // again from here. Anything else closes the range.
    if (!start || (start && end) || iso < start) return onChange({ start: iso, end: "" });
    if (iso === start) return onChange({ start: iso, end: "" });
    onChange({ start, end: iso });
  }

  // A range that straddles a busy day must not be selectable. Checking the
  // whole span rather than the endpoints is the difference between "these two
  // days are free" and "this stay is possible".
  function spanIsClear(from, to) {
    for (let d = from; d <= to; d = addDays(d, 1)) if (busyDays.has(d)) return false;
    return true;
  }

  const cells = monthGrid(cursor.year, cursor.month);

  return (
    <div className="panel picker">
      <h3>Choose your dates</h3>

      <div className="cal-head">
        <button className="cal-nav" onClick={() => setCursor(shift(cursor, -1))} aria-label="Previous month">‹</button>
        <strong>{MONTH_NAMES[cursor.month]} {cursor.year}</strong>
        <button className="cal-nav" onClick={() => setCursor(shift(cursor, 1))} aria-label="Next month">›</button>
      </div>

      <div className="cal-dow">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
      </div>

      <div className="cal-grid">
        {cells.map((c) => {
          const past = c.iso < today;
          const isBusy = busyDays.has(c.iso);
          // A day that cannot close a valid range is shown unavailable too —
          // otherwise a guest picks it and the button silently never enables.
          const unreachable = Boolean(start && !end && c.iso > start && !spanIsClear(start, c.iso));
          const disabled = past || isBusy || unreachable;
          const selected = c.iso === start || c.iso === end;
          const between = Boolean(start && end && c.iso > start && c.iso < end);
          return (
            <button
              key={c.iso}
              className={[
                "cal-day",
                c.inMonth ? "" : "out",
                disabled ? "off" : "",
                selected ? "sel" : "",
                between ? "mid" : "",
              ].filter(Boolean).join(" ")}
              disabled={disabled}
              onClick={() => pick(c.iso)}
              aria-label={c.iso}
              aria-pressed={selected}
            >
              {c.day}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="sw sel" /> your dates</span>
        <span><i className="sw off" /> not available</span>
      </div>

      <div className="cal-summary">
        {!start ? (
          <p className="card-meta">Tap a day to start.</p>
        ) : !end ? (
          <p className="card-meta">Pick-up {pretty(start)} — now tap your return day.</p>
        ) : (
          <>
            <p style={{ margin: "0 0 6px" }}>
              <strong>{pretty(start)}</strong> to <strong>{pretty(end)}</strong>
              {" · "}{nightsBetween(start, end)} night{nightsBetween(start, end) === 1 ? "" : "s"}
            </p>
            {verdict && !verdict.ok ? (
              <ul className="cal-errors">
                {verdict.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {quote ? (
              <ul className="specs">
                <li><span className="k">{money(quote.nightly)} × {quote.nights} nights</span><span>{money(quote.subtotal)}</span></li>
                {quote.prepFee ? <li><span className="k">{listing.prepFeeDescription || "Prep fee"}</span><span>{money(quote.prepFee)}</span></li> : null}
                <li><span className="k"><strong>Estimate</strong></span><span><strong>{money(quote.total)}</strong></span></li>
              </ul>
            ) : null}
            {/* NOT A TOTAL, and it says so. Tax, insurance, delivery and
                add-ons are quoted by the office on approval. A number a guest
                reads as final and is then charged differently is worse than no
                number at all. */}
            {quote ? (
              <p className="card-meta" style={{ marginTop: 8 }}>
                Estimate only — tax, insurance{listing.deliveryDollarMile ? ", delivery" : ""} and any
                add-ons are confirmed when we come back to you.
              </p>
            ) : null}
            <button className="btn ghost" onClick={() => onChange({ start: "", end: "" })}>Clear dates</button>
          </>
        )}
      </div>
    </div>
  );
}

function shift({ year, month }, by) {
  const m = month + by;
  if (m < 0) return { year: year - 1, month: 11 };
  if (m > 11) return { year: year + 1, month: 0 };
  return { year, month: m };
}

function pretty(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
}
