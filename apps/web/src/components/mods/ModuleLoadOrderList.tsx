import { useState } from 'react';
import {
  isRequiredModuleId,
  type ScannedModule,
} from '@bannerlord-panel/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type ModuleRow = {
  id: string;
  enabled: boolean;
  module?: ScannedModule;
};

export function ModuleLoadOrderList({
  rows,
  editable,
  onToggle,
  onReorder,
  emptyHint,
}: {
  rows: ModuleRow[];
  editable: boolean;
  onToggle?: (id: string) => void;
  onReorder?: (from: number, to: number) => void;
  emptyHint?: string;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        {emptyHint ??
          'No modules found. Drop module folders into the host mods/ directory or ensure the installation includes engine/Modules.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const mod = row.module;
        const required = Boolean(mod?.required || isRequiredModuleId(row.id));
        const canToggle = Boolean(onToggle) && editable && !required;
        const loadIndex = row.enabled
          ? rows.filter((r) => r.enabled).findIndex((r) => r.id === row.id) + 1
          : null;

        return (
          <div
            key={row.id}
            draggable={editable && Boolean(onReorder)}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && onReorder) onReorder(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3 ${
              row.enabled
                ? 'border-border bg-surface'
                : 'border-border/70 bg-surface/60 opacity-90'
            }`}
          >
            <span
              className={`select-none text-muted ${editable && onReorder ? 'cursor-grab' : ''}`}
              title={editable ? 'Drag to reorder' : undefined}
              aria-hidden
            >
              ⋮⋮
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border text-sm text-muted">
              {loadIndex ?? '—'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">
                  {mod?.name ?? row.id}
                </span>
                {mod?.source === 'builtin' ? (
                  <Badge tone="muted">BUILT-IN</Badge>
                ) : mod?.source === 'global' ? (
                  <Badge tone="accent">GLOBAL</Badge>
                ) : null}
                {required ? <Badge tone="danger">REQUIRED</Badge> : null}
                {row.enabled ? (
                  <Badge tone="success">ON</Badge>
                ) : (
                  <Badge tone="muted">OFF</Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted">{row.id}</p>
            </div>
            {onToggle ? (
              <Button
                type="button"
                size="sm"
                variant={row.enabled ? 'secondary' : 'primary'}
                disabled={!canToggle}
                title={
                  required
                    ? 'Required Coop modules stay enabled'
                    : row.enabled
                      ? 'Disable this module in the preset'
                      : 'Enable this module in the preset'
                }
                onClick={() => {
                  if (canToggle) onToggle(row.id);
                }}
                aria-pressed={row.enabled}
              >
                {required ? 'Required' : row.enabled ? 'Disable' : 'Enable'}
              </Button>
            ) : null}
            {onReorder ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!editable || index === 0}
                  onClick={() => onReorder(index, index - 1)}
                  aria-label="Move up"
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!editable || index === rows.length - 1}
                  onClick={() => onReorder(index, index + 1)}
                  aria-label="Move down"
                >
                  ↓
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
