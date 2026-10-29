// Styrer siden: live-tekst med browserens talegenkendelse, stemmekommandoer,
// egne ord, markeringer og at gemme resultatet som en .md-fil.

// Tælles op ved hver ny udgave sammen med CACHE i sw.js, så man kan se i
// bunden af siden, om browseren har hentet den nyeste.
const VERSION = 12;

// Browserens indbyggede talegenkendelse. Den er god til dansk, men lyden sendes
// til browserens leverandør. Derfor spørger appen, før den bruges første gang.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const PARAGRAPH_S = 60; // Nyt afsnit med tidsstempel cirka hvert minut.

const $ = (id) => document.getElementById(id);

let live = null;
let liveAccepted = false;
let gaps = []; // Tidsrum, hvor appen var i baggrunden.
let wakeLock = null;

// ---------- Indstillinger ----------

const SETTINGS_KEY = 'transskription-indstillinger';
const DEFAULT_SETTINGS = {
  commands: true, capitals: true, period: true, longest: false,
  fontSize: 17, theme: 'terminal', crt: true, boot: true, rain: true, words: '',
};
let settings = { ...DEFAULT_SETTINGS };
try {
  const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  // Version 11 havde Matrix som standard og gemte det sammen med andre indstillinger.
  // Det er ikke et aktivt valg, så det skifter til det nye standardudseende.
  if (stored.v !== 2 && stored.theme === 'matrix') delete stored.theme;
  Object.assign(settings, stored);
} catch { /* standardindstillinger */ }
settings.v = 2;

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ikke afgørende */ }
}

function applySettings() {
  $('opt-commands').checked = settings.commands;
  $('opt-capitals').checked = settings.capitals;
  $('opt-period').checked = settings.period;
  $('opt-longest').checked = settings.longest;
  $('opt-font').value = settings.fontSize;
  $('opt-theme').value = settings.theme;
  $('opt-rain').checked = settings.rain;
  $('opt-crt').checked = settings.crt;
  $('opt-boot').checked = settings.boot;
  $('opt-words').value = settings.words;
  $('font-label').textContent = settings.fontSize + ' px';
  $('text').style.fontSize = settings.fontSize + 'px';
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.crt = settings.crt ? 'on' : 'off';
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', ['terminal', 'matrix', 'dark'].includes(settings.theme) ? '#000000' : '#1f5f8b');
  wordRules = null;
  updateRain();
}

// ---------- Opstartsskærm ----------

const BOOT_KEY = 'transskription-opstart';
const BOOT_PAUSE_MS = 30 * 60 * 1000; // Vises højst hvert halve time.

// Kort tekst som i en film. Den dækker skærmen, men tryk går igennem til siden
// bagved, og den forsvinder af sig selv efter cirka halvandet sekund.
function runBoot() {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (settings.theme !== 'terminal' || !settings.boot || calm) return;
  try {
    if (Date.now() - Number(localStorage.getItem(BOOT_KEY) || 0) < BOOT_PAUSE_MS) return;
    localStorage.setItem(BOOT_KEY, String(Date.now()));
  } catch { /* vis den bare */ }
  const lines = [
    `TRANSSKRIPTION OS v${VERSION}.0`,
    '> mount /dev/mic .............. OK',
    '> load tale-modul (da-DK) ..... OK',
    `> tale-tjeneste: ${liveService()} ....... STANDBY`,
    '> klar_',
  ];
  const boot = $('boot');
  const log = $('boot-log');
  boot.hidden = false;
  boot.classList.remove('done');
  lines.forEach((line, i) => setTimeout(() => { log.textContent += line + '\n'; }, 150 * (i + 1)));
  setTimeout(() => boot.classList.add('done'), 1300);
  setTimeout(() => { boot.hidden = true; log.textContent = ''; }, 1700);
}

// ---------- Matrix-regn ----------

// Tegnene falder i baggrunden bag kortene. Den står stille, mens der lyttes, når
// siden er skjult, eller hvis telefonen er sat til færre animationer.
const RAIN_CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
const RAIN_SIZE = 16;
const rain = { timer: null, drops: [], ctx: $('rain').getContext('2d') };

