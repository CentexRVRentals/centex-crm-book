#!/usr/bin/env node
//
// npm run conformance
//
// ============================================================================
// THE POINT OF THIS FILE
// ============================================================================
// src/lib/dates.js and the CRM's supabase/functions/_shared/booking-request.ts
// implement the same rules twice. That duplication is deliberate — CRM §4.163
// explains why extraction would have cost a published npm package and a publish
// step in every CRM release — and it carries exactly one risk:
//
//   **If the two disagree about which dates are bookable, a guest is offered a
//   date and then refused it.**
//
// So a corpus of cases goes through BOTH: this repo's checkDates, and the live
// Edge Function via `{ dryRun: true }`. Any case where the verdicts differ is
// named, with the case in it.
//
// WHY NOT IN preship. It needs the network and a live database, like the
// contract check. A gate that fails when the wifi drops is a gate people learn
// to ignore. **Required step in every delivery, and any time either side's
// date rules change.**
//
// WHY dryRun. Without it every case in the corpus would leave a held booking
// behind, and the corpus is deliberately large.
//
// b0.13 — A DRY RUN NOW PRICES TOO (CRM v6.03). A camper the server cannot
// price - no nightly rate, or a REQUIRED add-on with no price - is refused on
// every date, which this file would have reported as a wall of date
// "disagreements". So each camper is priced first, on a clear week far out,
// with `{ quote: true }`; the ones that cannot be priced are NAMED as a CRM
// data problem and skipped, and the dates are compared on the busiest camper
// that can be. Pricing is not what this file checks - the CRM's quote.test.js
// is - but it must not hide behind a date report.
//
// WHAT IT CANNOT CATCH. A rule that is wrong in the SAME way on both sides.
// dates.test.jsx is what tests the rules against what they should be; this
// tests them against each other. Neither replaces the other.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { checkDates, todayCentral, addDays } from "../src/lib/dates.js";

