import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  GameInstallation,
  InstallationInspectResult,
} from '@bannerlord-panel/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export function InstallationsPage() {
  const { can } = useAuth();
  const canWrite = can('installations:write');
  const [installations, setInstallations] = useState<GameInstallation[]>([]);
  const [sourcePath, setSourcePath] = useState(
    '/var/lib/bannerlord-panel/staging/DedicatedServer',
  );
  const [installationId, setInstallationId] = useState('');
  const [inspect, setInspect] = useState<InstallationInspectResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.listInstallations();
      setInstallations(data.installations);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load installations',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInspect() {
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const data = await api.inspectInstallation(sourcePath.trim());
      setInspect(data.inspect);
      setInstallationId(data.inspect.suggestedId);
      if (!data.inspect.hasExe) {
        setError(
          'BannerlordCoopServer.exe not found at that path (check DedicatedServer nesting).',
        );
      } else {
        setStatus(
          data.inspect.alreadyInstalled
            ? 'Package looks valid — already present under installations/ (import will refresh).'
            : 'Package looks valid — ready to import.',
        );
      }
    } catch (err) {
      setInspect(null);
      setError(err instanceof Error ? err.message : 'Inspect failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.importInstallation({
        sourcePath: sourcePath.trim(),
        installationId: installationId.trim() || undefined,
      });
      setStatus(
        `Imported ${data.installation.id}${data.imported.copied ? ' (copied)' : ''} — you can create a server next.`,
      );
      setInspect(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Installations</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Shared read-only Bannerlord Coop packages on the host. Upload the
            DedicatedServer folder to the VPS (scp/rsync), then import it here.
            Multi-GB browser upload is not used.
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {canWrite ? (
        <Card>
          <CardHeader
            title="Import from host path"
            description="Place files under staging (recommended), inspect to auto-detect version, then import into installations/."
          />
          <form className="space-y-4 p-4" onSubmit={(e) => void handleImport(e)}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>
                On the VPS, copy the package e.g.{' '}
                <code className="text-text">
                  rsync -a DedicatedServer/ /var/lib/bannerlord-panel/staging/DedicatedServer/
                </code>
              </li>
              <li>Paste that path below → Inspect → Import.</li>
              <li>
                Open{' '}
                <Link to="/" className="text-accent hover:underline">
                  Dashboard
                </Link>{' '}
                → Create server → Start.
              </li>
            </ol>

            <div>
              <Label htmlFor="src">Source path on host</Label>
              <Input
                id="src"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleInspect()}
              >
                Inspect
              </Button>
            </div>

            {inspect ? (
              <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
                <p>
                  Package root:{' '}
                  <span className="text-muted">{inspect.packageRoot}</span>
                </p>
                <p>
                  Exe found:{' '}
                  <span className={inspect.hasExe ? 'text-success' : 'text-danger'}>
                    {inspect.hasExe ? 'yes' : 'no'}
                  </span>
                </p>
                <p>
                  Version {inspect.gameVersion} · Coop {inspect.coopCommit} ·{' '}
                  {inspect.layout}
                </p>
              </div>
            ) : null}

            <div>
              <Label htmlFor="iid">Installation id</Label>
              <Input
                id="iid"
                value={installationId}
                onChange={(e) => setInstallationId(e.target.value)}
                placeholder="auto from release-info.txt"
              />
            </div>

            <Button type="submit" disabled={busy || (inspect ? !inspect.hasExe : false)}>
              Import &amp; register
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Registered installations" />
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Id</th>
                <th className="px-2 py-2 font-medium">Version</th>
                <th className="px-2 py-2 font-medium">Path</th>
              </tr>
            </thead>
            <tbody>
              {installations.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-2 py-8 text-center text-muted"
                  >
                    {busy ? 'Loading…' : 'No installations yet'}
                  </td>
                </tr>
              ) : (
                installations.map((inst) => (
                  <tr key={inst.id} className="border-t border-border">
                    <td className="px-2 py-2 font-medium">{inst.id}</td>
                    <td className="px-2 py-2 text-muted">
                      {inst.gameVersion} / {inst.coopCommit || '—'}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted">
                      {inst.path}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
