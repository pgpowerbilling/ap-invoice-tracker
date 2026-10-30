/* Job package reader: pulls the pole list (Ticket Id, Place, Street, ES Pole#, VZ Pole#, date set)
   out of a customer packet PDF. Text PDFs are read directly (pdf.js); scanned PDFs are read with
   text recognition (Tesseract). Columns are found from the header row's positions, so values
   with spaces ("ELCO P43", "COTTAGE PARK AVE") stay in the right column. */
const PKG=(function(){
"use strict";
const PDFJS="https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/";
const TESS="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const HEAD=[["ticket",/^ticket/i],["town",/^(place|town|city|municipality)/i],["street",/^(street|address|road)/i],["esPole",/^(es|elco|utility)$/i],["vzPole",/^(vz|verizon|telco)$/i],["dateSet",/^date$/i],["notes",/^(notes?|comments?)$/i]];
const TICKET=/^[A-Z]{1,4}\d{5,}$/i;
const clean=s=>String(s||"").replace(/[|\[\]{}=_~“”‘’"`]+/g," ").replace(/^[—–\-.,:;]+|[—–\-,:;]+$/g,"").replace(/\s+/g," ").trim();

function lines(words,tolFactor){
  const ws=words.filter(w=>clean(w.t)).map(w=>Object.assign({},w,{cy:(w.y0+w.y1)/2,h:Math.max(1,w.y1-w.y0)})).sort((a,b)=>a.cy-b.cy);
  const out=[];
  ws.forEach(w=>{const L=out[out.length-1];if(L&&Math.abs(w.cy-L.cy)<=Math.max(L.h,w.h)*(tolFactor||0.6)){L.words.push(w);L.cy=(L.cy*(L.words.length-1)+w.cy)/L.words.length;L.h=Math.max(L.h,w.h);}else out.push({cy:w.cy,h:w.h,words:[w]});});
  out.forEach(L=>L.words.sort((a,b)=>a.x0-b.x0));return out;}
function findHeader(ls){
  for(let i=0;i<ls.length;i++){const ws=ls[i].words;const anchors={};
    ws.forEach((w,k)=>{const t=clean(w.t);HEAD.forEach(([key,re])=>{if(anchors[key]!=null)return;
      if(key==="esPole"||key==="vzPole"){if(re.test(t)&&ws[k+1]&&/^pole/i.test(clean(ws[k+1].t)))anchors[key]=w.x0;}
      else if(re.test(t))anchors[key]=w.x0;});});
    if(anchors.street!=null&&(anchors.ticket!=null||anchors.esPole!=null)&&Object.keys(anchors).length>=3)return{index:i,anchors};}
  return null;}
function rowFrom(L,cols,tol){
  const r={ticket:"",town:"",street:"",esPole:"",vzPole:"",dateSet:"",notes:""};let conf=100;
  L.words.forEach(w=>{let col=cols[0];for(const c of cols){if(w.x0>=c.x-tol)col=c;}
    const t=clean(w.t);if(!t)return;r[col.key]=(r[col.key]?r[col.key]+" ":"")+t;if(w.conf!=null)conf=Math.min(conf,w.conf);});
  return{r,conf};}
/* no readable header (scans often lose a highlighted header row): find column starts from the data itself */
const DEFAULT_ORDER=["ticket","town","street","esPole","vzPole","dateSet"];
function inferCols(ls,width){
  const rows=ls.filter(L=>TICKET.test(clean(L.words[0].t).replace(/\s/g,"")));if(rows.length<2)return null;
  /* a column starts where a word follows a wide gap; average word-space is small, column gutters are wide */
  const starts=[];rows.forEach((L,ri)=>{const hs=L.words.map(w=>w.y1-w.y0).sort((a,b)=>a-b);const hgt=Math.max(1,hs[Math.floor(hs.length/2)]);
    L.words.forEach((w,k)=>{const prev=L.words[k-1];const gap=prev?w.x0-prev.x1:Infinity;if(gap>hgt*1.2)starts.push({x:w.x0,ri});});});
  starts.sort((a,b)=>a.x-b.x);const tol=width*0.01;const cl=[];
  starts.forEach(s=>{const c=cl[cl.length-1];if(c&&s.x-c.first<=tol*2){c.xs.push(s.x);c.rows.add(s.ri);}else cl.push({first:s.x,xs:[s.x],rows:new Set([s.ri])});});
  const peaks=cl.filter(c=>c.rows.size>=rows.length*0.5).map(c=>Math.min.apply(null,c.xs));
  if(peaks.length<4)return null;const anchors={};peaks.slice(0,DEFAULT_ORDER.length).forEach((x,i)=>anchors[DEFAULT_ORDER[i]]=x);return anchors;}
/* pages: [{width, words:[{t,x0,y0,x1,y1,conf?}]}] -> {rows, warn} */
function parse(pages){
  const rows=[],warn=[];let base=null;
  pages.forEach((pg,pi)=>{
    const ls=lines(pg.words,0.45);const h=findHeader(ls);let start=0,anchors;
    if(h){anchors=h.anchors;base={anchors,width:pg.width};start=h.index+1;}
    else if(base){const k=pg.width/base.width;anchors={};Object.keys(base.anchors).forEach(c=>anchors[c]=base.anchors[c]*k);}
    else if((anchors=inferCols(ls,pg.width))){warn.push("Page "+(pi+1)+": the header row couldn't be read, so columns were taken in packet order: "+Object.keys(anchors).map(k=>({ticket:"Ticket Id",town:"Place",street:"Street",esPole:"ES Pole#",vzPole:"VZ Pole#",dateSet:"Date set"}[k])).join(", ")+".");}
    else{warn.push("Page "+(pi+1)+": no Ticket / Street / Pole header was found, so this page was skipped.");return;}
    const cols=Object.keys(anchors).map(key=>({key,x:anchors[key]})).sort((a,b)=>a.x-b.x);
    const gaps=cols.slice(1).map((c,i)=>c.x-cols[i].x);const tol=Math.min(pg.width*0.012,(Math.min.apply(null,gaps.length?gaps:[pg.width]))*0.25);
    for(let i=start;i<ls.length;i++){const {r,conf}=rowFrom(ls[i],cols,tol);
      const isRow=TICKET.test(r.ticket.replace(/\s/g,""))||(!!r.street&&!!r.esPole&&anchors.ticket==null);
      if(!isRow){const txt=ls[i].words.map(w=>clean(w.t)).join(" ");if(/[A-Z]{2,}\d{5,}/i.test(txt))warn.push("Page "+(pi+1)+': a line could not be split into columns and was skipped: "'+txt.slice(0,80)+'"');continue;}
      r.ticket=r.ticket.replace(/\s/g,"").toUpperCase();r.esPole=r.esPole.replace(/['’]/g,"").replace(/\b([Pp])([Oo0-9]+[A-Za-z]?)\b/g,(m,p,d)=>/\d/.test(d)||/^[Oo]$/.test(d)?p+d.replace(/[Oo]/g,"0"):m);r.vzPole=r.vzPole.replace(/['’]/g,"");
      const L={ticket:r.ticket,town:r.town,street:r.street,esPole:r.esPole,vzPole:r.vzPole,pdfPage:String(pi+1),woJob:"",area:"",dateSet:r.dateSet,notes:r.notes};
      const issues=[];if(conf<70)issues.push("low read confidence");if(!L.street||!L.esPole)issues.push("missing street or pole #");
      if(issues.length)L._check=issues.join(", ");rows.push(L);}
  });
  const seen=new Map();rows.forEach((L,i)=>{if(seen.has(L.ticket)){L._check=(L._check?L._check+", ":"")+"duplicate ticket";}else seen.set(L.ticket,i);});
  return{rows,warn};}

/* ---- browser side ---- */
let pdfjs=null,tess=null;
function loadScript(src){return new Promise((res,rej)=>{if(document.querySelector('script[src="'+src+'"]'))return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("Could not load "+src));document.head.appendChild(s);});}
async function getPdfjs(){if(!pdfjs){pdfjs=await import(PDFJS+"pdf.min.mjs");pdfjs.GlobalWorkerOptions.workerSrc=PDFJS+"pdf.worker.min.mjs";}return pdfjs;}
async function ocrWorker(progress){if(!tess){await loadScript(TESS);progress&&progress("Starting text recognition…");tess=await globalThis.Tesseract.createWorker("eng");}return tess;}
function tessWords(data){
  if(data.words&&data.words.length)return data.words;
  const out=[];(data.blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>(l.words||[]).forEach(w=>out.push(w)))));return out;}
async function pagesOf(file,progress){
  const lib=await getPdfjs();const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const pages=[];let scanned=false;
  for(let n=1;n<=doc.numPages;n++){progress&&progress("Reading page "+n+" of "+doc.numPages+"…");
    const page=await doc.getPage(n);const vp=page.getViewport({scale:1});const tc=await page.getTextContent();
    const items=tc.items.filter(it=>it.str&&it.str.trim());
    if(items.map(i=>i.str).join("").replace(/\s/g,"").length>20){
      const words=[];items.forEach(it=>{const x=it.transform[4],y=vp.height-it.transform[5],h=Math.abs(it.transform[3])||it.height||10;
        const parts=it.str.split(/(\s+)/);let cx=x;const cw=(it.width||0)/Math.max(1,it.str.length);
        parts.forEach(p=>{if(p.trim())words.push({t:p.trim(),x0:cx,y0:y-h,x1:cx+p.length*cw,y1:y});cx+=p.length*cw;});});
      pages.push({width:vp.width,words});
    }else{scanned=true;
      const scale=Math.min(3,2400/vp.width);const v2=page.getViewport({scale});const c=document.createElement("canvas");c.width=Math.round(v2.width);c.height=Math.round(v2.height);
      await page.render({canvasContext:c.getContext("2d"),viewport:v2,canvas:c}).promise;
      const w=await ocrWorker(progress);progress&&progress("Recognizing text on page "+n+" of "+doc.numPages+"… (scanned page)");
      const {data}=await w.recognize(c,{},{blocks:true,text:true});
      pages.push({width:c.width,words:tessWords(data).map(x=>({t:x.text,x0:x.bbox.x0,y0:x.bbox.y0,x1:x.bbox.x1,y1:x.bbox.y1,conf:x.confidence}))});}
  }
  return{pages,scanned,numPages:doc.numPages};}
async function read(file,progress){const r=await pagesOf(file,progress);const out=parse(r.pages);out.scanned=r.scanned;out.pages=r.numPages;return out;}
async function readUnitSheets(file,sections,progress){const r=await pagesOf(file,progress);const out=parseUnitSheets(r.pages,sections);out.scanned=r.scanned;return out;}

/* ---- filled Crew Daily Unit Checklist pages -> sheet entries ---- */
const nm=s=>String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9.]+/g," ").replace(/\s+/g," ").trim();
const NUM=/^\d+(\.\d+)?$/;
function valuesBelow(ls,li,anchors,tol){
  /* anchors: [{key,x}] from a label line; value = words on the next line(s) before the next label line */
  const out={};anchors.forEach(a=>out[a.key]="");const cols=anchors.slice().sort((a,b)=>a.x-b.x);
  for(let k=li+1;k<ls.length&&k<=li+2;k++){const L=ls[k];const txt=nm(L.words.map(w=>w.t).join(" "));
    if(/ticket id|vz pole|pole set|pole top configuration|location|work order/.test(txt)&&k>li+1)break;
    if(k>li+1&&Object.values(out).some(Boolean))break;
    L.words.forEach(w=>{let col=null;for(const c of cols){if(w.x0>=c.x-tol)col=c;}if(col)out[col.key]=(out[col.key]?out[col.key]+" ":"")+clean(w.t);});}
  return out;}
