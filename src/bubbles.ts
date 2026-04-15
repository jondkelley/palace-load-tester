import { palace } from './state.js';

export let chatBubs: Bubble[] = [];
export let quedBubbles: Bubble[] = [];
export const bubbleConsts = {
	padding: 9,
	spikeSize: 3,
	spikeSpread: 10,
	spoof: /(\-?\d+\s*)[\s,]*(\-?\d+\s*)/i,
	sound: /([a-zA-Z0-9\._-]*)(\s?)/i
};

interface BubInfo {
	start: number;
	type: number;
	x?: number;
	y?: number;
}

export class Bubble {
	p: HTMLDivElement;
	user: any;
	color: number | undefined;
	size: number;
	sticky: boolean;
	thought: boolean;
	shout: boolean;
	storedOriginX: number;
	storedOriginY: number;
	originX!: number;
	originY!: number;
	padA: number;
	padB: number;
	textWidth: number;
	textHeight: number;
	textYOffset: number;
	x!: number;
	y!: number;
	right!: boolean;
	deflated!: boolean;
	popTimer: ReturnType<typeof setTimeout> | null = null;
	raf: number | null = null;
	private baseCssText = '';

	constructor(user: any, chat: { whisper?: boolean; chatstr: string }, bubInfo: BubInfo) {
		let x = 0;
		let y = 0;

		if (user) {
			if (user.sticky) {
				user.sticky.remove(true);
				user.sticky = null;
				palace.theRoom.reDrawTop();
			}
			x = user.x;
			y = user.y;
		} else if (palace.theRoom.sticky) {
			palace.theRoom.sticky.remove(true);
			palace.theRoom.sticky = null;
			palace.theRoom.reDrawTop();
		}

		if (bubInfo.x !== undefined) {
			x = bubInfo.x;
			y = bubInfo.y!;
		}

		this.p = document.createElement('div');
		this.p.className = 'chatBubble';
		if (chat.whisper) this.p.style.fontStyle = 'italic';

		this.p.textContent = chat.chatstr.substring(bubInfo.start);
		this.p.style.top = '-9999px';

		this.user = user;

		if (user) this.color = user.color;
		this.size = 0.5;
		this.sticky = Boolean(bubInfo.type & 1);
		this.thought = Boolean(bubInfo.type & 2);
		this.shout = Boolean(bubInfo.type & 4);
		this.storedOriginX = x;
		this.storedOriginY = y;
		this.adjustOrigin();
		this.padA = bubbleConsts.padding;
		this.padB = bubbleConsts.padding * 2;
		if (this.thought) {
			this.padA += bubbleConsts.padding;
			this.padB += bubbleConsts.padding * 2;
		} else if (this.shout) {
			this.padA += bubbleConsts.padding * 2;
			this.padB += bubbleConsts.padding * 4;
		}
		this.p.style.maxHeight = `${palace.roomHeight - this.padB * 2 + this.padA}px`;
		if (palace.roomWidth < 550) {
			this.p.style.maxWidth = `${Math.max(50, Math.trunc(palace.roomWidth / 3.5))}px`;
		}
		palace.container.appendChild(this.p);
		this.textWidth = this.p.offsetWidth;
		this.textHeight = this.p.offsetHeight;
		this.textYOffset = 0;
		if (this.isOverflown) {
			this.p.style.pointerEvents = 'auto';
		}
		if (this.textHeight < this.padB && !this.shout) {
			if (this.thought) this.textYOffset = (this.padB - this.textHeight) / 2;
			this.textHeight = this.padB;
		}
		this.baseCssText = this.p.style.cssText;

		if (!this.awaitDirection()) {
			this.show();
		} else {
			quedBubbles.push(this);
		}
	}

	get isOverflown(): boolean {
		return this.p.scrollHeight > this.p.clientHeight || this.p.scrollWidth > this.p.clientWidth;
	}

	adjustOrigin(): void {
		this.originX = this.storedOriginX;
		this.originY = this.storedOriginY;
		if (this.thought) this.originY -= 20;
		if (this.originX < 0) this.originX = 0;
		if (this.originY < 0) this.originY = 0;
		if (this.originX > palace.roomWidth) this.originX = palace.roomWidth;
		if (this.originY > palace.roomHeight) this.originY = palace.roomHeight;
	}

