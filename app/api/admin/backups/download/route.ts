import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import { backupPath, isValidBackupName } from '@/lib/backup';

export const runtime = 'nodejs';

/** Download a backup file: `?name=keeparr-YYYYMMDD-HHmmss.db`. */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const name = new URL(req.url).searchParams.get('name') ?? '';
    if (!isValidBackupName(name)) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }
    const p = backupPath(name);
    if (!fs.existsSync(p)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const stat = fs.statSync(p);
    // Backups are modest (a few MB) - a buffered read keeps the route simple.
    const body = new Uint8Array(fs.readFileSync(p));
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
