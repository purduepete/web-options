import { ChoiceMenu } from '../components/ChoiceMenu';
import { TableIcon } from '../components/icons';
import { OWNED_GROUPS, OWNED_GROUP_DESCRIPTIONS, OWNED_GROUP_LABELS, type OwnedGroup } from './group';

/** How the rows are banded, alongside the sort that orders them within a band. */
export function OwnedGroupMenu({ value, onChange }: { value: OwnedGroup; onChange: (next: OwnedGroup) => void }) {
    return (
        <ChoiceMenu
            name="Group"
            icon={<TableIcon width={15} height={15} />}
            options={OWNED_GROUPS.map((mode) => ({
                value: mode,
                label: OWNED_GROUP_LABELS[mode],
                description: OWNED_GROUP_DESCRIPTIONS[mode],
            }))}
            value={value}
            neutral="none"
            onChange={onChange}
        />
    );
}
