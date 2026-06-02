import './GuidePanel.css';
import { getVisibleTabs } from '../layout/tabBarUtils';

interface GuidePanelProps {
    showReports: boolean;
    showManage: boolean;
}

export const GuidePanel = ({ showReports, showManage }: GuidePanelProps) => {
    const tabs = getVisibleTabs(showReports, showManage);
    const tabLabels = tabs.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ');

    return (
        <section className="guide-panel">
            <h2 className="guide-panel__title">Keyboard shortcuts</h2>
            <dl className="guide-panel__list">
                <div>
                    <dt>1–{tabs.length}</dt>
                    <dd>
                        Switch main tabs ({tabLabels}). Session (gear) is not numbered.
                    </dd>
                </div>
                <div>
                    <dt>F</dt>
                    <dd>Open Logs and focus search</dd>
                </div>
                <div>
                    <dt>Ctrl+Enter</dt>
                    <dd>Manual sync for active tournament (admin+)</dd>
                </div>
                <div>
                    <dt>Esc</dt>
                    <dd>Blur focused input</dd>
                </div>
            </dl>
            <p className="guide-panel__note">Shortcuts are disabled while typing in a field.</p>

            <h3 className="guide-panel__title" style={{ marginTop: 'var(--space-6)' }}>
                Local test data
            </h3>
            <p className="guide-panel__note">
                Manage → Reset test data supports scenarios: default (~40m on clock), late (~2m), overtime (expired +
                outstanding tables), top8 (round 6, no timer). Hide [TEST] tournaments under Manage → App config.
            </p>
        </section>
    );
};
