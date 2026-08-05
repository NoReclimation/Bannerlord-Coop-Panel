import { useCallback, useEffect, useState } from 'react';
import type { BackupRef } from '@bannerlord-panel/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ServerBackups({ serverId }: { serverId: string }) {
  const { can } = useAuth();
  const canControl = can('servers:control');
  const canWrite = can('servers:write');
  const [backups, setBackups] = useState<BackupRef[]>([]);
  const [retentionCount, setRetentionCount] = useState(10);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.listBackups(serverId);
      setBackups(data.backups);
      setRetentionCount(data.retentionCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups');
    } finally {
      setBusy(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!canControl) return;
    setBusy(true);
    setError(null);
    try {
      await api.createBackup(serverId, note.trim() || undefined);
      setNote('');
      setStatus('Backup created');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(backup: BackupRef) {
    if (!canWrite) return;
    if (
      !window.confirm(
        'Restore this backup? The server will be stopped if running, saves/config replaced, then started again if it was running.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.restoreBackup(serverId, backup.id);
      setStatus(`Restored backup ${backup.id.slice(0, 8)}…`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(backup: BackupRef) {
    if (!canWrite) return;
    if (!window.confirm('Delete this backup permanently?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteBackup(serverId, backup.id);
      setStatus('Backup deleted');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(backup: BackupRef) {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.downloadBackup(serverId, backup.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${backup.id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Backups"
          description={`Zip archives of saves + configs under backups/<serverId>/ on the host. Wineprefix and logs are excluded. Retention: keep last ${retentionCount}.`}
          action={
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          }
        />
        <div className="space-y-4 p-4">
          {canControl ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <Label htmlFor="bk-note">Note (optional)</Label>
                <Input
                  id="bk-note"
                  value={note}
                  placeholder="Before wipe / weekly"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button disabled={busy} onClick={() => void handleCreate()}>
                Create backup
              </Button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-muted"
                    >
                      {busy ? 'Loading…' : 'No backups yet'}
                    </td>
                  </tr>
                ) : (
                  backups.map((backup) => (
                    <tr
                      key={backup.id}
                      className="border-t border-border"
                    >
                      <td className="px-3 py-2">
                        {formatWhen(backup.createdAt)}
                        <p className="text-xs text-muted">{backup.id}</p>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {formatSize(backup.sizeBytes)}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {backup.note || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void handleDownload(backup)}
                          >
                            Download
                          </Button>
                          {canWrite ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void handleRestore(backup)}
                              >
                                Restore
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void handleDelete(backup)}
                              >
                                Delete
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {status ? <p className="text-sm text-muted">{status}</p> : null}
        </div>
      </Card>
    </div>
  );
}
