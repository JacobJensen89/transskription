// Dansk tale til tekst med browserens talegenkendelse. Noter gemmes i browseren på enheden.

// Tælles op ved hver ny udgave sammen med CACHE i sw.js, så man kan se, om den nyeste er hentet.
const VERSION = 20;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// Skjult test: ?kort lader genkendelsen lukke efter hver sætning i stedet for at køre i ét stræk.
const SHORT = new URLSearchParams(location.search).has('kort');

const RESTART_MS = 150;     // Pause før genstart, når browseren har lukket genkendelsen.
const PAUSE_MS = 1500;      // Uafsluttet tekst gemmes efter så lang pause.
const SNAPSHOT_MS = 10000;  // ... og med dette mellemrum under sammenhængende tale.
const WATCHDOG_MS = 3000;   // Vagten tjekker så ofte, om genkendelsen stadig kører.
const STALL_MS = 40000;     // Ingen livstegn så længe: start forfra.

const $ = (id) => document.getElementById(id);

// ---------- Noter ----------

const NOTES_KEY = 'noter';
const ACTIVE_KEY = 'aktiv-note';
let notes = [];
let activeId = null;
let saveTimer = null;
let storageFailed = false;

try {
  const stored = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
  if (Array.isArray(stored)) notes = stored.filter((n) => n && typeof n.id === 'string');
  activeId = localStorage.getItem(ACTIVE_KEY);
} catch { /* ingen gemte noter */ }

function newNote() {
  const now = Date.now();
  const note = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text: '', created: now, updated: now };
  notes.push(note);
  return note;
}

// Tidligere udgaver gemte ét udkast og en række indstillinger. Udkastet bliver til en note.
function migrateOldVersion() {
  try {
    const raw = localStorage.getItem('transskription-udkast');
    if (raw && !notes.length) {
      const d = JSON.parse(raw);
      const text = [d.title, d.text].filter((s) => s && s.trim()).join('\n\n');
      if (text) {
        const note = newNote();
        note.text = text;
        note.created = note.updated = d.saved || Date.now();
        activeId = note.id;
      }
    }
    ['transskription-udkast', 'transskription-indstillinger', 'transskription-log', 'transskription-opstart']
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* intet at flytte */ }
}

