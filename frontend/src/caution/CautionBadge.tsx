import { AlertIcon } from '../components/icons';
import { useCautionSymbols } from './CautionProvider';
import './CautionBadge.css';

const TITLE = 'On the caution list. Treat this underlying with care.';

/**
 * Sits with the ticker rather than in the badge cluster on the right: it is a fact
 * about the underlying, not about this contract, so it reads as part of the name.
 */
export function CautionBadge({ symbol }: { symbol: string }) {
    const symbols = useCautionSymbols();
    if (!symbols.has(symbol.toUpperCase())) return null;

    return (
        <span className="caution-flag" title={TITLE}>
            <AlertIcon width={14} height={14} />
            <span className="sr-only"> caution</span>
        </span>
    );
}
