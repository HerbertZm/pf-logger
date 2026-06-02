import './Shell.css';
import { ContextBar } from './ContextBar';
import { TabBar, type Tab } from './TabBar';

interface ShellProps {
    tab: Tab;
    onTabChange: (tab: Tab) => void;
    logsBadge?: number;
    dashboardUrgent?: boolean;
    showReports?: boolean;
    children: React.ReactNode;
}

export const Shell = ({ tab, onTabChange, logsBadge, dashboardUrgent, showReports, children }: ShellProps) => {
    const handleSessionToggle = () => {
        onTabChange(tab === 'session' ? 'dashboard' : 'session');
    };

    return (
        <div className="shell">
            <ContextBar onSessionClick={handleSessionToggle} sessionActive={tab === 'session'} />
            <TabBar
                active={tab}
                onChange={onTabChange}
                {...(logsBadge !== undefined && { logsBadge })}
                {...(dashboardUrgent !== undefined && { dashboardUrgent })}
                {...(showReports !== undefined && { showReports })}
            />
            <main className="shell__content">{children}</main>
        </div>
    );
};
