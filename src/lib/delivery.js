// delivery.js
//
// b0.27 (CRM v6.72, Fleet Delivery Pricing R2) - WHERE A CAMPER DELIVERS, as
// the listing and the request form say it. Never a price: the quote box
// prices the drive to the guest's address (request-booking), and the listing
// says nothing about the rate (Jesse, b0.16).
//
// Pure, and imports nothing - the request form uses it, and it must not pull
// in the Supabase client (listings.js does).
//
// The view's columns (public_listings, CRM update-public-listings-delivery-r2.sql):
//   delivery_offered    a range bound or at least one site
//   delivery_max_miles  the range bound's reach (null: sites only, or none)
//   delivery_sites      [{ name, city, within_miles }] - never an amount,
//                       street or point

const str = (v) => (typeof v === "string" ? v.trim() : "");
const miles = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The sites as the view gives them. An entry with no name is dropped; a
// missing or odd column is no sites.
export function deliverySites(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s === "object" && str(s.name))
    .map((s) => ({ name: str(s.name), city: str(s.city), withinMiles: miles(s.within_miles) }));
}

export function deliveryMaxMiles(value) {
  return miles(value);
}

// "Pecan Grove (Buda), Lake Camp (Austin)"
export function siteNames(sites) {
  return (Array.isArray(sites) ? sites : []).map((s) => (s.city ? `${s.name} (${s.city})` : s.name)).join(", ");
}

// What the camper page says, one sentence per line; empty when the camper
// does not deliver.
//   range bound          "Delivery available within 75 miles."
//   range bound + sites  + "Also delivers to: Pecan Grove (Buda)."
//   sites only           "Delivery to: Pecan Grove (Buda)."
export function deliveryLines(listing) {
  if (!listing?.deliveryOffered) return [];
  const sites = siteNames(listing.deliverySites);
  const max = listing.deliveryMaxMiles;
  if (max === null || max === undefined) return sites ? [`Delivery to: ${sites}.`] : [];
  return [`Delivery available within ${max} miles.`, ...(sites ? [`Also delivers to: ${sites}.`] : [])];
}

// Beside "Deliver it to me": " (within 75 miles)", or " (to Pecan Grove
// (Buda))" for a site-only camper, or "".
export function deliveryNote(listing) {
  const max = listing?.deliveryMaxMiles;
  if (max !== null && max !== undefined) return ` (within ${max} miles)`;
  const sites = siteNames(listing?.deliverySites);
  return sites ? ` (to ${sites})` : "";
}
