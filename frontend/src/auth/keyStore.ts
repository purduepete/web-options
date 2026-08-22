const STORAGE_KEY = 'weboptions_api_key';

/**
 * Where the key lives.
 *
 * sessionStorage by default, so closing the tab forgets it. localStorage only when
 * the user opts in on a device they own. The key is never put in the URL or rendered
 * into the document: a query string ends up in the server access log and in history.
 *
 * Every call is guarded. A browser can refuse storage outright -- a private mode, an
 * embedded webview, a blocked third-party context -- and this module runs before
 * anything renders, so an unguarded read takes the whole app down rather than one
 * feature. Since the key is read back on every request, a refusal would otherwise
 * leave a gate nobody can get through, so it falls back to memory and holds for the
 * session instead of the tab.
 */
let memoryKey: string | null = null;

export function readKey(): string | null {
    try {
        return sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY) ?? memoryKey;
    } catch {
        return memoryKey;
    }
}

export function saveKey(key: string, remember: boolean): void {
    clearKey();
    memoryKey = key;
    try {
        (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, key);
    } catch {
        // Refused: the key holds for this session and is forgotten on reload.
    }
}

export function isRemembered(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
        return false;
    }
}

export function clearKey(): void {
    memoryKey = null;
    try {
        sessionStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to clear if the store cannot be reached.
    }
}
