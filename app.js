/* CloudPad — static notepad + Supabase cloud sync (GitHub Pages ready)
   Modes:
   - Local demo: notes in localStorage, no login needed
   - Cloud: Supabase URL+key in Settings + signed in -> Postgres + RLS + realtime
*/

const $ = (id) => document.getElementById(id);
const LS_CFG = "cloudpad_supabase_cfg";
const LS_LOCAL_NOTES = "cloudpad_notes_demo";
const LS_THEME = "cloudpad_theme";
const LS_COMPOSIO = "cloudpad_composio_key";

let supabase = null;      // supabase client (from CDN global)
let sessionUser = null;   // logged-in user or null
let cloudMode = false;
let notes = [];           // active dataset
let activeId = null;
let activeFilter = "all";
let activeTag = null;
let saveTimer = null;
let realtimeChannel = null;

// ---------- utils ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const nowISO = () => new Date().toISOString();
const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms) => (...a) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fn(...a), ms); };

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function confirmDialog(title, msg, okLabel = "Delete") {
  return new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-msg").textContent = msg;
    $("confirm-yes").textContent = okLabel;
    $("confirm-modal").hidden = false;
    $("confirm-yes").onclick = () => { $("confirm-modal").hidden = true; resolve(true); };
    $("confirm-no").onclick = () => { $("confirm-modal").hidden = true; resolve(false); };
  });
}

