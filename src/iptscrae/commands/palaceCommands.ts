import { IptCommand } from '../IptCommand.js';
import { IptError } from '../IptError.js';
import type { IptExecutionContext } from '../IptExecutionContext.js';
import { PalaceExecutionContext } from '../PalaceExecutionContext.js';
import { IptTokenList } from '../IptTokenList.js';
import { IptAlarm } from '../IptAlarm.js';
import { IptVariable } from '../IptVariable.js';
import { IntegerToken } from '../tokens/IntegerToken.js';
import { StringToken } from '../tokens/StringToken.js';
import { ArrayToken } from '../tokens/ArrayToken.js';
import { HashToken } from '../tokens/HashToken.js';
import { FileToken } from '../tokens/FileToken.js';
import { palace } from '../../state.js';
import { cyborgHandlers } from '../../cyborgState.js';
import { PalaceRoom } from '../../core.js';
import { cacheProps, loadProps, createNewProps } from '../../props.js';
import { prefs } from '../../preferences.js';
import { spotConsts } from '../../constants.js';

// ── Helper ──

function getPalaceContext(context: IptExecutionContext): PalaceExecutionContext {
	if (context instanceof PalaceExecutionContext) return context;
	throw new IptError('Palace command requires PalaceExecutionContext');
}

// ── Chat & Communication ──

export class SAYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		palace.sendXtlk(msg.data);
	}
}

export class SAYATCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		const msg = context.stack.popType(StringToken);
		palace.sendXtlk('@' + x.data + ',' + y.data + ' ' + msg.data);
	}
}

export class LOCALMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		palace.localmsg(msg.data);
	}
}

export class LOGMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		palace.logmsg(msg.data);
	}
}

export class GLOBALMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		palace.sendGmsg(msg.data);
	}
}

export class ROOMMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		palace.sendRmsg(msg.data);
	}
}

export class PRIVATEMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const userId = context.stack.popType(IntegerToken);
		const msg = context.stack.popType(StringToken);
		palace.sendWhisper(msg.data, userId.data);
	}
}

export class KILLUSERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const userId = context.stack.popType(IntegerToken);
		palace.sendWhisper('`kill', userId.data);
	}
}

export class SUSRMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		palace.sendXtlk(msg.data);
	}
}

export class STATUSMSGCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		const el = document.createElement('div');
		el.textContent = msg.data;
		el.style.cssText =
			'position:fixed;left:8px;' +
			'padding:4px 12px;border-radius:4px;' +
			'background:rgba(0,0,0,0.75);color:#fff;font-size:13px;' +
			'pointer-events:none;white-space:pre;z-index:9999;' +
			'transition:opacity 4s ease-out,bottom 4s ease-out;opacity:1;';
		const chatbox = document.getElementById('chatbox');
		const startBottom = chatbox ? chatbox.offsetHeight + 8 : 40;
		el.style.bottom = `${startBottom}px`;
		document.body.appendChild(el);
		requestAnimationFrame(() => {
			el.style.opacity = '0';
			el.style.bottom = `${startBottom + 120}px`;
		});
		el.addEventListener('transitionend', () => el.remove(), { once: true });
	}
}

// ── Movement & Positioning ──

export class SETPOSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		if (palace.debugMode) console.log(`Setting position to (${x.data}, ${y.data})`);
		palace.setpos(x.data, y.data);
	}
}

export class MOVECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		palace.move(x.data, y.data);
	}
}

export class SETLOCCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		palace.setpos(x.data, y.data);
	}
}

export class SETLOCLOCALCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				spot.x = x.data;
				spot.y = y.data;
				palace.theRoom.setSpotImg(spot);
				palace.theRoom.refreshTop();
			}
		}
	}
}

export class POSXCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theUser ? palace.theUser.x : 0));
	}
}

export class POSYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theUser ? palace.theUser.y : 0));
	}
}

// ── Room Navigation & Info ──

export class GOTOROOMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const roomId = context.stack.popType(IntegerToken);
		context.exitRequested = true;
		palace.gotoroom(roomId.data);
	}
}

export class NETGOTOCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const url = context.stack.popType(StringToken);
		(window as any).apiBridge.launchHyperLink(url.data);
	}
}

export class ROOMIDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theRoom ? palace.theRoom.id : 0));
	}
}

export class ROOMNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(palace.theRoom ? palace.theRoom.name : ''));
	}
}

export class SERVERNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(palace.servername || ''));
	}
}

export class ROOMWIDTHCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.roomWidth));
	}
}

export class ROOMHEIGHTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.roomHeight));
	}
}

export class NBRROOMUSERSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theRoom ? palace.theRoom.users?.length : 0));
	}
}

export class NBRSPOTSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theRoom ? palace.theRoom.spots.length : 0));
	}
}

export class NBRDOORSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (!palace.theRoom) {
			context.stack.push(IntegerToken.ZERO);
			return;
		}
		let count = 0;
		for (const spot of palace.theRoom.spots) {
			if (spot.type > 0) count++;
		}
		context.stack.push(new IntegerToken(count));
	}
}

// ── User Identity & Info ──

export class MECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const palCtx = getPalaceContext(context);
		context.stack.push(new IntegerToken(palCtx.hotspotId));
	}
}

export class WHOMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theUserID || 0));
	}
}

export class USERIDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theUserID || 0));
	}
}

export class USERNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(palace.theUser ? palace.theUser.name : ''));
	}
}

export class WHOCHATCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const palCtx = getPalaceContext(context);
		context.stack.push(new IntegerToken(palCtx.whoChatId));
	}
}

export class WHOTARGETCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theRoom?.whisperUserID || 0));
	}
}

export class WHONAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const userId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const user = palace.theRoom.getUser(userId.data);
			context.stack.push(new StringToken(user ? user.name : ''));
		} else {
			context.stack.push(new StringToken(''));
		}
	}
}

export class WHOPOSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const userId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const user = palace.theRoom.getUser(userId.data);
			if (user) {
				context.stack.push(new IntegerToken(user.x));
				context.stack.push(new IntegerToken(user.y));
				return;
			}
		}
		context.stack.push(IntegerToken.ZERO);
		context.stack.push(IntegerToken.ZERO);
	}
}

export class ROOMUSERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theRoom && index.data >= 0 && index.data < palace.theRoom.users.length) {
			context.stack.push(new IntegerToken(palace.theRoom.users[index.data].id));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

// ── User Permissions & Status ──

export class ISWIZARDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(palace.isOperator ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

export class ISGODCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(palace.isOwner ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

export class ISGUESTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(!palace.isOperator && !palace.isOwner ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

// ── Avatar Appearance ──

export class SETFACECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const face = context.stack.popType(IntegerToken);
		palace.sendFace(face.data);
	}
}

export class SETCOLORCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const color = context.stack.popType(IntegerToken);
		palace.sendFaceColor(color.data);
	}
}

export class DONPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const propId = context.stack.popType(IntegerToken);
		palace.donprop(propId.data);
	}
}

export class DOFFPROPCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		if (palace.theUser && palace.theUser.props.length > 0) {
			const lastProp = palace.theUser.props[palace.theUser.props.length - 1];
			palace.removeprop(lastProp);
		}
	}
}

export class NAKEDCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		if (palace.theUser) {
			palace.setprops([]);
		}
	}
}

export class SETPROPSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const top = context.stack.pop();
		const props: number[] = [];
		if (top instanceof ArrayToken) {
			for (const token of top.data) {
				if (token instanceof IntegerToken) {
					props.push(token.data);
				}
			}
		} else if (top instanceof IntegerToken) {
			const count = top.data;
			for (let i = 0; i < count && i < 9; i++) {
				props.unshift(context.stack.popType(IntegerToken).data);
			}
		}
		palace.setprops(props);
	}
}

export class NBRUSERPROPSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theUser ? palace.theUser.props.length : 0));
	}
}

export class HASPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(
			palace.theUser && palace.theUser.props.length > 0 ? IntegerToken.ONE : IntegerToken.ZERO
		);
	}
}

export class TOPPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (palace.theUser && palace.theUser.props.length > 0) {
			context.stack.push(new IntegerToken(palace.theUser.props[palace.theUser.props.length - 1]));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class USERPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theUser && index.data >= 0 && index.data < palace.theUser.props.length) {
			context.stack.push(new IntegerToken(palace.theUser.props[index.data]));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class REMOVEPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const propId = context.stack.popType(IntegerToken);
		palace.removeprop(propId.data);
	}
}

export class IMAGETOPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const fileName = context.stack.popType(StringToken);
		const palCtx = getPalaceContext(context);
		if (palCtx.hotspotId === -999) {
			throw new IptError('IMAGETOPROP is not available for Cyborg scripting');
		}
		if (!palace.theRoom) return;
		let picImg: HTMLImageElement | null = null;
		for (const pic of palace.theRoom.pics) {
			if (pic && pic.name === fileName.data && pic.img && pic.img.naturalWidth > 0) {
				picImg = pic.img;
				break;
			}
		}
		if (!picImg) return;
		const canvas = document.createElement('canvas');
		canvas.width = picImg.naturalWidth;
		canvas.height = picImg.naturalHeight;
		const ctx2d = canvas.getContext('2d')!;
		ctx2d.drawImage(picImg, 0, 0);
		canvas.toBlob((blob) => {
			if (blob) {
				createNewProps([blob]);
			}
		}, 'image/png');
	}
}

// ── Spot / Hotspot Operations ──

export class SPOTIDXCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theRoom && index.data >= 0 && index.data < palace.theRoom.spots.length) {
			context.stack.push(new IntegerToken(palace.theRoom.spots[index.data].id));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class GETSPOTSTATECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			context.stack.push(new IntegerToken(spot ? spot.state : 0));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class SETSPOTSTATECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		palace.sendSpotState(spotId.data, state.data);
	}
}

export class SETSPOTSTATELOCALCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			palace.theRoom.spotStateChange({
				roomid: palace.theRoom.id,
				spotid: spotId.data,
				state: state.data
			});
		}
	}
}

