import { format } from '../dateUtils.js';

export default function Header({ now, accountCount, onOpenAccounts, onAddEvent }) {
  return (
    <header className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
      <div>
        <div className="font-serif text-xl text-ink">{format(now, 'EEEE')}</div>
        <div className="text-sm text-faint">{format(now, 'h:mm a')}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-full bg-surface px-4 py-2.5 text-sm font-medium text-muted active:bg-surface-2"
          onClick={onOpenAccounts}
        >
          Accounts · {accountCount}
        </button>
        <button
          className="rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink active:opacity-80"
          onClick={onAddEvent}
        >
          + Add event
        </button>
      </div>
    </header>
  );
}
