/* ============================================================
   Anonymous Match — frontend app (vanilla JS, no build step)
   Talks to the backend in ../backend over REST + Socket.io.
   ============================================================ */

const API_BASE = window.API_BASE || (location.origin.startsWith('http') && location.port !== '' ? location.origin.replace(/:\d+$/, ':3000') : 'http://localhost:3000');

const LS_KEY = 'anon_match_session_v1';

const S = {
  session: JSON.parse(localStorage.getItem(LS_KEY) || 'null'), // {userId, sessionToken, username}
  vibeDNA: null,
  hasCompletedQuiz: false,
  liveStats: { online: 0, waiting: 0, chatting: 0, matchedToday: 0, yapping: 0 },
  matchState: 'idle', // idle | waiting | pending | active
  currentMatch: null,
  breakdown: null,
  chatMessages: [],
  yapMessages: [],
  socket: null,
  quizIndex: 0,
  quizAnswers: {},
  quizQuestions: [],
  currentRoute: 'landing',
};

function saveSession() {
  localStorage.setItem(LS_KEY, JSON.stringify(S.session));
}
function clearSession() {
  localStorage.removeItem(LS_KEY);
  S.session = null;
}

/* ---------------- API helper ---------------- */
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && S.session) {
    headers['x-user-id'] = S.session.userId;
    headers['x-session-token'] = S.session.sessionToken;
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error(`Can't reach the server at ${API_BASE}. Is the backend running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---------------- Socket ---------------- */
function connectSocket() {
  if (S.socket || !S.session) return;
  S.socket = io(API_BASE, { transports: ['websocket', 'polling'] });
  S.socket.on('connect', () => S.socket.emit('auth', S.session.userId));

  S.socket.on('stats:update', (stats) => {
    S.liveStats = stats;
    if (S.currentRoute === 'home') renderHome();
  });

  S.socket.on('match:found', (match) => {
    S.currentMatch = match;
    S.matchState = 'pending';
    toast('We found someone who stands out.');
    if (S.currentRoute === 'match') renderMatchTab();
  });
  S.socket.on('match:partner_accepted', (match) => {
    S.currentMatch = match;
    if (S.currentRoute === 'match') renderMatchTab();
  });
  S.socket.on('match:accepted', (match) => {
    S.currentMatch = match;
    S.matchState = 'active';
    loadChatMessages(match.matchId).then(() => {
      if (S.currentRoute === 'match') renderMatchTab();
    });
  });
  S.socket.on('match:ended', ({ reason }) => {
    toast(reason || 'That match ended.');
    S.currentMatch = null;
    S.matchState = 'waiting';
    refreshMatchStatus().then(() => { if (S.currentRoute === 'match') renderMatchTab(); });
  });

  S.socket.on('chat:message', (message) => {
    if (S.currentMatch && message) {
      S.chatMessages.push(message);
      if (S.currentRoute === 'match' && S.matchState === 'active') renderMatchTab(true);
    }
  });
  S.socket.on('chat:reveal_unlocked', ({ matchId, level, info }) => {
    if (S.currentMatch && S.currentMatch.matchId === matchId) {
      S.currentMatch.revealLevel = level;
      S.currentMatch.revealedInfo = info;
      toast(`New reveal unlocked — level ${level}`);
      if (S.currentRoute === 'match') renderMatchTab();
    }
  });

  S.socket.on('yapping:message', (message) => {
    S.yapMessages.push(message);
    if (S.currentRoute === 'yapping') renderYapping(true);
  });
}

/* ---------------- Router ---------------- */
const routes = ['landing', 'identity', 'preferences', 'quiz', 'vibedna', 'home', 'match', 'yapping', 'me'];
const TAB_ROUTES = ['home', 'match', 'yapping', 'me'];

function go(route) {
  S.currentRoute = route;
  document.getElementById('tabbar').hidden = !TAB_ROUTES.includes(route);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.route === route));
  const renderers = {
    landing: renderLanding, identity: renderIdentity, preferences: renderPreferences,
    quiz: renderQuiz, vibedna: renderVibeDNA, home: renderHome, match: renderMatchTab,
    yapping: renderYapping, me: renderMe,
  };
  (renderers[route] || renderLanding)();
  window.scrollTo(0, 0);
}

document.getElementById('tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) go(btn.dataset.route);
});

/* ---------------- Particle background ---------------- */
function initParticles() {
  const field = document.getElementById('particleField');
  const n = window.innerWidth < 480 ? 18 : 32;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 100}%`;
    s.style.opacity = (0.15 + Math.random() * 0.35).toFixed(2);
    s.style.animationDuration = `${8 + Math.random() * 14}s`;
    s.style.animationDelay = `-${Math.random() * 10}s`;
    field.appendChild(s);
  }
}

