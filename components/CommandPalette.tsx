import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from 'react';
import { UseNotificationsReturn } from '../hooks/useNotifications';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandAction {
  id: string;
  label: string;
  description?: string;
  /** Keyboard shortcut hint, e.g. "⌘K" */
  shortcut?: string;
  /** Icon element */
  icon?: React.ReactNode;
  /** Tags for fuzzy search */
  keywords?: string[];
  /** If true, the action is currently disabled (shown dimmed) */
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface CommandGroup {
  id: string;
  label: string;
  actions: CommandAction[];
}

/** Async state for any operation triggered from the palette */
interface ActionState {
  actionId: string | null;
  loading: boolean;
  error: string | null;
}

export interface CommandPaletteProps {
  /**
   * Groups of actions to display.
   * Rate-fetch and compliance-check actions should be passed here;
   * the palette will handle their loading/error/retry states.
   */
  groups: CommandGroup[];
  /** Notification state — errors are forwarded as persistent notifications */
  notificationState: UseNotificationsReturn;
  /** Controlled open state */
  open: boolean;
  onClose: () => void;
  /** Placeholder for the search input */
  placeholder?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matches(action: CommandAction, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (action.label.toLowerCase().includes(q)) return true;
  if (action.description?.toLowerCase().includes(q)) return true;
  return action.keywords?.some(k => k.toLowerCase().includes(q)) ?? false;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  );
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function IconExclamation({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconRefresh({ className, spinning }: { className?: string; spinning?: boolean }) {
  return (
    <svg
      className={[className, spinning ? 'animate-spin' : ''].filter(Boolean).join(' ')}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
    </svg>
  );
}

// ─── Action row ───────────────────────────────────────────────────────────────

interface ActionRowProps {
  action: CommandAction;
  active: boolean;
  state: ActionState;
  onSelect: (action: CommandAction) => void;
  onRetry: (action: CommandAction) => void;
  onRef: (el: HTMLLIElement | null) => void;
}

function ActionRow({ action, active, state, onSelect, onRetry, onRef }: ActionRowProps) {
  const isRunning = state.loading && state.actionId === action.id;
  const hasFailed = !state.loading && state.error !== null && state.actionId === action.id;

  return (
    <li
      ref={onRef}
      role="option"
      aria-selected={active}
      id={`cmd-action-${action.id}`}
      className={`flex cursor-default select-none items-center gap-3 rounded-md px-3 py-2.5 transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-900 hover:bg-gray-100'
      } ${action.disabled ? 'pointer-events-none opacity-40' : ''}`}
      onClick={() => !action.disabled && onSelect(action)}
    >
      {/* Optional custom icon */}
      {action.icon && (
        <span className={`shrink-0 ${active ? 'text-white' : 'text-gray-400'}`} aria-hidden="true">
          {action.icon}
        </span>
      )}

      {/* Labels */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{action.label}</span>
        {action.description && (
          <span className={`truncate text-xs ${active ? 'text-blue-200' : 'text-gray-400'}`}>
            {action.description}
          </span>
        )}
      </span>

      {/* Right-side status */}
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Running spinner */}
        {isRunning && (
          <IconSpinner
            className={`h-4 w-4 ${active ? 'text-white' : 'text-blue-600'}`}
          />
        )}

        {/* Error badge + retry */}
        {hasFailed && (
          <>
            <span
              title={state.error ?? 'Failed'}
              className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${
                active ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700'
              }`}
            >
              <IconExclamation className="h-3 w-3" />
              Failed
            </span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRetry(action); }}
              className={`rounded p-0.5 text-xs ${
                active ? 'text-white hover:bg-white/20' : 'text-gray-500 hover:bg-gray-200'
              } focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500`}
              aria-label={`Retry ${action.label}`}
            >
              <IconRefresh className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {/* Shortcut hint */}
        {action.shortcut && !isRunning && !hasFailed && (
          <kbd
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              active ? 'bg-blue-500 text-blue-100' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {action.shortcut}
          </kbd>
        )}
      </span>
    </li>
  );
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

/**
 * A keyboard-navigable command palette modal.
 *
 * Each action's `onSelect` is awaited; loading and error states are shown
 * inline on the action row. On failure the error is also forwarded to the
 * `notificationState` as a persistent notification with a retry callback.
 *
 * Usage:
 * ```tsx
 * const notifs = useNotifications();
 * const [open, setOpen] = useState(false);
 *
 * const groups: CommandGroup[] = [
 *   {
 *     id: 'rates',
 *     label: 'Exchange Rates',
 *     actions: [
 *       {
 *         id: 'fetch-usd-mxn',
 *         label: 'Refresh USD/MXN rate',
 *         keywords: ['exchange', 'rate', 'usd', 'mxn'],
 *         onSelect: async () => { await sdk.paymentsInstance.getExchangeRate(...) },
 *       },
 *     ],
 *   },
 * ];
 *
 * <CommandPalette
 *   groups={groups}
 *   notificationState={notifs}
 *   open={open}
 *   onClose={() => setOpen(false)}
 * />
 * ```
 */
export function CommandPalette({
  groups,
  notificationState,
  open,
  onClose,
  placeholder = 'Search commands…',
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [actionState, setActionState] = useState<ActionState>({
    actionId: null,
    loading: false,
    error: null,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // ── Filter ─────────────────────────────────────────────────────────────
  const filtered: CommandGroup[] = groups
    .map(group => ({
      ...group,
      actions: group.actions.filter(a => matches(a, query)),
    }))
    .filter(g => g.actions.length > 0);

  const flatActions: CommandAction[] = filtered.flatMap(g => g.actions);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setQuery('');
      setActionState({ actionId: null, loading: false, error: null });
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);

  // ── Execute action ──────────────────────────────────────────────────────

  const executeAction = useCallback(
    async (action: CommandAction) => {
      if (action.disabled) return;
      if (actionState.loading) return;

      setActionState({ actionId: action.id, loading: true, error: null });
      try {
        await action.onSelect();
        setActionState({ actionId: action.id, loading: false, error: null });
        onClose();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setActionState({ actionId: action.id, loading: false, error: message });

        // Forward to the notification center as a persistent, retryable error
        notificationState.notifyPaymentError(
          `"${action.label}" failed: ${message}`,
          err,
          async () => {
            // Retry from the notification center triggers the action again
            await executeAction(action);
          }
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actionState.loading, notificationState, onClose]
  );

  const retryAction = useCallback(
    (action: CommandAction) => {
      setActionState({ actionId: action.id, loading: false, error: null });
      executeAction(action);
    },
    [executeAction]
  );

  // ── Keyboard navigation ─────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(activeIndex + 1, flatActions.length - 1);
          setActiveIndex(next);
          const action = flatActions[next];
          if (action) itemRefs.current.get(action.id)?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(activeIndex - 1, 0);
          setActiveIndex(prev);
          const action = flatActions[prev];
          if (action) itemRefs.current.get(action.id)?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const action = flatActions[activeIndex];
          if (action) executeAction(action);
          break;
        }
      }
    },
    [activeIndex, flatActions, executeAction]
  );

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/50 px-4 pt-[10vh]"
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black ring-opacity-5"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-4">
          <IconSearch className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="cmd-listbox"
            aria-activedescendant={
              flatActions[activeIndex]
                ? `cmd-action-${flatActions[activeIndex].id}`
                : undefined
            }
            type="text"
            className="flex-1 border-0 bg-transparent py-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
            placeholder={placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {actionState.loading && (
            <IconSpinner className="h-4 w-4 shrink-0 text-blue-600" />
          )}
        </div>

        {/* Inline error banner for the last failed action */}
        {actionState.error && !actionState.loading && (
          <div
            role="alert"
            className="flex items-start gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5"
          >
            <IconExclamation className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="min-w-0 flex-1 text-xs text-red-700">{actionState.error}</p>
            <button
              type="button"
              onClick={() => {
                const action = flatActions.find(a => a.id === actionState.actionId);
                if (action) retryAction(action);
              }}
              className="ml-auto flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500"
            >
              <IconRefresh className="h-3 w-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={() => setActionState(s => ({ ...s, error: null }))}
              className="shrink-0 rounded p-1 text-red-400 hover:text-red-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500"
              aria-label="Dismiss error"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Results */}
        <div className="max-h-80 overflow-y-auto" id="cmd-scroll-region">
          {flatActions.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              {query ? `No results for "${query}"` : 'No commands available'}
            </p>
          ) : (
            <ul
              id="cmd-listbox"
              role="listbox"
              aria-label="Commands"
              className="p-2"
            >
              {filtered.map(group => (
                <li key={group.id} role="presentation">
                  <p
                    className="mb-1 mt-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400"
                    role="presentation"
                  >
                    {group.label}
                  </p>
                  <ul role="group" aria-label={group.label}>
                    {group.actions.map(action => {
                      const globalIdx = flatActions.indexOf(action);
                      return (
                        <ActionRow
                          key={action.id}
                          action={action}
                          active={globalIdx === activeIndex}
                          state={actionState}
                          onSelect={executeAction}
                          onRetry={retryAction}
                          onRef={el => {
                            if (el) itemRefs.current.set(action.id, el);
                            else itemRefs.current.delete(action.id);
                          }}
                        />
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-gray-100 px-4 py-2">
          <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">↑↓</kbd>
          <span className="text-[10px] text-gray-400">Navigate</span>
          <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">↵</kbd>
          <span className="text-[10px] text-gray-400">Select</span>
          <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">Esc</kbd>
          <span className="text-[10px] text-gray-400">Close</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
