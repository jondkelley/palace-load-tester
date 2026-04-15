export class IptToken {
	scriptCharacterOffset: number;

	constructor(characterOffset = -1) {
		this.scriptCharacterOffset = characterOffset;
	}

	clone(): IptToken {
		return new IptToken();
	}

	toBoolean(): boolean {
		return true;
	}

	dereference(): IptToken {
		return this;
	}

	toString(): string {
		return '[IptToken]';
	}
}