export class SPOTNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			context.stack.push(new StringToken(spot ? spot.name : ''));
		} else {
			context.stack.push(new StringToken(''));
		}
	}
}

export class SPOTDESTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			context.stack.push(new IntegerToken(spot ? spot.dest : 0));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class DESTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const palCtx = getPalaceContext(context);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(palCtx.hotspotId);
			context.stack.push(new IntegerToken(spot ? spot.dest : 0));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class GETSPOTLOCCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				context.stack.push(new IntegerToken(spot.x));
				context.stack.push(new IntegerToken(spot.y));
				return;
			}
		}
		context.stack.push(IntegerToken.ZERO);
		context.stack.push(IntegerToken.ZERO);
	}
}

export class INSPOTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom && palace.theUser) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				const dx = palace.theUser.x - spot.x;
				const dy = palace.theUser.y - spot.y;
				const inRange = (dx * dx + dy * dy) < (22 * 22);
				context.stack.push(inRange ? IntegerToken.ONE : IntegerToken.ZERO);
				return;
			}
		}
		context.stack.push(IntegerToken.ZERO);
	}
}

export class DOORIDXCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			let count = 0;
			for (const spot of palace.theRoom.spots) {
				if (spot.type > 0) {
					if (count === index.data) {
						context.stack.push(new IntegerToken(spot.id));
						return;
					}
					count++;
				}
			}
		}
		context.stack.push(IntegerToken.ZERO);
	}
}

export class ISLOCKEDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				context.stack.push(spot.state !== 0 ? IntegerToken.ONE : IntegerToken.ZERO);
				return;
			}
		}
		context.stack.push(IntegerToken.ZERO);
	}
}

export class LOCKCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		palace.sendLockRoom(spotId.data);
	}
}

export class UNLOCKCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		palace.sendUnlockRoom(spotId.data);
	}
}

// ── Loose Props ──

export class NBRLOOSEPROPSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(
			palace.theRoom ? palace.theRoom.nbrLooseProps : 0
		));
	}
}

export class ADDLOOSEPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		const propId = context.stack.popType(IntegerToken);
		palace.sendPropDrop(x.data, y.data, propId.data);
	}
}

export class DROPPROPCommand extends IptCommand {
    override execute(context: IptExecutionContext): void {
        const y = context.stack.popType(IntegerToken);
        const x = context.stack.popType(IntegerToken);

        // DROPPROP: use the user's topmost worn prop, then remove it
        if (!palace.theUser || palace.theUser.props.length === 0) {
            return;
        }

        const propId = palace.theUser.props[palace.theUser.props.length - 1];
        palace.sendPropDrop(x.data, y.data, propId);
        palace.removeprop(propId);
    }
}

export class REMOVELOOSEPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		palace.sendPropDelete(index.data);
	}
}

export class MOVELOOSEPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		palace.sendPropMove(x.data, y.data, index.data);
	}
}

export class CLEARLOOSEPROPSCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		if (palace.theRoom) {
			palace.sendPropDelete(-1);
		}
	}
}

export class LOOSEPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theRoom && index.data >= 0 && index.data < palace.theRoom.looseProps.length) {
			context.stack.push(new IntegerToken(palace.theRoom.looseProps[index.data].id));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class LOOSEPROPIDXCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theRoom && index.data >= 0 && index.data < palace.theRoom.looseProps.length) {
			context.stack.push(new IntegerToken(palace.theRoom.looseProps[index.data].id));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class LOOSEPROPPOSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const index = context.stack.popType(IntegerToken);
		if (palace.theRoom && index.data >= 0 && index.data < palace.theRoom.looseProps.length) {
			const lp = palace.theRoom.looseProps[index.data];
			context.stack.push(new IntegerToken(lp.x));
			context.stack.push(new IntegerToken(lp.y));
		} else {
			context.stack.push(IntegerToken.ZERO);
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

// ── Audio ──

export class SOUNDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const name = context.stack.popType(StringToken);
		palace.playSound(name.data);
	}
}

export class MIDIPLAYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const name = context.stack.popType(StringToken);
		palace.playSound(name.data);
	}
}

export class MIDILOOPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const name = context.stack.popType(StringToken);
		palace.playSound(name.data);
	}
}

export class MIDISTOPCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		// No dedicated stop mechanism available
	}
}

// ── Drawing ──

export const iptPen = {
	posX: 0,
	posY: 0,
	size: 1,
	color: [0, 0, 0] as number[],
	opacity: 255,
	fillColor: [0, 0, 0] as number[],
	fillOpacity: 0,
	front: false,
};

function sendIptDraw(type: number, points: number[]): void {
	palace.sendDraw({
		type,
		front: iptPen.front,
		size: iptPen.size,
		color: [iptPen.color[0], iptPen.color[1], iptPen.color[2], iptPen.opacity / 255] as any,
		fill: [iptPen.fillColor[0], iptPen.fillColor[1], iptPen.fillColor[2], iptPen.fillOpacity / 255] as any,
		points
	});
}

export class LINECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y2 = context.stack.popType(IntegerToken);
		const x2 = context.stack.popType(IntegerToken);
		const y1 = context.stack.popType(IntegerToken);
		const x1 = context.stack.popType(IntegerToken);
		sendIptDraw(0, [x1.data, y1.data, x2.data, y2.data]);
		iptPen.posX = x2.data;
		iptPen.posY = y2.data;
	}
}

export class LINETOCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const dy = context.stack.popType(IntegerToken);
		const dx = context.stack.popType(IntegerToken);
		const endX = iptPen.posX + dx.data;
		const endY = iptPen.posY + dy.data;
		sendIptDraw(0, [iptPen.posX, iptPen.posY, endX, endY]);
		iptPen.posX = endX;
		iptPen.posY = endY;
	}
}

export class PENCOLORCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const b = context.stack.popType(IntegerToken);
		const g = context.stack.popType(IntegerToken);
		const r = context.stack.popType(IntegerToken);
		iptPen.color = [r.data, g.data, b.data];
	}
}

export class PENSIZECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const size = context.stack.popType(IntegerToken);
		iptPen.size = size.data;
	}
}

export class PENPOSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		iptPen.posX = x.data;
		iptPen.posY = y.data;
	}
}

export class PENTOCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		iptPen.posX = x.data;
		iptPen.posY = y.data;
	}
}

export class PENFRONTCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		iptPen.front = true;
	}
}

export class PENBACKCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		iptPen.front = false;
	}
}

export class PENOPACITYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const opacity = context.stack.popType(IntegerToken);
		iptPen.opacity = opacity.data;
	}
}

export class PENFILLCOLORCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const b = context.stack.popType(IntegerToken);
		const g = context.stack.popType(IntegerToken);
		const r = context.stack.popType(IntegerToken);
		iptPen.fillColor = [r.data, g.data, b.data];
	}
}

export class PENFILLOPACITYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const opacity = context.stack.popType(IntegerToken);
		iptPen.fillOpacity = opacity.data;
	}
}

export class POLYGONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arr = context.stack.popType(ArrayToken);
		const points: number[] = [];
		for (const token of arr.data) {
			if (token instanceof IntegerToken) points.push(token.data);
		}
		sendIptDraw(1, points);
	}
}

export class PAINTCLEARCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		palace.sendDrawClear(3); // drawType.CLEAN
	}
}

export class PAINTUNDOCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		palace.sendDrawClear(4); // drawType.UNDO
	}
}

// ── Timer / Alarm ──

export class SETALARMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const futureTicks = context.stack.popType(IntegerToken);
		const palCtx = getPalaceContext(context);
		// If running from cyborg context, execute cyborg ALARM event if present
		if (palCtx.hotspotId === -999 && cyborgHandlers && cyborgHandlers['ALARM']) {
			const tokenList = cyborgHandlers['ALARM'];
			const ctx = new PalaceExecutionContext(context.manager);
			ctx.hotspotId = -999;
			const alarm = new IptAlarm(tokenList, context.manager, futureTicks.data, ctx);
			alarm.isCyborg = true;
			context.manager.addAlarm(alarm);
			return;
		}
		// Otherwise, execute spot ALARM event as before
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot || !spot.handlers || !spot.handlers['ALARM']) return;
		const tokenList = spot.handlers['ALARM'];
		const ctx = new PalaceExecutionContext(context.manager);
		ctx.hotspotId = spotId.data;
		const alarm = new IptAlarm(tokenList, context.manager, futureTicks.data, ctx);
		alarm.isCyborg = false;
		context.manager.addAlarm(alarm);
	}
}

// ── Client Info ──

const cachedClientType = (() => {
	const platform = navigator.platform?.toLowerCase() || '';
	return platform.includes('win') ? 'WINDOWS64' : platform.includes('mac') ? 'MACINTOSH' : 'UNIX';
})();

export class CLIENTTYPECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(cachedClientType));
	}
}

export class OPENPALACECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(IntegerToken.ZERO);
	}
}

let cachedPalaceChatVersion: number | null = null;

export class PALACECHATCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (cachedPalaceChatVersion === null) {
			const digits = palace.clientVersion.replace(/\D/g, '').slice(1);
			cachedPalaceChatVersion = parseInt('50' + digits, 10) || 50000;
		}
		context.stack.push(new IntegerToken(cachedPalaceChatVersion));
	}
}

export class MACROCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const script = context.stack.popType(StringToken);
		context.manager.executeWithContext(script.data, context);
	}
}

export class SELECTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const palCtx = getPalaceContext(context);
		palCtx.hotspotId = spotId.data;
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				palace.theRoom.selectSpot(spot);
			}
		}
	}
}

// ── Unsupported (no-op) ──

export class UnsupportedCommand extends IptCommand {
	// Silently consume and do nothing
}

// ── Extended Iptscrae Commands ──

export class CHARTONUMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const str = context.stack.popType(StringToken);
		context.stack.push(new IntegerToken(str.data.length > 0 ? str.data.charCodeAt(0) : 0));
	}
}

