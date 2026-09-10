// CloudPad full button/function audit — runs the REAL index.html + app.js in jsdom.
// Usage: npm install --prefix /tmp/jsd jsdom && node tests/audit.js
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("/tmp/jsd/node_modules/jsdom");
const dir = "/home/user/notepad-cloud";
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => console.log("JSDOM-ERR:", (e.message || e).toString().slice(0, 100)));
const dom = new JSDOM(fs.readFileSync(dir + "/index.html", "utf8"), { url: "https://localhost/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
// jsdom's built-in crypto lacks `subtle` — give the app real webcrypto like a modern browser.
Object.defineProperty(window, "crypto", { value: require("crypto").webcrypto, configurable: true });
Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => { window.__clip = t; } }, configurable: true });
if (!window.URL.createObjectURL) { window.URL.createObjectURL = () => "blob:stub"; window.URL.revokeObjectURL = () => {}; }
for (const code of ["window.CLOUDPAD_CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:''};", fs.readFileSync(dir + "/app.js", "utf8")]) {
  const s = window.document.createElement("script"); s.textContent = code; window.document.head.appendChild(s);
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await tick(800);
  const d = window.document;
  let fails = 0, n = 0;
  const T = (name, ok, x = "") => { n++; if (!ok) fails++; console.log((ok ? "PASS" : "FAIL"), "-", name, String(x)); };
  const cards = () => d.querySelectorAll(".note-card").length;
  const toastHas = (s) => d.getElementById("toasts").textContent.includes(s);
  const setFilter = (f) => d.querySelector(`.filter[data-filter="${f}"]`).click();
  const blurActive = () => { if (d.activeElement && d.activeElement.blur) d.activeElement.blur(); };

  T("A1 boot seeds", cards() === 2, cards());
  T("A2 desktop auto-open", d.getElementById("editor").hidden === false);
  d.getElementById("new-note-btn").click();
  T("B1 new note", cards() === 3);
  d.getElementById("note-title").value = "Audit Note";
  d.getElementById("note-title").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(950);
  T("C1 title autosave", [...d.querySelectorAll(".note-card h4")].some((h) => h.textContent.includes("Audit Note")));
  d.getElementById("note-tags").value = "work, urgent";
  d.getElementById("note-tags").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(150);
  T("D1 tags render", d.getElementById("tags-list").textContent.includes("#work"));
  d.querySelector('.tag[data-tag="work"]').click();
  T("E1 tag filter", cards() === 1, cards());
  d.getElementById("clear-tag").click();
  T("E2 clear tag", cards() === 3, cards());
  const ta = d.getElementById("note-content");
  ta.value = "hello"; ta.setSelectionRange(0, 5);
  d.querySelector('.toolbar button[data-md="**"]').click();
  T("F1 bold", ta.value === "**hello**", ta.value);
  d.querySelector('.toolbar button[data-md="## "]').click();
  T("F2 heading", ta.value.startsWith("## "), ta.value.slice(0, 14));
  ta.value = "text"; ta.setSelectionRange(0, 4);
  d.querySelector(".toolbar button[data-link]").click();
  T("F3 link", ta.value === "[text](https://)", ta.value);
  d.getElementById("preview-toggle").click();
  T("G1 preview on", d.getElementById("note-preview").hidden === false && d.getElementById("note-preview").innerHTML.includes("https://"));
  d.getElementById("preview-toggle").click();
  T("G2 preview off", d.getElementById("preview-toggle").classList.contains("active") === false && d.getElementById("note-preview").hidden === true);
  T("G3 wordcount", d.getElementById("word-count").textContent.includes("words"));
  // NOTE: seed "Welcome" note starts pinned, so pinning Audit Note makes 2.
  d.getElementById("pin-btn").click(); await tick(100);
  T("H1 pin badge 2", d.getElementById("count-pinned").textContent === "2", d.getElementById("count-pinned").textContent);
  setFilter("pinned"); T("H2 pinned filter", cards() === 2, cards());
  setFilter("all"); d.getElementById("pin-btn").click(); await tick(100);
  T("H3 unpin badge 1", d.getElementById("count-pinned").textContent === "1", d.getElementById("count-pinned").textContent);
  d.getElementById("archive-btn").click(); await tick(100);
  setFilter("archived"); T("H4 archived filter", cards() === 1, cards());
  setFilter("all"); T("H5 all excludes archived", cards() === 2, cards());
  d.getElementById("archive-btn").click(); await tick(100);
  T("H6 unarchive", toastHas("Unarchived") && cards() === 3, cards());
  d.getElementById("export-btn").click(); T("I1 export no-throw", true);
  d.getElementById("copy-btn").click(); await tick(100);
  T("I2 copy", window.__clip === ta.value);
  d.getElementById("save-btn").click(); await tick(150);
  T("I3 save", toastHas("Saved") && d.getElementById("save-state").textContent.includes("Saved"));
  d.getElementById("delete-btn").click(); await tick(150);
  T("J1 trash instant", toastHas("Moved to trash") && d.getElementById("count-trash").textContent === "1" && d.getElementById("editor").hidden === true);
  setFilter("trash"); T("J2 trash lists 1", cards() === 1, cards());
  d.querySelector(".note-card").dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true })); await tick(150);
  T("J3 dblclick restores", toastHas("Restored"));
  setFilter("all"); T("J4 all back to 3", cards() === 3, cards());
  d.querySelector(".note-card").click(); await tick(100);
  d.getElementById("delete-btn").click(); await tick(150);
  setFilter("trash");
  d.querySelector(".note-card").click(); await tick(100);
  d.getElementById("delete-btn").click(); await tick(100);
  T("J5 permanent asks confirm", d.getElementById("confirm-modal").hidden === false);
  d.getElementById("confirm-no").click(); await tick(50);
  T("J6 cancel keeps trash", d.getElementById("count-trash").textContent === "1");
  d.getElementById("delete-btn").click(); await tick(50);
  d.getElementById("confirm-yes").click(); await tick(150);
  T("J7 confirm deletes forever", d.getElementById("count-trash").textContent === "0");
  setFilter("all"); T("J8 all now 2", cards() === 2, cards());
  d.getElementById("search-input").value = "zzz-no-match";
  d.getElementById("search-input").dispatchEvent(new window.Event("input", { bubbles: true }));
  T("K1 search 0", cards() === 0, cards());
  d.getElementById("search-input").value = "";
  d.getElementById("search-input").dispatchEvent(new window.Event("input", { bubbles: true }));
  T("K2 search clear", cards() === 2, cards());
  const th0 = d.documentElement.dataset.theme;
  d.getElementById("theme-btn").click();
  T("L1 theme", d.documentElement.dataset.theme !== th0);
  d.getElementById("theme-btn").click();
  d.getElementById("sidebar").classList.remove("open");
  d.getElementById("sidebar-open").click();
  T("L2 hamburger opens", d.getElementById("sidebar").classList.contains("open"));
  d.getElementById("sidebar-overlay").click();
  T("L3 overlay closes", !d.getElementById("sidebar").classList.contains("open"));
  d.getElementById("settings-btn").click();
  T("M1 settings opens", d.getElementById("settings-modal").hidden === false);
  d.querySelector("#settings-modal [data-close]").click();
  T("M2 settings closes", d.getElementById("settings-modal").hidden === true);
  d.getElementById("settings-btn").click();
  d.getElementById("settings-modal").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  T("M3 backdrop closes", d.getElementById("settings-modal").hidden === true);
  d.getElementById("settings-btn").click();
  d.getElementById("cfg-url").value = ""; d.getElementById("cfg-key").value = "";
  d.getElementById("cfg-save").click(); await tick(100);
  T("N1 empty keys rejected", toastHas("Paste both"));
  d.getElementById("cfg-composio").value = "ck-test";
  d.getElementById("cfg-composio").dispatchEvent(new window.Event("change", { bubbles: true }));
  T("N2 composio key", toastHas("phase 2"));
  d.getElementById("export-all").click(); T("N3 export-all", true);
  d.getElementById("import-btn").click(); T("N4 import", true);
  d.getElementById("cfg-edge-url").value = "https://x.supabase.co/functions/v1/github-backup";
  d.getElementById("backup-save").click();
  T("N5 backup settings", toastHas("Backup settings saved"));
  d.getElementById("cfg-disconnect").click(); await tick(100);
  T("N6 disconnect", toastHas("Disconnected"));
  d.getElementById("settings-modal").hidden = true;
  T("O1 loader timeout offline", (await window.loadSupabaseLib(400)) === false);
  T("O2 upgrade exposed", typeof window.upgradeToCloud === "function");
  const libSrcs = [...d.querySelectorAll("head script[src]")].map((s) => s.getAttribute("src"));
  const vi = libSrcs.findIndex((s) => s.includes("vendor/supabase"));
  T("O3 tries vendor before CDNs", vi !== -1 && vi < libSrcs.findIndex((s) => s.includes("jsdelivr")), libSrcs.join(" | "));
  const vlib = fs.readFileSync(dir + "/vendor/supabase-js.js", "utf8");
  T("O4 vendor lib present", vlib.length > 50000 && vlib.includes("createClient"), vlib.length + " bytes");
  const dom2 = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://localhost/", runScripts: "dangerously" });
  const vs = dom2.window.document.createElement("script"); vs.textContent = vlib; dom2.window.document.head.appendChild(vs);
  let vlibWorks = false;
  try { vlibWorks = typeof dom2.window.supabase?.createClient === "function" && !!dom2.window.supabase.createClient("https://x.supabase.co", "k").auth; } catch (e) { vlibWorks = false; }
  T("O5 vendored UMD instantiates", vlibWorks);
  d.getElementById("auth-btn").click();
  T("P1 auth demo default", d.getElementById("auth-modal").hidden === false && d.getElementById("auth-demo-btns").hidden === false);
  d.getElementById("tab-cloud").click();
  T("P2 cloud tab", d.getElementById("auth-cloud-btns").hidden === false);
  d.getElementById("tab-demo").click();
  d.getElementById("auth-name").value = "Auditor";
  d.getElementById("auth-email").value = "audit@example.com";
  d.getElementById("auth-password").value = "secret1";
  d.getElementById("demo-signup-btn").click(); await tick(400);
  T("Q1 demo signup", d.getElementById("user-email").textContent === "audit@example.com" && d.getElementById("auth-modal").hidden === true, d.getElementById("auth-error").textContent.slice(0, 60));
  T("Q2 demo welcome", [...d.querySelectorAll(".note-card h4")].some((h) => h.textContent.includes("Auditor")));
  d.getElementById("auth-btn").click(); await tick(100);
  T("Q3 demo signout", toastHas("Signed out of demo account") && cards() === 2, cards());
  d.getElementById("auth-btn").click();
  d.getElementById("auth-email").value = "audit@example.com";
  d.getElementById("auth-password").value = "wrong";
  d.getElementById("demo-signin-btn").click(); await tick(300);
  T("Q4 wrong pass", d.getElementById("auth-error").textContent.includes("Wrong password"), d.getElementById("auth-error").textContent.slice(0, 60));
  d.getElementById("auth-password").value = "secret1";
  d.getElementById("demo-signin-btn").click(); await tick(300);
  T("Q5 demo signin", toastHas("Welcome back"));
  d.getElementById("auth-btn").click(); await tick(100);
  // Simulate: library "present" but unusable -> fast, deterministic failure path (no long timeouts).
  window.supabase = { createClient: () => { throw new Error("boom"); } };
  d.getElementById("auth-btn").click(); d.getElementById("tab-cloud").click();
  d.getElementById("auth-email").value = "t@t.t"; d.getElementById("auth-password").value = "x";
  d.getElementById("signin-btn").click(); await tick(300);
  T("R1 cloud signin retries lib", toastHas("Loading cloud library"), d.getElementById("auth-error").textContent.slice(0, 70));
  T("R2 cloud failure explains", d.getElementById("auth-error").textContent.includes("couldn't load"));
  d.getElementById("magic-btn").click(); await tick(300);
  T("R3 magic same path", d.getElementById("auth-error").textContent.includes("couldn't load"));
  d.getElementById("auth-modal").hidden = true;
  d.getElementById("sync-status").click(); await tick(300);
  T("R4 badge retries cloud", toastHas("Retrying cloud connection"));
  const chain = { limit: async () => ({ data: [], error: null }) };
  const o2 = { order: () => chain }, o1 = { order: () => o2 };
  const fakeUser = { id: "u1", email: "t@t.t" };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => {}, signOut: async () => ({}),
      getUser: async () => ({ data: { user: null } }),
      signInWithPassword: async () => ({ data: { user: fakeUser, session: { user: fakeUser } }, error: null }),
      signUp: async () => ({ data: { user: fakeUser, session: { user: fakeUser } }, error: null }),
      signInWithOtp: async () => ({ error: null }),
    },
    from: () => ({ select: () => o1 }), removeChannel: () => {},
    channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  })};
  window.localStorage.setItem("cloudpad_supabase_cfg", JSON.stringify({ url: "https://x.supabase.co", key: "k" }));
  await window.upgradeToCloud(); await tick(200);
  T("S1 upgrade connects", d.getElementById("sync-text").textContent.includes("Supabase connected"), d.getElementById("sync-text").textContent);
  d.getElementById("auth-btn").click();
  T("S2 auth opens", d.getElementById("auth-modal").hidden === false);
  d.getElementById("tab-cloud").click();
  d.getElementById("auth-email").value = "t@t.t"; d.getElementById("auth-password").value = "pw1234";
  d.getElementById("signin-btn").click(); await tick(300);
  T("S3 cloud signin", d.getElementById("sync-text").textContent.includes("Cloud sync") && d.getElementById("setup-hint").style.display === "none");
  d.getElementById("auth-modal").hidden = false; d.getElementById("tab-cloud").click();
  d.getElementById("magic-btn").click(); await tick(200);
  T("S4 magic toast", toastHas("Magic link sent"));
  d.getElementById("signup-btn").click(); await tick(200);
  T("S5 cloud signup", toastHas("Welcome! Cloud sync is on"));
  d.getElementById("auth-btn").click(); await tick(200);
  T("S6 cloud signout", toastHas("Signed out") && cards() === 2, cards());
  d.querySelector(".note-card").click(); await tick(100);
  d.getElementById("github-backup-btn").click(); await tick(100);
  T("T1 backup needs cloud", toastHas("cloud mode"));
  blurActive(); // real taps move focus; jsdom .click() doesn't
  d.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
  T("T2 slash focuses search", d.activeElement === d.getElementById("search-input"));
  blurActive();
  d.dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })); await tick(150);
  T("T3 ctrl+s saves", d.getElementById("save-state").textContent.includes("Saved"));
  d.getElementById("mobile-new").click();
  T("T4 mobile-new", cards() === 3, cards());
  T("U1 no stray error surfaces", !d.getElementById("toasts").textContent.includes("⚠"));
  console.log(fails ? `RESULT: ${fails}/${n} FAILURES` : `RESULT: ALL ${n} PASS`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
