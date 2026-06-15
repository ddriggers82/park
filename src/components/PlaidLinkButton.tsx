'use client';

import { useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';

interface Props {
  linkToken: string;
  onSuccess: (publicToken: string) => Promise<void>;
}

// OAuth banks bounce the browser to the bank's site and back to our redirect_uri
// with ?oauth_state_id=... To resume, Link must re-initialize with the SAME token
// used to start the flow, so we stash it before opening and reuse it on return.
const STORAGE_KEY = 'plaid_link_token';

export function PlaidLinkButton({ linkToken, onSuccess }: Props) {
  const isOAuthRedirect =
    typeof window !== 'undefined' && window.location.search.includes('oauth_state_id=');

  // On an OAuth return reuse the stashed token; otherwise use the fresh server token.
  const token =
    isOAuthRedirect && typeof window !== 'undefined'
      ? window.localStorage.getItem(STORAGE_KEY) ?? linkToken
      : linkToken;

  const { open, ready } = usePlaidLink({
    token,
    // Only set on the OAuth return; presence tells Link to continue the flow.
    receivedRedirectUri: isOAuthRedirect ? window.location.href : undefined,
    onSuccess: (public_token) => {
      if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
      void onSuccess(public_token);
    },
    onExit: () => {
      if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
    },
  });

  // After returning from the bank's OAuth page, reopen Link automatically to finish.
  useEffect(() => {
    if (isOAuthRedirect && ready) open();
  }, [isOAuthRedirect, ready, open]);

  const handleClick = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, linkToken);
    open();
  };

  return (
    <button
      onClick={handleClick}
      disabled={!ready}
      style={{ padding: '8px 16px', cursor: ready ? 'pointer' : 'default' }}
    >
      Connect bank account
    </button>
  );
}
