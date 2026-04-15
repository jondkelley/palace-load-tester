export function timeStampStr(seconds?: boolean): string {
	const now = new Date();
	const time: (number | string)[] = [now.getHours(), now.getMinutes(), now.getSeconds()];
	const suffix = ((time[0] as number) < 12) ? 'AM' : 'PM';
	time[0] = ((time[0] as number) < 12) ? time[0] : (time[0] as number) - 12;
	time[0] = (time[0] as number) || 12;

	if ((time[1] as number) < 10) time[1] = `0${time[1]}`;
	if ((time[2] as number) < 10) time[2] = `0${time[2]}`;

	if (!seconds) time.pop();
	return `${time.join(':')} ${suffix}`;
}

export function dedup<T>(ary: T[]): T[] {
	return ary.filter((e, i, a) => a.indexOf(e) === i);
}

export function getHsl(color: number, lightness: number): string {
	return `hsl(${22.5 * color},50%,${lightness}%)`;
}

export function getRandomInt(min: number, max: number): number {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
}

export function getRandomIntInclusive(min: number, max: number): number {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getNbrs(str: string): (number | string)[] {
	const nbrs: (number | string)[] = str.match(/[\.0-9]+/g) ?? [];
	nbrs.forEach((val, index) => {
		nbrs[index] = Number(val);
	});
	return nbrs;
}

export function hexToRGBA(hex: string, opacity: number): string {
	const nbrs = hex.match(/[A-Fa-f0-9]{2}/g)!;
	return `RGBA(${parseInt(nbrs[0], 16)},${parseInt(nbrs[1], 16)},${parseInt(nbrs[2], 16)},${opacity})`;
}

export function rgbToHex(rgba: string): string {
	const nbrs = getNbrs(rgba);
	nbrs.forEach((val, index) => {
		nbrs[index] = Number(val).toHex();
	});
	if (nbrs.length > 3) nbrs.pop();
	return `#${nbrs.join('')}`;
}

export function microseconds(): number {
	return new Date().getTime();
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	let r: number, g: number, b: number;

	if (s === 0) {
		r = g = b = l;
	} else {
		const hue2rgb = (p: number, q: number, t: number): number => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};

		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return [r! * 255, g! * 255, b! * 255];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h = 0, s: number;
	const l = (max + min) / 2;

	if (max === min) {
		h = s = 0;
	} else {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}

	return [h, s!, l];
}

Number.prototype.swap16 = function (this: number) {
	return ((this & 0xFF) << 8) | ((this >> 8) & 0xFF);
};

Number.prototype.toHex = function (this: number) {
	const hex = this.toString(16);
	if (hex.length % 2) return `0${hex}`;
	return hex;
};

Number.prototype.fastRound = function (this: number) {
	return (0.5 + this) | 0;
};

export function toHex(str: string): string {
	let hex = '';
	for (let i = 0; i < str.length; i++) {
		let s = str.charCodeAt(i).toString(16);
		if (s.length % 2) s = `0${s}`;
		hex += s;
	}
	return hex;
}

export function httpPostAsync(theUrl: string, rtype: XMLHttpRequestResponseType | null, postContent: Document | XMLHttpRequestBodyInit | null, callback: (response: unknown) => void, callerror?: (status: number) => void): void {
	const xmlHttp = new XMLHttpRequest();
	if (rtype) xmlHttp.responseType = rtype;
	xmlHttp.onerror = () => {
		if (callerror) callerror(xmlHttp.status);
	};
	xmlHttp.onload = () => {
		if (xmlHttp.status === 200) {
			callback(xmlHttp.response);
		} else {
			if (callerror) callerror(xmlHttp.status);
		}
	};
	xmlHttp.open('POST', theUrl, true);
	xmlHttp.send(postContent);
}

export function httpGetAsync(theUrl: string, rtype: XMLHttpRequestResponseType | null, callback: (response: unknown) => void, callerror?: (status: number) => void): void {
	const xmlHttp = new XMLHttpRequest();
	if (rtype) xmlHttp.responseType = rtype;
	xmlHttp.onerror = () => {
		if (callerror) callerror(xmlHttp.status);
	};
	xmlHttp.onload = () => {
		if (xmlHttp.status === 200) {
			callback(xmlHttp.response);
		} else {
			if (callerror) callerror(xmlHttp.status);
		}
	};
	xmlHttp.open('GET', theUrl, true);
	xmlHttp.send();
}

export function httpHeadAsync(theUrl: string, callback: (contentType: string) => void): void {
	const xmlHttp = new XMLHttpRequest();
	xmlHttp.onerror = function () {
		console.log(`Error with http get request: ${theUrl}`);
	};
	xmlHttp.onload = function () {
		if (xmlHttp.status === 200) {
			callback(xmlHttp.getResponseHeader('Content-Type')!.trim());
		} else {
			console.log(`Error ${xmlHttp.status} with http head request: ${theUrl}`);
		}
	};
	xmlHttp.open('HEAD', theUrl, true);
	xmlHttp.send();
}

export function getImageData(img: HTMLImageElement | string[]): string | string[] {
	if (Array.isArray(img) && img.length > 0) return img;
	if (typeof img === 'string') return img;
	const imgEl = img as HTMLImageElement;
	if (/^data/.test(imgEl.src)) return imgEl.src;
	const canvas = document.createElement('canvas');
	canvas.width = imgEl.naturalWidth;
	canvas.height = imgEl.naturalHeight;
	canvas.getContext('2d')!.drawImage(imgEl, 0, 0);
	return canvas.toDataURL('image/png');
}

export function getTextHeight(font: string): number {
	const div = document.createElement('div');
	div.textContent = '/y]T|\\';
	div.style.position = 'absolute';
	div.style.top = '-9999px';
	div.style.left = '-9999px';
	div.style.font = font;
	document.body.appendChild(div);
	const h = div.offsetHeight;
	document.body.removeChild(div);
	return h;
}

export function parseURL(url: string): HTMLAnchorElement {
	const parser = document.createElement('a');
	parser.href = url;
	return parser;
}

export function ticks(): number {
	return Math.trunc(microseconds() / 16.666666666666667);
}

export function datetime(): number {
	return Math.trunc(microseconds() / 1000);
}

export function showConfirmDialog(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';
		const box = document.createElement('div');
		box.className = 'dlg-box';
		const label = document.createElement('p');
		label.className = 'dlg-message';
		label.textContent = message;
		const btnRow = document.createElement('div');
		btnRow.className = 'dlg-buttons';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'dlg-btn-cancel';
		cancelBtn.textContent = 'Cancel';
		const okBtn = document.createElement('button');
		okBtn.className = 'dlg-btn-ok';
		okBtn.textContent = 'OK';
		btnRow.appendChild(cancelBtn);
		btnRow.appendChild(okBtn);
		box.appendChild(label);
		box.appendChild(btnRow);
		overlay.appendChild(box);
		document.body.appendChild(overlay);
		okBtn.focus();

		const finish = (result: boolean) => {
			overlay.remove();
			resolve(result);
		};

		okBtn.addEventListener('click', () => finish(true));
		cancelBtn.addEventListener('click', () => finish(false));
		overlay.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') finish(true);
			else if (e.key === 'Escape') finish(false);
		});
	});
}

