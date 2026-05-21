import { useEffect, useRef } from 'react';
import './FilterBar.css';
import { FilterChip } from '../shared/FilterChip';
import { Button } from '../shared/Button';
import { useTournament } from '../../context/TournamentContext';

export type LogType = 'drop' | 'extension' | 'penalty' | 'coverage' | 'judge_call';

export interface FilterState {
  types: Set<LogType>;
  search: string;
}

interface FilterBarProps {
  filter: FilterState;
  onChange: (f: FilterState) => void;
}

const ALL_TYPES: LogType[] = ['drop', 'extension', 'penalty', 'coverage', 'judge_call'];
const LABELS: Record<LogType, string> = {
  drop: 'Drops', extension: 'Extensions', penalty: 'Penalties',
  coverage: 'Coverage', judge_call: 'Judge Calls',
};
const PF_ONLY: Set<LogType> = new Set(['coverage', 'judge_call']);

export const FilterBar = ({ filter, onChange }: FilterBarProps) => {
  const { sources } = useTournament();
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAll = filter.types.size === 0;

  const toggleType = (t: LogType) => {
    const next = new Set(filter.types);
    if (next.has(t)) next.delete(t); else next.add(t);
    onChange({ ...filter, types: next });
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleSearch = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange({ ...filter, search: value }), 300);
  };

  const clear = () => {
    onChange({ types: new Set(), search: '' });
    if (searchRef.current) searchRef.current.value = '';
  };

  const isDirty = filter.types.size > 0 || filter.search.length > 0;

  // Remove PF-only filters when source disabled
  useEffect(() => {
    if (!sources.pf) {
      const next = new Set(filter.types);
      PF_ONLY.forEach((t) => next.delete(t));
      if (next.size !== filter.types.size) onChange({ ...filter, types: next });
    }
  }, [sources.pf]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="filter-bar">
      <div className="filter-bar__chips">
        <FilterChip label="All" active={isAll} onClick={() => onChange({ ...filter, types: new Set() })} />
        {ALL_TYPES.filter((t) => sources.pf || !PF_ONLY.has(t)).map((t) => (
          <FilterChip
            key={t}
            label={LABELS[t]}
            active={filter.types.has(t)}
            pfOnly={PF_ONLY.has(t)}
            onClick={() => toggleType(t)}
          />
        ))}
      </div>

      <div className="filter-bar__search-row">
        <input
          ref={searchRef}
          className="filter-bar__search"
          type="search"
          placeholder="Search…"
          defaultValue={filter.search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        {isDirty && <Button variant="danger" size="sm" onClick={clear}>Clear</Button>}
      </div>
    </div>
  );
};
