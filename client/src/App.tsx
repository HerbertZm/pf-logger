import { useEffect, useRef, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useTournament } from './context/TournamentContext';
import { LoginModal } from './components/layout/LoginModal';
import { Shell } from './components/layout/Shell';
import { type Tab } from './components/layout/TabBar';
import { ActiveRound } from './components/dashboard/ActiveRound';
import { IndicatorsLayout } from './components/indicators/IndicatorsLayout';
import { LogFeed } from './components/logs/LogFeed';
import type { FilterBarHandle } from './components/logs/FilterBar';
import { CrossRoundSummary } from './components/insights/CrossRoundSummary';
import { SessionPanel } from './components/session/SessionPanel';
import { DataTab } from './components/data/DataTab';
import { ReportsTab } from './components/reports/ReportsTab';
import { DashboardRoundProvider } from './context/DashboardRoundContext';
import { ManageTab } from './components/manage/ManageTab';
import { GuidePanel } from './components/guide/GuidePanel';
import { useLogsBadge } from './hooks/useLogsBadge';
import { useTabKeyboard } from './hooks/useTabKeyboard';

const App = () => {
    const { token, isAdmin, isSuperadmin } = useAuth();
    const { activeTournamentId } = useTournament();
    const [tab, setTab] = useState<Tab>('dashboard');
    const logsFilterRef = useRef<FilterBarHandle | null>(null);
    const pendingLogsSearchFocus = useRef(false);

    const logsBadge = useLogsBadge(activeTournamentId, tab === 'logs');

    useTabKeyboard({
        tab,
        setTab,
        showReports: isAdmin,
        showManage: isSuperadmin,
        canSync: isAdmin,
        activeTournamentId,
        onFocusLogsSearch: () => {
            pendingLogsSearchFocus.current = true;
        },
    });

    useEffect(() => {
        if (tab !== 'logs' || !pendingLogsSearchFocus.current) return;
        pendingLogsSearchFocus.current = false;
        const id = window.setTimeout(() => logsFilterRef.current?.focusSearch(), 0);
        return () => clearTimeout(id);
    }, [tab]);

    useEffect(() => {
        if (!isAdmin && tab === 'reports') {
            setTab('dashboard');
        }
        if (!isSuperadmin && tab === 'manage') {
            setTab('dashboard');
        }
    }, [isAdmin, isSuperadmin, tab]);

    if (!token) return <LoginModal />;

    return (
        <Shell
            tab={tab}
            onTabChange={setTab}
            logsBadge={logsBadge}
            showReports={isAdmin}
            showManage={isSuperadmin}
        >
            {tab === 'dashboard' && (
                <DashboardRoundProvider>
                    <IndicatorsLayout>
                        <ActiveRound />
                    </IndicatorsLayout>
                </DashboardRoundProvider>
            )}
            {tab === 'logs' && (
                <IndicatorsLayout>
                    <LogFeed filterBarRef={logsFilterRef} isTabActive={tab === 'logs'} />
                </IndicatorsLayout>
            )}
            {tab === 'insights' && (
                <IndicatorsLayout>
                    <CrossRoundSummary />
                </IndicatorsLayout>
            )}
            {tab === 'guide' && <GuidePanel showReports={isAdmin} showManage={isSuperadmin} />}
            {tab === 'reports' && isAdmin && <ReportsTab />}
            {tab === 'session' && <SessionPanel />}
            {tab === 'data' && <DataTab />}
            {tab === 'manage' && isSuperadmin && <ManageTab />}
        </Shell>
    );
};

export default App;
