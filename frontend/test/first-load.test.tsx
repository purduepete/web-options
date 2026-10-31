import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstLoad, useFirstLoadPending } from '../src/hooks/useFirstLoad';

function Section({ loading, failed = false }: { loading: boolean; failed?: boolean }) {
    useFirstLoadPending(loading, failed);
    return <main>Content</main>;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    document.documentElement.dataset.firstLoad = 'pending';
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('first-load readiness', () => {
    it('holds the entire first entry until every slow section settles', () => {
        const view = render(
            <>
                <FirstLoad />
                <Section loading />
                <Section loading />
            </>
        );
        act(() => vi.advanceTimersByTime(500));
        expect(document.documentElement.dataset.firstLoad).toBe('pending');
        view.rerender(
            <>
                <FirstLoad />
                <Section loading={false} />
                <Section loading />
            </>
        );
        act(() => vi.advanceTimersByTime(500));
        expect(document.documentElement.dataset.firstLoad).toBe('pending');
        view.rerender(
            <>
                <FirstLoad />
                <Section loading={false} />
                <Section loading={false} />
            </>
        );
        act(() => vi.advanceTimersByTime(40));
        expect(document.documentElement.dataset.firstLoad).toBe('ready');
        act(() => vi.advanceTimersByTime(600));
        expect(document.documentElement.dataset.firstLoad).toBe('complete');
        view.rerender(
            <>
                <FirstLoad />
                <Section loading />
                <Section loading />
            </>
        );
        act(() => vi.advanceTimersByTime(500));
        expect(document.documentElement.dataset.firstLoad).toBe('complete');
    });
    it('reveals errors and sign-in immediately while other requests remain pending', () => {
        render(
            <>
                <FirstLoad />
                <Section loading />
                <Section loading failed />
            </>
        );
        expect(document.documentElement.dataset.firstLoad).toBe('error');
    });
});