/* ---------------- Screen: Landing ---------------- */
function renderLanding() {
  api('/api/stats/live', { auth: false }).then((s) => { S.liveStats = s; paintLiveStrip(); }).catch(() => {});
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen center">
      <div class="brand-mark">Anonymous Match</div>
      <h1 class="hero-title">Somewhere in this room,<br/>someone gets your <em>vibe</em>.</h1>
      <p class="hero-sub">Answer a few questions. We'll find one person worth talking to. No swiping, no profiles, no follower counts.</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-block" id="findVibeBtn">Find my vibe</button>
        <button class="btn btn-secondary btn-block" id="enterYapBtn">Enter Yapping Room</button>
      </div>
      <div class="live-strip" id="liveStrip"></div>
      <p class="foot-note">Anonymous by default. You decide what you reveal.</p>
      <button class="link-btn" style="margin-top:16px" id="recoverLink">Already have a recovery code?</button>
    </div>
  `;
  document.getElementById('findVibeBtn').onclick = () => ensureIdentity().then(() => go('identity'));
  document.getElementById('enterYapBtn').onclick = () => ensureIdentity().then(() => { connectSocket(); go('yapping'); });
  document.getElementById('recoverLink').onclick = renderRecovery;
}

function paintLiveStrip() {
  const el = document.getElementById('liveStrip');
  if (!el) return;
  const s = S.liveStats;
  el.innerHTML = `
    <div class="live-stat"><div class="num"><span class="dot-live"></span>${s.online ?? 0}</div><div class="lbl">online now</div></div>
    <div class="live-stat"><div class="num">${s.waiting ?? 0}</div><div class="lbl">waiting for a match</div></div>
    <div class="live-stat"><div class="num">${s.chatting ?? 0}</div><div class="lbl">currently chatting</div></div>
    <div class="live-stat"><div class="num">${s.matchedToday ?? 0}</div><div class="lbl">matches today</div></div>
  `;
}

function renderRecovery() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen center">
      <h2 style="margin-bottom:18px">Recover your identity</h2>
      <div class="panel" style="width:100%">
        <div class="field-row"><label>Recovery code</label><input type="text" id="recCode" placeholder="AM-XXXX-XXXX" /></div>
        <button class="btn btn-primary btn-block" id="recSubmit">Recover</button>
      </div>
      <button class="link-btn" style="margin-top:16px" id="backLink">Back</button>
    </div>`;
  document.getElementById('backLink').onclick = renderLanding;
  document.getElementById('recSubmit').onclick = async () => {
    const code = document.getElementById('recCode').value.trim().toUpperCase();
    if (!code) return;
    try {
      const data = await api('/api/identity/recover', { method: 'POST', body: { recoveryCode: code }, auth: false });
      S.session = { userId: data.userId, sessionToken: data.sessionToken, username: data.username };
      saveSession();
      const me = await api('/api/identity/me');
      S.vibeDNA = me.vibeDNA; S.hasCompletedQuiz = me.hasCompletedQuiz;
      connectSocket();
      go(me.hasCompletedQuiz ? 'home' : 'identity');
    } catch (e) { toast(e.message); }
  };
}

