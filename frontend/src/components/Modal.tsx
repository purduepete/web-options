import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import './Modal.css';

/**
 * The app's general-purpose dialog.
 *
 * It takes its portal-and-Escape shape from `ShortcutsOverlay` and its focus
 * restore and body scroll lock from `CommandPalette` — neither has both, and
 * neither is refactored here because both are load-bearing and well tested.
 *
 * It adds the one thing neither has: focus CONTAINMENT. Tabbing out of an
 * `aria-modal` dialog into a page a screen reader has been told is inert is how a
 * reader ends up typing into something they cannot see.
 */

export interface ModalProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    /** Distinguishes this dialog's styling hooks from the next one's. */
    className?: string;
}

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function Modal({ open, title, onClose, children, className }: ModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const restoreFocusTo = useRef<Element | null>(null);
    const titleId = useId();

    useEffect(() => {
        if (!open) return;
        restoreFocusTo.current = document.activeElement;
        closeRef.current?.focus();

        return () => {
            const previous = restoreFocusTo.current;
            // Only take focus back if nothing else claimed it: something inside may
            // have navigated and moved focus somewhere more useful.
            if (document.activeElement !== document.body) return;
            if (previous instanceof HTMLElement && document.body.contains(previous)) previous.focus();
        };
    }, [open]);

    // The page behind a modal must not scroll with it.
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    if (!open) return null;

    function trapTab(event: KeyboardEvent) {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        const active = document.activeElement;

        // Only the two ends need handling; everything between them wraps by itself.
        if (event.shiftKey && (active === first || active === dialogRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            // Stopped here so a page-level Escape handler does not also fire and
            // undo a second thing the reader never asked about.
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key === 'Tab') trapTab(event);
    }

    return createPortal(
        <div className="modal-root">
            <div className="modal-backdrop" data-testid="modal-backdrop" onClick={onClose} />

            <div
                ref={dialogRef}
                className={className ? `modal-dialog ${className}` : 'modal-dialog'}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={onKeyDown}
            >
                <div className="modal-head">
                    <h2 id={titleId}>{title}</h2>
                    <button ref={closeRef} type="button" className="modal-close" aria-label="Close" onClick={onClose}>
                        <CloseIcon />
                    </button>
                </div>

                <div className="modal-body">{children}</div>
            </div>
        </div>,
        document.body,
    );
}