// mini markdown -> html (offline-safe, no dependency)
function mdToHtml(src = "") {
  let h = esc(src);
  // code blocks ```..```
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
  // headings
  h = h.replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>");
  // bold / italic / inline code / strike
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\W)\*(.+?)\*/g, "$1<em>$2</em>")
       .replace(/`([^`]+?)`/g, "<code>$1</code>").replace(/~~(.+?)~~/g, "<del>$1</del>");
  // images & links
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px"/>')
       .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // blockquote
  h = h.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");
  // task + bullets + numbered (line-based, simple)
  h = h.replace(/^- \[x\] (.*)$/gim, "<div>☑ $1</div>").replace(/^- \[ \] (.*)$/gm, "<div>☐ $1</div>")
       .replace(/^- (.*)$/gm, "<li>$1</li>").replace(/^(\d+)\. (.*)$/gm, "<li>$2</li>");
  h = h.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // paragraphs
  h = h.split(/\n{2,}/).map((b) => /^\s*<(h\d|ul|pre|blockquote|div)/.test(b.trim()) ? b : `<p>${b.replace(/\n/g, "<br/>")}</p>`).join("\n");
  return h;
}

// ---------- theme ----------
function initTheme() {
  const t = localStorage.getItem(LS_THEME) || "light";
  document.documentElement.dataset.theme = t;
  $("theme-btn").textContent = t === "light" ? "🌙" : "☀️";
}
$("theme-btn").onclick = () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(LS_THEME, next);
  $("theme-btn").textContent = next === "light" ? "🌙" : "☀️";
};

// ---------- local store ----------
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_LOCAL_NOTES) || "[]"); }
  catch { return []; }
}
function saveLocal() {
  localStorage.setItem(LS_LOCAL_NOTES, JSON.stringify(notes));
}
function seedLocalIfEmpty() {
  if (loadLocal().length === 0 && !localStorage.getItem(LS_LOCAL_NOTES + "_seeded")) {
    const t = Date.now();
    const seed = [
      { id: uid(), user_id: null, title: "👋 Welcome to CloudPad", content: "# Welcome!\n\nThis is your **cloud notepad**.\n\n- Write in **Markdown**\n- Notes **autosave**\n- Press `/` to search\n- Toggle 👁 **Preview**\n\n## Go cloud ☁️\n1. Create a free project at `supabase.com`\n2. Run `supabase-schema.sql` in SQL editor\n3. Open ⚙ Settings → paste URL + anon key → Sign in\n\nHappy noting! 📝", tags: ["welcome"], pinned: true, archived: false, deleted_at: null, created_at: new Date(t).toISOString(), updated_at: new Date(t).toISOString() },
      { id: uid(), user_id: null, title: "Ideas", content: "- [ ] Ship notepad MVP\n- [ ] Deploy to GitHub Pages\n- [ ] Connect Supabase\n- [ ] Phase 2: Composio → backup to Notion + Drive", tags: ["ideas"], pinned: false, archived: false, deleted_at: null, created_at: new Date(t).toISOString(), updated_at: new Date(t).toISOString() },
    ];
    localStorage.setItem(LS_LOCAL_NOTES, JSON.stringify(seed));
    localStorage.setItem(LS_LOCAL_NOTES + "_seeded", "1");
  }
}

// ---------- supabase ----------
function getCfg() {
  try { return JSON.parse(localStorage.getItem(LS_CFG) || "{}"); } catch { return {}; }
}
function initSupabaseFromStorage() {
  const { url, key } = getCfg();
  if (url && key && window.supabase) {
    try {
      supabase = window.supabase.createClient(url, key);
      return true;
    } catch (e) { console.warn("supabase init failed", e); }
  }
  supabase = null;
  return false;
}
function setSyncUI() {
  const badge = $("sync-status");
  if (cloudMode && sessionUser) {
    badge.classList.add("cloud");
    $("sync-text").textContent = "Cloud sync • " + (sessionUser.email || "signed in");
    $("user-email").textContent = sessionUser.email || "Signed in";
    $("user-plan").textContent = "Supabase cloud";
    $("auth-btn").textContent = "Sign out";
    $("setup-hint").style.display = "none";
  } else if (supabase) {
    badge.classList.remove("cloud");
    $("sync-text").textContent = "Supabase connected — sign in";
    $("user-email").textContent = "Not signed in";
    $("user-plan").textContent = "Local mode";
    $("auth-btn").textContent = "Sign in";
    $("setup-hint").style.display = "";
  } else {
    badge.classList.remove("cloud");
    $("sync-text").textContent = "Local demo";
    $("user-email").textContent = "Not signed in";
    $("user-plan").textContent = "Local mode";
    $("auth-btn").textContent = "Sign in";
    $("setup-hint").style.display = "";
  }
}

async function refreshSession() {
  if (!supabase) { sessionUser = null; cloudMode = false; return; }
  const { data } = await supabase.auth.getSession();
  sessionUser = data?.session?.user || null;
  cloudMode = !!sessionUser;
  setSyncUI();
  subscribeRealtime();
}

function subscribeRealtime() {
  if (realtimeChannel && supabase) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
  if (!supabase || !sessionUser) return;
  realtimeChannel = supabase.channel("notes-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${sessionUser.id}` },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!notes.find((n) => n.id === payload.new.id)) notes.unshift(payload.new);
        } else if (payload.eventType === "UPDATE") {
          const i = notes.findIndex((n) => n.id === payload.new.id);
          if (i >= 0) notes[i] = payload.new;
        } else if (payload.eventType === "DELETE") {
          notes = notes.filter((n) => n.id !== payload.old.id);
          if (activeId === payload.old.id) { activeId = null; renderEditor(); }
        }
        renderAll();
      })
    .subscribe();
}

// ---------- data ops (work in both modes) ----------
async function fetchNotes() {
  if (cloudMode && supabase) {
    const { data, error } = await supabase.from("notes").select("*").order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(500);
    if (error) { toast("Cloud fetch failed: " + error.message, "err"); notes = loadLocal(); }
    else notes = data || [];
  } else {
    notes = loadLocal();
  }
}

async function createNote() {
  const note = { id: uid(), title: "", content: "", tags: [], pinned: false, archived: false, deleted_at: null, created_at: nowISO(), updated_at: nowISO() };
  if (cloudMode && supabase) {
    const row = { ...note, user_id: sessionUser.id };
    const { data, error } = await supabase.from("notes").insert(row).select().single();
    if (error) return toast("Create failed: " + error.message, "err");
    notes.unshift(data);
    activeId = data.id;
  } else {
    notes.unshift({ ...note, user_id: null });
    activeId = note.id;
    saveLocal();
  }
  activeFilter = "all"; activeTag = null;
  renderAll(); renderEditor();
  $("note-title").focus();
}

