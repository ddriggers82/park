/**
 * Returns the ISO date that is exactly 10 days before the given delinquency date.
 * Per Deed of Trust covenant A.4: the buyer must pay borough taxes at least 10 days
 * before delinquency. This is the date at which a reminder should fire (Plan 7).
 *
 * @param delinquencyISO - ISO 8601 date string (YYYY-MM-DD)
 * @returns ISO 8601 date string 10 days prior
 */
export function reminderTriggerDate(delinquencyISO: string): string {
  const [y, m, d] = delinquencyISO.split('-').map(Number);
  // Use UTC to avoid DST shifts
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 10);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns true when an insurance policy's expiration date is on or before today,
 * meaning the policy has lapsed (or expires today and is not yet renewed).
 *
 * @param expirationISO - policy expiration date (YYYY-MM-DD)
 * @param todayISO - the current date to compare against (YYYY-MM-DD); injected for testability
 */
export function isLapsed(expirationISO: string, todayISO: string): boolean {
  return expirationISO <= todayISO;
}
