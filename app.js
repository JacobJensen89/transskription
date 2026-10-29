// Styrer siden: live-tekst med browserens talegenkendelse og at gemme
// resultatet som en .md-fil.

// Tælles op ved hver ny udgave sammen med CACHE i sw.js, så man kan se i
// bunden af siden, om browseren har hentet den nyeste.
const VERSION = 7;

// Browserens indbyggede talegenkendelse. Den er god til dansk, men lyden sendes
// til browserens leverandør. Derfor spørger appen, før den bruges første gang.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const PARAGRAPH_S = 60; // Nyt afsnit med tidsstempel cirka hvert minut.

const $ = (id) => document.getElementById(id);

let live = null;
let liveAccepted = false;
let gaps = []; // Tidsrum, hvor appen var i baggrunden.
let wakeLock = null;

// ---------- Live-tekst ----------

function liveService() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Apple';
  if (/Macintosh/.test(ua) && !/Chrome|Edg/.test(ua)) return 'Apple';
  if (/Edg\//.test(ua)) return 'Microsoft';
  return 'Google';
}

function toggleLive() {
  if (live) {
    stopLive();
    return;
  }
  if (!liveAccepted && !confirm(
    `Live-tekst sender lyden til ${liveService()}, som laver den om til tekst. `
    + 'Brug den kun, når det er i orden, at lyden forlader enheden. Fortsæt?',
  )) return;
  liveAccepted = true;
  gaps = [];
  $('live-warning').hidden = true;
  const state = { active: true, started: Date.now(), paragraphStart: null, gapStart: null, timer: null };
  state.elapsed = () => (Date.now() - state.started) / 1000;
  live = state;
  startRecognition(state);
  keepAwake(true);
  $('live').textContent = '■ Stop live-tekst';
  $('live').classList.add('recording');
  $('live-status').hidden = false;
  const tick = () => {
    if (live === state) $('live-status').textContent = 'Lytter … ' + clock(state.elapsed());
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

function startRecognition(state) {
  const rec = new SpeechRecognition();
  rec.lang = 'da-DK';
  rec.continuous = true;
  rec.interimResults = true;
  const startedAt = Date.now();
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addLiveText(state, r[0].transcript);
      else interim += r[0].transcript;
    }
    $('live-interim').hidden = !interim;
    $('live-interim').textContent = interim;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      state.fatal = 'Browseren har ikke lov til at bruge mikrofonen eller tale-tjenesten. '
        + 'På iPhone: slå Diktering til, eller åbn siden i Safari i stedet for appen.';
    } else if (e.error === 'language-not-supported') {
      state.fatal = 'Browseren kan ikke genkende dansk.';
    } else if (e.error === 'network') {
      $('live-status').textContent = 'Ingen forbindelse til tale-tjenesten. Prøver igen …';
    }
  };
  // Browseren stopper selv efter en pause eller nogle minutter. Så startes den igen.
  rec.onend = () => {
    $('live-interim').hidden = true;
    if (!state.active) return;
    if (state.fatal) {
      stopLive(state.fatal);
    } else if (document.hidden) {
      state.waiting = true;
    } else {
      // Hvis den stoppede med det samme, ventes lidt, så den ikke prøver i ring.
      setTimeout(() => state.active && startRecognition(state), Date.now() - startedAt < 2000 ? 2000 : 100);
    }
  };
  state.recognition = rec;
  try {
    rec.start();
  } catch (err) {
    stopLive('Live-tekst kunne ikke starte: ' + err.message);
  }
}

function addLiveText(state, transcript) {
  let t = transcript.trim();
  if (!t) return;
  t = t[0].toUpperCase() + t.slice(1);
  if (!/[.!?…]$/.test(t)) t += '.';
  const now = state.elapsed();
  const box = $('text');
  // Chrome på Android sender den samme sætning flere gange, efterhånden som den
  // vokser ("Skal", "Skal jeg", "Skal jeg synge"). Er den nye en forlængelse af
  // den forrige, erstattes den forrige. Er den en ældre, kortere udgave, droppes den.
  // Det sker kun, hvis ingen har rettet i teksten imens.
  const norm = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const last = state.last;
  if (last && box.value.length === last.end) {
    if (last.norm.startsWith(norm)) return;
    if (norm.startsWith(last.norm)) {
      box.value = box.value.slice(0, last.start) + t;
      state.last = { norm, start: last.start, end: box.value.length };
      box.scrollTop = box.scrollHeight;
      return;
    }
  }
  if (state.paragraphStart === null || now - state.paragraphStart >= PARAGRAPH_S) {
    state.paragraphStart = now;
    box.value += (box.value.trim() ? '\n\n' : '') + `[${clock(now)}] `;
  } else {
    box.value += ' ';
  }
  const start = box.value.length;
  box.value += t;
  state.last = { norm, start, end: box.value.length };
  box.scrollTop = box.scrollHeight;
  updateButtons();
}

