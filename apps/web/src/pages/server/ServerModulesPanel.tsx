import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isRequiredModuleId,
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

type Row = {
  id: string;
  enabled: boolean;
  module?: ScannedModule;
};

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
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

  const [modules, setModules] = useState<ScannedModule[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [modpacks, setModpacks] = useState<ModpackPreset[]>([]);
  const [selectedPack, setSelectedPack] = useState('');
  const [packName, setPackName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, ScannedModule>();
    for (const m of modules) map.set(m.id, m);
    return map;
  }, [modules]);

  const buildRows = useCallback(
    (scanned: ScannedModule[], enabledOrderedIds: string[]) => {
      const enabledSet = new Set(enabledOrderedIds);
      const ordered: Row[] = [];
      for (const id of enabledOrderedIds) {
        ordered.push({ id, enabled: true, module: scanned.find((m) => m.id === id) });
      }
      for (const m of scanned) {
        if (!enabledSet.has(m.id)) {
          ordered.push({ id: m.id, enabled: false, module: m });
        }
      }
      return ordered;
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [modulesRes, packsRes] = await Promise.all([
        api.getServerModules(serverId),
        api.listModpacks(hostId).catch(() => ({ modpacks: [] as ModpackPreset[] })),
      ]);
      setModules(modulesRes.modules);
      setRows(buildRows(modulesRes.modules, modulesRes.config.enabledOrderedIds));
      setModpacks(packsRes.modpacks);
      setDirty(false);
      setInfo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  }, [serverId, hostId, buildRows]);

  useEffect(() => {
    void load();
  }, [load]);

  const installedCount = modules.length;
  const activeCount = rows.filter((r) => r.enabled).length;

  function toggle(id: string) {
    if (!canWrite) return;
    const mod = byId.get(id);
    if (mod?.required || isRequiredModuleId(id)) return;
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
    setDirty(true);
    setInfo(null);
  }

  function reorder(from: number, to: number) {
    if (!canWrite) return;
    setRows((prev) => moveItem(prev, from, to));
    setDirty(true);
    setInfo(null);
  }

  function enabledOrderedIds(): string[] {
    return rows.filter((r) => r.enabled).map((r) => r.id);
  }

  async function save() {
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.putServerModules(serverId, {
        enabledOrderedIds: enabledOrderedIds(),
      });
      setDirty(false);
      setInfo(
        result.restartRequired || serverRunning
          ? 'Saved. Module mounts and load order were applied (container recreated if it was running).'
          : 'Saved.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save modules');
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
        // Keep current enabled order; drop missing; append new disabled.
        const kept = enabled.filter((id) => result.modules.some((m) => m.id === id));
        return buildRows(result.modules, kept.length ? kept : enabledOrderedIds());
      });
      setInfo(`Rescanned — ${result.modules.length} modules found.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescan failed');
    }
  }

  function applyPack(packId: string) {
    setSelectedPack(packId);
    const pack = modpacks.find((p) => p.id === packId);
    if (!pack) return;
    setRows(buildRows(modules, pack.enabledOrderedIds));
    setDirty(true);
    setInfo(`Applied modpack “${pack.name}”. Save to persist.`);
  }

  async function saveAsPack() {
    if (!canWrite) return;
    const name = packName.trim();
    if (!name) {
      setError('Enter a modpack name');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { modpack } = await api.putModpack(hostId, {
        name,
        enabledOrderedIds: enabledOrderedIds(),
      });
      setModpacks((prev) =>
        [...prev.filter((p) => p.id !== modpack.id), modpack].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setSelectedPack(modpack.id);
      setPackName('');
      setInfo(`Modpack “${modpack.name}” saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save modpack');
    } finally {
      setSaving(false);
    }
  }

  async function deletePack() {
    if (!canWrite || !selectedPack) return;
    if (!window.confirm('Delete this modpack preset?')) return;
    try {
      await api.deleteModpack(hostId, selectedPack);
      setModpacks((prev) => prev.filter((p) => p.id !== selectedPack));
      setSelectedPack('');
      setInfo('Modpack deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete modpack');
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
            Enable installed modules and arrange their load order. Third-party
            mods live once under the host{' '}
            <code className="text-accent">mods/</code> folder.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">
            {installedCount} installed · {activeCount} active
          </span>
          <Button size="sm" variant="secondary" onClick={() => void rescan()}>
            Rescan
          </Button>
          {canWrite ? (
            <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {info ? <p className="text-sm text-accent">{info}</p> : null}

      <Card>
        <CardHeader
          title="Modpacks"
          description="Named presets of enabled modules + load order for this host."
        />
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label htmlFor="modpack-select">Apply modpack</Label>
            <select
              id="modpack-select"
              className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
              value={selectedPack}
              onChange={(e) => applyPack(e.target.value)}
              disabled={!canWrite}
            >
              <option value="">Select…</option>
              {modpacks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {canWrite ? (
            <>
              <div className="min-w-[10rem] flex-1 space-y-1">
                <Label htmlFor="modpack-name">Save as modpack</Label>
                <Input
                  id="modpack-name"
                  value={packName}
                  onChange={(e) => setPackName(e.target.value)}
                  placeholder="Preset name"
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => void saveAsPack()}
              >
                Save preset
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!selectedPack}
                onClick={() => void deletePack()}
              >
                Delete preset
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            No modules found. Drop module folders into the host{' '}
            <code className="text-accent">mods/</code> directory or ensure the
            installation includes <code className="text-accent">engine/Modules</code>.
          </p>
        ) : (
          rows.map((row, index) => {
            const mod = row.module ?? byId.get(row.id);
            const required = Boolean(mod?.required || isRequiredModuleId(row.id));
            const loadIndex = row.enabled
              ? rows.filter((r) => r.enabled).findIndex((r) => r.id === row.id) + 1
              : null;

            return (
              <div
                key={row.id}
                draggable={canWrite}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) reorder(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3"
              >
                <span
                  className="cursor-grab select-none text-muted"
                  title="Drag to reorder"
                  aria-hidden
                >
                  ⋮⋮
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded border border-border text-sm text-muted">
                  {loadIndex ?? '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">
                      {mod?.name ?? row.id}
                    </span>
                    {mod?.source === 'builtin' ? (
                      <Badge tone="muted">BUILT-IN</Badge>
                    ) : (
                      <Badge tone="accent">GLOBAL</Badge>
                    )}
                    {required ? <Badge tone="danger">REQUIRED</Badge> : null}
                    {row.enabled ? <Badge tone="success">ON</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted">{row.id}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  disabled={!canWrite || required}
                  onClick={() => toggle(row.id)}
                  className={`relative h-7 w-12 rounded-full transition ${
                    row.enabled ? 'bg-accent' : 'bg-surface-2 border border-border'
                  } disabled:opacity-60`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-text transition ${
                      row.enabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canWrite || index === 0}
                    onClick={() => reorder(index, index - 1)}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canWrite || index === rows.length - 1}
                    onClick={() => reorder(index, index + 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
