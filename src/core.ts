import { palace, smileys } from './state.js';
import { getHsl, timeStampStr, getNbrs, httpHeadAsync, parseURL, dedup } from './utility.js';
import { prefs, setGeneralPref, getGeneralPref } from './preferences.js';
import { logmsg, logAppend, updateDrawPreview, viewScale, toggleZoomPanel, setUserInterfaceAvailability, escapeHeld } from './interface.js';
import { makeHyperLinks } from './video-players.js';
import { chatBubs, Bubble, bubbleConsts } from './bubbles.js';
import { cacheProps, loadProps, dragBagProp, PalaceProp } from './props.js';
import { PalaceUser } from './users.js';
import { spotConsts, drawType } from './constants.js';
import { PalaceClient, IptEngine } from './client.js';
import { PalaceExecutionContext } from './iptscrae/index.js';
import { ScriptEditorWidget } from './iptscrae-editor.js';
import { cyborgHandlers } from './cyborgState.js';
import { CyborgEngine } from './iptscrae/cyborgEngine.js';

interface RuntimeSpot {
	id: number;
	name: string;
	type: number;
	flags: number;
	x: number;
	y: number;
	state: number;
	dest: number;
	points: number[];
	statepics: { id: number; x: number; y: number }[];
	img: HTMLElement;
	toplayer: boolean;
	script: string;
	handlers: { [key: string]: IptEngine.TokenList };
	webEmbed?: HTMLElement;
	picMode?: number;
	picFilters?: Record<number, { brightness?: number; opacity?: number; saturation?: number; hue?: number; contrast?: number; blur?: number; angle?: number }>;
	spotStyle?: { backgroundColor: string; borderColor: string; borderSize: number };
	curveTension?: number;
	spotGradient?: { firstColor: string; secondColor: string; angle: number };
	spotPathGradient?: { centerColor: string; surroundColors: string[]; useSpotPoint: boolean };
	clipMode?: number;
	nameTag?: HTMLDivElement;
}

interface LooseProp {
	id: number;
	x: number;
	y: number;
	light: number;
	raf: number | null;
}

interface DrawData {
	type: number;
	pensize: number;
	pencolor: string;
	fillcolor: string;
	points: number[];
}

interface PictureEntry {
	id: number;
	name: string;
	img: HTMLImageElement;
}

interface GrabbedProp {
	looseprop: LooseProp | null;
	id: number;
	offsetX: number;
	offsetY: number;
	mx: number;
	my: number;
}

interface RoomConstructorInfo {
	id: number;
	name: string;
	flags: number;
	background: string;
	spots: RuntimeSpot[];
	looseProps: LooseProp[];
	draws: DrawData[];
	pictures: PictureEntry[];
	authored?: boolean;
	[key: string]: any;
}

export function loadSmileys(callback: () => void): void {
	let buff = document.createElement('canvas');
	buff.height = 44;
	buff.width = 44;
	const buffCtx = buff.getContext('2d')!;
	const smile = document.createElement('img');
	smile.onload = function () {
		let count = 0;
		for (let x = 0; x < 13; x++) {
			for (let y = 0; y < 16; y++) {
				buffCtx.clearRect(0, 0, 44, 44);
				buffCtx.drawImage(smile, x * 45, y * 45, 44, 44, 0, 0, 44, 44);
				smileys[`${x},${y}`] = document.createElement('img');
				buffCtx.canvas.toBlob((blob) => {
					if (blob) smileys[`${x},${y}`].src = URL.createObjectURL(blob);
					count++;
					if (count === 208) {
						callback();
					}
				});
			}
		}

		smileys['5,0'].onload = function () {
			const nakedbutton = document.getElementById('removeprops')!;
			const src = `url(${smileys['5,0'].src})`;
			nakedbutton.style.backgroundImage = src;

			const smileyfaces = document.getElementById('smileyfaces')!;
			smileyfaces.style.backgroundImage = src;
			smileyfaces.onclick = () => {
				toggleZoomPanel('smileypicker');
			};
			updateDrawPreview();
			smileys['5,0'].onload = null;
		};

		const smileycolorpicker = document.getElementById('smileycolorpicker')!;

		let s = '';
		for (let i = 0; i < 15; i++) s += `${getHsl(i, 50)},`;
		smileycolorpicker.style.background = `linear-gradient(to right,${s.substring(0, s.length - 1)})`;

		let mouseDown = false;
		smileycolorpicker.onmousemove = (event: MouseEvent) => {
			const color = ((event.x - (smileycolorpicker.offsetLeft + (smileycolorpicker.parentNode as HTMLElement).offsetLeft)) / (smileycolorpicker.clientWidth / 15)).fastRound();
			if (mouseDown && color > -1 && color < 16 && palace.theRoom.userColorChange({ id: palace.theUserID, color: color })) {
				palace.sendFaceColor(color);
			}
		};
		smileycolorpicker.onmousedown = function (event: MouseEvent) {
			event.preventDefault();
			mouseDown = true;
			smileycolorpicker.onmousemove!(event);
		};
		smileycolorpicker.onmouseup = () => {
			mouseDown = false;
		};
		smileycolorpicker.onmouseleave = smileycolorpicker.onmouseup;

		const smileypicker = document.getElementById('smileypicker')!;
		for (let i = 0; i < 13; i++) {
			const img = smileys[`${i},0`];
			img.className = 'smileyface';
			img.draggable = false;
			img.onclick = function () {
				const faces = img.parentElement!.getElementsByTagName('img');
				for (let e = 0; e < faces.length; e++) {
					if (faces[e] === img && palace.theRoom.userFaceChange({ id: palace.theUserID, face: e })) {
						palace.sendFace(e);
					}
				}
			};
			smileypicker.appendChild(img);
		}

		smile.onload = null;
	};
	smile.src = 'img/smileys.png';
}

export class Renderer {
	context: CanvasRenderingContext2D;
	topcontext: CanvasRenderingContext2D;
	bubblecontext: CanvasRenderingContext2D;
	propcontext: CanvasRenderingContext2D;
	drawPoints: number[];
	drawTimer: ReturnType<typeof setTimeout> | null = null;
	drawTimer2: ReturnType<typeof setTimeout> | null = null;
	drawTimer3: ReturnType<typeof setTimeout> | null = null;
	drawTimer4: ReturnType<typeof setTimeout> | null = null;
	thoughtAnimId: number | null = null;
	spots!: RuntimeSpot[];
	draws!: DrawData[];
	looseProps!: LooseProp[];
	grabbedProp: GrabbedProp | null = null;

	constructor(canvas: HTMLCanvasElement, canvas2: HTMLCanvasElement, canvas3: HTMLCanvasElement, canvas4: HTMLCanvasElement) {
		this.context = canvas.getContext("2d")!;
		this.topcontext = canvas2.getContext("2d")!;
		this.bubblecontext = canvas3.getContext("2d")!;
		this.propcontext = canvas4.getContext("2d")!;
		this.drawPoints = [];
	}

	get canvas(): HTMLCanvasElement {
		return this.context.canvas;
	}

	refreshTop(): void {
		if (this.drawTimer2) {
			clearTimeout(this.drawTimer2);
			this.drawTimer2 = null;
		}
		this.topcontext.clearRect(0, 0, this.topcontext.canvas.width, this.topcontext.canvas.height);

		let i;

		for (i = 0; i < this.draws.length; i++) { this.drawDraws(this.draws[i], true, this.topcontext); }
		if (prefs.draw.front) this.preDrawDrawing(this.topcontext);
		for (i = 0; i < this.spots.length; i++) { this.drawSpot(this.spots[i], true, this.topcontext); }
		for (i = 0; i < this.spots.length; i++) { this.drawSpotName(this.spots[i], true, this.topcontext); }

		if ((this as any).showCoords) {
			const ctx = this.topcontext;
			ctx.save();
			ctx.font = '12px monospace';
			ctx.fillStyle = '#0f0';
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 3;
			const text = `${(this as any).lastMouseX}, ${(this as any).lastMouseY}`;
			ctx.strokeText(text, 6, ctx.canvas.height - 6);
			ctx.fillText(text, 6, ctx.canvas.height - 6);
			ctx.restore();
		}

		if (this.topcontext.shadowBlur > 0) {
			this.topcontext.shadowColor = 'transparent';
			this.topcontext.globalAlpha = 1;
			this.topcontext.shadowBlur = 0;
			this.topcontext.shadowOffsetY = 0;
		}

		this.reDrawBubbles();
	}

	refreshBubbles(): void {
		if (this.drawTimer3) {
			clearTimeout(this.drawTimer3);
			this.drawTimer3 = null;
		}
		this.bubblecontext.clearRect(0, 0, this.bubblecontext.canvas.width, this.bubblecontext.canvas.height);

		// Authoring overlays: drawn on bubble layer so they appear above all spot images
		if ((this as any).authoring) {
			const ctx = this.bubblecontext;
			const selSpot = (this as any).selectedSpot;
			ctx.save();
			for (let i = 0; i < this.spots.length; i++) {
				const spot = this.spots[i];
				const isSelected = spot === selSpot;
				if (spot.points && spot.points.length >= 4) {
					ctx.beginPath();
					ctx.moveTo(spot.x + spot.points[0], spot.y + spot.points[1]);
					for (let p = 2; p < spot.points.length; p += 2) {
						ctx.lineTo(spot.x + spot.points[p], spot.y + spot.points[p + 1]);
					}
					ctx.closePath();
					if (isSelected) {
						ctx.shadowColor = 'rgba(0, 255, 255, 0.8)';
						ctx.shadowBlur = 12;
						ctx.fillStyle = 'rgba(0,255,255,0.15)';
					} else {
						ctx.shadowColor = 'transparent';
						ctx.shadowBlur = 0;
						ctx.fillStyle = 'rgba(0,0,0,0.25)';
					}
					ctx.fill();
					ctx.strokeStyle = isSelected ? 'rgba(0,255,255,0.9)' : 'rgba(0,255,255,0.6)';
					ctx.lineWidth = isSelected ? 2 : 1;
					ctx.setLineDash(isSelected ? [] : [4, 4]);
					ctx.stroke();
					ctx.setLineDash([]);
					ctx.shadowColor = 'transparent';
					ctx.shadowBlur = 0;
					if (!isSelected) {
						for (let p = 0; p < spot.points.length; p += 2) {
							const vx = spot.x + spot.points[p];
							const vy = spot.y + spot.points[p + 1];
							ctx.fillStyle = '#0af';
							ctx.fillRect(vx - 3, vy - 3, 6, 6);
							ctx.strokeStyle = '#fff';
							ctx.lineWidth = 1;
							ctx.strokeRect(vx - 3, vy - 3, 6, 6);
						}
					}
					ctx.font = '10px sans-serif';
					ctx.fillStyle = 'rgba(0,255,255,0.8)';
					ctx.fillText(spot.name || `#${spot.id}`, spot.x + spot.points[0] + 2, spot.y + spot.points[1] - 3);
				}
			}
			if (selSpot && selSpot.points && selSpot.points.length >= 4) {
				for (let p = 0; p < selSpot.points.length; p += 2) {
					const vx = selSpot.x + selSpot.points[p];
					const vy = selSpot.y + selSpot.points[p + 1];
					ctx.fillStyle = '#0af';
					ctx.fillRect(vx - 3, vy - 3, 6, 6);
				}
				for (let p = 0; p < selSpot.points.length; p += 2) {
					const vx = selSpot.x + selSpot.points[p];
					const vy = selSpot.y + selSpot.points[p + 1];
					ctx.strokeStyle = '#fff';
					ctx.lineWidth = 1;
					ctx.strokeRect(vx - 3, vy - 3, 6, 6);
				}

				ctx.shadowColor = 'rgba(255,255,255,1)';
				ctx.shadowBlur = 2;
				ctx.shadowOffsetX = 0;
				ctx.shadowOffsetY = 0;
				const ox = selSpot.x, oy = selSpot.y;
				ctx.strokeStyle = '#0af';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(ox - 3, oy); ctx.lineTo(ox + 3, oy);
				ctx.moveTo(ox, oy - 3); ctx.lineTo(ox, oy + 3);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(0,170,255,0.4)';
				ctx.fill();
				ctx.strokeStyle = '#0af';
				ctx.stroke();
			}
			ctx.restore();
		}

		let hasThought = false;
		for (let i = 0; i < chatBubs.length; i++) {
			this.drawBubble(chatBubs[i]);
			if (chatBubs[i].thought && !chatBubs[i].deflated) hasThought = true;
		}

		if (this.bubblecontext.shadowBlur > 0) {
			this.bubblecontext.shadowColor = 'transparent';
			this.bubblecontext.globalAlpha = 1;
			this.bubblecontext.shadowBlur = 0;
			this.bubblecontext.shadowOffsetY = 0;
		}

		// Animate thought cloud haze at ~15fps while any thought bubble is visible
		if (hasThought && !this.thoughtAnimId) {
			const tick = () => {
				if (!chatBubs.some(b => b.thought && !b.deflated)) {
					this.thoughtAnimId = null;
					return;
				}
				this.refreshBubbles();
				this.thoughtAnimId = setTimeout(tick, 66) as unknown as number;
			};
			this.thoughtAnimId = setTimeout(tick, 66) as unknown as number;
		}
	}

	reDrawBubbles(): void {
		if (!this.drawTimer3) {
			this.drawTimer3 = setTimeout(() => { this.refreshBubbles(); }, 1);
		}
	}

	refreshProps(): void {
		if (this.drawTimer4) {
			clearTimeout(this.drawTimer4);
			this.drawTimer4 = null;
		}
		this.propcontext.clearRect(0, 0, this.propcontext.canvas.width, this.propcontext.canvas.height);
		this.drawLimboProp();
		for (let i = 0; i < this.looseProps.length; i++) { this.drawLooseProp(this.looseProps[i]); }
		if (this.propcontext.shadowBlur > 0) {
			this.propcontext.shadowColor = 'transparent';
			this.propcontext.globalAlpha = 1;
			this.propcontext.shadowBlur = 0;
			this.propcontext.shadowOffsetY = 0;
		}
	}

	reDrawProps(): void {
		if (!this.drawTimer4) {
			this.drawTimer4 = setTimeout(() => { this.refreshProps(); }, 1);
		}
	}

	reDrawTop(): void {
		if (!this.drawTimer2) {
			this.drawTimer2 = setTimeout(() => { this.refreshTop(); }, 1);
		}
	}

	refresh(): void {
		if (this.drawTimer) {
			clearTimeout(this.drawTimer);
			this.drawTimer = null;
		}
		this.context.clearRect(0, 0, this.context.canvas.width, this.context.canvas.height);

		let i;

		for (i = 0; i < this.spots.length; i++) { this.drawSpot(this.spots[i], false, this.context); }
		for (i = 0; i < this.draws.length; i++) { this.drawDraws(this.draws[i], false, this.context); }
		if (!prefs.draw.front) this.preDrawDrawing(this.context);
		for (i = 0; i < this.spots.length; i++) { this.drawSpotName(this.spots[i], false, this.context); }

		if (this.context.shadowBlur > 0) {
			this.context.shadowColor = 'transparent';
			this.context.globalAlpha = 1;
			this.context.shadowBlur = 0;
			this.context.shadowOffsetY = 0;
		}
	}

	reDraw(): void {
		if (!this.drawTimer) {
			this.drawTimer = setTimeout(() => { this.refresh(); }, 8);
		}
	}

