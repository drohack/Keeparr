import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { errorResponse } from '@/lib/route-helpers';
import {
  deleteBackup,
  isValidBackupName,
  listBackups,
  restoreBackup,
} from '@/lib/backup';
import { runJob } from '@/lib/jobs';
import { logEvent } from '@/lib/queries';

export const runtime = 'nodejs';

/** List backups, newest first. */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ backups: listBackups() });
  } catch (e) {
    return errorResponse(e);
  }
}

interface PostBody {
  action?: 'create' | 'restore';
  name?: string;
}

/**
 * `{action:'create'}` - run the backup job now (single-flight, shows in the
 * jobs history). `{action:'restore', name}` - replace the live database with
 * the named backup; the current db is snapshotted first as the safety net.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as PostBody;

    if (body.action === 'create') {
      const started = await runJob('backup');
      return NextResponse.json({ started });
    }

    if (body.action === 'restore') {
      const name = String(body.name ?? '');
      if (!isValidBackupName(name)) {
        return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
      }
      const { safetyNet } = await restoreBackup(name);
      logEvent('warn', 'backup', `Restored database from ${name} (pre-restore snapshot: ${safetyNet}).`);
      return NextResponse.json({ restored: name, safetyNet });
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Delete one backup file: `{name}`. */
export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { name } = (await req.json()) as { name?: string };
    if (!isValidBackupName(String(name ?? ''))) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }
    return NextResponse.json({ deleted: deleteBackup(String(name)) });
  } catch (e) {
    return errorResponse(e);
  }
}
