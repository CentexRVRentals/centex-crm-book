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
  reachabilityProblem,
  liveSiteProblems,
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

// ============================================================================
// b0.11 — THE LIVE SITE CHECK
// ============================================================================
// The repo's one look ABOVE itself. These cases exist because on 2026-09-21
// the deployed site had been answering 401 to every visitor since it was
// created, and every offline guard in this repo was correctly green: b0.8's
// tests assert what index.html and robots.txt say, and both said "public".
// The setting that made it private lived in Netlify, where no test can reach.
//
// So the guard is a request, and these tests drive the ANSWERS that request
// can come back with — every one of them, because a negative test that does
// not fail proves nothing.

describe("reachabilityProblem names what a status means", () => {
  it("CRITICAL: 200 is the only clean answer", () => {
    expect(reachabilityProblem("/", 200)).toBe(null);
  });

  it("CRITICAL: 401 says the site is PRIVATE and where to look", () => {
    // The exact bug, and its exact signature: Netlify's team protection
    // answers 401 and redirects to app.netlify.com/edge-access. The message
    // has to name Netlify's visitor access, because the person reading it will
    // otherwise go looking in this repo, where the cause provably is not.
    const msg = reachabilityProblem("/", 401);
    expect(msg).toMatch(/PRIVATE/);
    expect(msg).toMatch(/Visitor access/);
    expect(msg).toMatch(/401/);
  });

  it("CRITICAL: 403 claims LESS — it is not proof of a private site", () => {
    // 401 is Netlify saying "sign in". 403 is somebody else saying no, and
    // that somebody is often local: a container's egress proxy returns 403,
    // which is how the first draft came to announce that a site loading
    // perfectly well in a browser was private.
    const msg = reachabilityProblem("/", 403);
    expect(msg).toMatch(/403/);
    expect(msg).not.toMatch(/IS PRIVATE/);
    expect(msg).toMatch(/firewall|WAF|proxy/);
  });

  it("404 asks whether the deploy published, 5xx says the deploy is erroring", () => {
    expect(reachabilityProblem("/sitemap.xml", 404)).toMatch(/published/);
    expect(reachabilityProblem("/", 500)).toMatch(/serving an error/);
    expect(reachabilityProblem("/", 503)).toMatch(/serving an error/);
  });

  it("an unexpected status is still reported rather than swallowed", () => {
    expect(reachabilityProblem("/", 302)).toMatch(/302, expected 200/);
  });
});

const LIVE = "https://book.example.com";
const livePages = () => ({
  origin: LIVE,
  root: {
    status: 200,
    text: `<link rel="canonical" href="${LIVE}/" /><meta property="og:url" content="${LIVE}/" />`,
  },
  robots: { status: 200, text: robotsTxt(LIVE) },
  sitemap: { status: 200, text: `<urlset><url><loc>${LIVE}/</loc></url><url><loc>${LIVE}/camper/u1</loc></url></urlset>` },
});

describe("liveSiteProblems separates a broken deploy from a dropped connection", () => {
  it("CRITICAL: a healthy public deploy reports nothing at all", () => {
    expect(liveSiteProblems(livePages())).toEqual({ problems: [], unreachable: [] });
  });

  it("CRITICAL: a private site is a PROBLEM, not a warning", () => {
    // This is the whole point of the release. If it landed in `unreachable`
    // the contract check would warn and pass, and the site would stay private.
    const pages = livePages();
    pages.root = { status: 401, text: "Sign in with an invited Netlify account" };
    const { problems, unreachable } = liveSiteProblems(pages);
    expect(unreachable).toEqual([]);
    expect(problems.some((p) => /PRIVATE/.test(p))).toBe(true);
  });

  it("CRITICAL: a private site produces ONE finding, not a pile of origin noise", () => {
    // A Netlify login page has no canonical, no og:url and no Sitemap line. If
    // its body were fed to originMismatches the real cause would be buried
    // under four confident, irrelevant failures about the wrong document. And
    // three pages answering 401 is ONE fact about the site, not three.
    const login = { status: 401, text: "Sign in with an invited Netlify account" };
    const { problems } = liveSiteProblems({ origin: LIVE, root: login, robots: login, sitemap: login });
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/PRIVATE/);
    expect(problems[0]).toMatch(/the site answered 401/);
  });

  it("CRITICAL: 403 does NOT claim the site is private — it names the alternatives", () => {
    // Found by running this from a sandboxed container: the egress proxy
    // answers 403, and the first draft announced that a site loading fine in a
    // browser was private. State the cause you can prove.
    const blocked = { status: 403, text: "" };
    const { problems } = liveSiteProblems({ origin: LIVE, root: blocked, robots: blocked, sitemap: blocked });
    expect(problems.length).toBe(1);
    expect(problems[0]).not.toMatch(/IS PRIVATE/);
    expect(problems[0]).toMatch(/firewall|proxy/);
    expect(problems[0]).toMatch(/Open it in a browser/);
  });

  it("CRITICAL: pages failing for DIFFERENT reasons are reported separately", () => {
    // The collapse must not hide a second, different fault. A live site with
    // one missing artifact is not the same shape as a private site.
    const pages = livePages();
    pages.sitemap = { status: 404, text: "" };
    const { problems } = liveSiteProblems(pages);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/\/sitemap\.xml answered 404/);
  });

  it("CRITICAL: a fetch that threw is UNREACHABLE, so the wifi cannot fail a delivery", () => {
    const pages = livePages();
    pages.root = { error: "getaddrinfo ENOTFOUND book.example.com" };
    const { problems, unreachable } = liveSiteProblems(pages);
    expect(problems).toEqual([]);
    expect(unreachable.length).toBe(1);
    expect(unreachable[0]).toMatch(/ENOTFOUND/);
  });

  it("CRITICAL: a reachable site serving yesterday's origin is a PROBLEM", () => {
    // The other half of b0.10: the site is up, and pointing at the old host.
    const pages = livePages();
    pages.root = {
      status: 200,
      text: `<link rel="canonical" href="https://${OLD_HOST}/" /><meta property="og:url" content="${LIVE}/" />`,
    };
    const { problems } = liveSiteProblems(pages);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/canonical/);
  });

  it("CRITICAL: a sitemap entry on another host is caught live, not just at build", () => {
    const pages = livePages();
    pages.sitemap = { status: 200, text: `<loc>${LIVE}/</loc><loc>https://${OLD_HOST}/camper/u1</loc>` };
    expect(liveSiteProblems(pages).problems.some((p) => /sitemap\.xml names/.test(p))).toBe(true);
  });

  it("CRITICAL: a deploy that shipped the placeholder is caught live", () => {
    const pages = livePages();
    pages.root = {
      status: 200,
      text: `<link rel="canonical" href="${ORIGIN_PLACEHOLDER}/" /><meta property="og:url" content="${ORIGIN_PLACEHOLDER}/" />`,
    };
    expect(liveSiteProblems(pages).problems.some((p) => p.includes(ORIGIN_PLACEHOLDER))).toBe(true);
  });

  it("everything unreachable checks no content and asserts nothing about it", () => {
    const gone = { error: "fetch failed" };
    const { problems, unreachable } = liveSiteProblems({ origin: LIVE, root: gone, robots: gone, sitemap: gone });
    expect(problems).toEqual([]);
    expect(unreachable.length).toBe(3);
  });

  it("a missing page object is treated as unreachable rather than throwing", () => {
    expect(() => liveSiteProblems({ origin: LIVE })).not.toThrow();
    expect(liveSiteProblems({ origin: LIVE }).unreachable.length).toBe(3);
  });
});

