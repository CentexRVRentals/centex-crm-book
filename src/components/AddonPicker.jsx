import React from "react";
import { money } from "../lib/listings.js";

// b0.13 — THE ADD-ONS PANEL BECOMES THE PICKER.
//
// `value` is { [addonId]: qty }; `onChange` gets the whole next object. The
// page owns it (Camper.jsx), so the quote box and the request form read the
// same choices the guest can see ticked.
//
// THE RULES ARE THE SERVER'S, shown - not decided - here:
//   * Required add-ons are on every booking. Shown as "included", no control:
//     request-booking adds each one itself (hidden ones too), so this page
//     neither sends them nor lets anyone untick them.
//   * Max Quantity is the most ONE booking may take (CRM decision 7), already
//     normalised by the view. 1 = a checkbox; more = a 0..N choice.
//   * "per day" or "once per booking" comes from `daily` (decision 6). There
//     is no other way an add-on is charged.
//   * An add-on with no price cannot be chosen: the server would refuse the
//     whole request over it. It is still listed, so the guest can ask.
//
// A long catalogue on a phone is a long scroll, so the choice list is capped
// at 20 even if the office typed 50 - more than that is a phone call.
const MOST_OFFERED = 20;

export default function AddonPicker({ items, value = {}, onChange = () => {} }) {
  // Says so plainly rather than vanishing: an empty add-ons panel on a camper
  // page is information - there is nothing to add.
  if (!items.length) {
    return (
      <div className="panel">
        <h3>Add-ons</h3>
        <p className="empty-note" style={{ margin: 0 }}>Nothing to add on this one just yet.</p>
      </div>
    );
  }
  const set = (id, qty) => {
    const next = { ...value };
    if (qty > 0) next[id] = qty;
    else delete next[id];
    onChange(next);
  };
  return (
    <div className="panel">
      <h3>Add-ons</h3>
      {items.map((a) => (
        <AddonRow key={a.addonId || a.name} addon={a} qty={Number(value[a.addonId]) || 0} set={set} />
      ))}
    </div>
  );
}

function AddonRow({ addon: a, qty, set }) {
  // A number, or it has no price. money() alone would write null as "$0".
  const price = typeof a.price === "number" && Number.isFinite(a.price) ? money(a.price) : null;
  const max = Number.isInteger(a.maxQuantity) && a.maxQuantity >= 1 ? a.maxQuantity : 1;
  const choosable = !a.required && Boolean(a.addonId) && price !== null;
  const terms = [
    price !== null ? `${price} ${a.daily ? "per day" : "once per booking"}` : null,
    max > 1 && !a.required ? `up to ${max} per booking` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="addon">
      <div>
        <div className="n">
          {a.name} {a.required ? <span className="req">included</span> : null}
        </div>
        {a.description ? <div className="d">{a.description}</div> : null}
        {terms ? <div className="d">{terms}</div> : null}
        {!a.required && price === null ? <div className="d">Ask us about this one.</div> : null}
      </div>
      <div className="pick">
        {choosable && max === 1 ? (
          <label className="pick-one">
            <input
              type="checkbox"
              checked={qty > 0}
              onChange={(e) => set(a.addonId, e.target.checked ? 1 : 0)}
              aria-label={`Add ${a.name}`}
            />
            <span>Add</span>
          </label>
        ) : null}
        {choosable && max > 1 ? (
          <select
            value={String(Math.min(qty, max))}
            onChange={(e) => set(a.addonId, Number(e.target.value))}
            aria-label={`How many ${a.name}`}
          >
            <option value="0">None</option>
            {Array.from({ length: Math.min(max, MOST_OFFERED) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>{n}</option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
