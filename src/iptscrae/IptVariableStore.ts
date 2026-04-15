import { IptVariable } from './IptVariable.js';
import type { IptExecutionContext } from './IptExecutionContext.js';

export class IptVariableStore {
	private variables: Map<string, IptVariable> = new Map();
	private context: IptExecutionContext;

	constructor(context: IptExecutionContext) {
		this.context = context;
	}

	getVariable(variableName: string): IptVariable {
		let variable = this.variables.get(variableName);
		if (!variable) {
			variable = new IptVariable(this.context, variableName);
			if (this.context.isExternalVariable(variableName)) {
				variable.external = true;
			}
			this.variables.set(variableName, variable);
		}
		return variable;
	}
}