	drawBubble(bub: Bubble): void {
		const ctx = this.bubblecontext;

		if (bub.user) {
			// Modern vertical gradient for all bubble types
			const padding = bubbleConsts.padding;
			let gy = bub.y - padding;
			const gheight = (bub.textHeight + padding * 2) * bub.size;
			const gw = bub.textWidth + padding * 2;
			gy += gw / 3 - (gheight * bub.size) / 3;
			const grd = ctx.createLinearGradient(0, gy, 0, gy + gheight);
			grd.addColorStop(0, getHsl(bub.color!, 84));
			grd.addColorStop(0.5, getHsl(bub.color!, 77));
			grd.addColorStop(1, getHsl(bub.color!, 70));

			ctx.fillStyle = grd;
		} else {
			ctx.fillStyle = 'white';
		}

		if (bub.thought) {
			ctx.shadowColor = 'RGBA(0,0,0,.4)';
			ctx.shadowOffsetY = 1;
			ctx.shadowBlur = 3;
			bub.makeThoughtBubble(ctx, performance.now());
		} else if (bub.shout) {
			ctx.shadowColor = 'RGBA(0,0,0,.4)';
			ctx.shadowOffsetY = 1;
			ctx.shadowBlur = 3;
			bub.makeShoutBubble(ctx);
		} else {
			// Softer, larger shadow for modern regular bubbles
			ctx.shadowColor = 'RGBA(0,0,0,.25)';
			ctx.shadowOffsetY = 3;
			ctx.shadowBlur = 10;
			bub.makeRegularBubble(ctx);
		}
		ctx.globalAlpha = bub.thought ? (bub.size - 0.1) * 0.78 : bub.size - 0.1;
		ctx.fill();

		// Gloss highlight on regular bubbles
		if (!bub.thought && !bub.shout) {
			bub.drawGloss(ctx);
		}

		if (bub.thought) {
			const now = performance.now();
			bub.drawThoughtHaze(ctx, now);
			bub.drawThoughtDots(ctx, now);
		}
	}

	drawSpot(spot: RuntimeSpot, above: boolean, ctx: CanvasRenderingContext2D): void {
		if (above === spot.toplayer) {
			if (spot.spotPathGradient || spot.spotGradient || spot.spotStyle || (spotConsts.ShowFrame & spot.flags) || (spotConsts.Shadow & spot.flags)) {
				this.makeHotSpot(spot, ctx);

				if (spot.spotPathGradient) {
					const pg = spot.spotPathGradient;
					const n = spot.points.length / 2;
					if (n >= 3) {
						const vx: number[] = [], vy: number[] = [];
						for (let i = 0; i < n; i++) {
							vx.push(spot.x + spot.points[i * 2]);
							vy.push(spot.y + spot.points[i * 2 + 1]);
						}
						let cx: number, cy: number;
						if (pg.useSpotPoint) {
							cx = spot.x; cy = spot.y;
						} else {
							cx = 0; cy = 0;
							for (let i = 0; i < n; i++) { cx += vx[i]; cy += vy[i]; }
							cx /= n; cy /= n;
						}
						let maxR = 0;
						for (let i = 0; i < n; i++) {
							const d = Math.sqrt((vx[i] - cx) ** 2 + (vy[i] - cy) ** 2);
							if (d > maxR) maxR = d;
						}
						if (maxR < 1) maxR = 1;
						const sc = pg.surroundColors;
						if (sc.length <= 1) {
							const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
							grad.addColorStop(0, pg.centerColor);
							grad.addColorStop(1, sc[0] || 'rgba(0,0,0,0)');
							ctx.fillStyle = grad;
							ctx.fill();
						} else {
							ctx.save();
							ctx.clip();
							for (let i = 0; i < n; i++) {
								const i2 = (i + 1) % n;
								const r = Math.max(
									Math.sqrt((vx[i] - cx) ** 2 + (vy[i] - cy) ** 2),
									Math.sqrt((vx[i2] - cx) ** 2 + (vy[i2] - cy) ** 2)
								);
								ctx.beginPath();
								ctx.moveTo(cx, cy);
								ctx.lineTo(vx[i], vy[i]);
								ctx.lineTo(vx[i2], vy[i2]);
								ctx.closePath();
								const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r || 1);
								grad.addColorStop(0, pg.centerColor);
								grad.addColorStop(1, sc[i % sc.length]);
								ctx.fillStyle = grad;
								ctx.fill();
							}
							ctx.restore();
						}
						if (spot.spotStyle && spot.spotStyle.borderSize > 0) {
							this.makeHotSpot(spot, ctx);
							ctx.strokeStyle = spot.spotStyle.borderColor;
							ctx.lineWidth = spot.spotStyle.borderSize;
							ctx.stroke();
						}
					}
				} else if (spot.spotGradient) {
					const g = spot.spotGradient;
					let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
					for (let i = 0; i < spot.points.length - 1; i += 2) {
						const px = spot.x + spot.points[i], py = spot.y + spot.points[i + 1];
						if (px < minX) minX = px; if (px > maxX) maxX = px;
						if (py < minY) minY = py; if (py > maxY) maxY = py;
					}
					if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
						const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
						const diag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2;
						const rad = g.angle * Math.PI / 180;
						const dx = Math.cos(rad) * diag, dy = Math.sin(rad) * diag;
						const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
						grad.addColorStop(0, g.firstColor);
						grad.addColorStop(1, g.secondColor);
						ctx.fillStyle = grad;
						ctx.fill();
					}
					// Border from spotStyle still applies over gradient
					if (spot.spotStyle && spot.spotStyle.borderSize > 0) {
						ctx.strokeStyle = spot.spotStyle.borderColor;
						ctx.lineWidth = spot.spotStyle.borderSize;
						ctx.stroke();
					}
				} else if (spot.spotStyle) {
					ctx.fillStyle = spot.spotStyle.backgroundColor;
					ctx.fill();
					if (spot.spotStyle.borderSize > 0) {
						ctx.strokeStyle = spot.spotStyle.borderColor;
						ctx.lineWidth = spot.spotStyle.borderSize;
						ctx.stroke();
					}
				} else {
					if (spotConsts.Shadow & spot.flags) {
						//ctx.fillStyle = 'black';
						//ctx.fill();
					}
					if (spotConsts.ShowFrame & spot.flags) {
						ctx.strokeStyle = 'black';
						ctx.lineWidth = 1;
						ctx.stroke();
					}
				}
			}
		}
	}

	roundRect(x: number, y: number, width: number, height: number, radius: number): void {
		this.context.beginPath();
		this.context.moveTo(x + radius, y);
		this.context.lineTo(x + width - radius, y);
		this.context.quadraticCurveTo(x + width, y, x + width, y + radius);
		this.context.lineTo(x + width, y + height - radius);
		this.context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		this.context.lineTo(x + radius, y + height);
		this.context.quadraticCurveTo(x, y + height, x, y + height - radius);
		this.context.lineTo(x, y + radius);
		this.context.quadraticCurveTo(x, y, x + radius, y);
		this.context.closePath();
		this.context.fill();
	}

	drawSpotName(_spot: RuntimeSpot, _above: boolean, _ctx: CanvasRenderingContext2D): void {
		// Nametags are now rendered as DOM div elements via setSpotNameTag
	}

	setSpotNameTag(spot: RuntimeSpot): void {
		if ((spotConsts.ShowName & spot.flags) && spot.name.length > 0) {
			if (!spot.nameTag) {
				spot.nameTag = document.createElement('div');
				spot.nameTag.className = 'spotnametag';
				palace.container.appendChild(spot.nameTag);
			}
			spot.nameTag.textContent = spot.name;
			spot.nameTag.style.left = `${spot.x}px`;
			spot.nameTag.style.top = `${spot.y}px`;
		} else if (spot.nameTag) {
			spot.nameTag.remove();
			spot.nameTag = undefined;
		}
	}

	makeHotSpot(spot: RuntimeSpot, ctx: CanvasRenderingContext2D = this.context): void {
		ctx.beginPath();
		const t = spot.curveTension ?? 0;
		if (t <= 0 || spot.points.length < 6) {
			// Straight lines (default)
			ctx.moveTo(spot.x + spot.points[0], spot.y + spot.points[1]);
			const len = spot.points.length - 1;
			for (let i = 2; i < len; i += 2) {
				ctx.lineTo(spot.x + spot.points[i], spot.y + spot.points[i + 1]);
			}
		} else {
			// GDI+ AddClosedCurve cardinal spline (tension = curve * 0.008, factor = tension / 3)
			const n = spot.points.length / 2;
			const px: number[] = [];
			const py: number[] = [];
			for (let i = 0; i < n; i++) {
				px.push(spot.x + spot.points[i * 2]);
				py.push(spot.y + spot.points[i * 2 + 1]);
			}
			const s = t * 0.008 / 3;
			ctx.moveTo(px[0], py[0]);
			for (let i = 0; i < n; i++) {
				const p0x = px[(i - 1 + n) % n], p0y = py[(i - 1 + n) % n];
				const p1x = px[i],               p1y = py[i];
				const p2x = px[(i + 1) % n],     p2y = py[(i + 1) % n];
				const p3x = px[(i + 2) % n],     p3y = py[(i + 2) % n];
				const cp1x = p1x + s * (p2x - p0x);
				const cp1y = p1y + s * (p2y - p0y);
				const cp2x = p2x - s * (p3x - p1x);
				const cp2y = p2y - s * (p3y - p1y);
				ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2x, p2y);
			}
		}
		ctx.closePath();
	}

	drawLooseProp(lProp: LooseProp): void {
		const aProp = cacheProps[lProp.id];
		if (aProp && aProp.isComplete) {
			let gAlpha = 1;
			if (aProp.ghost) gAlpha = gAlpha / 2;

			if (this.grabbedProp && this.grabbedProp.looseprop === lProp) {
				this.propcontext.globalAlpha = gAlpha / 2;
				this.propcontext.drawImage(aProp.img, this.grabbedProp.mx, this.grabbedProp.my);
			}
			if (lProp.light > 0) {
				this.propcontext.shadowColor = `rgba(0,255,255,${lProp.light})`;
				this.propcontext.shadowBlur = 4;
			}
			this.propcontext.globalAlpha = gAlpha;
			this.propcontext.drawImage(aProp.img, lProp.x, lProp.y);
			if (this.propcontext.shadowBlur > 0) {
				this.propcontext.shadowColor = 'transparent';
				this.propcontext.shadowBlur = 0;
			}
			if (this.propcontext.globalAlpha < 1) {
				this.propcontext.globalAlpha = 1;
			}
		}
	}

	drawLimboProp(): void {
		if (this.grabbedProp && !this.grabbedProp.looseprop) {
			const aProp = cacheProps[this.grabbedProp.id];
			if (aProp && aProp.isComplete) {
				if (aProp.ghost) this.propcontext.globalAlpha = 0.5;
				this.propcontext.globalAlpha = this.propcontext.globalAlpha / 2;
				this.propcontext.drawImage(aProp.img, this.grabbedProp.mx, this.grabbedProp.my);
				this.propcontext.globalAlpha = 1;
			}
		}
	}

	drawDraws(draw: DrawData, foreground: boolean, ctx: CanvasRenderingContext2D): void {
		if (Boolean(drawType.PENFRONT & draw.type) === foreground) {
			ctx.lineWidth = draw.pensize;
			ctx.fillStyle = draw.fillcolor;
			ctx.strokeStyle = draw.pencolor;

			if (!Boolean(draw.type & drawType.TEXT) && !Boolean(draw.type & drawType.OVAL)) {
				if (draw.type & drawType.ERASER) ctx.globalCompositeOperation = 'destination-out';
				ctx.beginPath();
				ctx.moveTo(draw.points[0], draw.points[1]);

				for (let item = 2; item < draw.points.length - 1; item += 2)
					ctx.lineTo(draw.points[item], draw.points[item + 1]);

				if (drawType.SHAPE & draw.type) {
					ctx.closePath();
					ctx.fill();
				}
				ctx.stroke();
				if (draw.type & drawType.ERASER) ctx.globalCompositeOperation = 'source-over';
			}
		}
	}

	preDrawDrawing(ctx: CanvasRenderingContext2D): void {
		const l = this.drawPoints.length;
		if (l > 0) {
			ctx.lineWidth = prefs.draw.size;
			ctx.fillStyle = prefs.draw.fill;
			ctx.strokeStyle = prefs.draw.color;

			ctx.beginPath();

			const offset = (prefs.draw.type !== 1 ? Math.floor(prefs.draw.size / 2) : 0);

			ctx.moveTo(this.drawPoints[0] + offset, this.drawPoints[1] + offset);

			for (let item = 2; item < l - 1; item += 2) {
				ctx.lineTo(this.drawPoints[item] + offset, this.drawPoints[item + 1] + offset);
			}

			if (prefs.draw.type === 2) {
				ctx.globalCompositeOperation = 'destination-out';
			} else if (prefs.draw.type === 1) {
				ctx.closePath();
				ctx.fill();
			}
			ctx.stroke();
			if (prefs.draw.type === 2) {
				ctx.globalCompositeOperation = 'source-over';
			}
		}
	}
}


export class PalaceRoom extends Renderer {
	id!: number;
	name!: string;
	flags!: number;
	background!: string;
	pics: PictureEntry[];
	users!: PalaceUser[];
	mouseLooseProp: number | null;
	mouseHoverUser: PalaceUser | null = null;
	mouseSelfProp: number | null = null;
	mouseOverSpot: RuntimeSpot | null = null;
	mouseDownSpot: RuntimeSpot | null = null;
	lastClickIsRight = false;
	lastMouseX = 0;
	lastMouseY = 0;
	whisperUserID: number | null = null;
	mCtx: CanvasRenderingContext2D;
	private _authoring = false;
	private _clipRegionCount = 0;
	private _clipRegionRafId = 0;
	get authoring(): boolean { return this._authoring; }
	set authoring(v: boolean) {
		if (v && !this._authoring) {
			IptEngine.abort();
			if (this._clipRegionRafId) { cancelAnimationFrame(this._clipRegionRafId); this._clipRegionRafId = 0; }
			this._clipRegionCount = 0;
			this.restoreSpotBackups();
		}
		this._authoring = v;
		palace.container.classList.toggle('authoring', v);
		document.getElementById('authoringbtn')?.classList.toggle('active', v);
	}
	dragImages = false;
	showCoords = false;
	autoUserLayer = false;
	selectedSpot: RuntimeSpot | null = null;
	private authorDrag: { spot: RuntimeSpot; pointIndex: number; offsetX: number; offsetY: number } | null = null;
	private authorDragMoved = false;
	private picDrag: { spot: RuntimeSpot; offsetX: number; offsetY: number } | null = null;
	private rightDragSlide = false;
	rightDragSlideEnded = false;
	private rightDragCleanup: (() => void) | null = null;
	private spotTip: HTMLDivElement | null = null;
	private spotTipSpot: RuntimeSpot | null = null;

	private startRightDragSlide(event: MouseEvent): void {
		const user = palace.theUser!;
		this.rightDragSlide = true;
		user.style.transition = 'none';
		user.domNametag.style.transition = 'none';

		// Pointer capture: routes all pointer events to the canvas even outside app
		super.canvas.setPointerCapture((event as PointerEvent).pointerId ?? 1);

		// Belt-and-suspenders failsafes
		const onWindowMouseUp = (e: MouseEvent) => { if (e.button === 2) this.stopRightDragSlide(); };
		const onWindowBlur = () => this.stopRightDragSlide();
		window.addEventListener('mouseup', onWindowMouseUp, true);
		window.addEventListener('blur', onWindowBlur);

		this.rightDragCleanup = () => {
			window.removeEventListener('mouseup', onWindowMouseUp, true);
			window.removeEventListener('blur', onWindowBlur);
			try { super.canvas.releasePointerCapture((event as PointerEvent).pointerId ?? 1); } catch { /* already released */ }
		};
	}

	private stopRightDragSlide(): void {
		if (!this.rightDragSlide) return;
		this.rightDragSlide = false;
		this.rightDragSlideEnded = true;
		if (this.rightDragCleanup) { this.rightDragCleanup(); this.rightDragCleanup = null; }
		const user = palace.theUser;
		if (user) {
			user.style.transition = '';
			user.domNametag.style.transition = '';
		}
	}

