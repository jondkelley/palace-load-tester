import { IptCommand } from '../IptCommand.js';
import { IptError } from '../IptError.js';
import type { IptExecutionContext } from '../IptExecutionContext.js';
import { PalaceExecutionContext } from '../PalaceExecutionContext.js';
import { IptToken } from '../IptToken.js';
import { IptTokenList } from '../IptTokenList.js';
import { IptVariable } from '../IptVariable.js';
import { IptAlarm } from '../IptAlarm.js';
import { IntegerToken } from '../tokens/IntegerToken.js';
import { StringToken } from '../tokens/StringToken.js';
import { ArrayToken } from '../tokens/ArrayToken.js';
import { ArrayMarkToken } from '../tokens/ArrayMarkToken.js';
import { HashToken } from '../tokens/HashToken.js';

// ── Control Flow ──

export class IFCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const condition = context.stack.pop().dereference();
		const tokenList = context.stack.popType(IptTokenList);
		if (condition.toBoolean()) {
			tokenList.execute(context);
		}
	}
}

export class IFELSECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const condition = context.stack.pop().dereference();
		const falseClause = context.stack.popType(IptTokenList);
		const trueClause = context.stack.popType(IptTokenList);
		if (condition.toBoolean()) {
			trueClause.execute(context);
		} else {
			falseClause.execute(context);
		}
	}
}

export class WHILECommand extends IptCommand {
	private conditionTokenList!: IptTokenList;
	private executeTokenList!: IptTokenList;
	private _running = false;
	context!: IptExecutionContext;
	private checkingCondition = false;

	override get running(): boolean {
		return this._running;
	}

	override end(): void {
		this._running = false;
	}

	override step(): void {
		if (this.context.returnRequested || this.context.exitRequested) {
			this.end();
			return;
		}
		if (this.checkingCondition) {
			this.conditionTokenList.execute(this.context);
			this.checkingCondition = false;
		} else {
			let conditionResult: IptToken;
			try {
				conditionResult = this.context.stack.pop();
			} catch (e) {
				throw new IptError(
					'Unable to get result of condition clause from stack: ' + (e as Error).message
				);
			}
			if (!conditionResult.toBoolean() || this.context.breakRequested) {
				this.context.breakRequested = false;
				this.end();
				return;
			}
			this.checkingCondition = true;
			this.executeTokenList.execute(this.context);
		}
	}

	override execute(context: IptExecutionContext): void {
		this.context = context;
		context.manager.callStack.push(this);
		this._running = true;
		this.checkingCondition = true;
		this.conditionTokenList = context.stack.popType(IptTokenList);
		this.executeTokenList = context.stack.popType(IptTokenList);
		this.step();
	}
}

export class FOREACHCommand extends IptCommand {
	private array!: ArrayToken;
	private currentItemIndex = 0;
	private tokenList!: IptTokenList;
	context!: IptExecutionContext;
	private _running = false;

	override get running(): boolean {
		return this._running;
	}

	override end(): void {
		this._running = false;
	}

	override step(): void {
		if (
			this.context.returnRequested ||
			this.context.exitRequested ||
			this.context.breakRequested
		) {
			this.context.breakRequested = false;
			this.end();
			return;
		}
		if (this.currentItemIndex < this.array.data.length) {
			this.context.stack.push(this.array.data[this.currentItemIndex]);
			this.tokenList.execute(this.context);
			this.currentItemIndex++;
		} else {
			this.end();
		}
	}

	override execute(context: IptExecutionContext): void {
		this.context = context;
		context.manager.callStack.push(this);
		this._running = true;
		this.array = context.stack.popType(ArrayToken);
		this.tokenList = context.stack.popType(IptTokenList);
		this.currentItemIndex = 0;
		this.step();
	}
}

export class EXECCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const tokenList = context.stack.pop().dereference();
		if (tokenList instanceof IntegerToken && tokenList.data === 0) {
			return;
		}
		if (tokenList instanceof IptTokenList) {
			tokenList.execute(context);
		} else {
			throw new IptError(`Expected an IptTokenList object. Got a ${tokenList.constructor.name}`);
		}
	}
}

