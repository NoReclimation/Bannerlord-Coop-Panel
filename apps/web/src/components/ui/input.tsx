import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent',
        className,
      )}
      {...props}
    />
  );
}