function resizeRain() {
  const canvas = $('rain');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  rain.drops = Array.from({ length: Math.ceil(canvas.width / RAIN_SIZE) }, () => Math.random() * -50);
  rain.ctx.fillStyle = '#000';
  rain.ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawRain() {
  const { ctx } = rain;
  const { width, height } = $('rain');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#00ff41';
  ctx.font = `${RAIN_SIZE}px monospace`;
  rain.drops.forEach((y, i) => {
    ctx.fillText(RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)], i * RAIN_SIZE, y * RAIN_SIZE);
    rain.drops[i] = y * RAIN_SIZE > height && Math.random() > 0.975 ? 0 : y + 1;
  });
}

function updateRain() {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const want = settings.theme === 'matrix' && settings.rain && !live && !document.hidden && !calm;
  if (want && !rain.timer) {
    if (!rain.drops.length) resizeRain();
    rain.timer = setInterval(drawRain, 90);
  } else if (!want && rain.timer) {
    clearInterval(rain.timer);
    rain.timer = null;
  }
}

function bindSettings() {
  const checks = { 'opt-commands': 'commands', 'opt-capitals': 'capitals', 'opt-period': 'period', 'opt-longest': 'longest' };
  for (const [id, key] of Object.entries(checks)) {
    $(id).onchange = () => { settings[key] = $(id).checked; saveSettings(); };
  }
  $('opt-font').oninput = () => { settings.fontSize = Number($('opt-font').value); saveSettings(); applySettings(); };
  $('opt-theme').onchange = () => { settings.theme = $('opt-theme').value; saveSettings(); applySettings(); };
  $('opt-rain').onchange = () => { settings.rain = $('opt-rain').checked; saveSettings(); updateRain(); };
  $('opt-crt').onchange = () => { settings.crt = $('opt-crt').checked; saveSettings(); applySettings(); };
  $('opt-boot').onchange = () => { settings.boot = $('opt-boot').checked; saveSettings(); };
  $('opt-words').oninput = () => { settings.words = $('opt-words').value; wordRules = null; saveSettings(); };
  $('fix-words').onclick = fixWordsInText;
}

// ---------- Tekstbehandling ----------

