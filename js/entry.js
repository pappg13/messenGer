import {
  BAR_COUNT, EMOJIS, el, icon, toast, makeAvatar, formatClock, formatTime, placeholderPeaks,
  showMenu, closeMenu, menuItem, callable,
} from './util.js';

const SPEEDS = [1, 1.5, 2];
const STEPS = ['Uploaded', 'Converting', 'Summarising'];
const STALE_UPLOAD_MS = 10 * 60 * 1000;
const URL_TTL_MS = 30 * 60 * 1000;
const LISTEN_AFTER_SECONDS = 3;
const MAX_HEARD_AVATARS = 5;

const getAudioUrl = callable('getAudioUrl');
let nowPlaying = null;

export function stopPlayback() {
  if (nowPlaying && nowPlaying.audio) nowPlaying.audio.pause();
}

/*
 * One voice message. `ctx` supplies the journal it belongs to:
 *   { jid, me, messagesRef, listensRef, reactionsRef, memberName(uid, fallback), uploadProgress }
 */
export class Entry {
  constructor(ctx, id, data) {
    this.ctx = ctx;
    this.id = id;
    this.data = data;
    this.audio = null;
    this.rate = 1;
    this.seekOnLoad = null;
    this.urlPromise = null;
    this.urlFetchedAt = 0;
    this.listens = {};
    this.reactions = {};
    this.listenSent = false;
    this.build();
    this.update(data);
  }

  get isMine() { return this.data.authorId === this.ctx.me; }

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

    this.moreBtn = el('button', 'icon-btn');
    this.moreBtn.setAttribute('aria-label', 'Message options');
    this.moreBtn.setAttribute('aria-haspopup', 'true');
    this.moreBtn.appendChild(icon('more'));
    this.moreBtn.addEventListener('click', () => this.openOptions(this.moreBtn));
    this.head.append(this.avatarSlot, who, this.moreBtn);

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
    this.buildFoot();
    li.append(this.head, this.text, this.player, this.foot);
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

  buildFoot() {
    this.foot = el('div', 'entry-foot');
    this.reactionsBox = el('div', 'reactions');
    this.heardBox = el('div', 'heard');
    this.foot.append(this.reactionsBox, this.heardBox);
  }

  /* data -> DOM; never touches this.audio so playback survives updates */
  update(data) {
    this.data = data;
    const uid = data.authorId || '';
    const name = this.ctx.memberName(uid, data.authorName);
    if (this.avatarKey !== uid + name) {
      this.avatarKey = uid + name;
      this.avatarSlot.replaceWith(this.avatarSlot = makeAvatar(uid || name, name));
    }
    this.name.textContent = name;
    this.city.textContent = data.location || '';
    this.time.textContent = data.createdAt ? formatTime(data.createdAt) : '';
    this.moreBtn.hidden = !this.isMine;

    const status = this.effectiveStatus();
    const inFlight = ['uploading', 'converting', 'transcribing'].includes(status);
    this.pending.hidden = !inFlight;
    if (inFlight) this.renderPending(status);

    this.summary.textContent = data.summary || '';
    this.summary.hidden = !data.summary;

    let note = '';
    if (status === 'error') note = 'Couldn’t process this message.';
    else if (status === 'stale') note = 'This upload didn’t finish.';
    else if (status === 'ready' && data.transcript === '') note = 'No speech detected.';
    this.note.textContent = note;
    this.note.hidden = !note;

    const hasTranscript = Boolean(data.transcript);
    this.toggle.hidden = !hasTranscript;
    this.transcript.textContent = data.transcript || '';
    if (!hasTranscript) this.transcript.hidden = true;

    const playable = Boolean(data.audioPath);
    this.player.hidden = !playable;
    this.foot.hidden = !playable;
    if (playable) this.renderPlayerStatic();
    this.renderFoot();
  }

  effectiveStatus() {
    const { status, createdAt } = this.data;
    if (!status) return 'ready';
    const local = this.ctx.uploadProgress.has(this.id);
    if (status === 'uploading' && !local && createdAt && Date.now() - createdAt > STALE_UPLOAD_MS) return 'stale';
    return status;
  }

  renderPending(status) {
    const active = { uploading: 0, converting: 1, transcribing: 2 }[status];
    this.stepNodes.forEach((node, i) => {
      node.className = `step${i < active || (i === 0 && status !== 'uploading') ? ' done' : ''}${i === active ? ' active' : ''}`;
    });
    this.setProgress(this.ctx.uploadProgress.get(this.id));
  }

