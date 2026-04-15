const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('loadtest', {
	start: (config) => ipcRenderer.invoke('start-loadtest', config),
	stop: () => ipcRenderer.invoke('stop-loadtest'),
	getStats: () => ipcRenderer.invoke('get-stats'),
	onBotStatus: (callback) => ipcRenderer.on('bot-status', (_event, data) => callback(data)),
});