export class NUMTOCHARCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const num = context.stack.popType(IntegerToken);
		context.stack.push(new StringToken(String.fromCharCode(num.data)));
	}
}

export class REPLACECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const source = context.stack.popType(StringToken);
		const newStr = context.stack.popType(StringToken);
		const oldStr = context.stack.popType(StringToken);
		context.stack.push(new StringToken(source.data.replace(oldStr.data, newStr.data)));
	}
}

export class REPLACEALLCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const source = context.stack.popType(StringToken);
		const newStr = context.stack.popType(StringToken);
		const oldStr = context.stack.popType(StringToken);
		context.stack.push(new StringToken(source.data.split(oldStr.data).join(newStr.data)));
	}
}

export class ENCODEURLCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const str = context.stack.popType(StringToken);
		context.stack.push(new StringToken(encodeURIComponent(str.data)));
	}
}

export class DECODEURLCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const str = context.stack.popType(StringToken);
		context.stack.push(new StringToken(decodeURIComponent(str.data)));
	}
}

export class BITANDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const b = context.stack.popType(IntegerToken);
		const a = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(a.data & b.data));
	}
}

export class BITORCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const b = context.stack.popType(IntegerToken);
		const a = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(a.data | b.data));
	}
}

export class BITXORCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const b = context.stack.popType(IntegerToken);
		const a = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(a.data ^ b.data));
	}
}

export class BITSHIFTLEFTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const amount = context.stack.popType(IntegerToken);
		const value = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(value.data << amount.data));
	}
}

export class BITSHIFTRIGHTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const amount = context.stack.popType(IntegerToken);
		const value = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(value.data >> amount.data));
	}
}

export class NBRSERVERUSERSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.serverUserCount));
	}
}

export class CLIENTIDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.clientId || 0));
	}
}

export class GETTIMEZONECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(Intl.DateTimeFormat().resolvedOptions().timeZone));
	}
}

export class MEDIAADDRESSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(palace.mediaUrl || ''));
	}
}

export class ROOMPICNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new StringToken(palace.theRoom ? palace.theRoom.background : ''));
	}
}

export class WHOCOLORCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const userId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const user = palace.theRoom.getUser(userId.data);
			context.stack.push(new IntegerToken(user ? user.color : 0));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class WHOFACECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const userId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const user = palace.theRoom.getUser(userId.data);
			context.stack.push(new IntegerToken(user ? user.face : 0));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class ISFUNCTIONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const name = context.stack.popType(StringToken);
		const exists = context.manager.parser.getCommand(name.data) !== undefined;
		context.stack.push(exists ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

export class SETUSERNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const name = context.stack.popType(StringToken);
		palace.sendUserName(name.data);
	}
}

export class ISRIGHTCLICKCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const palCtx = getPalaceContext(context);
		context.stack.push(palCtx.isRightClick ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

export class LOCINSPOTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				const dx = x.data - spot.x;
				const dy = y.data - spot.y;
				const inRange = (dx * dx + dy * dy) < (22 * 22);
				context.stack.push(inRange ? IntegerToken.ONE : IntegerToken.ZERO);
				return;
			}
		}
		context.stack.push(IntegerToken.ZERO);
	}
}

export class GETROOMOPTIONSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theRoom ? palace.theRoom.flags : 0));
	}
}

export class SETSPOTNAMELOCALCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const name = context.stack.popType(StringToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				spot.name = name.data;
				palace.theRoom.setSpotNameTag(spot);
				palace.theRoom.refreshTop();
			}
		}
	}
}

// ── Extended Iptscrae Commands (Batch 2) ──

// Timer / Alarm

export class TIMEREXECCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const delayTicks = context.stack.popType(IntegerToken);
		const tokenList = context.stack.popType(IptTokenList);
		const alarm = new IptAlarm(tokenList, context.manager, delayTicks.data, context.cloneSharedScope());
		if (context instanceof PalaceExecutionContext && context.hotspotId === -999) {
			alarm.isCyborg = true;
		}
		context.manager.addAlarm(alarm);
	}
}

export class STOPALARMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const callerIsCyborg = context instanceof PalaceExecutionContext && context.hotspotId === -999;
		const toRemove = context.manager.alarms.filter((a) => {
			return a.isCyborg === callerIsCyborg
				&& a.context instanceof PalaceExecutionContext && a.context.hotspotId === spotId.data;
		});
		for (const alarm of toRemove) {
			context.manager.removeAlarm(alarm);
		}
	}
}

export class STOPALARMSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const callerIsCyborg = context instanceof PalaceExecutionContext && context.hotspotId === -999;
		context.manager.clearAlarmsByScope(callerIsCyborg);
	}
}

// Prop Info

export class PROPDIMENSIONSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const propId = context.stack.popType(IntegerToken);
		const prop = cacheProps[propId.data];
		if (prop && prop.isComplete) {
			context.stack.push(new IntegerToken(prop.w));
			context.stack.push(new IntegerToken(prop.h));
		} else {
			context.stack.push(IntegerToken.ZERO);
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class PROPOFFSETSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const propId = context.stack.popType(IntegerToken);
		const prop = cacheProps[propId.data];
		if (prop) {
			context.stack.push(new IntegerToken(prop.x));
			context.stack.push(new IntegerToken(prop.y));
		} else {
			context.stack.push(IntegerToken.ZERO);
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class LOADPROPSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arr = context.stack.popType(ArrayToken);
		const ids: number[] = [];
		for (const token of arr.data) {
			if (token instanceof IntegerToken) {
				ids.push(token.data);
			}
		}
		if (ids.length > 0) {
			loadProps(ids);
		}
	}
}

// Regex

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

export class REGEXPREPLACECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const sourceString = context.stack.popType(StringToken);
		const matchdata = context.manager.grepMatchData;
		let result = sourceString.data;
		if (matchdata) {
			for (let i = 0; i < matchdata.length; i++) {
				const re = new RegExp('\\$' + i.toString(), 'g');
				result = result.replace(re, matchdata[i]);
			}
		}
		context.stack.push(new StringToken(result));
	}
}

// Dialog Boxes

export class ALERTBOXCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);
		alert(msg.data);
	}
}

export class CONFIRMBOXCommand extends IptCommand {
	private _running = false;
	private waiting = true;

	override get running(): boolean { return this._running; }

	override execute(context: IptExecutionContext): void {
		const msg = context.stack.popType(StringToken);

		this._running = true;
		this.waiting = true;
		context.manager.callStack.push(this);

		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';
		const box = document.createElement('div');
		box.className = 'dlg-box';
		box.style.maxWidth = '400px';
		const label = document.createElement('p');
		label.className = 'dlg-message';
		label.textContent = msg.data;
		const btnRow = document.createElement('div');
		btnRow.className = 'dlg-buttons';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'dlg-btn-cancel';
		cancelBtn.textContent = 'Cancel';
		const okBtn = document.createElement('button');
		okBtn.className = 'dlg-btn-ok';
		okBtn.textContent = 'OK';
		btnRow.appendChild(cancelBtn);
		btnRow.appendChild(okBtn);
		box.appendChild(label);
		box.appendChild(btnRow);
		overlay.appendChild(box);
		document.body.appendChild(overlay);
		okBtn.focus();

		const finish = (result: boolean) => {
			overlay.remove();
			context.stack.push(result ? IntegerToken.ONE : IntegerToken.ZERO);
			this.waiting = false;
		};

		okBtn.addEventListener('click', () => finish(true));
		cancelBtn.addEventListener('click', () => finish(false));
		overlay.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') finish(true);
			else if (e.key === 'Escape') finish(false);
		});
	}

	override step(): void {
		if (!this.waiting) {
			this.end();
		}
	}

	override end(): void {
		this._running = false;
	}
}

export class PROMPTCommand extends IptCommand {
	private _running = false;
	private waiting = true;

	override get running(): boolean { return this._running; }

	override execute(context: IptExecutionContext): void {
		const defaultValue = context.stack.popType(StringToken);
		const msg = context.stack.popType(StringToken);

		this._running = true;
		this.waiting = true;
		context.manager.callStack.push(this);

		const overlay = document.createElement('div');
		overlay.className = 'dlg-overlay';
		const box = document.createElement('div');
		box.className = 'dlg-box';
		box.style.maxWidth = '400px';
		const label = document.createElement('p');
		label.className = 'dlg-message';
		label.textContent = msg.data;
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'dlg-input';
		input.value = defaultValue.data;
		const btnRow = document.createElement('div');
		btnRow.className = 'dlg-buttons';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'dlg-btn-cancel';
		cancelBtn.textContent = 'Cancel';
		const okBtn = document.createElement('button');
		okBtn.className = 'dlg-btn-ok';
		okBtn.textContent = 'OK';
		btnRow.appendChild(cancelBtn);
		btnRow.appendChild(okBtn);
		box.appendChild(label);
		box.appendChild(input);
		box.appendChild(btnRow);
		overlay.appendChild(box);
		document.body.appendChild(overlay);
		input.focus();
		input.select();

		const finish = (value: string) => {
			overlay.remove();
			context.stack.push(new StringToken(value));
			this.waiting = false;
		};

		okBtn.addEventListener('click', () => finish(input.value));
		cancelBtn.addEventListener('click', () => finish(''));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') finish(input.value);
			else if (e.key === 'Escape') finish('');
		});
	}

	override step(): void {
		if (!this.waiting) {
			this.end();
		}
	}

	override end(): void {
		this._running = false;
	}
}

// Text-to-Speech

export class TEXTSPEECHCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const text = context.stack.popType(StringToken);
		if ('speechSynthesis' in window) {
			const utterance = new SpeechSynthesisUtterance(text.data);
			speechSynthesis.speak(utterance);
		}
	}
}

// Auto User Layer

export class AUTOUSERLAYERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const on = context.stack.popType(IntegerToken).data !== 0;
		if (palace.theRoom) {
			palace.theRoom.autoUserLayer = on;
			for (const user of palace.theRoom.users) {
				if (on) {
					user.domAvatar.style.zIndex = String(user.y);
					user.domNametag.style.zIndex = String(user.y + 100);
				} else {
					user.domAvatar.style.zIndex = '';
					user.domNametag.style.zIndex = '';
				}
			}
		}
	}
}

