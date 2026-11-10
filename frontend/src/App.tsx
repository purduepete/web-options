import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ApiKeyProvider, useApiKey } from './auth/ApiKeyProvider';
import { KeyGate } from './auth/KeyGate';
import { CautionProvider } from './caution/CautionProvider';
import { GradeSettingsProvider } from './grade/GradeSettingsProvider';
import { VixProvider } from './grade/VixProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Loading } from './components/Loading';
import { FavoritesProvider } from './navigation/FavoritesProvider';
import { RecentlyVisitedProvider } from './navigation/RecentlyVisitedProvider';
import { ApiKeyPage } from './pages/ApiKeyPage';
import { AppearancePage } from './pages/AppearancePage';
import { CalendarWeekPage } from './pages/CalendarWeekPage';
import { CautionPage } from './pages/CautionPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { GradingPage } from './pages/GradingPage';
import { LatestCalendarPage } from './pages/LatestCalendarPage';
import { LiveSignalsPage } from './pages/LiveSignalsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OwnedContractsPage } from './pages/OwnedContractsPage';
import { SummaryPage } from './pages/SummaryPage';
import { ThemeProvider } from './theme/ThemeProvider';
import { WeeklyWrapupPage } from './pages/WeeklyWrapupPage';

const ContractHistoryPage = lazy(() =>
    import('./pages/ContractHistoryPage').then((module) => ({ default: module.ContractHistoryPage }))
);

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
            <CautionProvider>
                <GradeSettingsProvider>
                    <VixProvider>
                        <FavoritesProvider>
                            <RecentlyVisitedProvider>
                                <Routes>
                                    <Route element={<Layout />}>
                                        <Route index element={<LiveSignalsPage />} />
                                        <Route path="summary" element={<SummaryPage />} />
                                        <Route
                                            path="contract-history"
                                            element={
                                                <Suspense fallback={<Loading page />}>
                                                    <ContractHistoryPage />
                                                </Suspense>
                                            }
                                        />
                                        <Route path="owned-contracts" element={<OwnedContractsPage />} />
                                        <Route path="weekly-wrapups" element={<WeeklyWrapupPage />} />
                                        <Route path="calendars/latest" element={<LatestCalendarPage />} />
                                        <Route path="calendars/:publishDate" element={<CalendarWeekPage />} />
                                        <Route path="settings/favorites" element={<FavoritesPage />} />
                                        <Route path="settings/appearance" element={<AppearancePage />} />
                                        <Route path="settings/caution" element={<CautionPage />} />
                                        <Route path="settings/grading" element={<GradingPage />} />
                                        <Route path="settings/key" element={<ApiKeyPage />} />
                                        <Route path="*" element={<NotFoundPage />} />
                                    </Route>
                                </Routes>
                            </RecentlyVisitedProvider>
                        </FavoritesProvider>
                    </VixProvider>
                </GradeSettingsProvider>
            </CautionProvider>
        </BrowserRouter>
    );
}
