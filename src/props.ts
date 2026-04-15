import { palace } from './state.js';
import { httpGetAsync, httpPostAsync, dedup, showConfirmDialog, showPromptDialog } from './utility.js';
import { prefs, setGeneralPref } from './preferences.js';
import { platformCtrlKey, wearSelectedProps, setPropButtons, logmsg, enablePropButtons } from './interface.js';
import { openPropEditor, openPropEditorFromProps } from './prop-editor.js';

export let cacheProps: Record<string, PalaceProp> = {};
let nbrProps = 0;
let retryProps = { props: [] as number[], delay: 2500 };
export const propBag = document.getElementById('props')!;
const propBagRetainer = document.getElementById('propbagretainer')!;
export let selectedBagProps: number[] = [];
export let dragBagProp: { id: number; x: number; y: number; w: number; h: number } | null = null;
let propBagDB: IDBDatabase;
export { propBagDB };
export let propBagList: number[] = [];
export const propBagSet = new Set<number>();
export let propBagCategories: PropBagCategory[] = [];
let activeCategoryId: string | null = null;

export interface PropBagCategory {
	id: string;
	name: string;
	props: number[];
	collapsed?: boolean;
}

const tileMap = new Map<number, HTMLElement>();

export function setSelectedBagProps(v: number[]): void { selectedBagProps = v; }
export function resetCacheProps(): void {
	for (const k in cacheProps) {
		URL.revokeObjectURL(cacheProps[k].src);
	}
	cacheProps = {};
}

export const PROP_HEAD = 2;
export const PROP_GHOST = 4;
export const PROP_RARE = 8;
export const PROP_ANIMATED = 16;
export const PROP_BOUNCE = 32;
export const PROP_PNG = 1024;


function getVisiblePropList(): number[] {
	if (activeCategoryId) {
		const cat = propBagCategories.find((c) => c.id === activeCategoryId);
		return cat ? cat.props.filter((pid) => propBagSet.has(pid)) : propBagList;
	}
	return propBagList;
}

const categoryBar = document.getElementById('propcategories')!;
let activeCtxMenu: HTMLElement | null = null;

function dismissCtxMenu(): void {
	if (activeCtxMenu) {
		activeCtxMenu.remove();
		activeCtxMenu = null;
	}
}

async function showPropCtxMenu(pid: number): Promise<void> {
	const deleteCount = selectedBagProps.length > 0 ? selectedBagProps.length : 1;
	const catSubmenu = propBagCategories.map((cat, i) => ({
		id: 100 + i,
		label: cat.name,
		type: 'normal' as const,
		enabled: true
	}));
	const multiSelected = selectedBagProps.length >= 2;
	const menuIndex = await (window.apiBridge.openContextMenu as any)({
		items: [
			{ id: 0, label: 'Wear', type: 'normal', enabled: true },
			{ type: 'separator' },
			{ id: 2, label: 'Edit', type: 'normal', enabled: true },
			{ id: 3, label: 'Clone', type: 'normal', enabled: true },
			{ id: 4, label: 'Create Animation', type: 'normal', enabled: multiSelected },
			{ type: 'separator' },
			{ id: 5, label: 'Copy Image', type: 'normal', enabled: true },
			...(catSubmenu.length > 0 ? [
				{ type: 'separator' },
				{ id: 7, label: 'Add to Category', type: 'normal', enabled: true, submenu: catSubmenu }
			] : []),
			{ type: 'separator' },
			{ id: 9, label: `Delete${deleteCount > 1 ? ` (${deleteCount})` : ''}`, type: 'normal', enabled: true }
		]
	}) as number;

	switch (menuIndex) {
		case 0: // Wear
			wearSelectedProps();
			break;
		case 2: { // Edit
			const store = propBagDB.transaction('props', 'readonly').objectStore('props');
			const get = store.get(pid);
			get.onsuccess = () => {
				const prop = new PalaceProp(pid, get.result);
				if (prop.isComplete) openPropEditor(prop);
				else prop.img.addEventListener('load', () => openPropEditor(prop), { once: true });
			};
			break;
		}
		case 4: { // Create Animation
			const pidsToAnimate = selectedBagProps.slice();
			const store = propBagDB.transaction('props', 'readonly').objectStore('props');
			const animProps: PalaceProp[] = [];
			let remaining = pidsToAnimate.length;
			for (const srcPid of pidsToAnimate) {
				const get = store.get(srcPid);
				get.onsuccess = () => {
					const prop = new PalaceProp(srcPid, get.result);
					animProps.push(prop);
					if (--remaining === 0) {
						// Preserve selection order
						animProps.sort((a, b) => pidsToAnimate.indexOf(a.id) - pidsToAnimate.indexOf(b.id));
						const allReady = () => {
							if (animProps.every(p => p.isComplete)) {
								openPropEditorFromProps(animProps);
							}
						};
						let loadRemaining = 0;
						for (const p of animProps) {
							if (!p.isComplete) {
								loadRemaining++;
								p.img.addEventListener('load', () => {
									if (--loadRemaining === 0) allReady();
								}, { once: true });
							}
						}
						if (loadRemaining === 0) allReady();
					}
				};
			}
			break;
		}
		case 3: { // Clone
			const pidsToClone = selectedBagProps.length > 0 ? selectedBagProps.slice() : [pid];
			const store = propBagDB.transaction('props', 'readonly').objectStore('props');
			const cloned: { srcPid: number; data: NewPropData }[] = [];
			let remaining = pidsToClone.length;
			for (const srcPid of pidsToClone) {
				const get = store.get(srcPid);
				get.onsuccess = () => {
					const result = get.result;
					if (result && result.prop) {
						let newId = 0;
						do {
							newId = Math.round(Math.random() * 2147483647);
							if (newId % 2) newId = -newId;
						} while (propBagSet.has(newId));
						cloned.push({ srcPid, data: {
							id: newId,
							name: result.name || 'Palace Prop',
							w: result.prop.w,
							h: result.prop.h,
							x: result.prop.x,
							y: result.prop.y,
							head: result.prop.head,
							ghost: result.prop.ghost,
							animated: result.prop.animated,
							bounce: result.prop.bounce,
							blob: result.prop.blob
						}});
					}
					if (--remaining === 0 && cloned.length > 0) {
						// Insert each clone after its source, processing in reverse bag order
						// so that sequential inserts don't shift indices
						cloned.sort((a, b) => propBagList.indexOf(b.srcPid) - propBagList.indexOf(a.srcPid));
						for (const entry of cloned) {
							addPropsToDB([entry.data], entry.srcPid);
						}
					}
				};
			}
			break;
		}
		case 5: { // Copy Image
			const store = propBagDB.transaction('props', 'readonly').objectStore('props');
			const get = store.get(pid);
			get.onsuccess = () => {
				const result = get.result;
				if (result && result.prop && result.prop.blob) {
					const blob = result.prop.blob;
					const img = new Image();
					img.onload = () => {
						const c = document.createElement('canvas');
						c.width = img.naturalWidth;
						c.height = img.naturalHeight;
						c.getContext('2d')!.drawImage(img, 0, 0);
						c.toBlob((pngBlob) => {
							if (pngBlob) {
								navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
							}
						}, 'image/png');
						URL.revokeObjectURL(img.src);
					};
					img.src = URL.createObjectURL(blob);
				}
			};
			break;
		}
		case 9: { // Delete
			const pids = selectedBagProps.length > 0 ? selectedBagProps.slice() : [pid];
			const activeCat = getActiveCategory();
			if (activeCat) {
				removePropsFromCategory(activeCat, pids);
				renderCategoryBar();
			} else {
				if (!await showConfirmDialog(`Delete ${pids.length} prop${pids.length > 1 ? 's' : ''} permanently?`)) return;
				deletePropsFromDB(pids);
			}
			setSelectedBagProps([]);
			refreshPropBagView(true);
			setPropButtons();
			enablePropButtons();
			break;
		}
		default: { // Add to Category
			if (menuIndex >= 100) {
				const catIdx = menuIndex - 100;
				if (catIdx >= 0 && catIdx < propBagCategories.length) {
					const pids = selectedBagProps.length > 0 ? selectedBagProps.slice() : [pid];
					addPropsToCategory(propBagCategories[catIdx].id, pids);
					renderCategoryBar();
				}
			}
			break;
		}
	}
}

function showCategoryCtxMenu(catId: string, x: number, y: number): void {
	dismissCtxMenu();
	const menu = document.createElement('div');
	menu.className = 'catCtxMenu';
	menu.style.left = `${x}px`;
	menu.style.top = `${y}px`;

	const renameBtn = document.createElement('button');
	renameBtn.className = 'catCtxItem';
	renameBtn.textContent = 'Rename';
	renameBtn.onclick = () => {
		dismissCtxMenu();
		startRenameCategory(catId);
	};

	const removePropsBtn = document.createElement('button');
	removePropsBtn.className = 'catCtxItem';
	removePropsBtn.textContent = 'Remove selected from category';
	removePropsBtn.onclick = () => {
		dismissCtxMenu();
		if (selectedBagProps.length > 0) {
			removePropsFromCategory(catId, selectedBagProps);
			renderCategoryBar();
		}
	};

	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'catCtxItem danger';
	deleteBtn.textContent = 'Delete category';
	deleteBtn.onclick = () => {
		dismissCtxMenu();
		deleteCategory(catId);
		renderCategoryBar();
	};

	menu.appendChild(renameBtn);
	if (activeCategoryId === catId && selectedBagProps.length > 0) {
		menu.appendChild(removePropsBtn);
	}
	menu.appendChild(deleteBtn);

	document.body.appendChild(menu);
	activeCtxMenu = menu;

	// Clamp to viewport
	const rect = menu.getBoundingClientRect();
	if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
	if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

	const closeOnClick = (e: MouseEvent) => {
		if (!menu.contains(e.target as Node)) {
			dismissCtxMenu();
			document.removeEventListener('mousedown', closeOnClick, true);
		}
	};
	setTimeout(() => document.addEventListener('mousedown', closeOnClick, true), 0);
}

function startRenameCategory(catId: string): void {
	const cat = propBagCategories.find((c) => c.id === catId);
	if (!cat) return;
	showPromptDialog('Rename category:', cat.name).then((newName: string | null) => {
		if (newName && newName.trim() && newName.trim() !== cat.name) {
			renameCategory(catId, newName.trim());
		}
		renderCategoryBar();
	});
}

export function renderCategoryBar(): void {
	categoryBar.textContent = '';

	// Category dropdown button
	const activeCat = activeCategoryId ? propBagCategories.find(c => c.id === activeCategoryId) : null;
	const label = activeCat ? activeCat.name : 'All';
	const count = activeCat
		? activeCat.props.filter((pid) => propBagSet.has(pid)).length
		: propBagList.length;

	const dropBtn = document.createElement('button');
	dropBtn.className = 'catDropdownBtn';
	dropBtn.innerHTML = `<span class="catDropdownLabel">${label}</span><span class="catCount">${count}</span><span class="catDropdownArrow">▾</span>`;
	dropBtn.title = 'Select category';

	// Allow dropping props onto the dropdown button to open the menu
	dropBtn.ondragover = (e) => { if (dragBagProp) { e.preventDefault(); dropBtn.classList.add('dragOver'); } };
	dropBtn.ondragleave = () => dropBtn.classList.remove('dragOver');
	dropBtn.ondrop = (e) => {
		e.preventDefault();
		e.stopPropagation();
		dropBtn.classList.remove('dragOver');
	};

	dropBtn.onclick = () => showCategoryDropdown(dropBtn);

	// Right-click: category actions if a category is active
	dropBtn.oncontextmenu = (e) => {
		e.preventDefault();
		if (activeCategoryId) {
			showCategoryCtxMenu(activeCategoryId, e.clientX, e.clientY);
		}
	};

	categoryBar.appendChild(dropBtn);

	// "+" button
	const addBtn = document.createElement('button');
	addBtn.className = 'catTabAdd';
	addBtn.textContent = '+';
	addBtn.title = 'New category';
	addBtn.onclick = () => promptNewCategory();
	categoryBar.appendChild(addBtn);

	appendTileSizeWidget();
}

