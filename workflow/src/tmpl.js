/* Eversource MASTER Unit Invoice Template reader / filler.
   Works on the original .xlsx (via JSZip) by editing only the cells billing would type into,
   so every formula, style, validation and print setting in the template is kept as-is. */
const TMPL=(function(){
"use strict";
const ZIP=()=>(typeof JSZip!=="undefined"?JSZip:globalThis.JSZip);
const dec=s=>s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi,(m,n)=>String.fromCharCode(parseInt(n,16))).replace(/&amp;/g,"&");
const encX=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"");
const colNum=c=>c.split("").reduce((a,ch)=>a*26+ch.charCodeAt(0)-64,0);
const splitRef=r=>{const m=/^([A-Z]+)(\d+)$/.exec(r);return{col:m[1],row:+m[2]};};
const norm=s=>String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const itemKey=(wt,item)=>norm(wt)+"|"+norm(item);

async function open(buf){
  const zip=await ZIP().loadAsync(buf);
  const wbXml=await zip.file("xl/workbook.xml").async("string");
  const rels=await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const relMap={};rels.replace(/<Relationship\b[^>]*>/g,t=>{const id=/Id="([^"]+)"/.exec(t),tg=/Target="([^"]+)"/.exec(t);if(id&&tg)relMap[id[1]]=tg[1];return t;});
  const sheets={};wbXml.replace(/<sheet\b[^>]*>/g,t=>{const n=/name="([^"]+)"/.exec(t),r=/r:id="([^"]+)"/.exec(t);if(n&&r){let p=relMap[r[1]];p=p.replace(/^\//,"");if(!p.startsWith("xl/"))p="xl/"+p;sheets[dec(n[1])]=p;}return t;});
  let sst=[];const sf=zip.file("xl/sharedStrings.xml");
  if(sf){const x=await sf.async("string");sst=(x.match(/<si>[\s\S]*?<\/si>/g)||[]).map(si=>(si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g)||[]).map(t=>dec(t.replace(/^<t\b[^>]*>|<\/t>$/g,""))).join(""));}
  return{zip,sheets,sst,xml:{}};
}
async function sheetXml(t,name){if(!t.sheets[name])throw new Error('The template has no "'+name+'" tab.');if(t.xml[name]==null)t.xml[name]=await t.zip.file(t.sheets[name]).async("string");return t.xml[name];}
/* values only (cached values for formula cells) */
async function read(t,name){
  const x=await sheetXml(t,name);const out=new Map();
  const re=/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;let m;
  while((m=re.exec(x))){const a=m[1],body=m[2]||"";const r=/\br="([A-Z]+\d+)"/.exec(a);if(!r)continue;const ty=/\bt="([^"]+)"/.exec(a);
    let v=null;const vm=/<v>([\s\S]*?)<\/v>/.exec(body);
    if(ty&&ty[1]==="s"&&vm)v=t.sst[+vm[1]];else if(ty&&ty[1]==="inlineStr"){v=(body.match(/<t\b[^>]*>[\s\S]*?<\/t>/g)||[]).map(s=>dec(s.replace(/^<t\b[^>]*>|<\/t>$/g,""))).join("");}
    else if(ty&&ty[1]==="str"&&vm)v=dec(vm[1]);else if(vm)v=isNaN(+vm[1])?dec(vm[1]):+vm[1];
    out.set(r[1],v);}
  return out;}
async function parse(buf){
  const t=await open(buf);
  const rm=await read(t,"Unit Rate Master");
  const areas=["D","E","F","G"].map(c=>rm.get(c+"3")).filter(Boolean).map(String);
  if(areas.length!==4)throw new Error("Unit Rate Master row 3 should hold the four pricing-area headings in D3:G3.");
  const units=[];
  for(let r=4;r<400;r++){const wt=rm.get("B"+r),it=rm.get("C"+r);if(!wt&&!it){if(r>10&&!rm.get("B"+(r+1)))break;continue;}
    const rates={};areas.forEach((a,i)=>{const v=rm.get("DEFG"[i]+r);rates[a]=typeof v==="number"?v:null;});
    units.push({key:itemKey(wt,it),workType:String(wt).trim(),item:String(it).replace(/\s*\n\s*/g," ").trim(),rates,row:r});}
  const ubd=await read(t,"Unit Billing Detail");
  let per=0;for(let r=4;ubd.get("A"+r)==="P01";r++)per++;
  let slots=0;for(let r=4;ubd.get("A"+r);r+=per)slots++;
  const order=[];for(let r=4;r<4+per;r++)order.push(itemKey(ubd.get("G"+r),ubd.get("H"+r)));
  const missing=order.filter(k=>!units.some(u=>u.key===k));
  if(missing.length)throw new Error("Unit Billing Detail lists units that are not on the Unit Rate Master: "+missing.join(", "));
  const pr=await read(t,"Pole Register");let regRows=0;for(let r=4;pr.has("A"+r)&&pr.get("A"+r)!==""&&pr.get("A"+r)!=null;r++)regRows++;
  const cover=await read(t,"Invoice Cover");
  const from=["A1","A2","A3","A4","A5","A6","A7","A8","A9"].map(c=>cover.get(c)).filter(v=>v!=null&&v!=="").map(String);
  const fi=await read(t,"Final Invoice");
  return{areas,units,layout:{perPole:per,slots:Math.min(slots,regRows||slots),ubdOrder:order},from,terms:fi.get("B7")?String(fi.get("B7")):"",customer:fi.get("F5")?String(fi.get("F5")):""};
}
function setCellXml(x,ref,val){
  const {row}=splitRef(ref);
  const cellXml=(attrs)=>{const s=/\bs="(\d+)"/.exec(attrs||"");const sa=s?' s="'+s[1]+'"':"";
    if(val==null||val==="")return'<c r="'+ref+'"'+sa+"/>";
    if(typeof val==="number"&&isFinite(val))return'<c r="'+ref+'"'+sa+"><v>"+String(val)+"</v></c>";
    return'<c r="'+ref+'"'+sa+' t="inlineStr"><is><t xml:space="preserve">'+encX(val)+"</t></is></c>";};
  const cre=new RegExp('<c r="'+ref+'"(\\s[^>]*?)?(?:/>|>[\\s\\S]*?</c>)');
  if(cre.test(x))return x.replace(cre,(m,a)=>{if(/<f[\s>]/.test(m))throw new Error("Template cell "+ref+" holds a formula and was not overwritten.");return cellXml(a);});
  const rre=new RegExp('<row r="'+row+'"(\\s[^>]*?)?(/>|>([\\s\\S]*?)</row>)');
  const rm=rre.exec(x);
  if(rm){if(rm[2]==="/>")return x.replace(rm[0],'<row r="'+row+'"'+(rm[1]||"")+">"+cellXml("")+"</row>");
    const inner=rm[3];const cells=inner.match(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)||[];
    const myCol=colNum(splitRef(ref).col);let pos=inner.length;let acc=0;
    for(const c of cells){const cc=colNum(/<c r="([A-Z]+)/.exec(c)[1]);const at=inner.indexOf(c,acc);if(cc>myCol){pos=at;break;}acc=at+c.length;}
    const ni=inner.slice(0,pos)+cellXml("")+inner.slice(pos);
    return x.replace(rm[0],'<row r="'+row+'"'+(rm[1]||"")+">"+ni+"</row>");}
  const rows=[...x.matchAll(/<row r="(\d+)"/g)];let insAt=x.indexOf("</sheetData>");
  for(const r of rows){if(+r[1]>row){insAt=r.index;break;}}
  return x.slice(0,insAt)+'<row r="'+row+'">'+cellXml("")+"</row>"+x.slice(insAt);
}
/* inv: {no,dateText,po,period,packageName,customer,poles:[{town,street,esPole,woJob,area,gfBy,gfDate,billDate,notes,ticket,vzPole,qty:{unitKey:{qty,note}}}]} */
async function fill(buf,inv){
  const p=await parse(buf);const t=await open(buf);
  if(inv.poles.length>p.layout.slots)throw new Error("This template has "+p.layout.slots+" pole slots; the invoice has "+inv.poles.length+" poles. Split it into smaller invoices.");
  let pr=await sheetXml(t,"Pole Register"),ub=await sheetXml(t,"Unit Billing Detail"),fi=await sheetXml(t,"Final Invoice"),co=await sheetXml(t,"Invoice Cover");
  inv.poles.forEach((pl,i)=>{const r=4+i;
    const set=(c,v)=>{pr=setCellXml(pr,c+r,v);};
    set("B",pl.town);set("C",pl.street);set("D",pl.esPole);set("E",pl.woJob);set("F","COMPLETE");set("G","APPROVED FOR BILLING");set("H",pl.gfBy);set("I",pl.gfDate);
    set("J",pl.area);set("M","APPROVED FOR INVOICE");set("N",pl.billDate);set("O",pl.notes||"");set("P",pl.ticket);set("Q",pl.vzPole);
    const base=4+i*p.layout.perPole;
    Object.keys(pl.qty).forEach(k=>{const idx=p.layout.ubdOrder.indexOf(k);if(idx<0)throw new Error("Unit "+k+" is not in the template's Unit Billing Detail.");
      ub=setCellXml(ub,"I"+(base+idx),Number(pl.qty[k].qty));if(pl.qty[k].note)ub=setCellXml(ub,"J"+(base+idx),pl.qty[k].note);});
  });
  fi=setCellXml(fi,"B5",inv.no);fi=setCellXml(fi,"B6",inv.dateText);if(inv.packageName)fi=setCellXml(fi,"F7",inv.packageName);
  if(inv.po)co=setCellXml(co,"F8",inv.po);if(inv.period)co=setCellXml(co,"F9",inv.period);
  t.zip.file(t.sheets["Pole Register"],pr);t.zip.file(t.sheets["Unit Billing Detail"],ub);t.zip.file(t.sheets["Final Invoice"],fi);t.zip.file(t.sheets["Invoice Cover"],co);
  let wb=await t.zip.file("xl/workbook.xml").async("string");
  if(/<calcPr\b/.test(wb))wb=wb.replace(/<calcPr\b([^>]*?)(\/?)>/,(m,a,s)=>"<calcPr"+a.replace(/\s*fullCalcOnLoad="[^"]*"/,"")+' fullCalcOnLoad="1"'+s+">");
  else wb=wb.replace("</workbook>",'<calcPr fullCalcOnLoad="1"/></workbook>');
  t.zip.file("xl/workbook.xml",wb);
  if(t.zip.file("xl/calcChain.xml")){t.zip.remove("xl/calcChain.xml");
    let ct=await t.zip.file("[Content_Types].xml").async("string");ct=ct.replace(/<Override[^>]*calcChain[^>]*\/>/,"");t.zip.file("[Content_Types].xml",ct);
    let wr=await t.zip.file("xl/_rels/workbook.xml.rels").async("string");wr=wr.replace(/<Relationship[^>]*calcChain[^>]*\/>/,"");t.zip.file("xl/_rels/workbook.xml.rels",wr);}
  return t.zip.generateAsync({type:"uint8array",compression:"DEFLATE",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
return{parse,fill,itemKey,norm};
})();
if(typeof module!=="undefined")module.exports=TMPL;
