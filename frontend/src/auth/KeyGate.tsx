import { useState, type FormEvent } from 'react';
import { UnauthorizedError, describeFailure } from '../api';
import { ThemeControls } from '../theme/ThemeControls';
import { useApiKey } from './ApiKeyProvider';

// Unstyled like the rest of the Phase 1 skeleton; the real shell lands in Phase 5.
export function KeyGate() {
    const { submit } = useApiKey();
    const [key, setKey] = useState('');
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await submit(key.trim(), remember);
        } catch (cause) {
            // A key that was never checked is not a key that was refused.
            setError(cause instanceof UnauthorizedError ? 'That key was rejected.' : describeFailure(cause));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main data-first-load-error>
            <h1>Web Options</h1>
            <form onSubmit={onSubmit}>
                <p>
                    <label htmlFor="api-key">API key</label>
                    <br />
                    <input
                        id="api-key"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                        size={50}
                    />
                </p>
                <p>
                    <label>
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(event) => setRemember(event.target.checked)}
                        />{' '}
                        Remember on this device
                    </label>
                </p>
                <p>
                    <button type="submit" disabled={busy || key.trim().length === 0}>
                        {busy ? 'checking…' : 'unlock'}
                    </button>
                </p>
                {error && <p>{error}</p>}
            </form>

            {/* Appearance is a purely local preference, so it stays reachable
                while the app is locked. */}
            <details>
                <summary>Appearance</summary>
                <ThemeControls />
            </details>
        </main>
    );
}