async function persistNote(note) {
  note.updated_at = nowISO();
  setSaveState("saving");
  if (cloudMode && supabase) {
    const { error } = await supabase.from("notes").update({
      title: note.title, content: note.content, tags: note.tags,
      pinned: note.pinned, archived: note.archived, deleted_at: note.deleted_at, updated_at: note.updated_at,
    }).eq("id", note.id);
    if (error) { setSaveState("error"); return toast("Save failed: " + error.message, "err"); }
  } else {
    saveLocal();
  }
  setSaveState("saved");
  renderList(); renderCounts(); renderTags();
}
const persistDebounced = debounce((note) => persistNote(note), 700);

async function hardDelete(id) {
  if (cloudMode && supabase) {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) return toast("Delete failed: " + error.message, "err");
  }
  notes = notes.filter((n) => n.id !== id);
  if (!cloudMode) saveLocal();
  if (activeId === id) activeId = null;
  renderAll(); renderEditor();
}

// ---------- rendering ----------
const activeNote = () => notes.find((n) => n.id === activeId) || null;

function filteredNotes() {
  const q = $("search-input").value.trim().toLowerCase();
  return notes.filter((n) => {
    if (activeFilter === "pinned" && (!n.pinned || n.deleted_at || n.archived)) return false;
    if (activeFilter === "all" && (n.archived || n.deleted_at)) return false;
    if (activeFilter === "archived" && (!n.archived || n.deleted_at)) return false;
    if (activeFilter === "trash" && !n.deleted_at) return false;
    if (activeTag && !(n.tags || []).includes(activeTag)) return false;
    if (q && !((n.title || "") + " " + (n.content || "") + " " + (n.tags || []).join(" ")).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
}

function renderCounts() {
  $("count-all").textContent = notes.filter((n) => !n.archived && !n.deleted_at).length;
  $("count-pinned").textContent = notes.filter((n) => n.pinned && !n.deleted_at && !n.archived).length;
  $("count-archived").textContent = notes.filter((n) => n.archived && !n.deleted_at).length;
  $("count-trash").textContent = notes.filter((n) => n.deleted_at).length;
}

function renderTags() {
  const all = {};
  notes.filter((n) => !n.deleted_at).forEach((n) => (n.tags || []).forEach((t) => all[t] = (all[t] || 0) + 1));
  const keys = Object.keys(all).sort();
  $("clear-tag").hidden = !activeTag;
  $("tags-list").innerHTML = keys.length ? keys.map((t) =>
    `<span class="tag ${activeTag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)} (${all[t]})</span>`).join("")
    : `<span class="muted small">No tags yet</span>`;
  document.querySelectorAll(".tag[data-tag]").forEach((el) =>
    el.onclick = () => { activeTag = activeTag === el.dataset.tag ? null : el.dataset.tag; renderAll(); });
}

function renderList() {
  const list = filteredNotes();
  $("notes-list").innerHTML = list.length ? list.map((n) => `
    <div class="note-card ${n.id === activeId ? "active" : ""}" data-id="${n.id}">
      <h4>${n.pinned ? "📌 " : ""}${esc(n.title || "Untitled")}</h4>
      <p>${esc((n.content || "").slice(0, 140) || "No content")}</p>
      <div class="meta"><span>${new Date(n.updated_at).toLocaleDateString()} ${new Date(n.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      ${(n.tags || []).slice(0, 3).map((t) => `<span class="mini-tag">#${esc(t)}</span>`).join("")}</div>
    </div>`).join("")
    : `<p class="muted small" style="padding:8px">No notes here. Create one! ✨</p>`;
  document.querySelectorAll(".note-card").forEach((el) => el.onclick = () => { activeId = el.dataset.id; renderAll(); renderEditor(); closeSidebarMobile(); });
}

function renderAll() {
  document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b.dataset.filter === activeFilter));
  renderCounts(); renderTags(); renderList();
}

function setSaveState(s) {
  const el = $("save-state");
  el.className = "save-state " + (s === "saving" ? "saving" : s === "saved" ? "saved" : "");
  el.textContent = s === "saving" ? "● Saving…" : s === "saved" ? "✓ Saved" : s === "error" ? "⚠ Error" : "Saved";
}

function renderEditor() {
  const n = activeNote();
  const empty = !n;
  $("editor-empty").hidden = !empty ? false : false;
  $("editor-empty").style.display = empty ? "" : "none";
  $("editor").hidden = empty;
  if (empty) return;
  $("note-title").value = n.title || "";
  $("note-content").value = n.content || "";
  $("note-tags").value = (n.tags || []).join(", ");
  $("updated-at").textContent = "Updated " + new Date(n.updated_at).toLocaleString();
  $("pin-btn").classList.toggle("active", !!n.pinned);
  $("archive-btn").classList.toggle("active", !!n.archived);
  $("delete-btn").title = n.deleted_at ? "Delete forever" : "Move to trash";
  updateWordCount(); updatePreview();
}

// ---------- editor events ----------
function bindEditor() {
  $("note-title").addEventListener("input", (e) => { const n = activeNote(); if (!n) return; n.title = e.target.value; setSaveState("saving"); persistDebounced(n); });
  $("note-content").addEventListener("input", (e) => { const n = activeNote(); if (!n) return; n.content = e.target.value; setSaveState("saving"); updateWordCount(); updatePreview(); persistDebounced(n); });
  $("note-tags").addEventListener("change", (e) => { const n = activeNote(); if (!n) return; n.tags = e.target.value.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean); persistNote(n); });

  document.querySelectorAll(".toolbar [data-md]").forEach((btn) => btn.onclick = () => insertMarkdown(btn));
  $("preview-toggle").onclick = () => {
    const p = $("note-preview"), ta = $("note-content");
    const show = p.hidden;
    p.hidden = !show; ta.style.display = show ? "none" : "";
    $("preview-toggle").classList.toggle("active", show);
    if (show) updatePreview();
  };

  $("pin-btn").onclick = async () => { const n = activeNote(); if (!n) return; n.pinned = !n.pinned; await persistNote(n); renderEditor(); };
  $("archive-btn").onclick = async () => { const n = activeNote(); if (!n) return; n.archived = !n.archived; if (n.archived) n.pinned = false; await persistNote(n); renderEditor(); toast(n.archived ? "Archived" : "Unarchived"); };
  $("export-btn").onclick = () => {
    const n = activeNote(); if (!n) return;
    download(`${(n.title || "untitled").replace(/[^\w\- ]+/g, "").trim() || "note"}.md`, `# ${n.title || "Untitled"}\n\n${n.content || ""}\n`);
  };
  $("copy-btn").onclick = async () => { const n = activeNote(); if (!n) return; await navigator.clipboard.writeText(n.content || ""); toast("Copied to clipboard", "ok"); };
  $("delete-btn").onclick = async () => {
    const n = activeNote(); if (!n) return;
    if (n.deleted_at) {
      if (await confirmDialog("Delete forever?", "This note will be permanently deleted.", "Delete forever")) hardDelete(n.id);
    } else {
      n.deleted_at = nowISO(); n.pinned = false; await persistNote(n); activeId = null; renderAll(); renderEditor(); toast("Moved to trash");
    }
  };
}

function insertMarkdown(btn) {
  const ta = $("note-content"), n = activeNote(); if (!n) return;
  const ins = btn.dataset.md, s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  let out = v, pos = s;
  if (btn.dataset.line) { // prefix current line
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    out = v.slice(0, ls) + ins + v.slice(ls); pos = s + ins.length;
  } else if (btn.dataset.link) {
    const sel = v.slice(s, e) || "text";
    out = v.slice(0, s) + `[${sel}](https://)` + v.slice(e); pos = s + sel.length + 3;
  } else if (btn.dataset.block) {
    out = v.slice(0, s) + "```\n" + v.slice(s, e) + "\n```" + v.slice(e); pos = s + 4;
  } else {
    const sel = v.slice(s, e);
    out = v.slice(0, s) + ins + sel + ins + v.slice(e); pos = e + ins.length + (sel ? ins.length : 0);
    if (!sel) pos = s + ins.length;
  }
  ta.value = out; n.content = out; ta.focus(); ta.setSelectionRange(pos, pos);
  updateWordCount(); updatePreview(); setSaveState("saving"); persistDebounced(n);
}

function updateWordCount() {
  const t = $("note-content").value.trim();
  $("word-count").textContent = (t ? t.split(/\s+/).length : 0) + " words • " + t.length + " chars";
}
function updatePreview() {
  if (!$("note-preview").hidden) $("note-preview").innerHTML = mdToHtml($("note-content").value);
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ---------- sidebar events ----------
function closeSidebarMobile() { $("sidebar").classList.remove("open"); }
function bindSidebar() {
  $("new-note-btn").onclick = createNote;
  $("mobile-new").onclick = createNote;
  $("sidebar-open").onclick = () => $("sidebar").classList.add("open");
  $("sidebar-close").onclick = closeSidebarMobile;
  $("search-input").addEventListener("input", renderList);
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("search-input").focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); const n = activeNote(); if (n) persistNote(n); }
  });
  document.querySelectorAll(".filter").forEach((b) => b.onclick = () => { activeFilter = b.dataset.filter; renderAll(); });
  $("clear-tag").onclick = () => { activeTag = null; renderAll(); };
}

