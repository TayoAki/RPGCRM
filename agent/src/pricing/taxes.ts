import type { TaxCategory, TaxLine, TaxRate } from "../domain/types.js";

/** Rates in force for a jurisdiction and tax category on a given date. */
export function taxRatesFor(
  taxRates: TaxRate[],
  state: string,
  taxCategory: TaxCategory,
  date: string,
): TaxRate[] {
  const d = date.slice(0, 10);
  return taxRates.filter(
    (t) =>
      t.state === state &&
      t.taxCategory === taxCategory &&
      t.effectiveStart.slice(0, 10) <= d &&
      (t.effectiveEnd === null || d < t.effectiveEnd.slice(0, 10)),
  );
}

export function taxesPerGallon(
  taxRates: TaxRate[],
  state: string,
  taxCategory: TaxCategory,
  date: string,
): number {
  return round5(
    taxRatesFor(taxRates, state, taxCategory, date).reduce(
      (s, t) => s + t.ratePerGallon,
      0,
    ),
  );
}

/** Tax lines for a quantity of gallons (amounts rounded to cents). */
export function taxLinesFor(
  taxRates: TaxRate[],
  state: string,
  taxCategory: TaxCategory,
  date: string,
  gallons: number,
): TaxLine[] {
  return taxRatesFor(taxRates, state, taxCategory, date).map((t) => ({
    component: t.component,
    ratePerGallon: t.ratePerGallon,
    amount: round2(t.ratePerGallon * gallons),
  }));
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round4 = (n: number): number => Math.round(n * 10000) / 10000;
export const round5 = (n: number): number => Math.round(n * 100000) / 100000;
