/**
 * Iconic Billing — app.js
 * Architecture:
 *  - Auth via HttpOnly cookie (server sets/clears) — no token in JS
 *  - Event delegation on all dynamic lists
 *  - Voice via SpeechRecognition (Chrome/Edge) with manual fallback
 *  - PWA-ready: registers service worker for offline billing queue
 */
'use strict';

// ═══════════════════════════════════════════════════════════════
// API CLIENT — credentials:include sends the HttpOnly cookie
// ═══════════════════════════════════════════════════════════════
const API = {
  async _f(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method:      opts.method || 'GET',
      headers:     { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'include',   // sends HttpOnly cookie automatically
      body:        opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let d = {};
    try { d = await res.json(); } catch (_) {}
    if (res.status === 401) {
      // Session expired — graceful re-login
      App.state.doctor = null;
      App.showLogin();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    return d;
  },
  async login(email, password)    { return API._f('/auth/login',       { method: 'POST', body: { email, password } }); },
  async adminLogin(e, p)          { return API._f('/auth/admin-login',  { method: 'POST', body: { email: e, password: p } }); },
  async logout()                  { return API._f('/auth/logout',       { method: 'POST' }).catch(() => {}); },
  async me()                      { return API._f('/auth/me'); },
  async getPatients()             { return API._f('/patients'); },
  async extractCodes(transcript)  { return API._f('/billing/extract',    { method: 'POST', body: { transcript } }); },
  async scanSticker(b64, mt)      { return API._f('/billing/scan-sticker',{ method: 'POST', body: { imageBase64: b64, mediaType: mt } }); },
  async submitBilling(p)          { return API._f('/billing/submit',     { method: 'POST', body: p }); },
  async saveSticker(p)            { return API._f('/billing/save-sticker',{ method: 'POST', body: p }); },
  async getStats()                { return API._f('/billing/stats'); },
  async getPatientStatus()        { return API._f('/billing/status'); },
  async getCollections()          { return API._f('/billing/collections'); },
  async getRevenue()              { return API._f('/billing/revenue'); },
  async submitNewPatient(p)       { return API._f('/patients/submit',   { method: 'POST', body: p }); },
  async getDoctors()              { return API._f('/admin/doctors'); },
  async createDoctor(p)           { return API._f('/admin/doctors',      { method: 'POST', body: p }); },
  async updateDoctor(id, p)       { return API._f('/admin/doctors/' + id,{ method: 'PATCH', body: p }); },
  async getSheetHeaders(id)       { return API._f('/admin/doctors/' + id + '/sheet-headers'); },
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const App = {
  state: {
    doctor:         null,
    patients:       [],
    selected:       null,
    wardVisits:     [],
    authNo:         '',
    lastTranscript: '',
    calSelected:    new Set(),
    calYear:        new Date().getFullYear(),
    calMonth:       new Date().getMonth(),
    billingMode:    'voice',
    isRecording:    false,
  },

  // ── Helpers ───────────────────────────────────────────────
  el:   id => document.getElementById(id),
  fmt:  n  => 'R\u00a0' + (n||0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

  togglePw(id, btn) {
    const i = App.el(id);
    if (!i) return;
    i.type = i.type === 'password' ? 'text' : 'password';
    btn.textContent = i.type === 'text' ? '🙈' : '👁';
  },

  showToast(msg, duration = 2500) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 24px;font-size:15px;font-weight:600;color:var(--text);z-index:99999;pointer-events:none;opacity:0;transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; });
    setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(-20px)'; setTimeout(()=>t.remove(),400); }, duration);
  },

  showConfirm(title, msg, onOk, okLabel = 'Confirm') {
    let modal = App.el('confirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confirmModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(8,12,20,0.85);z-index:99000;display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(8px);';
      modal.innerHTML = '<div id="cmc" style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:28px 24px;width:100%;max-width:360px;transition:transform 0.2s;transform:scale(0.95);"><div id="cmt" style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;letter-spacing:-0.02em;"></div><div id="cmm" style="font-size:14px;color:var(--text2);margin-bottom:24px;line-height:1.5;"></div><div style="display:flex;gap:10px;"><button id="cmcancel" style="flex:1;padding:14px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;font-family:var(--font);">Cancel</button><button id="cmok" style="flex:1;padding:14px;background:var(--danger);border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font);"></button></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target===modal) App.hideConfirm(); });
    }
    App.el('cmt').textContent = title;
    App.el('cmm').textContent = msg;
    App.el('cmok').textContent = okLabel;
    App.el('cmok').onclick = () => { App.hideConfirm(); onOk(); };
    App.el('cmcancel').onclick = App.hideConfirm;
    modal.style.display = 'flex';
    requestAnimationFrame(() => { App.el('cmc').style.transform='scale(1)'; });
  },
  hideConfirm() {
    const m = App.el('confirmModal');
    if (!m) return;
    App.el('cmc').style.transform='scale(0.95)';
    setTimeout(()=>{ m.style.display='none'; }, 200);
  },

  setTodayDate() {
    const s = new Date().toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    ['currentDate','dashDate'].forEach(id => { const e=App.el(id); if(e) e.textContent=s; });
    const dos = App.el('dosDate');
    if (dos) dos.value = new Date().toISOString().split('T')[0];
  },

  showScreen(id) {
    ['loadingScreen','loginScreen','mainApp','adminScreen'].forEach(s => {
      const e = App.el(s); if (e) e.style.display = 'none';
    });
    const t = App.el(id);
    if (t) t.style.display = id==='loginScreen' ? 'flex' : 'block';
    App.closeSidebar();
  },

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  async init() {
    App.setTodayDate();
    App.bindAll();
    // Register service worker — network-first strategy means updates apply immediately
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      // Auto-reload when a new SW activates (new deployment detected)
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'SW_UPDATED') window.location.reload();
      });
    }
    // Try to restore session via /me (uses HttpOnly cookie)
    try {
      const { doctor } = await API.me();
      if (doctor) {
        App.state.doctor = doctor;
        await App.loadPatients();
        App.showDashboard();
        return;
      }
    } catch (_) {}
    App.showLogin();
  },

  // ═══════════════════════════════════════════════════════════
  // EASTER EGG
  // ═══════════════════════════════════════════════════════════
  checkEmailInput(val) {
    const v = val.toLowerCase().trim();
    if (v === 'admin') { App.el('loginEmail').value=''; App.showAdminLogin(); return; }
    if (v === 'declan' || v === 'elana') { App.el('loginEmail').value=''; App.triggerEgg(v); }
  },
  triggerEgg(name) {
    const eggs = {
      declan: {
        msgs: [
          '👨‍💻 Declan is in the building!',
          '⚡ The architect of the billing empire',
          'None of this exists without you 🚀',
          'Absolute legend. Keep shipping. 💙',
        ],
        colors: ['#00ff88','#00ffcc','#39ff14','#00c2ff','#ffffff'],
      },
      elana: {
        msgs: [
          '✨ The visionary has arrived!',
          '🌟 Iconic Billing shines because of you',
          'Your eye for detail makes all the difference 💫',
          'This one is for you. Always. 💙',
        ],
        colors: ['#ff88cc','#ffcc00','#ff44aa','#ffaa44','#ffffff'],
      },
    };
    const egg = eggs[name];
    if (!egg) return;
    // Flash the screen with the egg color
    const flash = document.createElement('div');
    flash.className = 'egg-flash';
    flash.style.background = egg.colors[0];
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
    // Toasts with a slight stagger
    let delay = 0;
    egg.msgs.forEach(m => { setTimeout(() => App.showToast(m, 2800), delay); delay += 950; });
    // Confetti burst
    setTimeout(() => App.eggConfetti(egg.colors), 150);
    // Supercharge the neural net
    if (App._nn) App._nn.setMode(name);
  },
  eggConfetti(colors) {
    const c = colors || ['#00c2ff','#0066ff','#00e5a0','#ffb800','#ff4d6a','#fff'];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement('div'), sz = 5 + Math.random() * 10;
      const shapes = ['50%', '3px', '0'];
      p.style.cssText = `position:fixed;width:${sz}px;height:${sz}px;background:${c[i%c.length]};border-radius:${shapes[i%3]};left:${5+Math.random()*90}%;top:48%;z-index:99998;pointer-events:none;box-shadow:0 0 ${sz*2}px ${c[i%c.length]}88;`;
      document.body.appendChild(p);
      const dx = (Math.random()-.5)*380, dy = -(60+Math.random()*340), rot = Math.random()*900;
      p.animate(
        [{transform:'translate(0,0) rotate(0deg)', opacity:1},
         {transform:`translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity:0}],
        {duration:1300+Math.random()*700, easing:'cubic-bezier(0,0.9,0.57,1)', fill:'forwards'}
      );
      setTimeout(() => p.remove(), 2200);
    }
  },

  // ═══════════════════════════════════════════════════════════
  // NEURAL NETWORK BACKGROUND — login screen animation
  // ═══════════════════════════════════════════════════════════
  _nn: null,
  initNeuralNet() {
    const canvas = App.el('neuralCanvas');
    if (!canvas) return;
    if (App._nn) { App._nn.stop(); }

    const ctx = canvas.getContext('2d');
    let raf, W = 0, H = 0, nodes = [];
    let mode = 'default';

    const PALETTES = {
      default: ['#0055cc','#0088ff','#00aaff','#0066dd'],
      declan:  ['#00ff88','#39ff14','#00ffcc','#00dd66'],
      elana:   ['#ff55bb','#ffcc00','#ff88cc','#ffaa33'],
    };

    const LINE_COLOR = {
      default: (a) => `rgba(0,110,255,${a})`,
      declan:  (a) => `rgba(0,255,120,${a})`,
      elana:   (a) => `rgba(255,100,180,${a})`,
    };

    const MAX_DIST = 155;

    function resize() {
      const p = canvas.parentElement;
      W = canvas.width  = p.offsetWidth  || window.innerWidth;
      H = canvas.height = p.offsetHeight || window.innerHeight;
      spawnNodes();
    }

    function spawnNodes() {
      const count = Math.min(72, Math.max(28, Math.floor((W * H) / 9500)));
      nodes = Array.from({ length: count }, () => ({
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: (Math.random() - 0.5) * 0.55,
        vy: (Math.random() - 0.5) * 0.55,
        r:  1.4 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.012 + Math.random() * 0.022,
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const palette   = PALETTES[mode]    || PALETTES.default;
      const mkLine    = LINE_COLOR[mode]   || LINE_COLOR.default;
      const speedMult = mode === 'declan' ? 2.8 : mode === 'elana' ? 2.0 : 1;
      const glowMult  = mode === 'default' ? 1 : 2.5;

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < MAX_DIST * MAX_DIST) {
            const norm  = 1 - Math.sqrt(d2) / MAX_DIST;
            const alpha = mode === 'default' ? norm * 0.22 : norm * 0.55;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = mkLine(alpha);
            ctx.lineWidth   = mode === 'default' ? 0.7 : 1.3;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        n.phase += n.phaseSpeed * speedMult;
        const glow  = 0.45 + Math.sin(n.phase) * 0.55;
        const ci    = Math.abs(Math.floor(n.phase / (Math.PI * 0.8))) % palette.length;
        const color = palette[ci];
        const rad   = n.r * (0.65 + glow * 0.7);

        ctx.shadowBlur  = (mode === 'default' ? 7 : 20) * glow * glowMult;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
        ctx.fillStyle   = color;
        ctx.globalAlpha = 0.45 + glow * 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur  = 0;

        // Move
        n.x += n.vx * speedMult;
        n.y += n.vy * speedMult;
        if (n.x < 0) { n.x = 0; n.vx =  Math.abs(n.vx); }
        if (n.x > W) { n.x = W; n.vx = -Math.abs(n.vx); }
        if (n.y < 0) { n.y = 0; n.vy =  Math.abs(n.vy); }
        if (n.y > H) { n.y = H; n.vy = -Math.abs(n.vy); }
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement);

    App._nn = {
      stop()     { cancelAnimationFrame(raf); ro.disconnect(); ctx.clearRect(0,0,W,H); App._nn = null; },
      setMode(m) { mode = m; setTimeout(() => { mode = 'default'; }, 3800); },
    };
  },

  // ═══════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════
  showLogin() {
    App.showScreen('loginScreen');
    ['loginError'].forEach(id=>{const e=App.el(id);if(e)e.style.display='none';});
    ['loginEmail','loginPassword'].forEach(id=>{const e=App.el(id);if(e)e.value='';});
    requestAnimationFrame(() => App.initNeuralNet());
  },

  async login() {
    const email=App.el('loginEmail').value.trim(), pass=App.el('loginPassword').value;
    const btn=App.el('loginBtn'), err=App.el('loginError');
    if (!email||!pass){err.textContent='Enter email and password.';err.style.display='block';return;}
    btn.disabled=true;btn.textContent='Signing in…';err.style.display='none';
    try {
      const {doctor}=await API.login(email,pass);
      App.state.doctor=doctor;
      btn.textContent='✓ Welcome!'; btn.style.background='linear-gradient(135deg,#00e5a0,#00c2ff)';
      await new Promise(r=>setTimeout(r,500));
      App.showScreen('loadingScreen');
      App.el('loadingText').textContent='Loading patients…';
      await App.loadPatients();
      App.showDashboard();
    } catch(e){
      err.textContent=e.message;err.style.display='block';
      btn.style.animation='shake 0.4s';setTimeout(()=>btn.style.animation='',500);
    } finally {btn.disabled=false;btn.textContent='Sign In';btn.style.background='';}
  },

  async logout() {
    App.showConfirm('Sign Out','Are you sure you want to sign out?',async()=>{
      await API.logout();
      App.state.doctor=null;App.state.patients=[];App.state.selected=null;
      App.showLogin();
    },'Sign Out');
  },

  showAdminLogin() {
    App.el('adminLoginOverlay').style.display='flex';
    setTimeout(()=>App.el('adminLoginEmail')?.focus(),80);
  },
  hideAdminLogin() {
    App.el('adminLoginOverlay').style.display='none';
    App.el('adminLoginError').style.display='none';
    ['adminLoginEmail','adminLoginPassword'].forEach(id=>{const e=App.el(id);if(e)e.value='';});
  },
  async adminLogin() {
    const email=App.el('adminLoginEmail').value.trim(), pass=App.el('adminLoginPassword').value;
    const btn=App.el('adminLoginBtn'),err=App.el('adminLoginError');
    if(!email||!pass){err.textContent='Enter both fields.';err.style.display='block';return;}
    btn.disabled=true;btn.textContent='Verifying…';err.style.display='none';
    try {
      await API.adminLogin(email,pass);
      App.hideAdminLogin();
      App.showScreen('adminScreen');
      App.clearAdminForm();
      await App.loadAdminDoctors();
    } catch(e){err.textContent=e.message;err.style.display='block';}
    finally{btn.disabled=false;btn.textContent='Enter Admin Panel';}
  },
  async exitAdmin(){await API.logout().catch(()=>{});App.showLogin();},

  // ═══════════════════════════════════════════════════════════
  // PATIENTS
  // ═══════════════════════════════════════════════════════════
  async loadPatients() {
    try{const{patients}=await API.getPatients();App.state.patients=patients||[];}
    catch(e){console.error('Patients load failed:',e);}
  },

  filterPatients(q) {
    if (!q||q.trim().length<2) return [];
    const ql=q.toLowerCase();
    return App.state.patients.filter(p=>
      (p.name||'').toLowerCase().includes(ql)||(p.fileNo||'').toLowerCase().includes(ql)
    ).slice(0,20);
  },

  renderPatientResults(matches, containerId, query) {
    const res=App.el(containerId);
    if (!res) return;
    if (!matches.length){res.innerHTML='<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px;">No patients found</div>';return;}
    const ql=query.toLowerCase();
    res.innerHTML=matches.map((p,i)=>{
      const nh=(p.name||'—').replace(new RegExp(`(${ql.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
        '<mark style="background:rgba(0,194,255,0.2);border-radius:3px;color:var(--accent);">$1</mark>');
      return `<div class="patient-item" data-idx="${App.state.patients.indexOf(p)}" data-source="${containerId}">
        <div class="patient-name">${nh}</div>
        <div class="patient-meta"><span class="file-badge">${p.fileNo||'—'}</span>${p.medAid?'<span>'+p.medAid+'</span>':''}</div>
      </div>`;
    }).join('');
  },

  selectPatient(idx) {
    App.state.selected=App.state.patients[idx];
    App.populatePatientCard(App.state.selected);
    App.goToScreen(2);
  },

  populatePatientCard(p){
    ['sel-name','sel-fileno','sel-funding','sel-medaid','sel-plan','sel-memb'].forEach(id=>{
      const e=App.el(id);if(!e)return;
      const map={'sel-name':p.name,'sel-fileno':p.fileNo,'sel-funding':p.funding,'sel-medaid':p.medAid,'sel-plan':p.plan,'sel-memb':p.membNo};
      e.textContent=map[id]||'—';
    });
  },

  // ── Sidebar patient search ───────────────────────────────
  async showSidebarPatient(idx) {
    const p = App.state.patients[idx];
    if (!p) return;
    App.el('sidebarSearchResults').style.display='none';
    App.el('sidebarPatientPanel').style.display='block';
    App.el('sidebarPatientName').textContent=p.name||'—';
    App.el('sidebarPatientFile').textContent=p.fileNo||'—';

    // Demographics
    App.el('sidebarPatientDetails').innerHTML=`
      <div class="sidebar-detail-grid">
        ${p.funding?`<div class="sd-item"><div class="sd-label">Funding</div><div class="sd-val">${p.funding}</div></div>`:''}
        ${p.medAid?`<div class="sd-item"><div class="sd-label">Medical Aid</div><div class="sd-val">${p.medAid}</div></div>`:''}
        ${p.plan?`<div class="sd-item"><div class="sd-label">Plan</div><div class="sd-val">${p.plan}</div></div>`:''}
        ${p.membNo?`<div class="sd-item"><div class="sd-label">Member No</div><div class="sd-val">${p.membNo}</div></div>`:''}
        ${p.depCode?`<div class="sd-item"><div class="sd-label">Dep Code</div><div class="sd-val">${p.depCode}</div></div>`:''}
      </div>`;

    // Billing timeline
    const tl=App.el('sidebarPatientTimeline');
    tl.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0;">Loading history…</div>';
    try {
      const data=await API.getStats();
      const rows=(data.recent||[]).filter(b=>(b.fileNo||'').toLowerCase()===(p.fileNo||'').toLowerCase()||(b.patient||'').toLowerCase().includes((p.name||'').toLowerCase().split(' ')[0]));
      if (!rows.length){tl.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0;">No billing history found</div>';return;}
      tl.innerHTML=rows.map(b=>{
        const sc=/^paid$|settled/i.test(b.status)?'var(--success)':/reject/i.test(b.status)?'var(--danger)':'var(--warning)';
        return `<div class="timeline-item">
          <div class="timeline-dot" style="background:${sc};"></div>
          <div class="timeline-content">
            <div class="timeline-date">${b.dos||'—'}</div>
            <div class="timeline-codes">${b.tariff||'—'} · ${b.icd10||'—'}</div>
            ${b.status?`<div class="timeline-status" style="color:${sc};">${b.status}</div>`:''}
            ${b.billed>0?`<div class="timeline-amount">${App.fmt(b.billed)}</div>`:''}
          </div>
        </div>`;
      }).join('');
    } catch(e){tl.innerHTML='<div style="font-size:12px;color:var(--danger);padding:8px 0;">Could not load history</div>';}

    // Store idx for bill button
    App.el('sidebarBillPatientBtn').dataset.idx=idx;
  },

  backToSidebarSearch(){
    App.el('sidebarPatientPanel').style.display='none';
    App.el('sidebarSearchResults').style.display='block';
  },

  // ═══════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════
  async showDashboard() {
    App.showScreen('mainApp');
    App.el('dashboardScreen').style.display='block';
    App.el('stepsBar').style.display='none';
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    App.el('searchInput').value='';
    const dr=App.state.doctor;
    if(dr){
      ['dashDrName','drNameHeader','sidebarDrName'].forEach(id=>{const e=App.el(id);if(e)e.textContent=dr.doctor_name||'—';});
      App.el('sidebarCollections').style.display=dr.collections_sheet_id?'flex':'none';
    }
    App.setTodayDate();
    App.loadDashStats();
    window.scrollTo(0,0);
  },

  async loadDashStats(){
    try{
      const data=await API.getStats();
      if(data.available){
      }
    }catch(_){}
    try{
    }catch(_){}
  },

  // ═══════════════════════════════════════════════════════════
  // BILLING FLOW
  // ═══════════════════════════════════════════════════════════
  startNewBilling(){
    App.state.selected=null;App.state.wardVisits=[];App.state.authNo='';App.state.lastTranscript='';App.state.calSelected.clear();
    App.el('dashboardScreen').style.display='none';
    App.el('stepsBar').style.display='flex';
    App.resetVoice();App.resetCalendar();App.switchBillingMode('voice');
    App.setTodayDate();
    App.goToScreen(1);
  },

  samePatientNewVisit(){
    App.state.wardVisits=[];App.state.authNo='';App.state.lastTranscript='';App.state.calSelected.clear();
    App.el('dashboardScreen').style.display='none';
    App.el('stepsBar').style.display='flex';
    App.resetVoice();App.resetCalendar();App.switchBillingMode('voice');
    App.setTodayDate();
    App.goToScreen(2);
  },

  goToScreen(n){
    document.querySelectorAll('.screen').forEach((s,i)=>s.classList.toggle('active',i+1===n));
    document.querySelectorAll('.step').forEach((s,i)=>s.classList.toggle('active',i+1<=n));
    App.el('stepsBar').style.display=n===4?'none':'flex';
    window.scrollTo(0,0);
  },

  switchBillingMode(mode){
    App.state.billingMode=mode;
    document.querySelectorAll('#billingTabs .billing-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===mode));
    App.el('voicePanel').style.display=mode==='voice'?'block':'none';
    App.el('manualPanel').style.display=mode==='manual'?'block':'none';
    if(mode!=='voice'&&App.state.isRecording) App.stopRecording();
  },

  applyManualCodes(){
    const t=App.el('manualTariff').value.trim(),i=App.el('manualIcd10').value.trim();
    const m=App.el('manualModifier')?.value.trim()||'',n=App.el('manualNotes')?.value.trim()||'';
    if(!t&&!i){['manualTariff','manualIcd10'].forEach(id=>{App.el(id).style.borderColor='var(--danger)';setTimeout(()=>App.el(id).style.borderColor='',1400);}); return;}
    App.populateConfirm(t,i,m,n);
  },

  proceedToConfirm(){
    const t=App.el('voiceTariff')?.value.trim()||'',i=App.el('voiceIcd10')?.value.trim()||'';
    const m=App.el('voiceModifier')?.value.trim()||'',n=App.el('voiceNotes')?.value.trim()||'';
    if(!t&&!i){App.showVoiceStatus('error','⚠ Enter at least a Tariff or ICD-10 code');return;}
    App.populateConfirm(t,i,m,n);
  },

  populateConfirm(tariff,icd10,modifier,notes){
    const p=App.state.selected||{};
    App.el('conf-fileno').textContent=p.fileNo||'—';
    App.el('conf-patient').textContent=p.name||'—';
    App.el('conf-funding').textContent=[p.funding,p.medAid].filter(Boolean).join(' — ')||'—';
    App.el('conf-dos').textContent=App.el('dosDate')?.value||'—';
    App.el('conf-tariff').value=tariff||'';
    App.el('conf-icd10').value=icd10||'';
    App.el('conf-modifier').value=modifier||'';
    if(App.el('conf-notes')&&notes) App.el('conf-notes').value=notes;
    App.renderWardSummary();
    App.goToScreen(3);
  },

  async submitBilling(){
    const p=App.state.selected;
    if(!p){alert('No patient selected.');return;}
    const tariff=App.el('conf-tariff').value.trim(),icd10=App.el('conf-icd10').value.trim();
    const modifier=App.el('conf-modifier')?.value.trim()||'',notes=App.el('conf-notes')?.value.trim()||'';
    const dos=App.el('conf-dos')?.textContent.trim()||'';
    if(!tariff||!icd10){alert('Please enter Tariff and ICD-10 codes.');return;}
    const btn=App.el('submitBtn');btn.disabled=true;btn.textContent='Submitting…';
    try{
      const r=await API.submitBilling({fileNo:p.fileNo,patientName:p.name,dateOfService:dos,fundingType:p.funding||'',medAid:p.medAid||'',membNo:p.membNo||'',tariff,icd10,modifier,notes,wardVisits:App.state.wardVisits.length?JSON.stringify(App.state.wardVisits):''});
      btn.textContent='✓ Done!';btn.style.background='linear-gradient(135deg,#00e5a0,#00c2ff)';
      App.el('successMsg').textContent=`Billing submitted for ${p.name}${r.rowCount>1?' ('+r.rowCount+' rows)':''}`;
      setTimeout(()=>{App.goToScreen(4);App.state.wardVisits=[];btn.style.background='';},400);
    }catch(e){alert('Submission failed: '+e.message);}
    finally{btn.disabled=false;btn.textContent='Submit Billing Entry';}
  },

  // ═══════════════════════════════════════════════════════════
  // VOICE RECORDING — SpeechRecognition (Chrome/Edge), manual fallback for other browsers
  // ═══════════════════════════════════════════════════════════
  resetVoice(){
    if(App.state.mediaRecorder&&App.state.isRecording){try{App.state.mediaRecorder.stop();}catch(_){}}
    App.state.isRecording=false;App.state.audioChunks=[];App.state.mediaRecorder=null;
    const box=App.el('transcriptBox');if(box){box.textContent='Your speech will appear here…';box.classList.add('empty');}
    App.el('recordBtn')?.classList.remove('recording', 'listening');
    const lbl=App.el('recordLabel');if(lbl){lbl.classList.remove('recording');lbl.textContent='Tap to start recording';}
    App.el('voiceStatusBox').style.display='none';
    App.el('voiceFieldsWrap').style.display='none';
    App.el('voiceReviewBtn').style.display='none';
    ['voiceTariff','voiceIcd10','voiceModifier','voiceNotes'].forEach(id=>{const e=App.el(id);if(e)e.value='';});
  },

  toggleRecording(){ App.state.isRecording?App.stopRecording():App.startRecording(); },

  startRecording(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('Speech recognition not supported. Please use Chrome.');
      App.switchBillingMode('manual');
      return;
    }
    const box=App.el('transcriptBox'), btn=App.el('recordBtn'), lbl=App.el('recordLabel');
    App.el('voiceStatusBox').style.display='none';
    App.el('voiceFieldsWrap').style.display='none';
    App.el('voiceReviewBtn').style.display='none';
    box.classList.remove('empty'); box.textContent = '';

    // accumulatedFinal persists across recognition restarts (handles silence timeouts).
    // We only ever ADD new finals to it using e.resultIndex — never re-read old ones.
    // This lets onend restart freely without duplicating text.
    App.state._accFinal = '';
    App.state._transcript = '';
    App.state._accFinal = '';

    const startRec = () => {
      const rec = new SR();
      rec.lang = 'en-ZA'; rec.continuous = true; rec.interimResults = true;

      rec.onresult = e => {
        let newFinals = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) newFinals += e.results[i][0].transcript;
          else                       interim   += e.results[i][0].transcript;
        }
        if (newFinals) App.state._accFinal += newFinals;
        const display = (App.state._accFinal + (interim ? ' ' + interim : '')).trim();
        box.textContent = display || '...';
      };

      // Instant visual feedback: pulse the button the moment sound is detected,
      // before any words have been transcribed (bridges the ~500ms API latency).
      rec.onsoundstart = () => { App.el('recordBtn')?.classList.add('listening'); };
      rec.onspeechend  = () => { App.el('recordBtn')?.classList.remove('listening'); };

      rec.onend = () => {
        App.el('recordBtn')?.classList.remove('listening');
        if (App.state.isRecording) {
          // Silence timeout — restart to keep listening
          startRec();
        } else {
          // Doctor tapped STOP — all audio is now fully processed, extract here
          App.state._recognition = null;
          const text = (App.state._accFinal || '').trim();
          App.state._accFinal = '';
          if (text) App.extractFromText(text);
        }
      };
      rec.onerror = e => { if (e.error !== 'no-speech') App.stopRecording(); };
      rec.start();
      App.state._recognition = rec;
    };

    // Set state BEFORE startRec so onend restart check works immediately
    App.state.isRecording = true;
    btn.classList.add('recording'); btn.textContent = 'STOP';
    lbl.classList.add('recording'); lbl.textContent = 'Recording… tap to stop';
    startRec();
  },

  stopRecording(){
    App.state.isRecording = false;
    // UI update immediately
    const btn = App.el('recordBtn'), lbl = App.el('recordLabel');
    if (btn) { btn.classList.remove('recording'); btn.textContent = 'REC'; }
    if (lbl) { lbl.classList.remove('recording'); lbl.textContent = 'Processing…'; }
    // Stop recognition — onend will fire once all pending audio is processed,
    // then extract from the complete _accFinal there (not here, to avoid race condition)
    if (App.state._recognition) {
      try { App.state._recognition.stop(); } catch(_) {
        // If stop fails, extract whatever we have
        App.state._recognition = null;
        const text = (App.state._accFinal || '').trim();
        App.state._accFinal = '';
        if (text) App.extractFromText(text);
      }
    }
  },

  async extractFromText(text){
    App.el('transcriptBox').textContent=text;
    App.el('transcriptBox').classList.remove('empty');
    App.showVoiceStatus('loading','Extracting billing codes…');
    App.el('recordBtn').disabled=true;
    try{
      const result=await API.extractCodes(text);
      App.fillVoiceFields(result);
    }catch(e){
      App.showVoiceStatus('error','⚠ Extraction failed — enter codes manually');
      App.el('voiceFieldsWrap').style.display='block';
      App.el('voiceReviewBtn').style.display='flex';
    }finally{App.el('recordBtn').disabled=false;}
  },

  fillVoiceFields(result){
    App.el('voiceTariff').value=result.tariff||'';
    App.el('voiceIcd10').value=result.icd10||'';
    App.el('voiceModifier').value=result.modifier||'';
    App.el('voiceNotes').value=result.notes||'';
    const preview=[result.tariff?'📋 '+result.tariff:'',result.icd10?'🏥 '+result.icd10:''].filter(Boolean).join('  ·  ');
    App.showVoiceStatus('done','✓ '+(preview||'Codes extracted — review below'));
    App.el('voiceFieldsWrap').style.display='block';
    App.el('voiceReviewBtn').style.display='flex';
  },

  showVoiceStatus(type,msg){
    const box=App.el('voiceStatusBox');if(!box)return;
    const c={done:'var(--success)',error:'var(--warning)',loading:'var(--accent)'};
    box.style.display='block';box.style.color=c[type]||'var(--text2)';box.textContent=msg;
  },

  // ═══════════════════════════════════════════════════════════
  // WARD CALENDAR
  // ═══════════════════════════════════════════════════════════
  resetCalendar(){
    App.state.wardVisits=[];App.state.calSelected.clear();
    App.state.calYear=new Date().getFullYear();App.state.calMonth=new Date().getMonth();
    App.el('wardCalendarWrap').style.display='none';
    App.el('wardSummaryWrap').style.display='none';
    App.el('wardToggleBtn').textContent='+ Add Ward Visits';
    App.el('calWardTariff').value='';App.el('calWardIcd10').value='';
    App.el('wardSummaryChips').innerHTML='';
  },
  toggleWardCalendar(){
    const w=App.el('wardCalendarWrap');
    w.style.display=w.style.display!=='none'?'none':'block';
    if(w.style.display==='block') App.renderCalendar();
  },
  calPrevMonth(){App.state.calMonth--;if(App.state.calMonth<0){App.state.calMonth=11;App.state.calYear--;}App.renderCalendar();},
  calNextMonth(){App.state.calMonth++;if(App.state.calMonth>11){App.state.calMonth=0;App.state.calYear++;}App.renderCalendar();},
  renderCalendar(){
    const mn=['January','February','March','April','May','June','July','August','September','October','November','December'];
    App.el('calMonthTitle').textContent=mn[App.state.calMonth]+' '+App.state.calYear;
    const first=new Date(App.state.calYear,App.state.calMonth,1).getDay();
    const days=new Date(App.state.calYear,App.state.calMonth+1,0).getDate();
    const today=new Date().toISOString().split('T')[0];
    const dn=['Su','Mo','Tu','We','Th','Fr','Sa'];
    let h=dn.map(d=>`<div class="cal-day-header">${d}</div>`).join('');
    for(let i=0;i<first;i++) h+='<div class="cal-day cal-day-empty"></div>';
    for(let d=1;d<=days;d++){
      const ds=`${App.state.calYear}-${String(App.state.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const sel=App.state.calSelected.has(ds),isT=ds===today;
      h+=`<div class="cal-day${sel?' cal-day-selected':''}${isT?' cal-day-today':''}" data-date="${ds}">${d}</div>`;
    }
    App.el('calGrid').innerHTML=h;
    const cnt=App.el('calSelectedCount');if(cnt) cnt.textContent=App.state.calSelected.size>0?App.state.calSelected.size+' day'+(App.state.calSelected.size>1?'s':'')+' selected':'Tap days to select';
  },
  toggleCalDate(date){
    App.state.calSelected.has(date)?App.state.calSelected.delete(date):App.state.calSelected.add(date);
    App.renderCalendar();
  },
  saveWardVisits(){
    const t=App.el('calWardTariff')?.value.trim(),i=App.el('calWardIcd10')?.value.trim();
    if(!t||!i){['calWardTariff','calWardIcd10'].forEach(id=>{const e=App.el(id);if(e){e.style.borderColor='var(--danger)';setTimeout(()=>e.style.borderColor='',1400);}});return;}
    if(App.state.calSelected.size===0){App.showToast('Select at least one date',2000);return;}
    App.state.wardVisits=[...App.state.calSelected].sort().map(date=>({date,tariff:t,icd10:i}));
    App.renderWardChips();
    App.el('wardCalendarWrap').style.display='none';
    App.el('wardToggleBtn').textContent='✏️ Edit ('+App.state.wardVisits.length+')';
  },
  removeWardVisit(idx){
    const v=App.state.wardVisits[idx];
    if(v) App.state.calSelected.delete(v.date);
    App.state.wardVisits.splice(idx,1);
    App.renderWardChips();
    if(!App.state.wardVisits.length) App.el('wardToggleBtn').textContent='+ Add Ward Visits';
  },
  renderWardChips(){
    const chips=App.el('wardSummaryChips'),wrap=App.el('wardSummaryWrap');if(!chips||!wrap)return;
    if(!App.state.wardVisits.length){wrap.style.display='none';return;}
    chips.innerHTML=App.state.wardVisits.map((v,i)=>{
      const lbl=new Date(v.date+'T00:00:00').toLocaleDateString('en-ZA',{day:'numeric',month:'short'});
      return `<div class="ward-chip"><span class="ward-chip-date">${lbl}</span><span>${v.tariff}</span><span style="color:var(--text3);">·</span><span>${v.icd10}</span><button class="ward-chip-remove" data-wardidx="${i}">×</button></div>`;
    }).join('');
    wrap.style.display='block';
  },
  renderWardSummary(){
    const e=App.el('wardVisitsSummary');if(!e)return;
    if(!App.state.wardVisits.length){e.style.display='none';return;}
    e.style.display='block';
    e.innerHTML='<div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Ward Visits ('+App.state.wardVisits.length+')</div>'+
      App.state.wardVisits.map(v=>{const lbl=new Date(v.date+'T00:00:00').toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short'});
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);"><span style="font-size:12px;font-family:var(--mono);color:var(--accent);min-width:80px;">${lbl}</span><span style="font-size:11px;font-family:var(--mono);color:var(--text2);">${v.tariff}</span><span style="color:var(--text3);">·</span><span style="font-size:11px;font-family:var(--mono);color:var(--text2);">${v.icd10}</span></div>`;
      }).join('');
  },

  // ═══════════════════════════════════════════════════════════
  // STICKER SCANNER
  // ═══════════════════════════════════════════════════════════
  openSticker(){
    App.closeSidebar();
    App.el('stickerModal').style.display='flex';
    ['stickerPreview','stickerResults','stickerScanning','stickerError'].forEach(id=>App.el(id).style.display='none');
    App.el('stickerInput').value='';
    ['stickerFileNo','stickerName','stickerMedAid','stickerPlan','stickerMembNo','stickerDepCode','stickerIdNo','stickerCellNo'].forEach(id=>{const e=App.el(id);if(e)e.value='';});
  },
  closeSticker(){App.el('stickerModal').style.display='none';App.el('stickerInput').value='';},
  async handleStickerFile(file){
    if(!file)return;
    App.el('stickerError').style.display='none';App.el('stickerResults').style.display='none';
    App.el('stickerScanning').style.display='block';
    try{
      // Compress image to max 1200px to stay within API limits (phone cameras are 12MP+)
      const b64 = await new Promise((res, rej) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          const MAX = 1200;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else       { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          // Show preview
          App.el('stickerPreviewImg').src = dataUrl;
          App.el('stickerPreview').style.display = 'block';
          res(dataUrl.split(',')[1]);
        };
        img.onerror = rej;
        img.src = objUrl;
      });
      const result=await API.scanSticker(b64,'image/jpeg');
      App.el('stickerScanning').style.display='none';
      if(!result.name&&!result.fileNo){App.el('stickerError').textContent='Could not read details. Try a clearer photo.';App.el('stickerError').style.display='block';return;}
      ['fileNo','name','medAid','plan','membNo','depCode','idNo','cellNo'].forEach(k=>{const e=App.el('sticker'+k.charAt(0).toUpperCase()+k.slice(1));if(e)e.value=result[k]||'';});
      App.el('stickerResults').style.display='block';
    }catch(e){App.el('stickerScanning').style.display='none';App.el('stickerError').textContent='Scan failed: '+e.message;App.el('stickerError').style.display='block';}
  },
  confirmSticker(){
    const s={fileNo:App.el('stickerFileNo').value.trim(),name:App.el('stickerName').value.trim(),funding:'Medical Aid',medAid:App.el('stickerMedAid').value.trim(),plan:App.el('stickerPlan').value.trim(),membNo:App.el('stickerMembNo').value.trim(),depCode:App.el('stickerDepCode').value.trim(),idNo:App.el('stickerIdNo').value.trim(),cellNo:App.el('stickerCellNo').value.trim(),_fromSticker:true};
    const match=App.state.patients.find(p=>(s.fileNo&&p.fileNo===s.fileNo)||(s.name&&p.name?.toLowerCase()===s.name.toLowerCase()));
    // Merge: use sticker data for financial fields (more accurate), sheet data for file/name
    App.state.selected = match ? {
      ...match,
      funding: s.medAid ? 'Medical Aid' : (match.funding || ''),
      medAid:  s.medAid  || match.medAid  || '',
      plan:    s.plan    || match.plan    || '',
      membNo:  s.membNo  || match.membNo  || '',
    } : s;
    if(!match&&s.name&&s.fileNo) API.submitNewPatient(s).catch(()=>{});
    App.closeSticker();
    App.populatePatientCard(App.state.selected);
    App.el('dashboardScreen').style.display='none';
    App.el('stepsBar').style.display='flex';
    App.setTodayDate();App.resetCalendar();App.switchBillingMode('voice');
    App.goToScreen(2);
  },
  rescanSticker(){
    ['stickerResults','stickerPreview','stickerError'].forEach(id=>App.el(id).style.display='none');
    App.el('stickerInput').value='';
  },

  // ═══════════════════════════════════════════════════════════
  // REVENUE
  // ═══════════════════════════════════════════════════════════
  openRevenue(){App.closeSidebar();App.el('revenueModal').style.display='flex';App.loadRevenue();},
  closeRevenue(){App.el('revenueModal').style.display='none';},
  async loadRevenue(){
    const c=App.el('revenueContent');c.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3);">Loading…</div>';
    try{
      const d=await API.getRevenue();
      if(!d.available){c.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px;"><div style="font-size:32px;margin-bottom:12px;">📊</div><div style="font-weight:600;color:var(--text2);margin-bottom:8px;">No Revenue Data</div><div style="font-size:12px;line-height:1.7;">${d.message||'Run Billing → Refresh All in your Google Sheet.'}</div></div>`;return;}
      if(App.el('revModalSub')) App.el('revModalSub').textContent=d.sheetName||'Billing Log';
      const F=App.fmt;
      c.innerHTML=`<div class="rev-cards"><div class="rev-card"><div class="rev-card-label">Invoiced</div><div class="rev-card-val">${F(d.invoiced)}</div></div><div class="rev-card"><div class="rev-card-label">Claimed</div><div class="rev-card-val">${F(d.claimed)}</div></div><div class="rev-card rev-card-green"><div class="rev-card-label">Paid</div><div class="rev-card-val">${F(d.paid)}</div></div><div class="rev-card rev-card-warn"><div class="rev-card-label">Outstanding</div><div class="rev-card-val">${F(d.outstanding)}</div></div></div>`+
      (d.claims?.total>0?`<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text3);margin:20px 0 10px;">Claim Status</div><div class="claims-grid"><div class="claim-card claim-rejected"><div class="claim-val">${d.claims.rejected}</div><div class="claim-label">Rejected</div></div><div class="claim-card claim-inprogress"><div class="claim-val">${d.claims.inProgress}</div><div class="claim-label">In Progress</div></div><div class="claim-card claim-paid"><div class="claim-val">${d.claims.paid}</div><div class="claim-label">Paid</div></div></div>`:'')+
      (d.recent?.length?`<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text3);margin:20px 0 10px;">Recent</div>`+d.recent.map(r=>{const sc=/paid|settled/i.test(r.status)?'var(--success)':/reject/i.test(r.status)?'var(--danger)':'var(--warning)';return`<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:8px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;"><span style="font-size:13px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.patient||'—'}</span>${r.status?`<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.15);color:${sc};flex-shrink:0;margin-left:8px;">${r.status}</span>`:''}</div><div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11px;font-family:var(--mono);">${r.billed>0?`<span>Inv: <span style="color:var(--text2);">${F(r.billed)}</span></span>`:''}${r.paid>0?`<span>Paid: <span style="color:var(--success);">${F(r.paid)}</span></span>`:''}${r.outstanding>0?`<span>Due: <span style="color:var(--warning);">${F(r.outstanding)}</span></span>`:''}</div></div>`;}).join(''):'');
    }catch(e){c.innerHTML=`<div style="text-align:center;padding:40px;color:var(--danger);">Error: ${e.message}</div>`;}
  },

  // ═══════════════════════════════════════════════════════════
  // SIDEBAR
  // ═══════════════════════════════════════════════════════════
  openSidebar(){
    App.el('sidebar').classList.add('open');
    App.el('sidebarOverlay').classList.add('show');
    document.body.style.overflow='hidden';
  },
  closeSidebar(){
    App.el('sidebar').classList.remove('open');
    App.el('sidebarOverlay').classList.remove('show');
    document.body.style.overflow='';
  },

  openSheetModal(sheetId, title){
    App.closeSidebar();
    if(!sheetId){App.showToast('Sheet ID not configured',2000);return;}
    App.el('sheetIframe').src=`https://docs.google.com/spreadsheets/d/${sheetId}/preview`;
    App.el('sheetDirectLink').href=`https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    if(App.el('sheetModalTitle')) App.el('sheetModalTitle').textContent=title||'Sheet';
    App.el('sheetModal').style.display='flex';
  },
  closeSheetModal(){App.el('sheetModal').style.display='none';App.el('sheetIframe').src='';},

  // ═══════════════════════════════════════════════════════════
  // ADMIN
  // ═══════════════════════════════════════════════════════════

  toggleAdminRevenue(){
    const panel = App.el('adminRevenuePanel');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      App.loadAdminRevenue();
    } else {
      panel.style.display = 'none';
    }
  },

  async loadAdminRevenue(){
    const c = App.el('adminRevenueContent');
    c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;">Loading…</div>';
    try {
      const d = await API.getRevenue();
      if (!d.available) {
        c.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;">${d.message||'No revenue data yet.'}</div>`;
        return;
      }
      const F = App.fmt;
      c.innerHTML = `<div class="rev-cards" style="margin-bottom:12px;">
        <div class="rev-card"><div class="rev-card-label">Invoiced</div><div class="rev-card-val">${F(d.invoiced)}</div></div>
        <div class="rev-card"><div class="rev-card-label">Claimed</div><div class="rev-card-val">${F(d.claimed)}</div></div>
        <div class="rev-card rev-card-green"><div class="rev-card-label">Paid</div><div class="rev-card-val">${F(d.paid)}</div></div>
        <div class="rev-card rev-card-warn"><div class="rev-card-label">Outstanding</div><div class="rev-card-val">${F(d.outstanding)}</div></div>
      </div>` +
      (d.claims?.total > 0 ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Claim Status</div>
        <div class="claims-grid" style="margin-bottom:12px;">
          <div class="claim-card claim-rejected"><div class="claim-val">${d.claims.rejected}</div><div class="claim-label">Rejected</div></div>
          <div class="claim-card claim-inprogress"><div class="claim-val">${d.claims.inProgress}</div><div class="claim-label">In Progress</div></div>
          <div class="claim-card claim-paid"><div class="claim-val">${d.claims.paid}</div><div class="claim-label">Paid</div></div>
        </div>` : '') +
      (d.recent?.length ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Recent Entries</div>` +
        d.recent.map(r => {
          const sc = /paid|settled/i.test(r.status) ? 'var(--success)' : /reject/i.test(r.status) ? 'var(--danger)' : 'var(--warning)';
          return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.patient||'—'}</span>
            <div style="text-align:right;flex-shrink:0;">
              ${r.status ? `<div style="font-size:10px;color:${sc};font-weight:700;">${r.status}</div>` : ''}
              ${r.billed > 0 ? `<div style="font-size:11px;font-family:var(--mono);color:var(--text2);">${F(r.billed)}</div>` : ''}
              ${r.outstanding > 0 ? `<div style="font-size:11px;font-family:var(--mono);color:var(--warning);">Due ${F(r.outstanding)}</div>` : ''}
            </div>
          </div>`;
        }).join('') : '');
    } catch(e) {
      c.innerHTML = `<div style="color:var(--danger);padding:16px;font-size:12px;">Error: ${e.message}</div>`;
    }
  },

  async loadAdminDoctors(){
    const t=App.el('adminDoctorTable');t.innerHTML='<div style="text-align:center;padding:32px;color:var(--text3);">Loading…</div>';
    try{
      const{doctors}=await API.getDoctors();
      if(App.el('adminDoctorCount')) App.el('adminDoctorCount').textContent='('+(doctors?.length||0)+')';
      if(!doctors?.length){t.innerHTML='<div style="text-align:center;padding:32px;color:var(--text3);">No doctors yet.</div>';return;}
      t.innerHTML=`<div class="db-table"><div class="db-table-head"><div class="db-th">Doctor</div><div class="db-th">Email</div><div class="db-th">Sheet</div><div class="db-th">Status</div><div class="db-th">Actions</div></div>${doctors.map(dr=>{const ready=!!(dr.intake_sheet_id&&dr.collections_sheet_id&&dr.apps_script_url);const ini=(dr.doctor_name||'DR').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();return`<div class="db-table-row"><div class="db-td"><div style="display:flex;align-items:center;gap:8px;"><div style="width:28px;height:28px;border-radius:8px;background:var(--accent2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;">${ini}</div><span style="font-weight:600;font-size:13px;">${dr.doctor_name||'—'}</span></div></div><div class="db-td" style="font-size:12px;color:var(--text2);font-family:var(--mono);">${dr.email||'—'}</div><div class="db-td" style="font-size:11px;color:var(--text3);font-family:var(--mono);">${dr.intake_sheet_id?dr.intake_sheet_id.substring(0,12)+'…':'—'}</div><div class="db-td"><span style="font-size:10px;padding:3px 8px;border-radius:20px;background:${ready?'rgba(0,229,160,0.1)':'rgba(255,184,0,0.1)'};color:${ready?'var(--success)':'var(--warning)'};">${ready?'✓ Ready':'⚠ Setup'}</span></div><div class="db-td"><button class="db-action-btn" data-drid="${JSON.stringify(dr).replace(/"/g,'&quot;')}">Edit</button></div></div>`;}).join('')}</div>`;
    }catch(e){t.innerHTML=`<div style="color:var(--danger);padding:16px;">Error: ${e.message}</div>`;}
  },
  showAdminForm(){App.clearAdminForm();App.el('adminFormWrap').style.display='block';App.el('adminFormTitle').textContent='Add New Doctor';App.el('adminFormWrap').scrollIntoView({behavior:'smooth'});},
  hideAdminForm(){App.el('adminFormWrap').style.display='none';App.clearAdminForm();},
  adminEditDoctor(dr){
    App.el('adminEditUserId').value=dr.id||'';App.el('adminDrName').value=dr.doctor_name||'';App.el('adminDrEmail').value=dr.email||'';App.el('adminDrPassword').value='';App.el('adminSheetId').value=dr.intake_sheet_id||'';App.el('adminIntakeTab').value=dr.intake_tab_name||'Form Responses 1';App.el('adminAppsScript').value=dr.apps_script_url||'';App.el('adminGoogleKey').value='';App.el('adminAnthropicKey').value='';App.el('adminCollectionsId').value=dr.collections_sheet_id||'';
    // Notification settings
    if(App.el('adminNotifyPhone'))    App.el('adminNotifyPhone').value      = dr.notify_phone    || '';
    if(App.el('adminNotifyEmailAddr'))App.el('adminNotifyEmailAddr').value  = dr.notify_email    || '';
    if(App.el('adminNotifyWhatsapp')) App.el('adminNotifyWhatsapp').checked = !!dr.notify_whatsapp_enabled;
    if(App.el('adminNotifyEmail'))    App.el('adminNotifyEmail').checked    = !!dr.notify_email_enabled;
    App.setColMapDropdowns(dr.sheet_column_map||{});
    App.el('adminFormTitle').textContent='Edit — '+(dr.doctor_name||'Doctor');App.el('adminSaveBtn').textContent='Update Doctor';App.el('adminMsg').style.display='none';App.el('adminFormWrap').style.display='block';App.el('adminFormWrap').scrollIntoView({behavior:'smooth'});
  },
  clearAdminForm(){
    ['adminEditUserId','adminDrName','adminDrEmail','adminDrPassword','adminSheetId','adminAppsScript','adminGoogleKey','adminAnthropicKey','adminCollectionsId','adminNotifyPhone','adminNotifyEmailAddr'].forEach(id=>{const e=App.el(id);if(e)e.value='';});
    ['adminNotifyWhatsapp','adminNotifyEmail'].forEach(id=>{const e=App.el(id);if(e)e.checked=false;});
    if(App.el('adminIntakeTab'))App.el('adminIntakeTab').value='Form Responses 1';
    if(App.el('adminSaveBtn'))App.el('adminSaveBtn').textContent='Save Doctor';
    if(App.el('adminMsg'))App.el('adminMsg').style.display='none';
    if(App.el('colHeaderStatus')){App.el('colHeaderStatus').style.display='none';App.el('colHeaderStatus').textContent='';}
    App.setColMapDropdowns({});
  },
  async adminSave(){
    const btn=App.el('adminSaveBtn'),editId=App.el('adminEditUserId').value.trim();
    const colMap={fileNo:parseInt(App.el('colMapFileNo')?.value)||1,name:parseInt(App.el('colMapName')?.value)||2,funding:parseInt(App.el('colMapFunding')?.value)||10,medAid:parseInt(App.el('colMapMedAid')?.value)||11,plan:parseInt(App.el('colMapPlan')?.value)||12,membNo:parseInt(App.el('colMapMembNo')?.value)||13,depCode:parseInt(App.el('colMapDepCode')?.value)||14};
    const f={doctor_name:App.el('adminDrName').value.trim(),email:App.el('adminDrEmail').value.trim(),password:App.el('adminDrPassword').value.trim(),intake_sheet_id:App.el('adminSheetId').value.trim(),intake_tab_name:App.el('adminIntakeTab').value.trim()||'Form Responses 1',apps_script_url:App.el('adminAppsScript').value.trim(),google_key:App.el('adminGoogleKey').value.trim(),anthropic_key:App.el('adminAnthropicKey').value.trim(),collections_sheet_id:App.el('adminCollectionsId').value.trim()||null,sheet_column_map:colMap,notify_phone:App.el('adminNotifyPhone')?.value.trim()||'',notify_email:App.el('adminNotifyEmailAddr')?.value.trim()||'',notify_whatsapp_enabled:App.el('adminNotifyWhatsapp')?.checked||false,notify_email_enabled:App.el('adminNotifyEmail')?.checked||false};
    if(!f.doctor_name||!f.email||!f.intake_sheet_id||!f.collections_sheet_id||!f.apps_script_url){App.showAdminMsg('Fill in Name, Email, Intake Form ID, Collections Sheet ID and Apps Script URL.','error');return;}
    if(!editId&&(!f.google_key||!f.anthropic_key||!f.password)){App.showAdminMsg('Google key, Anthropic key and password required for new doctors.','error');return;}
    const p={...f};if(!p.google_key)delete p.google_key;if(!p.anthropic_key)delete p.anthropic_key;if(!p.password)delete p.password;
    btn.disabled=true;btn.textContent='Saving…';
    try{
      if(editId){await API.updateDoctor(editId,p);}else{await API.createDoctor(p);}
      App.showAdminMsg('✓ Saved!','success');App.clearAdminForm();App.el('adminFormWrap').style.display='none';await App.loadAdminDoctors();
    }catch(e){App.showAdminMsg('Error: '+e.message,'error');}
    finally{btn.disabled=false;btn.textContent=editId?'Update Doctor':'Save Doctor';}
  },
  showAdminMsg(msg,type){const e=App.el('adminMsg');e.textContent=msg;e.className='admin-msg '+type;e.style.display='block';},

  // Column-mapping helpers
  COL_MAP_DEFAULTS:{fileNo:1,name:2,funding:10,medAid:11,plan:12,membNo:13,depCode:14},
  COL_MAP_IDS:{fileNo:'colMapFileNo',name:'colMapName',funding:'colMapFunding',medAid:'colMapMedAid',plan:'colMapPlan',membNo:'colMapMembNo',depCode:'colMapDepCode'},

  // Populate each <select> with numbered options (plus any loaded header labels).
  // headers = array of header strings from row 1 (may be empty for default state).
  // values  = {fileNo:N, name:N, ...} — which option should be selected.
  buildColOptions(headers,values){
    const defaults=App.COL_MAP_DEFAULTS;
    Object.entries(App.COL_MAP_IDS).forEach(([key,selId])=>{
      const sel=App.el(selId);if(!sel)return;
      sel.innerHTML='';
      const maxCols=Math.max(headers.length,20);
      for(let i=0;i<maxCols;i++){
        const label=headers[i]?`Col ${i} — ${headers[i]}`:`Col ${i}`;
        const opt=document.createElement('option');
        opt.value=i;opt.textContent=label;
        if(i===(values[key]??defaults[key]))opt.selected=true;
        sel.appendChild(opt);
      }
    });
  },

  // Set dropdowns to stored values (or defaults if empty) without changing options.
  setColMapDropdowns(colMap){
    App.buildColOptions([],colMap);
  },

  async loadColHeaders(){
    const editId=App.el('adminEditUserId')?.value.trim();
    const statusEl=App.el('colHeaderStatus');
    if(!editId){App.showAdminMsg('Save the doctor first, then load headers.','error');return;}
    if(statusEl){statusEl.style.display='block';statusEl.textContent='Loading headers from sheet…';}
    try{
      const data=await API.getSheetHeaders(editId);
      const headers=data.headers||[];
      if(!headers.length){if(statusEl)statusEl.textContent='No headers found in row 1 of the sheet.';return;}
      // Read current selected values so we preserve them
      const cur={};
      Object.entries(App.COL_MAP_IDS).forEach(([key,selId])=>{const s=App.el(selId);if(s)cur[key]=parseInt(s.value);});
      App.buildColOptions(headers,cur);
      if(statusEl)statusEl.textContent=`✓ Loaded ${headers.length} columns from sheet row 1`;
    }catch(e){
      if(statusEl)statusEl.textContent='Could not load headers: '+e.message;
    }
  },

  // ═══════════════════════════════════════════════════════════
  // EVENT DELEGATION — one listener per container
  // ═══════════════════════════════════════════════════════════
  bindAll() {
    const on = (id, ev, fn) => { const e = App.el(id); if(e) e.addEventListener(ev, fn); };

    // ── Auth ─────────────────────────────────────────────
    on('loginEmail',   'input',  e => App.checkEmailInput(e.target.value));
    on('loginPassword','keydown',e => { if(e.key==='Enter') App.login(); });
    on('loginBtn',     'click',  ()=> App.login());
    on('adminLoginBtn','click',  ()=> App.adminLogin());
    on('adminLoginPassword','keydown',e=>{ if(e.key==='Enter') App.adminLogin(); });
    on('adminLoginEmail','input', e => { if(e.target.value.toLowerCase().trim()==='admin'){e.target.value='';App.showAdminLogin();} });

    // ── Header ────────────────────────────────────────────
    on('menuBtn',   'click', ()=> App.openSidebar());
    on('logoutBtn', 'click', ()=> App.logout());

    // ── Dashboard ─────────────────────────────────────────
    on('newBillingBtn',  'click', ()=> App.startNewBilling());
    on('scanStickerBtn', 'click', ()=> App.openSticker());

    // ── Patient search (screen 1) — EVENT DELEGATION ─────
    on('searchInput', 'input', e => {
      const q=e.target.value;const res=App.el('patientResults'),hint=App.el('searchHint');
      if(!q||q.trim().length<2){res.style.display='none';hint.style.display='block';return;}
      const m=App.filterPatients(q);hint.style.display='none';res.style.display='block';
      App.renderPatientResults(m,'patientResults',q);
    });
    App.el('patientResults')?.addEventListener('click', e => {
      const item=e.target.closest('.patient-item');if(!item)return;
      App.selectPatient(+item.dataset.idx);
    });
    on('backToDashBtn',   'click', ()=> App.showDashboard());
    on('openStickerFromSearchBtn','click',()=>App.openSticker());

    // ── Billing screen ────────────────────────────────────
    on('backToSearchBtn',  'click', ()=> App.goToScreen(1));
    on('changePatientBtn', 'click', ()=> App.goToScreen(1));
    App.el('billingTabs')?.addEventListener('click', e => {
      const tab=e.target.closest('.billing-tab');if(!tab)return;
      App.switchBillingMode(tab.dataset.mode);
    });
    on('recordBtn',       'click', ()=> App.toggleRecording());
    on('voiceReviewBtn',  'click', ()=> App.proceedToConfirm());
    on('manualApplyBtn',  'click', ()=> App.applyManualCodes());

    // Ward calendar — EVENT DELEGATION on calGrid
    on('wardToggleBtn','click', ()=> App.toggleWardCalendar());
    on('calPrevBtn',   'click', ()=> App.calPrevMonth());
    on('calNextBtn',   'click', ()=> App.calNextMonth());
    App.el('calGrid')?.addEventListener('click', e => {
      const day=e.target.closest('.cal-day:not(.cal-day-empty)');if(!day)return;
      App.toggleCalDate(day.dataset.date);
    });
    on('wardSaveBtn',  'click', ()=> App.saveWardVisits());
    on('wardCancelBtn','click', ()=> { App.el('wardCalendarWrap').style.display='none'; });
    // Ward chips remove — EVENT DELEGATION
    App.el('wardSummaryChips')?.addEventListener('click', e => {
      const btn=e.target.closest('.ward-chip-remove');if(!btn)return;
      App.removeWardVisit(+btn.dataset.wardidx);
    });

    // ── Confirm screen ────────────────────────────────────
    on('submitBtn',        'click', ()=> App.submitBilling());
    on('backToBillingBtn', 'click', ()=> App.goToScreen(2));

    // ── Success screen ────────────────────────────────────
    on('newBillingAfterSuccessBtn','click', ()=> App.startNewBilling());
    on('samePatientBtn',           'click', ()=> App.samePatientNewVisit());
    on('backToDashFromSuccessBtn', 'click', ()=> App.showDashboard());

    // ── Sticker ───────────────────────────────────────────
    on('stickerCameraBtn','click', ()=> App.el('stickerInput').click());
    on('stickerInput',    'change',e  => App.handleStickerFile(e.target.files[0]));
    on('confirmStickerBtn','click',()=> App.confirmSticker());
    on('rescanStickerBtn','click', ()=> App.rescanSticker());
    on('closeStickerBtn', 'click', ()=> App.closeSticker());

    // ── Revenue ───────────────────────────────────────────
    on('closeRevenueBtn',   'click', ()=> App.closeRevenue());
    on('refreshRevenueBtn', 'click', ()=> App.loadRevenue());

    // ── Sidebar ───────────────────────────────────────────
    on('closeSidebarBtn', 'click', ()=> App.closeSidebar());
    on('sidebarOverlay',  'click', ()=> App.closeSidebar());
    on('sidebar-nav-dashboard','click',()=>{ App.closeSidebar();App.showDashboard(); });
    on('sidebar-nav-billing',  'click',()=>{ App.closeSidebar();App.startNewBilling(); });
    on('sidebar-nav-scan',     'click',()=>App.openSticker());
    on('sidebarBillingLog',    'click',()=>{
      const dr=App.state.doctor;
      if(!dr?.intake_sheet_id){App.showToast('Sheet not configured',2000);return;}
      App.closeSidebar();
      // Open directly to Billing Log tab using range parameter
      const sheetId = dr.intake_sheet_id;
      App.el('sheetIframe').src=`https://docs.google.com/spreadsheets/d/${sheetId}/preview?rm=minimal&range=Billing+Log!A1`;
      App.el('sheetDirectLink').href=`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`;
      if(App.el('sheetModalTitle')) App.el('sheetModalTitle').textContent='Patient Intake Database';
      App.el('sheetModal').style.display='flex';
    });
    on('sidebarCollections',   'click',()=>{ const dr=App.state.doctor; App.openSheetModal(dr?.collections_sheet_id||dr?.intake_sheet_id,'Collections'); });
    on('sidebarSignOutBtn',    'click',()=>{ App.closeSidebar();App.logout(); });

    // Sidebar patient search — EVENT DELEGATION
    on('sidebarSearchInput','input', e => {
      const q=e.target.value;const res=App.el('sidebarSearchResults');
      App.el('sidebarPatientPanel').style.display='none';
      if(!q||q.trim().length<2){res.innerHTML='';res.style.display='none';return;}
      const m=App.filterPatients(q);res.style.display='block';
      App.renderPatientResults(m,'sidebarSearchResults',q);
    });
    App.el('sidebarSearchResults')?.addEventListener('click', e => {
      const item=e.target.closest('.patient-item');if(!item)return;
      App.showSidebarPatient(+item.dataset.idx);
    });
    on('sidebarBackToSearchBtn','click',()=>App.backToSidebarSearch());
    on('sidebarBillPatientBtn', 'click', e => {
      const idx=+e.currentTarget.dataset.idx;
      App.closeSidebar();
      App.state.selected=App.state.patients[idx];
      App.populatePatientCard(App.state.selected);
      App.el('dashboardScreen').style.display='none';
      App.el('stepsBar').style.display='flex';
      App.setTodayDate();App.resetCalendar();App.switchBillingMode('voice');
      App.goToScreen(2);
    });

    // ── Sheet modal ───────────────────────────────────────
    on('closeSheetBtn','click',()=>App.closeSheetModal());

    // ── Admin ─────────────────────────────────────────────
    on('showAdminFormBtn','click',  ()=>App.showAdminForm());
    on('hideAdminFormBtn','click',  ()=>App.hideAdminForm());
    on('adminCancelFormBtn','click',()=>App.hideAdminForm());
    on('adminSaveBtn','click',      ()=>App.adminSave());
    on('loadColHeadersBtn','click', ()=>App.loadColHeaders());
    on('adminRevenueBtn',    'click', ()=>App.toggleAdminRevenue());
    on('adminRefreshRevBtn', 'click', ()=>App.loadAdminRevenue());
    on('adminCloseRevBtn',   'click', ()=>{ App.el('adminRevenuePanel').style.display='none'; });
    on('exitAdminBtn','click',      ()=>App.exitAdmin());
    on('adminPwToggle',        'click', e=>App.togglePw('adminDrPassword',e.currentTarget));
    on('loginPwToggle',        'click', e=>App.togglePw('loginPassword',e.currentTarget));
    on('adminLoginPwToggle',   'click', e=>App.togglePw('adminLoginPassword',e.currentTarget));
    on('cancelAdminLoginBtn',  'click', ()=>App.hideAdminLogin());
    // T&C modal
    on('openTcBtn',   'click', ()=>{ App.el('tcModal').style.display='flex'; });
    on('closeTcBtn1', 'click', ()=>{ App.el('tcModal').style.display='none'; });
    on('closeTcBtn2', 'click', ()=>{ App.el('tcModal').style.display='none'; });
    // Admin table edit — EVENT DELEGATION
    App.el('adminDoctorTable')?.addEventListener('click', e => {
      const btn=e.target.closest('.db-action-btn');if(!btn)return;
      try{App.adminEditDoctor(JSON.parse(btn.dataset.drid.replace(/&quot;/g,'"')));}catch(_){}
    });

    // ── Collections screen ────────────────────────────────────
    on('closeCollectionsBtn',   'click', () => App.closeCollections());
    on('refreshCollectionsBtn', 'click', () => App.loadCollections());

    // ── Patient Status screen ─────────────────────────────────
    on('sidebarPatientStatus', 'click', () => { App.closeSidebar(); App.openPatientStatus(); });
    on('closePatientStatusBtn', 'click', () => App.closePatientStatus());
    on('refreshPatientStatusBtn', 'click', () => App.loadPatientStatus());
    App.el('psFilterBar')?.addEventListener('click', e => {
      const chip = e.target.closest('.ps-chip');
      if (!chip) return;
      App.el('psFilterBar').querySelectorAll('.ps-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      App.renderPatientStatusList(chip.dataset.filter);
    });
  },

  // ═══════════════════════════════════════════════════════════
  // COLLECTIONS SCREEN
  // ═══════════════════════════════════════════════════════════
  openCollections() {
    App.el('collectionsScreen').style.display = 'flex';
    App.loadCollections();
  },

  closeCollections() {
    App.el('collectionsScreen').style.display = 'none';
  },

  async loadCollections() {
    const body    = App.el('collectionsBody');
    const loading = App.el('collectionsLoading');
    body.innerHTML = '<div class="col-loading" id="collectionsLoading">Loading collections…</div>';
    try {
      const data = await API.getCollections();
      if (!data.available) {
        body.innerHTML = `<div class="col-loading">${data.message || 'Sheet not configured. Contact your administrator.'}</div>`;
        return;
      }
      if (data.empty) {
        body.innerHTML = '<div class="col-loading">No billing data yet. Submit a billing entry and run Billing → Refresh All in your sheet.</div>';
        return;
      }
      App.renderCollections(data);
    } catch (e) {
      body.innerHTML = '<div class="col-loading">Could not load collections. Please try again.</div>';
    }
  },

  renderCollections(d) {
    const fmt  = v => 'R ' + (v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const pct  = (v, t) => t > 0 ? Math.round((v / t) * 100) : 0;

    const ageLabels = [
      { key: 'd0',   label: '0 – 30 days',   cls: 'age-green'  },
      { key: 'd30',  label: '31 – 60 days',  cls: 'age-yellow' },
      { key: 'd60',  label: '61 – 90 days',  cls: 'age-orange' },
      { key: 'd90',  label: '91 – 120 days', cls: 'age-red'    },
      { key: 'd120', label: '120+ days',     cls: 'age-dark'   },
    ];

    const statusColor = s => {
      s = (s || '').toLowerCase();
      if (/^paid$|settled/.test(s))   return 'ps-status-green';
      if (/reject|written off/.test(s)) return 'ps-status-red';
      if (/gap/.test(s))              return 'ps-status-red';
      if (/unbilled/.test(s))         return 'ps-status-yellow';
      return 'ps-status-blue';
    };

    const totalOut = d.totals.outstanding || 0;

    let html = `
      <!-- Summary totals -->
      <div class="col-section">
        <div class="col-section-title">Summary</div>
        <div class="col-totals">
          <div class="col-total-card">
            <div class="col-total-label">Total Billed</div>
            <div class="col-total-value">${fmt(d.totals.billed)}</div>
          </div>
          <div class="col-total-card">
            <div class="col-total-label">Total Paid</div>
            <div class="col-total-value col-paid">${fmt(d.totals.paid)}</div>
          </div>
          <div class="col-total-card col-owed">
            <div class="col-total-label">Outstanding</div>
            <div class="col-total-value col-owed-val">${fmt(d.totals.outstanding)}</div>
          </div>
        </div>
      </div>

      <!-- Ageing analysis -->
      <div class="col-section">
        <div class="col-section-title">Ageing Analysis</div>
        ${ageLabels.map(({ key, label, cls }) => {
          const val = d.ageing[key] || 0;
          const w   = pct(val, totalOut);
          return `<div class="col-age-row">
            <div class="col-age-label">${label}</div>
            <div class="col-age-bar-wrap"><div class="col-age-bar ${cls}" style="width:${w}%"></div></div>
            <div class="col-age-amt">${fmt(val)}</div>
          </div>`;
        }).join('')}
      </div>

      <!-- By funding type -->
      <div class="col-section">
        <div class="col-section-title">By Funding Type</div>
        <table class="col-table">
          <thead><tr><th>Type</th><th>Billed</th><th>Paid</th><th>Outstanding</th></tr></thead>
          <tbody>
            ${d.byFunding.map(f => `<tr>
              <td>${f.name}</td>
              <td>${fmt(f.billed)}</td>
              <td>${fmt(f.paid)}</td>
              <td class="${f.outstanding > 0 ? 'col-owed-val' : ''}">${fmt(f.outstanding)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <!-- By status -->
      <div class="col-section">
        <div class="col-section-title">By Status</div>
        <div class="col-status-grid">
          ${d.byStatus.map(s => `
            <div class="col-status-row">
              <span class="ps-status-badge ${statusColor(s.name)}">${s.name}</span>
              <span class="col-status-count">${s.count} claim${s.count !== 1 ? 's' : ''}</span>
              ${s.outstanding > 0 ? `<span class="col-status-amt">${fmt(s.outstanding)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;

    // Outstanding patients list
    if (d.outstanding && d.outstanding.length > 0) {
      html += `
      <div class="col-section">
        <div class="col-section-title">Outstanding Patients (oldest first)</div>
        ${d.outstanding.map(p => `
          <div class="ps-card" style="margin-bottom:8px;">
            <div class="ps-card-top">
              <div class="ps-card-name">${p.patient || '—'}</div>
              <span class="ps-status-badge ${statusColor(p.status)}">${p.status}</span>
            </div>
            <div class="ps-card-meta">
              <span>${p.fileNo ? '#' + p.fileNo : ''}</span>
              <span>${p.dos || ''}</span>
              <span class="col-age-tag col-age-tag-${p.age > 120 ? 'dark' : p.age > 90 ? 'red' : p.age > 60 ? 'orange' : p.age > 30 ? 'yellow' : 'green'}">${p.age}d</span>
              <span>${p.medAid || p.funding || ''}</span>
            </div>
            <div class="ps-card-amount ps-outstanding">${fmt(p.outstanding)} outstanding</div>
          </div>
        `).join('')}
      </div>`;
    }

    App.el('collectionsBody').innerHTML = html;
  },

  // ═══════════════════════════════════════════════════════════
  // PATIENT STATUS SCREEN
  // ═══════════════════════════════════════════════════════════
  _psAllPatients: [],

  openPatientStatus() {
    App.el('patientStatusScreen').style.display = 'flex';
    // Reset filter to All
    App.el('psFilterBar')?.querySelectorAll('.ps-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    App.loadPatientStatus();
  },

  closePatientStatus() {
    App.el('patientStatusScreen').style.display = 'none';
  },

  async loadPatientStatus() {
    const container = App.el('psListContainer');
    const loading   = App.el('psLoading');
    if (loading) { loading.style.display = 'block'; loading.textContent = 'Loading patient status…'; }
    container.querySelectorAll('.ps-card').forEach(c => c.remove());
    try {
      const data = await API.getPatientStatus();
      App._psAllPatients = data.patients || [];
      if (!data.available) {
        if (loading) loading.textContent = 'Sheet not configured. Contact your administrator.';
        return;
      }
      if (loading) loading.style.display = 'none';
      const activeChip = App.el('psFilterBar')?.querySelector('.ps-chip.active');
      App.renderPatientStatusList(activeChip?.dataset.filter || 'all');
    } catch (e) {
      if (loading) { loading.style.display = 'block'; loading.textContent = 'Could not load status. Please try again.'; }
    }
  },

  renderPatientStatusList(filter) {
    const container = App.el('psListContainer');
    const loading   = App.el('psLoading');
    container.querySelectorAll('.ps-card').forEach(c => c.remove());

    const all = App._psAllPatients || [];
    const filtered = all.filter(p => {
      const s = (p.status || '').toLowerCase();
      if (filter === 'all')        return true;
      if (filter === 'unbilled')   return s === 'unbilled';
      if (filter === 'paid')       return /^paid$|settled/.test(s);
      if (filter === 'rejected')   return /reject|written off|gap/.test(s);
      if (filter === 'inprogress') return !['unbilled','paid','settled','rejected','written off','gap'].some(x => s === x || (x.length > 4 && s.includes(x)));
      return true;
    });

    if (filtered.length === 0) {
      if (loading) { loading.style.display = 'block'; loading.textContent = 'No patients match this filter.'; }
      return;
    }
    if (loading) loading.style.display = 'none';

    const frag = document.createDocumentFragment();
    filtered.forEach(p => {
      const s   = (p.status || 'Unbilled');
      const sc  = /^paid$|settled/i.test(s) ? 'ps-status-green'
                : /reject|written off/i.test(s) ? 'ps-status-red'
                : /gap/i.test(s) ? 'ps-status-red'
                : /unbilled/i.test(s) ? 'ps-status-yellow'
                : /billed|submitted|in process|awaiting|call|re-process|partial|partly|payment plan|patient to pay/i.test(s) ? 'ps-status-blue'
                : 'ps-status-grey';
      const card = document.createElement('div');
      card.className = 'ps-card';
      card.innerHTML = `
        <div class="ps-card-top">
          <div class="ps-card-name">${p.patient || '—'}</div>
          <span class="ps-status-badge ${sc}">${s}</span>
        </div>
        <div class="ps-card-meta">
          <span>${p.fileNo ? '#' + p.fileNo : ''}</span>
          <span>${p.dos || ''}</span>
          <span>${p.medAid || p.funding || ''}</span>
        </div>
        ${p.tariff || p.icd10 ? `<div class="ps-card-codes">${[p.tariff, p.icd10].filter(Boolean).join(' · ')}</div>` : ''}
        ${p.billed > 0 ? `<div class="ps-card-amount">${App.fmt(p.billed)}${p.outstanding > 0 ? ` · <span class="ps-outstanding">R${p.outstanding.toFixed(2)} outstanding</span>` : ''}</div>` : ''}
      `;
      frag.appendChild(card);
    });
    container.appendChild(frag);
  },
};

window.addEventListener('DOMContentLoaded', ()=> App.init());
