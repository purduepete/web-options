import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { FavoriteShortcuts } from '../navigation/FavoriteShortcuts';
import { Navbar } from '../navigation/Navbar';
import { CommandPaletteHost } from '../search/CommandPaletteHost';
import { ShortcutsOverlay } from '../shortcuts/ShortcutsOverlay';
import { TooltipLayer } from './Tooltip';
import { ToastPortal, useToasts } from './Toasts';

const ROUTE_LEAVE_MS = 250;

export function Layout() {
    const { toasts, notify, dismiss } = useToasts();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const { pathname } = useLocation();
    const outlet = useOutlet({ notify });
    // The page on screen trails the URL while the outgoing page fades out.
    const [shownPath, setShownPath] = useState(pathname);
    const [leaving, setLeaving] = useState(false);
    const shownOutlet = useRef<ReactNode>(outlet);
    const current = pathname === shownPath;

    useEffect(() => {
        if (current) shownOutlet.current = outlet;
    });

    useEffect(() => {
        if (pathname === shownPath) {
            setLeaving(false);
            return;
        }
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            setShownPath(pathname);
            return;
        }
        setLeaving(true);
        const timer = setTimeout(() => {
            setShownPath(pathname);
            setLeaving(false);
        }, ROUTE_LEAVE_MS);
        return () => clearTimeout(timer);
    }, [pathname, shownPath]);

    return (
        <>
            <FavoriteShortcuts />
            <Navbar onNotify={notify} onOpenSearch={() => setPaletteOpen(true)} />
            <div className="route-fade" data-leaving={leaving || undefined}>
                {/* Keyed so two routes sharing a component still count as an arrival. */}
                <Fragment key={shownPath}>{current ? outlet : shownOutlet.current}</Fragment>
            </div>
            <CommandPaletteHost open={paletteOpen} onOpenChange={setPaletteOpen} />
            <ShortcutsOverlay />
            <TooltipLayer key={pathname} />
            <ToastPortal toasts={toasts} onDismiss={dismiss} />
        </>
    );
}