async function ensureIdentity() {
  if (S.session) return S.session;
  const data = await api('/api/identity', { method: 'POST', auth: false });
  S.session = { userId: data.userId, sessionToken: data.sessionToken, username: data.username, recoveryCode: data.recoveryCode };
  saveSession();
  connectSocket();
  return S.session;
}

/* ---------------- Screen: Identity reveal ---------------- */
function renderIdentity() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen center">
      <p class="muted small">Your identity is ready.</p>
      <div class="panel identity-card" style="margin-top:14px; width:100%">
        <div style="font-size:34px">🌙</div>
        <div class="username-display">${S.session.username}</div>
        <p class="muted small">Save this recovery code somewhere safe. We don't need your phone number or email.</p>
        <div class="recovery-box">${S.session.recoveryCode || '\u2014'}</div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:22px; max-width:320px" id="continueBtn">Continue</button>
    </div>`;
  document.getElementById('continueBtn').onclick = () => go('preferences');
}

/* ---------------- Screen: Basic preferences ---------------- */
function renderPreferences() {
  const app = document.getElementById('app');
  const genders = [['male', 'Male'], ['female', 'Female'], ['other', 'Other']];
  const prefs = [['male', 'Men'], ['female', 'Women'], ['any', 'Everyone']];
  app.innerHTML = `
    <div class="screen">
      <h2 class="section-title">A little about you</h2>
      <p class="muted small" style="margin-bottom:18px">Private. Only used for matching — never shown publicly.</p>
      <div class="panel">
        <div class="field-row">
          <label>You are</label>
          <div class="pref-choice-row" id="genderRow">${genders.map(([v, l]) => `<button class="pref-choice" data-v="${v}">${l}</button>`).join('')}</div>
        </div>
        <div class="field-row">
          <label>Looking to meet</label>
          <div class="pref-choice-row" id="prefRow">${prefs.map(([v, l]) => `<button class="pref-choice" data-v="${v}">${l}</button>`).join('')}</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:20px" id="prefContinue">Continue</button>
      <button class="link-btn" style="margin-top:14px" id="prefSkip">Skip for now</button>
    </div>`;
  let gender = null, genderPref = null;
  document.getElementById('genderRow').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    gender = b.dataset.v;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('selected', c === b));
  });
  document.getElementById('prefRow').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    genderPref = b.dataset.v;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('selected', c === b));
  });
  const proceed = async () => {
    try {
      if (gender || genderPref) await api('/api/identity/preferences', { method: 'POST', body: { gender, genderPref } });
    } catch (e) { /* non-fatal */ }
    loadQuizAndGo();
  };
  document.getElementById('prefContinue').onclick = proceed;
  document.getElementById('prefSkip').onclick = () => loadQuizAndGo();
}

/* ---------------- Screen: Quiz ---------------- */
async function loadQuizAndGo() {
  if (S.quizQuestions.length === 0) {
    const data = await api('/api/quiz/questions', { auth: false });
    S.quizQuestions = data.questions;
  }
  S.quizIndex = 0;
  S.quizAnswers = {};
  go('quiz');
}

function renderQuiz() {
  const q = S.quizQuestions[S.quizIndex];
  const app = document.getElementById('app');
  if (!q) { submitQuiz(); return; }
  const total = S.quizQuestions.length;
  app.innerHTML = `
    <div class="screen">
      <div class="quiz-progress">
        <span>${String(S.quizIndex + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
        <div class="progress-track"><div class="progress-fill" style="width:${((S.quizIndex) / total) * 100}%"></div></div>
      </div>
      <div class="panel quiz-card">
        <div class="quiz-question">${q.text}</div>
        <div class="quiz-options">
          ${q.options.map((o) => `<button class="quiz-option" data-id="${o.id}">${o.emoji ? `<span>${o.emoji}</span>` : ''}<span>${o.label}</span></button>`).join('')}
        </div>
      </div>
    </div>`;
  app.querySelectorAll('.quiz-option').forEach((btn) => {
    btn.onclick = () => {
      S.quizAnswers[q.id] = btn.dataset.id;
      btn.classList.add('selected');
      setTimeout(() => { S.quizIndex += 1; renderQuiz(); }, 220);
    };
  });
}

async function submitQuiz() {
  try {
    const data = await api('/api/quiz/submit', { method: 'POST', body: { answers: S.quizAnswers } });
    S.vibeDNA = data.vibeDNA;
    S.hasCompletedQuiz = true;
    go('vibedna');
  } catch (e) { toast(e.message); go('home'); }
}

/* ---------------- Screen: Vibe DNA ---------------- */
function renderVibeDNA() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen center">
      <h2 class="section-title">Your Vibe DNA is ready.</h2>
      <div class="panel" style="width:100%; margin-top:10px; text-align:left">
        ${S.vibeDNA.map((t) => `
          <div class="dna-trait">
            <div class="emoji">${t.emoji}</div>
            <div class="info">
              <div class="label">${t.label}</div>
              <div class="dna-bar"><div class="dna-bar-fill" style="width:${t.percent}%"></div></div>
            </div>
            <div class="dna-pct">${t.percent}%</div>
          </div>`).join('')}
      </div>
      <p class="muted small" style="margin-top:16px">Not a psychological diagnosis. Just your Anonymous Match vibe.</p>
      <button class="btn btn-primary btn-block" style="margin-top:22px; max-width:320px" id="toHome">Continue</button>
    </div>`;
  document.getElementById('toHome').onclick = () => go('home');
}

/* ---------------- Screen: Home (tab) ---------------- */
function renderHome() {
  connectSocket();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen">
      <div class="top-bar">
        <div>
          <div class="muted small">Welcome back</div>
          <div style="font-family:var(--font-display); font-size:20px">${S.session.username}</div>
        </div>
      </div>
      <div class="panel">
        <div class="section-title" style="font-size:16px; margin-bottom:10px">The room right now</div>
        <div class="live-strip" id="homeStrip" style="margin-top:0"></div>
      </div>
      <div class="panel" style="margin-top:14px">
        <p>${S.hasCompletedQuiz ? 'Your vibe is on file. Ready to meet the one person who fits it?' : 'Take the vibe quiz to unlock matching.'}</p>
        <button class="btn btn-primary btn-block" style="margin-top:14px" id="goMatch">${S.hasCompletedQuiz ? 'Find my match' : 'Take the vibe quiz'}</button>
      </div>
      <div class="panel" style="margin-top:14px">
        <p>Not looking to match right now? Drop into the Yapping Room \u2014 everyone's anonymous.</p>
        <button class="btn btn-secondary btn-block" style="margin-top:14px" id="goYap">Enter Yapping Room</button>
      </div>
    </div>`;
  paintHomeStrip();
  document.getElementById('goMatch').onclick = () => go(S.hasCompletedQuiz ? 'match' : 'preferences');
  document.getElementById('goYap').onclick = () => go('yapping');
}
function paintHomeStrip() {
  const el = document.getElementById('homeStrip');
  if (!el) return;
  const s = S.liveStats;
  el.innerHTML = `
    <div class="live-stat"><div class="num"><span class="dot-live"></span>${s.online ?? 0}</div><div class="lbl">online</div></div>
    <div class="live-stat"><div class="num">${s.waiting ?? 0}</div><div class="lbl">waiting</div></div>
    <div class="live-stat"><div class="num">${s.chatting ?? 0}</div><div class="lbl">chatting</div></div>
    <div class="live-stat"><div class="num">${s.matchedToday ?? 0}</div><div class="lbl">matched today</div></div>
  `;
}

/* ---------------- Screen: Match tab (waiting / found / chat) ---------------- */
async function refreshMatchStatus() {
  try {
    const data = await api('/api/match/status');
    S.matchState = data.status === 'idle' ? 'idle' : data.status;
    if (data.match) S.currentMatch = data.match;
    if (data.breakdown) S.breakdown = data.breakdown;
    if (data.status === 'active' && S.currentMatch) await loadChatMessages(S.currentMatch.matchId);
  } catch (e) { /* ignore */ }
}
async function loadChatMessages(matchId) {
  try {
    const data = await api(`/api/chat/${matchId}/messages`);
    S.chatMessages = data.messages;
  } catch (e) { /* ignore */ }
}

let matchPollTimer = null;
function renderMatchTab(skipRefresh) {
  connectSocket();
  if (matchPollTimer) clearInterval(matchPollTimer);
  matchPollTimer = setInterval(() => { if (S.currentRoute === 'match') refreshMatchStatus().then(() => renderMatchTab(true)); }, 4000);

  const proceed = () => {
    if (!S.hasCompletedQuiz) return renderMatchNeedsQuiz();
    if (S.matchState === 'active' && S.currentMatch) return renderChat();
    if (S.matchState === 'pending' && S.currentMatch) return renderMatchFound();
    if (S.matchState === 'waiting') return renderWaitingRoom();
    return renderMatchIdle();
  };

  if (skipRefresh) { proceed(); return; }
  refreshMatchStatus().then(proceed).catch(proceed);
}

function renderMatchNeedsQuiz() {
  document.getElementById('app').innerHTML = `
    <div class="screen center">
      <h2 class="section-title">Let's see what kind of human you are.</h2>
      <p class="muted" style="margin-top:8px">Finish the vibe quiz before we can find your match.</p>
      <button class="btn btn-primary btn-block" style="margin-top:20px; max-width:320px" id="startQuiz">Start the quiz</button>
    </div>`;
  document.getElementById('startQuiz').onclick = () => loadQuizAndGo();
}

function renderMatchIdle() {
  document.getElementById('app').innerHTML = `
    <div class="screen center">
      <div class="waiting-orbit"><div class="core">🌙</div></div>
      <h2 class="section-title">Ready when you are.</h2>
      <p class="muted" style="margin-top:6px; max-width:320px">We'll find someone who actually fits you \u2014 one person, one conversation.</p>
      <button class="btn btn-primary btn-block" style="margin-top:20px; max-width:320px" id="joinQueue">Enter the waiting room</button>
    </div>`;
  document.getElementById('joinQueue').onclick = async () => {
    try {
      const data = await api('/api/match/queue/join', { method: 'POST' });
      S.matchState = data.status;
      if (data.match) S.currentMatch = data.match;
      if (data.breakdown) S.breakdown = data.breakdown;
      renderMatchTab(true);
    } catch (e) { toast(e.message); }
  };
}

function renderWaitingRoom() {
  const b = S.breakdown || { total: 0, notFit: 0, some: 0, strong: 0, standout: 0 };
  document.getElementById('app').innerHTML = `
    <div class="screen center">
      <div class="waiting-orbit">
        <div class="ring" style="width:220px; height:220px; animation-duration:22s"></div>
        <div class="ring" style="width:170px; height:170px; animation-duration:16s; border-color:rgba(156,130,224,0.25)"></div>
        <div class="core">${S.session.username[0]}</div>
      </div>
      <p class="muted" style="margin-top:8px">We're looking for someone who actually fits you.</p>
      <div class="panel breakdown-list" style="width:100%; margin-top:20px; text-align:left">
        <p class="small muted" style="margin-bottom:6px">Out of ${b.total} people currently available\u2026</p>
        <div class="breakdown-row"><span>Don't fit your preferences</span><b>${b.notFit}</b></div>
        <div class="breakdown-row"><span>Some compatibility</span><b>${b.some}</b></div>
        <div class="breakdown-row"><span>Strong compatibility</span><b>${b.strong}</b></div>
        <div class="breakdown-row"><span>Currently stand out</span><b>${b.standout}</b></div>
      </div>
      <button class="btn btn-ghost btn-block" style="margin-top:18px; max-width:320px" id="leaveQueue">Stop waiting</button>
    </div>`;
  document.getElementById('leaveQueue').onclick = async () => {
    try { await api('/api/match/queue/leave', { method: 'POST' }); S.matchState = 'idle'; renderMatchTab(true); } catch (e) { toast(e.message); }
  };
}

function renderMatchFound() {
  const m = S.currentMatch;
  document.getElementById('app').innerHTML = `
    <div class="screen center">
      <p class="muted small">Someone is waiting for you.</p>
      <div style="font-family:var(--font-display); font-size:24px; margin-top:6px">${m.partnerUsername}</div>
      <div class="compat-badge">${m.compatibility}<span>% compatibility</span></div>
      <div class="trait-chips">${m.sharedTraits.map((t) => `<span class="chip">${t.emoji} ${t.label}</span>`).join('')}</div>
      ${m.difference ? `<div class="diff-box">One difference \u2014 <b>${m.difference.question}</b><br/>You: ${m.difference.a} · They: ${m.difference.b}</div>` : ''}
      <div class="hero-actions" style="margin-top:22px">
        <button class="btn btn-primary btn-block" id="acceptBtn">${m.iAccepted ? 'Waiting for them\u2026' : 'Meet them'}</button>
        <button class="btn btn-ghost btn-block" id="declineBtn">Keep waiting</button>
      </div>
      ${m.theyAccepted && !m.iAccepted ? '<p class="small muted" style="margin-top:10px">They\u2019ve already said yes.</p>' : ''}
    </div>`;
  const acceptBtn = document.getElementById('acceptBtn');
  if (m.iAccepted) acceptBtn.disabled = true;
  acceptBtn.onclick = async () => {
    try {
      const data = await api('/api/match/accept', { method: 'POST', body: { matchId: m.matchId } });
      S.currentMatch = data.match;
      if (data.match.status === 'active') { S.matchState = 'active'; await loadChatMessages(m.matchId); }
      renderMatchTab(true);
    } catch (e) { toast(e.message); }
  };
  document.getElementById('declineBtn').onclick = async () => {
    try {
      await api('/api/match/decline', { method: 'POST', body: { matchId: m.matchId } });
      S.currentMatch = null; S.matchState = 'waiting';
      renderMatchTab(true);
    } catch (e) { toast(e.message); }
  };
}

function starterFor(m) {
  const shared = m.sharedTraits?.[0];
  if (!shared) return null;
  return `You both scored high on ${shared.emoji} ${shared.label}. Good opener: ask what that looks like on a random Tuesday.`;
}

function renderChat() {
  const m = S.currentMatch;
  if (S.socket) S.socket.emit('chat:join', m.matchId);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen" style="padding:0; max-width:640px">
      <div class="chat-header">
        <div>
          <div class="name">${m.partnerUsername}</div>
          <div class="small muted">${m.compatibility}% compatibility</div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="icon-btn" id="revealBtn" title="Reveal">\u2728</button>
          <button class="icon-btn" id="endBtn" title="End match">\u2715</button>
        </div>
      </div>
      <div class="chat-body" id="chatBody">
        ${S.chatMessages.length === 0 ? `<div class="starter-suggestion">${starterFor(m) || 'Say hi \u2014 this conversation belongs to you two.'}</div>` : ''}
        ${S.chatMessages.map(bubbleHtml).join('')}
      </div>
      <div class="chat-input-bar">
        <input type="text" id="chatInput" placeholder="Type a message\u2026" />
        <button class="icon-btn" id="sendBtn">\u2192</button>
      </div>
    </div>`;
  const body = document.getElementById('chatBody');
  body.scrollTop = body.scrollHeight;

  const send = async () => {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try { await api(`/api/chat/${m.matchId}/messages`, { method: 'POST', body: { text } }); }
    catch (e) { toast(e.message); }
  };
  document.getElementById('sendBtn').onclick = send;
  document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  document.getElementById('endBtn').onclick = async () => {
    if (!confirm('End this match? This conversation will close for both of you.')) return;
    try {
      await api(`/api/chat/${m.matchId}/end`, { method: 'POST' });
      S.currentMatch = null; S.matchState = 'idle'; S.chatMessages = [];
      renderMatchTab(true);
    } catch (e) { toast(e.message); }
  };
  document.getElementById('revealBtn').onclick = () => renderRevealSheet(m);
}
function bubbleHtml(msg) {
  const mine = msg.from === S.session.userId;
  return `<div class="bubble ${mine ? 'mine' : 'theirs'}">${escapeHtml(msg.text)}</div>`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderRevealSheet(m) {
  const levels = [
    [1, 'Vibe information', 'Already shared \u2014 your quiz overlap.'],
    [2, 'First name', 'Requires mutual consent from both of you.'],
    [3, 'Photo', 'Requires mutual consent from both of you.'],
    [4, 'Social / contact', 'Requires mutual consent from both of you.'],
  ];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,5,9,0.7);z-index:40;display:flex;align-items:flex-end';
  overlay.innerHTML = `
    <div class="panel" style="width:100%; border-radius:24px 24px 0 0; max-width:560px; margin:0 auto">
      <div class="section-title" style="font-size:17px">Reveal something</div>
      <p class="small muted" style="margin:6px 0 14px">Nobody is automatically exposed. Both people must agree.</p>
      ${levels.map(([lvl, label, sub]) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-soft)">
          <div><div>${label}</div><div class="small muted">${sub}</div></div>
          <button class="btn btn-sm ${lvl <= (m.revealLevel || 0) ? 'btn-secondary' : 'btn-primary'}" data-lvl="${lvl}" ${lvl <= (m.revealLevel || 0) ? 'disabled' : ''}>${lvl <= (m.revealLevel || 0) ? 'Unlocked' : 'Request'}</button>
        </div>`).join('')}
      <button class="btn btn-ghost btn-block" style="margin-top:16px" id="closeSheet">Close</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('button[data-lvl]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const data = await api(`/api/chat/${m.matchId}/reveal`, { method: 'POST', body: { level: Number(btn.dataset.lvl) } });
        toast(data.mutualLevel >= Number(btn.dataset.lvl) ? 'Unlocked!' : 'Request sent \u2014 waiting on them.');
        overlay.remove();
      } catch (e) { toast(e.message); }
    };
  });
  overlay.querySelector('#closeSheet').onclick = () => overlay.remove();
}

