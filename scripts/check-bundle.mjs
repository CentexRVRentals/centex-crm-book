#!/usr/bin/env node
//
// Runs after `vite build`. Checks the bundle actually contains the app.
//
// ============================================================================
// WHY THIS EXISTS, and it is not a hypothetical
// ============================================================================
// src/lib/supabase.js throws at module load when VITE_SUPABASE_URL or
// VITE_SUPABASE_ANON_KEY is missing — deliberately, because a site that renders
// an empty fleet looks like a data problem and is not one.
//
// At BUILD time, Vite replaces `import.meta.env.VITE_SUPABASE_URL` with the
// literal value. With no .env that literal is `undefined`, so the guard folds
// to `if (true) throw` — and **everything after it in the module graph becomes
// dead code and is tree-shaken away.**
//
// The build still succeeds. It prints a size. It looks exactly like a good
// build. What it produces is ~250 kB of React and a throw, with no application
// in it at all.
//
// That is how three "clean build" results were reported from a container with
// no .env: the number was real, the bundle was empty, and the check proved
// nothing. A build that cannot fail is not a gate.
//
// WHAT IT CHECKS. That a handful of strings only the app could have put there
// survived into the output. Crude on purpose — a bundle either contains the
// application or it does not, and anything cleverer would need the build
// system's own module graph, which is the thing being doubted.

import fs from "node:fs";
import path from "node:path";
import { readDotEnv, siteOrigin, originMismatches } from "./site-origin.mjs";

const DIST = path.join(process.cwd(), "dist", "assets");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

if (!fs.existsSync(DIST)) {
  console.error(`\n  ${red("No dist/assets — did vite build run?")}\n`);
  process.exit(1);
}

const jsFiles = fs.readdirSync(DIST).filter((f) => f.endsWith(".js"));
if (!jsFiles.length) {
  console.error(`\n  ${red("dist/assets has no JavaScript.")}\n`);
  process.exit(1);
}

const bundle = jsFiles.map((f) => fs.readFileSync(path.join(DIST, f), "utf8")).join("\n");
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

// Strings nothing but this application would produce. Not the only ones that
// could be checked; enough that all of them going missing means the app did.
const MUST_CONTAIN = [
  ["Centex RV Rentals", "the header — the app itself"],
  ["public_listings", "the data layer"],
  ["request-booking", "the write path"],
  ["payment-options", "the pay page (b0.12)"],
  ["Choose your dates", "the date picker"],
  [pkg.version, `the injected version (${pkg.version})`],
];

const missing = MUST_CONTAIN.filter(([needle]) => !bundle.includes(needle));

console.log("");
if (missing.length) {
  console.log(`  ${red("The build produced a bundle with no application in it.")}`);
  console.log(`  ${Math.round(bundle.length / 1024)} kB of JavaScript, missing:\n`);
  for (const [needle, why] of missing) console.log(`    ${red("×")} ${why}  ${needle === pkg.version ? "" : `(${needle})`}`);
  console.log(`
  ALMOST ALWAYS THE ENVIRONMENT. src/lib/supabase.js throws at module load
  when VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is unset; at build time
  that folds to a constant and everything after it is tree-shaken away.

    locally  — check .env has both, non-empty
    Netlify  — Site configuration -> Environment variables, then trigger a
               fresh build. Netlify bakes these in at BUILD time, so adding
               one to an existing site does nothing until the next build.
`);
  process.exit(1);
}

// ----------------------------------------------------------------------------
// The sitemap has to be IN dist, not just generated.
// ----------------------------------------------------------------------------
// Vite copies public/ into dist/ as part of its build. The first version of
// this ran the sitemap generator AFTER vite, so the file was written to
// public/ and never copied — the build passed, printed a size, and shipped no
// sitemap at all. Nothing would have said so until somebody checked Search
// Console weeks later.
const sitemap = path.join(process.cwd(), "dist", "sitemap.xml");
if (!fs.existsSync(sitemap)) {
  console.log(`
  ${red("dist/sitemap.xml is missing.")}

  The generator writes to public/, and vite copies public/ into dist/ — so it
  has to run BEFORE vite, not after. Check the order in package.json's build
  script:

    node scripts/sitemap.mjs && vite build && node scripts/check-bundle.mjs
`);
  process.exit(1);
}
const urls = (fs.readFileSync(sitemap, "utf8").match(/<loc>/g) || []).length;

// ----------------------------------------------------------------------------
// b0.10 — EVERYTHING THAT NAMES THE ORIGIN NAMES THE SAME ONE.
// ----------------------------------------------------------------------------
// index.html's canonical and og:url (stamped by vite.config.js), robots.txt's
// Sitemap line and every <loc> in the sitemap (both written by sitemap.mjs)
// are compared against the origin derived from the SAME inputs. This is the
// one check here that is about consistency rather than presence: a canonical
// pointing at yesterday's hostname is a build that looks fine, ships, and
// sends every text-message preview to the wrong domain.
//
// It fails the build on purpose. The sitemap script never fails a build
// because a THIN sitemap is a small cost; a build whose parts disagree about
// where the site lives is a broken pipeline, not a thin one.
const origin = siteOrigin(readDotEnv());
const problems = originMismatches({
  origin,
  indexHtml: fs.readFileSync(path.join(process.cwd(), "dist", "index.html"), "utf8"),
  robots: fs.existsSync(path.join(process.cwd(), "dist", "robots.txt"))
    ? fs.readFileSync(path.join(process.cwd(), "dist", "robots.txt"), "utf8")
    : "",
  sitemap: fs.readFileSync(sitemap, "utf8"),
});
if (problems.length) {
  console.log(`  ${red("The build disagrees with itself about the site's origin.")}\n`);
  for (const p of problems) console.log(`    ${red("×")} ${p}`);
  console.log(`
  The origin is decided once, in scripts/site-origin.mjs: VITE_SITE_URL, else
  Netlify's URL variable, else localhost. vite.config.js stamps it into
  index.html and sitemap.mjs writes robots.txt and sitemap.xml from it. If
  these disagree, one of those three stopped using it.
`);
  process.exit(1);
}

console.log(`  ${green("Bundle contains the app")} — ${Math.round(bundle.length / 1024)} kB, version ${pkg.version}`);
console.log(`  ${green("Origin agrees everywhere")} — ${origin}`);
console.log(`  ${urls > 1 ? green(`Sitemap: ${urls} URLs`) : red(`Sitemap: ${urls} URL — campers missing, see above`)}\n`);
