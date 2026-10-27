"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

const APP_FOLDER = "MusicScribe";

function isDev() {
  return process.argv.includes("--dev") || !app.isPackaged;
}

function repoRoot() {
  // desktop/src -> desktop -> repo
  return path.resolve(__dirname, "..", "..");
}

function resourcesRoot() {
  if (isDev()) return repoRoot();
  return process.resourcesPath;
}

function frontendDir() {
  return path.join(resourcesRoot(), "frontend");
}

function userDataDir() {
  if (process.env.MUSICSCRIBE_USER_DATA) {
    return path.resolve(process.env.MUSICSCRIBE_USER_DATA);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_FOLDER);
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, APP_FOLDER);
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, APP_FOLDER);
}

function modelCacheDir() {
  if (process.env.MUSICSCRIBE_MODEL_CACHE) {
    return path.resolve(process.env.MUSICSCRIBE_MODEL_CACHE);
  }
  return path.join(userDataDir(), "models");
}

function ensureDirs() {
  for (const dir of [userDataDir(), modelCacheDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sidecarBinary() {
  const base = path.join(resourcesRoot(), "sidecar");
  if (process.platform === "win32") {
    const win = path.join(base, "music-scribe-helper.exe");
    if (fs.existsSync(win)) return win;
  } else {
    const unix = path.join(base, "music-scribe-helper");
    if (fs.existsSync(unix)) return unix;
  }
  return null;
}

function venvPython() {
  const root = repoRoot();
  if (process.platform === "win32") {
    const win = path.join(root, ".venv", "Scripts", "python.exe");
    if (fs.existsSync(win)) return win;
  } else {
    const unix = path.join(root, ".venv", "bin", "python");
    if (fs.existsSync(unix)) return unix;
  }
  return null;
}

module.exports = {
  isDev,
  repoRoot,
  resourcesRoot,
  frontendDir,
  userDataDir,
  modelCacheDir,
  ensureDirs,
  sidecarBinary,
  venvPython,
};
