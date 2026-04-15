import { IptToken } from '../IptToken.js';

export class StringToken extends IptToken {
	data: string;

	constructor(value: string, characterOffset = -1) {
		super(characterOffset);
		this.data = value;
	}

	override clone(): IptToken {
		return new StringToken(this.data);
	}

	override toString(): string {
		return `[StringToken value="${this.data}"]`;
	}
}
