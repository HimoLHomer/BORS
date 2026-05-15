import React, { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { dividendInfoLinkLabel, normalizeDividendInfoUrl } from './dividendInfoLinks';

export function DividendInfoLinkCell({
  url,
  onSave,
}: {
  url: string | null;
  onSave: (url: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url ?? '');

  useEffect(() => {
    if (!editing) setDraft(url ?? '');
  }, [url, editing]);

  const commit = useCallback(() => {
    const normalized = normalizeDividendInfoUrl(draft);
    onSave(normalized);
    setEditing(false);
  }, [draft, onSave]);

  if (editing) {
    return (
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            setDraft(url ?? '');
            setEditing(false);
          }
        }}
        autoFocus
        placeholder="https://…"
        className="w-full max-w-[200px] bg-bg/50 border border-border rounded-lg px-2 py-1 text-[11px] font-mono text-text-p focus:outline-none focus:border-accent/50"
      />
    );
  }

  if (url) {
    return (
      <div className="flex items-center justify-start gap-1 min-w-0">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent/80 text-[11px] truncate max-w-[160px] underline-offset-2 hover:underline"
          title={url}
        >
          {dividendInfoLinkLabel(url)}
        </a>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 text-text-s/40 hover:text-text-s rounded shrink-0"
          aria-label="Edit dividend info link"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-[10px] font-bold uppercase tracking-wider text-text-s/40 hover:text-text-s"
    >
      Add link
    </button>
  );
}
