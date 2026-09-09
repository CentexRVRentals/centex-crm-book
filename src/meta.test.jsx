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
// SWAP-OVER. DELETE THIS BLOCK WHEN THE SITE GOES LIVE.
// ============================================================================
describe("the site is still hidden from search — DELETE AT SWAP-OVER", () => {
  it("CRITICAL: index.html still says noindex", () => {
    // Correct today: the site is reviewable and linked from nowhere. A
    // half-built site in Google is much harder to undo than to prevent.
    //
    // AT SWAP-OVER: remove the robots meta tag from index.html, and delete
    // this case. If this fails, either you are launching — in which case
    // delete it — or somebody removed the tag by accident, which is the other
    // reason this exists.
    expect(
      read("index.html"),
      "index.html no longer says noindex. Launching? Delete this test AND the robots.txt one below."
    ).toMatch(/name="robots"\s+content="noindex/);
  });

  it("CRITICAL: robots.txt still disallows everything", () => {
    // Both, or neither. A meta tag and a robots.txt that disagree fail
    // silently — one says hide, the other says index, and which wins depends
    // on the crawler.
    expect(
      read("public/robots.txt"),
      "robots.txt no longer disallows. Launching? Delete this test AND the noindex one above."
    ).toMatch(/^Disallow:\s*\/$/m);
  });

  it("CRITICAL: the two agree with each other", () => {
    // The case that catches a half-done swap-over: one changed, the other
    // forgotten. That state is worse than either, because the site looks
    // launched and behaves hidden.
    const hidden = /name="robots"\s+content="noindex/.test(read("index.html"));
    const disallowed = /^Disallow:\s*\/$/m.test(read("public/robots.txt"));
    expect(
      hidden,
      hidden === disallowed ? "" : "index.html and robots.txt disagree about whether this site is public. Change both or neither."
    ).toBe(disallowed);
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
