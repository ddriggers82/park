'use client';

import { usePlaidLink } from 'react-plaid-link';

interface Props {
  linkToken: string;
  onSuccess: (publicToken: string) => Promise<void>;
}

export function PlaidLinkButton({ linkToken, onSuccess }: Props) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token) => {
      void onSuccess(public_token);
    },
  });
  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{ padding: '8px 16px', cursor: ready ? 'pointer' : 'default' }}
    >
      Connect bank account
    </button>
  );
}
