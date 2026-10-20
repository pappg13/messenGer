import {
  database, el, icon, toast, openDialog, colorPicker, COLORS, callable, errorText,
} from './util.js';

const createJournal = callable('createJournal');

/* Pale text on dark tiles, dark text on light ones. */
function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#1c1c1e' : '#ffffff';
}

function openNewJournal() {
  openDialog('New Journal', (body, close) => {
    const form = el('form', 'sheet-form');
    const field = el('div', 'field');
    const label = el('label', null, 'Name');
    label.htmlFor = 'newJournalName';
    const input = el('input');
    input.id = 'newJournalName';
    input.maxLength = 60;
    input.required = true;
    input.autocomplete = 'off';
    input.placeholder = 'e.g. Family, Trip to Japan';
    field.append(label, input);

    const colorLabel = el('div', 'field-label', 'Color');
    const picker = colorPicker(COLORS[Math.floor(Math.random() * COLORS.length)]);
    const submit = el('button', 'btn', 'Create Journal');
    submit.type = 'submit';
    form.append(field, colorLabel, picker.node, submit);
    body.appendChild(form);
    setTimeout(() => input.focus(), 0);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      submit.disabled = true;
      try {
        const { jid } = await createJournal({ name, color: picker.get() });
        close(jid);
      } catch (err) {
        submit.disabled = false;
        toast(errorText(err, 'Couldn’t create the Journal.'));
      }
    });
  }).then((jid) => { if (jid) window.location.hash = `#/j/${jid}`; });
}

export function mountHome(container, { me }) {
  const root = el('div', 'home');
  const header = el('header', 'header');
  header.appendChild(el('h1', 'wordmark', 'messenGer'));
  root.appendChild(header);
  root.appendChild(el('h2', 'section-title', 'Your Journals'));
  const grid = el('div', 'tiles');
  root.appendChild(grid);
  const hint = el('p', 'home-hint', 'Journals are private spaces for voice messages. Create one, then share its invite link with the people you want in it.');
  hint.hidden = true;
  root.appendChild(hint);
  container.appendChild(root);

  const journals = new Map(); // jid -> { meta, lastSeenAt, offs: [] }
  let listLoaded = false;

  function render() {
    grid.replaceChildren();
    const items = [...journals.entries()]
        .filter(([, j]) => j.meta)
        .sort(([, a], [, b]) => (b.meta.lastMessageAt || b.meta.createdAt || 0) - (a.meta.lastMessageAt || a.meta.createdAt || 0));
    for (const [jid, j] of items) {
      const tile = el('a', 'tile');
      tile.href = `#/j/${jid}`;
      tile.style.background = j.meta.color;
      tile.style.color = textColorFor(j.meta.color);
      tile.appendChild(el('span', 'tile-name', j.meta.name));
      const isNew = j.meta.lastMessageAt && j.meta.lastMessageBy !== me &&
        j.meta.lastMessageAt > (j.lastSeenAt || 0);
      if (isNew) {
        tile.appendChild(el('span', 'tile-badge', 'New'));
        tile.setAttribute('aria-label', `${j.meta.name}, new messages`);
      }
      grid.appendChild(tile);
    }
    const add = el('button', 'tile tile-add');
    add.type = 'button';
    add.append(icon('plus'), el('span', 'tile-name', 'New Journal'));
    add.addEventListener('click', openNewJournal);
    grid.appendChild(add);
    hint.hidden = !listLoaded || items.length > 0;
  }

  function track(jid) {
    const entry = { meta: null, lastSeenAt: 0, offs: [] };
    journals.set(jid, entry);
    const metaRef = database.ref(`journals/${jid}/meta`);
    const seenRef = database.ref(`journals/${jid}/members/${me}/lastSeenAt`);
    const onMeta = metaRef.on('value', (snap) => { entry.meta = snap.val(); render(); }, () => {});
    const onSeen = seenRef.on('value', (snap) => { entry.lastSeenAt = snap.val() || 0; render(); }, () => {});
    entry.offs.push(() => metaRef.off('value', onMeta), () => seenRef.off('value', onSeen));
  }

  function untrack(jid) {
    const entry = journals.get(jid);
    if (entry) entry.offs.forEach((off) => off());
    journals.delete(jid);
  }

  const listRef = database.ref(`userJournals/${me}`);
  const onList = listRef.on('value', (snap) => {
    const ids = new Set(Object.keys(snap.val() || {}));
    for (const jid of [...journals.keys()]) if (!ids.has(jid)) untrack(jid);
    for (const jid of ids) if (!journals.has(jid)) track(jid);
    listLoaded = true;
    render();
  }, () => toast('Couldn’t load your Journals.'));

  render();
  return () => {
    listRef.off('value', onList);
    for (const jid of [...journals.keys()]) untrack(jid);
    root.remove();
  };
}
