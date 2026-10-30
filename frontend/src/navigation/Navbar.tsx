import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePublishedHeight } from '../hooks/usePublishedHeight';
import {
    ActivityIcon,
    CalendarIcon,
    ChevronDownIcon,
    ClockIcon,
    CloseIcon,
    MenuIcon,
    PageIcon,
    RefreshCwIcon,
    SearchIcon,
    SlidersIcon,
    StarIcon,
    WrenchIcon,
} from '../components/icons';
import { useFavorites } from './FavoritesProvider';
import { useRecentlyVisited } from './RecentlyVisitedProvider';
import { ThemeToggle } from './ThemeToggle';
import { VixChip } from './VixChip';
import { MAX_FAVORITES } from './navLists';
import { NAV_SECTIONS, type NavItem, type NavSection } from './navModel';
import './Navbar.css';

const DESKTOP_QUERY = '(min-width: 1024px)';
const MENU_SECTIONS = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.path && !item.disabled),
})).filter((section) => section.items.length > 0);

/** Kept here rather than in the nav model, which stays plain data. */
const SECTION_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
    signals: ActivityIcon,
    calendars: CalendarIcon,
    tools: WrenchIcon,
    settings: SlidersIcon,
};

export function Navbar({
    onNotify,
    onOpenSearch,
}: {
    onNotify?: (message: string) => void;
    onOpenSearch?: () => void;
}) {
    const isDesktop = useMediaQuery(DESKTOP_QUERY);
    const [menuOpen, setMenuOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [openSection, setOpenSection] = useState<string | null>(null);
    const { pathname } = useLocation();
    const navRef = useRef<HTMLElement>(null);

    // The pages pin their own headers under this one.
    usePublishedHeight(navRef, '--navbar-height');

    const closeAll = useCallback(() => {
        setMenuOpen(false);
        setDrawerOpen(false);
        setOpenSection(null);
    }, []);

    // Navigating is the signal that the user is done with the menu.
    useEffect(() => closeAll(), [pathname, closeAll]);

    // The desktop panel and the mobile drawer are different layouts of the same
    // state, so switching breakpoints mid-session has to reset both.
    useEffect(() => closeAll(), [isDesktop, closeAll]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                closeAll();
                return;
            }
            // Ctrl+\ opens the menu, next to the Ctrl+/ that opens search.
            if (event.key === '\\' && (event.ctrlKey || event.metaKey) && !event.altKey) {
                event.preventDefault();
                if (isDesktop) setMenuOpen((open) => !open);
                else setDrawerOpen((open) => !open);
            }
        }
        function onPointerDown(event: Event) {
            if (!navRef.current?.contains(event.target as Node | null)) closeAll();
        }
        document.addEventListener('keydown', onKeyDown);
        // pointerdown, not mousedown: a tap on a plain part of the page does not
        // always reach us as a mouse event on iPad.
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [closeAll, isDesktop]);

    function toggleSection(id: string) {
        setOpenSection((current) => (current === id ? null : id));
    }

    return (
        <header className="navbar" ref={navRef}>
            <div className="navbar-bar">
                <Link className="brand" to="/">
                    Web Options
                </Link>

                {isDesktop && (
                    <button
                        type="button"
                        className={menuOpen ? 'menu-trigger open' : 'menu-trigger'}
                        aria-expanded={menuOpen}
                        aria-controls="mega-panel"
                        data-tip="Menu (Ctrl \)"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        Menu
                        <ChevronDownIcon className={menuOpen ? 'rotated' : undefined} />
                    </button>
                )}

                <div className="bar-right">
                    <VixChip />

                    <div className="bar-tools">
                        <ThemeToggle />

                        {onOpenSearch && (
                            <button
                                type="button"
                                className="search-trigger"
                                aria-label="Search"
                                data-tip="Search (Ctrl K)"
                                onClick={onOpenSearch}
                            >
                                <SearchIcon />
                            </button>
                        )}

                        <button
                            type="button"
                            className="reload-trigger"
                            aria-label="Reload page"
                            data-tip="Reload page"
                            onClick={() => window.location.reload()}
                        >
                            <RefreshCwIcon />
                        </button>
                    </div>

                    {!isDesktop && (
                        <button
                            type="button"
                            className="drawer-toggle"
                            aria-expanded={drawerOpen}
                            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
                            onClick={() => setDrawerOpen((open) => !open)}
                        >
                            {drawerOpen ? <CloseIcon /> : <MenuIcon />}
                        </button>
                    )}
                </div>
            </div>

            {isDesktop && menuOpen && (
                <div className="mega-panel" id="mega-panel">
                    <div className="mega-inner">
                        <QuickAccess />
                        <div className="section-grid">
                            {MENU_SECTIONS.map((section) => (
                                <SectionColumn key={section.id} section={section} onNotify={onNotify} />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {!isDesktop && drawerOpen && (
                <nav className="drawer" aria-label="Main">
                    <QuickAccess />
                    {MENU_SECTIONS.map((section) => (
                        <div className="accordion" key={section.id}>
                            <button
                                type="button"
                                className="accordion-summary"
                                aria-expanded={openSection === section.id}
                                aria-controls={`accordion-${section.id}`}
                                onClick={() => toggleSection(section.id)}
                            >
                                {section.label}
                                <ChevronDownIcon className={openSection === section.id ? 'rotated' : undefined} />
                            </button>
                            {openSection === section.id && (
                                <div id={`accordion-${section.id}`} className="accordion-body">
                                    <ItemList items={section.items} onNotify={onNotify} />
                                </div>
                            )}
                        </div>
                    ))}
                </nav>
            )}
        </header>
    );
}

function SectionColumn({ section, onNotify }: { section: NavSection; onNotify?: (message: string) => void }) {
    const Icon = SECTION_ICONS[section.id] ?? PageIcon;

    return (
        <div className="nav-section">
            <h2 className="nav-section-title">
                <Icon />
                {section.label}
            </h2>
            <ItemList items={section.items} onNotify={onNotify} />
        </div>
    );
}

function ItemList({ items, onNotify }: { items: readonly NavItem[]; onNotify?: (message: string) => void }) {
    const { isFavorite, toggleFavorite, isFull } = useFavorites();

    return (
        <ul className="item-list">
            {items.map((item) => (
                <li key={item.id} className={item.disabled ? 'nav-item disabled' : 'nav-item'}>
                    {item.path ? (
                        // The description no longer has a line of its own. Keep it as
                        // the tooltip so the wording survives the tighter list.
                        <NavLink to={item.path} end className="nav-link" data-tip={item.description}>
                            {item.label}
                        </NavLink>
                    ) : (
                        <span className="nav-link" data-tip={item.description}>
                            {item.label} <span className="badge">soon</span>
                        </span>
                    )}

                    {item.path && !item.disabled && (
                        <button
                            type="button"
                            className="star"
                            aria-pressed={isFavorite(item.id)}
                            aria-label={
                                isFavorite(item.id) ? `Remove ${item.label} from favorites` : `Favorite ${item.label}`
                            }
                            data-tip={isFavorite(item.id) ? 'Remove from favorites' : 'Add to favorites'}
                            onClick={() => {
                                const changed = toggleFavorite(item.id);
                                if (!changed && isFull) {
                                    onNotify?.(`Favorites are capped at ${MAX_FAVORITES}. Remove one first.`);
                                }
                            }}
                        >
                            <StarIcon filled={isFavorite(item.id)} />
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}

/**
 * Favorites and history ride above the sections, as pills. The app this menu is
 * modeled on keeps favorites in a sidebar; there is no sidebar here, so they
 * sit beside the history they behave like.
 */
function QuickAccess() {
    const { favorites } = useFavorites();
    const { recent } = useRecentlyVisited();

    return (
        <>
            <PillRow icon={<StarIcon filled />} title="Favorites" items={favorites} />
            <PillRow icon={<ClockIcon />} title="Recently visited" items={recent} />
        </>
    );
}

function PillRow({ icon, title, items }: { icon: ReactNode; title: string; items: readonly NavItem[] }) {
    if (items.length === 0) return null;

    return (
        <div className="pill-row">
            <h2 className="nav-section-title">
                {icon}
                {title}
            </h2>
            <ul className="pills">
                {items.map((item) => (
                    <li key={item.id}>
                        <NavLink to={item.path ?? '/'} end className="pill" data-tip={item.description}>
                            {item.label}
                        </NavLink>
                    </li>
                ))}
            </ul>
        </div>
    );
}
