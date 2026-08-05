import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

export function Badge({
  className,
  tone = 'muted',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'muted' | 'success' | 'danger' | 'accent';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone === 'muted' && 'bg-surface-2 text-muted',
        tone === 'success' && 'bg-success/15 text-success',
        tone === 'danger' && 'bg-danger/15 text-danger',
        tone === 'accent' && 'bg-accent/15 text-accent',
        className,
      )}
      {...props}
    />
  );
}
