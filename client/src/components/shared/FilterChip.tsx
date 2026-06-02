import './FilterChip.css';

interface FilterChipProps {
    label: string;
    active: boolean;
    pfOnly?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

export const FilterChip = ({ label, active, pfOnly = false, disabled = false, onClick }: FilterChipProps) => (
    <button
        className={`filter-chip${active ? ' filter-chip--active' : ''}`}
        onClick={onClick}
        type="button"
        disabled={disabled}
    >
        {label}
        {pfOnly && <sup className="filter-chip__pf">PF</sup>}
    </button>
);
