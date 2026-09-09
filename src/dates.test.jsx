// @vitest-environment jsdom
//
// b0.3 — THE DATE RULES.
//
// These exist twice: here and in the Edge Function. That is deliberate (CRM
// §4.163) and the risk is exactly one thing — **if this file disagrees with the
// server about which days are bookable, a guest is offered a date and then
// refused it.**
//
// This file tests the rules in isolation, fast and offline.
// conformance.test.jsx tests that they AGREE WITH THE SERVER, and needs the
// network. Both matter and neither replaces the other: a bug that is wrong in
// the same way on both sides passes conformance and fails here.

import { describe, it, expect } from "vitest";
import {
  isIsoDate, nightsBetween, addDays, overlapsBusy, busyDaySet,
  checkDates, estimate, monthGrid, todayCentral,
  MAX_NIGHTS, MAX_ADVANCE_DAYS,
} from "./lib/dates.js";

const TODAY = "2026-09-09";
const busy = [{ from: "2026-11-02", through: "2026-11-06" }];

describe("dates parse the way the database stores them", () => {
  it("CRITICAL: only real YYYY-MM-DD calendar dates", () => {
    expect(isIsoDate("2026-11-02")).toBe(true);
    // The regex alone accepts these. Parsing is what rejects them.
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    for (const junk of ["2026-1-1", "26-01-01", "", null, undefined, 20261102, {}, [], true]) {
      expect(isIsoDate(junk), `${JSON.stringify(junk)} accepted`).toBe(false);
    }
  });

  it("nights, not days", () => {
    // Oct 1 -> Oct 4 is THREE nights. The off-by-one a minimum-nights rule
    // exists to be exact about, and one the server's own test got wrong first
    // time round.
    expect(nightsBetween("2026-10-01", "2026-10-04")).toBe(3);
    expect(nightsBetween("2026-10-01", "2026-10-02")).toBe(1);
    expect(nightsBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(nightsBetween("bad", "worse")).toBe(0);
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("CRITICAL: today is CENTRAL, not UTC", () => {
    // A guest in California at 10pm must not be told the 9th is in the past
    // while Texas is still on the 9th. UTC has already rolled over by then.
    const lateInCalifornia = new Date("2026-09-10T04:30:00Z"); // 11:30pm CDT on the 9th
    expect(todayCentral(lateInCalifornia)).toBe("2026-09-09");
  });
});

describe("THE ONE DECISION: a busy range is inclusive at both ends", () => {
  // If this changes and the server does not, a guest is offered a day the
  // server refuses. conformance.test.jsx is what proves they still agree.
  it("CRITICAL: every kind of overlap is an overlap", () => {
    for (const [s, e, why] of [
      ["2026-11-03", "2026-11-05", "wholly inside"],
      ["2026-10-30", "2026-11-03", "straddles the start"],
      ["2026-11-05", "2026-11-09", "straddles the end"],
      ["2026-10-01", "2026-12-01", "wholly contains"],
      ["2026-11-06", "2026-11-09", "starts on the day it ends"],
      ["2026-10-29", "2026-11-02", "ends on the day it starts"],
    ]) {
      expect(overlapsBusy(s, e, busy), `${why} was allowed`).toBe(true);
    }
  });

  it("clear dates are clear", () => {
    expect(overlapsBusy("2026-10-25", "2026-11-01", busy)).toBe(false);
    expect(overlapsBusy("2026-11-07", "2026-11-12", busy)).toBe(false);
    expect(overlapsBusy("2026-11-03", "2026-11-05", [])).toBe(false);
  });

  it("a malformed busy row cannot throw or spin", () => {
    expect(() => overlapsBusy("2026-11-01", "2026-11-03", [null, undefined, {}, { from: 1 }])).not.toThrow();
    // A corrupt range must not expand forever — the view is written by a repo
    // this one cannot see.
    const days = busyDaySet([{ from: "2026-01-01", through: "2099-01-01" }]);
    expect(days.size).toBeLessThanOrEqual(401);
  });

  it("CRITICAL: busyDaySet marks every day of a range, ends included", () => {
    const days = busyDaySet(busy);
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
      expect(days.has(d), `${d} not marked busy`).toBe(true);
    }
    expect(days.has("2026-11-01")).toBe(false);
    expect(days.has("2026-11-07")).toBe(false);
  });
});

describe("the verdict", () => {
  const check = (over) => checkDates({
    start: "2026-10-01", end: "2026-10-05", busy, minimumNights: 2, today: TODAY, ...over,
  });

  it("CRITICAL: a good range passes (anti-vacuity)", () => {
    const r = check();
    expect(r.errors, r.errors.join(" / ")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.nights).toBe(4);
  });

  it("CRITICAL: the past is refused, today is not", () => {
    expect(check({ start: "2026-09-08", end: "2026-09-12" }).ok).toBe(false);
    expect(check({ start: TODAY, end: "2026-09-12" }).ok).toBe(true);
  });

  it("CRITICAL: minimum nights, exactly", () => {
    expect(check({ start: "2026-10-01", end: "2026-10-03", minimumNights: 2 }).ok).toBe(true);
    expect(check({ start: "2026-10-01", end: "2026-10-02", minimumNights: 2 }).ok).toBe(false);
    expect(check({ start: "2026-10-01", end: "2026-10-02", minimumNights: 0 }).ok).toBe(true);
  });

  it("collects every error, not just the first", () => {
    // A guest fixing one field at a time because the page only ever names one
    // is a guest who gives up.
    const r = check({ start: "2026-09-01", end: "2026-09-01" });
    expect(r.errors.length).toBeGreaterThan(1);
  });

  it("ceilings are real, not placeholders", () => {
    expect(MAX_NIGHTS).toBeGreaterThan(7);
    expect(MAX_ADVANCE_DAYS).toBeGreaterThan(90);
    expect(check({ start: "2026-10-01", end: "2027-06-01" }).ok).toBe(false);
    expect(check({ start: "2030-01-01", end: "2030-01-05" }).ok).toBe(false);
  });

  it("hostile input never throws", () => {
    for (const v of [undefined, null, "", 0, 42, true, [], {}, "nonsense"]) {
      expect(() => checkDates({ start: v, end: v, busy: v, minimumNights: v, today: TODAY })).not.toThrow();
    }
  });
});

describe("the estimate is an estimate", () => {
  it("nightly rate plus prep fee, and nothing else", () => {
    // No tax, no insurance, no delivery, no add-ons. A number a guest reads as
    // final and is then charged differently is worse than no number.
    const q = estimate({ pricePerNight: 119, prepFee: 75, nights: 4 });
    expect(q.subtotal).toBe(476);
    expect(q.total).toBe(551);
  });

  it("no quote without a rate or nights", () => {
    expect(estimate({ pricePerNight: 0, nights: 4 })).toBeNull();
    expect(estimate({ pricePerNight: 119, nights: 0 })).toBeNull();
    expect(estimate({ pricePerNight: "junk", nights: "junk" })).toBeNull();
  });
});

describe("the calendar grid", () => {
  it("42 cells, Sunday first, neighbours filled in", () => {
    const cells = monthGrid(2026, 10); // November 2026
    expect(cells).toHaveLength(42);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
    expect(cells[0].iso <= "2026-11-01").toBe(true);
    // No gaps: every cell is one day after the last.
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].iso).toBe(addDays(cells[i - 1].iso, 1));
    }
  });

  it("February in a leap year", () => {
    expect(monthGrid(2028, 1).filter((c) => c.inMonth)).toHaveLength(29);
  });
});
