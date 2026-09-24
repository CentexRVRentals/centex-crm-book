// b0.14 — ADDRESS SUGGESTIONS on the delivery form.
//
// The one outside service this site calls that is not the CRM. It makes
// typing an address quicker and, more to the point, makes the address one
// Mapbox can find - which is what lets request-booking price delivery by the
// mile (CRM v6.05) instead of "from $minimum".
//
// SUGGESTIONS ONLY. Nothing here decides a price or a distance: the server
// geocodes the address again with its own secret token and prices from that.
// A guest who ignores the list and types, or a site with no token, loses
// nothing but the convenience.
//
// THE TOKEN IS PUBLIC BY DESIGN - a Mapbox `pk.` token in the browser, exactly
// like the anon key - and is THIS SITE'S OWN: created for it alone, restricted
// in Mapbox to https://book.centexrvrentals.com, so website traffic can never
// spend the office app's token. It comes from the build environment
// (VITE_MAPBOX_TOKEN on Netlify), never from source; no token = no list.

export const MAPBOX_HOST = "https://api.mapbox.com";
// Kyle, TX - where the yards are. A hint, not a filter: it ranks Buda's
// "Main St" above Ohio's without hiding anywhere.
export const SEARCH_NEAR = [-97.877, 29.989];
export const MIN_QUERY = 4;
export const SUGGEST_DEBOUNCE_MS = 300;

const token = () => (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
export const suggestionsEnabled = () => Boolean(token());

// Up to five real addresses for what has been typed, as
// [{ label, address, city, state, zip }]. Never throws: no token, too short,
// offline, a bad answer or an aborted call is just no suggestions.
export async function suggestAddresses(query, { signal } = {}) {
  const t = token();
  const q = typeof query === "string" ? query.trim() : "";
  if (!t || q.length < MIN_QUERY) return [];
  const url = `${MAPBOX_HOST}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?access_token=${encodeURIComponent(t)}&autocomplete=true&country=US&types=address&limit=5` +
    `&proximity=${SEARCH_NEAR[0]},${SEARCH_NEAR[1]}`;
  try {
    const res = await fetch(url, { signal });
    if (!res?.ok) return [];
    const body = await res.json();
    return (Array.isArray(body?.features) ? body.features : []).map(parseFeature).filter(Boolean);
  } catch {
    return [];
  }
}

// One Mapbox address feature -> the four fields the form has, or null when
// any is missing (a suggestion that fills three boxes is one the guest has to
// finish anyway, and the server will not price an incomplete address).
export function parseFeature(f) {
  if (!f || typeof f !== "object") return null;
  const ctx = Array.isArray(f.context) ? f.context : [];
  const find = (prefix) => ctx.find((c) => typeof c?.id === "string" && c.id.startsWith(prefix));
  const number = typeof f.address === "string" ? f.address.trim() : "";
  const street = typeof f.text === "string" ? f.text.trim() : "";
  const city = String(find("place.")?.text ?? "").trim();
  const region = find("region.");
  const state = String(region?.short_code ?? "").replace(/^US-/i, "").toUpperCase().trim() || String(region?.text ?? "").trim();
  const zip = String(find("postcode.")?.text ?? "").trim();
  const address = [number, street].filter(Boolean).join(" ");
  if (!number || !street || !city || !state || !zip) return null;
  return { label: `${address}, ${city}, ${state} ${zip}`, address, city, state, zip };
}
