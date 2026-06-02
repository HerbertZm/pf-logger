import { useEffect } from 'react';
import { api } from '../api/client';
import type { Tab } from '../components/layout/TabBar';
import { getVisibleTabs } from '../components/layout/tabBarUtils';

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

interface UseTabKeyboardOptions {
    tab: Tab;
    setTab: (tab: Tab) => void;
    showReports: boolean;
    showManage: boolean;
    canSync: boolean;
    activeTournamentId: number | null;
    onFocusLogsSearch?: () => void;
}

export function useTabKeyboard({
    tab,
    setTab,
    showReports,
    showManage,
    canSync,
    activeTournamentId,
    onFocusLogsSearch,
}: UseTabKeyboardOptions): void {
    useEffect(() => {
        const handler = (e: KeyboardEvent): void => {
            if (isTypingTarget(e.target)) {
                if (e.key === 'Escape') {
                    (e.target as HTMLElement).blur();
                }
                return;
            }

            const visible = getVisibleTabs(showReports, showManage);
            const digit = Number(e.key);
            if (digit >= 1 && digit <= 8 && digit <= visible.length) {
                const next = visible[digit - 1];
                if (next !== undefined) setTab(next);
                return;
            }

            if (e.key === 'f' || e.key === 'F') {
                setTab('logs');
                onFocusLogsSearch?.();
                return;
            }

            if (e.key === 'Escape') {
                (document.activeElement as HTMLElement | null)?.blur();
                return;
            }

            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSync && activeTournamentId !== null) {
                e.preventDefault();
                void api.post('/api/sync', { tournamentId: activeTournamentId }).catch(() => {
                    /* best-effort — no toast in hook */
                });
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [tab, setTab, showReports, showManage, canSync, activeTournamentId, onFocusLogsSearch]);
}
