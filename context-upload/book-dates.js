// THE DATE RULES, IMPLEMENTED HERE.
//
// A SECOND IMPLEMENTATION, ON PURPOSE. The server has these rules too, in
// supabase/functions/_shared/booking-request.ts. This is not an oversight and
// not laziness — it is the conclusion of CRM §4.163, and the reasoning is worth
// keeping next to the code:
//
//   ARITHMETIC — interval overlap, days between two dates — cannot
//   meaningfully drift. There is one right answer and a test catches a wrong
//   one. Sharing three lines of date maths across a repo boundary costs a
//   published npm package, a scope, and a publish step in every CRM release
//   that touches a validation rule. Deno's `npm:` specifier does not accept a
//   git URL, so there is no cheaper mechanism.
//
//   RULES drift silently, and almost all of ours are already data: which
//   statuses block a date is public_listing_busy_dates, one view both sides
//   read. Minimum nights is a column on the listing.
//
// WHAT IS LEFT IS ONE DECISION: is a check-out day bookable? The server says
// no — a busy range is inclusive at both ends, because the site does not
// collect pickup and dropoff times and refusing a bookable night is safer than
// accepting an unbookable one.
//
// **If this file disagrees with the server about that, a guest is offered a
// date and then refused it.** That is the entire risk of the duplication, and
// conformance.test.jsx runs a corpus of cases through both this file AND the
// live Edge Function's dryRun to prove they agree.

// Local calendar dates, never Date objects across a boundary. The bookings
// table, the busy-dates view and string comparison all assume YYYY-MM-DD, and
// a Date here would introduce a timezone the rest of this path does not have.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function nightsBetween(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) return 0;
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000
  );
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Today in US Central. The whole business runs on one timezone, hold expiry is
// reckoned in Central, and the server checks "is this start date in the past"
// in Central — so a guest in California at 10pm must not be told the 9th is
// past when Texas is still on the 9th.
export function todayCentral(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

// ----------------------------------------------------------------------------
// THE ONE DECISION. Inclusive at both ends.
// ----------------------------------------------------------------------------
// A busy range of Nov 2–6 makes ALL of 2,3,4,5,6 unavailable — including the
// 6th, the day the previous guest brings it back. The office can still take a
// same-day turnaround by hand when the times work; this site cannot know the
// times, so it does not offer the day.
export function overlapsBusy(start, end, busy) {
  if (!isIsoDate(start) || !isIsoDate(end)) return false;
  return (busy || []).some((b) => b && start <= b.through && b.from <= end);
}

// Every individual day inside any busy range, for greying out the calendar.
// Bounded so a corrupt range cannot spin: the view publishes ranges from real
// bookings, but this reads data written by a repo it cannot see.
const MAX_RANGE_DAYS = 400;

export function busyDaySet(busy) {
  const days = new Set();
  for (const b of busy || []) {
    if (!b || !isIsoDate(b.from) || !isIsoDate(b.through)) continue;
    let d = b.from;
    for (let i = 0; i <= MAX_RANGE_DAYS && d <= b.through; i++) {
      days.add(d);
      d = addDays(d, 1);
    }
  }
  return days;
}

// ----------------------------------------------------------------------------
// The verdict
// ----------------------------------------------------------------------------
// Mirrors the server's messages deliberately. A guest who somehow gets past
// this and is refused by the server should read the SAME sentence, not a
// second opinion phrased differently.
export const MAX_NIGHTS = 90;
export const MAX_ADVANCE_DAYS = 730;

export function checkDates({ start, end, busy, minimumNights, today }) {
  const errors = [];
  const todayIso = today || todayCentral();

  if (!isIsoDate(start) || !isIsoDate(end)) {
    return { ok: false, errors: ["Please choose your dates."], nights: 0 };
  }

  const nights = nightsBetween(start, end);
  if (nights < 1) errors.push("The return date has to be after the pick-up date.");
  if (start < todayIso) errors.push("That start date is in the past.");
  if (nights > MAX_NIGHTS) {
    errors.push(`We can't take a request for more than ${MAX_NIGHTS} nights online — please call us.`);
  }
  if (nightsBetween(todayIso, start) > MAX_ADVANCE_DAYS) {
    errors.push("That's further ahead than we're booking right now.");
  }

  const min = Number(minimumNights) || 0;
  if (min > 0 && nights > 0 && nights < min) {
    errors.push(`This camper has a ${min}-night minimum.`);
  }

  if (overlapsBusy(start, end, busy)) {
    errors.push("Those dates have just been taken. Please pick another week.");
  }

  return { ok: errors.length === 0, errors, nights };
}

// ----------------------------------------------------------------------------
// Quoting
// ----------------------------------------------------------------------------
// NIGHTLY RATE ONLY, plus fees the listing states. NOT a total — no tax, no
// insurance, no delivery, no add-ons. The office quotes the real number at
// approval.
//
// Deliberately labelled as an estimate wherever it is shown. A number a guest
// reads as final and is then charged differently is worse than no number.
export function estimate({ pricePerNight, prepFee, nights }) {
  const rate = Number(pricePerNight) || 0;
  const prep = Number(prepFee) || 0;
  if (!nights || nights < 1 || !rate) return null;
  return { nights, nightly: rate, subtotal: rate * nights, prepFee: prep, total: rate * nights + prep };
}

// Calendar grid for a month: 42 cells, Sunday-first, with the neighbouring
// days that fill the first and last weeks.
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = first.getUTCDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month, 1 - startOffset + i));
    cells.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month,
    });
  }
  return cells;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
