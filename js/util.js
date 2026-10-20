export const { auth, database, storage, functions } = window.firebaseApp;

export const BAR_COUNT = 48;
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
export const COLORS = [
  '#5b7c99', '#6b8f71', '#b9694a', '#8f6a99', '#a9822f', '#bb6475', '#4a8a8f', '#6f7580',
];

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const ICON_PATHS = {
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = ICON_PATHS[name]; // constant markup, no user data
  return svg;
}

let toastTimer = null;
export function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

export function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function initials(name) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

export function makeAvatar(uid, name, extraClass) {
  const avatar = el('span', `avatar av${hashString(uid || name || '') % 6}${extraClass ? ` ${extraClass}` : ''}`, initials(name));
  avatar.setAttribute('aria-hidden', 'true');
  return avatar;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(ts) {
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

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function placeholderPeaks(seed) {
  let x = hashString(seed || 'x') || 1;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    x = (x * 1664525 + 1013904223) >>> 0;
    const base = 0.35 + 0.65 * Math.abs(Math.sin(i / 5));
    return Math.min(1, base * (0.5 + (x % 1000) / 2000));
  });
}

export function callable(name) {
  const fn = functions.httpsCallable(name);
  return async (data) => (await fn(data)).data;
}

/* Turns a callable's error into a short message for a toast. */
export function errorText(err, fallback) {
  const message = err && err.message;
  if (message && !/^(internal|functions\/)/i.test(message) && message.length < 140) return message;
  return fallback;
}

/* ---------- popup menus ---------- */

let openMenuNode = null;
export function closeMenu() {
  if (openMenuNode) openMenuNode.remove();
  openMenuNode = null;
}
document.addEventListener('click', (e) => {
  if (openMenuNode && !e.composedPath().includes(openMenuNode) && !e.target.closest('[aria-haspopup]')) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

export function showMenu(anchor, build) {
  const wasOpen = openMenuNode && openMenuNode.parentElement === anchor.parentElement;
  closeMenu();
  if (wasOpen) return;
  const menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  build(menu);
  anchor.parentElement.appendChild(menu);
  openMenuNode = menu;
}

export function menuItem(label, onClick, extraClass) {
  const btn = el('button', `menu-item${extraClass ? ` ${extraClass}` : ''}`, label);
  btn.setAttribute('role', 'menuitem');
  btn.addEventListener('click', onClick);
  return btn;
}

/* ---------- dialogs (native <dialog>) ---------- */

/* Opens a modal sheet. `build(body, close)` fills it. Resolves when closed. */
export function openDialog(title, build) {
  return new Promise((resolve) => {
    const dialog = el('dialog', 'sheet');
    const head = el('div', 'sheet-head');
    head.appendChild(el('h2', 'sheet-title', title));
    const closeBtn = el('button', 'icon-btn');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.appendChild(icon('close'));
    head.appendChild(closeBtn);
    const body = el('div', 'sheet-body');
    dialog.append(head, body);
    document.body.appendChild(dialog);

    let result;
    const close = (value) => {
      result = value;
      dialog.close();
    };
    closeBtn.addEventListener('click', () => close(undefined));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(undefined); });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    build(body, close);
    dialog.showModal();
  });
}

export function confirmDialog({ title, message, confirmLabel, danger }) {
  return openDialog(title, (body, close) => {
    body.appendChild(el('p', 'sheet-text', message));
    const row = el('div', 'sheet-actions');
    const cancel = el('button', 'btn secondary', 'Cancel');
    const ok = el('button', `btn${danger ? ' danger' : ''}`, confirmLabel);
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    row.append(cancel, ok);
    body.appendChild(row);
  }).then((v) => v === true);
}

/* Color swatches; returns { node, get(), set() }. */
export function colorPicker(initial) {
  let value = initial || COLORS[0];
  const node = el('div', 'swatches');
  node.setAttribute('role', 'radiogroup');
  const buttons = COLORS.map((color) => {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.background = color;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', color);
    b.addEventListener('click', () => { value = color; paint(); });
    node.appendChild(b);
    return b;
  });
  function paint() {
    buttons.forEach((b, i) => b.setAttribute('aria-checked', String(COLORS[i] === value)));
  }
  paint();
  return { node, get: () => value };
}
