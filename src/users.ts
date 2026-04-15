import { palace, smileys } from './state.js';
import { getHsl } from './utility.js';
import { cacheProps, loadProps, PalaceProp } from './props.js';
import { chatBubs, quedBubbles, Bubble } from './bubbles.js';
import { enablePropButtons } from './interface.js';

interface DomProp {
	div: HTMLDivElement;
	prop?: PalaceProp;
	visible: boolean;
}

interface NameRectBounds {
	x: number;
	y: number;
}

export class PalaceUser {
	id!: number;
	name!: string;
	x!: number;
	y!: number;
	color!: number;
	face!: number;
	props!: number[];
	status!: number;
	sticky: Bubble | null = null;

	cssFilters: Record<string, string> = {};
	cssTransforms: Record<string, string> = {};
	domProp: (DomProp | null)[] = [];
	nameTagTranslate = '';

	domAvatar: HTMLDivElement;
	style: CSSStyleDeclaration;
	domNametag: HTMLDivElement;

	nameWidth = 0;
	nameHeight = 0;
	head = false;

	animateTimer: ReturnType<typeof setInterval> | null = null;
	raf: number | null = null;

	private _propMuted = false;
	avatarLocked = false;

	constructor(info: Record<string, unknown>, entered?: boolean) {
		Object.assign(this, info);

		this.cssFilters = {};
		this.cssTransforms = {};
		this.domProp = [];
		this.nameTagTranslate = '';

		this.domAvatar = document.createElement('div');
		this.style = this.domAvatar.style;
		this.domNametag = document.createElement('div');
		this.domNametag.innerText = this.name;

		this.domNametag.style.transition = 'none';
		this.style.transition = 'none';

		this.domAvatar.className = 'avatar';
		this.domNametag.className = 'avnametag';

		palace.container.appendChild(this.domNametag);

		this.setName(true);
		this.setAvatarLocation(true);

		if (entered) {
			this.shrink();
			this.setName(false);
		}

		this.setDomProps();
		this.setColor();

		palace.container.appendChild(this.domAvatar);

		setTimeout(() => {
			this.domNametag.style.transition = '';
			this.style.transition = '';
			if (entered) this.grow();
		}, 2);
	}

	get propMuted(): boolean {
		return Boolean(this._propMuted);
	}

	set propMuted(bool: boolean) {
		this._propMuted = Boolean(bool);
		this.domAvatar.className = this._propMuted ? 'avatar avpropmuted' : 'avatar';
	}

	opacity(value: string): void {
		this.domNametag.style.opacity = value;
		this.style.opacity = value;
	}

