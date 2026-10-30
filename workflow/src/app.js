(function(){
"use strict";
/* ---------- constants ---------- */
const ST={SUB:"submitted",RET:"returned",GF:"gf_approved",OK:"approved",INV:"invoiced"};
const ST_LABEL={submitted:"Awaiting GF",returned:"Returned to field",gf_approved:"Awaiting billing",approved:"Ready to invoice",invoiced:"Invoiced"};
const ST_CHIP={submitted:"c-sch",returned:"c-bad",gf_approved:"c-req",approved:"c-done",invoiced:"c-stage"};
const ST_ORDER=[ST.SUB,ST.RET,ST.GF,ST.OK,ST.INV];
const ROLES={admin:"Admin",approver:"Billing approver",gf:"General Foreman",crew:"Crew",viewer:"Viewer"};
const ROLE_HELP={admin:"Admin — everything, incl. logins, jobs, rates",approver:"Billing approver — final approval, invoices",gf:"General Foreman — review and approve crew sheets",crew:"Crew — submit daily unit sheets",viewer:"Viewer — read only"};
const CK="pole set|c k";
/* Crew Daily Unit Checklist, in the order printed on the paper sheet */
const CREW_SECTIONS=[
 ["Pole top configuration",[["pole top configuration|single phase no equipment","Single phase - no equipment"],["pole top configuration|single phase with equipment","Single phase - with equipment"],["pole top configuration|multi phase no equipment","Multi-phase - no equipment"],["pole top configuration|multi phase with equipment","Multi-phase - with equipment"],["pole top configuration|secondary no equipment","Secondary - no equipment"],["pole top configuration|secondary with equipment","Secondary - with equipment"]]],
 ["Riser with relocation",[["riser with relocation|single phase riser","Single-phase riser"],["riser with relocation|multi phase riser","Multi-phase riser"],["riser with relocation|secondary riser","Secondary riser"]]],
 ["Riser without relocation",[["riser without relocation|single phase riser","Single-phase riser"],["riser without relocation|multi phase riser","Multi-phase riser"],["riser without relocation|secondary riser","Secondary riser"]]],
 ["Transfers",[["transfers|transfer open wire old rack","Open wire - old rack"],["transfers|transfer open wire new rack","Open wire - new rack"],["transfers|transfer open wire dead end","Open wire - dead end"],["transfers|transfer aerial cable","Aerial cable"]]],
 ["Pole hole",[["pole hole|successful hole drill","Successful hole drill"],["pole hole|unsuccessful hole drill attempt","Unsuccessful drill attempt"],["pole hole|hand dig per hour","Hand dig (hours)"],["pole hole|sidewalk cut per hour","Sidewalk cut (hours)"]]],
 ["Pole set",[["pole set|pole set completion level 1 difficulty","Set - Level 1 difficulty"],["pole set|pole set completion level 2 difficulty","Set - Level 2 difficulty"],["pole set|pole set completion level 3 difficulty","Set - Level 3 difficulty"],[CK,"C&K"],["pole set|pull pole dispose","Pull pole & dispose"]]],
 ["Reconductoring",[["reconductoring|run primary wire","Run primary wire"],["reconductoring|remove primary wire","Remove primary wire"],["reconductoring|run secondary wire","Run secondary wire"],["reconductoring|remove secondary wire","Remove secondary wire"],["reconductoring|clip in conductor","Clip in conductor"]]]];
const CREW_KEYS=new Set(CREW_SECTIONS.flatMap(s=>s[1].map(i=>i[0])));

/* ---------- state ---------- */
const S={docs:new Map(),loaded:false,canWrite:false,view:"sheets",docId:null,
  f:{q:"",status:"open",job:""},pf:{job:"",q:"",st:""},
  config:null,dek:null,index:null,shas:{},me:null,myKey:null,busy:0,tmplBuf:null};
const main=document.getElementById("main"),overlay=document.getElementById("overlay");

/* ---------- helpers ---------- */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayStr=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
function fmtD(s){if(!s)return"";const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);return m?(m[2]+"/"+m[3]+"/"+m[1]):s;}
const isoDay=iso=>{if(!iso)return"";const d=new Date(iso);return isNaN(d)?"":fmtD(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"));};
function fmtT(s){if(!s)return"";const d=new Date(s);return isNaN(d)?s:d.toLocaleString("en-US",{month:"2-digit",day:"2-digit",year:"numeric",hour:"numeric",minute:"2-digit"});}
function fmtN(v){if(v==null||v==="")return"";const n=Number(v);return isFinite(n)?n.toLocaleString("en-US",{maximumFractionDigits:4}):"";}
const cents=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const money=v=>v==null||!isFinite(v)?"—":Number(v).toLocaleString("en-US",{style:"currency",currency:"USD"});
function newId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
let toastT;function toast(msg,ms){let t=document.getElementById("toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";t.setAttribute("role","status");document.body.appendChild(t);}t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,ms||3500);}
const jobs=()=>(S.index&&S.index.jobs)||[];
const jobById=id=>jobs().find(j=>j.id===id)||null;
const poleById=(j,pid)=>j&&(j.poles||[]).find(p=>p.id===pid)||null;
const poleLabel=p=>p?(p.street+" · "+p.esPole+(p.ticket?" · "+p.ticket:"")):"";
const rates=()=>(S.index&&S.index.rates)||null;
const unitMap=()=>{const m=new Map();(rates()?rates().units:[]).forEach(u=>m.set(u.key,u));return m;};
function unitInfo(key){if(key===CK)return{key,workType:"Pole Set",item:"C&K",rates:{},noRate:true};return unitMap().get(key)||{key,workType:"",item:key,rates:{},unknown:true};}
const poleArea=(j,p)=>(p&&p.area)||(j&&j.area)||"";
const sheets=()=>[...S.docs.entries()].filter(([,d])=>d.type==="sheet").map(([id,d])=>Object.assign({id},d));
const invoices=()=>[...S.docs.entries()].filter(([,d])=>d.type==="invoice").map(([id,d])=>Object.assign({id},d));
const stChip=d=>'<span class="chip '+(ST_CHIP[d.status]||"c-stage")+'">'+esc(ST_LABEL[d.status]||d.status)+"</span>"+(d.hold&&d.hold.on?' <span class="chip c-bad">On hold</span>':"");
function sheetPoleText(d){const j=jobById(d.jobId);const p=poleById(j,d.poleId);return p?poleLabel(p):(d.poleText?d.poleText+" (not on packet list)":"—");}

/* ---------- crypto (same scheme as the AP Invoice Tracker) ---------- */
const subtle=crypto.subtle,te=new TextEncoder(),td=new TextDecoder();
const b64=buf=>{const a=new Uint8Array(buf);let s="";for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000));return btoa(s);};
const unb64=s=>Uint8Array.from(atob(String(s).replace(/\s/g,"")),c=>c.charCodeAt(0));
const rand=n=>crypto.getRandomValues(new Uint8Array(n));
const hexId=n=>[...rand(n)].map(b=>b.toString(16).padStart(2,"0")).join("");
const sha256hex=async s=>[...new Uint8Array(await subtle.digest("SHA-256",te.encode(s)))].map(b=>b.toString(16).padStart(2,"0")).join("");
const userKey=u=>sha256hex("pg-wf:user:"+u.trim().toLowerCase());
async function decJson(key,box){return JSON.parse(td.decode(await subtle.decrypt({name:"AES-GCM",iv:unb64(box.iv)},key,unb64(box.ct))));}
async function encJson(key,obj){const iv=rand(12);const ct=await subtle.encrypt({name:"AES-GCM",iv},key,te.encode(JSON.stringify(obj)));return{iv:b64(iv),ct:b64(ct)};}
async function pwKey(pw,salt,iter,uses){const base=await subtle.importKey("raw",te.encode(pw),"PBKDF2",false,["deriveKey"]);return subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,uses);}
async function wrapDek(pw,iter=310000){const salt=rand(16),iv=rand(12);const k=await pwKey(pw,salt,iter,["wrapKey"]);const w=await subtle.wrapKey("raw",S.dek,k,{name:"AES-GCM",iv});return{salt:b64(salt),iter,iv:b64(iv),wrapped:b64(w)};}
const PW_ALPHA="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const genPw=()=>[0,1,2,3].map(()=>[...rand(5)].map(b=>PW_ALPHA[b%PW_ALPHA.length]).join("")).join("-");

/* ---------- roles & permissions ---------- */
const role=()=>S.me?S.me.role:"viewer";
const isAdmin=()=>role()==="admin";
const isBill=()=>isAdmin()||role()==="approver";
const RATE_USERS=["jsmith","skarlowsky"];
const canRates=()=>!!(S.me&&RATE_USERS.includes(S.me.username));
const hasToken=()=>!!(S.index&&S.index.ghToken);
const W=()=>S.canWrite;
const can={
  newSheet:()=>W()&&["admin","gf","crew"].includes(role()),
  editSheet:d=>W()&&d.status!==ST.INV&&(isAdmin()||(role()==="approver"&&[ST.GF,ST.OK].includes(d.status))||(role()==="gf"&&[ST.SUB,ST.RET].includes(d.status))||(role()==="crew"&&d.createdByKey===S.myKey&&[ST.SUB,ST.RET].includes(d.status))),
  gf:d=>W()&&(isAdmin()||role()==="gf")&&d.status===ST.SUB,
  bill:d=>W()&&isBill()&&d.status===ST.GF,
  reopen:d=>W()&&isBill()&&d.status===ST.OK,
  hold:d=>W()&&(isBill()||role()==="gf")&&[ST.SUB,ST.GF,ST.OK].includes(d.status),
  invoice:()=>W()&&isBill(),
  setup:()=>W()&&isBill(),
  seePrice:()=>role()!=="crew"
};
function applyRO(){S.canWrite=hasToken()&&!!S.me&&role()!=="viewer";document.body.classList.toggle("ro",!S.canWrite);document.body.classList.toggle("notadmin",!isAdmin());
  document.body.classList.toggle("nobill",!isBill());document.body.classList.toggle("crewonly",role()==="crew");renderBanner();}
function renderBanner(){const b=document.getElementById("bannerWrap");if(!b)return;
  if(!S.index||hasToken()){b.innerHTML="";return;}
  b.innerHTML='<div class="banner">'+(isAdmin()?'Saving is not connected yet. Open <b>Settings</b> and paste the GitHub key (the same one the AP Invoice Tracker uses) so changes are saved for everyone.':'View only for now: saving still needs to be connected by an admin.')+"</div>";}

/* ---------- GitHub storage ---------- */
const R=()=>S.config.repo;
const api=p=>"https://api.github.com/repos/"+R().owner+"/"+R().repo+"/contents/"+(R().base||"")+p;
const ghHdr=tok=>({Authorization:"Bearer "+(tok||S.index.ghToken),Accept:"application/vnd.github+json"});
const ghMsg=(st,what)=>st===401?"GitHub rejected the key (401: invalid or expired). Re-paste the full github_pat_… token in Settings."
  :st===403?"GitHub refused the "+what+" (403: the key doesn't have Contents read & write on "+R().repo+")."
  :st===404?"GitHub couldn't find the file or repository with this key (404)."
  :"GitHub "+what+" failed ("+st+").";
async function ghGet(p,tok){
  const r=await fetch(api(p)+"?ref="+R().branch+"&t="+Date.now(),{headers:ghHdr(tok),cache:"no-store"});
  if(r.status===404)return null;if(!r.ok)throw new Error(ghMsg(r.status,"read"));
  const meta=await r.json();let content=meta.content;
  if(!content){const br=await fetch("https://api.github.com/repos/"+R().owner+"/"+R().repo+"/git/blobs/"+meta.sha,{headers:ghHdr(tok)});if(!br.ok)throw new Error(ghMsg(br.status,"read"));content=(await br.json()).content;}
  return{sha:meta.sha,text:td.decode(unb64(content))};}
async function ghList(p){const r=await fetch(api(p)+"?ref="+R().branch+"&t="+Date.now(),{headers:ghHdr(),cache:"no-store"});if(r.status===404)return[];if(!r.ok)throw new Error(ghMsg(r.status,"read"));return r.json();}
async function ghPut(p,text,sha,message,tok){
  const body={message,content:b64(te.encode(text)),branch:R().branch};if(sha)body.sha=sha;
  const r=await fetch(api(p),{method:"PUT",headers:ghHdr(tok),body:JSON.stringify(body)});
  if(r.status===409||r.status===422){const e=new Error("conflict");e.conflict=true;throw e;}
  if(!r.ok)throw new Error(ghMsg(r.status,"save"));return(await r.json()).content.sha;}
