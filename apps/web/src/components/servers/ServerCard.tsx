import { Link } from 'react-router-dom';
import type { GameServerRecord } from '@bannerlord-panel/shared';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

function statusTone(status: string): 'success' | 'danger' | 'muted' | 'accent' {
  if (status === 'running') return 'success';
  if (status === 'error' || status === 'crashed') return 'danger';
  if (status === 'starting' || status === 'stopping') return 'accent';
  return 'muted';
}

export function ServerCard({
  server,
  onControl,
  onDelete,
  selected,
  onSelectedChange,
  deletePending,
  showSelect,
}: {
  server: GameServerRecord;
  onControl: (id: string, action: 'start' | 'stop' | 'restart' | 'kill') => void;
  onDelete?: (id: string) => void;
  selected?: boolean;
  onSelectedChange?: (id: string, selected: boolean) => void;
  deletePending?: boolean;
  showSelect?: boolean;
}) {
  const { can } = useAuth();
  const canControl = can('servers:control');
  const canKill = can('servers:kill');
  const canDelete = can('servers:delete');
  const canDeleteRequest = can('servers:delete-request');
  const showDelete = !!onDelete && (canDelete || canDeleteRequest);
  const showActions = canControl || showDelete;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {showSelect && onSelectedChange ? (
            <input
              type="checkbox"
              className="mt-1.5 size-4 shrink-0 rounded border border-border bg-surface-2 accent-[var(--accent)]"
              checked={!!selected}
              onChange={(e) => onSelectedChange(server.id, e.target.checked)}
              aria-label={`Select ${server.name}`}
            />
          ) : null}
          <div className="min-w-0">
            <Link
              to={`/servers/${server.id}`}
              className="text-lg font-semibold hover:text-accent"
            >
              {server.name}
            </Link>
            <p className="mt-1 text-sm text-muted">
              UDP {server.gamePort} · {server.saveName}
            </p>
            {deletePending ? (
              <Badge tone="accent" className="mt-2">
                Delete pending
              </Badge>
            ) : null}
          </div>
        </div>
        <Badge tone={statusTone(server.status)}>{server.status}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted">Last restart</dt>
          <dd>
            {server.lastRestartAt
              ? new Date(server.lastRestartAt).toLocaleString()
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Container</dt>
          <dd className="truncate">{server.containerName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Players connected</dt>
          <dd>
            {server.status === 'running' && server.playerCount != null
              ? server.playerCount
              : server.status === 'running'
                ? '—'
                : '0'}
          </dd>
        </div>
      </dl>

      {showActions ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {canControl ? (
            <>
              <Button size="sm" onClick={() => onControl(server.id, 'start')}>
                Start
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onControl(server.id, 'stop')}
              >
                Stop
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onControl(server.id, 'restart')}
              >
                Restart
              </Button>
              {canKill ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onControl(server.id, 'kill')}
                >
                  Kill
                </Button>
              ) : null}
            </>
          ) : null}
          {showDelete ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDelete(server.id)}
            >
              {canDelete ? 'Delete' : 'Request delete'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
