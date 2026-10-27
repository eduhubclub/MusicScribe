// Bandscribe frontend: library, progress, and the song view (sheet / tab / chords / lyrics).
const app = document.getElementById("app");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const store = {
  get(k, d) {
    try {
      // "chordy." keys are from before the rename
      const v = localStorage.getItem("bandscribe." + k) ?? localStorage.getItem("chordy." + k);
      return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem("bandscribe." + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

async function json(res) {
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json();
}

const api = {
  list: () => fetch("/api/jobs").then(json),
  get: id => fetch(`/api/jobs/${id}`).then(json),
  privacy: () => fetch("/api/privacy").then(json),
  clearLocal: () => fetch("/api/privacy/clear", { method: "POST" }).then(json),
  upload(file, opts) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("whisper_model", opts.whisper_model);
    fd.append("language", opts.language);
    return fetch("/api/jobs", { method: "POST", body: fd }).then(json);
  },
  createManual: (title, lyrics) => fetch("/api/jobs/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lyrics }),
  }).then(json),
  rename: (id, title) => fetch(`/api/jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).then(json),
  upgrade: id => fetch(`/api/jobs/${id}/parts`, { method: "POST" }).then(json),
  lows: id => fetch(`/api/jobs/${id}/lows`).then(json),
  lyrics: (id, text) => fetch(`/api/jobs/${id}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(json),
  tuning: (id, body) => fetch(`/api/jobs/${id}/tuning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json),
  save: (id, result) => fetch(`/api/jobs/${id}/result`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) }).then(json),
  notes: (id, part) => fetch(`/api/jobs/${id}/notes/${part}`).then(json),
  saveNotes: (id, part, notes) => fetch(`/api/jobs/${id}/notes/${part}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) }).then(json),
  saveDrumHits: (id, hits) => fetch(`/api/jobs/${id}/drums/hits`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hits }) }).then(json),
  del: id => fetch(`/api/jobs/${id}`, { method: "DELETE" }).then(json),
  retry: id => fetch(`/api/jobs/${id}/retry`, { method: "POST" }).then(json),
};

const STAGES = [
  ["prepare", "Decoding audio"],
  ["separate", "Separating instruments"],
  ["rhythm", "Finding the beat"],
  ["chords", "Detecting chords"],
  ["lyrics", "Transcribing lyrics"],
  ["parts", "Transcribing each instrument"],
  ["finish", "Encoding audio"],
];
// Open-string MIDI pitches, low to high
const STANDARD = [40, 45, 50, 55, 59, 64];
const TUNINGS = [
  ["Standard", STANDARD],
  ["Half step down", STANDARD.map(p => p - 1)],
  ["Whole step down", STANDARD.map(p => p - 2)],
  ["Drop D", [38, 45, 50, 55, 59, 64]],
  ["Drop Db", [37, 44, 49, 54, 58, 63]],
  ["Drop C", [36, 43, 48, 53, 57, 62]],
  ["DADGAD", [38, 45, 50, 55, 57, 62]],
  ["Open G", [38, 43, 50, 55, 59, 62]],
  ["Open D", [38, 45, 50, 54, 57, 62]],
];
// How far the chord shapes sit from the sounding pitch: the A string is the reference.
const tuningShift = strings => strings[1] - STANDARD[1];
// The drop version of each uniform tuning, and older names for the same tunings.
const DROPS = { "Standard": "Drop D", "Half step down": "Drop Db", "Whole step down": "Drop C" };
const TUNING_ALIASES = { "Drop C#": "Drop Db" };
const isUniformShift = strings => strings.every((p, i) => p - STANDARD[i] === strings[0] - STANDARD[0]);
const UKULELE = [67, 60, 64, 69]; // G C E A (re-entrant)
const PART_VIEWS = [["guitar", "Guitar tab"], ["bass", "Bass tab"], ["piano", "Piano"], ["drums", "Drums"], ["melody", "Melody"]];
const TAB_VIEWS = ["guitar", "bass", "drums"];
const ROLL_VIEWS = ["piano", "melody"];
const STEM_LABELS = { mix: "Full mix", vocals: "Vocals only", guitar: "Guitar", bass: "Bass", piano: "Piano / keys", drums: "Drums", other: "Other" };
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);
const noteHz = (name, octave) => {
  const i = NOTE_NAMES.indexOf(name);
  return midiToHz((octave + 1) * 12 + i);
};
// Lucide names for tuner instrument toggles (see frontend/icons.js + vendor/lucide.min.js).
const TUNER_ICONS = {
  guitar: "guitar",
  bass: "audio-lines",
  ukulele: "music-2",
  mandolin: "music-3",
  violin: "music",
  viola: "music-4",
  cello: "audio-waveform",
};
const TUNER_INSTRUMENTS = [
  {
    id: "guitar",
    label: "Guitar",
    minHz: 70,
    strings: [
      { name: "E2", hz: noteHz("E", 2) },
      { name: "A2", hz: noteHz("A", 2) },
      { name: "D3", hz: noteHz("D", 3) },
      { name: "G3", hz: noteHz("G", 3) },
      { name: "B3", hz: noteHz("B", 3) },
      { name: "E4", hz: noteHz("E", 4) },
    ],
  },
  {
    id: "bass",
    label: "Bass",
    minHz: 35,
    strings: [
      { name: "E1", hz: noteHz("E", 1) },
      { name: "A1", hz: noteHz("A", 1) },
      { name: "D2", hz: noteHz("D", 2) },
      { name: "G2", hz: noteHz("G", 2) },
    ],
  },
  {
    id: "ukulele",
    label: "Ukulele",
    minHz: 170,
    strings: [
      { name: "G4", hz: noteHz("G", 4) },
      { name: "C4", hz: noteHz("C", 4) },
      { name: "E4", hz: noteHz("E", 4) },
      { name: "A4", hz: noteHz("A", 4) },
    ],
  },
  {
    id: "mandolin",
    label: "Mandolin",
    minHz: 170,
    strings: [
      { name: "G3", hz: noteHz("G", 3) },
      { name: "D4", hz: noteHz("D", 4) },
      { name: "A4", hz: noteHz("A", 4) },
      { name: "E5", hz: noteHz("E", 5) },
    ],
  },
  {
    id: "violin",
    label: "Violin",
    minHz: 170,
    strings: [
      { name: "G3", hz: noteHz("G", 3) },
      { name: "D4", hz: noteHz("D", 4) },
      { name: "A4", hz: noteHz("A", 4) },
      { name: "E5", hz: noteHz("E", 5) },
    ],
  },
  {
    id: "viola",
    label: "Viola",
    minHz: 110,
    strings: [
      { name: "C3", hz: noteHz("C", 3) },
      { name: "G3", hz: noteHz("G", 3) },
      { name: "D4", hz: noteHz("D", 4) },
      { name: "A4", hz: noteHz("A", 4) },
    ],
  },
  {
    id: "cello",
    label: "Cello",
    minHz: 55,
    strings: [
      { name: "C2", hz: noteHz("C", 2) },
      { name: "G2", hz: noteHz("G", 2) },
      { name: "D3", hz: noteHz("D", 3) },
      { name: "A3", hz: noteHz("A", 3) },
    ],
  },
];
function freqToNote(hz) {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  const name = NOTE_NAMES[((nearest % 12) + 12) % 12];
  const octave = Math.floor(nearest / 12) - 1;
  return { name, octave, cents, midi: nearest, label: `${name}${octave}` };
}
function detectPitchHz(buf, sampleRate, minHz = 70) {
  // Autocorrelation pitch detect — works for single open-string notes.
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return null;

  const floor = Math.max(30, minHz * 0.85);
  const minLag = Math.floor(sampleRate / 1200);  // ~1200 Hz ceiling
  const maxLag = Math.floor(sampleRate / floor);
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < buf.length - lag; i++) corr += buf[i] * buf[i + lag];
    const norm = corr / (buf.length - lag);
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestCorr < 0.01) return null;

  // Parabolic interpolation around the peak lag
  let y0 = 0, y2 = 0;
  for (let i = 0; i < buf.length - (bestLag - 1); i++) y0 += buf[i] * buf[i + bestLag - 1];
  y0 /= (buf.length - (bestLag - 1));
  for (let i = 0; i < buf.length - (bestLag + 1); i++) y2 += buf[i] * buf[i + bestLag + 1];
  y2 /= (buf.length - (bestLag + 1));
  const y1 = bestCorr;
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom ? (y0 - y2) / denom : 0;
  const lag = bestLag + Math.max(-1, Math.min(1, shift));
  return sampleRate / lag;
}
const confLevel = s => (s < 0.55 ? "low" : s < 0.75 ? "mid" : "ok");
const confBadge = (label, score, title = "") =>
  `<span class="conf-badge ${confLevel(score)}" title="${esc(title || "")}">${esc(label)} ${Math.round(score * 100)}%</span>`;
const confOverallBtn = (score, title = "") =>
  `<button type="button" class="conf-badge conf-overall ${confLevel(score)}" id="confOverall"
    title="${esc(title || "Show confidence breakdown")}">overall ${Math.round(score * 100)}%</button>`;
const confMetersHtml = conf => {
  const parts = Object.entries(conf.by_part || {});
  if (!parts.length) return "";
  return `<div class="conf-parts">${parts.map(([k, v]) => {
    const why = ((conf.part_reasons || {})[k] || []).join("; ");
    return `<div class="conf-row ${confLevel(v)}" title="${esc(why)}"><span>${esc(k)}</span><i style="width:${Math.round(v * 100)}%"></i><em>${Math.round(v * 100)}%</em></div>`;
  }).join("")}</div>`;
};

let confModalEsc = null;

function openConfidenceModal(conf, { auto = false, onDismiss } = {}) {
  if (!conf) return;
  closeConfidenceModal();
  const overlay = document.createElement("div");
  overlay.className = "conf-modal-overlay no-print";
  overlay.id = "confModal";
  overlay.innerHTML = `
    <div class="conf-modal" role="dialog" aria-modal="true" aria-labelledby="confModalTitle">
      <div class="conf-modal-head">
        <h2 id="confModalTitle">Confidence</h2>
        <button type="button" class="conf-modal-close" id="confModalClose" aria-label="Close">×</button>
      </div>
      <p class="conf-modal-overall">
        <span class="conf-badge ${confLevel(conf.overall)}">overall ${Math.round(conf.overall * 100)}%</span>
      </p>
      ${confMetersHtml(conf)}
      <p class="conf-modal-note">${esc(conf.disclaimer || "Scores flag uncertainty — not accuracy guarantees.")}</p>
      <button type="button" class="primary" id="confModalOk">${auto ? "Got it" : "Close"}</button>
    </div>`;
  document.body.appendChild(overlay);
  const dismiss = () => {
    closeConfidenceModal();
    onDismiss?.();
  };
  overlay.querySelector("#confModalClose").onclick = dismiss;
  overlay.querySelector("#confModalOk").onclick = dismiss;
  overlay.addEventListener("click", e => { if (e.target === overlay) dismiss(); });
  confModalEsc = e => { if (e.key === "Escape") dismiss(); };
  document.addEventListener("keydown", confModalEsc);
}

function closeConfidenceModal() {
  if (confModalEsc) {
    document.removeEventListener("keydown", confModalEsc);
    confModalEsc = null;
  }
  document.getElementById("confModal")?.remove();
}

let timers = [];
let cleanupFns = [];
const playbarEl = () => document.getElementById("playbar");

function hidePlaybar() {
  const bar = playbarEl();
  if (!bar) return;
  bar.hidden = true;
  bar.innerHTML = "";
  document.body.classList.remove("has-playbar");
}

function clearSidebarMeta() {
  const el = document.getElementById("sidebarMeta");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

function cleanup() {
  timers.forEach(clearTimeout);
  timers = [];
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];
  closeConfidenceModal();
  hidePlaybar();
  clearSidebarMeta();
}