	putFilters(filters: string[]): void {
		for (let i = 0; i < filters.length; i++) {
			this.cssFilters[filters[i].match(/^[^(]+/)![0]] = filters[i];
		}
		this.applyFilters();
	}

	removeFilters(names: string[]): void {
		for (let i = 0; i < names.length; i++) {
			delete this.cssFilters[names[i]];
		}
		this.applyFilters();
	}

	applyFilters(): void {
		let filters = '';
		for (const name in this.cssFilters) {
			filters += `${this.cssFilters[name]} `;
		}
		this.style.filter = filters;
		this.domNametag.style.filter = filters;
	}

	putTransforms(transforms: string[]): void {
		for (let i = 0; i < transforms.length; i++) {
			this.cssTransforms[transforms[i].match(/^[^(]+/)![0]] = transforms[i];
		}
		this.applyTransforms();
	}

	removeTransforms(names: string[]): void {
		for (let i = 0; i < names.length; i++) {
			delete this.cssTransforms[names[i]];
		}
		this.applyTransforms();
	}

	applyTransforms(): void {
		let transforms = '';
		for (const name in this.cssTransforms) {
			transforms += `${this.cssTransforms[name]} `;
		}
		this.style.transform = transforms;
		this.domNametag.style.transform = transforms.replace(/translate\([^)]+\)/, this.nameTagTranslate);
	}

	setDomProps(dlPid?: number): void {
		if (this.animateTimer) {
			clearInterval(this.animateTimer);
			this.animateTimer = null;
		}
		if (this.raf) {
			cancelAnimationFrame(this.raf);
			this.raf = null;
		}

		for (let i = this.props.length; i < 9; i++) {
			const d = this.domProp[i];
			if (d) {
				this.domProp[i] = null;
				this.domAvatar.removeChild(d.div);
			}
		}

		const animatedProps: DomProp[] = [];
		for (let i = 0; i < this.props.length; i++) {
			let d = this.domProp[i];
			const pid = this.props[i];
			const wrongProp = (d && (!d.prop || d.prop.id !== pid));
			if (wrongProp || !d) {
				const prop = cacheProps[pid];
				if (prop && prop.img && prop.img.src) {
					const prevDiv = d ? d.div : undefined;
					const dd = this.createDomProp(i, prop, dlPid, prevDiv);
					if (prop.animated) animatedProps.push(dd);
					if (!prevDiv) this.domAvatar.appendChild(dd.div);
				} else if (wrongProp && d!.prop) {
					this.propPlaceHolder(i, d!.div);
				} else if (!d) {
					this.propPlaceHolder(i);
				}
			} else if (d.prop!.animated) {
				animatedProps.push(d);
			}
		}

		const head = this.hasHead;
		if (head && !this.head) {
			this.head = head;
			this.style.backgroundImage = '';
		} else if (!head && this.head) {
			this.head = head;
			this.setFace();
		}

		if (animatedProps.length > 1) {
			this.animate(animatedProps);
		} else if (animatedProps.length === 1) {
			this.setDomPropVisibility(animatedProps[0], true);
		}
	}

	propPlaceHolder(i: number, div?: HTMLDivElement): void {
		const ph = document.createElement('div');
		ph.className = 'avpropholder';
		this.domProp[i] = { div: ph, visible: false };
		if (div) {
			this.domAvatar.replaceChild(ph, div);
		} else {
			this.domAvatar.appendChild(ph);
		}
	}

	createDomProp(i: number, prop: PalaceProp, dlPid?: number, div?: HTMLDivElement): DomProp {
		const im = div && div.constructor === HTMLDivElement ? div : document.createElement('div');
		if (dlPid === prop.id) {
			im.style.transition = 'none';
			im.style.opacity = '0';
			setTimeout(() => {
				im.style.transition = '';
				im.style.opacity = prop.ghost ? '0.5' : '';
			}, 0);
		}
		im.style.width = `${prop.w}px`;
		im.style.height = `${prop.h}px`;
		im.style.backgroundImage = `url(${prop.img.src})`;
		im.style.transform = `translate(${prop.x}px,${prop.y}px)`;
		im.style.opacity = prop.ghost ? '0.5' : '';
		im.className = 'avprop';
		const d: DomProp = { div: im, prop: prop, visible: true };
		this.domProp[i] = d;
		return d;
	}

	get hasHead(): boolean {
		for (let i = 0; i < this.domProp.length; i++) {
			const d = this.domProp[i];
			if (d && d.prop && d.prop.head) {
				return true;
			}
		}
		return false;
	}

	animate(animatedProps: DomProp[]): void {
		let bounce = false;
		animatedProps.forEach((d, i) => {
			if (d.prop!.bounce) bounce = true;
			if (i !== 0) this.setDomPropVisibility(d, false);
		});
		let index = 0;
		let last: DomProp | undefined;
		let forward = true;
		const animator = (): void => {
			this.raf = null;
			if (last) this.setDomPropVisibility(last, false);
			last = animatedProps[index];
			this.setDomPropVisibility(last, true);
			if (index === animatedProps.length - 1) {
				bounce ? forward = false : index = -1;
			} else if (index === 0) {
				forward = true;
			}
			forward ? index++ : index--;
		};
		this.animateTimer = setInterval(() => {
			this.raf = requestAnimationFrame(animator);
		}, 350);
		animator();
	}

	setDomPropVisibility(d: DomProp, visible: boolean): void {
		if (visible && !d.visible) {
			d.div.style.visibility = 'visible';
		} else if (!visible && d.visible) {
			d.div.style.visibility = 'hidden';
		}
		d.visible = visible;
	}

	findDomProp(pid: number): DomProp | undefined {
		return this.domProp.find((d): d is DomProp => d !== null && d.prop !== undefined && d.prop.id === pid);
	}

	setName(dont?: boolean): void {
		if (!dont) this.domNametag.innerText = this.name;
		this.nameWidth = this.domNametag.offsetWidth;
		this.nameHeight = this.domNametag.offsetHeight;
		this.setNameLocation();
	}

	setNameLocation(): void {
		const bounds = this.nameRectBounds;
		this.nameTagTranslate = `translate(${bounds.x}px,${bounds.y}px)`;
		let s = this.domNametag.style.transform.replace(/translate\([^)]+\)/, this.nameTagTranslate);
		if (s === '') s = this.nameTagTranslate;
		this.domNametag.style.transform = s;
	}

