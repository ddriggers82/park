import { updateTaxStatusByPin } from '../../../db/compliance-repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TAX_SYNC_SECRET;
  if (!secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as Record<string, unknown>).parcels)
  ) {
    return new Response('Bad Request: parcels must be an array', { status: 400 });
  }

  const parcels = (body as { parcels: unknown[] }).parcels;
  let updated = 0;

  for (const item of parcels) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    const pin = typeof p.pin === 'string' ? p.pin : String(p.pin ?? '');
    const owedCents = Math.trunc(Number(p.owedCents));
    if (!pin) continue;
    updated += await updateTaxStatusByPin(pin, { owedCents });
  }

  return Response.json({ ok: true, updated });
}
