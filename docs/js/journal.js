import {
  database, storage, el, icon, toast, makeAvatar, dayKey, dayLabel, showMenu, closeMenu, menuItem,
  openDialog, confirmDialog, colorPicker, callable, errorText,
} from './util.js';
import { Entry, stopPlayback } from './entry.js';
import { createRecorder } from './recorder.js';

const FEED_LIMIT = 200;
const MAX_HEADER_AVATARS = 4;
const SEEN_DEBOUNCE_MS = 1500;

const actions = { leave: callable('leaveJournal'), remove: callable('deleteJournal') };

function extensionFor(mimeType) {
  return /mp4|m4a|aac/.test(mimeType) ? 'm4a' : 'webm';
}

function inviteLink(token) {
  return `${window.location.origin}${window.location.pathname}#/join/${token}`;
}

export function mountJournal(container, { user, jid }) {
  const me = user.uid;
  const journalRef = database.ref(`journals/${jid}`);
  const metaRef = journalRef.child('meta');
  const membersRef = journalRef.child('members');
  const messagesRef = journalRef.child('messages');
  const listensRef = journalRef.child('listens');
  const reactionsRef = journalRef.child('reactions');
  const mySeenRef = membersRef.child(me).child('lastSeenAt');

  let meta = null;
  const members = new Map(); // uid -> { displayName, joinedAt }
  const entries = new Map();
  const listensData = new Map();
  const reactionsData = new Map();
  const uploadProgress = new Map();
  const offs = [];
  let dead = false;
  let leaving = false;
  let feedLoaded = false;
  let seenAt = 0; // lastSeenAt when this visit started; drives the divider
  let started = false;
  let seenTimer = 0;
  let dividerFrame = 0;

  const ctx = {
    jid,
    me,
    messagesRef,
    listensRef,
    reactionsRef,
    uploadProgress,
    memberName: (uid, fallback) => (members.get(uid) && members.get(uid).displayName) || fallback || 'Someone',
  };

  /* ---------- DOM ---------- */

  const root = el('div', 'journal');
  const top = el('div', 'top');
  const header = el('header', 'header jheader');
  const back = el('a', 'icon-btn');
  back.href = '#/';
  back.setAttribute('aria-label', 'All Journals');
  back.appendChild(icon('back'));
  const dot = el('span', 'color-dot');
  const title = el('h1', 'jtitle', '');
  const membersBtn = el('button', 'members');
  membersBtn.setAttribute('aria-label', 'Members');
  const moreBtn = el('button', 'icon-btn');
  moreBtn.setAttribute('aria-label', 'Journal options');
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.appendChild(icon('more'));
  header.append(back, dot, title, membersBtn, moreBtn);

  const recorderBox = el('div', 'recorder');
  recorderBox.innerHTML = `
    <button class="record-btn" data-rec="record">
      <svg class="icon" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
      Record
    </button>
    <div class="rec-active" data-rec="active" hidden>
      <span class="rec-dot"></span>
      <span class="rec-time" data-rec="time">0:00</span>
      <canvas class="rec-wave" data-rec="wave"></canvas>
      <button class="icon-btn" data-rec="cancel" aria-label="Cancel recording">
        <svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <button class="icon-btn send-btn" data-rec="send" aria-label="Send recording">
        <svg class="icon" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
      </button>
    </div>`; // constant markup, no user data
  top.append(header, recorderBox);

  const feed = el('main', 'feed');
  feed.setAttribute('aria-live', 'polite');
  const empty = el('div', 'empty');
  empty.hidden = true;
  empty.append(el('h2', null, 'Record the first message'), el('p', null, 'Tap Record above. Everything here is private to this Journal’s members.'));
  root.append(top, feed, empty);
  container.appendChild(root);

  const recorder = createRecorder(recorderBox, saveMessage);

  /* ---------- header, members ---------- */

  function renderHeader() {
    if (!meta) return;
    title.textContent = meta.name;
    dot.style.background = meta.color;
    root.style.setProperty('--journal', meta.color);
    document.title = `${meta.name} · messenGer`;
  }

  function sortedMembers() {
    return [...members.entries()].sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
  }

  function renderMembers() {
    membersBtn.replaceChildren();
    const list = sortedMembers();
    list.slice(0, MAX_HEADER_AVATARS).forEach(([uid, m]) => {
      const avatar = makeAvatar(uid, m.displayName);
      avatar.title = m.displayName;
      membersBtn.appendChild(avatar);
    });
    if (list.length > MAX_HEADER_AVATARS) {
      membersBtn.appendChild(el('span', 'avatar more', `+${list.length - MAX_HEADER_AVATARS}`));
    }
    membersBtn.setAttribute('aria-label', `${list.length} member${list.length === 1 ? '' : 's'}`);
    entries.forEach((entry) => entry.update(entry.data));
  }

  function showMembers() {
    openDialog(`Members (${members.size})`, (body) => {
      const list = el('ul', 'member-list');
      sortedMembers().forEach(([uid, m]) => {
        const li = el('li', 'member-row');
        const who = el('div', 'who');
        who.append(el('div', 'who-name', m.displayName));
        const tags = [uid === me ? 'You' : '', meta && uid === meta.createdBy ? 'Creator' : ''].filter(Boolean);
        if (tags.length) who.append(el('div', 'who-meta', tags.join(' · ')));
        li.append(makeAvatar(uid, m.displayName), who);
        list.appendChild(li);
      });
      body.appendChild(list);
    });
  }
  membersBtn.addEventListener('click', showMembers);

  /* ---------- journal actions ---------- */

  function editJournal() {
    openDialog('Rename & color', (body, close) => {
      const form = el('form', 'sheet-form');
      const field = el('div', 'field');
      const label = el('label', null, 'Name');
      label.htmlFor = 'editJournalName';
      const input = el('input');
      input.id = 'editJournalName';
      input.maxLength = 60;
      input.required = true;
      input.value = meta.name;
      field.append(label, input);
      const picker = colorPicker(meta.color);
      const submit = el('button', 'btn', 'Save');
      submit.type = 'submit';
      form.append(field, el('div', 'field-label', 'Color'), picker.node, submit);
      body.appendChild(form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        submit.disabled = true;
        try {
          await journalRef.child('meta').update({ name, color: picker.get() });
          close(true);
        } catch (err) {
          submit.disabled = false;
          toast('Couldn’t save the changes.');
        }
      });
    });
  }

  function showInvite() {
    const link = inviteLink(meta.inviteToken);
    openDialog(`Invite to ${meta.name}`, (body) => {
      body.appendChild(el('p', 'sheet-text', 'Anyone with this link or QR code can join this Journal and see all of its messages. The link never expires.'));
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      const img = el('img', 'qr');
      img.alt = 'QR code for the invite link';
      img.src = qr.createDataURL(6, 8);
      body.appendChild(img);

      const input = el('input', 'link-input');
      input.readOnly = true;
      input.value = link;
      input.setAttribute('aria-label', 'Invite link');
      input.addEventListener('focus', () => input.select());
      body.appendChild(input);

      const row = el('div', 'sheet-actions');
      const copy = el('button', 'btn', 'Copy link');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast('Link copied.');
        } catch (err) {
          input.select();
          toast('Press Ctrl/Cmd+C to copy the link.');
        }
      });
      row.appendChild(copy);
      if (navigator.share) {
        const share = el('button', 'btn secondary', 'Share…');
        share.addEventListener('click', () => {
          navigator.share({ title: meta.name, url: link }).catch(() => {});
        });
        row.appendChild(share);
      }
      body.appendChild(row);
    });
  }

  async function leaveJournal() {
    const ok = await confirmDialog({
      title: `Leave ${meta.name}?`,
      message: 'You will no longer see this Journal. Your messages stay in it. You can rejoin with an invite link.',
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;
    leaving = true;
    try {
      await actions.leave({ jid });
      window.location.hash = '#/';
    } catch (err) {
      leaving = false;
      toast(errorText(err, 'Couldn’t leave the Journal.'));
    }
  }

  async function deleteJournal() {
    const ok = await confirmDialog({
      title: `Delete ${meta.name}?`,
      message: 'This permanently deletes the Journal and all of its voice messages for every member. This can’t be undone.',
      confirmLabel: 'Delete Journal',
      danger: true,
    });
    if (!ok) return;
    leaving = true;
    try {
      await actions.remove({ jid });
      window.location.hash = '#/';
    } catch (err) {
      leaving = false;
      toast(errorText(err, 'Couldn’t delete the Journal.'));
    }
  }

  moreBtn.addEventListener('click', () => {
    if (!meta) return;
    showMenu(moreBtn, (menu) => {
      menu.appendChild(menuItem('Invite people', () => { closeMenu(); showInvite(); }));
      menu.appendChild(menuItem('Members', () => { closeMenu(); showMembers(); }));
      menu.appendChild(menuItem('Rename & color', () => { closeMenu(); editJournal(); }));
      if (meta.createdBy === me) {
        menu.appendChild(menuItem('Delete Journal…', () => { closeMenu(); deleteJournal(); }, 'danger'));
      } else {
        menu.appendChild(menuItem('Leave Journal…', () => { closeMenu(); leaveJournal(); }, 'danger'));
      }
    });
  });

  /* ---------- feed layout: day sections, newest first ---------- */

  function findOrCreateDay(key, ts) {
    let section = feed.querySelector(`section[data-day="${key}"]`);
    if (section) return section;
    section = el('section', 'day');
    section.dataset.day = key;
    section.dataset.ts = String(ts);
    section.append(el('h2', 'day-title', dayLabel(ts)), el('ol', 'entries'));
    const next = [...feed.children].find((s) => s.dataset.day < key);
    feed.insertBefore(section, next || null);
    return section;
  }

  function placeEntry(entry) {
    const ts = entry.data.createdAt || Date.now();
    entry.ts = ts;
    const previousList = entry.node.parentElement;
    const list = findOrCreateDay(dayKey(ts), ts).querySelector('ol');
    const next = [...list.children].find((li) => li !== entry.node && Number(li.dataset.ts) < ts);
    entry.node.dataset.ts = String(ts);
    list.insertBefore(entry.node, next || null);
    if (previousList && previousList !== list) pruneEmptyDay(previousList);
  }

  function pruneEmptyDay(list) {
    if (list && !list.querySelector('.entry')) list.parentElement.remove();
  }

  function refreshChrome() {
    empty.hidden = !feedLoaded || entries.size > 0;
    scheduleDivider();
  }

  /* "New since your last visit": sits between messages newer and older than seenAt. */
  function scheduleDivider() {
    if (dividerFrame) return;
    dividerFrame = requestAnimationFrame(() => {
      dividerFrame = 0;
      feed.querySelectorAll('.new-divider').forEach((n) => {
        const list = n.parentElement;
        n.remove();
        pruneEmptyDay(list);
      });
      if (!feedLoaded || !seenAt) return;
      const sorted = [...entries.values()].sort((a, b) => b.ts - a.ts);
      const hasNew = sorted.some((e) => e.ts > seenAt && e.data.authorId !== me);
      if (!hasNew) return;
      const divider = el('li', 'new-divider', 'New since your last visit');
      divider.setAttribute('role', 'separator');
      const firstOld = sorted.find((e) => e.ts <= seenAt);
      if (firstOld) firstOld.node.before(divider);
      else sorted[sorted.length - 1].node.after(divider);
    });
  }

  /* ---------- last-seen tracking ---------- */

  function touchSeen(immediately) {
    clearTimeout(seenTimer);
    const write = () => { mySeenRef.set(firebase.database.ServerValue.TIMESTAMP).catch(() => {}); };
    if (immediately) write();
    else seenTimer = setTimeout(write, SEEN_DEBOUNCE_MS);
  }

  function onVisibility() {
    if (!document.hidden) {
      feed.querySelectorAll('.day').forEach((s) => {
        s.querySelector('.day-title').textContent = dayLabel(Number(s.dataset.ts));
      });
      touchSeen();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  /* ---------- subscriptions ---------- */

  function on(ref, event, handler, onError) {
    const fn = ref.on(event, handler, onError || (() => {}));
    offs.push(() => ref.off(event, fn));
  }

  function notAllowed() {
    if (dead || leaving) return;
    toast('You’re not a member of this Journal.');
    window.location.hash = '#/';
  }

  function startFeed() {
    const query = messagesRef.orderByChild('createdAt').limitToLast(FEED_LIMIT);
    on(query, 'child_added', (snap) => {
      const data = snap.val();
      if (data.deletedAt || entries.has(snap.key)) return;
      const entry = new Entry(ctx, snap.key, data);
      entry.setListens(listensData.get(snap.key));
      entry.setReactions(reactionsData.get(snap.key));
      entries.set(snap.key, entry);
      placeEntry(entry);
      if (feedLoaded) {
        refreshChrome();
        if (data.authorId !== me && !document.hidden) touchSeen();
      }
    }, () => toast('Couldn’t load messages.'));
    on(query, 'child_changed', (snap) => {
      const data = snap.val();
      const entry = entries.get(snap.key);
      if (data.deletedAt) {
        if (!entry) return;
        const list = entry.node.parentElement;
        entry.destroy();
        entries.delete(snap.key);
        pruneEmptyDay(list);
        refreshChrome();
        return;
      }
      if (!entry) return;
      const prevTs = entry.data.createdAt;
      entry.update(data);
      if (entry.data.createdAt !== prevTs) placeEntry(entry);
    });
    on(query, 'child_removed', (snap) => {
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
    }).catch(() => {});

    const track = (ref, store, apply) => {
      const handler = (snap) => {
        store.set(snap.key, snap.val());
        const entry = entries.get(snap.key);
        if (entry) entry[apply](snap.val());
      };
      on(ref, 'child_added', handler);
      on(ref, 'child_changed', handler);
      on(ref, 'child_removed', (snap) => {
        store.delete(snap.key);
        const entry = entries.get(snap.key);
        if (entry) entry[apply](null);
      });
    };
    track(listensRef, listensData, 'setListens');
    track(reactionsRef, reactionsData, 'setReactions');
  }

  async function init() {
    on(metaRef, 'value', (snap) => {
      if (leaving) return;
      meta = snap.val();
      if (!meta) {
        if (!dead) {
          toast('This Journal no longer exists.');
          window.location.hash = '#/';
        }
        return;
      }
      renderHeader();
    }, notAllowed);
    on(membersRef, 'value', (snap) => {
      members.clear();
      Object.entries(snap.val() || {}).forEach(([uid, m]) => members.set(uid, m));
      renderMembers();
    }, notAllowed);

    try {
      seenAt = (await mySeenRef.once('value')).val() || 0;
    } catch (err) {
      notAllowed();
      return;
    }
    if (dead) return;
    started = true;
    startFeed();
    touchSeen(true);
  }

  /* ---------- sending ---------- */

  async function saveMessage(blob, { location, duration, peaks }) {
    const contentType = blob.type || 'audio/webm';
    const newRef = messagesRef.push();
    const id = newRef.key;
    uploadProgress.set(id, 0);

    try {
      // Record first: the Cloud Function checks this record before it touches the upload.
      await newRef.set({
        authorId: me,
        authorName: user.displayName || (user.email || 'Someone').split('@')[0],
        location,
        duration,
        peaks,
        mimeType: contentType,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        status: 'uploading',
      });

      const task = storage.ref(`uploads/${me}/${jid}/${id}.${extensionFor(contentType)}`)
          .put(blob, { contentType });
      task.on('state_changed', (snap) => {
        const fraction = snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0;
        uploadProgress.set(id, fraction);
        const entry = entries.get(id);
        if (entry) entry.setProgress(fraction);
      });
      await task;
    } catch (err) {
      await newRef.child('status').set('error').catch(() => {});
      throw err;
    } finally {
      uploadProgress.delete(id);
      const entry = entries.get(id);
      if (entry) entry.update(entry.data);
    }
  }

  init();

  return () => {
    dead = true;
    recorder.cancel();
    stopPlayback();
    clearTimeout(seenTimer);
    cancelAnimationFrame(dividerFrame);
    document.removeEventListener('visibilitychange', onVisibility);
    offs.forEach((off) => off());
    entries.forEach((entry) => entry.destroy());
    if (started && !leaving) mySeenRef.set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
    closeMenu();
    document.title = 'messenGer';
    root.remove();
  };
}
