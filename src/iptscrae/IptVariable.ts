import { IptToken } from './IptToken.js';
import { IntegerToken } from './tokens/IntegerToken.js';
import type { IptExecutionContext } from './IptExecutionContext.js';

export class IptVariable extends IptToken {
	private _value: IptToken | null;
	private _name: string;
	private context: IptExecutionContext;
	private _globalized = false;
	private _globalVariable: IptVariable | null = null;
	initialized = false;
	external = false;

	constructor(context: IptExecutionContext, name: string, value: IptToken | null = null) {
		super();
		this.context = context;
		this._name = name;
		this._value = value;
	}

	get name(): string {
		return this._name;
	}

	get value(): IptToken {
		if (this.external) {
			return this.context.getExternalVariable(this._name);
		} else if (this._globalized && this._globalVariable) {
			return this._globalVariable.value;
		} else if (this._value === null) {
			return new IntegerToken(0);
		}
		return this._value;
	}

	set value(newValue: IptToken | null) {
		if (this.external) {
			if (newValue) this.context.setExternalVariable(this._name, newValue);
		} else if (this._globalized && this._globalVariable) {
			if (newValue) this._globalVariable.value = newValue;
		} else if (newValue !== null) {
			this._value = newValue;
			this.initialized = true;
		}
	}

	override clone(): IptToken {
		const newVariable = new IptVariable(this.context, this._name, this._value);
		newVariable._globalized = this._globalized;
		newVariable._globalVariable = this._globalVariable;
		newVariable.initialized = this.initialized;
		return newVariable;
	}

	globalize(globalVariable: IptVariable): void {
		this._globalVariable = globalVariable;
		this._globalized = true;
	}

	override dereference(): IptToken {
		return this.value;
	}

	override toBoolean(): boolean {
		return this.dereference().toBoolean();
	}

	override toString(): string {
		let string = '[IptVariable ';
		if (this._globalized) {
			string += '(global) ';
		}
		string += `"${this._name}" ${this.value.toString()}]`;
		return string;
	}
}
