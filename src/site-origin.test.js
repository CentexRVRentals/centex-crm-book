// @vitest-environment node
//
// b0.10 — THE ORIGIN IS DECIDED ONCE, AND NOTHING ELSE MAY NAME IT.
//
// Through b0.9 the hostname was written in index.html twice, in robots.txt,
// and as a fallback in sitemap.mjs. The day the site got its own domain,
// all four would have gone on saying netlify.app — silently, because nothing
// compared them to anything. These tests hold three properties:
//
//   1. siteOrigin() prefers the explicit override, then Netlify's own URL,
//      then localhost — and never invents a hostname.
//   2. originMismatches() actually FAILS on each way a build can disagree
//      with itself. A negative test that does not fail proves nothing
//      (the CRM's process correction 6), so every mismatch is driven.
//   3. No source file names the old origin, and index.html carries the
//      placeholder rather than a literal.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_ORIGIN,
  ORIGIN_PLACEHOLDER,
  siteOrigin,
  robotsTxt,
  originMismatches,
} from "../scripts/site-origin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Built from parts so this file cannot match its own guard.
const OLD_HOST = ["centex-crm-book", "netlify", "app"].join(".");

describe("siteOrigin decides the origin from the environment, in order", () => {
  it("CRITICAL: VITE_SITE_URL wins when set", () => {
    expect(siteOrigin({ VITE_SITE_URL: "https://book.example.com", URL: "https://x.netlify.app" }))
      .toBe("https://book.example.com");
  });

  it("CRITICAL: Netlify's URL is used when there is no override", () => {
    // The main address of the site, which becomes the custom domain the
    // moment it is made primary — no configuration step to forget.
    expect(siteOrigin({ URL: "https://book.example.com" })).toBe("https://book.example.com");
  });

  it("CRITICAL: with neither it says localhost, never a plausible hostname", () => {
    // The old fallback was the netlify.app address. A build that cannot find
    // its origin must be visibly wrong, not quietly wrong.
    expect(siteOrigin({})).toBe(LOCAL_ORIGIN);
    expect(siteOrigin(undefined)).toBe(LOCAL_ORIGIN);
    expect(siteOrigin({})).not.toContain(OLD_HOST);
  });

  it("trailing slashes are stripped, so paths do not double up", () => {
    expect(siteOrigin({ VITE_SITE_URL: "https://book.example.com/" })).toBe("https://book.example.com");
    expect(siteOrigin({ VITE_SITE_URL: "https://book.example.com///" })).toBe("https://book.example.com");
  });

  it("a value with a path, a query or no scheme is not an origin and falls through", () => {
    // Trimming would hide the misconfiguration; falling through shows it.
    expect(siteOrigin({ VITE_SITE_URL: "https://book.example.com/campers", URL: "https://ok.example.com" }))
      .toBe("https://ok.example.com");
    expect(siteOrigin({ VITE_SITE_URL: "book.example.com" })).toBe(LOCAL_ORIGIN);
    expect(siteOrigin({ VITE_SITE_URL: "https://book.example.com?x=1" })).toBe(LOCAL_ORIGIN);
    expect(siteOrigin({ VITE_SITE_URL: "   " })).toBe(LOCAL_ORIGIN);
  });
});

describe("robots.txt is generated from the template", () => {
  const robots = robotsTxt("https://book.example.com");

  it("CRITICAL: it allows crawling and points at the sitemap on the same origin", () => {
    expect(robots).toMatch(/^Allow:\s*\/$/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/$/m);
    expect(robots).toMatch(/^Sitemap:\s*https:\/\/book\.example\.com\/sitemap\.xml$/m);
  });
});

// A consistent build, as check-bundle would read it back out of dist/.
const ORIGIN = "https://book.example.com";
const GOOD = {
  origin: ORIGIN,
  indexHtml:
    `<link rel="canonical" href="${ORIGIN}/" />\n` +
    `<meta property="og:url" content="${ORIGIN}/" />\n`,
  robots: robotsTxt(ORIGIN),
  sitemap:
    `<urlset><url><loc>${ORIGIN}/</loc></url>` +
    `<url><loc>${ORIGIN}/camper/u1</loc></url></urlset>`,
};

