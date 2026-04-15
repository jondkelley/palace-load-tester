import { IptToken } from './IptToken.js';
import { IptError } from './IptError.js';
import { IptTokenList } from './IptTokenList.js';
import { IntegerToken } from './tokens/IntegerToken.js';
import { StringToken } from './tokens/StringToken.js';
import { ArrayMarkToken } from './tokens/ArrayMarkToken.js';
import { ArrayParseToken } from './tokens/ArrayParseToken.js';
import { VariableToken } from './tokens/VariableToken.js';
import { defaultCommands, type CommandConstructor } from './commands/defaultCommands.js';
import type { IptManager } from './IptManager.js';

// CharCode-indexed trie node for zero-overhead operator dispatch.
interface OperatorTrieNode {
	command?: CommandConstructor;
	children: (OperatorTrieNode | undefined)[];
}

export class IptParser {
	protected manager: IptManager;
	private commandList: Map<string, CommandConstructor>;
	private operatorTrie: OperatorTrieNode = { children: new Array(128) };
	private operatorStartSet: boolean[] = new Array(128).fill(false);
	private operatorTrieDirty = true;
	private script = '';
	private so = 0;
	private offset = 0;

	constructor(manager: IptManager, commandList?: Map<string, CommandConstructor>) {
		this.manager = manager;
		if (commandList) {
			this.commandList = commandList;
		} else {
			this.commandList = new Map();
			this.addDefaultCommands();
		}
	}

	getCommand(commandName: string): CommandConstructor | undefined {
		return this.commandList.get(commandName.toUpperCase());
	}

	getCommandNames(): string[] {
		return Array.from(this.commandList.keys());
	}

	addDefaultCommands(): void {
		this.addCommands(defaultCommands);
	}

	addCommands(commands: Record<string, CommandConstructor>): void {
		for (const [name, cls] of Object.entries(commands)) {
			this.addCommand(name, cls);
		}
	}

	addCommand(commandName: string, commandClass: CommandConstructor): void {
		const uc = commandName.toUpperCase();
		if (this.commandList.has(uc)) {
			throw new IptError(`Cannot add command. Command ${uc} already defined.`);
		}
		this.commandList.set(uc, commandClass);
		this.operatorTrieDirty = true;
	}

	removeCommand(commandName: string): void {
		const uc = commandName.toUpperCase();
		if (!this.commandList.has(uc)) {
			throw new IptError(`Cannot remove command. Command ${uc} doesn't exist.`);
		}
		this.commandList.delete(uc);
		this.operatorTrieDirty = true;
	}

