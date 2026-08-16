import { useApiKey } from '../auth/ApiKeyProvider';
import { KeyIcon } from '../components/icons';

export function ApiKeyPage() {
    const { identity, forget } = useApiKey();

    return (
        <main>
            <h1>API key</h1>
            <p>
                <KeyIcon /> This browser is using <strong>{identity?.label ?? 'an unlabelled key'}</strong>.
            </p>
            <p className="muted">
                The key itself is never shown again after it is minted. Forgetting it here clears it from this browser
                only — it stays valid until it is revoked with the operator tooling.
            </p>
            <p>
                <button type="button" className="primary" onClick={forget}>
                    Forget key on this device
                </button>
            </p>
        </main>
    );
}
