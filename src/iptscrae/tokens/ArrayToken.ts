import { IptToken } from '../IptToken.js';

export class ArrayToken extends IptToken {
	data: IptToken[];

	constructor(data: IptToken[] | null = null, characterOffset = -1) {
		super(characterOffset);
		this.data = data ?? [];
	}

	override clone(): IptToken {
		return new ArrayToken([...this.data]);
	}

	override toString(): string {
		let string = `[ArrayToken length=${this.data.length}]\n`;
		for (const token of this.data) {
			string += `  - ${token.toString()}\n`;
		}
		return string;
	}
}
