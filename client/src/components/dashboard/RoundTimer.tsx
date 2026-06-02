import './RoundTimer.css';
import { useRoundTimer } from '../../hooks/useRoundTimer';
import { formatTime, formatClock } from '../../utils/time';
import type { Round } from '../../api/types';

interface RoundTimerProps {
  round: Round;
  outstandingCount: number;
}

/** Start / planned-end row shown on live and pending rounds */
const TimeMeta = ({ round }: { round: Round }) => (
  <div className="round-timer__meta">
    <span className="round-timer__meta-item">
      <span className="round-timer__meta-label">Started</span>
      <span className="round-timer__meta-value">{formatClock(round.startedAt)}</span>
    </span>
    <span className="round-timer__meta-sep" />
    <span className="round-timer__meta-item">
      <span className="round-timer__meta-label">Ends at</span>
      <span className="round-timer__meta-value">{formatClock(round.timerEndDatetime)}</span>
    </span>
  </div>
);

export const RoundTimer = ({ round, outstandingCount }: RoundTimerProps) => {
  const { remaining, isOvertime, isTopEight, urgency } = useRoundTimer(round, outstandingCount);

  // Top 8 — no timer data
  if (isTopEight) {
    return (
      <div className="round-timer round-timer--top8">
        <span className="round-timer__value round-timer__value--muted">—</span>
        <span className="round-timer__label">Top 8 · No timer</span>
      </div>
    );
  }

  // Completed round — swap countdown for a static summary
  if (round.cardeStatus === 'COMPLETE') {
    const durationMin = round.timerDurationMinutes;
    return (
      <div className="round-timer round-timer--complete">
        <div className="round-timer__summary">
          <div className="round-timer__summary-item">
            <span className="round-timer__meta-label">Started</span>
            <span className="round-timer__summary-value">{formatClock(round.startedAt)}</span>
          </div>
          <div className="round-timer__summary-sep" />
          <div className="round-timer__summary-item">
            <span className="round-timer__meta-label">Timer ended</span>
            <span className="round-timer__summary-value">{formatClock(round.timerEndDatetime)}</span>
          </div>
          <div className="round-timer__summary-sep" />
          <div className="round-timer__summary-item">
            <span className="round-timer__meta-label">Duration</span>
            <span className="round-timer__summary-value">
              {durationMin != null ? `${durationMin} min` : '—'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Pending results — timer has expired, collecting results
  if (round.cardeStatus === 'pending_results') {
    return (
      <div className={`round-timer round-timer--${urgency}`}>
        <span className="round-timer__value">COLLECTING</span>
        <span className="round-timer__label">Results pending</span>
        <TimeMeta round={round} />
      </div>
    );
  }

  // Live — active countdown
  return (
    <div className={`round-timer round-timer--${urgency}${isOvertime ? ' round-timer--overtime' : ''}`}>
      <span className={`round-timer__value${isOvertime ? ' timer-overtime' : ''}`}>
        {formatTime(remaining)}
      </span>
      <span className="round-timer__label">
        {isOvertime ? 'Overtime' : 'Remaining'}
      </span>
      <TimeMeta round={round} />
    </div>
  );
};
