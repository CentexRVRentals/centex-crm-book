import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { readDotEnv, siteOrigin, ORIGIN_PLACEHOLDER } from "./scripts/site-origin.mjs";

// THE VERSION COMES FROM package.json, ALWAYS.
//
// Not a constant in a source file. The CRM has a whole section of hard-won
// notes about numbers written down in a second place: a lint config describing
// a codebase 15,000 lines smaller than the real one, a schema file missing 28
// columns, a header row claiming a version the app was not running. Every one
// of them was true the day it was typed.
//
// One number, one file, injected at build. There is nothing to keep in sync.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// THE ORIGIN COMES FROM scripts/site-origin.mjs, ALWAYS (b0.10).
//
// Same reasoning, with a hostname in it. index.html carries __SITE_ORIGIN__ in
// its canonical and og:url — the two tags a text-message preview reads, and
// previews do not run JavaScript — and this plugin stamps the real origin in
// at build and in dev. sitemap.mjs and check-bundle.mjs derive it from the
// same function, and check-bundle refuses a build where they disagree.
const SITE_ORIGIN = siteOrigin(readDotEnv());

function stampSiteOrigin() {
  return {
    name: "centex-site-origin",
    transformIndexHtml(html) {
      return html.replaceAll(ORIGIN_PLACEHOLDER, SITE_ORIGIN);
    },
  };
}

export default defineConfig({
  plugins: [react(), stampSiteOrigin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // WHEN this bundle was built, in UTC. The version alone cannot tell you
    // whether the deploy actually went out — two builds of b0.4 look identical
    // and one of them might be the one still sitting in Netlify's cache.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
});
