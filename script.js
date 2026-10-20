const { auth, database, storage } = window.firebaseApp;
const messagesRef = database.ref('messages');

const BAR_COUNT = 48;
const FEED_LIMIT = 200;
const STALE_UPLOAD_MS = 10 * 60 * 1000;
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const SPEEDS = [1, 1.5, 2];
const STEPS = ['Uploaded', 'Converting', 'Summarising'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);

let currentUser = null;
const entries = new Map();
const uploadProgress = new Map();
let feedLoaded = false;
let nowPlaying = null;

/* ---------- small helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const ICON_PATHS = {
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = ICON_PATHS[name]; // constant markup, no user data
  return svg;
}

let toastTimer = null;
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

function makeAvatar(uid, name) {
  const avatar = el('span', `avatar av${hashString(uid || name || '') % 6}`, initials(name));
  avatar.setAttribute('aria-hidden', 'true');
  return avatar;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(ts) {
  const key = dayKey(ts);
  const now = new Date();
  if (key === dayKey(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';
  const d = new Date(ts);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday}, ${d.getDate()} ${month}`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function placeholderPeaks(seed) {
  let x = hashString(seed || 'x') || 1;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    x = (x * 1664525 + 1013904223) >>> 0;
    const base = 0.35 + 0.65 * Math.abs(Math.sin(i / 5));
    return Math.min(1, base * (0.5 + (x % 1000) / 2000));
  });
}

/* ---------- menus ---------- */

