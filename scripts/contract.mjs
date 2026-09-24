#!/usr/bin/env node
//
// npm run contract
//
// Queries every view in src/lib/contract.js against the LIVE database and
// fails if a column this site reads is not there.
//
// ============================================================================
// WHY THIS IS NOT PART OF PRESHIP
// ============================================================================
// It needs the network and a live database. A preship that fails when the wifi
// drops is a preship people learn to ignore, and a gate people ignore is worse
// than no gate at all.
//
// So it is a separate command, and a REQUIRED STEP IN EVERY DELIVERY — the same
// standing as the SQL steps in the CRM's release scripts. Run it before you
// push, and any time the CRM ships a migration.
//
// WHAT IT CANNOT TELL YOU. That the data is right. A view can have every column
// and return nothing useful. This checks the SHAPE, which is the thing that
// breaks silently when someone renames a column three repos away.

// b0.11 — IT ALSO CHECKS THAT THE DEPLOYED SITE IS REACHABLE AND SAYS THE
// RIGHT ORIGIN. See the third section at the bottom, and liveSiteProblems in
// site-origin.mjs for why a request is the only thing that can check it.

import { createClient } from "@supabase/supabase-js";
import { VIEWS, FUNCTIONS, CONTRACT_VERSION } from "../src/lib/contract.js";
import { liveSiteProblems } from "./site-origin.mjs";
import fs from "node:fs";
import path from "node:path";

// Read .env by hand rather than adding dotenv. This script runs outside Vite,
// so import.meta.env is not available, and one more dependency for four lines
// is not worth it.
function loadEnv() {
  const out = { ...process.env };
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("\n  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set — check .env\n");
  process.exit(1);
}

// THE ANON KEY, DELIBERATELY. Checking the contract with a service-role key
// would prove the columns exist for somebody who can read everything, which is
// not the question. The question is whether a GUEST can read them.
const db = createClient(url, key, { auth: { persistSession: false } });

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;
let warnings = 0;

console.log(`\n  Contract ${CONTRACT_VERSION} against ${url}\n`);

for (const [view, spec] of Object.entries(VIEWS)) {
  const { data, error } = await db.from(view).select("*").limit(1);

  if (error) {
    // The two cases worth telling apart. A missing view is a migration that
    // never ran; a permission error is a grant that was revoked or never made.
    const missing = /does not exist|not find the table/i.test(error.message);
    console.log(`  ${red("FAIL")}  ${view}`);
    console.log(`        ${missing ? "the view does not exist, or anon cannot see it" : error.message}`);
    console.log(dim(`        ${spec.why}`));
    failures++;
    continue;
  }

  if (!data || data.length === 0) {
    // An empty view is not a contract failure — a fleet with no listed campers
    // is a data question. But its columns cannot be checked, and saying so is
    // better than reporting a pass that checked nothing (§4.104).
    console.log(`  ${red("SKIP")}  ${view} returned no rows — columns UNCHECKED`);
    console.log(dim(`        ${spec.why}`));
    warnings++;
    continue;
  }

  const present = new Set(Object.keys(data[0]));
  const missingRequired = spec.required.filter((c) => !present.has(c));
  const missingOptional = spec.optional.filter((c) => !present.has(c));

  if (missingRequired.length) {
    console.log(`  ${red("FAIL")}  ${view}`);
    console.log(`        missing REQUIRED: ${missingRequired.join(", ")}`);
    console.log(dim(`        ${spec.why}`));
    failures++;
  } else if (missingOptional.length) {
    console.log(`  ${green("ok")}    ${view} ${dim(`(${present.size} columns)`)}`);
    console.log(`        ${red("missing optional")}: ${missingOptional.join(", ")}`);
    warnings++;
  } else {
    console.log(`  ${green("ok")}    ${view} ${dim(`(${present.size} columns)`)}`);
  }
}

