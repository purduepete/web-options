import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from './FavoritesProvider';

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.matches('input, textarea, select') || target.isContentEditable;
}

export function FavoriteShortcuts() {
    const navigate = useNavigate();
    const { favorites } = useFavorites();

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (
                !event.ctrlKey ||
                event.altKey ||
                event.shiftKey ||
                event.metaKey ||
                event.repeat ||
                isTypingTarget(event.target)
            ) {
                return;
            }

            if (event.key === '0') {
                event.preventDefault();
                navigate('/');
                return;
            }

            if (event.key < '1' || event.key > '9') return;
            const favorite = favorites[Number(event.key) - 1];
            if (!favorite?.path) return;

            event.preventDefault();
            navigate(favorite.path);
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [favorites, navigate]);

    return null;
}
