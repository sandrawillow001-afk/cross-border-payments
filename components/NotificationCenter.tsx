import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Notification,
  NotificationCategory,
  NotificationType,
  useNotifications,
  UseNotificationsReturn,
} from '../hooks/useNotifications';

// ─── Icons (inline SVG, no external dependency) ──────────────────────────────

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function IconXCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
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

function IconInfo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  );
}

function IconBell({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
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

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

// ─── Category label map ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  exchange_rate: 'Exchange Rate',
  compliance: 'Compliance',
  payment: 'Payment',
  escrow: 'Escrow',
  network: 'Network',
  general: 'General',
};

// ─── Per-type style tokens ────────────────────────────────────────────────────

interface TypeStyle {
  container: string;
  icon: string;
  iconColor: string;
  badge: string;
  Icon: React.FC<{ className?: string }>;
}

const TYPE_STYLES: Record<NotificationType, TypeStyle> = {
  success: {
    container: 'border-green-200 bg-green-50',
    icon: 'bg-green-100',
    iconColor: 'text-green-600',
    badge: 'bg-green-100 text-green-800',
    Icon: IconCheck,
  },
  error: {
    container: 'border-red-200 bg-red-50',
    icon: 'bg-red-100',
    iconColor: 'text-red-600',
    badge: 'bg-red-100 text-red-800',
    Icon: IconXCircle,
  },
  warning: {
    container: 'border-yellow-200 bg-yellow-50',
    icon: 'bg-yellow-100',
    iconColor: 'text-yellow-600',
    badge: 'bg-yellow-100 text-yellow-800',
    Icon: IconExclamation,
  },
  info: {
    container: 'border-blue-200 bg-blue-50',
    icon: 'bg-blue-100',
    iconColor: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-800',
    Icon: IconInfo,
  },
};

// ─── Single notification row ──────────────────────────────────────────────────

interface NotificationItemProps {
  notification: Notification;
  isRetrying: boolean;
  onDismiss: (id: string) => void;
  onRetry: (id: string) => Promise<void>;
  onRead: (id: string) => void;
}

function NotificationItem({
  notification,
  isRetrying,
  onDismiss,
  onRetry,
  onRead,
}: NotificationItemProps) {
  const styles = TYPE_STYLES[notification.type];
  const { Icon } = styles;
  const hasRetry = !!notification.onRetry;

  const handleRetry = useCallback(async () => {
    await onRetry(notification.id);
  }, [notification.id, onRetry]);

  const handleDismiss = useCallback(() => {
    onDismiss(notification.id);
  }, [notification.id, onDismiss]);

  // Mark as read on mount if unread
  useEffect(() => {
    if (!notification.read) {
      onRead(notification.id);
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const age = formatAge(notification.createdAt);

  return (
    <li
      role="listitem"
      className={`flex gap-3 rounded-lg border p-4 ${styles.container} ${
        !notification.read ? 'ring-2 ring-inset ring-current ring-opacity-10' : ''
      }`}
      aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
    >
      {/* Icon */}
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${styles.icon}`}
        aria-hidden="true"
      >
        <Icon className={`h-4 w-4 ${styles.iconColor}`} />
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {/* Header row */}
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{notification.title}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles.badge}`}>
            {CATEGORY_LABELS[notification.category]}
          </span>
          <span className="ml-auto text-xs text-gray-400">{age}</span>
        </div>

        {/* Message */}
        <p className="text-sm text-gray-700">{notification.message}</p>

        {/* Error detail (collapsed by default) */}
        {notification.error && (
          <ErrorDetail error={notification.error} />
        )}

        {/* Action row */}
        {hasRetry && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={`Retry ${notification.title}`}
            >
              <IconRefresh className="h-3.5 w-3.5" spinning={isRetrying} />
              {isRetrying ? 'Retrying…' : 'Retry'}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Dismiss (no retry) */}
      {!hasRetry && (
        <button
          type="button"
          onClick={handleDismiss}
          className="ml-auto shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Dismiss notification"
        >
          <IconX className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

// ─── Collapsible error detail ─────────────────────────────────────────────────

function ErrorDetail({ error }: { error: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : JSON.stringify(error);

  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-xs text-gray-500 underline hover:text-gray-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      {expanded && (
        <pre className="mt-1 overflow-x-auto rounded bg-white/70 p-2 text-xs text-gray-600">
          {message}
        </pre>
      )}
    </div>
  );
}

// ─── Age formatter ────────────────────────────────────────────────────────────

function formatAge(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── NotificationCenter props ─────────────────────────────────────────────────

export interface NotificationCenterProps {
  /**
   * Pass the return value of `useNotifications()` so the component is
   * controlled by whoever manages notification state.
   */
  notificationState: UseNotificationsReturn;
  /** Where to anchor the dropdown panel. Defaults to 'right'. */
  align?: 'left' | 'right';
  /** Custom class for the trigger button wrapper */
  className?: string;
}

// ─── NotificationCenter ───────────────────────────────────────────────────────

/**
 * A notification bell button that opens a dropdown panel listing all
 * notifications. Error notifications with retry callbacks show a Retry button.
 *
 * Usage:
 * ```tsx
 * const notifs = useNotifications();
 * <NotificationCenter notificationState={notifs} />
 * ```
 */
export function NotificationCenter({
  notificationState,
  align = 'right',
  className = '',
}: NotificationCenterProps) {
  const {
    notifications,
    unreadCount,
    retry,
    dismiss,
    clearAll,
    markAllAsRead,
    markAsRead,
    retryNotification,
  } = notificationState;

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const toggleOpen = useCallback(() => {
    setOpen(v => {
      if (!v) markAllAsRead();
      return !v;
    });
  }, [markAllAsRead]);

  const panelAlignClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Bell trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <IconBell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className={`absolute ${panelAlignClass} z-50 mt-2 w-96 max-w-[calc(100vw-1rem)] origin-top-right rounded-xl bg-white shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Notifications
              {notifications.length > 0 && (
                <span className="ml-1.5 text-xs font-normal text-gray-400">
                  ({notifications.length})
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:underline"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Close notifications"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[28rem] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">No notifications</p>
            ) : (
              <ul className="flex flex-col gap-2 p-3" role="list">
                {notifications.map(n => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    isRetrying={retry.retryingId === n.id}
                    onDismiss={dismiss}
                    onRetry={retryNotification}
                    onRead={markAsRead}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