function showCategoryDropdown(anchor: HTMLElement): void {
	// Close any existing dropdown
	const existing = document.querySelector('.catDropdownMenu');
	if (existing) { existing.remove(); return; }

	const menu = document.createElement('div');
	menu.className = 'catDropdownMenu';

	// "All" option
	const allItem = document.createElement('div');
	allItem.className = 'catDropdownItem' + (activeCategoryId === null ? ' active' : '');
	allItem.innerHTML = `<span>All</span><span class="catCount">${propBagList.length}</span>`;
	allItem.onclick = () => {
		setActiveCategory(null);
		menu.remove();
		renderCategoryBar();
	};
	allItem.ondragover = (e) => { if (dragBagProp) { e.preventDefault(); allItem.classList.add('dragOver'); } };
	allItem.ondragleave = () => allItem.classList.remove('dragOver');
	allItem.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); allItem.classList.remove('dragOver'); };
	menu.appendChild(allItem);

	// Separator
	const sep = document.createElement('div');
	sep.className = 'catDropdownSep';
	menu.appendChild(sep);

	// Category items (draggable for reorder)
	let dragFromIdx = -1;

	propBagCategories.forEach((cat, idx) => {
		const item = document.createElement('div');
		item.className = 'catDropdownItem' + (activeCategoryId === cat.id ? ' active' : '');
		item.dataset.catid = cat.id;
		item.draggable = true;

		const validCount = cat.props.filter((pid) => propBagSet.has(pid)).length;
		item.innerHTML = `<span>${cat.name}</span><span class="catCount">${validCount}</span>`;

		item.onclick = () => {
			setActiveCategory(activeCategoryId === cat.id ? null : cat.id);
			menu.remove();
			renderCategoryBar();
		};

		// Right-click for rename/delete
		item.oncontextmenu = (e) => {
			e.preventDefault();
			menu.remove();
			showCategoryCtxMenu(cat.id, e.clientX, e.clientY);
		};

		// Drag to reorder
		item.ondragstart = (e) => {
			if (dragBagProp) return;
			dragFromIdx = idx;
			e.dataTransfer!.effectAllowed = 'move';
			e.dataTransfer!.setData('text/x-catreorder', cat.id);
			item.style.opacity = '0.5';
		};
		item.ondragend = () => { item.style.opacity = ''; dragFromIdx = -1; };

		// Drop: reorder or assign props
		item.ondragover = (e) => { e.preventDefault(); item.classList.add('dragOver'); };
		item.ondragleave = () => item.classList.remove('dragOver');
		item.ondrop = (e) => {
			e.preventDefault();
			e.stopPropagation();
			item.classList.remove('dragOver');

			if (dragBagProp) {
				const pids = selectedBagProps.indexOf(dragBagProp.id) > -1
					? selectedBagProps.slice()
					: [dragBagProp.id];
				addPropsToCategory(cat.id, pids);
				menu.remove();
				renderCategoryBar();
				return;
			}

			if (dragFromIdx > -1 && e.dataTransfer!.types.indexOf('text/x-catreorder') > -1) {
				reorderCategories(dragFromIdx, idx);
				menu.remove();
				renderCategoryBar();
			}
		};

		menu.appendChild(item);
	});

	// Position the menu below the anchor
	const rect = anchor.getBoundingClientRect();
	menu.style.position = 'fixed';
	menu.style.left = `${rect.left}px`;
	menu.style.top = `${rect.bottom}px`;
	menu.style.minWidth = `${rect.width}px`;

	document.body.appendChild(menu);

	// Clamp to viewport
	requestAnimationFrame(() => {
		const mr = menu.getBoundingClientRect();
		if (mr.right > window.innerWidth) menu.style.left = `${window.innerWidth - mr.width - 4}px`;
		if (mr.bottom > window.innerHeight) menu.style.top = `${rect.top - mr.height}px`;
	});

	// Close on outside click
	const closeDropdown = (e: MouseEvent) => {
		if (!menu.contains(e.target as Node) && e.target !== anchor) {
			menu.remove();
			document.removeEventListener('mousedown', closeDropdown, true);
		}
	};
	setTimeout(() => document.addEventListener('mousedown', closeDropdown, true), 0);
}

let tileSizeIcon: HTMLButtonElement | null = null;
let tileSizeTrack: HTMLDivElement | null = null;

function appendTileSizeWidget(): void {
	// Reuse existing elements if already created
	if (tileSizeIcon && tileSizeTrack) {
		categoryBar.appendChild(tileSizeIcon);
		if (!propBag.contains(tileSizeTrack)) propBag.appendChild(tileSizeTrack);
		const slider = tileSizeTrack.querySelector('input[type=range]') as HTMLInputElement;
		if (slider) slider.value = String(prefs.general.propBagTileSize ?? 91);
		return;
	}

	const sizeIcon = document.createElement('button');
	sizeIcon.className = 'catTileSizeIcon';
	sizeIcon.textContent = '\u2921';
	sizeIcon.title = 'Tile size';

	const track = document.createElement('div');
	track.className = 'catTileSizeTrack';
	const slider = document.createElement('input');
	slider.type = 'range';
	slider.min = '68';
	slider.max = '224';
	slider.value = String(prefs.general.propBagTileSize ?? 91);
	track.appendChild(slider);

	track.addEventListener('mousedown', (e) => e.stopPropagation());

	sizeIcon.onclick = () => {
		const open = track.classList.toggle('open');
		sizeIcon.classList.toggle('active', open);
	};

	slider.addEventListener('input', () => {
		setGeneralPref('propBagTileSize', Number(slider.value));
		refreshPropBagView(true);
	});

	categoryBar.appendChild(sizeIcon);
	propBag.appendChild(track);
	tileSizeIcon = sizeIcon;
	tileSizeTrack = track;
}

function promptNewCategory(): void {
	const input = document.createElement('input');
	input.type = 'text';
	input.placeholder = 'Category name';
	input.className = 'cat-inline-input';
	input.style.cssText = 'margin:2px 4px;';

	const commit = () => {
		const name = input.value.trim();
		if (name) {
			createCategory(name);
		}
		renderCategoryBar();
	};

	input.onblur = commit;
	input.onkeydown = (e) => {
		if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
		if (e.key === 'Escape') { input.value = ''; input.blur(); }
	};

	// Replace the "+" button with the input
	const addBtn = categoryBar.querySelector('.catTabAdd');
	if (addBtn) addBtn.replaceWith(input);
	input.focus();
}

export function refreshPropBagView(refresh?: boolean): void {
	const bagWidth = propBag.clientWidth;
	const tileSize = prefs.general.propBagTileSize as number;

	if (Number((propBag as HTMLElement).dataset.tileSize) !== tileSize) {
		(propBag as HTMLElement).style.setProperty('--tile-size', `${tileSize}px`);
		(propBag as HTMLElement).dataset.tileSize = String(tileSize);
	}

	let visibleColumns = (bagWidth / tileSize).fastRound();
	if (visibleColumns < 1) visibleColumns = 1;
	const visibleRows = ((window.innerHeight - palace.containerOffsetTop) / tileSize).fastRound();
	const displayList = getVisiblePropList();
	const max = displayList.length;
	const catBarHeight = categoryBar.offsetHeight || 0;
	let scroll = ((propBag.scrollTop - catBarHeight) / tileSize).fastRound() - 2;
	if (scroll < 0) scroll = 0;

	const cheight = (Math.ceil(max / visibleColumns) * tileSize + catBarHeight).fastRound();
	if (Number(propBagRetainer.dataset.height) !== cheight) {
		propBagRetainer.style.height = `${cheight}px`;
		propBagRetainer.dataset.height = String(cheight);
	}

	const visibleSet = new Map<number, { x: number; y: number }>();
	const endRow = visibleRows + scroll + 4;
	for (let y = scroll; y < endRow; y++) {
		const rowBase = y * visibleColumns;
		for (let x = 0; x < visibleColumns; x++) {
			const propIndex = rowBase + x;
			if (propIndex < max) visibleSet.set(displayList[propIndex], { x: x * tileSize, y: y * tileSize + catBarHeight });
		}
	}

	for (const id in getTransactions) {
		if (!visibleSet.has(Number(id))) {
			const trans = getTransactions[id];
			if (trans) {
				trans.trans.abort();
				delete getTransactions[id];
			}
		}
	}

	const selectedSet = new Set(selectedBagProps);

	for (const [pid, tile] of tileMap) {
		const pos = visibleSet.get(pid);
		if (!pos || refresh) {
			if (!pos) {
				const img = tile.firstChild as HTMLImageElement;
				if (img && img.src) {
					URL.revokeObjectURL(img.src);
					img.src = '';
				}
				tile.remove();
				tileMap.delete(pid);
			}
		}
	}

	for (const [pid, pos] of visibleSet) {
		let tile = tileMap.get(pid);
		if (!tile) {
			tile = document.createElement('div');
			tile.dataset.pid = String(pid);
			const img = document.createElement('img');
			img.className = 'bagprop';
			const trans = getTransactions[pid];
			if (trans) {
				trans.img = img;
			} else {
				getBagProp(pid, img);
			}
			tile.appendChild(img);
			tileMap.set(pid, tile);
			propBag.appendChild(tile);
		}

		if (Number(tile.dataset.left) !== pos.x || Number(tile.dataset.top) !== pos.y) {
			tile.style.transform = `translate(${pos.x}px,${pos.y}px)`;
			tile.dataset.left = String(pos.x);
			tile.dataset.top = String(pos.y);
		}

		tile.className = selectedSet.has(pid) ? 'selectedbagprop' : '';
	}
}

{ // setup propBag
	const getParent = (target: EventTarget | null): HTMLDivElement | undefined => {
		if (target instanceof HTMLImageElement) return target.parentNode as HTMLDivElement;
		if (target instanceof HTMLDivElement) return target;
	};

	propBag.onscroll = () => {
		refreshPropBagView();
	};

	let lastDragOver: HTMLElement | null;
	let draggedPids: number[] = [];

	propBag.ondragover = (event: DragEvent) => {
		event.preventDefault();
		event.stopImmediatePropagation();
		if (dragBagProp) {
			if (lastDragOver) {
				lastDragOver.classList.remove('drag-insert-left', 'drag-insert-right');
			}
			const target = getParent(event.target);
			if (target) {
				const pid = Number(target.dataset.pid);
				if (draggedPids.indexOf(pid) === -1) {
					const list = getVisiblePropList();
					const fromIndex = list.indexOf(dragBagProp.id);
					const toIndex = list.indexOf(pid);
					if (fromIndex > toIndex) {
						target.classList.add('drag-insert-left');
					} else {
						target.classList.add('drag-insert-right');
					}
					lastDragOver = target;
				}
			}
			event.dataTransfer!.effectAllowed = 'move';
		} else {
			propBag.classList.add('drag-target-glow');
		}
	};

	propBag.addEventListener("drop", (event: DragEvent) => {
		if (!dragBagProp) {
			propBag.classList.remove('drag-target-glow');
			const dt = event.dataTransfer;
			if (dt?.items) {
				for (let i = 0; i < dt.items.length; i++) {
					const item = dt.items[i];
					if (item.kind === "file") {
						createNewProps([item.getAsFile()!]);
						return;
					} else if (item.kind === 'string' && item.type === 'text/uri-list') {
						item.getAsString((str) => {
							httpGetAsync(str, 'blob', (blob: unknown) => {
								const b = blob as Blob;
								if (b.type.match(/^image|video/)) {
									createNewProps([b]);
								}
							});
						});
						return;
					}
				}
			} else if (dt?.files && dt.files.length > 0) {
				createNewProps(Array.from(dt.files));
			}
		} else {
			const target = getParent(event.target);
			if (target) {
				const pid = Number(target.dataset.pid);
				const list = getVisiblePropList();
				const fromIndex = list.indexOf(dragBagProp.id);
				const toIndex = list.indexOf(pid);
				if (toIndex > -1 && draggedPids.indexOf(pid) === -1) {
					// Determine which backing array to reorder
					const activeCat = activeCategoryId
						? propBagCategories.find((c) => c.id === activeCategoryId)
						: null;
					const reorderList = activeCat ? activeCat.props : propBagList;

					// Remove all dragged pids from their current positions
					const movedPids = draggedPids.filter((id) => reorderList.indexOf(id) > -1);
					for (const id of movedPids) {
						const idx = reorderList.indexOf(id);
						if (idx > -1) reorderList.splice(idx, 1);
					}
					// Find new insertion point after removal
					const insertAt = reorderList.indexOf(pid);
					if (insertAt > -1) {
						// When dragging down, insert after the target to match the visual indicator
						const pos = (fromIndex < toIndex) ? insertAt + 1 : insertAt;
						reorderList.splice(pos, 0, ...movedPids);
					}
					if (activeCat) {
						saveCategories();
					} else {
						updatePropBagList();
					}
					refreshPropBagView(true);
				}
			}
			draggedPids = [];
		}
	}, true);

	propBag.ondragleave = () => {
		propBag.classList.remove('drag-target-glow');
		if (lastDragOver) {
			lastDragOver.classList.remove('drag-insert-left', 'drag-insert-right');
			lastDragOver = null;
		}
	};

	propBag.ondragend = () => {
		dragBagProp = null;
		draggedPids = [];
		if (lastDragOver) {
			lastDragOver.style.borderRight = '';
			lastDragOver.style.borderLeft = '';
			lastDragOver = null;
		}
	};

	propBag.ondragstart = (event: DragEvent) => {
		const target = event.target as HTMLElement;
		const targetRect = target.getBoundingClientRect();
		const parentEl = target.parentNode as HTMLElement;
		const pid = Number(parentEl.dataset.pid);

		dragBagProp = {
			id: pid,
			x: event.clientX - targetRect.left,
			y: event.clientY - targetRect.top,
			w: target.offsetWidth,
			h: target.offsetHeight
		};

		// If the dragged prop is in the selection, drag all selected props
		if (selectedBagProps.indexOf(pid) > -1) {
			draggedPids = selectedBagProps.slice();
		} else {
			draggedPids = [pid];
		}

		// Show drag count badge
		if (draggedPids.length > 1 && event.dataTransfer) {
			event.dataTransfer.setData('text/plain', `${draggedPids.length} props`);
		}
	};

	const propBagHandle = document.createElement('div');
	propBagHandle.className = 'sidepanel-handle';
	propBag.prepend(propBagHandle);

	propBag.addEventListener('contextmenu', (event: MouseEvent) => {
		event.preventDefault();
		const target = getParent(event.target);
		if (target && target.dataset.pid) {
			const pid = Number(target.dataset.pid);
			// If right-clicked prop is not in selection, select it
			if (selectedBagProps.indexOf(pid) === -1) {
				selectedBagProps = [pid];
				refreshPropBagView(true);
				setPropButtons();
			}
			showPropCtxMenu(pid);
		}
	});

	(propBag as any).onmousedown = function(this: HTMLElement & { clickTime?: number; clickX?: number; clickY?: number }, event: MouseEvent) {
		if (event.button !== 0) return;
		const newTarget = getParent(event.target);

		const d = new Date();
		const t = d.getTime();
		if (newTarget && newTarget.dataset && newTarget.dataset.pid && this.clickTime && this.clickTime + 400 >= t && this.clickX === event.clientX && this.clickY === event.clientY) {
			wearSelectedProps();
			this.clickTime = undefined;
			return;
		}
		this.clickX = event.clientX;
		this.clickY = event.clientY;
		this.clickTime = t;

		if (event.target instanceof HTMLImageElement === false) {
			event.preventDefault();
		}
		if (!newTarget || !newTarget.dataset.pid) {
			if (event.target instanceof HTMLElement && event.target.closest('.sidepanel-handle, #propcategories')) return;
			if (selectedBagProps.length > 0) {
				selectedBagProps = [];
				refreshPropBagView(true);
				setPropButtons();
			}
			return;
		}
		if (newTarget && (newTarget.className === '' || event.shiftKey || platformCtrlKey(event))) {
			const newPid = Number(newTarget.dataset.pid);
			if (newPid != null) {
				let lastPid: number | undefined;
				if (!platformCtrlKey(event)) {
					if (event.shiftKey) lastPid = selectedBagProps[0];
					selectedBagProps = [];
				}

				if (platformCtrlKey(event)) {
					const already = selectedBagProps.indexOf(newPid);
					if (already > -1) {
						selectedBagProps.splice(already, 1);
					} else {
						selectedBagProps.push(newPid);
					}
				} else if (!lastPid) {
					selectedBagProps = [newPid];
				} else {
					const displayList = getVisiblePropList();
					const lastIdx = displayList.indexOf(lastPid);
					const newIdx = displayList.indexOf(newPid);
					const max = Math.max(newIdx, lastIdx);
					const min = Math.min(newIdx, lastIdx);
					selectedBagProps = displayList.slice(min, max + 1);
					if (newIdx < lastIdx) {
						selectedBagProps.reverse();
					}
				}
				refreshPropBagView(true);
				setPropButtons();
			}
		}
	};

	propBagHandle.onmousedown = (event: MouseEvent) => {
		event.preventDefault();
		const initialX = event.pageX - window.scrollX;
		const initialW = propBag.offsetWidth;
		const dragOverlay = document.createElement('div');
		dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
		document.body.appendChild(dragOverlay);

		const mouseMovePropBag = (event: MouseEvent) => {
			event.stopImmediatePropagation();
			const w = initialX - event.x + initialW;
			propBag.style.width = `${w}px`;
			setGeneralPref('propBagWidth', w);
			refreshPropBagView();
		};
		const mouseUpPropBag = (event: MouseEvent) => {
			event.stopImmediatePropagation();
			dragOverlay.remove();
			window.removeEventListener('mouseup', mouseUpPropBag, true);
			window.removeEventListener('mousemove', mouseMovePropBag, true);
		};

		window.addEventListener('mouseup', mouseUpPropBag, true);
		window.addEventListener('mousemove', mouseMovePropBag, true);
	};
}


