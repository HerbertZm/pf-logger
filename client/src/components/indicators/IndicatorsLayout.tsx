import type { ReactNode } from 'react';
import './IndicatorsLayout.css';
import { RoundSchedulePane } from './RoundSchedulePane';

interface IndicatorsLayoutProps {
    children: ReactNode;
}

export const IndicatorsLayout = ({ children }: IndicatorsLayoutProps) => (
    <div className="indicators-layout">
        <RoundSchedulePane />
        <div className="indicators-layout__main">{children}</div>
    </div>
);
