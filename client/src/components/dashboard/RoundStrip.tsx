import './RoundStrip.css';
import { Badge } from '../shared/Badge';
import type { Round } from '../../api/types';
import { useRoundPace } from '../../hooks/useRoundPace';

interface RoundStripProps {
    round: Round;
    urgency: 'success' | 'warning' | 'urgent';
    isPendingResults?: boolean;
}

const paceVariant = (level: string): 'success' | 'warning' | 'urgent' => {
    if (level === 'significantly_over') return 'urgent';
    if (level === 'over') return 'warning';
    return 'success';
};

export const RoundStrip = ({ round, urgency, isPendingResults = false }: RoundStripProps) => {
    const pace = useRoundPace(round);

    return (
        <div className={`round-strip round-strip--${urgency}`}>
            <span className="round-strip__label">Round {round.roundNumber}</span>
            <span className="round-strip__badges">
                {pace !== null && pace.level !== 'on_track' && (
                    <Badge icon="⏱" label={pace.label} variant={paceVariant(pace.level)} />
                )}
                {pace !== null && pace.level === 'on_track' && isLiveRound(round) && (
                    <Badge icon="✓" label={pace.label} variant="success" />
                )}
                {isPendingResults && <Badge icon="◑" label="Collecting" variant="info" />}
            </span>
        </div>
    );
};

function isLiveRound(round: Round): boolean {
    const s = round.cardeStatus?.toUpperCase() ?? '';
    return s === 'IN_PROGRESS' || s === 'PENDING_RESULTS';
}
