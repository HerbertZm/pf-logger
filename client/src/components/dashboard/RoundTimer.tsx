import './RoundTimer.css';
import { useRoundTimer } from '../../hooks/useRoundTimer';
import { formatTime } from '../../utils/time';
import type { Round } from '../../api/types';

interface RoundTimerProps {
  round: Round;
  outstandingCount: number;
}

export const RoundTimer = ({ round, outstandingCount }: RoundTimerProps) => {
  const { remaining, isOvertime, isTopEight, urgency } = useRoundTimer(round, outstandingCount);

  if (isTopEight) {
    return (
      <div className="round-timer round-timer--top8">
        <span className="round-timer__value round-timer__value--muted">—</span>
        <span className="round-timer__label">Top 8 / No timer</span>
      </div>
    );
  }

  if (round.cardeStatus === 'pending_results') {
    return (
      <div className={`round-timer round-timer--${urgency}`}>
        <span className="round-timer__value">COLLECTING</span>
        <span className="round-timer__label">Results pending</span>
      </div>
    );
  }

  return (
    <div className={`round-timer round-timer--${urgency}${isOvertime ? ' round-timer--overtime' : ''}`}>
      <span className={`round-timer__value${isOvertime ? ' timer-overtime' : ''}`}>
        {formatTime(remaining)}
      </span>
      <span className="round-timer__label">
        {isOvertime ? 'Overtime' : 'Remaining'}
      </span>
    </div>
  );
};
