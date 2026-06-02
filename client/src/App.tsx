import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { LoginModal } from './components/layout/LoginModal';
import { Shell } from './components/layout/Shell';
import { type Tab } from './components/layout/TabBar';
import { ActiveRound } from './components/dashboard/ActiveRound';
import { IndicatorsLayout } from './components/indicators/IndicatorsLayout';
import { LogFeed } from './components/logs/LogFeed';
import { CrossRoundSummary } from './components/insights/CrossRoundSummary';
import { SessionPanel } from './components/session/SessionPanel';
import { DataTab } from './components/data/DataTab';

const ComingSoon = ({ name }: { name: string }) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '40vh',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-body-size)',
        }}
    >
        {name} — coming soon
    </div>
);

const App = () => {
    const { token } = useAuth();
    const [tab, setTab] = useState<Tab>('dashboard');

    if (!token) return <LoginModal />;

    return (
        <Shell tab={tab} onTabChange={setTab}>
            {tab === 'dashboard' && (
                <IndicatorsLayout>
                    <ActiveRound />
                </IndicatorsLayout>
            )}
            {tab === 'logs' && (
                <IndicatorsLayout>
                    <LogFeed />
                </IndicatorsLayout>
            )}
            {tab === 'insights' && (
                <IndicatorsLayout>
                    <CrossRoundSummary />
                </IndicatorsLayout>
            )}
            {tab === 'session' && <SessionPanel />}
            {tab === 'data' && <DataTab />}
            {tab === 'manage' && <ComingSoon name="Manage" />}
        </Shell>
    );
};

export default App;
