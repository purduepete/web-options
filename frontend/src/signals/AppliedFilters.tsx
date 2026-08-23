import { CloseIcon } from '../components/icons';
import './AppliedFilters.css';

export interface AppliedFilter {
    key: string;
    label: string;
    remove: () => void;
}

export function AppliedFilters({ filters, className = '' }: { filters: readonly AppliedFilter[]; className?: string }) {
    if (filters.length === 0) return null;

    return (
        <span className={`applied-filters${className ? ` ${className}` : ''}`} aria-label="Applied filters">
            {filters.map((filter) => (
                <button
                    key={filter.key}
                    type="button"
                    className="applied-filter"
                    onClick={filter.remove}
                    aria-label={`Remove ${filter.label} filter`}
                    title={`Remove ${filter.label} filter`}
                >
                    <span>{filter.label}</span>
                    <CloseIcon width={12} height={12} />
                </button>
            ))}
        </span>
    );
}