interface PropInfo {
	name: string;
	offsets?: { x: string | number; y: string | number };
	size?: { w: string | number; h: string | number };
	flags?: string | number;
	prop?: {
		x: number;
		y: number;
		w: number;
		h: number;
		head: boolean;
		ghost: boolean;
		animated: boolean;
		bounce: boolean;
		blob: Blob;
	};
}

export class PalaceProp {
	id: number;
	rcounter?: number;
	/** Long-timeout fallback when waiting for PRPD prop-done blowthru (palaceserver-go + GVER). */
	coordFallbackTimer?: ReturnType<typeof setTimeout>;
	/** After timeout, use legacy asset query + short retries. */
	propCoordLegacyFallback?: boolean;
	img!: HTMLImageElement;
	blob!: Blob;
	name!: string;
	x!: number;
	y!: number;
	w!: number;
	h!: number;
	head!: boolean;
	ghost!: boolean;
	animated!: boolean;
	bounce!: boolean;
	src!: string;

	constructor(id: number, info?: PropInfo) {
		this.id = id;
		if (info) {
			this.setInfo(info);
		} else {
			this.rcounter = 0;
		}
		nbrProps++;
		if (nbrProps > palace.theRoom.nbrRoomProps + 66) {
			for (const k in cacheProps) {
				if (!palace.theRoom.propInUse(Number(k))) {
					URL.revokeObjectURL(cacheProps[k].src);
					delete cacheProps[k];
					nbrProps--;
				}
			}
		}
	}

	get isComplete(): boolean {
		return (this.img && this.img.complete && this.img.naturalWidth > 0);
	}

	showProp(): void {
		for (let i = 0; i < palace.theRoom.users.length; i++) {
			const user = palace.theRoom.users[i];
			if (user.props.indexOf(this.id) > -1) {
				user.setDomProps(this.id);
			}
		}
		if (palace.theRoom.looseProps.find((lp: any) => lp.id === this.id)) {
			palace.theRoom.reDrawProps();
		}
	}

	requestPropImage(url: string): void {
		this.img = document.createElement('img');
		this.img.onload = () => {
			this.showProp();
		};
		httpGetAsync(url, 'blob', (blob: unknown) => {
			this.img.src = URL.createObjectURL(blob as Blob);
			this.blob = blob as Blob;
		});
	}

	loadBlob(blob: Blob): void {
		this.blob = blob;
		this.img = document.createElement('img');
		this.img.onload = () => {
			this.showProp();
		};
		this.img.src = URL.createObjectURL(blob);
	}

	setInfo(info: PropInfo): void {
		this.name = info.name;
		if (info.offsets) {
			this.x = Number(info.offsets.x);
			this.y = Number(info.offsets.y);
			this.w = Number(info.size!.w);
			this.h = Number(info.size!.h);
			this.decodePropFlags(info.flags!);
		} else {
			this.x = info.prop!.x;
			this.y = info.prop!.y;
			this.w = info.prop!.w;
			this.h = info.prop!.h;
			this.head = info.prop!.head;
			this.ghost = info.prop!.ghost;
			this.animated = info.prop!.animated;
			this.bounce = info.prop!.bounce;
			this.loadBlob(info.prop!.blob);
		}
	}

	decodePropFlags(flags: string | number): void {
		if (typeof flags === 'string') {
			flags = parseInt(flags, 16).swap16();
		}
		this.head = Boolean(flags & PROP_HEAD);
		this.ghost = Boolean(flags & PROP_GHOST);
		this.animated = Boolean(flags & PROP_ANIMATED);
		this.bounce = Boolean(flags & PROP_BOUNCE);
	}

	get encodePropFlags(): string {
		let flag = PROP_PNG;
		if (this.head) flag ^= PROP_HEAD;
		if (this.ghost) flag ^= PROP_GHOST;
		if (this.animated) flag ^= PROP_ANIMATED;
		if (this.bounce) flag ^= PROP_BOUNCE;
		return flag.swap16().toHex();
	}
}


export function uploadPropInfo(aProp: PalaceProp): void {
	httpPostAsync(`${palace.mediaUrl}webservice/props/new/`, 'json',
		JSON.stringify({
			props: [
				{
					format: aProp.blob.type.split('/')[1],
					name: aProp.name,
					size: { w: aProp.w, h: aProp.h },
					offsets: { x: aProp.x, y: aProp.y },
					flags: aProp.encodePropFlags,
					id: aProp.id,
					crc: 0
				}
			]
		}),
		(json: unknown) => {
			const data = json as { props: { id: number; restricted?: boolean }[] | null; upload_url: string } | null;
			if (data) {
				if (!data.props) {
					logmsg('Prop upload failed (server error: no props in response): ' + JSON.stringify(data));
					return;
				}
				for (let i = 0; i < data.props.length; i++) {
					const prop = data.props[i];
					if (prop.restricted !== true) {
						uploadProp(data.upload_url, prop.id);
					}
				}
			}
		},
		(status: number) => {
			logmsg(`Prop upload request failed (HTTP ERROR): ${status}`);
		}
	);
}


export function uploadProp(url: string, pid: number): void {
	const aProp = cacheProps[pid];
	if (aProp.blob && aProp.blob.size > 0) {
		const formData = new FormData();
		formData.append('id', String(pid));
		formData.append('prop', aProp.blob);

		// Use responseType "text" + JSON.parse: with "json", some runtimes hand the callback `null`
		// on 200 + valid JSON so prop-done blowthru was never sent even after props/upload: saved.
		httpPostAsync(url, 'text', formData,
			(raw: unknown) => {
				let data: { success?: boolean; errormsg?: string } | null = null;
				if (typeof raw === 'string' && raw.length > 0) {
					try {
						data = JSON.parse(raw) as { success?: boolean; errormsg?: string };
					} catch {
						data = null;
					}
				}
				if (data) {
					if (data.success === true) {
						if (typeof palace?.sendPropCoordBlowThru === 'function' && palace.supportsPalaceAppPropCoord?.()) {
							palace.sendPropCoordBlowThru(pid);
						}
					} else {
						logmsg(`Prop upload failed (server error), prop id: ${pid}`);
						if (data.errormsg) logmsg(data.errormsg);
					}
				} else {
					logmsg(`Prop upload failed (unexpected server response)`);
				}
			},
			(status: number) => {
				logmsg(`Prop upload failed (HTTP ERROR): ${status}`);
			}
		);
	}
}

/** Room blowthru from palaceserver-go: roommate finished uploading prop to media server — fetch once. */
export function handlePropCoordBlowThru(propId: number, fromUserId: number): void {
	if (typeof palace?.supportsPalaceAppPropCoord !== 'function' || !palace.supportsPalaceAppPropCoord()) {
		return;
	}
	if (fromUserId === palace.theUserID) {
		return;
	}
	const pid = propId | 0;
	const aProp = cacheProps[pid];
	if (!aProp) {
		return;
	}
	if (aProp.coordFallbackTimer !== undefined) {
		clearTimeout(aProp.coordFallbackTimer);
		delete aProp.coordFallbackTimer;
	}
	delete aProp.propCoordLegacyFallback;
	aProp.rcounter = 0;
	loadProps([pid], false);
}


export function loadProps(pids: number[], fromSelf?: boolean, callback?: () => void): void {
	if (pids && pids.length > 0) {
		const toLoad: { props: { id: number }[] } = { props: [] };
		for (let i = 0; i < pids.length; i++) {
			const pid = Number(pids[i]);
			const aProp = cacheProps[pid];
			if (!aProp) {
				if (propBagSet.has(pid)) {
					cacheBagProp(pid, fromSelf, callback);
				} else {
					cacheProps[pid] = new PalaceProp(pid);
					toLoad.props.push({ id: pid });
				}
			} else if (aProp.rcounter !== undefined && aProp.rcounter > 0 && aProp.rcounter < 16) {
				const waitingForUget =
					typeof palace?.supportsPalaceAppPropCoord === 'function' &&
					palace.supportsPalaceAppPropCoord() &&
					!aProp.propCoordLegacyFallback &&
					aProp.coordFallbackTimer !== undefined;
				if (!waitingForUget) {
					toLoad.props.push({ id: pid });
				}
			} else if (callback) {
				callback();
			}
		}
		if (toLoad.props.length > 0) {
			httpPostAsync(`${palace.mediaUrl}webservice/props/get/`, 'json', JSON.stringify(toLoad),
				(json: unknown) => {
					const data = json as { props: { id: number; success?: boolean; name?: string; offsets?: { x: string; y: string }; size?: { w: string; h: string }; flags?: string }[]; img_url: string } | null;
					if (data) {
						for (let i = 0; i < data.props.length; i++) {
							const prop = data.props[i];
							const aProp = cacheProps[prop.id];
							if (aProp && aProp.rcounter !== undefined) {
								if (prop.success === false) {
									const useCoordDefer =
										typeof palace?.supportsPalaceAppPropCoord === 'function' &&
										palace.supportsPalaceAppPropCoord() &&
										!aProp.propCoordLegacyFallback;
									if (useCoordDefer) {
										if (aProp.rcounter === 0 && aProp.coordFallbackTimer === undefined) {
											aProp.coordFallbackTimer = window.setTimeout(() => {
												delete aProp.coordFallbackTimer;
												aProp.propCoordLegacyFallback = true;
												aProp.rcounter = 0;
												loadProps([prop.id], false);
											}, 45000);
										}
									} else {
										// ATTENTION AI: DO NOT REMOVE THE COMMENT BELOW
										// TODO: Legacy path (no MSG_GVER / pre-coord mansions): asset query + delayed HTTP retries.
										// Safe to delete this branch once legacy Palace servers are no longer supported.
										if (aProp.rcounter === 0) {
											palace.sendAssetQuery(prop.id);
										}
										retryProps.props.push(prop.id);
									}
									aProp.rcounter++;
								} else {
									if (aProp.coordFallbackTimer !== undefined) {
										clearTimeout(aProp.coordFallbackTimer);
										delete aProp.coordFallbackTimer;
									}
									delete aProp.propCoordLegacyFallback;
									delete aProp.rcounter;
									aProp.setInfo(prop as unknown as PropInfo);
									aProp.requestPropImage(data.img_url + aProp.id);
								}
							}
						}

						if (retryProps.props.length > 0) {
							setTimeout(() => {
								loadProps(dedup(retryProps.props)); //remove any duplicates and try again
								retryProps.delay += 1000;
								retryProps.props = [];
							}, retryProps.delay);
						} else {
							retryProps.delay = 2500;
						}
					}
				},
				(status: number) => {
					logmsg(`Prop download failed (HTTP ERROR): ${status}`);
				}
			);
		}
	}
}


