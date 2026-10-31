import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FirstLoad } from './hooks/useFirstLoad';
import './first-load.css';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
    <StrictMode>
        <App />
        <FirstLoad />
    </StrictMode>
);
