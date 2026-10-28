export function parseMoneyToCents(value: string): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function moneyCentsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("El importe no es un entero seguro de centavos.");
  const absolute = Math.abs(cents);
  const value = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${value}` : value;
}

export function sumMoneyToCents(values: readonly string[]): number | null {
  let total = 0;
  for (const value of values) {
    const cents = parseMoneyToCents(value);
    if (cents === null) return null;
    total += cents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function comparePaymentAmounts(expectedCents: number, declaredCents: number, accreditedCents: number) {
  if (![expectedCents, declaredCents, accreditedCents].every(Number.isSafeInteger)) return null;
  if ([expectedCents, declaredCents, accreditedCents].some((value) => value < 0)) return null;
  const differenceCents = accreditedCents - expectedCents;
  return {
    matches: expectedCents === declaredCents && expectedCents === accreditedCents,
    differenceCents
  };
}

export function calculateCashClosure(openingCents: number, confirmedReceiptsCents: number, countedCents: number) {
  if (![openingCents, confirmedReceiptsCents, countedCents].every(Number.isSafeInteger)) return null;
  if ([openingCents, confirmedReceiptsCents, countedCents].some((value) => value < 0)) return null;
  const expectedCents = openingCents + confirmedReceiptsCents;
  if (!Number.isSafeInteger(expectedCents)) return null;
  return { expectedCents, differenceCents: countedCents - expectedCents };
}