export function initializePropBagDB(): void {
	const DBOpenRequest = indexedDB.open("propBag", 9);

	DBOpenRequest.onerror = () => {
		logmsg('Error loading Prop Bag.');
	};

	DBOpenRequest.onsuccess = () => {
		propBagDB = DBOpenRequest.result;

		const tx = propBagDB.transaction("props");
		const store = tx.objectStore("props");
		const get = store.get('propList');
		get.onsuccess = () => {
			if (get.result) {
				propBagList = get.result.list;
				propBagSet.clear();
				for (const pid of propBagList) propBagSet.add(pid);
				if (propBag.dataset.state === '1') {
					refreshPropBagView();
				}
			}
		};
		const getCat = store.get('categories');
		getCat.onsuccess = () => {
			if (getCat.result) {
				propBagCategories = getCat.result.list;
				renderCategoryBar();
			}
		};
	};

	DBOpenRequest.onupgradeneeded = (event) => {
		propBagDB = DBOpenRequest.result;

		if ((event.oldVersion as number) < 4) {
			const store = propBagDB.createObjectStore("props", { keyPath: "id" });
			store.createIndex("name", "name", { unique: false });
			store.put({ id: 'propList', list: propBagList });
		}

		if ((event.oldVersion as number) < 8) {
			const tx = DBOpenRequest.transaction!;
			const store = tx.objectStore("props");

			const request = store.get('propList');
			request.onsuccess = () => {
				const pids: number[] = request.result.list;
				const doNext = () => {
					const pid = pids.shift();
					if (pid) {
						const get = store.get(pid);
						get.onerror = () => {
							console.log(get.error);
							tx.abort();
						};
						get.onsuccess = () => {
							const item = get.result;
							item.prop.blob = dataURItoBlob(item.prop.img);
							delete item.prop.img;
							const put = store.put(item);
							put.onerror = () => {
								console.log(put.error);
								tx.abort();
							};
							doNext();
						};
					}
				};
				doNext();
			};
			request.onerror = () => {
				console.log(request.error);
			};
			tx.oncomplete = () => {
				if (palace?.debugMode) console.log('Success converting your prop bag');
			};
		}
		if ((event.oldVersion as number) < 9) {
			const tx = DBOpenRequest.transaction!;
			const store = tx.objectStore("props");
			store.put({ id: 'categories', list: [] as PropBagCategory[] });
		}
	};
}
initializePropBagDB();

function saveCategories(): void {
	const store = propBagDB.transaction("props", "readwrite").objectStore("props");
	store.put({ id: 'categories', list: propBagCategories });
}

export function createCategory(name: string): PropBagCategory {
	const cat: PropBagCategory = {
		id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		name,
		props: [],
	};
	propBagCategories.push(cat);
	saveCategories();
	return cat;
}

export function renameCategory(catId: string, name: string): void {
	const cat = propBagCategories.find((c) => c.id === catId);
	if (cat) {
		cat.name = name;
		saveCategories();
	}
}

export function deleteCategory(catId: string): void {
	const idx = propBagCategories.findIndex((c) => c.id === catId);
	if (idx > -1) {
		propBagCategories.splice(idx, 1);
		if (activeCategoryId === catId) activeCategoryId = null;
		saveCategories();
		renderCategoryBar();
		refreshPropBagView(true);
	}
}

export function addPropsToCategory(catId: string, pids: number[]): void {
	const cat = propBagCategories.find((c) => c.id === catId);
	if (cat) {
		for (const pid of pids) {
			if (cat.props.indexOf(pid) === -1) cat.props.push(pid);
		}
		saveCategories();
	}
}

export function removePropsFromCategory(catId: string, pids: number[]): void {
	const cat = propBagCategories.find((c) => c.id === catId);
	if (cat) {
		const removeSet = new Set(pids);
		cat.props = cat.props.filter((p) => !removeSet.has(p));
		saveCategories();
		if (activeCategoryId === catId) refreshPropBagView(true);
	}
}

export function setActiveCategory(catId: string | null): void {
	activeCategoryId = catId;
	propBag.scrollTop = 0;
	renderCategoryBar();
	refreshPropBagView(true);
}

export function getActiveCategory(): string | null {
	return activeCategoryId;
}

export function reorderCategories(fromIdx: number, toIdx: number): void {
	if (fromIdx === toIdx) return;
	const [cat] = propBagCategories.splice(fromIdx, 1);
	propBagCategories.splice(toIdx, 0, cat);
	saveCategories();
}

export function dataURItoBlob(dataURI: string): Blob {
	const arr = dataURI.split(',');
	const mime = arr[0].match(/:(.*?);/)![1];
	const ary = Uint8Array.from(atob(arr[1]), (c) => c.charCodeAt(0));
	return new Blob([ary], { type: mime });
}

export function deletePropsFromDB(propIds: number[]): void {
	const tx = propBagDB.transaction("props", "readwrite");
	const store = tx.objectStore("props");
	const removeSet = new Set(propIds);
	propIds.forEach((pid) => {
		const index = propBagList.indexOf(pid);
		if (index > -1) {
			propBagList.splice(index, 1);
			propBagSet.delete(pid);
		}
		store.delete(pid);
	});
	store.put({ id: 'propList', list: propBagList });
	// Clean deleted props from categories
	let catChanged = false;
	for (const cat of propBagCategories) {
		const before = cat.props.length;
		cat.props = cat.props.filter((p) => !removeSet.has(p));
		if (cat.props.length !== before) catChanged = true;
	}
	if (catChanged) {
		store.put({ id: 'categories', list: propBagCategories });
	}
}

export function updatePropBagList(): void {
	const store = propBagDB.transaction("props", "readwrite").objectStore("props");
	store.put({ id: 'propList', list: propBagList });
}

export function addPropsToDB(props: NewPropData[], insertAfter?: number): IDBObjectStore {
	const tx = propBagDB.transaction("props", "readwrite");
	const store = tx.objectStore("props");

	tx.onerror = () => {
		console.log(`Error adding prop to DB: ${tx.error}`);
	};
	tx.oncomplete = () => {
		refreshPropBagView();
	};

	props.forEach((prop) => {
		if (!propBagSet.has(prop.id) && prop.blob && prop.blob.size > 0) {
			store.add({
				id: prop.id,
				name: prop.name,
				prop: {
					x: prop.x,
					y: prop.y,
					w: prop.w,
					h: prop.h,
					head: prop.head,
					ghost: prop.ghost,
					animated: prop.animated,
					bounce: prop.bounce,
					blob: prop.blob
				}
			});
			if (insertAfter != null) {
				const idx = propBagList.indexOf(insertAfter);
				if (idx > -1) {
					propBagList.splice(idx + 1, 0, prop.id);
					insertAfter = prop.id;
				} else {
					propBagList.unshift(prop.id);
				}
			} else {
				propBagList.unshift(prop.id);
			}
			propBagSet.add(prop.id);
		}
	});

	store.put({ id: 'propList', list: propBagList });
	return store;
}


export function saveProp(pids: number[], _flush?: boolean): void {
	const props: PalaceProp[] = [];
	pids.forEach((p) => {
		const prop = cacheProps[p];
		if (prop) {
			props.push(prop);
		}
	});
	addPropsToDB(props);
}

export let getTransactions: Record<string, { trans: IDBTransaction; img: HTMLImageElement }> = {};

export function getBagProp(id: number, img: HTMLImageElement): void {
	const transaction = propBagDB.transaction("props", "readonly");
	getTransactions[id] = { trans: transaction, img: img };
	const store = transaction.objectStore("props");
	const get = store.get(id);
	get.onsuccess = () => {
		if (getTransactions[id]) {
			const currentImg = getTransactions[id].img;
			delete getTransactions[id];
			const result = get.result;
			const prop = result.prop;
			if (prop.ghost) currentImg.className = 'bagprop ghost';
			currentImg.title = `${result.name}\n${formatBytes(prop.blob.size)}`;
			currentImg.src = URL.createObjectURL(prop.blob);
		}
	};
	transaction.onabort = () => {
		delete getTransactions[id];
	};
}

export function formatBytes(bytes: number, decimals?: number): string {
	if (bytes === 0) return '0 Bytes';
	const k = 1000;
	const dm = decimals || 2;
	const sizes = ['bytes', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function cacheBagProp(id: number, toUpload?: boolean, callback?: () => void): void {
	const store = propBagDB.transaction("props", "readonly").objectStore("props");
	const get = store.get(id);
	get.onsuccess = () => {
		let aProp = cacheProps[id];
		if (!aProp) {
			aProp = new PalaceProp(id, get.result);
			cacheProps[id] = aProp;
		}
		if (callback) callback();
		if (toUpload) {
			uploadPropInfo(aProp);
		}
	};
}


interface GifFrame {
	width: number;
	height: number;
	left: number;
	top: number;
	patch: Uint8ClampedArray;
	disposalType: number;
	transparent: boolean;
	delay: number;
}

export class GifDecoder {
	worker: Worker;
	gifCanvas: HTMLCanvasElement;
	gifctx: CanvasRenderingContext2D;
	tempcanvas: HTMLCanvasElement;
	tempctx: CanvasRenderingContext2D;
	imgData: ImageData | null = null;
	startCallBack: (w: number, h: number, nbrFrames: number) => boolean | void;
	receivedFrameCallBack: (canvas: HTMLCanvasElement, transparent: boolean, delay: number) => void;
	endedCallBack: (e?: unknown) => void;

	constructor(file: Blob, start: (w: number, h: number, nbrFrames: number) => boolean | void, frame: (canvas: HTMLCanvasElement, transparent: boolean, delay: number) => void, end: (e?: unknown) => void) {
		this.worker = new Worker('js/workers/gifextract.js');

		this.worker.addEventListener('message', (e) => { this.message(e); });
		this.worker.addEventListener('error', (e) => { this.error(e); });
		this.worker.postMessage(file);

		this.gifCanvas = document.createElement('canvas');
		this.gifctx = this.gifCanvas.getContext("2d")!;
		this.tempcanvas = document.createElement('canvas');
		this.tempctx = this.tempcanvas.getContext("2d")!;

		this.startCallBack = start;
		this.receivedFrameCallBack = frame;
		this.endedCallBack = end;
	}

	message(e: MessageEvent): void {
		if (e.data.start) {
			this.start(e.data.width, e.data.height, e.data.nbrFrames);
		} else if (e.data.frame) {
			this.processFrame(e.data.frame);
		}
		if (e.data.finished) {
			this.end();
		}
	}

	start(w: number, h: number, nbrFrames: number): void {
		this.gifCanvas.width = w;
		this.gifCanvas.height = h;
		if (this.startCallBack(w, h, nbrFrames)) {
			this.worker.terminate();
		}
	}

	processFrame(frame: GifFrame): void {
		if (!this.imgData || frame.width !== this.imgData.width || frame.height !== this.imgData.height) {
			this.tempcanvas.width = frame.width;
			this.tempcanvas.height = frame.height;
			this.imgData = this.tempctx.createImageData(this.tempcanvas.width, this.tempcanvas.height);
		}

		this.imgData.data.set(frame.patch);
		this.tempctx.putImageData(this.imgData, 0, 0);

		let restorer: ImageData | undefined;
		if (frame.disposalType === 3) {
			restorer = this.gifctx.getImageData(0, 0, this.gifCanvas.width, this.gifCanvas.height);
		}

		this.gifctx.drawImage(this.tempcanvas, frame.left, frame.top);

		this.receivedFrameCallBack(this.gifCanvas, frame.transparent, frame.delay);

		if (frame.disposalType === 2) {
			this.gifctx.clearRect(0, 0, this.gifCanvas.width, this.gifCanvas.height);
		} else if (restorer) {
			this.gifctx.putImageData(restorer, 0, 0);
		}
		delete (frame as any).patch;
	}

	end(e?: unknown): void {
		this.endedCallBack(e);
	}

	error(e: ErrorEvent): void {
		console.log('Gif Decoder errored!');
		console.log(e);
		this.worker.terminate();
		this.end(e);
	}
}


interface ImageDownOptions {
	canvas?: boolean;
	nearest?: boolean;
}

function applySharpen(imageData: ImageData, amount: number): ImageData {
	if (amount <= 0) return imageData;
	const strength = amount / 100;
	const w = imageData.width;
	const h = imageData.height;
	const src = imageData.data;
	const out = new Uint8ClampedArray(src.length);
	// 3x3 sharpen kernel: identity + strength * (identity - blur)
	// center = 1 + 4*strength, edges = -strength
	const center = 1 + 4 * strength;
	const edge = -strength;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			for (let c = 0; c < 3; c++) {
				const idx = i + c;
				let val = src[idx] * center;
				if (y > 0) val += src[idx - w * 4] * edge;
				else val += src[idx] * edge;
				if (y < h - 1) val += src[idx + w * 4] * edge;
				else val += src[idx] * edge;
				if (x > 0) val += src[idx - 4] * edge;
				else val += src[idx] * edge;
				if (x < w - 1) val += src[idx + 4] * edge;
				else val += src[idx] * edge;
				out[idx] = val;
			}
			out[i + 3] = src[i + 3]; // preserve alpha
		}
	}
	return new ImageData(out, w, h);
}

