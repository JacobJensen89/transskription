// Styrer siden: optagelse, indlæsning af lydfil, opdeling i stykker,
// fremdrift og at gemme resultatet som en .md-fil.

// Tælles op ved hver ny udgave sammen med CACHE i sw.js, så man kan se i
// bunden af siden, om browseren har hentet den nyeste.
const VERSION = 4;

const SAMPLE_RATE = 16000;
const MAX_CHUNK_S = 30; // Whisper kan højst tage 30 sekunder ad gangen.
const MIN_CHUNK_S = 20; // Vi leder efter en stille pause mellem 20 og 30 sekunder.
const SILENCE_RMS = 0.0005; // Kun næsten helt tavse stykker springes over.
const MAX_GAIN = 30; // Svag lyd forstærkes højst 30 gange.

const $ = (id) => document.getElementById(id);

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let modelReady = false;
let audioBlob = null;
let audioName = '';
let audioSamples = null;
let cancelRequested = false;
let busy = false;
let textSource = 'local'; // 'local' eller 'live', skrives i .md-filen.

// ---------- Sprogmodel ----------

const pending = new Map();
let nextId = 1;

worker.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    showModelProgress(data.loaded, data.total);
  } else if (data.type === 'ready') {
    modelReady = true;
    $('model-progress').hidden = true;
    $('load-model').hidden = true;
    $('model-status').textContent = data.device === 'webgpu'
      ? 'Klar. Bruger grafikkortet (hurtig).'
      : 'Klar. Grafikkortet kan ikke bruges i denne browser, så det går langsommere.';
    updateButtons();
  } else if (data.type === 'result' || data.type === 'error') {
    const job = pending.get(data.id);
    if (job) {
      pending.delete(data.id);
      data.type === 'result' ? job.resolve(data.text) : job.reject(new Error(data.message));
    } else if (data.type === 'error') {
      $('model-progress').hidden = true;
      $('load-model').hidden = false;
      $('load-model').disabled = false;
      $('model-status').textContent = 'Sprogmodellen kunne ikke hentes: ' + data.message;
    }
  }
};

function transcribeChunk(audio) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

function showModelProgress(loaded, total) {
  $('model-progress').hidden = false;
  const pct = total ? (loaded / total) * 100 : 0;
  $('model-progress').firstElementChild.style.width = pct + '%';
  $('model-status').textContent =
    `Henter sprogmodel: ${mb(loaded)} af ${mb(total)} MB. Det sker kun første gang.`;
}

function loadModel() {
  $('load-model').disabled = true;
  $('model-status').textContent = 'Starter sprogmodellen …';
  worker.postMessage({ type: 'load' });
}

async function modelIsCached() {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((req) => req.url.includes('whisper-small'));
  } catch {
    return false;
  }
}

// ---------- Optagelse ----------

let recorder = null;
let recordTimer = null;
let wakeLock = null;
let recordGaps = []; // Tidsrum, hvor mikrofonen kan have været slået fra.

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* ikke afgørende */ }
}