let openMenuNode = null;
function closeMenu() {
  if (openMenuNode) openMenuNode.remove();
  openMenuNode = null;
}
document.addEventListener('click', (e) => {
  if (openMenuNode && !e.composedPath().includes(openMenuNode) && !e.target.closest('[aria-haspopup]')) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

function showMenu(anchor, build) {
  const wasOpen = openMenuNode && openMenuNode.parentElement === anchor.parentElement;
  closeMenu();
  if (wasOpen) return;
  const menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  build(menu);
  anchor.parentElement.appendChild(menu);
  openMenuNode = menu;
}

function menuItem(label, onClick, extraClass) {
  const btn = el('button', `menu-item${extraClass ? ` ${extraClass}` : ''}`, label);
  btn.setAttribute('role', 'menuitem');
  btn.addEventListener('click', onClick);
  return btn;
}

/* ---------- feed entries ---------- */

class Entry {
  constructor(id, data) {
    this.id = id;
    this.data = data;
    this.audio = null;
    this.rate = 1;
    this.seekOnLoad = null;
    this.audioUrlPromise = null;
    this.build();
    this.update(data);
  }

  build() {
    const li = el('li', 'entry');
    this.node = li;

    this.head = el('div', 'entry-head');
    this.avatarSlot = el('span');
    this.name = el('div', 'who-name');
    this.meta = el('div', 'who-meta');
    this.city = el('span', 'who-city');
    this.time = el('span');
    this.meta.append(this.city, document.createTextNode(' · '), this.time);
    const who = el('div', 'who');
    who.append(this.name, this.meta);

    const moreBtn = el('button', 'icon-btn');
    moreBtn.setAttribute('aria-label', 'Message options');
    moreBtn.setAttribute('aria-haspopup', 'true');
    moreBtn.appendChild(icon('more'));
    moreBtn.addEventListener('click', () => this.openOptions(moreBtn));
    this.head.append(this.avatarSlot, who, moreBtn);

    this.text = el('div', 'entry-text');
    this.pending = el('div', 'pending');
    this.stepNodes = STEPS.map((label) => el('span', 'step', label));
    const steps = el('div', 'steps');
    steps.append(...this.stepNodes);
    this.progressFill = document.createElement('i');
    const progress = el('div', 'progress');
    progress.appendChild(this.progressFill);
    this.pending.append(steps, progress);

    this.summary = el('p', 'summary');
    this.note = el('p', 'note');
    this.toggle = el('button', 'transcript-toggle', 'Show full transcript');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.transcript = el('p', 'transcript');
    this.transcript.hidden = true;
    this.toggle.addEventListener('click', () => {
      const open = this.transcript.hidden;
      this.transcript.hidden = !open;
      this.toggle.setAttribute('aria-expanded', String(open));
      this.toggle.textContent = open ? 'Hide transcript' : 'Show full transcript';
    });
    this.text.append(this.pending, this.summary, this.note, this.toggle, this.transcript);

    this.buildPlayer();
    li.append(this.head, this.text, this.player);
  }

  buildPlayer() {
    this.player = el('div', 'player');
    this.playBtn = el('button', 'play-btn');
    this.playBtn.setAttribute('aria-label', 'Play');
    this.playBtn.appendChild(icon('play'));
    this.playBtn.addEventListener('click', () => this.togglePlay());

    this.wave = el('div', 'wave');
    this.wave.setAttribute('role', 'slider');
    this.wave.setAttribute('aria-label', 'Seek');
    this.wave.setAttribute('aria-valuemin', '0');
    this.wave.setAttribute('aria-valuemax', '100');
    this.wave.setAttribute('aria-valuenow', '0');
    this.wave.tabIndex = 0;
    this.bars = Array.from({ length: BAR_COUNT }, () => document.createElement('i'));
    this.wave.append(...this.bars);
    this.wave.addEventListener('click', (e) => {
      const rect = this.wave.getBoundingClientRect();
      this.seekToFraction((e.clientX - rect.left) / rect.width);
    });
    this.wave.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
      if (!step) return;
      e.preventDefault();
      this.seekToSeconds(Math.max(0, this.currentTime() + step));
    });

    this.timeLabel = el('span', 'time', '0:00 / 0:00');
    this.speedBtn = el('button', 'speed', '1×');
    this.speedBtn.setAttribute('aria-label', 'Playback speed');
    this.speedBtn.addEventListener('click', () => {
      this.rate = SPEEDS[(SPEEDS.indexOf(this.rate) + 1) % SPEEDS.length];
      this.speedBtn.textContent = `${this.rate}×`;
      if (this.audio) this.audio.playbackRate = this.rate;
    });
    this.player.append(this.playBtn, this.wave, this.timeLabel, this.speedBtn);
  }

  /* data -> DOM; never touches this.audio so playback survives updates */
  update(data) {
    this.data = data;
    const uid = data.uid || '';
    const name = data.displayName || 'Family';
    if (this.avatarKey !== uid + name) {
      this.avatarKey = uid + name;
      this.avatarSlot.replaceWith(this.avatarSlot = makeAvatar(uid || name, name));
    }
    this.name.textContent = name;
    this.city.textContent = data.location || '';
    this.time.textContent = data.timestamp ? formatTime(data.timestamp) : '';

    const status = this.effectiveStatus();
    const inFlight = ['uploading', 'uploaded', 'converting', 'transcribing'].includes(status);
    this.pending.hidden = !inFlight;
    if (inFlight) this.renderPending(status);

    this.summary.textContent = data.summary || '';
    this.summary.hidden = !data.summary;

    let note = '';
    if (status === 'error') note = data.error ? 'Couldn’t process this message.' : 'Something went wrong with this message.';
    else if (status === 'stale') note = 'This upload didn’t finish.';
    else if (status === 'ready' && data.transcript === '') note = 'No speech detected.';
    this.note.textContent = note;
    this.note.hidden = !note;

    const hasTranscript = Boolean(data.transcript);
    this.toggle.hidden = !hasTranscript;
    this.transcript.textContent = data.transcript || '';
    if (!hasTranscript) this.transcript.hidden = true;

    const playable = Boolean(data.audioPath || data.audioUrl);
    this.player.hidden = !playable;
    if (playable) this.renderPlayerStatic();

  }

  effectiveStatus() {
    const { status, timestamp } = this.data;
    if (!status) return 'ready'; // messages from before status existed
    const local = uploadProgress.has(this.id);
    if (status === 'uploading' && !local && timestamp && Date.now() - timestamp > STALE_UPLOAD_MS) return 'stale';
    return status;
  }

  renderPending(status) {
    const active = { uploading: 0, uploaded: 0, converting: 1, transcribing: 2 }[status];
    this.stepNodes.forEach((node, i) => {
      node.className = `step${i < active || (i === 0 && status !== 'uploading') ? ' done' : ''}${i === active ? ' active' : ''}`;
    });
    this.setProgress(uploadProgress.get(this.id));
  }

  setProgress(fraction) {
    const status = this.effectiveStatus();
    let width = 0;
    if (status === 'uploading') width = (fraction || 0) / 3;
    else if (status === 'uploaded') width = 1 / 3;
    else if (status === 'converting') width = 0.5;
    else if (status === 'transcribing') width = 0.8;
    this.progressFill.style.width = `${Math.round(width * 100)}%`;
  }

  renderPlayerStatic() {
    if (this.audio) return;
    const peaks = Array.isArray(this.data.peaks) && this.data.peaks.length ? this.data.peaks : placeholderPeaks(this.id);
    this.bars.forEach((bar, i) => {
      const p = peaks[Math.min(peaks.length - 1, Math.floor((i / BAR_COUNT) * peaks.length))] || 0;
      bar.style.height = `${Math.round(12 + 88 * Math.max(0, Math.min(1, p)))}%`;
    });
    this.timeLabel.textContent = `0:00 / ${formatClock(this.data.duration)}`;
  }

  /* ---- playback ---- */

  currentTime() { return this.audio ? this.audio.currentTime : 0; }

  totalTime() {
    const d = this.audio && Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    return d || this.data.duration || 0;
  }

  async ensureAudio() {
    if (this.audio) return this.audio;
    if (!this.audioUrlPromise) {
      this.audioUrlPromise = this.data.audioPath
        ? storage.ref(this.data.audioPath).getDownloadURL()
        : Promise.resolve(this.data.audioUrl);
    }
    let url;
    try {
      url = await this.audioUrlPromise;
    } catch (err) {
      this.audioUrlPromise = null;
      throw err;
    }
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = url;
    audio.playbackRate = this.rate;
    audio.addEventListener('timeupdate', () => this.renderProgress());
    audio.addEventListener('loadedmetadata', () => {
      if (this.seekOnLoad != null) {
        audio.currentTime = this.seekOnLoad * this.totalTime();
        this.seekOnLoad = null;
      }
      this.renderProgress();
    });
    audio.addEventListener('play', () => this.setPlaying(true));
    audio.addEventListener('pause', () => this.setPlaying(false));
    audio.addEventListener('ended', () => {
      audio.currentTime = 0;
      this.setPlaying(false);
      this.renderProgress();
    });
    this.audio = audio;
    return audio;
  }

  async togglePlay() {
    try {
      const audio = await this.ensureAudio();
      if (audio.paused) {
        if (nowPlaying && nowPlaying !== this) nowPlaying.audio.pause();
        nowPlaying = this;
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (err) {
      toast('Couldn’t play this message.');
    }
  }

  setPlaying(playing) {
    this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (!playing && nowPlaying === this) nowPlaying = null;
  }

  async seekToFraction(fraction) {
    fraction = Math.max(0, Math.min(1, fraction));
    try {
      const audio = await this.ensureAudio();
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = fraction * audio.duration;
        this.renderProgress();
      } else {
        this.seekOnLoad = fraction;
      }
    } catch (err) {
      toast('Couldn’t load this message.');
    }
  }

  seekToSeconds(seconds) {
    const total = this.totalTime();
    if (total) this.seekToFraction(seconds / total);
  }

  renderProgress() {
    const total = this.totalTime();
    const current = this.currentTime();
    const fraction = total ? Math.min(1, current / total) : 0;
    const filled = Math.round(fraction * BAR_COUNT);
    this.bars.forEach((bar, i) => bar.classList.toggle('on', i < filled));
    this.wave.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    this.timeLabel.textContent = `${formatClock(current)} / ${formatClock(total)}`;
  }

  /* ---- options + delete ---- */

  openOptions(anchor) {
    showMenu(anchor, (menu) => {
      menu.appendChild(menuItem('Delete…', () => {
        menu.replaceChildren();
        menu.appendChild(el('div', 'menu-note', 'Delete this message?'));
        const row = el('div', 'menu-row');
        row.append(
          menuItem('Cancel', closeMenu),
          menuItem('Delete', () => { closeMenu(); this.remove(); }, 'danger'),
        );
        menu.appendChild(row);
      }, 'danger'));
    });
  }

  async remove() {
    const { audioPath, audioUrl } = this.data;
    try {
      await messagesRef.child(this.id).remove();
    } catch (err) {
      toast('Couldn’t delete the message.');
      return;
    }
    const fileRef = audioPath ? storage.ref(audioPath) : audioUrl ? storage.refFromURL(audioUrl) : null;
    if (fileRef) fileRef.delete().catch(() => {});
  }

  destroy() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (nowPlaying === this) nowPlaying = null;
    this.node.remove();
  }
}

