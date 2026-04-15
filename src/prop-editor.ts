import { palace, smileys } from './state.js';
import { getHsl } from './utility.js';
import { PalaceProp, createNewProp, deletePropsFromDB, addPropsToDB, encodeAPNG, propBagList } from './props.js';
import { getGeneralPref, setGeneralPref } from './preferences.js';

// ─── Prop Editor ───

let savedPEGeometry: { left: number; top: number; width: number; height: number } | null = null;

type PETool = 'pen' | 'eraser' | 'eyedropper' | 'fill' | 'zoom' | 'select';

interface AnimFrame {
	data: Uint8ClampedArray;
	delay: number; // ms
}

interface PropEditorState {
	dialog: HTMLDivElement;
	mainCanvas: HTMLCanvasElement;
	mainCtx: CanvasRenderingContext2D;
	previewCanvas: HTMLCanvasElement;
	previewCtx: CanvasRenderingContext2D;
	previewWrapper: HTMLDivElement;
	previewNametag: HTMLDivElement;
	pixelData: Uint8ClampedArray;
	propW: number;
	propH: number;
	propX: number;
	propY: number;
	zoom: number;
	tool: PETool;
	color: [number, number, number, number]; // RGBA
	colorInput: HTMLInputElement;
	bgColor: [number, number, number]; // RGB background checkering color
	propName: string;
	flags: { head: boolean; ghost: boolean; animated: boolean; bounce: boolean; showNameTag: boolean };
	drawing: boolean;
	lastPixel: { x: number; y: number } | null;
	selection: { x: number; y: number; w: number; h: number } | null;
	selecting: boolean;
	selectStart: { x: number; y: number } | null;
	floatingSelection: { data: Uint8ClampedArray; x: number; y: number; w: number; h: number } | null;
	_floatingOrigin: { x: number; y: number } | null;
	_floatingWasCut: boolean;
	_hideSelActions?: () => void;
	prop: PalaceProp | null;
	onSave: ((pixels: Uint8ClampedArray, w: number, h: number) => void) | null;
	brushSize: number;
	antiAlias: boolean;
	floodErase: boolean;
	fillAntiAlias: boolean;
	tolerance: number;
	clearOnDrag: boolean;
	undoStack: UndoEntry[];
	redoStack: UndoEntry[];
	_renderTmp?: HTMLCanvasElement;
	_floatingTmp?: HTMLCanvasElement;
	_aaSnapshot?: Uint8ClampedArray;
	_aaPath?: { x: number; y: number }[];
	// Animation
	frames: AnimFrame[];
	currentFrame: number;
	onionSkin: boolean;
	onionOpacity: number;
	animPlaying: boolean;
	animTimer: number | null;
	timelineEl: HTMLDivElement | null;
	batchMode: boolean;
	// Playback caches
	_frameCache: HTMLCanvasElement[] | null;
	_previewTmp?: HTMLCanvasElement;
	_floodInProgress: boolean;
}

function savePESettings(state: PropEditorState): void {
	setGeneralPref('propEditorSettings', {
		tool: state.tool,
		brushSize: state.brushSize,
		antiAlias: state.antiAlias,
		floodErase: state.floodErase,
		fillAntiAlias: state.fillAntiAlias,
		tolerance: state.tolerance,
		clearOnDrag: state.clearOnDrag,
		color: state.color,
		bgColor: state.bgColor,
		onionSkin: state.onionSkin,
		onionOpacity: state.onionOpacity,
		batchMode: state.batchMode,
	});
}

const PROP_DEFAULT_W = 44;
const PROP_DEFAULT_H = 44;
const PROP_MAX_W = 220;
const PROP_MAX_H = 220;

function parseRgba(str: string): [number, number, number, number] {
	const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
	if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? Math.round(+m[4] * 255) : 255];
	return [0, 128, 0, 255];
}

function setPixel(state: PropEditorState, x: number, y: number, r: number, g: number, b: number, a: number): void {
	if (x < 0 || x >= state.propW || y < 0 || y >= state.propH) return;
	const i = (y * state.propW + x) * 4;
	state.pixelData[i] = r;
	state.pixelData[i + 1] = g;
	state.pixelData[i + 2] = b;
	state.pixelData[i + 3] = a;
}

function getPixel(state: PropEditorState, x: number, y: number): [number, number, number, number] {
	if (x < 0 || x >= state.propW || y < 0 || y >= state.propH) return [0, 0, 0, 0];
	const i = (y * state.propW + x) * 4;
	return [state.pixelData[i], state.pixelData[i + 1], state.pixelData[i + 2], state.pixelData[i + 3]];
}

function colorMatch(a: [number, number, number, number], b: [number, number, number, number], tolerance: number): boolean {
	return Math.abs(a[0] - b[0]) <= tolerance &&
		Math.abs(a[1] - b[1]) <= tolerance &&
		Math.abs(a[2] - b[2]) <= tolerance &&
		Math.abs(a[3] - b[3]) <= tolerance;
}

function floodFillOnData(data: Uint8ClampedArray, w: number, h: number, startX: number, startY: number, fillR: number, fillG: number, fillB: number, fillA: number, tolerance: number, antiAlias: boolean, explicitTarget?: [number, number, number, number]): void {
	const getP = (x: number, y: number): [number, number, number, number] => {
		if (x < 0 || x >= w || y < 0 || y >= h) return [0, 0, 0, 0];
		const i = (y * w + x) * 4;
		return [data[i], data[i + 1], data[i + 2], data[i + 3]];
	};
	const setP = (x: number, y: number, r: number, g: number, b: number, a: number) => {
		if (x < 0 || x >= w || y < 0 || y >= h) return;
		const i = (y * w + x) * 4;
		data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
	};
	const target = explicitTarget || getP(startX, startY);
	if (colorMatch(target, [fillR, fillG, fillB, fillA], 0)) return;
	const visited = new Uint8Array(w * h);
	const stack: [number, number][] = [[startX, startY]];
	while (stack.length > 0) {
		const [cx, cy] = stack.pop()!;
		if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
		const vi = cy * w + cx;
		if (visited[vi]) continue;
		const p = getP(cx, cy);
		if (!colorMatch(p, target, tolerance)) continue;
		visited[vi] = 1;
		setP(cx, cy, fillR, fillG, fillB, fillA);
		stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
	}
	if (antiAlias) {
		// Feather boundary pixels: blend fill color with neighbors outside the filled region
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				if (visited[y * w + x]) continue;
				// Count how many of the 4 neighbors were filled
				let filledNeighbors = 0;
				if (x > 0 && visited[y * w + (x - 1)]) filledNeighbors++;
				if (x < w - 1 && visited[y * w + (x + 1)]) filledNeighbors++;
				if (y > 0 && visited[(y - 1) * w + x]) filledNeighbors++;
				if (y < h - 1 && visited[(y + 1) * w + x]) filledNeighbors++;
				if (filledNeighbors === 0) continue;
				// Blend: mix existing pixel with fill color based on neighbor count
				const blend = filledNeighbors / 6; // subtle blend (max ~67%)
				const [er, eg, eb, ea] = getP(x, y);
				setP(x, y,
					Math.round(er + (fillR - er) * blend),
					Math.round(eg + (fillG - eg) * blend),
					Math.round(eb + (fillB - eb) * blend),
					Math.round(ea + (fillA - ea) * blend)
				);
			}
		}
	}
}

function showFloodProgress(state: PropEditorState, total: number): HTMLDivElement {
	const bar = document.createElement('div');
	bar.className = 'pe-flood-progress';
	bar.innerHTML = `<div class="pe-flood-progress-label">Processing frames: 0/${total}</div><div class="pe-flood-progress-track"><div class="pe-flood-progress-fill" style="width:0%"></div></div>`;
	state.dialog.appendChild(bar);
	return bar;
}

function updateFloodProgress(bar: HTMLDivElement, current: number, total: number): void {
	const label = bar.querySelector('.pe-flood-progress-label') as HTMLElement;
	const fill = bar.querySelector('.pe-flood-progress-fill') as HTMLElement;
	if (label) label.textContent = `Processing frames: ${current}/${total}`;
	if (fill) fill.style.width = `${(current / total * 100).toFixed(1)}%`;
}

function removeFloodProgress(bar: HTMLDivElement): void {
	bar.remove();
}

function floodFillAllFrames(
	state: PropEditorState,
	sx: number, sy: number,
	r: number, g: number, b: number, a: number,
): void {
	pushUndoAllFrames(state);
	state._floodInProgress = true;
	const targetColor = getPixel(state, sx, sy);
	const total = state.frames.length;
	const bar = showFloodProgress(state, total);
	const tol = state.tolerance;
	const aa = state.fillAntiAlias;
	const w = state.propW, h = state.propH;

	const finish = () => {
		removeFloodProgress(bar);
		state._floodInProgress = false;
		state.pixelData.set(state.frames[state.currentFrame].data);
		state._frameCache = null;
		renderTimeline(state);
		renderMainCanvas(state);
		renderPreview(state);
	};

	if (total > 50) {
		const MAX_BATCH = 16;
		let completed = 0;
		const processFrame = (fi: number) => new Promise<void>((resolve) => {
			floodFillOnData(state.frames[fi].data, w, h, sx, sy, r, g, b, a, tol, aa, targetColor);
			completed++;
			updateFloodProgress(bar, completed, total);
			resolve();
		});
		(async () => {
			for (let start = 0; start < total; start += MAX_BATCH) {
				const batch = [];
				for (let j = start; j < Math.min(start + MAX_BATCH, total); j++) {
					batch.push(processFrame(j));
				}
				await Promise.all(batch);
				await new Promise<void>((rv) => requestAnimationFrame(() => rv()));
			}
			finish();
		})();
	} else {
		let i = 0;
		const step = () => {
			if (i < total) {
				floodFillOnData(state.frames[i].data, w, h, sx, sy, r, g, b, a, tol, aa, targetColor);
				i++;
				updateFloodProgress(bar, i, total);
				requestAnimationFrame(step);
			} else {
				finish();
			}
		};
		step();
	}
}

function compositeCheckerboard(
	src: Uint8ClampedArray, dst: Uint8ClampedArray,
	w: number, h: number, bgColor: [number, number, number],
): void {
	const [bgR, bgG, bgB] = bgColor;
	const bgR2 = 255 - bgR, bgG2 = 255 - bgG, bgB2 = 255 - bgB;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const di = (y * w + x) * 4;
			const checker = (x + y) & 1;
			const cbR = checker ? bgR : bgR2, cbG = checker ? bgG : bgG2, cbB = checker ? bgB : bgB2;
			const a = src[di + 3];
			if (a === 255) {
				dst[di] = src[di]; dst[di + 1] = src[di + 1]; dst[di + 2] = src[di + 2]; dst[di + 3] = 255;
			} else if (a === 0) {
				dst[di] = cbR; dst[di + 1] = cbG; dst[di + 2] = cbB; dst[di + 3] = 255;
			} else {
				const invA = 255 - a;
				dst[di]     = (src[di]     * a + cbR * invA + 127) / 255 | 0;
				dst[di + 1] = (src[di + 1] * a + cbG * invA + 127) / 255 | 0;
				dst[di + 2] = (src[di + 2] * a + cbB * invA + 127) / 255 | 0;
				dst[di + 3] = 255;
			}
		}
	}
}

function paintBrush(state: PropEditorState, cx: number, cy: number, r: number, g: number, b: number, a: number): void {
	const radius = Math.floor(state.brushSize / 2);
	if (radius === 0) {
		setPixel(state, cx, cy, r, g, b, a);
		return;
	}
	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			if (dx * dx + dy * dy <= radius * radius) {
				setPixel(state, cx + dx, cy + dy, r, g, b, a);
			}
		}
	}
}

function drawBresenhamLineBrush(state: PropEditorState, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number): void {
	const dx = Math.abs(x1 - x0);
	const dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx - dy;
	while (true) {
		paintBrush(state, x0, y0, r, g, b, a);
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * err;
		if (e2 > -dy) { err -= dy; x0 += sx; }
		if (e2 < dx) { err += dx; y0 += sy; }
	}
}

