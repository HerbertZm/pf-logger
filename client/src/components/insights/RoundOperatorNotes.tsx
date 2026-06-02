import { useState } from 'react';
import './RoundOperatorNotes.css';
import { api } from '../../api/client';
import type { Round } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../shared/Button';

interface RoundOperatorNotesProps {
    round: Round;
    onSaved: (round: Round) => void;
}

export const RoundOperatorNotes = ({ round, onSaved }: RoundOperatorNotesProps) => {
    const { isAdmin } = useAuth();
    const [draft, setDraft] = useState(round.operatorNotes ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    if (!isAdmin) {
        if (round.operatorNotes === null || round.operatorNotes.length === 0) {
            return null;
        }
        return (
            <div className="round-notes round-notes--readonly">
                <span className="round-notes__label">Operator notes</span>
                <p className="round-notes__text">{round.operatorNotes}</p>
            </div>
        );
    }

    const handleSave = (): void => {
        setSaving(true);
        setError(null);
        setSaved(false);
        const payload = draft.trim() === '' ? null : draft.trim();
        api.patch<Round>(`/api/rounds/${round.id}/notes`, { notes: payload })
            .then((updated) => {
                onSaved(updated);
                setSaved(true);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setSaving(false));
    };

    return (
        <div className="round-notes">
            <label className="round-notes__label" htmlFor={`round-notes-${round.id}`}>
                Operator notes
            </label>
            <textarea
                id={`round-notes-${round.id}`}
                className="round-notes__input"
                rows={3}
                value={draft}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setSaved(false);
                }}
                placeholder="Deck check pile-up at tables 12–15…"
            />
            <div className="round-notes__actions">
                <Button variant="secondary" size="sm" loading={saving} onClick={handleSave}>
                    Save notes
                </Button>
                {saved && <span className="round-notes__saved">Saved</span>}
                {error !== null && <span className="round-notes__error">{error}</span>}
            </div>
        </div>
    );
};