	remove(now: boolean): void {
		if (now) {
			const index = chatBubs.indexOf(this);
			if (this.popTimer) clearTimeout(this.popTimer);
			this.popTimer = null;
			this.cancelAnimation();
			this.user = null;
			if (index > -1) {
				palace.container.removeChild(this.p);
				chatBubs.splice(index, 1);
			}
		} else {
			this.deflate(true);
		}
		Bubble.pushBubbles();
	}

	show(): void {
		if (this.sticky && this.user) this.user.sticky = this;
		if (this.sticky && !this.user) palace.theRoom.sticky = this;

		chatBubs.push(this);
		this.inflate();

		if (!this.sticky) {
			let speed = this.p.textContent!.length * 130;
			if (speed < 3540) {
				speed = 3540;
			} else if (speed > 12000) {
				speed = 12000;
			}
			this.popTimer = setTimeout(() => { this.remove(false); }, speed);
		}
		palace.theRoom.reDrawBubbles();
	}

	inflate(): void {
		this.deflated = false;
		this.cancelAnimation();

		let start: number | undefined;
		const grow = (timestamp: number) => {
			if (!start) {
				start = timestamp;
				setTimeout(() => {
					this.p.style.cssText = `${this.baseCssText};left:${this.x}px;top:${this.y + this.textYOffset}px;transition:transform 0.18s ease-out,opacity 0.18s ease-out;transform:scale(1);opacity:1`;
				}, 0);
			}
			const progress = timestamp - start;
			this.size = Math.min((progress / this.size / 360) + 0.5, 1);
			palace.theRoom.reDrawBubbles();
			if (progress < 150) {
				this.raf = requestAnimationFrame(grow);
			} else {
				this.size = 1;
				this.raf = null;
			}
		};
		this.raf = requestAnimationFrame(grow);
	}

	deflate(remove: boolean): void {
		this.deflated = true;
		this.cancelAnimation();
		let start: number | undefined;
		const shrink = (timestamp: number) => {
			if (!start) {
				start = timestamp;
				this.p.style.cssText = `${this.baseCssText};transition:transform 0.14s linear,opacity 0.14s linear`;
			}
			const progress = timestamp - start;
			this.size = Math.max(1 - (progress / 200), 0.5);
			palace.theRoom.reDrawBubbles();
			if (progress < 100) {
				this.raf = requestAnimationFrame(shrink);
			} else if (remove) {
				this.raf = null;
				this.remove(true);
			} else {
				this.p.style.top = '-9999px';
			}
		};
		this.raf = requestAnimationFrame(shrink);
	}

	cancelAnimation(): void {
		if (this.raf) {
			cancelAnimationFrame(this.raf);
		}
	}

	makeShoutBubble(ctx: CanvasRenderingContext2D): void {
		const w = this.textWidth * this.size;
		const h = this.textHeight * this.size;
		const centerX = this.x + (this.textWidth / 2);
		const centerY = this.y + (this.textHeight / 2);
		const radiusW = (w / 1.45) + bubbleConsts.padding;
		const radiusH = (h / 1.45) + bubbleConsts.padding;
		const circum = radiusW * radiusH * Math.PI;
		const inter = circum / (circum / (bubbleConsts.spikeSize + Math.round((radiusW + radiusH) / bubbleConsts.spikeSpread)));

		let pie = Math.PI / inter;

		ctx.beginPath();
		ctx.moveTo(centerX + radiusW * Math.cos(pie), centerY + radiusH * Math.sin(pie));

		let angle = 0;
		for (let n = 0; n < inter; n++) {
			pie = Math.PI / inter;

			angle += pie;
			ctx.lineTo(centerX + radiusW * Math.cos(angle), centerY + radiusH * Math.sin(angle));

			angle += pie;
			let r1 = 16;
			let r2 = 16;
			if (this.size < 1) {
				r1 = (r1 + 4) * Math.random();
				r2 = (r1 + 4) * Math.random();
			}

			ctx.lineTo(centerX + (radiusW + 5 + r1) * Math.cos(angle), centerY + (radiusH + 5 + r2) * Math.sin(angle));
		}
		ctx.closePath();
	}

	makeThoughtBubble(ctx: CanvasRenderingContext2D, time: number): void {
		this._drawThoughtCloud(ctx, time * 0.0002, time, 1);
	}

