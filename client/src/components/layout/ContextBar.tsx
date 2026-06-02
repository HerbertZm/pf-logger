import './ContextBar.css';
import { useTournament } from '../../context/TournamentContext';
import { useWorkerStatus } from '../../hooks/useWorkerStatus';
import { formatRelative } from '../../utils/time';
import { useAuth } from '../../context/AuthContext';

interface ContextBarProps {
    onSessionClick?: () => void;
    sessionActive?: boolean;
}

export const ContextBar = ({ onSessionClick, sessionActive = false }: ContextBarProps) => {
    const { activeTournament, tournaments, activeTournamentId, setActiveTournament, sources } = useTournament();
    const { isAdmin, isSuperadmin } = useAuth();
    const { lastSync, isRunning, error, isStale, pfJwtExpiresAt } = useWorkerStatus(activeTournament?.id ?? null);

    const statusLabel = () => {
        if (error) return { text: '✕ Error', cls: 'context-bar__status--error' };
        if (isStale && lastSync)
            return { text: `⚠ Stale · ${formatRelative(lastSync)}`, cls: 'context-bar__status--stale' };
        if (isRunning || lastSync) return { text: '● Live', cls: 'context-bar__status--live' };
        return { text: '○ Waiting', cls: 'context-bar__status--waiting' };
    };

    const jwtWarn = (() => {
        if (!sources.pf || !pfJwtExpiresAt) return false;
        return (pfJwtExpiresAt.getTime() - Date.now()) / 60_000 < 30;
    })();

    const status = statusLabel();

    return (
        <div className="context-bar">
            <div className="context-bar__left">
                {tournaments.length > 1 && isAdmin ? (
                    <select
                        className="context-bar__select"
                        value={activeTournamentId ?? ''}
                        onChange={(e) => setActiveTournament(Number(e.target.value))}
                        aria-label="Select tournament"
                    >
                        {!activeTournamentId && (
                            <option value="" disabled>
                                Select tournament
                            </option>
                        )}
                        {tournaments.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                                {t.isEnded ? ' (ended)' : ''}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className={`context-bar__name${!activeTournament ? ' context-bar__name--empty' : ''}`}>
                        {activeTournament?.name ?? 'No tournament selected'}
                    </span>
                )}
            </div>
            <div className="context-bar__right">
                <span className={`context-bar__status ${status.cls}`}>{status.text}</span>
                {(sources.pf || isSuperadmin) && (
                    <button
                        className={`context-bar__gear${sessionActive ? ' context-bar__gear--active' : ''}${jwtWarn ? ' context-bar__gear--warn' : ''}`}
                        onClick={onSessionClick}
                        aria-label="Session settings"
                        title="Session settings"
                    >
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                            <path
                                d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.42 1.42M13.36 13.36l1.42 1.42M14.78 3.22l-1.42 1.42M4.64 13.36l-1.42 1.42"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                            />
                        </svg>
                        {jwtWarn && <span className="context-bar__gear-dot" />}
                    </button>
                )}
            </div>
        </div>
    );
};