export class BREAKCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.breakRequested = true;
	}
}

export class RETURNCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.returnRequested = true;
	}
}

export class EXITCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.exitRequested = true;
	}
}

// ── Stack Operations ──

export class DUPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.duplicate();
	}
}

export class POPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.pop();
	}
}

export class SWAPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const token1 = context.stack.pop();
		const token2 = context.stack.pop();
		context.stack.push(token1);
		context.stack.push(token2);
	}
}

export class OVERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(context.stack.pick(1));
	}
}

export class PICKCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const pickDepth = context.stack.popType(IntegerToken);
		const token = context.stack.pick(pickDepth.data);
		context.stack.push(token);
	}
}

export class STACKDEPTHCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(context.stack.depth));
	}
}

// ── Variable Operations ──

export class GLOBALCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const globalVariable = context.manager.globalVariableStore.getVariable(variable.name);
		if (variable.initialized) {
			globalVariable.value = variable.value;
		}
		variable.globalize(globalVariable);
	}
}

// ── Type Inspection ──

export class TOPTYPECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (context.stack.depth === 0) {
			context.stack.push(IntegerToken.ZERO);
			return;
		}
		const token = context.stack.pick(0);
		if (token instanceof IntegerToken) {
			context.stack.push(IntegerToken.ONE);
		} else if (token instanceof IptVariable) {
			context.stack.push(new IntegerToken(2));
		} else if (token instanceof IptTokenList) {
			context.stack.push(new IntegerToken(3));
		} else if (token instanceof StringToken) {
			context.stack.push(new IntegerToken(4));
		} else if (token instanceof ArrayMarkToken) {
			context.stack.push(new IntegerToken(5));
		} else if (token instanceof ArrayToken) {
			context.stack.push(new IntegerToken(6));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class VARTYPECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (context.stack.depth === 0) {
			context.stack.push(IntegerToken.ZERO);
			return;
		}
		const token = context.stack.pick(0).dereference();
		if (token instanceof IntegerToken) {
			context.stack.push(IntegerToken.ONE);
		} else if (token instanceof IptVariable) {
			context.stack.push(new IntegerToken(2));
		} else if (token instanceof IptTokenList) {
			context.stack.push(new IntegerToken(3));
		} else if (token instanceof StringToken) {
			context.stack.push(new IntegerToken(4));
		} else if (token instanceof ArrayMarkToken) {
			context.stack.push(new IntegerToken(5));
		} else if (token instanceof ArrayToken) {
			context.stack.push(new IntegerToken(6));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

// ── String Operations ──

export class ATOICommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const a1 = context.stack.popType(StringToken);
		context.stack.push(new IntegerToken(parseInt(a1.data, 10) || 0));
	}
}

export class ITOACommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const integerInput = context.stack.popType(IntegerToken);
		context.stack.push(new StringToken(integerInput.data.toString()));
	}
}

export class STRLENCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const string = context.stack.popType(StringToken);
		context.stack.push(new IntegerToken(string.data.length));
	}
}

export class STRINDEXCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const string2 = context.stack.popType(StringToken);
		const string1 = context.stack.popType(StringToken);
		context.stack.push(new IntegerToken(string1.data.indexOf(string2.data)));
	}
}

export class SUBSTRCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const fragment = context.stack.popType(StringToken);
		const whole = context.stack.popType(StringToken);
		context.stack.push(
			whole.data.toLowerCase().indexOf(fragment.data.toLowerCase()) !== -1 ? IntegerToken.ONE : IntegerToken.ZERO
		);
	}
}

export class SUBSTRINGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const length = context.stack.popType(IntegerToken);
		const offset = context.stack.popType(IntegerToken);
		const string = context.stack.popType(StringToken);
		if (offset.data < 0) {
			throw new IptError('Offset cannot be negative.');
		}
		context.stack.push(new StringToken(string.data.substr(offset.data, length.data)));
	}
}