export class ImageDown {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	options: ImageDownOptions;
	worker: Worker | null;
	maxSize: number;
	callbacks: ((data: ImageData | HTMLCanvasElement) => void)[];
	width!: number;
	height!: number;
	finished!: () => void;

	constructor(maxSize: number, options?: ImageDownOptions) {
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d')!;
		this.ctx.imageSmoothingEnabled = true;
		this.ctx.imageSmoothingQuality = 'high';

		this.options = options || {};
		this.worker = new Worker('js/workers/resizeimage.js');
		this.worker.addEventListener('message', (e) => {
			this.receivedMessage(e);
		});
		this.maxSize = maxSize;
		this.callbacks = [];
	}

	set exportAsCanvas(value: boolean) {
		this.options.canvas = value;
	}

	receivedMessage(e: MessageEvent): void {
		const response = e.data;
		if (response.pixels) {
			this.setCanvasSize(response.width, response.height);
			const imgData = this.createImageData(response.pixels, response.width, response.height);
			if (this.options.canvas) {
				this.ctx.putImageData(imgData, 0, 0);
				const cb = this.callbacks.shift()!;
				cb(this.canvas);
			} else {
				const cb = this.callbacks.shift()!;
				cb(imgData);
			}
		} else {
			this.finished();
		}
	}

	createImageData(data: Uint8ClampedArray, w: number, h: number): ImageData {
		const imgData = this.ctx.createImageData(w, h);
		imgData.data.set(data);
		return imgData;
	}

	finish(callback: () => void): void {
		if (this.worker) {
			this.finished = callback;
			this.worker.postMessage(0);
		} else {
			callback();
		}
	}

	resize(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, callback: (data: ImageData | HTMLCanvasElement) => void): void {
		const srcW = (src as any).width as number;
		const srcH = (src as any).height as number;
		this.setNewSize(srcW, srcH);

		// No resizing needed — copy pixels directly to avoid blurring
		if (this.width === srcW && this.height === srcH) {
			this.setCanvasSize(srcW, srcH);
			this.ctx.clearRect(0, 0, srcW, srcH);
			this.ctx.imageSmoothingEnabled = false;
			this.ctx.drawImage(src, 0, 0);
			if (this.options.canvas) {
				callback(this.canvas);
			} else {
				callback(this.imageData);
			}
			return;
		}

		// Use stepwise halving for downscaling (sharper), Lanczos for upscaling (smoother)
		const isDownscale = this.width < srcW || this.height < srcH;
		if (isDownscale) {
			this.stepDown(src, callback);
		} else if (this.worker) {
			this.lanczos(src, callback);
		} else {
			this.native(src, callback);
		}
	}

	/**
	 * Progressive halving downscale — repeatedly halves the image until
	 * close to the target size, then does one final drawImage step.
	 * Produces sharper, cleaner results than single-pass Lanczos for
	 * large reduction ratios because each 2:1 step is a simple box filter
	 * that preserves detail well.
	 */
	stepDown(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, callback: (data: ImageData | HTMLCanvasElement) => void): void {
		let curW = (src as any).width as number;
		let curH = (src as any).height as number;

		// We need two scratch canvases to ping-pong between
		const c1 = document.createElement('canvas');
		const ctx1 = c1.getContext('2d')!;
		const c2 = document.createElement('canvas');
		const ctx2 = c2.getContext('2d')!;

		// Draw source onto c1 at original size
		c1.width = curW;
		c1.height = curH;
		ctx1.clearRect(0, 0, curW, curH);
		ctx1.drawImage(src, 0, 0, curW, curH);

		let current = c1;
		let currentCtx = ctx1;
		let alt = c2;
		let altCtx = ctx2;

		// Halve until within 2x of the target
		while (curW > this.width * 2 || curH > this.height * 2) {
			const nextW = Math.max(Math.ceil(curW / 2), this.width);
			const nextH = Math.max(Math.ceil(curH / 2), this.height);

			alt.width = nextW;
			alt.height = nextH;
			altCtx.clearRect(0, 0, nextW, nextH);
			altCtx.imageSmoothingEnabled = true;
			altCtx.imageSmoothingQuality = 'high';
			altCtx.drawImage(current, 0, 0, curW, curH, 0, 0, nextW, nextH);

			curW = nextW;
			curH = nextH;

			// Swap
			[current, alt] = [alt, current];
			[currentCtx, altCtx] = [altCtx, currentCtx];
		}

		// Final step to exact target size
		this.setCanvasSize(this.width, this.height);
		this.ctx.clearRect(0, 0, this.width, this.height);
		this.ctx.imageSmoothingEnabled = true;
		this.ctx.imageSmoothingQuality = 'high';
		this.ctx.drawImage(current, 0, 0, curW, curH, 0, 0, this.width, this.height);

		if (this.options.canvas) {
			callback(this.canvas);
		} else {
			callback(this.imageData);
		}
	}

	setCanvasSize(w: number, h: number): boolean {
		let changed = false;
		if (w !== this.canvas.width) {
			this.canvas.width = w;
			changed = true;
		}
		if (h !== this.canvas.height) {
			this.canvas.height = h;
			changed = true;
		}
		return changed;
	}

	lanczos(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, callback: (data: ImageData | HTMLCanvasElement) => void): void {
		let imgData: ImageData;

		if (src instanceof HTMLVideoElement) {
			if (!this.setCanvasSize(src.width, src.height)) {
				this.ctx.clearRect(0, 0, src.width, src.height);
			}
			this.ctx.drawImage(src, 0, 0);
			imgData = this.ctx.getImageData(0, 0, src.width, src.height);
		} else if (src instanceof HTMLImageElement) {
			if (!this.setCanvasSize(src.width, src.height)) {
				this.ctx.clearRect(0, 0, this.width, this.height);
			}
			this.ctx.drawImage(src, 0, 0);
			imgData = this.ctx.getImageData(0, 0, src.width, src.height);
		} else {
			const ctx = src.getContext('2d')!;
			imgData = ctx.getImageData(0, 0, src.width, src.height);
		}

		this.callbacks.push(callback);

		this.worker!.postMessage(
			{
				src: imgData!,
				width: this.width,
				height: this.height
			},
			[imgData!.data.buffer]
		);
	}

	native(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, callback: (data: ImageData | HTMLCanvasElement) => void): void {
		if (!this.setCanvasSize(this.width, this.height)) {
			this.ctx.clearRect(0, 0, this.width, this.height);
		}
		this.ctx.imageSmoothingQuality = this.options.nearest ? 'low' : 'high';
		this.ctx.drawImage(src, 0, 0, (src as any).width, (src as any).height, 0, 0, this.width, this.height);
		if (this.options.canvas) {
			callback(this.canvas);
		} else {
			callback(this.imageData);
		}
	}

	destroy(): void {
		if (this.worker) {
			this.worker.terminate();
		}
	}

	get imageData(): ImageData {
		return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
	}

	setNewSize(w: number, h: number): void {
		if (w > this.maxSize) {
			h = h * (this.maxSize / w);
			w = this.maxSize;
		}
		if (h > this.maxSize) {
			w = w * (this.maxSize / h);
			h = this.maxSize;
		}
		this.width = Math.round(w);
		this.height = Math.round(h);
	}
}

interface CropResult {
	cropX: number;
	cropY: number;
	cropW: number;
	cropH: number;
	sharpen: number;
}

interface VideoEditorResult extends CropResult {
	startTime: number;
	endTime: number;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 10);
	return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

function showBatchImportPrompt(count: number): Promise<boolean> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';

		const dialog = document.createElement('div');
		dialog.className = 'dlg-box';

		const title = document.createElement('h3');
		title.textContent = `Import ${count} Files`;

		const msg = document.createElement('p');
		msg.className = 'dlg-message';
		msg.textContent = 'Would you like to crop/edit each file individually, or import them all as-is?';

		const buttons = document.createElement('div');
		buttons.className = 'dlg-buttons';

		const importAllBtn = document.createElement('button');
		importAllBtn.className = 'dlg-btn-cancel';
		importAllBtn.textContent = 'Import All';

		const cropEachBtn = document.createElement('button');
		cropEachBtn.className = 'dlg-btn-ok';
		cropEachBtn.textContent = 'Crop Each';

		buttons.appendChild(importAllBtn);
		buttons.appendChild(cropEachBtn);

		dialog.appendChild(title);
		dialog.appendChild(msg);
		dialog.appendChild(buttons);
		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		importAllBtn.addEventListener('click', () => {
			overlay.remove();
			resolve(false);
		});

		cropEachBtn.addEventListener('click', () => {
			overlay.remove();
			resolve(true);
		});
	});
}