function current() {
  let note = notes.find((n) => n.id === activeId);
  if (!note) {
    note = notes[notes.length - 1] || newNote();
    activeId = note.id;
  }
  return note;
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    localStorage.setItem(ACTIVE_KEY, activeId || '');
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function titleOf(note, max = 40) {
  const line = (note.text.split('\n').find((l) => l.trim()) || '').trim();
  if (!line) return 'Ny note';
  return line.length > max ? line.slice(0, max).trimEnd() + '…' : line;
}

function countWords(text) {
  return (text.match(/\S+/g) || []).length;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderTitle() {
  $('title').textContent = titleOf(current());
  document.title = 'Transskription';
}

function renderList() {
  $('list').replaceChildren(...[...notes].sort((a, b) => b.updated - a.updated).map((n) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    if (n.id === activeId) btn.className = 'active';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = titleOf(n);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${formatDate(n.updated)} · ${countWords(n.text)} ord`;
    btn.append(name, meta);
    btn.onclick = () => openNote(n.id);
    li.append(btn);
    return li;
  }));
}

function showNote() {
  const note = current();
  $('text').value = note.text;
  renderTitle();
  renderInfo();
}

function openNote(id) {
  flushPending();
  saveNow();
  activeId = id;
  rs.last = null;
  saveNow();
  showNote();
  closePanel();
}

function createNote() {
  // En tom note bruges igen i stedet for at samle tomme noter.
  const note = current();
  if (!note.text.trim()) {
    closePanel();
    $('text').focus();
    return;
  }
  flushPending();
  const fresh = newNote();
  activeId = fresh.id;
  rs.last = null;
  saveNow();
  showNote();
  closePanel();
}

function deleteNote() {
  const note = current();
  if (note.text.trim() && !confirm('Slet denne note?')) return;
  flushPending();
  notes = notes.filter((n) => n.id !== note.id);
  activeId = notes.length ? [...notes].sort((a, b) => b.updated - a.updated)[0].id : null;
  rs.last = null;
  current();
  saveNow();
  showNote();
}

function openPanel() {
  renderList();
  $('panel').hidden = false;
}

function closePanel() {
  $('panel').hidden = true;
}

// Alt, der ændrer teksten, går gennem denne: gem og opdatér tæller og titel.
function textChanged() {
  const note = current();
  note.text = $('text').value;
  note.updated = Date.now();
  renderTitle();
  renderInfo();
  scheduleSave();
}

// ---------- Tekstbehandling ----------

const WORD_EDGE = (word) => `(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`;
const COMMANDS = [
  ['spørgsmålstegn', '?'], ['udråbstegn', '!'], ['semikolon', ';'], ['kolon', ':'],
  ['punktum', '.'], ['komma', ','], ['nyt\\s+afsnit', '\n\n'], ['(?:ny\\s+linje|linjeskift)', '\n'],
].map(([word, symbol]) => [new RegExp(WORD_EDGE(word), 'giu'), symbol]);

// Stemmekommandoer: ordet erstattes af tegnet, og mellemrum før tegnsætning fjernes.
function applyCommands(text) {
  for (const [re, symbol] of COMMANDS) text = text.replace(re, `\u0001${symbol}\u0001`);
  return text
    .replace(/\s*\u0001(\n+)\u0001\s*/g, '$1')
    .replace(/\s*\u0001([.,:;!?])\u0001\s*/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+$/, '')
    .replace(/^[ \t]+/, '');
}

// Stort begyndelsesbogstav efter punktum, spørgsmålstegn, udråbstegn og ny linje.
function capitalizeInner(text) {
  return text.replace(/([.!?]\s+|\n)(\p{L})/gu, (m, before, letter) => before + letter.toUpperCase());
}

function formatSegment(raw) {
  const t = applyCommands(raw.trim());
  return t ? capitalizeInner(t) : '';
}

// Google retter nogle gange en sætning, efter den er sendt, fx ved at tilføje et ord. Så er den
// nye ikke en ren forlængelse, men de to har næsten alle ord til fælles i samme rækkefølge.
// Sætninger under fire ord sammenlignes ikke, så korte svar ikke slås sammen.
function mostlySame(a, b) {
  const x = a.split(' ');
  const y = b.split(' ');
  if (Math.min(x.length, y.length) < 4) return false;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = [0];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[y.length] / Math.min(x.length, y.length) >= 0.75;
}

// Sætter en sætning ind i noten: ved markøren, hvis feltet er i fokus, ellers til sidst. Vokser
// en sætning (Chrome på Android sender den flere gange), erstatter den nye udgave den forrige.
function commit(raw) {
  const t = formatSegment(raw);
  if (!t) return;
  const box = $('text');
  const norm = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const last = rs.last && rs.last.sess === rs.sess && rs.last.noteId === activeId ? rs.last : null;
  const value = box.value;
  const atCaret = document.activeElement === box;

  if (last && norm && value.slice(last.start, last.end) === last.text) {
    if (last.norm.startsWith(norm)) return;
    const similar = mostlySame(last.norm, norm);
    if (similar && norm.length < last.norm.length) return; // behold den længste udgave
    if (norm.startsWith(last.norm) || similar) {
      const caret = box.selectionEnd;
      // Den erstattende udgave får samme store eller små begyndelsesbogstav som den, den afløser.
      const ins = last.cap ? t.replace(/^\p{L}/u, (c) => c.toUpperCase()) : t;
      box.value = value.slice(0, last.start) + ins + value.slice(last.end);
      rs.last = { ...last, text: ins, norm, end: last.start + ins.length };
      if (atCaret) {
        const moved = caret >= last.end ? caret + ins.length - last.text.length : caret;
        box.setSelectionRange(moved, moved);
      } else {
        box.scrollTop = box.scrollHeight;
      }
      textChanged();
      return;
    }
  }

  const pos = atCaret ? box.selectionEnd : value.length;
  let before = value.slice(0, pos);
  let sep = '';
  if (/^[.,:;!?]/.test(t) || /^\n/.test(t)) before = before.replace(/[ \t]+$/, '');
  else if (before && !/\s$/.test(before)) sep = ' ';
  const prev = (before + sep).replace(/[ \t]+$/, '');
  const needsCapital = prev === '' || /[.!?]$/.test(prev) || /\n$/.test(prev);
  const ins = needsCapital ? t.replace(/^\p{L}/u, (c) => c.toUpperCase()) : t;
  const head = before + sep + ins;
  box.value = head + value.slice(pos);
  rs.last = { start: (before + sep).length, end: head.length, text: ins, norm, cap: needsCapital, sess: rs.sess, noteId: activeId };
  if (atCaret) box.setSelectionRange(head.length, head.length);
  else box.scrollTop = box.scrollHeight;
  textChanged();
}

// ---------- Optagelse ----------

const rs = {
  on: false, startedAt: 0, rec: null, running: false, sess: null, attemptAt: 0, restartTimer: null,
  failStreak: 0, waiting: false, fatal: null, status: 'Stoppet',
  pending: '', pendingCommitted: '', flushTimer: null, snapshotAt: 0, last: null,
  clockTimer: null, watchdog: null,
};

const STATUS_MARK = { Lytter: '●', Genforbinder: '◌', Stoppet: '■' };

function setStatus(status, extra = '') {
  rs.status = status;
  rs.extra = extra;
  renderInfo();
}

function clockText(ms) {
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function renderInfo() {
  const words = countWords($('text').value);
  const parts = [`${STATUS_MARK[rs.status]} ${rs.status}`];
  if (rs.on) parts.push(clockText(Date.now() - rs.startedAt));
  parts.push(`${words.toLocaleString('da-DK')} ord`);
  if (rs.extra) parts.push(rs.extra);
  if (storageFailed) parts.push('! kan ikke gemme');
  $('info').textContent = parts.join(' · ');
}

// Det uafsluttede gemmes, så det ikke går tabt. Vokser sætningen, erstatter den nye udgave den gemte.
function flushPending() {
  clearTimeout(rs.flushTimer);
  const text = rs.pending;
  if (!text || text === rs.pendingCommitted) return;
  rs.pendingCommitted = text;
  rs.snapshotAt = Date.now();
  commit(text);
}

function startSession() {
  clearTimeout(rs.restartTimer);
  rs.restartTimer = null;
  const rec = new SpeechRecognition();
  rec.lang = 'da-DK';
  rec.continuous = !SHORT;
  rec.interimResults = true;
  const sess = { startedAt: Date.now(), lastEvent: Date.now(), heard: 0 };
  rs.sess = sess;
  rs.rec = rec;
  rs.running = false;
  rs.attemptAt = Date.now();
  const alive = () => { sess.lastEvent = Date.now(); };

  rec.onstart = () => {
    if (rs.rec !== rec) return;
    rs.running = true;
    alive();
    if (rs.on) setStatus('Lytter');
  };
  rec.onaudiostart = () => { if (rs.rec === rec) alive(); };
  rec.onsoundstart = () => { if (rs.rec === rec) { sess.heard++; alive(); } };
  rec.onspeechstart = () => { if (rs.rec === rec) { sess.heard++; alive(); } };

  rec.onresult = (e) => {
    if (rs.rec !== rec) return;
    sess.heard++;
    alive();
    rs.failStreak = 0;
    if (rs.status !== 'Lytter') setStatus('Lytter');
    let interim = '';
    let sawFinal = false;
    // Kun fra resultIndex: de tidligere er allerede indsat.
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        commit(r[0].transcript);
        sawFinal = true;
      } else {
        interim += r[0].transcript;
      }
    }
    if (sawFinal) rs.pendingCommitted = '';
    rs.pending = interim.trim();
    clearTimeout(rs.flushTimer);
    if (rs.pending) rs.flushTimer = setTimeout(flushPending, PAUSE_MS);
    $('interim').textContent = interim ? '… ' + interim.trim() : '';
  };

  rec.onerror = (e) => {
    if (rs.rec !== rec) return;
    alive();
    // «no-speech» og «aborted» er normale. Genstarten sker i onend.
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      rs.fatal = 'Mikrofonen er ikke tilladt. Tillad den i browseren.';
    } else if (e.error === 'language-not-supported') {
      rs.fatal = 'Browseren kan ikke genkende dansk.';
    } else if (e.error === 'network' && rs.on) {
      setStatus('Genforbinder');
    }
  };

  rec.onend = () => {
    if (rs.rec !== rec) return;
    rs.running = false;
    $('interim').textContent = '';
    flushPending();
    rs.pending = '';
    rs.pendingCommitted = '';
    if (!rs.on) return;
    if (rs.fatal) {
      const msg = rs.fatal;
      rs.fatal = null;
      stop(msg);
      return;
    }
    const quick = Date.now() - sess.startedAt < 1000 && sess.heard === 0;
    rs.failStreak = quick ? rs.failStreak + 1 : 0;
    if (document.hidden && MOBILE) {
      // En telefon slukker mikrofonen i baggrunden. Genstart, når appen er synlig igen.
      rs.waiting = true;
      setStatus('Genforbinder');
      return;
    }
    if (rs.failStreak >= 2) setStatus('Genforbinder');
    const delay = quick ? Math.min(1000 * rs.failStreak, 5000) : RESTART_MS;
    rs.restartTimer = setTimeout(() => { rs.restartTimer = null; if (rs.on) startSession(); }, delay);
  };

  try {
    rec.start();
  } catch {
    // Ikke klar endnu: vagten prøver igen.
  }
}

function restartNow() {
  const old = rs.rec;
  flushPending();
  rs.pending = '';
  rs.pendingCommitted = '';
  startSession();
  try { old?.abort(); } catch { /* allerede lukket */ }
}

// Vagten: har genkendelsen mistet sin slutning eller hænger den, startes den forfra.
function watchdogTick() {
  if (!rs.on || rs.waiting) return;
  const now = Date.now();
  if (!rs.running && !rs.restartTimer && now - rs.attemptAt > 4000) {
    restartNow();
  } else if (rs.running && now - rs.sess.lastEvent > STALL_MS) {
    restartNow();
  }
}

function start() {
  if (!SpeechRecognition || rs.on) return;
  rs.on = true;
  rs.startedAt = Date.now();
  rs.failStreak = 0;
  rs.waiting = false;
  rs.fatal = null;
  rs.snapshotAt = Date.now();
  $('mic').textContent = '■ STOP';
  $('mic').classList.add('on');
  setStatus('Lytter');
  keepAwake(true);
  clearInterval(rs.clockTimer);
  rs.clockTimer = setInterval(() => {
    renderInfo();
    if (rs.pending && Date.now() - rs.snapshotAt >= SNAPSHOT_MS) flushPending();
  }, 1000);
  clearInterval(rs.watchdog);
  rs.watchdog = setInterval(watchdogTick, WATCHDOG_MS);
  startSession();
}

function stop(reason = '') {
  if (!rs.on) return;
  flushPending();
  rs.on = false;
  clearInterval(rs.clockTimer);
  clearInterval(rs.watchdog);
  clearTimeout(rs.restartTimer);
  rs.restartTimer = null;
  const rec = rs.rec;
  rs.rec = null;
  try { rec?.stop(); } catch { /* allerede lukket */ }
  rs.pending = '';
  rs.pendingCommitted = '';
  $('interim').textContent = '';
  $('mic').textContent = '● START';
  $('mic').classList.remove('on');
  keepAwake(false);
  saveNow();
  setStatus('Stoppet', reason ? '! ' + reason : '');
}

function toggle() {
  if (rs.on) stop();
  else start();
}

// Beder telefonen holde skærmen tændt. wantAwake sikrer, at en forespørgsel, der først besvares
// efter «stop», bliver frigivet i stedet for at holde skærmen tændt.
let wakeLock = null;
let wantAwake = false;

async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on) {
      if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
      const lock = await navigator.wakeLock.request('screen');
      if (!wantAwake) {
        await lock.release();
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch { /* ikke afgørende */ }
}

// ---------- Kopiér og download ----------

function slug(text) {
  return text.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'note';
}

function ymd(ts) {
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function buildMarkdown(note) {
  const title = titleOf(note, 60).replace(/…$/, '');
  return [
    '---',
    `titel: "${title.replace(/["\\]/g, '\\$&')}"`,
    `dato: ${ymd(note.created)}`,
    'kilde: live-tekst via browserens tale-tjeneste, ikke gennemlæst',
    '---',
    '',
    `# ${title}`,
    '',
    note.text.trim(),
    '',
  ].join('\n');
}

function download() {
  flushPending();
  const note = current();
  if (!note.text.trim()) return;
  const blob = new Blob([buildMarkdown(note)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${ymd(note.created)}-${slug(titleOf(note, 60))}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function copyAll() {
  flushPending();
  const text = current().text;
  if (!text.trim()) return;
  let label;
  try {
    await navigator.clipboard.writeText(text);
    label = 'Kopieret ✓';
  } catch {
    label = 'Kunne ikke kopiere';
  }
  $('copy').textContent = label;
  setTimeout(() => ($('copy').textContent = 'Kopiér alt'), 1800);
}

// ---------- Start ----------

migrateOldVersion();
current();
saveNow();
$('version').textContent = `v${VERSION}`;
showNote();

$('mic').onclick = toggle;
$('copy').onclick = copyAll;
$('download').onclick = download;
$('delete').onclick = deleteNote;
$('new').onclick = createNote;
$('panel-new').onclick = createNote;
$('open-list').onclick = openPanel;
$('panel-close').onclick = closePanel;
$('text').addEventListener('input', textChanged);

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault();
    toggle();
  } else if (e.key === 'Escape' && !$('panel').hidden) {
    closePanel();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushPending();
    saveNow();
    return;
  }
  if (!rs.on) return;
  keepAwake(true);
  if (rs.waiting) {
    rs.waiting = false;
    startSession();
  }
});
window.addEventListener('pagehide', () => { flushPending(); saveNow(); });

if (!SpeechRecognition) {
  $('mic').disabled = true;
  $('mic').textContent = 'IKKE MULIGT';
  $('info').textContent = '! Browseren kan ikke genkende tale. Brug Chrome eller Edge.';
}

// Tidligere udgaver hentede en sprogmodel. Den bruges ikke længere og slettes.
if ('caches' in window) {
  ['transformers-cache', 'experimental_transformers-hash-cache'].forEach((k) => caches.delete(k).catch(() => {}));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
