/**
 * Royalty pure logic -- §27(d) of the purchase agreement.
 * The buyer owes 25% of gross RV-site income from the Option Property,
 * due July 1 and October 1 each calendar year.
 * All values in integer cents.
 */

/** Compute the royalty owed: 25% of gross income, rounded to the nearest cent. */
export function royaltyOwed(grossCents: number): number {
  return Math.round(grossCents * 0.25);
}

/**
 * Return the two royalty due dates for a calendar year as ISO date strings.
 * Always ['YYYY-07-01', 'YYYY-10-01'].
 */
export function royaltyDueDates(year: number): [string, string] {
  const y = String(year).padStart(4, '0');
  return [`${y}-07-01`, `${y}-10-01`];
}
