import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '../navigation/Navbar';
import { CommandPaletteHost } from '../search/CommandPaletteHost';
import { ShortcutsOverlay } from '../shortcuts/ShortcutsOverlay';
import { ToastPortal, useToasts } from './Toasts';

export function Layout() {
    const { toasts, notify, dismiss } = useToasts();
    const [paletteOpen, setPaletteOpen] = useState(false);

    return (
        <>
            <Navbar onNotify={notify} onOpenSearch={() => setPaletteOpen(true)} />
            <Outlet context={{ notify }} />
            <CommandPaletteHost open={paletteOpen} onOpenChange={setPaletteOpen} />
            <ShortcutsOverlay />
            <ToastPortal toasts={toasts} onDismiss={dismiss} />
        </>
    );
}