async function pagesGet(p){const r=await fetch(p+"?t="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("Could not load "+p+" ("+r.status+")");return r.json();}
function errText(e){const m=(e&&e.message)||String(e);return /failed to fetch|networkerror|load failed/i.test(m)?"Could not reach GitHub (network or firewall). Your change was not saved. Try again.":m;}
function setBusy(d){S.busy=Math.max(0,S.busy+d);document.body.style.cursor=S.busy?"progress":"";}

/* ---------- load ---------- */
async function loadIndex(){
  let idx=await decJson(S.dek,await pagesGet("data/index.enc.json"));
  if(idx.ghToken){try{const f=await ghGet("data/index.enc.json",idx.ghToken);if(f)idx=await decJson(S.dek,JSON.parse(f.text));}catch(e){console.warn(e);}}
  S.index=idx;}
async function loadDocs(){
  const ids=Object.keys(S.index.docs||{});const next=new Map();let list=null;
  if(hasToken()){try{list=await ghList("data/docs");}catch(e){console.warn(e);}}
  const shaBy={};(list||[]).forEach(x=>{shaBy[x.name.replace(/\.enc\.json$/,"")]=x.sha;});
  await Promise.all(ids.map(async id=>{const file=S.index.docs[id].file;
    try{
      if(list){
        if(!shaBy[file])return;
        if(S.docs.has(id)&&S.shas[file]===shaBy[file]){next.set(id,S.docs.get(id));return;}
        const f=await ghGet("data/docs/"+file+".enc.json");if(!f)return;
        next.set(id,await decJson(S.dek,JSON.parse(f.text)));S.shas[file]=f.sha;
      }else next.set(id,await decJson(S.dek,await pagesGet("data/docs/"+file+".enc.json")));
    }catch(e){console.warn("Record failed to load",id,e);if(S.docs.has(id))next.set(id,S.docs.get(id));}
  }));
  S.docs=next;}
async function loadAll(){await loadIndex();await loadDocs();S.loaded=true;
  const prof=S.index.profiles&&S.index.profiles[S.myKey];if(prof)S.me=Object.assign({key:S.myKey},prof);}
async function templateBuf(){
  if(S.tmplBuf)return S.tmplBuf;
  const tm=S.index.template;if(!tm||!tm.file)throw new Error("No invoice template has been loaded yet (Rates tab).");
  let box;if(hasToken()){const f=await ghGet("data/"+tm.file);if(!f)throw new Error("The template file is missing from GitHub.");box=JSON.parse(f.text);}else box=await pagesGet("data/"+tm.file);
  const o=await decJson(S.dek,box);S.tmplBuf=unb64(o.b64).buffer;return S.tmplBuf;}

/* ---------- save ---------- */
function canSave(){
  if(!hasToken()){toast(isAdmin()?"Saving isn't connected yet. Paste the GitHub key in Settings.":"Saving isn't connected yet. An admin needs to add the GitHub key in Settings.",7000);if(isAdmin())openSettings();return false;}
  if(!S.canWrite){toast("Your login is view-only.");return false;}return true;}
function stamp(d,hist){d.updatedAt=new Date().toISOString();d.updatedBy=S.me.name;
  if(hist){(d.history=d.history||[]).push({t:d.updatedAt,by:S.me.name,text:String(hist).slice(0,2000)});if(d.history.length>400)d.history=d.history.slice(-400);}}
async function commitIndex(op,msg){
  for(let a=0;a<4;a++){
    const f=await ghGet("data/index.enc.json");const fresh=await decJson(S.dek,JSON.parse(f.text));const out=op(fresh);
    try{await ghPut("data/index.enc.json",JSON.stringify(await encJson(S.dek,fresh)),f.sha,msg||"Workflow: update");S.index=fresh;return out;}catch(e){if(!e.conflict)throw e;}
  }throw new Error("Someone else saved at the same moment. Try again.");}
async function commitConfig(op,msg){
  for(let a=0;a<4;a++){
    const f=await ghGet("config.json");const fresh=JSON.parse(f.text);op(fresh);
    try{await ghPut("config.json",JSON.stringify(fresh,null,1),f.sha,msg);S.config=fresh;return;}catch(e){if(!e.conflict)throw e;}
  }throw new Error("Someone else saved at the same moment. Try again.");}
async function reloadDoc(id){try{const file=S.index.docs[id].file;const f=await ghGet("data/docs/"+file+".enc.json");if(f){S.docs.set(id,await decJson(S.dek,JSON.parse(f.text)));S.shas[file]=f.sha;}}catch(e){}}
async function commitDoc(id,op,hist,silent){
  if(!canSave())return false;
  const ent=S.index.docs[id];if(!ent){toast("This record no longer exists.");return false;}
  const p="data/docs/"+ent.file+".enc.json";setBusy(1);
  try{
    for(let a=0;a<4;a++){
      const f=await ghGet(p);if(!f)throw new Error("This record was removed by someone else.");
      const fresh=await decJson(S.dek,JSON.parse(f.text));op(fresh);stamp(fresh,hist);
      try{S.shas[ent.file]=await ghPut(p,JSON.stringify(await encJson(S.dek,fresh)),f.sha,"Workflow: update record");S.docs.set(id,fresh);if(!silent)refresh();return true;}
      catch(e){if(!e.conflict)throw e;}
    }
    throw new Error("Someone else saved this at the same moment. Try again.");
  }catch(e){toast(errText(e),9000);await reloadDoc(id);refresh();return false;}
  finally{setBusy(-1);}
}
async function createDoc(type,doc,hist){
  if(!canSave())return null;const id=newId(type==="sheet"?"s-":"i-");const file=hexId(12);setBusy(1);
  try{
    const no=await commitIndex(ix=>{ix.seq=ix.seq||{};ix.docs=ix.docs||{};let n=null;if(type==="sheet"){ix.seq.sheet=(ix.seq.sheet||0)+1;n=ix.seq.sheet;}ix.docs[id]={file,type};return n;},"Workflow: add record");
    doc.type=type;if(type==="sheet")doc.no="US-"+String(no).padStart(4,"0");
    doc.createdAt=new Date().toISOString();doc.createdBy=S.me.name;doc.createdByKey=S.myKey;stamp(doc,hist);
    S.shas[file]=await ghPut("data/docs/"+file+".enc.json",JSON.stringify(await encJson(S.dek,doc)),null,"Workflow: add record");
    S.docs.set(id,doc);refresh();return id;
  }catch(e){toast(errText(e),9000);return null;}finally{setBusy(-1);}
}

/* ---------- auth ---------- */
async function login(u,p){
  const k=await userKey(u);const entry=S.config.users[k];
  if(!entry)throw new Error("Username or password is incorrect.");
  const wk=await pwKey(p,unb64(entry.salt),entry.iter,["unwrapKey"]);
  try{S.dek=await subtle.unwrapKey("raw",unb64(entry.wrapped),wk,{name:"AES-GCM",iv:unb64(entry.iv)},{name:"AES-GCM",length:256},true,["encrypt","decrypt"]);}
  catch(e){throw new Error("Username or password is incorrect.");}
  S.myKey=k;S.me=null;await loadAll();
  if(!S.me)S.me={key:k,username:u.trim().toLowerCase(),name:u.trim(),role:"viewer"};
}
function enterApp(){
  document.getElementById("login").hidden=true;document.getElementById("app").hidden=false;
  document.getElementById("meName").textContent=S.me.name;document.getElementById("meRole").textContent=ROLES[S.me.role]||S.me.role;
  if(role()==="crew")S.f.status="";
  applyRO();route();
  clearInterval(S.poll);S.poll=setInterval(async()=>{if(document.hidden||S.busy||overlay.innerHTML)return;try{await loadAll();applyRO();refresh();}catch(e){}},90000);
}
async function initLogin(){
  try{S.config=await pagesGet("config.json");}catch(e){document.getElementById("loginErr").textContent="The tracker couldn't load its settings. Reload the page.";}
  document.getElementById("loginForm").onsubmit=async e=>{
    e.preventDefault();const err=document.getElementById("loginErr"),b=document.getElementById("loginBtn");err.textContent="";b.disabled=true;b.textContent="Signing in…";
    try{await login(document.getElementById("u").value,document.getElementById("p").value);document.getElementById("p").value="";enterApp();}
    catch(x){err.textContent=x.message||"Sign-in failed.";}
    finally{b.disabled=false;b.textContent="Sign in";}
  };
  document.getElementById("btn-out").onclick=()=>{location.hash="";location.reload();};
  document.getElementById("btn-settings").onclick=openSettings;
  document.getElementById("btn-logins").onclick=openLogins;
  document.getElementById("btn-pw").onclick=openPassword;
  document.getElementById("btn-new").onclick=()=>openSheetForm(null);
}

/* ---------- overlays ---------- */
function closeOverlay(){overlay.innerHTML="";document.removeEventListener("keydown",escKey);}
function escKey(e){if(e.key==="Escape"){const tops=overlay.querySelectorAll(".modal");if(tops.length>1){const t=tops[tops.length-1];t.previousElementSibling&&t.previousElementSibling.remove();t.remove();return;}closeOverlay();}}
function modal(title,body,foot,cls){
  closeOverlay();
  const scr=document.createElement("div");scr.className="scrim";const m=document.createElement("div");m.className="modal "+(cls||"small");m.setAttribute("role","dialog");m.setAttribute("aria-modal","true");
  m.innerHTML='<header><h2>'+esc(title)+'</h2><button class="btn sm" type="button" data-x>Close</button></header><div class="body">'+body+'</div><footer><span class="sub" data-msg></span><span class="sp"></span>'+foot+"</footer>";
  overlay.appendChild(scr);overlay.appendChild(m);document.addEventListener("keydown",escKey);
  scr.onclick=()=>closeOverlay();m.querySelectorAll("[data-x]").forEach(b=>b.onclick=()=>closeOverlay());
  return m;}
async function busyRun(btn,m,fn,label){const t=btn.textContent;btn.disabled=true;btn.textContent=label||"Saving…";const msg=m.querySelector("[data-msg]");msg.textContent="";
  try{await fn();}catch(e){msg.textContent=errText(e);}finally{btn.disabled=false;btn.textContent=t;}}
function confirmBox(title,body,label,onOk,opts){
  opts=opts||{};
  const scr=document.createElement("div");scr.className="scrim top";const m=document.createElement("div");m.className="modal small";m.setAttribute("role","alertdialog");m.setAttribute("aria-modal","true");
  m.innerHTML='<header><h2>'+esc(title)+'</h2></header><div class="body"><p style="margin:0">'+esc(body)+'</p>'+(opts.note?'<label class="f" for="cf-note">'+esc(opts.note)+(opts.noteReq?" (required)":" (optional)")+'<textarea id="cf-note"></textarea></label>':"")+'<div class="err" data-err></div></div><footer><span class="sp"></span><button class="btn" type="button" data-x>Cancel</button><button class="btn '+(opts.danger?"danger":"primary")+'" type="button" data-ok>'+esc(label)+"</button></footer>";
  overlay.appendChild(scr);overlay.appendChild(m);document.addEventListener("keydown",escKey);
  const close=()=>{scr.remove();m.remove();};scr.onclick=close;m.querySelector("[data-x]").onclick=close;
  m.querySelector("[data-ok]").onclick=async()=>{const n=m.querySelector("#cf-note");const v=n?n.value.trim():"";
    if(opts.noteReq&&!v){m.querySelector("[data-err]").textContent="Add a note so the next person knows why.";return;}
    const b=m.querySelector("[data-ok]");b.disabled=true;b.textContent="Saving…";await onOk(v);close();};
  (m.querySelector("#cf-note")||m.querySelector("[data-ok]")).focus();
}

/* ---------- settings, password, logins ---------- */
function openSettings(){
  if(!isAdmin())return;
  const m=modal("Settings",'<p class="sub" style="margin:0">Saving uses a GitHub access key with <b>Contents: read &amp; write</b> on '+esc(R().owner)+"/"+esc(R().repo)+'. The key the AP Invoice Tracker and Project Tracker use works here. It is stored encrypted inside this tracker, so only these logins can use it.</p>'+
    '<label class="f" for="tok">GitHub fine-grained token<input id="tok" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" data-lpignore="true" data-1p-ignore placeholder="'+(hasToken()?"Connected · paste a new key to replace":"github_pat_…")+'"></label>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tok-save">Save key</button>');
  m.querySelector("#tok-save").onclick=e=>busyRun(e.target,m,async()=>{
    const tok=m.querySelector("#tok").value.trim();
    if(!tok)throw new Error("Paste the token first.");
    if(!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(tok))throw new Error("That doesn't look like a GitHub token. It starts with github_pat_ and has no spaces.");
    const f=await ghGet("data/index.enc.json",tok);if(!f)throw new Error("GitHub couldn't find the tracker data with this key.");
    const fresh=await decJson(S.dek,JSON.parse(f.text));fresh.ghToken=tok;
    await ghPut("data/index.enc.json",JSON.stringify(await encJson(S.dek,fresh)),f.sha,"Workflow: connect saving key",tok);
    S.index=fresh;applyRO();await loadDocs();refresh();closeOverlay();toast("Saving connected for all logins.");
  });
}
function openPassword(){
  const m=modal("Change password",'<label class="f" for="np1">New password (at least 10 characters)<input id="np1" type="password" autocomplete="new-password"></label><label class="f" for="np2">Confirm new password<input id="np2" type="password" autocomplete="new-password"></label>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="np-save">Change password</button>');
  m.querySelector("#np-save").onclick=e=>busyRun(e.target,m,async()=>{
    const a=m.querySelector("#np1").value,b=m.querySelector("#np2").value;
    if(a.length<10)throw new Error("Use at least 10 characters.");if(a!==b)throw new Error("The two passwords don't match.");
    if(!hasToken())throw new Error("Saving isn't connected yet, so the password can't be changed.");
    const entry=await wrapDek(a);await commitConfig(c=>{c.users[S.myKey]=entry;},"Workflow: change password");
    closeOverlay();toast("Password changed. Use it next time you sign in.");
  });
}
function openLogins(){
  if(!isAdmin())return;
  const draw=()=>{
    const profs=S.index.profiles||{};const keys=Object.keys(S.config.users||{});
    const rows=keys.map(k=>{const p=profs[k]||{username:"(unknown)",name:"(no profile)",role:"viewer"};const me=k===S.myKey;
      return'<div class="u" data-k="'+k+'"><div><b>'+esc(p.name)+'</b> <span class="sub">'+esc(p.username)+(p.crew?" · Crew "+esc(p.crew):"")+(me?" · you":"")+'</span></div><div class="acts">'+
        (me?'<span class="role">'+esc(ROLES[p.role]||p.role)+"</span>":'<select data-role aria-label="Role for '+esc(p.name)+'">'+Object.keys(ROLES).map(r=>'<option value="'+r+'"'+(r===p.role?" selected":"")+">"+ROLES[r]+"</option>").join("")+'</select><button class="btn sm" type="button" data-reset>Reset password</button><button class="btn sm danger" type="button" data-rm>Remove</button>')+"</div></div>";}).join("");
    return'<div class="sec-h" style="margin:0">Current logins</div><div class="ulist">'+rows+'</div>'+
      '<div class="sec-h" style="margin:4px 0 0">Add a login</div><fieldset style="grid-template-columns:1fr 1fr">'+
      '<label class="f" for="nu-name">Full name<input id="nu-name" autocomplete="off"></label>'+
      '<label class="f" for="nu-user">Username<input id="nu-user" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="e.g. jdoe"></label>'+
      '<label class="f" for="nu-role">Role<select id="nu-role">'+["crew","gf","approver","viewer","admin"].map(r=>'<option value="'+r+'">'+esc(ROLE_HELP[r])+"</option>").join("")+'</select></label>'+
      '<label class="f" for="nu-crew">Crew / lead (crew logins)<input id="nu-crew" autocomplete="off" placeholder="optional"></label>'+
      '<label class="f wide" for="nu-pw">Password<input id="nu-pw" type="text" autocomplete="off" spellcheck="false"></label></fieldset>'+
      '<div class="row-inline"><button class="btn" type="button" id="nu-gen">Generate password</button><span class="sub">At least 10 characters. Give the username and password to the person directly.</span></div><div id="nu-done"></div>';
  };
  const m=modal("Logins",draw(),'<button class="btn" type="button" data-x>Close</button><button class="btn primary" type="button" id="nu-save">Create login</button>');
  m.style.width="min(680px,calc(100% - 24px))";
  const bind=()=>{
    const body=m.querySelector(".body");
    body.querySelector("#nu-gen").onclick=()=>{body.querySelector("#nu-pw").value=genPw();};
    body.querySelectorAll(".u[data-k]").forEach(row=>{const k=row.dataset.k;const p=(S.index.profiles||{})[k]||{};
      const sel=row.querySelector("[data-role]");if(sel)sel.onchange=async()=>{if(!hasToken()){toast("Connect saving in Settings first.");return;}try{await commitIndex(ix=>{ix.profiles[k]=Object.assign({},ix.profiles[k],{role:sel.value});},"Workflow: change role");toast(p.name+" is now "+ROLES[sel.value]);}catch(e){toast(errText(e));}};
      const rs=row.querySelector("[data-reset]");if(rs)rs.onclick=async()=>{if(!hasToken()){toast("Connect saving in Settings first.");return;}const pw=genPw();
        try{const entry=await wrapDek(pw);await commitConfig(c=>{c.users[k]=entry;},"Workflow: reset password");body.querySelector("#nu-done").innerHTML='<div class="okbox">New password for <b>'+esc(p.name)+'</b> ('+esc(p.username)+'): <code>'+esc(pw)+"</code><br>Give it to them directly. It is not shown again.</div>";}catch(e){toast(errText(e));}};
      const rm=row.querySelector("[data-rm]");if(rm)rm.onclick=()=>confirmBox("Remove "+(p.name||"this login")+"?","They will no longer be able to sign in with this login.","Remove login",async()=>{
        try{await commitConfig(c=>{delete c.users[k];},"Workflow: remove login");await commitIndex(ix=>{delete ix.profiles[k];},"Workflow: remove login profile");body.innerHTML=draw();bind();toast("Login removed");}catch(e){toast(errText(e));}},{danger:true});
    });
  };
  bind();
  m.querySelector("#nu-save").onclick=e=>busyRun(e.target,m,async()=>{
    const body=m.querySelector(".body");
    const name=body.querySelector("#nu-name").value.trim(),user=body.querySelector("#nu-user").value.trim().toLowerCase(),r=body.querySelector("#nu-role").value,crew=body.querySelector("#nu-crew").value.trim(),pw=body.querySelector("#nu-pw").value;
    if(!name)throw new Error("Enter the person's full name.");
    if(!/^[a-z0-9._-]{3,32}$/.test(user))throw new Error("Username: 3–32 characters, letters, numbers, dot, dash or underscore.");
    if(pw.length<10)throw new Error("Password must be at least 10 characters. Use Generate password.");
    if(!hasToken())throw new Error("Connect saving in Settings first.");
    const k=await userKey(user);if(S.config.users[k])throw new Error("That username already exists.");
    const entry=await wrapDek(pw);
    await commitConfig(c=>{c.users[k]=entry;},"Workflow: add login");
    await commitIndex(ix=>{ix.profiles=ix.profiles||{};ix.profiles[k]={username:user,name,role:r,crew};},"Workflow: add login profile");
    body.innerHTML=draw();bind();
    body.querySelector("#nu-done").innerHTML='<div class="okbox">Login created for <b>'+esc(name)+'</b> ('+esc(ROLES[r])+').<br>Username: <code>'+esc(user)+'</code><br>Password: <code>'+esc(pw)+'</code><br>Give these to them directly. The password is not shown again. A new login can take a minute or two to start working.</div>';
  });
}

/* ---------- routing ---------- */
function route(){
  const h=(location.hash||"").replace(/^#/,"");closeOverlay();
  if(h.indexOf("sheet-")===0){S.view="sheet";S.docId=h.slice(6);}
  else if(h.indexOf("inv-")===0){S.view="invoice";S.docId=h.slice(4);}
  else if(h.indexOf("job-")===0){const id=h.slice(4);if(S.view!=="job"||S.docId!==id){S.jobTab="locs";S.pf={q:"",st:""};}S.view="job";S.docId=id;}
  else if(["invoices","addjob","rates","sheets"].includes(h))S.view=h;else S.view="overview";
  if(role()==="crew"&&!["overview","job","sheet","sheets"].includes(S.view))S.view="overview";
  if(S.view==="rates"&&!canRates())S.view="overview";
  const nav={sheet:"overview",sheets:"overview",job:"overview",invoice:"invoices"}[S.view]||S.view;
  document.querySelectorAll("[data-nav]").forEach(a=>{if(a.dataset.nav===nav)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
  refresh();window.scrollTo(0,0);
}
window.addEventListener("hashchange",route);
function visibleSheets(){let all=sheets();if(role()==="crew")all=all.filter(s=>s.createdByKey===S.myKey);return all;}
function refresh(){
  if(!S.loaded)return;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set("ct-jobs",jobs().filter(j=>!j.archived).length||"");
  set("ct-ready",sheets().filter(s=>s.status===ST.OK).length||"");
  document.getElementById("btn-new").hidden=!can.newSheet();
  document.querySelectorAll("[data-nav=rates]").forEach(a=>a.hidden=!canRates());
  const v=S.view;
  if(v==="sheet")renderSheet();else if(v==="invoice")renderInvoice();else if(v==="invoices")renderInvoices();
  else if(v==="job")renderJob();else if(v==="addjob")renderAddJob();else if(v==="rates")renderRates();else if(v==="sheets")renderSheets();else renderOverview();
}

/* ---------- pricing (rates from the template's Unit Rate Master; no rounding until display / final total) ---------- */
function priceSheet(d){
  const j=jobById(d.jobId),p=poleById(j,d.poleId),area=poleArea(j,p);const errs=[];
  if(!p)errs.push("Pole is not linked to the packet's pole list");
  if(!area)errs.push("No pricing area set for this pole");
  const lines=(d.lines||[]).map(l=>{const u=unitInfo(l.key);let rate=null;
    if(u.noRate)errs.push(u.item+" has no rate on the Unit Rate Master");else if(u.unknown)errs.push("Unit "+l.key+" is not on the Unit Rate Master");
    else if(area){rate=u.rates[area];if(rate==null)errs.push(u.item+" has no "+area+" rate");}
    return{key:l.key,workType:u.workType,item:u.item,qty:Number(l.qty),note:l.note||"",rate:rate==null?null:rate,ext:rate==null?null:Number(l.qty)*rate};});
  const total=errs.length?null:lines.reduce((a,l)=>a+l.ext,0);
  return{lines,total,area,errs:[...new Set(errs)],job:j,pole:p};}

/* ---------- views: unit sheets ---------- */
function tile(k,v,s,alert){return'<div class="tile'+(alert?" alert":"")+'"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span><span class="s">'+esc(s)+"</span></div>";}
function renderSheets(){
  const all=visibleSheets();
  const cnt=s=>all.filter(x=>x.status===s).length;
  const crew=role()==="crew";
  main.innerHTML='<a class="back" href="#overview">← Overview</a>'+(crew?'<div class="cta"><div><b>Crew daily unit sheets</b><span class="sub">Fill out one sheet per location. Your General Foreman reviews each sheet before it goes to billing.</span></div><button class="btn primary big w-only" type="button" id="cta-new">+ New unit sheet</button></div>':"")+
    '<h2 class="sec">Workflow</h2><section class="tiles">'+
    tile("Awaiting GF",cnt(ST.SUB),"Crew sheets to review",false)+tile("Returned to field",cnt(ST.RET),"Sent back for fixes",cnt(ST.RET)>0)+
    tile("Awaiting billing",cnt(ST.GF),"GF approved for billing",false)+tile("Ready to invoice",cnt(ST.OK),"Billing approved for invoice",false)+tile("Invoiced",cnt(ST.INV),"On an invoice",false)+"</section>"+
    '<div class="filters" role="search"><input type="search" id="f-q" placeholder="Search sheet #, street, pole, ticket, crew…" aria-label="Search unit sheets" value="'+esc(S.f.q)+'">'+
    '<select id="f-st" aria-label="Status"><option value="open">All open (not invoiced)</option><option value="">All sheets</option>'+ST_ORDER.map(s=>'<option value="'+s+'">'+esc(ST_LABEL[s])+"</option>").join("")+'<option value="hold">On hold</option></select>'+
    '<select id="f-job" aria-label="Job"><option value="">All jobs</option>'+jobs().map(j=>'<option value="'+esc(j.id)+'">'+esc(j.name)+"</option>").join("")+'</select><span class="count" id="f-count"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Sheet #</th><th class="nosort">Work date</th><th class="nosort">Job</th><th class="nosort">Pole / location</th><th class="nosort">Crew / lead</th><th class="nosort">Units</th>'+(can.seePrice()?'<th class="nosort num">Amount</th>':"")+'<th class="nosort">Status</th><th class="nosort">Last update</th></tr></thead><tbody id="tb"></tbody></table></div>';
  const cta=document.getElementById("cta-new");if(cta)cta.onclick=()=>openSheetForm(null);
  const q=document.getElementById("f-q"),st=document.getElementById("f-st"),jb=document.getElementById("f-job");st.value=S.f.status;jb.value=S.f.job;
  q.oninput=()=>{S.f.q=q.value;fill();};st.onchange=()=>{S.f.status=st.value;fill();};jb.onchange=()=>{S.f.job=jb.value;fill();};
  function fill(){
    const qq=S.f.q.trim().toLowerCase();
    const rows=all.filter(s=>{if(S.f.status==="open"){if(s.status===ST.INV)return false;}else if(S.f.status==="hold"){if(!(s.hold&&s.hold.on))return false;}else if(S.f.status&&s.status!==S.f.status)return false;
      if(S.f.job&&s.jobId!==S.f.job)return false;
      if(qq){const j=jobById(s.jobId);const hay=[s.no,j&&j.name,sheetPoleText(s),s.crew,s.wo,s.fwo].join(" ").toLowerCase();if(hay.indexOf(qq)<0)return false;}
      return true;}).sort((a,b)=>ST_ORDER.indexOf(a.status)-ST_ORDER.indexOf(b.status)||String(b.workDate).localeCompare(String(a.workDate))||String(b.no).localeCompare(String(a.no)));
    document.getElementById("f-count").textContent=rows.length+" sheet"+(rows.length===1?"":"s");
    const tb=document.getElementById("tb");
    tb.innerHTML=rows.length?rows.map(s=>{const j=jobById(s.jobId);const n=(s.lines||[]).length;const pr=can.seePrice()?priceSheet(s):null;
      return'<tr tabindex="0" data-id="'+esc(s.id)+'"><td class="mono"><b>'+esc(s.no)+'</b></td><td>'+fmtD(s.workDate)+'</td><td><div class="job-name">'+esc(j?j.name:"(job removed)")+'</div></td><td class="wrapc">'+esc(sheetPoleText(s))+"</td><td>"+esc(s.crew)+'</td><td class="mono">'+n+" unit"+(n===1?"":"s")+"</td>"+
        (pr?'<td class="mono num">'+(pr.total==null?'<span class="sub" title="'+esc(pr.errs.join("; "))+'">Check pricing</span>':money(pr.total))+"</td>":"")+"<td>"+stChip(s)+'</td><td class="sub">'+esc(fmtT(s.updatedAt))+"<br>"+esc(s.updatedBy||"")+"</td></tr>";}).join("")
      :'<tr><td colspan="9"><div class="empty"><b>No unit sheets here</b>'+(can.newSheet()?"Use + New unit sheet to log the units completed at a pole.":"Sheets appear here once crews submit them.")+"</div></td></tr>";
    bindRows(tb,id=>location.hash="sheet-"+id);
  }
  fill();
}
function bindRows(tb,fn){tb.querySelectorAll("tr[data-id]").forEach(tr=>{tr.onclick=()=>fn(tr.dataset.id);tr.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fn(tr.dataset.id);}};});}
function dl(k,v,wide){return'<div class="dl'+(wide?" wide":"")+'"><span class="k">'+esc(k)+'</span><span class="v">'+(v===""||v==null?'<span class="sub">—</span>':v)+"</span></div>";}
function histHtml(d){return'<div class="hist">'+((d.history||[]).slice().reverse().map(h=>'<div class="row"><span class="t">'+esc(fmtT(h.t))+"</span><b>"+esc(h.by)+"</b><span>"+esc(h.text)+"</span></div>").join("")||'<div class="row"><span class="sub">No history.</span></div>')+"</div>";}
function sheetLinesHtml(d){
  const priced=can.seePrice();const pr=priceSheet(d);
  const rows=pr.lines.map(l=>'<tr><td>'+esc(l.workType)+'</td><td class="wrapc"><b>'+esc(l.item)+"</b></td>"+'<td class="mono num">'+fmtN(l.qty)+"</td>"+
    (priced?'<td class="mono num">'+(l.rate==null?'<span class="late">No rate</span>':money(l.rate))+'</td><td class="mono num">'+(l.ext==null?"—":money(l.ext))+"</td>":"")+'<td class="wrapc sub">'+esc(l.note)+"</td></tr>").join("");
  return(priced&&pr.errs.length?'<div class="banner bad"><b>Pricing check:</b> '+esc(pr.errs.join(" · "))+"</div>":"")+
    '<div class="tablebox"><table class="static"><thead><tr><th>Work type</th><th>Unit</th><th class="num">Qty</th>'+(priced?'<th class="num">Unit rate</th><th class="num">Extended</th>':"")+"<th>Note</th></tr></thead><tbody>"+(rows||'<tr><td colspan="6" class="sub">No units entered.</td></tr>')+"</tbody>"+
    (priced&&pr.lines.length?'<tfoot><tr><td colspan="4" class="num"><b>Pole total'+(pr.area?" · "+esc(pr.area):"")+'</b></td><td class="mono num"><b>'+(pr.total==null?"Incomplete":money(pr.total))+'</b></td><td class="sub">Calculated: Σ qty × area rate, USD</td></tr></tfoot>':"")+"</table></div>";}
function renderSheet(){
  const d=S.docs.get(S.docId);
  if(!d||d.type!=="sheet"||(role()==="crew"&&d.createdByKey!==S.myKey)){main.innerHTML='<a class="back" href="#sheets">← Unit sheets</a><div class="empty"><b>Sheet not found</b>It may have been removed.</div>';return;}
  const j=jobById(d.jobId);const p=poleById(j,d.poleId);const id=S.docId;
  const acts=[];
  if(can.editSheet(d))acts.push('<button class="btn" type="button" id="a-edit">'+(d.status===ST.RET&&role()==="crew"?"Fix &amp; resubmit":"Edit sheet")+"</button>");
  if(can.hold(d))acts.push('<button class="btn" type="button" id="a-hold">'+(d.hold&&d.hold.on?"Release hold":"Hold")+"</button>");
  if(can.gf(d))acts.push('<button class="btn danger" type="button" id="a-gfret">Return to field</button><button class="btn primary" type="button" id="a-gfok">Approve for billing</button>');
  if(can.bill(d))acts.push('<button class="btn danger" type="button" id="a-bret">Return</button><button class="btn primary" type="button" id="a-bok">Approve for invoice</button>');
  if(can.reopen(d))acts.push('<button class="btn" type="button" id="a-reopen">Reopen billing review</button>');
  if(d.status===ST.INV&&d.invoiceId&&role()!=="crew")acts.push('<a class="btn" href="#inv-'+esc(d.invoiceId)+'">Open invoice '+esc(d.invoiceNo||"")+"</a>");
  const ret=d.status===ST.RET&&d.returnNote?'<div class="banner bad"><b>Returned by '+esc(d.returnedBy||"")+":</b> "+esc(d.returnNote)+"</div>":"";
  const hold=d.hold&&d.hold.on?'<div class="banner"><b>On hold — '+esc(d.hold.by)+":</b> "+esc(d.hold.note)+"</div>":"";
  main.innerHTML=(j?'<a class="back" href="#job-'+esc(j.id)+'">← '+esc(j.name)+'</a>':'<a class="back" href="#overview">← Overview</a>')+ret+hold+
    '<section class="jobhead"><div><h1>Unit sheet '+esc(d.no)+'</h1><div class="meta">'+stChip(d)+"<span>"+esc(j?j.name:"(job removed)")+"</span><span>"+esc(fmtD(d.workDate))+'</span></div></div><div class="acts">'+acts.join("")+"</div></section>"+
    '<section class="details">'+dl("Date",esc(fmtD(d.workDate)))+dl("Crew / lead",esc(d.crew))+dl("AWC",esc(d.awc))+dl("Work order #",esc(d.wo))+dl("FWO #",esc(d.fwo))+dl("Pole set?",esc(d.poleSet==="yes"?"Yes":d.poleSet==="no"?"No":""))+
      dl("Pole # / location",esc(p?p.esPole+" — "+p.street+", "+p.town:(d.poleText?d.poleText+" (not on packet list)":"")),true)+
      (p?dl("Ticket ID",esc(p.ticket))+dl("VZ pole #",esc(p.vzPole))+dl("Pricing area",esc(poleArea(j,p))||'<span class="late">Not set</span>'):"")+
      dl("Submitted",esc(d.createdBy+" · "+fmtT(d.submittedAt||d.createdAt)))+dl("GF approval",d.gfAt?esc(d.gfBy+" · "+fmtT(d.gfAt)):"")+dl("Billing approval",d.billAt?esc(d.billBy+" · "+fmtT(d.billAt)):"")+dl("Invoice",esc(d.invoiceNo||""))+
      (d.notes?dl("Notes / extras / difficulty justification",esc(d.notes),true):"")+(d.gfNote?dl("GF note",esc(d.gfNote),true):"")+(d.billNote?dl("Billing note",esc(d.billNote),true):"")+"</section>"+
    '<h2 class="sec">Units</h2>'+sheetLinesHtml(d)+'<h2 class="sec">History</h2>'+histHtml(d);
  const on=(sel,fn)=>{const b=document.getElementById(sel);if(b)b.onclick=fn;};
  const guard=want=>x=>{if(x.status!==want)throw new Error("This sheet was already moved to "+(ST_LABEL[x.status]||x.status)+" by someone else.");};
  on("a-edit",()=>openSheetForm(id));
  on("a-hold",()=>{const h=d.hold&&d.hold.on;confirmBox(h?"Release hold on "+d.no+"?":"Put "+d.no+" on hold?",h?"The sheet continues through approval.":"The sheet stays where it is but is flagged and can't be invoiced until the hold is released.",h?"Release hold":"Hold",async n=>{
    await commitDoc(id,x=>{x.hold=h?{on:false}:{on:true,note:n,by:S.me.name,at:new Date().toISOString()};},h?"Hold released"+(n?": "+n:""):"Put on hold: "+n);},{note:h?"Note":"Reason for hold",noteReq:!h});});
  on("a-gfok",()=>confirmBox("Approve "+d.no+" for billing?","Confirms the quantities match the verified unit sheet. The sheet goes to billing for final approval.","Approve for billing",async n=>{await commitDoc(id,x=>{guard(ST.SUB)(x);x.status=ST.GF;x.gfBy=S.me.name;x.gfAt=new Date().toISOString();x.gfNote=n||"";x.returnNote="";},"GF approved for billing"+(n?": "+n:""));},{note:"Note to billing"}));
  on("a-gfret",()=>confirmBox("Return "+d.no+" to the field?","The crew will see your note and can fix and resubmit the sheet.","Return to field",async n=>{await commitDoc(id,x=>{guard(ST.SUB)(x);x.status=ST.RET;x.returnNote=n;x.returnedBy=S.me.name;},"Returned to field: "+n);},{note:"What needs fixing",noteReq:true,danger:true}));
  on("a-bok",()=>{const pr=priceSheet(d);
    confirmBox("Approve "+d.no+" for invoice?",(pr.errs.length?"Heads up: "+pr.errs.join("; ")+". It can be approved, but it can't go on an invoice until that is fixed. ":"")+(pr.total!=null?"Pole total: "+money(pr.total)+". ":"")+"Approved sheets are ready to put on an invoice.","Approve for invoice",async n=>{await commitDoc(id,x=>{guard(ST.GF)(x);x.status=ST.OK;x.billBy=S.me.name;x.billAt=new Date().toISOString();x.billNote=n||"";},"Billing approved for invoice"+(n?": "+n:""));},{note:"Billing note"});});
  on("a-bret",()=>confirmBox("Return "+d.no+"?","It goes back to the field with your note. The GF will need to approve it again.","Return",async n=>{await commitDoc(id,x=>{guard(ST.GF)(x);x.status=ST.RET;x.returnNote=n;x.returnedBy=S.me.name;x.gfAt="";x.gfBy="";},"Returned by billing: "+n);},{note:"What needs fixing",noteReq:true,danger:true}));
  on("a-reopen",()=>confirmBox("Reopen "+d.no+"?","It moves back to Awaiting billing so it can be reviewed or returned.","Reopen",async n=>{await commitDoc(id,x=>{guard(ST.OK)(x);x.status=ST.GF;x.billAt="";x.billBy="";},"Reopened for billing review"+(n?": "+n:""));},{note:"Reason"}));
}

/* ---------- crew daily unit sheet form (matches the paper checklist) ---------- */
function openSheetForm(id,presetJob){
  if(id==null&&!can.newSheet()){canSave();return;}
  const src=id?S.docs.get(id):null;
  const d=src?JSON.parse(JSON.stringify(src)):{jobId:"",poleId:"",poleText:"",workDate:todayStr(),crew:(S.me&&S.me.crew)||(role()==="crew"?S.me.name:""),awc:"",wo:"",fwo:"",poleSet:"",notes:"",lines:[]};
  if(!id&&presetJob)d.jobId=presetJob;
  const act=jobs().filter(j=>!j.archived||j.id===d.jobId);
  if(!act.length){toast(can.setup()?"Add a job first (Add Job).":"No jobs are set up yet. Ask billing to add the job.",7000);return;}
  if(!d.jobId&&act.length===1)d.jobId=act[0].id;
  const qty={};const notes={};(d.lines||[]).forEach(l=>{qty[l.key]=l.qty;notes[l.key]=l.note||"";});
  const others=(d.lines||[]).filter(l=>!CREW_KEYS.has(l.key)).map(l=>({key:l.key,qty:l.qty,note:l.note||""}));
  const otherUnits=(rates()?rates().units:[]).filter(u=>!CREW_KEYS.has(u.key));
  const sec=CREW_SECTIONS.map(s=>'<div class="cl-sec"><div class="cl-h"><span>'+esc(s[0])+'</span><span>Qty</span></div>'+s[1].map(it=>'<label class="cl-row"><span>'+esc(it[1])+(it[0]===CK?' <span class="sub">(no rate on file)</span>':"")+'</span><input type="number" inputmode="decimal" step="any" min="0" data-q="'+esc(it[0])+'" value="'+esc(qty[it[0]]==null?"":qty[it[0]])+'" aria-label="'+esc(s[0]+" — "+it[1])+' quantity"></label>').join("")+"</div>").join("");
  const body='<fieldset><legend>Sheet header</legend>'+
    '<label class="f" for="sf-date">Date<input type="date" id="sf-date" value="'+esc(d.workDate)+'"></label>'+
    '<label class="f" for="sf-crew">Crew / lead<input id="sf-crew" value="'+esc(d.crew)+'"></label>'+
    '<label class="f" for="sf-awc">AWC<input id="sf-awc" value="'+esc(d.awc)+'"></label>'+
    '<label class="f" for="sf-wo">Work order #<input id="sf-wo" value="'+esc(d.wo)+'"></label>'+
    '<label class="f" for="sf-fwo">FWO #<input id="sf-fwo" value="'+esc(d.fwo)+'"></label>'+
    '<label class="f" for="sf-set">Pole set?<select id="sf-set"><option value="">—</option><option value="yes"'+(d.poleSet==="yes"?" selected":"")+'>Yes</option><option value="no"'+(d.poleSet==="no"?" selected":"")+">No</option></select></label>"+
    '<label class="f wide" for="sf-job">Job<select id="sf-job"><option value="">Select a job…</option>'+act.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===d.jobId?" selected":"")+">"+esc(j.name)+"</option>").join("")+"</select></label>"+
    '<label class="f wide" for="sf-pq">Pole # / location — search street, pole # or ticket<input id="sf-pq" type="search" autocomplete="off" placeholder="e.g. Bent St, P43, PT4382921"></label>'+
    '<div class="wide polepick" id="sf-poles" role="listbox" aria-label="Poles on the packet"></div>'+
    '<label class="f wide" for="sf-ptxt" id="sf-ptxt-w" hidden>Pole not on the packet list — describe it<input id="sf-ptxt" value="'+esc(d.poleText)+'"></label></fieldset>'+
    '<div><div class="sec-h">Units completed at this pole</div><p class="sub" style="margin:-4px 0 8px">Enter a quantity only beside units actually performed. Leave the rest blank.</p><div class="cl-grid">'+sec+"</div></div>"+
    '<div><div class="sec-h">Other units</div><div id="sf-other" class="linelist"></div><button class="btn" type="button" id="sf-add-o" style="margin-top:8px">+ Add another unit</button></div>'+
    '<label class="f wide" for="sf-notes">Notes / extras / difficulty justification<textarea id="sf-notes">'+esc(d.notes)+"</textarea></label>";
  const m=modal(id?"Edit "+d.no:"Crew daily unit sheet",body,'<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="sf-save">'+(id?(d.status===ST.RET?"Save &amp; resubmit":"Save changes"):"Submit to GF")+"</button>","wide");
  const pq=m.querySelector("#sf-pq"),pbox=m.querySelector("#sf-poles"),jsel=m.querySelector("#sf-job");
  let selPole=d.poleId,notOnList=!d.poleId&&!!d.poleText;
  function drawPoles(){const j=jobById(jsel.value);const ps=(j&&j.poles)||[];const q=pq.value.trim().toLowerCase();
    let list=ps.filter(p=>!q||[p.street,p.esPole,p.vzPole,p.ticket,p.town].join(" ").toLowerCase().indexOf(q)>=0);
    const sp=ps.find(p=>p.id===selPole);
    if(sp&&list.indexOf(sp)<0)list=[sp].concat(list);
    const lim=q?60:8;
    pbox.innerHTML=(j?list.slice(0,lim).map(p=>'<button type="button" class="pp'+(p.id===selPole?" on":"")+'" data-p="'+esc(p.id)+'" role="option" aria-selected="'+(p.id===selPole)+'"><b>'+esc(p.street)+'</b> · '+esc(p.esPole)+'<span class="sub"> '+esc(p.ticket)+(p.vzPole?" · VZ "+esc(p.vzPole):"")+"</span></button>").join("")+
      (list.length>lim?'<span class="sub">Showing '+lim+" of "+list.length+" — type to narrow</span>":"")+
      '<button type="button" class="pp'+(notOnList?" on":"")+'" data-p="__none">Pole not on the list</button>':'<span class="sub">Pick the job first.</span>');
    pbox.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{if(b.dataset.p==="__none"){notOnList=true;selPole="";}else{selPole=b.dataset.p;notOnList=false;}drawPoles();});
    m.querySelector("#sf-ptxt-w").hidden=!notOnList;}
  pq.oninput=drawPoles;jsel.onchange=()=>{selPole="";drawPoles();};drawPoles();
  const obox=m.querySelector("#sf-other");
  function drawOthers(){obox.innerHTML=others.map((o,i)=>'<div class="line" data-i="'+i+'"><label class="f code">Unit<select data-k="key"><option value="">Select…</option>'+otherUnits.map(u=>'<option value="'+esc(u.key)+'"'+(u.key===o.key?" selected":"")+">"+esc(u.workType+" — "+u.item)+"</option>").join("")+(o.key&&!otherUnits.some(u=>u.key===o.key)?'<option selected value="'+esc(o.key)+'">'+esc(unitInfo(o.key).item)+"</option>":"")+'</select></label><label class="f qty">Qty<input data-k="qty" type="number" step="any" inputmode="decimal" min="0" value="'+esc(o.qty)+'"></label><button class="btn sm danger rm" type="button" aria-label="Remove unit">✕</button><label class="f wide nt">Note<input data-k="note" value="'+esc(o.note)+'" placeholder="optional"></label></div>').join("");
    obox.querySelectorAll(".line").forEach(row=>{const i=+row.dataset.i;row.querySelectorAll("[data-k]").forEach(inp=>{const ev=inp.tagName==="SELECT"?"onchange":"oninput";inp[ev]=()=>{others[i][inp.dataset.k]=inp.value;};});row.querySelector(".rm").onclick=()=>{others.splice(i,1);drawOthers();};});}
  drawOthers();
  m.querySelector("#sf-add-o").onclick=()=>{if(!otherUnits.length){toast("The rate list hasn't been loaded yet.");return;}others.push({key:"",qty:"",note:""});drawOthers();};
  m.querySelector("#sf-save").onclick=e=>busyRun(e.target,m,async()=>{
    const g=s=>m.querySelector(s).value.trim();
    const patch={jobId:jsel.value,workDate:g("#sf-date"),crew:g("#sf-crew"),awc:g("#sf-awc"),wo:g("#sf-wo"),fwo:g("#sf-fwo"),poleSet:g("#sf-set"),notes:m.querySelector("#sf-notes").value.trim(),poleId:notOnList?"":selPole,poleText:notOnList?g("#sf-ptxt"):""};
    if(!patch.jobId)throw new Error("Pick the job.");if(!patch.workDate)throw new Error("Enter the date.");if(!patch.crew)throw new Error("Enter the crew / lead.");
    if(!patch.poleId&&!patch.poleText)throw new Error(notOnList?"Describe the pole / location.":"Pick the pole from the list (or Pole not on the list).");
    const lines=[];
    for(const inp of m.querySelectorAll("[data-q]")){const v=inp.value.trim();if(v==="")continue;const q=Number(v);if(!isFinite(q)||q<0)throw new Error("Quantities must be numbers of 0 or more.");if(q>0)lines.push({key:inp.dataset.q,qty:q,note:notes[inp.dataset.q]||""});}
    for(const o of others){if(!o.key&&String(o.qty).trim()==="")continue;if(!o.key)throw new Error("Pick the unit for each extra line.");const q=Number(o.qty);if(String(o.qty).trim()===""||!isFinite(q)||q<=0)throw new Error(unitInfo(o.key).item+": enter a quantity greater than 0.");
      if(lines.some(l=>l.key===o.key))throw new Error(unitInfo(o.key).item+" is entered twice.");lines.push({key:o.key,qty:q,note:String(o.note||"").trim()});}
    if(!lines.length)throw new Error("Enter at least one unit quantity.");
    patch.lines=lines;
    if(!id){
      patch.status=ST.SUB;patch.submittedAt=new Date().toISOString();
      const nid=await createDoc("sheet",patch,"Submitted "+lines.length+" unit line(s)");if(nid){closeOverlay();toast("Sheet submitted to the GF");location.hash="sheet-"+nid;}
    }else{
      const ch=diffLines(src.lines,lines);const resub=src.status===ST.RET;
      const ok=await commitDoc(id,x=>{if(x.status===ST.INV)throw new Error("This sheet is already invoiced.");Object.assign(x,patch);if(x.status===ST.RET){x.status=ST.SUB;x.submittedAt=new Date().toISOString();}},(resub?"Fixed and resubmitted. ":"Edited. ")+(ch||"No unit changes."));
      if(ok){closeOverlay();toast(resub?"Resubmitted to the GF":"Saved");}
    }
  });
}
function diffLines(a,b){const A=new Map((a||[]).map(l=>[l.key,l])),B=new Map((b||[]).map(l=>[l.key,l]));const out=[];const nm=k=>unitInfo(k).item;
  B.forEach((l,k)=>{const o=A.get(k);if(!o)out.push("+"+nm(k)+" ×"+fmtN(l.qty));else if(Number(o.qty)!==Number(l.qty))out.push(nm(k)+" "+fmtN(o.qty)+"→"+fmtN(l.qty));});
  A.forEach((l,k)=>{if(!B.has(k))out.push("−"+nm(k));});return out.length?"Units: "+out.join(", "):"";}

