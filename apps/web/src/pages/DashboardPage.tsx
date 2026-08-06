import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  WsEvents,
  type GameServerRecord,
  type PlayerCountPayload,
} from '@bannerlord-panel/shared';
import { api, getAccessToken } from '@/lib/api';
import { ServerCard } from '@/components/servers/ServerCard';
import { CreateServerPanel } from '@/components/servers/CreateServerPanel';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

interface DeleteRequestRow {
  id: string;
  serverId: string | null;
  serverName: string | null;
  requestedByUsername: string | null;
  status: string;
  createdAt: string;
}

export function DashboardPage() {
  const { can } = useAuth();
  const canCreate = can('servers:create');
  const canDelete = can('servers:delete');
  const canDeleteRequest = can('servers:delete-request');
  const canControl = can('servers:control');
  const canSelect = canDelete || canDeleteRequest;

  const [servers, setServers] = useState<GameServerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [deleteRequests, setDeleteRequests] = useState<DeleteRequestRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listServers();
      setServers(data.servers);
      const pending = await api.listPendingDeleteServerIds();
      setPendingIds(new Set(pending.serverIds));
      if (canDelete) {
        const reqs = await api.listDeleteRequests('pending');
        setDeleteRequests(reqs.requests);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, [canDelete]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    const socket = io('/client', {
      path: '/client-socket',
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
    });

    socket.on(WsEvents.PlayerCount, (payload: PlayerCountPayload) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === payload.serverId
            ? { ...s, playerCount: payload.playerCount }
            : s,
        ),
      );
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const selectedServers = useMemo(
    () => servers.filter((s) => selected.has(s.id)),
    [servers, selected],
  );

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

  async function onStopAll() {
    const running = servers.filter(
      (s) => s.status === 'running' || s.status === 'starting',
    );
    if (running.length === 0) return;
    if (!window.confirm(`Stop all ${running.length} running server(s)?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const s of running) {
        const { server } = await api.controlServer(s.id, 'stop');
        setServers((prev) => prev.map((x) => (x.id === s.id ? server : x)));
      }
      setStatus(`Stopped ${running.length} server(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stop all failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSelected() {
    if (selectedServers.length === 0) return;
    const names = selectedServers.map((s) => s.name).join(', ');

    if (canDelete) {
      if (
        !window.confirm(
          `Delete ${selectedServers.length} server(s)?\n${names}\n\nContainers are removed; saves/backups on disk are kept.`,
        )
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        for (const s of selectedServers) {
          await api.deleteServer(s.id);
        }
        setSelected(new Set());
        setStatus(`Deleted ${selectedServers.length} server(s).`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (canDeleteRequest) {
      if (
        !window.confirm(
          `Request delete for ${selectedServers.length} server(s)?\n${names}\n\nAn admin must approve before they are removed.`,
        )
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        for (const s of selectedServers) {
          await api.requestServerDelete(s.id);
        }
        setSelected(new Set());
        setStatus('Delete request submitted — waiting for admin approval.');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setBusy(false);
      }
    }
  }

  async function approveRequest(id: string) {
    setBusy(true);
    try {
      await api.approveDeleteRequest(id);
      setStatus('Delete approved and server removed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  }

  async function rejectRequest(id: string) {
    setBusy(true);
    try {
      await api.rejectDeleteRequest(id);
      setStatus('Delete request rejected.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  const hasRunnable = servers.some(
    (s) => s.status === 'running' || s.status === 'starting',
  );

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
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
          {canControl && hasRunnable ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void onStopAll()}
            >
              Stop all
            </Button>
          ) : null}
          {canSelect && selected.size > 0 ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void onDeleteSelected()}
            >
              {canDelete ? 'Delete selected' : 'Request delete'}
            </Button>
          ) : null}
          {canCreate ? (
            <Button onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? 'Hide create' : 'Create server'}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {status ? <p className="mt-4 text-sm text-success">{status}</p> : null}

      {canDelete && deleteRequests.length > 0 ? (
        <Card className="mt-6">
          <CardHeader
            title="Pending deletes"
            description="Moderator requests waiting for your approval"
          />
          <ul className="space-y-3 px-4 pb-4">
            {deleteRequests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{r.serverName ?? 'Unknown server'}</p>
                  <p className="text-xs text-muted">
                    Requested by {r.requestedByUsername ?? 'unknown'} ·{' '}
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void approveRequest(r.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void rejectRequest(r.id)}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {showCreate && canCreate ? (
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
            {canCreate ? (
              <>
                Import a package under{' '}
                <Link to="/installations" className="text-accent hover:underline">
                  Installations
                </Link>
                , then click <span className="text-text">Create server</span>.
              </>
            ) : (
              'Ask an admin or moderator to create a server.'
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
              showSelect={canSelect}
              selected={selected.has(server.id)}
              deletePending={pendingIds.has(server.id)}
              onSelectedChange={(id, checked) => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(id);
                  else next.delete(id);
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
