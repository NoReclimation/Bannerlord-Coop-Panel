import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GameServerRecord } from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { ServerSettingsPanel } from './server/ServerSettingsPanel';
import { ServerConsole } from './server/ServerConsole';
import { ServerFileManager } from './server/ServerFileManager';
import { ServerSchedules } from './server/ServerSchedules';
import { ServerBackups } from './server/ServerBackups';

type Tab = 'console' | 'files' | 'schedules' | 'backups' | 'settings';

export function ServerPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canControl = can('servers:control');
  const canWrite = can('servers:write');
  const [server, setServer] = useState<GameServerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('console');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getServer(id);
      setServer(data.server);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load server');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function control(action: 'start' | 'stop' | 'restart' | 'kill') {
    try {
      const data = await api.controlServer(id, action);
      setServer(data.server);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Control failed');
    }
  }

  async function removeServer() {
    if (!server) return;
    if (
      !window.confirm(
        `Remove "${server.name}"? This deletes the container. Saves and backups on disk are kept.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteServer(server.id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  }

  if (!server && !error) {
    return <p className="text-muted">Loading server…</p>;
  }

  if (!server) {
    return <p className="text-danger">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-muted hover:text-accent">
            ← Servers
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h2 className="text-2xl font-semibold">{server.name}</h2>
            <Badge
              tone={
                server.status === 'running'
                  ? 'success'
                  : server.status === 'error'
                    ? 'danger'
                    : 'muted'
              }
            >
              {server.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            Port {server.gamePort} · Install {server.installationId}
          </p>
        </div>
        {canControl || canWrite ? (
          <div className="flex flex-wrap gap-2">
            {canControl ? (
              <>
                <Button size="sm" onClick={() => void control('start')}>
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void control('stop')}
                >
                  Stop
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void control('restart')}
                >
                  Restart
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void control('kill')}
                >
                  Kill
                </Button>
              </>
            ) : null}
            {canWrite ? (
              <Button
                size="sm"
                variant="danger"
                disabled={deleting}
                onClick={() => void removeServer()}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-2 border-b border-border pb-2">
        <Button
          size="sm"
          variant={tab === 'console' ? 'primary' : 'ghost'}
          onClick={() => setTab('console')}
        >
          Console
        </Button>
        <Button
          size="sm"
          variant={tab === 'files' ? 'primary' : 'ghost'}
          onClick={() => setTab('files')}
        >
          Files
        </Button>
        <Button
          size="sm"
          variant={tab === 'schedules' ? 'primary' : 'ghost'}
          onClick={() => setTab('schedules')}
        >
          Schedules
        </Button>
        <Button
          size="sm"
          variant={tab === 'backups' ? 'primary' : 'ghost'}
          onClick={() => setTab('backups')}
        >
          Backups
        </Button>
        <Button
          size="sm"
          variant={tab === 'settings' ? 'primary' : 'ghost'}
          onClick={() => setTab('settings')}
        >
          Settings
        </Button>
      </div>

      {tab === 'console' ? (
        <ServerConsole serverId={server.id} />
      ) : tab === 'files' ? (
        <ServerFileManager serverId={server.id} />
      ) : tab === 'schedules' ? (
        <ServerSchedules serverId={server.id} />
      ) : tab === 'backups' ? (
        <ServerBackups serverId={server.id} />
      ) : (
        <ServerSettingsPanel serverId={server.id} />
      )}
    </div>
  );
}
