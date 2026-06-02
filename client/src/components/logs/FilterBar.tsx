import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import './FilterBar.css';
import { FilterChip } from '../shared/FilterChip';
import { Button } from '../shared/Button';
import { useTournament } from '../../context/TournamentContext';

export type LogType = 'drop' | 'extension' | 'penalty' | 'coverage' | 'judge_call';

export interface FilterState {
    types: Set<LogType>;
    search: string;
    /** When set, only entries for this round number are shown. */
    roundNumber: number | null;
}

export type FilterPreset = 'this_round' | 'extensions' | 'drops' | 'penalties' | 'clear';

export interface FilterBarHandle {
    focusSearch: () => void;
}

interface FilterBarProps {
    filter: FilterState;
    onChange: (f: FilterState) => void;
    handleRef?: Ref<FilterBarHandle>;
    latestRoundNumber: number | null;
    activePreset: FilterPreset | null;
    onPresetChange: (preset: FilterPreset | null) => void;
}

const ALL_TYPES: LogType[] = ['drop', 'extension', 'penalty', 'coverage', 'judge_call'];
const LABELS: Record<LogType, string> = {
    drop: 'Drops',
    extension: 'Extensions',
    penalty: 'Penalties',
    coverage: 'Coverage',
    judge_call: 'Judge Calls',
};
const PF_ONLY: Set<LogType> = new Set(['coverage', 'judge_call']);

export const FilterBar = ({
    filter,
    onChange,
    handleRef,
    latestRoundNumber,
    activePreset,
    onPresetChange,
}: FilterBarProps) => {
    const { sources } = useTournament();
    const searchRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(handleRef, () => ({
        focusSearch: () => {
            searchRef.current?.focus();
            searchRef.current?.select();
        },
    }));

    const isAll = filter.types.size === 0;

    const toggleType = (t: LogType) => {
        onPresetChange(null);
        const next = new Set(filter.types);
        if (next.has(t)) next.delete(t);
        else next.add(t);
        onChange({ ...filter, types: next });
    };

    useEffect(
        () => () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        },
        [],
    );

    const handleSearch = (value: string) => {
        onPresetChange(null);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onChange({ ...filter, search: value }), 300);
    };

    const clear = () => {
        onChange({ types: new Set(), search: '', roundNumber: null });
        onPresetChange(null);
        if (searchRef.current) searchRef.current.value = '';
    };

    const applyPreset = (preset: FilterPreset): void => {
        if (preset === 'clear') {
            clear();
            return;
        }
        onPresetChange(preset);
        if (preset === 'this_round') {
            onChange({
                types: new Set(),
                search: '',
                roundNumber: latestRoundNumber,
            });
            return;
        }
        const typeMap: Record<string, LogType> = {
            extensions: 'extension',
            drops: 'drop',
            penalties: 'penalty',
        };
        const t = typeMap[preset];
        onChange({
            types: new Set(t ? [t] : []),
            search: '',
            roundNumber: null,
        });
    };

    const isDirty = filter.types.size > 0 || filter.search.length > 0 || filter.roundNumber !== null;

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
            <div className="filter-bar__presets">
                <FilterChip
                    label="This round"
                    active={activePreset === 'this_round'}
                    disabled={latestRoundNumber === null}
                    onClick={() => applyPreset('this_round')}
                />
                <FilterChip
                    label="Extensions"
                    active={activePreset === 'extensions'}
                    onClick={() => applyPreset('extensions')}
                />
                <FilterChip
                    label="Drops"
                    active={activePreset === 'drops'}
                    disabled={!sources.pf}
                    onClick={() => applyPreset('drops')}
                />
                <FilterChip
                    label="Penalties"
                    active={activePreset === 'penalties'}
                    onClick={() => applyPreset('penalties')}
                />
                <FilterChip label="Clear" active={activePreset === 'clear'} onClick={() => applyPreset('clear')} />
            </div>
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
                {isDirty && (
                    <Button variant="danger" size="sm" onClick={clear}>
                        Clear
                    </Button>
                )}
            </div>
        </div>
    );
};