	/** Draw animated haze layers over the thought cloud. */
	drawThoughtHaze(ctx: CanvasRenderingContext2D, time: number): void {
		const layers = [
			{ scale: 1.04, alpha: 0.45, speed: 0.0006 },
			{ scale: 1.07, alpha: 0.38, speed: -0.0004 },
			{ scale: 1.10, alpha: 0.25, speed: 0.0003 },
		];
		const savedFill = ctx.fillStyle;
		for (const layer of layers) {
			const drift = time * layer.speed;
			ctx.save();
			ctx.globalAlpha = layer.alpha * this.size;
			ctx.shadowColor = 'transparent';
			ctx.shadowBlur = 0;
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
			ctx.fillStyle = savedFill;
			this._drawThoughtCloud(ctx, drift, time, layer.scale);
			ctx.fill();
			ctx.restore();
		}
	}

	private _drawThoughtCloud(ctx: CanvasRenderingContext2D, angleOffset: number, time: number, scaleExtra: number): void {
		const padding = bubbleConsts.padding;
		let x = this.x - padding;
		let y = this.y - padding;
		const width = (this.textWidth + (padding * 2)) * this.size;
		const height = (this.textHeight + (padding * 2)) * this.size;

		const w = this.textWidth + (padding * 2);
		x += (w - width) / 2;
		const h = this.textHeight + (padding * 2);
		y += (h - height) / 2;

		const baseBumpR = Math.max(10, Math.min(width, height) * 0.18) * this.size * scaleExtra;
		const spacing = (Math.max(10, Math.min(width, height) * 0.18) * this.size) * 1.5;

		ctx.beginPath();

		// Build cloud entirely from overlapping arcs
		const cx = x + width / 2;
		const cy = y + height / 2;
		const rx = (width / 2) * scaleExtra;
		const ry = (height / 2) * scaleExtra;

		// Place bumps along an ellipse that covers the rounded rect area
		const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
		const numBumps = Math.max(10, Math.round(perim / spacing));

		for (let i = 0; i < numBumps; i++) {
			const angle = (2 * Math.PI * i) / numBumps + angleOffset;
			// Per-bump radius jitter: each bump oscillates at its own phase
			const jitter = time > 0 ? Math.sin(time * 0.0015 + i * 2.39) * baseBumpR * 0.15 : 0;
			// Per-bump position jitter: radial and tangential wobble
			const radialOff = time > 0 ? Math.sin(time * 0.0012 + i * 3.71) * baseBumpR * 0.12 : 0;
			const tangentOff = time > 0 ? Math.cos(time * 0.0009 + i * 1.93) * baseBumpR * 0.10 : 0;
			const bumpR = baseBumpR + jitter;
			const bx = cx + (rx + radialOff) * Math.cos(angle) - tangentOff * Math.sin(angle);
			const by = cy + (ry + radialOff) * Math.sin(angle) + tangentOff * Math.cos(angle);
			ctx.moveTo(bx + bumpR, by);
			ctx.arc(bx, by, bumpR, 0, Math.PI * 2);
		}

		// Fill center with an ellipse so there are no gaps
		ctx.moveTo(cx + rx, cy);
		ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	}

