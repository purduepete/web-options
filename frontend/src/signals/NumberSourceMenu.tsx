import { NUMBER_SOURCES, type NumberSource } from '@weboptions/shared';
import { ChoiceMenu, type ChoiceOption } from '../components/ChoiceMenu';
import { DollarIcon } from '../components/icons';

/**
 * Which numbers the tickets show.
 *
 * Neither source narrows the week, so the trigger always names the one in use
 * and never wears the highlight.
 */

const OPTIONS: Record<NumberSource, Omit<ChoiceOption<NumberSource>, 'value'>> = {
    actual: { label: 'Actual', description: 'The quote captured that morning' },
    quoted: { label: 'VADER', description: 'The numbers advertised with the signal' },
};

interface NumberSourceMenuProps {
    value: NumberSource;
    onChange: (next: NumberSource) => void;
}

export function NumberSourceMenu({ value, onChange }: NumberSourceMenuProps) {
    return (
        <ChoiceMenu
            name="Numbers"
            icon={<DollarIcon width={15} height={15} />}
            options={NUMBER_SOURCES.map((source) => ({ value: source, ...OPTIONS[source] }))}
            value={value}
            onChange={onChange}
        />
    );
}
