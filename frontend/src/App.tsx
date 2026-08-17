import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ApiKeyProvider, useApiKey } from './auth/ApiKeyProvider';
import { KeyGate } from './auth/KeyGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { FavoritesProvider } from './navigation/FavoritesProvider';
import { RecentlyVisitedProvider } from './navigation/RecentlyVisitedProvider';
import { ApiKeyPage } from './pages/ApiKeyPage';
import { AppearancePage } from './pages/AppearancePage';
import { CalendarWeekPage } from './pages/CalendarWeekPage';
import { CalendarsIndexPage } from './pages/CalendarsIndexPage';
import { LatestCalendarPage } from './pages/LatestCalendarPage';
import { LiveSignalsPage } from './pages/LiveSignalsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ThemeProvider } from './theme/ThemeProvider';

export default function App() {
    return (
        <ErrorBoundary>
            <ThemeProvider>
                <ApiKeyProvider>
                    <Gate />
                </ApiKeyProvider>
            </ThemeProvider>
        </ErrorBoundary>
    );
}

/**
 * The router sits INSIDE the gate on purpose: with no key there is exactly one
 * thing to look at, so there is nothing to route between.
 */
function Gate() {
    const { status } = useApiKey();
    if (status === 'locked') return <KeyGate />;

    return (
        <BrowserRouter>
            <FavoritesProvider>
                <RecentlyVisitedProvider>
                    <Routes>
                        <Route element={<Layout />}>
                            <Route index element={<LiveSignalsPage />} />
                            <Route path="calendars" element={<CalendarsIndexPage />} />
                            <Route path="calendars/latest" element={<LatestCalendarPage />} />
                            <Route path="calendars/:publishDate" element={<CalendarWeekPage />} />
                            <Route path="settings/appearance" element={<AppearancePage />} />
                            <Route path="settings/key" element={<ApiKeyPage />} />
                            <Route path="*" element={<NotFoundPage />} />
                        </Route>
                    </Routes>
                </RecentlyVisitedProvider>
            </FavoritesProvider>
        </BrowserRouter>
    );
}
