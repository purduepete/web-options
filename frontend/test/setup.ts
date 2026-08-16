import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Node 26 defines a global `localStorage` that stays undefined unless the process
 * was started with --localstorage-file, and it shadows the jsdom one, so a bare
 * `localStorage` reference in app code resolves to nothing. Both storages are
 * replaced here with a plain in-memory implementation.
 */
class MemoryStorage implements Storage {
    private entries = new Map<string, string>();

    get length(): number {
        return this.entries.size;
    }

    key(index: number): string | null {
        return [...this.entries.keys()][index] ?? null;
    }

    getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.entries.set(key, String(value));
    }

    removeItem(key: string): void {
        this.entries.delete(key);
    }

    clear(): void {
        this.entries.clear();
    }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: new MemoryStorage(),
    });
}

// jsdom has no matchMedia, and the theme provider asks for it on first render.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
});
