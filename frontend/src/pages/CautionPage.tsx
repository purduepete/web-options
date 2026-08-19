import { useEffect, useState, type FormEvent } from 'react';
import { CAUTION_SYMBOL_LIMIT, parseCautionSymbols } from '@weboptions/shared';
import { describeFailure } from '../api';
import { useCaution } from '../caution/CautionProvider';
import { AlertIcon } from '../components/icons';
import './CautionPage.css';

/**
 * The caution list is a global setting rather than a per-browser one: it is stored
 * on the server, so a ticker flagged here is flagged on every device. That is why
 * it sits under Settings and not above one of the grids.
 */
export function CautionPage() {
    const { symbols, loaded, error, save } = useCaution();
    const [text, setText] = useState('');
    const [seeded, setSeeded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    // Seeded once, when the list arrives. Following it afterwards would overwrite
    // whatever is half-typed every time a save came back.
    useEffect(() => {
        if (!loaded || seeded) return;
        setText([...symbols].sort().join('\n'));
        setSeeded(true);
    }, [loaded, seeded, symbols]);

    const parsed = parseCautionSymbols(text);
    const overLimit = parsed.length > CAUTION_SYMBOL_LIMIT;

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        setSaving(true);
        setStatus(null);
        setFailure(null);
        try {
            await save(parsed);
            setText(parsed.slice().sort().join('\n'));
            setStatus(parsed.length === 1 ? 'Saved 1 symbol.' : `Saved ${parsed.length} symbols.`);
        } catch (cause) {
            setFailure(describeFailure(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="caution-page">
            <h1>Caution symbols</h1>

            <p className="caution-intro">
                <AlertIcon />
                <span>
                    Underlyings listed here are flagged with a caution icon wherever they appear, on the live signals
                    grid and on the weekly calendars. Enter one symbol per line, or separate them with spaces or commas.
                </span>
            </p>

            <form onSubmit={onSubmit}>
                <label className="caution-label" htmlFor="caution-symbols">
                    Symbols
                    <span className="caution-count">
                        {parsed.length} of {CAUTION_SYMBOL_LIMIT}
                    </span>
                </label>

                <textarea
                    id="caution-symbols"
                    className="caution-input"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="TSLA"
                    rows={8}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="characters"
                />

                <div className="caution-actions">
                    <button type="submit" className="primary" disabled={saving || !loaded || overLimit}>
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    {overLimit && <span className="caution-failure">That is more than {CAUTION_SYMBOL_LIMIT}.</span>}
                    {status && <span className="caution-status">{status}</span>}
                    {(failure ?? error) && <span className="caution-failure">{failure ?? error}</span>}
                </div>
            </form>
        </main>
    );
}
