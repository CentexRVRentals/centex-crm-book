import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchListing, fetchPhotos, fetchAddons, fetchAmenities, fetchBusyDates,
  money, text,
} from "../lib/listings.js";
import DatePicker from "../components/DatePicker.jsx";
import RequestForm from "../components/RequestForm.jsx";
import { Loading, ErrorState, NotFound } from "../components/States.jsx";
import { checkDates, todayCentral } from "../lib/dates.js";
import { usePageMeta, camperMeta } from "../lib/meta.js";

// One camper. Photos, specs, policies, add-ons, price.
//
// READ-ONLY IN b0.2. The date picker is b0.3 and the request form is b0.4, so
// there is deliberately no call to action yet — a "Book now" button that did
// nothing would be worse than no button.
//
// EVERYTHING BELOW SURVIVES AN EMPTY SECTION. Add-ons and amenities are both
// empty in the database today, so "renders with neither" is not a defensive
// nicety here — it is the only state that has ever existed.

export default function Camper() {
  const { unitId } = useParams();
  const [state, setState] = useState({ status: "loading" });
  // Dates live on the PAGE, not inside the picker. b0.4's request form needs
  // them, and lifting them later would mean rewriting the picker's interface.
  const [dates, setDates] = useState({ start: "", end: "" });
  // The form replaces the picker rather than sitting under it. On a phone a
  // form below a calendar is a form nobody scrolls to.
  const [requesting, setRequesting] = useState(false);

  async function load() {
    setState({ status: "loading" });
    try {
      const listing = await fetchListing(unitId);
      if (!listing) return setState({ status: "missing" });
      // Photos, add-ons and amenities fetched together AFTER the listing,
      // because without a listing there is nothing to attach them to.
      const [photos, addons, amenities, busy] = await Promise.all([
        fetchPhotos(unitId), fetchAddons(unitId), fetchAmenities(unitId), fetchBusyDates(unitId),
      ]);
      setState({ status: "ready", listing, photos, addons, amenities, busy });
    } catch (err) {
      setState({ status: "error", detail: err?.message || String(err) });
    }
  }

  useEffect(() => { load(); setDates({ start: "", end: "" }); setRequesting(false); }, [unitId]);

  // Hooks cannot be called conditionally, so this runs on every render —
  // including while loading, when it falls back to the site default. That is
  // correct: a page that is still loading should not claim a camper's title.
  usePageMeta(camperMeta(state.listing, state.photos?.[0]?.url));

  if (state.status === "loading") return <Loading what="this camper" />;
  if (state.status === "missing") return <NotFound what="camper" />;
  if (state.status === "error") return <ErrorState detail={state.detail} onRetry={load} />;

  const u = state.listing;

  return (
    <div className="wrap">
      <Link className="back" to="/">← All campers</Link>
      <h1 style={{ margin: "4px 0 2px" }}>{u.name}</h1>
      <div className="card-meta" style={{ marginBottom: 18 }}>{describe(u)}</div>

      <div className="detail">
        <div>
          <Gallery photos={state.photos} name={u.name} />
          {u.description ? (
            <div className="panel" style={{ marginTop: 20 }}>
              <h3>About this camper</h3>
              <p style={{ margin: 0 }}>{u.description}</p>
            </div>
          ) : null}
          <Amenities items={state.amenities} />
          <Rules listing={u} />
        </div>

        <div>
          <div className="panel">
            <div className="price-big">
              {money(u.pricePerNight)} <small>/ night</small>
            </div>
            {u.minimumNights > 1 ? (
              <div className="card-meta">{u.minimumNights}-night minimum</div>
            ) : null}
            <ul className="specs" style={{ marginTop: 12 }}>
              {u.securityDeposit ? <Row k="Security deposit" v={money(u.securityDeposit)} /> : null}
              {u.prepFee ? <Row k={text(u.prepFeeDescription, "Prep fee")} v={money(u.prepFee)} /> : null}
              {u.checkIn ? <Row k="Pick-up from" v={u.checkIn} /> : null}
              {u.checkOut ? <Row k="Return by" v={u.checkOut} /> : null}
              {u.cancellationPolicy ? <Row k="Cancellation" v={u.cancellationPolicy} /> : null}
            </ul>
            {/* Delivery pricing is SHOWN, never calculated. The office quotes
                the fee at approval; a distance calculation on a public page
                would be a second opinion about money. */}
            {u.deliveryDollarMile ? (
              <p className="card-meta" style={{ marginTop: 12, marginBottom: 0 }}>
                Delivery available{u.deliveryMilesMax ? ` within ${u.deliveryMilesMax} miles` : ""} —
                we'll quote it with your request.
              </p>
            ) : null}
          </div>

          {requesting ? (
            <RequestForm
              listing={u}
              busy={state.busy}
              dates={dates}
              onCancel={() => setRequesting(false)}
            />
          ) : (
            <>
              <DatePicker listing={u} busy={state.busy} value={dates} onChange={setDates} />
              {dates.start && dates.end ? (
                <RequestCta listing={u} busy={state.busy} dates={dates} onStart={() => setRequesting(true)} />
              ) : null}
            </>
          )}
          <Specs listing={u} />
          <Addons items={state.addons} />
        </div>
      </div>
    </div>
  );
}

