/**
 * Every browser-storage key the app uses, in one place so a rename cannot orphan
 * a user's saved state. The theme keys keep webportfolio's names deliberately.
 */
export const STORAGE_KEYS = {
    themePreference: 'config_theme_preference',
    highlightColor: 'config_highlight_color',
    apiKey: 'weboptions_api_key',
    favorites: 'nav_favorites',
    recentlyVisited: 'nav_recently_visited',
    signalNumberSource: 'weboptions_signal_number_source',
    ownedFilters: 'weboptions.filters.owned-contracts.v1',
    liveSignalsFilters: 'weboptions.filters.live-signals.v1',
    summaryFilters: 'weboptions.filters.summary.v1',
} as const;
