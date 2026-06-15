import 'server-only';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

if (!process.env.PLAID_CLIENT_ID) throw new Error('PLAID_CLIENT_ID env var is required');
if (!process.env.PLAID_SECRET) throw new Error('PLAID_SECRET env var is required');

// Require PLAID_ENV explicitly. With live production credentials, a missing or
// typo'd value must fail loudly rather than silently pointing the secret at the
// sandbox base path.
const plaidEnv = process.env.PLAID_ENV;
if (plaidEnv !== 'sandbox' && plaidEnv !== 'production') {
  throw new Error("PLAID_ENV env var must be 'sandbox' or 'production'");
}

const cfg = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaid = new PlaidApi(cfg);

/**
 * Wrap every Plaid SDK call. The SDK is axios-based: a failed request throws an
 * AxiosError whose `.config.headers` carries the live PLAID-SECRET and whose
 * `.response.data` echoes Plaid's error body. That object must never escape the
 * server boundary (a thrown value can be serialized back to the browser by the
 * server-action runtime). This rethrows a plain Error carrying only Plaid's
 * error_code, so no credential or request config can leak to the client.
 */
export async function plaidCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
      ?.error_code;
    throw new Error(code ? `Plaid request failed (${code})` : 'Plaid request failed');
  }
}
