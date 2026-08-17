import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../components/icons';
import { SHORTCUT_SECTIONS } from './shortcutList';
import './ShortcutsOverlay.css';

export function ShortcutsOverlay() {
    const [open, setOpen] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setOpen(false);
                return;
            }
            if (event.altKey || !event.shiftKey) return;
            if (!event.ctrlKey && !event.metaKey) return;
            // Layouts disagree on whether shift+slash arrives as ? or /.
            if (event.key !== '?' && event.key !== '/') return;

            event.preventDefault();
            setOpen((shown) => !shown);
        }

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        if (open) closeRef.current?.focus();
    }, [open]);

    if (!open) return null;

    return createPortal(
        <div className="shortcuts-root">
            <div className="shortcuts-backdrop" data-testid="shortcuts-backdrop" onClick={() => setOpen(false)} />

            <div className="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="shortcuts-head">
                    <h2 id={titleId}>Keyboard shortcuts</h2>
                    <button
                        ref={closeRef}
                        type="button"
                        className="shortcuts-close"
                        aria-label="Close"
                        onClick={() => setOpen(false)}
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="shortcuts-body">
                    {SHORTCUT_SECTIONS.map((section) => (
                        <section className="shortcuts-section" key={section.title}>
                            <h3>{section.title}</h3>
                            <dl>
                                {section.shortcuts.map((shortcut) => (
                                    <Fragment key={shortcut.keys.join('+')}>
                                        <dt>
                                            {shortcut.keys.map((key) => (
                                                <kbd key={key}>{key}</kbd>
                                            ))}
                                        </dt>
                                        <dd>{shortcut.description}</dd>
                                    </Fragment>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
