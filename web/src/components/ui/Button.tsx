import type { ComponentProps, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from '../../lib/format.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-[#0b0f17] hover:bg-accent-strong active:bg-accent shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] font-semibold',
  secondary: 'bg-surface-3 text-fg hover:bg-border active:bg-border-strong',
  outline: 'border border-border-strong text-fg hover:bg-surface-3 active:bg-border',
  ghost: 'text-muted hover:text-fg hover:bg-surface-3 active:bg-border',
  danger: 'bg-danger/15 text-[#fca5a5] border border-danger/30 hover:bg-danger/25',
  link: 'text-accent hover:text-accent-strong underline-offset-4 hover:underline px-0',
};

const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-md',
  'icon-xs': 'h-7 w-7 rounded-md',
};

export function Button({ variant = 'secondary', size = 'md', loading = false, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-100',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
