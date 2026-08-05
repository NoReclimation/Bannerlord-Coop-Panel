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
}: {
  server: GameServerRecord;
  onControl: (id: string, action: 'start' | 'stop' | 'restart' | 'kill') => void;
}) {
  const { can } = useAuth();

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            to={`/servers/${server.id}`}
            className="text-lg font-semibold hover:text-accent"
          >
            {server.name}
          </Link>
          <p className="mt-1 text-sm text-muted">
            UDP {server.gamePort} · {server.saveName}
          </p>
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
      </dl>

      {can('servers:control') ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
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
          <Button
            size="sm"
            variant="danger"
            onClick={() => onControl(server.id, 'kill')}
          >
            Kill
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
