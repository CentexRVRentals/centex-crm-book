import { supabase, photoUrl } from "./supabase.js";

// THE ONLY MODULE THAT QUERIES. Components call these; they never touch
// `supabase` directly.
//
// Not a style preference. Every one of these functions has to survive a view
// returning a shape nobody expected — a null in a column the contract calls
// optional, an empty result, a column that quietly stopped being there. Doing
// that in one place means a component can render whatever it gets back without
// each one inventing its own defensiveness.
//
// THE RULE THIS FOLLOWS. `audit_log.details` taught the CRM that a reader of
// data written elsewhere has to survive its input rather than assume the
// contract its writer honoured on the day (§4.158, CRM). These views are
// written by a repo this one cannot see, on a deploy schedule it does not
// control. Same rule.

// ----------------------------------------------------------------------------
// Coercion. Optional chaining is a null check, not a type check.
// ----------------------------------------------------------------------------
// `row?.name` guards the key being absent and says NOTHING about its type. An
// object rendered as a React child throws "Objects are not valid as a React
// child" — a white screen, not a blank field.
export function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function money(value) {
  const n = num(value);
  if (n === null) return null;
  return n % 1 === 0 ? `$${n.toLocaleString()}` : `$${n.toFixed(2)}`;
}

export function list(value) {
  return Array.isArray(value) ? value : [];
}

