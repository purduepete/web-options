import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import './Toasts.css';

const DISMISS_AFTER = 5000;

export interface Toast {
    id: number;
    message: string;
}

/**
 * Deliberately tiny: the shell only needs to say "that did not work" in passing.
 * Anything that must be acknowledged belongs in the page, not in a toast.
 */
export function useToasts() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const nextId = useRef(1);
    const timers = useRef<number[]>([]);

    const dismiss = useCallback((id: number) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const notify = useCallback(
        (message: string) => {
            const id = nextId.current++;
            setToasts((current) => [...current, { id, message }]);
            timers.current.push(window.setTimeout(() => dismiss(id), DISMISS_AFTER));
        },
        [dismiss],
    );

    useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

    return { toasts, notify, dismiss };
}

export function ToastPortal({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
    if (toasts.length === 0) return null;
    return createPortal(
        <div className="toasts" role="status" aria-live="polite">
            {toasts.map((toast) => (
                <div className="toast" key={toast.id}>
                    <span>{toast.message}</span>
                    <button type="button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
                        <CloseIcon width={14} height={14} />
                    </button>
                </div>
            ))}
        </div>,
        document.body,
    );
}
