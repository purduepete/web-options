import { useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

/**
 * The glue: collects everything the palette can act on and binds the global
 * shortcut. Kept apart from `CommandPalette` so the component itself stays
 * testable without a router or a key.
 */
export function CommandPaletteHost({ open, onOpenChange }: CommandPaletteHostProps) {
    const navigate = useNavigate();
    const { favorites } = useFavorites();
    const { recent } = useRecentlyVisited();
    const { preference, setPreference } = useTheme();
    const { forget } = useApiKey();
    const openRef = useRef(open);
    openRef.current = open;

    // The callback never changes, so the shortcut is bound once instead of on
    // every open and close.
    useCommandHotkey(useCallback(() => onOpenChange(!openRef.current), [onOpenChange]));

    const commands = useMemo(
        () => buildCommands({ navigate, favorites, recent, preference, setPreference, forget }),
        [navigate, favorites, recent, preference, setPreference, forget],
    );

    return <CommandPalette open={open} commands={commands} onClose={() => onOpenChange(false)} />;
}
