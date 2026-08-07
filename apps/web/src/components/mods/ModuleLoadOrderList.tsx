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
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3"
          >
            <span
              className={`select-none text-muted ${editable && onReorder ? 'cursor-grab' : ''}`}
              title={editable ? 'Drag to reorder' : undefined}
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
                ) : mod?.source === 'global' ? (
                  <Badge tone="accent">GLOBAL</Badge>
                ) : null}
                {required ? <Badge tone="danger">REQUIRED</Badge> : null}
                {row.enabled ? <Badge tone="success">ON</Badge> : null}
              </div>
              <p className="truncate text-xs text-muted">{row.id}</p>
            </div>
            {onToggle ? (
              <button
                type="button"
                role="switch"
                aria-checked={row.enabled}
                disabled={!editable || required}
                onClick={() => onToggle(row.id)}
                className={`relative h-7 w-12 rounded-full transition ${
                  row.enabled
                    ? 'bg-accent'
                    : 'border border-border bg-surface-2'
                } disabled:opacity-60`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-text transition ${
                    row.enabled ? 'left-5' : 'left-0.5'
                  }`}
                />
              </button>
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