// Avatar Visibility

export class HIDEAVATARSCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		if (palace.theRoom) {
			for (const user of palace.theRoom.users) {
				user.domAvatar.style.display = 'none';
			}
		}
	}
}

// ── DIMROOM ──

export class DIMROOMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const num = context.stack.popType(IntegerToken).data;
		const overlay = document.getElementById('dimoverlay');
		if (!overlay) return;
		if (num <= 0 || num >= 100) {
			overlay.style.opacity = '0';
		} else {
			overlay.style.opacity = String((100 - num) / 100);
		}
	}
}

export class SHOWAVATARSCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		if (palace.theRoom) {
			for (const user of palace.theRoom.users) {
				user.domAvatar.style.display = '';
			}
		}
	}
}

// Spot Options

const LAYER_FLAG_BITS = spotConsts.PicturesAboveAll | spotConsts.PicturesAboveProps | spotConsts.PicturesAboveNameTags;

function flagsToLayer(flags: number): number {
	if (flags & spotConsts.PicturesAboveAll) return 3;
	if (flags & spotConsts.PicturesAboveNameTags) return 2;
	if (flags & spotConsts.PicturesAboveProps) return 1;
	return 0;
}

function layerToFlags(layer: number): number {
	switch (layer) {
		case 1: return spotConsts.PicturesAboveProps;
		case 2: return spotConsts.PicturesAboveNameTags;
		case 3: return spotConsts.PicturesAboveAll;
		default: return 0;
	}
}

export class GETSPOTOPTIONSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				context.stack.push(new IntegerToken(spot.flags & ~LAYER_FLAG_BITS));
				context.stack.push(new IntegerToken(flagsToLayer(spot.flags)));
				context.stack.push(new IntegerToken(spot.type));
				return;
			}
		}
		context.stack.push(IntegerToken.ZERO);
		context.stack.push(IntegerToken.ZERO);
		context.stack.push(IntegerToken.ZERO);
	}
}

export class SETSPOTOPTIONSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const type = context.stack.popType(IntegerToken);
		const layer = context.stack.popType(IntegerToken);
		const options = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			palace.theRoom.backupSpot(spot);
			spot.flags = (options.data & ~LAYER_FLAG_BITS) | layerToFlags(layer.data);
			spot.toplayer = layer.data > 0;
			spot.type = type.data;
			palace.theRoom.invalidateSpot(spot);
		}
	}
}

// Spot Style

function parseArgbString(s: string): string {
	let hex = s;
	if (hex.startsWith('&h') || hex.startsWith('&H')) hex = hex.substring(2);
	if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.substring(2);
	hex = hex.padStart(8, '0');
	const a = parseInt(hex.substring(0, 2), 16) / 255;
	const r = parseInt(hex.substring(2, 4), 16);
	const g = parseInt(hex.substring(4, 6), 16);
	const b = parseInt(hex.substring(6, 8), 16);
	return `rgba(${r},${g},${b},${a})`;
}

function intArgbToRgba(val: number): string {
	const a = ((val >>> 24) & 0xFF) / 255;
	const r = (val >>> 16) & 0xFF;
	const g = (val >>> 8) & 0xFF;
	const b = val & 0xFF;
	return `rgba(${r},${g},${b},${a})`;
}

/** Pop a color value — accepts integer ARGB or "&hAARRGGBB" string. */
function popColor(context: IptExecutionContext): string {
	const tok = context.stack.pop();
	const token = tok instanceof IptVariable ? tok.dereference() : tok;
	if (token instanceof IntegerToken) {
		return intArgbToRgba(token.data);
	}
	if (token instanceof StringToken) {
		return parseArgbString(token.data);
	}
	return 'rgba(0,0,0,0)';
}

export class SETSPOTSTYLECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const borderSize = context.stack.popType(IntegerToken);
		const borderColor = popColor(context);
		const backgroundColor = popColor(context);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			spot.spotStyle = {
				backgroundColor,
				borderColor,
				borderSize: borderSize.data,
			};
			// Toggle ShowFrame flag based on borderSize
			if (borderSize.data <= 0 && (spot.flags & spotConsts.ShowFrame)) {
				spot.flags = spot.flags ^ spotConsts.ShowFrame;
			} else if (borderSize.data > 0 && !(spot.flags & spotConsts.ShowFrame)) {
				spot.flags = spot.flags | spotConsts.ShowFrame;
			}
			palace.theRoom.setSpotImg(spot);
			palace.theRoom.reDraw();
			palace.theRoom.reDrawTop();
		}
	}
}

export class SETSPOTCLIPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const clipMode = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			spot.clipMode = clipMode.data;
			palace.theRoom.updateClipRegionCount();
			// Mode 2 affects other spots' clipping — refresh all synchronously
			for (const s of palace.theRoom.spots) palace.theRoom.setSpotImg(s);
			palace.theRoom.reDraw();
			palace.theRoom.reDrawTop();
		}
	}
}

export class SETSPOTCURVECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const tension = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			spot.curveTension = tension.data;
			if (spot.clipMode === 2) {
				// Curve change on a mode-2 region affects other spots
				for (const s of palace.theRoom.spots) palace.theRoom.setSpotImg(s);
			} else {
				palace.theRoom.setSpotImg(spot);
			}
			palace.theRoom.reDraw();
			palace.theRoom.reDrawTop();
		}
	}
}

export class SETSPOTGRADIENTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const angle = context.stack.popType(IntegerToken);
		const secondColor = popColor(context);
		const firstColor = popColor(context);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			spot.spotGradient = {
				firstColor,
				secondColor,
				angle: angle.data,
			};
			spot.spotPathGradient = undefined;
			palace.theRoom.reDraw();
			palace.theRoom.reDrawTop();
		}
	}
}

export class SETSPOTPATHGRADIENTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const useSpotPoint = context.stack.popType(IntegerToken);
		const centerColor = popColor(context);
		const surroundToken = context.stack.pop();
		const surround = surroundToken instanceof IptVariable ? surroundToken.dereference() : surroundToken;
		let surroundColors: string[];
		if (surround instanceof ArrayToken) {
			surroundColors = surround.data.map(t => {
				if (t instanceof IntegerToken) return intArgbToRgba(t.data);
				if (t instanceof StringToken) return parseArgbString(t.data);
				return 'rgba(0,0,0,0)';
			});
		} else {
			const color = surround instanceof IntegerToken ? intArgbToRgba(surround.data)
				: surround instanceof StringToken ? parseArgbString(surround.data)
				: 'rgba(0,0,0,0)';
			surroundColors = [color];
		}
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			spot.spotPathGradient = {
				centerColor,
				surroundColors,
				useSpotPoint: useSpotPoint.data !== 0,
			};
			spot.spotGradient = undefined;
			palace.theRoom.reDraw();
			palace.theRoom.reDrawTop();
		}
	}
}

// Spot Points / Geometry

export class GETSPOTPOINTSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot && spot.points) {
				const tokens: IntegerToken[] = spot.points.map((p: number) => new IntegerToken(p));
				context.stack.push(new ArrayToken(tokens));
				return;
			}
		}
		context.stack.push(new ArrayToken([]));
	}
}

export class SETSPOTPOINTSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const yLoc = context.stack.popType(IntegerToken);
		const xLoc = context.stack.popType(IntegerToken);
		const arr = context.stack.popType(ArrayToken);
		if (arr.data.length % 2 !== 0) {
			throw new IptError('SETSPOTPOINTS: array must have an even number of entries (x,y pairs).');
		}
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				palace.theRoom.backupSpot(spot);
				spot.points = arr.data.map((t) => {
					const v = t instanceof IptVariable ? t.dereference() : t;
					if (v instanceof IntegerToken) return v.data;
					if (v instanceof StringToken) return parseInt(v.data, 10) || 0;
					return 0;
				});
				spot.x = xLoc.data;
				spot.y = yLoc.data;
				palace.theRoom.invalidateSpot(spot);
			}
		}
	}
}

// Spot Location (set locally)

export class SETSPOTLOCCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				spot.x = x.data;
				spot.y = y.data;
			}
		}
	}
}

export class SETPICLOCLOCALCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				const idx = state.data < 0 ? spot.state : state.data;
				if (spot.statepics[idx]) {
					spot.statepics[idx].x = x.data;
					spot.statepics[idx].y = y.data;
					palace.theRoom.setSpotImg(spot);
				}
			}
		}
	}
}

export class SETPICLOCCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		context.stack.popType(IntegerToken); // state (consumed but unused by wire protocol)
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		palace.sendPictMove(spotId.data, y.data, x.data);
	}
}

// Math Utilities

export class ROUNDNUMCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const val = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(Math.round(val.data)));
	}
}

export class ABSVALUECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const val = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(Math.abs(val.data)));
	}
}

export class SQRTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const val = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(Math.floor(Math.sqrt(Math.abs(val.data)))));
	}
}

export class POWERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const exp = context.stack.popType(IntegerToken);
		const base = context.stack.popType(IntegerToken);
		context.stack.push(new IntegerToken(Math.floor(Math.pow(base.data, exp.data))));
	}
}

// ── Hash Commands ──

export class NEWHASHCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new HashToken());
	}
}

export class HASHTOJSONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const hash = context.stack.pop().dereference();
		if (hash instanceof HashToken) {
			context.stack.push(new StringToken(hashToJsonString(hash)));
		} else {
			throw new IptError('HASHTOJSON requires a HashToken.');
		}
	}
}

export class JSONTOHASHCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const jsonStr = context.stack.popType(StringToken);
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonStr.data);
		} catch {
			throw new IptError('JSONTOHASH: invalid JSON string.');
		}
		context.stack.push(jsValueToToken(parsed));
	}
}