function showCropEditor(file: Blob): Promise<CropResult | null> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';

		const editor = document.createElement('div');
		editor.className = 'dlg-box';

		const title = document.createElement('h3');
		title.textContent = file.type === 'image/gif' ? 'Import GIF as Prop' : 'Import Image as Prop';

		const previewContainer = document.createElement('div');
		previewContainer.className = 'dlg-preview';

		const img = document.createElement('img');
		img.src = URL.createObjectURL(file);
		previewContainer.appendChild(img);

		// Crop overlay
		const cropBox = document.createElement('div');
		cropBox.className = 'dlg-crop';
		previewContainer.appendChild(cropBox);

		for (const pos of ['tl', 'tr', 'bl', 'br']) {
			const handle = document.createElement('div');
			handle.className = `dlg-crop-handle ${pos}`;
			handle.dataset.pos = pos;
			cropBox.appendChild(handle);
		}

		// Buttons
		const buttons = document.createElement('div');
		buttons.className = 'dlg-buttons';

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'dlg-btn-cancel';
		cancelBtn.textContent = 'Cancel';

		const importBtn = document.createElement('button');
		importBtn.className = 'dlg-btn-ok';
		importBtn.textContent = 'Import';

		buttons.appendChild(cancelBtn);
		buttons.appendChild(importBtn);

		// SVG sharpen filter for live preview
		const svgNS = 'http://www.w3.org/2000/svg';
		const svgEl = document.createElementNS(svgNS, 'svg');
		svgEl.setAttribute('width', '0');
		svgEl.setAttribute('height', '0');
		svgEl.style.position = 'absolute';
		const filterEl = document.createElementNS(svgNS, 'filter');
		const filterId = 'sharpen-preview-' + Date.now();
		filterEl.setAttribute('id', filterId);
		const convolve = document.createElementNS(svgNS, 'feConvolveMatrix');
		convolve.setAttribute('order', '3');
		convolve.setAttribute('preserveAlpha', 'true');
		convolve.setAttribute('kernelMatrix', '0 0 0 0 1 0 0 0 0');
		filterEl.appendChild(convolve);
		svgEl.appendChild(filterEl);
		overlay.appendChild(svgEl);

		const updateSharpenFilter = (value: number) => {
			const s = value / 100;
			if (s <= 0) {
				img.style.filter = '';
			} else {
				const e = -s;
				const c = 1 + 4 * s;
				convolve.setAttribute('kernelMatrix', `0 ${e} 0 ${e} ${c} ${e} 0 ${e} 0`);
				img.style.filter = `url(#${filterId})`;
			}
		};

		// Sharpen slider
		const sharpenRow = document.createElement('div');
		sharpenRow.className = 'dlg-sharpen-row';
		const sharpenLabel = document.createElement('label');
		sharpenLabel.textContent = 'Sharpen';
		const sharpenSlider = document.createElement('input');
		sharpenSlider.type = 'range';
		sharpenSlider.min = '0';
		sharpenSlider.max = '100';
		sharpenSlider.value = '0';
		sharpenSlider.className = 'dlg-sharpen-slider';
		const sharpenValue = document.createElement('span');
		sharpenValue.className = 'dlg-sharpen-value';
		sharpenValue.textContent = '0';
		sharpenSlider.oninput = () => {
			sharpenValue.textContent = sharpenSlider.value;
			updateSharpenFilter(Number(sharpenSlider.value));
		};
		sharpenRow.appendChild(sharpenLabel);
		sharpenRow.appendChild(sharpenSlider);
		sharpenRow.appendChild(sharpenValue);

		editor.appendChild(title);
		editor.appendChild(previewContainer);
		editor.appendChild(sharpenRow);
		editor.appendChild(buttons);
		overlay.appendChild(editor);
		document.body.appendChild(overlay);

		// Crop state (normalized 0..1)
		let cropLeft = 0, cropTop = 0, cropRight = 1, cropBottom = 1;

		function updateCropBox(): void {
			const rect = img.getBoundingClientRect();
			const containerRect = previewContainer.getBoundingClientRect();
			const imgLeft = rect.left - containerRect.left;
			const imgTop = rect.top - containerRect.top;
			const imgW = rect.width;
			const imgH = rect.height;

			cropBox.style.left = `${imgLeft + cropLeft * imgW}px`;
			cropBox.style.top = `${imgTop + cropTop * imgH}px`;
			cropBox.style.width = `${(cropRight - cropLeft) * imgW}px`;
			cropBox.style.height = `${(cropBottom - cropTop) * imgH}px`;
		}

		img.onload = () => {
			requestAnimationFrame(() => updateCropBox());
		};

		// Crop drag
		let cropDrag: { type: string; startX: number; startY: number; origL: number; origT: number; origR: number; origB: number } | null = null;

		previewContainer.addEventListener('mousedown', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.classList.contains('dlg-crop-handle') && target !== cropBox) return;

			cropDrag = {
				type: target.dataset.pos || 'move',
				startX: e.clientX,
				startY: e.clientY,
				origL: cropLeft,
				origT: cropTop,
				origR: cropRight,
				origB: cropBottom
			};
			e.preventDefault();
		});

		window.addEventListener('mousemove', onCropMove);
		window.addEventListener('mouseup', onCropUp);

		function onCropMove(e: MouseEvent): void {
			if (!cropDrag) return;
			const rect = img.getBoundingClientRect();
			const dx = (e.clientX - cropDrag.startX) / rect.width;
			const dy = (e.clientY - cropDrag.startY) / rect.height;

			if (cropDrag.type === 'move') {
				const w = cropDrag.origR - cropDrag.origL;
				const h = cropDrag.origB - cropDrag.origT;
				let newL = cropDrag.origL + dx;
				let newT = cropDrag.origT + dy;
				newL = Math.max(0, Math.min(1 - w, newL));
				newT = Math.max(0, Math.min(1 - h, newT));
				cropLeft = newL;
				cropTop = newT;
				cropRight = newL + w;
				cropBottom = newT + h;
			} else {
				if (cropDrag.type === 'tl' || cropDrag.type === 'bl') {
					cropLeft = Math.max(0, Math.min(cropDrag.origR - 0.05, cropDrag.origL + dx));
				}
				if (cropDrag.type === 'tr' || cropDrag.type === 'br') {
					cropRight = Math.min(1, Math.max(cropDrag.origL + 0.05, cropDrag.origR + dx));
				}
				if (cropDrag.type === 'tl' || cropDrag.type === 'tr') {
					cropTop = Math.max(0, Math.min(cropDrag.origB - 0.05, cropDrag.origT + dy));
				}
				if (cropDrag.type === 'bl' || cropDrag.type === 'br') {
					cropBottom = Math.min(1, Math.max(cropDrag.origT + 0.05, cropDrag.origB + dy));
				}
			}
			updateCropBox();
		}

		function onCropUp(): void {
			cropDrag = null;
		}

		// Resize observer for crop box
		const resizeObs = new ResizeObserver(() => updateCropBox());
		resizeObs.observe(previewContainer);

		function cleanup(): void {
			window.removeEventListener('mousemove', onCropMove);
			window.removeEventListener('mouseup', onCropUp);
			resizeObs.disconnect();
			URL.revokeObjectURL(img.src);
			img.src = '';
			overlay.remove();
		}

		cancelBtn.addEventListener('click', () => {
			cleanup();
			resolve(null);
		});

		importBtn.addEventListener('click', () => {
			const result: CropResult = {
				cropX: cropLeft * img.naturalWidth,
				cropY: cropTop * img.naturalHeight,
				cropW: (cropRight - cropLeft) * img.naturalWidth,
				cropH: (cropBottom - cropTop) * img.naturalHeight,
				sharpen: Number(sharpenSlider.value)
			};
			cleanup();
			resolve(result);
		});
	});
}

function showVideoEditor(file: Blob): Promise<VideoEditorResult | null> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';

		const editor = document.createElement('div');
		editor.className = 'dlg-box';

		const title = document.createElement('h3');
		title.textContent = 'Import Video as Prop';

		const previewContainer = document.createElement('div');
		previewContainer.className = 'dlg-preview';

		const vid = document.createElement('video');
		vid.muted = true;
		vid.playsInline = true;
		vid.src = URL.createObjectURL(file);

		previewContainer.appendChild(vid);

		// Crop overlay
		const cropBox = document.createElement('div');
		cropBox.className = 'dlg-crop';
		previewContainer.appendChild(cropBox);

		for (const pos of ['tl', 'tr', 'bl', 'br']) {
			const handle = document.createElement('div');
			handle.className = `dlg-crop-handle ${pos}`;
			handle.dataset.pos = pos;
			cropBox.appendChild(handle);
		}

		// Timeline
		const timeline = document.createElement('div');
		timeline.className = 'dlg-timeline';

		const timeLabel = document.createElement('label');
		timeLabel.textContent = 'Select up to 15 seconds:';

		const rangeTrack = document.createElement('div');
		rangeTrack.className = 'dlg-range-track';

		const rangeFill = document.createElement('div');
		rangeFill.className = 'dlg-range-fill';

		const thumbStart = document.createElement('div');
		thumbStart.className = 'dlg-range-thumb';
		thumbStart.dataset.which = 'start';

		const thumbEnd = document.createElement('div');
		thumbEnd.className = 'dlg-range-thumb';
		thumbEnd.dataset.which = 'end';

		rangeTrack.appendChild(rangeFill);
		rangeTrack.appendChild(thumbStart);
		rangeTrack.appendChild(thumbEnd);

		const timeDisplay = document.createElement('div');
		timeDisplay.className = 'dlg-time-display';
		const timeStart = document.createElement('span');
		const timeEnd = document.createElement('span');
		const timeDuration = document.createElement('span');
		timeDisplay.appendChild(timeStart);
		timeDisplay.appendChild(timeDuration);
		timeDisplay.appendChild(timeEnd);

		timeline.appendChild(timeLabel);
		timeline.appendChild(rangeTrack);
		timeline.appendChild(timeDisplay);

		// Buttons
		const buttons = document.createElement('div');
		buttons.className = 'dlg-buttons';

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'dlg-btn-cancel';
		cancelBtn.textContent = 'Cancel';

		const importBtn = document.createElement('button');
		importBtn.className = 'dlg-btn-ok';
		importBtn.textContent = 'Import';

		buttons.appendChild(cancelBtn);
		buttons.appendChild(importBtn);

		// SVG sharpen filter for live preview
		const svgNS = 'http://www.w3.org/2000/svg';
		const svgEl = document.createElementNS(svgNS, 'svg');
		svgEl.setAttribute('width', '0');
		svgEl.setAttribute('height', '0');
		svgEl.style.position = 'absolute';
		const filterEl = document.createElementNS(svgNS, 'filter');
		const filterId = 'sharpen-preview-' + Date.now();
		filterEl.setAttribute('id', filterId);
		const convolve = document.createElementNS(svgNS, 'feConvolveMatrix');
		convolve.setAttribute('order', '3');
		convolve.setAttribute('preserveAlpha', 'true');
		convolve.setAttribute('kernelMatrix', '0 0 0 0 1 0 0 0 0');
		filterEl.appendChild(convolve);
		svgEl.appendChild(filterEl);
		overlay.appendChild(svgEl);

		const updateSharpenFilter = (value: number) => {
			const s = value / 100;
			if (s <= 0) {
				vid.style.filter = '';
			} else {
				const e = -s;
				const c = 1 + 4 * s;
				convolve.setAttribute('kernelMatrix', `0 ${e} 0 ${e} ${c} ${e} 0 ${e} 0`);
				vid.style.filter = `url(#${filterId})`;
			}
		};

		// Sharpen slider
		const sharpenRow = document.createElement('div');
		sharpenRow.className = 'dlg-sharpen-row';
		const sharpenLabel = document.createElement('label');
		sharpenLabel.textContent = 'Sharpen';
		const sharpenSlider = document.createElement('input');
		sharpenSlider.type = 'range';
		sharpenSlider.min = '0';
		sharpenSlider.max = '100';
		sharpenSlider.value = '0';
		sharpenSlider.className = 'dlg-sharpen-slider';
		const sharpenValue = document.createElement('span');
		sharpenValue.className = 'dlg-sharpen-value';
		sharpenValue.textContent = '0';
		sharpenSlider.oninput = () => {
			sharpenValue.textContent = sharpenSlider.value;
			updateSharpenFilter(Number(sharpenSlider.value));
		};
		sharpenRow.appendChild(sharpenLabel);
		sharpenRow.appendChild(sharpenSlider);
		sharpenRow.appendChild(sharpenValue);

		editor.appendChild(title);
		editor.appendChild(previewContainer);
		editor.appendChild(timeline);
		editor.appendChild(sharpenRow);
		editor.appendChild(buttons);
		overlay.appendChild(editor);
		document.body.appendChild(overlay);

		// State
		let duration = 0;
		let startTime = 0;
		let endTime = 15;
		const maxSpan = 15;

		// Crop state (normalized 0..1)
		let cropLeft = 0, cropTop = 0, cropRight = 1, cropBottom = 1;

		function updateTimeline(): void {
			const startPct = (startTime / duration) * 100;
			const endPct = (endTime / duration) * 100;
			rangeFill.style.left = `${startPct}%`;
			rangeFill.style.width = `${endPct - startPct}%`;
			thumbStart.style.left = `${startPct}%`;
			thumbEnd.style.left = `${endPct}%`;
			timeStart.textContent = formatTime(startTime);
			timeEnd.textContent = formatTime(endTime);
			timeDuration.textContent = `${formatTime(endTime - startTime)} selected`;
		}

		function updateCropBox(): void {
			const rect = vid.getBoundingClientRect();
			const containerRect = previewContainer.getBoundingClientRect();
			const vidLeft = rect.left - containerRect.left;
			const vidTop = rect.top - containerRect.top;
			const vidW = rect.width;
			const vidH = rect.height;

			cropBox.style.left = `${vidLeft + cropLeft * vidW}px`;
			cropBox.style.top = `${vidTop + cropTop * vidH}px`;
			cropBox.style.width = `${(cropRight - cropLeft) * vidW}px`;
			cropBox.style.height = `${(cropBottom - cropTop) * vidH}px`;
		}

		vid.onloadedmetadata = () => {
			duration = vid.duration;
			endTime = Math.min(duration, maxSpan);
			updateTimeline();
			vid.currentTime = startTime;
			vid.play();

			requestAnimationFrame(() => updateCropBox());
		};

		// Looping preview within the selected range
		vid.loop = true;
		vid.ontimeupdate = () => {
			if (vid.currentTime >= endTime || vid.currentTime < startTime) {
				vid.currentTime = startTime;
			}
		};
		vid.onended = () => {
			vid.currentTime = startTime;
			vid.play();
		};

		// Timeline drag
		let draggingThumb: string | null = null;
		const getTimeFromX = (clientX: number): number => {
			const rect = rangeTrack.getBoundingClientRect();
			const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			return pct * duration;
		};

		rangeTrack.addEventListener('mousedown', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.dataset.which) {
				draggingThumb = target.dataset.which;
			} else {
				// Click on track: move the range so it's centered on click point
				const clickTime = getTimeFromX(e.clientX);
				const span = endTime - startTime;
				startTime = Math.max(0, Math.min(duration - span, clickTime - span / 2));
				endTime = startTime + span;
				updateTimeline();
				vid.currentTime = startTime;
			}
			e.preventDefault();
		});

		window.addEventListener('mousemove', onTimelineMove);
		window.addEventListener('mouseup', onTimelineUp);

		function onTimelineMove(e: MouseEvent): void {
			if (!draggingThumb) return;
			const t = getTimeFromX(e.clientX);
			if (draggingThumb === 'start') {
				startTime = Math.max(0, Math.min(t, endTime - 0.1));
				if (endTime - startTime > maxSpan) {
					endTime = startTime + maxSpan;
				}
			} else {
				endTime = Math.min(duration, Math.max(t, startTime + 0.1));
				if (endTime - startTime > maxSpan) {
					startTime = endTime - maxSpan;
				}
			}
			updateTimeline();
			vid.currentTime = startTime;
		}

		function onTimelineUp(): void {
			draggingThumb = null;
		}

		// Crop drag
		let cropDrag: { type: string; startX: number; startY: number; origL: number; origT: number; origR: number; origB: number } | null = null;

		previewContainer.addEventListener('mousedown', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.classList.contains('dlg-crop-handle') && target !== cropBox) return;

			cropDrag = {
				type: target.dataset.pos || 'move',
				startX: e.clientX,
				startY: e.clientY,
				origL: cropLeft,
				origT: cropTop,
				origR: cropRight,
				origB: cropBottom
			};
			e.preventDefault();
		});

		window.addEventListener('mousemove', onCropMove);
		window.addEventListener('mouseup', onCropUp);

		function onCropMove(e: MouseEvent): void {
			if (!cropDrag) return;
			const rect = vid.getBoundingClientRect();
			const dx = (e.clientX - cropDrag.startX) / rect.width;
			const dy = (e.clientY - cropDrag.startY) / rect.height;

			if (cropDrag.type === 'move') {
				const w = cropDrag.origR - cropDrag.origL;
				const h = cropDrag.origB - cropDrag.origT;
				let newL = cropDrag.origL + dx;
				let newT = cropDrag.origT + dy;
				newL = Math.max(0, Math.min(1 - w, newL));
				newT = Math.max(0, Math.min(1 - h, newT));
				cropLeft = newL;
				cropTop = newT;
				cropRight = newL + w;
				cropBottom = newT + h;
			} else {
				if (cropDrag.type === 'tl' || cropDrag.type === 'bl') {
					cropLeft = Math.max(0, Math.min(cropDrag.origR - 0.05, cropDrag.origL + dx));
				}
				if (cropDrag.type === 'tr' || cropDrag.type === 'br') {
					cropRight = Math.min(1, Math.max(cropDrag.origL + 0.05, cropDrag.origR + dx));
				}
				if (cropDrag.type === 'tl' || cropDrag.type === 'tr') {
					cropTop = Math.max(0, Math.min(cropDrag.origB - 0.05, cropDrag.origT + dy));
				}
				if (cropDrag.type === 'bl' || cropDrag.type === 'br') {
					cropBottom = Math.min(1, Math.max(cropDrag.origT + 0.05, cropDrag.origB + dy));
				}
			}
			updateCropBox();
		}

		function onCropUp(): void {
			cropDrag = null;
		}

		// Resize observer for crop box
		const resizeObs = new ResizeObserver(() => updateCropBox());
		resizeObs.observe(previewContainer);

		function cleanup(): void {
			window.removeEventListener('mousemove', onTimelineMove);
			window.removeEventListener('mouseup', onTimelineUp);
			window.removeEventListener('mousemove', onCropMove);
			window.removeEventListener('mouseup', onCropUp);
			resizeObs.disconnect();
			vid.pause();
			URL.revokeObjectURL(vid.src);
			vid.src = '';
			overlay.remove();
		}

		cancelBtn.addEventListener('click', () => {
			cleanup();
			resolve(null);
		});

		importBtn.addEventListener('click', () => {
			const result: VideoEditorResult = {
				startTime: startTime,
				endTime: endTime,
				cropX: cropLeft * vid.videoWidth,
				cropY: cropTop * vid.videoHeight,
				cropW: (cropRight - cropLeft) * vid.videoWidth,
				cropH: (cropBottom - cropTop) * vid.videoHeight,
				sharpen: Number(sharpenSlider.value)
			};
			cleanup();
			resolve(result);
		});
	});
}

