import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse } from '@weboptions/shared';
import { fetchMe, UnauthorizedError } from '../api';
import { clearKey, isRemembered, readKey, saveKey } from './keyStore';

/** Roughly three seconds of patience, which covers an API restarting underneath us. */
const VERIFY_ATTEMPTS = 5;
const VERIFY_RETRY_MS = 600;

type Status = 'checking' | 'locked' | 'unlocked';

interface ApiKeyState {
    status: Status;
    identity: MeResponse | null;
    remembered: boolean;
    submit(key: string, remember: boolean): Promise<void>;
    forget(): void;
    lock(): void;
}

const ApiKeyContext = createContext<ApiKeyState | null>(null);

export function ApiKeyProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<Status>('checking');
    const [identity, setIdentity] = useState<MeResponse | null>(null);
    const [remembered, setRemembered] = useState(isRemembered);

    useEffect(() => {
        const stored = readKey();
        if (!stored) {
            setStatus('locked');
            return;
        }
        let cancelled = false;

        // A stored key can have been revoked since the last visit, so it is checked
        // rather than trusted. Only an outright rejection counts: the API is often
        // still starting up while the page is already being served, and throwing the
        // key away over an unreachable server means retyping it after every restart.
        async function verify(key: string) {
            for (let attempt = 1; !cancelled; attempt++) {
                try {
                    const me = await fetchMe(key);
                    if (cancelled) return;
                    setIdentity(me);
                    setStatus('unlocked');
                    return;
                } catch (error) {
                    if (cancelled) return;
                    if (error instanceof UnauthorizedError) {
                        clearKey();
                        setRemembered(false);
                        setStatus('locked');
                        return;
                    }
                    if (attempt >= VERIFY_ATTEMPTS) {
                        // Keep the key and let each page report the outage itself.
                        setStatus('unlocked');
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_MS));
                }
            }
        }

        void verify(stored);
        return () => {
            cancelled = true;
        };
    }, []);

    const submit = useCallback(async (key: string, remember: boolean) => {
        const me = await fetchMe(key);
        saveKey(key, remember);
        setRemembered(remember);
        setIdentity(me);
        setStatus('unlocked');
    }, []);

    const forget = useCallback(() => {
        clearKey();
        setRemembered(false);
        setIdentity(null);
        setStatus('locked');
    }, []);

    const value = useMemo<ApiKeyState>(
        () => ({ status, identity, remembered, submit, forget, lock: forget }),
        [status, identity, remembered, submit, forget],
    );

    return <ApiKeyContext.Provider value={value}>{children}</ApiKeyContext.Provider>;
}

export function useApiKey(): ApiKeyState {
    const value = useContext(ApiKeyContext);
    if (!value) throw new Error('useApiKey must be used inside ApiKeyProvider');
    return value;
}
