import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { AuthProvider } from './context/AuthContext';
import { TournamentProvider } from './context/TournamentContext';
import App from './App';

// AuthProvider wraps TournamentProvider — tournament context makes authenticated API calls on mount
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <AuthProvider>
            <TournamentProvider>
                <App />
            </TournamentProvider>
        </AuthProvider>
    </StrictMode>,
);