const WORD_EDGE = (word) => `(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let wordRules = null;

// «forkert = rigtigt», ét par pr. linje.
function getWordRules() {
  if (wordRules) return wordRules;
  wordRules = [];
  for (const line of settings.words.split('\n')) {
    const parts = line.split(/\s*(?:=|→|->)\s*/);
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) continue;
    const from = escapeRegExp(parts[0].trim()).replace(/\s+/g, '\\s+');
    wordRules.push([new RegExp(WORD_EDGE(from), 'giu'), parts[1].trim()]);
  }
  return wordRules;
}

function applyWords(text) {
  let count = 0;
  for (const [re, to] of getWordRules()) {
    text = text.replace(re, () => { count++; return to; });
  }
  return { text, count };
}

function fixWordsInText() {
  const { text, count } = applyWords($('text').value);
  $('text').value = text;
  $('fix-result').hidden = false;
  $('fix-result').textContent = getWordRules().length
    ? `${count} ord rettet.`
    : 'Skriv først mindst ét par, fx «øjen = Jørgen».';
  updateButtons();
}

// Stemmekommandoer. Ordene erstattes af tegnet, og mellemrum rettes til.
const COMMANDS = [
  ['spørgsmålstegn', '?'], ['udråbstegn', '!'], ['semikolon', ';'], ['kolon', ':'],
  ['punktum', '.'], ['komma', ','], ['nyt\\s+afsnit', '\n\n'], ['ny\\s+linje', '\n'],
].map(([word, symbol]) => [new RegExp(WORD_EDGE(word), 'giu'), symbol]);

function applyCommands(text) {
  for (const [re, symbol] of COMMANDS) text = text.replace(re, `\u0001${symbol}\u0001`);
  return text
    .replace(/\s*\u0001(\n+)\u0001\s*/g, '$1')
    .replace(/\s*\u0001([.,:;!?])\u0001\s*/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+$/, '');
}

function capitalize(text) {
  return text.replace(/(^|[.!?]\s+|\n)(\p{L})/gu, (m, before, letter) => before + letter.toUpperCase());
}

function formatSegment(raw) {
  let t = applyWords(raw.trim()).text;
  if (settings.commands) t = applyCommands(t);
  t = t.replace(/^[ \t]+/, '');
  if (!t) return '';
  if (settings.capitals) t = capitalize(t);
  if (settings.period && !/[.!?…:;,\n]$/.test(t)) t += '.';
  return t;
}

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
  const state = { active: true, started: Date.now(), lastSpeech: Date.now(), paragraphStart: null, gapStart: null, timer: null };
  state.elapsed = () => (Date.now() - state.started) / 1000;
  live = state;
  updateRain();
  startRecognition(state);
  keepAwake(true);
  $('live').textContent = '■ Stop live-tekst';
  $('live').classList.add('recording');
  $('live-status').hidden = false;
  const tick = () => {
    if (live !== state) return;
    const quiet = (Date.now() - state.lastSpeech) / 1000;
    $('live-status').textContent = 'Lytter … ' + clock(state.elapsed())
      + (quiet > 60 ? ` · Ingen tale registreret i ${clock(quiet)}. Hører mikrofonen dig?` : '');
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

function startRecognition(state) {
  const rec = new SpeechRecognition();
  rec.lang = 'da-DK';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = settings.longest ? 5 : 1;
  const startedAt = Date.now();
  rec.onresult = (e) => {
    let interim = '';
    state.lastSpeech = Date.now();
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = bestAlternative(r);
      if (r.isFinal) addLiveText(state, text);
      else interim += text;
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

// Med «vælg den længste udgave» tages den længste af de foreslåede udgaver.
function bestAlternative(result) {
  let best = result[0].transcript;
  if (settings.longest) {
    for (let i = 1; i < result.length; i++) {
      if (result[i].transcript.length > best.length) best = result[i].transcript;
    }
  }
  return best;
}

// Google retter nogle gange en sætning, efter den er sendt som endelig, fx ved at
// tilføje et ord eller skifte store og små bogstaver. Så er den nye ikke en ren
// forlængelse af den gamle, men de to har næsten alle ord til fælles i samme
// rækkefølge. Sætninger under fire ord sammenlignes ikke, så korte svar som
// "Ja" og "Nej" ikke bliver slået sammen.
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

function addLiveText(state, transcript) {
  const t = formatSegment(transcript);
  if (!t) return;
  const now = state.elapsed();
  const box = $('text');
  // Chrome på Android sender den samme sætning flere gange, efterhånden som den
  // vokser ("Skal", "Skal jeg", "Skal jeg synge"). Er den nye en forlængelse af
  // den forrige, erstattes den forrige. Er den en ældre, kortere udgave, droppes den.
  // Det sker kun, hvis ingen har rettet i teksten imens.
  const norm = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const last = state.last;
  if (last && norm && box.value.length === last.end) {
    if (last.norm.startsWith(norm)) return;
    if (norm.startsWith(last.norm) || mostlySame(last.norm, norm)) {
      box.value = box.value.slice(0, last.start) + t;
      state.last = { norm, start: last.start, end: box.value.length };
      box.scrollTop = box.scrollHeight;
      updateButtons();
      return;
    }
  }
  if (state.paragraphStart === null || now - state.paragraphStart >= PARAGRAPH_S) {
    state.paragraphStart = now;
    box.value += (box.value.trim() ? '\n\n' : '') + `[${clock(now)}] `;
  } else if (/^[.,:;!?]/.test(t)) {
    // «punktum», «komma» osv. som egen sætning: tegnet erstatter det punktum,
    // appen selv havde sat efter forrige sætning.
    box.value = box.value.replace(/[.!?…]*\s*$/, '');
  } else if (/^\n/.test(t)) {
    box.value = box.value.replace(/ +$/, '');
  } else if (box.value && !/[\n ]$/.test(box.value)) {
    box.value += ' ';
  }
  const start = box.value.length;
  box.value += t;
  state.last = { norm, start, end: box.value.length };
  box.scrollTop = box.scrollHeight;
  updateButtons();
}

// Markeringer til beslutninger og handlinger, så de er lette at finde bagefter.
function addMarker(label) {
  const box = $('text');
  const now = live ? live.elapsed() : null;
  box.value = box.value.replace(/\s+$/, '') + (box.value.trim() ? '\n\n' : '')
    + (now === null ? '' : `[${clock(now)}] `) + `**${label}:** `;
  if (live) {
    live.paragraphStart = now;
    live.last = null;
  }
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
  updateRain();
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
  const project = $('project').value.trim();
  return [
    '---',
    `titel: "${title.replace(/["\\]/g, '\\$&')}"`,
    `dato: ${date}`,
    ...(project ? [`projekt: "${project.replace(/["\\]/g, '\\$&')}"`] : []),
    `kilde: live-tekst via browserens tale-tjeneste (${liveService()}), ikke gennemlæst af assistenten`,
    '---',
    '',
    `# ${title}`,
    '',
    `Dato: ${date}`,
    ...(project ? [`Projekt: ${project}`] : []),
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
  const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function fileName() {
  return `${$('date').value || today()}-${slug($('title').value)}.md`;
}

