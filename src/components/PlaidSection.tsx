import { createLinkToken, exchangePublicToken, syncTransactions } from '../app/plaid-actions';
import { ensureAnchorRiverLoan } from '../db/repository';
import { getPlaidItem } from '../db/plaid-repository';
import { PlaidLinkButton } from './PlaidLinkButton';
import { SubmitButton } from './SubmitButton';

export async function PlaidSection() {
  const loanId = await ensureAnchorRiverLoan();
  const item = await getPlaidItem(loanId);
  const isConnected = item !== null;

  let linkToken: string | null = null;
  let linkError = false;
  if (!isConnected) {
    try {
      linkToken = await createLinkToken();
    } catch {
      linkError = true;
    }
  }

  return (
    <section className="card">
      <h2>Bank feed (Plaid)</h2>
      {!isConnected && linkToken && (
        <div>
          <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: 'var(--sub)' }}>
            No bank account connected. Connect the seller&apos;s Wells Fargo to start pulling payments automatically.
          </p>
          <PlaidLinkButton linkToken={linkToken} onSuccess={exchangePublicToken} />
        </div>
      )}
      {!isConnected && linkError && (
        <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>
          Could not reach Plaid right now. Refresh to try connecting again.
        </p>
      )}
      {isConnected && (
        <div>
          <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: 'var(--sub)' }}>
            Wells Fargo connected.{' '}
            {item.syncCursor ? 'Last sync cursor stored.' : 'Not yet synced.'}
          </p>
          <form action={async () => { await syncTransactions(); }}>
            <SubmitButton variant="secondary">Sync now</SubmitButton>
          </form>
        </div>
      )}
    </section>
  );
}