function hashToJsonString(hash: HashToken): string {
	const obj: Record<string, unknown> = {};
	for (const [key, value] of hash.data) {
		obj[key] = tokenToJsValue(value);
	}
	return JSON.stringify(obj);
}

function tokenToJsValue(token: IptToken): unknown {
	if (token instanceof StringToken) return token.data;
	if (token instanceof IntegerToken) return token.data;
	if (token instanceof HashToken) {
		const obj: Record<string, unknown> = {};
		for (const [key, value] of token.data) {
			obj[key] = tokenToJsValue(value);
		}
		return obj;
	}
	if (token instanceof ArrayToken) {
		return token.data.map(tokenToJsValue);
	}
	return null;
}

function jsValueToToken(value: unknown): IptToken {
	if (value === null || value === undefined) return IntegerToken.ZERO;
	if (typeof value === 'string') return new StringToken(value);
	if (typeof value === 'number') return new IntegerToken(Math.floor(value));
	if (typeof value === 'boolean') return value ? IntegerToken.ONE : IntegerToken.ZERO;
	if (Array.isArray(value)) {
		return new ArrayToken(value.map(jsValueToToken));
	}
	if (typeof value === 'object') {
		const hash = new HashToken();
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			hash.data.set(k, jsValueToToken(v));
		}
		return hash;
	}
	return IntegerToken.ZERO;
}

// ── HTTP Commands ──

import { IptToken } from '../IptToken.js';


const httpCustomHeaders = new Map<string, string>();
const httpRequestSpotIds = new WeakMap<XMLHttpRequest, number>();
const httpRequests = new Set<XMLHttpRequest>();

export function abortAllIptscraeHttpRequests() {
	for (const xhr of httpRequests) {
		try { xhr.abort(); } catch {}
	}
	httpRequests.clear();
}

function buildDefaultHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		'Userkey': String((prefs as any).registration?.puid ?? 0),
		'Accept-Language': navigator.language || 'en',
		'Palace-Address': `palace://${palace.ip || ''}:${palace.port || '9998'}/${palace.theRoom?.id ?? 0}`,
	};
	for (const [k, v] of httpCustomHeaders) {
		headers[k] = v;
	}
	return headers;
}

export class ADDHEADERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const value = context.stack.popType(StringToken);
		const name = context.stack.popType(StringToken);
		httpCustomHeaders.set(name.data, value.data);
	}
}

export class REMOVEHEADERCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const name = context.stack.popType(StringToken);
		httpCustomHeaders.delete(name.data);
	}
}

export class RESETHEADERSCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		httpCustomHeaders.clear();
	}
}

export class HTTPGETCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const url = context.stack.popType(StringToken);
		const palCtx = getPalaceContext(context);
		const spotId = palCtx.hotspotId;
		if (palace.debugMode) console.log('HTTPGET for URL:', url.data, 'from spotId:', spotId);
		const manager = context.manager;

		const resolvedUrl = /^https?:\/\//i.test(url.data) ? url.data : (palace.mediaUrl || '') + url.data;

		const headers = buildDefaultHeaders();

		const xhr = new XMLHttpRequest();
		httpRequests.add(xhr);
		httpRequestSpotIds.set(xhr, spotId);
		xhr.open('GET', resolvedUrl);
		for (const [k, v] of Object.entries(headers)) {
			try { xhr.setRequestHeader(k, v); } catch (_e) { /* forbidden header */ }
		}
		const cleanup = () => { httpRequests.delete(xhr); };
		xhr.onload = () => {
			cleanup();
			const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
			httpRequestSpotIds.delete(xhr);
			const result = xhrToResult(xhr);
			handleHttpResponse(result, manager, originSpotId);
		};
		xhr.onerror = () => {
			cleanup();
			const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
			httpRequestSpotIds.delete(xhr);
			dispatchHttpEvent(manager, originSpotId, 'HTTPERROR', (ctx) => {
				if (palace.debugMode) console.log('HTTP GET error');
				ctx.httpErrorMsg = 'Network error';
				ctx.httpUrl = resolvedUrl;
			});
		};
		xhr.onprogress = (e) => {
			const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
			dispatchHttpEvent(manager, originSpotId, 'HTTPRECEIVEPROGRESS', (ctx) => {
				ctx.httpBytesReceived = e.loaded;
				ctx.httpTotalBytes = e.lengthComputable ? e.total : 0;
			});
		};
		xhr.onabort = cleanup;
		xhr.send();
	}
}

export class HTTPPOSTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const url = context.stack.popType(StringToken);
		const postData = context.stack.pop().dereference();
		const palCtx = getPalaceContext(context);
		const spotId = palCtx.hotspotId;
		const manager = context.manager;

		const resolvedUrl = /^https?:\/\//i.test(url.data) ? url.data : (palace.mediaUrl || '') + url.data;

		const headers = buildDefaultHeaders();

		let body: string | FormData | File;
		let hasFiles = false;

		if (postData instanceof HashToken) {
			// Check if any values are FileTokens
			for (const [, v] of postData.data) {
				if (v instanceof FileToken) { hasFiles = true; break; }
			}
			if (hasFiles) {
				const formData = new FormData();
				for (const [k, v] of postData.data) {
					if (v instanceof FileToken) {
						formData.append(k, v.data, v.data.name);
					} else {
						formData.append(k, v.toString());
					}
				}
				body = formData;
			} else {
				const params = new URLSearchParams();
				for (const [k, v] of postData.data) {
					params.set(k, v.toString());
				}
				body = params.toString();
				if (!headers['Content-Type'] && !headers['content-type']) {
					headers['Content-Type'] = 'application/x-www-form-urlencoded';
				}
			}
		} else if (postData instanceof ArrayToken) {
			if (postData.data.length % 2 !== 0) {
				throw new IptError('ArrayToken has an odd number of entries, there must be a value for every key.');
			}
			// Check if any values are FileTokens
			for (let i = 1; i < postData.data.length; i += 2) {
				const v = postData.data[i].dereference();
				if (v instanceof FileToken) { hasFiles = true; break; }
			}
			if (hasFiles) {
				const formData = new FormData();
				for (let i = 0; i < postData.data.length; i += 2) {
					const key = postData.data[i].dereference();
					const val = postData.data[i + 1].dereference();
					const keyStr = key.toString();
					if (val instanceof FileToken) {
						formData.append(keyStr, val.data, val.data.name);
					} else {
						formData.append(keyStr, val.toString());
					}
				}
				body = formData;
			} else {
				const params = new URLSearchParams();
				for (let i = 0; i < postData.data.length; i += 2) {
					const key = postData.data[i].dereference();
					const val = postData.data[i + 1].dereference();
					params.set(key.toString(), val.toString());
				}
				body = params.toString();
				if (!headers['Content-Type'] && !headers['content-type']) {
					headers['Content-Type'] = 'application/x-www-form-urlencoded';
				}
			}
		} else if (postData instanceof FileToken) {
			body = postData.data;
		} else if (postData instanceof StringToken || postData instanceof IntegerToken) {
			body = postData.toString();
			if (!headers['Content-Type'] && !headers['content-type']) {
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
			}
		} else {
			throw new IptError('HTTPPOST requires a string, hash, array, or file as post data.');
		}

		const xhr = new XMLHttpRequest();
		httpRequests.add(xhr);
		httpRequestSpotIds.set(xhr, spotId);
		xhr.open('POST', resolvedUrl);
		// Don't set Content-Type for FormData — browser sets it with boundary
		for (const [k, v] of Object.entries(headers)) {
			if (body instanceof FormData && k.toLowerCase() === 'content-type') continue;
			try { xhr.setRequestHeader(k, v); } catch (_e) { /* forbidden header */ }
		}
		const cleanup = () => { httpRequests.delete(xhr); };
		xhr.onload = () => {
			cleanup();
			const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
			httpRequestSpotIds.delete(xhr);
			const result = xhrToResult(xhr);
			handleHttpResponse(result, manager, originSpotId);
		};
		xhr.onerror = () => {
			cleanup();
			const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
			httpRequestSpotIds.delete(xhr);
			dispatchHttpEvent(manager, originSpotId, 'HTTPERROR', (ctx) => {
				ctx.httpErrorMsg = 'Network error';
				ctx.httpUrl = resolvedUrl;
			});
		};
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) {
				const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
				dispatchHttpEvent(manager, originSpotId, 'HTTPSENDPROGRESS', (ctx) => {
					ctx.httpBytesSent = e.loaded;
					ctx.httpBytesLeft = e.total - e.loaded;
				});
			}
		};
		xhr.onprogress = (e) => {
			const originSpotId = httpRequestSpotIds.get(xhr) ?? spotId;
			dispatchHttpEvent(manager, originSpotId, 'HTTPRECEIVEPROGRESS', (ctx) => {
				ctx.httpBytesReceived = e.loaded;
				ctx.httpTotalBytes = e.lengthComputable ? e.total : 0;
			});
		};
		xhr.onabort = cleanup;
		xhr.send(body);
	}
}

export class HTTPCANCELCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		// Cancel is a no-op
	}
}

interface HttpResult {
	status: number;
	headers: Record<string, string>;
	body: string;
	url: string;
}

function xhrToResult(xhr: XMLHttpRequest): HttpResult {
	const headers: Record<string, string> = {};
	xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
		const idx = line.indexOf(': ');
		if (idx > 0) headers[line.substring(0, idx).toLowerCase()] = line.substring(idx + 2);
	});
	return { status: xhr.status, headers, body: xhr.responseText, url: xhr.responseURL };
}

function parseContentType(contentType: string): [string, string] {
	const mime = contentType.split(';')[0].trim();
	const slash = mime.indexOf('/');
	if (slash < 0) return [mime, ''];
	return [mime.substring(0, slash), mime.substring(slash + 1)];
}

function extractFilenameFromHeaders(headers: Record<string, string>, responseUrl: string): string {
	const disposition = headers['content-disposition'] || '';
	if (disposition) {
		const match = disposition.match(/filename="?([^";\n]+)"?/i);
		if (match) return match[1].trim();
	}
	try {
		const urlPath = new URL(responseUrl).pathname;
		const segments = urlPath.split('/');
		return segments[segments.length - 1] || '';
	} catch {
		return '';
	}
}