function stopLive(message) {
  const state = live;
  if (!state) return;
  state.active = false;
  onVisibility(false);
  live = null;
  clearInterval(state.timer);
  // stop() i stedet for abort(), så den sidste sætning når at komme med.
  try { state.recognition?.stop(); } catch { /* allerede stoppet */ }
  keepAwake(false);
  $('live').textContent = '🎙 Start live-tekst';
  $('live').classList.remove('recording');
  $('live-status').textContent = message || `Stoppet efter ${clock(state.elapsed())}. Læs teksten igennem, før du gemmer.`;
}

// Telefoner slukker mikrofonen i baggrunden. Husk hvornår, og start igen bagefter.
function onVisibility(hidden) {
  const state = live;
  if (!state) return;
  if (hidden) {
    state.gapStart ??= state.elapsed();
  } else {
    keepAwake(true);
    if (state.gapStart !== null) {
      gaps.push([state.gapStart, state.elapsed()]);
      state.gapStart = null;
      showWarning();
    }
  }
  if (!hidden && state.waiting && state.active) {
    state.waiting = false;
    startRecognition(state);
  }
}

function showWarning() {
  const spans = gaps.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(', ');
  $('live-warning').hidden = false;
  $('live-warning').textContent =
    `Advarsel: appen var i baggrunden (${spans}). Der mangler tekst fra det tidsrum. `
    + 'Hold appen åben med skærmen tændt, mens der tales.';
}

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* ikke afgørende */ }
}

// ---------- Gem ----------

function buildMarkdown() {
  const title = $('title').value.trim() || 'Møde';
  const date = $('date').value || today();
  return [
    '---',
    `titel: "${title.replace(/["\\]/g, '\\$&')}"`,
    `dato: ${date}`,
    `kilde: live-tekst via browserens tale-tjeneste (${liveService()}), ikke gennemlæst af assistenten`,
    '---',
    '',
    `# ${title}`,
    '',
    `Dato: ${date}`,
    '',
    $('text').value.trim(),
    '',
  ].join('\n');
}

function slug(text) {
  return text.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'moede';
}

function saveMarkdown() {
  const date = $('date').value || today();
  const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${date}-${slug($('title').value)}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(buildMarkdown());
    $('copy').textContent = 'Kopieret ✓';
  } catch {
    $('copy').textContent = 'Kunne ikke kopiere';
  }
  setTimeout(() => ($('copy').textContent = 'Kopiér tekst'), 2000);
}

// ---------- Hjælpere ----------

function updateButtons() {
  const hasText = $('text').value.trim().length > 0;
  $('save-md').disabled = !hasText;
  $('copy').disabled = !hasText;
}

function clock(seconds) {
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Tidligere udgaver hentede en sprogmodel på 250–450 MB. Den bruges ikke
// længere, så den slettes for at frigøre plads.
async function removeOldModel() {
  try {
    await Promise.all(['transformers-cache', 'experimental_transformers-hash-cache'].map((k) => caches.delete(k)));
  } catch { /* intet at slette */ }
}

// ---------- Start ----------

$('date').value = today();
$('version').textContent = `Version ${VERSION}`;
$('live').onclick = toggleLive;
$('save-md').onclick = saveMarkdown;
$('copy').onclick = copyText;
$('text').oninput = updateButtons;
document.addEventListener('visibilitychange', () => onVisibility(document.hidden));
window.addEventListener('beforeunload', (e) => {
  if (live || $('text').value.trim()) e.preventDefault();
});

if (!SpeechRecognition) {
  $('live').hidden = true;
  $('live-intro').textContent = 'Live-tekst virker ikke i denne browser. Brug Edge, Chrome eller Safari.';
}
updateButtons();
removeOldModel();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
