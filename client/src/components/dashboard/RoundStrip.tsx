import './RoundStrip.css';
import { Badge } from '../shared/Badge';
import type { Round } from '../../api/types';

interface RoundStripProps {
  round: Round;
  urgency: 'success' | 'warning' | 'urgent';
  isPendingResults?: boolean;
}

export const RoundStrip = ({ round, urgency, isPendingResults = false }: RoundStripProps) => (
  <div className={`round-strip round-strip--${urgency}`}>
    <span className="round-strip__label">Round {round.roundNumber}</span>
    {isPendingResults && (
      <Badge icon="◑" label="Collecting" variant="info" />
    )}
  </div>
);