function loadEnv() {
  const out = { ...process.env };
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

// NAMES WHICH ONE, and treats an empty value differently from a missing one —
// an absent variable is a setup step nobody did, an empty one is a setup step
// that appeared to work. Learned the hard way on the contract check.
const problems = [];
if (!url) problems.push("VITE_SUPABASE_URL is not set");
else if (!url.startsWith("http")) problems.push(`VITE_SUPABASE_URL looks wrong: ${url}`);
if (key === undefined) problems.push("VITE_SUPABASE_ANON_KEY is not set");
else if (!key.trim()) problems.push("VITE_SUPABASE_ANON_KEY is present but EMPTY — check .env");
if (problems.length) {
  console.error(`\n  ${problems.join("\n  ")}\n\n  Looked in ${path.join(process.cwd(), ".env")}\n`);
  process.exit(1);
}

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ----------------------------------------------------------------------------
// A real camper, and its real busy dates.
// ----------------------------------------------------------------------------
// Read from the live views rather than fixtured. A corpus built against made-up
// availability would agree with the server about nothing that matters.
// THE SAME CLIENT contract.mjs uses, and the same one the site uses. The first
// version of this hand-built a PostgREST URL and got it wrong — it produced
// `public_listings&select=*` with no `?` at all, so the query string became
// part of the table name. There is no reason to hand-roll a URL when the
// client that does it correctly is already a dependency.
const db = createClient(url, key, { auth: { persistSession: false } });

async function get(view, unitId) {
  let q = db.from(view).select("*");
  if (unitId) q = q.eq("unit_id", unitId);
  const { data, error } = await q;
  if (error) throw new Error(`${view}: ${error.message}`);
  return data || [];
}

const listings = await get("public_listings");
if (!listings.length) {
  console.error("\n  No listed campers — nothing to compare against.\n");
  process.exit(1);
}
// The one with the most busy dates: the more real ranges, the more of the
// overlap rule gets exercised.
const allBusy = await get("public_listing_busy_dates");
const busyByUnit = new Map();
for (const b of allBusy) {
  const arr = busyByUnit.get(b.unit_id) || [];
  arr.push({ from: b.busy_from, through: b.busy_through });
  busyByUnit.set(b.unit_id, arr);
}
// b0.13 - priced first; see the top of this file.
const clearFrom = addDays(todayCentral(), 200);
async function priceProblem(u) {
  const nights = Math.max(1, Number(u.minimum_nights) || 1) + 1;
  const res = await fetch(`${url}/functions/v1/request-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote: true, unitId: u.unit_id, start: clearFrom, end: addDays(clearFrom, nights), method: "pickup", addons: [] }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.quote !== true) {
    throw new Error(
      `request-booking did not answer quote:true (got ${JSON.stringify(body).slice(0, 160)}). ` +
      "Deploy CRM v6.03 before running this."
    );
  }
  return body.ok === true ? "" : (body.errors || ["refused, no reason given"])[0];
}
const byBusiest = listings
  .slice()
  .sort((a, b) => (busyByUnit.get(b.unit_id)?.length || 0) - (busyByUnit.get(a.unit_id)?.length || 0));
let unit = null;
const unpriceable = [];
for (const u of byBusiest) {
  let problem;
  try {
    problem = await priceProblem(u);
  } catch (err) {
    console.log(`\n  ${red("STOP")}  ${err.message}\n`);
    process.exit(1);
  }
  if (!problem) { unit = unit || u; continue; }
  unpriceable.push({ u, problem });
}
if (unpriceable.length) {
  console.log(`\n  ${red("CANNOT BE PRICED")} — every request for these is refused. Fix in the CRM (Pricing / Add ons tab):`);
  for (const { u, problem } of unpriceable) console.log(`        ${u.name} (${u.unit_id}): ${problem}`);
}
if (!unit) {
  console.error("\n  No listed camper can be priced — nothing to compare dates against.\n");
  process.exit(1);
}
const busy = busyByUnit.get(unit.unit_id) || [];

console.log(`\n  Conformance: this repo's rules vs the live request-booking`);
console.log(dim(`  ${unit.name} (${unit.unit_id}) — ${busy.length} busy range(s), ${unit.minimum_nights || 0}-night minimum\n`));

// ----------------------------------------------------------------------------
// The corpus.
// ----------------------------------------------------------------------------
const today = todayCentral();
const cases = [];
const add = (why, start, end) => cases.push({ why, start, end });

// Around every real busy range: the boundary days are the decision this whole
// file exists to protect.
for (const b of busy.slice(0, 6)) {
  add("ends the day a busy range starts", addDays(b.from, -3), b.from);
  add("ends the day before a busy range", addDays(b.from, -3), addDays(b.from, -1));
  add("starts the day a busy range ends", b.through, addDays(b.through, 3));
  add("starts the day after a busy range", addDays(b.through, 1), addDays(b.through, 4));
  add("straddles the start", addDays(b.from, -2), addDays(b.from, 2));
  add("straddles the end", addDays(b.through, -2), addDays(b.through, 2));
  add("wholly inside", b.from, b.through);
  add("wholly contains", addDays(b.from, -5), addDays(b.through, 5));
}

// Clear weeks well past anything busy.
const far = addDays(today, 200);
add("clear week, far out", far, addDays(far, 7));
add("exactly the minimum", far, addDays(far, Math.max(1, Number(unit.minimum_nights) || 1)));
add("one night under the minimum", far, addDays(far, Math.max(1, (Number(unit.minimum_nights) || 2) - 1)));

// Edges.
add("starts today", today, addDays(today, 3));
add("starts yesterday", addDays(today, -1), addDays(today, 3));
add("end before start", addDays(far, 5), far);
add("same day both ends", far, far);
add("longer than the online maximum", far, addDays(far, 120));
add("further ahead than we book", addDays(today, 900), addDays(today, 905));

// ----------------------------------------------------------------------------
// Compare.
// ----------------------------------------------------------------------------
async function serverVerdict({ start, end }) {
  const res = await fetch(`${url}/functions/v1/request-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unitId: unit.unit_id, start, end,
      name: "Conformance Check", email: "conformance@example.test",
      method: "pickup", dryRun: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  // A dry run MUST say it was dry. If it does not, either the flag was
  // ignored — in which case this corpus just created holds — or an older
  // build is deployed. Either way, stop.
  if (body.dryRun !== true) {
    throw new Error(
      `request-booking did not answer dryRun:true (got ${JSON.stringify(body).slice(0, 160)}). ` +
      "Deploy CRM v3.90 before running this — and check for stray WEB- holds."
    );
  }
  return { ok: body.ok === true, errors: body.errors || [] };
}

let disagreements = 0;
let checked = 0;

for (const c of cases) {
  const mine = checkDates({
    start: c.start, end: c.end, busy,
    minimumNights: unit.minimum_nights, today,
  });
  let theirs;
  try {
    theirs = await serverVerdict(c);
  } catch (err) {
    console.log(`  ${red("STOP")}  ${err.message}\n`);
    process.exit(1);
  }
  checked++;

  if (mine.ok === theirs.ok) continue;

  disagreements++;
  console.log(`  ${red("DISAGREE")}  ${c.why}`);
  console.log(`            ${c.start} → ${c.end}`);
  console.log(`            this site: ${mine.ok ? green("bookable") : red("refused")}${mine.ok ? "" : ` — ${mine.errors[0]}`}`);
  console.log(`            server:    ${theirs.ok ? green("bookable") : red("refused")}${theirs.ok ? "" : ` — ${theirs.errors[0]}`}`);
  console.log(
    dim(
      mine.ok
        ? "            The calendar would OFFER this and the server would REFUSE it. This is the guest-facing bug.\n"
        : "            The calendar hides a week the server would accept. Lost booking, not a broken one.\n"
    )
  );
}

console.log("");
if (disagreements) {
  console.log(`  ${red(`${disagreements} of ${checked} cases disagree.`)} src/lib/dates.js and the Edge Function have drifted.\n`);
  process.exit(1);
}
console.log(`  ${green(`All ${checked} cases agree.`)}\n`);
// A camper that cannot be priced is a failed run even when the dates agree:
// the site lists it, and every request for it is refused.
if (unpriceable.length) {
  console.log(`  ${red(`But ${unpriceable.length} camper(s) cannot be priced`)} — named at the top. Not a date problem.\n`);
  process.exit(1);
}
