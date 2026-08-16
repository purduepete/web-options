import { Outlet } from 'react-router-dom';
import { Navbar } from '../navigation/Navbar';
import { ToastPortal, useToasts } from './Toasts';

export function Layout() {
    const { toasts, notify, dismiss } = useToasts();

    return (
        <>
            <Navbar onNotify={notify} />
            <Outlet context={{ notify }} />
            <ToastPortal toasts={toasts} onDismiss={dismiss} />
        </>
    );
}