// ── Audio cache for HTTP-downloaded sounds ──

const httpSoundCache = new Map<string, string>(); // filename → URL

function cacheHttpSound(filename: string, url: string): void {
	httpSoundCache.set(filename, url);
}

export function getHttpSoundUrl(filename: string): string | undefined {
	return httpSoundCache.get(filename);
}

function refreshSpotPicsByFilename(filename: string, url: string): void {
	if (!palace.theRoom) return;
	// Replace the filename in the URL with the local filename
	try {
		const parsed = new URL(url);
		const lastSlash = parsed.pathname.lastIndexOf('/');
		parsed.pathname = parsed.pathname.substring(0, lastSlash + 1) + encodeURIComponent(filename);
		filename = parsed.toString();
	} catch {
		// Not a valid URL, use as-is
	}

	const bustUrl = filename + (filename.includes('?') ? '&' : '?') + '_t=' + Date.now();
	const room = palace.theRoom;
	for (let i = 0; i < room.pics.length; i++) {
		const picEntry = room.pics[i];
		if (!picEntry || picEntry.name !== filename) continue;
		// Load into a fresh image element to avoid issues reusing the old one
		const newImg = document.createElement('img');
		newImg.onload = () => {
			picEntry.img = newImg;
			for (const spot of room.spots) {
				const statepic = spot.statepics[spot.state];
				if (statepic && statepic.id === i && spot.img) {
					room.setSpotImg(spot);
				}
			}
		};
		newImg.src = bustUrl;
	}
}

function handleHttpResponse(result: HttpResult, manager: import('../IptManager.js').IptManager, spotId: number): void {
	const headers = result.headers || {};
	const fullContentType = headers['content-type'] || '';
	const [majorType, subType] = parseContentType(fullContentType);
	const body = result.body || '';
	const filename = extractFilenameFromHeaders(headers, result.url || '');

	const responseHeaders = new HashToken();
	for (const [key, val] of Object.entries(headers)) {
		responseHeaders.data.set(key, new StringToken(val));
	}
	const responseUrl = result.url || '';

	switch (majorType) {
		case 'image': {
			const ctx = fireHttpReceived(manager, spotId, body, responseHeaders, majorType, filename, responseUrl);
			if (ctx.httpContents !== '' && ctx.httpFilename !== '') {
				refreshSpotPicsByFilename(ctx.httpFilename, ctx.httpUrl);
			}
			break;
		}
		case 'text': {
			if (subType === 'iptscrae' || subType === 'ipt') {
				const ctx = fireHttpReceived(manager, spotId, body, responseHeaders, majorType, filename, responseUrl);
				if (ctx.httpContents !== '') {
					if (!palace.theRoom) return;
					const execCtx = new PalaceExecutionContext(manager);
					execCtx.hotspotId = spotId;
					execCtx.eventName = 'HTTPRECEIVED';
					execCtx.httpUrl = responseUrl;
					manager.executeWithContext(ctx.httpContents, execCtx);
				}
			} else if (subType === 'html') {
				const ctx = fireHttpReceived(manager, spotId, body, responseHeaders, majorType, filename, responseUrl);
				if (ctx.httpContents !== '') {
					const popup = window.open('', '_blank', 'width=800,height=600');
					if (popup) {
						popup.document.open();
						popup.document.write(ctx.httpContents);
						popup.document.close();
					}
				}
			} else {
				fireHttpReceived(manager, spotId, body, responseHeaders, majorType, filename, responseUrl);
			}
			break;
		}
		case 'audio': {
			const ctx = fireHttpReceived(manager, spotId, body, responseHeaders, majorType, filename, responseUrl);
			if (ctx.httpContents !== '' && ctx.httpFilename !== '') {
				cacheHttpSound(ctx.httpFilename, responseUrl);
			}
			break;
		}
		default: {
			fireHttpReceived(manager, spotId, body, responseHeaders, majorType, filename, responseUrl);
			break;
		}
	}
}

function fireHttpReceived(
	manager: import('../IptManager.js').IptManager,
	spotId: number,
	body: string,
	responseHeaders: HashToken,
	contentType: string,
	filename: string,
	responseUrl: string
): PalaceExecutionContext {
	// Create a shared context that all handlers will read/mutate
	const sharedCtx = { httpContents: body, httpFilename: filename };

	if (!palace.theRoom) {
		const ctx = new PalaceExecutionContext(manager);
		ctx.httpContents = body;
		ctx.httpFilename = filename;
		ctx.httpUrl = responseUrl;
		return ctx;
	}
	const spot = palace.theRoom.getSpot(spotId);
	if (!spot || !spot.handlers) {
		const ctx = new PalaceExecutionContext(manager);
		ctx.httpContents = body;
		ctx.httpFilename = filename;
		ctx.httpUrl = responseUrl;
		return ctx;
	}

	const events = ['HTTPRECEIVED', 'HTTPRECIEVED'];
	let lastCtx: PalaceExecutionContext | null = null;

	for (const evt of events) {
		if (!spot.handlers[evt]) continue;
		const ctx = new PalaceExecutionContext(manager);
		ctx.hotspotId = spotId;
		ctx.eventName = evt;
		ctx.httpContents = sharedCtx.httpContents;
		ctx.httpHeaders = responseHeaders;
		ctx.httpContentType = contentType;
		ctx.httpFilename = sharedCtx.httpFilename;
		ctx.httpUrl = responseUrl;
		manager.executeTokenListSync(spot.handlers[evt], ctx);
		// Propagate any modifications the script made
		sharedCtx.httpContents = ctx.httpContents;
		sharedCtx.httpFilename = ctx.httpFilename;
		lastCtx = ctx;
	}

	if (!lastCtx) {
		const ctx = new PalaceExecutionContext(manager);
		ctx.httpContents = body;
		ctx.httpFilename = filename;
		ctx.httpUrl = responseUrl;
		return ctx;
	}
	return lastCtx;
}

function dispatchHttpEvent(manager: import('../IptManager.js').IptManager, spotId: number, event: string, setup: (ctx: PalaceExecutionContext) => void): void {
	if (!palace.theRoom) return;
	const spot = palace.theRoom.getSpot(spotId);
	if (!spot || !spot.handlers) return;

	// Fire both correct and legacy misspelled event names
	const events = event === 'HTTPRECEIVED' ? ['HTTPRECEIVED', 'HTTPRECIEVED'] : [event];

	for (const evt of events) {
		if (!spot.handlers[evt]) continue;
		const ctx = new PalaceExecutionContext(manager);
		ctx.hotspotId = spotId;
		ctx.eventName = evt;
		setup(ctx);
		manager.executeTokenListSync(spot.handlers[evt], ctx);
	}
}

// Room Pic Info

export class NBRROOMPICSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.push(new IntegerToken(palace.theRoom ? palace.theRoom.pics.length : 0));
	}
}

export class GETPICPIXELCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const y = context.stack.popType(IntegerToken);
		const x = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(IntegerToken.ZERO); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot) { context.stack.push(IntegerToken.ZERO); return; }
		const s = resolveState(spot, state.data);
		const statepic = spot.statepics[s];
		if (!statepic) { context.stack.push(IntegerToken.ZERO); return; }
		const picEntry = palace.theRoom.pics[statepic.id];
		if (!picEntry || !picEntry.img || picEntry.img.naturalWidth === 0) {
			context.stack.push(IntegerToken.ZERO); return;
		}
		const img = picEntry.img;
		const imgLeft = spot.x + statepic.x - Math.trunc(img.naturalWidth / 2);
		const imgTop = spot.y + statepic.y - Math.trunc(img.naturalHeight / 2);
		const px = x.data - imgLeft;
		const py = y.data - imgTop;
		if (px < 0 || py < 0 || px >= img.naturalWidth || py >= img.naturalHeight) {
			context.stack.push(IntegerToken.ZERO); return;
		}
		const c = document.createElement('canvas');
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		const ctx = c.getContext('2d')!;
		ctx.drawImage(img, 0, 0);
		const pixel = ctx.getImageData(px, py, 1, 1).data;
		// ABGR format: Alpha << 24 | Blue << 16 | Green << 8 | Red
		const abgr = ((pixel[3] << 24) | (pixel[2] << 16) | (pixel[1] << 8) | pixel[0]) >>> 0;
		context.stack.push(new IntegerToken(abgr));
	}
}

// Mouse Position

export class MOUSEPOSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (palace.theRoom) {
			context.stack.push(new IntegerToken(palace.theRoom.lastMouseX));
			context.stack.push(new IntegerToken(palace.theRoom.lastMouseY));
		} else {
			context.stack.push(IntegerToken.ZERO);
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class WHEREPROPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		if (context instanceof PalaceExecutionContext &&
			(context.eventName === 'LOOSEPROPADDED' || context.eventName === 'LOOSEPROPMOVED' || context.eventName === 'LOOSEPROPDELETED')) {
			context.stack.push(new IntegerToken(context.wherePropX));
			context.stack.push(new IntegerToken(context.wherePropY));
		} else {
			throw new IptError('WHEREPROP is only available in LOOSEPROPADDED, LOOSEPROPMOVED, and LOOSEPROPDELETED events');
		}
	}
}

// Spot Type

export class GETSPOTTYPECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			context.stack.push(new IntegerToken(spot ? spot.type : 0));
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

// Spot Dest

export class SETSPOTDESTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const dest = context.stack.popType(IntegerToken);
		const spotId = context.stack.popType(IntegerToken);
		if (palace.theRoom) {
			const spot = palace.theRoom.getSpot(spotId.data);
			if (spot) {
				spot.dest = dest.data;
			}
		}
	}
}

// Load Website

export class LOADWEBSITECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const url = context.stack.popType(StringToken);
		window.open(url.data, '_blank', 'noopener,noreferrer');
	}
}

// Web Embed

