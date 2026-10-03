/* =====================================================================
   EAS•C  ⇄  Supabase integration            (easc-supabase.js)

   Student : login → progress is loaded/saved automatically. View-only.
   Teacher : login, then
     • LEARNER PROGRESS   – table of every learner (+ CSV export)
     • ✎ Edit page        – click on any module page and edit its text
                            directly: objectives, discussion, definitions,
                            matrix/grid cards, tables, formulas, worked
                            examples, guided problems, activity text.
                            Bold / italic / lists / insert table / formulas.
     • VIDEO & QUESTIONS  – YouTube video, guide questions and performance
                            questions of Modules 1-5 (structured forms)
     • ⬇ EXPORT HTML      – downloads a new index.html with all edits baked
                            in, ready to replace the file on GitHub

   Setup: run supabase_schema.sql, then set the two values below.
   (Use the anon / public key only — never the service_role key.)
   ===================================================================== */
(function () {
  'use strict';

  /* ───────────── 1. CONFIG ───────────── */
  const SUPABASE_URL      = 'https://kfpambnrawqzhxwcomxo.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_2jrHl7Pc1G0MTETc002GUw_I11sqE0_';

  const LEGACY_VIDEO = { 1: '8IxJaU06qJA', 2: 'D3qFmPn1pgM' };   // built-in videos of Modules 1-2
  const MODULE_NAMES = [
    'Null & Alternative Hypotheses', 'Level of Significance', 'Hypothesis Testing',
    'Correlation Analysis', 'Scatter Plot & Regression'
  ];
  const LOCAL_KEYS = ['EASC_progress_v4', 'EASC_cert_name'];
  const EDIT_FIELDS = ['objectives', 'content_html', 'examples', 'video_id', 'activity_html', 'performance', 'guide', 'blocks'];

  // (the tag/marker names are built from pieces so this file never contains
  //  them as one contiguous string — the exporter searches the page source)
  const SC = 'scr' + 'ipt';
  const BAKED_ID = 'easc-baked-content';
  const MARK = '<!-- Supabase ' + 'integration';

  /* ───────────── 2. HELPERS ───────────── */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rmath = el => { try { if (typeof window.renderAllMath === 'function') window.renderAllMath(el); } catch (e) { console.warn(e); } };

  function toast(msg, kind) {
    let t = $('sbToast');
    if (!t) { t = document.createElement('div'); t.id = 'sbToast'; document.body.appendChild(t); }
    t.className = 'sb-toast show ' + (kind || '');
    t.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 4200);
  }

  function parseYouTube(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (/^[\w-]{11}$/.test(v)) return v;
    const m = v.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  /* ---- sanitising (DOMPurify when available, built-in fallback otherwise) ---- */
  function fallbackSanitize(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,select,textarea,frame,frameset,applet,svg,math').forEach(e => e.remove());
    t.content.querySelectorAll('*').forEach(e => {
      [...e.attributes].forEach(a => {
        const n = a.name.toLowerCase(), v = a.value.replace(/\s+/g, '').toLowerCase();
        if (n.indexOf('on') === 0 || (/^(href|src|xlink:href|action|formaction)$/.test(n) && /^(javascript|vbscript|data:text\/html)/.test(v))) e.removeAttribute(a.name);
      });
    });
    return t.innerHTML;
  }
  const TABLE_WRAP = {
    TABLE: ['<table>', '</table>', 'table'], THEAD: ['<table><thead>', '</thead></table>', 'thead'],
    TBODY: ['<table><tbody>', '</tbody></table>', 'tbody'], TFOOT: ['<table><tfoot>', '</tfoot></table>', 'tfoot'],
    TR: ['<table><tbody><tr>', '</tr></tbody></table>', 'tr']
  };
  // hostTag = tag name of the element whose innerHTML this is (tables need their wrapper to survive parsing)
  function sanitizeFragment(html, hostTag) {
    html = String(html == null ? '' : html);
    const w = TABLE_WRAP[String(hostTag || '').toUpperCase()];
    const input = w ? w[0] + html + w[1] : html;
    const out = window.DOMPurify ? window.DOMPurify.sanitize(input) : fallbackSanitize(input);
    if (!w) return out;
    const t = document.createElement('template');
    t.innerHTML = out;
    const host = t.content.querySelector(w[2]);
    return host ? host.innerHTML : '';
  }
  const clean = h => sanitizeFragment(h, 'DIV');

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

  .sb-toast{position:fixed;right:18px;bottom:18px;z-index:21000;max-width:380px;padding:12px 16px;border-radius:12px;
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

  /* ---- teacher bar on the module page ---- */
  .sb-tbar{position:sticky;top:0;z-index:60;margin:0 0 14px;padding:10px 12px;border:1px solid #6a5311;border-radius:14px;
    background:linear-gradient(135deg,#1d1a0b,#10223f);box-shadow:0 8px 28px #0007}
  .sb-tbar[hidden],.sb-trow[hidden]{display:none!important}
  .sb-trow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .sb-trow+.sb-trow{margin-top:8px;padding-top:8px;border-top:1px solid #ffffff18}
  .sb-tlabel{font-size:11px;letter-spacing:1.5px;color:#ffd66b}
  .sb-tb{border:1px solid var(--line);background:var(--bg2);color:var(--white);border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer}
  .sb-tb:hover:not(:disabled){border-color:var(--cyan)}.sb-tb:disabled{opacity:.4;cursor:not-allowed}
  .sb-tb.hot{background:linear-gradient(100deg,#08a9ed,#0877ff);border-color:transparent;color:#fff}
  .sb-tb.on{background:#7a5a00;border-color:#ffd66b;color:#fff}
  .sb-sep{width:1px;height:22px;background:#ffffff25;margin:0 4px}
  .sb-tstat{font-size:12px;color:var(--muted);margin-left:auto}.sb-tstat.dirty{color:#ffd66b;font-weight:700}
  .sb-hint{font-size:11px;color:var(--muted);flex-basis:100%}
  .sb-hint code{background:#0003;padding:1px 5px;border-radius:5px}
  .sb-eb-on{outline:1px dashed rgba(32,200,255,.55);outline-offset:3px;cursor:text;min-height:1em}
  .sb-eb-on:hover{outline-color:#ffd66b}
  .sb-eb-on:focus{outline:2px solid var(--cyan);background-color:rgba(32,200,255,.05)}
  body.sb-editing .answerBox{display:block!important}

  /* ---- form editor (video, guide, performance) ---- */
  .sb-mtabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
  .sb-mtab{border:1px solid var(--line);background:var(--panel);color:var(--white);border-radius:10px;padding:9px 14px;font-weight:700}
  .sb-mtab.on{background:linear-gradient(100deg,#08a9ed,#0877ff);color:#fff;border-color:transparent}
  #sbEdForm textarea,#sbEdForm input[type=text]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg2);color:var(--white);font:inherit;line-height:1.5}
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
  let sb = null, ME = null, chosenRole = null, authMode = 'signin';
  const DEFAULTS = {};       // content as shipped in the page (incl. baked/exported edits)
  const BAKED = {};          // edits baked into this index.html by a previous export
  const CONTENT_ROWS = {};   // edits stored in Supabase
  let LEARNERS = [];
  let EDITING = false, pageDirty = false, formDirty = false, AUTO_EDIT = 0, skippedPatches = 0;
  const C = () => window.EASC_CONTENT;

  /* ───────────── 5. CONTENT LAYER ───────────── */
  const ggToModel = g => {
    g = g || { title: '', questions: [] };
    return { title: g.title || '', questions: (g.questions || []).map(q => ({ q: q[0], o: clone(q[2] || []), a: Math.max(0, String(q[1] || 'a').charCodeAt(0) - 97) })) };
  };
  const modelToGG = m => ({ title: m.title, questions: m.questions.map(x => [x.q, String.fromCharCode(97 + (+x.a || 0)), x.o]) });

  function snapshotDefaults() {
    const c = C();
    window.EASC_VID_OVERRIDE = window.EASC_VID_OVERRIDE || {};
    for (let n = 1; n <= 5; n++) {
      DEFAULTS[n] = {
        objectives: clone(c.OBJ[n] || []), content_html: c.DISC[n] || '', examples: clone(c.EX[n] || []),
        video_id: c.VID[n] || LEGACY_VIDEO[n] || '', activity_html: c.ACT[n] || '',
        performance: clone(c.WH[n] || []), guide: ggToModel(c.GG && c.GG[n]),
        _hadVID: Object.prototype.hasOwnProperty.call(c.VID, n), _vidOv: !!window.EASC_VID_OVERRIDE[n]
      };
    }
  }

  function restoreDefaults(n) {
    const c = C(), d = DEFAULTS[n];
    c.OBJ[n] = clone(d.objectives);
    if (d.content_html) c.DISC[n] = d.content_html; else delete c.DISC[n];
    c.EX[n] = clone(d.examples);
    if (d._hadVID) c.VID[n] = d.video_id; else delete c.VID[n];
    if (d.activity_html) c.ACT[n] = d.activity_html; else delete c.ACT[n];
    c.WH[n] = clone(d.performance);
    if (c.GG) c.GG[n] = modelToGG(clone(d.guide));
    window.EASC_VID_OVERRIDE[n] = d._vidOv;
  }

  // Applies the data-driven fields of a row (blocks are applied after render, see section 6)
  function applyRow(n, row) {
    restoreDefaults(n);
    if (!row) return;
    const c = C();
    if (row.objectives) c.OBJ[n] = row.objectives.map(clean);
    if (row.content_html != null) c.DISC[n] = clean(row.content_html);
    if (row.examples) c.EX[n] = row.examples.map(e => [clean(e[0]), clean(e[1])]);
    if (row.video_id) { c.VID[n] = row.video_id; window.EASC_VID_OVERRIDE[n] = true; }
    if (row.activity_html != null) c.ACT[n] = clean(row.activity_html);
    if (row.performance) c.WH[n] = row.performance.map(q => ({ q: clean(q.q), o: (q.o || []).map(clean), a: +q.a || 0, w: clean(q.w || '') }));
    if (row.guide && row.guide.questions && c.GG) {
      c.GG[n] = modelToGG({
        title: clean(row.guide.title || ''),
        questions: row.guide.questions.map(x => ({ q: clean(x.q), o: (x.o || []).map(clean), a: +x.a || 0 }))
      });
    }
  }

  function readBaked() {
    const el = $(BAKED_ID);
    if (!el) return {};
    try { return (JSON.parse(el.textContent) || {}).modules || {}; }
    catch (e) { console.warn('[EASC] baked content unreadable:', e); return {}; }
  }

  async function loadContent() {
    const { data, error } = await sb.from('module_content').select('*').order('module_no');
    if (error) { console.warn('[EASC] module_content:', error); toast('Could not load edited lessons — showing the built-in content.', 'warn'); return; }
    (data || []).forEach(r => { CONTENT_ROWS[r.module_no] = r; applyRow(r.module_no, r); });
  }

  const effectiveBlocks = n => Object.assign({}, (BAKED[n] || {}).blocks || {}, (CONTENT_ROWS[n] || {}).blocks || {});

  async function upsertRow(n, fields) {
    const merged = Object.assign({}, CONTENT_ROWS[n] || {}, fields);
    if (EDIT_FIELDS.every(k => merged[k] == null)) {            // nothing left → remove the row
      if (CONTENT_ROWS[n]) {
        const { error } = await sb.from('module_content').delete().eq('module_no', n);
        if (error) throw error;
        delete CONTENT_ROWS[n];
      }
      return null;
    }
    const { data, error } = await sb.from('module_content').upsert(Object.assign({ module_no: n }, fields), { onConflict: 'module_no' }).select().single();
    if (error) throw error;
    CONTENT_ROWS[n] = data;
    return data;
  }

  /* ───────────── 6. ON-PAGE BLOCKS (the visual editor) ───────────── */
  // A "block" is a maximal piece of static page content (no inputs/buttons/ids).
  // Blocks get a stable key + a fingerprint, so edits can be re-applied on every load.
  const EB_BAD = /^(script|style|select|input|textarea|button|canvas|iframe|video|audio|object|embed|form|svg|math|option|optgroup|template|noscript|link|meta)$/i;
  const EB_SKIP = '#partPager,.pagerControls,.pagerSteps,.easc-video-wrap,.guideBlock,.comprehensionBlock,.guideQuestions,.interact,.wq,.wfb';
  const EB_DATAID = /^(vd|gd|wh)\d/;               // video / guide / performance containers → edited in the forms
  const TBL_HOST = /^(TABLE|THEAD|TBODY|TFOOT|TR)$/;

  const isKatex = el => el.classList && (el.classList.contains('katex') || el.classList.contains('katex-display'));
  const isSkip = el => el.matches(EB_SKIP) || EB_DATAID.test(el.id || '');
  function selfUnsafe(el) {
    if (EB_BAD.test(el.tagName) || isSkip(el)) return true;
    if (el.id && !/^ct\d$/.test(el.id)) return true;
    for (const a of el.attributes) if (/^on/i.test(a.name)) return true;
    return false;
  }
  function hasUnsafe(el, memo) {
    if (isKatex(el)) return false;
    if (memo.has(el)) return memo.get(el);
    let r = selfUnsafe(el);
    if (!r) for (const c of el.children) if (hasUnsafe(c, memo)) { r = true; break; }
    memo.set(el, r);
    return r;
  }
  function collectBlocks(el, out, memo) {
    if (isKatex(el) || isSkip(el)) return;
    if (!hasUnsafe(el, memo)) {
      if ((el.textContent || '').trim() || el.querySelector('img,table')) out.push(el);
      return;
    }
    for (const c of el.children) collectBlocks(c, out, memo);
  }

  function unrenderMath(root) {
    root.querySelectorAll('.katex-display').forEach(d => {
      const a = d.querySelector('annotation[encoding="application/x-tex"]');
      if (a) d.replaceWith(document.createTextNode('$$' + a.textContent + '$$'));
    });
    root.querySelectorAll('.katex').forEach(k => {
      const a = k.querySelector('annotation[encoding="application/x-tex"]');
      if (a) k.replaceWith(document.createTextNode('$' + a.textContent + '$'));
    });
  }
  function canon(el) {          // render-state independent text of a block (for the fingerprint)
    const c = el.cloneNode(true);
    unrenderMath(c);
    let t = c.textContent.replace(/[\u200b\u00a0]/g, ' ');
    t = t.replace(/\\\[([\s\S]*?)\\\]/g, (m, x) => '$$' + x + '$$').replace(/\\\(([\s\S]*?)\\\)/g, (m, x) => '$' + x + '$');
    return t.replace(/\s+/g, ' ').trim();
  }
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }

  function tagModule(tr) {
    [...tr.children].forEach((sec, pi) => {
      const out = [], memo = new Map();
      collectBlocks(sec, out, memo);
      out.forEach(el => {
        const path = [];
        for (let e = el; e !== sec; e = e.parentElement) path.unshift([...e.parentElement.children].indexOf(e));
        el.setAttribute('data-eb', pi + ':' + path.join('.'));
        el.setAttribute('data-eh', hash(canon(el)));
      });
    });
  }

  const hostsOf = el => TBL_HOST.test(el.tagName) ? [...el.querySelectorAll('td,th,caption')] : [el];

  function setBlockHtml(el, html) {
    el.innerHTML = sanitizeFragment(html, el.tagName);
    rmath(el);
  }
  function serializeBlock(el) {
    const c = el.cloneNode(true);
    unrenderMath(c);
    c.querySelectorAll('[contenteditable]').forEach(x => x.removeAttribute('contenteditable'));
    c.querySelectorAll('[spellcheck]').forEach(x => x.removeAttribute('spellcheck'));
    c.querySelectorAll('.sb-eb-on').forEach(x => { x.classList.remove('sb-eb-on'); if (!x.getAttribute('class')) x.removeAttribute('class'); });
    return sanitizeFragment(c.innerHTML, el.tagName);
  }

  function applyPatches(n, tr) {
    const blocks = effectiveBlocks(n);
    let skipped = 0;
    tr.querySelectorAll('[data-eb]').forEach(el => {
      const p = blocks[el.dataset.eb];
      if (!p) return;
      if (p.h !== el.dataset.eh) { skipped++; return; }
      setBlockHtml(el, p.html);
    });
    Object.keys(blocks).forEach(k => { if (!tr.querySelector('[data-eb="' + k + '"]')) skipped++; });
    return skipped;
  }

  function afterRender(n) {
    let tries = 0;
    const iv = setInterval(() => {
      const tr = $('pagerTrack' + n);
      if (tr && state.currentModule === n) { clearInterval(iv); processModule(n, tr); }
      else if (++tries > 70) clearInterval(iv);
    }, 80);
  }
  function processModule(n, tr) {
    if (tr.dataset.sbTagged) return;
    tr.dataset.sbTagged = '1';
    tagModule(tr);
    skippedPatches = applyPatches(n, tr);
    if (skippedPatches) console.warn('[EASC] ' + skippedPatches + ' saved edit(s) of Module ' + n + ' no longer match the page and were not applied.');
    if (ME && ME.role === 'teacher') {
      updateStatus();
      if (AUTO_EDIT === n) { AUTO_EDIT = 0; setEditing(true); }
    }
  }

  function installModuleHook() {
    const prev = window.openModule;
    window.openModule = function (n) {
      if (pageDirty && !confirm('You have unsaved edits on this page. Leave without saving?')) return;
      pageDirty = false; EDITING = false; skippedPatches = 0;
      document.body.classList.remove('sb-editing');
      const r = prev.apply(this, arguments);
      if (n >= 1 && n <= 5) afterRender(n);
      updateBar(n);
      return r;
    };
  }

  /* ───────────── 7. TEACHER BAR + EDIT MODE ───────────── */
  function setPageDirty(v) { pageDirty = v; updateStatus(); }
  function updateStatus() {
    const s = $('sbTstat'), sv = $('sbSavePage');
    if (!s) return;
    if (sv) sv.disabled = !pageDirty;
    if (pageDirty) { s.textContent = '● Unsaved changes'; s.className = 'sb-tstat dirty'; }
    else if (skippedPatches) { s.textContent = '⚠ ' + skippedPatches + ' saved edit(s) no longer match the page code'; s.className = 'sb-tstat dirty'; }
    else { s.textContent = EDITING ? 'Click any text to edit it' : ''; s.className = 'sb-tstat'; }
  }

  function updateBar(n) {
    const b = $('sbTbar');
    if (!b) return;
    b.hidden = !(n >= 1 && n <= 5);
    $('sbEditToggle').textContent = '✎ Edit page';
    $('sbEditToggle').classList.remove('on');
    $('sbFmt').hidden = true;
    updateStatus();
  }

  function setEditing(on) {
    const n = state.currentModule, tr = $('pagerTrack' + n);
    if (!tr) { toast('The page is still loading — try again in a moment.', 'warn'); return; }
    EDITING = on;
    document.body.classList.toggle('sb-editing', on);
    $('sbEditToggle').textContent = on ? '✔ Done editing' : '✎ Edit page';
    $('sbEditToggle').classList.toggle('on', on);
    $('sbFmt').hidden = !on;
    if (on) { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {} }
    tr.querySelectorAll('[data-eb]').forEach(el => {
      if (on) {
        unrenderMath(el);
        hostsOf(el).forEach(h => { h.contentEditable = 'true'; h.classList.add('sb-eb-on'); h.spellcheck = true; });
      } else {
        hostsOf(el).forEach(h => { h.removeAttribute('contenteditable'); h.removeAttribute('spellcheck'); h.classList.remove('sb-eb-on'); if (!h.getAttribute('class')) h.removeAttribute('class'); });
        rmath(el);
      }
    });
    updateStatus();
    if (on) toast('Edit mode ON — click any text on the page to change it. Use the Parts menu to move between Parts I–IV.', 'ok');
  }

  /* ---- selection helpers ---- */
  function inEditable() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return false;
    let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentElement;
    return !!(n && n.closest && n.closest('.sb-eb-on'));
  }
  function curCell() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentElement;
    const cell = n && n.closest && n.closest('td,th');
    if (!cell) return null;
    const tbl = cell.closest('table'), blk = tbl && tbl.closest('[data-eb]');
    return (blk && blk.contains(tbl)) ? cell : null;
  }

  function fmt(cmd) {
    if (!inEditable()) { toast('Click inside the text you want to change first.', 'warn'); return; }
    document.execCommand(cmd, false, null);
  }
  function insertFormula() {
    if (!inEditable()) { toast('Click where the formula should go first.', 'warn'); return; }
    document.execCommand('insertText', false, '$\\mu = 0$');
    toast('Formula inserted. Edit the LaTeX between the $ signs (e.g. $\\bar{x}$, $\\sigma^2$).', 'ok');
  }
  function insertTable() {
    if (!inEditable()) { toast('Click where the table should go first.', 'warn'); return; }
    const r = parseInt(prompt('How many rows (including the header row)?', '4'), 10);
    const c = parseInt(prompt('How many columns?', '3'), 10);
    if (!(r >= 1 && r <= 30 && c >= 1 && c <= 12)) return;
    let h = '<table><thead><tr>';
    for (let j = 0; j < c; j++) h += '<th>Heading ' + (j + 1) + '</th>';
    h += '</tr></thead><tbody>';
    for (let i = 1; i < r; i++) { h += '<tr>'; for (let j = 0; j < c; j++) h += '<td>&nbsp;</td>'; h += '</tr>'; }
    document.execCommand('insertHTML', false, h + '</tbody></table><p><br></p>');
  }
  function tblOp(op) {
    const cell = curCell();
    if (!cell) return;
    const tbl = cell.closest('table'), row = cell.parentElement, blk = tbl.closest('[data-eb]');
    const mk = tag => {
      const c = document.createElement(tag); c.innerHTML = '<br>';
      if (TBL_HOST.test(blk.tagName)) { c.contentEditable = 'true'; c.classList.add('sb-eb-on'); }
      return c;
    };
    if (op === 'rowAfter') {
      const nr = document.createElement('tr');
      [...row.cells].forEach(() => nr.appendChild(mk('td')));
      if (row.parentElement.tagName === 'THEAD') { const tb = tbl.tBodies[0] || tbl.appendChild(document.createElement('tbody')); tb.insertBefore(nr, tb.firstChild); }
      else row.after(nr);
    } else if (op === 'rowDel') {
      if (tbl.rows.length < 2) { toast('A table needs at least one row.', 'warn'); return; }
      row.remove();
    } else if (op === 'colAfter') {
      const idx = cell.cellIndex;
      [...tbl.rows].forEach(r => { const ref = r.cells[idx], nc = mk(ref && ref.tagName === 'TH' ? 'th' : 'td'); if (ref) ref.after(nc); else r.appendChild(nc); });
    } else if (op === 'colDel') {
      if (row.cells.length < 2) { toast('A table needs at least one column.', 'warn'); return; }
      const idx = cell.cellIndex;
      [...tbl.rows].forEach(r => { if (r.cells[idx]) r.cells[idx].remove(); });
    } else if (op === 'tblDel') {
      if (!confirm('Delete this whole table?')) return;
      if (tbl === blk) tbl.innerHTML = ''; else tbl.remove();
    }
    blk.dataset.sbDirty = '1';
    setPageDirty(true);
  }

  /* ---- save / reset of page edits ---- */
  function dirtyBlocks(n) { const tr = $('pagerTrack' + n); return tr ? [...tr.querySelectorAll('[data-eb][data-sb-dirty]')] : []; }
  function mergedBlocks(n, includeDirty) {
    const b = effectiveBlocks(n);
    if (includeDirty && state.currentModule === n) dirtyBlocks(n).forEach(el => { b[el.dataset.eb] = { h: el.dataset.eh, html: serializeBlock(el) }; });
    return b;
  }

  async function savePage() {
    const n = state.currentModule;
    if (!(n >= 1 && n <= 5)) return;
    const dirty = dirtyBlocks(n);
    if (!dirty.length) { toast('No changes to save.', 'warn'); return; }
    const btn = $('sbSavePage'); btn.disabled = true;
    try {
      const all = mergedBlocks(n, true), baked = (BAKED[n] || {}).blocks || {}, rowBlocks = {};
      Object.keys(all).forEach(k => { if (!(baked[k] && baked[k].html === all[k].html && baked[k].h === all[k].h)) rowBlocks[k] = all[k]; });
      await upsertRow(n, { blocks: Object.keys(rowBlocks).length ? rowBlocks : null });
      dirty.forEach(el => el.removeAttribute('data-sb-dirty'));
      setPageDirty(false);
      toast('Module ' + n + ' saved ✓ — learners see it the next time they open the module.', 'ok');
    } catch (e) {
      console.warn('[EASC] save page:', e);
      toast('Save failed: ' + (e.message || e), 'err');
      btn.disabled = false;
    }
  }

  async function resetModule(n) {
    if (!confirm('Remove ALL saved edits of Module ' + n + ' (text, video, questions) and go back to the version shipped in the page?')) return;
    try {
      await upsertRow(n, EDIT_FIELDS.reduce((o, k) => (o[k] = null, o), {}));
      applyRow(n, null);
      pageDirty = false; formDirty = false;
      toast('Module ' + n + ' reset.', 'ok');
      if (state.currentModule === n && $('pagerTrack' + n)) window.openModule(n);
      if ($('sbEditor') && $('sbEditor').classList.contains('active')) renderEditor(n);
    } catch (e) { toast('Reset failed: ' + (e.message || e), 'err'); }
  }

  /* ---- build the teacher bar ---- */
  function buildTeacherBar() {
    const shell = document.querySelector('#moduleView .moduleShell');
    if (!shell || $('sbTbar')) return;
    shell.insertAdjacentHTML('afterbegin', `
    <div class="sb-tbar" id="sbTbar" hidden>
      <div class="sb-trow">
        <b class="sb-tlabel">TEACHER</b>
        <button type="button" class="sb-tb hot" id="sbEditToggle">✎ Edit page</button>
        <button type="button" class="sb-tb" id="sbSavePage" disabled>💾 Save</button>
        <button type="button" class="sb-tb" id="sbVidQ">🎞 Video &amp; questions</button>
        <button type="button" class="sb-tb" id="sbExportBtn">⬇ Export HTML</button>
        <button type="button" class="sb-tb" id="sbResetBtn">↺ Reset module</button>
        <span class="sb-tstat" id="sbTstat"></span>
      </div>
      <div class="sb-trow" id="sbFmt" hidden>
        <button type="button" class="sb-tb" data-cmd="bold" title="Bold"><b>B</b></button>
        <button type="button" class="sb-tb" data-cmd="italic" title="Italic"><i>I</i></button>
        <button type="button" class="sb-tb" data-cmd="underline" title="Underline"><u>U</u></button>
        <button type="button" class="sb-tb" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
        <button type="button" class="sb-tb" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
        <button type="button" class="sb-tb" data-cmd="subscript" title="Subscript">x₂</button>
        <button type="button" class="sb-tb" data-cmd="superscript" title="Superscript">x²</button>
        <button type="button" class="sb-tb" data-cmd="removeFormat" title="Clear formatting">Tx</button>
        <span class="sb-sep"></span>
        <button type="button" class="sb-tb" id="sbFormula" title="Insert a formula">∑ Formula</button>
        <button type="button" class="sb-tb" id="sbTbl" title="Insert a table">▦ Insert table</button>
        <span class="sb-sep"></span>
        <button type="button" class="sb-tb" data-tbl="rowAfter" disabled>＋ Row</button>
        <button type="button" class="sb-tb" data-tbl="rowDel" disabled>－ Row</button>
        <button type="button" class="sb-tb" data-tbl="colAfter" disabled>＋ Col</button>
        <button type="button" class="sb-tb" data-tbl="colDel" disabled>－ Col</button>
        <button type="button" class="sb-tb" data-tbl="tblDel" disabled>✕ Table</button>
        <span class="sb-hint">Formulas use LaTeX between dollar signs, e.g. <code>$\\mu = 45$</code>, <code>$\\bar{x}$</code>. The row/column buttons work when the cursor is inside a table. The video, guide questions and performance questions are edited under “Video &amp; questions”.</span>
      </div>
    </div>`);

    $('sbEditToggle').addEventListener('click', () => setEditing(!EDITING));
    $('sbSavePage').addEventListener('click', savePage);
    $('sbVidQ').addEventListener('click', () => openEditor(state.currentModule));
    $('sbExportBtn').addEventListener('click', exportHtml);
    $('sbResetBtn').addEventListener('click', () => resetModule(state.currentModule));
    $('sbFmt').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // keep the text selection
    $('sbFmt').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cmd) fmt(b.dataset.cmd);
      else if (b.dataset.tbl) tblOp(b.dataset.tbl);
      else if (b.id === 'sbFormula') insertFormula();
      else if (b.id === 'sbTbl') insertTable();
    });

    const mc = $('moduleContainer');
    mc.addEventListener('input', e => {
      if (!EDITING) return;
      const blk = e.target.closest && e.target.closest('[data-eb]');
      if (blk) { blk.dataset.sbDirty = '1'; setPageDirty(true); }
    });
    mc.addEventListener('paste', e => {                         // paste as plain text (no Word/web junk)
      if (!EDITING || !(e.target.closest && e.target.closest('.sb-eb-on'))) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    ['drop', 'dragover'].forEach(t => mc.addEventListener(t, e => { if (EDITING && e.target.closest && e.target.closest('.sb-eb-on')) e.preventDefault(); }));
    document.addEventListener('selectionchange', () => {
      if (!EDITING) return;
      const c = !!curCell();
      document.querySelectorAll('#sbFmt [data-tbl]').forEach(b => { b.disabled = !c; });
    });
    window.addEventListener('beforeunload', e => { if (pageDirty || formDirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* ───────────── 8. FORM EDITOR (video · guide · performance) ───────────── */
  let edModule = 1;
  const markFormDirty = () => { formDirty = true; };

  function effective(n) {
    const d = DEFAULTS[n], r = CONTENT_ROWS[n] || {};
    return {
      video_id: r.video_id != null ? r.video_id : d.video_id,
      guide: clone(r.guide != null ? r.guide : d.guide),
      performance: clone(r.performance != null ? r.performance : d.performance)
    };
  }

  function openEditor(n, btn) {
    if (n == null) n = edModule;
    if (formDirty && $('sbEditor').classList.contains('active') && n !== edModule && !confirm('Discard your unsaved changes to Module ' + edModule + '?')) n = edModule;
    showView('sbEditor', btn || $('sbNavEdit'));
    renderEditor(n);
  }

  function renderEditor(n) {
    edModule = n; formDirty = false;
    $('sbMTabs').innerHTML = [1, 2, 3, 4, 5].map(i =>
      `<button type="button" class="sb-mtab ${i === n ? 'on' : ''}" data-n="${i}">Module ${String(i).padStart(2, '0')}</button>`).join('');
    $('sbMTabs').querySelectorAll('.sb-mtab').forEach(b => b.addEventListener('click', () => openEditor(+b.dataset.n)));

    const edited = !!(CONTENT_ROWS[n] || BAKED[n]);
    $('sbEdForm').innerHTML = `
      <section class="easc-part"><h2>MODULE ${String(n).padStart(2, '0')} — ${esc(MODULE_NAMES[n - 1].toUpperCase())}
        ${edited ? '<span class="sb-who teacher" style="margin-left:10px">CUSTOMISED</span>' : '<span class="sb-who" style="margin-left:10px">BUILT-IN CONTENT</span>'}</h2>
        <p class="hint">Lesson text, discussions, definitions, tables, formulas, worked examples and activity text are edited <b>directly on the module page</b>.</p>
        <button type="button" class="btn" id="edOpenPage">✎ Open Module ${n} and edit the page →</button></section>

      <section class="easc-part"><h2>PART II — VIDEO LESSON (YouTube)</h2>
        <p class="hint">Paste a YouTube link or the 11-character video ID.</p>
        <input type="text" id="edVid" placeholder="https://www.youtube.com/watch?v=…"><div id="edVidPrev"></div></section>

      <section class="easc-part"><h2>PART III — GUIDE QUESTIONS</h2>
        <p class="hint">Select the radio button next to the correct choice.</p>
        <input type="text" id="edGTitle" placeholder="Guide title" style="margin-bottom:10px">
        <div id="edG"></div><button type="button" class="sb-mini" id="edAddG">＋ Add guide question</button></section>

      <section class="easc-part"><h2>PART IV — PERFORMANCE QUESTIONS</h2>
        <p class="hint">Select the radio button next to the correct choice. Learners see the questions in this order.</p>
        <div id="edQ"></div><button type="button" class="sb-mini" id="edAddQ">＋ Add question</button></section>

      <div class="sb-actions">
        <button type="button" class="btn" id="edSave">💾 Save to Supabase</button>
        <button type="button" class="btn secondary" id="edPreview">👁 Preview (unsaved)</button>
        <button type="button" class="btn secondary" id="edReset">↺ Reset module</button>
        <button type="button" class="btn secondary" id="edExport">⬇ Export HTML</button>
      </div>`;

    const v = effective(n);
    $('edVid').value = v.video_id;
    $('edGTitle').value = v.guide.title;
    renderQList('edG', v.guide.questions, { explain: false, label: 'Guide question' });
    renderQList('edQ', v.performance, { explain: true, label: 'Question' });
    updateVideoPreview();

    $('sbEdForm').oninput = markFormDirty;
    $('edVid').addEventListener('input', updateVideoPreview);
    $('edOpenPage').addEventListener('click', () => {
      if (formDirty && !confirm('You have unsaved changes in this form. Leave without saving?')) return;
      formDirty = false; AUTO_EDIT = n; window.openModule(n);
    });
    $('edAddG').addEventListener('click', () => qMutate('edG', false, { explain: false, label: 'Guide question' }, cur => cur.push({ q: '', o: ['', '', ''], a: 0 })));
    $('edAddQ').addEventListener('click', () => qMutate('edQ', true, { explain: true, label: 'Question' }, cur => cur.push({ q: '', o: ['', '', ''], a: 0, w: '' })));
    $('edSave').addEventListener('click', saveForm);
    $('edPreview').addEventListener('click', previewForm);
    $('edReset').addEventListener('click', () => resetModule(n));
    $('edExport').addEventListener('click', exportHtml);
  }

  function updateVideoPreview() {
    const id = parseYouTube($('edVid').value);
    $('edVidPrev').innerHTML = id
      ? `<div class="sb-vprev"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" allowfullscreen loading="lazy" title="Video preview"></iframe></div>`
      : (id === null ? '<p class="hint" style="color:var(--bad)">That does not look like a valid YouTube link or ID.</p>' : '');
  }

  function qMutate(boxId, explain, opts, fn) {
    const cur = collectQList(boxId, explain);
    fn(cur);
    renderQList(boxId, cur, opts);
    markFormDirty();
  }

  function renderQList(boxId, list, opts) {
    const box = $(boxId); box.innerHTML = '';
    list.forEach((q, i) => {
      const d = document.createElement('div'); d.className = 'sb-item sb-q';
      d.innerHTML = `<div class="sb-head"><span>${opts.label} ${i + 1}</span><button type="button" class="sb-mini danger qDel">Remove</button></div>
        <textarea class="qQ" rows="2" placeholder="Question text"></textarea>
        <div class="qOpts"></div>
        <button type="button" class="sb-mini qAddO">＋ Add choice</button>
        ${opts.explain ? '<input type="text" class="qW" placeholder="Explanation shown after submitting" style="margin-top:8px">' : ''}`;
      d.querySelector('.qQ').value = q.q || '';
      if (opts.explain) d.querySelector('.qW').value = q.w || '';
      const ob = d.querySelector('.qOpts');
      (q.o || []).forEach((o, j) => {
        const r = document.createElement('div'); r.className = 'sb-opt';
        r.innerHTML = `<input type="radio" name="${boxId}_a${i}" value="${j}" ${+q.a === j ? 'checked' : ''} title="Correct answer"><input type="text" class="qO" placeholder="Choice ${String.fromCharCode(65 + j)}"><button type="button" class="sb-mini danger" title="Remove choice">✕</button>`;
        r.querySelector('.qO').value = o || '';
        r.querySelector('button').addEventListener('click', () => qMutate(boxId, opts.explain, opts, cur => {
          if (cur[i].o.length <= 2) { toast('A question needs at least 2 choices.', 'warn'); return; }
          cur[i].o.splice(j, 1);
          if (cur[i].a === j) cur[i].a = 0; else if (cur[i].a > j) cur[i].a--;
        }));
        ob.appendChild(r);
      });
      d.querySelector('.qAddO').addEventListener('click', () => qMutate(boxId, opts.explain, opts, cur => {
        if (cur[i].o.length >= 6) { toast('Maximum 6 choices.', 'warn'); return; }
        cur[i].o.push('');
      }));
      d.querySelector('.qDel').addEventListener('click', () => qMutate(boxId, opts.explain, opts, cur => { cur.splice(i, 1); }));
      box.appendChild(d);
    });
  }

  function collectQList(boxId, explain) {
    return [...document.querySelectorAll('#' + boxId + ' .sb-q')].map(card => {
      const sel = card.querySelector('input[type=radio]:checked');
      const o = { q: card.querySelector('.qQ').value.trim(), o: [...card.querySelectorAll('.qO')].map(i => i.value.trim()), a: sel ? +sel.value : 0 };
      if (explain) o.w = card.querySelector('.qW').value.trim();
      return o;
    });
  }

  const normPerf = list => (list || []).map(q => ({ q: String(q.q || '').trim(), o: (q.o || []).map(x => String(x).trim()), a: +q.a || 0, w: String(q.w || '').trim() }));
  const normGuide = g => ({ title: String((g && g.title) || '').trim(), questions: ((g && g.questions) || []).map(q => ({ q: String(q.q || '').trim(), o: (q.o || []).map(x => String(x).trim()), a: +q.a || 0 })) });

  function collectForm() {
    const v = {
      video_id: parseYouTube($('edVid').value),
      guide: { title: $('edGTitle').value.trim(), questions: collectQList('edG', false) },
      performance: collectQList('edQ', true)
    };
    if (v.video_id === null) throw new Error('The video link is not a valid YouTube link or ID.');
    if (!v.guide.questions.length) throw new Error('Add at least one guide question.');
    if (!v.performance.length) throw new Error('Add at least one performance question.');
    [['Guide question', v.guide.questions], ['Question', v.performance]].forEach(([lab, list]) => list.forEach((q, i) => {
      if (!q.q) throw new Error(lab + ' ' + (i + 1) + ' has no question text.');
      if (q.o.length < 2 || q.o.some(o => !o)) throw new Error(lab + ' ' + (i + 1) + ' needs at least 2 choices and none may be empty.');
      if (q.a < 0 || q.a >= q.o.length) throw new Error(lab + ' ' + (i + 1) + ': pick the correct answer.');
    }));
    return v;
  }

  function formToFields(n, v) {
    const d = DEFAULTS[n];
    return {
      video_id: (!v.video_id || v.video_id === d.video_id) ? null : v.video_id,
      guide: same(normGuide(v.guide), normGuide(d.guide)) ? null : normGuide(v.guide),
      performance: same(normPerf(v.performance), normPerf(d.performance)) ? null : normPerf(v.performance)
    };
  }

  async function saveForm() {
    const n = edModule; let v;
    try { v = collectForm(); } catch (e) { toast(e.message, 'err'); return; }
    const btn = $('edSave'); btn.disabled = true;
    try {
      await upsertRow(n, formToFields(n, v));
      applyRow(n, CONTENT_ROWS[n] || null);
      formDirty = false;
      toast('Module ' + n + ' saved ✓ — learners see it the next time they open the module.', 'ok');
      renderEditor(n);
    } catch (e) { console.warn('[EASC] save:', e); toast('Save failed: ' + (e.message || e), 'err'); }
    finally { btn.disabled = false; }
  }

  function previewForm() {
    let v; try { v = collectForm(); } catch (e) { toast(e.message, 'err'); return; }
    applyRow(edModule, Object.assign({}, CONTENT_ROWS[edModule] || {}, { video_id: v.video_id || null, guide: normGuide(v.guide), performance: normPerf(v.performance) }));
    toast('Previewing unsaved changes — click “Save to Supabase” to keep them.', 'warn');
    formDirty = false;
    window.openModule(edModule);
  }

  /* ───────────── 9. EXPORT HTML (edits baked into index.html) ───────────── */
  function bakedFor(n) {
    const r = CONTENT_ROWS[n] || {}, b = BAKED[n] || {}, out = {};
    ['objectives', 'content_html', 'examples', 'video_id', 'activity_html', 'performance', 'guide'].forEach(k => {
      const v = r[k] != null ? r[k] : b[k];
      if (v != null) out[k] = v;
    });
    const blocks = mergedBlocks(n, true);
    if (Object.keys(blocks).length) out.blocks = blocks;
    return Object.keys(out).length ? out : null;
  }

  function pickFile() {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.html,.htm,text/html';
      i.onchange = () => {
        const f = i.files && i.files[0];
        if (!f) return res(null);
        const r = new FileReader();
        r.onload = () => res(String(r.result)); r.onerror = () => res(null);
        r.readAsText(f);
      };
      i.addEventListener('cancel', () => res(null));
      i.click();
    });
  }

  async function exportHtml() {
    if (formDirty && !confirm('The Video / questions form has unsaved changes that will NOT be in the export. Export anyway?')) return;
    let src = null;
    if (location.protocol !== 'file:') {
      try {
        const u = location.href.split('#')[0].split('?')[0];
        const r = await fetch(u + '?_=' + Date.now(), { cache: 'no-store' });
        if (r.ok) src = await r.text();
      } catch (e) { /* fall through to the file picker */ }
    }
    if (!src || src.indexOf(MARK) < 0) {
      toast('Please select the index.html you currently use (the one on GitHub).', 'warn');
      src = await pickFile();
      if (!src) return;
    }
    if (src.indexOf(MARK) < 0) { toast('That file is not the EAS•C courseware with the Supabase integration.', 'err'); return; }

    const modules = {}; let count = 0;
    for (let n = 1; n <= 5; n++) { const b = bakedFor(n); if (b) { modules[n] = b; count++; } }

    const nl = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    src = src.replace(new RegExp('<' + SC + ' id="' + BAKED_ID + '"[\\s\\S]*?<\\/' + SC + '>[ \\t]*\\r?\\n?'), '');
    const json = JSON.stringify({ v: 1, exported: new Date().toISOString(), modules })
      .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const tag = '<' + SC + ' id="' + BAKED_ID + '" type="application/json">' + json + '</' + SC + '>' + nl;
    const at = src.indexOf(MARK);
    const out = src.slice(0, at) + tag + src.slice(at);

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'text/html;charset=utf-8' }));
    a.download = 'index.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(count ? 'index.html downloaded with the edits of ' + count + ' module(s) included. Upload it to GitHub to replace the old file.'
                : 'index.html downloaded (no edits yet). Make edits first, then export again.', count ? 'ok' : 'warn');
  }

  /* ───────────── 10. PROGRESS SYNC (students) ───────────── */
  let lastSaved = {}, pushing = false;

  function snap() {
    const o = {};
    for (let i = 1; i <= 6; i++) { const p = state.progress[i] || {}; o[i] = (p.completed ? 1 : 0) + ':' + Math.round(+p.score || 0); }
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
    const { data, error } = await sb.from('module_progress').select('module_no,completed,score').eq('user_id', ME.id);
    if (error) { console.warn('[EASC] progress load:', error); toast('Could not load your saved progress.', 'warn'); }
    (data || []).forEach(r => { const p = state.progress[r.module_no]; if (p) { p.completed = !!r.completed; p.score = r.score || 0; } });
    lastSaved = snap();
    if (typeof window.EASC_refresh === 'function') window.EASC_refresh();
  }
  async function pushProgress() {
    if (!ME || ME.role !== 'student' || pushing) return;
    const now = snap(), rows = [];
    for (let i = 1; i <= 6; i++) {
      if (now[i] !== lastSaved[i]) {
        const p = state.progress[i];
        rows.push({ user_id: ME.id, module_no: i, completed: !!p.completed, score: Math.max(0, Math.min(100, Math.round(+p.score || 0))) });
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
    setInterval(pushProgress, 2500);
    window.addEventListener('pagehide', pushProgress);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pushProgress(); });
  }

  /* ───────────── 11. LOGIN SCREEN ───────────── */
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
        <label class="sb-field" id="sbCodeRow" hidden><span>Teacher access code</span><input id="sbCode" type="password" autocomplete="off"><small>Needed the first time you use a teacher account. Ask your administrator.</small></label>
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
        if (!data.session) { setMode('signin'); setMsg('Account created! Check your email to confirm it, then sign in here.', 'ok'); return; }
        await afterLogin(data.session, code);
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await afterLogin(data.session, code);
      }
    } catch (err) { setMsg(err && err.message ? err.message : String(err), 'err'); }
    finally { btn.disabled = false; }
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
      if (!ok) { await sb.auth.signOut(); throw new Error('Invalid teacher access code.'); }
      prof = await loadProfile(session.user.id);
    }
    if (chosenRole === 'student' && prof.role === 'teacher') {
      await sb.auth.signOut();
      throw new Error('This is a teacher account. Go back and choose "Teacher".');
    }
    await startApp(prof);
  }

  /* ───────────── 12. START / STOP ───────────── */
  async function startApp(prof) {
    ME = { id: prof.id, name: prof.full_name || prof.email || 'Learner', email: prof.email, role: prof.role };
    document.body.classList.add('sb-role-' + ME.role);
    clearLocalProgress();
    await loadContent();
    installModuleHook();
    if (ME.role === 'student') {
      state.userName = String(ME.name).toUpperCase();
      await loadProgress();
      startProgressSync();
    }
    buildChip();
    if (ME.role === 'teacher') { buildTeacherUI(); buildTeacherBar(); }
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
    if (pageDirty && !confirm('You have unsaved page edits. Log out anyway?')) return;
    pageDirty = false; formDirty = false;
    if (ME && ME.role === 'student') await pushProgress();
    try { await sb.auth.signOut(); } catch (e) {}
    clearLocalProgress();
    location.reload();
  }

  /* ───────────── 13. TEACHER UI (nav, progress table) ───────────── */
  function buildTeacherUI() {
    document.querySelector('.nav').insertAdjacentHTML('beforeend',
      '<div class="sb-navhead">Teacher</div>' +
      '<button type="button" id="sbNavProg">📊 &nbsp; LEARNER PROGRESS</button>' +
      '<button type="button" id="sbNavEdit">🎞 &nbsp; VIDEO &amp; QUESTIONS</button>' +
      '<button type="button" id="sbNavExport">⬇ &nbsp; EXPORT HTML</button>');
    $('sbNavProg').addEventListener('click', e => openProgress(e.currentTarget));
    $('sbNavEdit').addEventListener('click', e => openEditor(null, e.currentTarget));
    $('sbNavExport').addEventListener('click', exportHtml);

    document.querySelector('.main').insertAdjacentHTML('beforeend', `
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
      <div class="top"><div><div class="kicker">TEACHER</div><h2>VIDEO &amp; QUESTIONS</h2>
        <div class="sub">Video, guide questions and performance questions. (Everything else is edited on the module page itself.)</div></div></div>
      <div class="sb-mtabs" id="sbMTabs"></div>
      <div id="sbEdForm"></div>
    </section>`);

    $('sbSearch').addEventListener('input', renderLearners);
    $('sbSort').addEventListener('change', renderLearners);
    $('sbRefresh').addEventListener('click', loadLearners);
    $('sbCsv').addEventListener('click', exportCsv);
  }

  function openProgress(btn) { showView('sbProgress', btn || $('sbNavProg')); loadLearners(); }

  async function loadLearners() {
    $('sbLearnerBody').innerHTML = '<tr><td colspan="9" class="sb-dim">Loading…</td></tr>';
    const { data, error } = await sb.from('learner_overview').select('*').order('full_name');
    if (error) { $('sbLearnerBody').innerHTML = '<tr><td colspan="9" style="color:var(--bad)">Could not load learners: ' + esc(error.message) + '</td></tr>'; return; }
    LEARNERS = data || [];
    renderLearners();
  }
  const fmtDate = d => d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const overall = l => Math.round((l.modules_completed || 0) / 5 * 100);

  function renderLearners() {
    const q = ($('sbSearch').value || '').toLowerCase().trim(), sort = $('sbSort').value;
    const rows = LEARNERS.filter(l => ((l.full_name || '') + ' ' + (l.email || '')).toLowerCase().includes(q));
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
    const safe = v => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const head = ['Name', 'Email', 'M1 score', 'M1 done', 'M2 score', 'M2 done', 'M3 score', 'M3 done', 'M4 score', 'M4 done', 'M5 score', 'M5 done',
      'Modules completed', 'Written test score', 'Written test passed', 'Last activity'];
    const lines = [head.map(safe).join(',')].concat(LEARNERS.map(l => [
      l.full_name, l.email, l.m1_score, l.m1_done, l.m2_score, l.m2_done, l.m3_score, l.m3_done, l.m4_score, l.m4_done,
      l.m5_score, l.m5_done, l.modules_completed, l.test_score, l.test_passed, l.last_activity || l.last_seen || ''].map(safe).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'easc-learner-progress.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ───────────── 14. BOOT ───────────── */
  async function boot() {
    buildAuth();
    const fail = msg => { $('sbBootMsg').textContent = msg; document.querySelectorAll('#sbAuth .sb-role').forEach(b => { b.disabled = true; }); };

    if (typeof state === 'undefined' || !C() || !C().GG) { fail('This index.html is missing the EASC_CONTENT patch — use the patched index.html.'); return; }
    if (/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY)) { fail('Supabase is not configured yet. Open the file and set SUPABASE_URL and SUPABASE_ANON_KEY.'); return; }
    if (!window.supabase || !window.supabase.createClient) { fail('Could not load supabase-js (check your internet connection).'); return; }

    // keep KaTeX away from blocks that are being edited
    if (typeof window.renderMathInElement === 'function' && !window.renderMathInElement.__sb) {
      const orig = window.renderMathInElement;
      const wrapped = function (el, opts) {
        opts = Object.assign({}, opts || {});
        opts.ignoredClasses = (opts.ignoredClasses || []).concat(['sb-eb-on']);
        return orig.call(this, el, opts);
      };
      wrapped.__sb = true;
      window.renderMathInElement = wrapped;
    }

    snapshotDefaults();
    Object.assign(BAKED, readBaked());                    // edits exported earlier and shipped inside this file
    Object.keys(BAKED).forEach(n => applyRow(+n, BAKED[n]));
    snapshotDefaults();                                   // from now on "built-in" = shipped + baked

    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb.auth.onAuthStateChange(evt => { if (evt === 'SIGNED_OUT' && ME) { clearLocalProgress(); location.reload(); } });

    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) await startApp(await loadProfile(data.session.user.id));
    } catch (e) {
      console.warn('[EASC] session restore:', e);
      try { await sb.auth.signOut(); } catch (_) {}
    }
  }

  window.EASC_SB = { openEditor, exportHtml, logout, get user() { return ME; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