	private clampSlidePos(x: number, y: number): [number, number] {
		return [
			Math.max(22, Math.min(palace.roomWidth - 22, x)),
			Math.max(22, Math.min(palace.roomHeight - 22, y)),
		];
	}

	private static spotTypeNames: Record<number, string> = {
		0: 'Normal', 1: 'Passage', 2: 'Shutable', 3: 'Lockable', 4: 'Dead Bolt', 5: 'Nav Area'
	};

	constructor(info: RoomConstructorInfo) {
		super(palace.canvas, palace.canvas2, palace.canvas3, palace.canvas4);

		Object.assign(this, info);

		super.canvas.onmousedown = (e) => { this.mouseDown(e); };
		super.canvas.onmousemove = (e) => { this.mouseMove(e); };
		super.canvas.onmouseup = (e) => { this.mouseUp(e); };
		super.canvas.onmouseleave = (e) => { this.mouseLeave(e); };
		super.canvas.ondblclick = (e) => { this.dblClick(e); };
		super.canvas.oncontextmenu = (e) => { this.contextMenu(e); };
		super.canvas.ondrop = (e) => { this.drop(e); };
		super.canvas.ondragover = (e) => { this.dragOver(e); };

		this.mouseLooseProp = null;

		const mCanvas = document.createElement('canvas');
		mCanvas.width = 220;
		mCanvas.height = 220;
		this.mCtx = mCanvas.getContext('2d', { willReadFrequently: true })!;

		if (!info.authored) {
			Bubble.deleteAllBubbles();
		}

		document.getElementById('palaceroom')!.innerText = this.name;

		const media = palace.passUrl(this.background);

		if (media !== palace.lastLoadedBG) {
			palace.setRoomBG(super.canvas.width, super.canvas.height, '');
			palace.toggleLoadingBG(true);

			palace.currentBG = media;
			const ext = parseURL(media).pathname.split('.').pop()!;
			if (['jpg', 'jpeg', 'bmp', 'png', 'apng', 'gif', 'svg', 'webp', 'pdf', 'ico'].indexOf(ext) > -1) {
				palace.setBackGround(media);
			} else {
				httpHeadAsync(media, (contentType: string) => {
					if (contentType.indexOf('video') > -1 || ['mp4', 'ogg', 'webm', 'm4v'].indexOf(ext) > -1) {
						palace.setBackGroundVideo(media);
					} else {
						palace.setBackGround(media);
					}
				});
			}
		} else {
			// Same background already loaded — fire ROOMREADY immediately
			setTimeout(() => { if (palace.theRoom === this) this.executeEvent('ROOMREADY'); }, 0);
		}

		palace.removeSpotPicElements();

		this.pics = [];

		info.pictures.forEach((pict) => {
			const newImg = document.createElement('img');
			newImg.onload = () => {
				if (this === palace.theRoom) {
					this.spots.forEach((spot) => {
						if (!spot.img) {
							spot.img = PalaceRoom.createSpotPicPlaceholder();
							palace.container.appendChild(spot.img);
						}
						this.setSpotImg(spot);
					});
				}
			};
			pict.img = newImg;

			this.pics[pict.id] = pict;
			newImg.src = palace.passUrl(pict.name);
		});

		this.spots.forEach((spot) => {
			if (spot.script !== '') {
				spot.handlers = IptEngine.parseEventHandlers(spot.script);
			}
			this.setSpotNameTag(spot);
		});
		
	}

	dragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	drop(event: DragEvent): void {
		if (palace.theUser && dragBagProp) {
			event.preventDefault();
			const x = (event.layerX / viewScale).fastRound();
			const y = (event.layerY / viewScale).fastRound();
			
			const overSelf = (palace.theUser && palace.theUser.x - 22 < x && palace.theUser.x + 22 > x && palace.theUser.y - 22 < y && palace.theUser.y + 22 > y);
			const dragBP = dragBagProp;

			loadProps([dragBP.id], true, () => {
				const prop = cacheProps[dragBP.id];
				if (prop) {
					if (!overSelf) {
						const dx = (dragBP.x * prop.w / dragBP.w).fastRound();
						const dy = (dragBP.y * prop.h / dragBP.h).fastRound();
						palace.sendPropDrop(x - dx, y - dy, dragBP.id);
					} else {
						palace.addSelfProp(dragBP.id);
						palace.selfPropChange();
					}
				}
			});
		}
	}

	setEnvCursor(name: string): void {
		if (super.canvas.dataset.cursorName !== name) {
			super.canvas.style.cursor = name;
			super.canvas.dataset.cursorName = name;
		}
	}

	mouseMove(event: MouseEvent): boolean | void {
		if (this.users && palace.theUser) {
			const isDrawing = (document.getElementById('drawcheckbox') as HTMLInputElement).checked;

			if (isDrawing) {
				switch (prefs.draw.type) {
					case 1: this.setEnvCursor('url(img/bucket.cur) 16 13,crosshair'); break;
					case 2: this.setEnvCursor('url(img/eraser.cur) 5 15,crosshair'); break;
					default: this.setEnvCursor('url(img/pen.cur) 1 14,crosshair');
				}
				return true;
			}

			const x = (event.layerX / viewScale).fastRound();
			const y = (event.layerY / viewScale).fastRound();

			this.lastMouseX = x;
			this.lastMouseY = y;

			if (this.showCoords) this.reDrawTop();

			// Authoring drag: move vertex or whole spot
			if (this.authorDrag && (event.buttons & 1)) {
				this.hideSpotTip();
				this.authorDragMoved = true;
				const drag = this.authorDrag;
				const cw = super.canvas.width;
				const ch = super.canvas.height;
				if (drag.pointIndex === -2) {
					// Origin drag — move x,y and compensate points so they stay on screen
					const newX = Math.max(0, Math.min(cw, x));
					const newY = Math.max(0, Math.min(ch, y));
					const dx = newX - drag.spot.x;
					const dy = newY - drag.spot.y;
					for (let i = 0; i < drag.spot.points.length; i += 2) {
						drag.spot.points[i] -= dx;
						drag.spot.points[i + 1] -= dy;
					}
					drag.spot.x = newX;
					drag.spot.y = newY;
				} else if (drag.pointIndex >= 0) {
					// Single vertex drag — clamp absolute position to room bounds
					const vx = Math.max(0, Math.min(cw, x)) - drag.spot.x;
					const vy = Math.max(0, Math.min(ch, y)) - drag.spot.y;
					drag.spot.points[drag.pointIndex] = vx;
					drag.spot.points[drag.pointIndex + 1] = vy;
				} else {
					// Whole spot drag — clamp so all points stay within room bounds
					let newX = x - drag.offsetX;
					let newY = y - drag.offsetY;
					const pts = drag.spot.points;
					let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
					for (let i = 0; i < pts.length - 1; i += 2) {
						if (pts[i] < pMinX) pMinX = pts[i];
						if (pts[i] > pMaxX) pMaxX = pts[i];
						if (pts[i + 1] < pMinY) pMinY = pts[i + 1];
						if (pts[i + 1] > pMaxY) pMaxY = pts[i + 1];
					}
					newX = Math.max(-pMinX, Math.min(cw - pMaxX, newX));
					newY = Math.max(-pMinY, Math.min(ch - pMaxY, newY));
					drag.spot.x = newX;
					drag.spot.y = newY;
				}
				this.reDrawTop();
				this.reDraw();
				this.setSpotNameTag(drag.spot);
				return;
			}

			// Drag Images mode: drag spot statepic
			if (this.picDrag && (event.buttons & 1)) {
				const drag = this.picDrag;
				const statepic = drag.spot.statepics[drag.spot.state];
				if (statepic) {
					statepic.x = x - drag.spot.x - drag.offsetX;
					statepic.y = y - drag.spot.y - drag.offsetY;
					this.setSpotImg(drag.spot);
				}
				return;
			}

			// Right-click drag slide: preview avatar position
			if (this.rightDragSlide && palace.theUser && (event.buttons & 2)) {
				const [cx, cy] = this.clampSlidePos(x, y);
				palace.theUser.x = cx;
				palace.theUser.y = cy;
				palace.theUser.setAvatarLocation();
				return;
			}

			if (!this.grabbedProp) {
				let selfPropPid: number | undefined;
				if (!palace.theUser.avatarLocked || event.shiftKey) {
					selfPropPid = this.mouseOverSelfProp(x, y);
				}

				if (!event.shiftKey) {
					const mUser = this.mouseOverUser(x, y);
					const skipSelfHover = mUser === palace.theUser && selfPropPid;
					if (skipSelfHover) {
						this.mouseExitUser();
					} else if (this.mouseHoverUser !== mUser) {
						if (mUser != null) {
							this.mouseEnterUser(mUser);
						} else {
							this.mouseExitUser();
						}
					}
				} else {
					this.mouseExitUser();
				}

				if (selfPropPid !== undefined) {
					if (this.mouseSelfProp !== selfPropPid) {
						this.mouseEnterSelfProp(selfPropPid);
					}
				} else {
					this.mouseExitSelfProp();
				}

				const lpIndex = this.mouseOverLooseProp(x, y);
				if (lpIndex !== this.mouseLooseProp) {
					if (lpIndex !== undefined) {
						this.mouseEnterLooseProp(lpIndex);
					} else {
						this.mouseExitLooseProp();
					}
				}
			} else {
				this.mouseExitLooseProp();
				this.mouseExitSelfProp();

				if (palace.theUser.x - 22 < x && palace.theUser.x + 22 > x && palace.theUser.y - 22 < y && palace.theUser.y + 22 > y) {
					palace.addSelfProp(this.grabbedProp.id);
					this.grabbedProp.mx = -999;
					this.grabbedProp.my = -999;
				} else {
					if (event.altKey === false && ((palace.theUser as any).propsChanged === true || !this.grabbedProp.looseprop)) {
						palace.removeSelfProp(this.grabbedProp.id);
					}

					this.grabbedProp.mx = (x - this.grabbedProp.offsetX);
					this.grabbedProp.my = (y - this.grabbedProp.offsetY);
				}
				this.reDrawProps();
			}

			if (this.grabbedProp && event.altKey) {
				this.setEnvCursor('copy');
			} else if (this.mouseLooseProp !== null || this.mouseSelfProp || this.grabbedProp) {
				this.setEnvCursor('move');
			} else if (this.dragImages && this.mouseOverSpotPic(x, y)) {
				this.setEnvCursor('move');
			} else if (this.mouseHoverUser === palace.theUser && event.ctrlKey) {
				this.setEnvCursor('context-menu');
			} else {
				const spot = this.mouseInSpot(x, y);

				// Spot hover tracking for ROLLOVER/ROLLOUT/MOUSEMOVE events
				if (spot !== this.mouseOverSpot) {
					if (this.mouseOverSpot && !this.authoring) {
						this.executeSpotEventWithContext('ROLLOUT', this.mouseOverSpot, (ctx) => {
							ctx.mouseX = x;
							ctx.mouseY = y;
						});
					}
					this.mouseOverSpot = spot ?? null;
					if (this.mouseOverSpot && !this.authoring) {
						this.executeSpotEventWithContext('ROLLOVER', this.mouseOverSpot, (ctx) => {
							ctx.mouseX = x;
							ctx.mouseY = y;
						});
					}
				} else if (this.mouseOverSpot && !this.authoring) {
					
					const spot = this.mouseOverSpot;
					if (spot.handlers && spot.handlers['MOUSEMOVE']) {
						
						const ctx = new PalaceExecutionContext(IptEngine);
						ctx.hotspotId = spot.id;
						ctx.eventName = 'MOUSEMOVE';
						ctx.mouseX = x;
						ctx.mouseY = y;
						//mousemove event not always firing, need to figure out why still.
						//logmsg(`MouseMove on spot ${this.mouseOverSpot.id}`);
						IptEngine.executeTokenListSync(spot.handlers['MOUSEMOVE'], ctx);
					}
				}

				// MOUSEDRAG: fires continuously while mouse button held and dragging over the spot
				if (!this.authoring && this.mouseDownSpot && (event.buttons & 1) && spot === this.mouseDownSpot) {
					this.executeSpotEventWithContext('MOUSEDRAG', this.mouseDownSpot, (ctx) => {
						ctx.mouseX = x;
						ctx.mouseY = y;
					});
				}

				if (this.authoring) {
					// Authoring cursor: check for vertex handle hit on any spot
					const vertexHit = this.hitTestVertex(x, y);
					if (vertexHit) {
						this.setEnvCursor('crosshair');
					} else if (spot) {
						this.setEnvCursor('move');
					} else {
						this.setEnvCursor('default');
					}
					// Authoring spot tooltip
					if (spot && spot !== this.spotTipSpot) {
						this.showSpotTip(spot, event.clientX, event.clientY);
					} else if (spot && this.spotTip) {
						this.spotTip.style.left = `${event.clientX + 14}px`;
						this.spotTip.style.top = `${event.clientY + 14}px`;
					} else if (!spot) {
						this.hideSpotTip();
					}
				} else if ((this.mouseHoverUser && this.mouseHoverUser !== palace.theUser) || (spot && spot.type > 0)) {
					this.setEnvCursor('pointer');
				} else {
					this.setEnvCursor('default');
				}
			}
		}
	}

	mouseLeave(_event: MouseEvent): void {
		this.mouseExitSelfProp();
		this.mouseExitLooseProp();
		this.mouseExitUser();
		if (this.mouseOverSpot) {
			this.executeSpotEvent('ROLLOUT', this.mouseOverSpot);
			this.mouseOverSpot = null;
		}
		this.mouseDownSpot = null;
		this.picDrag = null;
		this.stopRightDragSlide();
		this.hideSpotTip();
	}

	private showSpotTip(spot: RuntimeSpot, cx: number, cy: number): void {
		this.hideSpotTip();
		const tip = document.createElement('div');
		tip.className = 'spot-tip';
		const typeName = PalaceRoom.spotTypeNames[spot.type] || 'Unknown';
		tip.innerHTML =
			`<b>Spot Info</b>` +
			`<table>` +
			`<tr><td>Name:</td><td>${spot.name || ''}</td></tr>` +
			`<tr><td>Type:</td><td>${typeName}</td></tr>` +
			`<tr><td>ID:</td><td>${spot.id}</td></tr>` +
			`<tr><td>State:</td><td>${spot.state}</td></tr>` +
			`<tr><td>Dest:</td><td>${spot.dest}</td></tr>` +
			`<tr><td>Pics:</td><td>${spot.statepics.length}</td></tr>` +
			`</table>`;
		tip.style.left = `${cx + 14}px`;
		tip.style.top = `${cy + 14}px`;
		document.body.appendChild(tip);
		this.spotTip = tip;
		this.spotTipSpot = spot;
	}

	hideSpotTip(): void {
		if (this.spotTip) {
			this.spotTip.remove();
			this.spotTip = null;
			this.spotTipSpot = null;
		}
	}