/* ---------- feed layout: day sections, newest first ---------- */

const feed = $('feed');

function findOrCreateDay(key, ts) {
  let section = feed.querySelector(`section[data-day="${key}"]`);
  if (section) return section;
  section = el('section', 'day');
  section.dataset.day = key;
  section.dataset.ts = String(ts);
  const title = el('h2', 'day-title', dayLabel(ts));
  section.append(title, el('ol', 'entries'));
  const next = [...feed.children].find((s) => s.dataset.day < key);
  feed.insertBefore(section, next || null);
  return section;
}

function placeEntry(entry) {
  const ts = entry.data.timestamp || Date.now();
  entry.ts = ts;
  const key = dayKey(ts);
  const previousList = entry.node.parentElement;
  const list = findOrCreateDay(key, ts).querySelector('ol');
  const next = [...list.children].find((li) => li !== entry.node && Number(li.dataset.ts) < ts);
  entry.node.dataset.ts = String(ts);
  list.insertBefore(entry.node, next || null);
  if (previousList && previousList !== list && !previousList.children.length) previousList.parentElement.remove();
}

function pruneEmptyDay(list) {
  if (list && !list.children.length) list.parentElement.remove();
}

function refreshChrome() {
  $('empty').hidden = !feedLoaded || entries.size > 0;
  renderMembers();
}

