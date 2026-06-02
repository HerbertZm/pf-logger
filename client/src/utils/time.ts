/** Format an ISO timestamp as a locale clock time — e.g. "10:04 AM" */
export const formatClock = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const formatTime = (seconds: number): string => {
  const abs = Math.abs(seconds);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${seconds < 0 ? '-' : ''}${mm}:${ss}`;
};

export const formatRelative = (date: Date): string => {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
};