	drawThoughtDots(ctx: CanvasRenderingContext2D, time: number): void {
		if (this.sticky) return;
		const padding = bubbleConsts.padding;
		let startX: number;
		if (this.right) {
			startX = this.x - padding;
		} else {
			startX = this.x + this.textWidth + padding;
		}

		let startY = this.originY;
		if (startY < this.y - padding) startY = this.y - padding;
		if (startY > this.y + this.textHeight + padding) startY = this.y + this.textHeight + padding;

		const sizes = [5, 3.5, 2];
		for (let i = 0; i < sizes.length; i++) {
			const t = (i + 1) / (sizes.length + 1);
			const wobbleX = Math.sin(time * 0.002 + i * 2.1) * 1.5;
			const wobbleY = Math.cos(time * 0.0018 + i * 1.7) * 1.5;
			const pulse = 1 + Math.sin(time * 0.003 + i * 2.5) * 0.15;
			const dx = startX + (this.originX - startX) * t + wobbleX;
			const dy = startY + (this.originY - startY) * t + wobbleY;
			const r = Math.max(1.5, sizes[i] * this.size * pulse);
			ctx.beginPath();
			ctx.arc(dx, dy, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	makeRegularBubble(ctx: CanvasRenderingContext2D): void {
		let radius = 18 * this.size;
		if (radius < 12) radius = 12;
		let x = this.x - bubbleConsts.padding;
		let y = this.y - bubbleConsts.padding;
		const width = (this.textWidth + (bubbleConsts.padding * 2)) * this.size;
		const height = (this.textHeight + (bubbleConsts.padding * 2)) * this.size;
		const ux = this.originX;
		const uy = this.originY;
		let dist = 23;
		const space = 6;

		const w = this.textWidth + (bubbleConsts.padding * 2);
		x += w / 3 - (width * this.size) / 3;

		const h = this.textHeight + (bubbleConsts.padding * 2);
		y += h / 3 - (height * this.size) / 3;

		// Clamp radius so it never exceeds half the smaller dimension
		if (radius > width / 2) radius = width / 2;
		if (radius > height / 2) radius = height / 2;

		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + width - radius, y);
		ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
		if (!this.right && !this.sticky) {
			let neck = uy;
			if (y + radius > neck) neck = y + radius;
			if (y + height - radius < neck) neck = y + height - radius;
			dist = dist / this.size;
			if (dist > 35) dist = 35;
			ctx.lineTo(x + width, neck - space);
			ctx.quadraticCurveTo(x + width, neck, ux - dist, uy);
			ctx.quadraticCurveTo(x + width, neck, x + width, neck + space);
		}
		ctx.lineTo(x + width, y + height - radius);
		ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		ctx.lineTo(x + radius, y + height);
		ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
		if (this.right && !this.sticky) {
			let neck = uy;
			if (y + height - radius < neck) neck = y + height - radius;
			if (y + radius > neck) neck = y + radius;
			dist = dist / this.size;
			if (dist > 35) dist = 35;
			ctx.lineTo(x, neck + space);
			ctx.quadraticCurveTo(x, neck, ux + dist, uy);
			ctx.quadraticCurveTo(x, neck, x, neck - space);
		}
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.closePath();
	}

	/** Draw a gloss highlight on the top portion of the regular bubble. */
	drawGloss(ctx: CanvasRenderingContext2D): void {
		let radius = 18 * this.size;
		if (radius < 12) radius = 12;
		let x = this.x - bubbleConsts.padding;
		let y = this.y - bubbleConsts.padding;
		const width = (this.textWidth + (bubbleConsts.padding * 2)) * this.size;
		const height = (this.textHeight + (bubbleConsts.padding * 2)) * this.size;

		const w = this.textWidth + (bubbleConsts.padding * 2);
		x += w / 3 - (width * this.size) / 3;
		const h = this.textHeight + (bubbleConsts.padding * 2);
		y += h / 3 - (height * this.size) / 3;

		if (radius > width / 2) radius = width / 2;
		if (radius > height / 2) radius = height / 2;

		const glossH = height * 0.4;
		const inset = 1;

		ctx.save();
		ctx.beginPath();
		ctx.moveTo(x + radius + inset, y + inset);
		ctx.lineTo(x + width - radius - inset, y + inset);
		ctx.quadraticCurveTo(x + width - inset, y + inset, x + width - inset, y + radius + inset);
		ctx.lineTo(x + width - inset, y + glossH);
		ctx.quadraticCurveTo(x + width / 2, y + glossH + glossH * 0.35, x + inset, y + glossH);
		ctx.lineTo(x + inset, y + radius + inset);
		ctx.quadraticCurveTo(x + inset, y + inset, x + radius + inset, y + inset);
		ctx.closePath();

		const grd = ctx.createLinearGradient(x, y, x, y + glossH);
		grd.addColorStop(0, 'rgba(255,255,255,0.35)');
		grd.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = grd;
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		ctx.globalAlpha = this.size;
		ctx.fill();
		ctx.restore();
	}

	avoidOthers(): boolean {
		const submissives: Bubble[] = [];
		const x1 = this.x - this.padA;
		const y1 = this.y - this.padA;
		const w1 = this.textWidth + this.padB;
		const h1 = this.textHeight + this.padB;

		const bub = this;
		if (chatBubs.find((boob) => {
			if (bub !== boob) {
				const x2 = boob.x - boob.padA;
				const y2 = boob.y - boob.padA;
				const w2 = boob.textWidth + boob.padB;
				const h2 = boob.textHeight + boob.padB;
				const overLaps = (x1 >= x2 + w2 || x1 + w1 <= x2 || y1 >= y2 + h2 || y1 + h1 <= y2) === false;
				if (((bub.sticky && boob.sticky) || (!boob.deflated && !boob.sticky)) && overLaps)
					return true;
				if (!bub.sticky && boob.sticky && overLaps)
					submissives.push(boob);
			}
		})) return true;

		if (x1 < 0 || y1 < 0 || x1 + w1 > palace.roomWidth || y1 + h1 > palace.roomHeight) {
			return true;
		}

		submissives.forEach((sub) => { sub.deflate(false); });
		return false;
	}

	awaitDirection(): boolean {
		const side = (palace.roomWidth / 2 < this.originX);
		let offsetOrigin = 42;
		if (this.sticky) offsetOrigin = -this.textWidth / 2;
		let iterations = 0;
		let currentSide = side;

		do {
			if (iterations > 1) return true;
			iterations++;

			let x = this.originX;
			let y = this.originY;

			if (currentSide || this.sticky) {
				x -= this.textWidth + offsetOrigin;
				this.right = false;
			} else {
				x += offsetOrigin;
				this.right = true;
			}
			y -= this.textHeight / 2;
			

			if (y + this.textHeight + this.padB > palace.roomHeight)
				y = palace.roomHeight - (this.textHeight + this.padB);
			if (y - this.padA < 0)
				y = this.padA;

			if (x + this.textWidth + this.padB > palace.roomWidth && (this.right === false || this.sticky || this.shout))
				x = palace.roomWidth - (this.textWidth + this.padB);
			if (x - this.padA < 0 && (this.right === true || this.sticky || this.shout))
				x = this.padA;

			this.x = x;
			this.y = y;

			currentSide = !currentSide;
		} while (this.avoidOthers());

		return false;
	}

	static processChatType(chatstr: string): BubInfo {
		let end: boolean | undefined;
		const bubInfo: BubInfo = { start: 0, type: 0 };
		const chatLen = chatstr.length;
		let i: number;
		for (i = 0; i < chatLen; i++) {
			switch (chatstr.charAt(i)) {
				case '!':
					bubInfo.type |= 4;
					break;
				case ':':
					bubInfo.type |= 2;
					break;
				case '^':
					bubInfo.type |= 1;
					break;
				case ')': {
					const r = bubbleConsts.sound.exec(chatstr.substr(i + 1));
					if (r && r[1].length > 0) {
						palace.playSound(r[1]);
						i += r[0].length;
					}
					break;
				}
				case '@': {
					const r = bubbleConsts.spoof.exec(chatstr);
					if (r) {
						bubInfo.x = Number(r[1]);
						bubInfo.y = Number(r[2]);
						i += r[0].length;
					}
					break;
				}
				case ';':
					bubInfo.type = -1;
					bubInfo.start = i;
					return bubInfo;
				default:
					end = true;
			}
			if (end) break;
		}
		bubInfo.start = i;
		return bubInfo;
	}

	static deleteAllBubbles(): boolean {
		let removed = false;
		for (let i = quedBubbles.length; --i >= 0;) {
			removed = true;
			palace.container.removeChild(quedBubbles[i].p);
		}
		quedBubbles = [];
		for (let i = chatBubs.length; --i >= 0;) {
			removed = true;
			chatBubs[i].remove(true);
		}

		if (palace.theRoom && palace.theRoom.sticky) {
			removed = true;
			palace.theRoom.sticky.remove(true);
			palace.theRoom.sticky = null;
		}
		return removed;
	}

	static pushBubbles(): void {
		for (let i = 0; i < quedBubbles.length; i++) {
			const bub = quedBubbles[i];
			if (!bub.awaitDirection()) {
				quedBubbles.splice(i, 1);
				bub.show();
				i--;
			}
		}
		for (let i = chatBubs.length; --i >= 0;) {
			const bub = chatBubs[i];
			if (bub.sticky && bub.deflated && !bub.awaitDirection()) {
				bub.inflate();
			}
		}
	}

	static resetDisplayedBubbles(): void {
		for (let i = 0; i < chatBubs.length; i++) {
			const bub = chatBubs[i];
			bub.adjustOrigin();
			bub.awaitDirection();
			if (bub.p.style.top !== '-9999px') {
				bub.p.style.left = `${bub.x}px`;
				bub.p.style.top = `${bub.y + bub.textYOffset}px`;
			}
		}
		Bubble.pushBubbles();
	}
}
