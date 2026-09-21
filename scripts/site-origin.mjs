// scripts/site-origin.mjs
//
// b0.10 — THE SITE'S PUBLIC ORIGIN, DECIDED ONCE.
//
// ============================================================================
// WHY THIS FILE EXISTS
// ============================================================================
// Through b0.9 the origin was written in four places: index.html's canonical
// and og:url, robots.txt's Sitemap line, and a fallback in sitemap.mjs. All
// four named the site's netlify.app address, which was true right up to the
// day the site got its own hostname — and then every text-message preview,
// every crawler and every sitemap entry would have kept pointing at the old
// one, silently, because nothing compared them to anything. (The sweep in
// src/site-origin.test.js looks for that full hostname, which is why this
// comment does not spell it out.)
//
// The CRM has a whole section of notes about numbers written in a second
// place. An origin is the same thing with a hostname in it.
//
// So: one derivation, imported by vite.config.js (which stamps it into
// index.html), sitemap.mjs (which writes sitemap.xml AND robots.txt from it)
// and check-bundle.mjs (which fails the build if the three artifacts disagree).
//
// ============================================================================
// WHERE THE VALUE COMES FROM, IN ORDER
// ============================================================================
//   1. VITE_SITE_URL   — an explicit override, set in Netlify or in .env.
//   2. URL             — Netlify's own build variable: "the main address to
//                        your site ... your own custom domain if you set one".
//                        It becomes the custom domain the moment that domain
//                        is made primary, with nothing to configure.
//   3. localhost       — a build on a machine with neither. A LOCAL build must
//                        still be internally consistent, so this is a real
//                        origin and not an error.
//
// The old netlify.app fallback is deliberately NOT here. A build that cannot
// find its origin must say localhost, which is obviously wrong in a screenshot,
// rather than a plausible hostname that is wrong quietly.

import fs from "node:fs";
import path from "node:path";

export const LOCAL_ORIGIN = "http://localhost:5173";

// The placeholder index.html carries in place of the origin. vite.config.js
// replaces it at build (and in dev); check-bundle refuses a build where it
// survived.
export const ORIGIN_PLACEHOLDER = "__SITE_ORIGIN__";

// A scheme and a host, nothing after. A value with a path would produce
// "https://x/booking//camper/…" everywhere, so it is rejected rather than
// trimmed — trimming would hide a misconfiguration that deserves to be seen.
const ORIGIN_SHAPE = /^https?:\/\/[^/\s?#]+$/;

export function siteOrigin(env = process.env) {
  for (const raw of [env?.VITE_SITE_URL, env?.URL]) {
    const value = String(raw ?? "").trim().replace(/\/+$/, "");
    if (ORIGIN_SHAPE.test(value)) return value;
  }
  return LOCAL_ORIGIN;
}

// .env, merged UNDER process.env. Vite reads .env itself for the bundle, but
// the scripts around the build do not, and the origin has to be decided from
// the same inputs in all three places or the consistency check below is
// checking three different questions.
export function readDotEnv(cwd = process.cwd(), base = process.env) {
  const out = { ...base };
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// robots.txt is GENERATED from this, because its Sitemap line must be an
// absolute URL and an absolute URL is an origin written down. The policy
// lines are the b0.8 ones and change together with the robots meta tag in
// index.html, or not at all — meta.test.jsx holds the two to that.
export function robotsTxt(origin) {
  return [
    "# GENERATED at build by scripts/sitemap.mjs from scripts/site-origin.mjs.",
    "# Edit the template there; this file is not in git.",
    "#",
    "# b0.8 — the site is public. This and the robots meta tag in index.html",
    "# change together, or not at all.",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

// After a build: does everything that names the origin name the SAME one?
// Returns a list of problems, empty when the build is consistent. Consistency
// is the property — not any particular hostname — so a local build with no
// environment passes on localhost and a Netlify build passes on the domain.
export function originMismatches({ origin, indexHtml, robots, sitemap }) {
  const problems = [];
  const home = `${origin}/`;

  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(indexHtml ?? "")?.[1];
  if (canonical !== home) problems.push(`index.html canonical is ${canonical ?? "missing"}, expected ${home}`);

  const og = /<meta property="og:url" content="([^"]*)"/.exec(indexHtml ?? "")?.[1];
  if (og !== home) problems.push(`index.html og:url is ${og ?? "missing"}, expected ${home}`);

  if ((indexHtml ?? "").includes(ORIGIN_PLACEHOLDER)) {
    problems.push(`index.html still contains ${ORIGIN_PLACEHOLDER} — the build did not stamp the origin`);
  }

  const sitemapLine = /^Sitemap:\s*(\S+)\s*$/m.exec(robots ?? "")?.[1];
  if (sitemapLine !== `${origin}/sitemap.xml`) {
    problems.push(`robots.txt Sitemap is ${sitemapLine ?? "missing"}, expected ${origin}/sitemap.xml`);
  }

  const locs = [...(sitemap ?? "").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) problems.push("sitemap.xml has no <loc> entries");
  for (const loc of locs) {
    if (!loc.startsWith(home)) problems.push(`sitemap.xml names ${loc}, which is not under ${origin}`);
  }

  return problems;
}