export class LOWERCASECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const string = context.stack.popType(StringToken);
		context.stack.push(new StringToken(string.data.toLowerCase()));
	}
}

export class UPPERCASECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const string = context.stack.popType(StringToken);
		context.stack.push(new StringToken(string.data.toUpperCase()));
	}
}

export class STRTOATOMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const stringToken = context.stack.popType(StringToken);
		const tokenList = context.manager.parser.tokenize(
			stringToken.data,
			stringToken.scriptCharacterOffset + 1
		);
		context.stack.push(tokenList);
	}
}

// ── Regex Operations ──
export class REGEXPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const pattern = context.stack.popType(StringToken);
		const source = context.stack.popType(StringToken);
		context.manager.grepMatchData = null;
		try {
			const re = new RegExp(pattern.data, 's');
			context.manager.grepMatchData = source.data.match(re);
			context.stack.push(context.manager.grepMatchData ? IntegerToken.ONE : IntegerToken.ZERO);
		} catch {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class GREPSTRCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const pattern = context.stack.popType(StringToken);
		const stringToSearch = context.stack.popType(StringToken);
		context.manager.grepMatchData = null;

		// Backwards-compatibility filtering (matches original PalaceChat behavior)
		let p = pattern.data;
		p = p.replace(/\[([^]*?)\\([^]*?)\]/g, '[$1\\\\$2]'); // escape backslashes inside []
		p = p.replace(/\|/g, '\\|');                          // escape |
		p = p.replace(/\?/g, '\\?');                          // escape ?

		let grepPattern: RegExp;
		try {
			grepPattern = new RegExp(p, 's');
		} catch {
			throw new IptError(`Bad GREPSTR Pattern: ${pattern.data}`);
		}
		context.manager.grepMatchData = stringToSearch.data.match(grepPattern);
		context.stack.push(
			context.manager.grepMatchData === null ? IntegerToken.ZERO : IntegerToken.ONE
		);
	}
}

export class GREPSUBCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const sourceString = context.stack.popType(StringToken);
		const matchdata = context.manager.grepMatchData;
		let result = sourceString.data;
		if (matchdata) {
			for (let i = 0; i < matchdata.length; i++) {
				const regexp = new RegExp('\\$' + i.toString(), 'g');
				result = result.replace(regexp, matchdata[i]);
			}
		}
		context.stack.push(new StringToken(result));
	}
}

// ── Array Operations ──

export class ARRAYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const itemCount = context.stack.popType(IntegerToken);
		if (itemCount.data >= 0) {
			const array = new ArrayToken();
			for (let i = 0; i < itemCount.data; i++) {
				array.data.push(new IntegerToken(0));
			}
			context.stack.push(array);
		} else {
			context.stack.push(new IntegerToken(0));
		}
	}
}

export class GETCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const key = context.stack.pop().dereference();
		const collection = context.stack.pop().dereference();
		if (collection instanceof ArrayToken) {
			if (!(key instanceof IntegerToken)) {
				throw new IptError(`Expected IntegerToken element since an ArrayToken was passed. Got ${key.constructor.name} element instead.`);
			}
			const index = key.data;
			if (index > collection.data.length - 1 || index < 0) {
				throw new IptError(
					`Attempted to fetch nonexistant array item at index ${index}.`
				);
			}
			let element: IptToken = collection.data[index];
			if (element instanceof HashToken) element = element.clone();
			context.stack.push(element);
		} else if (collection instanceof HashToken) {
			let k: string;
			if (key instanceof StringToken) {
				k = key.data;
			} else if (key instanceof IntegerToken) {
				k = String(key.data);
			} else {
				throw new IptError(`Expected StringToken or IntegerToken element. Got ${key.constructor.name} element instead.`);
			}
			const value = collection.data.get(k);
			if (value === undefined) {
				context.stack.push(new IntegerToken(0));
			} else {
				context.stack.push(value instanceof HashToken ? value.clone() : value);
			}
		} else {
			throw new IptError(`Expected ArrayToken or HashToken element. Got ${collection.constructor.name} element instead.`);
		}
	}
}

