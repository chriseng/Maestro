import { Sparkles, Trophy, Wand2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Theme } from '../../../types';
import type { TabId } from '../types';

interface Tab {
	id: TabId;
	label: string;
	icon: ReactNode;
}

const TABS: Tab[] = [
	{ id: 'achievements', label: 'Achievements', icon: <Trophy className="w-4 h-4" /> },
	{ id: 'confetti', label: 'Confetti', icon: <Sparkles className="w-4 h-4" /> },
	{ id: 'baton', label: 'Baton', icon: <Wand2 className="w-4 h-4" /> },
];

interface PlaygroundTabsProps {
	theme: Theme;
	activeTab: TabId;
	onSelectTab: (tab: TabId) => void;
}

export function PlaygroundTabs({ theme, activeTab, onSelectTab }: PlaygroundTabsProps) {
	return (
		<div className="flex border-b" style={{ borderColor: theme.colors.border }}>
			{TABS.map((tab) => (
				<button
					key={tab.id}
					onClick={() => onSelectTab(tab.id)}
					className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
						activeTab === tab.id ? 'border-b-2' : ''
					}`}
					style={{
						color: activeTab === tab.id ? theme.colors.accent : theme.colors.textDim,
						borderColor: activeTab === tab.id ? theme.colors.accent : 'transparent',
						backgroundColor: activeTab === tab.id ? `${theme.colors.accent}10` : 'transparent',
					}}
				>
					{tab.icon}
					{tab.label}
				</button>
			))}
		</div>
	);
}
