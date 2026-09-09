import { useEffect } from "react";
import { text, num } from "./listings.js";

// PER-PAGE TITLE, DESCRIPTION AND SOCIAL CARD.
//
// TWO REASONS, and the second is the one people forget:
//
//   1. SEO. One of the three arguments for this being a separate repo rather
//      than a tab inside the authenticated CRM. Eleven camper pages with
//      identical titles rank as one page.
//
//   2. **A link pasted into a text message.** Somebody will send a camper to
//      their partner, and what arrives is either a photo and a name or a bare
//      URL. That is a booking, not a nicety.
//
// SET IMPERATIVELY, not with a helmet library. This is a client-rendered SPA:
// whatever is in index.html at build is what a crawler that does not run
// JavaScript sees, and no library changes that. What this DOES fix is the
// social scrapers that do run it, the browser tab, and the bookmark title.
//
// ⚠ THE HONEST LIMIT. Google renders JavaScript and will see these; many other
// crawlers and some link previewers will not, and will show whatever
// index.html says. Real per-page metadata needs prerendering or SSG, which is
// a decision for after swap-over — when there is traffic to justify it.

const DEFAULT_TITLE = "Centex RV Rentals — Camper rentals in Kyle, TX";
const DEFAULT_DESC =
  "Travel trailer and RV rentals in Kyle, Texas. Pick up from us or have it delivered.";

function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href) {
  if (!href) return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function usePageMeta({ title, description, image, path } = {}) {
  useEffect(() => {
    const t = title || DEFAULT_TITLE;
    const d = description || DEFAULT_DESC;
    const url = path ? `${window.location.origin}${path}` : window.location.href;

    document.title = t;
    setMeta("name", "description", d);
    setCanonical(url);

    // Open Graph — what a text message, Facebook or LinkedIn shows.
    setMeta("property", "og:title", t);
    setMeta("property", "og:description", d);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:url", url);
    if (image) setMeta("property", "og:image", image);

    // Twitter reads its own tags and falls back to OG inconsistently, so both.
    setMeta("name", "twitter:card", image ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", t);
    setMeta("name", "twitter:description", d);
    if (image) setMeta("name", "twitter:image", image);

    // DELIBERATELY NOT RESET on unmount. The next page sets its own, and a
    // reset would flash the default title between navigations.
  }, [title, description, image, path]);
}

// The camper page's title, built from whatever the listing actually has. Every
// field is optional in the contract, so this degrades to the name alone.
export function camperMeta(listing, coverUrl) {
  if (!listing) return {};
  // COERCED, like everything else read out of a view. `filter(Boolean)` keeps
  // an object — it is truthy — and `join` turns it into "[object Object]" in a
  // page title and, worse, in the card that appears when somebody texts the
  // link. Caught by this file's own hostile case, which is §4.158 a second
  // time: optional chaining and truthiness are null checks, not type checks.
  const bits = [num(listing.year), text(listing.make), text(listing.model)]
    .map((v) => (v === null ? "" : String(v)))
    .filter(Boolean)
    .join(" ");
  const sleeps = num(listing.sleeps) ? `Sleeps ${num(listing.sleeps)}` : "";
  const price = num(listing.pricePerNight) ? `from $${num(listing.pricePerNight)}/night` : "";
  return {
    title: `${text(listing.name, "Camper")}${bits ? ` — ${bits}` : ""} | Centex RV Rentals`,
    description: [bits, sleeps, price, "Rent from Centex RV Rentals in Kyle, TX."]
      .filter(Boolean)
      .join(" · "),
    image: text(coverUrl) || undefined,
    path: `/camper/${text(listing.unitId)}`,
  };
}