function getSpotBounds(spot: { x: number; y: number; points: number[] }): { left: number; top: number; width: number; height: number } {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < spot.points.length - 1; i += 2) {
		const px = spot.x + spot.points[i];
		const py = spot.y + spot.points[i + 1];
		if (px < minX) minX = px;
		if (px > maxX) maxX = px;
		if (py < minY) minY = py;
		if (py > maxY) maxY = py;
	}
	return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

export class WEBEMBEDCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const url = context.stack.popType(StringToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot) return;

		// Remove existing webembed if any
		if (spot.webEmbed) {
			spot.webEmbed.remove();
			spot.webEmbed = undefined;
		}

		// Empty string removes the embed
		if (url.data === '') {
			palace.hideMuteButton();
			return;
		}

		const bounds = getSpotBounds(spot);
		const webview = document.createElement('webview') as any;
		webview.className = 'spotwebembed';
		webview.src = url.data;
		webview.setAttribute('allowfullscreen', '');
		webview.setAttribute('allowtransparency', '');
		webview.style.cssText = `position:absolute;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;border:none;z-index:3;pointer-events:none`;
		palace.container.appendChild(webview);
		spot.webEmbed = webview;

		// Open clicked links in the default browser
		webview.addEventListener('new-window', (e: any) => {
			if (e.url) window.apiBridge.launchHyperLink(e.url);
		});

		// Mute if media is globally muted, show mute button when audio starts
		webview.addEventListener('dom-ready', () => {
			if (palace.mediaMuted) webview.setAudioMuted(true);
		});
		webview.addEventListener('media-started-playing', () => {
			palace.showMuteButton();
			if (palace.mediaMuted) webview.setAudioMuted(true);
		});

		// Handle fullscreen requests from embedded content
		webview.addEventListener('enter-html-full-screen', () => {
			webview.style.left = '0';
			webview.style.top = '0';
			webview.style.width = `${palace.roomWidth}px`;
			webview.style.height = `${palace.roomHeight}px`;
			webview.style.zIndex = '9999';
		});

		webview.addEventListener('leave-html-full-screen', () => {
			const b = getSpotBounds(spot);
			webview.style.left = `${b.left}px`;
			webview.style.top = `${b.top}px`;
			webview.style.width = `${b.width}px`;
			webview.style.height = `${b.height}px`;
			webview.style.zIndex = '3';
		});

		// Fire WEBDOCBEGIN for initial load
		palace.theRoom?.executeSpotEventWithContext('WEBDOCBEGIN', spot, (ctx: PalaceExecutionContext) => {
			ctx.docUrl = url.data;
		});

		// Remove webembed on load failure
		webview.addEventListener('did-fail-load', (e: any) => {
			// Ignore aborted loads (e.g. navigation away) and sub-frame errors
			if (e.errorCode === -3 || !e.isMainFrame) return;
			palace.theRoom.logmsg(`WebEmbed failed to load: ${e.errorDescription || 'Unknown error'} (code ${e.errorCode}) - ${e.validatedURL || url.data}`);
			if (spot.webEmbed === webview) {
				webview.remove();
				spot.webEmbed = undefined;
			}
		});

		// Fire WEBDOCDONE on load
		webview.addEventListener('did-finish-load', () => {
			webview.style.pointerEvents = 'auto';
			if (!palace.theRoom) return;
			let currentUrl = url.data;
			try {
				currentUrl = webview.getURL() || url.data;
			} catch { /* ignore */ }

			palace.theRoom.executeSpotEventWithContext('WEBDOCDONE', spot, (ctx: PalaceExecutionContext) => {
				ctx.docUrl = currentUrl;
			});

			// Fire WEBSTATUS with completed status
			palace.theRoom?.executeSpotEventWithContext('WEBSTATUS', spot, (ctx: PalaceExecutionContext) => {
				ctx.newStatus = 'Done';
			});
		});

		// Fire WEBTITLE when page title changes (works cross-origin)
		webview.addEventListener('page-title-updated', (e: any) => {
			if (!palace.theRoom) return;
			const title = e.title || '';
			if (title) {
				if (palace.debugMode) console.log(title)
				palace.theRoom.executeSpotEventWithContext('WEBTITLE', spot, (ctx: PalaceExecutionContext) => {
					ctx.newTitle = title;
				});
			}
		});
	}
}

export class WEBLOCATIONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (!palace.theRoom) {
			context.stack.push(new StringToken(''));
			return;
		}
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot?.webEmbed) {
			try {
				context.stack.push(new StringToken((spot.webEmbed as any).getURL() || (spot.webEmbed as any).src));
			} catch {
				context.stack.push(new StringToken((spot.webEmbed as any).src || ''));
			}
		} else {
			context.stack.push(new StringToken(''));
		}
	}
}

export class WEBTITLECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (!palace.theRoom) {
			context.stack.push(new StringToken(''));
			return;
		}
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot?.webEmbed) {
			try {
				context.stack.push(new StringToken((spot.webEmbed as any).getTitle() || ''));
			} catch {
				context.stack.push(new StringToken(''));
			}
		} else {
			context.stack.push(new StringToken(''));
		}
	}
}

export class WEBSCRIPTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const script = context.stack.popType(StringToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot?.webEmbed) {
			try {
				(spot.webEmbed as any).executeJavaScript(script.data);
			} catch {
				// Error — silently ignore
			}
		}
	}
}

// ── ADDPIC / ADDPICNAME ──

function addPicToSpot(fileName: string, saveName: string, spotId: number, file?: File): void {
	if (!palace.theRoom) return;
	const spot = palace.theRoom.getSpot(spotId);
	if (!spot) return;
	palace.theRoom.backupSpot(spot);

	// Generate a new unique pic ID (one higher than current max)
	let maxId = 0;
	for (let i = 0; i < palace.theRoom.pics.length; i++) {
		if (palace.theRoom.pics[i]) maxId = i;
	}
	const newId = maxId + 1;

	// Create image element and register in room pics table
	const newImg = document.createElement('img');
	const pict = { id: newId, name: saveName, img: newImg };
	palace.theRoom.pics[newId] = pict;

	newImg.onload = () => {
		if (palace.theRoom) {
			palace.theRoom.setSpotImg(spot);
		}
	};
	newImg.src = file ? URL.createObjectURL(file) : palace.passUrl(fileName);

	// Add new state pic entry to the spot
	spot.statepics.push({ id: newId, x: 0, y: 0 });
}

function insertPicToSpot(fileName: string, saveName: string, index: number, spotId: number, file?: File): void {
	if (!palace.theRoom) return;
	const spot = palace.theRoom.getSpot(spotId);
	if (!spot) return;
	palace.theRoom.backupSpot(spot);

	let maxId = 0;
	for (let i = 0; i < palace.theRoom.pics.length; i++) {
		if (palace.theRoom.pics[i]) maxId = i;
	}
	const newId = maxId + 1;

	const newImg = document.createElement('img');
	const pict = { id: newId, name: saveName, img: newImg };
	palace.theRoom.pics[newId] = pict;

	newImg.onload = () => {
		if (palace.theRoom) {
			palace.theRoom.setSpotImg(spot);
		}
	};
	newImg.src = file ? URL.createObjectURL(file) : palace.passUrl(fileName);

	const clampedIndex = Math.max(0, Math.min(index, spot.statepics.length));
	spot.statepics.splice(clampedIndex, 0, { id: newId, x: 0, y: 0 });
}

export class REMOVEPICCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const index = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot || index.data < 0 || index.data >= spot.statepics.length) return;
		palace.theRoom.backupSpot(spot);
		spot.statepics.splice(index.data, 1);
		palace.theRoom.setSpotImg(spot);
	}
}

export class ADDPICCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const token = context.stack.pop().dereference();
		if (token instanceof FileToken) {
			const name = token.data.name;
			addPicToSpot(name, name, spotId.data, token.data);
		} else {
			const fileName = String((token as StringToken).data);
			addPicToSpot(fileName, fileName, spotId.data);
		}
	}
}

export class INSERTPICCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const index = context.stack.popType(IntegerToken);
		const token = context.stack.pop().dereference();
		if (token instanceof FileToken) {
			const name = token.data.name;
			insertPicToSpot(name, name, index.data, spotId.data, token.data);
		} else {
			const fileName = String((token as StringToken).data);
			insertPicToSpot(fileName, fileName, index.data, spotId.data);
		}
	}
}

export class ADDPICNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const saveName = context.stack.popType(StringToken);
		const token = context.stack.pop().dereference();
		if (token instanceof FileToken) {
			addPicToSpot(token.data.name, saveName.data, spotId.data, token.data);
		} else {
			const fileName = String((token as StringToken).data);
			addPicToSpot(fileName, saveName.data, spotId.data);
		}
	}
}

// ── ADDSPOT ──

export class ADDSPOTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const yLoc = context.stack.popType(IntegerToken);
		const xLoc = context.stack.popType(IntegerToken);
		const pointsArr = context.stack.popType(ArrayToken);
		if (!palace.theRoom) return;

		// Convert ArrayToken to flat number array, dereferencing and coercing to integer
		const points: number[] = [];
		for (const token of pointsArr.data) {
			const t = token instanceof IptVariable ? token.dereference() : token;
			if (t instanceof IntegerToken) {
				points.push(t.data);
			} else if (t instanceof StringToken) {
				const num = parseInt(t.data, 10);
				points.push(isNaN(num) ? 0 : num);
			}
		}

		if (points.length % 2 !== 0) {
			throw new IptError('ADDSPOT: ArrayToken has an odd number of entries, there must be an even number of x\'s and y\'s.');
		}

		// Generate a unique positive spot ID
		let maxId = 0;
		for (const s of palace.theRoom.spots) {
			if (s.id > maxId) maxId = s.id;
		}
		const newId = maxId + 1;

		const spot: any = {
			id: newId,
			name: '',
			type: 0,
			flags: 0,
			x: xLoc.data,
			y: yLoc.data,
			state: 0,
			dest: 0,
			points: points,
			statepics: [],
			img: PalaceRoom.createSpotPicPlaceholder(),
			toplayer: false,
			script: '',
			handlers: {},
			_addedByScript: true,
		};

		palace.container.appendChild(spot.img);
		palace.theRoom.spots.push(spot);
		palace.theRoom.reDraw();
		palace.theRoom.reDrawTop();

		// Push the new spot's ID onto the stack
		context.stack.push(new IntegerToken(newId));
	}
}

