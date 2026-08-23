import type { RefObject } from 'react';
import type { ExpiryFilter, NumberSource } from '@weboptions/shared';
import type { GradeFilter, HalfFilter, MoneynessFilter, OwnedFilter, TierSelection } from './grouping';
import { CloseIcon } from '../components/icons';
import {
    ExpiryFilterMenu,
    GradeFilterMenu,
    HalfFilterMenu,
    MoneynessFilterMenu,
    OwnedFilterMenu,
    TierFilterMenu,
} from './FilterMenu';
import { NumberSourceMenu } from './NumberSourceMenu';

interface SignalFilterControlsProps {
    numberSource: NumberSource;
    expiry: ExpiryFilter;
    moneyness: MoneynessFilter;
    half: HalfFilter;
    owned?: OwnedFilter;
    tier?: readonly TierSelection[];
    symbol: string;
    symbolAriaLabel?: string;
    clearSymbolAriaLabel?: string;
    symbolInputRef: RefObject<HTMLInputElement | null>;
    onNumberSourceChange: (next: NumberSource) => void;
    onExpiryChange: (next: ExpiryFilter) => void;
    onMoneynessChange: (next: MoneynessFilter) => void;
    onHalfChange: (next: HalfFilter) => void;
    onOwnedChange?: (next: OwnedFilter) => void;
    onTierChange?: (next: TierSelection[]) => void;
    onSymbolChange: (next: string) => void;
    grades?: readonly GradeFilter[];
    onGradesChange?: (next: GradeFilter[]) => void;
}

export function SignalFilterControls({
    numberSource,
    expiry,
    moneyness,
    half,
    owned,
    tier,
    symbol,
    symbolAriaLabel = 'Filter by symbols, comma separated',
    clearSymbolAriaLabel = 'Clear symbol filter',
    symbolInputRef,
    onNumberSourceChange,
    onExpiryChange,
    onMoneynessChange,
    onHalfChange,
    onOwnedChange,
    onTierChange,
    onSymbolChange,
    grades,
    onGradesChange,
}: SignalFilterControlsProps) {
    return (
        <>
            <div className="filter-section filter-section-view">
                <h2>View</h2>
                <NumberSourceMenu value={numberSource} onChange={onNumberSourceChange} />
            </div>
            <div className="filter-section filter-section-expiry">
                <h2>Contract</h2>
                <ExpiryFilterMenu value={expiry} onChange={onExpiryChange} />
            </div>
            <div className="filter-section filter-section-half">
                <h2>Performance</h2>
                <HalfFilterMenu value={half} onChange={onHalfChange} />
            </div>
            {owned && onOwnedChange && (
                <div className="filter-section filter-section-owned">
                    <h2>Ownership</h2>
                    <OwnedFilterMenu value={owned} onChange={onOwnedChange} />
                </div>
            )}
            <div className="filter-section filter-section-moneyness">
                <h2>Contract</h2>
                <MoneynessFilterMenu value={moneyness} onChange={onMoneynessChange} />
            </div>
            {grades && onGradesChange && (
                <div className="filter-section filter-section-grade">
                    <h2>Performance</h2>
                    <GradeFilterMenu value={grades} onChange={onGradesChange} />
                </div>
            )}
            {tier && onTierChange && (
                <div className="filter-section filter-section-tier">
                    <h2>Risk</h2>
                    <TierFilterMenu value={tier} onChange={onTierChange} />
                </div>
            )}
            <div className="filter-section filter-section-symbol">
                <h2>Symbol</h2>
                <div className={`symbol-filter${symbol ? ' has-value' : ''}`}>
                    <input
                        type="text"
                        ref={symbolInputRef}
                        value={symbol}
                        onChange={(event) => onSymbolChange(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') event.currentTarget.blur();
                        }}
                        placeholder="Filter by symbol"
                        aria-label={symbolAriaLabel}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {symbol && (
                        <button
                            type="button"
                            className="symbol-filter-clear"
                            onClick={() => onSymbolChange('')}
                            aria-label={clearSymbolAriaLabel}
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}
