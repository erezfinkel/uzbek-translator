const $ = (id) => document.getElementById(id);

const hebrewTextEl = $('hebrew-text');
const azeriTextEl = $('azeri-text');
const russianTextEl = $('russian-text');
const outputActions = $('output-actions');
const statusText = $('status-text');
const recordBtn = $('record-btn');
const replyStatus = $('reply-status');
const replyOriginalEl = $('reply-original');
const replyHebrewEl = $('reply-hebrew');
const replyCard = $('reply-card');
const ttsAudio = $('tts-audio');

let lastAzeri = '';
let lastRussian = '';
let lastReplyHebrew = '';

// ========== Text to speech ==========
// Order per language: device voice -> Google TTS audio. Google has no Azerbaijani voice,
// so Azerbaijani falls back to a Turkish voice reading a phonetic respelling.

const LANGS = {
    az: { voice: ['az'], google: null, fallback: 'tr' },
    tr: { voice: ['tr'], google: 'tr' },
    ru: { voice: ['ru'], google: 'ru' },
    he: { voice: ['he', 'iw'], google: 'iw' },
};

let voices = [];
function loadVoices() {
    if ('speechSynthesis' in window) voices = window.speechSynthesis.getVoices();
}
if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 500);
    setTimeout(loadVoices, 2000);
}

function findVoice(prefixes) {
    if (voices.length === 0) loadVoices();
    return voices.find(v => v.lang && prefixes.some(p => v.lang.toLowerCase().replace('_', '-').startsWith(p)));
}

// Azerbaijani -> Turkish spelling, so a Turkish voice pronounces it close to right.
// Only three letters differ; Azerbaijani q is mostly voiced (qız = "gız").
function azeriToTurkishSpelling(text) {
    return text
        .replace(/Ə/g, 'E').replace(/ə/g, 'e')
        .replace(/X/g, 'H').replace(/x/g, 'h')
        .replace(/Q/g, 'G').replace(/q/g, 'g');
}

function setStatus(el, msg) { el.innerText = msg; }

function playUrl(url, statusEl) {
    window.speechSynthesis && window.speechSynthesis.cancel();
    ttsAudio.src = url;
    ttsAudio.onended = () => setStatus(statusEl, '✅ מוכן');
    ttsAudio.onerror = () => setStatus(statusEl, '❌ לא הצלחתי להשמיע. בדוק חיבור לאינטרנט.');
    setStatus(statusEl, '🔊 משמיע...');
    const p = ttsAudio.play();
    if (p) p.catch(() => setStatus(statusEl, '👇 לחץ על כפתור ההשמעה'));
}

function playGoogle(text, tl, statusEl) {
    const short = text.substring(0, 200);
    playUrl(`https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(short)}&tl=${tl}&total=1&idx=0&textlen=${short.length}&client=tw-ob`, statusEl);
}

function speak(text, lang, statusEl = statusText) {
    const cfg = LANGS[lang];
    const voice = findVoice(cfg.voice);

    if (!voice) {
        if (cfg.google) return playGoogle(text, cfg.google, statusEl);
        if (cfg.fallback === 'tr') return speak(azeriToTurkishSpelling(text), 'tr', statusEl);
        return setStatus(statusEl, '❌ אין קול זמין לשפה הזו');
    }

    ttsAudio.pause();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    let started = false;
    u.onstart = () => { started = true; setStatus(statusEl, '🔊 משמיע...'); };
    u.onend = () => setStatus(statusEl, '✅ מוכן');
    u.onerror = () => { if (cfg.google) playGoogle(text, cfg.google, statusEl); };
    window.speechSynthesis.speak(u);

    // Some Android voices fail silently - fall back to Google audio
    setTimeout(() => {
        if (!started && !window.speechSynthesis.speaking && cfg.google) playGoogle(text, cfg.google, statusEl);
    }, 2000);
}

// ========== Translation ==========

