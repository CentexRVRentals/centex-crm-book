#!/usr/bin/env node
//
// Writes public/sitemap.xml from the live fleet. Runs as part of `npm run build`.
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

const SITE = process.env.VITE_SITE_URL || "https://centex-crm-book.netlify.app";

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
  console.log(`  sitemap.xml — ${urls.length} URL(s)${note ? ` (${note})` : ""}`);
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
