import './TabBar.css';
import { getVisibleTabs } from './tabBarUtils';

export type Tab = 'dashboard' | 'logs' | 'insights' | 'guide' | 'reports' | 'session' | 'data' | 'manage';

interface TabBarProps {
    active: Tab;
    onChange: (tab: Tab) => void;
    logsBadge?: number;
    dashboardUrgent?: boolean;
    sessionWarning?: boolean;
    showReports?: boolean;
    showManage?: boolean;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="1" y="1" width="9" height="9" rx="2" fill="currentColor" />
                <rect x="12" y="1" width="9" height="9" rx="2" fill="currentColor" />
                <rect x="1" y="12" width="9" height="9" rx="2" fill="currentColor" />
                <rect x="12" y="12" width="9" height="9" rx="2" fill="currentColor" />
            </svg>
        ),
    },
    {
        id: 'logs',
        label: 'Logs',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="5" width="18" height="3" rx="1.5" fill="currentColor" />
                <rect x="2" y="10" width="14" height="3" rx="1.5" fill="currentColor" />
                <rect x="2" y="15" width="10" height="3" rx="1.5" fill="currentColor" />
            </svg>
        ),
    },
    {
        id: 'insights',
        label: 'Insights',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="12" width="5" height="10" rx="1" fill="currentColor" />
                <rect x="9" y="6" width="5" height="16" rx="1" fill="currentColor" />
                <rect x="16" y="2" width="5" height="20" rx="1" fill="currentColor" />
            </svg>
        ),
    },
    {
        id: 'guide',
        label: 'Guide',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 10v6M11 7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        id: 'reports',
        label: 'Reports',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="3" y="2" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <line x1="7" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.5" />
                <line x1="7" y1="11" x2="15" y2="11" stroke="currentColor" strokeWidth="1.5" />
                <line x1="7" y1="15" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" />
            </svg>
        ),
    },
    {
        id: 'data',
        label: 'Data',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="1" y="1" width="20" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <rect x="1" y="12" width="20" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <line x1="7" y1="1" x2="7" y2="10" stroke="currentColor" strokeWidth="1.5" />
                <line x1="14" y1="1" x2="14" y2="10" stroke="currentColor" strokeWidth="1.5" />
                <line x1="7" y1="12" x2="7" y2="21" stroke="currentColor" strokeWidth="1.5" />
                <line x1="14" y1="12" x2="14" y2="21" stroke="currentColor" strokeWidth="1.5" />
            </svg>
        ),
    },
    {
        id: 'manage',
        label: 'Manage',
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
                <path
                    d="M11 1v3M11 18v3M1 11h3M18 11h3M3.93 3.93l2.12 2.12M15.95 15.95l2.12 2.12M18.07 3.93l-2.12 2.12M6.05 15.95l-2.12 2.12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                />
            </svg>
        ),
    },
];

export const TabBar = ({
    active,
    onChange,
    logsBadge = 0,
    dashboardUrgent = false,
    showReports = false,
    showManage = false,
}: TabBarProps) => {
    const visibleIds = getVisibleTabs(showReports, showManage);
    const tabs = TABS.filter((t) => visibleIds.includes(t.id));

    return (
        <nav className="tab-bar" aria-label="Main navigation">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    className={`tab-bar__item${active === tab.id ? ' tab-bar__item--active' : ''}`}
                    onClick={() => onChange(tab.id)}
                    aria-current={active === tab.id ? 'page' : undefined}
                >
                    <span className="tab-bar__icon">
                        {tab.icon}
                        {tab.id === 'dashboard' && dashboardUrgent && (
                            <span className="tab-bar__dot tab-bar__dot--urgent" />
                        )}
                        {tab.id === 'logs' && logsBadge > 0 && (
                            <span className="tab-bar__badge">{logsBadge > 99 ? '99+' : logsBadge}</span>
                        )}
                    </span>
                    <span className="tab-bar__label">{tab.label}</span>
                </button>
            ))}
        </nav>
    );
};