export function showPromptDialog(message: string, defaultValue?: string, password?: boolean): Promise<string | null> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';
		const box = document.createElement('div');
		box.className = 'dlg-box';
		const label = document.createElement('p');
		label.className = 'dlg-message';
		label.textContent = message;
		const input = document.createElement('input');
		if (password) input.type = 'password';
		input.className = 'dlg-input';
		input.value = defaultValue || '';
		const btnRow = document.createElement('div');
		btnRow.className = 'dlg-buttons';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'dlg-btn-cancel';
		cancelBtn.textContent = 'Cancel';
		const okBtn = document.createElement('button');
		okBtn.className = 'dlg-btn-ok';
		okBtn.textContent = 'OK';
		btnRow.appendChild(cancelBtn);
		btnRow.appendChild(okBtn);
		box.appendChild(label);
		box.appendChild(input);
		box.appendChild(btnRow);
		overlay.appendChild(box);
		document.body.appendChild(overlay);
		input.focus();
		input.select();

		const finish = (result: string | null) => {
			overlay.remove();
			resolve(result);
		};

		okBtn.addEventListener('click', () => finish(input.value));
		cancelBtn.addEventListener('click', () => finish(null));
		overlay.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') finish(input.value);
			else if (e.key === 'Escape') finish(null);
		});
	});
}