/* ---------- overview (home) ---------- */
function jobStats(j,ss){
  const mine=ss.filter(s=>s.jobId===j.id);const by=st=>mine.filter(s=>s.status===st).length;
  const locs=j.poles||[];const started=new Set(mine.map(s=>s.poleId).filter(Boolean));
  const doneLocs=locs.filter(p=>{const sh=mine.filter(s=>s.poleId===p.id);return sh.length&&sh.every(s=>s.status===ST.OK||s.status===ST.INV);}).length;
  let appr=0,apprOk=true;mine.filter(s=>s.status===ST.OK||s.status===ST.INV).forEach(s=>{const t=priceSheet(s).total;if(t==null)apprOk=false;else appr+=t;});
  return{locs:locs.length,started:started.size,doneLocs,sub:by(ST.SUB),ret:by(ST.RET),gf:by(ST.GF),ok:by(ST.OK),inv:by(ST.INV),hold:mine.filter(s=>s.hold&&s.hold.on).length,appr,apprOk,sheets:mine.length};}
function renderOverview(){
  const ss=visibleSheets();const all=jobs();const showClosed=!!S.showClosed;
  const list=all.filter(j=>showClosed||!j.archived).sort((a,b)=>(a.archived?1:0)-(b.archived?1:0)||a.name.localeCompare(b.name));
  const cnt=s=>ss.filter(x=>x.status===s).length;const crew=role()==="crew";
  const tq=(k,v,s,st,alert)=>'<button type="button" class="tile tbtn'+(alert?" alert":"")+'" data-st="'+st+'"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span><span class="s">'+esc(s)+"</span></button>";
  main.innerHTML=(crew?'<div class="cta"><div><b>Crew daily unit sheets</b><span class="sub">Fill out one sheet per location. Your General Foreman reviews each sheet before it goes to billing.</span></div><button class="btn primary big w-only" type="button" id="cta-new">+ New unit sheet</button></div>':"")+
    '<h2 class="sec">'+(crew?"My unit sheets":"Workflow")+'</h2><section class="tiles">'+
    tq("Awaiting GF",cnt(ST.SUB),"Crew sheets to review",ST.SUB)+tq("Returned to field",cnt(ST.RET),"Sent back for fixes",ST.RET,cnt(ST.RET)>0)+
    tq("Awaiting billing",cnt(ST.GF),"GF approved for billing",ST.GF)+tq("Ready to invoice",cnt(ST.OK),"Approved for invoice",ST.OK)+tq("All open sheets",ss.filter(s=>s.status!==ST.INV).length,"Not yet invoiced","open")+"</section>"+
    '<div class="row-inline" style="justify-content:space-between;align-items:center"><h2 class="sec" style="margin:6px 0 0">Jobs</h2>'+(all.some(j=>j.archived)?'<label class="sub" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ov-closed"'+(showClosed?" checked":"")+"> Show closed jobs</label>":"")+"</div>"+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Job</th><th class="nosort">Customer</th><th class="nosort">PO</th><th class="nosort">Locations</th><th class="nosort">Progress</th><th class="nosort">Awaiting GF</th><th class="nosort">Awaiting billing</th><th class="nosort">Ready to invoice</th>'+(can.seePrice()?'<th class="nosort num">Approved $</th>':"")+'<th class="nosort">Status</th></tr></thead><tbody id="ov-jobs"></tbody></table></div>';
  const tb=document.getElementById("ov-jobs");
  tb.innerHTML=list.length?list.map(j=>{const st=jobStats(j,ss);const pct=st.locs?st.doneLocs/st.locs:0;
    return'<tr tabindex="0" data-id="'+esc(j.id)+'"><td><div class="job-name">'+esc(j.name)+'</div><div class="sub">'+esc([j.wo?"WO "+j.wo:"",j.area||""].filter(Boolean).join(" · ")||j.desc)+"</div></td><td>"+esc(j.customer)+'</td><td class="mono">'+esc(j.po)+'</td><td class="mono">'+st.locs+'</td><td><div class="bar"><div class="track"><div class="fill" style="width:'+Math.round(pct*100)+'%"></div></div><span class="pct">'+st.doneLocs+"/"+st.locs+'</span></div><div class="sub">'+st.started+" started</div></td>"+
      '<td class="mono">'+(st.sub||"")+'</td><td class="mono">'+(st.gf||"")+'</td><td class="mono">'+(st.ok||"")+"</td>"+(can.seePrice()?'<td class="mono num">'+(st.ok+st.inv?(st.apprOk?money(st.appr):'<span class="sub">Check pricing</span>'):"")+"</td>":"")+
      "<td>"+(j.archived?'<span class="chip c-stage">Closed</span>':'<span class="chip c-done">Active</span>')+(st.ret?' <span class="chip c-bad">'+st.ret+" returned</span>":"")+(st.hold?' <span class="chip c-bad">'+st.hold+" on hold</span>":"")+"</td></tr>";}).join("")
    :'<tr><td colspan="10"><div class="empty"><b>No jobs yet</b>'+(can.setup()?'Use <a href="#addjob">Add Job</a> to set up the first job and its locations.':"Billing sets up jobs before crews can log units.")+"</div></td></tr>";
  bindRows(tb,id=>location.hash="job-"+id);
  main.querySelectorAll(".tbtn").forEach(b=>b.onclick=()=>{S.f.status=b.dataset.st;S.f.job="";location.hash="sheets";});
  const oc=document.getElementById("ov-closed");if(oc)oc.onchange=()=>{S.showClosed=oc.checked;renderOverview();};
  const cta=document.getElementById("cta-new");if(cta)cta.onclick=()=>openSheetForm(null);
}