export class PUTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const key = context.stack.pop().dereference();
		const collection = context.stack.pop().dereference();
		const data = context.stack.pop().dereference();
		
		if (collection instanceof ArrayToken) {
			if (!(key instanceof IntegerToken)) {
				throw new IptError(`Expected IntegerToken element since an ArrayToken was passed. Got ${key.constructor.name} element instead.`);
			}
			const index = key.data;
			if (index >= 0 && index < collection.data.length) {
				collection.data[index] = data;
			} else {
				throw new IptError(`Array index ${index} out of range`);
			}
		} else if (collection instanceof HashToken) {
			let vKey: string;
			if (key instanceof IntegerToken) {
				vKey = String(key.data);
			} else if (key instanceof StringToken) {
				vKey = key.data;
			} else {
				throw new IptError(`Expected IntegerToken or StringToken element since a HashToken was passed. Got ${key.constructor.name} element instead.`);
			}
			if (data instanceof IntegerToken && data.data === 0 && collection.data.has(vKey)) {
				collection.data.delete(vKey);
			} else {
				collection.data.set(vKey, data);
			}
		} else {
			throw new IptError(`Expected ArrayToken or HashToken element. Got ${collection.constructor.name} element instead.`);
		}
	}
}

export class LENGTHCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const collection = context.stack.pop().dereference();
		if (collection instanceof ArrayToken) {
			context.stack.push(new IntegerToken(collection.data.length));
		} else if (collection instanceof HashToken) {
			context.stack.push(new IntegerToken(collection.data.size));
		} else {
			throw new IptError('LENGTH requires an ArrayToken or HashToken.');
		}
	}
}

// ── Math Operations ──

export class RANDOMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const number = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken((Math.random() * number.data) | 0));
	}
}

export class COSINECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const degrees = context.stack.popType(IntegerToken);
		const radians = (degrees.data * Math.PI) / 180;
		context.stack.push(new IntegerToken(Math.round(Math.cos(radians) * 1000)));
	}
}

export class SINECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const degrees = context.stack.popType(IntegerToken);
		const radians = (degrees.data * Math.PI) / 180;
		context.stack.push(new IntegerToken(Math.round(Math.sin(radians) * 1000)));
	}
}

export class TANGENTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const degrees = context.stack.popType(IntegerToken);
		const radians = (degrees.data * Math.PI) / 180;
		context.stack.push(new IntegerToken(Math.round(Math.tan(radians) * 1000)));
	}
}

// ── Time Operations ──

export class TICKSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(((Date.now() / 17) % 0x4f1a00) | 0));
	}
}

export class DATETIMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken((Date.now() / 1000) | 0));
	}
}

// ── Timer Operations ──

export class ALARMEXECCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const delayTicks = context.stack.popType(IntegerToken);
		const tokenList = context.stack.popType(IptTokenList);
		const alarm = new IptAlarm(tokenList, context.manager, delayTicks.data);
		if (context instanceof PalaceExecutionContext) {
			(alarm.context as PalaceExecutionContext).hotspotId = context.hotspotId;
			if (context.hotspotId === -999) alarm.isCyborg = true;
		}
		context.manager.addAlarm(alarm);
	}
}

export class DELAYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.popType(IntegerToken); // consume ticks, do nothing
	}
}

// ── Debug / Trace Operations ──

export class TRACECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const token = context.stack.popType(StringToken);
		context.manager.traceMessage(token.data);
	}
}

export class TRACESTACKCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		while (context.stack.depth > 0) {
			context.manager.traceMessage(context.stack.pop().toString());
		}
	}
}

export class BREAKPOINTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.manager.pause();
	}
}

// ── Misc ──

export class BEEPCommand extends IptCommand {
	// do nothing
}

export class IPTVERSIONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(IntegerToken.ONE);
	}
}
