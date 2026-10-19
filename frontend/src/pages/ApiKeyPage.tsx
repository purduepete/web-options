import { useApiKey } from '../auth/ApiKeyProvider';
import { KeyIcon } from '../components/icons';
import { isAccessMode } from '../auth/mode';

export function ApiKeyPage() {
    const { identity, forget } = useApiKey();
    if (isAccessMode()) {
        return (
            <main>
                <h1>Platform access</h1>
                <p>Public access uses Cloudflare Access. Private access uses Tailscale access controls.</p>
                <p>This deployment doesn't require a browser API key.</p>
            </main>
        );
    }

    return (
        <main>
            <h1>API key</h1>
            <p>
                <KeyIcon /> This browser is using <strong>{identity?.label ?? 'an unlabeled key'}</strong>.
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
