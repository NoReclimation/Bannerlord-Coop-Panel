import { cn } from '@/lib/utils';
import type { SelectHTMLAttributes } from 'react';

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none focus:border-accent',
        className,
      )}
      {...props}
    />
  );
}
