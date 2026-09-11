import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchListings, fetchCoverPhotos, money, text } from "../lib/listings.js";
import { Loading, ErrorState } from "../components/States.jsx";
import { usePageMeta } from "../lib/meta.js";

// The grid. Every camper in `public_listings`, which is every non-retired
// camper with a price — currently eleven.
//
// TWO QUERIES, NOT TWELVE. Listings and every cover photo in one round trip
// each, joined in memory. One query per camper would be eleven chances for one
// to be slow, on the page that decides whether somebody stays.

export default function Listings() {
  const [state, setState] = useState({ status: "loading" });

  async function load() {
    setState({ status: "loading" });
    try {
      // Both at once. A failure in either fails the page, which is correct:
      // a grid of nameless cards is worse than an honest error.
      const [listings, covers] = await Promise.all([fetchListings(), fetchCoverPhotos()]);
      setState({ status: "ready", listings, covers });
    } catch (err) {
      setState({ status: "error", detail: err?.message || String(err) });
    }
  }

  useEffect(() => { load(); }, []);

  // Set explicitly rather than left to index.html, so navigating back from a
  // camper page restores the title instead of keeping that camper's.
  usePageMeta({
    title: "Camper & travel trailer rentals in Kyle, TX | Centex RV Rentals",
    description: "Browse our fleet of travel trailers. Pick up from us in Kyle, Texas, or have it delivered to your site.",
    path: "/",
  });

  if (state.status === "loading") return <Loading what="campers" />;
  if (state.status === "error") {
    return <ErrorState detail={state.detail} onRetry={load} />;
  }

  if (state.listings.length === 0) {
    // NOT AN ERROR. An empty fleet is a data state, and saying "something went
    // wrong" about it would send you looking for a bug that isn't there.
    return (
      <div className="state">
        <h2>Nothing available just now</h2>
        <p>Give us a call — we may have something coming back in.</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="grid">
        {state.listings.map((u) => (
          <Link className="card" key={u.unitId} to={`/camper/${encodeURIComponent(u.unitId)}`}>
            <Cover url={state.covers.get(u.unitId)?.url} name={u.name} />
            <div className="card-body">
              <h2>{u.name}</h2>
              <div className="card-meta">{describe(u)}</div>
              <div className="card-price">
                {money(u.pricePerNight)} <small>/ night</small>
                {u.minimumNights > 1 ? <small> · {u.minimumNights}-night minimum</small> : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Cover({ url, name }) {
  // NO CAMPER HAS PHOTOS TODAY... except they might: the contract check found
  // public_listing_photos returning 6 columns, which means rows exist. Either
  // way this renders deliberately rather than showing a broken image icon.
  if (!url) return <div className="card-img empty">Photos coming soon</div>;
  return <img className="card-img" src={url} alt={name} loading="lazy" />;
}

// Year Make Model, or whatever subset exists. Every field here is optional in
// the contract, and a camper with none of them still gets a sensible line.
function describe(u) {
  const parts = [u.year, u.make, u.model].map((v) => text(v)).filter(Boolean);
  const head = parts.length ? parts.join(" ") : text(u.type, "Travel trailer");
  return u.sleeps ? `${head} · sleeps ${u.sleeps}` : head;
}