function renderAntiAliasedStroke(state: PropEditorState, color: string): Uint8ClampedArray {
	const tmp = document.createElement('canvas');
	tmp.width = state.propW;
	tmp.height = state.propH;
	const ctx = tmp.getContext('2d')!;
	ctx.lineWidth = state.brushSize;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	const path = state._aaPath!;
	if (path.length === 1) {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(path[0].x + 0.5, path[0].y + 0.5, state.brushSize / 2, 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.moveTo(path[0].x + 0.5, path[0].y + 0.5);
		for (let i = 1; i < path.length; i++) {
			ctx.lineTo(path[i].x + 0.5, path[i].y + 0.5);
		}
		ctx.stroke();
	}
	return ctx.getImageData(0, 0, state.propW, state.propH).data;
}

function applyAntiAliasedPath(state: PropEditorState): void {
	if (!state._aaSnapshot || !state._aaPath || state._aaPath.length === 0) return;
	state.pixelData.set(state._aaSnapshot);
	const [r, g, b, a] = state.color;
	const src = renderAntiAliasedStroke(state, `rgba(${r},${g},${b},${a / 255})`);
	const dst = state.pixelData;
	for (let i = 0; i < src.length; i += 4) {
		const sa = src[i + 3];
		if (sa === 0) continue;
		const da = dst[i + 3];
		if (sa === 255 || da === 0) {
			dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = sa;
		} else {
			const outA = sa + da * (255 - sa) / 255;
			dst[i]     = ((src[i]     * sa + dst[i]     * da * (255 - sa) / 255) / outA) | 0;
			dst[i + 1] = ((src[i + 1] * sa + dst[i + 1] * da * (255 - sa) / 255) / outA) | 0;
			dst[i + 2] = ((src[i + 2] * sa + dst[i + 2] * da * (255 - sa) / 255) / outA) | 0;
			dst[i + 3] = outA | 0;
		}
	}
}

function applyAntiAliasedErase(state: PropEditorState): void {
	if (!state._aaSnapshot || !state._aaPath || state._aaPath.length === 0) return;
	state.pixelData.set(state._aaSnapshot);
	const mask = renderAntiAliasedStroke(state, 'white');
	const dst = state.pixelData;
	for (let i = 0; i < mask.length; i += 4) {
		const ma = mask[i + 3];
		if (ma === 0) continue;
		if (ma >= 255) {
			dst[i] = 0; dst[i + 1] = 0; dst[i + 2] = 0; dst[i + 3] = 0;
		} else {
			const remaining = Math.max(0, dst[i + 3] - ma);
			dst[i + 3] = remaining;
			if (remaining === 0) { dst[i] = 0; dst[i + 1] = 0; dst[i + 2] = 0; }
		}
	}
}

function discardFloatingSelection(state: PropEditorState): void {
	state.floatingSelection = null;
	state._floatingTmp = undefined;
	state.selection = null;
	state._hideSelActions?.();
}

function commitFloatingSelection(state: PropEditorState): void {
	if (!state.floatingSelection) return;
	const fs = state.floatingSelection;
	if (state.batchMode && state.frames.length > 1) {
		// Batch mode: commit to all frames
		pushUndoAllFrames(state);
		const w = state.propW;
		const h = state.propH;
		for (let fi = 0; fi < state.frames.length; fi++) {
			const fd = state.frames[fi].data;
			for (let y = 0; y < fs.h; y++) {
				for (let x = 0; x < fs.w; x++) {
					const dx = fs.x + x;
					const dy = fs.y + y;
					if (dx < 0 || dx >= w || dy < 0 || dy >= h) continue;
					const si = (y * fs.w + x) * 4;
					if (fs.data[si + 3] > 0) {
						const di = (dy * w + dx) * 4;
						fd[di] = fs.data[si];
						fd[di + 1] = fs.data[si + 1];
						fd[di + 2] = fs.data[si + 2];
						fd[di + 3] = fs.data[si + 3];
					}
				}
			}
		}
		state.pixelData.set(state.frames[state.currentFrame].data);
		state._frameCache = null;
		renderTimeline(state);
	} else {
		pushUndo(state);
		for (let y = 0; y < fs.h; y++) {
			for (let x = 0; x < fs.w; x++) {
				const si = (y * fs.w + x) * 4;
				const a = fs.data[si + 3];
				if (a > 0) {
					setPixel(state, fs.x + x, fs.y + y, fs.data[si], fs.data[si + 1], fs.data[si + 2], a);
				}
			}
		}
		if (state.frames.length > 1) {
			syncFrameToState(state);
			state._frameCache = null;
			renderTimeline(state);
		}
	}
	state.floatingSelection = null;
	state._floatingTmp = undefined;
	state._floatingOrigin = null;
	state._floatingWasCut = false;
	state._hideSelActions?.();
	state.selection = null;
}

function liftSelection(state: PropEditorState, clearSource: boolean = true): void {
	if (!state.selection || state.floatingSelection) return;
	const sel = state.selection;
	const data = new Uint8ClampedArray(sel.w * sel.h * 4);
	// Extract pixel data from current frame
	for (let y = 0; y < sel.h; y++) {
		for (let x = 0; x < sel.w; x++) {
			const px = getPixel(state, sel.x + x, sel.y + y);
			const di = (y * sel.w + x) * 4;
			data[di] = px[0];
			data[di + 1] = px[1];
			data[di + 2] = px[2];
			data[di + 3] = px[3];
		}
	}
	if (clearSource) {
		if (state.batchMode && state.frames.length > 1) {
			// Batch mode: clear source rect on all frames
			const w = state.propW;
			const h = state.propH;
			for (let fi = 0; fi < state.frames.length; fi++) {
				const fd = state.frames[fi].data;
				for (let cy = sel.y; cy < sel.y + sel.h; cy++) {
					for (let cx = sel.x; cx < sel.x + sel.w; cx++) {
						if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
						const di = (cy * w + cx) * 4;
						fd[di] = 0; fd[di + 1] = 0; fd[di + 2] = 0; fd[di + 3] = 0;
					}
				}
			}
			state.pixelData.set(state.frames[state.currentFrame].data);
			state._frameCache = null;
		} else {
			for (let y = 0; y < sel.h; y++) {
				for (let x = 0; x < sel.w; x++) {
					setPixel(state, sel.x + x, sel.y + y, 0, 0, 0, 0);
				}
			}
		}
	}
	state.floatingSelection = { data, x: sel.x, y: sel.y, w: sel.w, h: sel.h };
	state._floatingOrigin = { x: sel.x, y: sel.y };
	// Cache rendered floating selection as a canvas
	const tmp = document.createElement('canvas');
	tmp.width = sel.w;
	tmp.height = sel.h;
	const tmpCtx = tmp.getContext('2d')!;
	const imgData = tmpCtx.createImageData(sel.w, sel.h);
	imgData.data.set(data);
	tmpCtx.putImageData(imgData, 0, 0);
	state._floatingTmp = tmp;
}

type UndoEntry = { pixels: Uint8ClampedArray } | { allFrames: Uint8ClampedArray[]; pixels: Uint8ClampedArray };

function pushUndo(state: PropEditorState): void {
	state.undoStack.push({ pixels: new Uint8ClampedArray(state.pixelData) });
	state.redoStack.length = 0;
}

function pushUndoAllFrames(state: PropEditorState): void {
	syncFrameToState(state);
	const allFrames = state.frames.map(f => new Uint8ClampedArray(f.data));
	state.undoStack.push({ allFrames, pixels: new Uint8ClampedArray(state.pixelData) });
	state.redoStack.length = 0;
}

function performUndo(state: PropEditorState): boolean {
	if (state.undoStack.length === 0) return false;
	const entry = state.undoStack.pop()!;
	if ('allFrames' in entry) {
		syncFrameToState(state);
		const redoEntry: UndoEntry = { allFrames: state.frames.map(f => new Uint8ClampedArray(f.data)), pixels: new Uint8ClampedArray(state.pixelData) };
		state.redoStack.push(redoEntry);
		for (let i = 0; i < state.frames.length && i < entry.allFrames.length; i++) {
			state.frames[i].data.set(entry.allFrames[i]);
		}
		state.pixelData.set(state.frames[state.currentFrame].data);
		state._frameCache = null;
	} else {
		state.redoStack.push({ pixels: new Uint8ClampedArray(state.pixelData) });
		state.pixelData.set(entry.pixels);
		if (state.frames.length > 1) {
			state.frames[state.currentFrame].data.set(state.pixelData);
			state._frameCache = null;
		}
	}
	return true;
}

function performRedo(state: PropEditorState): boolean {
	if (state.redoStack.length === 0) return false;
	const entry = state.redoStack.pop()!;
	if ('allFrames' in entry) {
		syncFrameToState(state);
		const undoEntry: UndoEntry = { allFrames: state.frames.map(f => new Uint8ClampedArray(f.data)), pixels: new Uint8ClampedArray(state.pixelData) };
		state.undoStack.push(undoEntry);
		for (let i = 0; i < state.frames.length && i < entry.allFrames.length; i++) {
			state.frames[i].data.set(entry.allFrames[i]);
		}
		state.pixelData.set(state.frames[state.currentFrame].data);
		state._frameCache = null;
	} else {
		state.undoStack.push({ pixels: new Uint8ClampedArray(state.pixelData) });
		state.pixelData.set(entry.pixels);
		if (state.frames.length > 1) {
			state.frames[state.currentFrame].data.set(state.pixelData);
			state._frameCache = null;
		}
	}
	return true;
}

// ─── Animation Frame Management ───

function syncFrameToState(state: PropEditorState): void {
	if (state.frames.length > 0) {
		state.frames[state.currentFrame].data.set(state.pixelData);
	}
}

function switchToFrame(state: PropEditorState, index: number): void {
	if (index < 0 || index >= state.frames.length) return;
	syncFrameToState(state);
	state.currentFrame = index;
	state.pixelData.set(state.frames[index].data);
	state.undoStack.length = 0;
	state.redoStack.length = 0;
	if (state.floatingSelection) {
		commitFloatingSelection(state);
	}
}

function addFrame(state: PropEditorState, afterIndex?: number): void {
	const ins = (afterIndex ?? state.currentFrame) + 1;
	const delay = state.frames.length > 0 ? state.frames[state.currentFrame].delay : 50;
	const newFrame: AnimFrame = { data: new Uint8ClampedArray(state.propW * state.propH * 4), delay };
	state.frames.splice(ins, 0, newFrame);
	state.flags.animated = state.frames.length > 1;
	switchToFrame(state, ins);
}

function duplicateFrame(state: PropEditorState): void {
	syncFrameToState(state);
	const src = state.frames[state.currentFrame];
	const ins = state.currentFrame + 1;
	state.frames.splice(ins, 0, { data: new Uint8ClampedArray(src.data), delay: src.delay });
	state.flags.animated = state.frames.length > 1;
	switchToFrame(state, ins);
}

function deleteFrame(state: PropEditorState): void {
	if (state.frames.length <= 1) return;
	state.frames.splice(state.currentFrame, 1);
	state.flags.animated = state.frames.length > 1;
	const idx = Math.min(state.currentFrame, state.frames.length - 1);
	state.currentFrame = idx;
	state.pixelData.set(state.frames[idx].data);
	state.undoStack.length = 0;
	state.redoStack.length = 0;
}

function moveFrame(state: PropEditorState, from: number, to: number): void {
	if (from === to || to < 0 || to >= state.frames.length) return;
	const [frame] = state.frames.splice(from, 1);
	state.frames.splice(to, 0, frame);
	state.currentFrame = to;
}

function stopAnimation(state: PropEditorState): void {
	if (state.animTimer !== null) {
		clearTimeout(state.animTimer);
		state.animTimer = null;
	}
	state.animPlaying = false;
	state._frameCache = null;
}

/** Pre-render all frames into cached canvases for fast playback */
function buildFrameCache(state: PropEditorState): HTMLCanvasElement[] {
	const propW = state.propW;
	const propH = state.propH;
	return state.frames.map(frame => {
		const c = document.createElement('canvas');
		c.width = propW;
		c.height = propH;
		const ctx = c.getContext('2d')!;
		const imgData = ctx.createImageData(propW, propH);
		compositeCheckerboard(frame.data, imgData.data, propW, propH, state.bgColor);
		ctx.putImageData(imgData, 0, 0);
		return c;
	});
}

/** Fast render path during animation playback — draws from cached canvas */
function renderPlaybackFrame(state: PropEditorState): void {
	const cache = state._frameCache;
	if (!cache) return;
	const ctx = state.mainCtx;
	const cw = state.mainCanvas.width;
	const ch = state.mainCanvas.height;
	const z = state.zoom;
	const pw = state.propW * z;
	const ph = state.propH * z;
	const ox = Math.floor((cw - pw) / 2);
	const oy = Math.floor((ch - ph) / 2);

	ctx.fillStyle = '#1a1a1a';
	ctx.fillRect(0, 0, cw, ch);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(cache[state.currentFrame], 0, 0, state.propW, state.propH, ox, oy, pw, ph);

	// Border around prop area
	ctx.strokeStyle = '#0ff3';
	ctx.lineWidth = 1;
	ctx.strokeRect(ox - 0.5, oy - 0.5, pw + 1, ph + 1);
}

/** Lightweight timeline highlight update — avoids full DOM rebuild */
function updateTimelineHighlight(state: PropEditorState): void {
	const el = state.timelineEl;
	if (!el) return;
	const cells = el.querySelectorAll('.pe-frame-cell');
	cells.forEach((cell, i) => {
		cell.classList.toggle('active', i === state.currentFrame);
	});
	const countLabel = el.querySelector('.pe-frame-count') as HTMLSpanElement | null;
	if (countLabel) {
		countLabel.textContent = `${state.currentFrame + 1}/${state.frames.length}`;
	}
	const delayInput = el.querySelector('.pe-frame-delay') as HTMLInputElement | null;
	if (delayInput) {
		delayInput.value = String(state.frames[state.currentFrame].delay);
	}
}

function playAnimation(state: PropEditorState, renderCb: () => void, timelineCb: () => void): void {
	if (state.frames.length <= 1) return;
	syncFrameToState(state);
	state.animPlaying = true;
	state._frameCache = buildFrameCache(state);

	const step = () => {
		if (!state.animPlaying) return;
		const frame = state.frames[state.currentFrame];
		state.pixelData.set(frame.data);
		renderCb();

		const next = (state.currentFrame + 1) % state.frames.length;
		state.animTimer = window.setTimeout(() => {
			state.currentFrame = next;
			timelineCb();
			step();
		}, frame.delay);
	};
	step();
}

function buildFrameThumb(state: PropEditorState, frame: AnimFrame): HTMLCanvasElement {
	const thumbSize = 48;
	const c = document.createElement('canvas');
	c.width = thumbSize;
	c.height = thumbSize;
	const ctx = c.getContext('2d')!;
	// checkerboard bg
	for (let y = 0; y < thumbSize; y += 4) {
		for (let x = 0; x < thumbSize; x += 4) {
			ctx.fillStyle = ((x / 4 + y / 4) % 2 === 0) ? '#2a2a2a' : '#222';
			ctx.fillRect(x, y, 4, 4);
		}
	}
	const tmpC = document.createElement('canvas');
	tmpC.width = state.propW;
	tmpC.height = state.propH;
	const tmpCtx = tmpC.getContext('2d')!;
	const imgData = tmpCtx.createImageData(state.propW, state.propH);
	imgData.data.set(frame.data);
	tmpCtx.putImageData(imgData, 0, 0);
	// fit into thumb maintaining aspect ratio
	const scale = Math.min(thumbSize / state.propW, thumbSize / state.propH);
	const dw = state.propW * scale;
	const dh = state.propH * scale;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(tmpC, (thumbSize - dw) / 2, (thumbSize - dh) / 2, dw, dh);
	return c;
}

function renderTimeline(state: PropEditorState): void {
	const el = state.timelineEl;
	if (!el) return;
	const strip = el.querySelector('.pe-frame-strip') as HTMLDivElement;
	if (!strip) return;
	strip.innerHTML = '';
	state.frames.forEach((frame, i) => {
		const cell = document.createElement('div');
		cell.className = 'pe-frame-cell' + (i === state.currentFrame ? ' active' : '');
		cell.title = `Frame ${i + 1} (${frame.delay}ms)`;
		cell.draggable = true;

		const thumb = buildFrameThumb(state, frame);
		thumb.className = 'pe-frame-thumb';
		cell.appendChild(thumb);

		const label = document.createElement('span');
		label.className = 'pe-frame-label';
		label.textContent = `${i + 1}`;
		cell.appendChild(label);

		cell.addEventListener('click', () => {
			if (state.animPlaying) return;
			switchToFrame(state, i);
			renderTimeline(state);
			renderMainCanvas(state);
			renderPreview(state);
		});

		// Drag reorder
		cell.addEventListener('dragstart', (e) => {
			e.dataTransfer!.setData('text/plain', String(i));
			cell.classList.add('dragging');
		});
		cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
		cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
		cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
		cell.addEventListener('drop', (e) => {
			e.preventDefault();
			cell.classList.remove('drag-over');
			const from = Number(e.dataTransfer!.getData('text/plain'));
			if (from !== i) {
				moveFrame(state, from, i);
				state.pixelData.set(state.frames[state.currentFrame].data);
				renderTimeline(state);
				renderMainCanvas(state);
				renderPreview(state);
			}
		});

		strip.appendChild(cell);
	});

	// Update delay input value
	const delayInput = el.querySelector('.pe-frame-delay') as HTMLInputElement | null;
	if (delayInput && state.frames.length > 0) {
		delayInput.value = String(state.frames[state.currentFrame].delay);
	}

	// Update frame count label
	const countLabel = el.querySelector('.pe-frame-count') as HTMLSpanElement | null;
	if (countLabel) {
		countLabel.textContent = `${state.currentFrame + 1}/${state.frames.length}`;
	}
}

function createTimelineBar(state: PropEditorState): HTMLDivElement {
	const bar = document.createElement('div');
	bar.className = 'pe-timeline';

	// Toggle header
	const toggleHeader = document.createElement('div');
	toggleHeader.className = 'pe-timeline-toggle';
	const toggleArrow = document.createElement('span');
	toggleArrow.className = 'pe-timeline-arrow';
	toggleArrow.textContent = '▾';
	const toggleLabel = document.createElement('span');
	toggleLabel.className = 'pe-timeline-toggle-label';
	toggleLabel.textContent = 'Animation';
	toggleHeader.appendChild(toggleArrow);
	toggleHeader.appendChild(toggleLabel);
	toggleHeader.addEventListener('click', () => {
		const collapsed = bar.classList.toggle('collapsed');
		toggleArrow.textContent = collapsed ? '▸' : '▾';
	});
	bar.appendChild(toggleHeader);

	// Collapsible content wrapper
	const content = document.createElement('div');
	content.className = 'pe-timeline-content';

	// Controls row
	const controls = document.createElement('div');
	controls.className = 'pe-timeline-controls';

	// Play/Pause
	const playBtn = document.createElement('button');
	playBtn.className = 'pe-timeline-btn pe-play-btn';
	playBtn.title = 'Play/Pause animation';
	playBtn.textContent = '▶';
	playBtn.addEventListener('click', () => {
		if (state.animPlaying) {
			stopAnimation(state);
			playBtn.textContent = '▶';
			state.pixelData.set(state.frames[state.currentFrame].data);
			renderTimeline(state);
			renderMainCanvas(state);
			renderPreview(state);
		} else {
			playBtn.textContent = '⏸';
			playAnimation(state,
				() => { renderPlaybackFrame(state); renderPreview(state); },
				() => { updateTimelineHighlight(state); }
			);
		}
	});
	controls.appendChild(playBtn);

	// Add frame
	const addBtn = document.createElement('button');
	addBtn.className = 'pe-timeline-btn';
	addBtn.title = 'Add empty frame';
	addBtn.textContent = '+';
	addBtn.addEventListener('click', () => {
		if (state.animPlaying) return;
		addFrame(state);
		renderTimeline(state);
		renderMainCanvas(state);
		renderPreview(state);
	});
	controls.appendChild(addBtn);

	// Duplicate frame
	const dupBtn = document.createElement('button');
	dupBtn.className = 'pe-timeline-btn';
	dupBtn.title = 'Duplicate frame';
	dupBtn.textContent = '⧉';
	dupBtn.addEventListener('click', () => {
		if (state.animPlaying) return;
		duplicateFrame(state);
		renderTimeline(state);
		renderMainCanvas(state);
		renderPreview(state);
	});
	controls.appendChild(dupBtn);

	// Delete frame
	const delBtn = document.createElement('button');
	delBtn.className = 'pe-timeline-btn';
	delBtn.title = 'Delete frame';
	delBtn.textContent = '🗑';
	delBtn.addEventListener('click', () => {
		if (state.animPlaying || state.frames.length <= 1) return;
		deleteFrame(state);
		renderTimeline(state);
		renderMainCanvas(state);
		renderPreview(state);
	});
	controls.appendChild(delBtn);

	// Separator
	const sep = document.createElement('span');
	sep.className = 'pe-timeline-sep';
	controls.appendChild(sep);

	// Frame count
	const countLabel = document.createElement('span');
	countLabel.className = 'pe-frame-count';
	countLabel.textContent = `${state.currentFrame + 1}/${state.frames.length}`;
	controls.appendChild(countLabel);

	// Delay input
	const delayLabel = document.createElement('span');
	delayLabel.className = 'pe-timeline-label';
	delayLabel.textContent = 'Delay:';
	controls.appendChild(delayLabel);

	const delayInput = document.createElement('input');
	delayInput.type = 'number';
	delayInput.className = 'pe-frame-delay';
	delayInput.min = '10';
	delayInput.max = '10000';
	delayInput.step = '10';
	delayInput.value = state.frames.length > 0 ? String(state.frames[state.currentFrame].delay) : '50';
	delayInput.addEventListener('change', () => {
		if (state.frames.length > 0) {
			state.frames[state.currentFrame].delay = Math.max(10, +delayInput.value || 50);
			delayInput.value = String(state.frames[state.currentFrame].delay);
		}
	});
	controls.appendChild(delayInput);

	const msLabel = document.createElement('span');
	msLabel.className = 'pe-timeline-label';
	msLabel.textContent = 'ms';
	controls.appendChild(msLabel);

	// Set all delays
	const setAllBtn = document.createElement('button');
	setAllBtn.className = 'pe-timeline-btn';
	setAllBtn.title = 'Set all frames to this delay';
	setAllBtn.textContent = 'All';
	setAllBtn.addEventListener('click', () => {
		const d = Math.max(10, +delayInput.value || 50);
		for (const f of state.frames) f.delay = d;
	});
	controls.appendChild(setAllBtn);

	// Separator
	const sep2 = document.createElement('span');
	sep2.className = 'pe-timeline-sep';
	controls.appendChild(sep2);

	// Onion skin toggle
	const onionBtn = document.createElement('button');
	onionBtn.className = 'pe-timeline-btn' + (state.onionSkin ? ' active' : '');
	onionBtn.title = 'Onion skinning';
	onionBtn.textContent = '🧅';
	onionBtn.addEventListener('click', () => {
		state.onionSkin = !state.onionSkin;
		onionBtn.classList.toggle('active', state.onionSkin);
		renderMainCanvas(state);
	});
	controls.appendChild(onionBtn);

	// Batch mode toggle
	const batchBtn = document.createElement('button');
	batchBtn.className = 'pe-timeline-btn' + (state.batchMode ? ' active' : '');
	batchBtn.title = 'Apply drawing to all frames';
	batchBtn.textContent = '⚡';
	batchBtn.addEventListener('click', () => {
		state.batchMode = !state.batchMode;
		batchBtn.classList.toggle('active', state.batchMode);
	});
	controls.appendChild(batchBtn);

	content.appendChild(controls);

	// Frame strip (scrollable thumbnails)
	const strip = document.createElement('div');
	strip.className = 'pe-frame-strip';
	content.appendChild(strip);

	bar.appendChild(content);

	state.timelineEl = bar;
	renderTimeline(state);
	return bar;
}

function applyBatchDiff(state: PropEditorState, before: Uint8ClampedArray): void {
	if (!state.batchMode || state.frames.length <= 1) return;
	const len = state.pixelData.length;
	for (let fi = 0; fi < state.frames.length; fi++) {
		if (fi === state.currentFrame) continue;
		const fd = state.frames[fi].data;
		for (let i = 0; i < len; i += 4) {
			if (state.pixelData[i] !== before[i] || state.pixelData[i + 1] !== before[i + 1] ||
				state.pixelData[i + 2] !== before[i + 2] || state.pixelData[i + 3] !== before[i + 3]) {
				fd[i] = state.pixelData[i];
				fd[i + 1] = state.pixelData[i + 1];
				fd[i + 2] = state.pixelData[i + 2];
				fd[i + 3] = state.pixelData[i + 3];
			}
		}
	}
}

// ─── Rendering ───

function renderMainCanvas(state: PropEditorState): void {
	const ctx = state.mainCtx;
	const cw = state.mainCanvas.width;
	const ch = state.mainCanvas.height;
	const z = state.zoom;
	const pw = state.propW * z;
	const ph = state.propH * z;
	const ox = Math.floor((cw - pw) / 2);
	const oy = Math.floor((ch - ph) / 2);
	const propW = state.propW;
	const propH = state.propH;
	const pixelData = state.pixelData;

	// Background fill
	ctx.fillStyle = '#1a1a1a';
	ctx.fillRect(0, 0, cw, ch);

	// Build a 1:1 ImageData with checkerboard + pixel compositing
	const imgData = ctx.createImageData(propW, propH);
	compositeCheckerboard(pixelData, imgData.data, propW, propH, state.bgColor);

	// Put 1:1 image onto a temp canvas and draw scaled
	const tmp = state._renderTmp ??= document.createElement('canvas');
	if (tmp.width !== propW || tmp.height !== propH) {
		tmp.width = propW;
		tmp.height = propH;
	}
	const tmpCtx = tmp.getContext('2d')!;
	tmpCtx.putImageData(imgData, 0, 0);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(tmp, 0, 0, propW, propH, ox, oy, pw, ph);

	// Onion skinning — draw previous/next frames as faint overlays
	if (state.onionSkin && state.frames.length > 1 && !state.animPlaying) {
		const drawOnionFrame = (frameIdx: number, tint: string, alpha: number) => {
			const f = state.frames[frameIdx];
			if (!f) return;
			// Build onion frame in the temp canvas
			tmpCtx.clearRect(0, 0, propW, propH);
			const onionData = tmpCtx.createImageData(propW, propH);
			onionData.data.set(f.data);
			tmpCtx.putImageData(onionData, 0, 0);
			// Apply tint inside the temp canvas using source-atop
			tmpCtx.globalCompositeOperation = 'source-atop';
			tmpCtx.fillStyle = tint;
			tmpCtx.fillRect(0, 0, propW, propH);
			tmpCtx.globalCompositeOperation = 'source-over';
			// Draw tinted onion frame onto main canvas at reduced opacity
			ctx.globalAlpha = alpha;
			ctx.drawImage(tmp, 0, 0, propW, propH, ox, oy, pw, ph);
			ctx.globalAlpha = 1;
		};
		const prevIdx = state.currentFrame - 1;
		const nextIdx = state.currentFrame + 1;
		if (prevIdx >= 0) drawOnionFrame(prevIdx, 'rgba(255,0,0,0.5)', state.onionOpacity);
		if (nextIdx < state.frames.length) drawOnionFrame(nextIdx, 'rgba(0,0,255,0.5)', state.onionOpacity);
	}

	// Grid lines when zoomed in enough
	if (z >= 4) {
		ctx.strokeStyle = 'rgba(255,255,255,0.08)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 0; x <= propW; x++) {
			const px = ox + x * z + 0.5;
			ctx.moveTo(px, oy);
			ctx.lineTo(px, oy + ph);
		}
		for (let y = 0; y <= propH; y++) {
			const py = oy + y * z + 0.5;
			ctx.moveTo(ox, py);
			ctx.lineTo(ox + pw, py);
		}
		ctx.stroke();
	}

	// Border around prop area
	ctx.strokeStyle = '#0ff3';
	ctx.lineWidth = 1;
	ctx.strokeRect(ox - 0.5, oy - 0.5, pw + 1, ph + 1);

	// Floating selection pixels
	if (state.floatingSelection && state._floatingTmp) {
		const fs = state.floatingSelection;
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(state._floatingTmp, 0, 0, fs.w, fs.h, ox + fs.x * z, oy + fs.y * z, fs.w * z, fs.h * z);
	}

	// Selection overlay
	const selRect = state.floatingSelection
		? state.floatingSelection
		: state.selection;
	if (selRect) {
		const sx = ox + selRect.x * z;
		const sy = oy + selRect.y * z;
		const sw = selRect.w * z;
		const sh = selRect.h * z;
		ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
		ctx.fillRect(sx, sy, sw, sh);
		ctx.strokeStyle = '#0ff';
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);
		ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
		ctx.setLineDash([]);
	}
}