// ── REMOVESPOT ──

export class REMOVESPOTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;

		const idx = palace.theRoom.spots.findIndex((s: any) => s.id === spotId.data);
		if (idx === -1) return;

		const spot = palace.theRoom.spots[idx];

		// Only remove spots created by ADDSPOT
		if (!spot._addedByScript) return;

		// Remove DOM elements
		if (spot.img && spot.img.parentNode) {
			spot.img.parentNode.removeChild(spot.img);
		}
		if (spot.webEmbed && spot.webEmbed.parentNode) {
			spot.webEmbed.parentNode.removeChild(spot.webEmbed);
		}

		// Remove from spots array
		palace.theRoom.spots.splice(idx, 1);
	}
}

// ── SETTOOLTIP / CLEARTOOLTIP ──

let tooltipEl: HTMLDivElement | null = null;

function getTooltipEl(): HTMLDivElement {
	if (!tooltipEl) {
		tooltipEl = document.createElement('div');
		tooltipEl.className = 'iptscrae-tooltip';
		tooltipEl.style.cssText = 'position:absolute;padding:6px 10px;background:rgba(30,30,30,0.92);color:#eee;border:1px solid rgba(255,255,255,0.15);border-radius:5px;font-size:12px;line-height:1.4;pointer-events:none;z-index:9999;display:none;white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,0.35);backdrop-filter:blur(4px);max-width:320px;';
		palace.container.appendChild(tooltipEl);
	}
	return tooltipEl;
}

export class SETTOOLTIPCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const message = context.stack.popType(StringToken);
		const el = getTooltipEl();
		el.textContent = message.data;
		const mouseX = palace.theRoom?.lastMouseX ?? 0;
		const mouseY = palace.theRoom?.lastMouseY ?? 0;
		el.style.left = `${mouseX}px`;
		el.style.top = `${mouseY + 16}px`;
		el.style.display = '';
	}
}

export function clearTooltip(): void {
	if (tooltipEl) {
		tooltipEl.style.display = 'none';
	}
}

export class CLEARTOOLTIPCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		clearTooltip();
	}
}

// ── UPDATE ──

export class UPDATELATERCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		// no-op placeholder
	}
}

export class UPDATENOWCommand extends IptCommand {
	override execute(_context: IptExecutionContext): void {
		if (palace.theRoom) {
			palace.theRoom.refresh();
			palace.theRoom.refreshTop();
		}
	}
}

// ── SETSPOTSCRIPT ──

export class SETSPOTSCRIPTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const eventName = context.stack.popType(StringToken);
		const tokenList = context.stack.popType(IptTokenList);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			if (!spot.handlers) spot.handlers = {};
			spot.handlers[eventName.data.toUpperCase()] = tokenList;
		}
	}
}

export class CACHESCRIPTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const eventName = context.stack.popType(StringToken);
		const tokenList = context.stack.popType(IptTokenList);
		if (context instanceof PalaceExecutionContext && context.hotspotId === -999) {
			throw new IptError('CACHESCRIPT is not available for Cyborg scripting');
		}
		const key = eventName.data.toUpperCase();
		const manager = context.manager;
		const list = manager.cachedScripts.get(key);
		if (list) {
			list.push(tokenList);
		} else {
			manager.cachedScripts.set(key, [tokenList]);
		}
	}
}

// ── Pic Filter helpers ──

function resolveState(spot: { state: number }, state: number): number {
	return state < 0 ? spot.state : state;
}

export class GETPICDIMENSIONSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot) { context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return; }
		const s = resolveState(spot, state.data);
		const statepic = spot.statepics[s];
		if (!statepic) { context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return; }
		const picEntry = palace.theRoom.pics[statepic.id];
		if (!picEntry || !picEntry.img || picEntry.img.naturalWidth === 0) {
			context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return;
		}
		context.stack.push(new IntegerToken(picEntry.img.naturalWidth));
		context.stack.push(new IntegerToken(picEntry.img.naturalHeight));
	}
}

export class GETPICLOCCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot) { context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return; }
		const s = resolveState(spot, state.data);
		const statepic = spot.statepics[s];
		if (!statepic) { context.stack.push(IntegerToken.ZERO); context.stack.push(IntegerToken.ZERO); return; }
		context.stack.push(new IntegerToken(statepic.x));
		context.stack.push(new IntegerToken(statepic.y));
	}
}

export class GETPICNAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(new StringToken('')); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		if (!spot) { context.stack.push(new StringToken('')); return; }
		const s = resolveState(spot, state.data);
		const statepic = spot.statepics[s];
		if (!statepic) { context.stack.push(new StringToken('')); return; }
		const picEntry = palace.theRoom.pics[statepic.id];
		context.stack.push(new StringToken(picEntry?.name ?? ''));
	}
}

function ensurePicFilters(spot: any, state: number): Record<string, number> {
	if (!spot.picFilters) spot.picFilters = {};
	if (!spot.picFilters[state]) spot.picFilters[state] = {};
	return spot.picFilters[state];
}

// ── SETPICANGLE ──

export class SETPICANGLECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const angle = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).angle = angle.data;
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// ── GETPICANGLE ──

export class GETPICANGLECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(IntegerToken.ZERO); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		const s = spot ? resolveState(spot, state.data) : 0;
		const val = spot?.picFilters?.[s]?.angle ?? 0;
		context.stack.push(new IntegerToken(val));
	}
}

// ── SETPICBRIGHTNESS ──

export class SETPICBRIGHTNESSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const brightness = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).brightness = Math.max(-100, Math.min(100, brightness.data));
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// ── GETPICBRIGHTNESS ──

export class GETPICBRIGHTNESSCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(IntegerToken.ZERO); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		const s = spot ? resolveState(spot, state.data) : 0;
		const val = spot?.picFilters?.[s]?.brightness ?? 0;
		context.stack.push(new IntegerToken(val));
	}
}

// ── SETPICOPACITY ──

export class SETPICOPACITYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const opacity = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).opacity = Math.max(0, Math.min(100, opacity.data));
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// ── GETPICOPACITY ──

export class GETPICOPACITYCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(new IntegerToken(100)); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		const s = spot ? resolveState(spot, state.data) : 0;
		const val = spot?.picFilters?.[s]?.opacity ?? 100;
		context.stack.push(new IntegerToken(val));
	}
}

// ── SETPICSATURATION ──

export class SETPICSATURATIONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const saturation = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).saturation = Math.max(-10000, Math.min(10000, saturation.data));
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// ── GETPICSATURATION ──

export class GETPICSATURATIONCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		if (!palace.theRoom) { context.stack.push(new IntegerToken(100)); return; }
		const spot = palace.theRoom.getSpot(spotId.data);
		const s = spot ? resolveState(spot, state.data) : 0;
		const val = spot?.picFilters?.[s]?.saturation ?? 100;
		context.stack.push(new IntegerToken(val));
	}
}

// ── SETPICHUE ──

export class SETPICHUECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const hue = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).hue = Math.max(-180, Math.min(180, hue.data));
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// ── SETPICCONTRAST ──

export class SETPICCONTRASTCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const contrast = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).contrast = Math.max(-100, Math.min(1000, contrast.data));
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// ── SETPICBLUR ──

export class SETPICBLURCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const state = context.stack.popType(IntegerToken);
		const blur = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			const s = resolveState(spot, state.data);
			ensurePicFilters(spot, s).blur = Math.max(0, Math.min(2500, blur.data));
			palace.theRoom.setSpotImg(spot);
		}
	}
}

// Spot Pic Mode

export class SETSPOTPICMODECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const spotId = context.stack.popType(IntegerToken);
		const picMode = context.stack.popType(IntegerToken);
		if (!palace.theRoom) return;
		const spot = palace.theRoom.getSpot(spotId.data);
		if (spot) {
			spot.picMode = picMode.data;
			palace.theRoom.setSpotImg(spot);
		}
	}
}

export class SETPICFRAMECommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.popType(IntegerToken); // spotId
		context.stack.popType(IntegerToken); // state
		context.stack.popType(IntegerToken); // frameIndex
	}
}

export class PAUSEPICCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.popType(IntegerToken); // spotId
		context.stack.popType(IntegerToken); // state
	}
}

export class RESUMEPICCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.popType(IntegerToken); // spotId
		context.stack.popType(IntegerToken); // state
	}
}

export class NBRPICFRAMESCommand extends IptCommand {
	override execute(context: IptExecutionContext): void {
		context.stack.popType(IntegerToken); // spotId
		context.stack.popType(IntegerToken); // state
		context.stack.push(IntegerToken.ZERO);
	}
}

// ── File Selection ──

export class SELECTFILECommand extends IptCommand {
	private _running = false;
	private waiting = true;

	override get running(): boolean { return this._running; }

	override execute(context: IptExecutionContext): void {
		const mimeType = context.stack.popType(StringToken);
		this._running = true;
		this.waiting = true;
		context.manager.callStack.push(this);

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = mimeType.data;
		input.style.display = 'none';
		document.body.appendChild(input);

		input.addEventListener('change', () => {
			document.body.removeChild(input);
			const file = input.files?.[0];
			if (file) {
				context.stack.push(new FileToken(file));
			} else {
				context.stack.push(IntegerToken.ZERO);
			}
			this.waiting = false;
		});

		input.addEventListener('cancel', () => {
			document.body.removeChild(input);
			context.stack.push(IntegerToken.ZERO);
			this.waiting = false;
		});

		input.click();
	}

	override step(): void {
		if (!this.waiting) {
			this.end();
		}
	}

	override end(): void {
		this._running = false;
	}
}
