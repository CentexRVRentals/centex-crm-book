// b0.27 (CRM v6.72, Fleet Delivery Pricing R2) - src/lib/delivery.js: what
// the camper page and the request form say about where a camper delivers.
// Never a price.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deliveryLines, deliveryMaxMiles, deliveryNote, deliverySites, siteNames } from "./lib/delivery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("the view's delivery columns, coerced", () => {
  it("CRITICAL: sites keep a name, a town and the Within - nothing else, and junk is dropped", () => {
    expect(deliverySites([
      { name: " Pecan Grove ", city: "Buda", within_miles: "2", amount: 95, street: "1 Main" },
      { name: "", city: "x" }, null, "x", { name: { evil: true } },
    ])).toEqual([{ name: "Pecan Grove", city: "Buda", withinMiles: 2 }]);
    expect(deliverySites(null)).toEqual([]);
    expect(deliverySites({})).toEqual([]);
  });

  it("max miles: a positive number or null - never 0 from a null", () => {
    expect(deliveryMaxMiles(75)).toBe(75);
    expect(deliveryMaxMiles(null)).toBeNull();
    expect(deliveryMaxMiles("")).toBeNull();
    expect(deliveryMaxMiles("abc")).toBeNull();
  });
});

describe("what the page says", () => {
  const SITES = [{ name: "Pecan Grove", city: "Buda" }, { name: "Lake Camp", city: "" }];
  it("CRITICAL: the four cases", () => {
    expect(deliveryLines({ deliveryOffered: true, deliveryMaxMiles: 75, deliverySites: [] })).toEqual(["Delivery available within 75 miles."]);
    expect(deliveryLines({ deliveryOffered: true, deliveryMaxMiles: 75, deliverySites: SITES }))
      .toEqual(["Delivery available within 75 miles.", "Also delivers to: Pecan Grove (Buda), Lake Camp."]);
    expect(deliveryLines({ deliveryOffered: true, deliveryMaxMiles: null, deliverySites: SITES })).toEqual(["Delivery to: Pecan Grove (Buda), Lake Camp."]);
    expect(deliveryLines({ deliveryOffered: false, deliveryMaxMiles: 75, deliverySites: SITES })).toEqual([]);
    expect(siteNames(SITES)).toBe("Pecan Grove (Buda), Lake Camp");
  });

  it("the request form's note", () => {
    expect(deliveryNote({ deliveryMaxMiles: 75 })).toBe(" (within 75 miles)");
    expect(deliveryNote({ deliveryMaxMiles: null, deliverySites: [{ name: "Pecan Grove", city: "Buda" }] })).toBe(" (to Pecan Grove (Buda))");
    expect(deliveryNote({})).toBe("");
  });

  it("CRITICAL: imports nothing - the request form must not pull in the Supabase client", () => {
    const src = fs.readFileSync(path.join(__dirname, "lib", "delivery.js"), "utf8");
    expect(src).not.toMatch(/^import /m);
  });

  it("CRITICAL: the four v6.0x delivery columns are read nowhere", () => {
    for (const f of ["lib/listings.js", "lib/contract.js", "pages/Camper.jsx", "components/RequestForm.jsx"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(src, f).not.toMatch(/delivery_minimum|delivery_dollar_mile|delivery_miles_max|deliveryDollarMile|deliveryMilesMax|deliveryMinimum/);
    }
  });
});