	setAvatarLocation(dont?: boolean): void {
		this.putTransforms([`translate(${this.x - 21}px,${this.y - 21}px)`]);
		if (!dont) this.setNameLocation();
		if (palace.theRoom?.autoUserLayer) {
			this.domAvatar.style.zIndex = String(this.y);
			this.domNametag.style.zIndex = String(this.y + 100);
		}
	}

	setColor(): void {
		this.domNametag.style.color = getHsl(this.color, 60);
		if (!this.head) this.style.backgroundImage = `url(${smileys[`${this.face},${this.color}`].src})`;
	}

	setFace(): void {
		if (!this.head) this.style.backgroundImage = `url(${smileys[`${this.face},${this.color}`].src})`;
	}

	poke(): void {
		const end = (): void => {
			this.domAvatar.removeEventListener('transitionend', end);
			this.style.transitionDuration = '0.2s, 0.15s, 0.2s';
			this.domAvatar.offsetWidth;
			this.removeTransforms(['scale']);
		};

		this.style.transitionDuration = '0.01s, 0.15s, 0.2s';
		this.domAvatar.offsetWidth;
		this.putTransforms(['scale(1.09, 0.95)']);

		this.domAvatar.addEventListener('transitionend', end);
	}

	grow(): void {
		this.removeTransforms(['scale']);
	}

	shrink(exit?: boolean): void {
		this.putTransforms(['scale(0.001)']);
		if (exit) {
			this.id = -1;
			this.domAvatar.addEventListener('transitionend', () => {
				this.remove();
			});
		}
	}

	removeFromDom(): void {
		if (this.animateTimer) {
			clearInterval(this.animateTimer);
		}
		palace.container.removeChild(this.domNametag);
		palace.container.removeChild(this.domAvatar);
	}

	remove(): void {
		this.popBubbles();
		this.removeFromDom();
		palace.theRoom.users.splice(palace.theRoom.users.indexOf(this), 1);
		palace.theRoom.setUserCount();
	}

	get nameRectBounds(): NameRectBounds {
		const w = this.nameWidth;
		const h = this.nameHeight;
		const halfW = (w / 2);
		let x = this.x;
		let y = this.y + 2;
		const bgw = palace.roomWidth;
		const bgh = palace.roomHeight;

		if (x - halfW < 0) x = halfW;
		if (x > bgw - halfW) x = bgw - halfW;

		x = Math.round(x - halfW);
		y = Math.round(y + (h / 2));

		if (y < 0) y = 0;
		if (y > bgh - h) y = bgh - h;

		return { x: x, y: y };
	}

	changeUserProps(props: number[], fromSelf?: boolean): boolean | undefined {
		const same = (this.props.length === props.length &&
			this.props.every((v, i) => v === props[i]));

		this.props = props;

		if (!same) {
			loadProps(this.props, fromSelf);
			if (this === palace.theUser) {
				enablePropButtons();
			}
			this.setDomProps();
			return true;
		}
	}

	popBubbles(): void {
		for (let a = quedBubbles.length; --a >= 0;) {
			const bub = quedBubbles[a];
			if (this === bub.user) {
				bub.user = null;
				palace.container.removeChild(bub.p);
				quedBubbles.splice(a, 1);
			}
		}
		const i = chatBubs.length;
		for (let c = i; --c >= 0;) {
			const bub = chatBubs[c];
			if (this === bub.user) {
				bub.remove(true);
			}
		}
		if (i !== chatBubs.length) {
			palace.theRoom.reDrawTop();
		}
	}
}