// ----------------------------------------------------------------------------
// Listings
// ----------------------------------------------------------------------------
export async function fetchListings() {
  const { data, error } = await supabase.from("public_listings").select("*");
  if (error) throw error;
  return list(data).map(toListing).sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchListing(unitId) {
  const { data, error } = await supabase
    .from("public_listings")
    .select("*")
    .eq("unit_id", unitId)
    .maybeSingle();
  if (error) throw error;
  return data ? toListing(data) : null;
}

// EVERY FIELD COERCED, EVERY OPTIONAL DEFAULTED. A component reading
// listing.sleeps gets a number or null, never a string, never an object.
function toListing(row) {
  const r = row || {};
  return {
    unitId: text(r.unit_id),
    name: text(r.name, "Camper"),
    pricePerNight: num(r.price_per_night),

    type: text(r.type),
    year: num(r.year),
    make: text(r.make),
    model: text(r.model),
    sleeps: num(r.sleeps),
    tvs: num(r.tvs),
    interiorDimensions: text(r.interior_dimensions),
    freshWaterTank: text(r.fresh_water_tank),
    greyWaterTank: text(r.grey_water_tank),
    blackWaterTank: text(r.black_water_tank),
    description: text(r.unit_description),

    minimumNights: num(r.minimum_nights),
    securityDeposit: num(r.security_deposit),
    prepFee: num(r.prep_fee),
    prepFeeDescription: text(r.prep_fee_description),

    // Delivery pricing is SHOWN, not calculated. The office quotes the fee at
    // approval; a distance calculation on a public page would be a second
    // opinion about money.
    deliveryMinimum: num(r.delivery_minimum),
    deliveryMiles: num(r.delivery_miles),
    deliveryDollarMile: num(r.delivery_dollar_mile),
    deliveryMilesMax: num(r.delivery_miles_max),

    checkIn: text(r.check_in),
    checkOut: text(r.check_out),
    minimumGuestAge: num(r.minimum_guest_age),

    petFriendly: r.pet_friendly === true,
    festivalFriendly: r.festival_friendly === true,
    tailgateFriendly: r.tailgate_friendly === true,
    beachFriendly: r.beach_friendly === true,
    smokingAllowed: r.smoking_allowed === true,

    // The view already nullifs blank ones; filtered again because a view is
    // not a promise.
    customRules: [r.custom_rule_1, r.custom_rule_2, r.custom_rule_3, r.custom_rule_4, r.custom_rule_5]
      .map((v) => text(v))
      .filter(Boolean),

    cancellationPolicy: text(r.cancellation_policy),
  };
}

// ----------------------------------------------------------------------------
// Photos
// ----------------------------------------------------------------------------
// The cover first, then sort_order. `is_cover` is enforced unique per unit by
// an index in the CRM, but this sorts rather than assumes — an index can be
// dropped and this page should still look deliberate.
export async function fetchPhotos(unitId) {
  const { data, error } = await supabase
    .from("public_listing_photos")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  return list(data)
    .map((r) => ({
      url: photoUrl(text(r?.storage_path)),
      thumbUrl: photoUrl(text(r?.thumb_path)) || photoUrl(text(r?.storage_path)),
      caption: text(r?.caption),
      sortOrder: num(r?.sort_order, 0),
      isCover: r?.is_cover === true,
    }))
    .filter((p) => p.url)
    .sort((a, b) => (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0) || a.sortOrder - b.sortOrder);
}

// One query for the whole grid rather than one per camper. Eleven round trips
// to draw one page is eleven chances for one to be slow.
export async function fetchCoverPhotos() {
  const { data, error } = await supabase.from("public_listing_photos").select("*");
  if (error) throw error;
  const byUnit = new Map();
  for (const r of list(data)) {
    const unitId = text(r?.unit_id);
    const url = photoUrl(text(r?.thumb_path)) || photoUrl(text(r?.storage_path));
    if (!unitId || !url) continue;
    const existing = byUnit.get(unitId);
    const better = !existing || (r?.is_cover === true && !existing.isCover)
      || (r?.is_cover === existing.isCover && num(r?.sort_order, 0) < existing.sortOrder);
    if (better) byUnit.set(unitId, { url, isCover: r?.is_cover === true, sortOrder: num(r?.sort_order, 0) });
  }
  return byUnit;
}

// ----------------------------------------------------------------------------
// Add-ons and amenities
// ----------------------------------------------------------------------------
// BOTH SOURCE TABLES ARE EMPTY as of b0.2 — no camper has an add-on or an
// amenity yet, which is why the contract check reports them UNCHECKED rather
// than ok. Every page below is built to render correctly with neither, because
// that is the only state anyone has actually seen.
//
// When the first one is created, run `npm run contract`. A column nothing has
// ever written is untested, however carefully it was reviewed — the CRM shipped
// two booking statuses that stayed broken for eighteen releases for exactly
// that reason.
export async function fetchAddons(unitId) {
  const { data, error } = await supabase
    .from("public_listing_addons")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  return list(data)
    .map((r) => ({
      addonId: text(r?.addon_id),
      name: text(r?.name),
      description: text(r?.description),
      price: num(r?.price),
      chargeBy: text(r?.charge_by),
      daily: r?.daily === true,
      required: r?.required === true,
      position: num(r?.position, 0),
    }))
    .filter((a) => a.name)
    .sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0) || a.position - b.position);
}

export async function fetchAmenities(unitId) {
  const { data, error } = await supabase
    .from("public_listing_amenities")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  // amenity_name and amenity_group, which is what the view actually selects.
  // There is no sort_order on this view, so the order is group then name —
  // stable, and the same every load, which matters more than any particular
  // order.
  return list(data)
    .map((r) => ({ name: text(r?.amenity_name), group: text(r?.amenity_group) }))
    .filter((a) => a.name)
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------
// Busy dates
// ----------------------------------------------------------------------------
// Read but not yet used for anything in b0.2 — the calendar is b0.3. Here now
// because the camper page shows "next available", and because fetching it early
// means the shape is exercised before a date picker depends on it.
export async function fetchBusyDates(unitId) {
  const { data, error } = await supabase
    .from("public_listing_busy_dates")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  return list(data)
    .map((r) => ({ from: text(r?.busy_from), through: text(r?.busy_through) }))
    .filter((b) => b.from && b.through)
    .sort((a, b) => a.from.localeCompare(b.from));
}