// ---------- modals ----------
function bindModals() {
  document.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => b.closest(".modal").hidden = true);
  document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
  $("settings-btn").onclick = () => {
    const { url, key } = getCfg();
    $("cfg-url").value = url || ""; $("cfg-key").value = key || "";
    $("cfg-composio").value = localStorage.getItem(LS_COMPOSIO) || "";
    $("cfg-status").textContent = supabase ? (cloudMode ? "● Cloud active" : "● Connected — sign in") : "○ Not connected";
    $("settings-modal").hidden = false;
  };
  $("cfg-save").onclick = async () => {
    const url = $("cfg-url").value.trim().replace(/\/$/, ""), key = $("cfg-key").value.trim();
    if (!url || !key) return toast("Paste both URL and anon key", "err");
    localStorage.setItem(LS_CFG, JSON.stringify({ url, key }));
    if (!window.supabase) return toast("Supabase CDN not loaded (offline?) — check connection", "err");
    supabase = window.supabase.createClient(url, key);
    $("cfg-status").textContent = "● Connected — sign in now";
    toast("Supabase connected! Now sign in.", "ok");
    await refreshSession(); await fetchNotes(); renderAll(); renderEditor();
    $("settings-modal").hidden = true;
    if (!sessionUser) $("auth-modal").hidden = false;
  };
  $("cfg-disconnect").onclick = async () => {
    localStorage.removeItem(LS_CFG);
    if (supabase) await supabase.auth.signOut().catch(() => {});
    supabase = null; sessionUser = null; cloudMode = false; notes = loadLocal(); activeId = null;
    setSyncUI(); renderAll(); renderEditor();
    $("cfg-status").textContent = "○ Not connected";
    toast("Disconnected — back to local mode");
  };
  $("cfg-composio").addEventListener("change", (e) => {
    localStorage.setItem(LS_COMPOSIO, e.target.value.trim());
    toast("Composio key saved locally for phase 2", "ok");
  });

  $("auth-btn").onclick = async () => {
    if (sessionUser && supabase) {
      await supabase.auth.signOut();
      sessionUser = null; cloudMode = false; notes = loadLocal(); activeId = null;
      setSyncUI(); renderAll(); renderEditor(); toast("Signed out");
    } else {
      if (!supabase) {
        toast("Connect Supabase first (⚙ Settings)", "err");
        $("settings-btn").click(); return;
      }
      $("auth-modal").hidden = false;
    }
  };
  $("signin-btn").onclick = () => doAuth("signin");
  $("signup-btn").onclick = () => doAuth("signup");
  $("magic-btn").onclick = async () => {
    const email = $("auth-email").value.trim();
    if (!email) return authErr("Enter your email first.");
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) return authErr(error.message);
    toast("Magic link sent! Check your inbox.", "ok");
  };

  $("export-all").onclick = () => download(`cloudpad-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(notes, null, 2));
  $("import-btn").onclick = () => $("import-file").click();
  $("import-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const arr = JSON.parse(await f.text());
      if (!Array.isArray(arr)) throw new Error("not an array");
      for (const r of arr) {
        const row = { id: r.id || uid(), title: r.title || "", content: r.content || "", tags: r.tags || [], pinned: !!r.pinned, archived: !!r.archived, deleted_at: r.deleted_at || null, created_at: r.created_at || nowISO(), updated_at: nowISO() };
        if (cloudMode && supabase) await supabase.from("notes").upsert({ ...row, user_id: sessionUser.id });
        else notes.push({ ...row, user_id: null });
      }
      if (!cloudMode) saveLocal(); else await fetchNotes();
      renderAll(); toast(`Imported ${arr.length} notes`, "ok");
    } catch (err) { toast("Import failed: " + err.message, "err"); }
    e.target.value = "";
  });

  // Trash restore: double-click a trashed card restores it
  $("notes-list").addEventListener("dblclick", async (e) => {
    const card = e.target.closest(".note-card"); if (!card) return;
    const n = notes.find((x) => x.id === card.dataset.id);
    if (n && n.deleted_at) { n.deleted_at = null; await persistNote(n); renderAll(); renderEditor(); toast("Restored", "ok"); }
  });
}

function authErr(m) { $("auth-error").textContent = m; }
async function doAuth(mode) {
  authErr("");
  const email = $("auth-email").value.trim(), password = $("auth-password").value;
  if (!email || !password) return authErr("Email + password required.");
  const fn = mode === "signup" ? supabase.auth.signUp({ email, password }) : supabase.auth.signInWithPassword({ email, password });
  const { data, error } = await fn;
  if (error) return authErr(error.message);
  sessionUser = data.user || data.session?.user || null;
  if (data.session) sessionUser = data.session.user;
  if (!sessionUser) { // email confirmation may be on
    $("auth-modal").hidden = true;
    return toast(mode === "signup" ? "Account created! Confirm email, then sign in." : "Check your email to confirm, then sign in.", "ok");
  }
  cloudMode = true;
  $("auth-modal").hidden = true;
  setSyncUI(); subscribeRealtime();
  await fetchNotes(); renderAll(); renderEditor();
  toast("Welcome! Cloud sync is on ☁️", "ok");
}

// ---------- github backup (via Supabase Edge Function + Composio) ----------
const LS_BACKUP = "cloudpad_backup_cfg";
const getBackupCfg = () => { try { return JSON.parse(localStorage.getItem(LS_BACKUP) || "{}"); } catch { return {}; } };

function bindBackup() {
  const saved = getBackupCfg();
  if ($("cfg-edge-url") && saved.edgeUrl) $("cfg-edge-url").value = saved.edgeUrl;
  if ($("github-backup-btn")) $("github-backup-btn").onclick = doGithubBackup;
  if ($("backup-save")) $("backup-save").onclick = () => {
    localStorage.setItem(LS_BACKUP, JSON.stringify({ edgeUrl: $("cfg-edge-url").value.trim().replace(/\/$/, "") }));
    toast("Backup settings saved", "ok");
  };
}

async function doGithubBackup() {
  const n = activeNote();
  if (!n) return toast("Open a note first", "err");
  if (!cloudMode || !supabase) return toast("Sign in (cloud mode) to use backup", "err");
  const { edgeUrl } = getBackupCfg();
  if (!edgeUrl) { toast("Set Edge Function URL in ⚙ Settings first", "err"); $("settings-btn").click(); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return toast("Session expired — sign in again", "err");
  toast("Backing up to GitHub… 🐙");
  try {
    const r = await fetch(edgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ title: n.title || "Untitled", content: n.content || "", note_id: n.id }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "backup failed");
    toast(`Backed up → ${j.path}`, "ok");
  } catch (e) { toast("Backup failed: " + e.message, "err"); }
}

// ---------- boot ----------
(async function boot() {
  initTheme();
  seedLocalIfEmpty();
  bindSidebar(); bindEditor(); bindModals(); bindBackup();
  const hasSupabase = initSupabaseFromStorage();
  if (hasSupabase) {
    try { await refreshSession(); } catch (e) { console.warn(e); }
    supabase.auth.onAuthStateChange(async (_ev, session) => {
      sessionUser = session?.user || null;
      cloudMode = !!sessionUser;
      setSyncUI(); subscribeRealtime();
      await fetchNotes(); renderAll(); renderEditor();
    });
  }
  setSyncUI();
  await fetchNotes();
  // open first note on desktop
  if (window.innerWidth > 900 && filteredNotes().length) activeId = filteredNotes()[0].id;
  renderAll(); renderEditor();
})();
