import 'server-only';
import { put, del, issueSignedToken, presignUrl } from '@vercel/blob';

// Receipts/proofs/declarations are stored in a PRIVATE Blob store. We persist the
// blob pathname (not a public URL) and mint a short-lived presigned URL on demand,
// served behind the Clerk-authenticated /api/receipts route. The bare object URL is
// not publicly fetchable.

const SIGNED_URL_TTL_MS = 5 * 60 * 1000; // 5 minutes — only needs to outlive the redirect

export async function uploadReceipt(file: File): Promise<string> {
  const blob = await put(`receipts/${file.name}`, file, {
    access: 'private',
    addRandomSuffix: true,
  });
  // Store the pathname; presign it at access time via signedReceiptUrl.
  return blob.pathname;
}

export async function deleteReceipt(pathnameOrUrl: string): Promise<void> {
  await del(pathnameOrUrl);
}

/**
 * Mint a short-lived presigned GET URL for a private receipt pathname.
 * Throws if the pathname does not exist or the store rejects the request.
 */
export async function signedReceiptUrl(pathname: string): Promise<string> {
  const signed = await issueSignedToken({
    pathname,
    operations: ['get'],
    validUntil: Date.now() + SIGNED_URL_TTL_MS,
  });
  const { presignedUrl } = await presignUrl(signed, {
    operation: 'get',
    pathname,
    access: 'private',
  });
  return presignedUrl;
}
