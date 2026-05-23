import { useCallback, useRef, useState } from 'react';
import type { Session, Theme } from '../../../types';
import type { FileNode } from '../../../types/fileTree';
import type { FileTreeChanges } from '../../../utils/fileExplorer';
import { useClickOutside } from '../../../hooks/ui/useClickOutside';
import { useContextMenuPosition } from '../../../hooks/ui/useContextMenuPosition';
import { useEventListener } from '../../../hooks/utils/useEventListener';
import { useModalStore } from '../../../stores/modalStore';
import { safeClipboardWrite } from '../../../utils/clipboard';
import type { ContextMenuState } from '../types';
import { PREVIEW_ALL_CONFIRM_THRESHOLD } from '../types';
import { collectPreviewableFiles } from '../utils/pathHelpers';

interface UseFileContextMenuArgs {
	session: Session;
	theme: Theme;
	sshRemoteId: string | undefined;
	onShowFlash?: (msg: string) => void;
	onFocusFileInGraph?: (relativePath: string) => void;
	onOpenBrowserTabAt?: (url: string, options?: { title?: string }) => void;
	handleFileClick: (node: FileNode, path: string, activeSession: Session) => Promise<void>;
	openRenameModal: (node: FileNode, path: string) => void;
	openDeleteModal: (node: FileNode, path: string) => Promise<void>;
	openNewFileModal: (parentFolderPath: string, parentFolderAbsolutePath: string) => void;
	setSelectedFileIndex: (n: number) => void;
}

interface UseFileContextMenuResult {
	contextMenu: ContextMenuState | null;
	contextMenuRef: React.RefObject<HTMLDivElement>;
	contextMenuPos: { top: number; left: number; ready?: boolean };
	openContextMenu: (e: React.MouseEvent, node: FileNode, path: string, globalIndex: number) => void;
	closeContextMenu: () => void;
	handleCopyPath: () => void;
	handleOpenInDefaultApp: () => void;
	handleOpenInMaestroBrowser: () => void;
	handleOpenInExplorer: () => void;
	handleOpenNewFile: () => void;
	handleOpenRename: () => void;
	handleOpenDelete: () => Promise<void>;
	handleFocusInGraph: () => void;
	handlePreviewFile: () => void;
	handlePreviewAllInFolder: () => void;
}

export function useFileContextMenu({
	session,
	sshRemoteId,
	onShowFlash,
	onFocusFileInGraph,
	onOpenBrowserTabAt,
	handleFileClick,
	openRenameModal,
	openDeleteModal,
	openNewFileModal,
	setSelectedFileIndex,
}: UseFileContextMenuArgs): UseFileContextMenuResult {
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const contextMenuPos = useContextMenuPosition(
		contextMenuRef,
		contextMenu?.x ?? 0,
		contextMenu?.y ?? 0
	);

	useClickOutside(
		contextMenuRef,
		() => {
			setContextMenu(null);
		},
		contextMenu !== null
	);

	// Close context menu on Escape key (only attached while the menu is open).
	useEventListener(
		'keydown',
		(e) => {
			if ((e as KeyboardEvent).key === 'Escape') {
				setContextMenu(null);
			}
		},
		{ enabled: contextMenu !== null }
	);

	const openContextMenu = useCallback(
		(e: React.MouseEvent, node: FileNode, path: string, globalIndex: number) => {
			e.preventDefault();
			e.stopPropagation();
			setSelectedFileIndex(globalIndex);
			setContextMenu({ x: e.clientX, y: e.clientY, node, path });
		},
		[setSelectedFileIndex]
	);

	const closeContextMenu = useCallback(() => setContextMenu(null), []);

	const handleFocusInGraph = useCallback(() => {
		if (contextMenu && onFocusFileInGraph) {
			onFocusFileInGraph(contextMenu.path);
		}
		setContextMenu(null);
	}, [contextMenu, onFocusFileInGraph]);

	const handlePreviewFile = useCallback(() => {
		if (contextMenu && contextMenu.node.type === 'file') {
			handleFileClick(contextMenu.node, contextMenu.path, session);
		}
		setContextMenu(null);
	}, [contextMenu, handleFileClick, session]);

	const handlePreviewAllInFolder = useCallback(() => {
		if (!contextMenu || contextMenu.node.type !== 'folder') {
			setContextMenu(null);
			return;
		}
		const folderNode = contextMenu.node;
		const folderPath = contextMenu.path;
		setContextMenu(null);

		const files = collectPreviewableFiles(folderNode, folderPath);
		if (files.length === 0) {
			onShowFlash?.(`No previewable files in "${folderNode.name}"`);
			return;
		}

		const openAll = async () => {
			for (const file of files) {
				await handleFileClick(file.node, file.path, session);
			}
			onShowFlash?.(
				`Opened ${files.length} file${files.length !== 1 ? 's' : ''} from "${folderNode.name}"`
			);
		};

		if (files.length > PREVIEW_ALL_CONFIRM_THRESHOLD) {
			useModalStore.getState().openModal('confirm', {
				message: `Preview all ${files.length} files under "${folderNode.name}"? This opens a tab for each file.`,
				onConfirm: () => void openAll(),
			});
			return;
		}
		void openAll();
	}, [contextMenu, handleFileClick, session, onShowFlash]);

	const handleCopyPath = useCallback(() => {
		if (contextMenu) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			safeClipboardWrite(absolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath]);

	const handleOpenInDefaultApp = useCallback(() => {
		if (contextMenu) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			window.maestro?.shell?.openPath(absolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath]);

	const handleOpenInMaestroBrowser = useCallback(() => {
		if (contextMenu && contextMenu.node.type === 'file' && onOpenBrowserTabAt) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			const encodedPath = absolutePath
				.split('/')
				.map((seg) => encodeURIComponent(seg))
				.join('/');
			const url = `file://${encodedPath}`;
			onOpenBrowserTabAt(url, { title: contextMenu.node.name });
		}
		setContextMenu(null);
	}, [contextMenu, onOpenBrowserTabAt, session.fullPath]);

	const handleOpenInExplorer = useCallback(() => {
		if (contextMenu) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			window.maestro?.shell?.showItemInFolder(absolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath]);

	const handleOpenNewFile = useCallback(() => {
		if (contextMenu && contextMenu.node.type === 'folder') {
			const parentFolderAbsolutePath = `${session.fullPath}/${contextMenu.path}`;
			openNewFileModal(contextMenu.path, parentFolderAbsolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath, openNewFileModal]);

	const handleOpenRename = useCallback(() => {
		if (contextMenu) {
			openRenameModal(contextMenu.node, contextMenu.path);
		}
		setContextMenu(null);
	}, [contextMenu, openRenameModal]);

	const handleOpenDelete = useCallback(async () => {
		if (contextMenu) {
			await openDeleteModal(contextMenu.node, contextMenu.path);
		}
		setContextMenu(null);
	}, [contextMenu, openDeleteModal]);

	return {
		contextMenu,
		contextMenuRef,
		contextMenuPos,
		openContextMenu,
		closeContextMenu,
		handleCopyPath,
		handleOpenInDefaultApp,
		handleOpenInMaestroBrowser,
		handleOpenInExplorer,
		handleOpenNewFile,
		handleOpenRename,
		handleOpenDelete,
		handleFocusInGraph,
		handlePreviewFile,
		handlePreviewAllInFolder,
	};
}