// Deler filen via telefonens delingsmenu, fx til OneDrive eller mail.
async function shareFile() {
  for (const type of ['text/markdown', 'text/plain']) {
    const file = new File([buildMarkdown()], fileName(), { type });
    if (!navigator.canShare?.({ files: [file] })) continue;
    try {
      await navigator.share({ files: [file], title: $('title').value.trim() || 'Møde' });
    } catch (err) {
      if (err.name !== 'AbortError') alert('Filen kunne ikke deles. Brug «Gem som .md-fil» i stedet.');
    }
    return;
  }
  alert('Browseren kan ikke dele filen. Brug «Gem som .md-fil» i stedet.');
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
  $('share').disabled = !hasText;
  $('reset').disabled = !hasText && !$('title').value.trim() && !$('project').value.trim();
  const words = countWords($('text').value);
  $('count').textContent = `${words.toLocaleString('da-DK')} ord`;
  scheduleSave();
}

// Tidsstempler som [01:08] er ikke ord og tælles ikke med.
function countWords(text) {
  return (text.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ').match(/\S+/g) || []).length;
}

// ---------- Udkast ----------

// Teksten gemmes løbende i browseren på denne enhed, så den ikke går tabt,
// hvis appen lukkes. Den sendes ikke nogen steder hen.
const DRAFT_KEY = 'transskription-udkast';
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 500);
}

function saveDraft() {
  clearTimeout(saveTimer);
  try {
    if (!$('text').value.trim() && !$('title').value.trim() && !$('project').value.trim()) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft = { title: $('title').value, project: $('project').value, date: $('date').value, text: $('text').value, saved: Date.now() };
    // Uændret udkast beholder sit gamle tidspunkt, så "gendannet fra" er rigtigt.
    const old = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (old && old.title === draft.title && old.project === draft.project && old.date === draft.date && old.text === draft.text) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* privat vindue eller fuld lagerplads: så virker appen uden udkast */ }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || (!draft.text?.trim() && !draft.title?.trim())) return;
    $('title').value = draft.title || '';
    $('project').value = draft.project || '';
    if (draft.date) $('date').value = draft.date;
    $('text').value = draft.text || '';
    const when = new Date(draft.saved).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
    $('restored').hidden = false;
    $('restored').textContent = `Udkast fra ${when} er gendannet. Nye sætninger kommer bagefter.`;
  } catch { /* intet udkast */ }
}

function resetAll() {
  if (live) return;
  if ($('text').value.trim() && !confirm('Teksten og titlen bliver slettet. Har du gemt filen, du skal bruge? Fortsæt?')) return;
  $('title').value = '';
  $('project').value = '';
  $('text').value = '';
  $('date').value = today();
  $('restored').hidden = true;
  $('live-warning').hidden = true;
  $('live-status').hidden = true;
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ikke afgørende */ }
  updateButtons();
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
$('title').oninput = updateButtons;
$('project').oninput = updateButtons;
$('share').onclick = shareFile;
document.querySelectorAll('[data-marker]').forEach((b) => { b.onclick = () => addMarker(b.dataset.marker); });
bindSettings();
applySettings();
runBoot();
$('date').onchange = scheduleSave;
$('reset').onclick = resetAll;
// Gem med det samme, når appen forlades, så sidste ord ikke går tabt.
document.addEventListener('visibilitychange', () => document.hidden && saveDraft());
window.addEventListener('pagehide', saveDraft);
document.addEventListener('visibilitychange', () => { onVisibility(document.hidden); updateRain(); });
window.addEventListener('resize', () => { if (rain.drops.length) { resizeRain(); } });
window.addEventListener('beforeunload', (e) => {
  if (live || $('text').value.trim()) e.preventDefault();
});

if (!SpeechRecognition) {
  $('live').hidden = true;
  $('live-intro').textContent = 'Live-tekst virker ikke i denne browser. Brug Edge, Chrome eller Safari.';
}
if (navigator.canShare?.({ files: [new File(['x'], 'a.md', { type: 'text/plain' })] })) {
  $('share').hidden = false;
}
restoreDraft();
updateButtons();
removeOldModel();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
