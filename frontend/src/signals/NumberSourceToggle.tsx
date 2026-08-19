import { NUMBER_SOURCES, type NumberSource } from '@weboptions/shared';

/**
 * Which numbers the tickets show.
 *
 * A radiogroup rather than a checkbox: "Actual" and "Quoted" are two named
 * sources, and a checkbox would have to imply one of them is the absence of the
 * other. Same markup shape as the theme picker so the two read alike.
 */

const LABELS: Record<NumberSource, string> = {
    actual: 'Actual',
    quoted: 'VADER',
};

const TITLES: Record<NumberSource, string> = {
    actual: 'The quote captured at 7:30am Pacific on the signal date.',
    quoted: 'The numbers VADER advertised with the signal.',
};

interface NumberSourceToggleProps {
    value: NumberSource;
    onChange: (next: NumberSource) => void;
}

export function NumberSourceToggle({ value, onChange }: NumberSourceToggleProps) {
    return (
        <div className="number-source" role="radiogroup" aria-label="Number source">
            {NUMBER_SOURCES.map((source) => {
                const selected = source === value;
                return (
                    <button
                        key={source}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={selected ? 'number-source-option selected' : 'number-source-option'}
                        title={TITLES[source]}
                        onClick={() => onChange(source)}
                    >
                        {LABELS[source]}
                    </button>
                );
            })}
        </div>
    );
}
