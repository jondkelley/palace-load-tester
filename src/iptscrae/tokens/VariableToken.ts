import type { IptExecutionContext } from '../IptExecutionContext.js';
import { IptCommand } from '../IptCommand.js';

export class VariableToken extends IptCommand {
	name: string;

	constructor(name: string, characterOffset = -1) {
		super(characterOffset);
		this.name = name.toUpperCase();
	}

	override execute(context: IptExecutionContext): void {
		context.stack.push(context.variableStore.getVariable(this.name));
	}

	override toString(): string {
		return `[VariableToken name="${this.name}"]`;
	}
}
