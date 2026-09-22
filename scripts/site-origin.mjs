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

// b0.11 — WHAT A LIVE PAGE'S STATUS MEANS, IN A SENTENCE.
//
// Written because of the swap-over's own bug: on 2026-09-21 the site had been
// serving 401 to every visitor since it was created. Netlify's team defaults
// new projects to private, this one was explicitly Private for production, and
// NOTHING in this repo could see it — b0.8 flipped the robots meta tag and
// robots.txt, which are the only signals the repo owns, and said "the site is
// public" in three places while every guest got a Netlify login page.
//
// A guard that lives in the repo cannot check a setting that lives above the
// repo. The only thing that can is a request. So `npm run contract` makes one.
// 401 AND 403 ARE NOT THE SAME CLAIM, and the first draft of this said they
// were. Netlify's team protection answers 401 — verified against the live site
// on 2026-09-21, which redirects to app.netlify.com/edge-access. A 403 is
// somebody ELSE saying no: a firewall rule, a WAF, or a proxy between you and
// the site. Writing one confident sentence for both was caught by running this
// from a sandboxed container, whose egress proxy returns 403 — and the check
// cheerfully announced that a site I had just loaded in a browser was private.
// A guard that states the wrong cause with confidence costs more than one that
// says less.
export function reachabilityProblem(label, status) {
  if (status === 200) return null;
  if (status === 401) {
    return `${label} answered 401 — THE SITE IS PRIVATE. ` +
      "Netlify: the project's Visitor access (Project configuration), and the team " +
      "default above it. A site nobody can open ranks for nothing, takes no bookings, " +
      "and shows a login page to a guest Stripe just redirected back.";
  }
  if (status === 403) {
    return `${label} answered 403 — something refused the request. Netlify's visitor ` +
      "access, a firewall or WAF rule, or a proxy between this machine and the site. " +
      "Open it in a browser: if it loads there, the refusal is local to this machine.";
  }
  if (status === 404) return `${label} answered 404 — is the deploy published, and did the build emit this file?`;
  if (status >= 500) return `${label} answered ${status} — the deploy is serving an error.`;
  return `${label} answered ${status}, expected 200.`;
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

// The whole live check, as a pure function so preship covers it with the
// network nowhere in sight. Each page is { status, text } when it was fetched,
// or { error } when the fetch itself threw.
//
// TWO KINDS OF BAD, AND THEY ARE NOT THE SAME KIND. A page that could not be
// reached at all is almost always the wifi; a page that answered and answered
// WRONG is the deploy. The caller FAILS on `problems` and only WARNS on
// `unreachable`, for the same reason this repo keeps the contract check out of
// preship: a gate that cries about a dropped connection is a gate people learn
// to ignore.
export function liveSiteProblems({ origin, root, robots, sitemap }) {
  const problems = [];
  const unreachable = [];
  const pages = { "/": root, "/robots.txt": robots, "/sitemap.xml": sitemap };

  // ONE FAULT, ONE MESSAGE. When every page answers the same non-200 — which
  // is what a private site, an unpublished deploy or a proxy all look like —
  // that is one fact about the site, not three about its paths. The first
  // draft printed the same paragraph three times and buried it.
  const fetched = Object.entries(pages).filter(([, p]) => p && !p.error);
  const failed = fetched.filter(([, p]) => p.status !== 200);
  const oneCause =
    failed.length > 1 &&
    failed.length === fetched.length &&
    new Set(failed.map(([, p]) => p.status)).size === 1;

  for (const [label, page] of Object.entries(pages)) {
    if (!page || page.error) {
      unreachable.push(`${label} — ${page?.error || "not fetched"}`);
      continue;
    }
    if (oneCause) continue;
    const bad = reachabilityProblem(label, page.status);
    if (bad) problems.push(bad);
  }
  if (oneCause) problems.push(reachabilityProblem("the site", failed[0][1].status));

  // Content is only compared for pages that actually arrived with a 200.
  // Asserting the canonical of a Netlify login page would produce a second,
  // louder failure about entirely the wrong thing, and bury the first.
  const ok = (p) => Boolean(p) && !p.error && p.status === 200;
  const checkable = [root, robots, sitemap].filter(ok);
  if (checkable.length) {
    problems.push(
      ...originMismatches({
        origin,
        // A page that did not arrive is passed as its own correct value, so it
        // contributes no findings of its own — it has already been reported
        // above as unreachable or wrong-status, and one fault should produce
        // one message.
        indexHtml: ok(root)
          ? root.text
          : `<link rel="canonical" href="${origin}/" /><meta property="og:url" content="${origin}/" />`,
        robots: ok(robots) ? robots.text : robotsTxt(origin),
        sitemap: ok(sitemap) ? sitemap.text : `<loc>${origin}/</loc>`,
      })
    );
  }

  return { problems, unreachable };
}
