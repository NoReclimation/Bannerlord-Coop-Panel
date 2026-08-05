import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variant === 'primary' &&
          'bg-accent text-bg hover:bg-accent-hover',
        variant === 'secondary' &&
          'bg-surface-2 text-text border border-border hover:border-accent/50',
        variant === 'danger' && 'bg-danger/90 text-white hover:bg-danger',
        variant === 'ghost' && 'text-muted hover:text-text hover:bg-surface-2',
        className,
      )}
      {...props}
    />
  );
}
