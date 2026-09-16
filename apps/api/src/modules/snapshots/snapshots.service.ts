import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface SnapshotInfo {
  id: string; // filename without extension
  file: string; // full filename
  size: number;
  sizeLabel: string;
  createdAt: string;
  type: 'full';
}

@Injectable()
export class SnapshotsService {
  private readonly dir: string;

  constructor() {
    const base = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
    this.dir = path.join(base, 'snapshots');
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private findPgDump(): string {
    const candidates = [
      process.env.PG_DUMP || '',
      '/Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump',
      '/Applications/Postgres.app/Contents/Versions/18/bin/pg_dump',
      '/opt/homebrew/opt/postgresql@18/bin/pg_dump',
      '/opt/homebrew/bin/pg_dump',
      'pg_dump',
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        if (c === 'pg_dump') return 'pg_dump';
        if (fs.existsSync(c)) return c;
      } catch {}
    }
    return 'pg_dump';
  }

  private findPgRestore(): string {
    const c = this.findPgDump().replace('pg_dump', 'pg_restore');
    if (fs.existsSync(c)) return c;
    return 'pg_restore';
  }

  async list(): Promise<SnapshotInfo[]> {
    const files = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    const dumps = files.filter(f => f.endsWith('.dump'));
    const infos: SnapshotInfo[] = [];
    for (const f of dumps) {
      const full = path.join(this.dir, f);
      try {
        const stat = await fs.promises.stat(full);
        const id = f.replace(/\.dump$/, '');
        infos.push({
          id,
          file: f,
          size: stat.size,
          sizeLabel: this.formatSize(stat.size),
          createdAt: stat.mtime.toISOString(),
          type: 'full',
        });
      } catch {}
    }
    infos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return infos;
  }

  async create(actorId?: string): Promise<SnapshotInfo> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `snapshot-${stamp}.dump`;
    const full = path.join(this.dir, file);
    const pgUrl = process.env.DATABASE_URL || 'postgresql://isp_user:change_me@localhost:5432/isp_platform';
    const pgDump = this.findPgDump();

    // Use custom format (-Fc) so pg_restore can do clean restore with --if-exists
    const cmd = `"${pgDump}" "${pgUrl.replace(/"/g, '\\"')}" -Fc -f "${full}"`;
    try {
      await execAsync(cmd, { maxBuffer: 20 * 1024 * 1024 });
    } catch (e: any) {
      // Fallback: try plain SQL dump if custom fails (e.g., pg_dump not found)
      const plain = full.replace('.dump', '.sql');
      const cmd2 = `"${pgDump}" "${pgUrl.replace(/"/g, '\\"')}" -f "${plain}"`;
      try {
        await execAsync(cmd2, { maxBuffer: 20 * 1024 * 1024 });
        // prefer plain if custom failed
        if (fs.existsSync(plain)) {
          const stat = await fs.promises.stat(plain);
          return {
            id: path.basename(plain, '.sql'),
            file: path.basename(plain),
            size: stat.size,
            sizeLabel: this.formatSize(stat.size),
            createdAt: stat.mtime.toISOString(),
            type: 'full',
          };
        }
      } catch (e2: any) {
        throw new BadRequestException(`Snapshot failed: ${e2?.message?.slice(0, 300) || e?.message?.slice(0, 300)}`);
      }
      throw new BadRequestException(`Snapshot failed: ${e?.message?.slice(0, 300)}`);
    }

    // Also try radius if configured (best effort, don't fail whole snapshot)
    try {
      const rHost = process.env.RADIUS_DB_HOST;
      const rUser = process.env.RADIUS_DB_USER;
      const rPass = process.env.RADIUS_DB_PASSWORD || process.env.RADIUS_DB_PASS;
      const rName = process.env.RADIUS_DB_NAME || 'radius';
      if (rHost && rUser) {
        const rFile = full.replace('.dump', '-radius.sql');
        const rCmd = `mysqldump -h "${rHost}" -P "${process.env.RADIUS_DB_PORT || '3306'}" -u "${rUser}" -p"${rPass}" "${rName}" > "${rFile}"`;
        await execAsync(rCmd, { maxBuffer: 20 * 1024 * 1024 }).catch(() => {});
      }
    } catch {}

    // Optionally also run the project's backup.sh for full parity (postgres+radius with retention)
    // but we already did pg_dump above, so just return.

    const stat = await fs.promises.stat(full);
    return {
      id: file.replace(/\.dump$/, ''),
      file,
      size: stat.size,
      sizeLabel: this.formatSize(stat.size),
      createdAt: stat.mtime.toISOString(),
      type: 'full',
    };
  }

  getPath(id: string): string {
    // id is like snapshot-2026-09-16T10-00-00 or filename
    const safe = path.basename(id).replace(/[^a-zA-Z0-9._-]/g, '');
    const candidates = [
      path.join(this.dir, safe),
      path.join(this.dir, safe + '.dump'),
      path.join(this.dir, safe + '.sql'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new NotFoundException('Snapshot not found');
  }

  async restore(id: string): Promise<{ restored: string }> {
    const full = this.getPath(id);
    const pgUrl = process.env.DATABASE_URL || 'postgresql://isp_user:change_me@localhost:5432/isp_platform';
    const pgRestore = this.findPgRestore();

    // For custom format, use pg_restore --clean --if-exists -d
    // Need to extract db name from URL or use URL directly
    const isCustom = full.endsWith('.dump');
    const cmd = isCustom
      ? `"${pgRestore}" -c --if-exists -d "${pgUrl.replace(/"/g, '\\"')}" "${full}"`
      : `psql "${pgUrl.replace(/"/g, '\\"')}" -f "${full}"`;

    try {
      const { stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
      // pg_restore often writes warnings to stderr but still succeeds (e.g., "already exists")
      // Consider success if file still exists and no thrown error
      return { restored: path.basename(full) };
    } catch (e: any) {
      const msg = e?.stderr?.slice(0, 600) || e?.message?.slice(0, 600) || 'Restore failed';
      // If custom restore failed, try plain psql as fallback
      if (isCustom) {
        try {
          const alt = `psql "${pgUrl.replace(/"/g, '\\"')}" -f "${full}"`;
          await execAsync(alt, { maxBuffer: 50 * 1024 * 1024 });
          return { restored: path.basename(full) };
        } catch {}
      }
      throw new BadRequestException(`Restore failed: ${msg}`);
    }
  }

  async delete(id: string): Promise<{ deleted: string }> {
    const full = this.getPath(id);
    await fs.promises.unlink(full).catch(() => {});
    // Also delete companion radius file if exists
    const base = full.replace(/\.dump$/, '').replace(/\.sql$/, '');
    const radiusFile = `${base}-radius.sql`;
    await fs.promises.unlink(radiusFile).catch(() => {});
    return { deleted: path.basename(full) };
  }

  async saveUpload(file: Express.Multer.File): Promise<SnapshotInfo> {
    if (!file) throw new BadRequestException('No file uploaded');
    const ext = file.originalname.endsWith('.sql') ? '.sql' : '.dump';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `snapshot-upload-${stamp}${ext}`;
    const full = path.join(this.dir, name);
    await fs.promises.writeFile(full, file.buffer);
    const stat = await fs.promises.stat(full);
    return {
      id: name.replace(/\.(dump|sql)$/, ''),
      file: name,
      size: stat.size,
      sizeLabel: this.formatSize(stat.size),
      createdAt: stat.mtime.toISOString(),
      type: 'full',
    };
  }
}