// Only appears once the dates are valid. A call to action next to a range the
// server would refuse is a button that leads somewhere disappointing.
function RequestCta({ listing, busy, dates, onStart }) {
  const ok = checkDates({
    start: dates.start, end: dates.end, busy,
    minimumNights: listing.minimumNights, today: todayCentral(),
  }).ok;
  if (!ok) return null;
  return (
    <div className="panel">
      <button className="btn" style={{ marginTop: 0, width: "100%" }} onClick={onStart}>
        Request these dates
      </button>
      <p className="card-meta" style={{ margin: "8px 0 0", textAlign: "center" }}>
        No payment now — we'll confirm first.
      </p>
    </div>
  );
}

function Row({ k, v }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}

function Gallery({ photos, name }) {
  const [i, setI] = useState(0);
  if (!photos.length) {
    return <div className="no-photos">Photos of {name} coming soon</div>;
  }
  const active = photos[Math.min(i, photos.length - 1)];
  return (
    <div className="gallery">
      <img src={active.url} alt={active.caption || name} />
      {photos.length > 1 ? (
        <div className="thumbs">
          {photos.map((p, n) => (
            <img
              key={p.url}
              src={p.thumbUrl}
              alt={p.caption || `${name} photo ${n + 1}`}
              aria-current={n === i}
              onClick={() => setI(n)}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Specs({ listing: u }) {
  const rows = [
    ["Sleeps", u.sleeps],
    ["Type", u.type],
    ["Year", u.year],
    ["Make", u.make],
    ["Model", u.model],
    ["Interior", u.interiorDimensions],
    ["Fresh water", u.freshWaterTank],
    ["Grey water", u.greyWaterTank],
    ["Black water", u.blackWaterTank],
    ["TVs", u.tvs],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!rows.length) return null;
  return (
    <div className="panel">
      <h3>Specs</h3>
      <ul className="specs">
        {rows.map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
      </ul>
    </div>
  );
}

function Amenities({ items }) {
  // Empty in the database today. Renders nothing rather than an empty heading —
  // a section title with nothing under it reads as broken.
  if (!items.length) return null;
  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <h3>What's on board</h3>
      <div className="tags">
        {items.map((a) => <span className="tag" key={a.name}>{a.name}</span>)}
      </div>
    </div>
  );
}

function Addons({ items }) {
  // Also empty today. Says so plainly rather than vanishing, because an empty
  // add-ons panel on a camper page is information: there is nothing to add.
  if (!items.length) {
    return (
      <div className="panel">
        <h3>Add-ons</h3>
        <p className="empty-note" style={{ margin: 0 }}>Nothing to add on this one just yet.</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <h3>Add-ons</h3>
      {items.map((a) => (
        <div className="addon" key={a.addonId || a.name}>
          <div>
            <div className="n">
              {a.name} {a.required ? <span className="req">included</span> : null}
            </div>
            {a.description ? <div className="d">{a.description}</div> : null}
          </div>
          <div style={{ whiteSpace: "nowrap" }}>
            {money(a.price)}{a.daily ? <span className="d"> / day</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Rules({ listing: u }) {
  const flags = [
    ["Pets welcome", u.petFriendly],
    ["Festivals OK", u.festivalFriendly],
    ["Tailgating OK", u.tailgateFriendly],
    ["Beach OK", u.beachFriendly],
    ["Smoking allowed", u.smokingAllowed],
  ];
  const yes = flags.filter(([, v]) => v);
  const no = flags.filter(([, v]) => !v);
  const hasAny = yes.length || u.customRules.length || u.minimumGuestAge;
  if (!hasAny) return null;
  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <h3>Good to know</h3>
      <div className="tags" style={{ marginBottom: u.customRules.length ? 12 : 0 }}>
        {yes.map(([k]) => <span className="tag" key={k}>{k}</span>)}
        {no.map(([k]) => <span className="tag no" key={k}>No {k.replace(/ (welcome|OK|allowed)$/, "").toLowerCase()}</span>)}
      </div>
      {u.minimumGuestAge ? (
        <p className="card-meta" style={{ marginTop: 0 }}>Renters must be {u.minimumGuestAge} or older.</p>
      ) : null}
      {u.customRules.length ? (
        <ul className="rules">{u.customRules.map((r) => <li key={r}>{r}</li>)}</ul>
      ) : null}
    </div>
  );
}

function describe(u) {
  const parts = [u.year, u.make, u.model].map((v) => text(v)).filter(Boolean);
  const head = parts.length ? parts.join(" ") : text(u.type, "Travel trailer");
  return u.sleeps ? `${head} · sleeps ${u.sleeps}` : head;
}
