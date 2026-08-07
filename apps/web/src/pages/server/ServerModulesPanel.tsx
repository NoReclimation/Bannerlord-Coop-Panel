import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ModpackPreset, ScannedModule } from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  ModuleLoadOrderList,
  type ModuleRow,
} from '@/components/mods/ModuleLoadOrderList';

type SubTab = 'modpacks' | 'load-order';

function buildRows(
  scanned: ScannedModule[],
  enabledOrderedIds: string[],
): ModuleRow[] {
  const enabledSet = new Set(enabledOrderedIds);
  const ordered: ModuleRow[] = [];
  for (const id of enabledOrderedIds) {
    ordered.push({
      id,
      enabled: true,
      module: scanned.find((m) => m.id === id),
    });
  }
  for (const m of scanned) {
    if (!enabledSet.has(m.id)) {
      ordered.push({ id: m.id, enabled: false, module: m });
    }
  }
  return ordered;
}

export function ServerModulesPanel({
  serverId,
  hostId,
  serverRunning,
}: {
  serverId: string;
  hostId: string;
  serverRunning: boolean;
}) {
  const { can } = useAuth();
  const canWrite = can('servers:write');
  const canManagePacks = can('installations:write');

  const [subTab, setSubTab] = useState<SubTab>('modpacks');
  const [modules, setModules] = useState<ScannedModule[]>([]);
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [modpacks, setModpacks] = useState<ModpackPreset[]>([]);
  const [selectedPack, setSelectedPack] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [modulesRes, packsRes] = await Promise.all([
        api.getServerModules(serverId),
        api
          .listModpacks(hostId)
          .catch(() => ({ modpacks: [] as ModpackPreset[] })),
      ]);
      setModules(modulesRes.modules);
      setRows(
        buildRows(modulesRes.modules, modulesRes.config.enabledOrderedIds),
      );
      setModpacks(packsRes.modpacks);
      setInfo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  }, [serverId, hostId]);

  useEffect(() => {
    void load();
  }, [load]);

  const installedCount = modules.length;
  const activeCount = rows.filter((r) => r.enabled).length;

  async function applySelectedPack() {
    if (!canWrite || !selectedPack) return;
    const pack = modpacks.find((p) => p.id === selectedPack);
    if (!pack) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.putServerModules(serverId, {
        enabledOrderedIds: pack.enabledOrderedIds,
      });
      setRows(buildRows(modules, pack.enabledOrderedIds));
      setInfo(
        result.restartRequired || serverRunning
          ? `Applied “${pack.name}”. Container was recreated if it was running.`
          : `Applied “${pack.name}”.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply modpack');
    } finally {
      setSaving(false);
    }
  }

  async function rescan() {
    setError(null);
    try {
      const result = await api.rescanServerModules(serverId);
      setModules(result.modules);
      setRows((prev) => {
        const enabled = prev.filter((r) => r.enabled).map((r) => r.id);
        const kept = enabled.filter((id) =>
          result.modules.some((m) => m.id === id),
        );
        return buildRows(result.modules, kept.length ? kept : enabled);
      });
      setInfo(`Rescanned — ${result.modules.length} modules found.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescan failed');
    }
  }

  if (loading) {
    return <p className="text-muted">Loading modules…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-text">Modules</h3>
          <p className="mt-1 text-sm text-muted">
            Choose an admin-defined modpack, or review this server’s active load
            order.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">
            {installedCount} installed · {activeCount} active
          </span>
          <Button size="sm" variant="secondary" onClick={() => void rescan()}>
            Rescan
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {info ? <p className="text-sm text-accent">{info}</p> : null}

      <div className="flex gap-2 border-b border-border pb-2">
        <Button
          size="sm"
          variant={subTab === 'modpacks' ? 'primary' : 'ghost'}
          onClick={() => setSubTab('modpacks')}
        >
          Modpacks
        </Button>
        <Button
          size="sm"
          variant={subTab === 'load-order' ? 'primary' : 'ghost'}
          onClick={() => setSubTab('load-order')}
        >
          Load order
        </Button>
      </div>

      {subTab === 'modpacks' ? (
        <Card>
          <CardHeader
            title="Modpacks"
            description="Pre-defined load orders built by an admin under Mods."
            action={
              canManagePacks ? (
                <Link
                  to="/mods"
                  className="text-sm text-accent hover:underline"
                >
                  Manage in Mods →
                </Link>
              ) : null
            }
          />
          <div className="flex flex-wrap items-end gap-3 px-4 py-3">
            <div className="min-w-[14rem] flex-1 space-y-1">
              <Label htmlFor="server-modpack">Select modpack</Label>
              <select
                id="server-modpack"
                className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
                value={selectedPack}
                onChange={(e) => setSelectedPack(e.target.value)}
                disabled={!canWrite}
              >
                <option value="">Select…</option>
                {modpacks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.enabledOrderedIds.length} modules)
                  </option>
                ))}
              </select>
            </div>
            {canWrite ? (
              <Button
                size="sm"
                disabled={saving || !selectedPack}
                onClick={() => void applySelectedPack()}
              >
                {saving ? 'Applying…' : 'Apply to server'}
              </Button>
            ) : null}
          </div>
          {modpacks.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">
              No modpacks on this host yet.
              {canManagePacks ? (
                <>
                  {' '}
                  Create one in{' '}
                  <Link to="/mods" className="text-accent hover:underline">
                    Mods
                  </Link>
                  .
                </>
              ) : (
                ' Ask an admin to create presets.'
              )}
            </p>
          ) : selectedPack ? (
            <div className="border-t border-border px-4 py-3">
              <p className="mb-2 text-xs text-muted">
                Preview (apply to write this order to the server)
              </p>
              <ModuleLoadOrderList
                rows={buildRows(
                  modules,
                  modpacks.find((p) => p.id === selectedPack)
                    ?.enabledOrderedIds ?? [],
                ).filter((r) => r.enabled)}
                editable={false}
              />
            </div>
          ) : null}
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Current load order for this server. To change it, apply a modpack
            from the Modpacks tab
            {canManagePacks ? (
              <>
                {' '}
                or edit presets in{' '}
                <Link to="/mods" className="text-accent hover:underline">
                  Mods
                </Link>
              </>
            ) : null}
            .
          </p>
          <ModuleLoadOrderList
            rows={rows.filter((r) => r.enabled)}
            editable={false}
          />
        </div>
      )}
    </div>
  );
}
