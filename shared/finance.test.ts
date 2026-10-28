import { describe, expect, it } from "vitest";
import {
  calculateCashClosure, comparePaymentAmounts, moneyCentsToDecimal,
  parseMoneyToCents, sumMoneyToCents
} from "./finance";

describe("financial decimal arithmetic", () => {
  it("parses decimal strings into integer cents without rounding", () => {
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents("1500")).toBe(150000);
    expect(parseMoneyToCents("12.05")).toBe(1205);
    expect(parseMoneyToCents("12.5")).toBe(1250);
  });

  it("rejects negative, over-precision, localized, and exponent input", () => {
    expect(parseMoneyToCents("-1.00")).toBeNull();
    expect(parseMoneyToCents("1.001")).toBeNull();
    expect(parseMoneyToCents("1,25")).toBeNull();
    expect(parseMoneyToCents("1e3")).toBeNull();
    expect(parseMoneyToCents("100000000")).toBeNull();
  });

  it("sums and formats amounts using integer cents", () => {
    expect(sumMoneyToCents(["1.10", "2.25", "0.05"])).toBe(340);
    expect(moneyCentsToDecimal(340)).toBe("3.40");
    expect(moneyCentsToDecimal(-5)).toBe("-0.05");
    expect(sumMoneyToCents(["1.00", "bad"])).toBeNull();
  });

  it("marks a payment conciliable only when expected, declared and accredited amounts match", () => {
    expect(comparePaymentAmounts(10000, 10000, 10000)).toEqual({ matches: true, differenceCents: 0 });
    expect(comparePaymentAmounts(10000, 9900, 10000)).toEqual({ matches: false, differenceCents: 0 });
    expect(comparePaymentAmounts(10000, 10000, 9800)).toEqual({ matches: false, differenceCents: -200 });
    expect(comparePaymentAmounts(-1, 0, 0)).toBeNull();
  });

  it("calculates cash closure from opening balance and confirmed receipts", () => {
    expect(calculateCashClosure(5000, 18000, 23000)).toEqual({ expectedCents: 23000, differenceCents: 0 });
    expect(calculateCashClosure(5000, 18000, 22900)).toEqual({ expectedCents: 23000, differenceCents: -100 });
    expect(calculateCashClosure(5000, 18000, 23150)).toEqual({ expectedCents: 23000, differenceCents: 150 });
    expect(calculateCashClosure(-1, 100, 100)).toBeNull();
  });
});