async function translate(text, from, to) {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`);
    const data = await res.json();
    if (!data || !data[0]) throw new Error('Translation failed');
    return data[0].map(seg => seg[0]).join('');
}

const OFFLINE_MSG = '📴 אין חיבור לאינטרנט. השיחון עובד גם בלי רשת.';

async function translateHebrew(text) {
    setStatus(statusText, '⏳ מתרגם...');
    azeriTextEl.innerText = '...';
    russianTextEl.innerText = '';
    outputActions.hidden = true;
    try {
        [lastAzeri, lastRussian] = await Promise.all([translate(text, 'he', 'az'), translate(text, 'he', 'ru')]);
        azeriTextEl.innerText = lastAzeri;
        russianTextEl.innerText = lastRussian;
        outputActions.hidden = false;
        speak(lastAzeri, 'az');
    } catch (e) {
        console.error('Translation error:', e);
        azeriTextEl.innerText = navigator.onLine ? '❌ שגיאה בתרגום. נסה שוב.' : OFFLINE_MSG;
        setStatus(statusText, 'מוכן');
    }
}

async function translateReply(text, from) {
    replyCard.hidden = false;
    replyOriginalEl.innerText = text;
    replyHebrewEl.innerText = '...';
    setStatus(replyStatus, '⏳ מתרגם...');
    try {
        lastReplyHebrew = await translate(text, from, 'iw');
        replyHebrewEl.innerText = lastReplyHebrew;
        speak(lastReplyHebrew, 'he', replyStatus);
    } catch (e) {
        console.error('Translation error:', e);
        replyHebrewEl.innerText = navigator.onLine ? '❌ שגיאה בתרגום. נסה שוב.' : OFFLINE_MSG;
        setStatus(replyStatus, 'מוכן');
    }
}

// ========== Speech recognition ==========

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function listen(lang, btn, statusEl, onText) {
    if (!SpeechRecognition) return setStatus(statusEl, 'הדפדפן לא תומך בזיהוי קולי. פתח ב-Chrome.');
    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { btn.classList.add('recording'); setStatus(statusEl, '🎙️ מקשיב...'); };
    rec.onend = () => btn.classList.remove('recording');
    rec.onresult = (e) => onText(e.results[0][0].transcript);
    rec.onerror = (e) => {
        console.error('Speech recognition error', e.error);
        btn.classList.remove('recording');
        const msg = e.error === 'not-allowed' ? '❌ אין הרשאה למיקרופון. אשר בהגדרות הדפדפן.'
            : e.error === 'network' ? OFFLINE_MSG
            : '❌ לא שמעתי. נסה שוב.';
        setStatus(statusEl, msg);
    };
    rec.start();
}

if (!SpeechRecognition) {
    setStatus(statusText, 'הדפדפן לא תומך בזיהוי קולי. השתמש בהקלדה.');
    recordBtn.disabled = true;
}

recordBtn.addEventListener('click', () => listen('he-IL', recordBtn, statusText, (text) => {
    hebrewTextEl.value = text;
    translateHebrew(text);
}));

$('translate-btn').addEventListener('click', () => {
    const text = hebrewTextEl.value.trim();
    if (text) translateHebrew(text);
    else setStatus(statusText, 'אנא הזן טקסט לתרגום.');
});

$('play-az-btn').addEventListener('click', () => lastAzeri && speak(lastAzeri, 'az'));
$('play-ru-btn').addEventListener('click', () => lastRussian && speak(lastRussian, 'ru'));
$('play-reply-btn').addEventListener('click', () => lastReplyHebrew && speak(lastReplyHebrew, 'he', replyStatus));

$('reply-az-btn').addEventListener('click', (e) =>
    listen('az-AZ', e.currentTarget, replyStatus, (text) => translateReply(text, 'az')));
$('reply-ru-btn').addEventListener('click', (e) =>
    listen('ru-RU', e.currentTarget, replyStatus, (text) => translateReply(text, 'ru')));

// ========== Tabs ==========

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== tab.dataset.panel; });
    });
});

// ========== Phrasebook (works offline: pre-recorded audio) ==========

const phraseList = $('phrase-list');
const phraseSearch = $('phrase-search');

// Play from a blob: Chrome rejects service-worker-cached mp3 served to the media element's
// range requests when offline, but a plain fetch from the cache works.
let phraseBlobUrl = null;
async function playPhrase(id, lang, text) {
    window.speechSynthesis && window.speechSynthesis.cancel();
    try {
        const res = await fetch(`audio/${id}-${lang}.mp3`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (phraseBlobUrl) URL.revokeObjectURL(phraseBlobUrl);
        phraseBlobUrl = URL.createObjectURL(await res.blob());
        ttsAudio.src = phraseBlobUrl;
        ttsAudio.onended = null;
        ttsAudio.onerror = null;
        await ttsAudio.play();
    } catch (e) {
        console.error('Phrase audio error:', e);
        speak(text, lang); // audio file missing - try live voice
    }
}

function renderPhrases(groups) {
    phraseList.innerHTML = '';
    groups.forEach(group => {
        const section = document.createElement('section');
        section.className = 'phrase-group';
        const h = document.createElement('h3');
        h.innerText = group.cat;
        section.appendChild(h);
        group.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'phrase';
            card.dataset.search = `${item.he} ${item.az} ${item.ru}`.toLowerCase();
            card.innerHTML = `
                <div class="phrase-he"></div>
                <div class="phrase-az" dir="ltr"></div>
                <div class="phrase-ru" dir="ltr"></div>
                <div class="phrase-actions">
                    <button class="chip az-chip">🔊 Azərbaycanca</button>
                    <button class="chip ru-chip">🔊 Русский</button>
                </div>`;
            card.querySelector('.phrase-he').innerText = item.he;
            card.querySelector('.phrase-az').innerText = item.az;
            card.querySelector('.phrase-ru').innerText = item.ru;
            card.querySelector('.az-chip').addEventListener('click', () => playPhrase(item.id, 'az', item.az));
            card.querySelector('.ru-chip').addEventListener('click', () => playPhrase(item.id, 'ru', item.ru));
            section.appendChild(card);
        });
        phraseList.appendChild(section);
    });
}

phraseSearch.addEventListener('input', () => {
    const q = phraseSearch.value.trim().toLowerCase();
    document.querySelectorAll('.phrase-group').forEach(section => {
        let visible = 0;
        section.querySelectorAll('.phrase').forEach(card => {
            const show = !q || card.dataset.search.includes(q);
            card.hidden = !show;
            if (show) visible++;
        });
        section.hidden = visible === 0;
    });
});

fetch('phrases.json')
    .then(r => r.json())
    .then(renderPhrases)
    .catch(e => { console.error('Phrases load error:', e); phraseList.innerText = '❌ לא הצלחתי לטעון את השיחון.'; });

// ========== Offline support ==========

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.error('SW register failed:', e));
}
