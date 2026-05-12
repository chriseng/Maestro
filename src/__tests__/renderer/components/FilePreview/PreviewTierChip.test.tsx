import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreviewTierChip } from '../../../../renderer/components/FilePreview/PreviewTierChip';
import { mockTheme } from '../../../helpers/mockTheme';

describe('PreviewTierChip', () => {
	beforeEach(() => {
		// Each test starts with a fresh DOM
	});

	function renderChip(
		opts: {
			autoTier?: 'rich' | 'fast' | 'giant';
			override?: 'rich' | 'fast' | 'giant';
			visible?: boolean;
			onSelect?: (tier: 'rich' | 'fast' | 'giant' | undefined) => void;
		} = {}
	) {
		const onSelect = opts.onSelect ?? vi.fn();
		const utils = render(
			<PreviewTierChip
				theme={mockTheme}
				autoTier={opts.autoTier ?? 'fast'}
				override={opts.override}
				onSelect={onSelect}
				visible={opts.visible}
			/>
		);
		return { ...utils, onSelect };
	}

	describe('rendering', () => {
		it('renders the auto tier label when no override is set', () => {
			renderChip({ autoTier: 'fast' });
			const btn = screen.getByTestId('preview-tier-chip-button');
			expect(btn.textContent).toContain('Fast');
			expect(btn.textContent).toContain('auto');
		});

		it('renders the override tier label when an override is set', () => {
			renderChip({ autoTier: 'fast', override: 'rich' });
			const btn = screen.getByTestId('preview-tier-chip-button');
			expect(btn.textContent).toContain('Rich');
			expect(btn.textContent).not.toContain('auto');
		});

		it('shows "Giant" when giant is the effective tier', () => {
			renderChip({ autoTier: 'giant' });
			expect(screen.getByTestId('preview-tier-chip-button').textContent).toContain('Giant');
		});

		it('does not render when visible is false', () => {
			renderChip({ visible: false });
			expect(screen.queryByTestId('preview-tier-chip')).toBeNull();
		});

		it('renders when visible is omitted (default true)', () => {
			renderChip({});
			expect(screen.getByTestId('preview-tier-chip')).toBeTruthy();
		});

		it('marks button with aria-expanded false by default', () => {
			renderChip({});
			const btn = screen.getByTestId('preview-tier-chip-button');
			expect(btn.getAttribute('aria-expanded')).toBe('false');
		});

		it('shows tooltip text describing the current mode', () => {
			renderChip({ autoTier: 'fast' });
			expect(screen.getByTestId('preview-tier-chip-button').getAttribute('title')).toContain(
				'Auto'
			);

			renderChip({ autoTier: 'fast', override: 'rich' });
			expect(screen.getAllByTestId('preview-tier-chip-button')[1].getAttribute('title')).toContain(
				'Forced'
			);
		});
	});

	describe('menu interaction', () => {
		it('opens the menu when the chip is clicked', () => {
			renderChip({});
			expect(screen.queryByTestId('preview-tier-chip-menu')).toBeNull();
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			expect(screen.getByTestId('preview-tier-chip-menu')).toBeTruthy();
		});

		it('shows all four menu rows: Auto, Rich, Fast, Giant', () => {
			renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const menu = screen.getByTestId('preview-tier-chip-menu');
			expect(menu.textContent).toContain('Auto');
			expect(menu.textContent).toContain('Rich');
			expect(menu.textContent).toContain('Fast');
			expect(menu.textContent).toContain('Giant');
		});

		it('closes the menu after a selection', () => {
			const { onSelect } = renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const rows = screen.getAllByRole('menuitem');
			fireEvent.click(rows[1]); // Rich
			expect(onSelect).toHaveBeenCalledWith('rich');
			expect(screen.queryByTestId('preview-tier-chip-menu')).toBeNull();
		});

		it('toggles the menu off when the chip is clicked while open', () => {
			renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			expect(screen.getByTestId('preview-tier-chip-menu')).toBeTruthy();
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			expect(screen.queryByTestId('preview-tier-chip-menu')).toBeNull();
		});

		it('closes when Escape is pressed', () => {
			renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			expect(screen.getByTestId('preview-tier-chip-menu')).toBeTruthy();
			fireEvent.keyDown(document, { key: 'Escape' });
			expect(screen.queryByTestId('preview-tier-chip-menu')).toBeNull();
		});

		it('closes when clicking outside', () => {
			renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			expect(screen.getByTestId('preview-tier-chip-menu')).toBeTruthy();
			fireEvent.mouseDown(document.body);
			expect(screen.queryByTestId('preview-tier-chip-menu')).toBeNull();
		});
	});

	describe('selection actions', () => {
		it('Auto row calls onSelect(undefined) to clear the override', () => {
			const { onSelect } = renderChip({ override: 'rich' });
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const autoRow = screen.getAllByRole('menuitem')[0];
			fireEvent.click(autoRow);
			expect(onSelect).toHaveBeenCalledWith(undefined);
		});

		it('Rich row calls onSelect("rich")', () => {
			const { onSelect } = renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const rows = screen.getAllByRole('menuitem');
			fireEvent.click(rows[1]);
			expect(onSelect).toHaveBeenCalledWith('rich');
		});

		it('Fast row calls onSelect("fast")', () => {
			const { onSelect } = renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const rows = screen.getAllByRole('menuitem');
			fireEvent.click(rows[2]);
			expect(onSelect).toHaveBeenCalledWith('fast');
		});

		it('Giant row calls onSelect("giant")', () => {
			const { onSelect } = renderChip({});
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const rows = screen.getAllByRole('menuitem');
			fireEvent.click(rows[3]);
			expect(onSelect).toHaveBeenCalledWith('giant');
		});

		it('marks the active row with aria-current', () => {
			renderChip({ override: 'fast' });
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const rows = screen.getAllByRole('menuitem');
			// Rows: [Auto, Rich, Fast, Giant]. Fast is the active override.
			expect(rows[2].getAttribute('aria-current')).toBe('true');
			expect(rows[0].getAttribute('aria-current')).toBeNull();
			expect(rows[1].getAttribute('aria-current')).toBeNull();
			expect(rows[3].getAttribute('aria-current')).toBeNull();
		});

		it('marks Auto as active when no override is set', () => {
			renderChip({ override: undefined });
			fireEvent.click(screen.getByTestId('preview-tier-chip-button'));
			const rows = screen.getAllByRole('menuitem');
			expect(rows[0].getAttribute('aria-current')).toBe('true');
			expect(rows[1].getAttribute('aria-current')).toBeNull();
			expect(rows[2].getAttribute('aria-current')).toBeNull();
			expect(rows[3].getAttribute('aria-current')).toBeNull();
		});
	});
});