/* ---------- job page: locations + unit sheets ---------- */
function renderJob(){
  const j=jobById(S.docId);
  if(!j){main.innerHTML='<a class="back" href="#overview">← Overview</a><div class="empty"><b>Job not found</b></div>';return;}
  const ss=visibleSheets();const st=jobStats(j,ss);const tab=S.jobTab||"locs";
  main.innerHTML='<a class="back" href="#overview">← Overview</a>'+
    '<section class="jobhead"><div><h1>'+esc(j.name)+'</h1><div class="meta">'+(j.archived?'<span class="chip c-stage">Closed</span>':'<span class="chip c-done">Active</span>')+"<span>"+esc(j.customer)+"</span>"+(j.po?"<span>PO "+esc(j.po)+"</span>":"")+(j.wo?"<span>WO / Job # "+esc(j.wo)+"</span>":"")+'</div></div><div class="acts">'+
      (can.newSheet()&&!j.archived?'<button class="btn primary" type="button" id="jb-sheet">+ New unit sheet</button>':"")+
      '<button class="btn" type="button" id="jb-print"'+((j.poles||[]).length?"":" disabled")+'>Print Unit Sheets</button>'+(can.setup()?'<button class="btn" type="button" id="jb-add">+ Add locations</button><button class="btn" type="button" id="jb-edit">Edit job</button>':"")+(role()!=="crew"?'<button class="btn" type="button" id="jb-csv">Export CSV</button>':"")+"</div></section>"+
    (!j.area&&(j.poles||[]).some(p=>!p.area)&&role()!=="crew"?'<div class="banner">No default pricing area is set for this job, so locations without their own area can\'t be priced. Set it with <b>Edit job</b>.</div>':"")+
    '<section class="tiles">'+tile("Locations",st.locs,st.started+" started",false)+tile("Awaiting GF",st.sub,"Crew sheets",false)+tile("Awaiting billing",st.gf,"GF approved",false)+tile("Ready to invoice",st.ok,"Approved for invoice",false)+tile("Invoiced",st.inv,"Sheets on invoices",false)+(can.seePrice()?tile("Approved $",st.ok+st.inv?(st.apprOk?money(st.appr):"Check"):"$0.00","Ready + invoiced",false):"")+"</section>"+
    '<div class="subtabs" role="tablist"><button role="tab" type="button" id="t-locs" aria-selected="'+(tab==="locs")+'">Locations</button><button role="tab" type="button" id="t-sheets" aria-selected="'+(tab==="sheets")+'">Unit sheets ('+ss.filter(s=>s.jobId===j.id).length+')</button></div><div id="jbody"></div>';
  document.getElementById("t-locs").onclick=()=>{S.jobTab="locs";renderJob();};document.getElementById("t-sheets").onclick=()=>{S.jobTab="sheets";renderJob();};
  const on=(i,fn)=>{const b=document.getElementById(i);if(b)b.onclick=fn;};
  on("jb-sheet",()=>openSheetForm(null,j.id));on("jb-print",()=>openPrintPicker(j.id));on("jb-add",()=>openAddLocations(j.id));on("jb-edit",()=>openJobForm(j.id));
  on("jb-csv",()=>{const sx=sheets();const head=["#","Ticket ID","Town","Street","ES Pole #","VZ Pole #","PDF Page","WO / Job #","Pricing Area","Date Set","Status","Sheets","Notes"];
    const lines=[head].concat((j.poles||[]).map(p=>{const sh=sx.filter(s=>s.jobId===j.id&&s.poleId===p.id);return[p.n,p.ticket,p.town,p.street,p.esPole,p.vzPole,p.pdfPage,p.woJob||j.wo,poleArea(j,p),p.dateSet,poleStatus(sh)[0],sh.map(s=>s.no).join(" "),p.notes];}));
    download(new Blob(["﻿"+lines.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n")],{type:"text/csv"}),"Locations - "+j.name+".csv");});
  const box=document.getElementById("jbody");
  if(tab==="sheets"){
    const rows=ss.filter(s=>s.jobId===j.id).sort((a,b)=>ST_ORDER.indexOf(a.status)-ST_ORDER.indexOf(b.status)||String(b.workDate).localeCompare(String(a.workDate)));
    box.innerHTML='<div class="tablebox"><table><thead><tr><th class="nosort">Sheet #</th><th class="nosort">Work date</th><th class="nosort">Location</th><th class="nosort">Crew / lead</th><th class="nosort">Units</th>'+(can.seePrice()?'<th class="nosort num">Amount</th>':"")+'<th class="nosort">Status</th></tr></thead><tbody id="jb-sh"></tbody></table></div>';
    const tb=document.getElementById("jb-sh");
    tb.innerHTML=rows.map(s=>{const pr=can.seePrice()?priceSheet(s):null;return'<tr tabindex="0" data-id="'+esc(s.id)+'"><td class="mono"><b>'+esc(s.no)+"</b></td><td>"+fmtD(s.workDate)+'</td><td class="wrapc">'+esc(sheetPoleText(s))+"</td><td>"+esc(s.crew)+'</td><td class="mono">'+(s.lines||[]).length+"</td>"+(pr?'<td class="mono num">'+(pr.total==null?'<span class="sub">Check pricing</span>':money(pr.total))+"</td>":"")+"<td>"+stChip(s)+"</td></tr>";}).join("")||'<tr><td colspan="7"><div class="empty"><b>No unit sheets yet</b>Crews submit one sheet per location.</div></td></tr>';
    bindRows(tb,id=>location.hash="sheet-"+id);return;}
  const q=S.pf.q||"",stf=S.pf.st||"";
  box.innerHTML='<div class="filters" style="margin-bottom:10px"><input type="search" id="pl-q" placeholder="Search street, pole #, ticket…" aria-label="Search locations" value="'+esc(q)+'"><select id="pl-st" aria-label="Status"><option value="">All statuses</option>'+["Not started","Awaiting GF","Returned to field","Awaiting billing","Ready to invoice","Invoiced"].map(s=>"<option"+(s===stf?" selected":"")+">"+s+"</option>").join("")+'</select><span class="count" id="pl-count"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">#</th><th class="nosort">Ticket ID</th><th class="nosort">Town</th><th class="nosort">Street</th><th class="nosort">ES pole #</th><th class="nosort">VZ pole #</th><th class="nosort">PDF page</th><th class="nosort">Pricing area</th><th class="nosort">Sheets</th>'+(can.seePrice()?'<th class="nosort num">Approved $</th>':"")+'<th class="nosort">Status</th><th class="nosort">Notes</th><th class="nosort"></th></tr></thead><tbody id="pl-body"></tbody></table></div>';
  const qi=document.getElementById("pl-q"),si=document.getElementById("pl-st");qi.oninput=()=>{S.pf.q=qi.value;fill();};si.onchange=()=>{S.pf.st=si.value;fill();};
  function fill(){const tb=document.getElementById("pl-body");const qq=(S.pf.q||"").trim().toLowerCase();const sx=sheets();
    const rows=(j.poles||[]).map(p=>{const sh=sx.filter(s=>s.jobId===j.id&&s.poleId===p.id);const stt=poleStatus(sh);
      const appr=sh.filter(s=>s.status===ST.OK||s.status===ST.INV).map(priceSheet);const amt=appr.some(x=>x.total==null)?null:appr.reduce((a,x)=>a+x.total,0);return{p,sh,stt,amt,napp:appr.length};})
      .filter(r=>(!qq||[r.p.street,r.p.esPole,r.p.vzPole,r.p.ticket,r.p.town,r.p.notes].join(" ").toLowerCase().indexOf(qq)>=0)&&(!S.pf.st||r.stt[0]===S.pf.st));
    document.getElementById("pl-count").textContent=rows.length+" of "+(j.poles||[]).length+" locations";
    tb.innerHTML=rows.map(r=>{const p=r.p;const ar=poleArea(j,p);return'<tr tabindex="0" data-id="'+esc(p.id)+'"><td class="mono">'+esc(p.n)+'</td><td class="mono">'+esc(p.ticket)+"</td><td>"+esc(p.town)+"</td><td><b>"+esc(p.street)+'</b></td><td class="mono">'+esc(p.esPole)+'</td><td class="mono">'+esc(p.vzPole)+'</td><td class="mono">'+esc(p.pdfPage)+"</td><td>"+(ar?esc(ar)+(p.area?"":' <span class="sub">(job default)</span>'):'<span class="late">Not set</span>')+'</td><td class="mono">'+r.sh.length+"</td>"+
      (can.seePrice()?'<td class="mono num">'+(r.napp?(r.amt==null?'<span class="sub">Check pricing</span>':money(r.amt)):"")+"</td>":"")+'<td><span class="chip '+r.stt[1]+'">'+esc(r.stt[0])+'</span></td><td class="wrapc sub">'+esc(p.notes)+'</td><td><button class="btn sm" type="button" data-print="'+esc(p.id)+'" aria-label="Print unit sheet for '+esc(p.street+" "+p.esPole)+'">Print</button></td></tr>';}).join("")||'<tr><td colspan="13"><div class="empty"><b>No locations</b>'+((j.poles||[]).length?"Nothing matches the filters.":(can.setup()?"Use + Add locations.":""))+"</div></td></tr>";
    tb.querySelectorAll("[data-print]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();printUnitSheets(j,[poleById(j,b.dataset.print)]);});
    if(role()!=="crew")bindRows(tb,pid=>openPoleForm(j.id,pid));}
  fill();
}

/* ---------- printable crew daily unit checklist (one page per location) ---------- */
function unitSheetPage(j,p,i,n){
  const box=(label,val,cls)=>'<div class="us-f '+(cls||"")+'"><span>'+esc(label)+'</span><div class="us-box">'+esc(val||"")+"</div></div>";
  const sec=s=>'<table class="us-sec"><thead><tr><th>'+esc(s[0])+'</th><th class="q">QTY</th></tr></thead><tbody>'+s[1].map(it=>"<tr><td>"+esc(it[1])+'</td><td class="q"></td></tr>').join("")+"</tbody></table>";
  const L=CREW_SECTIONS.slice(0,4),Rt=CREW_SECTIONS.slice(4);
  return'<section class="us-page"><div class="us-top"><div><h1>CREW DAILY UNIT CHECKLIST</h1><div class="us-awc">AWC <span class="us-line"></span></div></div><div class="us-job"><img src="../pg-logo.jpg" alt="P&amp;G Power Co."><b>'+esc(j.name)+"</b>"+(j.po?"<span>PO "+esc(j.po)+"</span>":"")+"</div></div>"+
    '<div class="us-row">'+box("DATE","","w1")+box("CREW / LEAD","","w2")+box("WORK ORDER #",p.woJob||j.wo,"w1")+box("FWO #","","w1")+"</div>"+
    '<div class="us-row">'+box("POLE # / LOCATION",[p.esPole,[p.street,p.town].filter(Boolean).join(", ")].filter(Boolean).join(" — "),"w3")+'<div class="us-f w1"><span>POLE SET?</span><div class="us-box">[&nbsp;&nbsp;] YES &nbsp;&nbsp; [&nbsp;&nbsp;] NO</div></div></div>'+
    '<div class="us-row">'+box("TICKET ID",p.ticket,"w1")+box("VZ POLE #",p.vzPole,"w1")+box("LOCATION #",String(p.n||""),"w1")+box("PDF PAGE",p.pdfPage,"w1")+"</div>"+
    '<div class="us-cols"><div>'+L.map(sec).join("")+"</div><div>"+Rt.map(sec).join("")+'<table class="us-sec"><thead><tr><th>OTHER UNITS</th><th class="q">QTY</th></tr></thead><tbody><tr><td></td><td class="q"></td></tr><tr><td></td><td class="q"></td></tr><tr><td></td><td class="q"></td></tr></tbody></table></div></div>'+
    '<div class="us-notes"><b>NOTES / EXTRAS / DIFFICULTY JUSTIFICATION:</b>'+(p.notes?'<div class="us-pn">Packet note: '+esc(p.notes)+"</div>":"")+'<div class="us-l"></div><div class="us-l"></div><div class="us-l"></div></div>'+
    '<div class="us-foot">P&amp;G Power Co. · '+esc(j.name)+" · Location "+(i+1)+" of "+n+"</div></section>";}
function printUnitSheets(j,poles){
  if(!poles.length){toast("Select at least one location.");return;}
  const p=document.getElementById("print");
  p.innerHTML='<div class="us">'+poles.map((x,i)=>unitSheetPage(j,x,i,poles.length)).join("")+"</div>";
  document.body.classList.add("printing");const prev=document.title;document.title="Unit Sheets - "+j.name;
  const done=()=>{document.body.classList.remove("printing");document.title=prev;window.removeEventListener("afterprint",done);};
  window.addEventListener("afterprint",done);
  const imgs=[...p.querySelectorAll("img")];Promise.all(imgs.map(im=>im.complete?1:new Promise(r=>{im.onload=im.onerror=r;}))).then(()=>setTimeout(()=>window.print(),150));
}
function openPrintPicker(jid){
  const j=jobById(jid);const ps=(j.poles||[]).slice().sort((a,b)=>(a.n||0)-(b.n||0));const sx=sheets();
  const started=new Set(sx.filter(s=>s.jobId===jid).map(s=>s.poleId));
  const m=modal("Print unit sheets — "+j.name,'<div class="row-inline"><button class="btn sm" type="button" id="pp-all">All</button><button class="btn sm" type="button" id="pp-ns">Not started</button><button class="btn sm" type="button" id="pp-none">Clear</button><input type="search" id="pp-q" placeholder="Filter street, pole #, ticket…" aria-label="Filter locations" style="flex:1 1 200px;padding:6px 10px;border:1px solid var(--field);border-radius:4px"></div>'+
    '<div class="ulist" id="pp-list" style="max-height:52vh;overflow:auto">'+ps.map(p=>'<label class="u" style="grid-template-columns:auto 1fr auto;cursor:pointer" data-hay="'+esc([p.street,p.esPole,p.ticket,p.town,p.vzPole].join(" ").toLowerCase())+'"><input type="checkbox" data-p="'+esc(p.id)+'"><span><span class="mono sub">#'+esc(p.n)+"</span> <b>"+esc(p.street)+"</b> · "+esc(p.esPole)+' <span class="sub">'+esc(p.ticket)+"</span></span>"+(started.has(p.id)?'<span class="chip c-sch">Has sheet</span>':'<span class="chip c-stage">Not started</span>')+"</label>").join("")+"</div>",
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="pp-go">Print 0 sheets</button>',"wide");
  const boxes=[...m.querySelectorAll("[data-p]")];const go=m.querySelector("#pp-go");
  const upd=()=>{const n=boxes.filter(b=>b.checked).length;go.textContent="Print "+n+" sheet"+(n===1?"":"s");go.disabled=!n;};
  boxes.forEach(b=>b.onchange=upd);
  const vis=b=>!b.closest("label").hidden;
  m.querySelector("#pp-all").onclick=()=>{boxes.forEach(b=>{if(vis(b))b.checked=true;});upd();};
  m.querySelector("#pp-none").onclick=()=>{boxes.forEach(b=>b.checked=false);upd();};
  m.querySelector("#pp-ns").onclick=()=>{boxes.forEach(b=>b.checked=vis(b)&&!started.has(b.dataset.p));upd();};
  m.querySelector("#pp-q").oninput=e=>{const q=e.target.value.trim().toLowerCase();boxes.forEach(b=>{const l=b.closest("label");l.hidden=!!q&&l.dataset.hay.indexOf(q)<0;});};
  upd();
  go.onclick=()=>{const ids=new Set(boxes.filter(b=>b.checked).map(b=>b.dataset.p));const sel=ps.filter(p=>ids.has(p.id));closeOverlay();printUnitSheets(j,sel);};
}

/* ---------- location grid (Add Job / Add locations) ---------- */
const LOC_COLS=[["ticket","Ticket ID","w-s"],["town","Town","w-s"],["street","Street *","w-l"],["esPole","ES pole # *","w-s"],["vzPole","VZ pole #","w-xs"],["pdfPage","PDF page","w-xs"],["woJob","WO / Job #","w-s"],["area","Pricing area","area"],["dateSet","Date set","w-s"],["notes","Notes","w-l"]];
const LOC_HDR={ticket:/ticket/,town:/^(town|place|city|municipality)/,street:/street|address|road|location/,esPole:/es\s*pole|elco|^pole\s*(#|no|num|number)?$|utility\s*pole/,vzPole:/vz|verizon|telco/,pdfPage:/pdf|page/,woJob:/^wo\b|work\s*order|job\s*#|job\s*no/,area:/area|pricing/,dateSet:/date/,notes:/note|comment|remark/};
const emptyLoc=()=>({ticket:"",town:"",street:"",esPole:"",vzPole:"",pdfPage:"",woJob:"",area:"",dateSet:"",notes:""});
function rowsFromTable(aoa){
  const norm=v=>String(v==null?"":v).trim();const out=[];const warn=[];
  let hi=-1,map=null;
  for(let r=0;r<Math.min(aoa.length,15);r++){const cells=aoa[r].map(c=>norm(c).toLowerCase());const m={};let hits=0;
    Object.keys(LOC_HDR).forEach(k=>{const i=cells.findIndex((c,ci)=>c&&LOC_HDR[k].test(c)&&!Object.values(m).includes(ci));if(i>=0){m[k]=i;hits++;}});
    if(hits>=2&&m.street!=null){hi=r;map=m;break;}}
  if(hi<0){map={ticket:0,town:1,street:2,esPole:3,vzPole:4};warn.push("No header row found, so columns were read in this order: Ticket ID, Town, Street, ES pole #, VZ pole #.");}
  const areas=rates()?rates().areas:[];
  for(let r=hi+1;r<aoa.length;r++){const row=aoa[r]||[];const L=emptyLoc();let any=false;
    Object.keys(map).forEach(k=>{let v=norm(row[map[k]]);if(k==="dateSet"&&/^\d{5}(\.\d+)?$/.test(v)){const d=new Date(Date.UTC(1899,11,30)+Math.round(+v)*864e5);v=fmtD(d.toISOString().slice(0,10));}L[k]=v;if(v)any=true;});
    if(!any)continue;
    if(L.area){const hit=areas.find(a=>a.toLowerCase()===L.area.toLowerCase()||a.toLowerCase().startsWith(L.area.toLowerCase()));if(hit)L.area=hit;else{warn.push("Row "+(r+1)+': pricing area "'+L.area+'" doesn\'t match the rate card — left blank.');L.area="";}}
    out.push(L);}
  return{rows:out,warn};}
function locGrid(host,state){
  const areas=rates()?rates().areas:[];
  host.innerHTML='<div class="row-inline"><label class="f" for="lg-count" style="width:200px">How many locations?<input type="number" id="lg-count" min="0" max="500" step="1" inputmode="numeric" value="'+(state.rows.length||"")+'"></label><button class="btn" type="button" id="lg-set">Set rows</button>'+
    '<label class="btn" for="lg-file" style="cursor:pointer">Upload sheet (.xlsx / .csv)<input type="file" id="lg-file" accept=".xlsx,.xlsm,.csv,.txt" hidden></label><button class="btn" type="button" id="lg-paste-t">Paste from Excel</button><span class="sub" id="lg-info"></span></div>'+
    '<div id="lg-sheetw" class="row-inline" hidden><label class="f" for="lg-sheet">Worksheet<select id="lg-sheet"></select></label></div>'+
    '<div class="pastebox" id="lg-paste" hidden><p class="sub" style="margin:0 0 6px">Copy the rows from Excel (include the header row if there is one) and paste them here.</p><textarea id="lg-paste-box" aria-label="Paste rows from Excel"></textarea><div class="row-inline" style="margin-top:6px"><button class="btn primary" type="button" id="lg-paste-go">Use pasted rows</button></div></div>'+
    '<div id="lg-warn"></div><div class="grid-edit"><table><thead><tr><th class="nosort">#</th>'+LOC_COLS.map(c=>'<th class="nosort">'+esc(c[1])+"</th>").join("")+'<th class="nosort"></th></tr></thead><tbody id="lg-body"></tbody></table></div>';
  const body=host.querySelector("#lg-body");const info=host.querySelector("#lg-info");
  function draw(){
    body.innerHTML=state.rows.map((L,i)=>'<tr data-i="'+i+'"><td class="mono sub">'+(state.start+i)+"</td>"+LOC_COLS.map(c=>"<td>"+(c[2]==="area"?'<select data-k="area" aria-label="Pricing area row '+(i+1)+'"><option value="">Job default</option>'+areas.map(a=>"<option"+(a===L.area?" selected":"")+">"+esc(a)+"</option>").join("")+"</select>":'<input class="'+c[2]+'" data-k="'+c[0]+'" value="'+esc(L[c[0]])+'" aria-label="'+esc(c[1].replace(" *",""))+" row "+(i+1)+'">')+"</td>").join("")+'<td><button class="btn sm danger" type="button" data-rm aria-label="Remove row '+(i+1)+'">✕</button></td></tr>').join("")||'<tr><td colspan="12" class="sub" style="padding:14px">Enter how many locations, upload a sheet, or paste from Excel.</td></tr>';
    body.querySelectorAll("tr[data-i]").forEach(tr=>{const i=+tr.dataset.i;tr.querySelectorAll("[data-k]").forEach(inp=>{const ev=inp.tagName==="SELECT"?"onchange":"oninput";inp[ev]=()=>{state.rows[i][inp.dataset.k]=inp.value;};});
      tr.querySelector("[data-rm]").onclick=()=>{state.rows.splice(i,1);host.querySelector("#lg-count").value=state.rows.length;draw();};});
    info.textContent=state.rows.length?state.rows.length+" location"+(state.rows.length===1?"":"s"):"";}
  function setRows(rows,warn){state.rows=rows;host.querySelector("#lg-count").value=rows.length;host.querySelector("#lg-warn").innerHTML=warn&&warn.length?'<div class="banner">'+warn.slice(0,10).map(esc).join("<br>")+(warn.length>10?"<br>…and "+(warn.length-10)+" more":"")+"</div>":"";draw();}
  host.querySelector("#lg-set").onclick=()=>{const n=Math.max(0,Math.min(500,parseInt(host.querySelector("#lg-count").value,10)||0));
    const filled=state.rows.slice(n).filter(L=>Object.values(L).some(Boolean)).length;
    if(filled&&!confirm(filled+" filled row(s) will be removed. Continue?"))return;
    while(state.rows.length<n)state.rows.push(emptyLoc());state.rows.length=n;draw();};
  host.querySelector("#lg-paste-t").onclick=()=>{const p=host.querySelector("#lg-paste");p.hidden=!p.hidden;};
  host.querySelector("#lg-paste-go").onclick=()=>{const t=host.querySelector("#lg-paste-box").value.replace(/\r/g,"");if(!t.trim())return;const r=rowsFromTable(t.split("\n").map(l=>l.split("\t")));setRows(r.rows,r.warn);host.querySelector("#lg-paste").hidden=true;};
  let book=null;
  const sheetSel=host.querySelector("#lg-sheet");
  const loadSheet=async()=>{const aoa=await book.get(sheetSel.value);const r=rowsFromTable(aoa);setRows(r.rows,r.warn);};
  sheetSel.onchange=loadSheet;
  host.querySelector("#lg-file").onchange=async ev=>{const f=ev.target.files[0];if(!f)return;info.textContent="Reading "+f.name+"…";
    try{if(/\.(csv|txt)$/i.test(f.name)){book=null;host.querySelector("#lg-sheetw").hidden=true;const r=rowsFromTable(parseCsv(await f.text()));setRows(r.rows,r.warn);}
      else{book=await TMPL.tables(await f.arrayBuffer());sheetSel.innerHTML=book.names.map(n=>"<option>"+esc(n)+"</option>").join("");host.querySelector("#lg-sheetw").hidden=book.names.length<2;await loadSheet();}
    }catch(e){info.textContent="";toast("Couldn't read that file: "+errText(e),8000);}ev.target.value="";};
  draw();
}
function parseCsv(t){const rows=[];let row=[],cell="",q=false;for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=c;}
  else if(c==='"')q=true;else if(c===","){row.push(cell);cell="";}else if(c==="\n"){row.push(cell);rows.push(row);row=[];cell="";}else if(c!=="\r")cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
function checkLocs(rows,existing){
  const used=rows.filter(L=>Object.values(L).some(v=>String(v).trim()));
  const errs=[];const seen=new Set((existing||[]).map(p=>String(p.ticket||"").toUpperCase()).filter(Boolean));
  used.forEach((L,i)=>{if(!L.street.trim()||!L.esPole.trim())errs.push("Row "+(i+1)+": Street and ES pole # are required.");
    const t=L.ticket.trim().toUpperCase();if(t){if(seen.has(t))errs.push("Row "+(i+1)+": Ticket "+L.ticket+" is already on this job.");seen.add(t);}});
  return{used:used.map(L=>{const o={};Object.keys(L).forEach(k=>o[k]=String(L[k]).trim());return o;}),errs};}
function renderAddJob(){
  if(!can.setup()){main.innerHTML='<div class="empty"><b>Billing sets up jobs</b>Ask an admin or billing approver to add the job.</div>';return;}
  const st=S.addJob||(S.addJob={rows:[],start:1,f:{name:"",customer:"Eversource",po:"",wo:"",area:"",desc:""}});
  const f=(k,l,wide)=>'<label class="f'+(wide?" wide":"")+'" for="aj-'+k+'">'+esc(l)+'<input id="aj-'+k+'" value="'+esc(st.f[k])+'"></label>';
  main.innerHTML='<section class="jobhead"><div><h1>Add Job</h1><div class="meta">Enter the job, then its locations: type them in or upload the packet\'s spreadsheet.</div></div></section>'+
    '<section class="details" style="display:block"><fieldset style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))"><legend>Job</legend>'+f("name","Job name *",true)+f("customer","Customer (bill to) *")+f("po","PO")+f("wo","WO / Job #")+
    '<label class="f" for="aj-area">Default pricing area'+areaSelect("aj-area",st.f.area)+"</label>"+'<label class="f wide" for="aj-desc">Description<textarea id="aj-desc">'+esc(st.f.desc)+"</textarea></label></fieldset></section>"+
    '<h2 class="sec">Locations</h2><div id="aj-grid"></div>'+
    '<div class="row-inline" style="justify-content:flex-end;margin-top:4px"><span class="err" id="aj-err" role="alert" style="margin:0 auto 0 0"></span><button class="btn" type="button" id="aj-clear">Clear form</button><button class="btn primary" type="button" id="aj-save">Create job</button></div>';
  ["name","customer","po","wo","area"].forEach(k=>{const el=document.getElementById("aj-"+k);el[el.tagName==="SELECT"?"onchange":"oninput"]=()=>{st.f[k]=el.value;};});
  document.getElementById("aj-desc").oninput=e=>{st.f.desc=e.target.value;};
  locGrid(document.getElementById("aj-grid"),st);
  document.getElementById("aj-clear").onclick=()=>{if(!confirm("Clear the job and all location rows?"))return;S.addJob=null;renderAddJob();};
  document.getElementById("aj-save").onclick=async e=>{const err=document.getElementById("aj-err");err.textContent="";const b=e.target;
    const v={name:st.f.name.trim(),customer:st.f.customer.trim(),po:st.f.po.trim(),wo:st.f.wo.trim(),area:st.f.area,desc:st.f.desc.trim()};
    if(!v.name){err.textContent="Enter the job name.";return;}if(!v.customer){err.textContent="Enter the customer.";return;}
    if(jobs().some(j=>j.name.trim().toLowerCase()===v.name.toLowerCase())){err.textContent="A job named "+v.name+" already exists.";return;}
    const c=checkLocs(st.rows,[]);if(c.errs.length){err.textContent=c.errs.slice(0,3).join(" ")+(c.errs.length>3?" (+"+(c.errs.length-3)+" more)":"");return;}
    if(!c.used.length&&!confirm("Create the job with no locations? You can add them later."))return;
    if(!canSave())return;b.disabled=true;b.textContent="Saving…";
    try{const id=newId("j-");const now=new Date().toISOString();
      await commitIndex(ix=>{ix.jobs=ix.jobs||[];ix.jobs.push(Object.assign({id,archived:false,createdAt:now,createdBy:S.me.name,poles:c.used.map((L,i)=>Object.assign({id:newId("p-")+i,n:i+1},L))},v));},"Workflow: add job");
      S.addJob=null;toast("Job "+v.name+" created with "+c.used.length+" location"+(c.used.length===1?"":"s"));location.hash="job-"+id;}
    catch(x){err.textContent=errText(x);}finally{b.disabled=false;b.textContent="Create job";}};
}
function openAddLocations(jid){
  if(!can.setup()){canSave();return;}
  const j=jobById(jid);const start=(j.poles||[]).reduce((a,p)=>Math.max(a,p.n||0),0)+1;const st={rows:[],start};
  const m=modal("Add locations to "+j.name,'<div id="al-grid"></div>','<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="al-save">Add locations</button>',"wide");
  m.style.width="min(1180px,calc(100% - 24px))";locGrid(m.querySelector("#al-grid"),st);
  m.querySelector("#al-save").onclick=e=>busyRun(e.target,m,async()=>{const c=checkLocs(st.rows,j.poles);if(c.errs.length)throw new Error(c.errs.slice(0,3).join(" "));if(!c.used.length)throw new Error("Add at least one location.");if(!canSave())return;
    await commitIndex(ix=>{const t=ix.jobs.find(x=>x.id===jid);t.poles=t.poles||[];let n=t.poles.reduce((a,p)=>Math.max(a,p.n||0),0);c.used.forEach((L,i)=>t.poles.push(Object.assign({id:newId("p-")+i,n:++n},L)));},"Workflow: add locations");
    closeOverlay();refresh();toast(c.used.length+" location(s) added");});
}

/* ---------- jobs ---------- */
function areaSelect(id,val,blankLabel){const areas=rates()?rates().areas:[];return'<select id="'+id+'"><option value="">'+esc(blankLabel||"— not set —")+"</option>"+areas.map(a=>'<option'+(a===val?" selected":"")+">"+esc(a)+"</option>").join("")+"</select>";}
function openJobForm(id){
  if(!can.setup()){canSave();return;}
  const j=id?Object.assign({},jobById(id)):{name:"",customer:"Eversource",po:"",wo:"",area:"",desc:"",archived:false};
  const f=(k,l,wide)=>'<label class="f'+(wide?" wide":"")+'" for="jf-'+k+'">'+esc(l)+'<input id="jf-'+k+'" value="'+esc(j[k])+'"></label>';
  const m=modal(id?"Edit job":"Add job",'<fieldset style="grid-template-columns:1fr 1fr">'+f("name","Job / packet name",true)+f("customer","Customer (bill to)")+f("po","PO")+f("wo","WO / Job # (Pole Register)")+
    '<label class="f" for="jf-area">Default pricing area'+areaSelect("jf-area",j.area)+"</label>"+
    '<label class="f wide" for="jf-desc">Description<textarea id="jf-desc">'+esc(j.desc)+"</textarea></label>"+(id?'<label class="f chk wide" for="jf-arch"><input type="checkbox" id="jf-arch"'+(j.archived?" checked":"")+"> Closed (hide from crews)</label>":"")+"</fieldset>"+
    '<p class="sub" style="margin:0">The pricing area picks the Eversource rate column. Each pole uses this default unless a different area is set on that pole.</p>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="jf-save">'+(id?"Save job":"Add job")+"</button>");
  m.querySelector("#jf-save").onclick=e=>busyRun(e.target,m,async()=>{
    const g=k=>m.querySelector("#jf-"+k).value.trim();
    const v={name:g("name"),customer:g("customer"),po:g("po"),wo:g("wo"),area:g("area"),desc:m.querySelector("#jf-desc").value.trim(),archived:id?m.querySelector("#jf-arch").checked:false};
    if(!v.name)throw new Error("Enter the job name.");if(!v.customer)throw new Error("Enter the customer.");
    if(!canSave())return;
    await commitIndex(ix=>{ix.jobs=ix.jobs||[];if(id){const t=ix.jobs.find(x=>x.id===id);if(t)Object.assign(t,v,{updatedAt:new Date().toISOString(),updatedBy:S.me.name});}else ix.jobs.push(Object.assign({id:newId("j-"),poles:[],createdAt:new Date().toISOString(),createdBy:S.me.name},v));},"Workflow: save job");
    closeOverlay();refresh();toast(id?"Job saved":"Job added");
  });
}

/* ---------- pole register ---------- */
function poleStatus(sh){
  if(!sh.length)return["Not started","c-stage"];
  const open=sh.filter(s=>s.status!==ST.INV);
  if(!open.length)return["Invoiced","c-stage"];
  if(open.some(s=>s.status===ST.RET))return["Returned to field","c-bad"];
  if(open.some(s=>s.status===ST.SUB))return["Awaiting GF","c-sch"];
  if(open.some(s=>s.status===ST.GF))return["Awaiting billing","c-req"];
  return["Ready to invoice","c-done"];}
function openPoleForm(jid,pid){
  const j=jobById(jid);const p=poleById(j,pid);if(!p)return;
  const ro=!can.setup();const ss=sheets().filter(s=>s.jobId===jid&&s.poleId===pid);
  const f=(k,l)=>'<label class="f" for="pf-'+k+'">'+esc(l)+'<input id="pf-'+k+'" value="'+esc(p[k])+'"'+(ro?" disabled":"")+"></label>";
  const m=modal("Pole "+p.esPole+" — "+p.street,'<fieldset style="grid-template-columns:1fr 1fr">'+f("ticket","Ticket ID")+f("town","Town")+f("street","Street")+f("esPole","ES pole #")+f("vzPole","VZ pole #")+f("pdfPage","PDF page")+f("woJob","WO / Job # (blank = job's)")+f("dateSet","Date set")+
    '<label class="f" for="pf-area">Pricing area'+areaSelect("pf-area",p.area,"Use job default"+(j.area?" ("+j.area+")":""))+"</label>"+
    '<label class="f wide" for="pf-notes">Notes / exceptions<textarea id="pf-notes"'+(ro?" disabled":"")+">"+esc(p.notes)+"</textarea></label></fieldset>"+
    '<div><div class="sec-h">Unit sheets for this pole</div>'+(ss.length?'<div class="ulist">'+ss.map(s=>'<a class="u" href="#sheet-'+esc(s.id)+'" style="text-decoration:none;color:inherit"><span><b class="mono">'+esc(s.no)+"</b> · "+esc(fmtD(s.workDate))+" · "+esc(s.crew)+"</span>"+stChip(s)+"</a>").join("")+"</div>":'<p class="sub" style="margin:0">None yet.</p>')+"</div>",
    '<button class="btn" type="button" data-x>Close</button>'+(ro?"":'<button class="btn primary" type="button" id="pf-save">Save pole</button>'));
  if(ro){m.querySelector("#pf-area").disabled=true;return;}
  m.querySelectorAll("a.u").forEach(a=>a.onclick=()=>closeOverlay());
  m.querySelector("#pf-save").onclick=e=>busyRun(e.target,m,async()=>{
    const v={};["ticket","town","street","esPole","vzPole","pdfPage","woJob","dateSet","area"].forEach(k=>v[k]=m.querySelector("#pf-"+k).value.trim());v.notes=m.querySelector("#pf-notes").value.trim();
    if(!v.street||!v.esPole)throw new Error("Street and ES pole # are required.");if(!canSave())return;
    const ch=Object.keys(v).filter(k=>String(p[k]==null?"":p[k])!==v[k]);
    await commitIndex(ix=>{const t=(ix.jobs.find(x=>x.id===jid)||{poles:[]}).poles.find(x=>x.id===pid);if(!t)throw new Error("Pole not found.");Object.assign(t,v);(t.log=t.log||[]).push({t:new Date().toISOString(),by:S.me.name,text:"Changed "+ch.join(", ")});},"Workflow: update pole");
    closeOverlay();refresh();toast("Pole saved");
  });
}
/* ---------- rates & template ---------- */
function renderRates(){
  if(!canRates()){location.hash="overview";return;}
  const r=rates();const tm=S.index.template;
  main.innerHTML='<section class="jobhead"><div><h1>Rates &amp; invoice template</h1><div class="meta">'+(tm?"Template: <b>"+esc(tm.name)+"</b> · loaded "+esc(fmtT(tm.at))+" by "+esc(tm.by)+" · "+esc(tm.slots)+" pole slots per invoice":"No template loaded yet")+'</div></div><div class="acts"><button class="btn" type="button" id="r-dl"'+(tm?"":" disabled")+'>Download template</button><button class="btn primary w-only" type="button" id="r-up">Load new template</button></div></section>'+
    '<div class="note">Rates come straight from the template\'s <b>Unit Rate Master</b> and are applied by each pole\'s pricing area, the same way the workbook does it. To change rates, update the Unit Rate Master in the master template and load it here; the app shows every rate change before saving.</div>'+
    (r?'<div class="tablebox"><table class="static"><thead><tr><th>Work type</th><th>Unit item</th>'+r.areas.map(a=>'<th class="num">'+esc(a)+"</th>").join("")+"</tr></thead><tbody>"+r.units.map(u=>"<tr><td>"+esc(u.workType)+'</td><td class="wrapc"><b>'+esc(u.item)+"</b></td>"+r.areas.map(a=>'<td class="mono num">'+money(u.rates[a])+"</td>").join("")+"</tr>").join("")+
      '<tr><td>Pole Set</td><td><b>C&amp;K</b> <span class="sub">(on the crew checklist)</span></td>'+r.areas.map(()=>'<td class="num"><span class="late">No rate</span></td>').join("")+"</tr></tbody></table></div>":'<div class="empty"><b>No rates yet</b>Load the master template to bring in the Unit Rate Master.</div>');
  document.getElementById("r-dl").onclick=async()=>{try{const b=await templateBuf();download(new Blob([b],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),tm.name);}catch(e){toast(errText(e),8000);}};
  const up=document.getElementById("r-up");if(up)up.onclick=openTemplateUpload;
}
function openTemplateUpload(){
  if(!canRates()||!canSave())return;
  const m=modal("Load master template",'<p class="sub" style="margin:0">Choose the blank Eversource MASTER Unit Invoice Template (.xlsx). The app reads the Unit Rate Master and the pole/unit layout, and fills a copy of this file for every invoice.</p><label class="f" for="tu-file">Template file<input type="file" id="tu-file" accept=".xlsx"></label><div id="tu-prev"></div>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tu-save" disabled>Save template &amp; rates</button>');
  let parsed=null,buf=null,name="";
  m.querySelector("#tu-file").onchange=async ev=>{const f=ev.target.files[0];if(!f)return;name=f.name;const pv=m.querySelector("#tu-prev");pv.innerHTML='<p class="sub">Reading…</p>';
    try{buf=await f.arrayBuffer();parsed=await TMPL.parse(buf);}catch(e){pv.innerHTML='<div class="err">'+esc(errText(e))+"</div>";parsed=null;m.querySelector("#tu-save").disabled=true;return;}
    const old=rates();const chg=[];const om=new Map((old?old.units:[]).map(u=>[u.key,u]));
    parsed.units.forEach(u=>{const o=om.get(u.key);if(!o)chg.push([u.item,"new unit"]);else parsed.areas.forEach(a=>{if(o.rates[a]!==u.rates[a])chg.push([u.item+" · "+a,money(o.rates[a])+" → "+money(u.rates[a])]);});});
    (old?old.units:[]).forEach(o=>{if(!parsed.units.some(u=>u.key===o.key))chg.push([o.item,"removed"]);});
    pv.innerHTML='<div class="okbox">'+parsed.units.length+" units × "+parsed.areas.length+" pricing areas · "+parsed.layout.slots+" pole slots · "+parsed.layout.perPole+" unit rows per pole</div>"+
      (old?'<div class="sec-h" style="margin:10px 0 4px">Changes vs. current rates ('+chg.length+")</div>"+(chg.length?'<div class="tablebox" style="max-height:240px;overflow:auto"><table class="static"><tbody>'+chg.slice(0,400).map(c=>"<tr><td>"+esc(c[0])+'</td><td class="mono">'+esc(c[1])+"</td></tr>").join("")+"</tbody></table></div>":'<p class="sub" style="margin:0">No rate changes.</p>'):"");
    m.querySelector("#tu-save").disabled=false;};
  m.querySelector("#tu-save").onclick=e=>busyRun(e.target,m,async()=>{if(!parsed)return;
    const file="template-"+hexId(6)+".enc.json";
    await ghPut("data/"+file,JSON.stringify(await encJson(S.dek,{name,b64:b64(buf)})),null,"Workflow: store invoice template");
    await commitIndex(ix=>{ix.rates={areas:parsed.areas,units:parsed.units.map(u=>({key:u.key,workType:u.workType,item:u.item,rates:u.rates})),from:parsed.from,terms:parsed.terms,customer:parsed.customer};
      ix.template={file,name,at:new Date().toISOString(),by:S.me.name,slots:parsed.layout.slots,perPole:parsed.layout.perPole};(ix.rateLog=ix.rateLog||[]).push({t:new Date().toISOString(),by:S.me.name,name});},"Workflow: update rates from template");
    S.tmplBuf=buf;closeOverlay();refresh();toast("Template and rates saved");});
}

/* ---------- invoices ---------- */
function renderInvoices(){
  const all=invoices().sort((a,b)=>(a.status==="Draft"?0:1)-(b.status==="Draft"?0:1)||String(b.date).localeCompare(String(a.date))||String(b.no).localeCompare(String(a.no)));
  const ready=sheets().filter(s=>s.status===ST.OK);const jobIds=[...new Set(ready.map(s=>s.jobId))];
  main.innerHTML='<section class="jobhead"><div><h1>Invoices</h1><div class="meta">'+ready.length+" unit sheet"+(ready.length===1?"":"s")+" approved for invoice across "+jobIds.length+" job"+(jobIds.length===1?"":"s")+"</div></div></section>"+
    '<h2 class="sec">Ready to bill</h2><div class="tablebox"><table><thead><tr><th class="nosort">Job</th><th class="nosort">Customer</th><th class="nosort">Sheets</th><th class="nosort">Locations</th><th class="nosort">Work dates</th><th class="nosort num">Amount</th><th class="nosort">Check</th><th class="nosort"></th></tr></thead><tbody id="rb"></tbody></table></div>'+
    '<h2 class="sec">Invoices</h2><div class="tablebox"><table><thead><tr><th class="nosort">Invoice #</th><th class="nosort">Date</th><th class="nosort">Job</th><th class="nosort">Customer</th><th class="nosort">Locations</th><th class="nosort num">Total</th><th class="nosort">Status</th></tr></thead><tbody id="it"></tbody></table></div>';
  const rb=document.getElementById("rb");
  rb.innerHTML=jobIds.length?jobIds.map(id=>{const j=jobById(id);const sel=ready.filter(s=>s.jobId===id);const b=buildInvoice(sel);
    return'<tr><td><div class="job-name">'+esc(j?j.name:"(job removed)")+"</div></td><td>"+esc(j?j.customer:"")+'</td><td class="mono">'+sel.length+'</td><td class="mono">'+b.poles.length+"</td><td>"+esc(b.period)+'</td><td class="mono num">'+(b.errs.length?"—":money(b.total))+"</td><td>"+(b.errs.length?'<span class="chip c-bad" title="'+esc(b.errs.join("; "))+'">'+b.errs.length+" issue"+(b.errs.length===1?"":"s")+"</span>":'<span class="chip c-done">Ready</span>')+"</td><td>"+(can.invoice()?'<button class="btn sm primary" type="button" data-build="'+esc(id)+'">Build invoice</button>':"")+"</td></tr>";}).join("")
    :'<tr><td colspan="8"><div class="empty"><b>Nothing ready to bill</b>Unit sheets show up here once billing approves them for invoice.</div></td></tr>';
  rb.querySelectorAll("[data-build]").forEach(b=>b.onclick=()=>openInvoiceForm(b.dataset.build));
  const tb=document.getElementById("it");
  tb.innerHTML=all.length?all.map(i=>'<tr tabindex="0" data-id="'+esc(i.id)+'"><td class="mono"><b>'+esc(i.no)+"</b></td><td>"+fmtD(i.date)+'</td><td><div class="job-name">'+esc(i.jobName)+"</div></td><td>"+esc(i.customer)+'</td><td class="mono">'+(i.poles||[]).length+'</td><td class="mono num">'+money(i.total)+"</td><td>"+invChip(i.status)+"</td></tr>").join("")
    :'<tr><td colspan="7"><div class="empty"><b>No invoices yet</b></div></td></tr>';
  bindRows(tb,id=>location.hash="inv-"+id);
}
const invChip=s=>'<span class="chip '+({Draft:"c-req",Sent:"c-done",Void:"c-bad"}[s]||"c-stage")+'">'+esc(s)+"</span>";
function buildInvoice(sel){
  const errs=[];const byPole=new Map();
  sel.forEach(s=>{const pr=priceSheet(s);if(s.hold&&s.hold.on)errs.push(s.no+" is on hold");pr.errs.forEach(e=>errs.push(s.no+": "+e));if(!pr.pole)return;
    const k=pr.pole.id;const e=byPole.get(k)||{pole:pr.pole,area:pr.area,sheets:[],qty:new Map()};e.sheets.push(s);
    pr.lines.forEach(l=>{const q=e.qty.get(l.key)||{qty:0,notes:[]};q.qty+=l.qty;if(l.note)q.notes.push(l.note);e.qty.set(l.key,q);});byPole.set(k,e);});
  const j=sel.length?jobById(sel[0].jobId):null;
  const order=rates()?rates().units.map(u=>u.key):[];
  const poles=[...byPole.values()].sort((a,b)=>(a.pole.n||0)-(b.pole.n||0)).map((e,i)=>{const p=e.pole;
    const lines=[];
    [...e.qty.entries()].sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0])).forEach(([key,q])=>{const u=unitInfo(key);const rate=u.rates?u.rates[e.area]:null;lines.push({key,workType:u.workType,item:u.item,qty:Math.round(q.qty*10000)/10000,rate:rate==null?null:rate,ext:rate==null?null:q.qty*rate,note:q.notes.join("; ")});});
    const lastGf=e.sheets.map(s=>s.gfAt).sort().pop(),lastBill=e.sheets.map(s=>s.billAt).sort().pop();
    return{slot:"P"+String(i+1).padStart(2,"0"),poleId:p.id,n:p.n,ticket:p.ticket,town:p.town,street:p.street,esPole:p.esPole,vzPole:p.vzPole,pdfPage:p.pdfPage,woJob:p.woJob||(j?j.wo:""),area:e.area,notes:p.notes||"",
      gfBy:[...new Set(e.sheets.map(s=>s.gfBy))].join(", "),gfDate:isoDay(lastGf),billBy:[...new Set(e.sheets.map(s=>s.billBy))].join(", "),billDate:isoDay(lastBill),sheetNos:e.sheets.map(s=>s.no),lines,total:lines.reduce((a,l)=>a+(l.ext||0),0)};});
  const slots=(S.index.template&&S.index.template.slots)||0;
  if(!S.index.template)errs.push("No invoice template loaded (Rates tab)");
  else if(poles.length>slots)errs.push(poles.length+" poles selected; the template holds "+slots+" per invoice. Select fewer sheets.");
  const dates=sel.map(s=>s.workDate).filter(Boolean).sort();
  return{poles,errs:[...new Set(errs)],total:cents(poles.reduce((a,p)=>a+p.total,0)),period:dates.length?fmtD(dates[0])+(dates[dates.length-1]!==dates[0]?" – "+fmtD(dates[dates.length-1]):""):""};}
function openInvoiceForm(presetJob){
  if(!can.invoice()){canSave();return;}
  const ready=sheets().filter(s=>s.status===ST.OK);
  const jobIds=[...new Set(ready.map(s=>s.jobId))];
  if(!ready.length){toast("No sheets are approved for invoice yet.",5000);return;}
  const m=modal("Build invoice",'<fieldset style="grid-template-columns:1fr 1fr 1fr"><label class="f wide" for="if-job">Job<select id="if-job">'+jobIds.map(id=>{const j=jobById(id);return'<option value="'+esc(id)+'">'+esc(j?j.name:"(job removed)")+" ("+ready.filter(s=>s.jobId===id).length+" sheets)</option>";}).join("")+"</select></label>"+
    '<label class="f" for="if-no">Invoice #<input id="if-no" autocomplete="off"></label><label class="f" for="if-date">Invoice date<input type="date" id="if-date" value="'+todayStr()+'"></label><label class="f" for="if-po">PO#<input id="if-po"></label>'+
    '<label class="f" for="if-per">Billing period<input id="if-per"></label><label class="f" for="if-pkg">Billing package<input id="if-pkg"></label></fieldset>'+
    '<div><div class="sec-h">Sheets to include</div><div class="row-inline" style="margin-bottom:6px"><button class="btn sm" type="button" id="if-all">Select all</button><button class="btn sm" type="button" id="if-none">Clear</button></div><div id="if-sheets"></div></div><div><div class="sec-h">Invoice cover preview</div><div id="if-prev"></div></div>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="if-save">Create invoice</button>',"wide");
  const jobSel=m.querySelector("#if-job");let chosen=new Set();let built=null;
  function onJob(){const j=jobById(jobSel.value);m.querySelector("#if-po").value=j?j.po:"";m.querySelector("#if-pkg").value=j?j.name:"";const list=ready.filter(s=>s.jobId===jobSel.value).sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate)));
    const slots=(S.index.template&&S.index.template.slots)||40;chosen=new Set();const pc=new Set();list.forEach(s=>{const k=s.poleId||s.id;if(pc.has(k)||pc.size<slots){pc.add(k);chosen.add(s.id);}});
    m.querySelector("#if-sheets").innerHTML='<div class="ulist" style="max-height:260px;overflow:auto">'+list.map(s=>'<label class="u" style="grid-template-columns:auto 1fr auto;cursor:pointer"><input type="checkbox" data-s="'+esc(s.id)+'"'+(chosen.has(s.id)?" checked":"")+'><span><b class="mono">'+esc(s.no)+"</b> · "+esc(fmtD(s.workDate))+" · "+esc(sheetPoleText(s))+'</span><span class="mono">'+(s.lines||[]).length+" units</span></label>").join("")+"</div>";
    m.querySelectorAll("[data-s]").forEach(c=>c.onchange=()=>{if(c.checked)chosen.add(c.dataset.s);else chosen.delete(c.dataset.s);prev();});prev();}
  m.querySelector("#if-all").onclick=()=>{m.querySelectorAll("[data-s]").forEach(c=>{c.checked=true;chosen.add(c.dataset.s);});prev();};
  m.querySelector("#if-none").onclick=()=>{m.querySelectorAll("[data-s]").forEach(c=>{c.checked=false;});chosen.clear();prev();};
  function prev(){const sel=ready.filter(s=>chosen.has(s.id));built=buildInvoice(sel);m.querySelector("#if-per").value=built.period;
    m.querySelector("#if-prev").innerHTML=(built.errs.length?'<div class="banner bad"><b>Fix before invoicing:</b><br>'+built.errs.map(esc).join("<br>")+"</div>":"")+
      '<div class="tablebox"><table class="static"><thead><tr><th>Pole ID</th><th>WO / Job #</th><th>Location / address</th><th>Pole #</th><th>Pricing area</th><th class="num">Amount</th></tr></thead><tbody>'+
      (built.poles.map(p=>'<tr><td class="mono">'+p.slot+'</td><td class="mono">'+esc(p.woJob)+"</td><td>"+esc(p.street+", "+p.town)+'</td><td class="mono">'+esc(p.esPole)+"</td><td>"+esc(p.area)+'</td><td class="mono num">'+money(p.total)+"</td></tr>").join("")||'<tr><td colspan="6" class="sub">Select at least one sheet.</td></tr>')+
      '</tbody><tfoot><tr><td colspan="5" class="num"><b>Total (USD) · '+built.poles.length+" pole"+(built.poles.length===1?"":"s")+'</b></td><td class="mono num"><b>'+(built.errs.length?"—":money(built.total))+"</b></td></tr></tfoot></table></div>";
    m.querySelector("#if-save").disabled=!!built.errs.length||!sel.length;}
  if(presetJob&&jobIds.includes(presetJob))jobSel.value=presetJob;
  jobSel.onchange=onJob;onJob();
  m.querySelector("#if-save").onclick=e=>busyRun(e.target,m,async()=>{
    const no=m.querySelector("#if-no").value.trim(),date=m.querySelector("#if-date").value;
    if(!no)throw new Error("Enter the invoice number.");if(!date)throw new Error("Enter the invoice date.");
    if(invoices().some(i=>i.no.toLowerCase()===no.toLowerCase()&&i.status!=="Void"))throw new Error("Invoice "+no+" already exists.");
    const sel=ready.filter(s=>chosen.has(s.id));if(!sel.length)throw new Error("Select at least one sheet.");
    const b=buildInvoice(sel);if(b.errs.length)throw new Error("Fix the items listed first.");
    const j=jobById(jobSel.value);const r=rates();
    const doc={no,date,jobId:j.id,jobName:j.name,customer:j.customer||(r&&r.customer)||"",terms:(r&&r.terms)||"",po:m.querySelector("#if-po").value.trim(),period:m.querySelector("#if-per").value.trim(),pkg:m.querySelector("#if-pkg").value.trim(),
      sheetIds:sel.map(s=>s.id),poles:b.poles,total:b.total,status:"Draft",template:S.index.template?S.index.template.name:"",from:(r&&r.from)||[]};
    const iid=await createDoc("invoice",doc,"Invoice built: "+b.poles.length+" pole(s) from "+sel.length+" sheet(s) · total "+money(b.total));
    if(!iid)return;
    const failed=[];
    for(const s of sel){const ok=await commitDoc(s.id,x=>{if(x.status!==ST.OK)throw new Error(x.no+" is no longer approved for invoice.");x.status=ST.INV;x.invoiceId=iid;x.invoiceNo=no;},"Added to invoice "+no,true);if(!ok)failed.push(s.no);}
    closeOverlay();location.hash="inv-"+iid;
    if(failed.length)toast("Invoice created, but these sheets could not be marked invoiced: "+failed.join(", ")+". Check them.",12000);else toast("Invoice "+no+" created");
  });
}
function renderInvoice(){
  const i=S.docs.get(S.docId);const id=S.docId;
  if(!i||i.type!=="invoice"||role()==="crew"){main.innerHTML='<a class="back" href="#invoices">← Invoices</a><div class="empty"><b>Invoice not found</b></div>';return;}
  const chk=cents(i.poles.reduce((a,p)=>a+p.lines.reduce((x,l)=>x+(l.ext||0),0),0));const tieOk=chk===cents(i.total);
  const acts=['<button class="btn primary" type="button" id="v-xls">Eversource template (.xlsx)</button><button class="btn" type="button" id="v-pdf">P&amp;G invoice PDF</button>'];
  if(can.invoice()&&i.status==="Draft")acts.push('<button class="btn" type="button" id="v-sent">Mark as sent</button>');
  if(can.invoice()&&i.status!=="Void")acts.push('<button class="btn danger" type="button" id="v-void">Void</button>');
  main.innerHTML='<a class="back" href="#invoices">← Invoices</a>'+
    '<section class="jobhead"><div><h1>Invoice '+esc(i.no)+'</h1><div class="meta">'+invChip(i.status)+"<span>"+esc(i.jobName)+"</span><span>"+esc(fmtD(i.date))+'</span></div></div><div class="acts">'+acts.join("")+"</div></section>"+
    (tieOk?"":'<div class="banner bad">Pole lines total '+money(chk)+" but the saved invoice total is "+money(i.total)+" (variance "+money(cents(chk-i.total))+"). Do not send until this is resolved.</div>")+
    '<section class="details">'+dl("Bill to",esc(i.customer))+dl("Terms",esc(i.terms))+dl("PO#",esc(i.po))+dl("Billing period",esc(i.period))+dl("Billing package",esc(i.pkg))+dl("Invoice total",'<b class="mono">'+money(i.total)+"</b>")+dl("Unit sheets",esc(i.poles.flatMap(p=>p.sheetNos).join(", ")),true)+dl("Template",esc(i.template))+(i.sentAt?dl("Sent",esc(i.sentBy+" · "+fmtT(i.sentAt))):"")+"</section>"+
    '<h2 class="sec">Invoice cover — unit billing summary</h2><div class="tablebox"><table class="static"><thead><tr><th>WO / Job #</th><th>Location / address</th><th>Pole #</th><th>Pole ID</th><th class="num">Amount</th><th>Pricing area</th></tr></thead><tbody>'+
    i.poles.map(p=>'<tr><td class="mono">'+esc(p.woJob)+"</td><td>"+esc(p.street+", "+p.town)+'</td><td class="mono">'+esc(p.esPole)+'</td><td class="mono">'+p.slot+'</td><td class="mono num">'+money(p.total)+"</td><td>"+esc(p.area)+"</td></tr>").join("")+
    '</tbody><tfoot><tr><td colspan="4" class="num"><b>Total (USD)</b></td><td class="mono num"><b>'+money(i.total)+"</b></td><td></td></tr></tfoot></table></div>"+
    '<h2 class="sec">Final invoice — pole and unit detail</h2>'+i.poles.map(p=>'<div class="tablebox" style="margin-bottom:10px"><table class="static"><thead><tr><th colspan="6">'+esc("POLE "+p.slot+"  |  "+p.street+"  |  POLE "+p.esPole+"  |  "+p.town+"  |  WO #"+p.woJob+"  |  "+p.area)+'</th></tr><tr class="subh"><td>Work type</td><td>Unit description</td><td class="num">Qty</td><td class="num">Unit price</td><td class="num">Amount</td><td>Note</td></tr></thead><tbody>'+
      p.lines.map(l=>"<tr><td>"+esc(l.workType)+"</td><td>"+esc(l.item)+'</td><td class="mono num">'+fmtN(l.qty)+'</td><td class="mono num">'+money(l.rate)+'</td><td class="mono num">'+money(l.ext)+'</td><td class="sub">'+esc(l.note)+"</td></tr>").join("")+
      '</tbody><tfoot><tr><td colspan="4" class="num"><b>Pole '+p.slot+' total</b></td><td class="mono num"><b>'+money(p.total)+'</b></td><td class="sub">'+esc(p.sheetNos.join(", "))+"</td></tr></tfoot></table></div>").join("")+
    '<h2 class="sec">History</h2>'+histHtml(i);
  document.getElementById("v-xls").onclick=e=>exportTemplate(i,e.target);
  document.getElementById("v-pdf").onclick=()=>printInvoice(i);
  const s=document.getElementById("v-sent");if(s)s.onclick=()=>confirmBox("Mark "+i.no+" as sent?","Record that this invoice package was submitted (Ariba).","Mark sent",async n=>{await commitDoc(id,x=>{x.status="Sent";x.sentAt=new Date().toISOString();x.sentBy=S.me.name;},"Marked sent"+(n?": "+n:""));},{note:"Note"});
  const v=document.getElementById("v-void");if(v)v.onclick=()=>confirmBox("Void invoice "+i.no+"?","Its unit sheets go back to Ready to invoice so they can be billed again. The voided invoice stays on record.","Void invoice",async n=>{
    const ok=await commitDoc(id,x=>{x.status="Void";x.voidAt=new Date().toISOString();x.voidBy=S.me.name;},"Voided: "+n,true);if(!ok)return;
    for(const sid of i.sheetIds||[]){if(S.index.docs[sid])await commitDoc(sid,x=>{if(x.invoiceId===id){x.status=ST.OK;x.invoiceId="";x.invoiceNo="";}},"Invoice "+i.no+" voided — back to Ready to invoice",true);}
    refresh();toast("Invoice "+i.no+" voided");},{note:"Reason",noteReq:true,danger:true});
}
function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
async function exportTemplate(i,btn){
  const t=btn.textContent;btn.disabled=true;btn.textContent="Building…";
  try{
    const buf=await templateBuf();
    const out=await TMPL.fill(buf,{no:i.no,dateText:fmtD(i.date),po:i.po,period:i.period,packageName:i.pkg,
      poles:i.poles.map(p=>{const q={};p.lines.forEach(l=>{q[l.key]={qty:l.qty,note:l.note};});return{town:p.town,street:p.street,esPole:p.esPole,woJob:p.woJob,area:p.area,gfBy:p.gfBy,gfDate:p.gfDate,billDate:p.billDate,notes:p.notes,ticket:p.ticket,vzPole:p.vzPole,qty:q};})});
    download(new Blob([out],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"Eversource_Unit_Billing_"+i.date+"_"+i.no.replace(/[\\/:*?"<>|]/g,"-")+".xlsx");
    toast("Template filled. Excel recalculates the totals when the file opens.",6000);
  }catch(e){toast(errText(e),9000);}finally{btn.disabled=false;btn.textContent=t;}
}
function printInvoice(i){
  const p=document.getElementById("print");
  const head='<div class="pv-head"><div><img src="../pg-logo.jpg" alt="P&amp;G Power Co."><div class="pv-from">'+(i.from||[]).map(esc).join("<br>")+'</div></div><div class="pv-title"><h1>INVOICE</h1><table class="pv-meta"><tr><td>Invoice No.</td><td><b>'+esc(i.no)+"</b></td></tr><tr><td>Invoice Date</td><td>"+esc(fmtD(i.date))+"</td></tr>"+(i.terms?"<tr><td>Terms</td><td>"+esc(i.terms)+"</td></tr>":"")+"<tr><td>Bill To</td><td>"+esc(i.customer)+"</td></tr>"+(i.po?"<tr><td>PO#</td><td>"+esc(i.po)+"</td></tr>":"")+(i.period?"<tr><td>Billing Period</td><td>"+esc(i.period)+"</td></tr>":"")+'</table></div></div><div class="pv-stripe"></div>';
  const cover='<h2 class="pv-h2">'+esc((i.customer||"").toUpperCase())+' — UNIT BILLING SUMMARY</h2><table class="pv-lines"><thead><tr><th>WO / Job #</th><th>Location / Address</th><th>Pole #</th><th>Pole ID</th><th class="num">Amount</th><th>Pricing Area</th></tr></thead><tbody>'+
    i.poles.map(x=>"<tr><td>"+esc(x.woJob)+"</td><td>"+esc(x.street+", "+x.town)+"</td><td>"+esc(x.esPole)+"</td><td>"+x.slot+'</td><td class="num">'+money(x.total)+"</td><td>"+esc(x.area)+"</td></tr>").join("")+
    '</tbody><tfoot><tr><td colspan="4" class="num">Invoice Subtotal</td><td class="num">'+money(i.total)+'</td><td></td></tr><tr><td colspan="4" class="num">TOTAL</td><td class="num">'+money(i.total)+'</td><td></td></tr></tfoot></table><p class="pv-foot">Thank you for your business</p>';
  const detail='<div class="pv-break"></div>'+head+'<h2 class="pv-h2">'+esc((i.customer||"").toUpperCase())+' | UNIT BASED INVOICE — FINAL INVOICE</h2><p class="pv-foot" style="margin-top:0">Approved pole locations and unit detail. See Invoice Cover for billing summary.'+(i.pkg?" Billing package: "+esc(i.pkg)+".":"")+"</p>"+
    i.poles.map(x=>'<table class="pv-lines pv-pole"><thead><tr><th colspan="5">'+esc("POLE "+x.slot+"  |  "+x.street+"  |  POLE "+x.esPole+"  |  "+String(x.town).toUpperCase()+"  |  WO #"+x.woJob+"  |  "+String(x.area).toUpperCase())+'</th></tr><tr class="subh"><td>Work Type</td><td>Unit Description</td><td class="num">Qty</td><td class="num">Unit Price</td><td class="num">Amount</td></tr></thead><tbody>'+
      x.lines.map(l=>"<tr><td>"+esc(l.workType)+"</td><td>"+esc(l.item)+'</td><td class="num">'+fmtN(l.qty)+'</td><td class="num">'+money(l.rate)+'</td><td class="num">'+money(l.ext)+"</td></tr>").join("")+
      '</tbody><tfoot><tr><td colspan="4">'+esc("POLE "+x.slot+" TOTAL  |  "+x.street+"  |  POLE "+x.esPole)+'</td><td class="num">'+money(x.total)+"</td></tr></tfoot></table>").join("")+
    '<table class="pv-lines"><tfoot><tr><td class="num">INVOICE TOTAL (USD)</td><td class="num" style="width:140px">'+money(i.total)+"</td></tr></tfoot></table>";
  p.innerHTML='<div class="pv">'+head+cover+detail+"</div>";
  document.body.classList.add("printing");const prev=document.title;document.title="P&G Invoice "+i.no;
  const done=()=>{document.body.classList.remove("printing");document.title=prev;window.removeEventListener("afterprint",done);};
  window.addEventListener("afterprint",done);setTimeout(()=>window.print(),200);
}

initLogin();
window.__wf={S,priceSheet,buildInvoice};
})();
