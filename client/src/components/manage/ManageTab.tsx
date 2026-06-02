import { useEffect, useState } from 'react';
import './ManageTab.css';
import { api } from '../../api/client';
import type { AdminTournament } from '../../api/adminTypes';
import { useAuth } from '../../context/AuthContext';
import { ActivityPanel } from './ActivityPanel';
import { ConfigPanel } from './ConfigPanel';
import { EventsPanel } from './EventsPanel';
import { OpsChecklistPanel } from './OpsChecklistPanel';
import { SessionsPanel } from './SessionsPanel';
import { ToolsPanel } from './ToolsPanel';
import { TournamentPanel } from './TournamentPanel';
import { UsersPanel } from './UsersPanel';

export const ManageTab = () => {
    const { isSuperadmin } = useAuth();
    const [activeTournamentCount, setActiveTournamentCount] = useState(0);

    useEffect(() => {
        if (!isSuperadmin) return;
        api.get<AdminTournament[]>('/api/admin/tournaments')
            .then((list) =>
                setActiveTournamentCount(
                    list.filter((t) => t.isActive && !t.isEnded && (t.deletedAt === null || t.deletedAt === undefined))
                        .length,
                ),
            )
            .catch(() => setActiveTournamentCount(0));
    }, [isSuperadmin]);

    if (!isSuperadmin) {
        return <p className="manage-tab__denied">Manage requires superadmin access.</p>;
    }

    return (
        <div className="manage-tab">
            <div className="manage-tab__panels">
                <OpsChecklistPanel tournamentCount={activeTournamentCount} />
                <ToolsPanel />
                <ConfigPanel />
                <EventsPanel />
                <TournamentPanel />
                <UsersPanel />
                <SessionsPanel />
                <ActivityPanel />
            </div>
        </div>
    );
};
