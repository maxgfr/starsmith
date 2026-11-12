import { TOOL_NAME, TOOL_URL } from "../constants.js";
import { format, type Messages } from "../i18n/index.js";
import { escapeHtml, UPDATED } from "./format.js";
import { type JsonRepo, reposToLines } from "./json.js";

export interface HtmlModel {
  title: string;
  description: string;
  locale: string;
  username: string;
  repos: JsonRepo[];
  groups: { name: string; count: number }[];
  digest: string | null;
  t: Messages;
}

/** JSON safe inside a <script> element: no `</script>`, no HTML comment openers. */
function scriptJson(text: string): string {
  return text
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const STYLE = `
:root{--bg:#fbfaf8;--panel:#fff;--text:#1d1c1a;--muted:#6b6862;--line:#e7e4de;--accent:#b4531c;--chip:#f2efe9;--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.04)}
[data-theme=dark]{--bg:#141312;--panel:#1c1b19;--text:#ecebe8;--muted:#9a968e;--line:#2d2b28;--accent:#f0915a;--chip:#26241f;--shadow:none}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141312;--panel:#1c1b19;--text:#ecebe8;--muted:#9a968e;--line:#2d2b28;--accent:#f0915a;--chip:#26241f;--shadow:none}}
*{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
.wrap{max-width:1200px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:24px}
h1{font-size:clamp(28px,4vw,40px);line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}
.lede{color:var(--muted);margin:0;max-width:65ch}
.meta{color:var(--muted);font-size:13px;margin-top:8px}
.icon-btn{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;width:40px;height:40px;cursor:pointer;font-size:18px;flex:none}
.digest{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:24px;box-shadow:var(--shadow)}
.digest p{margin:.4em 0}
.controls{position:sticky;top:0;z-index:2;background:var(--bg);padding:12px 0;display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid var(--line)}
.controls input[type=search],.controls select{height:40px;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;padding:0 12px;font:inherit;min-width:0}
.controls label{display:flex;gap:6px;align-items:center;color:var(--muted);font-size:14px;white-space:nowrap}
.layout{display:grid;grid-template-columns:240px 1fr;gap:28px;margin-top:20px}
nav{position:sticky;top:76px;align-self:start;max-height:calc(100vh - 96px);overflow:auto;font-size:14px}
nav button{display:flex;justify-content:space-between;width:100%;text-align:left;border:0;background:none;color:var(--muted);padding:5px 8px;border-radius:8px;cursor:pointer;font:inherit}
nav button:hover{background:var(--chip);color:var(--text)}
nav button[aria-pressed=true]{background:var(--chip);color:var(--text);font-weight:600}
nav .count{font-variant-numeric:tabular-nums;opacity:.7}
#group-select{display:none}
.status{color:var(--muted);font-size:14px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:var(--shadow);min-width:0}
.card h3{margin:0;font-size:15px;line-height:1.3;overflow-wrap:anywhere}
.card h3 a{text-decoration:none}
.card h3 a:hover{color:var(--accent)}
.card h3 .owner{color:var(--muted);font-weight:400}
.card p{margin:0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.card .foot{margin-top:auto;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:13px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{border:0;background:var(--chip);color:var(--muted);border-radius:999px;padding:2px 8px;font:inherit;font-size:12px;cursor:pointer}
.chip:hover{color:var(--accent)}
.badge{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:0 6px}
.empty{color:var(--muted);padding:40px 0;text-align:center}
footer{margin-top:48px;color:var(--muted);font-size:13px;text-align:center}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:820px){.layout{grid-template-columns:1fr}nav{display:none}#group-select{display:block}.controls{grid-template-columns:1fr 1fr}.controls input[type=search]{grid-column:1/-1}}
`;

// Plain DOM, no framework: the page must work from a file:// URL and stay one file.
const SCRIPT = `
const D=JSON.parse(document.getElementById("data").textContent);
const T=D.t, $=(s)=>document.querySelector(s);
const fmt=(s,v)=>s.replace(/\\{(\\w+)\\}/g,(m,k)=>k in v?v[k]:m);
const nf=new Intl.NumberFormat(D.locale,{notation:"compact",maximumFractionDigits:1});
const state={q:"",group:"",lang:"",sort:"stars",hideArchived:false,limit:120};
const params=new URLSearchParams(location.hash.slice(1));
for(const k of ["q","group","lang","sort"]) if(params.get(k)) state[k]=params.get(k);
state.hideArchived=params.get("archived")==="hide";
const el=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v==null)continue;if(k==="text")n.textContent=v;else if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v)}for(const c of kids)if(c)n.append(c);return n};
const safeUrl=(u)=>/^https?:\\/\\//i.test(u||"")?u:null;
const BADGES={archived:"🗄️",stale:"💤",new:"🆕",fork:"🍴"};
for(const r of D.repos) r._hay=[r.name,r.description||"",r.originalDescription||"",r.language||"",r.topics.join(" "),r.groups.join(" ")].join(" ").toLowerCase();

const q=$("#q"),langSel=$("#lang"),sortSel=$("#sort"),arch=$("#archived"),groupSel=$("#group-select");
q.value=state.q;sortSel.value=state.sort;arch.checked=state.hideArchived;
const langs=[...new Set(D.repos.map(r=>r.language).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
for(const l of langs) langSel.append(el("option",{value:l,text:l}));
langSel.value=state.lang;
const nav=$("nav");
const navButtons=[];
const addGroup=(name,label,count)=>{const b=el("button",{type:"button","aria-pressed":String(state.group===name),onclick:()=>{state.group=name;sync()}},el("span",{text:label}),el("span",{class:"count",text:String(count)}));navButtons.push([name,b]);nav.append(b);groupSel.append(el("option",{value:name,text:label+" ("+count+")"}))};
addGroup("",T.allGroups,D.repos.length);
for(const g of D.groups) addGroup(g.name,g.name,g.count);
groupSel.value=state.group;

function matches(r,terms){if(state.group&&!r.groups.includes(state.group))return false;if(state.lang&&r.language!==state.lang)return false;if(state.hideArchived&&r.archived)return false;return terms.every(t=>r._hay.includes(t))}
const sorters={stars:(a,b)=>b.stars-a.stars||a.name.localeCompare(b.name),starred:(a,b)=>b.starredAt.localeCompare(a.starredAt),pushed:(a,b)=>(b.pushedAt||"").localeCompare(a.pushedAt||"")||b.stars-a.stars,name:(a,b)=>a.name.localeCompare(b.name)};

function card(r){
  const [owner,name]=r.name.split("/");
  const topics=el("div",{class:"chips"});
  for(const t of r.topics.slice(0,6)) topics.append(el("button",{type:"button",class:"chip",text:t,onclick:()=>{q.value=t;state.q=t;sync()}}));
  const foot=el("div",{class:"foot"},el("span",{text:"★ "+nf.format(r.stars)}),r.language?el("span",{text:r.language}):null,r.license?el("span",{text:r.license}):null);
  for(const b of r.badges) foot.append(el("span",{class:"badge",title:b,text:BADGES[b]||b}));
  const home=safeUrl(r.homepage);
  if(home) foot.append(el("a",{href:home,rel:"noopener",target:"_blank",text:T.homepage+" ↗"}));
  return el("article",{class:"card"},el("h3",{},el("a",{href:safeUrl(r.url),rel:"noopener",target:"_blank"},el("span",{class:"owner",text:owner+" / "}),name)),r.description?el("p",{text:r.description}):null,r.topics.length?topics:null,foot);
}

let list=[];
function render(){
  const grid=$("#grid");grid.replaceChildren();
  const frag=document.createDocumentFragment();
  for(const r of list.slice(0,state.limit)) frag.append(card(r));
  grid.append(frag);
  $("#status").textContent=fmt(T.results,{count:list.length.toLocaleString(D.locale)});
  $("#empty").hidden=list.length>0;
}
function sync(){
  state.limit=120;
  const terms=state.q.toLowerCase().split(/\\s+/).filter(Boolean);
  list=D.repos.filter(r=>matches(r,terms)).sort(sorters[state.sort]||sorters.stars);
  for(const[name,b]of navButtons)b.setAttribute("aria-pressed",String(state.group===name));
  groupSel.value=state.group;
  const p=new URLSearchParams();
  if(state.q)p.set("q",state.q);if(state.group)p.set("group",state.group);if(state.lang)p.set("lang",state.lang);if(state.sort!=="stars")p.set("sort",state.sort);if(state.hideArchived)p.set("archived","hide");
  history.replaceState(null,"",p.toString()?"#"+p:location.pathname+location.search);
  render();
}
let timer;q.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>{state.q=q.value.trim();sync()},120)});
langSel.addEventListener("change",()=>{state.lang=langSel.value;sync()});
sortSel.addEventListener("change",()=>{state.sort=sortSel.value;sync()});
arch.addEventListener("change",()=>{state.hideArchived=arch.checked;sync()});
groupSel.addEventListener("change",()=>{state.group=groupSel.value;sync()});
document.addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement!==q){e.preventDefault();q.focus()}});
new IntersectionObserver(es=>{if(es[0].isIntersecting&&state.limit<list.length){state.limit+=120;render()}},{rootMargin:"600px"}).observe($("#more"));
const root=document.documentElement,stored=localStorage.getItem("theme");if(stored)root.dataset.theme=stored;
$("#theme").addEventListener("click",()=>{const dark=root.dataset.theme?root.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches;root.dataset.theme=dark?"light":"dark";localStorage.setItem("theme",root.dataset.theme)});
sync();
`;

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Markdown links as plain text, for attributes and the page title. */
export function stripLinks(text: string): string {
  return text.replace(MD_LINK, "$1");
}

/** Escaped text where Markdown links to http(s) URLs become anchors. */
export function inlineHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(MD_LINK)) {
    const [whole, label = "", url = ""] = match;
    out += escapeHtml(text.slice(last, match.index));
    out += `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
    last = (match.index ?? 0) + whole.length;
  }
  return out + escapeHtml(text.slice(last));
}

function digestHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`)
    .join("");
}

