import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

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

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // WHEN this bundle was built, in UTC. The version alone cannot tell you
    // whether the deploy actually went out — two builds of b0.4 look identical
    // and one of them might be the one still sitting in Netlify's cache.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
});