	mouseUp(event: MouseEvent): void {
		if (this.authorDrag) {
			this.authorDrag = null;
			if (this.authorDragMoved) {
				this.authorDragMoved = false;
				this.reDrawTop();
				this.reDraw();
				palace.sendRoomSetDesc();
			}
		}
		if (this.picDrag) {
			const drag = this.picDrag;
			const statepic = drag.spot.statepics[drag.spot.state];
			if (statepic) {
				palace.sendPictMove(drag.spot.id, statepic.y, statepic.x);
			}
			this.picDrag = null;
		}
		if (this.rightDragSlide && palace.theUser) {
			const x = (event.layerX / viewScale).fastRound();
			const y = (event.layerY / viewScale).fastRound();
			this.stopRightDragSlide();
			palace.setpos(x, y);
			return;
		}
		if (this.grabbedProp) {
			const x = (event.layerX / viewScale).fastRound();
			const y = (event.layerY / viewScale).fastRound();
			const overSelf = (palace.theUser && palace.theUser.x - 22 < x && palace.theUser.x + 22 > x && palace.theUser.y - 22 < y && palace.theUser.y + 22 > y);
			if (!this.grabbedProp.looseprop) {
				if (!overSelf) {
					palace.sendPropDrop(x - this.grabbedProp.offsetX, y - this.grabbedProp.offsetY, this.grabbedProp.id);
				} else {
					palace.addSelfProp(this.grabbedProp.id);
				}
			} else {
				if (!event.altKey) {
					const index = this.looseProps.indexOf(this.grabbedProp.looseprop);
					if (index > -1) {
						if (overSelf) {
							palace.sendPropDelete(index);
						} else {
							palace.sendPropMove(x - this.grabbedProp.offsetX, y - this.grabbedProp.offsetY, index);
						}
					}
				} else {
					if (!overSelf) {
						palace.sendPropDrop(x - this.grabbedProp.offsetX, y - this.grabbedProp.offsetY, this.grabbedProp.id);
					}
				}
			}
			this.reDrawProps();
		}
		this.grabbedProp = null;
		this.mouseDownSpot = null;
		if (palace.theUser && (palace.theUser as any).propsChanged === true) {
			palace.selfPropChange();
		}
		// Fire MOUSEUP on the spot under the cursor
		if (palace.theUser && !this.authoring) {
			const mx = (event.layerX / viewScale).fastRound();
			const my = (event.layerY / viewScale).fastRound();
			const spot = this.mouseInSpot(mx, my);
			if (spot) {
				this.executeSpotEventWithContext('MOUSEUP', spot, (ctx) => {
					ctx.mouseX = mx;
					ctx.mouseY = my;
				});
			}
		}
	}

	clickSpotInfo(x: number, y: number): { spot?: RuntimeSpot; dontMove?: boolean } {
		const ai: { spot?: RuntimeSpot; dontMove?: boolean } = {};
		let spot;
		for (let i = this.spots.length; --i >= 0;) {
			spot = this.spots[i];
			this.makeHotSpot(spot);
			if (this.context.isPointInPath(x, y)) {
				if (ai.spot == null) ai.spot = spot;
				if (spotConsts.DontMoveHere & spot.flags) ai.dontMove = true;
			}
		}
		return ai;
	}

	/** Hit-test vertex handles across all spots, prioritizing the selected spot. Returns the spot and point index, or null. */
	private hitTestVertex(x: number, y: number): { spot: RuntimeSpot; pointIndex: number } | null {
		const radius = 3; // matches the drawn handle size (6x6 square, ±3)
		let best: { spot: RuntimeSpot; pointIndex: number; dist: number } | null = null;
		// Check selected spot first for priority
		const ordered = this.selectedSpot
			? [this.selectedSpot, ...this.spots.filter(s => s !== this.selectedSpot)]
			: this.spots;
		for (const sp of ordered) {
			// Origin target handle (selected spot only, pointIndex -2)
			if (sp === this.selectedSpot) {
				const odx = x - sp.x;
				const ody = y - sp.y;
				if (odx * odx + ody * ody <= 9) { // radius ~3 matches drawn circle
					return { spot: sp, pointIndex: -2 };
				}
			}
			for (let p = 0; p < sp.points.length; p += 2) {
				const vx = sp.x + sp.points[p];
				const vy = sp.y + sp.points[p + 1];
				const dx = x - vx;
				const dy = y - vy;
				if (dx >= -radius && dx <= radius && dy >= -radius && dy <= radius) {
					const dist = dx * dx + dy * dy;
					if (!best || dist < best.dist) {
						best = { spot: sp, pointIndex: p, dist };
					}
				}
			}
			// If we found a hit on the selected spot, use it immediately (priority)
			if (best && sp === this.selectedSpot) return best;
		}
		return best;
	}

	get noPainting(): boolean {
		return Boolean(this.flags & 0x0004);
	}

	get noUserScripts(): boolean {
		return Boolean(this.flags & 0x0010);
	}

	mouseDown(event: MouseEvent): boolean | void {
		if (document.activeElement !== document.body) {
			(document.activeElement as HTMLElement).blur();
		}
		if (palace.theUser && event.button === 0) {
			event.preventDefault();
			const isDrawing = (document.getElementById('drawcheckbox') as HTMLInputElement).checked;
			const x = (event.layerX / viewScale).fastRound();
			const y = ((event.layerY) / viewScale).fastRound();
			if (isDrawing) {
				if (!palace.allowPainting && !palace.isOperator) {
					logmsg('Painting is not allowed on this server.');
					return false;
				}
				if (this.noPainting && !palace.isOperator) {
					logmsg('Painting is not allowed in this room.');
					return false;
				}
				this.startDrawing(x, y);
			} else {
				// Drag Images mode: check for spot statepic hit
				if (this.dragImages) {
					for (let si = this.spots.length - 1; si >= 0; si--) {
						const sp = this.spots[si];
						const statepic = sp.statepics[sp.state];
						if (!statepic || !sp.img || !this.pics[statepic.id]) continue;
						const img = this.pics[statepic.id].img as HTMLImageElement;
						if (!img || !img.naturalWidth) continue;
						const iw = parseInt(sp.img.style.width) || img.naturalWidth;
						const ih = parseInt(sp.img.style.height) || img.naturalHeight;
						const ix = parseInt(sp.img.style.left) || 0;
						const iy = parseInt(sp.img.style.top) || 0;
						if (x >= ix && x < ix + iw && y >= iy && y < iy + ih) {
							// Offset from the center of the image relative to spot loc
							const cx = Math.trunc(iw / 2);
							const cy = Math.trunc(ih / 2);
							this.picDrag = { spot: sp, offsetX: x - ix - cx, offsetY: y - iy - cy };
							return;
						}
					}
				}

				const mUser = this.mouseOverUser(x, y);
				if (!event.shiftKey && mUser !== palace.theUser && mUser) {
					this.enterWhisperMode(mUser.id, mUser.name);
				} else {
					let lpIndex: number | undefined;
					let pid: number | undefined;

					if (!palace.theUser.avatarLocked || event.shiftKey) {
						pid = this.mouseOverSelfProp(x, y);
					}
					if (!pid) {
						lpIndex = this.mouseOverLooseProp(x, y);
					}

					if (pid) {
						const aProp = cacheProps[pid];
						this.makeDragProp(null, pid, x, y, x - aProp.x - palace.theUser.x + 22, y - aProp.y - palace.theUser.y + 22);
					} else if (lpIndex != null) {
						const lProp = this.looseProps[lpIndex];
						this.makeDragProp(lProp, lProp.id, x, y, x - lProp.x, y - lProp.y);
					} else if (!mUser || mUser === palace.theUser) {
						const areaInfo = this.clickSpotInfo(x, y);
						if (this.authoring) {
							// In authoring mode: check vertex handles on any spot first
							const vtx = this.hitTestVertex(x, y);
							if (vtx) {
								this.selectedSpot = vtx.spot;
								this.mouseDownSpot = vtx.spot;
								this.reDrawTop();
								this.authorDrag = { spot: vtx.spot, pointIndex: vtx.pointIndex, offsetX: 0, offsetY: 0 };
							} else {
								this.selectedSpot = areaInfo.spot ?? null;
								this.mouseDownSpot = areaInfo.spot ?? null;
								this.reDrawTop();
								if (areaInfo.spot) {
									this.authorDrag = { spot: areaInfo.spot, pointIndex: -1, offsetX: x - areaInfo.spot.x, offsetY: y - areaInfo.spot.y };
								}
							}
						} else {
							if (areaInfo.dontMove !== true) palace.setpos(x, y);
							this.mouseDownSpot = areaInfo.spot ?? null;
							this.lastClickIsRight = false;
							if (areaInfo.spot) {
								this.selectSpot(areaInfo.spot);
							}
						}
					}
				}
			}
		}
		if (palace.theUser && event.button === 2 && !this.authoring && getGeneralPref('rClickSlide')) {
			const x = (event.layerX / viewScale).fastRound();
			const y = ((event.layerY) / viewScale).fastRound();
			const areaInfo = this.clickSpotInfo(x, y);
			if (!areaInfo.spot && !this.mouseOverUser(x, y)) {
				this.startRightDragSlide(event);
				const [cx, cy] = this.clampSlidePos(x, y);
				palace.theUser.x = cx;
				palace.theUser.y = cy;
				palace.theUser.setAvatarLocation();
			}
		}
	}

	contextMenu(event: MouseEvent): void {
		event.preventDefault();
		if (!palace.theUser || this.authoring) return;
		if (this.rightDragSlide || this.rightDragSlideEnded) {
			this.rightDragSlideEnded = false;
			return;
		}
		const x = (event.layerX / viewScale).fastRound();
		const y = ((event.layerY) / viewScale).fastRound();
		const areaInfo = this.clickSpotInfo(x, y);
		if (areaInfo.spot) {
			this.lastClickIsRight = true;
			this.executeSpotEvent('SELECT', areaInfo.spot);
			this.executeSpotEvent('MOUSEDOWN', areaInfo.spot);
		}
	}

	dblClick(event: MouseEvent): void {
		if (this.authoring && palace.theUser && event.button === 0) {
			event.preventDefault();
			const x = (event.layerX / viewScale).fastRound();
			const y = ((event.layerY) / viewScale).fastRound();
			// Double-click origin handle: center it relative to its points
			if (this.selectedSpot) {
				const dx = x - this.selectedSpot.x;
				const dy = y - this.selectedSpot.y;
				if (dx * dx + dy * dy <= 16) {
					const pts = this.selectedSpot.points;
					let cx = 0, cy = 0;
					const n = pts.length / 2;
					for (let i = 0; i < pts.length; i += 2) {
						cx += this.selectedSpot.x + pts[i];
						cy += this.selectedSpot.y + pts[i + 1];
					}
					cx = Math.round(cx / n);
					cy = Math.round(cy / n);
					const offX = cx - this.selectedSpot.x;
					const offY = cy - this.selectedSpot.y;
					for (let i = 0; i < pts.length; i += 2) {
						pts[i] -= offX;
						pts[i + 1] -= offY;
					}
					this.selectedSpot.x = cx;
					this.selectedSpot.y = cy;
					this.reDrawTop();
					this.reDraw();
					palace.sendRoomSetDesc();
					return;
				}
			}
			const spot = this.mouseInSpot(x, y);
			if (spot) {
				showSpotEditor(spot, this);
			}
		}
	}

	static createSpotPicPlaceholder(): HTMLSpanElement {
		const ph = document.createElement('span');
		ph.className = 'spotholder';
		return ph;
	}

	startDrawing(x: number, y: number): void {
		if (palace.calcRoomDescSize() > 15000) {
			logmsg('Room data is too large to add drawings. Remove some scripting or doors first.');
			return;
		}
		const offset = (prefs.draw.type !== 1 ? Math.floor(prefs.draw.size / 2) : 0);
		this.drawPoints = [x - offset, y - offset];

		const drawing = (event: MouseEvent) => {
			const newx = ((event.x + window.scrollX - palace.container.offsetLeft) / viewScale).fastRound() - offset;
			const newy = ((event.y + window.scrollY - palace.containerOffsetTop) / viewScale).fastRound() - offset;
			if (event.shiftKey && this.drawPoints.length > 3) {
				this.drawPoints[this.drawPoints.length - 2] = newx;
				this.drawPoints[this.drawPoints.length - 1] = newy;
			} else {
				this.drawPoints.push(newx);
				this.drawPoints.push(newy);
			}
			prefs.draw.front ? this.reDrawTop() : this.reDraw();
		};

		const drawingEnd = () => {
			palace.sendDraw({
				type: prefs.draw.type,
				front: prefs.draw.front,
				color: getNbrs(prefs.draw.color),
				fill: getNbrs(prefs.draw.fill),
				size: prefs.draw.size,
				points: this.drawPoints
			});
			window.removeEventListener('mousemove', drawing);
			window.removeEventListener('mouseup', drawingEnd);
			this.drawPoints = [];
		};

		window.addEventListener('mousemove', drawing);
		window.addEventListener('mouseup', drawingEnd);
	}

	draw(draw: DrawData): void {
		if (drawType.CLEAN & draw.type) {
			this.draws = [];
			this.reDraw();
			this.reDrawTop();
		} else if (drawType.UNDO & draw.type) {
			const d = this.draws.pop();
			if (d) {
				if (d.type & drawType.PENFRONT) {
					this.reDrawTop();
				} else {
					this.reDraw();
				}
			}
		} else {
			this.draws.push(draw);
			if (draw.type & drawType.PENFRONT) {
				this.reDrawTop();
			} else {
				this.reDraw();
			}
		}
	}

	/** Build an SVG path d-string for a spot's polygon (absolute coords), optionally offset. */
	private spotPolygonPath(spot: RuntimeSpot, offX: number, offY: number): string {
		const t = spot.curveTension ?? 0;
		const n = spot.points.length / 2;
		if (t > 0 && n >= 3) {
			const px: number[] = [];
			const py: number[] = [];
			for (let i = 0; i < n; i++) {
				px.push(spot.x + spot.points[i * 2] - offX);
				py.push(spot.y + spot.points[i * 2 + 1] - offY);
			}
			const s = t * 0.008 / 3;
			let d = `M${px[0]},${py[0]}`;
			for (let i = 0; i < n; i++) {
				const p0x = px[(i - 1 + n) % n], p0y = py[(i - 1 + n) % n];
				const p1x = px[i],               p1y = py[i];
				const p2x = px[(i + 1) % n],     p2y = py[(i + 1) % n];
				const p3x = px[(i + 2) % n],     p3y = py[(i + 2) % n];
				const cp1x = p1x + s * (p2x - p0x);
				const cp1y = p1y + s * (p2y - p0y);
				const cp2x = p2x - s * (p3x - p1x);
				const cp2y = p2y - s * (p3y - p1y);
				d += `C${cp1x},${cp1y},${cp2x},${cp2y},${p2x},${p2y}`;
			}
			return d + 'Z';
		}
		let d = `M${spot.x + spot.points[0] - offX},${spot.y + spot.points[1] - offY}`;
		for (let i = 2; i < spot.points.length - 1; i += 2) {
			d += `L${spot.x + spot.points[i] - offX},${spot.y + spot.points[i + 1] - offY}`;
		}
		return d + 'Z';
	}

	/** Bounding box of a spot's polygon points. */
	private spotBBox(spot: RuntimeSpot): { minX: number; minY: number; maxX: number; maxY: number } {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (let i = 0; i < spot.points.length - 1; i += 2) {
			const px = spot.x + spot.points[i];
			const py = spot.y + spot.points[i + 1];
			if (px < minX) minX = px;
			if (px > maxX) maxX = px;
			if (py < minY) minY = py;
			if (py > maxY) maxY = py;
		}
		return { minX, minY, maxX, maxY };
	}

