import { requireAnyRole } from '../../../lib/current-role';
import { buildExportWorkbook } from '../../../lib/export-workbook';

// Buyer or seller can export the full workbook. Middleware already blocks
// unauthenticated requests; requireAnyRole rejects logged-in accounts with no role.
export async function GET() {
  try {
    await requireAnyRole();
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const body = await buildExportWorkbook(todayISO);
  const filename = `anchor-river-note-${todayISO}.xlsx`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
