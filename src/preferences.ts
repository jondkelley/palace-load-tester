import { getRandomInt } from './utility.js';
import { setDrawType, logerror } from './interface.js';
import type { PrefsData } from './types/index.js';

export let prefs: PrefsData = { general: {}, control: {}, draw: { type: 0, size: 2, front: true, color: 'rgba(255,0,0,1)', fill: 'rgba(255,166,0,0.5)' } };

window.onerror = (e, url, line) => {
	logerror(`${e}<br>${url?.split('/').pop()}&nbsp;&nbsp;&nbsp;&nbsp;Line:${line}<br><br>`);
};

export function setControlPrefs(id: string, obj: unknown): void {
	prefs.control[id] = obj;
}

export function getControlPrefs(id: string): unknown {
	return prefs.control[id];
}

export function setGeneralPref(id: string, value: unknown): void {
	prefs.general[id] = value;
}

export function getGeneralPref(id: string): unknown {
	return prefs.general[id];
}

window.onunload = () => {
	localStorage.preferences = JSON.stringify(prefs);
};

{
	let a: unknown;
	if (localStorage.preferences) {
		prefs = JSON.parse(localStorage.preferences);

		const drawcolor = document.getElementById('drawcolor') as HTMLInputElement;
		drawcolor.value = prefs.draw.color;
		drawcolor.style.backgroundColor = prefs.draw.color;

		const drawfill = document.getElementById('drawfill') as HTMLInputElement;
		drawfill.value = prefs.draw.fill;
		drawfill.style.backgroundColor = prefs.draw.fill;

		(document.getElementById('drawsize') as HTMLInputElement).value = String(prefs.draw.size);
		a = getGeneralPref('propBagWidth');
		if (a) document.getElementById('props')!.style.width = `${a}px`;
		a = getGeneralPref('chatLogWidth');
		if (a) document.getElementById('log')!.style.width = `${a}px`;
		a = getGeneralPref('propBagTileSize');
		if (a) {
			document.getElementById('props')!.style.setProperty('--tile-size', `${a}px`);
		}
		a = getGeneralPref('viewScales');
		if (typeof a === 'boolean') (document.getElementById('prefviewfitscale') as HTMLInputElement).checked = a;
		a = getGeneralPref('viewScaleAll');
		if (typeof a === 'boolean') (document.getElementById('prefviewscaleall') as HTMLInputElement).checked = a;
		a = getGeneralPref('disableSounds');
		if (typeof a === 'boolean') (document.getElementById('prefdisablesounds') as HTMLInputElement).checked = a;
		a = getGeneralPref('autoplayvideos');
		if (typeof a === 'boolean') (document.getElementById('prefautoplayvideos') as HTMLInputElement).checked = a;
		a = getGeneralPref('shownametags');
		if (typeof a === 'boolean') (document.getElementById('prefshownametags') as HTMLInputElement).checked = a;
		a = getGeneralPref('iptDebug');
		if (typeof a === 'boolean') (document.getElementById('prefiptdebug') as HTMLInputElement).checked = a;
		a = getGeneralPref('debugMode');
		if (typeof a === 'boolean') (document.getElementById('prefdebugmode') as HTMLInputElement).checked = a;
		a = getGeneralPref('rClickSlide');
		if (typeof a === 'boolean') (document.getElementById('prefrclickslide') as HTMLInputElement).checked = a;

		a = getGeneralPref('updateChannel');
		if (typeof a === 'string') (document.getElementById('prefupdatechannel') as HTMLSelectElement).value = a;
		a = getGeneralPref('updateNotifications');
		if (typeof a === 'boolean') (document.getElementById('prefupdatenotify') as HTMLInputElement).checked = a;
		a = getGeneralPref('updateManifestUrl');
		if (typeof a === 'string') (document.getElementById('prefupdateurl') as HTMLInputElement).value = a;

		setDrawType();
	} else {
		(prefs as any).registration = { regi: getRandomInt(100, 2147483647), puid: 2000000000 };
		setGeneralPref('home', 'ee.fastpalaces.com:9991');
		setGeneralPref('userName', 'Palace User');
		setGeneralPref('propBagTileSize', 91);
		setGeneralPref('viewScaleAll', true);
		setGeneralPref('shownametags', true);
	}
	(document.getElementById('prefusername') as HTMLInputElement).value = getGeneralPref('userName') as string;
	(document.getElementById('prefhomepalace') as HTMLInputElement).value = getGeneralPref('home') as string;
}
