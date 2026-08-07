import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isRequiredModuleId,
  type HostNode,
  type GameInstallation,
  type ModpackPreset,
  type ScannedModule,
} from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ModuleLoadOrderList,
  type ModuleRow,
} from '@/components/mods/ModuleLoadOrderList';

type PageTab = 'modpacks' | 'load-orders';

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

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

function defaultEnabledIds(modules: ScannedModule[]): string[] {
  return modules
    .filter((m) => m.required || isRequiredModuleId(m.id))
    .map((m) => m.id);
}

export function ModsPage() {
  const { can } = useAuth();
  const canEdit = can('installations:write');

  const [tab, setTab] = useState<PageTab>('modpacks');
  const [hosts, setHosts] = useState<HostNode[]>([]);
  const [installations, setInstallations] = useState<GameInstallation[]>([]);
  const [hostId, setHostId] = useState('');
  const [installationId, setInstallationId] = useState('');
  const [modules, setModules] = useState<ScannedModule[]>([]);
  const [modpacks, setModpacks] = useState<ModpackPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [packName, setPackName] = useState('');
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const hostInstallations = useMemo(
    () => installations.filter((i) => i.hostId === hostId),
    [installations, hostId],
  );

  useEffect(() => {
    if (!can('installations:read')) return;
    void (async () => {
      try {
        const installsRes = await api.listInstallations();
        setInstallations(installsRes.installations);

        let hostList: HostNode[] = [];
        if (can('hosts:read')) {
          try {
            const hostsRes = await api.listHosts();
            hostList = hostsRes.hosts;
          } catch {
            hostList = [];
          }
        }
        if (hostList.length === 0) {
          // Moderators may lack hosts:read — synthesize from installations.
          const seen = new Map<string, HostNode>();
          for (const inst of installsRes.installations) {
            if (!seen.has(inst.hostId)) {
              seen.set(inst.hostId, {
                id: inst.hostId,
                name: `Host ${inst.hostId.slice(0, 8)}`,
                endpoint: '',
                dataRoot: '',
                status: 'online',
                createdAt: inst.createdAt,
              });
            }
          }
          hostList = [...seen.values()];
        }
        setHosts(hostList);
        const first =
          hostList.find((h) => h.status === 'online') ?? hostList[0];
        if (first) setHostId(first.id);
        else setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load hosts');
        setLoading(false);
      }
    })();
  }, [can]);

  const loadHostData = useCallback(async () => {
    if (!hostId) return;
    setLoading(true);
    setError(null);
    try {
      const installForHost = installations.filter((i) => i.hostId === hostId);
      const chosen =
        installForHost.find((i) => i.id === installationId) ??
        installForHost[0];
      if (chosen && chosen.id !== installationId) {
        setInstallationId(chosen.id);
      }
      const [modsRes, packsRes] = await Promise.all([
        api.scanHostModules(hostId, chosen?.id),
        api.listModpacks(hostId),
      ]);
      setModules(modsRes.modules);
      setModpacks(packsRes.modpacks);
      setRows((prev) => {
        if (editingId) return prev;
        return buildRows(modsRes.modules, defaultEnabledIds(modsRes.modules));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mods');
    } finally {
      setLoading(false);
    }
  }, [hostId, installationId, installations, editingId]);

  useEffect(() => {
    if (!hostId) return;
    void loadHostData();
  }, [hostId, installationId, loadHostData]);

  function startCreate() {
    setEditingId('new');
    setPackName('');
    setRows(buildRows(modules, defaultEnabledIds(modules)));
    setTab('load-orders');
    setInfo(null);
    setError(null);
  }

  function startEdit(pack: ModpackPreset) {
    setEditingId(pack.id);
    setPackName(pack.name);
    setRows(buildRows(modules, pack.enabledOrderedIds));
    setTab('load-orders');
    setInfo(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setPackName('');
    setRows(buildRows(modules, defaultEnabledIds(modules)));
    setTab('modpacks');
  }

  function toggle(id: string) {
    if (!canEdit) return;
    const mod = modules.find((m) => m.id === id);
    if (mod?.required || isRequiredModuleId(id)) return;
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }

  function reorder(from: number, to: number) {
    if (!canEdit) return;
    setRows((prev) => moveItem(prev, from, to));
  }

  async function savePack() {
    if (!canEdit || !hostId) return;
    const name = packName.trim();
    if (!name) {
      setError('Enter a modpack name');
      return;
    }
    const enabledOrderedIds = rows.filter((r) => r.enabled).map((r) => r.id);
    if (enabledOrderedIds.length === 0) {
      setError('Enable at least one module');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { modpack } = await api.putModpack(hostId, {
        id: editingId && editingId !== 'new' ? editingId : undefined,
        name,
        enabledOrderedIds,
      });
      setModpacks((prev) =>
        [...prev.filter((p) => p.id !== modpack.id), modpack].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setEditingId(null);
      setPackName('');
      setTab('modpacks');
      setInfo(`Saved modpack “${modpack.name}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save modpack');
    } finally {
      setSaving(false);
    }
  }

  async function deletePack(id: string, name: string) {
    if (!canEdit || !hostId) return;
    if (!window.confirm(`Delete modpack “${name}”?`)) return;
    try {
      await api.deleteModpack(hostId, id);
      setModpacks((prev) => prev.filter((p) => p.id !== id));
      if (editingId === id) cancelEdit();
      setInfo(`Deleted “${name}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete modpack');
    }
  }

  async function rescan() {
    if (!hostId) return;
    setError(null);
    try {
      const modsRes = await api.scanHostModules(
        hostId,
        installationId || undefined,
      );
      setModules(modsRes.modules);
      setInfo(`Rescanned — ${modsRes.modules.length} modules found.`);
      if (editingId) {
        setRows((prev) => {
          const enabled = prev.filter((r) => r.enabled).map((r) => r.id);
          const kept = enabled.filter((id) =>
            modsRes.modules.some((m) => m.id === id),
          );
          return buildRows(
            modsRes.modules,
            kept.length ? kept : defaultEnabledIds(modsRes.modules),
          );
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescan failed');
    }
  }

  if (!can('installations:read')) {
    return <p className="text-danger">Access required.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Mods</h2>
          <p className="mt-1 text-sm text-muted">
            Build modpacks with a fixed load order. Servers apply these presets —
            drop third-party modules into the host{' '}
            <code className="text-accent">mods/</code> folder once.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {hosts.length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor="mods-host">Host</Label>
              <select
                id="mods-host"
                className="h-10 min-w-[10rem] rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
                value={hostId}
                onChange={(e) => {
                  setHostId(e.target.value);
                  setInstallationId('');
                  setEditingId(null);
                }}
              >
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {hostInstallations.length > 1 ? (
            <div className="space-y-1">
              <Label htmlFor="mods-install">Installation</Label>
              <select
                id="mods-install"
                className="h-10 min-w-[10rem] rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
                value={installationId}
                onChange={(e) => setInstallationId(e.target.value)}
              >
                {hostInstallations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} ({i.gameVersion})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
          variant={tab === 'modpacks' ? 'primary' : 'ghost'}
          onClick={() => setTab('modpacks')}
        >
          Mod packs
        </Button>
        <Button
          size="sm"
          variant={tab === 'load-orders' ? 'primary' : 'ghost'}
          onClick={() => setTab('load-orders')}
        >
          Load orders
        </Button>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : tab === 'modpacks' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {modpacks.length} preset{modpacks.length === 1 ? '' : 's'} ·{' '}
              {modules.length} module{modules.length === 1 ? '' : 's'} on host
            </p>
            {canEdit ? (
              <Button size="sm" onClick={startCreate}>
                New modpack
              </Button>
            ) : (
              <p className="text-xs text-muted">
                Admin access required to edit.
              </p>
            )}
          </div>
          {modpacks.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-muted">
                No modpacks yet. Create one under Load orders with the modules
                enabled in the order you want servers to use.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {modpacks.map((pack) => (
                <Card key={pack.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-text">{pack.name}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {pack.enabledOrderedIds.length} modules in load order
                      </p>
                    </div>
                    <Badge tone="accent">PRESET</Badge>
                  </div>
                  <ol className="mt-3 list-decimal space-y-0.5 pl-4 text-xs text-muted">
                    {pack.enabledOrderedIds.slice(0, 8).map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                    {pack.enabledOrderedIds.length > 8 ? (
                      <li>… +{pack.enabledOrderedIds.length - 8} more</li>
                    ) : null}
                  </ol>
                  {canEdit ? (
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startEdit(pack)}
                      >
                        Edit load order
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void deletePack(pack.id, pack.name)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {!canEdit ? (
            <p className="text-sm text-muted">
              Only admins can create or change load-order presets. Open a
              modpack from Mod packs to review it after an admin builds it.
            </p>
          ) : (
            <Card>
              <CardHeader
                title={
                  editingId && editingId !== 'new'
                    ? 'Edit modpack'
                    : 'New modpack'
                }
                description="Enable modules and set load order. Required Coop modules stay on."
              />
              <div className="flex flex-wrap items-end gap-3 px-4 py-3">
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <Label htmlFor="pack-name">Name</Label>
                  <Input
                    id="pack-name"
                    value={packName}
                    onChange={(e) => setPackName(e.target.value)}
                    placeholder="e.g. Vanilla Coop"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={saving || !editingId}
                  onClick={() => void savePack()}
                >
                  {saving ? 'Saving…' : 'Save modpack'}
                </Button>
                {editingId ? (
                  <Button size="sm" variant="ghost" onClick={cancelEdit}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {modules.length} installed ·{' '}
              {rows.filter((r) => r.enabled).length} active in this preset
            </p>
            {canEdit && !editingId ? (
              <Button size="sm" onClick={startCreate}>
                Start new preset
              </Button>
            ) : null}
          </div>

          <ModuleLoadOrderList
            rows={rows}
            editable={canEdit && Boolean(editingId)}
            onToggle={canEdit && editingId ? toggle : undefined}
            onReorder={canEdit && editingId ? reorder : undefined}
          />
        </div>
      )}
    </div>
  );
}
