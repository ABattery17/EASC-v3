/* =====================================================================
   EAS•C  ⇄  Supabase integration            (easc-supabase.js)

   What it does
   ─ Login screen first: choose STUDENT or TEACHER, then sign in / sign up
   ─ Student : progress is loaded from and saved to Supabase automatically;
               sees the courseware exactly as it is (view only, no editing)
   ─ Teacher : everything a student sees, plus
               • LEARNER PROGRESS  – live table of every learner (+ CSV export)
               • EDIT MODULES      – edit objectives, content, worked examples,
                                     YouTube video, activity instructions and
                                     performance questions of Modules 1-5

   Setup
   1. Run supabase_schema.sql in the Supabase SQL editor.
   2. Paste your Project URL and anon (public) key below.
      (NEVER paste the service_role key in a browser file.)
   3. Load this file at the very end of index.html (the patched index.html
      already does this, after supabase-js and DOMPurify).
   ===================================================================== */
(function () {
  'use strict';

  /* ───────────── 1. CONFIG ───────────── */
  const SUPABASE_URL      = 'https://YOUR-PROJECT-REF.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

  // Built-in videos of Modules 1-2 (Modules 3-5 are read from the courseware itself)
  const LEGACY_VIDEO = { 1: '8IxJaU06qJA', 2: 'D3qFmPn1pgM' };
  const MODULE_NAMES = [
    'Null & Alternative Hypotheses', 'Level of Significance', 'Hypothesis Testing',
    'Correlation Analysis', 'Scatter Plot & Regression'
  ];
  // localStorage keys the original courseware uses for progress on this device
  const LOCAL_KEYS = ['EASC_progress_v4', 'EASC_cert_name'];

  /* ───────────── 2. SMALL HELPERS ───────────── */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = h => (window.DOMPurify ? window.DOMPurify.sanitize(String(h == null ? '' : h)) : String(h == null ? '' : h));
  const clone = o => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function toast(msg, kind) {
    let t = $('sbToast');
    if (!t) { t = document.createElement('div'); t.id = 'sbToast'; document.body.appendChild(t); }
    t.className = 'sb-toast show ' + (kind || '');
    t.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3800);
  }

  function parseYouTube(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (/^[\w-]{11}$/.test(v)) return v;
    const m = v.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : null;           // null = invalid
  }

  /* ───────────── 3. STYLES ───────────── */
  const css = `
  .sb-auth{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:20px;overflow:auto;
    background:radial-gradient(circle at 50% -10%,#0b3b70 0,#061a3b 40%,#020a1c 100%);color:#effaff;font-family:Inter,Segoe UI,Arial,sans-serif}
  .sb-auth[hidden]{display:none}
  .sb-card{width:min(560px,100%);border:1px solid #1670ac;border-radius:26px;padding:34px 34px 28px;
    background:linear-gradient(135deg,#061a3cf2,#08295af2);box-shadow:0 25px 90px #000a,0 0 45px #00bfff18}
  .sb-brand{display:flex;align-items:center;gap:14px;margin-bottom:22px}
  .sb-brand .mark{width:50px;height:50px;border-radius:15px;background:linear-gradient(135deg,#10caff,#0878ff);display:grid;place-items:center;font-size:26px;font-weight:900}
  .sb-brand b{font-size:26px;display:block}.sb-brand small{display:block;color:#9db9d8;font-size:10px;letter-spacing:.7px;margin-top:2px}
  .sb-card h2{margin:0 0 6px;font-size:22px}.sb-card .sb-sub{color:#9db9d8;font-size:13px;margin:0 0 20px;line-height:1.5}
  .sb-roles{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .sb-role{border:1px solid #1d659a;background:#0b2b54;color:#effaff;border-radius:18px;padding:22px 14px;text-align:center;transition:.2s}
  .sb-role:hover{border-color:#39d7ff;transform:translateY(-3px);box-shadow:0 0 28px #00bfff30}
  .sb-role span{display:block;font-size:40px;margin-bottom:8px}.sb-role b{display:block;font-size:16px}.sb-role small{display:block;color:#9db9d8;margin-top:6px;font-size:11px;line-height:1.4}
  .sb-tabs{display:flex;gap:8px;margin:0 0 16px}
  .sb-tab{flex:1;border:1px solid #1d659a;background:#0b2b54;color:#a9c2dd;border-radius:11px;padding:10px;font-weight:700}
  .sb-tab.on{background:linear-gradient(100deg,#08a9ed,#0877ff);color:#fff;border-color:transparent}
  .sb-field{display:block;margin:0 0 12px}.sb-field>span{display:block;font-size:12px;color:#9db9d8;margin-bottom:5px;letter-spacing:.3px}
  .sb-field input{width:100%;padding:12px 14px;border-radius:11px;border:1px solid #1d659a;background:#041832;color:#effaff;font:inherit}
  .sb-field input:focus{outline:none;border-color:#39d7ff;box-shadow:0 0 0 3px #20c8ff22}
  .sb-field small{display:block;color:#7f9cbc;font-size:11px;margin-top:4px}
  .sb-field[hidden]{display:none}
  .sb-msg{min-height:20px;margin:6px 0 10px;font-size:13px;line-height:1.5}.sb-msg.err{color:#ff8da1}.sb-msg.ok{color:#5ef0a2}
  .sb-go{width:100%}.sb-link{background:none;border:0;color:#72e7ff;padding:0;font-size:13px;margin-top:14px}
  .sb-link:hover{text-decoration:underline}
  .sb-who{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.5px;background:#0a5037;color:#7dffb9;margin-left:6px}
  .sb-who.teacher{background:#5a3d00;color:#ffd66b}

  #sbChip{position:static!important;margin-top:18px}
  .sidebar{overflow-y:auto}
  #sbChip b{display:block;font-size:12px;word-break:break-word}
  #sbChip .sb-row2{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
  #sbChip button{background:#0b2b54;border:1px solid #1d659a;color:#dff6ff;border-radius:8px;padding:5px 10px;font-size:11px}
  #sbChip button:hover{border-color:#39d7ff}
  #sbSync{font-size:10px;color:var(--muted)}
  .sb-navhead{font-size:10px;letter-spacing:2px;color:var(--cyan2);margin:14px 4px 2px;text-transform:uppercase}

  body.sb-role-teacher #pgTop,body.sb-role-teacher #dashboard .section:has(#pgList){display:none}

  .sb-toast{position:fixed;right:18px;bottom:18px;z-index:21000;max-width:360px;padding:12px 16px;border-radius:12px;
    background:#08234a;border:1px solid #17639a;color:#effaff;font-size:13px;box-shadow:0 10px 40px #0008;opacity:0;transform:translateY(12px);pointer-events:none;transition:.25s}
  .sb-toast.show{opacity:1;transform:none}.sb-toast.ok{border-color:#35e78b}.sb-toast.err{border-color:#ff6482}.sb-toast.warn{border-color:#ffd66b}

  .sb-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 14px}
  .sb-bar input,.sb-bar select{padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg2);color:var(--white);font:inherit}
  .sb-bar input{min-width:220px;flex:1}
  .sb-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 16px}
  .sb-stat{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:14px}
  .sb-stat b{display:block;font-size:26px;color:var(--cyan2)}.sb-stat span{font-size:11px;color:var(--muted);letter-spacing:.6px}
  .sb-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
  .sb-table{margin:0;min-width:900px}.sb-table th,.sb-table td{text-align:center;white-space:nowrap}
  .sb-table th:first-child,.sb-table td:first-child{text-align:left}
  .sb-table small{display:block;color:var(--muted);font-size:11px}
  .sb-ok{color:var(--good);font-weight:700}.sb-warn{color:var(--gold)}.sb-dim{color:var(--muted)}
  .sb-pbar{height:8px;min-width:90px;border-radius:99px;background:#102d52;overflow:hidden}.sb-pbar i{display:block;height:100%;background:linear-gradient(90deg,#0ba8ed,#74eaff)}

  .sb-mtabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
  .sb-mtab{border:1px solid var(--line);background:var(--panel);color:var(--white);border-radius:10px;padding:9px 14px;font-weight:700}
  .sb-mtab.on{background:linear-gradient(100deg,#08a9ed,#0877ff);color:#fff;border-color:transparent}
  #sbEdForm textarea,#sbEdForm input[type=text]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg2);color:var(--white);font:inherit;line-height:1.5}
  #sbEdForm textarea.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
  #sbEdForm .hint{font-size:12px;color:var(--muted);margin:0 0 8px;line-height:1.5}
  .sb-item{border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 10px;background:rgba(0,0,0,.12)}
  .sb-item .sb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;font-size:13px}
  .sb-opt{display:flex;gap:8px;align-items:center;margin:6px 0}.sb-opt input[type=text]{flex:1}
  .sb-opt input[type=radio]{accent-color:#18c6ff;width:18px;height:18px}
  .sb-mini{border:1px solid var(--line);background:var(--bg2);color:var(--white);border-radius:8px;padding:6px 10px;font-size:12px}
  .sb-mini:hover{border-color:var(--cyan)}.sb-mini.danger:hover{border-color:var(--bad);color:var(--bad)}
  .sb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;position:sticky;bottom:0;padding:12px 0;background:linear-gradient(transparent,var(--bg) 40%)}
  .sb-vprev{margin-top:10px;max-width:420px;aspect-ratio:16/9;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
  .sb-vprev iframe{width:100%;height:100%;border:0}
  @media(max-width:700px){.sb-roles{grid-template-columns:1fr}.sb-stats{grid-template-columns:1fr 1fr}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ───────────── 4. STATE ───────────── */
  let sb = null;                 // supabase client
  let ME = null;                 // { id, name, email, role }
  let chosenRole = null;         // role picked on the login screen
  let authMode = 'signin';       // 'signin' | 'signup'
  const DEFAULTS = {};           // built-in content snapshot per module
  const CONTENT_ROWS = {};       // rows currently stored in Supabase
  let LEARNERS = [];

  const C = () => window.EASC_CONTENT;

  /* ───────────── 5. CONTENT LAYER (built-in ⇄ teacher-edited) ───────────── */
  function snapshotDefaults() {
    const c = C();
    for (let n = 1; n <= 5; n++) {
      DEFAULTS[n] = {
        objectives:   clone(c.OBJ[n] || []),
        content_html: c.DISC[n] || '',
        examples:     clone(c.EX[n] || []),
        video_id:     c.VID[n] || LEGACY_VIDEO[n] || '',
        activity_html: c.ACT[n] || '',
        performance:  clone(c.WH[n] || []),
        _hadVID: Object.prototype.hasOwnProperty.call(c.VID, n)
      };
    }
    window.EASC_VID_OVERRIDE = window.EASC_VID_OVERRIDE || {};
  }

  function restoreDefaults(n) {
    const c = C(), d = DEFAULTS[n];
    c.OBJ[n] = clone(d.objectives);
    if (d.content_html) c.DISC[n] = d.content_html; else delete c.DISC[n];
    c.EX[n]  = clone(d.examples);
    if (d._hadVID) c.VID[n] = d.video_id; else delete c.VID[n];
    if (d.activity_html) c.ACT[n] = d.activity_html; else delete c.ACT[n];
    c.WH[n]  = clone(d.performance);
    window.EASC_VID_OVERRIDE[n] = false;
  }

  // row = a module_content row (null columns keep the built-in value)
  function applyRow(n, row) {
    restoreDefaults(n);
    if (!row) return;
    const c = C();
    if (row.objectives)        c.OBJ[n] = row.objectives.map(clean);
    if (row.content_html != null) c.DISC[n] = clean(row.content_html);
    if (row.examples)          c.EX[n]  = row.examples.map(e => [clean(e[0]), clean(e[1])]);
    if (row.video_id)        { c.VID[n] = row.video_id; window.EASC_VID_OVERRIDE[n] = true; }
    if (row.activity_html != null) c.ACT[n] = clean(row.activity_html);
    if (row.performance)       c.WH[n]  = row.performance.map(q => ({
      q: clean(q.q), o: (q.o || []).map(clean), a: +q.a || 0, w: clean(q.w || '')
    }));
  }

  async function loadContent() {
    const { data, error } = await sb.from('module_content').select('*').order('module_no');
    if (error) { console.warn('[EASC] module_content:', error); toast('Could not load edited lessons — showing the built-in content.', 'warn'); return; }
    (data || []).forEach(r => { CONTENT_ROWS[r.module_no] = r; applyRow(r.module_no, r); });
  }

  /* ───────────── 6. PROGRESS SYNC (students) ───────────── */
  let lastSaved = {}, pushing = false, syncTimer = null;

  function snap() {
    const o = {};
    for (let i = 1; i <= 6; i++) {
      const p = state.progress[i] || {};
      o[i] = (p.completed ? 1 : 0) + ':' + Math.round(+p.score || 0);
    }
    return o;
  }

  function setSync(s) {
    const e = $('sbSync'); if (!e) return;
    e.textContent = s === 'saving' ? '☁ Saving…' : s === 'error' ? '⚠ Offline — will retry' : '☁ Saved';
    e.style.color = s === 'error' ? 'var(--bad)' : '';
  }

  function clearLocalProgress() {
    LOCAL_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    Object.keys(state.progress).forEach(k => { state.progress[k].completed = false; state.progress[k].score = 0; });
  }

  async function loadProgress() {
    const { data, error } = await sb.from('module_progress')
      .select('module_no,completed,score').eq('user_id', ME.id);
    if (error) { console.warn('[EASC] progress load:', error); toast('Could not load your saved progress.', 'warn'); }
    (data || []).forEach(r => {
      const p = state.progress[r.module_no];
      if (p) { p.completed = !!r.completed; p.score = r.score || 0; }
    });
    lastSaved = snap();
    if (typeof window.EASC_refresh === 'function') window.EASC_refresh();
  }

  async function pushProgress() {
    if (!ME || ME.role !== 'student' || pushing) return;
    const now = snap(), rows = [];
    for (let i = 1; i <= 6; i++) {
      if (now[i] !== lastSaved[i]) {
        const p = state.progress[i];
        rows.push({
          user_id: ME.id, module_no: i, completed: !!p.completed,
          score: Math.max(0, Math.min(100, Math.round(+p.score || 0)))
        });
      }
    }
    if (!rows.length) return;
    pushing = true; setSync('saving');
    try {
      const { error } = await sb.from('module_progress').upsert(rows, { onConflict: 'user_id,module_no' });
      if (error) throw error;
      rows.forEach(r => { lastSaved[r.module_no] = now[r.module_no]; });
      setSync('ok');
    } catch (e) { console.warn('[EASC] progress save:', e); setSync('error'); }
    pushing = false;
  }

  function startProgressSync() {
    ['updateUIProgress', 'markModuleComplete'].forEach(fn => {
      const orig = window[fn];
      if (typeof orig !== 'function') return;
      window[fn] = function () { const r = orig.apply(this, arguments); setTimeout(pushProgress, 250); return r; };
    });
    syncTimer = setInterval(pushProgress, 2500);        // catches every other code path too
    window.addEventListener('pagehide', pushProgress);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pushProgress(); });
  }

  /* ───────────── 7. LOGIN SCREEN ───────────── */
  function buildAuth() {
    const d = document.createElement('div');
    d.id = 'sbAuth'; d.className = 'sb-auth';
    d.innerHTML = `
    <div class="sb-card">
      <div class="sb-brand"><div class="mark">Σ</div><div><b>EAS•C</b><small>ENHANCING ACTIVITIES IN STATISTICS COURSEWARE</small></div></div>

      <div id="sbStepRole">
        <h2>Welcome! Who is signing in?</h2>
        <p class="sb-sub">Choose your role to continue.</p>
        <div class="sb-roles">
          <button type="button" class="sb-role" data-role="student"><span>🎓</span><b>I'm a Student</b><small>Study the modules and save your progress</small></button>
          <button type="button" class="sb-role" data-role="teacher"><span>👩‍🏫</span><b>I'm a Teacher</b><small>Monitor all learners and edit the lessons</small></button>
        </div>
        <div class="sb-msg err" id="sbBootMsg"></div>
      </div>

      <form id="sbStepForm" hidden autocomplete="on">
        <h2 id="sbFormTitle">Sign in</h2>
        <p class="sb-sub" id="sbFormSub"></p>
        <div class="sb-tabs">
          <button type="button" class="sb-tab on" data-mode="signin">Sign in</button>
          <button type="button" class="sb-tab" data-mode="signup">Create account</button>
        </div>
        <label class="sb-field" id="sbNameRow" hidden><span>Full name (used on your certificate)</span><input id="sbName" type="text" autocomplete="name"></label>
        <label class="sb-field"><span>Email</span><input id="sbEmail" type="email" autocomplete="email" required></label>
        <label class="sb-field"><span>Password</span><input id="sbPass" type="password" autocomplete="current-password" minlength="6" required><small>At least 6 characters.</small></label>
        <label class="sb-field" id="sbCodeRow" hidden><span>Teacher access code</span><input id="sbCode" type="password" autocomplete="off"><small>Required the first time you use a teacher account. Ask your administrator.</small></label>
        <div class="sb-msg" id="sbMsg"></div>
        <button class="btn sb-go" id="sbSubmit" type="submit">Sign in</button>
        <button class="sb-link" id="sbBack" type="button">← Change role</button>
      </form>
    </div>`;
    document.body.appendChild(d);

    d.querySelectorAll('.sb-role').forEach(b => b.addEventListener('click', () => pickRole(b.dataset.role)));
    d.querySelectorAll('.sb-tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('sbBack').addEventListener('click', () => { $('sbStepForm').hidden = true; $('sbStepRole').hidden = false; setMsg(''); });
    $('sbStepForm').addEventListener('submit', onSubmitAuth);
  }

  function setMsg(t, kind) { const m = $('sbMsg'); if (m) { m.textContent = t || ''; m.className = 'sb-msg ' + (kind || ''); } }

  function pickRole(r) {
    chosenRole = r;
    $('sbStepRole').hidden = true; $('sbStepForm').hidden = false;
    $('sbCodeRow').hidden = r !== 'teacher';
    $('sbFormSub').innerHTML = 'Signing in as a <span class="sb-who ' + r + '">' + r.toUpperCase() + '</span>';
    setMode('signin'); setMsg('');
    $('sbEmail').focus();
  }

  function setMode(m) {
    authMode = m;
    document.querySelectorAll('#sbAuth .sb-tab').forEach(t => t.classList.toggle('on', t.dataset.mode === m));
    $('sbNameRow').hidden = m !== 'signup';
    $('sbFormTitle').textContent = m === 'signup' ? 'Create your account' : 'Sign in';
    $('sbSubmit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    $('sbPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    setMsg('');
  }

  async function onSubmitAuth(e) {
    e.preventDefault(); setMsg('');
    const btn = $('sbSubmit'); btn.disabled = true;
    const email = $('sbEmail').value.trim(), password = $('sbPass').value;
    const name = $('sbName').value.trim(), code = $('sbCode').value.trim();
    try {
      if (authMode === 'signup') {
        if (!name) throw new Error('Please enter your full name.');
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        if (!data.session) {   // email confirmation is switched on in Supabase
          setMode('signin');
          setMsg('Account created! Check your email to confirm it, then sign in here.', 'ok');
          return;
        }
        await afterLogin(data.session, code);
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await afterLogin(data.session, code);
      }
    } catch (err) {
      setMsg(err && err.message ? err.message : String(err), 'err');
    } finally { btn.disabled = false; }
  }

  async function loadProfile(uid) {
    for (let i = 0; i < 5; i++) {
      const { data, error } = await sb.from('profiles').select('id,full_name,email,role').eq('id', uid).maybeSingle();
      if (error) throw error;
      if (data) return data;
      await sleep(400);
    }
    throw new Error('Profile not found. Did you run supabase_schema.sql?');
  }

  async function afterLogin(session, code) {
    let prof = await loadProfile(session.user.id);

    if (chosenRole === 'teacher' && prof.role !== 'teacher') {
      if (!code) { await sb.auth.signOut(); throw new Error('Enter the teacher access code to use a teacher account.'); }
      const { data: ok, error } = await sb.rpc('claim_teacher_role', { p_code: code });
      if (error) { await sb.auth.signOut(); throw error; }
      if (!ok)   { await sb.auth.signOut(); throw new Error('Invalid teacher access code.'); }
      prof = await loadProfile(session.user.id);
    }
    if (chosenRole === 'student' && prof.role === 'teacher') {
      await sb.auth.signOut();
      throw new Error('This is a teacher account. Go back and choose "Teacher".');
    }
    await startApp(prof);
  }

  /* ───────────── 8. START / STOP THE APP ───────────── */
  async function startApp(prof) {
    ME = { id: prof.id, name: prof.full_name || prof.email || 'Learner', email: prof.email, role: prof.role };
    document.body.classList.add('sb-role-' + ME.role);

    clearLocalProgress();                          // never inherit another learner's local data
    await loadContent();                           // teacher-edited lessons (everyone)
    if (ME.role === 'student') {
      state.userName = String(ME.name).toUpperCase();
      await loadProgress();
      startProgressSync();
    }
    buildChip();
    if (ME.role === 'teacher') buildTeacherUI();

    sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', ME.id).then(() => {});
    $('sbAuth').hidden = true;
  }

  function buildChip() {
    const c = document.createElement('div');
    c.className = 'profile'; c.id = 'sbChip';
    c.innerHTML = `<b>${esc(ME.name)}</b><span>${esc(ME.email || '')}</span>
      <div class="sb-row2"><span class="sb-who ${ME.role}" style="margin:0">${ME.role.toUpperCase()}</span><button type="button" id="sbLogout">Log out</button></div>
      ${ME.role === 'student' ? '<span id="sbSync">☁ Saved</span>' : ''}`;
    document.querySelector('.sidebar').appendChild(c);
    $('sbLogout').addEventListener('click', logout);
  }

  async function logout() {
    if (ME && ME.role === 'student') await pushProgress();
    try { await sb.auth.signOut(); } catch (e) {}
    clearLocalProgress();
    location.reload();
  }

  /* ───────────── 9. TEACHER UI ───────────── */
  function buildTeacherUI() {
    const nav = document.querySelector('.nav');
    nav.insertAdjacentHTML('beforeend',
      '<div class="sb-navhead">Teacher</div>' +
      '<button type="button" id="sbNavProg">📊 &nbsp; LEARNER PROGRESS</button>' +
      '<button type="button" id="sbNavEdit">✎ &nbsp; EDIT MODULES</button>');
    $('sbNavProg').addEventListener('click', e => openProgress(e.currentTarget));
    $('sbNavEdit').addEventListener('click', e => openEditor(null, e.currentTarget));

    const main = document.querySelector('.main');
    main.insertAdjacentHTML('beforeend', `
    <section id="sbProgress" class="page">
      <div class="top"><div><div class="kicker">TEACHER</div><h2>LEARNER PROGRESS</h2>
        <div class="sub">Every registered student, with module scores and the written test.</div></div></div>
      <div class="sb-stats" id="sbStats"></div>
      <div class="sb-bar">
        <input id="sbSearch" type="search" placeholder="Search name or email…">
        <select id="sbSort"><option value="name">Sort: name</option><option value="progress">Sort: progress (high → low)</option><option value="recent">Sort: recent activity</option></select>
        <button type="button" class="btn secondary" id="sbRefresh">⟳ Refresh</button>
        <button type="button" class="btn secondary" id="sbCsv">⬇ Export CSV</button>
      </div>
      <div class="sb-wrap"><table class="sb-table"><thead><tr>
        <th>Learner</th>${[1, 2, 3, 4, 5].map(i => '<th>M' + i + '</th>').join('')}<th>Written test</th><th>Progress</th><th>Last activity</th>
      </tr></thead><tbody id="sbLearnerBody"></tbody></table></div>
    </section>

    <section id="sbEditor" class="page">
      <div class="top"><div><div class="kicker">TEACHER</div><h2>EDIT MODULES</h2>
        <div class="sub">Changes are saved to Supabase and appear for all learners the next time they open the module.</div></div></div>
      <div class="sb-mtabs" id="sbMTabs"></div>
      <div id="sbEdForm"></div>
    </section>`);

    $('sbSearch').addEventListener('input', renderLearners);
    $('sbSort').addEventListener('change', renderLearners);
    $('sbRefresh').addEventListener('click', loadLearners);
    $('sbCsv').addEventListener('click', exportCsv);

    // "Edit this module" shortcut inside every module page
    const bb = document.querySelector('#moduleView .backBtn');
    if (bb) {
      bb.insertAdjacentHTML('beforeend', ' <button type="button" class="btn secondary" id="sbEditThis">✎ Edit this module</button>');
      $('sbEditThis').addEventListener('click', () => {
        const n = state.currentModule;
        if (n >= 1 && n <= 5) openEditor(n, $('sbNavEdit')); else toast('Open Module 1–5 first to edit it.', 'warn');
      });
    }
  }

  /* ---- 9a. progress table ---- */
  function openProgress(btn) { showView('sbProgress', btn || $('sbNavProg')); loadLearners(); }

  async function loadLearners() {
    $('sbLearnerBody').innerHTML = '<tr><td colspan="9" class="sb-dim">Loading…</td></tr>';
    const { data, error } = await sb.from('learner_overview').select('*').order('full_name');
    if (error) {
      $('sbLearnerBody').innerHTML = '<tr><td colspan="9" style="color:var(--bad)">Could not load learners: ' + esc(error.message) + '</td></tr>';
      return;
    }
    LEARNERS = data || [];
    renderLearners();
  }

  const fmtDate = d => d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const overall = l => Math.round((l.modules_completed || 0) / 5 * 100);

  function renderLearners() {
    const q = ($('sbSearch').value || '').toLowerCase().trim();
    const sort = $('sbSort').value;
    let rows = LEARNERS.filter(l => ((l.full_name || '') + ' ' + (l.email || '')).toLowerCase().includes(q));
    rows.sort((a, b) =>
      sort === 'progress' ? overall(b) - overall(a) || (b.test_score - a.test_score)
      : sort === 'recent' ? String(b.last_activity || b.last_seen || '').localeCompare(String(a.last_activity || a.last_seen || ''))
      : String(a.full_name || a.email).localeCompare(String(b.full_name || b.email)));

    const attempted = LEARNERS.filter(l => l.test_score > 0);
    const avgProg = LEARNERS.length ? Math.round(LEARNERS.reduce((s, l) => s + overall(l), 0) / LEARNERS.length) : 0;
    const avgTest = attempted.length ? Math.round(attempted.reduce((s, l) => s + l.test_score, 0) / attempted.length) : 0;
    $('sbStats').innerHTML =
      `<div class="sb-stat"><b>${LEARNERS.length}</b><span>REGISTERED LEARNERS</span></div>
       <div class="sb-stat"><b>${avgProg}%</b><span>AVERAGE PROGRESS</span></div>
       <div class="sb-stat"><b>${LEARNERS.filter(l => l.test_passed).length}</b><span>PASSED WRITTEN TEST</span></div>
       <div class="sb-stat"><b>${attempted.length ? avgTest + '%' : '—'}</b><span>AVG TEST SCORE (ATTEMPTED)</span></div>`;

    const cell = (l, i) => l['m' + i + '_done'] ? `<span class="sb-ok">✓ ${l['m' + i + '_score']}%</span>`
      : l['m' + i + '_score'] ? `<span class="sb-warn">${l['m' + i + '_score']}%</span>` : '<span class="sb-dim">—</span>';

    $('sbLearnerBody').innerHTML = rows.length ? rows.map(l => `<tr>
      <td><b>${esc(l.full_name || '(no name)')}</b><small>${esc(l.email || '')}</small></td>
      ${[1, 2, 3, 4, 5].map(i => '<td>' + cell(l, i) + '</td>').join('')}
      <td>${l.test_passed ? `<span class="sb-ok">✓ Passed ${l.test_score}%</span>` : l.test_score ? `<span class="sb-warn">${l.test_score}%</span>` : '<span class="sb-dim">Not taken</span>'}</td>
      <td><div class="sb-pbar"><i style="width:${overall(l)}%"></i></div><small>${l.modules_completed || 0}/5 modules</small></td>
      <td>${fmtDate(l.last_activity || l.last_seen)}</td></tr>`).join('')
      : '<tr><td colspan="9" class="sb-dim">No learners found.</td></tr>';
  }

  function exportCsv() {
    const cellSafe = v => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const head = ['Name', 'Email', 'M1 score', 'M1 done', 'M2 score', 'M2 done', 'M3 score', 'M3 done', 'M4 score', 'M4 done', 'M5 score', 'M5 done',
      'Modules completed', 'Written test score', 'Written test passed', 'Last activity'];
    const lines = [head.map(cellSafe).join(',')].concat(LEARNERS.map(l => [
      l.full_name, l.email, l.m1_score, l.m1_done, l.m2_score, l.m2_done, l.m3_score, l.m3_done, l.m4_score, l.m4_done,
      l.m5_score, l.m5_done, l.modules_completed, l.test_score, l.test_passed, l.last_activity || l.last_seen || ''].map(cellSafe).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'easc-learner-progress.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---- 9b. module editor ---- */
  let edModule = 1, edDirty = false;

  function effective(n) {
    const d = DEFAULTS[n], r = CONTENT_ROWS[n] || {};
    return {
      objectives:    clone(r.objectives   != null ? r.objectives   : d.objectives),
      content_html:  r.content_html  != null ? r.content_html  : d.content_html,
      examples:      clone(r.examples     != null ? r.examples     : d.examples),
      video_id:      r.video_id      != null ? r.video_id      : d.video_id,
      activity_html: r.activity_html != null ? r.activity_html : d.activity_html,
      performance:   clone(r.performance  != null ? r.performance  : d.performance)
    };
  }

  function openEditor(n, btn) {
    showView('sbEditor', btn || $('sbNavEdit'));
    if (n == null) n = edModule;
    if (edDirty && n !== edModule && !confirm('Discard your unsaved changes to Module ' + edModule + '?')) n = edModule;
    renderEditor(n);
  }

  function renderEditor(n) {
    edModule = n; edDirty = false;
    $('sbMTabs').innerHTML = [1, 2, 3, 4, 5].map(i =>
      `<button type="button" class="sb-mtab ${i === n ? 'on' : ''}" data-n="${i}">Module ${String(i).padStart(2, '0')}</button>`).join('');
    $('sbMTabs').querySelectorAll('.sb-mtab').forEach(b => b.addEventListener('click', () => openEditor(+b.dataset.n)));

    const edited = !!CONTENT_ROWS[n];
    $('sbEdForm').innerHTML = `
      <section class="easc-part"><h2>MODULE ${String(n).padStart(2, '0')} — ${esc(MODULE_NAMES[n - 1].toUpperCase())}
        ${edited ? '<span class="sb-who teacher" style="margin-left:10px">CUSTOMISED</span>' : '<span class="sb-who" style="margin-left:10px">BUILT-IN CONTENT</span>'}</h2>
        <p class="hint">Fields you leave unchanged keep using the built-in lesson. Use “Reset to built-in” to remove all of your edits for this module.</p></section>

      <section class="easc-part"><h2>PART I — LEARNING OBJECTIVES</h2>
        <p class="hint">One objective per line.</p><textarea id="edObj" rows="6"></textarea></section>

      <section class="easc-part"><h2>PART II — CONTENT</h2>
        <p class="hint">HTML is allowed (&lt;p&gt;, &lt;b&gt;, &lt;ul&gt;, tables …). LaTeX works with <code>$…$</code> or <code>$$…$$</code>. Use <code>&amp;lt;</code> for a literal “&lt;”.</p>
        <textarea id="edContent" class="mono" rows="18"></textarea>
        <h3 class="sub2">Worked examples</h3><div id="edEx"></div>
        <button type="button" class="sb-mini" id="edAddEx">＋ Add example</button>
        <h3 class="sub2">Video lesson (YouTube)</h3>
        <p class="hint">Paste a YouTube link or the 11-character video ID. Leave it equal to the built-in video to keep the original.</p>
        <input type="text" id="edVid" placeholder="https://www.youtube.com/watch?v=…"><div id="edVidPrev"></div></section>

      <section class="easc-part"><h2>PART III — ACTIVITY INSTRUCTIONS</h2>
        <p class="hint">HTML allowed. (The interactive widgets and guide questions of the activity are part of the courseware code.)</p>
        <textarea id="edAct" class="mono" rows="10"></textarea></section>

      <section class="easc-part"><h2>PART IV — PERFORMANCE QUESTIONS</h2>
        <p class="hint">Select the radio button next to the correct choice. Learners see all questions of the module in this order.</p>
        <div id="edQ"></div><button type="button" class="sb-mini" id="edAddQ">＋ Add question</button></section>

      <div class="sb-actions">
        <button type="button" class="btn" id="edSave">💾 Save to Supabase</button>
        <button type="button" class="btn secondary" id="edPreview">👁 Preview (unsaved)</button>
        <button type="button" class="btn secondary" id="edReset">↺ Reset to built-in</button>
      </div>`;

    const v = effective(n);
    $('edObj').value = v.objectives.join('\n');
    $('edContent').value = v.content_html;
    $('edAct').value = v.activity_html;
    $('edVid').value = v.video_id;
    renderExamples(v.examples);
    renderQuestions(v.performance);
    updateVideoPreview();

    $('sbEdForm').oninput = () => { edDirty = true; };
    $('edVid').addEventListener('input', updateVideoPreview);
    $('edAddEx').addEventListener('click', () => { const cur = collectForm(true); cur.examples.push(['Example ' + (cur.examples.length + 1) + ': ', '']); renderExamples(cur.examples); edDirty = true; });
    $('edAddQ').addEventListener('click', () => { const cur = collectForm(true); cur.performance.push({ q: '', o: ['', '', ''], a: 0, w: '' }); renderQuestions(cur.performance); edDirty = true; });
    $('edSave').addEventListener('click', saveModule);
    $('edPreview').addEventListener('click', previewModule);
    $('edReset').addEventListener('click', resetModule);
  }

  function updateVideoPreview() {
    const id = parseYouTube($('edVid').value);
    $('edVidPrev').innerHTML = id
      ? `<div class="sb-vprev"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" allowfullscreen loading="lazy" title="Video preview"></iframe></div>`
      : (id === null ? '<p class="hint" style="color:var(--bad)">That does not look like a valid YouTube link or ID.</p>' : '');
  }

  function renderExamples(list) {
    const box = $('edEx'); box.innerHTML = '';
    list.forEach((ex, i) => {
      const d = document.createElement('div'); d.className = 'sb-item sb-ex';
      d.innerHTML = `<div class="sb-head"><span>Example ${i + 1}</span><button type="button" class="sb-mini danger">Remove</button></div>
        <input type="text" class="exT" placeholder="Title"><textarea class="exB" rows="3" placeholder="Worked example text"></textarea>`;
      d.querySelector('.exT').value = ex[0] || ''; d.querySelector('.exB').value = ex[1] || '';
      d.querySelector('button').addEventListener('click', () => { const cur = collectForm(true); cur.examples.splice(i, 1); renderExamples(cur.examples); edDirty = true; });
      box.appendChild(d);
    });
  }

  function renderQuestions(list) {
    const box = $('edQ'); box.innerHTML = '';
    list.forEach((q, i) => {
      const d = document.createElement('div'); d.className = 'sb-item sb-q';
      d.innerHTML = `<div class="sb-head"><span>Question ${i + 1}</span><button type="button" class="sb-mini danger qDel">Remove question</button></div>
        <textarea class="qQ" rows="2" placeholder="Question text"></textarea>
        <div class="qOpts"></div>
        <button type="button" class="sb-mini qAddO">＋ Add choice</button>
        <input type="text" class="qW" placeholder="Explanation shown after submitting" style="margin-top:8px">`;
      d.querySelector('.qQ').value = q.q || '';
      d.querySelector('.qW').value = q.w || '';
      const ob = d.querySelector('.qOpts');
      (q.o || []).forEach((o, j) => {
        const r = document.createElement('div'); r.className = 'sb-opt';
        r.innerHTML = `<input type="radio" name="qa${i}" value="${j}" ${+q.a === j ? 'checked' : ''} title="Correct answer"><input type="text" class="qO" placeholder="Choice ${String.fromCharCode(65 + j)}"><button type="button" class="sb-mini danger" title="Remove choice">✕</button>`;
        r.querySelector('.qO').value = o || '';
        r.querySelector('button').addEventListener('click', () => {
          const cur = collectForm(true);
          if (cur.performance[i].o.length <= 2) { toast('A question needs at least 2 choices.', 'warn'); return; }
          cur.performance[i].o.splice(j, 1);
          if (cur.performance[i].a === j) cur.performance[i].a = 0; else if (cur.performance[i].a > j) cur.performance[i].a--;
          renderQuestions(cur.performance); edDirty = true;
        });
        ob.appendChild(r);
      });
      d.querySelector('.qAddO').addEventListener('click', () => {
        const cur = collectForm(true);
        if (cur.performance[i].o.length >= 6) { toast('Maximum 6 choices.', 'warn'); return; }
        cur.performance[i].o.push(''); renderQuestions(cur.performance); edDirty = true;
      });
      d.querySelector('.qDel').addEventListener('click', () => { const cur = collectForm(true); cur.performance.splice(i, 1); renderQuestions(cur.performance); edDirty = true; });
      box.appendChild(d);
    });
  }

  // loose = true → no validation (used while re-rendering)
  function collectForm(loose) {
    const v = {
      objectives: $('edObj').value.split('\n').map(s => s.trim()).filter(Boolean),
      content_html: $('edContent').value.trim(),
      examples: [...document.querySelectorAll('#edEx .sb-ex')]
        .map(r => [r.querySelector('.exT').value.trim(), r.querySelector('.exB').value.trim()])
        .filter(e => loose || e[0] || e[1]),
      video_raw: $('edVid').value,
      video_id: parseYouTube($('edVid').value),
      activity_html: $('edAct').value.trim(),
      performance: [...document.querySelectorAll('#edQ .sb-q')].map(card => {
        const sel = card.querySelector('input[type=radio]:checked');
        return {
          q: card.querySelector('.qQ').value.trim(),
          o: [...card.querySelectorAll('.qO')].map(i => i.value.trim()),
          a: sel ? +sel.value : 0,
          w: card.querySelector('.qW').value.trim()
        };
      })
    };
    if (loose) return v;

    if (!v.objectives.length) throw new Error('Add at least one learning objective.');
    if (v.video_id === null) throw new Error('The video link is not a valid YouTube link or ID.');
    if (!v.performance.length) throw new Error('Add at least one performance question.');
    v.performance.forEach((q, i) => {
      if (!q.q) throw new Error('Question ' + (i + 1) + ' has no question text.');
      if (q.o.length < 2 || q.o.some(o => !o)) throw new Error('Question ' + (i + 1) + ' needs at least 2 choices and none may be empty.');
      if (q.a < 0 || q.a >= q.o.length) throw new Error('Question ' + (i + 1) + ': pick the correct answer.');
    });
    return v;
  }

  const normPerf = list => (list || []).map(q => ({
    q: String(q.q || '').trim(), o: (q.o || []).map(x => String(x).trim()), a: +q.a || 0, w: String(q.w || '').trim()
  }));
  const normEx = list => (list || []).map(e => [String(e[0] || '').trim(), String(e[1] || '').trim()]);

  // Turn the validated form values into a DB row (null = keep built-in)
  function toRow(n, v) {
    const d = DEFAULTS[n];
    return {
      module_no: n,
      objectives:    same(v.objectives, d.objectives.map(s => s.trim())) ? null : v.objectives,
      content_html:  v.content_html === (d.content_html || '').trim() ? null : v.content_html,
      examples:      same(v.examples, normEx(d.examples)) ? null : v.examples,
      video_id:      (!v.video_id || v.video_id === d.video_id) ? null : v.video_id,
      activity_html: v.activity_html === (d.activity_html || '').trim() ? null : v.activity_html,
      performance:   same(v.performance, normPerf(d.performance)) ? null : v.performance
    };
  }

  const isEmptyRow = r => ['objectives', 'content_html', 'examples', 'video_id', 'activity_html', 'performance'].every(k => r[k] == null);

  async function saveModule() {
    const n = edModule; let v;
    try { v = collectForm(false); } catch (e) { toast(e.message, 'err'); return; }
    const row = toRow(n, v);
    const btn = $('edSave'); btn.disabled = true;
    try {
      if (isEmptyRow(row)) {
        if (CONTENT_ROWS[n]) {
          const { error } = await sb.from('module_content').delete().eq('module_no', n);
          if (error) throw error;
          delete CONTENT_ROWS[n];
          applyRow(n, null);
          toast('Saved — Module ' + n + ' now matches the built-in content.', 'ok');
        } else toast('No changes to save.', 'warn');
      } else {
        const { data, error } = await sb.from('module_content').upsert(row, { onConflict: 'module_no' }).select().single();
        if (error) throw error;
        CONTENT_ROWS[n] = data; applyRow(n, data);
        toast('Module ' + n + ' saved ✓ — learners will see it next time they open it.', 'ok');
      }
      renderEditor(n);
    } catch (e) {
      console.warn('[EASC] save:', e);
      toast('Save failed: ' + (e.message || e), 'err');
    } finally { btn.disabled = false; }
  }

  function previewModule() {
    let v; try { v = collectForm(false); } catch (e) { toast(e.message, 'err'); return; }
    // apply the draft in memory only (nothing is written to Supabase)
    const draft = Object.assign({}, v, { video_id: v.video_id || null });
    applyRow(edModule, draft);
    toast('Previewing unsaved changes — click “Save to Supabase” to keep them.', 'warn');
    openModule(edModule);
  }

  async function resetModule() {
    const n = edModule;
    if (!confirm('Remove ALL custom edits of Module ' + n + ' and go back to the built-in lesson?')) return;
    try {
      if (CONTENT_ROWS[n]) {
        const { error } = await sb.from('module_content').delete().eq('module_no', n);
        if (error) throw error;
        delete CONTENT_ROWS[n];
      }
      applyRow(n, null);
      toast('Module ' + n + ' reset to built-in content.', 'ok');
      renderEditor(n);
    } catch (e) { toast('Reset failed: ' + (e.message || e), 'err'); }
  }

  /* ───────────── 10. BOOT ───────────── */
  async function boot() {
    buildAuth();
    const fail = msg => { $('sbBootMsg').textContent = msg; document.querySelectorAll('#sbAuth .sb-role').forEach(b => b.disabled = true); };

    if (typeof state === 'undefined' || !C()) { fail('This index.html is missing the EASC_CONTENT patch — use the patched index.html.'); return; }
    if (/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY)) { fail('Supabase is not configured yet. Open easc-supabase.js and set SUPABASE_URL and SUPABASE_ANON_KEY.'); return; }
    if (!window.supabase || !window.supabase.createClient) { fail('Could not load supabase-js (check your internet connection).'); return; }

    snapshotDefaults();
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    sb.auth.onAuthStateChange(evt => {
      if (evt === 'SIGNED_OUT' && ME) { clearLocalProgress(); location.reload(); }
    });

    // Returning visitor with a saved session → skip the login form
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) {
        const prof = await loadProfile(data.session.user.id);
        await startApp(prof);
      }
    } catch (e) {
      console.warn('[EASC] session restore:', e);
      try { await sb.auth.signOut(); } catch (_) {}
    }
  }

  window.EASC_SB = { openProgress, openEditor, logout, get user() { return ME; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
