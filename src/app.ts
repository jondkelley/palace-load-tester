import { setPalace } from './state.js';
import { prefs, getGeneralPref } from './preferences.js';
import { PalaceClient, IptEngine } from './client.js';
import { CyborgEngine } from './iptscrae/cyborgEngine.js';
import { loadSmileys } from './core.js';

(async () => {
	const appVersion = await window.apiBridge.getAppVersion();
	const palace = new PalaceClient((prefs as any).registration.regi, (prefs as any).registration.puid, appVersion);
	palace.clientId = await window.apiBridge.getClientId();
	setPalace(palace);

	const iptDebug = prefs.general.iptDebug === true;
	IptEngine.debugMode = iptDebug;
	CyborgEngine.debugMode = iptDebug;
	palace.debugMode = prefs.general.debugMode === true;

	// Claim any palace:// URL that was passed to the app at launch (e.g. the user clicked a
	// palace:// link while the app was not running). We do this before going to home so the
	// link target takes priority over the home preference.
	const startupPalaceUrl = await window.apiBridge.getPendingPalaceUrl();

	// Handle palace:// URLs that arrive while the app is already running.
	window.apiBridge.handlePalaceUrl((url: string) => {
		palace.goto(url);
	});

	// Warm up the webview renderer process so the first WEBEMBED is instant.
	const warmup = document.createElement('webview') as any;
	warmup.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;';
	warmup.src = 'about:blank';
	document.body.appendChild(warmup);
	warmup.addEventListener('dom-ready', () => warmup.remove());

	loadSmileys(() => {
		if (startupPalaceUrl) {
			palace.goto(startupPalaceUrl);
		} else if (prefs.general.home !== '') {
			palace.goto(prefs.general.home as string);
		}
	});

	function getDefaultChannel(version: string): string {
		if (version.includes('-alpha')) return 'alpha';
		if (version.includes('-beta'))  return 'beta';
		return 'stable';
	}

	function showUpdateBanner(version: string, downloadUrl: string | null) {
		const banner = document.getElementById('update-banner') as HTMLElement;
		const versionEl = document.getElementById('update-version') as HTMLElement;
		const nowBtn = document.getElementById('update-now-btn') as HTMLButtonElement;
		const progressEl = document.getElementById('update-progress') as HTMLElement;
		versionEl.textContent = version;
		banner.dataset.downloadUrl = downloadUrl ?? '';
		nowBtn.style.display = downloadUrl ? '' : 'none';
		progressEl.style.display = 'none';
		banner.style.display = '';
	}

	async function checkForUpdates() {
		const notificationsEnabled = getGeneralPref('updateNotifications') !== false;
		if (!notificationsEnabled) return;
		const channel = (getGeneralPref('updateChannel') as string) || getDefaultChannel(appVersion);
		const manifestUrl = (getGeneralPref('updateManifestUrl') as string) || undefined;
		try {
			const result = await (window.apiBridge as any).checkForUpdates(channel, manifestUrl);
			if (result?.updateAvailable) {
				showUpdateBanner(result.latestVersion, result.downloadUrl ?? null);
			}
		} catch { /* silent */ }
	}

	checkForUpdates();
	setInterval(checkForUpdates, 60 * 60 * 1000);
})();