  setProgress(fraction) {
    const status = this.effectiveStatus();
    let width = 0;
    if (status === 'uploading') width = (fraction || 0) / 3;
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

  /* ---- reactions + listens ---- */

  setListens(map) { this.listens = map || {}; this.renderFoot(); }
  setReactions(map) { this.reactions = map || {}; this.renderFoot(); }

  renderFoot() {
    const counts = new Map();
    Object.values(this.reactions).forEach((emoji) => counts.set(emoji, (counts.get(emoji) || 0) + 1));
    const mine = this.reactions[this.ctx.me];

    this.reactionsBox.replaceChildren();
    EMOJIS.filter((emoji) => counts.has(emoji)).forEach((emoji) => {
      const chip = el('button', `chip${mine === emoji ? ' mine' : ''}`);
      chip.append(el('span', null, emoji), el('span', 'chip-count', String(counts.get(emoji))));
      chip.setAttribute('aria-pressed', String(mine === emoji));
      chip.addEventListener('click', () => this.react(emoji));
      this.reactionsBox.appendChild(chip);
    });
    const add = el('button', 'chip add');
    add.setAttribute('aria-label', 'Add reaction');
    add.setAttribute('aria-haspopup', 'true');
    add.appendChild(icon('smile'));
    add.addEventListener('click', () => {
      showMenu(add, (menu) => {
        menu.classList.add('emoji-menu');
        EMOJIS.forEach((emoji) => {
          const b = menuItem(emoji, () => { closeMenu(); this.react(emoji); });
          b.setAttribute('aria-label', `React ${emoji}`);
          if (mine === emoji) b.classList.add('selected');
          menu.appendChild(b);
        });
      });
    });
    this.reactionsBox.appendChild(add);

    const listeners = Object.keys(this.listens).filter((uid) => uid !== this.data.authorId);
    this.heardBox.replaceChildren();
    this.heardBox.hidden = listeners.length === 0;
    if (listeners.length) {
      this.heardBox.appendChild(el('span', 'heard-label', 'Heard by'));
      const stack = el('span', 'heard-stack');
      listeners.slice(0, MAX_HEARD_AVATARS).forEach((uid) => {
        const name = this.ctx.memberName(uid);
        const avatar = makeAvatar(uid, name, 'tiny');
        avatar.title = name;
        stack.appendChild(avatar);
      });
      if (listeners.length > MAX_HEARD_AVATARS) {
        stack.appendChild(el('span', 'heard-more', `+${listeners.length - MAX_HEARD_AVATARS}`));
      }
      this.heardBox.appendChild(stack);
    }
  }

  async react(emoji) {
    const ref = this.ctx.reactionsRef.child(this.id).child(this.ctx.me);
    try {
      if (this.reactions[this.ctx.me] === emoji) await ref.remove();
      else await ref.set(emoji);
    } catch (err) {
      toast('Couldn’t save your reaction.');
    }
  }

  maybeRecordListen() {
    if (this.isMine || this.listenSent || this.listens[this.ctx.me] || !this.audio) return;
    const { currentTime, duration, ended } = this.audio;
    const enough = ended || currentTime >= Math.min(LISTEN_AFTER_SECONDS, (duration || Infinity) / 2);
    if (!enough) return;
    this.listenSent = true;
    this.ctx.listensRef.child(this.id).child(this.ctx.me)
        .set(firebase.database.ServerValue.TIMESTAMP)
        .catch(() => { this.listenSent = false; });
  }

  /* ---- playback ---- */

  currentTime() { return this.audio ? this.audio.currentTime : 0; }

  totalTime() {
    const d = this.audio && Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    return d || this.data.duration || 0;
  }

  async ensureAudio() {
    if (this.audio) return this.audio;
    if (!this.urlPromise || Date.now() - this.urlFetchedAt > URL_TTL_MS) {
      this.urlFetchedAt = Date.now();
      this.urlPromise = getAudioUrl({ jid: this.ctx.jid, mid: this.id }).then((r) => r.url);
    }
    let url;
    try {
      url = await this.urlPromise;
    } catch (err) {
      this.urlPromise = null;
      throw err;
    }
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = url;
    audio.playbackRate = this.rate;
    audio.addEventListener('timeupdate', () => { this.renderProgress(); this.maybeRecordListen(); });
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
      this.maybeRecordListen();
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

  /* ---- options + delete (own messages only) ---- */

  openOptions(anchor) {
    showMenu(anchor, (menu) => {
      menu.appendChild(menuItem('Delete…', () => {
        menu.replaceChildren();
        menu.appendChild(el('div', 'menu-note', 'Delete this message? This can’t be undone.'));
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
    try {
      await this.ctx.messagesRef.child(this.id).child('deletedAt')
          .set(firebase.database.ServerValue.TIMESTAMP);
    } catch (err) {
      toast('Couldn’t delete the message.');
    }
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