function renderPreview(state: PropEditorState): void {
	const ctx = state.previewCtx;
	const cw = state.previewCanvas.width;
	const ch = state.previewCanvas.height;

	// Clear
	ctx.clearRect(0, 0, cw, ch);

	// Draw checkerboard bg
	const [pBgR, pBgG, pBgB] = state.bgColor;
	const pBg1 = `rgb(${pBgR},${pBgG},${pBgB})`;
	const pBg2 = `rgb(${255 - pBgR},${255 - pBgG},${255 - pBgB})`;
	for (let y = 0; y < ch; y += 8) {
		for (let x = 0; x < cw; x += 8) {
			ctx.fillStyle = ((x / 8 + y / 8) % 2 === 0) ? pBg1 : pBg2;
			ctx.fillRect(x, y, 8, 8);
		}
	}

	// Build prop image from pixel data (1:1, no scaling)
	const propImgData = new ImageData(new Uint8ClampedArray(state.pixelData), state.propW, state.propH);
	const tmpCanvas = state._previewTmp ??= document.createElement('canvas');
	if (tmpCanvas.width !== state.propW || tmpCanvas.height !== state.propH) {
		tmpCanvas.width = state.propW;
		tmpCanvas.height = state.propH;
	}
	const tmpCtx = tmpCanvas.getContext('2d')!;
	tmpCtx.putImageData(propImgData, 0, 0);

	// Composite floating selection onto prop image
	if (state.floatingSelection && state._floatingTmp) {
		tmpCtx.drawImage(state._floatingTmp, state.floatingSelection.x, state.floatingSelection.y);
	}

	// Avatar center in preview (smiley is 44x44, avatar origin is center-21)
	const avatarX = 88;
	const avatarY = 88;

	// Smiley face (user's current or random fallback)
	const user = palace.theUser;
	const showSmiley = !state.flags.head;
	if (showSmiley) {
		let smileyKey: string;
		if (user) {
			smileyKey = `${user.face},${user.color}`;
		} else {
			const keys = Object.keys(smileys);
			smileyKey = keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : '';
		}
		const smileyImg = smileyKey ? smileys[smileyKey] : null;
		if (smileyImg && smileyImg.complete) {
			ctx.drawImage(smileyImg, avatarX, avatarY, 44, 44);
		}
	}

	// Draw prop at its x,y offsets relative to the avatar origin (like room rendering)
	if (state.flags.ghost) ctx.globalAlpha = 0.5;
	const drawX = avatarX + state.propX;
	const drawY = avatarY + state.propY;
	if (palace.debugMode) console.log('drawing prop at', state.propX, state.propY);
	ctx.drawImage(tmpCanvas, drawX, drawY);
	ctx.globalAlpha = 1;

	// Name tag – real DOM element using .avnametag class to match room rendering exactly
	// Room formula (nameRectBounds): nametag top = user.y + 2 + nameHeight/2
	// user.y equivalent in preview = avatarY + 21 (avatar div positioned at user.y - 21)
	const nametag = state.previewNametag;
	if (state.flags.showNameTag && user) {
		nametag.innerText = user.name;
		nametag.style.color = getHsl(user.color, 60);
		nametag.style.display = '';
		// Position after render so offsetWidth/offsetHeight are available
		requestAnimationFrame(() => {
			const nameW = nametag.offsetWidth;
			const nameH = nametag.offsetHeight;
			const userY = avatarY + 22;
			const nameTop = Math.round(userY + 2 + nameH / 2);
			const nameLeft = Math.round((cw / 2) - (nameW / 2));
			nametag.style.transform = `translate(${nameLeft}px,${nameTop}px)`;
		});
	} else {
		nametag.style.display = 'none';
	}
}

