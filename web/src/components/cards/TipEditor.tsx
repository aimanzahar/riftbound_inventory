import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { cx, relTime, wordCount } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';

const SOFT_WORDS = 50;
const HARD_WORDS = 60;
const HARD_CHARS = 400;

/** Per-card usage tip: display with “by Codex · edited by X”, inline textarea editor with a live word counter. */
export function TipEditor({ cardId, startEditing = false, className }: { cardId: string; startEditing?: boolean; className?: string }) {
  const tip = useStore((s) => s.tips.get(cardId));
  const devices = useStore((s) => s.devices);
  const me = useStore((s) => s.me);
  const saveTip = useStore((s) => s.saveTip);
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(tip?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setText(tip?.text ?? '');
  }, [tip?.text, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autogrow(el);
  }, [editing]);

  const words = wordCount(text);
  const chars = text.trim().length;
  const tooLong = words > HARD_WORDS || chars > HARD_CHARS;
  const dirty = text.trim() !== (tip?.text ?? '').trim();
  const canSave = dirty && chars > 0 && !tooLong && !busy;

  const editorName = (id: string | null | undefined) => (id ? (id === me.id ? 'you' : (devices.find((d) => d.id === id)?.name ?? 'someone')) : null);
  const meta = tip
    ? [
        tip.source === 'codex' ? `by Codex${tip.model ? ` (${tip.model})` : ''}` : 'by you & friends',
        tip.edited_at ? `edited by ${editorName(tip.edited_by) ?? 'someone'} ${relTime(tip.edited_at)}` : tip.generated_at ? `generated ${relTime(tip.generated_at)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const ok = await saveTip(cardId, text.trim());
    setBusy(false);
    if (ok) {
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    }
  };
  const cancel = () => {
    setText(tip?.text ?? '');
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className={cx('group flex flex-col gap-1.5', className)}>
        <p className={cx('text-[14px] leading-relaxed', tip ? 'text-fg/90' : 'italic text-faint')}>{tip ? tip.text : 'No tip yet — write one in under 50 words.'}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-faint">{saved ? <span className="text-success">Saved</span> : meta}</span>
          <Button variant="ghost" size="xs" leftIcon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
            {tip ? 'Edit' : 'Write tip'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <textarea
        ref={ta}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autogrow(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void save();
        }}
        rows={3}
        maxLength={HARD_CHARS + 50}
        placeholder="When to play it, what it answers or combos with, one common mistake…"
        aria-label="Card tip"
        className="min-h-[72px] w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-[14px] leading-relaxed text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <div className="flex items-center justify-between gap-2">
        <span className={cx('tabular text-[11px]', tooLong ? 'text-danger' : words > SOFT_WORDS ? 'text-warning' : 'text-faint')} aria-live="polite">
          {words} / {SOFT_WORDS} words{chars > HARD_CHARS ? ` · ${chars}/${HARD_CHARS} chars` : ''}
          {tooLong ? ' — too long' : words > SOFT_WORDS ? ' — keep it under 50' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={!canSave} loading={busy}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function autogrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(260, el.scrollHeight + 2)}px`;
}
