import { useEffect, useLayoutEffect } from 'react';

const pending = new Set<symbol>();
let frame = 0;

function check() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
            const root = document.documentElement;
            if (root.dataset.firstLoad !== 'pending') return;
            if (document.querySelector('[role="alert"], [data-first-load-error]')) {
                root.dataset.firstLoad = 'error';
            } else if (pending.size === 0) {
                document.querySelectorAll('#root main, #root .enter').forEach((element) => {
                    element.classList.add('first-load-content');
                });
                root.dataset.firstLoad = 'ready';
                setTimeout(() => {
                    if (root.dataset.firstLoad === 'ready') root.dataset.firstLoad = 'complete';
                }, 600);
            }
        });
    });
}

/** Registers only the first arrival; later refreshes never hide the shell. */
export function useFirstLoadPending(loading: boolean, failed = false) {
    useLayoutEffect(() => {
        if (failed && document.documentElement.dataset.firstLoad === 'pending') {
            document.documentElement.dataset.firstLoad = 'error';
        }
        if (!loading || document.documentElement.dataset.firstLoad !== 'pending') return;
        const token = Symbol();
        pending.add(token);
        check();
        return () => {
            pending.delete(token);
            check();
        };
    }, [loading, failed]);
}

export function FirstLoad() {
    useEffect(() => {
        const observer = new MutationObserver(check);
        observer.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true });
        check();
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, []);
    return null;
}
