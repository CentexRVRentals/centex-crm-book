// @vitest-environment jsdom
//
// b0.5 — THE VERSION MARKER.
//
// Added because a screenshot of the deployed site could not be told apart from
// a screenshot of the previous release. A missing button read as a bug when it
// was an older bundle, and there was no way to tell from the page which was
// which.
//
// WHAT THIS PROTECTS. Not that the number is *correct* — no test can know
// that. It protects the two ways this kind of marker goes wrong:
//
//   * it stops being injected, so the header renders "bundefined" or throws
//   * somebody hardcodes it, at which point it is a number written in a second
//     place and it will be wrong the week after it is typed
//
// The CRM is a catalogue of the second failure: a lint config describing a
// codebase 15,000 lines smaller than the real one, a schema file missing 28
// columns, a header row claiming a version the app was not running.

import { describe, it, expect } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Header } from "./components/States.jsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("the version comes from package.json and nowhere else", () => {
  it("CRITICAL: vite.config.js injects it from the file, not a literal", () => {
    const cfg = read("vite.config.js");
    expect(cfg).toMatch(/readFileSync\([^)]*package\.json/);
    expect(cfg).toMatch(/__APP_VERSION__:\s*JSON\.stringify\(pkg\.version\)/);
    // A hardcoded version string in the config would defeat the whole point.
    expect(cfg).not.toMatch(/__APP_VERSION__:\s*JSON\.stringify\(\s*["']\d/);
  });

  it("CRITICAL: the build time is injected too", () => {
    // The version alone cannot tell you the DEPLOY happened. Two builds of
    // b0.4 look identical and one of them might be the one still sitting in
    // Netlify's cache.
    expect(read("vite.config.js")).toMatch(/__BUILD_TIME__:\s*JSON\.stringify\(new Date\(\)/);
  });

  it("CRITICAL: no source file hardcodes a version string", () => {
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) files.push(p);
      }
    })(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => {
      const code = fs.readFileSync(f, "utf8")
        .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
      return /["'`]b?\d+\.\d+\.\d+["'`]/.test(code);
    }).map((f) => path.relative(ROOT, f));
    expect(offenders, `these hardcode a version: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("the header shows it", () => {
  it("CRITICAL: the marker renders, on every page", () => {
    // vitest.config.js defines __APP_VERSION__ as "test". If the injection
    // were removed this would throw ReferenceError rather than quietly showing
    // nothing — which is the failure mode worth having.
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(Header))
    );
    expect(html).toContain("btest");
    expect(html).toMatch(/class="ver"/);
  });

  it("CRITICAL: the build time is on the element, for a screenshot to carry", () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(Header))
    );
    expect(html).toMatch(/title="built [^"]*UTC"/);
  });
});

describe("package.json is the one place", () => {
  it("CRITICAL: it has a version at all", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.version, "package.json has no version").toBeTruthy();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("CRITICAL: HANDOVER's stated version matches package.json", () => {
    // The CRM learned this one twice: a header row is a number written in a
    // second place, and it was wrong both times somebody checked.
    const pkg = JSON.parse(read("package.json"));
    const handover = read("HANDOVER.md");
    const stated = /\|\s*\*\*Version\*\*\s*\|\s*`b?([\d.]+)`/.exec(handover);
    expect(stated, "HANDOVER.md has no Version row").toBeTruthy();
    expect(
      stated[1],
      `HANDOVER says b${stated[1]}, package.json says ${pkg.version}`
    ).toBe(pkg.version);
  });
});