// ----------------------------------------------------------------------------
// The Edge Function. Reachability only.
// ----------------------------------------------------------------------------
// Deliberately posts a request that CANNOT succeed — an empty body — so this
// check never creates a hold. What it proves is the two things that actually
// break: the function is deployed, and it answers without an Authorization
// header. A 401 here means --no-verify-jwt was missed, which is the single
// most likely deployment mistake for this endpoint.
for (const [name, spec] of Object.entries(FUNCTIONS)) {
  // b0.12 — a function with a `probe` says exactly what a harmless request to
  // it must answer (payment-options: a token that cannot verify -> 401 with
  // the server's own sentence). Without one, the request-booking check below.
  if (spec.probe) {
    try {
      const res = await fetch(`${url}/functions/v1/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec.probe.body),
      });
      const body = await res.json().catch(() => null);
      const said = body && typeof body[spec.probe.key] === "string" && body[spec.probe.key].trim();
      if (res.status === 404) {
        console.log(`  ${red("FAIL")}  ${name} is not deployed`);
        failures++;
      } else if (res.status === spec.probe.status && said) {
        console.log(`  ${green("ok")}    ${name} ${dim(`(refused a bad token in its own words, as it should)`)}`);
      } else if ((res.status === 401 || res.status === 403) && !said) {
        console.log(`  ${red("FAIL")}  ${name} answered ${res.status} with no sentence of its own`);
        console.log(`        that is the gateway: redeploy with --no-verify-jwt, or no guest can pay`);
        failures++;
      } else {
        console.log(`  ${red("FAIL")}  ${name} answered ${res.status}, expected ${spec.probe.status} with "${spec.probe.key}"`);
        console.log(`        got ${JSON.stringify(body)?.slice(0, 120)}`);
        failures++;
      }
    } catch (err) {
      console.log(`  ${red("FAIL")}  ${name} — ${err.message}`);
      failures++;
    }
    continue;
  }
  try {
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status === 401 || res.status === 403) {
      console.log(`  ${red("FAIL")}  ${name} answered ${res.status}`);
      console.log(`        redeploy with --no-verify-jwt, or a guest can never book`);
      failures++;
      continue;
    }
    if (res.status === 404) {
      console.log(`  ${red("FAIL")}  ${name} is not deployed`);
      failures++;
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body.ok !== "boolean" || !Array.isArray(body.errors)) {
      console.log(`  ${red("FAIL")}  ${name} did not answer in the expected shape`);
      console.log(`        expected { ok: boolean, errors: string[] }, got ${JSON.stringify(body)?.slice(0, 120)}`);
      failures++;
      continue;
    }
    console.log(`  ${green("ok")}    ${name} ${dim(`(refused an empty request, as it should)`)}`);

    // b0.13 - THE LIVE QUOTE. A quote for no camper must be refused AS A
    // QUOTE: ok:false, quote:true, a sentence. A deploy from before CRM v6.03
    // answers without `quote`, and the quote box would show "couldn't work out
    // a total" on every camper. Nothing is written either way.
    if (spec.quote) {
      const q = await fetch(`${url}/functions/v1/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: true, addons: [] }),
      });
      const qb = await q.json().catch(() => null);
      if (qb && qb.ok === false && qb.quote === true && Array.isArray(qb.errors) && qb.errors.length) {
        console.log(`  ${green("ok")}    ${name} quote ${dim(`(refused a quote for no camper, as a quote)`)}`);
      } else {
        console.log(`  ${red("FAIL")}  ${name} does not answer { quote: true } — deploy CRM v6.03 before this site`);
        console.log(`        got ${q.status} ${JSON.stringify(qb)?.slice(0, 120)}`);
        failures++;
      }
    }
  } catch (err) {
    console.log(`  ${red("FAIL")}  ${name} — ${err.message}`);
    failures++;
  }
}

// ----------------------------------------------------------------------------
// b0.11 — THE DEPLOYED SITE. Reachable, and naming the right origin.
// ----------------------------------------------------------------------------
// The one check in this repo that looks ABOVE the repo. On 2026-09-21 the site
// had been answering 401 to every visitor since the day it was created — a
// Netlify visibility setting, invisible to every offline guard, while b0.8's
// tests correctly asserted that the two files the repo owns said "public".
//
// WHAT IT PROVES, AND WHAT IT DOES NOT. It describes PRODUCTION AS IT STANDS
// RIGHT NOW, not the commit about to be pushed — the deploy being checked is
// the previous one. That is still the check worth having, because the failure
// it catches is a setting nobody changed in git at all.
//
// CONTRACT_SITE_URL is required rather than defaulted. A default would be the
// origin written down in a fifth place, which is the exact thing b0.10 removed.
const siteUrl = String(env.CONTRACT_SITE_URL ?? "").trim().replace(/\/+$/, "");
if (!siteUrl) {
  console.log(`\n  ${red("CONTRACT_SITE_URL is not set")} — the deployed site was not checked.`);
  console.log(`        Add it to .env, e.g.  CONTRACT_SITE_URL=https://book.centexrvrentals.com`);
  console.log(dim(`        Not defaulted on purpose: a default is the origin written down again.`));
  failures++;
} else {
  const grab = async (p) => {
    try {
      const res = await fetch(`${siteUrl}${p}`, { redirect: "follow" });
      return { status: res.status, text: await res.text() };
    } catch (err) {
      return { error: err.message };
    }
  };
  const [root, robotsPage, sitemapPage] = await Promise.all([grab("/"), grab("/robots.txt"), grab("/sitemap.xml")]);
  const { problems, unreachable } = liveSiteProblems({
    origin: siteUrl,
    root,
    robots: robotsPage,
    sitemap: sitemapPage,
  });

  if (problems.length) {
    console.log(`  ${red("FAIL")}  ${siteUrl}`);
    for (const p of problems) console.log(`        ${p}`);
    failures++;
  } else if (unreachable.length) {
    // The wifi, almost always. Warn — never fail a delivery over a dropped
    // connection, for the same reason this whole script is not in preship.
    console.log(`  ${red("SKIP")}  ${siteUrl} could not be reached — UNCHECKED`);
    for (const u of unreachable) console.log(`        ${u}`);
    warnings++;
  } else {
    const locs = (sitemapPage.text.match(/<loc>/g) || []).length;
    console.log(`  ${green("ok")}    ${siteUrl} ${dim(`(public, origin agrees, ${locs} sitemap URLs)`)}`);
  }
}

console.log("");
if (failures) {
  console.log(`  ${red(`${failures} contract failure(s).`)} Do not ship against this database.\n`);
  process.exit(1);
}
if (warnings) {
  console.log(`  ${green("Contract holds")}, with ${warnings} thing(s) worth reading above.\n`);
  process.exit(0);
}
console.log(`  ${green("Contract holds.")}\n`);