describe("the contract script runs the live check", () => {
  const src = read("scripts/contract.mjs").replace(/^\s*\/\/.*$/gm, "");

  // A BLOCK, BY BRACE MATCHING — not a regex window over the whole file.
  //
  // The first draft of the three tests below asserted /if \(!siteUrl\) \{[\s\S]*?failures\+\+/
  // against the whole source. Mutating that block's `failures++` to `warnings++`
  // left all of them GREEN, because the lazy window simply ran on and found a
  // `failures++` in a later branch. A guard that cannot fail is not a guard;
  // this is the CRM's whole-file-window hazard, reproduced exactly.
  function block(anchor) {
    const start = src.indexOf(anchor);
    if (start === -1) return "";
    const open = src.indexOf("{", start);
    if (open === -1) return "";
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    return "";
  }

  it("CRITICAL: it imports and calls liveSiteProblems", () => {
    expect(src).toMatch(/import \{ liveSiteProblems \} from "\.\/site-origin\.mjs"/);
    expect(src).toMatch(/liveSiteProblems\(\{/);
  });

  it("CRITICAL: CONTRACT_SITE_URL is required, not defaulted to a hostname", () => {
    // A default would be the origin written down in a fifth place — the exact
    // thing b0.10 removed. Absent means fail, loudly.
    expect(src).toMatch(/CONTRACT_SITE_URL/);
    expect(src).not.toMatch(/CONTRACT_SITE_URL[^\n]*\|\|[^\n]*https?:\/\//);

    const unset = block("if (!siteUrl)");
    expect(unset, "could not find the unset-CONTRACT_SITE_URL block").not.toBe("");
    expect(unset, "an unset CONTRACT_SITE_URL must count as a FAILURE").toMatch(/failures\+\+/);
    expect(unset, "an unset CONTRACT_SITE_URL must not merely warn").not.toMatch(/warnings\+\+/);
  });

  it("CRITICAL: problems fail and unreachable only warns", () => {
    const bad = block("if (problems.length)");
    const unreachable = block("else if (unreachable.length)");
    expect(bad, "could not find the problems block").not.toBe("");
    expect(unreachable, "could not find the unreachable block").not.toBe("");

    expect(bad, "a misconfigured deploy must FAIL").toMatch(/failures\+\+/);
    expect(bad, "a misconfigured deploy must not merely warn").not.toMatch(/warnings\+\+/);

    // The other direction, and it matters just as much: a dropped connection
    // must never fail a delivery, or this becomes a gate people skip.
    expect(unreachable, "an unreachable site must only WARN").toMatch(/warnings\+\+/);
    expect(unreachable, "an unreachable site must not fail the run").not.toMatch(/failures\+\+/);
  });

  it("CRITICAL: the live check never creates a booking", () => {
    // The Edge Function section posts deliberately-invalid bodies for the same
    // reason. This one only ever GETs; a POST here would leave a held booking
    // behind on every run.
    const liveSection = src.slice(src.indexOf("const siteUrl"));
    expect(liveSection).not.toMatch(/method:\s*["']POST["']/);
  });
});
