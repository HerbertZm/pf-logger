import './FilterChip.css';

interface FilterChipProps {
  label: string;
  active: boolean;
  pfOnly?: boolean;
  onClick: () => void;
}

export const FilterChip = ({ label, active, pfOnly = false, onClick }: FilterChipProps) => (
  <button
    className={`filter-chip${active ? ' filter-chip--active' : ''}`}
    onClick={onClick}
    type="button"
  >
    {label}
    {pfOnly && <sup className="filter-chip__pf">PF</sup>}
  </button>
);