	/** Test if a point is inside a spot's polygon (with optional curve tension approximated as straight segments). */
	private pointInSpotPoly(spot: RuntimeSpot, tx: number, ty: number): boolean {
		const n = spot.points.length / 2;
		if (n < 2) return false;
		let inside = false;
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const xi = spot.x + spot.points[i * 2], yi = spot.y + spot.points[i * 2 + 1];
			const xj = spot.x + spot.points[j * 2], yj = spot.y + spot.points[j * 2 + 1];
			if (((yi > ty) !== (yj > ty)) && (tx < (xj - xi) * (ty - yi) / (yj - yi) + xi)) {
				inside = !inside;
			}
		}
		return inside;
	}

	/** Test if an image rect overlaps a spot's polygon (AABB pre-check + corner/center point tests). */
	private imgOverlapsSpotPoly(spot: RuntimeSpot, imgL: number, imgT: number, imgW: number, imgH: number): boolean {
		const bb = this.spotBBox(spot);
		// AABB pre-check
		if (imgL + imgW <= bb.minX || imgL >= bb.maxX || imgT + imgH <= bb.minY || imgT >= bb.maxY) return false;
		// Test image corners and center against polygon
		const testPts = [
			[imgL, imgT], [imgL + imgW, imgT],
			[imgL, imgT + imgH], [imgL + imgW, imgT + imgH],
			[imgL + imgW / 2, imgT + imgH / 2],
		];
		for (const [px, py] of testPts) {
			if (this.pointInSpotPoly(spot, px, py)) return true;
		}
		// Test polygon points against image rect (polygon may be inside image)
		for (let i = 0; i < spot.points.length - 1; i += 2) {
			const px = spot.x + spot.points[i];
			const py = spot.y + spot.points[i + 1];
			if (px >= imgL && px <= imgL + imgW && py >= imgT && py <= imgT + imgH) return true;
		}
		return false;
	}

	/** Build a CSS clip-path for the spot image based on clipMode and mode-2 clip regions. */
	private computeSpotClipPath(spot: RuntimeSpot, imgLeft: number, imgTop: number, imgWidth: number, imgHeight: number): string {
		const cm = spot.clipMode ?? 0;

		// Self-clip (modes 1/-1)
		let selfClip = '';
		if ((cm === 1 || cm === -1) && spot.points.length >= 4) {
			const d = this.spotPolygonPath(spot, imgLeft, imgTop);
			if (cm === 1) {
				selfClip = d;
			} else {
				selfClip = `M-9999,-9999L9999,-9999L9999,9999L-9999,9999Z${d}`;
			}
		}

		// Mode-2 region clips from other spots
		const regionPaths: string[] = [];
		for (let i = 0; i < this.spots.length; i++) {
			const cs = this.spots[i];
			if (cs === spot || cs.clipMode !== 2 || cs.points.length < 4) continue;
			if (!this.imgOverlapsSpotPoly(cs, imgLeft, imgTop, imgWidth, imgHeight)) continue;
			regionPaths.push(this.spotPolygonPath(cs, imgLeft, imgTop));
		}

		if (regionPaths.length === 0 && !selfClip) return '';

		// Mode-2 regions punch out (hide) the overlapping area, so invert each region path
		const big = 'M-9999,-9999L9999,-9999L9999,9999L-9999,9999Z';

		if (regionPaths.length === 0) {
			// Self-clip only
			if (cm === -1) return `path(evenodd,"${selfClip}")`;
			return `path("${selfClip}")`;
		}

		if (!selfClip) {
			// Region cutout(s) only — punch out all region polygons from a full rect
			return `path(evenodd,"${big}${regionPaths.join('')}")`;
		}

		// Both self-clip and region cutout:
		if (cm === -1) {
			// Mode -1 (inverted self) + region cutouts: hide self polygon AND region polygons
			return `path(evenodd,"${big}${this.spotPolygonPath(spot, imgLeft, imgTop)}${regionPaths.join('')}")`;
		}
		// Mode 1 (clip to self) + region cutouts: show only inside self, minus region holes
		// self visible, then punch out regions inside it
		return `path(evenodd,"${big}${selfClip}${regionPaths.join('')}")`;
	}

	setSpotImg(spot: RuntimeSpot): void {
		const statepic = spot.statepics[spot.state];
		if (statepic && this.pics[statepic.id]) {
			let img = this.pics[statepic.id].img;
			if (img.naturalWidth > 0) {
				if (!spot.img) {
					spot.img = PalaceRoom.createSpotPicPlaceholder();
					palace.container.appendChild(spot.img);
				}
				const mode = spot.picMode || 0;
				let left: string, top: string, width = '', height = '';
				let pixelated = false;

				if (mode === 1) {
					// Mode 1: top-left of pic at spot loc, natural size
					left = `${spot.x}px`;
					top = `${spot.y}px`;
				} else if (mode >= 2) {
					// Compute spot bounding box
					let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
					for (let i = 0; i < spot.points.length - 1; i += 2) {
						const px = spot.x + spot.points[i];
						const py = spot.y + spot.points[i + 1];
						if (px < minX) minX = px;
						if (px > maxX) maxX = px;
						if (py < minY) minY = py;
						if (py > maxY) maxY = py;
					}
					const bw = maxX - minX;
					const bh = maxY - minY;
					if (mode === 2 || mode === 3) {
						// Modes 2/3: stretch to fill bounds, ignore aspect ratio
						left = `${minX}px`;
						top = `${minY}px`;
						width = `${bw}px`;
						height = `${bh}px`;
					} else {
						// Modes 4/5: stretch & center, preserve aspect ratio
						const scale = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
						const sw = Math.trunc(img.naturalWidth * scale);
						const sh = Math.trunc(img.naturalHeight * scale);
						left = `${minX + Math.trunc((bw - sw) / 2)}px`;
						top = `${minY + Math.trunc((bh - sh) / 2)}px`;
						width = `${sw}px`;
						height = `${sh}px`;
					}
					// Modes 2/4: low quality (nearest-neighbor); 3/5: high quality (smooth)
					pixelated = mode === 2 || mode === 4;
				} else {
					// Mode 0: default — centered on spot loc
					left = `${spot.x + statepic.x - Math.trunc(img.naturalWidth / 2)}px`;
					top = `${spot.y + statepic.y - Math.trunc(img.naturalHeight / 2)}px`;
				}

				const imgL = parseFloat(left);
				const imgT = parseFloat(top);
				const imgW = width ? parseFloat(width) : img.naturalWidth;
				const imgH = height ? parseFloat(height) : img.naturalHeight;

				const pf = spot.picFilters?.[spot.state];
				let filterStr = '';
				if (pf) {
					const parts: string[] = [];
					if (pf.brightness !== undefined && pf.brightness !== 0) parts.push(`brightness(${(100 + pf.brightness) / 100})`);
					if (pf.contrast !== undefined && pf.contrast !== 0) parts.push(`contrast(${(100 + pf.contrast) / 100})`);
					if (pf.hue !== undefined && pf.hue !== 0) parts.push(`hue-rotate(${pf.hue}deg)`);
					if (pf.saturation !== undefined && pf.saturation !== 0) parts.push(`saturate(${(pf.saturation * 0.01) + 1})`);
					if (pf.blur !== undefined && pf.blur !== 0) parts.push(`blur(${pf.blur / 25}px)`);
					if (pf.opacity !== undefined && pf.opacity !== 100) parts.push(`opacity(${pf.opacity / 100})`);
					if (parts.length) filterStr = parts.join(' ');
				}

				if ((spot.img as HTMLImageElement).src !== (img as HTMLImageElement).src) {
					img = img.cloneNode(false) as HTMLImageElement;
					const clipPath = this.computeSpotClipPath(spot, imgL, imgT, imgW, imgH);
					(img as HTMLElement).style.cssText = `left:${left};top:${top}${width ? `;width:${width};height:${height}` : ''}${pixelated ? ';image-rendering:pixelated' : ''}${filterStr ? `;filter:${filterStr}` : ''}${pf?.angle ? `;transform:rotate(${pf.angle}deg)` : ''}${clipPath ? `;clip-path:${clipPath}` : ''}`;
					(img as HTMLElement).className = 'spotpic';
					if (spot.toplayer) (img as HTMLElement).className += ' spotupper';
					if (Boolean(spotConsts.PicturesAboveAll & spot.flags || spotConsts.PicturesAboveProps & spot.flags || spotConsts.PicturesAboveNameTags & spot.flags)) {
						(img as HTMLElement).className += ' ontop';
					}
					palace.container.replaceChild(img, spot.img);
					spot.img = img;
				} else {
					const clipPath = this.computeSpotClipPath(spot, imgL, imgT, imgW, imgH);
					(spot.img as HTMLElement).style.cssText = `left:${left};top:${top}${width ? `;width:${width};height:${height}` : ''}${pixelated ? ';image-rendering:pixelated' : ''}${filterStr ? `;filter:${filterStr}` : ''}${pf?.angle ? `;transform:rotate(${pf.angle}deg)` : ''}${clipPath ? `;clip-path:${clipPath}` : ''}`;
					let updatedClass = 'spotpic';
					if (spot.toplayer) updatedClass += ' spotupper';
					if (Boolean(spotConsts.PicturesAboveAll & spot.flags || spotConsts.PicturesAboveProps & spot.flags || spotConsts.PicturesAboveNameTags & spot.flags)) {
						updatedClass += ' ontop';
					}
					if ((spot.img as HTMLElement).className !== updatedClass) (spot.img as HTMLElement).className = updatedClass;
				}
			}
		} else if (spot.img && spot.img.className !== 'spotholder') {
			const img = PalaceRoom.createSpotPicPlaceholder();
			palace.container.replaceChild(img, spot.img);
			spot.img = img;
		}
	}

	spotStateChange(info: { roomid: number; spotid: number; state: number; lock?: boolean }): void {
		const spot = this.getSpot(info.spotid);
		if (this.id === info.roomid && spot) {
			const previousState = spot.state;
			spot.state = info.state;
			this.setSpotImg(spot);
			this.executeSpotEventWithContext('STATECHANGE', spot, (ctx) => {
				ctx.lastState = previousState;
			});
			if (info.lock === false) {
				if (!prefs.general.disableSounds) {
					palace.sounds.dooropen.play();
				}
			} else if (info.lock === true) {
				if (!prefs.general.disableSounds) {
					palace.sounds.doorclose.play();
				}
			}
		}
	}

	spotMove(info: { roomid: number; spotid: number; x: number; y: number }): void {
		const spot = this.getSpot(info.spotid);
		if (this.id === info.roomid && spot) {
			spot.x = info.x;
			spot.y = info.y;
			this.setSpotImg(spot);
			this.setSpotNameTag(spot);
			this.reDraw();
			this.reDrawTop();
		}
	}

	spotMovePic(info: { roomid: number; spotid: number; x: number; y: number }): void {
		const spot = this.getSpot(info.spotid);
		if (this.id === info.roomid && spot && spot.statepics[spot.state]) {
			spot.statepics[spot.state].x = info.x;
			spot.statepics[spot.state].y = info.y;
			this.setSpotImg(spot);
		}
	}

	getSpot(id: number): RuntimeSpot | undefined {
		return this.spots.find((spot) => id === spot.id);
	}

	// ── Spot invalidation ──

	/** Flags controlling which parts of a spot are refreshed by invalidateSpot(). */
	static readonly SPOT_PIC    = 1; // DOM image position/filter/clip
	static readonly SPOT_CANVAS = 2; // Canvas-drawn visuals (gradients, styles, outlines)
	static readonly SPOT_LAYOUT = 4; // Nametag + webEmbed positioning
	static readonly SPOT_ALL    = 7;

	/** Invalidate all spots in the room (e.g. after room rebuild). */
	invalidateSpotCaches(): void {
		for (const spot of this.spots) {
			this.setSpotImg(spot);
			this.setSpotNameTag(spot);
		}
	}

	/**
	 * Refresh visual representations of a spot after a property change.
	 * Pass a bitmask of SPOT_PIC / SPOT_CANVAS / SPOT_LAYOUT to limit work.
	 */
	invalidateSpot(spot: RuntimeSpot, flags = PalaceRoom.SPOT_ALL): void {
		if (flags & PalaceRoom.SPOT_PIC) {
			this.setSpotImg(spot);
			if (this._clipRegionCount > 0) this.scheduleClipRegionRefresh();
		}
		if (flags & PalaceRoom.SPOT_LAYOUT) {
			this.setSpotNameTag(spot);
			if (spot.webEmbed) {
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				for (let i = 0; i < spot.points.length - 1; i += 2) {
					const px = spot.x + spot.points[i];
					const py = spot.y + spot.points[i + 1];
					if (px < minX) minX = px;
					if (px > maxX) maxX = px;
					if (py < minY) minY = py;
					if (py > maxY) maxY = py;
				}
				spot.webEmbed.style.left = `${minX}px`;
				spot.webEmbed.style.top = `${minY}px`;
				spot.webEmbed.style.width = `${maxX - minX}px`;
				spot.webEmbed.style.height = `${maxY - minY}px`;
			}
		}
		if (flags & PalaceRoom.SPOT_CANVAS) {
			this.reDraw();
			this.reDrawTop();
		}
	}

	/** Schedule a single batched clip-region refresh for the next animation frame. */
	private scheduleClipRegionRefresh(): void {
		if (this._clipRegionRafId) return;
		this._clipRegionRafId = requestAnimationFrame(() => {
			this._clipRegionRafId = 0;
			for (const s of this.spots) this.setSpotImg(s);
		});
	}

	/** Update the cached count of mode-2 clip region spots. */
	updateClipRegionCount(): void {
		let n = 0;
		for (const s of this.spots) { if (s.clipMode === 2) n++; }
		this._clipRegionCount = n;
	}

	// ── Spot backup / restore (storeCopy pattern) ──

	private spotBackups = new Map<number, Omit<RuntimeSpot, 'img' | 'handlers' | 'webEmbed' | 'nameTag'>>();
	private addedSpotIds = new Set<number>();

	/** Track a spot that was dynamically added by script. */
	trackAddedSpot(id: number): void {
		if (!this._authoring) this.addedSpotIds.add(id);
	}

	/** Check if a spot was dynamically added by script. */
	isAddedSpot(id: number): boolean {
		return this.addedSpotIds.has(id);
	}

	/** Snapshot a spot's server-persisted data before script modification. Idempotent per spot. */
	backupSpot(spot: RuntimeSpot): void {
		if (this._authoring || this.spotBackups.has(spot.id)) return;
		this.spotBackups.set(spot.id, {
			id: spot.id,
			name: spot.name,
			type: spot.type,
			flags: spot.flags,
			x: spot.x,
			y: spot.y,
			state: spot.state,
			dest: spot.dest,
			points: [...spot.points],
			statepics: spot.statepics.map(p => ({ ...p })),
			toplayer: spot.toplayer,
			script: spot.script,
			picMode: spot.picMode,
			picFilters: spot.picFilters ? JSON.parse(JSON.stringify(spot.picFilters)) : undefined,
			spotStyle: spot.spotStyle ? { ...spot.spotStyle } : undefined,
			curveTension: spot.curveTension,
			spotGradient: spot.spotGradient ? { ...spot.spotGradient } : undefined,
			spotPathGradient: spot.spotPathGradient ? { centerColor: spot.spotPathGradient.centerColor, surroundColors: [...spot.spotPathGradient.surroundColors], useSpotPoint: spot.spotPathGradient.useSpotPoint } : undefined,
			clipMode: spot.clipMode,
		});
	}

	/** Restore all script-modified spots to their original server state. */
	restoreSpotBackups(): void {
		// Remove dynamically added spots
		for (let i = this.spots.length - 1; i >= 0; i--) {
			const s = this.spots[i];
			if (this.addedSpotIds.has(s.id)) {
				if (s.img?.parentNode) s.img.parentNode.removeChild(s.img);
				if (s.webEmbed?.parentNode) s.webEmbed.parentNode.removeChild(s.webEmbed);
				if (s.nameTag?.parentNode) s.nameTag.parentNode.removeChild(s.nameTag);
				this.spots.splice(i, 1);
			}
		}
		this.addedSpotIds.clear();

		// Restore modified spots
		for (const [id, backup] of this.spotBackups) {
			const spot = this.getSpot(id);
			if (!spot) continue;
			spot.name = backup.name;
			spot.type = backup.type;
			spot.flags = backup.flags;
			spot.x = backup.x;
			spot.y = backup.y;
			spot.state = backup.state;
			spot.dest = backup.dest;
			spot.points = [...backup.points];
			spot.statepics = backup.statepics.map(p => ({ ...p }));
			spot.toplayer = backup.toplayer;
			spot.script = backup.script;
			spot.picMode = backup.picMode;
			spot.picFilters = backup.picFilters ? JSON.parse(JSON.stringify(backup.picFilters)) : undefined;
			spot.spotStyle = backup.spotStyle ? { ...backup.spotStyle } : undefined;
			spot.curveTension = backup.curveTension;
			spot.spotGradient = backup.spotGradient ? { ...backup.spotGradient } : undefined;
			spot.spotPathGradient = backup.spotPathGradient ? { centerColor: backup.spotPathGradient.centerColor, surroundColors: [...backup.spotPathGradient.surroundColors], useSpotPoint: backup.spotPathGradient.useSpotPoint } : undefined;
			spot.clipMode = backup.clipMode;
			this.invalidateSpot(spot);
		}
		this.spotBackups.clear();
	}

	selectSpot(spot: RuntimeSpot): void {
		this.selectedSpot = spot;
		if (this.executeSpotEvent('SELECT', spot) === false) {
			const dest = spot.dest;
			switch (spot.type) {
				case spotConsts.types.passage:
					if (dest > 0) palace.gotoroom(dest);
					break;
				case spotConsts.types.shutable:
				case spotConsts.types.lockable:
					if (spot.state === 0) {
						palace.gotoroom(dest);
					} else {
						logmsg('Sorry the door is locked.');
					}
					break;
				case spotConsts.types.deadBolt: {
					const d = this.getSpot(dest);
					if (d) {
						if (d.state === 0) {
							palace.sendLockRoom(dest);
						} else {
							palace.sendUnlockRoom(dest);
						}
					}
					break;
				}
			}
		}
		this.executeSpotEvent('MOUSEDOWN', spot);
	}

	loosePropAdd(data: LooseProp): void {
		this.looseProps.unshift(data);
		if (this.mouseLooseProp !== null) this.mouseLooseProp++;
		loadProps([data.id]);
		this.reDrawProps();
		this.executeEventWithContext('LOOSEPROPADDED', (ctx) => {
			ctx.whatPropId = data.id;
			ctx.wherePropX = data.x;
			ctx.wherePropY = data.y;
		});
	}

	loosePropMove(info: { index: number; x: number; y: number }): void {
		if (info.index >= 0 && this.looseProps.length > info.index) {
			const lp = this.looseProps[info.index];
			if (lp && (lp.x !== info.x || lp.y !== info.y)) {
				lp.x = info.x;
				lp.y = info.y;
				this.reDrawProps();
				this.executeEventWithContext('LOOSEPROPMOVED', (ctx) => {
					ctx.whatPropId = lp.id;
					ctx.whatIndex = info.index;
					ctx.wherePropX = lp.x;
					ctx.wherePropY = lp.y;
				});
			}
		}
	}

	loosePropDelete(index: number): void {
		let change = false;
		let deletedPropId = 0;
		let deletedPropX = 0;
		let deletedPropY = 0;
		if (index < 0) {
			if (this.looseProps.length > 0) change = true;
			this.looseProps = [];
		} else if (this.looseProps.length >= index) {
			const adjustIndex = (idx: number | null): number | null => {
				if (idx !== null && idx > -1) {
					if (index === idx) {
						return null;
					} else if (index < idx) {
						return --idx;
					}
					return idx;
				}
				return idx;
			};

			if (this.mouseLooseProp !== null) this.mouseLooseProp = adjustIndex(this.mouseLooseProp);

			change = true;
			if (this.looseProps[index]) {
				deletedPropId = this.looseProps[index].id;
				deletedPropX = this.looseProps[index].x;
				deletedPropY = this.looseProps[index].y;
			}
			this.looseProps.splice(index, 1);
		}
		if (change) {
			this.reDrawProps();
			this.executeEventWithContext('LOOSEPROPDELETED', (ctx) => {
				ctx.whatPropId = deletedPropId;
				ctx.wherePropX = deletedPropX;
				ctx.wherePropY = deletedPropY;
			});
		}
	}

	removeUser(info: { id: number; logoff?: boolean }): boolean | undefined {
		const user = this.getUser(info.id);
		if (user) {
			this.executeSyncEventWithContext('LEAVE', (ctx) => {
				ctx.whoChatId = info.id;
			});
			this.executeSyncEventWithContext('USERLEAVE', (ctx) => {
				ctx.whoLeaveId = info.id;
			});
			if (user === palace.theUser) {
				user.remove();
			} else {
				logmsg(`${user.name} has ${info.logoff ? 'signed off.' : 'left the room.'}`);
				user.shrink(true);
			}
			return true;
		}
	}

	addUser(info: any): void {
		const dude = new PalaceUser(info, true);
		const loggedOn = (palace.lastUserLogOnID === dude.id && PalaceClient.ticks() - palace.lastUserLogOnTime < 900);
		if (loggedOn) {
			palace.lastUserLogOnID = 0;
			palace.lastUserLogOnTime = 0;
			if (!prefs.general.disableSounds) palace.sounds.signon.play();
		}
		if (palace.theUserID === dude.id && palace.theUser !== dude) {
			setUserInterfaceAvailability(false);
			palace.theUser = dude;
			if (prefs.general.avatarLocked) dude.avatarLocked = true;

		}

		if (dude !== palace.theUser) {
			logmsg(`${dude.name} has ${loggedOn ? 'signed on.' : 'entered the room.'}`);
		}

		this.users.push(dude);

		if (this.whisperUserID) {
			if (this.whisperUserID === dude.id) {
				dude.putFilters(['brightness(112%)', 'drop-shadow(0px 0px 4px PaleGreen)']);
			} else if (palace.theUser !== dude) {
				dude.opacity('0.5');
			}
		}

		loadProps(dude.props);
		this.setUserCount();

		if (dude === palace.theUser) {
			if (loggedOn) this.executeEvent('SIGNON');
			this.executeEventWithContext('ENTER', (ctx) => {
				ctx.whoEnterId = dude.id;
			});
		}
		this.executeSyncEventWithContext('USERENTER', (ctx) => {
				ctx.whoEnterId = dude.id;
		});
	}

	getUser(uid: number): PalaceUser | undefined {
		return this.users.find((user) => uid === user.id);
	}

	loadUsers(infos: any[]): void {
		const dudes: PalaceUser[] = [];
		infos.forEach((info) => { dudes.push(new PalaceUser(info)); });

		this.users = dudes;

		let pids: number[] = [];
		dudes.forEach((dude) => { pids = dude.props.concat(pids); });
		this.looseProps.find((prop) => { pids.push(prop.id); });

		loadProps(dedup(pids));

		this.setUserCount();

		super.refresh();
		super.refreshTop();
		super.refreshProps();
	}

	userColorChange(info: { id: number; color: number }): boolean | undefined {
		const user = this.getUser(info.id);
		if (user && user.color !== info.color) {
			user.color = info.color;
			user.setColor();
			if (this.whisperUserID === info.id) {
				const pill = document.getElementById('chatbar-whisper-pill')!;
				pill.style.background = getHsl(info.color, 45).replace('hsl(', 'hsla(').replace(')', ',0.3)');
				pill.style.color = getHsl(info.color, 80);
			}
			this.executeEventWithContext('COLORCHANGE', (ctx) => {
				ctx.whoChangeId = info.id;
			});
			return true;
		}
	}

	userFaceChange(info: { id: number; face: number }): boolean | undefined {
		const user = this.getUser(info.id);
		if (user && user.face !== info.face) {
			user.face = info.face;
			user.setFace();
			this.executeEventWithContext('FACECHANGE', (ctx) => {
				ctx.whoChangeId = info.id;
			});
			return true;
		}
	}

	userPropChange(info: { id: number; props: number[] }): void {
		const user = this.getUser(info.id);
		if (user) user.changeUserProps(info.props);
	}

	userAvatarChange(info: { id: number; color: number; face: number; props: number[] }): void {
		const user = this.getUser(info.id);
		if (user) {
			user.color = info.color;
			user.face = info.face;
			user.setColor();
			user.changeUserProps(info.props);
		}
	}

	userNameChange(info: { id: number; name: string }): void {
		const user = this.getUser(info.id);
		if (user && user.name !== info.name) {
			const previousName = user.name;
			user.name = info.name;
			user.setName();
			user.setColor();
			this.executeEventWithContext('NAMECHANGE', (ctx) => {
				ctx.whoChangeId = info.id;
				ctx.lastName = previousName;
			});
		}
	}

	userMove(info: { id: number; x: number; y: number }): void {
		const user = this.getUser(info.id);
		if (user && (user.x !== info.x || user.y !== info.y)) {
			user.popBubbles();
			user.x = info.x;
			user.y = info.y;
			user.setAvatarLocation();
			this.executeEventWithContext('USERMOVE', (ctx) => {
				ctx.whoMoveId = info.id;
			});
		}
	}

	userChat(chat: { id: number; chatstr: string; whisper?: boolean }): void {
        try {
            const user = this.getUser(chat.id);
			const originalChat = chat.chatstr;
			if (!user) {
				this.executeEventWithContext('SERVERMSG', (ctx: PalaceExecutionContext) => {
					ctx.chatStr = chat.chatstr;
				});
			} else {
				const result = this.executeSyncEventWithChatStr('INCHAT', (ctx) => {
					ctx.whoChatId = chat.id;
					ctx.chatStr = chat.chatstr;
				});
				if (result !== null) chat.chatstr = result;
			}

            const chatspan = document.createElement('div');
            chatspan.className = 'userlogchat';
            const namespan = document.createElement('div');
            namespan.className = 'userlogname';

			if (chat.chatstr !== '') {
				const bubInfo = Bubble.processChatType(chat.chatstr);
				if (bubInfo.type > -1 && bubInfo.start < chat.chatstr.length) new Bubble(user, chat, bubInfo);
			}

            if (user) {
                namespan.innerText = user.name;
                namespan.style.color = getHsl(user.color, 60);
            } else {
                namespan.innerText = '***';
                if (chat.whisper !== true) chatspan.style.color = '#c87070';
            }

            const timestamp = document.createElement('span');
            timestamp.className = 'userlogtime';
            timestamp.innerText = `${timeStampStr(true)}`;
            chatspan.appendChild(timestamp);

            if (chat.whisper === true) {
                chatspan.className += ' userlogwhisper';
                if (!document.hasFocus() && !prefs.general.disableSounds) palace.sounds.whisper.play();
            }
            chatspan.appendChild(namespan);
            chatspan.appendChild(makeHyperLinks(originalChat, chatspan));

            logAppend(chatspan);


        } catch (e) {            // play() can throw if called before user interaction on some browsers
            console.error('Error playing whisper sound:', e);
        }
	}

	executeEvent(event: string): void {
		if (escapeHeld) { logmsg('Script halted by user.'); return; }
		this.spots.forEach((spot) => {
			if (spot.handlers && spot.handlers[event]) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.hotspotId = spot.id;
				ctx.eventName = event;
				IptEngine.queueTokenListWithContext(
					spot.handlers[event],
					ctx
				);
			}
		});
		const cached = IptEngine.cachedScripts.get(event);
		if (cached) {
			for (const tokenList of cached) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.eventName = event;
				IptEngine.queueTokenListWithContext(tokenList, ctx);
			}
		}
		if (!this.noUserScripts && cyborgHandlers && cyborgHandlers[event]) {
			const ctx = new PalaceExecutionContext(CyborgEngine);
			ctx.hotspotId = -999;
			ctx.eventName = event;
			CyborgEngine.queueTokenListWithContext(cyborgHandlers[event], ctx);
			CyborgEngine.start();
		}
		IptEngine.start();
	}

	executeEventWithContext(event: string, setup: (ctx: PalaceExecutionContext) => void): void {
		if (escapeHeld) { logmsg('Script halted by user.'); return; }
		this.spots.forEach((spot) => {
			if (spot.handlers && spot.handlers[event]) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.hotspotId = spot.id;
				ctx.eventName = event;
				setup(ctx);
				IptEngine.queueTokenListWithContext(spot.handlers[event], ctx);
			}
		});
		const cached = IptEngine.cachedScripts.get(event);
		if (cached) {
			for (const tokenList of cached) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.eventName = event;
				setup(ctx);
				IptEngine.queueTokenListWithContext(tokenList, ctx);
			}
		}
		if (!this.noUserScripts && cyborgHandlers && cyborgHandlers[event]) {
			const ctx = new PalaceExecutionContext(CyborgEngine);
			ctx.hotspotId = -999;
			ctx.eventName = event;
			setup(ctx);
			CyborgEngine.queueTokenListWithContext(cyborgHandlers[event], ctx);
			CyborgEngine.start();
		}
		IptEngine.start();
	}

	executeSyncEventWithContext(event: string, setup: (ctx: PalaceExecutionContext) => void): void {
		if (escapeHeld) { logmsg('Script halted by user.'); return; }
		this.spots.forEach((spot) => {
			if (spot.handlers && spot.handlers[event]) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.hotspotId = spot.id;
				ctx.eventName = event;
				setup(ctx);
				IptEngine.executeTokenListSync(spot.handlers[event], ctx);
			}
		});
		const cached = IptEngine.cachedScripts.get(event);
		if (cached) {
			for (const tokenList of cached) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.eventName = event;
				setup(ctx);
				IptEngine.executeTokenListSync(tokenList, ctx);
			}
		}
		if (!this.noUserScripts && cyborgHandlers && cyborgHandlers[event]) {
			const ctx = new PalaceExecutionContext(CyborgEngine);
			ctx.hotspotId = -999;
			ctx.eventName = event;
			setup(ctx);
			CyborgEngine.executeTokenListSync(cyborgHandlers[event], ctx);
		}
	}

	executeSyncEventWithChatStr(event: string, setup: (ctx: PalaceExecutionContext) => void): string | null {
		if (escapeHeld) { logmsg('Script halted by user.'); return null; }
		let chatStr: string | null = null;
		this.spots.forEach((spot) => {
			if (spot.handlers && spot.handlers[event]) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.hotspotId = spot.id;
				ctx.eventName = event;
				setup(ctx);
				IptEngine.executeTokenListSync(spot.handlers[event], ctx);
				chatStr = ctx.chatStr;
			}
		});
		const cached = IptEngine.cachedScripts.get(event);
		if (cached) {
			for (const tokenList of cached) {
				const ctx = new PalaceExecutionContext(IptEngine);
				ctx.eventName = event;
				setup(ctx);
				IptEngine.executeTokenListSync(tokenList, ctx);
				chatStr = ctx.chatStr;
			}
		}
		if (!this.noUserScripts && cyborgHandlers && cyborgHandlers[event]) {
			const ctx = new PalaceExecutionContext(CyborgEngine);
			ctx.hotspotId = -999;
			ctx.eventName = event;
			setup(ctx);
			CyborgEngine.executeTokenListSync(cyborgHandlers[event], ctx);
			if (ctx.chatStr !== null) chatStr = ctx.chatStr;
		}
		return chatStr;
	}

	executeSpotEvent(event: string, spot: RuntimeSpot): boolean {
		if (escapeHeld) { logmsg('Script halted by user.'); return false; }
		if (spot.handlers && spot.handlers[event]) {
			const ctx = new PalaceExecutionContext(IptEngine);
			ctx.hotspotId = spot.id;
			ctx.eventName = event;
			ctx.isRightClick = this.lastClickIsRight;
			IptEngine.queueTokenListWithContext(
				spot.handlers[event],
				ctx
			);
			IptEngine.start();
			return true;
		}
		return false;
	}

	executeSpotEventWithContext(event: string, spot: RuntimeSpot, setup: (ctx: PalaceExecutionContext) => void): boolean {
		if (escapeHeld) { logmsg('Script halted by user.'); return false; }
		if (spot.handlers && spot.handlers[event]) {
			const ctx = new PalaceExecutionContext(IptEngine);
			ctx.hotspotId = spot.id;
			ctx.eventName = event;
			setup(ctx);
			IptEngine.queueTokenListWithContext(spot.handlers[event], ctx);
			IptEngine.start();
			return true;
		}
		return false;
	}

	setUserCount(): void {
		const roomCount = this.users.length;
		const serverCount = palace.serverUserCount;
		const el = document.getElementById('palacecounts')!;
		el.textContent = `${roomCount} / ${serverCount}`;
		el.title = `${roomCount} in room · ${serverCount} on server`;
	}

	toggleUserNames(on: boolean): void {
		if (this.users) {
			this.users.forEach((user) => {
				user.domNametag.style.display = on ? '' : 'none';
			});
		}
	}

	enterWhisperMode(userid: number, name: string): void {
		const cancel = (this.whisperUserID === userid);
		if (this.whisperUserID || cancel) {
			this.exitWhisperMode();
		}
		if (!cancel) {
			const chatbox = document.getElementById('chatbox')!;
			const whisperPill = document.getElementById('chatbar-whisper-pill')!;
			const whisperLabel = document.getElementById('chatbar-whisper-label')!;
			chatbox.setAttribute('data-placeholder', `Whisper to ${name}`);
			whisperLabel.textContent = name;
			whisperPill.classList.remove('chatbar-hidden');
			this.whisperUserID = userid;
			const user = this.getUser(userid);
			if (user) {
				const hsl = getHsl(user.color, 45);
				whisperPill.style.background = hsl.replace(')', ',0.3)').replace('hsl(', 'hsla(');
				whisperPill.style.color = getHsl(user.color, 80);
			}
			this.users.forEach((u) => {
				if (u !== user && palace.theUser !== u) {
					u.opacity('0.5');
				}
			});

			if (user) {
				user.poke();
			}
			chatbox.focus();
		}
	}

	exitWhisperMode(): void {
		const chatbox = document.getElementById('chatbox')!;
		const whisperPill = document.getElementById('chatbar-whisper-pill')!;
		chatbox.setAttribute('data-placeholder', 'Chat...');
		whisperPill.classList.add('chatbar-hidden');
		whisperPill.style.background = '';
		whisperPill.style.color = '';
		const user = this.getUser(this.whisperUserID!);
		if (user) {
			user.poke();
			if (user !== this.mouseHoverUser) {
				user.removeFilters(['brightness', 'drop-shadow']);
			}
		}
		this.users.forEach((u) => {
			if (u !== user && palace.theUser !== u) {
				u.opacity('');
			}
		});
		this.whisperUserID = null;
	}

	makeDragProp(lp: LooseProp | null, pid: number, x: number, y: number, x2: number, y2: number): void {
		this.grabbedProp = { looseprop: lp, id: pid, offsetX: x2, offsetY: y2, mx: x - x2, my: y - y2 };
	}

	mouseInSpot(x: number, y: number): RuntimeSpot | undefined {
		let spot;
		for (let i = this.spots.length; --i >= 0;) {
			spot = this.spots[i];
			this.makeHotSpot(spot);
			if (this.context.isPointInPath(x, y)) return spot;
		}
	}

	mouseOverUser(x: number, y: number): PalaceUser | undefined {
		for (let i = this.users.length; --i >= 0;) {
			const user = this.users[i];
			if (user.x + 22 > x && user.x - 22 < x && user.y + 22 > y && user.y - 22 < y) {
				return user;
			}
		}
	}

	mouseOverSelfProp(x: number, y: number): number | undefined {
		if (!this.grabbedProp) {
			for (let i = palace.theUser.props.length; --i >= 0;) {
				const aProp = cacheProps[palace.theUser.props[i]];
				const px = (palace.theUser.x + aProp.x) - 22;
				const py = (palace.theUser.y + aProp.y) - 22;
				if (aProp && (!aProp.animated || (palace.theUser as any).animatePropID === undefined || (palace.theUser as any).animatePropID === aProp.id) && aProp.isComplete && px < x && (px + aProp.w) > x && py < y && (py + aProp.h) > y) {
					if (this.mouseOverProp(aProp, x, y, px, py)) {
						return aProp.id;
					}
				}
			}
		}
	}

	mouseOverLooseProp(x: number, y: number): number | undefined {
		if (!this.grabbedProp) {
			for (let i = this.looseProps.length; --i >= 0;) {
				const lProp = this.looseProps[i];
				const aProp = cacheProps[lProp.id];
				if (aProp && aProp.isComplete && lProp.x < x && (lProp.x + aProp.w) > x && lProp.y < y && (lProp.y + aProp.h) > y) {
					if (this.mouseOverProp(aProp, x, y, lProp.x, lProp.y)) {
						return i;
					}
				}
			}
		}
	}

	mouseOverSpotPic(x: number, y: number): boolean {
		for (let i = this.spots.length - 1; i >= 0; i--) {
			const sp = this.spots[i];
			const statepic = sp.statepics[sp.state];
			if (!statepic || !sp.img || !this.pics[statepic.id]) continue;
			const img = this.pics[statepic.id].img as HTMLImageElement;
			if (!img || !img.naturalWidth) continue;
			const iw = parseInt(sp.img.style.width) || img.naturalWidth;
			const ih = parseInt(sp.img.style.height) || img.naturalHeight;
			const ix = parseInt(sp.img.style.left) || 0;
			const iy = parseInt(sp.img.style.top) || 0;
			if (x >= ix && x < ix + iw && y >= iy && y < iy + ih) return true;
		}
		return false;
	}

	mouseOverProp(aProp: PalaceProp, x: number, y: number, px: number, py: number): boolean {
		this.mCtx.clearRect(0, 0, this.mCtx.canvas.width, this.mCtx.canvas.height);
		this.mCtx.drawImage(aProp.img, 0, 0, aProp.w, aProp.h);
		return (this.mCtx.getImageData((x - px), (y - py), 1, 1).data[3] > 0);
	}

	mouseEnterUser(user: PalaceUser): void {
		this.mouseExitSelfProp();
		this.mouseExitLooseProp();
		this.mouseExitUser();
		if (user !== palace.theUser) {
			user.putFilters(['brightness(112%)', 'drop-shadow(0px 0px 4px #0ff)']);
		}
		this.mouseHoverUser = user;
	}

	mouseExitUser(): void {
		if (this.mouseHoverUser) {
			const target = this.mouseHoverUser;
			if (this.whisperUserID !== this.mouseHoverUser.id && target !== palace.theUser) {
				target.removeFilters(['brightness', 'drop-shadow']);
			}
			this.mouseHoverUser = null;
		}
	}

	mouseEnterLooseProp(lpIndex: number): void {
		if (!this.mouseHoverUser && !this.mouseSelfProp) {
			this.mouseExitLooseProp();
			this.mouseLooseProp = lpIndex;
			const target = this.looseProps[this.mouseLooseProp];
			if (target.raf) {
				cancelAnimationFrame(target.raf);
				target.raf = null;
			}
			target.light = 1;
			this.reDrawProps();
		}
	}

	mouseExitLooseProp(): void {
		if (this.mouseLooseProp !== null) {
			const target = this.looseProps[this.mouseLooseProp];
			this.mouseLooseProp = null;
			if (target) {
				let start: number | undefined;
				const fade = (timestamp: number) => {
					if (!start) start = timestamp;
					const progress = timestamp - start;
					target.light = Math.max(1 - (progress / 150), 0);
					this.reDrawProps();
					if (progress < 150) {
						target.raf = requestAnimationFrame(fade);
					} else {
						target.raf = null;
					}
				};
				target.raf = requestAnimationFrame(fade);
			}
		}
	}

	mouseEnterSelfProp(pid: number): void {
		this.mouseExitLooseProp();
		if (!this.mouseHoverUser) {
			this.mouseExitSelfProp();
			this.mouseSelfProp = pid;
			palace.theUser.findDomProp(pid).div.style.filter = 'drop-shadow(0px 0px 2px #50C878)';
		}
	}

	mouseExitSelfProp(): void {
		if (this.mouseSelfProp) {
			palace.theUser.findDomProp(this.mouseSelfProp).div.style.filter = '';
			this.mouseSelfProp = null;
		}
	}

	get nbrLooseProps(): number {
		return this.looseProps.length;
	}

	get nbrRoomProps(): number {
		let count = 0;
		for (let i = 0; i < this.users.length; i++) {
			count += this.users[i].props.length;
		}
		count += this.nbrLooseProps;
		return count;
	}

	propInUse(id: number): boolean {
		for (let i = 0; i < this.users.length; i++) {
			for (let j = 0; j < this.users[i].props.length; j++) {
				if (this.users[i].props[j] === id) {
					return true;
				}
			}
		}
		for (let o = 0; o < this.looseProps.length; o++) {
			if (this.looseProps[o].id === id) {
				return true;
			}
		}
		return false;
	}

	navigationError(type: number): void {
		switch (type) {
			case 0:
				logmsg('Internal Server Error!');
				break;
			case 1:
				logmsg('Unknown room.');
				break;
			case 2:
				logmsg('Room is full.');
				break;
			case 3:
				logmsg('Room is closed.');
				break;
			case 4:
				logmsg("You can't author.");
				break;
			case 5:
				logmsg('The Server is full.');
				break;
			default:
				logmsg('Unknown navigation error.');
				break;
		}
	}
}

