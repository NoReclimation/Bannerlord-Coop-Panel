import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GameServerRecord } from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { ServerCard } from '@/components/servers/ServerCard';
import { CreateServerPanel } from '@/components/servers/CreateServerPanel';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

export function DashboardPage() {
  const { can } = useAuth();
  const canWrite = can('servers:write');
  const [servers, setServers] = useState<GameServerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listServers();
      setServers(data.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onControl(
    id: string,
    action: 'start' | 'stop' | 'restart' | 'kill',
  ) {
    try {
      const { server } = await api.controlServer(id, action);
      setServers((prev) => prev.map((s) => (s.id === id ? server : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Control failed');
    }
  }

  async function onDelete(id: string) {
    const target = servers.find((s) => s.id === id);
    const label = target?.name ?? 'this server';
    if (
      !window.confirm(
        `Remove "${label}"? This deletes the container. Saves and backups on disk are kept.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Servers</h2>
          <p className="mt-1 text-sm text-muted">
            Manage Bannerlord Coop instances on connected hosts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          {canWrite ? (
            <Button
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? 'Hide create' : 'Create server'}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

      {showCreate && canWrite ? (
        <div className="mt-6">
          <CreateServerPanel
            onCancel={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              void load();
            }}
          />
        </div>
      ) : null}

      {loading ? (
        <p className="mt-8 text-muted">Loading servers…</p>
      ) : servers.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-muted">
          <p>No servers yet.</p>
          <p className="mt-2 text-sm">
            {canWrite ? (
              <>
                Import a package under{' '}
                <Link to="/installations" className="text-accent hover:underline">
                  Installations
                </Link>
                , then click <span className="text-text">Create server</span>.
              </>
            ) : (
              'Ask an admin to create a server.'
            )}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onControl={(id, action) => void onControl(id, action)}
              onDelete={
                canWrite ? (id) => void onDelete(id) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
