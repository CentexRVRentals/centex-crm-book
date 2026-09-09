// b0.1 — WHAT THIS REPO IS NOT ALLOWED TO DO.
//
// Three rules, all of them offline, all of them in preship. The contract check
// that talks to the live database is `npm run contract` and is deliberately
// NOT here: a preship that fails when the wifi drops is a preship people learn
// to ignore.
//
// These are the rules that keep the two repos separable. A guest site that
// imports from the CRM, or reads a base table, or hardcodes a project URL, is a
// guest site that cannot be pointed at a second tenant — and multi-tenancy is
// the reason this is a separate repo at all.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIEWS, FUNCTIONS, FORBIDDEN_TABLES } from "./lib/contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname);

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    // .test.jsx excluded too — b0.2 added render tests, which are JSX.
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.(js|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(SRC);
const CODE = FILES.map((f) => ({
  file: path.relative(SRC, f),
  // Comments stripped: this file and contract.js both DISCUSS the names they
  // forbid, and a naive search matches the explanation rather than a call.
  text: fs.readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n"),
}));

describe("the harness is real", () => {
  it("CRITICAL: there are source files to check (anti-vacuity)", () => {
    // Every case below filters this list. An empty list passes everything.
    expect(FILES.length, "no source files found — the scan is broken").toBeGreaterThan(0);
  });
});

describe("this repo shares no code with the CRM", () => {
  it("CRITICAL: nothing imports from the CRM repo", () => {
    // The whole point of the split. An import across the boundary would ship
    // the authenticated CRM into a bundle strangers download — and would make
    // the two repos one repo with extra steps.
    const offenders = CODE.filter((f) =>
      /from\s+["'][^"']*(centex-crm-app|\.\.\/\.\.\/\.\.\/src\/App)/.test(f.text)
    ).map((f) => f.file);
    expect(offenders, `these import from the CRM: ${offenders.join(", ")}`).toEqual([]);
  });

  it("CRITICAL: no import escapes this repo", () => {
    const offenders = CODE.filter((f) => /from\s+["']\.\.\/\.\.\/\.\.\//.test(f.text)).map((f) => f.file);
    expect(offenders, `these reach outside the repo: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("this repo reads five views and nothing else", () => {
  it("CRITICAL: no source file names a base table", () => {
    // Belt and braces over the anon grant. The grant is the real defence; this
    // makes the mistake visible to a developer instead of returning a
    // permission error some component renders as an empty list.
    const offenders = [];
    for (const f of CODE) {
      for (const table of FORBIDDEN_TABLES) {
        if (new RegExp(`\\.from\\(\\s*["']${table}["']`).test(f.text)) {
          offenders.push(`${f.file} reads ${table}`);
        }
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([]);
  });

  it("CRITICAL: every .from() names a view in the contract", () => {
    // The other direction, and the one that catches a typo. `.from("public_listing")`
    // — singular — returns an error the caller may swallow; here it is a
    // failing test with the name in it.
    const allowed = new Set(Object.keys(VIEWS));
    const offenders = [];
    for (const f of CODE) {
      for (const m of f.text.matchAll(/\.from\(\s*["']([^"']+)["']/g)) {
        if (!allowed.has(m[1])) offenders.push(`${f.file} reads "${m[1]}"`);
      }
    }
    expect(offenders, `not in the contract: ${offenders.join("; ")}`).toEqual([]);
  });

  it("CRITICAL: every function call names a function in the contract", () => {
    const allowed = new Set(Object.keys(FUNCTIONS));
    const offenders = [];
    for (const f of CODE) {
      for (const m of f.text.matchAll(/functions\/v1\/([a-z-]+)/g)) {
        if (!allowed.has(m[1])) offenders.push(`${f.file} calls "${m[1]}"`);
      }
    }
    expect(offenders, `not in the contract: ${offenders.join("; ")}`).toEqual([]);
  });
});

describe("nothing about the tenant is hardcoded", () => {
  it("CRITICAL: no Supabase project URL appears in source", () => {
    // Multi-tenancy is why this is a separate repo. A hardcoded project ref
    // means tenant two is a code change instead of a config value, and the
    // whole reason for the split evaporates quietly.
    const offenders = CODE.filter((f) => /https:\/\/[a-z0-9]{15,}\.supabase\.co/.test(f.text)).map((f) => f.file);
    expect(offenders, `hardcoded project URL in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("CRITICAL: no key of any kind appears in source", () => {
    // A JWT starts eyJ. This catches an anon key pasted in for convenience —
    // harmless in itself, since the anon key is public by design, but the same
    // convenience is how a service role key eventually lands in a repo.
    const offenders = CODE.filter((f) => /eyJ[A-Za-z0-9_-]{20,}/.test(f.text)).map((f) => f.file);
    expect(offenders, `a key is hardcoded in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("CRITICAL: the client is built from environment variables", () => {
    const client = CODE.find((f) => f.file.endsWith(path.join("lib", "supabase.js")));
    expect(client, "src/lib/supabase.js not found").toBeTruthy();
    expect(client.text).toMatch(/import\.meta\.env\.VITE_SUPABASE_URL/);
    expect(client.text).toMatch(/import\.meta\.env\.VITE_SUPABASE_ANON_KEY/);
  });
});

describe("the contract itself is well formed", () => {
  it("CRITICAL: every view declares what it is for and what it needs", () => {
    for (const [name, spec] of Object.entries(VIEWS)) {
      expect(spec.why, `${name} has no stated purpose`).toBeTruthy();
      expect(spec.required.length, `${name} requires nothing — then why is it here?`).toBeGreaterThan(0);
      expect(spec.required, `${name} does not require unit_id`).toContain("unit_id");
    }
  });

  it("CRITICAL: no column is both required and optional", () => {
    for (const [name, spec] of Object.entries(VIEWS)) {
      const both = spec.required.filter((c) => spec.optional.includes(c));
      expect(both, `${name}: ${both.join(", ")} listed twice`).toEqual([]);
    }
  });

  it("CRITICAL: the honeypot field is part of the request contract", () => {
    // The server answers a filled `company` field with a plausible success and
    // writes nothing. If this site stops sending the field, the form loses its
    // cheapest defence and nothing else would notice.
    expect(FUNCTIONS["request-booking"].sends).toContain("company");
  });
});