function route() {
  cleanup();
  const m = location.hash.match(/^#\/job\/(\w+)/);
  if (m) showJob(m[1]);
  else if (/^#\/create\/?$/.test(location.hash)) showCreate();
  else if (/^#\/record\/?$/.test(location.hash)) showRecord();
  else if (/^#\/tuner\/?$/.test(location.hash)) showTuner();
  else if (/^#\/tab-your-own\/?$/.test(location.hash)) showTabYourOwn();
  else if (/^#\/library\/?$/.test(location.hash)) showLibraryGrid();
  else if (/^#\/upload\/?$/.test(location.hash)) showLibrary();
  else if (location.hash === "#/" || location.hash === "" || location.hash === "#") showCreate();
  else showLibrary();
  refreshSidebar();
  syncSidebarChrome();
}
window.addEventListener("hashchange", route);

/* ---------------- Sidebar library ---------------- */

function currentJobId() {
  const m = location.hash.match(/^#\/job\/(\w+)/);
  return m ? m[1] : null;
}

function setSidebarOpen(open) {
  document.body.classList.toggle("sidebar-open", open);
  const btn = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (btn) btn.setAttribute("aria-label", open ? "Close library menu" : "Open library menu");
  if (backdrop) backdrop.hidden = !open;
}

function shortTuningLabel(name) {
  if (name === "Standard") return "Std";
  if (name === "Half step down") return "½↓";
  if (name === "Whole step down") return "1↓";
  if (name.startsWith("Drop ")) return "Dr" + name.slice(5).replace(/\s/g, "");
  if (name.startsWith("Open ")) return "O" + name.slice(5, 6);
  return name.slice(0, 3);
}

function syncSidebarToolDensity() {
  const collapsed = document.body.classList.contains("sidebar-collapsed");
  document.querySelectorAll("#sidebarMeta select.tool-select option").forEach(opt => {
    if (!opt.dataset.full) opt.dataset.full = opt.textContent;
    if (!opt.dataset.short) {
      const sel = opt.closest("select");
      if (sel?.id === "capo") opt.dataset.short = opt.value === "0" ? "C0" : `C${opt.value}`;
      else opt.dataset.short = shortTuningLabel(opt.dataset.full || opt.value || opt.textContent);
    }
    opt.textContent = collapsed ? opt.dataset.short : opt.dataset.full;
  });
}

function setFootIcon(btn, name) {
  const host = btn?.querySelector(".sidebar-foot-icon");
  if (!host) return;
  if (window.MSIcons) MSIcons.set(host, name);
  else host.setAttribute("data-ms-icon", name);
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  store.set("sidebarCollapsed", collapsed);
  const btn = document.getElementById("sidebarCollapse");
  if (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    btn.title = collapsed ? "Expand Menu" : "Collapse Menu";
    setFootIcon(btn, collapsed ? "menu" : "panel-left-close");
    const label = btn.querySelector(".sidebar-foot-label");
    if (label) label.textContent = "Menu";
  }
  syncSidebarToolDensity();
}

function setDarkMode(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  store.set("darkMode", dark);
  const btn = document.getElementById("sidebarTheme");
  if (btn) {
    setFootIcon(btn, dark ? "sun" : "moon");
    const label = btn.querySelector(".sidebar-foot-label");
    if (label) label.textContent = dark ? "Light" : "Dark";
    btn.title = dark ? "Light Mode" : "Dark Mode";
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
}

function setSidebarSide(side) {
  const right = side === "right";
  document.body.classList.toggle("sidebar-right", right);
  store.set("sidebarSide", right ? "right" : "left");
  const btn = document.getElementById("sidebarFlip");
  if (btn) {
    btn.title = "Flip Sidebar";
    btn.setAttribute("aria-label", right ? "Move sidebar to the left" : "Move sidebar to the right");
  }
}

function syncSidebarChrome() {
  const library = document.getElementById("headerLibrary");
  const create = document.getElementById("headerCreate");
  const onLibrary = /^#\/library\/?$/.test(location.hash);
  const onCreateFlow = /^#\/(create|upload|record|tuner|tab-your-own)\/?$/.test(location.hash)
    || location.hash === "#/" || location.hash === "" || location.hash === "#";
  if (library) library.classList.toggle("on", onLibrary);
  if (create) create.classList.toggle("on", onCreateFlow && !onLibrary && !currentJobId());
  // Library grid / song page: hide the duplicate sidebar song list.
  document.body.classList.toggle("on-library-page", onLibrary);
  document.body.classList.toggle("on-song-page", !!currentJobId());
  // Close the drawer after navigating on narrow screens
  if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
}

async function refreshSidebar() {
  const el = document.getElementById("sidebarJobs");
  if (!el) return;
  let jobs;
  try { jobs = await api.list(); } catch {
    el.innerHTML = `<p class="sidebar-empty">Couldn't load library.</p>`;
    return;
  }
  if (!jobs.length) {
    el.innerHTML = `<p class="sidebar-empty">No songs yet — use Create to add one.</p>`;
    return;
  }
  const active = currentJobId();
  el.innerHTML = jobs.map(j => {
    const busy = j.status === "running" || j.status === "queued";
    const meta = busy
      ? (j.stage_label || j.status)
      : new Date(j.created * 1000).toLocaleDateString();
    const on = j.id === active ? " on" : "";
    return `<a class="sidebar-job${on}" href="#/job/${j.id}" title="${esc(j.title)}">
      <span class="sidebar-title">${esc(j.title)}</span>
      <span class="badge ${j.status}">${j.status === "done" ? "ready" : j.status}</span>
      <span class="sidebar-meta">${esc(meta)}</span>
    </a>`;
  }).join("");
  if (jobs.some(j => j.status === "running" || j.status === "queued")) {
    timers.push(setTimeout(refreshSidebar, 2000));
  }
}

function initSidebar() {
  const toggle = document.getElementById("sidebarToggle");
  const collapse = document.getElementById("sidebarCollapse");
  const themeBtn = document.getElementById("sidebarTheme");
  const flipBtn = document.getElementById("sidebarFlip");
  const backdrop = document.getElementById("sidebarBackdrop");
  toggle?.addEventListener("click", () => {
    setSidebarOpen(!document.body.classList.contains("sidebar-open"));
  });
  collapse?.addEventListener("click", () => {
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  });
  themeBtn?.addEventListener("click", () => {
    setDarkMode(document.documentElement.dataset.theme !== "dark");
  });
  flipBtn?.addEventListener("click", () => {
    setSidebarSide(document.body.classList.contains("sidebar-right") ? "left" : "right");
  });
  backdrop?.addEventListener("click", () => setSidebarOpen(false));
  setDarkMode(!!store.get("darkMode", false));
  setSidebarSide(store.get("sidebarSide", "left") === "right" ? "right" : "left");
  setSidebarCollapsed(!!store.get("sidebarCollapsed", false));
  // Hydrate any remaining data-ms-icon hosts (e.g. Flip) + header Lucide marks.
  document.querySelectorAll("[data-ms-icon]").forEach(host => {
    if (host.querySelector("svg, [data-lucide]")) return;
    const name = host.getAttribute("data-ms-icon");
    if (name) setFootIcon(host.closest("button") || host.parentElement, name);
  });
  // Flip is not updated by setDarkMode/collapse — paint from its data-ms-icon.
  const flipIcon = document.querySelector("#sidebarFlip .sidebar-foot-icon");
  if (flipIcon && !flipIcon.querySelector("svg")) {
    const name = flipIcon.getAttribute("data-ms-icon") || "arrow-left-right";
    if (window.MSIcons) MSIcons.set(flipIcon, name);
  }
  window.MSIcons?.paint(document);
  refreshSidebar();
  syncSidebarChrome();
}

let splashTimer = null;
let splashRemoveTimer = null;

function dismissSplash() {
  const el = document.getElementById("splash");
  if (!el || el.dataset.done === "1") return;
  el.dataset.done = "1";
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  el.classList.add("splash-out");
  document.body.classList.remove("splash-active");
  const btn = document.getElementById("splashContinue");
  btn?.setAttribute("aria-hidden", "true");
  // Keep outside route() cleanup timers so hash navigation doesn't yank the fade.
  if (splashRemoveTimer) clearTimeout(splashRemoveTimer);
  splashRemoveTimer = setTimeout(() => el.remove(), 500);
}

function initSplash() {
  const el = document.getElementById("splash");
  const btn = document.getElementById("splashContinue");
  if (!el) {
    document.body.classList.remove("splash-active");
    return;
  }
  const go = () => dismissSplash();
  // Click/tap anywhere on the splash (including Get started) continues.
  el.addEventListener("click", go);
  el.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
      e.preventDefault();
      go();
    }
  });
  // Brief hold, then fade into home/library.
  splashTimer = setTimeout(go, 2200);
  btn?.focus({ preventScroll: true });
}

initSplash();
initSidebar();
route();

/* ---------------- Create hub ---------------- */

function showCreate() {
  app.innerHTML = `
    <section class="create-page">
      <header class="create-page-head">
        <h1>Create</h1>
        <p class="lede">Choose how you want to start a song.</p>
      </header>
      <div class="create-tiles" role="list">
        <a class="create-tile" href="#/upload" role="listitem" title="Upload an audio or video file">
          <span class="create-tile-mark">${window.MSIcons ? MSIcons.el("upload", "create-tile-ico") : "↑"}</span>
          <span class="create-tile-label">Upload</span>
          <span class="create-tile-desc">MP3, WAV, FLAC, M4A, or video</span>
        </a>
        <a class="create-tile" href="#/record" role="listitem" title="Record with your microphone">
          <span class="create-tile-mark">${window.MSIcons ? MSIcons.el("mic", "create-tile-ico") : "●"}</span>
          <span class="create-tile-label">Record</span>
          <span class="create-tile-desc">Capture audio from your mic</span>
        </a>
        <a class="create-tile" href="#/tab-your-own" role="listitem" title="Paste lyrics and add your own chords">
          <span class="create-tile-mark">${window.MSIcons ? MSIcons.el("file-music", "create-tile-ico") : "♪"}</span>
          <span class="create-tile-label">Tab</span>
          <span class="create-tile-desc">Lyrics and chords, no audio</span>
        </a>
        <a class="create-tile" href="#/tuner" role="listitem" title="Tune your guitar with the microphone">
          <span class="create-tile-mark">${window.MSIcons ? MSIcons.el("guitar", "create-tile-ico") : "♮"}</span>
          <span class="create-tile-label">Tuner</span>
          <span class="create-tile-desc">Guitar, bass, uke, strings…</span>
        </a>
      </div>
    </section>`;
  window.MSIcons?.paint(app);
}

/* ---------------- Instrument tuner (mic pitch) ---------------- */

function showTuner() {
  const savedId = store.get("tunerInstrument", "guitar");
  let instrument = TUNER_INSTRUMENTS.find(i => i.id === savedId) || TUNER_INSTRUMENTS[0];

  app.innerHTML = `
    <section class="tuner-page">
      <header class="tuner-head">
        <h1>Tuner</h1>
        <p class="lede">Pick an instrument, then play a string — pitch is read from your microphone.</p>
      </header>
      <div class="tuner-instrument" role="radiogroup" aria-label="Instrument">
        ${TUNER_INSTRUMENTS.map(i => `
          <button type="button" class="tuner-inst-btn${i.id === instrument.id ? " on" : ""}"
            role="radio" aria-checked="${i.id === instrument.id ? "true" : "false"}"
            data-id="${i.id}" title="${esc(i.label)}" aria-label="${esc(i.label)}">
            <span class="tuner-ico">${window.MSIcons ? MSIcons.el(TUNER_ICONS[i.id] || "music") : ""}</span>
            <span class="tuner-inst-label">${esc(i.label)}</span>
          </button>`).join("")}
      </div>
      <div class="tuner-panel" id="tunerPanel">
        <div class="tuner-note" id="tunerNote">—</div>
        <div class="tuner-cents" id="tunerCents">Listen…</div>
        <div class="tuner-meter" aria-hidden="true">
          <div class="tuner-meter-track">
            <span class="tuner-meter-mark" style="left:0%"></span>
            <span class="tuner-meter-mark mid" style="left:50%"></span>
            <span class="tuner-meter-mark" style="left:100%"></span>
            <div class="tuner-meter-needle" id="tunerNeedle" style="left:50%"></div>
          </div>
          <div class="tuner-meter-labels"><span>−50¢</span><span>0</span><span>+50¢</span></div>
        </div>
        <div class="tuner-hz" id="tunerHz"></div>
        <div class="tuner-strings" id="tunerStrings"></div>
        <canvas class="tuner-wave" id="tunerWave" width="640" height="80" aria-hidden="true"></canvas>
        <p class="tuner-status" id="tunerStatus">Starting microphone…</p>
        <button type="button" class="primary" id="tunerToggle" hidden>Start tuner</button>
      </div>
    </section>`;

  const noteEl = app.querySelector("#tunerNote");
  const centsEl = app.querySelector("#tunerCents");
  const needleEl = app.querySelector("#tunerNeedle");
  const hzEl = app.querySelector("#tunerHz");
  const statusEl = app.querySelector("#tunerStatus");
  const toggleBtn = app.querySelector("#tunerToggle");
  const stringsEl = app.querySelector("#tunerStrings");
  const instrumentGroup = app.querySelector(".tuner-instrument");
  const wave = app.querySelector("#tunerWave");
  const waveCtx = wave.getContext("2d");

  let audioCtx = null;
  let stream = null;
  let analyser = null;
  let buf = null;
  let raf = 0;
  let running = false;
  let smoothCents = 0;

  function renderStrings() {
    stringsEl.innerHTML = instrument.strings
      .map(s => `<span class="tuner-string" data-name="${esc(s.name)}">${esc(s.name)}</span>`)
      .join("");
  }

  function drawWave(data) {
    const w = wave.width;
    const h = wave.height;
    waveCtx.clearRect(0, 0, w, h);
    waveCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--edu-blue-600").trim() || "#2563eb";
    waveCtx.lineWidth = 2;
    waveCtx.beginPath();
    const step = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      const v = data[x * step] || 0;
      const y = (0.5 - v * 0.45) * h;
      if (x === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
  }

  function highlightString(label) {
    stringsEl.querySelectorAll(".tuner-string").forEach(el => {
      el.classList.toggle("on", el.dataset.name === label);
    });
  }

  function tick() {
    if (!running || !analyser) return;
    analyser.getFloatTimeDomainData(buf);
    drawWave(buf);
    const hz = detectPitchHz(buf, audioCtx.sampleRate, instrument.minHz);
    if (hz) {
      const note = freqToNote(hz);
      smoothCents = smoothCents * 0.7 + note.cents * 0.3;
      const cents = Math.round(smoothCents);
      const inTune = Math.abs(cents) <= 5;
      noteEl.textContent = note.label;
      noteEl.classList.toggle("in-tune", inTune);
      centsEl.textContent = cents === 0 ? "In tune" : `${cents > 0 ? "+" : ""}${cents} cents`;
      centsEl.classList.toggle("in-tune", inTune);
      const clamped = Math.max(-50, Math.min(50, smoothCents));
      needleEl.style.left = `${((clamped + 50) / 100) * 100}%`;
      needleEl.classList.toggle("in-tune", inTune);
      hzEl.textContent = `${hz.toFixed(1)} Hz`;
      // Closest open string for the selected instrument (within ~1 semitone)
      let closest = null;
      let best = Infinity;
      for (const s of instrument.strings) {
        const diff = Math.abs(12 * Math.log2(hz / s.hz));
        if (diff < best) { best = diff; closest = s.name; }
      }
      highlightString(best < 0.6 ? closest : null);
      statusEl.textContent = "Listening";
    } else {
      statusEl.textContent = "Play a note…";
    }
    raf = requestAnimationFrame(tick);
  }

  function selectInstrument(id) {
    instrument = TUNER_INSTRUMENTS.find(i => i.id === id) || TUNER_INSTRUMENTS[0];
    store.set("tunerInstrument", instrument.id);
    instrumentGroup.querySelectorAll(".tuner-inst-btn").forEach(btn => {
      const on = btn.dataset.id === instrument.id;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    renderStrings();
    highlightString(null);
    noteEl.textContent = "—";
    noteEl.classList.remove("in-tune");
    centsEl.textContent = "Listen…";
    centsEl.classList.remove("in-tune");
    needleEl.style.left = "50%";
    needleEl.classList.remove("in-tune");
    hzEl.textContent = "";
    smoothCents = 0;
  }
  instrumentGroup.querySelectorAll(".tuner-inst-btn").forEach(btn => {
    btn.onclick = () => selectInstrument(btn.dataset.id);
  });
  renderStrings();
  window.MSIcons?.paint(app);

  async function start() {
    statusEl.textContent = "Starting microphone…";
    toggleBtn.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      // Larger buffer helps low bass fundamentals
      analyser.fftSize = 8192;
      src.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      running = true;
      statusEl.textContent = "Listening";
      tick();
    } catch (e) {
      statusEl.textContent = `Microphone unavailable: ${e.message}`;
      toggleBtn.hidden = false;
      toggleBtn.textContent = "Try again";
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try { stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    try { audioCtx?.close(); } catch { /* ignore */ }
    stream = null;
    audioCtx = null;
    analyser = null;
  }

  toggleBtn.onclick = () => start();
  cleanupFns.push(stop);
  start();
}

/* ---------------- Record (microphone) ---------------- */

function showRecord() {
  const opts = store.get("opts", { whisper_model: "small", language: "" });
  app.innerHTML = `
    <section class="home-hero record-hero">
      <h1>Record</h1>
      <p class="lede">Capture a take with your microphone. Everything stays on this computer.</p>
      <button class="primary" id="rec">Start recording</button>
      <div class="options">
        <label>Lyrics quality
          <select id="wm">
            <option value="small">Fast (small)</option>
            <option value="medium">Better (medium)</option>
            <option value="large-v3-turbo">Best (large-v3-turbo)</option>
          </select>
        </label>
        <label>Language
          <select id="lang">
            <option value="">Auto-detect</option>
            ${["en English", "es Spanish", "fr French", "de German", "it Italian", "pt Portuguese", "nl Dutch", "sv Swedish", "ja Japanese", "ko Korean", "zh Chinese"]
              .map(s => `<option value="${s.slice(0, 2)}">${s.slice(3)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p id="status" style="margin:14px 0 0"></p>
    </section>`;
  const wm = app.querySelector("#wm");
  const lang = app.querySelector("#lang");
  const status = app.querySelector("#status");
  const recBtn = app.querySelector("#rec");
  wm.value = opts.whisper_model;
  lang.value = opts.language;
  const currentOpts = () => {
    const o = { whisper_model: wm.value, language: lang.value };
    store.set("opts", o);
    return o;
  };
  async function upload(file) {
    status.innerHTML = `<span class="upload-busy"><img class="wizard-line-art" src="/assets/wizard-sax.png" alt=""> Uploading ${esc(file.name)}…</span>`;
    try {
      const meta = await api.upload(file, currentOpts());
      location.hash = `#/job/${meta.id}`;
    } catch (e) {
      status.textContent = `Upload failed: ${e.message}`;
    }
  }
  let recorder = null;
  recBtn.onclick = async () => {
    if (recorder) { recorder.stop(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      status.textContent = `Microphone unavailable: ${e.message}`;
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      recorder = null;
      clearInterval(tick);
      recBtn.textContent = "Start recording";
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      upload(new File(chunks, `Recording ${stamp}.webm`, { type: "audio/webm" }));
    };
    recorder.start();
    const t0 = Date.now();
    const tick = setInterval(() => { recBtn.innerHTML = `<span class="rec-dot"></span>Stop (${fmtTime((Date.now() - t0) / 1000)})`; }, 250);
    cleanupFns.push(() => { if (recorder) { recorder.onstop = null; recorder.stop(); stream.getTracks().forEach(t => t.stop()); clearInterval(tick); } });
  };
}

/* ---------------- Tab your own (no audio) ---------------- */

function showTabYourOwn() {
  app.innerHTML = `
    <section class="tabown-hero">
      <h1>Tab your own</h1>
      <p class="lede">Paste lyrics, then add chords on the paper sheet. No audio required — saved in your local library.</p>
      <label class="tabown-field">Title
        <input type="text" id="tabownTitle" placeholder="Song title (optional)" maxlength="200">
      </label>
      <label class="tabown-field">Lyrics
        <textarea id="tabownLyrics" class="tabown-lyrics" spellcheck="true"
          placeholder="Paste lyrics here…&#10;&#10;VERSE&#10;When the night is long&#10;&#10;CHORUS&#10;Hold the line"></textarea>
      </label>
      <div class="tabown-actions">
        <button class="primary" id="tabownCreate">Create sheet</button>
        <span id="tabownStatus" class="hint" style="margin:0"></span>
      </div>
    </section>`;
  const titleEl = app.querySelector("#tabownTitle");
  const lyricsEl = app.querySelector("#tabownLyrics");
  const status = app.querySelector("#tabownStatus");
  const create = app.querySelector("#tabownCreate");
  lyricsEl.focus();
  create.onclick = async () => {
    const lyrics = lyricsEl.value.trim();
    if (!lyrics) { status.textContent = "Paste some lyrics first."; return; }
    create.disabled = true;
    status.textContent = "Creating…";
    try {
      const job = await api.createManual(titleEl.value.trim(), lyrics);
      location.hash = `#/job/${job.id}`;
    } catch (e) {
      status.textContent = `Couldn't create: ${e.message}`;
      create.disabled = false;
    }
  };
}

/* ---------------- Library grid (all songs) ---------------- */

async function showLibraryGrid() {
  app.innerHTML = `
    <section class="library-page">
      <header class="library-page-head">
        <h1>Library</h1>
        <p class="lede">All songs on this device.</p>
      </header>
      <div class="library-grid" id="libraryGrid">
        <p class="empty">Loading…</p>
      </div>
    </section>`;
  await refreshLibraryGrid();
}

async function refreshLibraryGrid() {
  const el = document.getElementById("libraryGrid");
  refreshSidebar();
  if (!el) return;
  let jobs;
  try { jobs = await api.list(); } catch {
    el.innerHTML = `<p class="empty">Couldn't load library.</p>`;
    return;
  }
  if (!jobs.length) {
    el.innerHTML = `<p class="empty">No songs yet — <a href="#/create">Create</a> one.</p>`;
    return;
  }
  el.innerHTML = jobs.map(j => {
    const busy = j.status === "running" || j.status === "queued";
    const meta = busy
      ? (j.stage_label || j.status)
      : new Date(j.created * 1000).toLocaleDateString();
    return `<a class="library-card" href="#/job/${j.id}" title="${esc(j.title)}">
      <span class="library-card-title">${esc(j.title)}</span>
      <span class="badge ${j.status}">${j.status === "done" ? "ready" : j.status}</span>
      ${busy ? `<span class="bar"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></span>` : ""}
      <span class="library-card-meta">${esc(meta)}</span>
    </a>`;
  }).join("");
  if (jobs.some(j => j.status === "running" || j.status === "queued")) {
    timers.push(setTimeout(refreshLibraryGrid, 2000));
  }
}

/* ---------------- Home (upload-first) ---------------- */

function showLibrary() {
  const opts = store.get("opts", { whisper_model: "small", language: "" });
  app.innerHTML = `
    <section class="home-hero drop" id="drop">
      <h1>Upload your song</h1>
      <p class="lede">Drop an MP3, WAV, FLAC, M4A, or video — or pick a file. Everything stays on this computer.</p>
      <input type="file" id="file" accept="audio/*,video/*" hidden>
      <button class="primary" id="pick">Choose a file</button>
      <div class="options">
        <label>Lyrics quality
          <select id="wm">
            <option value="small">Fast (small)</option>
            <option value="medium">Better (medium)</option>
            <option value="large-v3-turbo">Best (large-v3-turbo)</option>
          </select>
        </label>
        <label>Language
          <select id="lang">
            <option value="">Auto-detect</option>
            ${["en English", "es Spanish", "fr French", "de German", "it Italian", "pt Portuguese", "nl Dutch", "sv Swedish", "ja Japanese", "ko Korean", "zh Chinese"]
              .map(s => `<option value="${s.slice(0, 2)}">${s.slice(3)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p id="status" style="margin:14px 0 0"></p>
    </section>
    <section class="home-recent">
      <h2>Recent on this device</h2>
      <div class="jobs" id="jobs"></div>
    </section>
    <div class="privacy-banner" id="privacyBanner">
      <strong>Private by default.</strong>
      <span id="privacyText">Loading privacy status…</span>
      <button id="clearLocal" title="Delete ephemeral jobs and browser prefs on this machine">Clear local data</button>
    </div>`;

  api.privacy().then(p => {
    app.querySelector("#privacyText").textContent = p.promise;
  }).catch(() => {
    app.querySelector("#privacyText").textContent =
      "Helper unreachable. When running locally, audio never leaves this PC.";
  });
  app.querySelector("#clearLocal").onclick = async () => {
    if (!confirm("Delete all local song jobs and browser prefs on this machine? This cannot be undone.")) return;
    try {
      if (window.LocalStore) await LocalStore.clearAllLocalData();
      else await api.clearLocal();
      location.hash = "#/create";
      route();
    } catch (e) {
      alert(`Clear failed: ${e.message}`);
    }
  };

  const drop = app.querySelector("#drop");
  const fileInput = app.querySelector("#file");
  const wm = app.querySelector("#wm");
  const lang = app.querySelector("#lang");
  const status = app.querySelector("#status");
  wm.value = opts.whisper_model;
  lang.value = opts.language;
  const currentOpts = () => {
    const o = { whisper_model: wm.value, language: lang.value };
    store.set("opts", o);
    return o;
  };

  async function upload(file) {
    status.innerHTML = `<span class="upload-busy"><img class="wizard-line-art" src="/assets/wizard-sax.png" alt=""> Uploading ${esc(file.name)}…</span>`;
    try {
      const meta = await api.upload(file, currentOpts());
      location.hash = `#/job/${meta.id}`;
    } catch (e) {
      status.textContent = `Upload failed: ${e.message}`;
    }
  }

  app.querySelector("#pick").onclick = () => fileInput.click();
  fileInput.onchange = () => fileInput.files[0] && upload(fileInput.files[0]);
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) upload(f);
  });

  refreshList();
}

async function refreshList() {
  const el = document.getElementById("jobs");
  refreshSidebar();
  if (!el) return;
  let jobs;
  try { jobs = await api.list(); } catch { return; }
  if (!jobs.length) {
    el.innerHTML = `<p class="empty">No songs yet — upload one above to get started.</p>`;
    return;
  }
  el.innerHTML = jobs.map(j => {
    const busy = j.status === "running" || j.status === "queued";
    return `<a class="job" href="#/job/${j.id}">
      <span class="title">${esc(j.title)}</span>
      ${busy ? `<span class="meta">${esc(j.stage_label || "")}</span><span class="bar"><i style="width:${Math.round(j.progress * 100)}%"></i></span>` : ""}
      <span class="badge ${j.status}">${j.status === "done" ? "ready" : j.status}</span>
      <span class="meta">${new Date(j.created * 1000).toLocaleDateString()}</span>
      <button class="danger" data-del="${j.id}" ${j.status === "running" ? "disabled" : ""}>Delete</button>
    </a>`;
  }).join("");
  el.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.armed) {
        await api.del(btn.dataset.del).catch(() => {});
        refreshList();
        refreshSidebar();
      } else {
        btn.dataset.armed = "1";
        btn.textContent = "Confirm?";
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete"; }, 3000);
      }
    };
  });
  if (jobs.some(j => j.status === "running" || j.status === "queued")) {
    timers.push(setTimeout(refreshList, 2000));
  }
}

/* ---------------- Job / progress ---------------- */

async function showJob(id) {
  let job;
  try { job = await api.get(id); } catch (e) {
    app.innerHTML = `<p class="empty">Couldn't load this song: ${esc(e.message)}. <a href="#/create">Back</a></p>`;
    return;
  }
  if (job.status === "done" && job.result) showSong(job);
  else showProgress(job);
}

function showProgress(job) {
  const idx = STAGES.findIndex(([id]) => id === job.stage);
  const failed = job.status === "error";
  const pct = Math.max(0, Math.min(100, Math.round((job.progress || 0) * 100)));
  const statusLine = failed
    ? "Processing failed"
    : job.status === "queued" && idx < 0
      ? "Waiting in queue…"
      : esc(job.stage_label || "Working…");
  app.innerHTML = `
    <div class="progress-card loading-card">
      <img class="loading-hero wizard-line-art" src="/assets/wizard-sax.webp?v=3" alt="" width="220" height="256"
           onerror="this.onerror=null;this.src='/assets/wizard-sax.png?v=3'">
      <h2 style="margin:0">${esc(job.title)}</h2>
      <p class="facts" style="margin:6px 0 0">${statusLine}</p>
      <div class="progress-row">
        <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <span class="progress-fill" style="width:${pct}%"></span>
        </div>
        <span class="progress-pct">${pct}%</span>
      </div>
      <ul class="stages">
        ${STAGES.map(([id, label], i) => `<li class="${i < idx ? "done" : i === idx ? (failed ? "failed" : "active") : ""}">${label}</li>`).join("")}
      </ul>
      ${failed ? `<p class="error-box">${esc(job.error || "Unknown error")}</p><button class="primary" id="retry">Retry</button>` : ""}
      <p class="hint" style="margin-top:18px">The first run downloads the separation and lyrics models, which takes a few extra minutes.</p>
    </div>`;
  if (failed) {
    app.querySelector("#retry").onclick = async () => { await api.retry(job.id); showJob(job.id); };
    return;
  }
  timers.push(setTimeout(async () => {
    try { job = await api.get(job.id); } catch { /* transient */ }
    if (job.status === "done" && job.result) showSong(job); else showProgress(job);
  }, 1500));
}

/* ---------------- Song view ---------------- */

function showSong(job) {
  const r = job.result;
  const id = job.id;
  const origTonic = Chords.pc(r.key.tonic);
  const origFlats = Chords.keyUsesFlats(origTonic, r.key.mode);
  const st = {
    semis: store.get(`semis.${id}`, 0),
    view: store.get("view", "sheet"),
    follow: store.get("follow", true),
    simple: store.get("simple", false),
    keys: store.get("keys", false),
    instr: store.get("instr", "guitar"),
    stem: "mix",
  };
  if (!r.parts && r.tab) r.parts = { guitar: r.tab }; // songs from before parts existed
  r.parts ||= {};
  if (st.view === "tab") st.view = "guitar";
  const VIEWS = ["sheet", ...PART_VIEWS.map(([k]) => k).filter(k => r.parts[k]), "chords", "lyrics"];
  if (!VIEWS.includes(st.view)) st.view = "sheet";

  r.tuning ||= { name: "Standard", strings: STANDARD, capo: 0 };

  // Chord names show the shapes you play: sounding pitch (+ key transpose) minus tuning and capo.
  const offset = () => st.semis - tuningShift(r.tuning.strings) - r.tuning.capo;
  const spell = (name, semis) => {
    if (name === "N") return "N.C.";
    if (!semis) return name;
    return Chords.transpose(name, semis, Chords.keyUsesFlats((origTonic + semis + 120) % 12, r.key.mode));
  };
  const show = name => spell(st.simple ? Chords.simplify(name) : name, offset());
  // Pianos and ukuleles aren't tuned down with the guitar: they read the sounding chord (plus transpose).
  const concert = name => spell(st.simple ? Chords.simplify(name) : name, st.semis);
  // Open strings relative to the shapes being named (a half-step-down guitar plays standard shapes).
  const shapeStrings = () => r.tuning.strings.map(p => p - tuningShift(r.tuning.strings));
  const keyName = () => {
    const sounding = `${spell(r.key.tonic, st.semis)} ${r.key.mode}`;
    return offset() === st.semis ? sounding : `${sounding} · shapes in ${show(r.key.tonic)}`;
  };

  // Measure start/end times
  const beatTime = i => (i < r.beats.length ? r.beats[i] : r.duration);
  const measures = r.measures.map((m, i) => ({ ...m, i, start: beatTime(m.beat), end: beatTime(m.beat + m.beats) }));

  const segStarts = () => r.chords.map(s => s.start);
  function segIndexAt(t) {
    const starts = segStarts();
    let lo = 0, hi = starts.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  const chordAt = t => (r.chords.length ? r.chords[segIndexAt(t)].chord : "N");

  function measureChords(m) {
    const out = [];
    for (const s of r.chords) {
      if (s.end <= m.start + 0.05 || s.start >= m.end - 0.05) continue;
      if (!out.length || show(out[out.length - 1]) !== show(s.chord)) out.push(s.chord);
    }
    return out;
  }

  const metaEl = document.getElementById("sidebarMeta");
  if (metaEl) {
    metaEl.hidden = false;
    metaEl.innerHTML = `
      <div class="sidebar-song-title" id="sidebarSongTitle" title="${esc(job.title)}">${esc(job.title)}</div>
      <hr class="sidebar-meta-rule title-rule" aria-hidden="true">
      <div class="facts">
        <span>Key <b id="key"></b></span>
        <span>Tempo <b>${Math.round(r.tempo)} BPM</b></span>
        <span>Length <b>${fmtTime(r.duration)}</b></span>
        ${r.parts?.guitar ? `<span class="source-badge ${r.parts.guitar.source_fallback ? "fallback" : ""}" title="${esc(r.parts.guitar.source_reason || "")}">Source: ${esc(STEM_LABELS[r.parts.guitar.source] || r.parts.guitar.source)}</span>` : ""}
        ${(job.manual || r.manual || r.no_audio) ? `<span class="source-badge">Tab your own</span>` : ""}
        ${r.confidence ? confOverallBtn(r.confidence.overall, r.confidence.disclaimer) : ""}
      </div>
      <hr class="sidebar-meta-rule">
      <div class="sidebar-song-tools no-print">
        <div class="controls">
          <select id="tuning" class="tool-select" title="Your guitar's tuning: chord names, diagrams and tab follow it" aria-label="Tuning">
            ${TUNINGS.map(([n]) => `<option value="${esc(n)}" data-short="${n === "Standard" ? "Std" : esc(n.slice(0, 3))}">${n}</option>`).join("")}
          </select>
          <select id="capo" class="tool-select" title="Capo" aria-label="Capo">
            ${Array.from({ length: 10 }, (_, c) => `<option value="${c}" data-short="${c ? `C${c}` : "C0"}">${c ? `Capo ${c}` : "No capo"}</option>`).join("")}
          </select>
          <div class="transpose" title="Transpose to another key (resets when you change tuning or capo)">
            <button type="button" id="down" aria-label="Transpose down">−</button>
            <span id="semis"></span>
            <button type="button" id="up" aria-label="Transpose up">+</button>
          </div>
          <label class="tool-check" title="Show plain major/minor chords (Gsus2 → G, Dmaj7 → D)">
            <input type="checkbox" id="simple">
            <span class="tool-full">Simple chords</span>
            <span class="tool-compact" aria-hidden="true">Sim</span>
          </label>
          <label class="tool-check" title="Keep the current line in view while playing (pauses briefly when you scroll yourself)">
            <input type="checkbox" id="follow">
            <span class="tool-full">Auto-scroll</span>
            <span class="tool-compact" aria-hidden="true">Auto</span>
          </label>
          <button type="button" id="keysBtn" class="tool-btn" title="Live keyboard: the current chord to play, the next one, and the piano track's notes">
            <span class="tool-full">Keyboard</span>
            <span class="tool-compact" aria-hidden="true">Kb</span>
          </button>
          <button type="button" id="export" class="tool-btn" title="Export .txt">
            <span class="tool-full">Export .txt</span>
            <span class="tool-compact" aria-hidden="true">TXT</span>
          </button>
          ${(job.manual || r.manual || r.no_audio) ? "" : `<button type="button" id="pdf" class="tool-btn" title="Download a printable PDF (chords + guitar by default)">
            <span class="tool-full">Export PDF</span>
            <span class="tool-compact" aria-hidden="true">PDF</span>
          </button>
          <a class="button tool-btn" href="/api/jobs/${id}/midi/all" download title="Every part as one MIDI file">
            <span class="tool-full">MIDI</span>
            <span class="tool-compact" aria-hidden="true">MID</span>
          </a>`}
          <button type="button" id="print" class="tool-btn" title="Print">
            <span class="tool-full">Print</span>
            <span class="tool-compact" aria-hidden="true">Prn</span>
          </button>
        </div>
      </div>`;
  }

  app.innerHTML = `
    <div id="kbd" class="kbd-wrap kbd-host no-print" hidden></div>
    <div id="upgrade"></div>
    <div id="suggest"></div>
    <nav class="tabs">
      <button data-view="sheet">Chord sheet</button>
      ${PART_VIEWS.filter(([k]) => r.parts[k]).map(([k, label]) => `<button data-view="${k}">${label}</button>`).join("")}
      <button data-view="chords">Chords</button>
      <button data-view="lyrics">Lyrics</button>
    </nav>
    <section id="view"></section>`;

  const noAudio = !!(job.manual || r.manual || r.no_audio);

  // Sticky footer transport (primary play bar)
  const bar = playbarEl();
  bar.hidden = false;
  document.body.classList.add("has-playbar");
  if (noAudio) {
    bar.innerHTML = `
      <span class="playbar-note">No audio — click chords on the paper to add them · edit lyrics by double-click</span>
      <div class="now"><span class="cur" id="cur">–</span><span class="nxt" id="nxt"></span></div>
      <span class="times"><span id="tCur">0:00</span> / <span id="tDur">${fmtTime(r.duration)}</span></span>`;
  } else {
    bar.innerHTML = `
      <button type="button" class="play-toggle" id="playToggle" title="Play / pause" aria-label="Play">▶</button>
      <div class="now"><span class="cur" id="cur">–</span><span class="nxt" id="nxt"></span></div>
      <span class="times"><span id="tCur">0:00</span> / <span id="tDur">${fmtTime(r.duration)}</span></span>
      <input class="seek" id="seek" type="range" min="0" max="${Math.max(1, Math.round(r.duration * 1000))}" value="0" step="50" aria-label="Seek">
      <select class="stem-pick" id="stem" title="What to listen to">
        ${["mix", ...(r.stems || [])].map(s => `<option value="${s}">${STEM_LABELS[s] || s}</option>`).join("")}
      </select>
      <audio id="audio" preload="auto" src="/api/jobs/${id}/audio/mix"></audio>`;
  }

  const audio = noAudio
    ? {
        currentTime: 0,
        paused: true,
        duration: r.duration,
        play() { return Promise.resolve(); },
        pause() {},
        addEventListener() {},
        removeEventListener() {},
      }
    : bar.querySelector("#audio");
  const view = app.querySelector("#view");
  const curEl = bar.querySelector("#cur");
  const nxtEl = bar.querySelector("#nxt");
  const playToggle = bar.querySelector("#playToggle");
  const seek = bar.querySelector("#seek");
  const tCur = bar.querySelector("#tCur");
  const tDur = bar.querySelector("#tDur");

  if (!noAudio) {
    const syncPlayUi = () => {
      playToggle.textContent = audio.paused ? "▶" : "❚❚";
      playToggle.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    };
    playToggle.onclick = () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    };
    audio.addEventListener("play", syncPlayUi);
    audio.addEventListener("pause", syncPlayUi);
    audio.addEventListener("ended", syncPlayUi);
    syncPlayUi();

    let seeking = false;
    seek.onpointerdown = () => { seeking = true; };
    seek.onpointerup = () => {
      audio.currentTime = (+seek.value) / 1000;
      seeking = false;
    };
    seek.onchange = () => { audio.currentTime = (+seek.value) / 1000; seeking = false; };
    const syncSeek = () => {
      if (!seeking && Number.isFinite(audio.currentTime)) {
        seek.value = String(Math.round(audio.currentTime * 1000));
        tCur.textContent = fmtTime(audio.currentTime);
      }
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        seek.max = String(Math.round(audio.duration * 1000));
        tDur.textContent = fmtTime(audio.duration);
      }
    };
    audio.addEventListener("timeupdate", syncSeek);
    audio.addEventListener("loadedmetadata", syncSeek);

    bar.querySelector("#stem").onchange = e => {
      const t = audio.currentTime, playing = !audio.paused;
      audio.src = `/api/jobs/${id}/audio/${e.target.value}`;
      audio.addEventListener("loadedmetadata", () => { audio.currentTime = t; if (playing) audio.play(); syncPlayUi(); }, { once: true });
    };
  }

  function updateHeader() {
    const keyEl = document.getElementById("key");
    if (keyEl) keyEl.textContent = keyName();
    const semisEl = document.getElementById("semis");
    if (semisEl) semisEl.textContent = st.semis ? (st.semis > 0 ? `+${st.semis}` : st.semis) : "0";
  }
  const setSemis = d => {
    st.semis = ((st.semis + d + 17) % 12) - 5; // keep within -5..+6
    store.set(`semis.${id}`, st.semis);
    updateHeader();
    render();
  };
  document.getElementById("down").onclick = () => setSemis(-1);
  document.getElementById("up").onclick = () => setSemis(1);

  // Tuning and capo: the server re-frets the tab, the page re-labels chords as shapes.
  const tuningSel = document.getElementById("tuning");
  const capoSel = document.getElementById("capo");
  const syncTuningControls = () => {
    r.tuning.name = TUNING_ALIASES[r.tuning.name] || r.tuning.name;
    if (!TUNINGS.some(([n]) => n === r.tuning.name)) {
      const opt = new Option(r.tuning.name, r.tuning.name);
      opt.dataset.full = r.tuning.name;
      opt.dataset.short = shortTuningLabel(r.tuning.name);
      tuningSel.add(opt);
    }
    tuningSel.value = r.tuning.name;
    capoSel.value = String(r.tuning.capo);
    syncSidebarToolDensity();
  };
  async function setTuning(name, capo) {
    const strings = (TUNINGS.find(([n]) => n === name) || [name, r.tuning.strings])[1];
    tuningSel.disabled = capoSel.disabled = true;
    try {
      const res = await api.tuning(id, { name, strings, capo });
      r.parts = res.parts;
      r.tuning = res.tuning;
      // A key transpose was usually standing in for the tuning, so it would now count twice.
      st.semis = 0;
      store.set(`semis.${id}`, 0);
    } catch (e) {
      console.warn("retune failed", e);
    }
    tuningSel.disabled = capoSel.disabled = false;
    syncTuningControls();
    updateHeader();
    renderSuggestion();
    render();
  }
  tuningSel.onchange = () => setTuning(tuningSel.value, +capoSel.value);
  capoSel.onchange = () => setTuning(tuningSel.value, +capoSel.value);

  // Suggest a down-tuning when the chords would then be open shapes (e.g. Db -> D on Eb tuning),
  // and its drop version when the guitar keeps playing a note a tone below the lowest string.
  let lows = null;
  const lower = name => name[0].toLowerCase() + name.slice(1); // "Drop Db" -> "drop Db"
  async function renderSuggestion() {
    const box = app.querySelector("#suggest");
    box.innerHTML = "";
    if (store.get(`tuneHintOff.${id}`, false)) return;
    const total = r.chords.reduce((a, s) => a + (s.chord === "N" ? 0 : s.end - s.start), 0);
    if (!total) return;
    const fit = strings => {
      const o = -tuningShift(strings) - r.tuning.capo;
      let open = 0;
      for (const s of r.chords) if (s.chord !== "N" && Chords.isOpenShape(spell(s.chord, o))) open += s.end - s.start;
      return open / total;
    };
    const current = fit(r.tuning.strings);
    const uniform = TUNINGS.slice(0, 3);
    let [family, familyStrings] = uniform.reduce((best, t) => (fit(t[1]) > fit(best[1]) ? t : best), uniform[0]);
    if (fit(familyStrings) < current + 0.2) {
      // Keep the current chord shapes; only the low string can still change.
      const same = uniform.find(([, st]) => tuningShift(st) === tuningShift(r.tuning.strings));
      if (!same) return;
      [family, familyStrings] = same;
    }
    if (!lows && r.parts?.guitar) lows = await api.lows(id).catch(() => ({ total: 0, lows: {} }));
    const dropNote = familyStrings[0] - 2;
    const dropSecs = lows?.lows?.[dropNote] || 0;
    const dropped = dropSecs >= 4 && dropSecs >= 0.02 * lows.total;
    const [name, strings] = dropped ? TUNINGS.find(([n]) => n === DROPS[family]) : [family, familyStrings];
    // Never talk someone out of a drop tuning they picked.
    if (name === r.tuning.name || (!dropped && DROPS[name] === r.tuning.name)) return;
    const o = -tuningShift(strings) - r.tuning.capo;
    const sample = [...new Set(r.chords.filter(s => s.chord !== "N").map(s => spell(s.chord, o)))].slice(0, 5).join(", ");
    const shapes = family === r.tuning.name || tuningShift(strings) === tuningShift(r.tuning.strings) ? ""
      : `These chords look like open shapes on a guitar tuned <b>${lower(family)}</b> (${sample}…):
         ${Math.round(fit(strings) * 100)}% open shapes, versus ${Math.round(current * 100)}% in ${lower(r.tuning.name)}. `;
    const drop = dropped
      ? `The guitar plays a low ${Chords.FLATS[dropNote % 12]} for ${Math.round(dropSecs)}s, a tone below the
         lowest string of ${lower(family)}, so the low string looks dropped: <b>${lower(name)}</b>.`
      : "";
    box.innerHTML = `<div class="suggest">
      <span>${shapes}${drop}</span>
      <button class="primary" id="useTuning">Use ${lower(name)}</button>
      <button id="noTuning">Dismiss</button></div>`;
    box.querySelector("#useTuning").onclick = () => setTuning(name, r.tuning.capo);
    box.querySelector("#noTuning").onclick = () => { store.set(`tuneHintOff.${id}`, true); box.innerHTML = ""; };
  }

  const simpleBox = document.getElementById("simple");
  simpleBox.checked = st.simple;
  simpleBox.onchange = () => { st.simple = simpleBox.checked; store.set("simple", st.simple); lastChordName = null; render(); };

  const followBox = document.getElementById("follow");
  followBox.checked = st.follow;
  followBox.onchange = () => { st.follow = followBox.checked; store.set("follow", st.follow); };
  document.getElementById("print").onclick = () => window.print();
  document.getElementById("export").onclick = () => exportText();
  document.getElementById("pdf")?.addEventListener("click", () => {
    const parts = ["chords"];
    if (r.parts?.guitar?.note_count) parts.push("guitar");
    else if (r.parts?.bass?.note_count) parts.push("bass");
    window.location.href = `/api/jobs/${id}/pdf?parts=${parts.join(",")}`;
  });

  const tabBtns = app.querySelectorAll(".tabs button");
  tabBtns.forEach(b => (b.onclick = () => { st.view = b.dataset.view; store.set("view", st.view); render(); }));

  async function persist() {
    try { await api.save(id, r); } catch (e) { console.warn("save failed", e); }
  }

  /* ----- sheet model ----- */

  function blocks() {
    const out = [];
    let cursor = 0;
    const instr = (a, b) => {
      const ms = measures
        .filter(m => m.start >= a - 0.15 && m.end <= b + 0.15)
        .map(m => ({ ...m, chords: measureChords(m) }))
        .filter(m => m.chords.some(c => c !== "N"));
      if (ms.length) out.push({ type: "instr", measures: ms });
    };
    r.lyrics.lines.forEach((ln, li) => {
      instr(cursor, ln.start);
      out.push({ type: "line", line: ln, li, gapBefore: ln.start - cursor });
      cursor = ln.end;
    });
    instr(cursor, r.duration + 1);
    return out;
  }

  function lineChunks(ln) {
    const words = ln.words;
    const slots = words.map(() => []);
    r.chords.forEach((s, si) => {
      if (s.chord === "N" || s.start < ln.start - 0.25 || s.start > ln.end) return;
      if (si > 0 && show(r.chords[si - 1].chord) === show(s.chord)) return; // same once simplified
      let k = words.findIndex(w => w.end > s.start);
      if (k < 0) k = words.length - 1;
      slots[k].push({ name: s.chord, si });
    });
    // Audio sheets: show the active chord at line start when it began earlier.
    // Tab-your-own (no audio): chords stay only on the word they were placed on —
    // otherwise one edit fills every later line via a long-lived segment.
    if (!noAudio && !slots[0].length) {
      const si = segIndexAt(ln.start);
      const c = r.chords[si];
      if (c && c.chord !== "N") slots[0].push({ name: c.chord, si, carry: true });
    }
    return words.map((w, wi) => ({ w, wi, chords: slots[wi] }));
  }

  /* ----- views ----- */

  let words = [];      // [{start, end, el, lineEl}] for follow mode
  let measureEls = []; // [{start, end, els: [...]}]
  let roll = null;     // the piano roll being shown, see renderRoll()

  function render() {
    tabBtns.forEach(b => b.classList.toggle("on", b.dataset.view === st.view));
    words = [];
    measureEls = [];
    lastLine = lastWord = lastChordName = null;
    lastMeasures = [];
    roll = null;
    if (TAB_VIEWS.includes(st.view)) renderTab(st.view);
    else if (ROLL_VIEWS.includes(st.view)) renderRoll(st.view);
    else ({ sheet: renderSheet, chords: renderChords, lyrics: renderLyrics })[st.view]();
    updateKeyboard(audio.currentTime, segIndexAt(audio.currentTime));
    drawRoll();
  }

  function paperHtml(body, { hint = "" } = {}) {
    const hintHtml = hint ? `<p class="hint no-print">${hint}</p>` : "";
    return `${hintHtml}<div class="sheet-page"><h2 class="sheet-title" id="sheetTitle" contenteditable="true" spellcheck="false" title="Edit title">${esc(job.title)}</h2><div class="sheet-body">${body}</div></div>`;
  }

  function bindSheetTitle() {
    const sheetTitle = view.querySelector("#sheetTitle");
    if (!sheetTitle) return;
    sheetTitle.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); sheetTitle.blur(); }
      if (e.key === "Escape") { sheetTitle.textContent = job.title; sheetTitle.blur(); }
    });
    sheetTitle.addEventListener("blur", () => {
      const t = sheetTitle.textContent.replace(/\s+/g, " ").trim();
      if (!t) { sheetTitle.textContent = job.title; return; }
      if (t === job.title) return;
      job.title = t;
      api.rename(id, t).catch(() => {});
      const sideTitle = document.getElementById("sidebarSongTitle");
      if (sideTitle) {
        sideTitle.textContent = t;
        sideTitle.title = t;
      }
      refreshSidebar();
    });
  }

  function renderSheet() {
    const bl = blocks();
    if (!bl.length) {
      view.innerHTML = paperHtml(`<p class="empty">No chords or lyrics were detected.</p>`);
      bindSheetTitle();
      return;
    }
    const missingHint = r.lyrics.reference ? "" : `lyrics missing? <a href="#" id="pasteLink">paste the full lyrics</a>`;
    let body = `<div class="sheet">`;
    for (const b of bl) {
      if (b.type === "instr") {
        body += `<div class="instrumental">${b.measures.map(m =>
          `<span class="m" data-mi="${m.i}">${m.chords.map(c => `<b>${esc(show(c))}</b>`).join(" ")}</span>`).join("")}</div>`;
      } else {
        const gap = b.li > 0 && (b.gapBefore > 3 || b.line.stanza) ? ' style="margin-top:22px"' : "";
        if (b.line.section) {
          const sec = (r.confidence?.by_section || []).find(s => s.label === b.line.section);
          body += `<div class="section-label">${esc(b.line.section)}${sec ? confBadge("trust", sec.score, (sec.reasons || []).join("; ")) : ""}</div>`;
        }
        body += `<div class="line" data-li="${b.li}"${b.line.section ? "" : gap}>` + lineChunks(b.line).map(c => {
          const label = c.chords.map(x => esc(show(x.name))).join(" ");
          const carry = c.chords.length && c.chords.every(x => x.carry) ? " carry" : "";
          const si = c.chords.length ? c.chords[0].si : "";
          return `<span class="chunk" data-wi="${c.wi}"><span class="c editable${carry}" data-si="${si}" title="Click to edit chord">${label || "·"}</span><span class="w-wrap"><i class="t-handle t-start no-print" title="Drag start · Alt+←/→ nudge 50ms"></i><span class="w" title="Click to jump · double-click to edit">${esc(c.w.text)}</span><i class="t-handle t-end no-print" title="Drag end · Alt+←/→ nudge 50ms"></i></span></span>`;
        }).join("") + `</div>`;
      }
    }
    body += `</div>`;
    view.innerHTML = paperHtml(body, { hint: missingHint });
    bindSheetTitle();
    view.querySelector("#pasteLink")?.addEventListener("click", e => {
      e.preventDefault();
      st.view = "lyrics";
      tabBtns.forEach(b => b.classList.toggle("on", b.dataset.view === "lyrics"));
      editLyrics(lyricsText());
    });

    view.querySelectorAll(".line").forEach(lineEl => {
      const ln = r.lyrics.lines[+lineEl.dataset.li];
      lineEl.querySelectorAll(".chunk").forEach(ch => {
        const w = ln.words[+ch.dataset.wi];
        const wEl = ch.querySelector(".w");
        words.push({ start: w.start, end: w.end, el: wEl, lineEl });
        wEl.onclick = () => { audio.currentTime = w.start; };
        wEl.ondblclick = e => { e.preventDefault(); editWord(ln, w, wEl); };
        wEl.onkeydown = e => {
          if (!e.altKey) return;
          if (e.key === "ArrowLeft") { e.preventDefault(); nudgeWord(ln, w, -0.05); }
          if (e.key === "ArrowRight") { e.preventDefault(); nudgeWord(ln, w, 0.05); }
        };
        wEl.tabIndex = 0;
        ch.querySelector(".c").onclick = e => {
          e.preventDefault();
          e.stopPropagation();
          editChord(e.currentTarget, w);
        };
        bindTimingHandle(ch.querySelector(".t-start"), ln, w, "start");
        bindTimingHandle(ch.querySelector(".t-end"), ln, w, "end");
      });
    });
    view.querySelectorAll(".instrumental .m").forEach(el => {
      const m = measures[+el.dataset.mi];
      measureEls.push({ start: m.start, end: m.end, els: [el] });
      el.onclick = () => { audio.currentTime = m.start; };
    });
    words.sort((a, b) => a.start - b.start);
  }

  function editChord(cEl, word) {
    const si = cEl.dataset.si === "" ? null : +cEl.dataset.si;
    const input = document.createElement("input");
    input.className = "chord-input";
    input.setAttribute("aria-label", "Edit chord");
    const raw = cEl.textContent.trim();
    input.value = raw === "·" ? "" : raw.split(" ")[0];
    cEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      if (commit) applyChordEdit(si, word, input.value.trim());
      render();
    };
    input.onkeydown = e => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    };
    input.onblur = () => finish(true);
  }

  function applyChordEdit(si, word, text) {
    const segs = r.chords;
    let name = text;
    if (/^n\.?c\.?$/i.test(name)) name = "N";
    if (name && name !== "N") {
      if (!Chords.parse(name)) return;
      name = offset() ? Chords.transpose(name, -offset(), origFlats) : name;
    }
    const isCarry = si != null && segs[si] && segs[si].start < word.start - 0.3;

    if (!name) {
      // Remove the chord change: the previous chord continues.
      if (si == null || isCarry) return;
      if (si > 0) { segs[si - 1].end = segs[si].end; segs.splice(si, 1); } else segs[si].chord = "N";
    } else if (si != null && !isCarry) {
      segs[si].chord = name;
      // Tab-your-own: keep the chord on this word only (shrink long leftover segments).
      if (noAudio) {
        const t0 = word.start;
        const t1 = Math.max(word.end, t0 + 0.05);
        const oldEnd = segs[si].end;
        segs[si].start = t0;
        segs[si].end = t1;
        if (t1 < oldEnd - 0.01) segs.splice(si + 1, 0, { start: t1, end: oldEnd, chord: "N" });
      }
    } else if (noAudio) {
      // Tab-your-own: insert a chord spanning only this word, then resume "N".
      const t0 = word.start;
      const t1 = Math.max(word.end, t0 + 0.05);
      const i = segIndexAt(t0);
      const s = segs[i];
      const oldEnd = s.end;
      if (Math.abs(s.start - t0) < 0.05 && s.chord === "N") {
        s.chord = name;
        s.end = t1;
        if (t1 < oldEnd - 0.01) segs.splice(i + 1, 0, { start: t1, end: oldEnd, chord: "N" });
      } else {
        s.end = t0;
        const inserted = [{ start: t0, end: t1, chord: name }];
        if (t1 < oldEnd - 0.01) inserted.push({ start: t1, end: oldEnd, chord: "N" });
        segs.splice(i + 1, 0, ...inserted);
        if (s.end - s.start < 0.01) segs.splice(i, 1);
      }
    } else {
      // Audio sheet: add a chord change at this word (continues until the next change).
      const t = word.start;
      const i = segIndexAt(t);
      const s = segs[i];
      if (Math.abs(s.start - t) < 0.05) s.chord = name;
      else { segs.splice(i + 1, 0, { start: t, end: s.end, chord: name }); s.end = t; }
    }
    for (let i = segs.length - 1; i > 0; i--) {
      if (segs[i].chord === segs[i - 1].chord) { segs[i - 1].end = segs[i].end; segs.splice(i, 1); }
    }
    persist();
  }

  function editWord(ln, w, wEl) {
    wEl.contentEditable = "true";
    wEl.focus();
    document.getSelection().selectAllChildren(wEl);
    wEl.onkeydown = e => {
      if (e.key === "Enter") { e.preventDefault(); wEl.blur(); }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        nudgeWord(ln, w, e.key === "ArrowLeft" ? -0.05 : 0.05);
      }
    };
    wEl.onblur = () => {
      wEl.contentEditable = "false";
      const text = wEl.textContent.trim();
      if (text === w.text) return;
      if (text) w.text = text;
      else {
        ln.words.splice(ln.words.indexOf(w), 1);
        if (!ln.words.length) r.lyrics.lines.splice(r.lyrics.lines.indexOf(ln), 1);
        else { ln.start = ln.words[0].start; ln.end = ln.words[ln.words.length - 1].end; }
      }
      persist();
      render();
    };
  }

  /** Keep word order inside a line: prev.end ≤ start < end ≤ next.start (min 40ms). */
  function clampWordTiming(ln, w) {
    const i = ln.words.indexOf(w);
    const prev = i > 0 ? ln.words[i - 1] : null;
    const next = i < ln.words.length - 1 ? ln.words[i + 1] : null;
    const lo = prev ? prev.end : Math.max(0, ln.start - 0.5);
    const hi = next ? next.start : Math.min(r.duration, ln.end + 0.5);
    const minDur = 0.04;
    w.start = Math.max(lo, Math.min(w.start, hi - minDur));
    w.end = Math.max(w.start + minDur, Math.min(w.end, hi));
    ln.start = ln.words[0].start;
    ln.end = ln.words[ln.words.length - 1].end;
  }

  function nudgeWord(ln, w, delta) {
    w.start = +(w.start + delta).toFixed(3);
    w.end = +(w.end + delta).toFixed(3);
    clampWordTiming(ln, w);
    persist();
    render();
  }

  function bindTimingHandle(el, ln, w, edge) {
    if (!el) return;
    el.onpointerdown = e => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const originX = e.clientX;
      const originT = w[edge];
      // ~8px ≈ 50ms at typical zoom — scale from view width vs duration of the line
      const lineMs = Math.max(ln.end - ln.start, 0.5);
      const linePx = Math.max(el.closest(".line")?.getBoundingClientRect().width || 400, 80);
      const pxPerSec = linePx / lineMs;
      const onMove = ev => {
        const dt = (ev.clientX - originX) / pxPerSec;
        w[edge] = +(originT + dt).toFixed(3);
        if (edge === "start" && w.start > w.end - 0.04) w.start = w.end - 0.04;
        if (edge === "end" && w.end < w.start + 0.04) w.end = w.start + 0.04;
        clampWordTiming(ln, w);
        el.title = `${edge} ${w[edge].toFixed(2)}s`;
      };
      const onUp = () => {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        persist();
        render();
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    };
  }

  function tabRows(tab, maxChars) {
    const rows = [];
    let row = [], width = 2;
    tab.measures.forEach((m, i) => {
      const w = m.strings[0].length;
      if (row.length && width + w > maxChars) { rows.push(row); row = []; width = 2; }
      row.push({ ...m, i });
      width += w;
    });
    if (row.length) rows.push(row);
    return rows;
  }

  function tabHint(part, tab) {
    const midi = ` · <a href="/api/jobs/${id}/midi/${part}" download>MIDI</a>`;
    if (part === "drums") {
      return `BD kick · SD snare · HH hi-hat · CR crash · click a 16th cell to toggle that hit · ${tab.note_count} hits${midi}. Ghost notes and toms are left out.`;
    }
    const where = `Transcribed from the <b>${esc(STEM_LABELS[tab.source] || tab.source)}</b> stem`;
    const tuning = `${esc(r.tuning.name[0].toLowerCase() + r.tuning.name.slice(1))} (${tab.tuning})`;
    const legato = "h hammer-on · p pull-off · / \\ slide";
    const edit = " · click a measure to edit frets / delete / nudge ±16th";
    const ghosts = tab.ghost_filtered ? ` · ${tab.ghost_filtered} quiet/bleed notes filtered` : "";
    const fallback = part === "guitar" && tab.source_fallback
      ? ` · <span class="warn">no clear guitar stem — using ${esc(STEM_LABELS[tab.source] || tab.source)} (${esc(tab.source_reason || "fallback")})</span>`
      : "";
    if (part === "bass") {
      return `${where}${ghosts} · ${tuning} · ${tab.note_count} notes${edit} · ${legato}${midi}.`;
    }
    return `${where}${fallback}${ghosts} · ${tuning}${tab.capo ? ` · capo ${tab.capo}` : ""} · ${tab.note_count} notes${edit} · ${legato}${st.semis ? " · tab ignores key transpose" : ""}${midi}.`;
  }

  let editNotes = null; // cached notes for fretted-part editor
  let editMeasure = null;

  function sixteenthSec() {
    if (r.beats.length < 2) return 0.125;
    const period = (r.beats[r.beats.length - 1] - r.beats[0]) / (r.beats.length - 1);
    return period / 4;
  }

  async function ensureNotes(part) {
    if (editNotes && editNotes.part === part) return editNotes.notes;
    const res = await api.notes(id, part);
    editNotes = { part, notes: res.notes };
    return editNotes.notes;
  }

  async function persistNotes(part, notes) {
    const res = await api.saveNotes(id, part, notes);
    r.parts = res.parts;
    editNotes = { part, notes: res.notes };
    render();
  }

  function renderTab(part) {
    const tab = r.parts[part];
    if (!tab || !tab.measures || !tab.measures.length || !tab.note_count) {
      view.innerHTML = paperHtml(`<p class="empty">No playable notes were found for this part.</p>`);
      bindSheetTitle();
      return;
    }
    view.innerHTML = paperHtml(`<div class="tabwrap" id="tabBody"></div><div id="tabEdit" class="tab-edit no-print"></div>`, {
      hint: tabHint(part, tab),
    });
    bindSheetTitle();
    const body = view.querySelector("#tabBody");
    const probe = document.createElement("span");
    probe.className = "tabrow";
    probe.style.cssText = "position:absolute;visibility:hidden";
    probe.textContent = "0".repeat(50);
    body.appendChild(probe);
    const charW = probe.getBoundingClientRect().width / 50 || 8.4;
    probe.remove();
    const maxChars = Math.max(40, Math.floor(body.clientWidth / charW) - 1);

    const pad = " ".repeat(tab.string_names[0].length + 1);
    let html = "";
    for (const row of tabRows(tab, maxChars)) {
      html += `<pre class="tabrow"><span class="chordline">${pad}${row.map(m => `<span data-tm="${m.i}">${esc(m.chords)}</span>`).join("")}</span>\n`;
      for (let s = 0; s < tab.string_names.length; s++) {
        html += `${tab.string_names[s]}|${row.map(m => `<span data-tm="${m.i}">${m.strings[s]}</span>`).join("")}\n`;
      }
      html += "</pre>";
    }
    body.innerHTML = html;
    const byMeasure = {};
    view.querySelectorAll("[data-tm]").forEach(el => (byMeasure[el.dataset.tm] ||= []).push(el));
    tab.measures.forEach((m, i) => {
      const meas = measures.find(x => x.beat === m.beat);
      if (meas && byMeasure[i]) {
        measureEls.push({ start: meas.start, end: meas.end, els: byMeasure[i] });
        byMeasure[i].forEach(el => (el.onclick = () => {
          audio.currentTime = meas.start;
          if (part === "drums") openDrumEdit(meas, i);
          else openFretEdit(part, meas, i);
        }));
      }
    });
    if (editMeasure != null && part !== "drums") openFretEdit(part, measures.find(x => x.beat === tab.measures[editMeasure]?.beat), editMeasure);
  }

  async function openFretEdit(part, meas, mi) {
    if (!meas) return;
    editMeasure = mi;
    const box = view.querySelector("#tabEdit");
    if (!box) return;
    box.innerHTML = `<p class="hint">Loading notes…</p>`;
    let notes;
    try { notes = await ensureNotes(part); }
    catch (e) { box.innerHTML = `<p class="hint">Could not load notes: ${esc(e.message)}</p>`; return; }
    const step = sixteenthSec();
    const inMeas = notes
      .map((n, idx) => ({ n, idx }))
      .filter(({ n }) => n.start >= meas.start - 0.02 && n.start < meas.end - 0.01);
    const strings = r.tuning.strings;
    const capo = r.tuning.capo || 0;
    const fretOf = pitch => {
      // Prefer the string where fret is smallest non-negative within range
      let best = null;
      for (let s = 0; s < strings.length; s++) {
        const f = pitch - (strings[s] + capo);
        if (f >= 0 && f <= 19 && (best == null || f < best.fret)) best = { string: s, fret: f };
      }
      return best || { string: 0, fret: Math.max(0, pitch - (strings[0] + capo)) };
    };
    box.innerHTML = `
      <div class="tab-edit-head">Measure @ ${fmtTime(meas.start)} · ${inMeas.length} note(s)
        <button id="closeEdit">Close</button></div>
      ${inMeas.length ? `<table class="note-table"><thead><tr><th>Time</th><th>Str</th><th>Fret</th><th></th></tr></thead><tbody>
        ${inMeas.map(({ n, idx }) => {
          const fr = fretOf(n.pitch);
          return `<tr data-ni="${idx}">
            <td>${n.start.toFixed(2)}s</td>
            <td>${fr.string + 1}</td>
            <td><input class="fret-in" type="number" min="0" max="19" value="${fr.fret}" data-str="${fr.string}"></td>
            <td class="note-actions">
              <button data-act="left" title="Nudge −16th">−16th</button>
              <button data-act="right" title="Nudge +16th">+16th</button>
              <button data-act="del" class="danger">Delete</button>
            </td>
          </tr>`;
        }).join("")}
      </tbody></table>` : `<p class="hint">No notes in this measure (ghosts may be filtered).</p>`}`;
    box.querySelector("#closeEdit").onclick = () => { editMeasure = null; box.innerHTML = ""; };
    box.querySelectorAll("tr[data-ni]").forEach(tr => {
      const idx = +tr.dataset.ni;
      tr.querySelector(".fret-in").onchange = async e => {
        const str = +e.target.dataset.str;
        const fret = Math.max(0, Math.min(19, +e.target.value || 0));
        notes[idx] = { ...notes[idx], pitch: strings[str] + capo + fret };
        await persistNotes(part, notes);
      };
      tr.querySelector('[data-act="left"]').onclick = async () => {
        notes[idx] = { ...notes[idx], start: +(notes[idx].start - step).toFixed(3), end: +(notes[idx].end - step).toFixed(3) };
        await persistNotes(part, notes);
      };
      tr.querySelector('[data-act="right"]').onclick = async () => {
        notes[idx] = { ...notes[idx], start: +(notes[idx].start + step).toFixed(3), end: +(notes[idx].end + step).toFixed(3) };
        await persistNotes(part, notes);
      };
      tr.querySelector('[data-act="del"]').onclick = async () => {
        notes.splice(idx, 1);
        await persistNotes(part, notes);
      };
    });
  }

  async function openDrumEdit(meas, mi) {
    const box = view.querySelector("#tabEdit");
    if (!box) return;
    const tab = r.parts.drums;
    const hits = (tab.hits || []).map(([t, k]) => [t, k]);
    const kinds = [["kick", "BD"], ["snare", "SD"], ["hihat", "HH"], ["crash", "CR"]];
    const step = sixteenthSec();
    const slots = [];
    for (let t = meas.start; t < meas.end - 0.001; t += step) slots.push(+t.toFixed(3));
    const has = (t, kind) => hits.some(([ht, hk]) => hk === kind && Math.abs(ht - t) < step * 0.45);
    box.innerHTML = `
      <div class="tab-edit-head">Drums @ ${fmtTime(meas.start)} · click to toggle
        <button id="closeEdit">Close</button></div>
      <div class="drum-grid">${kinds.map(([kind, label]) => `
        <div class="drum-row"><span class="drum-lab">${label}</span>
          ${slots.map(t => `<button class="drum-cell ${has(t, kind) ? "on" : ""}" data-t="${t}" data-k="${kind}"></button>`).join("")}
        </div>`).join("")}</div>`;
    box.querySelector("#closeEdit").onclick = () => { box.innerHTML = ""; };
    box.querySelectorAll(".drum-cell").forEach(btn => {
      btn.onclick = async () => {
        const t = +btn.dataset.t, kind = btn.dataset.k;
        const i = hits.findIndex(([ht, hk]) => hk === kind && Math.abs(ht - t) < step * 0.45);
        if (i >= 0) hits.splice(i, 1);
        else hits.push([t, kind]);
        hits.sort((a, b) => a[0] - b[0]);
        try {
          const res = await api.saveDrumHits(id, hits);
          r.parts.drums = res.parts.drums;
          render();
          openDrumEdit(meas, mi);
        } catch (e) {
          box.insertAdjacentHTML("beforeend", `<p class="hint">Save failed: ${esc(e.message)}</p>`);
        }
      };
    });
  }

  function chordColor(name) {
    if (name === "N") return "#22262f";
    const p = Chords.parse(name);
    const hue = p ? (p.root * 30) % 360 : 0;
    const minor = p && /^m(?!aj)/.test(p.quality);
    return `hsl(${hue} ${minor ? 35 : 55}% ${minor ? 30 : 38}%)`;
  }

  // The chord name each instrument reads: guitar shapes follow tuning and capo, the others don't.
  const diagramName = name => (st.instr === "guitar" ? show(name) : concert(name));

  function renderChords() {
    const seen = [];
    for (const s of r.chords) if (s.chord !== "N" && !seen.includes(diagramName(s.chord))) seen.push(diagramName(s.chord));
    if (!seen.length) {
      view.innerHTML = paperHtml(`<p class="empty">No chords detected.</p>`);
      bindSheetTitle();
      return;
    }
    const draw = {
      guitar: c => Chords.diagramSVG(c, shapeStrings()),
      ukulele: c => Chords.diagramSVG(c, UKULELE, false),
      piano: c => Chords.pianoSVG(c),
    }[st.instr];
    const note = st.instr === "guitar" && !isUniformShift(r.tuning.strings)
      ? `Diagrams are worked out for ${esc(r.tuning.name)}.`
      : st.instr === "guitar" ? "" : "Shown at concert pitch (not affected by guitar tuning or capo).";
    view.innerHTML = paperHtml(`
      <div class="instr-pick">${[["guitar", "Guitar"], ["ukulele", "Ukulele"], ["piano", "Piano"]].map(([k, label]) =>
        `<button data-instr="${k}" class="${st.instr === k ? "on" : ""}">${label}</button>`).join("")}
        <span class="hint" style="margin:0">${note}</span></div>
      <div class="diagrams ${st.instr}">${seen.map(c => `<div class="diagram" data-chord="${esc(c)}"><div class="name">${esc(c)}</div>${draw(c)}</div>`).join("")}</div>
      <div class="timeline">${r.chords.map((s, i) => `<div data-i="${i}" title="${esc(diagramName(s.chord))} @ ${fmtTime(s.start)}" style="flex:${(s.end - s.start).toFixed(2)};background:${chordColor(s.chord)}">${esc(diagramName(s.chord))}</div>`).join("")}</div>`);
    bindSheetTitle();
    view.querySelectorAll(".timeline div").forEach(el => (el.onclick = () => { audio.currentTime = r.chords[+el.dataset.i].start; }));
    view.querySelectorAll("[data-instr]").forEach(b => (b.onclick = () => {
      st.instr = b.dataset.instr;
      store.set("instr", st.instr);
      lastChordName = null;
      render();
    }));
  }

  /* ----- piano roll (piano part and sung melody) ----- */

  const ROLL_PPS = 90;   // pixels per second
  const ROLL_TOP = 22;   // strip for bar numbers and chords
  const ROLL_GUTTER = 34;

  function renderRoll(part) {
    const notes = (r.parts[part] && r.parts[part].notes) || [];
    if (!notes.length) {
      view.innerHTML = paperHtml(`<p class="empty">No notes were found for this part.</p>`);
      bindSheetTitle();
      return;
    }
    const pitches = notes.map(n => n[2] + st.semis);
    let lo = Math.min(...pitches) - 2, hi = Math.max(...pitches) + 2;
    if (hi - lo < 24) { const mid = (hi + lo) >> 1; lo = mid - 12; hi = mid + 12; }
    const rowH = Math.max(6, Math.min(14, Math.floor(420 / (hi - lo + 1))));
    const lyricsStrip = part === "melody" ? 34 : 0;
    const what = part === "piano"
      ? "Notes from the piano/keys stem"
      : "The sung melody, one note at a time, ready to play on any instrument";
    view.innerHTML = paperHtml(`<div class="roll"><canvas></canvas></div>`, {
      hint: `${what} · ${notes.length} notes · ${st.semis ? "transposed" : "concert pitch"} · click to jump · <a href="/api/jobs/${id}/midi/${part}" download>MIDI</a>`,
    });
    bindSheetTitle();
    const canvas = view.querySelector("canvas");
    const height = ROLL_TOP + (hi - lo + 1) * rowH + lyricsStrip;
    canvas.style.height = `${height}px`;
    const lyricWords = part === "melody" ? r.lyrics.lines.flatMap(l => l.words) : [];
    roll = { part, canvas, lo, hi, rowH, height, notes, lyricWords };
    canvas.onclick = e => {
      const t = rollTime(e.offsetX);
      audio.currentTime = Math.max(0, Math.min(r.duration, t));
    };
    drawRoll();
  }

  function rollWindow() {
    const W = roll.canvas.clientWidth;
    const t0 = audio.currentTime - (W - ROLL_GUTTER) * 0.25 / ROLL_PPS; // playhead a quarter of the way in
    return { W, t0, t1: t0 + (W - ROLL_GUTTER) / ROLL_PPS };
  }
  const rollTime = x => rollWindow().t0 + (x - ROLL_GUTTER) / ROLL_PPS;

  function drawRoll() {
    if (!roll || !roll.canvas.isConnected) return;
    const { canvas, lo, hi, rowH, height, notes, lyricWords } = roll;
    const { W, t0, t1 } = rollWindow();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim(), accent2 = css.getPropertyValue("--accent-2").trim();
    const x = s => ROLL_GUTTER + (s - t0) * ROLL_PPS;
    const y = p => ROLL_TOP + (hi - p) * rowH;
    const t = audio.currentTime;

    ctx.fillStyle = "#13161c";
    ctx.fillRect(0, 0, W, height);
    for (let p = lo; p <= hi; p++) {
      if ([1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)) { ctx.fillStyle = "#0e1014"; ctx.fillRect(ROLL_GUTTER, y(p), W, rowH); }
      if (((p % 12) + 12) % 12 === 0) { ctx.fillStyle = "#2a2f3a"; ctx.fillRect(ROLL_GUTTER, y(p) + rowH - 1, W, 1); }
    }
    // bars and chords
    ctx.font = "11px JetBrains Mono, monospace";
    for (const m of measures) {
      if (m.end < t0 || m.start > t1) continue;
      ctx.fillStyle = "#2a2f3a"; ctx.fillRect(x(m.start), ROLL_TOP, 1, height - ROLL_TOP);
      ctx.fillStyle = "#5a6275"; ctx.fillText(String(m.i + 1), x(m.start) + 3, 10);
    }
    for (const s of r.chords) {
      if (s.chord === "N" || s.end < t0 || s.start > t1) continue;
      ctx.fillStyle = accent; ctx.fillText(concert(s.chord), Math.max(ROLL_GUTTER, x(s.start)) + 3, 20);
    }
    // notes
    for (const [s, e, pitch, amp] of notes) {
      if (e < t0 || s > t1) continue;
      const p = pitch + st.semis;
      const active = s <= t && t < e;
      ctx.globalAlpha = active ? 1 : 0.45 + 0.55 * Math.min(1, amp);
      ctx.fillStyle = active ? accent : accent2;
      ctx.fillRect(x(s), y(p) + 1, Math.max(3, (e - s) * ROLL_PPS - 1), rowH - 2);
    }
    ctx.globalAlpha = 1;
    // lyrics under the melody
    if (lyricWords.length) {
      // Two staggered rows so quick words don't overprint; a word that fits neither is skipped.
      ctx.fillStyle = "#e7e9ee"; ctx.font = "12px Inter, sans-serif";
      const rowEnd = [-Infinity, -Infinity];
      for (const w of lyricWords) {
        if (w.start < t0 - 1 || w.start > t1) continue;
        const wx = x(w.start), width = ctx.measureText(w.text).width;
        const row = wx > rowEnd[0] + 4 ? 0 : wx > rowEnd[1] + 4 ? 1 : -1;
        if (row < 0) continue;
        ctx.fillText(w.text, wx, height - 20 + row * 14);
        rowEnd[row] = wx + width;
      }
    }
    // gutter and playhead
    ctx.fillStyle = "#13161c"; ctx.fillRect(0, ROLL_TOP, ROLL_GUTTER - 1, height);
    for (let p = lo; p <= hi; p++) if (((p % 12) + 12) % 12 === 0) {
      ctx.fillStyle = "#8b93a7"; ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillText(`C${Math.floor(p / 12) - 1}`, 4, y(p) + rowH - 1);
    }
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x(t), 0, 2, height);
  }

  /* ----- live keyboard ----- */

  const KBD_LO = 48, KBD_HI = 83; // C3 to B5
  const kbdEl = app.querySelector("#kbd");
  let keyEls = {}, kb = { name: undefined, offset: null, right: null, live: "" };

  function buildKeyboard() {
    document.getElementById("keysBtn")?.classList.toggle("on", st.keys);
    kbdEl.hidden = !st.keys;
    if (!st.keys) return;
    const hasPiano = r.parts.piano && r.parts.piano.notes && r.parts.piano.notes.length;
    kbdEl.innerHTML = Chords.keyboardSVG(KBD_LO, KBD_HI) + `
      <div class="kbd-legend"><i class="k-chord"></i> chord <i class="k-left"></i> bass note <i class="k-next"></i> next chord
      ${hasPiano ? `<i class="k-live"></i> piano track` : ""}<span id="kbdName"></span></div>`;
    keyEls = {};
    kbdEl.querySelectorAll("[data-p]").forEach(el => (keyEls[el.dataset.p] = el));
    kb = { name: undefined, offset: null, right: null, live: "" };
    updateKeyboard(audio.currentTime, segIndexAt(audio.currentTime));
  }
  document.getElementById("keysBtn").onclick = () => { st.keys = !st.keys; store.set("keys", st.keys); buildKeyboard(); };

  function setKeys(cls, pitches) {
    kbdEl.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
    for (const p of pitches) keyEls[p]?.classList.add(cls);
  }

  function updateKeyboard(t, si) {
    if (!st.keys) return;
    const seg = r.chords[si];
    const name = seg && seg.chord !== "N" ? concert(seg.chord) : null;
    const tag = `${name}|${st.semis}|${st.simple}`;
    if (tag !== kb.name) {
      kb.name = tag;
      const v = name ? Chords.pianoVoicing(name, kb.right) : null;
      const next = r.chords.slice(si + 1).find(s => s.chord !== "N");
      const nv = next ? Chords.pianoVoicing(concert(next.chord), v ? v.right : kb.right) : null;
      if (v) kb.right = v.right;
      setKeys("k-left", v ? [v.left] : []);
      setKeys("k-chord", v ? v.right : []);
      const now = new Set(v ? [v.left, ...v.right] : []);
      setKeys("k-next", nv ? [nv.left, ...nv.right].filter(p => !now.has(p)) : []);
      // Say so when the guitar is reading different (shape) names for the same chords.
      const label = offset() !== st.semis ? "piano (concert pitch): " : "";
      kbdEl.querySelector("#kbdName").textContent = name ? `${label}${name}${next ? `  →  ${concert(next.chord)}` : ""}` : "";
    }
    const notes = r.parts.piano && r.parts.piano.notes;
    if (notes && notes.length) {
      // notes sounding now: scan back from the last note that has started
      let lo = 0, hi = notes.length - 1, k = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (notes[mid][0] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      const live = [];
      for (let i = k; i >= 0 && i > k - 60; i--) if (notes[i][1] > t) live.push(notes[i][2] + st.semis);
      const tagLive = live.sort().join(",");
      if (tagLive !== kb.live) { kb.live = tagLive; setKeys("k-live", live); }
    }
  }

  /* ----- upgrade older songs ----- */

  function renderUpgrade() {
    const box = app.querySelector("#upgrade");
    const others = ["bass", "piano", "drums", "melody"].some(k => r.parts[k]);
    if (others || (r.version || 1) >= 2) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="suggest"><span>This song was processed before Bandscribe wrote parts for every instrument.
      Add the bass tab, piano, drums and melody from its saved stems (about half a minute).</span>
      <button class="primary" id="doUpgrade">Transcribe all instruments</button></div>`;
    box.querySelector("#doUpgrade").onclick = async e => {
      e.target.disabled = true;
      e.target.textContent = "Transcribing…";
      try {
        const res = await api.upgrade(id);
        r.parts = res.parts;
        r.version = 2;
        delete r.tab;
        cleanup();
        showSong(job);
      } catch (err) {
        e.target.textContent = `Failed: ${err.message}`;
      }
    };
  }

  function lyricsText() {
    const lines = r.lyrics.lines;
    let text = "";
    lines.forEach((ln, i) => {
      if (i > 0 && (ln.stanza || ln.start - lines[i - 1].end > 3)) text += "\n";
      if (ln.section) text += `${ln.section}\n`;
      text += ln.words.map(w => w.text).join(" ") + "\n";
    });
    return text;
  }

  function renderLyrics() {
    const text = lyricsText();
    const pasted = !!r.lyrics.reference;
    const tools = `<p class="hint">${pasted ? "Your lyrics, timed to the song" : `Automatic transcription (${esc(r.lyrics.language || "unknown")})`}
        <button id="editLyrics" style="margin-left:8px">${pasted ? "Edit lyrics" : "Paste full lyrics"}</button>
        ${text ? `<button id="copy">Copy</button>` : ""}</p>`;
    const body = text
      ? `${tools}<div class="lyrics-plain">${esc(text)}</div>`
      : `${tools}<p class="empty">No vocals were transcribed. Paste the lyrics to add them.</p>`;
    view.innerHTML = paperHtml(body);
    bindSheetTitle();
    view.querySelector("#copy")?.addEventListener("click", e => navigator.clipboard.writeText(text).then(() => (e.target.textContent = "Copied")));
    view.querySelector("#editLyrics").onclick = () => editLyrics(pasted ? r.lyrics.text : text);
  }

  function editLyrics(initial) {
    view.innerHTML = paperHtml(`
      <p class="hint">Paste or type the full lyrics, one sung line per line, with a blank line between verses and choruses.
        Words the transcription heard keep their timing, and the rest are placed where the vocal track has singing.</p>
      <textarea id="lyricsBox" class="lyrics-box" spellcheck="false">${esc(initial || "")}</textarea>
      <div class="controls" style="margin-top:10px">
        <button class="primary" id="align">Line up with the song</button>
        <button id="cancel">Cancel</button>
        ${r.lyrics.reference ? `<button id="revert">Go back to the automatic transcription</button>` : ""}
        <span id="lyricsStatus" class="hint" style="margin:0"></span>
      </div>`);
    bindSheetTitle();
    const box = view.querySelector("#lyricsBox");
    box.focus();
    const submit = async text => {
      view.querySelectorAll("button").forEach(b => (b.disabled = true));
      view.querySelector("#lyricsStatus").textContent = "Lining up…";
      try {
        r.lyrics = await api.lyrics(id, text);
        st.view = "sheet";
        store.set("view", "sheet");
        render();
      } catch (e) {
        view.querySelector("#lyricsStatus").textContent = `Failed: ${e.message}`;
        view.querySelectorAll("button").forEach(b => (b.disabled = false));
      }
    };
    view.querySelector("#align").onclick = () => box.value.trim() && submit(box.value);
    view.querySelector("#cancel").onclick = () => render();
    view.querySelector("#revert")?.addEventListener("click", () => submit(""));
  }

  /* ----- export ----- */

  function exportText() {
    const out = [
      job.title,
      `Key: ${keyName()}   Tempo: ${Math.round(r.tempo)} BPM${st.semis ? `   (transposed ${st.semis > 0 ? "+" : ""}${st.semis})` : ""}`,
      `Tuning: ${r.tuning.name}${r.tuning.capo ? `   Capo ${r.tuning.capo}` : ""}`,
      "",
    ];
    for (const b of blocks()) {
      if (b.type === "instr") {
        for (let i = 0; i < b.measures.length; i += 4) {
          out.push("| " + b.measures.slice(i, i + 4).map(m => m.chords.map(show).join(" ").padEnd(6)).join(" | ") + " |");
        }
        out.push("");
      } else {
        if (b.li > 0 && (b.gapBefore > 3 || b.line.stanza)) out.push("");
        if (b.line.section) out.push(`[${b.line.section}]`);
        let chordRow = "", lyricRow = "";
        for (const c of lineChunks(b.line)) {
          const label = c.chords.map(x => show(x.name)).join(" ");
          if (label) {
            if (chordRow.length > lyricRow.length) lyricRow = lyricRow.padEnd(chordRow.length);
            chordRow = chordRow.padEnd(lyricRow.length) + label + " ";
          }
          lyricRow += c.w.text + " ";
        }
        if (chordRow.trim()) out.push(chordRow.trimEnd());
        out.push(lyricRow.trimEnd());
      }
    }
    for (const [part, label] of PART_VIEWS.filter(([k]) => TAB_VIEWS.includes(k))) {
      const tab = r.parts[part];
      if (!tab || !tab.note_count) continue;
      const tuning = tab.tuning ? ` (${tab.tuning}${tab.capo ? `, capo ${tab.capo}` : ""})` : "";
      out.push("", "", `${label.toUpperCase()}${tuning}`, "");
      const pad = " ".repeat(tab.string_names[0].length + 1);
      for (const row of tabRows(tab, 100)) {
        out.push(pad + row.map(m => m.chords).join(""));
        tab.string_names.forEach((n, s) => out.push(n + "|" + row.map(m => m.strings[s]).join("")));
        out.push("");
      }
    }
    const blob = new Blob([out.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${job.title.replace(/[\\/:*?"<>|]+/g, "_")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ----- follow along ----- */

  let lastLine = null, lastWord = null, lastMeasures = [], lastChordName = null;
  let raf = 0;

  function tick() {
    const t = audio.currentTime;

    const si = segIndexAt(t);
    const seg = r.chords[si];
    const name = seg ? seg.chord : "N";
    if (name !== lastChordName || offset() !== tick.offset) {
      lastChordName = name;
      tick.offset = offset();
      curEl.textContent = name === "N" ? "–" : show(name);
      const next = r.chords.slice(si + 1).find(s => s.chord !== "N");
      nxtEl.textContent = next ? `→ ${show(next.chord)}` : "";
      view.querySelectorAll(".diagram").forEach(d => d.classList.toggle("on", d.dataset.chord === diagramName(name)));
    }
    updateKeyboard(t, si);
    drawRoll();

    // words
    let lo = 0, hi = words.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (words[mid].start <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    const w = k >= 0 && t <= words[k].end + 0.4 ? words[k] : null;
    if (w !== lastWord) {
      lastWord?.el.classList.remove("on");
      w?.el.classList.add("on");
      lastWord = w;
    }
    const line = w ? w.lineEl : null;
    if (line && line !== lastLine) {
      lastLine?.classList.remove("on");
      line.classList.add("on");
      lastLine = line;
      followTo(line);
    }

    // measures (instrumental bars and tab)
    const cur = measureEls.filter(m => t >= m.start && t < m.end);
    if (cur.length !== lastMeasures.length || cur.some((m, i) => m !== lastMeasures[i])) {
      lastMeasures.forEach(m => m.els.forEach(e => e.classList.remove("on")));
      cur.forEach(m => m.els.forEach(e => e.classList.add("on")));
      lastMeasures = cur;
      if (TAB_VIEWS.includes(st.view) && cur[0]) followTo(cur[0].els[0].closest("pre"));
      if (st.view === "sheet" && cur[0] && !w) followTo(cur[0].els[0]);
    }

    if (!audio.paused) raf = requestAnimationFrame(tick);
  }

  // Auto-scroll: keep the current line ~30% down the space below the sticky header,
  // so the upcoming lines stay visible. Manual scrolling pauses it for a few seconds.
  let manualUntil = 0;
  const onManualScroll = () => { manualUntil = performance.now() + 4000; };
  window.addEventListener("wheel", onManualScroll, { passive: true });
  window.addEventListener("touchmove", onManualScroll, { passive: true });

  function followTo(el) {
    if (!el || !st.follow || audio.paused || performance.now() < manualUntil) return;
    const header = document.querySelector(".topbar");
    const top = header ? header.getBoundingClientRect().bottom : 0;
    const bottomReserve = bar.getBoundingClientRect().height || 0;
    const usable = Math.max(120, window.innerHeight - top - bottomReserve);
    const target = window.scrollY + el.getBoundingClientRect().top - top - usable * 0.3;
    if (Math.abs(target - window.scrollY) > 8) window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }

  audio.addEventListener("play", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      tick();
      const m = lastMeasures[0]?.els[0];
      followTo(TAB_VIEWS.includes(st.view) ? m?.closest("pre") : lastLine || m);
    });
  });
  audio.addEventListener("seeked", tick);

  const onKey = e => {
    if (noAudio) return;
    if (e.code !== "Space" || e.target.closest("input, select, [contenteditable=true], button")) return;
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  };
  document.addEventListener("keydown", onKey);
  const onResize = () => { if (TAB_VIEWS.includes(st.view) || ROLL_VIEWS.includes(st.view)) render(); };
  window.addEventListener("resize", onResize);
  cleanupFns.push(() => {
    cancelAnimationFrame(raf);
    audio.pause();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", onManualScroll);
    window.removeEventListener("touchmove", onManualScroll);
    window.removeEventListener("resize", onResize);
  });

  syncTuningControls();
  updateHeader();
  renderSuggestion();
  renderUpgrade();
  buildKeyboard();
  render();
  tick();

  const confBtn = document.getElementById("confOverall");
  if (confBtn && r.confidence) {
    const markSeen = () => store.set(`confModalSeen.${id}`, true);
    confBtn.onclick = () => openConfidenceModal(r.confidence);
    if (!store.get(`confModalSeen.${id}`, false)) {
      openConfidenceModal(r.confidence, { auto: true, onDismiss: markSeen });
    }
  }
}
