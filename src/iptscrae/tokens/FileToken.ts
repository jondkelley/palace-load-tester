import { IptToken } from '../IptToken.js';

export class FileToken extends IptToken {
	data: File;

	constructor(file: File, characterOffset = -1) {
		super(characterOffset);
		this.data = file;
	}

	override clone(): IptToken {
		return new FileToken(this.data);
	}

	override toBoolean(): boolean {
		return true;
	}

	override toString(): string {
		return `[FileToken name="${this.data.name}" size=${this.data.size} type="${this.data.type}"]`;
	}
}