// ─── Mouse helpers ───

function canvasToPixelUnbounded(state: PropEditorState, e: MouseEvent): { x: number; y: number } {
	const rect = state.mainCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;
	const z = state.zoom;
	const cw = state.mainCanvas.width;
	const ch = state.mainCanvas.height;
	const pw = state.propW * z;
	const ph = state.propH * z;
	const ox = Math.floor((cw - pw) / 2);
	const oy = Math.floor((ch - ph) / 2);
	return { x: Math.floor((mx - ox) / z), y: Math.floor((my - oy) / z) };
}

function canvasToPixel(state: PropEditorState, e: MouseEvent): { x: number; y: number } | null {
	const p = canvasToPixelUnbounded(state, e);
	if (p.x < 0 || p.x >= state.propW || p.y < 0 || p.y >= state.propH) return null;
	return p;
}

// ─── Toolbar ───

const TOOLS: { id: PETool; icon: string; title: string }[] = [
	{ id: 'pen', icon: '✏', title: 'Pen' },
	{ id: 'eraser', icon: '🧽', title: 'Eraser' },
	{ id: 'eyedropper', icon: '💧', title: 'Eyedropper' },
	{ id: 'fill', icon: '🪣', title: 'Fill' },
	{ id: 'zoom', icon: '🔍', title: 'Zoom (L=in, R=out)' },
	{ id: 'select', icon: '⬚', title: 'Select' },
];

function createToolbar(state: PropEditorState, onToolChange?: () => void): HTMLDivElement {
	const bar = document.createElement('div');
	bar.className = 'pe-toolbar';

	const buttons: Record<string, HTMLButtonElement> = {};
	for (const t of TOOLS) {
		const btn = document.createElement('button');
		btn.className = 'pe-tool-btn';
		btn.title = t.title;
		btn.textContent = t.icon;
		btn.dataset.tool = t.id;
		if (t.id === state.tool) btn.classList.add('active');
		btn.addEventListener('click', () => {
			if (state.floatingSelection && t.id !== 'select') {
				commitFloatingSelection(state);
				renderMainCanvas(state);
				renderPreview(state);
			}
			state.tool = t.id;
			for (const k in buttons) buttons[k].classList.remove('active');
			btn.classList.add('active');
			updateCanvasCursor(state);
			onToolChange?.();
		});
		buttons[t.id] = btn;
		bar.appendChild(btn);
	}

	return bar;
}

function updateToolOptions(state: PropEditorState, container: HTMLDivElement): void {
	container.innerHTML = '';

	if (state.tool === 'pen' || state.tool === 'eraser') {
		const sizeRow = document.createElement('div');
		sizeRow.className = 'pe-option-row';
		const sizeLabel = document.createElement('span');
		sizeLabel.textContent = `Size: ${state.brushSize}`;
		const sizeInput = document.createElement('input');
		sizeInput.type = 'range';
		sizeInput.min = '1';
		sizeInput.max = '20';
		sizeInput.value = String(state.brushSize);
		sizeInput.addEventListener('input', () => {
			state.brushSize = +sizeInput.value;
			sizeLabel.textContent = `Size: ${state.brushSize}`;
		});
		sizeRow.appendChild(sizeLabel);
		sizeRow.appendChild(sizeInput);
		container.appendChild(sizeRow);
	}

	if (state.tool === 'pen') {
		const aaRow = document.createElement('label');
		aaRow.className = 'pe-option-row';
		const aaInput = document.createElement('input');
		aaInput.type = 'checkbox';
		aaInput.checked = state.antiAlias;
		aaInput.addEventListener('change', () => { state.antiAlias = aaInput.checked; });
		aaRow.appendChild(aaInput);
		aaRow.appendChild(document.createTextNode(' Anti-aliasing'));
		container.appendChild(aaRow);
	}

	if (state.tool === 'eraser') {
		const feRow = document.createElement('label');
		feRow.className = 'pe-option-row';
		const feInput = document.createElement('input');
		feInput.type = 'checkbox';
		feInput.checked = state.floodErase;
		feInput.addEventListener('change', () => {
			state.floodErase = feInput.checked;
			updateToolOptions(state, container);
		});
		feRow.appendChild(feInput);
		feRow.appendChild(document.createTextNode(' Flood erase'));
		container.appendChild(feRow);

		if (!state.floodErase) {
			const eAaRow = document.createElement('label');
			eAaRow.className = 'pe-option-row';
			const eAaInput = document.createElement('input');
			eAaInput.type = 'checkbox';
			eAaInput.checked = state.antiAlias;
			eAaInput.addEventListener('change', () => { state.antiAlias = eAaInput.checked; });
			eAaRow.appendChild(eAaInput);
			eAaRow.appendChild(document.createTextNode(' Anti-aliasing'));
			container.appendChild(eAaRow);
		}

		if (state.floodErase) {
			const tolRow = document.createElement('div');
			tolRow.className = 'pe-option-row';
			const tolLabel = document.createElement('span');
			tolLabel.textContent = `Tolerance: ${state.tolerance}`;
			const tolInput = document.createElement('input');
			tolInput.type = 'range';
			tolInput.min = '0';
			tolInput.max = '255';
			tolInput.value = String(state.tolerance);
			tolInput.addEventListener('input', () => {
				state.tolerance = +tolInput.value;
				tolLabel.textContent = `Tolerance: ${state.tolerance}`;
			});
			tolRow.appendChild(tolLabel);
			tolRow.appendChild(tolInput);
			container.appendChild(tolRow);

			const feAaRow = document.createElement('label');
			feAaRow.className = 'pe-option-row';
			const feAaInput = document.createElement('input');
			feAaInput.type = 'checkbox';
			feAaInput.checked = state.fillAntiAlias;
			feAaInput.addEventListener('change', () => { state.fillAntiAlias = feAaInput.checked; });
			feAaRow.appendChild(feAaInput);
			feAaRow.appendChild(document.createTextNode(' Anti-aliasing'));
			container.appendChild(feAaRow);
		}
	}

	if (state.tool === 'fill') {
		const tolRow = document.createElement('div');
		tolRow.className = 'pe-option-row';
		const tolLabel = document.createElement('span');
		tolLabel.textContent = `Tolerance: ${state.tolerance}`;
		const tolInput = document.createElement('input');
		tolInput.type = 'range';
		tolInput.min = '0';
		tolInput.max = '255';
		tolInput.value = String(state.tolerance);
		tolInput.addEventListener('input', () => {
			state.tolerance = +tolInput.value;
			tolLabel.textContent = `Tolerance: ${state.tolerance}`;
		});
		tolRow.appendChild(tolLabel);
		tolRow.appendChild(tolInput);
		container.appendChild(tolRow);

		const fillAaRow = document.createElement('label');
		fillAaRow.className = 'pe-option-row';
		const fillAaInput = document.createElement('input');
		fillAaInput.type = 'checkbox';
		fillAaInput.checked = state.fillAntiAlias;
		fillAaInput.addEventListener('change', () => { state.fillAntiAlias = fillAaInput.checked; });
		fillAaRow.appendChild(fillAaInput);
		fillAaRow.appendChild(document.createTextNode(' Anti-aliasing'));
		container.appendChild(fillAaRow);
	}

	if (state.tool === 'select') {
		const codRow = document.createElement('label');
		codRow.className = 'pe-option-row';
		const codInput = document.createElement('input');
		codInput.type = 'checkbox';
		codInput.checked = state.clearOnDrag;
		codInput.addEventListener('change', () => { state.clearOnDrag = codInput.checked; });
		codRow.appendChild(codInput);
		codRow.appendChild(document.createTextNode(' Clear when dragged'));
		container.appendChild(codRow);
	}
}