export function showSpotEditor(spot: RuntimeSpot, room: PalaceRoom, initialTab = 0): void {
	// Request fresh room list for the destination dropdown
	palace.sendRoomListRequest();

	const typeNames: Record<number, string> = {
		0: 'Normal', 1: 'Passage', 2: 'Shutable Door', 3: 'Lockable Door', 4: 'Dead Bolt', 5: 'Nav Area'
	};
	const doorAboveOptions = ['Nothing', 'All', 'Props', 'Name Tags'];

	const overlay = document.createElement('div');
	overlay.className = 'dlg-overlay';

	const box = document.createElement('div');
	box.className = 'dlg-box spot-editor';
	box.style.maxWidth = '460px';

	// Title (also serves as drag handle)
	const title = document.createElement('h3');
	title.textContent = 'Spot Editor';
	title.style.cursor = 'move';
	title.style.userSelect = 'none';
	box.appendChild(title);

	// Drag support on the title bar
	let dragX = 0, dragY = 0, dragging = false;
	let dragOverlay: HTMLDivElement | null = null;
	title.addEventListener('mousedown', (e: MouseEvent) => {
		e.preventDefault();
		dragging = true;
		if (box.style.position !== 'fixed') {
			const r = box.getBoundingClientRect();
			box.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;max-width:none`;
		}
		const rect = box.getBoundingClientRect();
		dragX = e.clientX - rect.left;
		dragY = e.clientY - rect.top;
		dragOverlay = document.createElement('div');
		dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:move;';
		document.body.appendChild(dragOverlay);
	});
	window.addEventListener('mousemove', (e: MouseEvent) => {
		if (!dragging) return;
		box.style.left = `${e.clientX - dragX}px`;
		box.style.top = `${e.clientY - dragY}px`;
	});
	window.addEventListener('mouseup', () => { dragging = false; dragOverlay?.remove(); dragOverlay = null; });

	// ── Tab bar ──
	const tabBar = document.createElement('div');
	tabBar.className = 'spot-tab-bar';
	const tabNames = ['Info', 'Pictures', 'Script'];
	const tabBtns: HTMLButtonElement[] = [];
	const tabPanes: HTMLDivElement[] = [];
	let wasScript = initialTab === 2;

	/** Save the Script tab geometry to prefs. */
	const saveScriptGeometry = () => {
		const r = box.getBoundingClientRect();
		setGeneralPref('spotScriptGeometry', { left: r.left, top: r.top, width: r.width, height: r.height });
	};

	/** Apply saved (or default) geometry to the box for Script tab, clamped to viewport. */
	const applyScriptGeometry = (fallbackRect?: DOMRect) => {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const saved = prefs.general.spotScriptGeometry as { left: number; top: number; width: number; height: number } | undefined;
		let w = Number(saved?.width) || 560;
		let h = Number(saved?.height) || (fallbackRect ? fallbackRect.height : 500);
		let l = Number(saved?.left);
		let t = Number(saved?.top);
		// If no saved position, center horizontally from current box position
		if (!saved || !isFinite(l)) {
			const fr = fallbackRect || box.getBoundingClientRect();
			l = fr.left + fr.width / 2 - w / 2;
			t = fr.top;
		}
		// Clamp size to viewport
		w = Math.min(w, vw - 20);
		h = Math.min(h, vh - 20);
		// Clamp position so no part is offscreen
		l = Math.max(0, Math.min(l, vw - w));
		t = Math.max(0, Math.min(t, vh - h));
		box.style.cssText += `;position:fixed;left:${l}px;top:${t}px;max-width:none;width:${w}px;height:${h}px`;
		spotResizeHandle.style.display = '';
	};

	tabNames.forEach((name, i) => {
		const btn = document.createElement('button');
		btn.className = 'spot-tab-btn';
		btn.textContent = name;
		if (i === initialTab) btn.classList.add('active');
		btn.onclick = () => {
			tabBtns.forEach(b => b.classList.remove('active'));
			tabPanes.forEach(p => p.style.display = 'none');
			btn.classList.add('active');
			tabPanes[i].style.display = '';
			if (i === 2) {
				const rect = box.getBoundingClientRect();
				applyScriptGeometry(rect);
				scriptWidget.focus();
				scriptWidget.textarea.setSelectionRange(0, 0);
				scriptWidget.textarea.scrollTop = 0;
				scriptWidget.textarea.dispatchEvent(new Event('scroll'));
				wasScript = true;
			} else {
				if (wasScript) {
					saveScriptGeometry();
					wasScript = false;
				}
				spotResizeHandle.style.display = 'none';
				box.style.position = '';
				box.style.left = '';
				box.style.top = '';
				box.style.maxWidth = '460px';
				box.style.width = '';
				box.style.height = '';
			}
		};
		tabBar.appendChild(btn);
		tabBtns.push(btn);
	});
	box.appendChild(tabBar);

	// ════════════════════════════════════════
	// Tab 0: Info
	// ════════════════════════════════════════
	const infoPane = document.createElement('div');
	infoPane.className = 'spot-tab-pane';
	if (initialTab !== 0) infoPane.style.display = 'none';

	const grid = document.createElement('div');
	grid.className = 'spot-editor-grid';

	const addRow = (label: string, ...els: HTMLElement[]) => {
		const lbl = document.createElement('label');
		lbl.textContent = label;
		grid.appendChild(lbl);
		const cell = document.createElement('div');
		cell.className = 'spot-editor-cell';
		els.forEach(e => cell.appendChild(e));
		grid.appendChild(cell);
	};

	// Name
	const nameInput = document.createElement('input');
	nameInput.className = 'dlg-input';
	nameInput.value = spot.name;
	addRow('Name', nameInput);

	// Dest + Door ID
	const destInput = document.createElement('input');
	destInput.className = 'dlg-input dlg-input-sm';
	destInput.type = 'number';
	destInput.value = String(spot.dest);

	const doorIdSelect = document.createElement('select');
	doorIdSelect.className = 'dlg-input';
	const noneOpt = document.createElement('option');
	noneOpt.value = '0';
	noneOpt.textContent = '(none)';
	doorIdSelect.appendChild(noneOpt);
	if (palace.roomList) {
		for (const rm of palace.roomList) {
			const opt = document.createElement('option');
			opt.value = String(rm.id);
			opt.textContent = `${rm.name} (${rm.id})`;
			if (rm.id === spot.dest) opt.selected = true;
			doorIdSelect.appendChild(opt);
		}
	}
	if (!palace.roomList || !palace.roomList.find((r: any) => r.id === spot.dest)) {
		if (spot.dest > 0) {
			const curOpt = document.createElement('option');
			curOpt.value = String(spot.dest);
			curOpt.textContent = `Room ${spot.dest}`;
			curOpt.selected = true;
			doorIdSelect.appendChild(curOpt);
		} else {
			noneOpt.selected = true;
		}
	}
	doorIdSelect.onchange = () => { destInput.value = doorIdSelect.value; };
	addRow('Dest', destInput, doorIdSelect);

	// Spot ID
	const spotIdInput = document.createElement('input');
	spotIdInput.className = 'dlg-input dlg-input-sm';
	spotIdInput.type = 'number';
	spotIdInput.value = String(spot.id);
	spotIdInput.readOnly = true;
	addRow('Spot ID', spotIdInput);

	// State
	const stateInput = document.createElement('input');
	stateInput.className = 'dlg-input dlg-input-sm';
	stateInput.type = 'number';
	stateInput.value = String(spot.state);
	addRow('State', stateInput);

	// Corners
	const cornersInput = document.createElement('input');
	cornersInput.className = 'dlg-input dlg-input-sm';
	cornersInput.type = 'number';
	cornersInput.min = '1';
	cornersInput.max = '32';
	cornersInput.value = String(spot.points.length / 2);
	cornersInput.onchange = () => {
		let n = Math.max(1, Math.min(32, Number(cornersInput.value) || 1));
		cornersInput.value = String(n);
		const current = spot.points.length / 2;
		if (n > current) {
			const baseX = spot.points[0] || 0;
			const baseY = spot.points[1] || 0;
			for (let i = current; i < n; i++) {
				spot.points.push(baseX, baseY + (i - current + 1) * 8);
			}
		} else if (n < current) {
			spot.points.length = n * 2;
		}
		room.reDrawTop();
	};
	addRow('Corners', cornersInput);

	// Separator
	const sep = document.createElement('hr');
	sep.className = 'spot-editor-sep';
	grid.appendChild(sep);

	// Door images above
	const doorAboveSelect = document.createElement('select');
	doorAboveSelect.className = 'dlg-input';
	let doorAboveVal = 0;
	if (spot.flags & spotConsts.PicturesAboveAll) doorAboveVal = 1;
	else if (spot.flags & spotConsts.PicturesAboveProps) doorAboveVal = 2;
	else if (spot.flags & spotConsts.PicturesAboveNameTags) doorAboveVal = 3;
	doorAboveOptions.forEach((name, i) => {
		const opt = document.createElement('option');
		opt.value = String(i);
		opt.textContent = name;
		if (i === doorAboveVal) opt.selected = true;
		doorAboveSelect.appendChild(opt);
	});
	addRow('Door images above', doorAboveSelect);

	// Type
	const typeSelect = document.createElement('select');
	typeSelect.className = 'dlg-input';
	Object.entries(typeNames).forEach(([val, name]) => {
		const opt = document.createElement('option');
		opt.value = val;
		opt.textContent = name;
		if (Number(val) === spot.type) opt.selected = true;
		typeSelect.appendChild(opt);
	});
	addRow('Type', typeSelect);

	// Options section
	const optSection = document.createElement('fieldset');
	optSection.className = 'spot-editor-options';
	const optLegend = document.createElement('legend');
	optLegend.textContent = 'Options';
	optSection.appendChild(optLegend);

	const optGrid = document.createElement('div');
	optGrid.className = 'spot-editor-opt-grid';

	const flagDefs: [string, number][] = [
		["Don't move here", spotConsts.DontMoveHere],
		['Show name', spotConsts.ShowName],
		['Forbidden', spotConsts.Forbidden],
		['Draw frame', spotConsts.ShowFrame],
		['Mandatory', spotConsts.Mandatory],
		['Shadow', spotConsts.Shadow],
		['Landing pad', spotConsts.Landingpad],
	];

	const flagChecks: { flag: number; cb: HTMLInputElement }[] = [];
	flagDefs.forEach(([name, flag]) => {
		const lbl = document.createElement('label');
		lbl.className = 'spot-editor-chk';
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.checked = Boolean(spot.flags & flag);
		lbl.appendChild(cb);
		lbl.appendChild(document.createTextNode(name));
		optGrid.appendChild(lbl);
		flagChecks.push({ flag, cb });
	});
	optSection.appendChild(optGrid);

	infoPane.appendChild(grid);
	infoPane.appendChild(optSection);
	tabPanes.push(infoPane);
	box.appendChild(infoPane);

	// ════════════════════════════════════════
	// Tab 1: Pictures
	// ════════════════════════════════════════
	const picsPane = document.createElement('div');
	picsPane.className = 'spot-tab-pane';
	if (initialTab !== 1) picsPane.style.display = 'none';

	// Working copy of statepics with resolved names
	const picsList: { name: string; x: number; y: number }[] = spot.statepics.map(p => ({
		name: room.pics[p.id]?.name || '',
		x: p.x,
		y: p.y,
	}));

	const picsListEl = document.createElement('div');
	picsListEl.className = 'spot-pics-list';

	let dragState: { srcIdx: number; placeholder: HTMLDivElement; curIdx: number } | null = null;

	const getRowAtY = (clientY: number): number => {
		const rows = Array.from(picsListEl.children) as HTMLElement[];
		for (let i = 0; i < rows.length; i++) {
			const rect = rows[i].getBoundingClientRect();
			if (clientY < rect.top + rect.height / 2) return i;
		}
		return rows.length;
	};

	const renderPicsList = () => {
		picsListEl.innerHTML = '';
		picsList.forEach((pic, i) => {
			const row = document.createElement('div');
			row.className = 'spot-pics-row';
			row.dataset.idx = String(i);

			const dragHandle = document.createElement('span');
			dragHandle.className = 'spot-pics-handle';
			dragHandle.textContent = '\u2261';
			dragHandle.title = 'Drag to reorder';

			dragHandle.addEventListener('mousedown', (e) => {
				e.preventDefault();
				const placeholder = document.createElement('div');
				placeholder.className = 'spot-pics-placeholder';
				const rowRect = row.getBoundingClientRect();
				placeholder.style.height = rowRect.height + 'px';

				// Create floating clone
				row.classList.add('spot-pics-dragging');
				row.style.cssText += `;position:fixed;width:${rowRect.width}px;left:${rowRect.left}px;top:${rowRect.top}px;z-index:100000;pointer-events:none`;

				picsListEl.insertBefore(placeholder, row);

				dragState = { srcIdx: i, placeholder, curIdx: i };

				const onMove = (ev: MouseEvent) => {
					row.style.top = ev.clientY - rowRect.height / 2 + 'px';
					const targetIdx = getRowAtY(ev.clientY);
					if (targetIdx !== dragState!.curIdx) {
						dragState!.curIdx = targetIdx;
						// Move the placeholder
						const children = Array.from(picsListEl.children) as HTMLElement[];
						const nonDrag = children.filter(c => c !== row);
						const before = nonDrag[targetIdx] || null;
						if (before !== placeholder) {
							picsListEl.insertBefore(placeholder, before);
						}
					}
				};

				const onUp = () => {
					window.removeEventListener('mousemove', onMove);
					window.removeEventListener('mouseup', onUp);
					if (!dragState) return;
					const { srcIdx } = dragState;
					dragState = null;

					// Compute final insertion index
					// The placeholder position among non-drag non-placeholder children gives us target
					const children = Array.from(picsListEl.children) as HTMLElement[];
					const visibleRows = children.filter(c => c !== row && c !== placeholder);
					let finalIdx = visibleRows.length;
					for (let j = 0; j < children.length; j++) {
						if (children[j] === placeholder) {
							// Count real rows before placeholder
							finalIdx = children.slice(0, j).filter(c => c !== row && c !== placeholder).length;
							break;
						}
					}

					placeholder.remove();
					if (finalIdx !== srcIdx) {
						const [moved] = picsList.splice(srcIdx, 1);
						picsList.splice(finalIdx, 0, moved);
					}
					renderPicsList();
				};

				window.addEventListener('mousemove', onMove);
				window.addEventListener('mouseup', onUp);
			});

			const idxLabel = document.createElement('span');
			idxLabel.className = 'spot-pics-idx';
			idxLabel.textContent = String(i);

			const nameInput = document.createElement('input');
			nameInput.className = 'dlg-input';
			nameInput.value = pic.name;
			nameInput.title = 'Picture name';
			nameInput.placeholder = 'filename.png';
			nameInput.onchange = () => { pic.name = nameInput.value; };

			const xInput = document.createElement('input');
			xInput.className = 'dlg-input';
			xInput.type = 'number';
			xInput.value = String(pic.x);
			xInput.title = 'X offset';
			xInput.onchange = () => { pic.x = Number(xInput.value) || 0; };

			const yInput = document.createElement('input');
			yInput.className = 'dlg-input';
			yInput.type = 'number';
			yInput.value = String(pic.y);
			yInput.title = 'Y offset';
			yInput.onchange = () => { pic.y = Number(yInput.value) || 0; };

			const delBtn = document.createElement('button');
			delBtn.className = 'spot-pics-del';
			delBtn.textContent = '\u2715';
			delBtn.title = 'Remove picture';
			delBtn.onclick = () => { picsList.splice(i, 1); renderPicsList(); };

			row.appendChild(dragHandle);
			row.appendChild(idxLabel);
			row.appendChild(nameInput);
			row.appendChild(xInput);
			row.appendChild(yInput);
			row.appendChild(delBtn);
			picsListEl.appendChild(row);
		});
	};
	renderPicsList();

	const picsHeader = document.createElement('div');
	picsHeader.className = 'spot-pics-header';
	const headerLabels = ['', '#', 'Name', 'X', 'Y', ''];
	headerLabels.forEach(t => {
		const span = document.createElement('span');
		span.textContent = t;
		picsHeader.appendChild(span);
	});

	const addPicBtn = document.createElement('button');
	addPicBtn.className = 'dlg-btn-ok';
	addPicBtn.style.marginTop = '6px';
	addPicBtn.textContent = '+ Add Picture';
	addPicBtn.onclick = () => {
		picsList.push({ name: '', x: 0, y: 0 });
		renderPicsList();
	};

	picsPane.appendChild(picsHeader);
	picsPane.appendChild(picsListEl);
	picsPane.appendChild(addPicBtn);
	tabPanes.push(picsPane);
	box.appendChild(picsPane);

	// ════════════════════════════════════════
	// Tab 2: Script
	// ════════════════════════════════════════
	const scriptPane = document.createElement('div');
	scriptPane.className = 'spot-tab-pane spot-tab-script';
	if (initialTab !== 2) scriptPane.style.display = 'none';

	const scriptWidget = new ScriptEditorWidget({
		title: `Spot ${spot.id}: ${spot.name || '(unnamed)'}`,
		placeholder: '; Spot script\nON SELECT {\n    "Hello" SAY\n}',
		showSave: false,
	});
	scriptWidget.value = spot.script || '';
	scriptPane.appendChild(scriptWidget.element);
	tabPanes.push(scriptPane);
	box.appendChild(scriptPane);

	// ── Buttons ──
	const btnRow = document.createElement('div');
	btnRow.className = 'dlg-buttons';
	btnRow.style.justifyContent = 'space-between';

	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'dlg-btn-cancel';
	deleteBtn.style.background = '#a33';
	deleteBtn.textContent = 'Delete';
	deleteBtn.onclick = () => {
		palace.sendSpotDel(spot.id);
		overlay.remove();
	};

	const rightBtns = document.createElement('div');
	rightBtns.style.display = 'flex';
	rightBtns.style.gap = '8px';

	const okBtn = document.createElement('button');
	okBtn.className = 'dlg-btn-ok';
	okBtn.textContent = 'OK';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'dlg-btn-cancel';
	cancelBtn.textContent = 'Cancel';

	rightBtns.appendChild(okBtn);
	rightBtns.appendChild(cancelBtn);
	btnRow.appendChild(deleteBtn);
	btnRow.appendChild(rightBtns);
	box.appendChild(btnRow);

	// Custom resize handle for Script tab (replaces CSS resize:both which drifts under flex centering)
	const spotResizeHandle = document.createElement('div');
	spotResizeHandle.className = 'ipe-resize-handle';
	spotResizeHandle.style.display = 'none';
	box.appendChild(spotResizeHandle);
	spotResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const r = box.getBoundingClientRect();
		const sX = e.clientX, sY = e.clientY, sW = r.width, sH = r.height;
		const rOverlay = document.createElement('div');
		rOverlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:nwse-resize;';
		document.body.appendChild(rOverlay);
		const onMove = (ev: MouseEvent) => {
			box.style.width = `${sW + ev.clientX - sX}px`;
			box.style.height = `${sH + ev.clientY - sY}px`;
		};
		const onUp = () => {
			rOverlay.remove();
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	});

	overlay.appendChild(box);
	document.body.appendChild(overlay);
	if (initialTab === 2) {
		applyScriptGeometry();
		scriptWidget.focus();
		scriptWidget.textarea.setSelectionRange(0, 0);
		scriptWidget.textarea.scrollTop = 0;
		scriptWidget.textarea.dispatchEvent(new Event('scroll'));
	} else {
		nameInput.focus();
		nameInput.select();
	}

	const close = () => {
		if (wasScript) saveScriptGeometry();
		overlay.remove();
	};

	cancelBtn.onclick = close;
	overlay.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') close();
	});

	okBtn.onclick = () => {
		spot.name = nameInput.value;
		spot.dest = Number(destInput.value) || 0;
		spot.state = Number(stateInput.value) || 0;
		spot.type = Number(typeSelect.value) || 0;

		// Rebuild flags
		let flags = spot.flags;
		flags &= ~(spotConsts.DontMoveHere | spotConsts.ShowName | spotConsts.Forbidden |
			spotConsts.ShowFrame | spotConsts.Mandatory | spotConsts.Shadow | spotConsts.Landingpad |
			spotConsts.PicturesAboveAll | spotConsts.PicturesAboveProps | spotConsts.PicturesAboveNameTags);
		flagChecks.forEach(({ flag, cb }) => { if (cb.checked) flags |= flag; });
		const aboveVal = Number(doorAboveSelect.value);
		if (aboveVal === 1) flags |= spotConsts.PicturesAboveAll;
		else if (aboveVal === 2) flags |= spotConsts.PicturesAboveProps;
		else if (aboveVal === 3) flags |= spotConsts.PicturesAboveNameTags;
		spot.flags = flags;

		// Update statepics from pictures tab — resolve names to IDs
		spot.statepics = picsList.filter((p, i) => i === 0 || p.name).map(p => {
			if (!p.name) return { id: 0, x: p.x, y: p.y };
			// Find existing pic entry by name
			let picEntry = room.pics.find((e: any) => e && e.name === p.name);
			if (!picEntry) {
				// Allocate a new unique ID
				let maxId = 0;
				for (let i = 0; i < room.pics.length; i++) {
					if (room.pics[i]) maxId = i;
				}
				const newId = maxId + 1;
				const newImg = document.createElement('img');
				picEntry = { id: newId, name: p.name, img: newImg };
				room.pics[newId] = picEntry;
				newImg.onload = () => { if (palace.theRoom === room) room.setSpotImg(spot); };
				newImg.src = palace.passUrl(p.name);
			}
			return { id: picEntry.id, x: p.x, y: p.y };
		});
		

		// Update script from script tab
		const newScript = scriptWidget.value;
		spot.script = newScript;
		spot.handlers = IptEngine.parseEventHandlers(newScript);

		room.setSpotNameTag(spot);
		room.reDraw();
		room.reDrawTop();
		palace.sendRoomSetDesc();
		logmsg(`Spot "${spot.name}" updated.`);
		close();
	};
}
