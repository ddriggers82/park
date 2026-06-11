import 'server-only';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

if (!process.env.PLAID_CLIENT_ID) throw new Error('PLAID_CLIENT_ID env var is required');
if (!process.env.PLAID_SECRET) throw new Error('PLAID_SECRET env var is required');

const cfg = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaid = new PlaidApi(cfg);
