import { Fragment, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { FavoriteShortcuts } from '../navigation/FavoriteShortcuts';
import { Navbar } from '../navigation/Navbar';
import { CommandPaletteHost } from '../search/CommandPaletteHost';
import { ShortcutsOverlay } from '../shortcuts/ShortcutsOverlay';
import { ToastPortal, useToasts } from './Toasts';

export function Layout() {
    const { toasts, notify, dismiss } = useToasts();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const { pathname } = useLocation();

    return (
        <>
            <FavoriteShortcuts />
            <Navbar onNotify={notify} onOpenSearch={() => setPaletteOpen(true)} />
            {/* Keyed so two routes sharing a component still count as an arrival. */}
            <Fragment key={pathname}>
                <Outlet context={{ notify }} />
            </Fragment>
            <CommandPaletteHost open={paletteOpen} onOpenChange={setPaletteOpen} />
            <ShortcutsOverlay />
            <ToastPortal toasts={toasts} onDismiss={dismiss} />
        </>
    );
}
