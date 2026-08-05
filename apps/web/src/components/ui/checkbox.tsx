import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

export function Checkbox({
  className,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-text">
      <input
        type="checkbox"
        className={cn(
          'size-4 rounded border-border accent-accent',
          className,
        )}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
