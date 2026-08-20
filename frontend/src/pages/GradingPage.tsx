import { useState, type FormEvent } from 'react';
import {
    GRADE_DEFAULTS,
    type GradeSettings,
    gradeSettingsError,
    VIX_CALM_BELOW,
    VIX_DEAD_BELOW,
} from '@weboptions/shared';
import { describeFailure } from '../api';
import { useGradeSettingsState } from '../grade/GradeSettingsProvider';
import { SlidersIcon } from '../components/icons';
import './GradingPage.css';

/**
 * The thresholds behind the green / yellow / red badge in the trade drill-in.
 *
 * A global setting rather than a per-browser one, for the same reason the caution
 * list is: a threshold set on the laptop should hold on the phone.
 *
 * The fields are text, not `type="number"`: a number input's spinner and its
 * locale-dependent parsing both get in the way of typing `-0.25`.
 */

interface Field {
    key: keyof GradeSettings;
    label: string;
    hint: string;
}

const FIELDS: Field[] = [
    {
        key: 'deltaThreshold',
        label: 'Delta threshold',
        hint: 'Flag a put whose delta is beyond this. Both numbers are negative, so -0.31 is beyond -0.25.',
    },
    {
        key: 'deltaRedThreshold',
        label: 'Delta red threshold',
        hint: 'And beyond this, red rather than yellow. It has to sit further from zero than the delta threshold.',
    },
    {
        key: 'otmPercentThreshold',
        label: 'Cushion percent',
        hint: 'Flag a put whose strike is less than this far below the underlying price.',
    },
    { key: 'annualizedRedBelow', label: 'Red below', hint: 'An annualized yield under this grades red.' },
    { key: 'annualizedYellowBelow', label: 'Yellow below', hint: 'And under this, yellow. At or above it, green.' },
];

type Draft = Record<keyof GradeSettings, string>;

function toDraft(settings: GradeSettings): Draft {
    return {
        deltaThreshold: String(settings.deltaThreshold),
        deltaRedThreshold: String(settings.deltaRedThreshold),
        otmPercentThreshold: String(settings.otmPercentThreshold),
        annualizedRedBelow: String(settings.annualizedRedBelow),
        annualizedYellowBelow: String(settings.annualizedYellowBelow),
    };
}

export function GradingPage() {
    const { settings, loaded, error, save } = useGradeSettingsState();
    const [draft, setDraft] = useState<Draft>(() => toDraft(GRADE_DEFAULTS));
    const [seeded, setSeeded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    // Seeded ONCE, during render rather than in an effect. An effect leaves a
    // window between the thresholds arriving and the fields showing them, and
    // anything typed in that window is overwritten under the reader's caret.
    // Following the settings afterwards would do the same on every save.
    if (loaded && !seeded) {
        setSeeded(true);
        setDraft(toDraft(settings));
    }

    const parsed: GradeSettings = {
        deltaThreshold: Number(draft.deltaThreshold),
        deltaRedThreshold: Number(draft.deltaRedThreshold),
        otmPercentThreshold: Number(draft.otmPercentThreshold),
        annualizedRedBelow: Number(draft.annualizedRedBelow),
        annualizedYellowBelow: Number(draft.annualizedYellowBelow),
    };
    // The same check the server runs, so the button says no before the round trip.
    const invalid = gradeSettingsError(parsed);

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        if (invalid) return;
        setSaving(true);
        setStatus(null);
        setFailure(null);
        try {
            await save(parsed);
            setDraft(toDraft(parsed));
            setStatus('Saved.');
        } catch (cause) {
            setFailure(describeFailure(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="grading-page">
            <h1>Grading</h1>

            <p className="grading-intro">
                <SlidersIcon />
                <span>
                    These decide the grade on a trade&apos;s drill-in. Every one of them grades on its own and the trade
                    takes the worst of them, so two yellows are still a yellow and a yellow beside a red is a red. The
                    names and starting values match webportfolio, but this app does its own arithmetic, so a trade
                    sitting right on a threshold can grade differently in the two. Two more criteria have no threshold
                    to set: a symbol on the caution list is red, and a VIX close below {VIX_CALM_BELOW} makes every
                    trade at least yellow, below {VIX_DEAD_BELOW} red.
                </span>
            </p>

            <form onSubmit={onSubmit}>
                {FIELDS.map((field) => (
                    <div className="grading-field" key={field.key}>
                        <label className="grading-label" htmlFor={field.key}>
                            {field.label}
                        </label>
                        <input
                            id={field.key}
                            className="grading-input"
                            type="text"
                            inputMode="decimal"
                            value={draft[field.key]}
                            onChange={(event) =>
                                setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                            }
                            spellCheck={false}
                            autoComplete="off"
                        />
                        <p className="grading-hint">{field.hint}</p>
                    </div>
                ))}

                <div className="grading-actions">
                    <button type="submit" className="primary" disabled={saving || !loaded || invalid !== null}>
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setDraft(toDraft(GRADE_DEFAULTS));
                            setStatus(null);
                        }}
                    >
                        Reset to defaults
                    </button>
                    {invalid && <span className="grading-failure">{invalid}</span>}
                    {status && <span className="grading-status">{status}</span>}
                    {(failure ?? error) && <span className="grading-failure">{failure ?? error}</span>}
                </div>
            </form>
        </main>
    );
}
