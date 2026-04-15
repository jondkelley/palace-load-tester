export class IptError extends Error {
	characterOffset: number;
	stackSnapshot: string[] = [];

	constructor(message: string, characterOffset = -1) {
		super(message);
		this.name = 'IptError';
		this.characterOffset = characterOffset;
	}
}
