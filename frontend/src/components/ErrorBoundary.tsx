import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
    error: Error | null;
}

/**
 * Last line of defence. A render crash below this point would otherwise leave a
 * blank page with the reason only in the console, which is useless on a phone.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
    override state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('[weboptions] render failed', error, info.componentStack);
    }

    override render() {
        if (!this.state.error) return this.props.children;
        return (
            <main>
                <h1>Something broke</h1>
                <p className="muted">{this.state.error.message}</p>
                <p>
                    <button type="button" className="primary" onClick={() => window.location.reload()}>
                        Reload
                    </button>
                </p>
            </main>
        );
    }
}