async function toggleRecording() {
  if (recorder) {
    recorder.stop();
    return;
  }
  let stream;
  try {
    // Browserens støjfjernelse er lavet til videoopkald. Den kan skrue næsten
    // helt ned for stemmer i et mødelokale, så den slås fra. Modellen klarer selv støj.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    showRecordStatus('Mikrofonen kunne ikke åbnes. Tjek at browseren har lov til at bruge den.');
    return;
  }
  const parts = [];
  const started = Date.now();
  const elapsed = () => (Date.now() - started) / 1000;
  recordGaps = [];
  let gapStart = null;
  // Telefoner slukker mikrofonen, når appen kommer i baggrunden eller skærmen
  // slukker. Det kan siden ikke forhindre, men den kan huske, hvornår det skete.
  const markGap = () => {
    if (recorder && gapStart === null) gapStart = elapsed();
  };
  const endGap = () => {
    if (gapStart === null) return;
    recordGaps.push([gapStart, elapsed()]);
    gapStart = null;
    showRecordWarning();
  };
  const onVisibility = () => {
    if (document.hidden) {
      markGap();
    } else {
      endGap();
      keepAwake(true);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  stream.getAudioTracks().forEach((t) => {
    t.onmute = markGap;
    t.onunmute = endGap;
  });
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
  recorder.onstop = () => {
    endGap();
    document.removeEventListener('visibilitychange', onVisibility);
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(recordTimer);
    recorder = null;
    keepAwake(false);
    $('record').textContent = '● Optag';
    $('record').classList.remove('recording');
    $('record-status').hidden = true;
    const type = parts[0]?.type || 'audio/webm';
    setAudio(new Blob(parts, { type }), `optagelse-${today()}.${extensionFor(type)}`, true);
  };
  recorder.start(1000);
  keepAwake(true);
  $('record-warning').hidden = true;
  $('record').textContent = '■ Stop optagelse';
  $('record').classList.add('recording');
  const tick = () => showRecordStatus('Optager … ' + clock(elapsed()));
  tick();
  recordTimer = setInterval(tick, 1000);
  updateButtons();
}

function showRecordWarning() {
  if (!recordGaps.length) return;
  const spans = recordGaps.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(', ');
  $('record-warning').hidden = false;
  $('record-warning').textContent =
    `Advarsel: appen var i baggrunden eller mikrofonen var slået fra (${spans}). `
    + 'Optagelsen kan mangle lyd i det tidsrum. Hold appen åben med skærmen tændt, mens du optager.';
}

function showRecordStatus(text) {
  $('record-status').hidden = false;
  $('record-status').textContent = text;
}

function extensionFor(type) {
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

// ---------- Lyd ----------

async function setAudio(blob, name, recorded) {
  if (!recorded) $('record-warning').hidden = true;
  audioBlob = blob;
  audioName = name;
  audioSamples = null;
  $('audio-box').hidden = false;
  $('player').src = URL.createObjectURL(blob);
  $('save-audio').hidden = !recorded;
  $('audio-info').textContent = 'Læser lyden …';
  updateButtons();
  try {
    audioSamples = await decodeToMono16k(blob);
    $('audio-info').textContent = `${name} · ${clock(audioSamples.length / SAMPLE_RATE)}`;
  } catch {
    audioBlob = null;
    $('audio-info').textContent = 'Lydfilen kunne ikke læses. Prøv et andet format, fx mp3, m4a eller wav.';
  }
  updateButtons();
}

// Gør lyden klar til modellen: 16.000 målinger i sekundet og én kanal (mono).
async function decodeToMono16k(blob) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return mono;
  } finally {
    ctx.close();
  }
}

// Deler lyden i stykker på højst 30 sekunder. Snittet lægges i den mest
// stille tiendedel af et sekund mellem 20 og 30 sekunder, så ord ikke klippes over.
function chunkBounds(samples) {
  const max = MAX_CHUNK_S * SAMPLE_RATE;
  const min = MIN_CHUNK_S * SAMPLE_RATE;
  const win = SAMPLE_RATE / 10;
  const bounds = [];
  let start = 0;
  while (samples.length - start > max) {
    let best = start + max;
    let bestEnergy = Infinity;
    for (let p = start + min; p + win <= start + max; p += win / 2) {
      let energy = 0;
      for (let i = p; i < p + win; i++) energy += samples[i] * samples[i];
      if (energy < bestEnergy) {
        bestEnergy = energy;
        best = p + win / 2;
      }
    }
    bounds.push([start, best]);
    start = best;
  }
  bounds.push([start, samples.length]);
  return bounds;
}

// Skruer op for svag lyd, så det højeste punkt i stykket når 0,9.
function normalize(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = Math.min(MAX_GAIN, 0.9 / Math.max(peak, 1e-9));
  if (gain > 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

// Whisper finder nogle gange på tekst i stilhed, fx "Undertekster af ...".
const HALLUCINATIONS = [
  /^(danske )?(undertekster|tekster|tekstet|tekstning)\b.*$/i,
  /^tak fordi (i|du) (så|lyttede) med\.?$/i,
  /^(\.|…|\s)*$/,
];

function cleanText(text) {
  const trimmed = text.trim();
  if (HALLUCINATIONS.some((re) => re.test(trimmed))) return '';
  // Fjern sætninger, der gentages mere end to gange i træk.
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const kept = [];
  for (const s of sentences) {
    const n = kept.length;
    if (n >= 2 && kept[n - 1] === s && kept[n - 2] === s) continue;
    kept.push(s);
  }
  return kept.join(' ');
}

// ---------- Omsæt til tekst ----------

async function transcribe() {
  if (!audioSamples || !modelReady || busy) return;
  const existing = $('text').value.trim();
  if (existing && !confirm('Den nuværende tekst bliver erstattet. Fortsæt?')) return;

  busy = true;
  cancelRequested = false;
  updateButtons();
  keepAwake(true);
  $('text').value = '';
  $('cancel').hidden = false;
  $('tx-progress').hidden = false;
  $('tx-status').hidden = false;

  textSource = 'local';
  const bounds = chunkBounds(audioSamples);
  const started = performance.now();
  let failed = null;
  let empty = 0;
  try {
    for (let i = 0; i < bounds.length; i++) {
      if (cancelRequested) break;
      showTxProgress(i, bounds.length, started);
      const [a, b] = bounds[i];
      const chunk = audioSamples.slice(a, b);
      if (rms(chunk) < SILENCE_RMS) {
        empty++;
        continue;
      }
      const text = cleanText(await transcribeChunk(normalize(chunk)));
      if (text) appendText(`[${clock(a / SAMPLE_RATE)}] ${text}`);
      else empty++;
    }
  } catch (err) {
    failed = err;
  }

  busy = false;
  keepAwake(false);
  $('cancel').hidden = true;
  $('tx-progress').hidden = true;
  const used = clock((performance.now() - started) / 1000);
  $('tx-status').textContent = failed
    ? 'Noget gik galt: ' + failed.message
    : cancelRequested
      ? `Stoppet. Teksten indtil nu er bevaret (${used}).`
      : `Færdig på ${used}. Læs teksten igennem, før du gemmer.`
        + (empty ? ` ${empty} af ${bounds.length} stykker gav ingen tekst.` : '');
  updateButtons();
}

function showTxProgress(done, total, started) {
  $('tx-progress').firstElementChild.style.width = (done / total) * 100 + '%';
  let text = `Stykke ${done + 1} af ${total}`;
  if (done > 0) {
    const perChunk = (performance.now() - started) / done;
    text += ` · ca. ${clock(((total - done) * perChunk) / 1000)} tilbage`;
  }
  $('tx-status').textContent = text;
}

function appendText(line) {
  const box = $('text');
  box.value += (box.value ? '\n\n' : '') + line;
  box.scrollTop = box.scrollHeight;
  updateButtons();
}

// ---------- Live-tekst ----------

// Browserens indbyggede talegenkendelse. Den er god til dansk, men lyden sendes
// til browserens leverandør. Derfor spørger appen, før den bruges første gang.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const PARAGRAPH_S = 60; // Nyt afsnit med tidsstempel cirka hvert minut.
let live = null;
let liveAccepted = false;

function liveService() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|Macintosh/.test(ua) && !/Chrome|Edg/.test(ua)) return 'Apple';
  if (/iPhone|iPad/.test(ua)) return 'Apple';
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
    + 'Brug den kun, når det er i orden at lyden forlader computeren. Fortsæt?',
  )) return;
  liveAccepted = true;
  textSource = 'live';
  recordGaps = [];
  $('record-warning').hidden = true;
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
  updateButtons();
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
      state.fatal = 'Browseren har ikke lov til at bruge mikrofonen eller tale-tjenesten.';
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
  if (state.paragraphStart === null || now - state.paragraphStart >= PARAGRAPH_S) {
    state.paragraphStart = now;
    box.value += (box.value.trim() ? '\n\n' : '') + `[${clock(now)}] ${t}`;
  } else {
    box.value += ' ' + t;
  }
  box.scrollTop = box.scrollHeight;
  updateButtons();
}

