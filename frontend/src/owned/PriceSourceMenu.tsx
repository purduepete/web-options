import { ChoiceMenu, type ChoiceOption } from '../components/ChoiceMenu';
import { ActivityIcon } from '../components/icons';
import { PRICE_SOURCES, PRICE_SOURCE_DESCRIPTIONS, PRICE_SOURCE_LABELS, type PriceSource } from './priceSource';

// No neutral choice: neither source narrows the list, so the trigger names the
// one that is on rather than the menu.

interface PriceSourceMenuProps {
    value: PriceSource;
    onChange: (next: PriceSource) => void;
}

export function OwnedPriceSourceMenu({ value, onChange }: PriceSourceMenuProps) {
    const options: ChoiceOption<PriceSource>[] = PRICE_SOURCES.map((source) => ({
        value: source,
        label: PRICE_SOURCE_LABELS[source],
        description: PRICE_SOURCE_DESCRIPTIONS[source],
    }));
    return (
        <ChoiceMenu
            name="Prices"
            icon={<ActivityIcon width={15} height={15} />}
            options={options}
            value={value}
            onChange={onChange}
        />
    );
}
