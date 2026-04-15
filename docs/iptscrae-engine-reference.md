# OpenPalace Iptscrae Engine - Complete Source Reference

**Source Repository:** [theturtle32/OpenPalace](https://github.com/theturtle32/OpenPalace) (ActionScript 3.0)

## Architecture Overview

The Iptscrae engine is a **stack-based scripting language interpreter** (Forth-like/PostScript-like) using the **Command pattern**. Scripts use reverse-polish notation (RPN):

```
{ condition } { body } WHILE
{ body } condition IF
"hello" SAY
10 20 + ITOA SAY   ; pushes 10, pushes 20, adds them, converts to string, says "30"
```

### Key Design Patterns
- **Stack machine**: All operations push/pop from a central stack
- **Command pattern**: Each Iptscrae command = one class extending `IptCommand`
- **Interpreter pattern**: Scripts are tokenized into `IptTokenList` objects, then executed step-by-step
- **Pseudo-threading**: Execution yields after N steps (default 800) via `setTimeout`, preventing UI blocking
- **Event-driven**: Scripts are triggered by Palace events (INCHAT, ENTER, SELECT, etc.)
- **Variable scoping**: Local variables per execution context, with `GLOBAL` command for shared state

### Execution Flow
1. `IptParser.tokenize(script)` → `IptTokenList` (list of `IptToken` objects)
2. `IptTokenList.execute(context)` → pushes self onto `IptManager.callStack`
3. `IptManager.run()` → loops calling `step()` up to 800 times, then yields via `setTimeout`
4. Each `step()` processes one token: if it's an `IptCommand`, calls `.execute(context)`; otherwise pushes literal onto stack

---

## CORE ENGINE FILES

### IptConstants.as
```actionscript
package org.openpalace.iptscrae
{
    public final class IptConstants
    {
        public static const STACK_DEPTH:uint = 2048;
        public static const RECURSION_LIMIT:uint = 256;
        public static const ENABLE_DEBUGGING:Boolean = false;
    }
}
```

### Runnable.as (Interface)
```actionscript
package org.openpalace.iptscrae
{
    public interface Runnable
    {
        function execute(context:IptExecutionContext):void;
        function step():void;
        function end():void;
        function get running():Boolean;
        function toString():String;
    }
}
```

### IIptManager.as (Interface)
```actionscript
package org.openpalace.iptscrae
{
    public interface IIptManager
    {
        function execute(script:String):void;
        function executeWithContext(script:String, context:IptExecutionContext):void;
        function get currentRunnableItem():Runnable;
        function step():void;
        function addAlarm(alarm:IptAlarm):void;
        function removeAlarm(alarm:IptAlarm):void;
        function clearAlarms():void;
    }
}
```

### IIptVariable.as (Interface)
```actionscript
package org.openpalace.iptscrae
{
    public interface IIptVariable
    {
        function globalize(globalVariable:IptVariable):void;
        function set value(value:IptToken):void;
        function get value():IptToken;
    }
}
```

### IptError.as
```actionscript
package org.openpalace.iptscrae
{
    public class IptError extends Error
    {
        public var characterOffset:int;
        
        public function IptError(message:String, characterOffset:int = -1, id:*=0)
        {
            super(message, id);
            this.characterOffset = characterOffset;
        }
    }
}
```

### IptUtil.as
```actionscript
package org.openpalace.iptscrae
{
    import flash.utils.getQualifiedClassName;

    public class IptUtil
    {
        public static function className(o:Object):String
        {
            var fullClassName:String = getQualifiedClassName(o);
            return fullClassName.slice(fullClassName.lastIndexOf("::") + 2);
        }
    }
}
```

### IptEngineEvent.as
```actionscript
package org.openpalace.iptscrae
{
    import flash.events.Event;
    
    public class IptEngineEvent extends Event
    {
        public static const TRACE:String = "trace";
        public static const PAUSE:String = "pause";
        public static const RESUME:String = "resume";
        public static const ABORT:String = "abort";
        public static const START:String = "start";
        public static const FINISH:String = "finish";
        public static const ALARM:String = "alarm";
        
        public var message:String;
        
        public function IptEngineEvent(type:String, bubbles:Boolean=false, cancelable:Boolean=false)
        {
            super(type, bubbles, cancelable);
        }
    }
}
```

### IptToken.as (Base Token)
```actionscript
package org.openpalace.iptscrae
{
    import flash.events.EventDispatcher;

    public class IptToken extends EventDispatcher
    {
        public var scriptCharacterOffset:int;
        
        public function IptToken(characterOffset:int = -1)
        {
            scriptCharacterOffset = characterOffset;
        }
        
        public function clone():IptToken {
            return new IptToken();
        }
        
        public function toBoolean():Boolean {
            return true;
        }
        
        public function dereference():IptToken {
            return this;
        }
        
        override public function toString():String {
            return "[" + IptUtil.className(this) + "]";
        }
    }
}
```

### IptCommand.as (Base Command)
```actionscript
package org.openpalace.iptscrae
{
    public class IptCommand extends IptToken implements Runnable
    {
        public function IptCommand(characterOffset:int = -1)
        {
            super(characterOffset);
        }
        
        public function execute(context:IptExecutionContext):void
        {
        }
        
        override public function clone():IptToken {
            throw new IptError("You cannot clone a command token.");
        }
        
        public function get running():Boolean {
            return false;
        }
        
        public function step():void {
        }
        
        public function end():void {
        }
    }
}
```

### IptVariable.as
```actionscript
package org.openpalace.iptscrae
{
    import org.openpalace.iptscrae.token.IntegerToken;

    public class IptVariable extends IptToken implements IIptVariable
    {
        private var _value:IptToken;
        private var _name:String;
        private var context:IptExecutionContext;
        private var _globalized:Boolean;
        private var _globalVariable:IptVariable;
        public var initialized:Boolean = false;
        public var external:Boolean = false;
        
        public function IptVariable(context:IptExecutionContext, name:String, value:IptToken=null)
        {
            super();
            this.context = context;
            this._name = name;
            this.value = value;
        }
        
        public function get name():String { 
            return _name;
        }
        
        public function get value():IptToken {
            if (external) {
                return context.getExternalVariable(_name); 
            }
            else if (_globalized) {
                return _globalVariable.value;
            }
            else if (_value == null) {
                return new IntegerToken(0);
            }
            return _value;
        }
        
        public function set value(newValue:IptToken):void {
            if (external) {
                context.setExternalVariable(name, newValue);
            }
            else if (_globalized) {
                _globalVariable.value = newValue;
            }
            else if (newValue != null) {
                _value = newValue;
                initialized = true;
            }
        }
        
        override public function clone():IptToken {
            var newVariable:IptVariable = new IptVariable(context, _name, _value);
            newVariable._globalized = _globalized;
            newVariable._globalVariable = _globalVariable;
            newVariable.initialized = initialized;
            return newVariable;
        }
        
        public function globalize(globalVariable:IptVariable):void {
            _globalVariable = globalVariable;
            _globalized = true;
        }
        
        override public function dereference():IptToken {
            return value;
        }
        
        override public function toBoolean():Boolean {
            return dereference().toBoolean();
        }
        
        override public function toString():String {
            var string:String = "[IptVariable ";
            if (_globalized) {
                string += "(global) ";
            }
            string += "\"" + name + "\" " + value.toString() + "]";
            return string;
        }
    }
}
```

### IptVariableStore.as
```actionscript
package org.openpalace.iptscrae
{
    import flash.utils.Dictionary;
    import org.openpalace.iptscrae.token.IntegerToken;

    public class IptVariableStore
    {
        internal var variables:Dictionary;
        private var context:IptExecutionContext;
        
        public function IptVariableStore(context:IptExecutionContext)
        {
            variables = new Dictionary();
            this.context = context;
        }
        
        public function getVariable(variableName:String):IptVariable {
            var ucVariableName:String = variableName.toUpperCase();
            var variable:IptVariable = variables[ucVariableName];
            if (variable == null) {
                variable = new IptVariable(context, ucVariableName);
                if (context.isExternalVariable(ucVariableName)) {
                    variable.external = true;
                }
                variables[ucVariableName] = variable;
            }
            return variable;
        }
    }
}
```

### IptTokenStack.as
```actionscript
package org.openpalace.iptscrae
{
    public class IptTokenStack
    {
        public var stack:Vector.<IptToken>;
        
        public function IptTokenStack()
        {
            stack = new Vector.<IptToken>();
        }

        public function get depth():uint {
            return stack.length;
        }
        
        public function popType(requestedType:Class):* {
            var token:IptToken = pop();
            if (token is IptVariable && requestedType != IptVariable) {
                token = token.dereference();
            }
            if (token is requestedType) {
                return token;
            }
            else {
                throw new IptError("Expected " + IptUtil.className(requestedType) +
                    " element.  Got " + IptUtil.className(token) + " element instead.");
            }
        }
        
        public function pop():IptToken {
            var token:IptToken;
            if (stack.length == 0) {
                throw new IptError("Cannot pop from an empty stack.");
            }
            try {
                token = stack.pop();
            }
            catch (e:Error) {
                throw new IptError(e.message);
            }
            return token;
        }
        
        public function push(token:IptToken):void {
            if (stack.length == IptConstants.STACK_DEPTH) {
                throw new IptError("Stack depth of " + IptConstants.STACK_DEPTH + " exceeded.");
            }
            try {
                stack.push(token);
            }
            catch (e:Error) {
                throw new IptError("Unable to push element onto the stack:" + e.message);
            }
        }
        
        public function pick(position:uint):IptToken {
            if (position > stack.length-1) {
                throw new IptError("You requested element #" + position +
                    " from the top of the stack, but there are only " + depth +
                    " element(s) available.");
            }
            var token:IptToken;
            try {
                token = stack[stack.length - 1 - position];
            }
            catch (e:Error) {
                throw new IptError("Unable to pick element " + position.toString() +
                    " from the stack: " + e.message);
            }
            return token;
        }
        
        public function duplicate():void {
            try {
                push(pick(0));
            }
            catch (e:Error) {
                throw new IptError(e.message);
            }
        }
    }
}
```

### IptExecutionContext.as
```actionscript
package org.openpalace.iptscrae
{
    public class IptExecutionContext
    {
        public var manager:IptManager;
        public var data:Object;
        public var stack:IptTokenStack;
        public var variableStore:IptVariableStore;
        
        public var breakRequested:Boolean = false;
        public var returnRequested:Boolean = false;
        public var exitRequested:Boolean = false;
        
        public function resetExecutionControls():void {
            breakRequested = returnRequested = exitRequested = false;
        }
        
        public function IptExecutionContext(manager:IptManager,
            stack:IptTokenStack = null, variableStore:IptVariableStore = null)
        {
            if (stack == null) {
                stack = new IptTokenStack();
            }
            if (variableStore == null) {
                variableStore = new IptVariableStore(this);
            }
            data = {};
            this.manager = manager;
            this.stack = stack;
            this.variableStore = variableStore;
        }
        
        public function isExternalVariable(name:String):Boolean {
            return false;
        }
        
        public function setExternalVariable(name:String, value:IptToken):void {
        }
        
        public function getExternalVariable(name:String):IptToken {
            return new IptToken();
        }
        
        public function clone():IptExecutionContext {
            var context:IptExecutionContext = new IptExecutionContext(manager, stack, variableStore);
            return context;
        }
    }
}
```

### IptTokenList.as
```actionscript
package org.openpalace.iptscrae
{
    [Event(name="finish", type="org.openpalace.iptscrae.IptEngineEvent")]
    public class IptTokenList extends IptToken implements Runnable
    {
        public var sourceScript:String;
        public var characterOffsetCompensation:int = 0;
        protected var _running:Boolean = false;
        public var context:IptExecutionContext;
        internal var tokenList:Vector.<IptToken>;
        internal var position:uint = 0;
        
        public function IptTokenList(tokenList:Vector.<IptToken> = null)
        {
            super();
            if (tokenList == null) {
                this.tokenList = new Vector.<IptToken>();
            } else {
                this.tokenList = tokenList;
            }
        }
        
        public function set running(newValue:Boolean):void { _running = newValue; }
        public function get running():Boolean { return _running; }
        
        public function reset():void {
            position = 0;
            _running = true;
        }
        
        public function getCurrentToken():IptToken {
            if (position < tokenList.length) {
                return tokenList[position];
            }
            return null;
        }
        
        public function getNextToken():IptToken {
            if (position >= tokenList.length) {
                throw new IptError("Read past end of tokenlist.");
            }
            if (tokenList.length == 0) {
                throw new IptError("No tokens to read.");
            }
            var token:IptToken;
            try {
                token = tokenList[position++];
            }
            catch (e:Error) {
                throw new IptError("Unable to get token: " + e.message);
            }
            return token;
        }
        
        public function get tokensAvailable():Boolean {
            return Boolean(position < tokenList.length);
        }
        
        public function get length():uint { return tokenList.length; }
        
        public function addToken(token:IptToken, characterOffset:int = -1):void {
            token.scriptCharacterOffset = characterOffset;
            tokenList.push(token);
        }
        
        public function popToken():IptToken {
            var token:IptToken;
            try {
                token = tokenList.pop();
            }
            catch (e:Error) {
                throw new IptError("Unable to pop token: " + e.message);
            }
            return token;
        }
        
        public override function clone():IptToken {
            var newTokenList:IptTokenList = new IptTokenList(tokenList);
            newTokenList.sourceScript = sourceScript;
            newTokenList.scriptCharacterOffset = scriptCharacterOffset;
            return newTokenList;
        }

        public function execute(context:IptExecutionContext):void {
            this.context = context;
            if (context.manager.callStack.length > IptConstants.RECURSION_LIMIT) {
                throw new IptError("Max call stack depth of " +
                    IptConstants.RECURSION_LIMIT + " exceeded.");
            }
            reset();
            context.manager.callStack.push(this);
        }
        
        public function end():void {
            _running = false;
            dispatchEvent(new IptEngineEvent(IptEngineEvent.FINISH));
        }
        
        public function step():void {
            if (tokensAvailable) {
                if (context.returnRequested) {
                    context.returnRequested = false;
                    end();
                    return;
                }
                if (context.exitRequested || context.breakRequested) {
                    end();
                    return;
                }
                
                // Process next token...
                var token:IptToken = getNextToken();
                if (token is IptCommand) {
                    try {
                        IptCommand(token).execute(context);
                    }
                    catch (e:IptError) {
                        var offsetToReport:int = (e.characterOffset == -1) ?
                                token.scriptCharacterOffset :
                                e.characterOffset;
                        end();
                        throw new IptError("  " + IptUtil.className(token) +
                            ":\n" + e.message, offsetToReport);
                    }
                }
                else if (token is IptTokenList) {
                    // prevents errant FINISH events firing when a
                    // tokenlist is executed recursively.
                    context.stack.push(IptTokenList(token).clone());
                }
                else {
                    context.stack.push(token);
                }
            }
            else {
                end();
            }
        }
        
        override public function toString():String {
            var string:String = "[IptTokenList {";
            var snippet:String = sourceScript.replace(/[\r\n]/g, " ");
            if (snippet.length > 20) {
                snippet = snippet.substr(0, 20) + "...";
            }
            string += (snippet + "}]");
            return string;
        }
    }
}
```

### IptParser.as (Tokenizer/Parser)
```actionscript
package org.openpalace.iptscrae
{
    import flash.utils.ByteArray;
    
    import org.openpalace.iptscrae.token.ArrayMarkToken;
    import org.openpalace.iptscrae.token.ArrayParseToken;
    import org.openpalace.iptscrae.token.IntegerToken;
    import org.openpalace.iptscrae.token.StringToken;
    import org.openpalace.iptscrae.token.VariableToken;

    public class IptParser
    {
        private var manager:IptManager;
        private var commandList:Object;
        private var script:String;
        private var so:uint;       // scan offset (current position)
        private var offset:int;    // saved offset for token start
        
        private var whiteSpaceTest:RegExp = /^[\s\r\n]{1}$/;
        private var hexNumberTest:RegExp = /^[0-9a-fA-F]{1}$/;
        private var tokenTest:RegExp = /^[a-zA-Z0-9_]{1}$/;
        
        public function IptParser(manager:IptManager, commandList:Object = null) {
            this.manager = manager;
            if (commandList == null) {
                this.commandList = {};
                addDefaultCommands();
            } else {
                this.commandList = commandList;
            }
        }
        
        public function getCommand(commandName:String):Class {
            return commandList[commandName.toUpperCase()];
        }
        
        public function addDefaultCommands():void {
            addCommands(IptDefaultCommands.commands);
        }
        
        public function addCommands(commands:Object):void {
            for (var commandName:String in commands) {
                addCommand(commandName, commands[commandName]);
            }
        }
        
        public function addCommand(commandName:String, commandClass:Class):void {
            var ucCommandName:String = commandName.toUpperCase();
            if (commandList[ucCommandName] != null) {
                throw new IptError("Cannot add command. Command " +
                    ucCommandName + " already defined.");
            }
            commandList[commandName.toUpperCase()] = commandClass;
        }
        
        public function removeCommand(commandName:String):void {
            var ucCommandName:String = commandName.toUpperCase();
            if (commandList[ucCommandName] == null) {
                throw new IptError("Cannot remove command. Command " +
                    ucCommandName + " doesn't exist.");
            }
            delete commandList[commandName.toUpperCase()];
        }
        
        public function currentChar():String { 
            return sc(0);
        }
        
        public function sc(offset:int):String {
            var pos:int = so + offset;
            if (pos < 0 || pos >= script.length)
                return null;
            else
                return script.charAt(pos);
        }
        
        public function tokenize(script:String, nestedCharCountOffset:int = 0):IptTokenList {
            this.script = script;
            so = 0;
            var tokenList:IptTokenList = new IptTokenList();
            var char:String;
            var arrayDepth:int = 0;
            
            while ((char = currentChar()) != null && char.charCodeAt(0) != 0) { 
                offset = so;
                
                if (char == " " || char == "\t" || char == "\r" || char == "\n") {
                    so++;
                }
                    
                else if (char == '#' || char == ";") {
                    // Comments: skip to end of line
                    while ((char = currentChar()) != null && char != '\r' && char != '\n') {
                        so++;
                    }
                }
                
                else if (char == '{') {
                    // Atom list (code block)
                    tokenList.addToken(parseAtomList(nestedCharCountOffset),
                        offset + nestedCharCountOffset);
                }
                    
                else if (char == '"') {
                    // String literal
                    tokenList.addToken(parseStringLiteral(),
                        offset + nestedCharCountOffset);
                }
                    
                else {
                    if (char == '}') {
                        throw new IptError("Parse error: unexpected '}' encountered",
                            offset + nestedCharCountOffset);
                    }
                    if (char == '[') {
                        so++;
                        arrayDepth++;
                        tokenList.addToken(new ArrayMarkToken(),
                            offset + nestedCharCountOffset);
                    }
                    else if (char == ']') {
                        arrayDepth--;
                        if (arrayDepth < 0) {
                            throw new IptError(
                                "Parse error: encountered a ']' without a matching '['.",
                                offset + nestedCharCountOffset);
                        }
                        so++;
                        tokenList.addToken(new ArrayParseToken(),
                            offset + nestedCharCountOffset);
                    }
                    else if (char == '!') {
                        if (sc(1) == '=') {
                            tokenList.addToken(new (getCommand("!="))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else {
                            tokenList.addToken(new (getCommand("!"))(),
                                offset + nestedCharCountOffset);
                            so++;
                        }
                    }
                    else if (char == '=') {
                        if (sc(1) == '=') {
                            tokenList.addToken(new (getCommand("=="))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else {
                            tokenList.addToken(new (getCommand("="))(),
                                offset + nestedCharCountOffset);
                            so++;
                        }
                    }
                    else if (char == '+') {
                        if (sc(1) == '+') {
                            tokenList.addToken(new (getCommand("++"))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else if (sc(1) == '=') {
                            tokenList.addToken(new (getCommand("+="))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else {
                            tokenList.addToken(new (getCommand("+"))(),
                                offset + nestedCharCountOffset);
                            so++;
                        }
                    }
                    else if (char == '-' && (sc(1) < '0' || sc(1) > '9')) {
                        if (sc(1) == '-') {
                            tokenList.addToken(new (getCommand("--"))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else if (sc(1) == '=') {
                            tokenList.addToken(new (getCommand("-="))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else {
                            tokenList.addToken(new (getCommand("-"))(),
                                offset + nestedCharCountOffset);
                            so++;
                        }
                    }
                    else if (char == '<') {
                        if (sc(1) == '>') {
                            tokenList.addToken(new (getCommand("<>"))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else if (sc(1) == '=') {
                            tokenList.addToken(new (getCommand("<="))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else {
                            tokenList.addToken(new (getCommand("<"))(),
                                offset + nestedCharCountOffset);
                            so++;
                        }
                    }
                    else if (char == '>') {
                        if (sc(1) == "=") {
                            tokenList.addToken(new (getCommand(">="))(),
                                offset + nestedCharCountOffset);
                            so += 2;
                        } else {
                            tokenList.addToken(new (getCommand(">"))(),
                                offset + nestedCharCountOffset);
                            so++;
                        }
                    }
                    else if (char == '*' || char == '/' || char == '&' || char == '%') {
                        var operator:String = char;
                        if (sc(1) == '=') {
                            operator += "=";
                            so++;
                        }
                        tokenList.addToken(new (getCommand(operator))(),
                            offset + nestedCharCountOffset);
                        so++;
                    }
                    else if (char == '-' || char >= '0' && char <= '9') {
                        tokenList.addToken(parseNumber(),
                            offset + nestedCharCountOffset);
                    }
                    else if (char == '_' || char >= 'a' && char <= 'z' ||
                             char >= 'A' && char <= 'Z') {
                        tokenList.addToken(parseSymbol(),
                            offset + nestedCharCountOffset);
                    }
                    else {
                        throw new IptError("Parse error: Unexpected character, charcode: " +
                            char.charCodeAt(0) + " -- '" + char + "'",
                            offset + nestedCharCountOffset);
                    }
                }
            }
            tokenList.sourceScript = script;
            tokenList.characterOffsetCompensation = nestedCharCountOffset;
            return tokenList;
        }
        
        private function parseAtomList(runningOffset:int = 0):IptTokenList {
            var nest:int = 0;
            var quotnest:int = 0;
            var qFlag:Boolean = false;
            var atomListString:String = "";
            var char:String;
            
            if (currentChar() == '{') {
                so++;
            }
            
            while (currentChar() != null && currentChar().charCodeAt(0) != 0 &&
                   (currentChar() != '}' || nest > 0 || qFlag)) 
            {
                if (qFlag) {
                    if (currentChar() == '\\') {
                        atomListString += currentChar();
                        so++;
                    }
                    else if (currentChar() == '"') {
                        qFlag = false;
                    }
                }
                else {
                    switch (currentChar()) {
                        case ";":
                        case "#":
                            while ((char = currentChar()) != null &&
                                   char != '\r' && char != '\n') {
                                atomListString += char;
                                so++;
                            }
                            break;
                        case "\"":
                            qFlag = true;
                            break;
                        case "{":
                            nest++;
                            break;
                        case "}":
                            nest--;
                            break;
                    }
                }
                atomListString += currentChar();
                so++;
            }
            if (currentChar() == '}') {
                so++;
            }
            if (qFlag) {
                throw new IptError("End of string not found.", so);
            }
            
            // Save context before parsing nested block
            var savedSo:uint = so;
            var savedScript:String = script;
            var savedOffset:uint = offset;
            
            // Parse inner script block
            var tokenList:IptTokenList = tokenize(atomListString, runningOffset + 1);
            
            // Restore parsing context
            script = savedScript;
            so = savedSo;
            offset = savedOffset;
            
            return tokenList;
        }
        
        private function parseNumber():IntegerToken {
            var numString:String = "";
            var char:String;
            
            if (currentChar() == "-") {
                numString += "-";
                so++;
            }
            
            char = currentChar();
            while (char != null && char >= '0' && char <= '9') {
                numString += char;
                so++;
                char = currentChar();
            }
            
            return new IntegerToken(parseInt(numString));
        }
        
        private function parseStringLiteral():StringToken {
            var result:String = "";
            var quoteCount:int = 0;
            var dp:int = 0;
            if (currentChar() == '"') {
                so++;
                quoteCount++;
            }
            while (currentChar() != null && currentChar().charCodeAt(0) != 0 &&
                   currentChar() != '"') {
                if (currentChar() == '\\') {
                    so++;
                    if (currentChar() == 'x') {
                        var hexNumChars:String = "0x";
                        so++;
                        for (var i:int = 0; i < 2 && hexNumberTest.test(currentChar()); i++) {
                            hexNumChars += currentChar();
                            so++;
                        }
                        var charsetBA:ByteArray = new ByteArray();
                        charsetBA.writeByte(parseInt(hexNumChars));
                        charsetBA.position = 0;
                        result += charsetBA.readMultiByte(1, "Windows-1252");
                    }
                    else {
                        result += currentChar();
                        so++;
                    }
                }
                else {
                    result += currentChar();
                    so++;
                }
            }
            if (currentChar() == '"') {
                quoteCount++;
                so++;
            }
            if (quoteCount <= 1) {
                throw new IptError("End of string not found.", so);
            }
            return new StringToken(result);
        }
        
        public function parseSymbol():IptToken {
            var dp:int = 0;
            var sc:String = currentChar();
            var token:String = "";
            
            while (tokenTest.test(sc = currentChar()) && currentChar().charCodeAt(0) != 0) {
                token += sc.toUpperCase();
                so++;
                sc = currentChar()
            }
            
            var commandClass:Class = getCommand(token);
            if (commandClass) {
                return IptToken(new commandClass());
            }
            
            return new VariableToken(token);
        }
        
        /**
         * Parses event handlers into individual token lists. 
         * Format: ON EventName { ... }
         * Returns object with keys=event names, values=IptTokenList
         */
        public function parseEventHandlers(script:String):Object {
            this.script = script;
            offset = so = 0;
            var handlers:Object = {};
            var char:String = "";
            while ((char = currentChar()) != null && char.charCodeAt(0) != 0) {
                
                if (char == " " || char == "\t" || char == "\r" || char == "\n") {
                    so++;
                }
                else if (char == '#' || char == ";") {
                    while ((char = currentChar()) != null && char != '\r' && char != '\n') {
                        so++;
                    }
                }
                else if (char == "O" && sc(1) == "N" && whiteSpaceTest.test(sc(2)))
                {
                    so += 3;
                    var handlerName:String = "";
                    
                    // Grab handler name...
                    while ((char = currentChar()) != null && char.charCodeAt(0) != 0) {
                        if (char == " " || char == "\t" || char == "\r" || char == "\n") {
                            so++;
                        }
                        else if (char == '#' || char == ";") {
                            while ((char = currentChar()) != null &&
                                   char != '\r' && char != '\n') {
                                so++;
                            }
                        }
                        else if (tokenTest.test(char)) {
                            while (tokenTest.test(currentChar())) {
                                handlerName += currentChar();
                                so++;
                            }
                            break;
                        }
                        else {
                            so++;
                        }
                    }
                    
                    // Look for opening brace
                    while ((char = currentChar()) != null) {
                        if (char == '#' || char == ";") {
                            while ((char = currentChar()) != null &&
                                   char != '\r' && char != '\n') {
                                so++;
                            }
                        }
                        if (char == '{') {
                            var tokenList:IptTokenList = parseAtomList();
                            handlers[handlerName] = tokenList;
                            break;
                        }
                        so++;
                    }
                }
                else {
                    so++;
                }
            }
            
            return handlers;
        }
    }
}
```

### IptManager.as (Execution Engine)
```actionscript
package org.openpalace.iptscrae
{
    import flash.events.EventDispatcher;
    import flash.utils.setTimeout;

    [Event(name="trace", type="org.openpalace.iptscrae.IptEngineEvent")]
    [Event(name="pause", type="org.openpalace.iptscrae.IptEngineEvent")]
    [Event(name="resume", type="org.openpalace.iptscrae.IptEngineEvent")]
    [Event(name="abort", type="org.openpalace.iptscrae.IptEngineEvent")]
    [Event(name="start", type="org.openpalace.iptscrae.IptEngineEvent")]
    [Event(name="finish", type="org.openpalace.iptscrae.IptEngineEvent")]
    
    public class IptManager extends EventDispatcher implements IIptManager
    {
        public var callStack:Vector.<Runnable> = new Vector.<Runnable>();
        public var alarms:Vector.<IptAlarm> = new Vector.<IptAlarm>();
        public var parser:IptParser;
        public var globalVariableStore:IptVariableStore;
        public var grepMatchData:Array;
        public var currentScript:String;
        public var paused:Boolean = false;
        public var debugMode:Boolean = false;
        public var stepsPerTimeSlice:int = 800;
        public var delayBetweenTimeSlices:int = 1;
        public var stepThroughScript:Boolean = false;
        private var _running:Boolean = false;
        
        public var executionContextClass:Class = IptExecutionContext;
        
        public function IptManager()
        {
            super();
            globalVariableStore = new IptVariableStore(new IptExecutionContext(this));
            parser = new IptParser(this);
        }
        
        public function get running():Boolean { return _running; }
        
        public function traceMessage(message:String):void {
            var event:IptEngineEvent = new IptEngineEvent(IptEngineEvent.TRACE);
            event.message = message;
            dispatchEvent(event);
        }
        
        public function addAlarm(alarm:IptAlarm):void {
            alarms.push(alarm);
            alarm.addEventListener(IptEngineEvent.ALARM, handleAlarm);
            alarm.start();
        }
        
        public function removeAlarm(alarm:IptAlarm):void {
            alarm.stop();
            var index:int = alarms.indexOf(alarm);
            if (index != -1) {
                alarms.splice(index, 1);
            }
        }
        
        public function clearAlarms():void {
            for each (var alarm:IptAlarm in alarms) {
                alarm.stop();
            }
            alarms = new Vector.<IptAlarm>;
        }
        
        public function handleAlarm(event:IptEngineEvent):void {
            var alarm:IptAlarm = IptAlarm(event.target);
            if (alarms.indexOf(alarm) == -1) { return; }
            executeTokenListWithContext(alarm.tokenList, alarm.context);
            removeAlarm(alarm);
            start();
        }
        
        public function clearCallStack():void {
            callStack = new Vector.<Runnable>();
        }

        public function get currentRunnableItem():Runnable {
            if (callStack.length > 0) {
                return callStack[callStack.length-1];
            }
            return null;
        }
        
        public function get moreToExecute():Boolean {
            return Boolean(callStack.length > 0);
        }
        
        public function cleanupCurrentItem():void {
            var runnableItem:Runnable = currentRunnableItem;
            if (runnableItem && !runnableItem.running) {
                callStack.pop();
            }
        }
        
        public function step():void {
            var runnableItem:Runnable = currentRunnableItem;
            if (runnableItem) {
                if (runnableItem.running) {
                    try {
                        runnableItem.step();
                    }
                    catch (e:IptError) {
                        var charOffset:int = 0;
                        if (runnableItem is IptTokenList) {
                            outputError(currentScript, e, charOffset);
                            clearCallStack();
                        }
                    }
                    cleanupCurrentItem();
                }
                else {
                    callStack.pop();
                }
            }
        }

        public function pause():void {
            if (debugMode) {
                paused = true;
                dispatchEvent(new IptEngineEvent(IptEngineEvent.PAUSE));
            }
        }
        
        public function resume():void {
            stepThroughScript = false;
            if (paused) {
                paused = false;
                dispatchEvent(new IptEngineEvent(IptEngineEvent.RESUME));
                run();
            }
        }

        private function finish():void {
            _running = false;
            if (alarms.length == 0) {
                dispatchEvent(new IptEngineEvent(IptEngineEvent.FINISH));
            }
        }
        
        public function abort():void {
            clearAlarms();
            clearCallStack();
            _running = false;
            dispatchEvent(new IptEngineEvent(IptEngineEvent.ABORT));
            dispatchEvent(new IptEngineEvent(IptEngineEvent.FINISH));
        }
        
        public function start():void {
            if (!_running) {
                _running = true;
                setTimeout(run, 1);  // Everything must be async
            }
            if (debugMode && stepThroughScript) {
                pause();
            }
        }
        
        private function run():void {
            // Pseudo-threading. Execute a group of commands and then yield
            // before scheduling the next group.
            for (var i:int = 0; i < stepsPerTimeSlice; i++) {
                if (moreToExecute && !paused) {
                    step();
                }
                else {
                    if (!moreToExecute) { 
                        finish();
                    }
                    return;
                }
            }
            setTimeout(run, delayBetweenTimeSlices);
        }
        
        public function execute(script:String):void {
            var context:IptExecutionContext = new executionContextClass(this);
            executeWithContext(script, context);
        }
        
        public function executeTokenListWithContext(tokenList:IptTokenList,
            context:IptExecutionContext):void {
            try {
                currentScript = tokenList.sourceScript;
                tokenList.execute(context);
                dispatchEvent(new IptEngineEvent(IptEngineEvent.START));
            }
            catch (e:IptError) {
                outputError(tokenList.sourceScript, e);
                abort();
            }
        }
        
        public function executeWithContext(script:String,
            context:IptExecutionContext):void {
            currentScript = script;
            var tokenList:IptTokenList;
            try {
                tokenList = parser.tokenize(script);
            }
            catch (e:IptError) {
                var error:IptError = new IptError("Parse Error: " + e.message,
                    e.characterOffset);
                outputError(currentScript, error, 0);
                abort();
                return;
            }
            try {
                tokenList.execute(context);
                dispatchEvent(new IptEngineEvent(IptEngineEvent.START));
            }
            catch (e:IptError) {
                var charOffset:int = 0;
                if (tokenList) {
                    charOffset = tokenList.characterOffsetCompensation;
                }
                outputError(currentScript, e, charOffset);
                abort();
            }
        }
        
        public function parseEventHandlers(script:String):Object {
            var handlers:Object = {};
            try {
                handlers = parser.parseEventHandlers(script);
            }
            catch (e:IptError) {
                outputError(script, e);
            }
            return handlers;
        }
        
        private function outputError(script:String, e:IptError,
            characterOffsetCompensation:int = 0):void {
            var sourceContext:String = "";
            var output:String = e.message;
            if (e.characterOffset != -1) {
                var offset:int = e.characterOffset - characterOffsetCompensation;
                if (currentRunnableItem) {
                    if (currentRunnableItem is IptTokenList) {
                        var tokenList:IptTokenList = IptTokenList(currentRunnableItem);
                        var charOffset:int = tokenList.scriptCharacterOffset;
                        var currentToken:IptToken = tokenList.getCurrentToken();
                        if (currentToken) {
                            charOffset = currentToken.scriptCharacterOffset;
                        }
                        sourceContext = highlightSource(tokenList.sourceScript,
                            offset - tokenList.characterOffsetCompensation, 30);
                    }
                }
                output = "At character " + offset + ":\n" + output + "\n" + sourceContext;
            }
            trace(output);
            traceMessage(output);
        }
        
        public function highlightSource(script:String, characterOffset:int,
            contextCharacters:int = 30):String {
            if (characterOffset != -1) {
                script = script.replace(/[\r\n]/g, " ");
                var charsAfter:int = script.length - characterOffset;
                var charsBefore:int = script.length - charsAfter;
                var output:String = "";
                output += script.slice(
                    characterOffset - Math.min(charsBefore, contextCharacters),
                    characterOffset + Math.min(charsAfter, contextCharacters)
                );
                output += "\n";
                var pointerPadding:int = Math.min(charsBefore, contextCharacters);
                var pointer:String = "";
                for (var i:int = 0; i < pointerPadding; i++) {
                    pointer += " ";
                }
                pointer += "^";
                output += pointer;
                return output;
            }
            return "";
        }
    }
}
```

### IptAlarm.as
```actionscript
package org.openpalace.iptscrae
{
    import flash.events.EventDispatcher;
    import flash.events.TimerEvent;
    import flash.utils.Timer;
    
    public class IptAlarm extends EventDispatcher
    {
        private var timer:Timer;
        public var tokenList:IptTokenList;
        public var context:IptExecutionContext;
        private var _delay:uint = 0;
        public var completed:Boolean = false;
        
        public function set delayTicks(ticks:int):void {
            _delay = ticksToMS(ticks - 2); // timing compensation of 2 ticks
            if (_delay < 10) { _delay = 10; }
            timer.delay = _delay;
        }
        public function get delayTicks():int {
            return msToTicks(_delay);
        }
        
        private function ticksToMS(ticks:uint):uint {
            return Math.max(0, ticks) / 60 * 1000;
        }
        
        private function msToTicks(ms:uint):uint {
            return ms / 1000 * 60;
        }
        
        public function IptAlarm(script:IptTokenList, manager:IptManager,
            delayTicks:uint, context:IptExecutionContext = null)
        {
            timer = new Timer(ticksToMS(delayTicks), 1);
            timer.addEventListener(TimerEvent.TIMER, handleTimer);
            if (context == null) {
                context = new manager.executionContextClass(manager); 
            }
            this.context = context;
            this.tokenList = script;
            this.delayTicks = delayTicks;
        }
        
        private function handleTimer(event:TimerEvent):void {
            dispatchEvent(new IptEngineEvent(IptEngineEvent.ALARM));
            completed = true;
        }
        
        public function start():void {
            timer.reset();
            timer.start();
        }
        
        public function stop():void {
            timer.stop();
        }
    }
}
```

---

## TOKEN TYPES

### IntegerToken.as
```actionscript
package org.openpalace.iptscrae.token
{
    import org.openpalace.iptscrae.IptToken;
    
    public class IntegerToken extends IptToken
    {
        public var data:int;
        
        public function IntegerToken(value:int = 0, characterOffset:int = -1) {
            super(characterOffset);
            data = value;
        }
        
        override public function clone():IptToken { return new IntegerToken(data); }
        override public function toBoolean():Boolean { return Boolean(data != 0); }
        override public function toString():String {
            return "[IntegerToken value=\"" + data.toString() + "\"]";
        }
    }
}
```

### StringToken.as
```actionscript
package org.openpalace.iptscrae.token
{
    import org.openpalace.iptscrae.IptToken;
    
    public class StringToken extends IptToken
    {
        public var data:String;
        
        public function StringToken(value:String, characterOffset:int = -1) {
            super(characterOffset);
            data = value;
        }
        
        public override function clone():IptToken { return new StringToken(data); }
        override public function toString():String {
            return "[StringToken value=\"" + data + "\"]";
        }
    }
}
```

### ArrayToken.as
```actionscript
package org.openpalace.iptscrae.token
{
    import org.openpalace.iptscrae.IptToken;

    public class ArrayToken extends IptToken
    {
        public var data:Array;
        
        public function ArrayToken(data:Array = null, characterOffset:int = -1) {
            super(characterOffset);
            if (data == null) { data = []; }
            this.data = data;
        }
        
        override public function clone():IptToken { return new ArrayToken(data); }
        override public function toString():String {
            var string:String = "[ArrayToken length=" + data.length + "]\n";
            for each (var token:IptToken in data) {
                string += ("  - " + token.toString() + "\n");
            }
            return string;
        }
    }
}
```

### ArrayMarkToken.as
```actionscript
package org.openpalace.iptscrae.token
{
    import org.openpalace.iptscrae.IptToken;

    public class ArrayMarkToken extends IptToken
    {
        override public function toString():String {
            return "[ArrayMarkToken]";
        }
    }
}
```

### ArrayParseToken.as
```actionscript
package org.openpalace.iptscrae.token
{
    import org.openpalace.iptscrae.IptConstants;
    import org.openpalace.iptscrae.IptExecutionContext;
    import org.openpalace.iptscrae.IptCommand;
    import org.openpalace.iptscrae.IptToken;
    
    public class ArrayParseToken extends IptCommand
    {
        override public function execute(context:IptExecutionContext):void {
            var array:ArrayToken = new ArrayToken();
            while (context.stack.depth > 0) {
                var token:IptToken = context.stack.pop();
                if (token is ArrayMarkToken) {
                    array.scriptCharacterOffset = token.scriptCharacterOffset;
                    break;
                }
                else {
                    array.data.unshift(token);
                }
            }
            context.stack.push(array);
        }
        
        override public function toString():String {
            return "[ArrayParseToken]";
        }
    }
}
```

### VariableToken.as
```actionscript
package org.openpalace.iptscrae.token
{
    import org.openpalace.iptscrae.IptExecutionContext;
    import org.openpalace.iptscrae.IptCommand;

    public class VariableToken extends IptCommand
    {
        public var name:String;
        
        public function VariableToken(name:String, characterOffset:int = -1) {
            super(characterOffset);
            this.name = name.toUpperCase();
        }
        
        /* When this token is encountered it will be executed, which will
           look up the variable in the variable store and push the real
           variable onto the stack instead. */
        override public function execute(context:IptExecutionContext):void {
            context.stack.push(context.variableStore.getVariable(name));
        }
        
        override public function toString():String {
            return "[VariableToken name=\"" + name + "\"]";
        }
    }
}
```

---

## BUILT-IN COMMANDS

### IptDefaultCommands.as (Command Registry)
```actionscript
package org.openpalace.iptscrae
{
    import org.openpalace.iptscrae.command.*;
    import org.openpalace.iptscrae.command.operator.*;

    public final class IptDefaultCommands
    {
        public static const commands:Object = {
            "_TRACE": TRACECommand,
            "ALARMEXEC": ALARMEXECCommand,
            "AND": LogicalAndOperator,
            "ARRAY": ARRAYCommand,
            "ATOI": ATOICommand,
            "BEEP": BEEPCommand,
            "BREAK": BREAKCommand,
            "_BREAKPOINT": BREAKPOINTCommand,
            "COSINE": COSINECommand,
            "DATETIME": DATETIMECommand,
            "DELAY": DELAYCommand,
            "DEF": AssignOperator,
            "DUP": DUPCommand,
            "EXEC": EXECCommand,
            "EXIT": EXITCommand,
            "FOREACH": FOREACHCommand,
            "GET": GETCommand,
            "GLOBAL": GLOBALCommand,
            "GREPSTR": GREPSTRCommand,
            "GREPSUB": GREPSUBCommand,
            "IF": IFCommand,
            "IFELSE": IFELSECommand,
            "IPTVERSION": IPTVERSIONCommand,
            "ITOA": ITOACommand,
            "LENGTH": LENGTHCommand,
            "LOWERCASE": LOWERCASECommand,
            "NOT": LogicalNotOperator,
            "OR": LogicalOrOperator,
            "OVER": OVERCommand,
            "PICK": PICKCommand,
            "POP": POPCommand,
            "PUT": PUTCommand,
            "RANDOM": RANDOMCommand,
            "RETURN": RETURNCommand,
            "SINE": SINECommand,
            "STACKDEPTH": STACKDEPTHCommand,
            "STRINDEX": STRINDEXCommand,
            "STRLEN": STRLENCommand,
            "STRTOATOM": STRTOATOMCommand,
            "SUBSTR": SUBSTRCommand,
            "SUBSTRING": SUBSTRINGCommand,
            "SWAP": SWAPCommand,
            "TANGENT": TANGENTCommand,
            "TICKS": TICKSCommand,
            "TOPTYPE": TOPTYPECommand,
            "TRACESTACK": TRACESTACKCommand,
            "UPPERCASE": UPPERCASECommand,
            "VARTYPE": VARTYPECommand,
            "WHILE": WHILECommand,
            "!": LogicalNotOperator,
            "!=": InequalityOperator,
            "<>": InequalityOperator,
            "+": AdditionOperator,
            "++": UnaryIncrementOperator,
            "+=": AdditionAssignmentOperator,
            "-": SubtractionOperator,
            "--": UnaryDecrementOperator,
            "-=": SubtractionAssignmentOperator,
            "*": MultiplicationOperator,
            "*=": MultiplicationAssignmentOperator,
            "/": DivisionOperator,
            "/=": DivisionAssignmentOperator,
            "%": ModuloOperator,
            "%=": ModuloAssignmentOperator,
            "&": ConcatOperator,
            "&=": ConcatAssignmentOperator,
            "=": AssignOperator,
            "==": EqualityOperator,
            "<": LessThanOperator,
            "<=": LessThanOrEqualToOperator,
            ">": GreaterThanOperator,
            ">=": GreaterThanOrEqualToOperator
        }
    }
}
```

### Control Flow Commands

#### IFCommand.as
```actionscript
// Stack: { body } condition IF
public class IFCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var condition:IptToken = context.stack.pop().dereference();
        var tokenList:IptTokenList = context.stack.popType(IptTokenList);
        if (condition.toBoolean()) {
            tokenList.execute(context);
        }
    }
}
```

#### IFELSECommand.as
```actionscript
// Stack: { trueBody } { falseBody } condition IFELSE
public class IFELSECommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var condition:IptToken = context.stack.pop().dereference();
        var falseClause:IptTokenList = context.stack.popType(IptTokenList);
        var trueClause:IptTokenList = context.stack.popType(IptTokenList);
        if (condition.toBoolean()) {
            trueClause.execute(context);
        } else {
            falseClause.execute(context);
        }
    }
}
```

#### WHILECommand.as (Implements Stepping for Pseudo-threading)
```actionscript
public class WHILECommand extends IptCommand
{
    private var conditionTokenList:IptTokenList;
    private var executeTokenList:IptTokenList;
    private var _running:Boolean = false;
    public var context:IptExecutionContext;
    private var checkingCondition:Boolean = false;
    
    override public function get running():Boolean { return _running; }
    override public function end():void { _running = false; }
    
    override public function step():void {
        if (context.returnRequested || context.exitRequested) {
            end();
            return;
        }
        
        if (checkingCondition) {
            conditionTokenList.execute(context);
            checkingCondition = false;
        }
        else {
            try {
                var conditionResult:IptToken = context.stack.pop();
            } catch (e:Error) {
                throw new IptError("Unable to get result of condition: " + e.message); 
            }
            if (!conditionResult.toBoolean() || context.breakRequested) {
                context.breakRequested = false;
                end();
                return;
            }
            checkingCondition = true;
            executeTokenList.execute(context);
        }
    } 
    
    // Stack: { body } { condition } WHILE
    override public function execute(context:IptExecutionContext):void {
        this.context = context;
        context.manager.callStack.push(this);
        _running = true;
        checkingCondition = true;
        conditionTokenList = context.stack.popType(IptTokenList);
        executeTokenList = context.stack.popType(IptTokenList);
        step();
    }
}
```

#### FOREACHCommand.as (Implements Stepping)
```actionscript
public class FOREACHCommand extends IptCommand
{
    private var array:ArrayToken;
    private var currentItemIndex:uint;
    private var tokenList:IptTokenList;
    public var context:IptExecutionContext;
    private var _running:Boolean = false;
    
    override public function get running():Boolean { return _running; }
    override public function end():void { _running = false; }
    
    override public function step():void {
        if (context.returnRequested || context.exitRequested || context.breakRequested) {
            context.breakRequested = false;
            end();
            return;
        }
        if (currentItemIndex < array.data.length) {
            context.stack.push(IptToken(array.data[currentItemIndex]));
            tokenList.execute(context);
            currentItemIndex++;
        } else {
            end();
        }
    }
    
    // Stack: { body } array FOREACH
    override public function execute(context:IptExecutionContext):void {
        this.context = context;
        context.manager.callStack.push(this);
        _running = true;
        array = context.stack.popType(ArrayToken);
        tokenList = context.stack.popType(IptTokenList);
        currentItemIndex = 0;
        step();
    }
}
```

#### EXECCommand.as
```actionscript
public class EXECCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var tokenList:IptToken = context.stack.pop().dereference();
        // Exec fails silently if given a zero-valued integer input.
        if (tokenList is IntegerToken && IntegerToken(tokenList).data == 0) {
            return;
        }
        if (tokenList is IptTokenList) {
            IptTokenList(tokenList).execute(context);
        }
        else {
            throw new IptError("Expected atom list, got " + IptUtil.className(tokenList));
        }
    }
}
```

#### BREAKCommand.as / RETURNCommand.as / EXITCommand.as
```actionscript
// BREAK - exits current loop
public class BREAKCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        context.breakRequested = true;
    }
}

// RETURN - exits current code block
public class RETURNCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        context.returnRequested = true;
    }
}

// EXIT - exits entire script
public class EXITCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        context.exitRequested = true;
    }
}
```

### Variable/Stack Commands

#### GLOBALCommand.as
```actionscript
public class GLOBALCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        var globalVariable:IptVariable =
            context.manager.globalVariableStore.getVariable(variable.name);
        if (variable.initialized) {
            globalVariable.value = variable.value;
        }
        variable.globalize(globalVariable);
    }
}
```

#### DUPCommand / SWAPCommand / OVERCommand / PICKCommand / POPCommand / STACKDEPTHCommand
```actionscript
// DUP - duplicate top of stack
public class DUPCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        context.stack.duplicate();
    }
}

// SWAP - swap top two items
// POP - discard top item
// OVER - copy second item to top
// PICK n - copy nth item to top
// STACKDEPTH - push current stack depth
```

### String Commands

```actionscript
// ATOI: string -> int
public class ATOICommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var a1:StringToken = context.stack.popType(StringToken);
        context.stack.push(new IntegerToken(parseInt(a1.data)));
    }
}

// ITOA: int -> string
public class ITOACommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var integerInput:IntegerToken = context.stack.popType(IntegerToken);
        context.stack.push(new StringToken(integerInput.data.toString()));
    }
}

// STRINDEX: string1 string2 -> index (indexOf)
public class STRINDEXCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var string2:StringToken = context.stack.popType(StringToken);
        var string1:StringToken = context.stack.popType(StringToken);
        context.stack.push(new IntegerToken(string1.data.indexOf(string2.data)));
    }
}

// SUBSTR: string fragment -> 1/0 (case-insensitive contains)
public class SUBSTRCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var fragment:StringToken = context.stack.popType(StringToken);
        var whole:StringToken = context.stack.popType(StringToken);
        context.stack.push(new IntegerToken(
            whole.data.toLowerCase().indexOf(fragment.data.toLowerCase()) != -1 ? 1 : 0));
    }
}

// SUBSTRING: string offset length -> substring
public class SUBSTRINGCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var length:IntegerToken = context.stack.popType(IntegerToken);
        var offset:IntegerToken = context.stack.popType(IntegerToken);
        var string:StringToken = context.stack.popType(StringToken);
        if (offset.data < 0) { throw new IptError("Offset cannot be negative."); }
        context.stack.push(new StringToken(string.data.substr(offset.data, length.data)));
    }
}

// STRTOATOM: string -> tokenList (parses string as Iptscrae code)
public class STRTOATOMCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var stringToken:StringToken = context.stack.popType(StringToken);
        var tokenList:IptTokenList = context.manager.parser.tokenize(
            stringToken.data, stringToken.scriptCharacterOffset + 1);
        context.stack.push(tokenList);
    }
}
```

### Array Commands

```actionscript
// ARRAY count -> array (creates array of count zeros)
public class ARRAYCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var itemCount:IntegerToken = context.stack.popType(IntegerToken);
        if (itemCount.data >= 0) {
            var array:ArrayToken = new ArrayToken();
            for (var i:int = 0; i < itemCount.data; i++) {
                array.data.push(new IntegerToken(0));
            }
            context.stack.push(array);
        } else {
            context.stack.push(new IntegerToken(0));
        }
    }
}

// GET: array index -> element
public class GETCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var index:IntegerToken = context.stack.popType(IntegerToken);
        var array:ArrayToken = context.stack.popType(ArrayToken);
        if (index.data > array.data.length - 1 || index.data < 0) {
            throw new IptError("Attempted to fetch nonexistant array item at index " +
                index.data.toString() + ".");
        }
        context.stack.push(array.data[index.data]);
    }
}

// PUT: data array index -> (modifies array in place)
public class PUTCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var index:IntegerToken = context.stack.popType(IntegerToken);
        var array:ArrayToken = context.stack.popType(ArrayToken);
        var data:IptToken = context.stack.pop().dereference();
        if (index.data >= 0 && index.data < array.data.length) {
            array.data[index.data] = data;
        } else {
            throw new IptError("Array index " + index.data.toString() + " out of range");
        }
    }
}

// LENGTH: array -> count
public class LENGTHCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var array:ArrayToken = context.stack.popType(ArrayToken);
        context.stack.push(new IntegerToken(array.data.length));
    }
}
```

### Regex Commands

```actionscript
// GREPSTR: string pattern -> 0/1
public class GREPSTRCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var pattern:StringToken = context.stack.popType(StringToken);
        var stringToSearch:StringToken = context.stack.popType(StringToken);
        context.manager.grepMatchData = null;
        var grepPattern:RegExp;
        try { grepPattern = new RegExp(pattern.data); }
        catch (e:Error) { throw new IptError("Bad GREPSTR Pattern: " + pattern.data); }
        var result:Array = stringToSearch.data.match(grepPattern);
        if (result) {
            context.manager.grepMatchData = result;
            context.stack.push(new IntegerToken(1));
        } else {
            context.stack.push(new IntegerToken(0));
        }
    }
}

// GREPSUB: sourceString -> result (replaces $0, $1, etc. with match data)
public class GREPSUBCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var sourceString:StringToken = context.stack.popType(StringToken);
        var matchdata:Array = context.manager.grepMatchData;
        var result:String = sourceString.data;
        if (matchdata) {
            for (var i:int = 0; i < matchdata.length; i++) {
                var regexp:RegExp = new RegExp("\\$" + i.toString(), "g");
                result = result.replace(regexp, matchdata[i]);
            }
        }
        context.stack.push(new StringToken(result));
    }
}
```

### Timer/Alarm Commands

```actionscript
// ALARMEXEC: { code } delayTicks ALARMEXEC
public class ALARMEXECCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var delayTicks:IntegerToken = context.stack.popType(IntegerToken);
        var tokenList:IptTokenList = context.stack.popType(IptTokenList);
        var alarm:IptAlarm = new IptAlarm(tokenList, context.manager, delayTicks.data);
        context.manager.addAlarm(alarm);
    }
}

// DELAY: ticks DELAY (no-op in OpenPalace)
public class DELAYCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var ticks:IntegerToken = context.stack.popType(IntegerToken);
        // Do nothing.
    }
}

// TICKS: -> ticks (current time in ticks)
public class TICKSCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var date:Date = new Date();
        context.stack.push(new IntegerToken(int(date.valueOf() / Number(17) % 0x4F1A00)));
    }
}

// RANDOM: max -> random(0..max-1)
public class RANDOMCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var number:IntegerToken = context.stack.popType(IntegerToken);
        context.stack.push(new IntegerToken(int(Math.random() * Number(number.data))));
    }
}
```

### Type Inspection Commands

```actionscript
// TOPTYPE: -> typeId (0=empty, 1=int, 2=var, 3=atomlist, 4=string, 5=arraymark, 6=array)
public class TOPTYPECommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        if (context.stack.depth == 0) {
            context.stack.push(new IntegerToken(0));
            return;
        }
        var token:IptToken = context.stack.pick(0);
        if (token is IntegerToken) { context.stack.push(new IntegerToken(1)); }
        else if (token is IptVariable) { context.stack.push(new IntegerToken(2)); }
        else if (token is IptTokenList) { context.stack.push(new IntegerToken(3)); }
        else if (token is StringToken) { context.stack.push(new IntegerToken(4)); }
        else if (token is ArrayMarkToken) { context.stack.push(new IntegerToken(5)); }
        else if (token is ArrayToken) { context.stack.push(new IntegerToken(6)); }
        else { context.stack.push(new IntegerToken(0)); }
    }
}

// VARTYPE: -> typeId (same but dereferences variables first)
public class VARTYPECommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        if (context.stack.depth == 0) {
            context.stack.push(new IntegerToken(0));
            return;
        }
        var token:IptToken = context.stack.pick(0).dereference();
        // same type mapping as TOPTYPE
    }
}
```

### Trace/Debug Commands

```actionscript
// _TRACE: string -> (outputs to trace log)
public class TRACECommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var token:StringToken = context.stack.popType(StringToken);
        context.manager.traceMessage(token.data);
    }
}

// TRACESTACK: -> (dumps entire stack to trace)
public class TRACESTACKCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        while (context.stack.depth > 0) {
            context.manager.traceMessage(context.stack.pop().toString());
        }
    }
}

// _BREAKPOINT: -> (pauses debugger)
public class BREAKPOINTCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        context.manager.pause();
    }
}
```

---

## OPERATORS

### Arithmetic Operators

```actionscript
// + (handles int+int and string+string)
public class AdditionOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var a2:IptToken = context.stack.pop().dereference();
        var a1:IptToken = context.stack.pop().dereference();
        if (a1 is IntegerToken && a2 is IntegerToken) {
            context.stack.push(new IntegerToken(IntegerToken(a1).data + IntegerToken(a2).data));
        } else if (a1 is StringToken && a2 is StringToken) {
            context.stack.push(new StringToken(StringToken(a1).data + StringToken(a2).data));
        } else {
            throw new IptError("Argument type mismatch.");
        }
    }
}

// -
public class SubtractionOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var a2:IntegerToken = context.stack.popType(IntegerToken);
        var a1:IntegerToken = context.stack.popType(IntegerToken);
        context.stack.push(new IntegerToken(a1.data - a2.data));
    }
}

// *
public class MultiplicationOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var multiplier:IntegerToken = context.stack.popType(IntegerToken);
        var multiplicand:IntegerToken = context.stack.popType(IntegerToken);
        context.stack.push(new IntegerToken(multiplicand.data * multiplier.data));
    }
}

// / (integer division)
public class DivisionOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var divisor:IntegerToken = context.stack.popType(IntegerToken);
        var dividend:IntegerToken = context.stack.popType(IntegerToken);
        context.stack.push(new IntegerToken(int(dividend.data / divisor.data)));
    }
}

// %
public class ModuloOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var a2:IntegerToken = context.stack.popType(IntegerToken);
        var a1:IntegerToken = context.stack.popType(IntegerToken);
        context.stack.push(new IntegerToken(a1.data % a2.data));
    }
}
```

### Assignment Operators

```actionscript
// = (also aliased as DEF)
public class AssignOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        var value:IptToken = context.stack.pop().dereference();
        variable.value = value;
    }
}

// ++ (unary increment)
public class UnaryIncrementOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        if (!(variable.value is IntegerToken)) {
            throw new IptError("Variable '" + variable.name + "' does not contain a number.");
        }
        variable.value = new IntegerToken(IntegerToken(variable.value).data + 1);
    }
}

// -- (unary decrement)
public class UnaryDecrementOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        if (!(variable.value is IntegerToken)) {
            throw new IptError("Variable '" + variable.name + "' does not contain a number.");
        }
        variable.value = new IntegerToken(IntegerToken(variable.value).data - 1);
    }
}

// += (handles int and string)
public class AdditionAssignmentOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        var argument:IptToken = context.stack.popType(IptToken);
        var originalValue:IptToken = variable.value;
        if (argument is IntegerToken && originalValue is IntegerToken) {
            variable.value = new IntegerToken(
                IntegerToken(originalValue).data + IntegerToken(argument).data);
        } else if (argument is StringToken && originalValue is StringToken) {
            variable.value = new StringToken(
                StringToken(originalValue).data + StringToken(argument).data);
        } else {
            throw new IptError("Type mismatch");
        }
    }
}

// &= (string concat assign)
public class ConcatAssignmentOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        if (!(variable.value is StringToken)) {
            throw new IptError("Variable '" + variable.name + "' does not contain a string.");
        }
        var arg:StringToken = context.stack.popType(StringToken);
        variable.value = new StringToken(StringToken(variable.value).data + arg.data);
    }
}

// /= (division assign)
public class DivisionAssignmentOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var variable:IptVariable = context.stack.popType(IptVariable);
        if (!(variable.value is IntegerToken)) {
            throw new IptError("Variable '" + variable.name + "' does not contain a number.");
        }
        var divisor:IntegerToken = context.stack.popType(IntegerToken);
        variable.value = new IntegerToken(IntegerToken(variable.value).data / divisor.data);
    }
}
```

### String Operator

```actionscript
// & (string concatenation)
public class ConcatOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var arg2:StringToken = context.stack.popType(StringToken);
        var arg1:StringToken = context.stack.popType(StringToken);
        context.stack.push(new StringToken(arg1.data + arg2.data));
    }
}
```

### Comparison Operators

```actionscript
// == (case-insensitive for strings!)
public class EqualityOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var a2:IptToken = context.stack.pop().dereference();
        var a1:IptToken = context.stack.pop().dereference();
        if (a1 is IntegerToken && a2 is IntegerToken) {
            context.stack.push(new IntegerToken(
                IntegerToken(a1).data == IntegerToken(a2).data ? 1 : 0));
        } else if (a1 is StringToken && a2 is StringToken) {
            context.stack.push(new IntegerToken(
                StringToken(a1).data.toUpperCase() == StringToken(a2).data.toUpperCase() ? 1 : 0));
        } else {
            context.stack.push(new IntegerToken(0));
        }
    }
}

// != and <> (inequality)
public class InequalityOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var a2:IptToken = context.stack.pop().dereference();
        var a1:IptToken = context.stack.pop().dereference();
        if (a1 is IntegerToken && a2 is IntegerToken) {
            context.stack.push(new IntegerToken(
                IntegerToken(a1).data != IntegerToken(a2).data ? 1 : 0));
        } else if (a1 is StringToken && a2 is StringToken) {
            context.stack.push(new IntegerToken(
                StringToken(a1).data != StringToken(a2).data ? 1 : 0));
        } else {
            context.stack.push(new IntegerToken(1));
        }
    }
}

// >, >=, <, <= (integer only, similar pattern)
// See GreaterThanOperator for the pattern - also handles string comparison
```

### Logical Operators

```actionscript
// AND
public class LogicalAndOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var arg2:IptToken = context.stack.popType(IptToken);
        var arg1:IptToken = context.stack.popType(IptToken);
        context.stack.push(new IntegerToken(
            (arg1.toBoolean() && arg2.toBoolean()) ? 1 : 0));
    }
}

// OR
public class LogicalOrOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var arg2:IptToken = context.stack.popType(IptToken);
        var arg1:IptToken = context.stack.popType(IptToken);
        context.stack.push(new IntegerToken(
            (arg1.toBoolean() || arg2.toBoolean()) ? 1 : 0));
    }
}

// NOT / !
public class LogicalNotOperator extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var token:IptToken = context.stack.pop().dereference();
        context.stack.push(new IntegerToken(token.toBoolean() ? 0 : 1));
    }
}
```

---

## PALACE-SPECIFIC INTEGRATION

### PalaceIptManager.as
```actionscript
package net.codecomposer.palace.iptscrae
{
    import org.openpalace.iptscrae.IptManager;
    
    public class PalaceIptManager extends IptManager
    {
        public var pc:PalaceController;
        
        public function PalaceIptManager(pc:PalaceController = null)
        {
            super();
            if (pc == null) { pc = new PalaceController(); }
            this.pc = pc;
            executionContextClass = PalaceIptExecutionContext;
        }
    }
}
```

### PalaceIptExecutionContext.as
```actionscript
package net.codecomposer.palace.iptscrae
{
    import org.openpalace.iptscrae.*;
    import org.openpalace.iptscrae.token.StringToken;
    
    public class PalaceIptExecutionContext extends IptExecutionContext
    {
        public var hotspotId:int = 0;
        
        public function PalaceIptExecutionContext(manager:IptManager,
            stack:IptTokenStack=null, variableStore:IptVariableStore=null) {
            super(manager, stack, variableStore);
        }
        
        override public function isExternalVariable(name:String):Boolean {
            if (name.toUpperCase() == "CHATSTR") { return true; }
            return false;
        }
        
        override public function getExternalVariable(name:String):IptToken {
            if (name.toUpperCase() == "CHATSTR") {
                return new StringToken(PalaceIptManager(manager).pc.getChatString());
            }
            return new IptToken();
        }
        
        override public function setExternalVariable(name:String, value:IptToken):void {
            if (name.toUpperCase() == "CHATSTR") {
                if (value is StringToken) {
                    PalaceIptManager(manager).pc.setChatString(StringToken(value).data);
                } else {
                    throw new IptError("Invalid data type for 'CHATSTR': " +
                        IptUtil.className(value));
                }
            }
        }
    }
}
```

### IptEventHandler.as (Event Type Constants)
```actionscript
public class IptEventHandler
{
    public static const TYPE_SELECT:int = 0;
    public static const TYPE_LOCK:int = 1;
    public static const TYPE_UNLOCK:int = 2;
    public static const TYPE_STATECHANGE:int = 3;
    public static const TYPE_MOUSEDRAG:int = 4;
    public static const TYPE_MOUSEDOWN:int = 5;
    public static const TYPE_ALARM:int = 6;
    public static const TYPE_MOUSEUP:int = 7;
    public static const TYPE_INCHAT:int = 8;
    public static const TYPE_PROPCHANGE:int = 9;   // Unused
    public static const TYPE_ENTER:int = 10;
    public static const TYPE_LEAVE:int = 11;
    public static const TYPE_OUTCHAT:int = 12;
    public static const TYPE_SIGNON:int = 13;
    public static const TYPE_SIGNOFF:int = 14;
    public static const TYPE_MACRO0:int = 15;
    // ... TYPE_MACRO1-9 = 16-24
    public static const TYPE_PPA_MACRO:int = 25;    // Unused
    public static const TYPE_MOUSEMOVE:int = 26;
    public static const TYPE_UNHANDLED:int = 27;
    public static const TYPE_ROLLOVER:int = 28;
    public static const TYPE_ROLLOUT:int = 29;
    public static const TYPE_USERMOVE:int = 30;
    public static const TYPE_USERENTER:int = 31;
    public static const TYPE_PPA_MESSAGE:int = 32;  // Unused
    
    public var eventType:int;
    public var script:String;
    public var tokenList:IptTokenList;
    
    public static function getEventType(token:String):int { /* switch on name */ }
}
```

### PalaceIptscraeCommands.as (Palace Command Registry)
```actionscript
public class PalaceIptscraeCommands {
    public static var commands:Object = {
        "ADDLOOSEPROP": ADDLOOSEPROPCommand,
        "ALARMEXEC": ALARMEXECCommand,       // overrides core (adds hotspotId context)
        "CHAT": SAYCommand,
        "CLEARLOOSEPROPS": CLEARLOOSEPROPSCommand,
        "CLEARPROPS": NAKEDCommand,
        "CLIENTTYPE": CLIENTTYPECommand,
        "DEST": DESTCommand,
        "DIMROOM": DIMROOMCommand,
        "DOFFPROP": DOFFPROPCommand,
        "DONPROP": DONPROPCommand,
        "DOORIDX": DOORIDXCommand,
        "DROPPROP": DROPPROPCommand,
        "GETPICLOC": GETPICLOCCommand,
        "GETPICDIMENSIONS": GETPICDIMENSIONSCommand,
        "GETSPOTSTATE": GETSPOTSTATECommand,
        "GETSPOTLOC": GETSPOTLOCCommand,
        "GLOBALMSG": GLOBALMSGCommand,
        "GOTOROOM": GOTOROOMCommand,
        "GREPSTR": GREPSTRCommand,           // overrides core (fixes ^^ regex bug)
        "HASPROP": HASPROPCommand,
        "HIDEAVATARS": HIDEAVATARSCommand,
        "ID": MECommand,
        "INSPOT": INSPOTCommand,
        "IPTVERSION": IPTVERSIONCommand,     // overrides core (returns 2 instead of 1)
        "ISGOD": ISGODCommand,
        "ISGUEST": ISGUESTCommand,
        "ISLOCKED": ISLOCKEDCommand,
        "ISWIZARD": ISWIZARDCommand,
        "KILLUSER": KILLUSERCommand,
        "LAUNCHAPP": UnsupportedCommand,
        "LAUNCHEVENT": UnsupportedCommand,
        "LAUNCHPPA": UnsupportedCommand,
        "LOADJAVA": UnsupportedCommand,
        "LOCALMSG": LOCALMSGCommand,
        "LOCK": LOCKCommand,
        "LOGMSG": LOGMSGCommand,
        "LOADPROPS": LOADPROPSCommand,
        "LOOSEPROPIDX": LOOSEPROPIDXCommand,
        "LOOSEPROP": LOOSEPROPCommand,
        "LOOSEPROPPOS": LOOSEPROPPOSCommand,
        "MACRO": MACROCommand,
        "MOVE": MOVECommand,
        "ME": MECommand,
        "MIDILOOP": MIDILOOPCommand,
        "MIDIPLAY": MIDIPLAYCommand,
        "MIDISTOP": MIDISTOPCommand,
        "MOUSEPOS": MOUSEPOSCommand,
        "MOVELOOSEPROP": MOVELOOSEPROPCommand,
        "NAKED": NAKEDCommand,
        "NBRDOORS": NBRDOORSCommand,
        "NBRLOOSEPROPS": NBRLOOSEPROPSCommand,
        "NBRROOMUSERS": NBRROOMUSERSCommand,
        "NBRSPOTS": NBRSPOTSCommand,
        "NBRUSERPROPS": NBRUSERPROPSCommand,
        "OPENPALACE": OPENPALACECommand,
        "POSX": POSXCommand,
        "POSY": POSYCommand,
        "PRIVATEMSG": PRIVATEMSGCommand,
        "REMOVEPROP": REMOVEPROPCommand,
        "ROOMID": ROOMIDCommand,
        "ROOMNAME": ROOMNAMECommand,
        "ROOMUSER": ROOMUSERCommand,
        "LINE": LINECommand,
        "LINETO": LINETOCommand,
        "PAINTCLEAR": PAINTCLEARCommand,
        "PAINTUNDO": PAINTUNDOCommand,
        "PENBACK": PENBACKCommand,
        "PENCOLOR": PENCOLORCommand,
        "PENFRONT": PENFRONTCommand,
        "PENPOS": PENPOSCommand,
        "PENSIZE": PENSIZECommand,
        "PENTO": PENTOCommand,
        "PROPOFFSETS": PROPOFFSETSCommand,
        "PROPDIMENSIONS": PROPDIMENSIONSCommand,
        "REMOVELOOSEPROP": REMOVELOOSEPROPCommand,
        "ROOMHEIGHT": ROOMHEIGHTCommand,
        "ROOMWIDTH": ROOMWIDTHCommand,
        "SAY": SAYCommand,
        "SAYAT": SAYATCommand,
        "SELECT": SELECTCommand,
        "SERVERNAME": SERVERNAMECommand,
        "SETALARM": SETALARMCommand,
        "SETCOLOR": SETCOLORCommand,
        "SETFACE": SETFACECommand,
        "SETLOC": SETLOCCommand,
        "SETLOCLOCAL": SETLOCLOCALCommand,
        "SETPICBRIGHTNESS": SETPICBRIGHTNESSCommand,
        "SETPICLOC": SETPICLOCCommand,
        "SETPICLOCLOCAL": SETPICLOCLOCALCommand,
        "SETPICOPACITY": SETPICOPACITYCommand,
        "SETPICSATURATION": SETPICSATURATIONCommand,
        "SETPOS": SETPOSCommand,
        "SETPROPS": SETPROPSCommand,
        "SETSPOTNAMELOCAL": SETSPOTNAMELOCALCommand,
        "SETSPOTSTATE": SETSPOTSTATECommand,
        "SETSPOTSTATELOCAL": SETSPOTSTATELOCALCommand,
        "SHELLCMD": UnsupportedCommand,
        "SHOWAVATARS": SHOWAVATARSCommand,
        "SHOWLOOSEPROPS": SHOWLOOSEPROPSCommand,
        "SPOTDEST": SPOTDESTCommand,
        "SPOTIDX": SPOTIDXCommand,
        "SPOTNAME": SPOTNAMECommand,
        "NETGOTO": NETGOTOCommand,
        "ROOMMSG": ROOMMSGCommand,
        "STATUSMSG": STATUSMSGCommand,
        "SUSRMSG": SUSRMSGCommand,
        "SOUND": SOUNDCommand,
        "TALKPPA": UnsupportedCommand,
        "TOPPROP": TOPPROPCommand,
        "UNLOCK": UNLOCKCommand,
        "USERID": USERIDCommand,
        "USERNAME": USERNAMECommand,
        "USERPROP": USERPROPCommand,
        "WHOCHAT": WHOCHATCommand,
        "WHOME": USERIDCommand,
        "WHONAME": WHONAMECommand,
        "WHOPOS": WHOPOSCommand,
        "WHOTARGET": WHOTARGETCommand
    };
}
```

### PalaceController.as (Key Methods)
```actionscript
public class PalaceController implements IPalaceController
{
    public var scriptManager:PalaceIptManager;
    public var client:PalaceClient;
    
    // Constructor: sets up scriptManager, overrides core commands, adds Palace commands
    public function PalaceController() {
        scriptManager = new PalaceIptManager(this);
        // Remove core commands that Palace overrides
        scriptManager.parser.removeCommand("ALARMEXEC");
        scriptManager.parser.removeCommand("GREPSTR");
        scriptManager.parser.removeCommand("IPTVERSION");
        // Add Palace-specific commands (which include overridden versions)
        scriptManager.parser.addCommands(PalaceIptscraeCommands.commands);
        scriptManager.addEventListener(IptEngineEvent.TRACE, handleTrace);
    }
    
    // Trigger event on a specific hotspot
    public function triggerHotspotEvent(hotspot:PalaceHotspot, eventType:int):Boolean {
        var tokenList:IptTokenList = hotspot.getEventHandler(eventType);
        if (tokenList) {
            var context:PalaceIptExecutionContext = new PalaceIptExecutionContext(scriptManager);
            context.hotspotId = hotspot.id;
            scriptManager.executeTokenListWithContext(tokenList, context);
            scriptManager.start();
            return true;
        }
        return false;
    }
    
    // Trigger event on all hotspots (iterates backwards + cyborg hotspot)
    public function triggerHotspotEvents(eventType:int):Boolean {
        var ranScripts:Boolean = false;
        for (var i:int = client.currentRoom.hotSpots.length-1; i > -1; i--) {
            var hotspot:PalaceHotspot = client.currentRoom.hotSpots.getItemAt(i);
            if (triggerHotspotEvent(hotspot, eventType)) { ranScripts = true; }
        }
        if (triggerHotspotEvent(client.cyborgHotspot, eventType)) { ranScripts = true; }
        return ranScripts;
    }
    
    // Execute raw script string
    public function executeScript(script:String):void {
        if (scriptManager) {
            scriptManager.execute(script);
            scriptManager.start();
        }
    }
    
    // Set script alarm on a hotspot
    public function setScriptAlarm(tokenList:IptTokenList, spotId:int, futureTime:int):void {
        var context:PalaceIptExecutionContext = new PalaceIptExecutionContext(scriptManager);
        context.hotspotId = spotId;
        var alarm:IptAlarm = new IptAlarm(tokenList, scriptManager, futureTime, context);
        scriptManager.addAlarm(alarm);
    }
    
    // ... 60+ more methods implementing IPalaceController interface
    // Each maps to a Palace protocol action (chat, move, room navigation, etc.)
}
```

### IPalaceController.as (Interface - Key Methods)
```actionscript
public interface IPalaceController
{
    function chat(text:String):void;
    function moveUserAbs(x:int, y:int):void;
    function moveUserRel(xBy:int, yBy:int):void;
    function gotoRoom(roomId:int):void;
    function getSelfPosX():int;
    function getSelfPosY():int;
    function getSelfUserId():int;
    function getSelfUserName():String;
    function getUserName(userId:int):String;
    function getWhoChat():int;
    function getWhoTarget():int;
    function getRoomId():int;
    function getRoomName():String;
    function getServerName():String;
    function getNumRoomUsers():int;
    function getNumSpots():int;
    function getNumDoors():int;
    function getSpotState(spotId:int):int;
    function setSpotState(spotId:int, state:int):void;
    function setSpotStateLocal(spotId:int, state:int):void;
    function getSpotName(spotId:int):String;
    function getSpotDest(spotId:int):int;
    function inSpot(spotId:int):Boolean;
    function isWizard():Boolean;
    function isGod():Boolean;
    function isGuest():Boolean;
    function isLocked(spotId:int):Boolean;
    function lock(spotId:int):void;
    function unlock(spotId:int):void;
    function donPropById(propId:int):void;
    function doffProp():void;
    function naked():void;
    function setFace(faceId:int):void;
    function changeColor(colorNumber:int):void;
    function playSound(soundName:String):void;
    function sendGlobalMessage(message:String):void;
    function sendRoomMessage(message:String):void;
    function sendPrivateMessage(message:String, userId:int):void;
    function setChatString(message:String):void;
    function getChatString():String;
    function clearAlarms():void;
    function setScriptAlarm(tokenList:IptTokenList, spotId:int, futureTime:int):void;
    function setSpotAlarm(spotId:int, futureTime:int):void;
    function triggerHotspotEvent(hotspot:PalaceHotspot, eventType:int):Boolean;
    // ... drawing commands, loose prop commands, etc.
}
```

### Representative Palace Command Pattern
```actionscript
// Simple query: push a value from the palace state
public class ROOMIDCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var pc:PalaceController = PalaceIptManager(context.manager).pc;
        context.stack.push(new IntegerToken(pc.getRoomId()));
    }
}

// Action with args: pop args from stack, perform action
public class MOVECommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var pc:PalaceController = PalaceIptManager(context.manager).pc;
        var yBy:IntegerToken = context.stack.popType(IntegerToken);
        var xBy:IntegerToken = context.stack.popType(IntegerToken);
        pc.moveUserRel(xBy.data, yBy.data);
    }
}

// Action that cancels script
public class GOTOROOMCommand extends IptCommand {
    public override function execute(context:IptExecutionContext):void {
        var roomId:IntegerToken = context.stack.popType(IntegerToken);
        context.exitRequested = true;
        PalaceIptManager(context.manager).pc.gotoRoom(roomId.data);
    }
}

// Boolean query: push 1 or 0
public class ISWIZARDCommand extends IptCommand {
    override public function execute(context:IptExecutionContext):void {
        var isWizard:Boolean = PalaceIptManager(context.manager).pc.isWizard();
        context.stack.push(new IntegerToken(isWizard ? 1 : 0));
    }
}
```

---

## KEY NOTES FOR TYPESCRIPT TRANSLATION

1. **Variable names are case-insensitive** - all uppercased internally
2. **String equality is case-insensitive** (EqualityOperator uppercases both sides)
3. **String inequality is case-SENSITIVE** (InequalityOperator compares directly)
4. **Only integer math** - no floating point (division truncates)
5. **`IptTokenList.clone()` shares the token array** - shallow clone (by design for efficiency)
6. **WHILE/FOREACH implement `Runnable`** - they push themselves onto the call stack for step-through execution, enabling pseudo-threading
7. **`popType()` auto-dereferences variables** - if you pop for `IntegerToken` but get an `IptVariable`, it calls `.dereference()` first
8. **External variables** (like `CHATSTR`) are handled via the execution context, not the variable store
9. **Ticks ≈ 1/60th of a second** (60 ticks per second) - used for alarms
10. **Event handlers** are parsed from `ON EventName { ... }` syntax attached to hotspots
11. **The parser handles `-` ambiguity**: if followed by a digit, it's a negative number; otherwise it's the subtraction operator
12. **`\xNN` hex escapes** in strings use Windows-1252 encoding (for TypeScript, map to the equivalent Unicode code points)
13. **Three command override pattern**: Palace removes core ALARMEXEC, GREPSTR, IPTVERSION and re-adds Palace-specific versions
14. **Cyborg hotspot**: A special hotspot for user-defined scripts, always checked for events after room hotspots