/** A static, single-file site: search, filters, sort and dark mode over the embedded stars. */
export function renderHtml(model: HtmlModel): string {
  const { t } = model;
  const data = {
    locale: model.locale,
    t: t.html,
    groups: model.groups,
    repos: "__REPOS__",
  };
  // Repositories go one per line, like data.json, so a changed star is a one-line diff.
  const json = scriptJson(JSON.stringify(data)).replace('"__REPOS__"', scriptJson(reposToLines(model.repos)));
  const description =
    model.description || format(t.defaultDescription, { tool: `[${TOOL_NAME}](${TOOL_URL})` });
  const lang = escapeHtml(model.locale);
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<meta name="description" content="${escapeHtml(stripLinks(description))}">
<meta name="generator" content="${TOOL_NAME}">
<style>${STYLE.trim()}</style>
</head>
<body>
<div class="wrap">
<header>
<div>
<h1>${escapeHtml(model.title)}</h1>
<p class="lede">${inlineHtml(description)}</p>
<p class="meta">${escapeHtml(format(t.html.results, { count: model.repos.length }))} · ${escapeHtml(t.updated)} ${UPDATED} · <a href="https://github.com/${escapeHtml(model.username)}?tab=stars">@${escapeHtml(model.username)}</a></p>
</div>
<button id="theme" class="icon-btn" type="button" aria-label="${escapeHtml(t.html.theme)}" title="${escapeHtml(t.html.theme)}">◐</button>
</header>
${model.digest ? `<section class="digest" aria-label="${escapeHtml(t.digest)}">${digestHtml(model.digest)}</section>` : ""}
<div class="controls">
<input id="q" type="search" placeholder="${escapeHtml(t.html.search)}" aria-label="${escapeHtml(t.html.search)}" autocomplete="off">
<select id="group-select" aria-label="${escapeHtml(t.html.allGroups)}"></select>
<select id="lang" aria-label="${escapeHtml(t.html.allLanguages)}"><option value="">${escapeHtml(t.html.allLanguages)}</option></select>
<select id="sort" aria-label="Sort">
<option value="stars">${escapeHtml(t.html.sortStars)}</option>
<option value="starred">${escapeHtml(t.html.sortStarred)}</option>
<option value="pushed">${escapeHtml(t.html.sortPushed)}</option>
<option value="name">${escapeHtml(t.html.sortName)}</option>
</select>
<label><input id="archived" type="checkbox"> ${escapeHtml(t.html.hideArchived)}</label>
</div>
<div class="layout">
<nav aria-label="${escapeHtml(t.contents)}"></nav>
<main>
<p id="status" class="status" aria-live="polite"></p>
<div id="grid" class="grid"></div>
<p id="empty" class="empty" hidden>${escapeHtml(t.html.noResults)}</p>
<div id="more"></div>
</main>
</div>
<footer>${escapeHtml(format(t.generatedBy, { tool: "" }))}<a href="${TOOL_URL}">${TOOL_NAME}</a></footer>
</div>
<script type="application/json" id="data">${json}</script>
<script>${SCRIPT.trim()}</script>
</body>
</html>
`;
}
