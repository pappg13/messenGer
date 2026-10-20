import { auth, database, $, el, toast, callable, errorText, closeMenu } from './util.js';
import { mountHome } from './home.js';
import { mountJournal } from './journal.js';

const joinJournal = callable('joinJournal');
const view = $('view');
const tabs = document.querySelectorAll('.tab');

let user = null;
let unmount = null;
let routeToken = 0;
let signingOut = false;

/* ---------- account tab ---------- */

function mountAccount(container, { user: u }) {
  const root = el('div', 'account');
  const header = el('header', 'header');
  header.appendChild(el('h1', 'wordmark', 'Account'));
  root.appendChild(header);

  const form = el('form', 'sheet-form');
  const emailField = el('div', 'field');
  const emailLabel = el('label', null, 'Signed in as');
  emailLabel.htmlFor = 'acctEmail';
  const email = el('input');
  email.id = 'acctEmail';
  email.value = u.email || '';
  email.readOnly = true;
  emailField.append(emailLabel, email);

  const nameField = el('div', 'field');
  const nameLabel = el('label', null, 'Display name');
  nameLabel.htmlFor = 'acctName';
  const name = el('input');
  name.id = 'acctName';
  name.maxLength = 60;
  name.required = true;
  name.value = u.displayName || (u.email || '').split('@')[0];
  nameField.append(nameLabel, name);

  const save = el('button', 'btn', 'Save name');
  save.type = 'submit';
  const logout = el('button', 'btn secondary', 'Log out');
  logout.type = 'button';
  logout.addEventListener('click', () => {
    signingOut = true;
    auth.signOut();
  });
  form.append(emailField, nameField, save, logout);
  root.appendChild(form);
  container.appendChild(root);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = name.value.trim();
    if (!displayName) return;
    save.disabled = true;
    try {
      await u.updateProfile({ displayName });
      // Members carry their own copy of the name in every Journal they belong to.
      const joined = (await database.ref(`userJournals/${u.uid}`).once('value')).val() || {};
      await Promise.all(Object.keys(joined).map((jid) => database
          .ref(`journals/${jid}/members/${u.uid}/displayName`).set(displayName).catch(() => {})));
      toast('Name saved.');
    } catch (err) {
      toast('Couldn’t save your name.');
    } finally {
      save.disabled = false;
    }
  });

  return () => root.remove();
}

/* ---------- joining through an invite link ---------- */

function mountJoin(container, { token }) {
  const root = el('div', 'join');
  const message = el('p', 'join-text', 'Joining Journal…');
  const home = el('a', 'btn secondary', 'Go to my Journals');
  home.href = '#/';
  home.hidden = true;
  root.append(message, home);
  container.appendChild(root);

  let cancelled = false;
  joinJournal({ token }).then(({ jid }) => {
    if (!cancelled) window.location.replace(`${window.location.pathname}${window.location.search}#/j/${jid}`);
  }).catch((err) => {
    if (cancelled) return;
    message.textContent = errorText(err, 'Couldn’t join this Journal.');
    home.hidden = false;
  });
  return () => { cancelled = true; root.remove(); };
}

/* ---------- router ---------- */

function parseRoute() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'j' && parts[1]) return { name: 'journal', jid: parts[1] };
  if (parts[0] === 'join' && parts[1]) return { name: 'join', token: parts[1] };
  if (parts[0] === 'account') return { name: 'account' };
  return { name: 'home' };
}

function route() {
  if (!user) return;
  const token = ++routeToken;
  closeMenu();
  if (unmount) unmount();
  unmount = null;
  view.replaceChildren();
  window.scrollTo(0, 0);

  const r = parseRoute();
  tabs.forEach((t) => {
    const active = t.dataset.tab === (r.name === 'account' ? 'account' : 'home');
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (token !== routeToken) return;
  if (r.name === 'journal') unmount = mountJournal(view, { user, jid: r.jid });
  else if (r.name === 'join') unmount = mountJoin(view, { token: r.token });
  else if (r.name === 'account') unmount = mountAccount(view, { user });
  else unmount = mountHome(view, { me: user.uid });
}

window.addEventListener('hashchange', route);

/* ---------- boot ---------- */

let booted = false;
auth.onAuthStateChanged((u) => {
  if (!u) {
    // Remember where an invite link or Journal was meant to go, then sign in first.
    if (!signingOut) {
      try { sessionStorage.setItem('returnHash', window.location.hash); } catch (err) { /* ignore */ }
    }
    window.location.replace('login.html');
    return;
  }
  user = u;
  if (!booted) {
    booted = true;
    try {
      const saved = sessionStorage.getItem('returnHash');
      sessionStorage.removeItem('returnHash');
      if (saved && !window.location.hash) window.location.hash = saved;
    } catch (err) { /* ignore */ }
    $('app').hidden = false;
    route();
  }
});