export function videoToPng(file: Blob, resizer: ImageDown, endedCallBack: (blob?: Blob, w?: number, h?: number) => void, edit?: VideoEditorResult): void {
	const vid = document.createElement('video');
	const sampleInterval = Math.round(1000 / 20);
	let frameCount = 0;
	let passedTransparencyScan = false;
	const frames: ArrayBuffer[] = [];
	const delays: number[] = [];

	// Crop canvas for extracting the cropped region
	let cropCanvas: HTMLCanvasElement | null = null;
	let cropCtx: CanvasRenderingContext2D | null = null;

	vid.defaultMuted = true;

	const startAt = edit ? edit.startTime : 0;
	const endAt = edit ? edit.endTime : Infinity;

	vid.onloadedmetadata = () => {
		if (vid.videoHeight === 0) {
			URL.revokeObjectURL(vid.src);
			vid.src = '';
			endedCallBack();
			return;
		}

		if (edit && edit.cropW > 0 && edit.cropH > 0 &&
			(edit.cropX !== 0 || edit.cropY !== 0 ||
			 Math.abs(edit.cropW - vid.videoWidth) > 1 || Math.abs(edit.cropH - vid.videoHeight) > 1)) {
			// Use crop dimensions
			const cw = Math.round(edit.cropW);
			const ch = Math.round(edit.cropH);
			cropCanvas = document.createElement('canvas');
			cropCanvas.width = cw;
			cropCanvas.height = ch;
			cropCtx = cropCanvas.getContext('2d')!;
			resizer.setNewSize(cw, ch);
			vid.width = cw;
			vid.height = ch;
		} else {
			resizer.setNewSize(vid.videoWidth, vid.videoHeight);
			vid.width = vid.videoWidth;
			vid.height = vid.videoHeight;
		}

		vid.currentTime = startAt;
	};

	vid.onended = () => {
		resizer.finish(() => {
			// Drop last frame if it's nearly identical to the first (avoids loop stutter)
			if (frames.length > 2) {
				const first = new Uint8Array(frames[0]);
				const last = new Uint8Array(frames[frames.length - 1]);
				if (first.length === last.length) {
					let diff = 0;
					const sampleStep = Math.max(1, (first.length >> 2) >> 8); // sample ~256 pixels
					for (let i = 0; i < first.length; i += sampleStep * 4) {
						diff += Math.abs(first[i] - last[i])
							+ Math.abs(first[i + 1] - last[i + 1])
							+ Math.abs(first[i + 2] - last[i + 2]);
					}
					const samples = Math.ceil(first.length / (sampleStep * 4));
					if (diff / (samples * 3) < 8) { // average per-channel diff < 8
						frames.pop();
						delays.pop();
					}
				}
			}
			encodeAPNG(frames, resizer.width, resizer.height, delays, endedCallBack);
			URL.revokeObjectURL(vid.src);
			vid.src = '';
		});
	};

	const doFrame = () => {
		vid.oncanplaythrough = null;
		vid.onerror = null;
		const effectiveEnd = Math.min(vid.duration, endAt);
		const remaining = effectiveEnd - vid.currentTime;
		if (vid.currentTime >= effectiveEnd || remaining < (sampleInterval / 1000) * 0.5) {
			vid.onended!(new Event('ended'));
			vid.onseeked = null;
			return;
		}
		if (frameCount >= 300) {
			vid.onended!(new Event('ended'));
			return;
		}

		// If cropping, draw cropped region to the crop canvas first
		let source: HTMLVideoElement | HTMLCanvasElement = vid;
		if (cropCanvas && cropCtx && edit) {
			cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
			cropCtx.drawImage(vid, Math.round(edit.cropX), Math.round(edit.cropY),
				cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);
			source = cropCanvas;
		}

		resizer.resize(source, (data) => {
			let imgData = data as ImageData;
			if (edit && edit.sharpen > 0) {
				imgData = applySharpen(imgData, edit.sharpen);
			}
			const buf = imgData.data.buffer;
			// Skip fully transparent frames until the first opaque frame is found
			if (!passedTransparencyScan) {
				const pixels = new Uint8Array(buf);
				const totalPixels = pixels.length >> 2;
				const step = Math.max(1, totalPixels >> 8); // sample ~256 pixels
				let hasOpaque = false;
				for (let i = 3; i < pixels.length; i += step * 4) {
					if (pixels[i] > 0) { hasOpaque = true; break; }
				}
				if (!hasOpaque) {
					return; // skip completely transparent frame
				}
				passedTransparencyScan = true;
			}
			frames.push(buf);
			delays.push(sampleInterval);
		});
		vid.currentTime = vid.currentTime + sampleInterval / 1000;
		frameCount++;
	};

	vid.oncanplaythrough = doFrame;
	vid.onseeked = doFrame;

	vid.onerror = () => {
		console.log('error with video');
		resizer.destroy();
		endedCallBack();
		URL.revokeObjectURL(vid.src);
	};

	vid.src = URL.createObjectURL(file);
}

export function encodeAPNG(frames: ArrayBuffer[], w: number, h: number, delays: number[], callback: (blob?: Blob, w?: number, h?: number) => void): void {
	const pngWork = new Worker('js/workers/apng-worker.js');
	pngWork.addEventListener('message', (e) => {
		const blob = new Blob([e.data.buffer], { type: 'image/apng' });
		callback(blob, w, h);
	});
	pngWork.addEventListener('error', function(this: Worker) {
		this.terminate();
	});
	pngWork.postMessage({ frames: frames, width: w, height: h, delays: delays }, frames);
}

export function gifToPng(file: Blob, resizer: ImageDown, endedCallBack: (blob?: Blob, w?: number, h?: number) => void, crop?: CropResult): void {
	const frames: ArrayBuffer[] = [];
	const delays: number[] = [];

	let cropCanvas: HTMLCanvasElement | null = null;
	let cropCtx: CanvasRenderingContext2D | null = null;

	new GifDecoder(file,
		(w, h, nbrFrames) => {
			if (nbrFrames <= 1) {
				processImage(file, resizer, endedCallBack, crop);
				return true;
			}
			if (crop && crop.cropW > 0 && crop.cropH > 0 &&
				(crop.cropX !== 0 || crop.cropY !== 0 ||
				 Math.abs(crop.cropW - w) > 1 || Math.abs(crop.cropH - h) > 1)) {
				cropCanvas = document.createElement('canvas');
				cropCanvas.width = Math.round(crop.cropW);
				cropCanvas.height = Math.round(crop.cropH);
				cropCtx = cropCanvas.getContext('2d')!;
			}
			resizer.setNewSize(cropCanvas ? cropCanvas.width : w, cropCanvas ? cropCanvas.height : h);
		},
		(image, _transparent, delay) => {
			let source: HTMLCanvasElement = image;
			if (cropCanvas && cropCtx && crop) {
				cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
				cropCtx.drawImage(image, Math.round(crop.cropX), Math.round(crop.cropY),
					cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);
				source = cropCanvas;
			}
			resizer.resize(source, (data) => {
				let imgData = data as ImageData;
				if (crop && crop.sharpen > 0) {
					imgData = applySharpen(imgData, crop.sharpen);
				}
				frames.push(imgData.data.buffer);
				delays.push(delay);
			});
		},
		(err) => {
			if (err) {
				endedCallBack();
			} else {
				resizer.finish(() => {
					encodeAPNG(frames, resizer.width, resizer.height, delays, endedCallBack);
				});
			}
		}
	);
}


export interface NewPropData {
	id: number;
	name: string;
	w: number;
	h: number;
	x: number;
	y: number;
	head: boolean;
	ghost: boolean;
	animated: boolean;
	bounce: boolean;
	blob: Blob;
}

export function createNewProps(list: (File | Blob)[], finishedCallback?: () => void): void {
	const files: (File | Blob)[] = new Array(list.length);
	for (let i = 0; i < list.length; i++) {
		files[i] = list[i];
	}
	const button = document.getElementById('newprops')!;
	button.className += ' loadingbutton';

	const resizer = new ImageDown(220);

	const port = (blob?: Blob, w?: number, h?: number) => {
		if (blob) {
			addPropsToDB([createNewProp(blob, w!, h!)]);
		}
		importFile();
	};

	let skipCropDialogs = false;

	const importFile = () => {
		if (files.length > 0) {
			const file = files.pop()!;

			if (file.type === 'image/gif') {
				if (skipCropDialogs) {
					gifToPng(file, resizer, port);
				} else {
					showCropEditor(file).then((crop) => {
						if (crop) {
							gifToPng(file, resizer, port, crop);
						} else {
							port();
						}
					});
				}
			} else if (file.type.match(/^video\/.*/)) {
				if (skipCropDialogs) {
					videoToPng(file, resizer, port);
				} else {
					showVideoEditor(file).then((edit) => {
						if (edit) {
							videoToPng(file, resizer, port, edit);
						} else {
							port(); // cancelled — skip this file
						}
					});
				}
			} else {
				if (skipCropDialogs) {
					processImage(file, resizer, port);
				} else {
					showCropEditor(file).then((crop) => {
						if (crop) {
							processImage(file, resizer, port, crop);
						} else {
							port();
						}
					});
				}
			}
		} else {
			resizer.finish(() => {
				button.className = 'tbcontrol tbbutton';
				resizer.destroy();
				if (finishedCallback) {
					finishedCallback();
				}
			});
		}
	};

	if (files.length > 1) {
		showBatchImportPrompt(files.length).then((cropEach) => {
			skipCropDialogs = !cropEach;
			importFile();
		});
	} else {
		importFile();
	}
}


export function processImage(file: Blob, resizer: ImageDown, endedCallBack: (blob?: Blob, w?: number, h?: number) => void, crop?: CropResult): void {
	const img = document.createElement('img');

	img.onload = () => {
		let source: HTMLImageElement | HTMLCanvasElement = img;
		if (crop && crop.cropW > 0 && crop.cropH > 0 &&
			(crop.cropX !== 0 || crop.cropY !== 0 ||
			 Math.abs(crop.cropW - img.naturalWidth) > 1 || Math.abs(crop.cropH - img.naturalHeight) > 1)) {
			const cw = Math.round(crop.cropW);
			const ch = Math.round(crop.cropH);
			const tempCanvas = document.createElement('canvas');
			tempCanvas.width = cw;
			tempCanvas.height = ch;
			const tempCtx = tempCanvas.getContext('2d')!;
			tempCtx.drawImage(img, Math.round(crop.cropX), Math.round(crop.cropY), cw, ch, 0, 0, cw, ch);
			source = tempCanvas;
		}
		resizer.resize(source, (data) => {
			let imgData = data as ImageData;
			if (crop && crop.sharpen > 0) {
				imgData = applySharpen(imgData, crop.sharpen);
			}
			endedCallBack(
				new Blob([UPNG.encode([imgData.data.buffer], resizer.width, resizer.height, 0)], { type: 'image/png' }),
				resizer.width,
				resizer.height
			);
		});
		URL.revokeObjectURL(img.src);
	};

	img.onerror = () => {
		endedCallBack();
		URL.revokeObjectURL(img.src);
	};

	img.src = URL.createObjectURL(file);
}


