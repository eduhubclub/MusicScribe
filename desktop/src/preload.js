"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicScribeDesktop", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  retryHelper: () => ipcRenderer.invoke("desktop:retry-helper"),
  openApp: () => ipcRenderer.invoke("desktop:open-app"),
  startModelDownload: () => ipcRenderer.invoke("desktop:start-models"),
  getModelStatus: () => ipcRenderer.invoke("desktop:model-status"),
  onHelperLog: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("helper:log", handler);
    return () => ipcRenderer.removeListener("helper:log", handler);
  },
});
