import './Shell.css';
import { ContextBar } from './ContextBar';
import { TabBar, type Tab } from './TabBar';

interface ShellProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  logsBadge?: number;
  dashboardUrgent?: boolean;
  children: React.ReactNode;
}

export const Shell = ({ tab, onTabChange, logsBadge, dashboardUrgent, children }: ShellProps) => {
  const handleSessionToggle = () => {
    onTabChange(tab === 'session' ? 'dashboard' : 'session');
  };

  return (
    <div className="shell">
      <ContextBar
        onSessionClick={handleSessionToggle}
        sessionActive={tab === 'session'}
      />
      <TabBar
        active={tab}
        onChange={onTabChange}
        {...(logsBadge !== undefined && { logsBadge })}
        {...(dashboardUrgent !== undefined && { dashboardUrgent })}
      />
      <main className="shell__content">{children}</main>
    </div>
  );
};
