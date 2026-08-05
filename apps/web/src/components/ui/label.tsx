import { cn } from '@/lib/utils';
import type { LabelHTMLAttributes } from 'react';

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-sm text-muted', className)}
      {...props}
    />
  );
}
