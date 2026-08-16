import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ChevronDownIcon, ClockIcon, CloseIcon, MenuIcon, SearchIcon, StarIcon } from '../components/icons';
import { useFavorites } from './FavoritesProvider';
import { useRecentlyVisited } from './RecentlyVisitedProvider';
import { MAX_FAVORITES } from './navLists';
import { NAV_SECTIONS, type NavItem } from './navModel';
import './Navbar.css';

const DESKTOP_QUERY = '(min-width: 1024px)';
const QUICK_ACCESS = 'quick-access';

export function Navbar({
    onNotify,
    onOpenSearch,
}: {
    onNotify?: (message: string) => void;
    onOpenSearch?: () => void;
}) {
    const isDesktop = useMediaQuery(DESKTOP_QUERY);
    const [openSection, setOpenSection] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { pathname } = useLocation();
    const navRef = useRef<HTMLElement>(null);

    // Navigating is the signal that the user is done with the menu.
    useEffect(() => {
        setOpenSection(null);
        setDrawerOpen(false);
    }, [pathname]);

    // The desktop panel and the mobile drawer are different layouts of the same
    // state, so switching breakpoints mid-session has to reset both.
    useEffect(() => {
        setOpenSection(null);
        setDrawerOpen(false);
    }, [isDesktop]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== 'Escape') return;
            setOpenSection(null);
            setDrawerOpen(false);
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const closePanel = useCallback(() => setOpenSection(null), []);

    function toggleSection(id: string) {
        setOpenSection((current) => (current === id ? null : id));
    }

    return (
        <header
            className="navbar"
            ref={navRef}
            onMouseLeave={isDesktop ? closePanel : undefined}
            onBlur={
                isDesktop
                    ? (event) => {
                          if (!navRef.current?.contains(event.relatedTarget as Node | null)) closePanel();
                      }
                    : undefined
            }
        >
            <div className="navbar-bar">
                <Link className="brand" to="/">
                    weboptions
                </Link>

                {onOpenSearch && (
                    <button type="button" className="search-trigger" onClick={onOpenSearch}>
                        <SearchIcon />
                        <span className="search-trigger-label">Search</span>
                        <kbd aria-hidden="true">Ctrl K</kbd>
                    </button>
                )}

                {isDesktop ? (
                    <nav className="sections" aria-label="Main">
                        {NAV_SECTIONS.map((section) => (
                            <SectionButton
                                key={section.id}
                                id={section.id}
                                label={section.label}
                                open={openSection === section.id}
                                onOpen={() => setOpenSection(section.id)}
                                onToggle={() => toggleSection(section.id)}
                            />
                        ))}
                        <SectionButton
                            id={QUICK_ACCESS}
                            label="Quick access"
                            open={openSection === QUICK_ACCESS}
                            onOpen={() => setOpenSection(QUICK_ACCESS)}
                            onToggle={() => toggleSection(QUICK_ACCESS)}
                        />
                    </nav>
                ) : (
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

            {isDesktop && openSection && (
                <div className="mega-panel" id={`panel-${openSection}`}>
                    {openSection === QUICK_ACCESS ? (
                        <QuickAccess onNotify={onNotify} />
                    ) : (
                        <ItemGrid
                            items={NAV_SECTIONS.find((section) => section.id === openSection)?.items ?? []}
                            onNotify={onNotify}
                        />
                    )}
                </div>
            )}

            {!isDesktop && drawerOpen && (
                <nav className="drawer" aria-label="Main">
                    {NAV_SECTIONS.map((section) => (
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
                                <div id={`accordion-${section.id}`}>
                                    <ItemGrid items={section.items} onNotify={onNotify} />
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="accordion">
                        <button
                            type="button"
                            className="accordion-summary"
                            aria-expanded={openSection === QUICK_ACCESS}
                            aria-controls={`accordion-${QUICK_ACCESS}`}
                            onClick={() => toggleSection(QUICK_ACCESS)}
                        >
                            Quick access
                            <ChevronDownIcon className={openSection === QUICK_ACCESS ? 'rotated' : undefined} />
                        </button>
                        {openSection === QUICK_ACCESS && (
                            <div id={`accordion-${QUICK_ACCESS}`}>
                                <QuickAccess onNotify={onNotify} />
                            </div>
                        )}
                    </div>
                </nav>
            )}
        </header>
    );
}

function SectionButton({
    id,
    label,
    open,
    onOpen,
    onToggle,
}: {
    id: string;
    label: string;
    open: boolean;
    onOpen: () => void;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            className={open ? 'section-button open' : 'section-button'}
            aria-expanded={open}
            aria-controls={`panel-${id}`}
            // Hover is the primary desktop gesture; focus covers the keyboard and
            // click still works for anyone who does not trust hover menus.
            onMouseEnter={onOpen}
            onFocus={onOpen}
            onClick={onToggle}
        >
            {label}
            <ChevronDownIcon className={open ? 'rotated' : undefined} />
        </button>
    );
}

function ItemGrid({ items, onNotify }: { items: readonly NavItem[]; onNotify?: (message: string) => void }) {
    const { isFavorite, toggleFavorite, isFull } = useFavorites();

    return (
        <ul className="item-grid">
            {items.map((item) => (
                <li key={item.id} className={item.disabled ? 'nav-item disabled' : 'nav-item'}>
                    {item.path ? (
                        <NavLink to={item.path} end className="nav-link">
                            <span className="nav-label">{item.label}</span>
                            <span className="nav-description">{item.description}</span>
                        </NavLink>
                    ) : (
                        <span className="nav-link">
                            <span className="nav-label">
                                {item.label} <span className="badge">soon</span>
                            </span>
                            <span className="nav-description">{item.description}</span>
                        </span>
                    )}

                    {item.path && !item.disabled && (
                        <button
                            type="button"
                            className="star"
                            aria-pressed={isFavorite(item.id)}
                            aria-label={
                                isFavorite(item.id) ? `Remove ${item.label} from favourites` : `Favourite ${item.label}`
                            }
                            title={isFavorite(item.id) ? 'Remove from favourites' : 'Add to favourites'}
                            onClick={() => {
                                const changed = toggleFavorite(item.id);
                                if (!changed && isFull) {
                                    onNotify?.(`Favourites are capped at ${MAX_FAVORITES}. Remove one first.`);
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

function QuickAccess({ onNotify }: { onNotify?: (message: string) => void }) {
    const { favorites } = useFavorites();
    const { recent } = useRecentlyVisited();

    return (
        <div className="quick-access">
            <section>
                <h2>
                    <StarIcon filled /> Favourites
                </h2>
                {favorites.length === 0 ? (
                    <p className="muted">Star a page in any menu to pin it here.</p>
                ) : (
                    <ItemGrid items={favorites} onNotify={onNotify} />
                )}
            </section>
            <section>
                <h2>
                    <ClockIcon /> Recently visited
                </h2>
                {recent.length === 0 ? (
                    <p className="muted">Nothing yet.</p>
                ) : (
                    <ul className="item-grid">
                        {recent.map((item) => (
                            <li key={item.id} className="nav-item">
                                <NavLink to={item.path!} end className="nav-link">
                                    <span className="nav-label">{item.label}</span>
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