/* ---------------- Screen: Yapping room ---------------- */
async function loadYapping() {
  const data = await api('/api/yapping/messages', { auth: false });
  S.yapMessages = data.messages;
}
async function loadIcebreaker() {
  return api('/api/yapping/icebreaker', { auth: false });
}
async function renderYapping(skipReload) {
  connectSocket();
  if (S.socket) S.socket.emit('yapping:join');
  if (!skipReload) { await loadYapping().catch(() => {}); }
  const ice = await loadIcebreaker().catch(() => null);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen" style="padding-bottom:100px">
      <div class="top-bar">
        <div>
          <h2 class="section-title" style="margin-bottom:2px">\uD83D\uDDE3\uFE0F Yapping Room</h2>
          <p class="small muted">Everyone is anonymous. Nobody knows who you are.</p>
        </div>
      </div>
      ${ice ? `<div class="icebreaker-banner"><div class="tag">Tonight's question</div><div style="margin-top:6px">${ice.emoji} ${ice.prompt}</div></div>` : ''}
      <div class="panel" id="yapList" style="max-height:50vh; overflow-y:auto"></div>
      <div class="chat-input-bar" style="position:fixed; bottom:70px; left:0; right:0; max-width:560px; margin:0 auto; border-radius:16px; margin-top:0">
        <input type="text" id="yapInput" placeholder="Say something\u2026" />
        <button class="icon-btn" id="yapSend">\u2192</button>
      </div>
    </div>`;
  paintYapList();
  const send = async () => {
    const input = document.getElementById('yapInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try { await api('/api/yapping/messages', { method: 'POST', body: { text } }); }
    catch (e) { toast(e.message); }
  };
  document.getElementById('yapSend').onclick = send;
  document.getElementById('yapInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}
function paintYapList() {
  const el = document.getElementById('yapList');
  if (!el) return;
  el.innerHTML = S.yapMessages.slice(-60).map((m) => `
    <div class="yap-msg">
      <div class="avatar">${(m.username || '?')[0]}</div>
      <div>
        <span class="who">${m.username}</span><span class="trust-tag">${m.trust || ''}</span>
        <div class="txt">${escapeHtml(m.text)}</div>
      </div>
    </div>`).join('');
  el.scrollTop = el.scrollHeight;
}

/* ---------------- Screen: Me ---------------- */
async function renderMe() {
  let me = {};
  try { me = await api('/api/identity/me'); } catch (e) { /* ignore */ }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="screen">
      <div class="panel identity-card">
        <div style="font-size:30px">\uD83C\uDF19</div>
        <div class="username-display">${S.session.username}</div>
        <div class="trust-pill">${me.trust || 'NEW'}</div>
      </div>
      <div class="panel" style="margin-top:14px">
        <div class="section-title" style="font-size:16px">Badges</div>
        <div class="badge-grid">
          <div class="badge"><div class="emoji">\uD83C\uDF19</div><div class="name">Night Owl</div></div>
          <div class="badge"><div class="emoji">\uD83C\uDF5B</div><div class="name">Food Argument Starter</div></div>
          <div class="badge"><div class="emoji">\uD83D\uDDE3\uFE0F</div><div class="name">Yapper</div></div>
          <div class="badge"><div class="emoji">\uD83D\uDC9C</div><div class="name">Good Conversation</div></div>
        </div>
      </div>
      <div class="panel" style="margin-top:14px">
        <div class="section-title" style="font-size:16px">Reveal-ready info</div>
        <p class="small muted">Optional. Only shared if you request a reveal and your match agrees too.</p>
        <div class="field-row" style="margin-top:10px"><label>First name</label><input type="text" id="firstNameInput" placeholder="Not set" /></div>
        <div class="field-row"><label>Social / contact</label><input type="text" id="contactInput" placeholder="Not set" /></div>
        <button class="btn btn-secondary btn-block" id="saveReveal">Save</button>
      </div>
      <div class="panel" style="margin-top:14px">
        <div class="section-title" style="font-size:16px">Identity</div>
        <p class="small muted">Regenerations left: ${me.regenerationsLeft ?? '\u2014'}</p>
        <button class="btn btn-secondary btn-block" style="margin-top:10px" id="regenBtn">New identity</button>
        <button class="btn btn-ghost btn-block" style="margin-top:10px" id="signOutBtn">Sign out of this device</button>
      </div>
    </div>`;
  document.getElementById('regenBtn').onclick = async () => {
    try {
      const data = await api('/api/identity/regenerate', { method: 'POST' });
      S.session.username = data.username; saveSession();
      renderMe();
    } catch (e) { toast(e.message); }
  };
  document.getElementById('signOutBtn').onclick = () => {
    if (!confirm('Sign out? Use your recovery code to come back.')) return;
    clearSession(); if (S.socket) { S.socket.disconnect(); S.socket = null; }
    location.reload();
  };
  document.getElementById('saveReveal').onclick = () => {
    toast('Saved for this session. (Wire this to a persistence endpoint for production.)');
  };
}

/* ---------------- Boot ---------------- */
async function boot() {
  initParticles();
  if (S.session) {
    connectSocket();
    try {
      const me = await api('/api/identity/me');
      S.vibeDNA = me.vibeDNA; S.hasCompletedQuiz = me.hasCompletedQuiz;
      go(me.hasCompletedQuiz ? 'home' : 'identity');
      return;
    } catch (e) {
      clearSession();
    }
  }
  go('landing');
}
boot();
