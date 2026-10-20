import { BAR_COUNT, toast, formatClock, placeholderPeaks } from './util.js';

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

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

/*
 * Wires a recorder UI (record button, active row with timer/canvas/cancel/send) found in
 * `root` by data-rec attributes. `onSave(blob, { location, duration, peaks })` is called
 * when the user sends a recording. Returns { cancel }.
 */
export function createRecorder(root, onSave) {
  const q = (name) => root.querySelector(`[data-rec="${name}"]`);
  const recordBtn = q('record');
  const activeRow = q('active');
  const timeNode = q('time');
  const canvas = q('wave');

  const r = {
    stream: null, context: null, analyser: null, media: null,
    chunks: [], levels: [], history: [],
    startedAt: 0, rafId: 0, timerId: 0, levelId: 0,
    locationPromise: null, active: false,
  };

  function setUI(recording) {
    recordBtn.hidden = recording;
    activeRow.hidden = !recording;
  }

  function currentLevel() {
    const data = new Uint8Array(r.analyser.fftSize);
    r.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    return Math.sqrt(sum / data.length);
  }

  function drawWave() {
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
    r.history.push(Math.min(1, currentLevel() * 4));
    if (r.history.length > slots) r.history.splice(0, r.history.length - slots);
    r.history.forEach((level, i) => {
      const barH = Math.max(2, level * height);
      ctx.fillRect((slots - r.history.length + i) * step, (height - barH) / 2, 2, barH);
    });
    r.rafId = requestAnimationFrame(drawWave);
  }

  async function start() {
    if (r.active) return;
    const mimeType = pickMimeType();
    if (mimeType === null) {
      toast('Recording isn’t supported in this browser.');
      return;
    }
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      toast('Microphone access is needed to record.');
      return;
    }

    r.chunks = [];
    r.levels = [];
    r.history = [];
    r.locationPromise = getUserLocation();

    const Ctx = window.AudioContext || window.webkitAudioContext;
    r.context = new Ctx();
    r.context.resume();
    const source = r.context.createMediaStreamSource(r.stream);
    r.analyser = r.context.createAnalyser();
    r.analyser.fftSize = 512;
    source.connect(r.analyser);
    // Silent sink keeps Safari pulling audio through the analyser.
    const sink = r.context.createGain();
    sink.gain.value = 0;
    r.analyser.connect(sink);
    sink.connect(r.context.destination);

    r.media = new MediaRecorder(r.stream, mimeType ? { mimeType } : undefined);
    r.media.ondataavailable = (e) => { if (e.data.size > 0) r.chunks.push(e.data); };
    r.media.start(1000);

    r.active = true;
    r.startedAt = performance.now();
    setUI(true);
    timeNode.textContent = '0:00';
    r.timerId = setInterval(() => {
      timeNode.textContent = formatClock((performance.now() - r.startedAt) / 1000);
    }, 250);
    r.levelId = setInterval(() => { if (r.analyser) r.levels.push(currentLevel()); }, 100);
    drawWave();
  }

  function release() {
    cancelAnimationFrame(r.rafId);
    clearInterval(r.timerId);
    clearInterval(r.levelId);
    if (r.stream) r.stream.getTracks().forEach((t) => t.stop());
    if (r.context && r.context.state !== 'closed') r.context.close().catch(() => {});
    r.stream = null;
    r.context = null;
    r.analyser = null;
    r.active = false;
    setUI(false);
  }

  function cancel() {
    if (!r.active) return;
    r.media.ondataavailable = null;
    if (r.media.state !== 'inactive') r.media.stop();
    release();
    r.chunks = [];
  }

  async function send() {
    if (!r.active) return;
    const media = r.media;
    const duration = Math.round((performance.now() - r.startedAt) / 100) / 10;
    const peaks = summarisePeaks(r.levels);
    const locationPromise = r.locationPromise;

    const stopped = new Promise((resolve) => { media.onstop = resolve; });
    media.stop();
    await stopped;
    const blob = new Blob(r.chunks, { type: media.mimeType || 'audio/webm' });
    release();
    r.chunks = [];

    if (blob.size === 0 || duration < 1) {
      toast('That recording was too short.');
      return;
    }
    try {
      const location = await Promise.race([
        locationPromise,
        new Promise((resolve) => setTimeout(() => resolve('Unknown location'), 3000)),
      ]);
      await onSave(blob, { location, duration, peaks });
    } catch (err) {
      toast('Couldn’t send the message.');
    }
  }

  recordBtn.addEventListener('click', start);
  q('cancel').addEventListener('click', cancel);
  q('send').addEventListener('click', send);
  return { cancel };
}
