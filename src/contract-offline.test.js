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
import { VIEWS, FUNCTIONS, FORBIDDEN_TABLES, OUTSIDE } from "./lib/contract.js";

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

// ============================================================================
// b0.7 — THE GUARD THAT WOULD HAVE CAUGHT THE AMENITIES BUG
// ============================================================================
// public_listing_amenities selects `amenity_group` and `amenity_name`. The
// contract said `name`, `category` and `sort_order` — all three guessed,
// because the table was empty and no row had ever come back. The site read
// `r.name`, got undefined, filtered every amenity out, and the panel silently
// never rendered.
//
// Three things had to line up for that to ship, and each is now checked:
//
//   1. the contract named columns the view does not have — only `npm run
//      contract` can catch that, and it did, the moment data existed
//   2. everything but unit_id was marked OPTIONAL, so the check reported `ok`
//      with a warning rather than failing. A warning is what gets scrolled past
//   3. **the test fixtures used the guessed names too**, so the suite was
//      green against a shape that does not exist anywhere
//
// The third is the one this file can do something about. A fixture is a claim
// about the world, and a fixture nobody checks against the contract is a
// claim that agrees with itself.
describe("fixtures and reads agree with the contract", () => {
  const KNOWN = new Map(Object.entries(VIEWS).map(([v, s]) => [v, new Set([...s.required, ...s.optional])]));

  it("CRITICAL: every column the data layer reads is in the contract", () => {
    // listings.js reads rows as `r?.column_name`. Any snake_case property it
    // reads must be a column the contract knows about — otherwise it is a
    // guess, and a guess that returns undefined filters silently.
    const src = fs.readFileSync(path.join(SRC, "lib", "listings.js"), "utf8");
    const everyKnown = new Set([...KNOWN.values()].flatMap((s) => [...s]));
    const read = [...src.matchAll(/\br\??\.([a-z][a-z0-9]*_[a-z0-9_]+)/g)].map((m) => m[1]);
    expect(read.length, "no snake_case reads found — has the data layer moved?").toBeGreaterThan(5);
    const unknown = [...new Set(read)].filter((c) => !everyKnown.has(c));
    expect(
      unknown,
      `listings.js reads these, and the contract does not list them: ${unknown.join(", ")}. ` +
      "Either add them to contract.js and run `npm run contract`, or they are a guess."
    ).toEqual([]);
  });

  it("CRITICAL: every column in a test fixture is in the contract", () => {
    // The fixtures in browse.test.jsx are built from what the views return.
    // When they were built from GUESSES, the suite was green against a shape
    // that does not exist — which is how the amenities bug reached production
    // with 81 tests passing.
    const fixtures = fs.readFileSync(path.join(SRC, "browse.test.jsx"), "utf8");
    const everyKnown = new Set([...KNOWN.values()].flatMap((s) => [...s]));
    // Object keys that look like database columns, inside the fixture file.
    const keys = [...fixtures.matchAll(/(?:^|[{,\s])([a-z][a-z0-9]*_[a-z0-9_]+):/gm)].map((m) => m[1]);
    expect(keys.length, "no fixture columns found").toBeGreaterThan(10);
    // The fixture file also uses the VIEW names as object keys (the mock's
    // table map), and those are not columns.
    const viewNames = new Set(Object.keys(VIEWS));
    const unknown = [...new Set(keys)].filter((c) => !everyKnown.has(c) && !viewNames.has(c));
    expect(
      unknown,
      `browse.test.jsx uses these column names, and the contract does not list them: ${unknown.join(", ")}. ` +
      "A fixture built from a guess makes the suite agree with itself."
    ).toEqual([]);
  });

  it("CRITICAL: a view whose only required column is unit_id is suspicious", () => {
    // The classification failure. `required` means "what this site cannot
    // render without" — and for every view here that is more than the id.
    // Marking everything else optional out of caution is what turned a
    // contract FAILURE into a warning nobody read.
    const lazy = Object.entries(VIEWS)
      .filter(([, spec]) => spec.required.length === 1 && spec.required[0] === "unit_id")
      // busy_dates is the genuine exception: its other two columns are
      // required and named, so it never reaches here.
      .map(([v]) => v);
    expect(
      lazy,
      `these views require only unit_id: ${lazy.join(", ")}. ` +
      "If the site cannot render without a column, it is required — see the amenities bug."
    ).toEqual([]);
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

  // b0.13 - the live quote is part of the contract, spelled out.
  it("CRITICAL: the quote is declared - what it sends, returns, and what a line is", () => {
    const rb = FUNCTIONS["request-booking"];
    expect(rb.sends).toContain("addons");
    expect(rb.returns).toEqual(expect.arrayContaining(["lines", "subtotalCents", "taxCents", "totalCents"]));
    // b0.16 (CRM v6.09) - no estimates, so no `estimate` anywhere.
    expect(rb.returns).not.toContain("estimate");
    expect(rb.quote.returns).not.toContain("estimate");
    expect(rb.quote.sends).toEqual(expect.arrayContaining(["quote", "unitId", "start", "end", "method", "addons", "address", "city", "state", "zip"]));
    expect(rb.quote.returns).toEqual(expect.arrayContaining(["subtotalCents", "taxCents", "totalCents"]));
    // A quote asks about a STAY: no person, no honeypot, no money.
    for (const k of ["name", "email", "phone", "company", "total", "price", "dryRun"]) expect(rb.quote.sends).not.toContain(k);
    expect(rb.quote.line).toEqual(["kind", "label", "addonId", "quantity", "nights", "unitPriceCents", "amountCents", "miles"]);
    // No tax rate ever reaches the guest (CRM: publicQuote sends amounts only).
    expect(JSON.stringify(rb.quote)).not.toMatch(/rate/i);
    expect(rb.quote.kinds).toEqual(["rental", "prep", "addon", "delivery", "tax"]);
  });

  // b0.16 (CRM v6.09) - the pay page's items are part of the contract too.
  it("CRITICAL: payment-options declares the quote it sends the pay page", () => {
    const po = FUNCTIONS["payment-options"];
    expect(po.returns).toContain("quote");
    expect(po.quote.returns).toEqual(["items", "subtotalCents", "taxCents"]);
    expect(po.quote.payLine).toEqual(["kind", "label", "addonId", "quantity", "nights", "unitPriceCents", "amountCents"]);
    expect(JSON.stringify(po.quote)).not.toMatch(/rate/i);
  });

  // b0.14 - the one outside host, declared, and held to the one file.
  it("CRITICAL: the only outside host in the source is the declared one, used only where declared", () => {
    const hosts = new Set();
    const where = {};
    for (const f of CODE) {
      const text = f.text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
      for (const m of text.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        hosts.add(m[1]);
        (where[m[1]] ||= new Set()).add(f.file);
      }
    }
    const declared = Object.values(OUTSIDE).map((o) => new URL(o.host).hostname);
    // checkout.stripe.com is where Pay sends the guest's BROWSER (b0.12), not
    // a call this site makes; the example.* hosts appear only in guards.
    const allowed = new Set([...declared, "checkout.stripe.com"]);
    const extra = [...hosts].filter((h) => !allowed.has(h) && !/^example\./.test(h));
    expect(extra, `undeclared hosts: ${extra.join(", ")}`).toEqual([]);
    for (const o of Object.values(OUTSIDE)) {
      // contract.js DECLARES the host; the one file named there USES it.
      const files = [...(where[new URL(o.host).hostname] || [])].filter((f) => !f.endsWith(path.join("lib", "contract.js")));
      expect(files.every((f) => f.endsWith(path.join(...o.file.split("/").slice(1)))), `${o.host} used in ${files.join(", ")}`).toBe(true);
    }
  });

  it("CRITICAL: the Mapbox token comes from the environment, and is never a secret one", () => {
    const addr = CODE.find((f) => f.file.endsWith(path.join("lib", "address.js")));
    expect(addr.text).toMatch(/import\.meta\.env\.VITE_MAPBOX_TOKEN/);
    // pk. is public; sk. is a secret token and must never ship in a bundle.
    expect(CODE.filter((f) => /\b(pk|sk)\.[A-Za-z0-9_-]{20,}/.test(f.text)).map((f) => f.file)).toEqual([]);
  });

  it("CRITICAL: charge_by is gone from the contract and from every read (CRM decision 6)", () => {
    expect(VIEWS.public_listing_addons.optional).not.toContain("charge_by");
    expect(VIEWS.public_listing_addons.optional).toContain("max_quantity");
  });

  it("CRITICAL: the honeypot field is part of the request contract", () => {
    // The server answers a filled `company` field with a plausible success and
    // writes nothing. If this site stops sending the field, the form loses its
    // cheapest defence and nothing else would notice.
    expect(FUNCTIONS["request-booking"].sends).toContain("company");
  });
});
