import { Link } from 'react-router-dom';

export function NotFoundPage() {
    return (
        <main>
            <h1>No such page</h1>
            <p>
                <Link to="/">Back to live signals</Link>
            </p>
        </main>
    );
}
