#!/usr/bin/env node
//
// Writes public/sitemap.xml from the live fleet — and public/robots.txt, whose
// Sitemap line names the same origin. Runs as part of `npm run build`.
//
// ============================================================================
// GENERATED, NOT WRITTEN
// ============================================================================
// A hand-written sitemap listing eleven campers is a list that goes wrong the
// first time one is retired or a new one is added — and nothing would ever
// tell you. It would keep pointing search engines at a page that 404s and
// omitting the camper you just bought.
//
// This queries public_listings, which is the same view the site reads, so the
// sitemap and the site cannot disagree about which campers exist.
//
// ============================================================================
// IT NEVER FAILS THE BUILD
// ============================================================================
// If the query fails — no network on the build machine, a bad key, Supabase
// down — it writes a sitemap containing the homepage and carries on.
//
// That is deliberate and worth defending. A stale or thin sitemap costs a
// little search visibility for a day. A failed build costs the whole deploy,
// including whatever fix was in it. The failure modes are not comparable, and
// a sitemap is not worth blocking a release over.
//
// It says loudly what it did, so a thin sitemap is never a silent one.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readDotEnv, siteOrigin, robotsTxt } from "./site-origin.mjs";

const env = readDotEnv();

// b0.10 \u2014 THE ORIGIN COMES FROM ONE PLACE. VITE_SITE_URL, else Netlify's own
// URL, else localhost \u2014 see site-origin.mjs. The netlify.app fallback that
// used to sit here is gone: a build that cannot find its origin says
// localhost, which is visibly wrong, rather than a hostname that is wrong
// quietly.
const SITE = siteOrigin(env);
const today = new Date().toISOString().slice(0, 10);

function write(urls, note) {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
          `    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join("\n") +
    `\n</urlset>\n`;
  fs.mkdirSync(path.join(process.cwd(), "public"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "public", "sitemap.xml"), xml);
  // robots.txt is generated here because its Sitemap line is an absolute URL,
  // and an absolute URL is the origin written down. Same origin, same moment.
  fs.writeFileSync(path.join(process.cwd(), "public", "robots.txt"), robotsTxt(SITE));
  console.log(`  sitemap.xml — ${urls.length} URL(s) at ${SITE}${note ? ` (${note})` : ""}`);
  console.log(`  robots.txt  — Sitemap: ${SITE}/sitemap.xml`);
}

// The homepage is always in it, whatever else happens.
const home = { loc: `${SITE}/`, freq: "daily", priority: "1.0" };

if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  write([home], "\x1b[31mno database credentials — campers omitted\x1b[0m");
  process.exit(0);
}

try {
  const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.from("public_listings").select("unit_id");
  if (error) throw error;

  const campers = (data || [])
    .map((r) => r?.unit_id)
    .filter((id) => typeof id === "string" && id.trim())
    // encodeURIComponent, because a unit_id is whatever the CRM put in
    // legacy_id — and a raw & or space in a <loc> makes the whole file
    // invalid, which is worse than omitting one camper.
    .map((id) => ({ loc: `${SITE}/camper/${encodeURIComponent(id)}`, freq: "weekly", priority: "0.8" }));

  if (!campers.length) {
    write([home], "\x1b[31mno campers returned — is the fleet listed?\x1b[0m");
    process.exit(0);
  }
  write([home, ...campers]);
} catch (err) {
  write([home], `\x1b[31mquery failed: ${err.message} — campers omitted\x1b[0m`);
}
