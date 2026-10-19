export function isAccessMode(): boolean {
    return import.meta.env.VITE_AUTH_MODE === 'access';
}
