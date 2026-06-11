import { createLinkToken, exchangePublicToken, syncTransactions } from '../app/plaid-actions';
import { ensureAnchorRiverLoan } from '../db/repository';
import { getPlaidItem } from '../db/plaid-repository';
import { PlaidLinkButton } from './PlaidLinkButton';

export async function PlaidSection() {
  const loanId = await ensureAnchorRiverLoan();
  const item = await getPlaidItem(loanId);
  const isConnected = item !== null;

  // If not connected, fetch a link token to render the Link button.
  // Guard the network call so a Plaid outage cannot break the whole page.
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
    <section style={{ marginTop: 32 }}>
      <h2>Bank feed (Plaid)</h2>
      {!isConnected && linkToken && (
        <div>
          <p>No bank account connected. Connect the seller&apos;s Wells Fargo to start pulling payments automatically.</p>
          <PlaidLinkButton linkToken={linkToken} onSuccess={exchangePublicToken} />
        </div>
      )}
      {!isConnected && linkError && (
        <p style={{ color: '#a00' }}>Could not reach Plaid right now. Refresh to try connecting again.</p>
      )}
      {isConnected && (
        <div>
          <p>
            Wells Fargo connected. Item ID: <code>{item.itemId}</code>.{' '}
            {item.syncCursor ? `Last sync cursor stored.` : `Not yet synced.`}
          </p>
          <form action={async () => { await syncTransactions(); }}>
            <button type="submit">Sync now</button>
          </form>
        </div>
      )}
    </section>
  );
}
