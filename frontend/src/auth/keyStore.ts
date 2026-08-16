const STORAGE_KEY = 'weboptions_api_key';

/**
 * Where the key lives.
 *
 * sessionStorage by default, so closing the tab forgets it. localStorage only when
 * the user opts in on a device they own. The key is never put in the URL or rendered
 * into the document: a query string ends up in the server access log and in history.
 */

export function readKey(): string | null {
    return sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
}

export function saveKey(key: string, remember: boolean): void {
    clearKey();
    (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, key);
}

export function isRemembered(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

export function clearKey(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
}
