import { useState, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export type NotificationCategory =
  | 'exchange_rate'
  | 'compliance'
  | 'payment'
  | 'escrow'
  | 'network'
  | 'general';

export interface Notification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  /** Original error, if any, for programmatic inspection */
  error?: Error | unknown;
  /** When the notification was created (ms since epoch) */
  createdAt: number;
  /** Whether the user has read/dismissed this notification */
  read: boolean;
  /** If provided, a retry callback will be shown alongside the notification */
  onRetry?: () => void | Promise<void>;
  /** Auto-dismiss after this many milliseconds (undefined = persistent) */
  autoDismissMs?: number;
}

export interface RetryState {
  /** Which notification ID is currently retrying */
  retryingId: string | null;
  /** Number of consecutive retry attempts for the active notification */
  attempts: number;
}

export interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  retry: RetryState;

  /** Add an arbitrary notification */
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => string;

  /** Convenience: report an exchange-rate fetch failure with a retry callback */
  notifyRateError: (
    message: string,
    error: unknown,
    retryFn: () => Promise<void>
  ) => string;

  /** Convenience: report a compliance check failure with a retry callback */
  notifyComplianceError: (
    message: string,
    error: unknown,
    retryFn: () => Promise<void>
  ) => string;

  /** Convenience: report a payment or escrow failure */
  notifyPaymentError: (
    message: string,
    error: unknown,
    retryFn?: () => Promise<void>
  ) => string;

  /** Convenience: report a success */
  notifySuccess: (title: string, message: string, category?: NotificationCategory) => string;

  /** Mark one notification as read */
  markAsRead: (id: string) => void;

  /** Mark all notifications as read */
  markAllAsRead: () => void;

  /** Remove a single notification */
  dismiss: (id: string) => void;

  /** Remove all notifications */
  clearAll: () => void;

  /**
   * Trigger the retry callback for a notification.
   * Tracks attempt count and marks the notification as retrying.
   */
  retryNotification: (id: string) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  return `notif-${Date.now()}-${++_idCounter}`;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [retry, setRetry] = useState<RetryState>({ retryingId: null, attempts: 0 });

  // Keep a ref so callbacks always see the latest list without stale closures
  const notifsRef = useRef<Notification[]>([]);
  notifsRef.current = notifications;

  // ── Auto-dismiss timers ──────────────────────────────────────────────────
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleAutoDismiss = useCallback((id: string, ms: number) => {
    if (timers.current.has(id)) clearTimeout(timers.current.get(id)!);
    const handle = setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
      timers.current.delete(id);
    }, ms);
    timers.current.set(id, handle);
  }, []);

  // ── Core add ─────────────────────────────────────────────────────────────

  const addNotification = useCallback(
    (notif: Omit<Notification, 'id' | 'createdAt' | 'read'>): string => {
      const id = nextId();
      const full: Notification = { ...notif, id, createdAt: Date.now(), read: false };
      setNotifications(prev => [full, ...prev]);
      if (full.autoDismissMs) scheduleAutoDismiss(id, full.autoDismissMs);
      return id;
    },
    [scheduleAutoDismiss]
  );

  // ── Domain-specific helpers ───────────────────────────────────────────────

  const notifyRateError = useCallback(
    (message: string, error: unknown, retryFn: () => Promise<void>): string => {
      return addNotification({
        type: 'error',
        category: 'exchange_rate',
        title: 'Exchange Rate Unavailable',
        message,
        error,
        onRetry: retryFn,
      });
    },
    [addNotification]
  );

  const notifyComplianceError = useCallback(
    (message: string, error: unknown, retryFn: () => Promise<void>): string => {
      return addNotification({
        type: 'error',
        category: 'compliance',
        title: 'Compliance Check Failed',
        message,
        error,
        onRetry: retryFn,
      });
    },
    [addNotification]
  );

  const notifyPaymentError = useCallback(
    (message: string, error: unknown, retryFn?: () => Promise<void>): string => {
      return addNotification({
        type: 'error',
        category: 'payment',
        title: 'Payment Error',
        message,
        error,
        onRetry: retryFn,
      });
    },
    [addNotification]
  );

  const notifySuccess = useCallback(
    (title: string, message: string, category: NotificationCategory = 'general'): string => {
      return addNotification({
        type: 'success',
        category,
        title,
        message,
        autoDismissMs: 5000,
      });
    },
    [addNotification]
  );

  // ── State management ─────────────────────────────────────────────────────

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    if (timers.current.has(id)) {
      clearTimeout(timers.current.get(id)!);
      timers.current.delete(id);
    }
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    timers.current.forEach(handle => clearTimeout(handle));
    timers.current.clear();
    setNotifications([]);
  }, []);

  // ── Retry ────────────────────────────────────────────────────────────────

  const retryNotification = useCallback(
    async (id: string): Promise<void> => {
      const notif = notifsRef.current.find(n => n.id === id);
      if (!notif?.onRetry) return;

      setRetry(prev => ({
        retryingId: id,
        attempts: prev.retryingId === id ? prev.attempts + 1 : 1,
      }));

      // Mark as read while retrying so badge count drops
      markAsRead(id);

      try {
        await notif.onRetry();
        // On success, remove the error notification
        dismiss(id);
      } catch {
        // Retry failed — keep the notification visible, reset retrying state
      } finally {
        setRetry(prev => (prev.retryingId === id ? { ...prev, retryingId: null } : prev));
      }
    },
    [dismiss, markAsRead]
  );

  // ── Derived ──────────────────────────────────────────────────────────────

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    notifications,
    unreadCount,
    retry,
    addNotification,
    notifyRateError,
    notifyComplianceError,
    notifyPaymentError,
    notifySuccess,
    markAsRead,
    markAllAsRead,
    dismiss,
    clearAll,
    retryNotification,
  };
}