function updateCanvasCursor(state: PropEditorState): void {
	const cursors: Record<PETool, string> = {
		pen: 'url(img/pen.cur), crosshair',
		eraser: 'url(img/eraser.cur), crosshair',
		eyedropper: 'url(img/eyedropper.svg) 4 27, crosshair',
		fill: 'url(img/bucket.cur), crosshair',
		zoom: 'zoom-in',
		select: 'crosshair',
	};
	state.mainCanvas.style.cursor = cursors[state.tool] || 'crosshair';
}

// ─── Main editor ───

export function openPropEditor(prop?: PalaceProp, prebuiltFrames?: AnimFrame[]): void {
	// Room renders props at their image's natural dimensions (background-image with no background-size),
	// not at prop.w/prop.h. Use natural dimensions to match room rendering.
	const propW = Math.min(prop && prop.img ? prop.img.naturalWidth : (prop ? prop.w : PROP_DEFAULT_W), PROP_MAX_W);
	const propH = Math.min(prop && prop.img ? prop.img.naturalHeight : (prop ? prop.h : PROP_DEFAULT_H), PROP_MAX_H);

	const colorInput = document.createElement('input');
	colorInput.type = 'text';
	colorInput.setAttribute('data-coloris', '');
	colorInput.value = 'rgba(0, 128, 0, 1)';
	colorInput.className = 'pe-color-btn';
	colorInput.style.backgroundColor = 'rgba(0, 128, 0, 1)';

	const state: PropEditorState = {
		dialog: document.createElement('div'),
		mainCanvas: document.createElement('canvas'),
		mainCtx: null as any,
		previewCanvas: document.createElement('canvas'),
		previewCtx: null as any,
		previewWrapper: null as any,
		previewNametag: null as any,
		pixelData: new Uint8ClampedArray(propW * propH * 4),
		propW,
		propH,
		propX: prop ? prop.x : 0,
		propY: prop ? prop.y : 0,
		zoom: 4,
		tool: 'pen',
		color: [0, 128, 0, 255],
		colorInput,
		bgColor: [42, 42, 42],
		propName: prop ? prop.name : '',
		flags: {
			head: prop ? prop.head : false,
			ghost: prop ? prop.ghost : false,
			animated: prop ? prop.animated : false,
			bounce: prop ? prop.bounce : false,
			showNameTag: true,
		},
		drawing: false,
		lastPixel: null,
		selection: null,
		selecting: false,
		selectStart: null,
		floatingSelection: null,
		_floatingOrigin: null,
		_floatingWasCut: false,
		prop: prop || null,
		onSave: null,
		brushSize: 1,
		antiAlias: false,
		floodErase: false,
		fillAntiAlias: false,
		tolerance: 0,
		clearOnDrag: true,
		undoStack: [],
		redoStack: [],
		// Animation
		frames: [],
		currentFrame: 0,
		onionSkin: false,
		onionOpacity: 0.3,
		animPlaying: false,
		animTimer: null,
		timelineEl: null,
		batchMode: false,
		_frameCache: null,
		_floodInProgress: false,
	};

	// Restore saved tool settings from preferences
	const savedSettings = getGeneralPref('propEditorSettings') as Record<string, unknown> | undefined;
	if (savedSettings) {
		if (savedSettings.tool && typeof savedSettings.tool === 'string') state.tool = savedSettings.tool as PETool;
		if (typeof savedSettings.brushSize === 'number') state.brushSize = savedSettings.brushSize;
		if (typeof savedSettings.antiAlias === 'boolean') state.antiAlias = savedSettings.antiAlias;
		if (typeof savedSettings.floodErase === 'boolean') state.floodErase = savedSettings.floodErase;
		if (typeof savedSettings.fillAntiAlias === 'boolean') state.fillAntiAlias = savedSettings.fillAntiAlias;
		if (typeof savedSettings.tolerance === 'number') state.tolerance = savedSettings.tolerance;
		if (typeof savedSettings.clearOnDrag === 'boolean') state.clearOnDrag = savedSettings.clearOnDrag;
		if (Array.isArray(savedSettings.color) && savedSettings.color.length === 4) {
			state.color = savedSettings.color as [number, number, number, number];
			const [r, g, b, a] = state.color;
			const val = `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
			state.colorInput.value = val;
			state.colorInput.style.backgroundColor = val;
		}
		if (Array.isArray(savedSettings.bgColor) && savedSettings.bgColor.length === 3) {
			state.bgColor = savedSettings.bgColor as [number, number, number];
		}
		if (typeof savedSettings.onionSkin === 'boolean') state.onionSkin = savedSettings.onionSkin;
		if (typeof savedSettings.onionOpacity === 'number') state.onionOpacity = savedSettings.onionOpacity;
		if (typeof savedSettings.batchMode === 'boolean') state.batchMode = savedSettings.batchMode;
	}

	state.mainCtx = state.mainCanvas.getContext('2d')!;
	state.previewCtx = state.previewCanvas.getContext('2d')!;

	// Load existing prop image/animation into pixel data
	const initFrames = (afterLoad: () => void) => {
		if (prop && prop.blob) {
			// Always try APNG decode — works for both static PNG and APNG
			const reader = new FileReader();
			reader.onload = () => {
				const buf = reader.result as ArrayBuffer;
				const decoded = UPNG.decode(buf);
				const rgba = UPNG.toRGBA8(decoded);
				if (rgba.length > 1) {
					// Multi-frame APNG
					for (let i = 0; i < rgba.length; i++) {
						const delay = (decoded.frames[i] && decoded.frames[i].delay) ? decoded.frames[i].delay : 50;
						state.frames.push({
							data: new Uint8ClampedArray(rgba[i]),
							delay: delay,
						});
					}
					state.flags.animated = true;
					state.pixelData.set(state.frames[0].data);
				} else {
					// Single frame — use canvas draw to handle all PNG variants reliably
					if (prop.img && prop.img.complete) {
						const tmpCanvas = document.createElement('canvas');
						tmpCanvas.width = propW;
						tmpCanvas.height = propH;
						const tmpCtx = tmpCanvas.getContext('2d')!;
						tmpCtx.drawImage(prop.img, 0, 0);
						const imgData = tmpCtx.getImageData(0, 0, propW, propH);
						state.pixelData.set(imgData.data);
					} else if (rgba.length === 1) {
						state.pixelData.set(new Uint8ClampedArray(rgba[0]));
					}
					state.frames.push({ data: new Uint8ClampedArray(state.pixelData), delay: 50 });
				}
				afterLoad();
			};
			reader.readAsArrayBuffer(prop.blob);
		} else {
			if (prop && prop.img && prop.img.complete) {
				const tmpCanvas = document.createElement('canvas');
				tmpCanvas.width = propW;
				tmpCanvas.height = propH;
				const tmpCtx = tmpCanvas.getContext('2d')!;
				tmpCtx.drawImage(prop.img, 0, 0);
				const imgData = tmpCtx.getImageData(0, 0, propW, propH);
				state.pixelData.set(imgData.data);
			}
			// Single-frame: wrap pixelData into frames array
			state.frames.push({ data: new Uint8ClampedArray(state.pixelData), delay: 50 });
			afterLoad();
		}
	};

	// Dialog container
	const dialog = state.dialog;
	dialog.className = 'pe-dialog';

	// ── Title bar ──
	const titleBar = document.createElement('div');
	titleBar.className = 'pe-titlebar';
	titleBar.textContent = 'Prop Editor';

	const closeBtn = document.createElement('button');
	closeBtn.className = 'pe-close-btn';
	closeBtn.textContent = '×';
	closeBtn.onclick = () => cleanup();
	titleBar.appendChild(closeBtn);
	dialog.appendChild(titleBar);

	// ── Body layout: left panel (tools + color picker) | center (canvas) | right panel (preview + options) ──
	const body = document.createElement('div');
	body.className = 'pe-body';

	// Left panel
	const leftPanel = document.createElement('div');
	leftPanel.className = 'pe-left-panel';

	const toolOptionsContainer = document.createElement('div');
	toolOptionsContainer.className = 'pe-tool-options';
	const toolbar = createToolbar(state, () => updateToolOptions(state, toolOptionsContainer));
	leftPanel.appendChild(toolbar);
	leftPanel.appendChild(toolOptionsContainer);
	updateToolOptions(state, toolOptionsContainer);

	const colorRow = document.createElement('div');
	colorRow.className = 'pe-color-row';
	const colorLabel = document.createElement('span');
	colorLabel.className = 'pe-color-label';
	colorLabel.textContent = 'Pen Color';
	colorRow.appendChild(colorLabel);
	colorRow.appendChild(colorInput);
	leftPanel.appendChild(colorRow);

	colorInput.addEventListener('change', () => {
		state.color = parseRgba(colorInput.value);
		colorInput.style.backgroundColor = colorInput.value;
	});

	const bgColorRow = document.createElement('div');
	bgColorRow.className = 'pe-color-row';
	const bgColorLabel = document.createElement('span');
	bgColorLabel.className = 'pe-color-label';
	bgColorLabel.textContent = 'BG Color';
	const bgColorInput = document.createElement('input');
	bgColorInput.type = 'text';
	bgColorInput.setAttribute('data-coloris', '');
	bgColorInput.className = 'pe-color-btn';
	const bgHex = `#${state.bgColor.map(c => c.toString(16).padStart(2, '0')).join('')}`;
	bgColorInput.value = bgHex;
	bgColorInput.style.backgroundColor = bgHex;
	bgColorInput.addEventListener('change', () => {
		const parsed = parseRgba(bgColorInput.value);
		state.bgColor = [parsed[0], parsed[1], parsed[2]];
		bgColorInput.style.backgroundColor = bgColorInput.value;
		state._frameCache = null;
		renderMainCanvas(state);
		renderPreview(state);
		if (state.timelineEl) renderTimeline(state);
	});
	bgColorRow.appendChild(bgColorLabel);
	bgColorRow.appendChild(bgColorInput);
	leftPanel.appendChild(bgColorRow);

	// Preview wrapper (position:relative container for canvas + nametag)
	state.previewWrapper = document.createElement('div');
	state.previewWrapper.className = 'pe-preview-wrapper';

	state.previewCanvas.className = 'pe-preview-canvas';
	state.previewCanvas.width = 220;
	state.previewCanvas.height = 220;
	state.previewWrapper.appendChild(state.previewCanvas);

	// Move tool: drag prop in preview
	let moveDragging = false;
	let moveStartX = 0;
	let moveStartY = 0;
	let moveStartPropX = 0;
	let moveStartPropY = 0;

	function clampPropPosition(): void {
		const cw = state.previewCanvas.width;
		const ch = state.previewCanvas.height;
		const avatarX = 88;
		const avatarY = 88;
		// Prop drawn at (avatarX + propX, avatarY + propY), must stay within [0, cw - propW] and [0, ch - propH]
		const minX = -avatarX;
		const minY = -avatarY;
		const maxX = cw - avatarX - state.propW;
		const maxY = ch - avatarY - state.propH;
		state.propX = Math.max(minX, Math.min(maxX, state.propX));
		state.propY = Math.max(minY, Math.min(maxY, state.propY));
	}

	state.previewCanvas.style.cursor = 'grab';
	state.previewCanvas.addEventListener('mousedown', (e: MouseEvent) => {
		e.preventDefault();
		moveDragging = true;
		moveStartX = e.clientX;
		moveStartY = e.clientY;
		moveStartPropX = state.propX;
		moveStartPropY = state.propY;
		state.previewCanvas.style.cursor = 'grabbing';
	});

	const onPreviewMoveMove = (e: MouseEvent): void => {
		if (!moveDragging) return;
		state.propX = moveStartPropX + (e.clientX - moveStartX);
		state.propY = moveStartPropY + (e.clientY - moveStartY);
		clampPropPosition();
		renderPreview(state);
	};

	const onPreviewMoveUp = (): void => {
		if (moveDragging) {
			moveDragging = false;
			state.previewCanvas.style.cursor = 'grab';
		}
	};

	window.addEventListener('mousemove', onPreviewMoveMove);
	window.addEventListener('mouseup', onPreviewMoveUp);

	// Nametag DOM element – uses the same .avnametag class as the room
	state.previewNametag = document.createElement('div');
	state.previewNametag.className = 'avnametag';
	state.previewNametag.style.top = '0';
	state.previewNametag.style.left = '0';
	state.previewNametag.style.pointerEvents = 'none';
	state.previewWrapper.appendChild(state.previewNametag);

	leftPanel.appendChild(state.previewWrapper);

	// Show NameTag checkbox – centered below preview
	const nameTagLabel = document.createElement('label');
	nameTagLabel.className = 'pe-checkbox-label';
	nameTagLabel.style.display = 'block';
	nameTagLabel.style.textAlign = 'center';
	const nameTagInput = document.createElement('input');
	nameTagInput.type = 'checkbox';
	nameTagInput.checked = state.flags.showNameTag;
	nameTagInput.addEventListener('change', () => {
		state.flags.showNameTag = nameTagInput.checked;
		renderPreview(state);
	});
	nameTagLabel.appendChild(nameTagInput);
	nameTagLabel.appendChild(document.createTextNode(' Show NameTag'));
	leftPanel.appendChild(nameTagLabel);

	// Checkboxes
	const checkboxes: { label: string; key: keyof typeof state.flags }[] = [
		{ label: 'Head', key: 'head' },
		{ label: 'Ghost', key: 'ghost' },
		{ label: 'Animated', key: 'animated' },
		{ label: 'Bounce', key: 'bounce' },
	];

	const cbGroup = document.createElement('div');
	cbGroup.className = 'pe-checkbox-group';
	for (const cb of checkboxes) {
		const label = document.createElement('label');
		label.className = 'pe-checkbox-label';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = state.flags[cb.key];
		input.addEventListener('change', () => {
			state.flags[cb.key] = input.checked;
			renderPreview(state);
		});
		label.appendChild(input);
		label.appendChild(document.createTextNode(' ' + cb.label));
		cbGroup.appendChild(label);
	}
	leftPanel.appendChild(cbGroup);

	body.appendChild(leftPanel);

	// Center: main canvas
	const centerPanel = document.createElement('div');
	centerPanel.className = 'pe-center-panel';

	const scrollWrapper = document.createElement('div');
	scrollWrapper.className = 'pe-canvas-scroll';
	state.mainCanvas.className = 'pe-main-canvas';
	scrollWrapper.appendChild(state.mainCanvas);
	centerPanel.appendChild(scrollWrapper);

	// ── Floating selection Apply/Cancel buttons ──
	const selActionBar = document.createElement('div');
	selActionBar.className = 'pe-sel-actions';
	selActionBar.style.display = 'none';

	const selApplyBtn = document.createElement('button');
	selApplyBtn.className = 'pe-sel-action-btn pe-sel-apply';
	selApplyBtn.title = 'Apply';
	selApplyBtn.textContent = '✓';

	const selCancelBtn = document.createElement('button');
	selCancelBtn.className = 'pe-sel-action-btn pe-sel-cancel';
	selCancelBtn.title = 'Cancel';
	selCancelBtn.textContent = '✕';

	selActionBar.appendChild(selApplyBtn);
	selActionBar.appendChild(selCancelBtn);
	centerPanel.appendChild(selActionBar);

	function positionSelActions(): void {
		if (!state.floatingSelection) { selActionBar.style.display = 'none'; return; }
		const fs = state.floatingSelection;
		const z = state.zoom;
		const cw = state.mainCanvas.width;
		const ch = state.mainCanvas.height;
		const pw = state.propW * z;
		const ph = state.propH * z;
		const ox = Math.floor((cw - pw) / 2);
		const oy = Math.floor((ch - ph) / 2);

		// Position below the selection, offset by scroll
		const sx = ox + fs.x * z;
		const sy = oy + (fs.y + fs.h) * z + 4;
		const left = sx - scrollWrapper.scrollLeft;
		const top = sy - scrollWrapper.scrollTop;

		// Clamp to stay visible within the center panel
		const panelW = scrollWrapper.clientWidth;
		const panelH = scrollWrapper.clientHeight;
		const barW = 52; // approximate width of two buttons + gap
		const barH = 22;
		const clampedLeft = Math.max(2, Math.min(left, panelW - barW - 2));
		const clampedTop = Math.max(2, Math.min(top, panelH - barH - 2));

		selActionBar.style.left = `${clampedLeft}px`;
		selActionBar.style.top = `${clampedTop}px`;
		selActionBar.style.display = 'flex';
	}

	function hideSelActions(): void {
		selActionBar.style.display = 'none';
	}

	state._hideSelActions = hideSelActions;

	function cancelFloatingSelection(): void {
		if (!state.floatingSelection) return;
		// Undo the source-clear that happened when the selection was lifted
		if (state._floatingWasCut) {
			performUndo(state);
		}
		state.floatingSelection = null;
		state._floatingTmp = undefined;
		state._floatingOrigin = null;
		state._floatingWasCut = false;
		state.selection = null;
		hideSelActions();
		renderMainCanvas(state);
		renderPreview(state);
		if (state.frames.length > 1) renderTimeline(state);
	}

	selApplyBtn.addEventListener('click', () => {
		hideSelActions();
		commitFloatingSelection(state);
		renderMainCanvas(state);
		renderPreview(state);
		if (state.frames.length > 1) renderTimeline(state);
	});

	selCancelBtn.addEventListener('click', () => {
		cancelFloatingSelection();
	});

	scrollWrapper.addEventListener('scroll', () => {
		if (state.floatingSelection) positionSelActions();
	});

	// Undo/Redo buttons overlaid on canvas
	const undoRedoBar = document.createElement('div');
	undoRedoBar.className = 'pe-undo-bar';

	const undoBtn = document.createElement('button');
	undoBtn.className = 'pe-undo-btn';
	undoBtn.title = 'Undo (Ctrl+Z)';
	undoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 7h8a3 3 0 0 1 0 6H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 4L4 7l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	undoBtn.addEventListener('click', () => {
		if (state._floodInProgress) return;
		pauseIfPlaying();
		if (state.floatingSelection) discardFloatingSelection(state);
		if (performUndo(state)) {
			renderMainCanvas(state);
			renderPreview(state);
			if (state.frames.length > 1) renderTimeline(state);
		}
	});

	const redoBtn = document.createElement('button');
	redoBtn.className = 'pe-undo-btn';
	redoBtn.title = 'Redo (Ctrl+Y)';
	redoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 7H4a3 3 0 0 0 0 6h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	redoBtn.addEventListener('click', () => {
		if (state._floodInProgress) return;
		pauseIfPlaying();
		if (state.floatingSelection) discardFloatingSelection(state);
		if (performRedo(state)) {
			renderMainCanvas(state);
			renderPreview(state);
			if (state.frames.length > 1) renderTimeline(state);
		}
	});

	undoRedoBar.appendChild(undoBtn);
	undoRedoBar.appendChild(redoBtn);
	centerPanel.appendChild(undoRedoBar);

	body.appendChild(centerPanel);

	dialog.appendChild(body);

	// ── Timeline bar (animation frames) ──
	const timelineBar = createTimelineBar(state);
	dialog.appendChild(timelineBar);

	// ── Bottom bar: prop name + Cancel/Save ──
	const bottomBar = document.createElement('div');
	bottomBar.className = 'pe-bottom-bar';

	const nameLabel = document.createElement('label');
	nameLabel.className = 'pe-name-label';
	nameLabel.textContent = 'Name:';
	const nameInput = document.createElement('input');
	nameInput.type = 'text';
	nameInput.className = 'pe-name-input';
	nameInput.value = state.propName;
	nameInput.placeholder = 'prop name';
	nameInput.addEventListener('input', () => { state.propName = nameInput.value; });
	nameLabel.appendChild(nameInput);
	bottomBar.appendChild(nameLabel);

	const btnGroup = document.createElement('div');
	btnGroup.className = 'pe-btn-group';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'dlg-btn-cancel';
	cancelBtn.textContent = 'Cancel';
	cancelBtn.onclick = () => cleanup();

	const saveBtn = document.createElement('button');
	saveBtn.className = 'dlg-btn-ok';
	saveBtn.textContent = 'Save';
	saveBtn.onclick = () => {
		stopAnimation(state);
		// Commit any floating selection before saving
		if (state.floatingSelection) {
			hideSelActions();
			commitFloatingSelection(state);
		}
		// Sync current frame
		syncFrameToState(state);

		const finishSave = (blob: Blob) => {
			// Find the predecessor of the old prop so the new one takes its place
			const oldId = state.prop?.id;
			let insertAfter: number | undefined;
			if (oldId !== undefined) {
				const idx = propBagList.indexOf(oldId);
				if (idx > 0) {
					insertAfter = propBagList[idx - 1];
				}
				deletePropsFromDB([oldId]);
			}

			// Create new prop with a fresh ID
			const newProp = createNewProp(blob, state.propW, state.propH);
			newProp.name = state.propName || 'Palace Prop';
			newProp.x = state.propX;
			newProp.y = state.propY;
			newProp.head = state.flags.head;
			newProp.ghost = state.flags.ghost;
			newProp.animated = state.frames.length > 1;
			newProp.bounce = state.flags.bounce;

			// Add to DB at the same position (refreshes prop bag on completion)
			addPropsToDB([newProp], insertAfter);

			cleanup();
		};

		if (state.frames.length > 1) {
			// Encode as APNG
			const buffers: ArrayBuffer[] = [];
			const delays: number[] = [];
			for (const f of state.frames) {
				const ab = new ArrayBuffer(f.data.byteLength);
				new Uint8Array(ab).set(f.data);
				buffers.push(ab);
				delays.push(f.delay);
			}
			encodeAPNG(buffers, state.propW, state.propH, delays, (blob) => {
				if (blob) finishSave(blob);
			});
		} else {
			// Single frame PNG
			const ab = new ArrayBuffer(state.pixelData.byteLength);
			new Uint8Array(ab).set(state.pixelData);
			const blob = new Blob(
				[UPNG.encode([ab], state.propW, state.propH, 0)],
				{ type: 'image/png' }
			);
			finishSave(blob);
		}
	};

	btnGroup.appendChild(cancelBtn);
	btnGroup.appendChild(saveBtn);
	bottomBar.appendChild(btnGroup);
	dialog.appendChild(bottomBar);

	// ── Canvas interactions ──
	let selDragging = false;
	let selDragStartMX = 0;
	let selDragStartMY = 0;
	let selDragStartSX = 0;
	let selDragStartSY = 0;
	let batchSnapshot: Uint8ClampedArray | null = null;
	let panning = false;
	let panStartX = 0;
	let panStartY = 0;
	let panScrollX = 0;
	let panScrollY = 0;
	let spaceHeld = false;

	function onCanvasMouseDown(e: MouseEvent): void {
		// Block input during async flood fill/erase
		if (state._floodInProgress) return;

		// Space+click = pan (grab-scroll the canvas)
		if (spaceHeld) {
			panning = true;
			panStartX = e.clientX;
			panStartY = e.clientY;
			panScrollX = scrollWrapper.scrollLeft;
			panScrollY = scrollWrapper.scrollTop;
			state.mainCanvas.style.cursor = 'grabbing';
			e.preventDefault();
			return;
		}

		const p = canvasToPixel(state, e);

		// Auto-pause animation on any drawing/alteration
		if (state.animPlaying && state.tool !== 'zoom') {
			pauseIfPlaying();
		}

		if (state.tool === 'zoom') {
			const oldZoom = state.zoom;
			if (e.button === 2 || e.shiftKey) {
				state.zoom = Math.max(1, state.zoom - 1);
			} else {
				state.zoom = Math.min(32, state.zoom + 1);
			}
			const newZoom = state.zoom;
			if (newZoom === oldZoom) return;

			// Mouse position relative to scroll viewport
			const wrapRect = scrollWrapper.getBoundingClientRect();
			const mx = e.clientX - wrapRect.left;
			const my = e.clientY - wrapRect.top;

			// Pixel position under cursor in old canvas coordinates
			const oldCanvasX = scrollWrapper.scrollLeft + mx;
			const oldCanvasY = scrollWrapper.scrollTop + my;
			const oldCW = state.mainCanvas.width;
			const oldCH = state.mainCanvas.height;
			const oldPW = state.propW * oldZoom;
			const oldPH = state.propH * oldZoom;
			const oldOX = Math.floor((oldCW - oldPW) / 2);
			const oldOY = Math.floor((oldCH - oldPH) / 2);
			// Fractional prop coordinate under cursor
			const propFX = (oldCanvasX - oldOX) / oldZoom;
			const propFY = (oldCanvasY - oldOY) / oldZoom;

			resizeMainCanvas();

			// New canvas coordinates for the same prop point
			const newCW = state.mainCanvas.width;
			const newCH = state.mainCanvas.height;
			const newPW = state.propW * newZoom;
			const newPH = state.propH * newZoom;
			const newOX = Math.floor((newCW - newPW) / 2);
			const newOY = Math.floor((newCH - newPH) / 2);
			const newCanvasX = newOX + propFX * newZoom;
			const newCanvasY = newOY + propFY * newZoom;

			scrollWrapper.scrollLeft = Math.max(0, newCanvasX - mx);
			scrollWrapper.scrollTop = Math.max(0, newCanvasY - my);
			return;
		}

		// Select tool: handle before bounds check so outside-prop clicks can commit
		if (state.tool === 'select') {
			const up = canvasToPixelUnbounded(state, e);
			if (state.floatingSelection) {
				const fs = state.floatingSelection;
				if (up.x >= fs.x && up.x < fs.x + fs.w && up.y >= fs.y && up.y < fs.y + fs.h) {
					selDragging = true;
					selDragStartMX = e.clientX;
					selDragStartMY = e.clientY;
					selDragStartSX = fs.x;
					selDragStartSY = fs.y;
					state.mainCanvas.style.cursor = 'grabbing';
					hideSelActions();
					return;
				} else {
					hideSelActions();
					commitFloatingSelection(state);
					renderMainCanvas(state);
					renderPreview(state);
					if (!p) return;
				}
			} else if (state.selection && p) {
				const sel = state.selection;
			if (p.x >= sel.x && p.x < sel.x + sel.w && p.y >= sel.y && p.y < sel.y + sel.h) {
					if (state.clearOnDrag) {
						if (state.batchMode && state.frames.length > 1) {
							pushUndoAllFrames(state);
						} else {
							pushUndo(state);
						}
					}
					liftSelection(state, state.clearOnDrag);
					state._floatingWasCut = state.clearOnDrag;
					selDragging = true;
					selDragStartMX = e.clientX;
					selDragStartMY = e.clientY;
					selDragStartSX = state.floatingSelection!.x;
					selDragStartSY = state.floatingSelection!.y;
					state.mainCanvas.style.cursor = 'grabbing';
					renderMainCanvas(state);
					renderPreview(state);
					return;
				}
			}
			if (!p) return;
			state.selection = null;
			state.selecting = true;
			state.selectStart = { x: p.x, y: p.y };
			state.selection = { x: p.x, y: p.y, w: 1, h: 1 };
			renderMainCanvas(state);
			return;
		}

		if (!p) return;

		if (state.tool === 'eyedropper') {
			const [r, g, b, a] = getPixel(state, p.x, p.y);
			state.color = [r, g, b, a];
			const val = `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
			state.colorInput.value = val;
			state.colorInput.style.backgroundColor = val;
			state.colorInput.dispatchEvent(new Event('input', { bubbles: true }));
			return;
		}

		if (state.tool === 'fill') {
			if (state.frames.length > 1) {
				floodFillAllFrames(state, p.x, p.y, state.color[0], state.color[1], state.color[2], state.color[3]);
			} else {
				pushUndo(state);
				floodFillOnData(state.pixelData, state.propW, state.propH, p.x, p.y, state.color[0], state.color[1], state.color[2], state.color[3], state.tolerance, state.fillAntiAlias);
				renderMainCanvas(state);
				renderPreview(state);
			}
			return;
		}

		if (state.tool === 'eraser') {
			if (state.floodErase) {
				if (state.frames.length > 1) {
					floodFillAllFrames(state, p.x, p.y, 0, 0, 0, 0);
				} else {
					pushUndo(state);
					floodFillOnData(state.pixelData, state.propW, state.propH, p.x, p.y, 0, 0, 0, 0, state.tolerance, state.fillAntiAlias);
					renderMainCanvas(state);
					renderPreview(state);
				}
				return;
			}
			state.drawing = true;
			state.lastPixel = p;
			batchSnapshot = state.batchMode ? new Uint8ClampedArray(state.pixelData) : null;
			if (state.batchMode && state.frames.length > 1) pushUndoAllFrames(state); else pushUndo(state);
			if (state.antiAlias) {
				state._aaSnapshot = new Uint8ClampedArray(state.pixelData);
				state._aaPath = [{ x: p.x, y: p.y }];
				applyAntiAliasedErase(state);
			} else {
				paintBrush(state, p.x, p.y, 0, 0, 0, 0);
			}
			renderMainCanvas(state);
			renderPreview(state);
			return;
		}

		if (state.tool === 'pen') {
			state.drawing = true;
			state.lastPixel = p;
			batchSnapshot = state.batchMode ? new Uint8ClampedArray(state.pixelData) : null;
			if (state.batchMode && state.frames.length > 1) pushUndoAllFrames(state); else pushUndo(state);
			if (state.antiAlias) {
				state._aaSnapshot = new Uint8ClampedArray(state.pixelData);
				state._aaPath = [{ x: p.x, y: p.y }];
				applyAntiAliasedPath(state);
			} else {
				paintBrush(state, p.x, p.y, state.color[0], state.color[1], state.color[2], state.color[3]);
			}
			renderMainCanvas(state);
			renderPreview(state);
		}
	}

	function onCanvasMouseMove(e: MouseEvent): void {
		// Panning
		if (panning) {
			scrollWrapper.scrollLeft = panScrollX - (e.clientX - panStartX);
			scrollWrapper.scrollTop = panScrollY - (e.clientY - panStartY);
			return;
		}

		// Dragging floating selection
		if (selDragging && state.floatingSelection) {
			const dx = Math.round((e.clientX - selDragStartMX) / state.zoom);
			const dy = Math.round((e.clientY - selDragStartMY) / state.zoom);
			state.floatingSelection.x = selDragStartSX + dx;
			state.floatingSelection.y = selDragStartSY + dy;
			renderMainCanvas(state);
			renderPreview(state);
			return;
		}

		// Update cursor for hoverable selection regions
		if (state.tool === 'select' && !state.selecting) {
			const up = canvasToPixelUnbounded(state, e);
			const fs = state.floatingSelection;
			const sel = state.selection;
			if (fs && up.x >= fs.x && up.x < fs.x + fs.w && up.y >= fs.y && up.y < fs.y + fs.h) {
				state.mainCanvas.style.cursor = 'grab';
			} else if (sel && up.x >= sel.x && up.x < sel.x + sel.w && up.y >= sel.y && up.y < sel.y + sel.h) {
				state.mainCanvas.style.cursor = 'grab';
			} else {
				state.mainCanvas.style.cursor = 'crosshair';
			}
		}

		if (state.selecting && state.selectStart) {
			const up = canvasToPixelUnbounded(state, e);
			const p = {
				x: Math.max(0, Math.min(state.propW - 1, up.x)),
				y: Math.max(0, Math.min(state.propH - 1, up.y)),
			};
			const x0 = Math.min(state.selectStart.x, p.x);
			const y0 = Math.min(state.selectStart.y, p.y);
			const x1 = Math.max(state.selectStart.x, p.x);
			const y1 = Math.max(state.selectStart.y, p.y);
			state.selection = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
			renderMainCanvas(state);
			return;
		}
		if (!state.drawing) return;
		const p = canvasToPixel(state, e);
		if (!p) return;

		if (state.tool === 'pen') {
			if (state.antiAlias && state._aaPath) {
				state._aaPath.push({ x: p.x, y: p.y });
				applyAntiAliasedPath(state);
			} else if (state.lastPixel) {
				drawBresenhamLineBrush(state, state.lastPixel.x, state.lastPixel.y, p.x, p.y, state.color[0], state.color[1], state.color[2], state.color[3]);
			} else {
				paintBrush(state, p.x, p.y, state.color[0], state.color[1], state.color[2], state.color[3]);
			}
		} else if (state.tool === 'eraser') {
			if (state.antiAlias && state._aaPath) {
				state._aaPath.push({ x: p.x, y: p.y });
				applyAntiAliasedErase(state);
			} else if (state.lastPixel) {
				drawBresenhamLineBrush(state, state.lastPixel.x, state.lastPixel.y, p.x, p.y, 0, 0, 0, 0);
			} else {
				paintBrush(state, p.x, p.y, 0, 0, 0, 0);
			}
		}
		state.lastPixel = p;
		renderMainCanvas(state);
		renderPreview(state);
	}

	function onCanvasMouseUp(): void {
		if (panning) {
			panning = false;
			state.mainCanvas.style.cursor = spaceHeld ? 'grab' : '';
			if (!spaceHeld) updateCanvasCursor(state);
		}
		if (selDragging) {
			selDragging = false;
			state.mainCanvas.style.cursor = 'grab';
			if (state.floatingSelection) positionSelActions();
		}
		if (state.selecting && state.selection && state.selection.w <= 1 && state.selection.h <= 1) {
			state.selection = null;
			renderMainCanvas(state);
		}
		if (state.drawing && batchSnapshot) {
			applyBatchDiff(state, batchSnapshot);
			syncFrameToState(state);
			batchSnapshot = null;
			state._frameCache = null;
			renderTimeline(state);
		}
		state.drawing = false;
		state.lastPixel = null;
		state.selecting = false;
		state._aaSnapshot = undefined;
		state._aaPath = undefined;
	}

	state.mainCanvas.addEventListener('mousedown', onCanvasMouseDown);
	state.mainCanvas.addEventListener('mousemove', onCanvasMouseMove);
	state.mainCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
	window.addEventListener('mouseup', onCanvasMouseUp);

	// ── Keyboard: Copy / Paste / Delete ──
	const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	function isModKey(e: KeyboardEvent): boolean {
		return isMac ? e.metaKey : e.ctrlKey;
	}

	function pauseIfPlaying(): void {
		if (!state.animPlaying) return;
		stopAnimation(state);
		// Restore current frame data without clearing undo/redo stacks
		state.pixelData.set(state.frames[state.currentFrame].data);
		const pb = state.timelineEl?.querySelector('.pe-play-btn');
		if (pb) pb.textContent = '▶';
		renderTimeline(state);
		renderMainCanvas(state);
		renderPreview(state);
	}

	function onKeyUp(e: KeyboardEvent): void {
		if (e.key === ' ') {
			spaceHeld = false;
			if (!panning) updateCanvasCursor(state);
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		// Space = pan mode cursor
		if (e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			if (!spaceHeld) {
				spaceHeld = true;
				if (!panning && !state.drawing) state.mainCanvas.style.cursor = 'grab';
			}
			return;
		}

		// Block all mutating shortcuts during async flood operations
		if (state._floodInProgress) return;

		// Auto-pause animation on mutating keyboard shortcuts
		if (state.animPlaying) {
			const isDel = e.key === 'Delete' || e.key === 'Backspace';
			const isUndo = isModKey(e) && e.key === 'z';
			const isRedo = isModKey(e) && (e.key === 'y' || (e.key === 'Z' && e.shiftKey));
			const isPaste = isModKey(e) && e.key === 'v';
			if (isDel || isUndo || isRedo || isPaste) {
				pauseIfPlaying();
			}
		}

		// Delete selection
		if ((e.key === 'Delete' || e.key === 'Backspace') && (state.floatingSelection || state.selection)) {
			if (state.floatingSelection) {
				// Discard floating selection without committing
				discardFloatingSelection(state);
			} else if (state.selection) {
				const sel = state.selection;
				if (state.batchMode && state.frames.length > 1) {
					// Batch mode: clear selection area on all frames
					pushUndoAllFrames(state);
					const w = state.propW;
					const h = state.propH;
					for (let fi = 0; fi < state.frames.length; fi++) {
						const fd = state.frames[fi].data;
						for (let y = sel.y; y < sel.y + sel.h; y++) {
							for (let x = sel.x; x < sel.x + sel.w; x++) {
								if (x < 0 || x >= w || y < 0 || y >= h) continue;
								const di = (y * w + x) * 4;
								fd[di] = 0; fd[di + 1] = 0; fd[di + 2] = 0; fd[di + 3] = 0;
							}
						}
					}
					state.pixelData.set(state.frames[state.currentFrame].data);
					state._frameCache = null;
					renderTimeline(state);
				} else {
					pushUndo(state);
					for (let y = sel.y; y < sel.y + sel.h; y++) {
						for (let x = sel.x; x < sel.x + sel.w; x++) {
							setPixel(state, x, y, 0, 0, 0, 0);
						}
					}
					if (state.frames.length > 1) {
						syncFrameToState(state);
						state._frameCache = null;
						renderTimeline(state);
					}
				}
				state.selection = null;
			}
			renderMainCanvas(state);
			renderPreview(state);
			e.preventDefault();
			return;
		}

		// Copy selection
		if (isModKey(e) && e.key === 'c' && (state.floatingSelection || state.selection)) {
			const tmpCanvas = document.createElement('canvas');
			if (state.floatingSelection) {
				const fs = state.floatingSelection;
				tmpCanvas.width = fs.w;
				tmpCanvas.height = fs.h;
				const tmpCtx = tmpCanvas.getContext('2d')!;
				const imgData = tmpCtx.createImageData(fs.w, fs.h);
				imgData.data.set(fs.data);
				tmpCtx.putImageData(imgData, 0, 0);
			} else {
				const sel = state.selection!;
				tmpCanvas.width = sel.w;
				tmpCanvas.height = sel.h;
				const tmpCtx = tmpCanvas.getContext('2d')!;
				const imgData = tmpCtx.createImageData(sel.w, sel.h);
				for (let y = 0; y < sel.h; y++) {
					for (let x = 0; x < sel.w; x++) {
						const src = getPixel(state, sel.x + x, sel.y + y);
						const di = (y * sel.w + x) * 4;
						imgData.data[di] = src[0];
						imgData.data[di + 1] = src[1];
						imgData.data[di + 2] = src[2];
						imgData.data[di + 3] = src[3];
					}
				}
				tmpCtx.putImageData(imgData, 0, 0);
			}
			tmpCanvas.toBlob((blob) => {
				if (blob) {
					navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
				}
			}, 'image/png');
			e.preventDefault();
			return;
		}

		// Undo
		if (isModKey(e) && e.key === 'z' && !e.shiftKey) {
			if (state.floatingSelection) discardFloatingSelection(state);
			if (performUndo(state)) {
				renderMainCanvas(state);
				renderPreview(state);
				if (state.frames.length > 1) renderTimeline(state);
			}
			e.preventDefault();
			return;
		}

		// Redo
		if (isModKey(e) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
			if (state.floatingSelection) discardFloatingSelection(state);
			if (performRedo(state)) {
				renderMainCanvas(state);
				renderPreview(state);
				if (state.frames.length > 1) renderTimeline(state);
			}
			e.preventDefault();
			return;
		}

		// Paste image as floating selection
		if (isModKey(e) && e.key === 'v') {
			navigator.clipboard.read().then((items) => {
				for (const item of items) {
					const imageType = item.types.find(t => t.startsWith('image/'));
					if (imageType) {
						item.getType(imageType).then((blob) => {
							const img = new Image();
							img.onload = () => {
								// Commit any existing floating selection first
								if (state.floatingSelection) {
									hideSelActions();
									commitFloatingSelection(state);
								}
								const pw = Math.min(img.naturalWidth, state.propW);
								const ph = Math.min(img.naturalHeight, state.propH);
								const tmpCanvas = document.createElement('canvas');
								tmpCanvas.width = pw;
								tmpCanvas.height = ph;
								const tmpCtx = tmpCanvas.getContext('2d')!;
								tmpCtx.drawImage(img, 0, 0, pw, ph);
								const pasted = tmpCtx.getImageData(0, 0, pw, ph);
								state.floatingSelection = {
									data: new Uint8ClampedArray(pasted.data),
									x: 0, y: 0, w: pw, h: ph,
								};
								state._floatingOrigin = { x: 0, y: 0 };
								state.selection = null;
								// Cache as canvas for rendering
								const ftmp = document.createElement('canvas');
								ftmp.width = pw;
								ftmp.height = ph;
								const ftmpCtx = ftmp.getContext('2d')!;
								ftmpCtx.putImageData(pasted, 0, 0);
								state._floatingTmp = ftmp;
								// Switch to select tool so user can drag
								state.tool = 'select';
								const activeBtn = state.dialog.querySelector('.pe-tool-btn.active');
								if (activeBtn) activeBtn.classList.remove('active');
								const selBtn = state.dialog.querySelector('.pe-tool-btn[data-tool="select"]');
								if (selBtn) selBtn.classList.add('active');
								updateCanvasCursor(state);
								renderMainCanvas(state);
								renderPreview(state);
								positionSelActions();
								URL.revokeObjectURL(img.src);
							};
							img.src = URL.createObjectURL(blob);
						});
						break;
					}
				}
			}).catch(() => {});
			e.preventDefault();
			return;
		}
	}

	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	// ── Drag support on title bar ──
	let dragX = 0, dragY = 0, dragging = false;
	let dragOverlay: HTMLDivElement | null = null;
	titleBar.addEventListener('mousedown', (e: MouseEvent) => {
		if ((e.target as HTMLElement).tagName === 'BUTTON') return;
		e.preventDefault();
		dragging = true;
		const rect = dialog.getBoundingClientRect();
		dragX = e.clientX - rect.left;
		dragY = e.clientY - rect.top;
		dragOverlay = document.createElement('div');
		dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:move;';
		document.body.appendChild(dragOverlay);
	});
	const onDragMove = (e: MouseEvent): void => {
		if (!dragging) return;
		dialog.style.left = `${e.clientX - dragX}px`;
		dialog.style.top = `${e.clientY - dragY}px`;
		dialog.style.marginLeft = '0';
	};
	const onDragUp = (): void => { dragging = false; dragOverlay?.remove(); dragOverlay = null; };
	window.addEventListener('mousemove', onDragMove);
	window.addEventListener('mouseup', onDragUp);

	// ── Resize observer for main canvas ──
	function resizeMainCanvas(): void {
		// Temporarily hide overflow to get a stable container measurement
		// that doesn't include scrollbar gutter.
		scrollWrapper.style.overflow = 'hidden';
		const containerW = scrollWrapper.clientWidth;
		const containerH = scrollWrapper.clientHeight;
		if (containerW <= 0 || containerH <= 0) return;

		const borderPad = 4; // 2px each side for the prop border
		const zoomedW = state.propW * state.zoom + borderPad;
		const zoomedH = state.propH * state.zoom + borderPad;

		const needsScroll = zoomedW > containerW || zoomedH > containerH;
		scrollWrapper.style.overflow = needsScroll ? 'auto' : 'hidden';

		const w = Math.max(containerW, zoomedW);
		const h = Math.max(containerH, zoomedH);

		if (state.mainCanvas.width !== w || state.mainCanvas.height !== h) {
			state.mainCanvas.width = w;
			state.mainCanvas.height = h;
		}
		renderMainCanvas(state);
	}

	const resizeObserver = new ResizeObserver(() => {
		resizeMainCanvas();
	});

	// ── Cleanup ──
	function cleanup(): void {
		stopAnimation(state);
		const rect = dialog.getBoundingClientRect();
		savedPEGeometry = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
		setGeneralPref('propEditorGeometry', savedPEGeometry);
		savePESettings(state);
		window.removeEventListener('mousemove', onDragMove);
		window.removeEventListener('mouseup', onDragUp);
		window.removeEventListener('mouseup', onCanvasMouseUp);
		window.removeEventListener('mousemove', onPreviewMoveMove);
		window.removeEventListener('mouseup', onPreviewMoveUp);
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		resizeObserver.disconnect();
		dialog.remove();
	}

	// ── Mount ──
	const mountEditor = () => {
		// Collapse animation panel for single-frame, expand for multi-frame
		const isMultiFrame = state.frames.length > 1;
		if (!isMultiFrame) {
			timelineBar.classList.add('collapsed');
			const arrow = timelineBar.querySelector('.pe-timeline-arrow');
			if (arrow) arrow.textContent = '▸';
		} else {
			timelineBar.classList.remove('collapsed');
			const arrow = timelineBar.querySelector('.pe-timeline-arrow');
			if (arrow) arrow.textContent = '▾';
		}
		renderTimeline(state);

		if (!savedPEGeometry) {
			savedPEGeometry = (getGeneralPref('propEditorGeometry') as typeof savedPEGeometry) ?? null;
		}
		if (savedPEGeometry) {
			// Restore saved size, clamped to viewport
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const w = Math.min(savedPEGeometry.width, vw - 20);
			const h = Math.min(savedPEGeometry.height, vh - 20);
			let l = savedPEGeometry.left;
			let t = savedPEGeometry.top;
			// Keep at least 100px visible on screen
			l = Math.max(0, Math.min(l, vw - Math.min(100, w)));
			t = Math.max(0, Math.min(t, vh - Math.min(100, h)));
			dialog.style.width = `${w}px`;
			dialog.style.height = `${h}px`;
			dialog.style.left = `${l}px`;
			dialog.style.top = `${t}px`;
			dialog.style.marginLeft = '0';
		} else {
			// Size dialog to fit the prop at current zoom, with some padding
			const leftPanelW = 220 + 8 * 2 + 1; // width + padding + border
			const titleBarH = 32;
			const bottomBarH = 44;
			const canvasPad = 32; // padding around the zoomed prop in the canvas
			const fitW = Math.max(500, leftPanelW + state.propW * state.zoom + canvasPad * 2 + 2);
			const fitH = Math.max(400, titleBarH + bottomBarH + state.propH * state.zoom + canvasPad * 2);
			const maxW = window.innerWidth - 40;
			const maxH = window.innerHeight - 40;
			const dlgW = Math.min(fitW, maxW);
			const dlgH = Math.min(fitH, maxH);
			dialog.style.width = `${dlgW}px`;
			dialog.style.height = `${dlgH}px`;
			dialog.style.marginLeft = `${-Math.round(dlgW / 2)}px`;
		}

		document.body.appendChild(dialog);

		// Custom resize handle (replaces CSS resize:both which breaks over webviews)
		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'ipe-resize-handle';
		dialog.appendChild(resizeHandle);
		resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const rect = dialog.getBoundingClientRect();
			const startX = e.clientX, startY = e.clientY;
			const startW = rect.width, startH = rect.height;
			const overlay = document.createElement('div');
			overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:nwse-resize;';
			document.body.appendChild(overlay);
			const onMove = (ev: MouseEvent) => {
				dialog.style.width = `${startW + ev.clientX - startX}px`;
				dialog.style.height = `${startH + ev.clientY - startY}px`;
			};
			const onUp = () => {
				overlay.remove();
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		});

		resizeObserver.observe(scrollWrapper);
		resizeMainCanvas();
		updateCanvasCursor(state);
		renderPreview(state);
	};

	if (prebuiltFrames && prebuiltFrames.length > 0) {
		state.frames = prebuiltFrames;
		state.pixelData.set(state.frames[0].data);
		mountEditor();
	} else {
		initFrames(mountEditor);
	}
}

export function openPropEditorFromProps(props: PalaceProp[]): void {
	// Determine canvas size from largest prop dimensions
	let maxW = PROP_DEFAULT_W;
	let maxH = PROP_DEFAULT_H;
	for (const p of props) {
		const w = p.img ? p.img.naturalWidth : p.w;
		const h = p.img ? p.img.naturalHeight : p.h;
		if (w > maxW) maxW = w;
		if (h > maxH) maxH = h;
	}
	maxW = Math.min(maxW, PROP_MAX_W);
	maxH = Math.min(maxH, PROP_MAX_H);

	// Build frames from each prop's image
	const frames: AnimFrame[] = [];
	const tmpCanvas = document.createElement('canvas');
	tmpCanvas.width = maxW;
	tmpCanvas.height = maxH;
	const tmpCtx = tmpCanvas.getContext('2d')!;
	for (const p of props) {
		tmpCtx.clearRect(0, 0, maxW, maxH);
		if (p.img && p.img.complete) {
			tmpCtx.drawImage(p.img, 0, 0);
		}
		const imgData = tmpCtx.getImageData(0, 0, maxW, maxH);
		frames.push({ data: new Uint8ClampedArray(imgData.data), delay: 50 });
	}

	// Create a virtual prop based on the first prop, sized to the canvas
	const first = props[0];
	const virtualProp = new PalaceProp(0);
	virtualProp.img = first.img;
	virtualProp.blob = first.blob;
	virtualProp.name = '';
	virtualProp.x = first.x;
	virtualProp.y = first.y;
	virtualProp.w = maxW;
	virtualProp.h = maxH;
	virtualProp.head = first.head;
	virtualProp.ghost = first.ghost;
	virtualProp.animated = true;
	virtualProp.bounce = first.bounce;

	openPropEditor(virtualProp, frames);
}
