import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CloseIcon, GripVerticalIcon, StarIcon } from '../components/icons';
import { useFavorites } from '../navigation/FavoritesProvider';
import type { NavItem } from '../navigation/navModel';
import './FavoritesPage.css';

export function favoriteMoveIndices(
    favorites: readonly NavItem[],
    activeId: string | number,
    overId: string | number
): readonly [number, number] | null {
    if (activeId === overId) return null;
    const startIndex = favorites.findIndex((item) => item.id === activeId);
    const endIndex = favorites.findIndex((item) => item.id === overId);
    return startIndex < 0 || endIndex < 0 ? null : [startIndex, endIndex];
}

export function FavoritesPage() {
    const { favorites, reorderFavorites, toggleFavorite } = useFavorites();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    function onDragEnd({ active, over }: DragEndEvent) {
        if (!over) return;
        const move = favoriteMoveIndices(favorites, active.id, over.id);
        if (!move) return;
        const [startIndex, endIndex] = move;
        reorderFavorites(startIndex, endIndex);
    }

    return (
        <main className="favorites-page">
            <header className="favorites-page-head">
                <div>
                    <h1>Favorites</h1>
                    <p>Drag pages into the order you want. Changes are saved automatically.</p>
                </div>
            </header>

            {favorites.length === 0 ? (
                <div className="favorites-empty">
                    <StarIcon />
                    <p>Star pages in the menu to add favorites here.</p>
                </div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={favorites.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                        <ol className="favorites-sortable" aria-label="Favorite pages">
                            {favorites.map((item, index) => (
                                <SortableFavorite
                                    key={item.id}
                                    item={item}
                                    index={index}
                                    onRemove={() => toggleFavorite(item.id)}
                                />
                            ))}
                        </ol>
                    </SortableContext>
                </DndContext>
            )}
        </main>
    );
}

function SortableFavorite({ item, index, onRemove }: { item: NavItem; index: number; onRemove: () => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

    return (
        <li
            ref={setNodeRef}
            className={`favorite-sortable-row${isDragging ? ' is-dragging' : ''}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
        >
            <button
                type="button"
                className="favorite-drag-handle"
                aria-label={`Reorder ${item.label}`}
                data-tip={`Reorder ${item.label}`}
                {...attributes}
                {...listeners}
            >
                <GripVerticalIcon />
            </button>
            <div className="favorite-sortable-copy">
                <span className="favorite-sortable-label">{item.label}</span>
                <span className="favorite-sortable-description">{item.description}</span>
            </div>
            <kbd className="favorite-shortcut">{index < 9 ? `Ctrl+${index + 1}` : 'No shortcut'}</kbd>
            <button
                type="button"
                className="favorite-remove"
                aria-label={`Remove ${item.label} from favorites`}
                data-tip={`Remove ${item.label} from favorites`}
                onClick={onRemove}
            >
                <CloseIcon />
            </button>
        </li>
    );
}