export function createNewProp(blob: Blob, w: number, h: number): NewPropData {
	let id = 0;

	do {
		id = Math.round(Math.random() * 2147483647);
		if (id % 2) id = -id;
	} while (propBagSet.has(id));

	const prop: NewPropData = {
		id: id,
		name: 'Palace Prop',
		w: w,
		h: h,
		x: (-Math.trunc(w / 2)) + 22,
		y: (-Math.trunc(h / 2)) + 22,
		head: true,
		ghost: false,
		animated: false,
		bounce: false,
		blob: blob
	};

	return prop;
}

document.onpaste = (e) => {
	if (propBag.dataset.state !== '1') return;
	const items = e.clipboardData?.items;
	if (!items) return;
	for (let i = 0; i < items.length; i++) {
		if (items[i].kind === 'string') return;
	}
	for (let i = 0; i < items.length; i++) {
		if (/^image/i.test(items[i].type)) {
			const file = items[i].getAsFile();
			if (file) {
				createNewProps([file]);
				return;
			}
		}
	}
};

export class LegacyPropDecoder {
	ctx: CanvasRenderingContext2D;
	imageData: ImageData;
	colors: number[];
	empty: Uint8Array;
	buf32: Uint32Array;

	constructor() {
		const c = document.createElement('canvas');
		c.width = 44;
		c.height = 44;
		this.ctx = c.getContext("2d")!;

		this.imageData = this.ctx.getImageData(0, 0, 44, 44);
		this.colors = LegacyPropDecoder.colorPalette;

		this.empty = new Uint8Array(7744);
		this.buf32 = new Uint32Array(this.imageData.data.buffer);
	}

	PROP_20BIT(flags: number): boolean { return Boolean(flags & 64); }
	PROP_S20BIT(flags: number): boolean { return Boolean(flags & 512); }
	PROP_32BIT(flags: number): boolean { return Boolean(flags & 256); }
	PROP_16BIT(flags: number): boolean { return Boolean(flags & 128); }

	decode8bit(b: Uint8Array, callback: BlobCallback): void {
		let Read = 0, Skip = 0, l = 0, x = 7744, o = 0, index = 0;
		const len = b.length;

		this.imageData.data.set(this.empty);

		while (x > 0) {
			if (o >= len) break;

			index = b[o];
			Skip = index >> 4;
			Read = index & 0x0F;
			x -= (Skip + Read);

			if (x < 0) break;
			l += Skip;
			o++;

			while (Read--) {
				this.buf32[l] = this.colors[b[o]];
				o++;
				l++;
			}
		}

		this.ctx.putImageData(this.imageData, 0, 0);
		this.ctx.canvas.toBlob(callback);
	}

	decode32bit(b: Uint8Array, callback: BlobCallback): void {
		this.imageData.data.set(b);
		this.ctx.putImageData(this.imageData, 0, 0);
		this.ctx.canvas.toBlob(callback);
	}

	decodeS20bit(b: Uint8Array, callback: BlobCallback): void {
		let inc = 0;
		const buf8 = this.imageData.data;

		for (let i = 0; i < 7744; i += 4) {
			let intComp = (256 * b[inc]) + b[inc + 1];
			let intComp2 = (256 * b[inc + 1]) + b[inc + 2];

			buf8[i + 3] = (intComp2 & 496) * 0.514112903225806494589278372586704791;
			buf8[i + 2] = (intComp & 62) * 4.11290322580645195671422698069363832;
			buf8[i + 1] = (intComp & 1984) * 0.128528225806451623647319593146676198;
			buf8[i] = (intComp & 63488) * 0.00401650705645161323897873728583363118;

			i += 4;

			intComp = (256 * b[inc + 2]) + b[inc + 3];
			intComp2 = (256 * b[inc + 3]) + b[inc + 4];

			buf8[i + 3] = (intComp2 & 31) * 8.22580645161290391342845396138727665;
			buf8[i + 2] = (intComp2 & 992) * 0.257056451612903247294639186293352395;
			buf8[i + 1] = (intComp & 124) * 2.05645161290322597835711349034681916;
			buf8[i] = (intComp & 3968) * 0.0642641129032258118236597965733380988;

			inc += 5;
		}

		this.ctx.putImageData(this.imageData, 0, 0);
		this.ctx.canvas.toBlob(callback);
	}

	decode20bit(b: Uint8Array, callback: BlobCallback): void {
		let inc = 0;
		const buf8 = this.imageData.data;

		for (let i = 0; i < 7744; i += 4) {
			let s1 = b[inc + 1] << 8 | b[inc + 2];

			buf8[i + 3] = ((s1 & 48) * 5.3125);
			buf8[i] = (b[inc] & 252) * 1.01190476190476186246769429999403656;
			buf8[i + 1] = ((b[inc] << 8 | b[inc + 1]) & 1008) * 0.252976190476190465616923574998509139;
			buf8[i + 2] = (s1 & 4032) * 0.0632440476190476164042308937496272847;

			i += 4;

			s1 = b[inc + 2] << 8 | b[inc + 3];
			const s2 = b[inc + 4];

			buf8[i + 3] = (s2 & 3) * 85;
			buf8[i] = ((b[inc + 2] << 8 | b[inc + 3]) & 4032) * 0.0632440476190476164042308937496272847;
			buf8[i + 1] = (s1 & 63) * 4.04761904761904744987077719997614622;
			buf8[i + 2] = (s2 & 252) * 1.01190476190476186246769429999403656;

			inc += 5;
		}

		this.ctx.putImageData(this.imageData, 0, 0);
		this.ctx.canvas.toBlob(callback);
	}

	decode(flags: number, uint8ary: Uint8Array | Uint8ClampedArray, callback: BlobCallback): void {
		const data = uint8ary instanceof Uint8Array ? uint8ary : new Uint8Array(uint8ary.buffer, uint8ary.byteOffset, uint8ary.byteLength);
		if (this.PROP_S20BIT(flags)) {
			this.decodeS20bit(pako.inflate(data), callback);
		} else if (this.PROP_20BIT(flags)) {
			this.decode20bit(pako.inflate(data), callback);
		} else if (this.PROP_32BIT(flags)) {
			this.decode32bit(pako.inflate(data), callback);
		} else {
			this.decode8bit(data, callback);
		}
	}

	static get colorPalette(): number[] {
		return [
			0xFFFEFEFE, 0xFFFFFFCC, 0xFFFFFF99, 0xFFFFFF66, 0xFFFFFF33, 0xFFFFFF00, 0xFFFFDFFF, 0xFFFFDFCC,
			0xFFFFDF99, 0xFFFFDF66, 0xFFFFDF33, 0xFFFFDF00, 0xFFFFBFFF, 0xFFFFBFCC, 0xFFFFBF99, 0xFFFFBF66,
			0xFFFFBF33, 0xFFFFBF00, 0xFFFF9FFF, 0xFFFF9FCC, 0xFFFF9F99, 0xFFFF9F66, 0xFFFF9F33, 0xFFFF9F00,
			0xFFFF7FFF, 0xFFFF7FCC, 0xFFFF7F99, 0xFFFF7F66, 0xFFFF7F33, 0xFFFF7F00, 0xFFFF5FFF, 0xFFFF5FCC,
			0xFFFF5F99, 0xFFFF5F66, 0xFFFF5F33, 0xFFFF5F00, 0xFFFF3FFF, 0xFFFF3FCC, 0xFFFF3F99, 0xFFFF3F66,
			0xFFFF3F33, 0xFFFF3F00, 0xFFFF1FFF, 0xFFFF1FCC, 0xFFFF1F99, 0xFFFF1F66, 0xFFFF1F33, 0xFFFF1F00,
			0xFFFF00FF, 0xFFFF00CC, 0xFFFF0099, 0xFFFF0066, 0xFFFF0033, 0xFFFF0000, 0xFFEEEEEE, 0xFFDDDDDD,
			0xFFCCCCCC, 0xFFBBBBBB, 0xFFAAFFFF, 0xFFAAFFCC, 0xFFAAFF99, 0xFFAAFF66, 0xFFAAFF33, 0xFFAAFF00,
			0xFFAADFFF, 0xFFAADFCC, 0xFFAADF99, 0xFFAADF66, 0xFFAADF33, 0xFFAADF00, 0xFFAABFFF, 0xFFAABFCC,
			0xFFAABF99, 0xFFAABF66, 0xFFAABF33, 0xFFAABF00, 0xFFAAAAAA, 0xFFAA9FFF, 0xFFAA9FCC, 0xFFAA9F99,
			0xFFAA9F66, 0xFFAA9F33, 0xFFAA9F00, 0xFFAA7FFF, 0xFFAA7FCC, 0xFFAA7F99, 0xFFAA7F66, 0xFFAA7F33,
			0xFFAA7F00, 0xFFAA5FFF, 0xFFAA5FCC, 0xFFAA5F99, 0xFFAA5F66, 0xFFAA5F33, 0xFFAA5F00, 0xFFAA3FFF,
			0xFFAA3FCC, 0xFFAA3F99, 0xFFAA3F66, 0xFFAA3F33, 0xFFAA3F00, 0xFFAA1FFF, 0xFFAA1FCC, 0xFFAA1F99,
			0xFFAA1F66, 0xFFAA1F33, 0xFFAA1F00, 0xFFAA00FF, 0xFFAA00CC, 0xFFAA0099, 0xFFAA0066, 0xFFAA0033,
			0xFFAA0000, 0xFF999999, 0xFF888888, 0xFF777777, 0xFF666666, 0xFF55FFFF, 0xFF55FFCC, 0xFF55FF99,
			0xFF55FF66, 0xFF55FF33, 0xFF55FF00, 0xFF55DFFF, 0xFF55DFCC, 0xFF55DF99, 0xFF55DF66, 0xFF55DF33,
			0xFF55DF00, 0xFF55BFFF, 0xFF55BFCC, 0xFF55BF99, 0xFF55BF66, 0xFF55BF33, 0xFF55BF00, 0xFF559FFF,
			0xFF559FCC, 0xFF559F99, 0xFF559F66, 0xFF559F33, 0xFF559F00, 0xFF557FFF, 0xFF557FCC, 0xFF557F99,
			0xFF557F66, 0xFF557F33, 0xFF557F00, 0xFF555FFF, 0xFF555FCC, 0xFF555F99, 0xFF555F66, 0xFF555F33,
			0xFF555F00, 0xFF555555, 0xFF553FFF, 0xFF553FCC, 0xFF553F99, 0xFF553F66, 0xFF553F33, 0xFF553F00,
			0xFF551FFF, 0xFF551FCC, 0xFF551F99, 0xFF551F66, 0xFF551F33, 0xFF551F00, 0xFF5500FF, 0xFF5500CC,
			0xFF550099, 0xFF550066, 0xFF550033, 0xFF550000, 0xFF444444, 0xFF333333, 0xFF222222, 0xFF111111,
			0xFF00FFFF, 0xFF00FFCC, 0xFF00FF99, 0xFF00FF66, 0xFF00FF33, 0xFF00FF00, 0xFF00DFFF, 0xFF00DFCC,
			0xFF00DF99, 0xFF00DF66, 0xFF00DF33, 0xFF00DF00, 0xFF00BFFF, 0xFF00BFCC, 0xFF00BF99, 0xFF00BF66,
			0xFF00BF33, 0xFF00BF00, 0xFF009FFF, 0xFF009FCC, 0xFF009F99, 0xFF009F66, 0xFF009F33, 0xFF009F00,
			0xFF007FFF, 0xFF007FCC, 0xFF007F99, 0xFF007F66, 0xFF007F33, 0xFF007F00, 0xFF005FFF, 0xFF005FCC,
			0xFF005F99, 0xFF005F66, 0xFF005F33, 0xFF005F00, 0xFF003FFF, 0xFF003FCC, 0xFF003F99, 0xFF003F66,
			0xFF003F33, 0xFF003F00, 0xFF001FFF, 0xFF001FCC, 0xFF001F99, 0xFF001F66, 0xFF001F33, 0xFF001F00,
			0xFF0000FF, 0xFF0000CC, 0xFF000099, 0xFF000066, 0xFF000033, 0xFF000000, 0xFF000000, 0xFF000000,
			0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000,
			0xFFF0F0F0, 0xFFE0E0E0, 0xFFD0D0D0, 0xFFC0C0C0, 0xFFB0B0B0, 0xFFA0A0A0, 0xFF808080, 0xFF707070,
			0xFF606060, 0xFF505050, 0xFF404040, 0xFF303030, 0xFF202020, 0xFF101010, 0xFF080808, 0xFF000000
		];
	}
}
