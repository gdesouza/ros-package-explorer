import { Pencil, Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  /** Accessible name of the field, e.g. "version". */
  label: string;
  text: string;
  email?: string;
  multiline?: boolean;
  withEmail?: boolean;
  /** Shown when not editing. */
  children: ReactNode;
  add?: boolean;
  onSave(text: string, email: string): Promise<string | null>;
}

const inputCls = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-2 focus:outline-primary';

/** Displays a value with a pencil that turns it into an inline editor. */
export function EditableField({ label, text, email = '', multiline, withEmail, children, add, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [draftEmail, setDraftEmail] = useState(email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  const start = () => {
    setDraft(text);
    setDraftEmail(email);
    setError(null);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const message = await onSave(draft, draftEmail).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    saving.current = false;
    setBusy(false);
    if (message) setError(message);
    else setEditing(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') (e.preventDefault(), cancel());
    else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) (e.preventDefault(), void save());
  };

  if (!editing) {
    return (
      <span className="inline-flex max-w-full items-start gap-1.5">
        <span className="min-w-0">{children}</span>
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`${add ? 'Add' : 'Edit'} ${label}`}
          title={`${add ? 'Add' : 'Edit'} ${label}`}
          onClick={start}
        >
          {add ? <Plus size={14} /> : <Pencil size={14} />}
        </button>
      </span>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2" onKeyDown={onKey}>
      {multiline ? (
        <textarea className={inputCls} rows={5} aria-label={label} value={draft} autoFocus disabled={busy} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input className={inputCls} aria-label={label} value={draft} autoFocus disabled={busy} onChange={(e) => setDraft(e.target.value)} />
      )}
      {withEmail && (
        <input className={inputCls} aria-label={`${label} email`} placeholder="email" value={draftEmail} disabled={busy} onChange={(e) => setDraftEmail(e.target.value)} />
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button disabled={busy} onClick={cancel}>Cancel</Button>
        <span className="text-xs text-muted-foreground">Writes to package.xml{multiline ? ' · Ctrl+Enter to save' : ''}</span>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
