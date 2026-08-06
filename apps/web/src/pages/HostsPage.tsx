import { useCallback, useEffect, useState } from 'react';
import type { HostNode } from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';

export function HostsPage() {
  const { can } = useAuth();
  const [hosts, setHosts] = useState<HostNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listHosts();
      setHosts(data.hosts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hosts');
    }
  }, []);

  useEffect(() => {
    if (can('hosts:read')) void load();
  }, [can, load]);

  if (!can('hosts:read')) {
    return <p className="text-danger">Admin access required.</p>;
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold">Hosts</h2>
      <p className="mt-1 text-sm text-muted">
        Management agents registered with the control plane.
      </p>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {hosts.map((host) => (
          <Card key={host.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{host.name}</h3>
                <p className="mt-1 text-sm text-muted">{host.dataRoot}</p>
              </div>
              <Badge
                tone={
                  host.status === 'online'
                    ? 'success'
                    : host.status === 'disabled'
                      ? 'danger'
                      : 'muted'
                }
              >
                {host.status}
              </Badge>
            </div>
            <p className="mt-3 truncate text-xs text-muted">{host.id}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
