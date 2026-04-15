import { IptManager } from './IptManager.js';
import { PalaceExecutionContext } from './PalaceExecutionContext.js';
import { logmsg, logerror } from '../interface.js';

export const CyborgEngine = new IptManager();
CyborgEngine.onTrace = (message: string) => logmsg('[CyborgTrace] ' + message);
CyborgEngine.onTraceHtml = (html: string) => logerror(html);
CyborgEngine.executionContextClass = PalaceExecutionContext;