function stopLive(message) {
  const state = live;
  if (!state) return;
  state.active = false;
  liveVisibility(false);
  live = null;
  clearInterval(state.timer);
  // stop() i stedet for abort(), så den sidste sætning når at komme med.
  try { state.recognition?.stop(); } catch { /* allerede stoppet */ }
  keepAwake(false);
  $('live').textContent = '🎙 Start live-tekst';
  $('live').classList.remove('recording');
  $('live-status').textContent = message || `Stoppet efter ${clock(state.elapsed())}. Læs teksten igennem, før du gemmer.`;
  updateButtons();
}

// Telefoner slukker mikrofonen i baggrunden. Husk hvornår, og start igen bagefter.
function liveVisibility(hidden) {
  const state = live;
  if (!state) return;
  if (hidden) {
    state.gapStart ??= state.elapsed();
  } else if (state.gapStart !== null) {
    recordGaps.push([state.gapStart, state.elapsed()]);
    state.gapStart = null;
    showRecordWarning();
  }
  if (!hidden && state.waiting && state.active) {
    state.waiting = false;
    startRecognition(state);
  }
}

// ---------- Gem ----------

function buildMarkdown() {
  const title = $('title').value.trim() || 'Møde';
  const date = $('date').value || today();
  return [
    '---',
    `titel: "${title.replace(/["\\]/g, '\\$&')}"`,
    `dato: ${date}`,
    textSource === 'live'
      ? `kilde: live-tekst via browserens tale-tjeneste (${liveService()}), ikke gennemlæst af assistenten`
      : 'kilde: automatisk transskription på egen computer (whisper-small), ikke gennemlæst af assistenten',
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

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function saveMarkdown() {
  const date = $('date').value || today();
  const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
  download(blob, `${date}-${slug($('title').value)}.md`);
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
  $('transcribe').disabled = !modelReady || !audioSamples || busy || !!recorder || !!live;
  $('record').disabled = busy || !!live;
  $('file').disabled = busy || !!recorder || !!live;
  $('live').disabled = busy || !!recorder;
  $('save-md').disabled = !hasText || busy;
  $('copy').disabled = !hasText;
  $('transcribe').title = !modelReady ? 'Sprogmodellen er ikke klar endnu'
    : !audioSamples ? 'Optag eller vælg en lydfil først' : '';
}

function clock(seconds) {
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function mb(bytes) {
  return Math.round((bytes || 0) / 1e6);
}

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ---------- Start ----------

$('date').value = today();
$('version').textContent = `Version ${VERSION}`;
$('record').onclick = toggleRecording;
$('file').onchange = (e) => {
  const file = e.target.files[0];
  if (file) setAudio(file, file.name, false);
  e.target.value = '';
};
$('save-audio').onclick = () => audioBlob && download(audioBlob, audioName);
$('load-model').onclick = loadModel;
$('transcribe').onclick = transcribe;
$('cancel').onclick = () => {
  cancelRequested = true;
  $('tx-status').textContent = 'Stopper efter det nuværende stykke …';
};
$('save-md').onclick = saveMarkdown;
$('copy').onclick = copyText;
$('text').oninput = updateButtons;
$('live').onclick = toggleLive;
document.addEventListener('visibilitychange', () => liveVisibility(document.hidden));
window.addEventListener('beforeunload', (e) => {
  if (busy || recorder || live || $('text').value.trim()) e.preventDefault();
});

if (!SpeechRecognition) {
  $('live').hidden = true;
  $('live-intro').textContent = 'Live-tekst virker ikke i denne browser. Brug Edge eller Chrome.';
}

if (!window.MediaRecorder) $('record').hidden = true;

if (await modelIsCached()) {
  loadModel();
} else {
  $('model-status').textContent =
    'Sprogmodellen skal hentes én gang (250–450 MB, afhængigt af computeren). Brug gerne wifi. Bagefter ligger den i browseren.';
  $('load-model').hidden = false;
}
updateButtons();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
