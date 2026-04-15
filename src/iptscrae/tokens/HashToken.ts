import { IptToken } from '../IptToken.js';

export class HashToken extends IptToken {
	data: Map<string, IptToken>;

	constructor(data?: Map<string, IptToken>, characterOffset = -1) {
		super(characterOffset);
		this.data = data ?? new Map();
	}

	override clone(): IptToken {
		const cloned = new Map<string, IptToken>();
		for (const [key, value] of this.data) {
			cloned.set(key, value.clone());
		}
		return new HashToken(cloned);
	}

	override toBoolean(): boolean {
		return this.data.size > 0;
	}

	override toString(): string {
		let string = `[HashToken size=${this.data.size}]\n`;
		for (const [key, value] of this.data) {
			string += `  "${key}": ${value.toString()}\n`;
		}
		return string;
	}
}
