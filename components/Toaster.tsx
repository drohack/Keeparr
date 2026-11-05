'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

type ToastFn = (message: string, type?: ToastType) => void;

// Default no-op so useToast() is safe anywhere (tests, unmounted trees).
const ToastContext = createContext<ToastFn>(() => {});

/** `const toast = useToast(); toast('Saved', 'success')` - see ToastProvider. */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

const MAX_STACK = 4;
const DISMISS_MS: Record<ToastType, number> = {
  info: 4000,
  success: 4000,
  error: 8000, // errors linger
};

const TONE: Record<ToastType, string> = {
  info: 'border-slate-700 bg-panel text-slate-200',
  success: 'border-emerald-500/40 bg-panel text-emerald-400',
  error: 'border-red-500/40 bg-panel text-red-400',
};

/**
 * Dependency-free toast stack (bottom-right). Mounted once in AppShell so
 * every page/component can call useToast().
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, type = 'info') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-(MAX_STACK - 1)), { id, type, message }]);
      setTimeout(() => dismiss(id), DISMISS_MS[type]);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-xl ${TONE[t.type]}`}
          >
            <span aria-hidden className="mt-0.5 shrink-0">
              {t.type === 'error' ? '✕' : t.type === 'success' ? '✓' : 'ℹ'}
            </span>
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-500 hover:text-white"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
