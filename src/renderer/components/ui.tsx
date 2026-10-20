import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'outline',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90',
        variant === 'outline' && 'border border-border bg-card hover:bg-accent',
        variant === 'ghost' && 'hover:bg-accent',
        className,
      )}
    />
  );
}

type Tone = 'neutral' | 'danger' | 'warning' | 'success' | 'primary';
const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  danger: 'text-danger border-danger',
  warning: 'text-warning border-warning',
  success: 'text-success border-success',
  primary: 'text-primary border-primary',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div
      role={tone === 'neutral' ? 'status' : 'alert'}
      className={cx(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'neutral' && 'border-border bg-muted',
        tone === 'warning' && 'border-warning text-warning',
        tone === 'danger' && 'border-danger text-danger',
      )}
    >
      {children}
    </div>
  );
}

export const statusTone = (s: string): Tone =>
  s === 'ok' ? 'success' : s === 'warning' ? 'warning' : 'danger';

export const statusLabel = (s: string) =>
  ({ ok: 'OK', warning: 'Warnings', invalid: 'Invalid', unsupported: 'Unsupported', unreadable: 'Unreadable' })[s] ?? s;

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(2)} MiB`;