describe("originMismatches fails on every way a build can disagree with itself", () => {
  it("CRITICAL: a consistent build has no problems", () => {
    expect(originMismatches(GOOD)).toEqual([]);
  });

  it("CRITICAL: a canonical on another host is named", () => {
    const bad = { ...GOOD, indexHtml: GOOD.indexHtml.replace(`rel="canonical" href="${ORIGIN}/"`, `rel="canonical" href="https://${OLD_HOST}/"`) };
    const problems = originMismatches(bad);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/canonical/);
  });

  it("CRITICAL: an og:url on another host is named", () => {
    const bad = { ...GOOD, indexHtml: GOOD.indexHtml.replace(`og:url" content="${ORIGIN}/"`, `og:url" content="https://${OLD_HOST}/"`) };
    const problems = originMismatches(bad);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/og:url/);
  });

  it("CRITICAL: a surviving placeholder is named", () => {
    // The shape a broken vite plugin leaves behind: the literal token shipped.
    const bad = { ...GOOD, indexHtml: GOOD.indexHtml.replaceAll(ORIGIN, ORIGIN_PLACEHOLDER) };
    const problems = originMismatches(bad);
    expect(problems.some((p) => p.includes(ORIGIN_PLACEHOLDER))).toBe(true);
  });

  it("CRITICAL: a robots.txt Sitemap line on another host is named", () => {
    const bad = { ...GOOD, robots: robotsTxt(`https://${OLD_HOST}`) };
    const problems = originMismatches(bad);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/robots\.txt Sitemap/);
  });

  it("CRITICAL: a missing robots.txt is named", () => {
    expect(originMismatches({ ...GOOD, robots: "" }).some((p) => /robots\.txt Sitemap is missing/.test(p))).toBe(true);
  });

  it("CRITICAL: a sitemap entry on another host is named", () => {
    const bad = { ...GOOD, sitemap: GOOD.sitemap.replace(`${ORIGIN}/camper/u1`, `https://${OLD_HOST}/camper/u1`) };
    const problems = originMismatches(bad);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/sitemap\.xml names/);
  });

  it("CRITICAL: an empty sitemap is named", () => {
    expect(originMismatches({ ...GOOD, sitemap: "<urlset></urlset>" })).toEqual(["sitemap.xml has no <loc> entries"]);
  });
});

describe("nothing in the source names the origin", () => {
  // Everything that ships or builds. Not HANDOVER.md, README.md or the
  // context-upload snapshot, which are documents about the repo, and not the
  // tests, which need the old hostname to prove the guards bite.
  const SWEEP_FILES = ["index.html", "vite.config.js", "vitest.config.js", "eslint.config.js", "package.json"];
  const SWEEP_DIRS = ["src", "scripts", "public"];

  const files = [...SWEEP_FILES.map((f) => path.join(ROOT, f))];
  for (const dir of SWEEP_DIRS) {
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        // public/robots.txt and public/sitemap.xml are GENERATED by the build
        // and carry whatever origin that build derived — legitimately.
        else if (dir === "public" && /^(robots\.txt|sitemap\.xml)$/.test(e.name)) continue;
        else if (!/\.test\.(js|jsx)$/.test(e.name) && !/\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(e.name)) files.push(p);
      }
    })(path.join(ROOT, dir));
  }

  it("CRITICAL: no shipped or build file names the netlify.app origin", () => {
    expect(files.length).toBeGreaterThan(10);
    const offenders = files
      .filter((f) => fs.readFileSync(f, "utf8").includes(OLD_HOST))
      .map((f) => path.relative(ROOT, f));
    expect(offenders, `these name ${OLD_HOST}: ${offenders.join(", ")}`).toEqual([]);
  });

  it("CRITICAL: index.html carries the placeholder, not a literal origin", () => {
    const html = read("index.html");
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="${ORIGIN_PLACEHOLDER}/" />`));
    expect(html).toMatch(new RegExp(`<meta property="og:url" content="${ORIGIN_PLACEHOLDER}/" />`));
  });

  it("CRITICAL: the build derives the origin in all three places and checks them", () => {
    // Code, not comments: the import lines and the calls.
    const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");
    expect(strip(read("vite.config.js"))).toMatch(/import \{[^}]*siteOrigin[^}]*\} from "\.\/scripts\/site-origin\.mjs"/);
    expect(strip(read("vite.config.js"))).toMatch(/transformIndexHtml\(html\)/);
    expect(strip(read("scripts/sitemap.mjs"))).toMatch(/import \{[^}]*robotsTxt[^}]*\} from "\.\/site-origin\.mjs"/);
    expect(strip(read("scripts/sitemap.mjs"))).toMatch(/robotsTxt\(SITE\)/);
    expect(strip(read("scripts/check-bundle.mjs"))).toMatch(/import \{[^}]*originMismatches[^}]*\} from "\.\/site-origin\.mjs"/);
    expect(strip(read("scripts/check-bundle.mjs"))).toMatch(/originMismatches\(\{/);
  });

  it("CRITICAL: the generated files and the CLI scratch directory are not in git", () => {
    const ignore = read(".gitignore");
    for (const entry of ["public/robots.txt", "public/sitemap.xml", "supabase/.temp/"]) {
      expect(ignore, `.gitignore does not list ${entry}`).toMatch(new RegExp(`^${entry.replace(/[.\/]/g, "\\$&")}$`, "m"));
    }
  });
});
