// @vitest-environment jsdom
//
// b0.6 — METADATA, AND THE THINGS THAT MUST CHANGE AT SWAP-OVER.
//
// The second half of this file is unusual and deliberate: it ASSERTS THAT THE
// SITE IS STILL HIDDEN. `noindex` in index.html and `Disallow: /` in
// robots.txt are correct today and wrong the moment the link goes live, and
// the failure mode of forgetting them is silent — the site launches and ranks
// for nothing, and nobody finds out for weeks.
//
// So the tests fail LOUDLY when they are removed, with the instruction to
// delete these cases as part of the swap-over. A guard that has to be deleted
// on purpose is a guard that cannot be forgotten.
//
// The CRM has the same shape in driver-booking-writes.test.js, which asserts a
// known gap so the remaining half cannot be forgotten once the expensive half
// is fixed.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { camperMeta } from "./lib/meta.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const LISTING = {
  unitId: "u1", name: "Igloo", year: 2021, make: "Jayco", model: "Jay Flight",
  sleeps: 8, pricePerNight: 109,
};

describe("a camper page describes itself", () => {
  it("CRITICAL: the title names the camper, not just the company", () => {
    // Eleven pages with identical titles rank as one page.
    const m = camperMeta(LISTING, "https://x.test/cover.jpg");
    expect(m.title).toContain("Igloo");
    expect(m.title).toContain("Jayco");
    expect(m.title).toContain("Centex RV Rentals");
    expect(m.path).toBe("/camper/u1");
  });

  it("CRITICAL: a link pasted into a text message carries a photo", () => {
    // The reason this is worth building at all. Somebody will send a camper to
    // their partner; what arrives is either a picture and a name or a bare URL.
    const m = camperMeta(LISTING, "https://x.test/cover.jpg");
    expect(m.image).toBe("https://x.test/cover.jpg");
  });

  it("CRITICAL: it degrades to the name when the listing has nothing else", () => {
    // Every field but the name and price is optional in the contract.
    const m = camperMeta({ unitId: "u2", name: "Sol" }, null);
    expect(m.title).toContain("Sol");
    expect(m.description).toContain("Centex");
    expect(m.image).toBeUndefined();
    expect(() => camperMeta(null)).not.toThrow();
    expect(camperMeta(null)).toEqual({});
  });

  it("hostile listing values do not throw or leak [object Object]", () => {
    for (const v of [undefined, null, 0, true, {}, [], { a: 1 }]) {
      const m = camperMeta({ unitId: "u", name: "X", year: v, make: v, model: v, sleeps: v, pricePerNight: v });
      expect(JSON.stringify(m)).not.toContain("[object Object]");
    }
  });
});

describe("both pages set their own metadata", () => {
  it("CRITICAL: the camper page and the grid each call usePageMeta", () => {
    // Without the grid setting its own, navigating back from a camper keeps
    // that camper's title in the tab and in a bookmark.
    expect(read("src/pages/Camper.jsx")).toMatch(/usePageMeta\(camperMeta\(/);
    expect(read("src/pages/Listings.jsx")).toMatch(/usePageMeta\(\{/);
  });
});

// ============================================================================
// b0.8 — THE SITE IS LIVE. The block that used to be here asserted the
// opposite, and said to delete it at swap-over. This is what replaced it.
// ============================================================================
// Keeping a pair of tests rather than deleting them, because the risk did not
// go away — it inverted. Before launch the danger was shipping while hidden;
// now it is somebody reintroducing a noindex, or the two files drifting apart.
//
// The third case is the one that matters either way: index.html and robots.txt
// must AGREE. A meta tag saying noindex and a robots.txt saying Allow fail
// silently, and which one wins depends on the crawler.
describe("the site is public, and says so consistently", () => {
  it("CRITICAL: index.html does NOT say noindex", () => {
    expect(
      read("index.html"),
      "index.html has a noindex robots tag. If that is deliberate, change robots.txt to match."
    ).not.toMatch(/name="robots"[^>]*content="[^"]*noindex/);
  });

  it("CRITICAL: robots.txt allows crawling and points at the sitemap", () => {
    const robots = read("public/robots.txt");
    expect(robots, "robots.txt still disallows everything").not.toMatch(/^Disallow:\s*\/$/m);
    expect(robots).toMatch(/^Allow:\s*\/$/m);
    // A sitemap nobody is told about is a sitemap nobody reads.
    expect(robots, "robots.txt does not point at the sitemap").toMatch(/^Sitemap:\s*https?:\/\//m);
  });

  it("CRITICAL: the two files agree with each other", () => {
    // The case that catches a half-done change in EITHER direction. That state
    // is worse than either consistent one, because the site looks like one
    // thing and behaves like the other.
    const hidden = /name="robots"[^>]*content="[^"]*noindex/.test(read("index.html"));
    const disallowed = /^Disallow:\s*\/$/m.test(read("public/robots.txt"));
    expect(
      hidden,
      hidden === disallowed ? "" : "index.html and robots.txt disagree about whether this site is public. Change both or neither."
    ).toBe(disallowed);
  });

  it("CRITICAL: the sitemap is generated, not written by hand", () => {
    // A hand-written list of eleven campers goes wrong the first time one is
    // retired, and nothing would ever say so.
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build, "the build does not generate a sitemap").toMatch(/sitemap/);
    expect(read("scripts/sitemap.mjs")).toMatch(/from\("public_listings"\)/);
  });

  it("CRITICAL: a sitemap failure does not fail the build", () => {
    // A thin sitemap costs a little search visibility for a day. A failed
    // build costs the whole deploy, including whatever fix was in it.
    const src = read("scripts/sitemap.mjs");
    expect(src).toMatch(/catch \(err\)/);
    // Every exit in that script is a zero.
    const exits = [...src.matchAll(/process\.exit\((\d+)\)/g)].map((m) => m[1]);
    expect(exits.length).toBeGreaterThan(0);
    expect(exits.every((c) => c === "0"), `sitemap.mjs exits non-zero somewhere: ${exits.join(", ")}`).toBe(true);
  });
});

describe("line endings are decided, not guessed", () => {
  it("CRITICAL: .gitattributes exists and pins them", () => {
    // Without it Git rewrites LF to CRLF on Windows checkout and back on
    // commit, which shows files as modified that nobody touched and produces
    // diffs nobody wrote.
    expect(read(".gitattributes")).toMatch(/^\*\s+text=auto\s+eol=lf$/m);
  });
});