function parseUnitSheets(pages,sections){
  const res=[];
  const secIdx=new Map(sections.map(s=>[nm(s[0]),s]));
  pages.forEach((pg,pi)=>{
    const ls=lines(pg.words,0.5);const tol=pg.width*0.01;const mid=pg.width/2;
    const txt=L=>L.words.map(w=>clean(w.t)).join(" ");
    const all=nm(ls.map(txt).join(" "));
    if(!/unit checklist/.test(all)||!/pole top configuration/.test(all))return;
    const e={page:pi+1,date:"",crew:"",wo:"",fwo:"",awc:"",poleSet:"",pole:"",ticket:"",vz:"",locNo:"",qty:{},others:[],notes:"",warn:[]};
    const findLine=re=>ls.findIndex(L=>re.test(nm(txt(L))));
    const anchorOf=(L,label)=>{const ws=L.words;for(let k=0;k<ws.length;k++){for(let n=1;n<=5&&k+n<=ws.length;n++){const seq=nm(ws.slice(k,k+n).map(w=>w.t).join(" "));if(seq===label)return ws[k].x0;if(label.indexOf(seq)!==0)break;}}return null;};
    const aw=ls.findIndex(L=>/^awc\b/.test(nm(txt(L))));if(aw>=0){const L=ls[aw];const k=L.words.findIndex(w=>/^awc$/i.test(clean(w.t)));const left=w=>w.x1<pg.width*0.62;
      e.awc=L.words.slice(k+1).filter(left).map(w=>clean(w.t)).join(" ").replace(/^_+|_+$/g,"").trim();
      const nx=ls[aw+1];if(!e.awc&&nx&&!/\bdate\b/.test(nm(txt(nx))))e.awc=nx.words.filter(left).map(w=>clean(w.t)).join(" ").trim();}
    const l1=findLine(/\bdate\b.*crew.*lead.*work order/);
    if(l1>=0){const L=ls[l1];const an=[["date","date"],["crew","crew lead"],["wo","work order"],["fwo","fwo"]].map(([k,lab])=>({key:k,x:anchorOf(L,lab)})).filter(a=>a.x!=null);Object.assign(e,valuesBelow(ls,l1,an,tol));}
    const l2=findLine(/pole location.*pole set/);
    if(l2>=0){const L=ls[l2];const an=[["pole","pole location"],["poleSet","pole set"]].map(([k,lab])=>({key:k,x:anchorOf(L,lab)})).filter(a=>a.x!=null);const v=valuesBelow(ls,l2,an,tol);e.pole=v.pole||"";
      const psx=(an.find(a=>a.key==="poleSet")||{}).x;const vl=ls[l2+1];
      if(psx!=null&&vl){const ps=vl.words.filter(w=>w.x0>=psx-tol).map(w=>String(w.t)).join("").toUpperCase().replace(/\s+/g,"");
        e.poleSet=/[X✓✔☒]\]?YES/.test(ps)?"yes":/[X✓✔☒]\]?NO/.test(ps)?"no":"";}}
    const l3=findLine(/ticket id.*vz pole/);
    if(l3>=0){const L=ls[l3];const an=[["ticket","ticket id"],["vz","vz pole"],["locNo","location"],["pdf","pdf page"]].map(([k,lab])=>({key:k,x:anchorOf(L,lab)})).filter(a=>a.x!=null);const v=valuesBelow(ls,l3,an,tol);e.ticket=(v.ticket||"").replace(/\s/g,"").toUpperCase();e.vz=v.vz||"";e.locNo=v.locNo||"";}
    /* unit rows: two columns, each with a section context and a QTY column position */
    const ctx={L:null,R:null},qx={L:null,R:null};let notesAt=-1;
    for(let k=Math.max(l3,0)+1;k<ls.length;k++){const Lw=ls[k];const t=nm(txt(Lw));
      if(/^notes extras/.test(t)){notesAt=k;break;}
      ["L","R"].forEach(side=>{const ws=Lw.words.filter(w=>side==="L"?w.x0<mid:w.x0>=mid);if(!ws.length)return;
        const st=nm(ws.map(w=>w.t).join(" "));
        if(/ qty$/.test(st)||st==="qty"){const head=st.replace(/ ?qty$/,"");ctx[side]=head==="other units"?"OTHER":(secIdx.get(head)||null);const q=ws.find(w=>/^qty$/i.test(clean(w.t)));qx[side]=q?q.x0:null;
          if(head&&!ctx[side])e.warn.push("Page "+(pi+1)+': unknown section "'+head+'"');return;}
        if(!ctx[side]||qx[side]==null)return;
        const lab=ws.filter(w=>w.x1<qx[side]-tol).map(w=>clean(w.t)).join(" ").trim();
        const qws=ws.filter(w=>w.x0>=qx[side]-tol*3).map(w=>clean(w.t)).join("");
        if(!qws)return;
        const q=qws.replace(/[^0-9.]/g,"");
        if(!NUM.test(q)){e.warn.push("Page "+(pi+1)+': quantity "'+qws+'" next to "'+(lab||"?")+'" is not a number');return;}
        if(ctx[side]==="OTHER"){if(lab)e.others.push({text:lab,qty:Number(q)});else e.warn.push("Page "+(pi+1)+": an Other units quantity has no unit written next to it");return;}
        const it=ctx[side][1].find(x=>nm(x[1])===nm(lab))||ctx[side][1].find(x=>nm(lab).indexOf(nm(x[1]))===0);
        if(!it){e.warn.push("Page "+(pi+1)+': couldn\'t match "'+lab+'" in '+ctx[side][0]);return;}
        e.qty[it[0]]=(e.qty[it[0]]||0)+Number(q);});}
    if(notesAt>=0){const raw=L=>L.words.map(w=>String(w.t).trim()).join(" ");const parts=[];const first=raw(ls[notesAt]).replace(/^.*JUSTIFICATION:?/i,"").trim();if(first)parts.push(first);
      for(let k=notesAt+1;k<ls.length;k++){const t=txt(ls[k]);if(/P&G Power Co\.?\s*·?.*Location \d+ of \d+/i.test(t)||/^P&G Power Co/i.test(t))break;if(/^Packet note:/i.test(t))continue;parts.push(raw(ls[k]));}
      e.notes=parts.join(" ").trim();}
    res.push(e);});
  return{sheets:res};}
return{parse,read,readUnitSheets,parseUnitSheets,lines,findHeader};
})();
if(typeof module!=="undefined")module.exports=PKG;
