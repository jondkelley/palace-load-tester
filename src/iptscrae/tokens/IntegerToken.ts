import { IptToken } from '../IptToken.js';

export class IntegerToken extends IptToken {
	static readonly ZERO = new IntegerToken(0);
	static readonly ONE = new IntegerToken(1);

	data: number;

	constructor(value = 0, characterOffset = -1) {
		super(characterOffset);
		this.data = value | 0;
	}

	override clone(): IptToken {
		return new IntegerToken(this.data);
	}

	override toBoolean(): boolean {
		return this.data !== 0;
	}

	override toString(): string {
		return `[IntegerToken value="${this.data}"]`;
	}
}