function renderMembers() {
  const seen = new Map();
  [...entries.values()]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .forEach((e) => { if (e.data.uid) seen.set(e.data.uid, e.data.displayName || 'Family'); });
  const box = $('members');
  box.replaceChildren();
  [...seen].slice(0, 5).forEach(([uid, name]) => {
    const avatar = makeAvatar(uid, name);
    avatar.title = name;
    box.appendChild(avatar);
  });
}

function startFeed() {
  const query = messagesRef.orderByKey().limitToLast(FEED_LIMIT);
  query.on('child_added', (snap) => {
    const entry = new Entry(snap.key, snap.val());
    entries.set(snap.key, entry);
    placeEntry(entry);
    if (feedLoaded) refreshChrome();
  }, () => toast('Couldn’t load messages.'));
  query.on('child_changed', (snap) => {
    const entry = entries.get(snap.key);
    if (!entry) return;
    const prevTs = entry.data.timestamp;
    entry.update(snap.val());
    if (entry.data.timestamp !== prevTs) placeEntry(entry);
  });
  query.on('child_removed', (snap) => {
    const entry = entries.get(snap.key);
    if (!entry) return;
    const list = entry.node.parentElement;
    entry.destroy();
    entries.delete(snap.key);
    pruneEmptyDay(list);
    refreshChrome();
  });
  // Existing children arrive before this resolves, so the empty state never flashes.
  query.once('value').then(() => {
    feedLoaded = true;
    refreshChrome();
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  feed.querySelectorAll('.day').forEach((section) => {
    section.querySelector('.day-title').textContent = dayLabel(Number(section.dataset.ts));
  });
});

/* ---------- recorder ---------- */

const recorder = {
  stream: null,
  context: null,
  analyser: null,
  media: null,
  chunks: [],
  levels: [],
  history: [],
  startedAt: 0,
  rafId: 0,
  timerId: 0,
  levelId: 0,
  locationPromise: null,
  active: false,
};

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve('Unknown location');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => resolve(await getCityFromCoordinates(coords.latitude, coords.longitude)),
      () => resolve('Unknown location'),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

async function getCityFromCoordinates(lat, lon) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse.php?format=json&lat=${lat}&lon=${lon}`);
    const data = await response.json();
    return data.address.city || data.address.town || 'Unknown location';
  } catch (err) {
    return 'Unknown location';
  }
}

function setRecorderUI(recording) {
  $('recordBtn').hidden = recording;
  $('recActive').hidden = !recording;
}

async function startRecording() {
  if (recorder.active) return;
  const mimeType = pickMimeType();
  if (mimeType === null) {
    toast('Recording isn’t supported in this browser.');
    return;
  }
  try {
    recorder.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    toast('Microphone access is needed to record.');
    return;
  }

  recorder.chunks = [];
  recorder.levels = [];
  recorder.history = [];
  recorder.locationPromise = getUserLocation();

  const Ctx = window.AudioContext || window.webkitAudioContext;
  recorder.context = new Ctx();
  recorder.context.resume();
  const source = recorder.context.createMediaStreamSource(recorder.stream);
  recorder.analyser = recorder.context.createAnalyser();
  recorder.analyser.fftSize = 512;
  source.connect(recorder.analyser);
  // Silent sink keeps Safari pulling audio through the analyser.
  const sink = recorder.context.createGain();
  sink.gain.value = 0;
  recorder.analyser.connect(sink);
  sink.connect(recorder.context.destination);

  recorder.media = new MediaRecorder(recorder.stream, mimeType ? { mimeType } : undefined);
  recorder.media.ondataavailable = (e) => { if (e.data.size > 0) recorder.chunks.push(e.data); };
  recorder.media.start(1000);

  recorder.active = true;
  recorder.startedAt = performance.now();
  setRecorderUI(true);
  $('recTime').textContent = '0:00';
  recorder.timerId = setInterval(() => {
    $('recTime').textContent = formatClock((performance.now() - recorder.startedAt) / 1000);
  }, 250);
  recorder.levelId = setInterval(sampleLevel, 100);
  drawWave();
}

function currentLevel() {
  const data = new Uint8Array(recorder.analyser.fftSize);
  recorder.analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / data.length);
}

function sampleLevel() {
  if (recorder.analyser) recorder.levels.push(currentLevel());
}

function drawWave() {
  const canvas = $('recWave');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(canvas).color;

  const step = 4;
  const slots = Math.floor(width / step);
  recorder.history.push(Math.min(1, currentLevel() * 4));
  if (recorder.history.length > slots) recorder.history.splice(0, recorder.history.length - slots);
  recorder.history.forEach((level, i) => {
    const barH = Math.max(2, level * height);
    ctx.fillRect((slots - recorder.history.length + i) * step, (height - barH) / 2, 2, barH);
  });
  recorder.rafId = requestAnimationFrame(drawWave);
}

function releaseRecorder() {
  cancelAnimationFrame(recorder.rafId);
  clearInterval(recorder.timerId);
  clearInterval(recorder.levelId);
  if (recorder.stream) recorder.stream.getTracks().forEach((t) => t.stop());
  if (recorder.context && recorder.context.state !== 'closed') recorder.context.close().catch(() => {});
  recorder.stream = null;
  recorder.context = null;
  recorder.analyser = null;
  recorder.active = false;
  setRecorderUI(false);
}

function cancelRecording() {
  if (!recorder.active) return;
  recorder.media.ondataavailable = null;
  if (recorder.media.state !== 'inactive') recorder.media.stop();
  releaseRecorder();
  recorder.chunks = [];
}

function summarisePeaks(levels) {
  if (!levels.length) return placeholderPeaks('empty');
  const peaks = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const from = Math.floor((i / BAR_COUNT) * levels.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / BAR_COUNT) * levels.length));
    peaks.push(Math.max(...levels.slice(from, to)));
  }
  const max = Math.max(...peaks) || 1;
  return peaks.map((p) => Math.round((p / max) * 100) / 100);
}

async function sendRecording() {
  if (!recorder.active) return;
  const media = recorder.media;
  const duration = Math.round((performance.now() - recorder.startedAt) / 100) / 10;
  const peaks = summarisePeaks(recorder.levels);
  const locationPromise = recorder.locationPromise;

  const stopped = new Promise((resolve) => { media.onstop = resolve; });
  media.stop();
  await stopped;
  const blob = new Blob(recorder.chunks, { type: media.mimeType || 'audio/webm' });
  releaseRecorder();
  recorder.chunks = [];

  if (blob.size === 0 || duration < 1) {
    toast('That recording was too short.');
    return;
  }
  try {
    const location = await Promise.race([
      locationPromise,
      new Promise((resolve) => setTimeout(() => resolve('Unknown location'), 3000)),
    ]);
    await saveMessage(blob, { location, duration, peaks });
  } catch (err) {
    toast('Couldn’t send the message.');
  }
}

/* ---------- saving ---------- */

function extensionFor(mimeType) {
  return /mp4|m4a|aac/.test(mimeType) ? 'm4a' : 'webm';
}

async function saveMessage(blob, { location, duration, peaks }) {
  const contentType = blob.type || 'audio/webm';
  const newRef = messagesRef.push();
  const id = newRef.key;
  uploadProgress.set(id, 0);

  try {
    // Record first: the Cloud Function finds it through the id in the file metadata.
    await newRef.set({
      uid: currentUser.uid,
      displayName: currentUser.displayName || (currentUser.email || 'Family').split('@')[0],
      location,
      duration,
      peaks,
      mimeType: contentType,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      status: 'uploading',
    });

    const task = storage.ref(`recordings/${id}.${extensionFor(contentType)}`).put(blob, {
      contentType,
      customMetadata: { messageId: id, uid: currentUser.uid },
    });
    task.on('state_changed', (snap) => {
      const fraction = snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0;
      uploadProgress.set(id, fraction);
      const entry = entries.get(id);
      if (entry) entry.setProgress(fraction);
    });
    await task;

    // The function may already have moved on; only advance from "uploading".
    await newRef.child('status').transaction((s) => (s === 'uploading' ? 'uploaded' : undefined));
  } catch (err) {
    await newRef.update({ status: 'error', error: 'Upload failed' }).catch(() => {});
    throw err;
  } finally {
    uploadProgress.delete(id);
    const entry = entries.get(id);
    if (entry) entry.update(entry.data);
  }
}

/* ---------- boot ---------- */

$('recordBtn').addEventListener('click', startRecording);
$('cancelBtn').addEventListener('click', cancelRecording);
$('sendBtn').addEventListener('click', sendRecording);

$('settingsBtn').addEventListener('click', (e) => {
  showMenu(e.currentTarget, (menu) => {
    menu.appendChild(el('div', 'menu-note', currentUser.displayName || currentUser.email || 'Signed in'));
    menu.appendChild(menuItem('Log out', () => auth.signOut()));
  });
});

let feedStarted = false;
auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }
  currentUser = user;
  if (!feedStarted) {
    feedStarted = true;
    startFeed();
  }
});
