import { auth } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { signedReceiptUrl } from '../../../lib/blob';

export const dynamic = 'force-dynamic';

/**
 * Authenticated gateway to private receipt blobs.
 *
 * Clerk middleware already protects this route (it is not in the public matcher),
 * but we re-check auth here as defense in depth. Given a `p` pathname inside the
 * receipts/ prefix, we mint a short-lived presigned URL and redirect to it so the
 * browser downloads directly from Blob. The bare object URL is not public.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const pathname = req.nextUrl.searchParams.get('p');
  if (!pathname || !pathname.startsWith('receipts/') || pathname.includes('..')) {
    return new NextResponse('Bad request', { status: 400 });
  }

  try {
    const url = await signedReceiptUrl(pathname);
    return NextResponse.redirect(url, 307);
  } catch {
    return new NextResponse('Receipt not found', { status: 404 });
  }
}
