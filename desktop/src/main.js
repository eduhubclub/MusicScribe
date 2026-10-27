"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { HelperProcess } = require("./helper");
const { ensureDirs, isDev, userDataDir, modelCacheDir } = require("./paths");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {HelperProcess | null} */
let helper = null;
let starting = false;
let lastError = null;
let modelsReady = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function preloadPath() {
  return path.join(__dirname, "preload.js");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Music Scribe",
    backgroundColor: "#12161c",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "splash.html"));
  return mainWindow;
}

function attachHelperLogs(proc) {
  proc.onLog((line) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("helper:log", line);
    }
  });
}

async function startHelper() {
  if (starting) return;
  starting = true;
  lastError = null;
  try {
    ensureDirs();
    if (helper) {
      await helper.stop();
      helper = null;
    }
    helper = new HelperProcess();
    attachHelperLogs(helper);
    await helper.start();
    modelsReady = await probeModelsReady();
  } catch (err) {
    lastError = err.message || String(err);
    throw err;
  } finally {
    starting = false;
  }
}

async function probeModelsReady() {
  if (!helper) return false;
  const url = `${helper.baseUrl()}/api/models`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const body = await res.json();
  return Boolean(body.ready);
}

async function fetchJson(pathname, options) {
  if (!helper) throw new Error("Helper is not running");
  const res = await fetch(`${helper.baseUrl()}${pathname}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function showModelsOrApp() {
  if (!helper || !mainWindow) return;
  modelsReady = await probeModelsReady();
  if (!modelsReady) {
    await mainWindow.loadFile(path.join(__dirname, "models.html"));
    return;
  }
  await mainWindow.loadURL(helper.baseUrl());
}

ipcMain.handle("desktop:get-state", async () => {
  try {
    if (!helper || !helper.port) {
      await startHelper();
    }
    modelsReady = await probeModelsReady();
    return {
      port: helper.port,
      baseUrl: helper.baseUrl(),
      modelsReady,
      userDataDir: userDataDir(),
      modelCacheDir: modelCacheDir(),
      dev: isDev(),
      error: null,
    };
  } catch (err) {
    return {
      port: null,
      baseUrl: null,
      modelsReady: false,
      userDataDir: userDataDir(),
      modelCacheDir: modelCacheDir(),
      dev: isDev(),
      error: err.message || String(err),
    };
  }
});

ipcMain.handle("desktop:retry-helper", async () => {
  await startHelper();
  return { ok: true, port: helper.port };
});

ipcMain.handle("desktop:open-app", async () => {
  await showModelsOrApp();
  return { ok: true, modelsReady };
});

ipcMain.handle("desktop:start-models", async () => {
  return fetchJson("/api/models/download", { method: "POST" });
});

ipcMain.handle("desktop:model-status", async () => {
  return fetchJson("/api/models/download");
});

app.whenReady().then(async () => {
  createWindow();
  try {
    await startHelper();
  } catch (err) {
    // Splash UI shows the error via get-state / logs.
    console.error(err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (!helper) return;
  event.preventDefault();
  const proc = helper;
  helper = null;
  try {
    await proc.stop();
  } catch (err) {
    console.error("helper stop failed", err);
  }
  app.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error(err);
  if (app.isReady()) {
    dialog.showErrorBox("Music Scribe", err.message || String(err));
  }
});