	private buildOperatorTrie(): void {
		this.operatorTrie = { children: new Array(128) };
		this.operatorStartSet = new Array(128).fill(false);
		for (const [name, cls] of this.commandList) {
			if (name.length === 0) continue;
			const fc = name.charCodeAt(0);
			if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122) || fc === 95) continue;
			this.operatorStartSet[fc] = true;
			let node = this.operatorTrie;
			for (let i = 0; i < name.length; i++) {
				const cc = name.charCodeAt(i);
				if (!node.children[cc]) {
					node.children[cc] = { children: new Array(128) };
				}
				node = node.children[cc]!;
			}
			node.command = cls;
		}
		this.operatorTrieDirty = false;
	}

	private ensureOperatorTrie(): void {
		if (this.operatorTrieDirty) {
			this.buildOperatorTrie();
		}
	}

	private parseOperator(): IptToken {
		let node = this.operatorTrie;
		let lastMatch: CommandConstructor | undefined;
		let lastMatchPos = this.so;
		const script = this.script;
		const len = script.length;

		while (this.so < len) {
			const child = node.children[script.charCodeAt(this.so)];
			if (!child) break;
			node = child;
			this.so++;
			if (node.command) {
				lastMatch = node.command;
				lastMatchPos = this.so;
			}
		}

		if (!lastMatch) {
			throw new IptError(
				`Parse error: unknown operator at position ${this.offset}`,
				this.offset
			);
		}

		this.so = lastMatchPos;
		return new lastMatch();
	}

	tokenize(script: string, nestedCharCountOffset = 0): IptTokenList {
		this.script = script;
		this.so = 0;
		this.ensureOperatorTrie();
		const tokenList = new IptTokenList();
		const len = script.length;
		let arrayDepth = 0;

		while (this.so < len) {
			const cc = script.charCodeAt(this.so);
			this.offset = this.so;

			if (cc === 32 || cc === 9 || cc === 13 || cc === 10) { // space, tab, CR, LF
				this.so++;
			} else if (cc === 35 || cc === 59) { // # or ;
				this.so++;
				while (this.so < len) {
					const c = script.charCodeAt(this.so);
					if (c === 13 || c === 10) break;
					this.so++;
				}
			} else if (cc === 123) { // {
				tokenList.addToken(
					this.parseAtomList(nestedCharCountOffset),
					this.offset + nestedCharCountOffset
				);
			} else if (cc === 34) { // "
				tokenList.addToken(
					this.parseStringLiteral(),
					this.offset + nestedCharCountOffset
				);
			} else if (cc === 125) { // }
				throw new IptError(
					"Parse error: unexpected '}' encountered",
					this.offset + nestedCharCountOffset
				);
			} else if (cc === 91) { // [
				this.so++;
				arrayDepth++;
				tokenList.addToken(
					new ArrayMarkToken(),
					this.offset + nestedCharCountOffset
				);
			} else if (cc === 93) { // ]
				arrayDepth--;
				if (arrayDepth < 0) {
					throw new IptError(
						"Parse error: encountered a ']' without a matching '['.",
						this.offset + nestedCharCountOffset
					);
				}
				this.so++;
				tokenList.addToken(
					new ArrayParseToken(),
					this.offset + nestedCharCountOffset
				);
			} else if (cc === 45) { // -
				if (this.so + 1 < len && script.charCodeAt(this.so + 1) >= 48 && script.charCodeAt(this.so + 1) <= 57) {
					tokenList.addToken(
						this.parseNumber(),
						this.offset + nestedCharCountOffset
					);
				} else {
					tokenList.addToken(
						this.parseOperator(),
						this.offset + nestedCharCountOffset
					);
				}
			} else if (this.operatorStartSet[cc]) {
				tokenList.addToken(
					this.parseOperator(),
					this.offset + nestedCharCountOffset
				);
			} else if (cc >= 48 && cc <= 57) { // 0-9
				tokenList.addToken(
					this.parseNumber(),
					this.offset + nestedCharCountOffset
				);
			} else if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || cc === 95) { // A-Z, a-z, _
				tokenList.addToken(
					this.parseSymbol(),
					this.offset + nestedCharCountOffset
				);
			} else {
				console.log(`Parse error: Unexpected character, charcode: ${cc} -- '${String.fromCharCode(cc)}' at position ${this.offset + nestedCharCountOffset}`);
				this.so++;
			}
		}

		tokenList.sourceScript = script;
		tokenList.characterOffsetCompensation = nestedCharCountOffset;
		return tokenList;
	}

	private parseAtomList(runningOffset = 0): IptTokenList {
		const script = this.script;
		const len = script.length;
		let nest = 0;
		let qFlag = false;

		if (this.so < len && script.charCodeAt(this.so) === 123) { // {
			this.so++;
		}

		const startPos = this.so;

		while (this.so < len) {
			const cc = script.charCodeAt(this.so);
			if (cc === 0) break;

			if (qFlag) {
				if (cc === 92) { // backslash — skip escaped char
					this.so += 2;
					continue;
				}
				if (cc === 34) qFlag = false; // closing "
			} else {
				if (cc === 125 && nest === 0) break; // } at depth 0
				switch (cc) {
					case 35: case 59: // # or ; — comment
						this.so++;
						while (this.so < len) {
							const c = script.charCodeAt(this.so);
							if (c === 13 || c === 10) break;
							this.so++;
						}
						break;
					case 34: qFlag = true; break;  // "
					case 123: nest++; break;        // {
					case 125: nest--; break;        // }
				}
			}
			this.so++;
		}

		const atomListString = script.substring(startPos, this.so);

		if (this.so < len && script.charCodeAt(this.so) === 125) { // }
			this.so++;
		}
		if (qFlag) {
			throw new IptError('End of string not found.', this.so);
		}

		// Save context before parsing the inner block
		const savedSo = this.so;
		const savedScript = this.script;
		const savedOffset = this.offset;

		// Parse inner script block
		const tokenList = this.tokenize(atomListString, runningOffset + 1);

		// Restore parsing context back to the outer script
		this.script = savedScript;
		this.so = savedSo;
		this.offset = savedOffset;

		return tokenList;
	}

	private parseNumber(): IntegerToken {
		const script = this.script;
		const len = script.length;
		const start = this.so;

		if (script.charCodeAt(this.so) === 45) this.so++; // '-'

		while (this.so < len) {
			const cc = script.charCodeAt(this.so);
			if (cc < 48 || cc > 57) break; // not 0-9
			this.so++;
		}

		return new IntegerToken(parseInt(script.substring(start, this.so), 10));
	}

	private parseStringLiteral(): StringToken {
		const script = this.script;
		const len = script.length;
		this.so++; // skip opening "

		// Fast path: scan for closing " or escape backslash
		const start = this.so;
		while (this.so < len) {
			const cc = script.charCodeAt(this.so);
			if (cc === 34 || cc === 92) break; // " or backslash
			this.so++;
		}

		if (this.so >= len) {
			throw new IptError('End of string not found.', this.so);
		}

		// No escapes — return substring directly
		if (script.charCodeAt(this.so) === 34) { // "
			const result = script.substring(start, this.so);
			this.so++; // skip closing "
			return new StringToken(result);
		}

		// Slow path: escape sequences present
		let result = script.substring(start, this.so);
		while (this.so < len) {
			const cc = script.charCodeAt(this.so);
			if (cc === 34) { // closing "
				this.so++;
				return new StringToken(result);
			}
			if (cc === 92) { // backslash
				this.so++;
				if (this.so >= len) break;
				if (script.charCodeAt(this.so) === 120) { // 'x'
					let hexStr = '0x';
					this.so++;
					for (let i = 0; i < 2 && this.so < len; i++) {
						const hcc = script.charCodeAt(this.so);
						if ((hcc >= 48 && hcc <= 57) || (hcc >= 65 && hcc <= 70) || (hcc >= 97 && hcc <= 102)) {
							hexStr += script.charAt(this.so);
							this.so++;
						} else {
							break;
						}
					}
					// Windows-1252 single byte → character
					result += String.fromCharCode(parseInt(hexStr));
				} else {
					result += script.charAt(this.so);
					this.so++;
				}
			} else {
				// Batch-copy regular characters until next " or backslash
				const batchStart = this.so;
				this.so++;
				while (this.so < len) {
					const c = script.charCodeAt(this.so);
					if (c === 34 || c === 92) break;
					this.so++;
				}
				result += script.substring(batchStart, this.so);
			}
		}

		throw new IptError('End of string not found.', this.so);
	}

	parseSymbol(): IptToken {
		const script = this.script;
		const len = script.length;
		const start = this.so;

		while (this.so < len) {
			const cc = script.charCodeAt(this.so);
			if (!((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || cc === 95)) break;
			this.so++;
		}

		const token = script.substring(start, this.so).toUpperCase();
		const commandClass = this.commandList.get(token);
		if (commandClass) {
			return new commandClass();
		}

		return new VariableToken(token);
	}

	parseEventHandlers(script: string): Record<string, IptTokenList> {
		this.script = script;
		this.offset = this.so = 0;
		const handlers: Record<string, IptTokenList> = {};
		const len = script.length;

		while (this.so < len) {
			const cc = script.charCodeAt(this.so);

			if (cc === 32 || cc === 9 || cc === 13 || cc === 10) {
				this.so++;
			} else if (cc === 35 || cc === 59) { // # or ;
				this.so++;
				while (this.so < len) {
					const c = script.charCodeAt(this.so);
					if (c === 13 || c === 10) break;
					this.so++;
				}
			} else if (
				cc === 79 && // 'O'
				this.so + 2 < len &&
				script.charCodeAt(this.so + 1) === 78 // 'N'
			) {
				const wsCode = script.charCodeAt(this.so + 2);
				if (wsCode === 32 || wsCode === 9 || wsCode === 13 || wsCode === 10) {
					this.so += 3;

					// Grab handler name
					let handlerName = '';
					while (this.so < len) {
						const c2 = script.charCodeAt(this.so);
						if (c2 === 32 || c2 === 9 || c2 === 13 || c2 === 10) {
							this.so++;
						} else if (c2 === 35 || c2 === 59) { // comment
							this.so++;
							while (this.so < len) {
								const c3 = script.charCodeAt(this.so);
								if (c3 === 13 || c3 === 10) break;
								this.so++;
							}
						} else if (
							(c2 >= 65 && c2 <= 90) || (c2 >= 97 && c2 <= 122) ||
							(c2 >= 48 && c2 <= 57) || c2 === 95
						) {
							const nameStart = this.so;
							while (this.so < len) {
								const c3 = script.charCodeAt(this.so);
								if (!((c3 >= 65 && c3 <= 90) || (c3 >= 97 && c3 <= 122) || (c3 >= 48 && c3 <= 57) || c3 === 95)) break;
								this.so++;
							}
							handlerName = script.substring(nameStart, this.so);
							break;
						} else {
							this.so++;
						}
					}

					// Look for opening brace
					while (this.so < len) {
						const c2 = script.charCodeAt(this.so);
						if (c2 === 35 || c2 === 59) { // comment
							this.so++;
							while (this.so < len) {
								const c3 = script.charCodeAt(this.so);
								if (c3 === 13 || c3 === 10) break;
								this.so++;
							}
						}
						if (this.so < len && script.charCodeAt(this.so) === 123) { // {
							const tokenList = this.parseAtomList();
							handlers[handlerName] = tokenList;
							break;
						}
						this.so++;
					}
				} else {
					this.so++;
				}
			} else {
				this.so++;
			}
		}

		return handlers;
	}
}
