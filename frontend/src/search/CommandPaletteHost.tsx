import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CalendarSummary } from '@weboptions/shared';
import { fetchCalendars } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { useFavorites } from '../navigation/FavoritesProvider';
import { useRecentlyVisited } from '../navigation/RecentlyVisitedProvider';
import { useTheme } from '../theme/ThemeProvider';
import { buildCommands } from './buildCommands';
import { CommandPalette } from './CommandPalette';
import { useCommandHotkey } from './useCommandHotkey';

export interface CommandPaletteHostProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Long enough that opening the palette repeatedly costs nothing. */
const CALENDAR_TTL_MS = 5 * 60 * 1000;

/**
 * The glue: collects everything the palette can act on, owns the one piece of
 * async it needs (the list of ingested weeks) and binds the global shortcut.
 * Kept apart from `CommandPalette` so the component itself stays testable
 * without a router, a key or a network.
 */
export function CommandPaletteHost({ open, onOpenChange }: CommandPaletteHostProps) {
    const navigate = useNavigate();
    const { favorites } = useFavorites();
    const { recent } = useRecentlyVisited();
    const { preference, setPreference } = useTheme();
    const { forget } = useApiKey();
    const [calendars, setCalendars] = useState<readonly CalendarSummary[]>([]);
    const fetchedAt = useRef(0);
    const openRef = useRef(open);
    openRef.current = open;

    // The callback never changes, so the shortcut is bound once instead of on
    // every open and close.
    useCommandHotkey(useCallback(() => onOpenChange(!openRef.current), [onOpenChange]));

    // Fetched on first open, not on mount: a session that never opens the
    // palette never pays for it. Refetched once it is stale so a long-lived tab
    // still finds a week ingested this morning. A failure just means no week
    // commands.
    useEffect(() => {
        if (!open || Date.now() - fetchedAt.current < CALENDAR_TTL_MS) return;
        let cancelled = false;
        fetchedAt.current = Date.now();
        fetchCalendars()
            .then((response) => {
                if (!cancelled) setCalendars(response.calendars);
            })
            .catch(() => {
                // Leave whatever was already loaded in place.
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    const commands = useMemo(
        () =>
            buildCommands({
                navigate,
                favorites,
                recent,
                calendars,
                preference,
                setPreference,
                forget,
            }),
        [navigate, favorites, recent, calendars, preference, setPreference, forget],
    );

    return <CommandPalette open={open} commands={commands} onClose={() => onOpenChange(false)} />;
}
