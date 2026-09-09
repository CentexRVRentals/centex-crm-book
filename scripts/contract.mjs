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

import { createClient } from "@supabase/supabase-js";
import { VIEWS, FUNCTIONS, CONTRACT_VERSION } from "../src/lib/contract.js";
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
  } catch (err) {
    console.log(`  ${red("FAIL")}  ${name} — ${err.message}`);
    failures++;
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
