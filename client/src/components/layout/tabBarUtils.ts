import type { Tab } from './TabBar';

const TAB_ORDER: Tab[] = ['dashboard', 'logs', 'insights', 'guide', 'reports', 'data', 'manage'];

export function getVisibleTabs(showReports: boolean, showManage: boolean): Tab[] {
    let tabs = TAB_ORDER;
    if (!showReports) tabs = tabs.filter((t) => t !== 'reports');
    if (!showManage) tabs = tabs.filter((t) => t !== 'manage');
    return tabs;
}
