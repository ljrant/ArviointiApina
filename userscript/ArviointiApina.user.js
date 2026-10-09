// ==UserScript==
// @name         ArviointiApina
// @namespace    https://github.com/ljrant/ArviointiApina
// @version      0.3.0
// @description  Local-first Abitti result collector and weighted course gradebook.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @homepageURL  https://ljrant.github.io/ArviointiApina/
// @supportURL   https://github.com/ljrant/ArviointiApina/issues
// @downloadURL  https://raw.githubusercontent.com/ljrant/ArviointiApina/main/userscript/ArviointiApina.user.js
// @updateURL    https://raw.githubusercontent.com/ljrant/ArviointiApina/main/userscript/ArviointiApina.user.js
// ==/UserScript==

(() => {
  "use strict";

  const KEY="arviointiapina_userscript_v1";
  const FINNISH={"10":90,"9½":85,"9":80,"8½":75,"8":70,"7½":65,"7":60,"6½":55,"6":50,"5½":45,"5":40,"4½":30,"4":0};
  const IB={"7":85,"6":70,"5":55,"4":40,"3":25,"2":10,"1":0};
  const IS_ABITTI=location.hostname==="oma.abitti.fi"&&location.pathname.startsWith("/school/review/");
  const AUTO=.93,SUGGEST=.80;
  const uid=(p="id")=>p+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
  const now=()=>new Date().toISOString();
  const num=v=>{const n=Number(String(v??"").trim().replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:NaN};
  const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim();
  const email=s=>String(s||"").trim().toLowerCase();
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt=(n,d=1)=>Number.isFinite(n)?String(Math.round(n*10**d)/10**d).replace(".",","):"";

  function fresh(){return{version:1,settings:{activeCourseId:null,activeTab:"gradebook"},courses:{}}}
  function load(){try{const raw=GM_getValue(KEY,"");if(!raw)return fresh();const x=typeof raw==="string"?JSON.parse(raw):raw;return{...fresh(),...x,settings:{...fresh().settings,...(x.settings||{})},courses:x.courses||{}}}catch(e){console.error(e);return fresh()}}
  let db=load();
  const save=()=>GM_setValue(KEY,JSON.stringify(db));
  const course=()=>db.courses[db.settings.activeCourseId]||null;

  function createCourse(name){
    const id=uid("course");
    db.courses[id]={id,name:String(name||"New course").trim(),students:{},assessments:{},grading:{system:"finnish",missingPolicy:"redistribute",finnishBoundaries:{...FINNISH},ibBoundaries:{...IB}},createdAt:now(),updatedAt:now()};
    db.settings.activeCourseId=id;save();return db.courses[id];
  }

  function createStudent(c,incoming){
    const id=uid("student"),e=email(incoming.email),n=String(incoming.name||"").trim();
    c.students[id]={id,canonicalName:n||e||"Unnamed student",aliases:[],emails:e?[e]:[],abittiUuids:incoming.uuid?[incoming.uuid]:[],weightingOverrides:{},createdAt:now(),updatedAt:now()};
    return c.students[id];
  }

  function levenshtein(a,b){
    if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
    const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
    for(let i=1;i<=a.length;i++){cur[0]=i;for(let j=1;j<=b.length;j++){const cost=a[i-1]===b[j-1]?0:1;cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost)}for(let j=0;j<=b.length;j++)prev[j]=cur[j]}
    return prev[b.length];
  }

  function similarity(a,b){
    const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 1;
    const edit=1-levenshtein(x,y)/Math.max(x.length,y.length);
    const ax=new Set(x.split(" ").filter(Boolean)),by=new Set(y.split(" ").filter(Boolean));
    const token=[...ax].filter(t=>by.has(t)).length/(new Set([...ax,...by]).size||1);
    const sx=[...ax].sort().join(" "),sy=[...by].sort().join(" ");
    const sorted=1-levenshtein(sx,sy)/Math.max(sx.length,sy.length);
    const contains=(x.includes(y)||y.includes(x))?Math.min(x.length,y.length)/Math.max(x.length,y.length):0;
    return Math.max(edit,token*.96,sorted,contains*.95,edit*.7+token*.3);
  }

  const names=s=>[s.canonicalName,...(s.aliases||[])].filter(Boolean);

  function matchStudent(c,incoming){
    const students=Object.values(c.students||{}),n=norm(incoming.name),e=email(incoming.email),u=String(incoming.uuid||"").trim();

    // 1. Name first: exact then fuzzy/partial.
    if(n){
      for(const s of students)if(names(s).some(x=>norm(x)===n))return{student:s,score:1,method:"exact-name",confirm:false};
      let best=null,second=null;
      for(const s of students){
        let score=0;
        for(const candidate of names(s).filter(x=>norm(x)!=="unnamed student"))score=Math.max(score,similarity(incoming.name,candidate));
        if(!best||score>best.score){second=best;best={student:s,score,method:"fuzzy-name"}}
        else if(!second||score>second.score)second={student:s,score,method:"fuzzy-name"};
      }
      if(best&&best.score>=SUGGEST){
        const gap=second?best.score-second.score:1;
        return{...best,confirm:best.score<AUTO||gap<.05};
      }
    }

    // 2. Email.
    if(e){
      const s=students.find(x=>(x.emails||[]).map(email).includes(e));
      if(s)return{student:s,score:1,method:"email",confirm:false};
    }

    // 3. Abitti UUID only as a last-resort hint.
    if(u){
      const s=students.find(x=>(x.abittiUuids||[]).includes(u));
      if(s)return{student:s,score:.75,method:"uuid-hint",confirm:true};
    }
    return null;
  }

  function attachIdentity(s,incoming){
    s.aliases||=[];s.emails||=[];s.abittiUuids||=[];
    const n=String(incoming.name||"").trim(),e=email(incoming.email),u=String(incoming.uuid||"").trim();
    if(n&&(!s.canonicalName||norm(s.canonicalName)==="unnamed student"))s.canonicalName=n;
    else if(n&&norm(n)!==norm(s.canonicalName)&&!s.aliases.some(a=>norm(a)===norm(n)))s.aliases.push(n);
    if(e&&!s.emails.map(email).includes(e))s.emails.push(e);
    if(u&&!s.abittiUuids.includes(u))s.abittiUuids.push(u);
    s.updatedAt=now();
  }

  function studentNameFromRow(row){
    const cell=row.querySelector(".studentName");if(!cell)return"";
    const source=cell.querySelector(".answerPaperLink")||cell,clone=source.cloneNode(true);
    clone.querySelectorAll("i,svg,img,button").forEach(el=>el.remove());
    return clone.textContent.replace(/\s+/g," ").trim();
  }

  function detectExam(){
    if(!IS_ABITTI)return null;
    const name=document.querySelector("h1.exam-name")?.textContent?.trim()||document.querySelector(".exam-name")?.textContent?.trim()||document.title||"Abitti exam";
    const students=[...document.querySelectorAll("#scoreTable tbody tr.student")].map(row=>{
      const g=row.querySelector(".gradingText");
      return{name:studentNameFromRow(row),email:row.querySelector(".email")?.textContent?.trim()||"",uuid:g?.getAttribute("data-student-uuid")||"",answerPaperId:g?.getAttribute("data-answer-paper-id")||"",points:num(row.querySelector(".totalScore")?.textContent)};
    }).filter(x=>x.name||x.email||x.uuid||Number.isFinite(x.points));
    return{name,reviewPath:location.pathname,students};
  }

  function confirmMatch(incoming,m){
    const detail=m.method==="fuzzy-name"?"Name similarity: "+Math.round(m.score*100)+"%":"Only a historical Abitti UUID matched. UUIDs are not treated as stable.";
    return confirm("Possible student match:\n\nImported: "+(incoming.name||incoming.email||"(unknown)")+"\nExisting: "+m.student.canonicalName+"\n\n"+detail+"\n\nSame student?");
  }

  function importExam(c,examName,maxPoints,weight){
    const detected=detectExam();maxPoints=num(maxPoints);weight=num(weight);
    if(!detected?.students.length)return alert("No Abitti results detected.");
    if(!(maxPoints>0))return alert("Enter a valid maximum score.");
    if(!(weight>=0))return alert("Enter a valid weight.");

    let a=Object.values(c.assessments).find(x=>x.source?.reviewPath===detected.reviewPath)||Object.values(c.assessments).find(x=>x.name.toLowerCase()===examName.toLowerCase());
    if(a){if(!confirm('"'+a.name+'" already exists. Update its results?'))return;a.name=examName;a.maxPoints=maxPoints;a.defaultWeight=weight}
    else{const id=uid("assessment");a=c.assessments[id]={id,name:examName,maxPoints,defaultWeight:weight,type:"exam",source:{type:"abitti",reviewPath:detected.reviewPath},results:{},createdAt:now()}}

    let created=0,matched=0;
    for(const incoming of detected.students){
      let m=matchStudent(c,incoming),s=null;
      if(m){if(!m.confirm||confirmMatch(incoming,m)){s=m.student;matched++}}
      if(!s){s=createStudent(c,incoming);created++}
      attachIdentity(s,incoming);
      a.results[s.id]={points:incoming.points,answerPaperId:incoming.answerPaperId||null,sourceName:incoming.name||"",sourceEmail:incoming.email||"",sourceAbittiUuid:incoming.uuid||"",importedAt:now()};
    }
    c.updatedAt=now();save();render();alert("Import complete.\nMatched: "+matched+"\nNew students: "+created);
  }

  function weightFor(s,a){
    if(Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)){const n=num(s.weightingOverrides[a.id]);return Number.isFinite(n)?Math.max(0,n):0}
    return Math.max(0,num(a.defaultWeight)||0);
  }

  function gradeFor(c,pct){
    const map=c.grading.system==="ib"?c.grading.ibBoundaries:c.grading.finnishBoundaries;
    return Object.entries(map||{}).map(([g,t])=>[g,num(t)]).filter(([,t])=>Number.isFinite(t)).sort((a,b)=>b[1]-a[1]).find(([,t])=>pct>=t)?.[0]||"";
  }

  function calc(c,s){
    let total=0,used=0;
    for(const a of Object.values(c.assessments)){
      const max=num(a.maxPoints),p=num(a.results?.[s.id]?.points),w=weightFor(s,a),has=Number.isFinite(p)&&Number.isFinite(max)&&max>0;
      if(has){total+=(p/max*100)*w;used+=w}else if(c.grading.missingPolicy==="zero")used+=w;
    }
    const pct=used>0?total/used:null;
    return{pct,grade:pct==null?"":gradeFor(c,pct)};
  }

  function csvEscape(v,sep=";"){const s=String(v??"");return s.includes(sep)||/["\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportCSV(c){
    const as=Object.values(c.assessments),head=["Student","Email"];
    for(const a of as)head.push(a.name+" Points",a.name+" Max",a.name+" Weight");
    head.push("Weighted %","Final Grade");const lines=[head.map(csvEscape).join(";")];
    for(const s of Object.values(c.students).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){
      const r=[s.canonicalName,s.emails?.[0]||""],x=calc(c,s);
      for(const a of as)r.push(a.results?.[s.id]?.points??"",a.maxPoints,weightFor(s,a));
      r.push(x.pct==null?"":x.pct.toFixed(2),x.grade);lines.push(r.map(csvEscape).join(";"));
    }
    download(c.name.replace(/[^\w-]+/g,"_")+"_gradebook.csv","\uFEFF"+lines.join("\r\n"),"text/csv;charset=utf-8");
  }
  function backup(){download("arviointiapina-backup-"+new Date().toISOString().slice(0,10)+".json",JSON.stringify({type:"ArviointiApina",database:db},null,2),"application/json;charset=utf-8")}
  function choose(accept,cb){const i=document.createElement("input");i.type="file";i.accept=accept;i.hidden=true;i.onchange=()=>{const f=i.files?.[0];if(f)cb(f);i.remove()};document.body.appendChild(i);i.click()}
  async function restore(file){try{const p=JSON.parse(await file.text()),next=p.database||p;if(!next?.courses)throw new Error("Not a valid backup.");if(!confirm("Replace all current data with this backup?"))return;db={...fresh(),...next,settings:{...fresh().settings,...(next.settings||{})},courses:next.courses||{}};save();render()}catch(e){alert(e.message)}}

  GM_addStyle(`
  #aa-root,#aa-root *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
  #aa-launch{position:fixed;right:12px;bottom:12px;z-index:2147483646;border:0;border-radius:999px;background:#24362f;color:#fff;padding:11px 14px;font-weight:700;cursor:pointer;box-shadow:0 5px 20px #0003}
  #aa-panel{position:fixed;right:10px;top:10px;bottom:10px;width:min(900px,calc(100vw - 20px));z-index:2147483647;background:#fff;color:#172026;border:1px solid #cfd8d4;border-radius:12px;box-shadow:0 18px 50px #0004;display:flex;flex-direction:column;overflow:hidden;font-size:13px}
  #aa-panel.compact{width:340px;top:56px}.aa-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:9px;border-bottom:1px solid #dde4e0;background:#f5f8f6}.aa-title{font-weight:800;margin-right:auto}
  .aa-btn,.aa-input,.aa-select,.aa-area{border:1px solid #bbc8c2;border-radius:7px;background:#fff;color:#172026;padding:6px 8px;font-size:12px}.aa-btn{cursor:pointer}.aa-btn.primary{background:#275d4e;border-color:#275d4e;color:#fff}.aa-btn.danger{color:#9a2626}
  .aa-tabs{display:flex;gap:3px;padding:6px 8px 0;border-bottom:1px solid #dde4e0;background:#fafcfb}.aa-tab{border:0;background:transparent;padding:7px 9px;cursor:pointer}.aa-tab.active{font-weight:700;background:#fff;border:1px solid #dde4e0;border-bottom-color:#fff;border-radius:6px 6px 0 0;margin-bottom:-1px}
  .aa-content{flex:1;overflow:auto;padding:9px}.aa-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.aa-muted{color:#6a7871}.aa-small{font-size:11px}.aa-table-wrap{overflow:auto}
  .aa-table{width:100%;border-collapse:collapse}.aa-table th,.aa-table td{border:1px solid #dde4e0;padding:5px 6px;white-space:nowrap;background:#fff}.aa-table th{position:sticky;top:0;background:#f4f7f5;z-index:2;text-align:left}.aa-table .student{position:sticky;left:0;z-index:1}.aa-table th.student{z-index:3}
  .aa-score{cursor:pointer;text-decoration:underline dotted}.aa-card{border:1px solid #dde4e0;background:#fafcfb;border-radius:9px;padding:9px;margin-bottom:8px}.aa-card h3{margin:0 0 7px;font-size:14px}.aa-area{width:100%;min-height:170px;font-family:ui-monospace,Consolas,monospace}
  .aa-mini{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:6px 2px;border-bottom:1px solid #edf1ef}.aa-mini-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aa-empty{text-align:center;color:#6a7871;padding:25px}
  `);

  let open=IS_ABITTI,compact=!IS_ABITTI,root=null;
  function btn(t,fn,cls=""){const b=document.createElement("button");b.type="button";b.className="aa-btn "+cls;b.textContent=t;b.onclick=fn;return b}
  function ensureRoot(){if(root)return;root=document.createElement("div");root.id="aa-root";const l=document.createElement("button");l.id="aa-launch";l.textContent="Grades";l.onclick=()=>{open=!open;render()};root.appendChild(l);document.body.appendChild(root)}
  function ensureCourse(){if(db.settings.activeCourseId&&db.courses[db.settings.activeCourseId])return;db.settings.activeCourseId=Object.keys(db.courses)[0]||null;save()}

  function render(){
    ensureRoot();ensureCourse();root.querySelector("#aa-panel")?.remove();if(!open)return;
    const p=document.createElement("div");p.id="aa-panel";p.classList.toggle("compact",compact);root.appendChild(p);header(p);
    if(compact)return compactView(p);
    tabs(p);const content=document.createElement("div");content.className="aa-content";p.appendChild(content);const c=course();if(!c)return noCourse(content);
    const tab=db.settings.activeTab;
    if(tab==="assessments")assessments(content,c);else if(tab==="students")students(content,c);else if(tab==="data")data(content,c);else if(tab==="settings")settings(content,c);else gradebook(content,c);
  }

  function header(p){
    const h=document.createElement("div");h.className="aa-head";const title=document.createElement("div");title.className="aa-title";title.textContent="ArviointiApina";h.appendChild(title);
    const s=document.createElement("select");s.className="aa-select";for(const c of Object.values(db.courses).sort((a,b)=>a.name.localeCompare(b.name,"fi"))){const o=document.createElement("option");o.value=c.id;o.textContent=c.name;o.selected=c.id===db.settings.activeCourseId;s.appendChild(o)}s.onchange=()=>{db.settings.activeCourseId=s.value;save();render()};h.appendChild(s);
    h.appendChild(btn("+ Course",()=>{const n=prompt("Course/class name:");if(n?.trim()){createCourse(n);render()}}));
    if(IS_ABITTI)h.appendChild(btn("Import Abitti",importDialog,"primary"));
    h.appendChild(btn(compact?"Full":"Compact",()=>{compact=!compact;render()}));h.appendChild(btn("×",()=>{open=false;render()}));p.appendChild(h);
  }

  function tabs(p){
    const t=document.createElement("div");t.className="aa-tabs";
    for(const [id,label] of [["gradebook","Gradebook"],["assessments","Assessments"],["students","Students"],["data","Data"],["settings","Settings"]]){const b=document.createElement("button");b.className="aa-tab "+(db.settings.activeTab===id?"active":"");b.textContent=label;b.onclick=()=>{db.settings.activeTab=id;save();render()};t.appendChild(b)}p.appendChild(t);
  }

  function noCourse(parent){const d=document.createElement("div");d.className="aa-empty";d.textContent="Create a course before importing results.";d.append(document.createElement("br"),btn("Create course",()=>{const n=prompt("Course/class name:");if(n?.trim()){createCourse(n);render()}},"primary"));parent.appendChild(d)}

  function gradebook(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";const info=document.createElement("span");info.className="aa-muted aa-small";info.textContent=Object.keys(c.students).length+" students · "+Object.keys(c.assessments).length+" assessments";bar.appendChild(info);if(IS_ABITTI)bar.appendChild(btn("Import current exam",importDialog,"primary"));bar.appendChild(btn("Export CSV",()=>exportCSV(c)));parent.appendChild(bar);
    const ss=Object.values(c.students).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi")),as=Object.values(c.assessments);if(!ss.length){const e=document.createElement("div");e.className="aa-empty";e.textContent="No students yet.";return parent.appendChild(e)}
    const wrap=document.createElement("div");wrap.className="aa-table-wrap";const table=document.createElement("table");table.className="aa-table";const thead=document.createElement("thead"),hr=document.createElement("tr");hr.innerHTML='<th class="student">Student</th>';
    for(const a of as){const th=document.createElement("th");th.innerHTML=esc(a.name)+'<div class="aa-muted aa-small">'+a.defaultWeight+'% · max '+a.maxPoints+"</div>";hr.appendChild(th)}hr.insertAdjacentHTML("beforeend","<th>Weighted</th><th>Grade</th><th></th>");thead.appendChild(hr);table.appendChild(thead);const body=document.createElement("tbody");
    for(const s of ss){const x=calc(c,s),tr=document.createElement("tr"),name=document.createElement("td");name.className="student";name.textContent=s.canonicalName;tr.appendChild(name);
      for(const a of as){const td=document.createElement("td"),r=a.results?.[s.id],sp=document.createElement("span");sp.className="aa-score";sp.textContent=r?fmt(num(r.points),2)+"/"+fmt(num(a.maxPoints),2):"—";sp.onclick=()=>editResult(c,s,a);td.appendChild(sp);if(Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)){const b=document.createElement("span");b.className="aa-muted aa-small";b.textContent="  "+weightFor(s,a)+"%";td.appendChild(b)}tr.appendChild(td)}
      const pct=document.createElement("td");pct.textContent=x.pct==null?"—":fmt(x.pct,1)+"%";tr.appendChild(pct);const gt=document.createElement("td");gt.appendChild(btn(x.grade||"—",async()=>{if(x.grade)await navigator.clipboard.writeText(x.grade)}));tr.appendChild(gt);const act=document.createElement("td");act.appendChild(btn("Weights",()=>editWeights(c,s)));tr.appendChild(act);body.appendChild(tr)}
    table.appendChild(body);wrap.appendChild(table);parent.appendChild(wrap);
  }

  function editResult(c,s,a){const current=a.results?.[s.id]?.points??"",v=prompt(s.canonicalName+"\n"+a.name+"\n\nPoints (blank removes result):",current);if(v===null)return;if(!v.trim())delete a.results[s.id];else{const p=num(v);if(!Number.isFinite(p))return alert("Invalid score.");a.results[s.id]={...(a.results[s.id]||{}),points:p,editedAt:now()}}save();render()}
  function editWeights(c,s){const as=Object.values(c.assessments),lines=as.map((a,i)=>(i+1)+". "+a.name+": "+weightFor(s,a)+"%"+(Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)?" [override]":"")),choice=prompt(s.canonicalName+"\n\nSelect assessment number.\nType RESET to clear all overrides.\n\n"+lines.join("\n"));if(choice===null)return;if(choice.trim().toUpperCase()==="RESET"){s.weightingOverrides={};save();return render()}const i=Number(choice)-1;if(!Number.isInteger(i)||i<0||i>=as.length)return alert("Invalid assessment.");const a=as[i],old=Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)?s.weightingOverrides[a.id]:"",v=prompt("Individual weight for "+a.name+".\n0 = exclude. Blank = course default.",old);if(v===null)return;s.weightingOverrides||={};if(!v.trim())delete s.weightingOverrides[a.id];else{const w=num(v);if(!(w>=0))return alert("Invalid weight.");s.weightingOverrides[a.id]=w}save();render()}

  function assessments(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";bar.appendChild(btn("+ Manual assessment",()=>{const n=prompt("Assessment name:");if(!n?.trim())return;const m=num(prompt("Maximum points:","100")),w=num(prompt("Weight %:","0"));if(!(m>0)||!(w>=0))return alert("Invalid maximum or weight.");const id=uid("assessment");c.assessments[id]={id,name:n.trim(),maxPoints:m,defaultWeight:w,type:"manual",source:{type:"manual"},results:{},createdAt:now()};save();render()}));if(IS_ABITTI)bar.appendChild(btn("Import current Abitti exam",importDialog,"primary"));parent.appendChild(bar);
    const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>Assessment</th><th>Max</th><th>Weight %</th><th>Results</th><th></th></tr></thead>";const body=document.createElement("tbody");let total=0;
    for(const a of Object.values(c.assessments)){total+=num(a.defaultWeight)||0;const tr=document.createElement("tr"),n=document.createElement("input"),m=document.createElement("input"),w=document.createElement("input");n.className=m.className=w.className="aa-input";n.value=a.name;m.value=a.maxPoints;w.value=a.defaultWeight;m.style.width=w.style.width="70px";n.onchange=()=>{a.name=n.value.trim()||a.name;save();render()};m.onchange=()=>{const x=num(m.value);if(x>0){a.maxPoints=x;save()}render()};w.onchange=()=>{const x=num(w.value);if(x>=0){a.defaultWeight=x;save()}render()};
      const td1=document.createElement("td"),td2=document.createElement("td"),td3=document.createElement("td"),td4=document.createElement("td"),td5=document.createElement("td");td1.appendChild(n);td2.appendChild(m);td3.appendChild(w);td4.textContent=Object.keys(a.results||{}).length;td5.appendChild(btn("Delete",()=>{if(confirm('Delete "'+a.name+'" and its results?')){delete c.assessments[a.id];for(const s of Object.values(c.students))delete s.weightingOverrides?.[a.id];save();render()}},"danger"));tr.append(td1,td2,td3,td4,td5);body.appendChild(tr)}
    const tr=document.createElement("tr");tr.innerHTML="<td><strong>Total</strong></td><td></td><td><strong>"+fmt(total,1)+"%</strong></td><td colspan='2'>"+(Math.abs(total-100)<.001?"OK":"Weights are normalized when calculating.")+"</td>";body.appendChild(tr);table.appendChild(body);parent.appendChild(table);
  }

  function students(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";bar.appendChild(btn("+ Student",()=>{const n=prompt("Student name:");if(n?.trim()){createStudent(c,{name:n,email:"",uuid:""});save();render()}}));parent.appendChild(bar);
    const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>Student</th><th>Email</th><th>Aliases</th><th>Abitti IDs seen</th><th></th></tr></thead>";const body=document.createElement("tbody");
    for(const s of Object.values(c.students).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){const tr=document.createElement("tr");tr.innerHTML="<td>"+esc(s.canonicalName)+"</td><td>"+esc((s.emails||[]).join(", "))+"</td><td>"+esc((s.aliases||[]).join(", "))+"</td><td>"+(s.abittiUuids||[]).length+"</td>";const td=document.createElement("td");td.appendChild(btn("Edit",()=>{const n=prompt("Canonical student name:",s.canonicalName);if(n?.trim()){if(norm(n)!==norm(s.canonicalName)&&norm(s.canonicalName)!=="unnamed student"){s.aliases||=[];s.aliases.push(s.canonicalName)}s.canonicalName=n.trim()}const a=prompt("Aliases separated by |",(s.aliases||[]).join(" | "));if(a!==null)s.aliases=a.split("|").map(x=>x.trim()).filter(Boolean);save();render()}));td.appendChild(btn("Delete",()=>{if(confirm("Delete "+s.canonicalName+" and all their results?")){delete c.students[s.id];for(const a of Object.values(c.assessments))delete a.results[s.id];save();render()}},"danger"));tr.appendChild(td);body.appendChild(tr)}table.appendChild(body);parent.appendChild(table);
  }

  function data(parent,c){
    const a=document.createElement("div");a.className="aa-card";a.innerHTML="<h3>Course data</h3>";a.appendChild(btn("Export course CSV",()=>exportCSV(c)));parent.appendChild(a);
    const b=document.createElement("div");b.className="aa-card";b.innerHTML="<h3>Full backup</h3><div class='aa-muted aa-small'>JSON preserves all courses, aliases, weights and settings.</div>";b.appendChild(btn("Export JSON backup",backup,"primary"));b.appendChild(btn("Restore JSON backup",()=>choose(".json,application/json",restore)));parent.appendChild(b);
    const d=document.createElement("div");d.className="aa-card";d.innerHTML="<h3>Course management</h3>";d.appendChild(btn("Rename course",()=>{const n=prompt("Course name:",c.name);if(n?.trim()){c.name=n.trim();save();render()}}));d.appendChild(btn("Delete course",()=>{if(confirm('Delete "'+c.name+'" and all its data?')){delete db.courses[c.id];db.settings.activeCourseId=null;save();render()}},"danger"));parent.appendChild(d);
  }

  function settings(parent,c){
    const a=document.createElement("div");a.className="aa-card";a.innerHTML="<h3>Grade calculation</h3>";const sys=document.createElement("select");sys.className="aa-select";sys.innerHTML='<option value="finnish">Finnish 4–10</option><option value="ib">IB 1–7</option>';sys.value=c.grading.system;sys.onchange=()=>{c.grading.system=sys.value;save();render()};const miss=document.createElement("select");miss.className="aa-select";miss.innerHTML='<option value="redistribute">Redistribute missing weight</option><option value="zero">Missing counts as zero</option>';miss.value=c.grading.missingPolicy;miss.onchange=()=>{c.grading.missingPolicy=miss.value;save();render()};a.append("Grading system: ",sys,document.createElement("br"),document.createElement("br"),"Missing result: ",miss);parent.appendChild(a);
    const b=document.createElement("div");b.className="aa-card";b.innerHTML="<h3>Grade boundaries</h3>";const area=document.createElement("textarea");area.className="aa-area";area.value=JSON.stringify(c.grading.system==="ib"?c.grading.ibBoundaries:c.grading.finnishBoundaries,null,2);b.appendChild(area);b.appendChild(btn("Save boundaries",()=>{try{const x=JSON.parse(area.value);for(const v of Object.values(x))if(!Number.isFinite(num(v)))throw new Error("Every threshold must be numeric.");if(c.grading.system==="ib")c.grading.ibBoundaries=x;else c.grading.finnishBoundaries=x;save();render()}catch(e){alert(e.message)}},"primary"));parent.appendChild(b);
  }

  function compactView(p){
    const content=document.createElement("div");content.className="aa-content";p.appendChild(content);const c=course();if(!c)return noCourse(content);const q=document.createElement("input");q.className="aa-input";q.placeholder="Search student...";q.style.width="100%";q.style.marginBottom="7px";content.appendChild(q);const list=document.createElement("div");content.appendChild(list);
    function draw(){list.innerHTML="";const needle=norm(q.value);for(const s of Object.values(c.students).filter(s=>!needle||names(s).some(n=>norm(n).includes(needle))).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){const x=calc(c,s),r=document.createElement("div");r.className="aa-mini";const n=document.createElement("div");n.className="aa-mini-name";n.textContent=s.canonicalName;const p=document.createElement("div");p.className="aa-muted aa-small";p.textContent=x.pct==null?"":fmt(x.pct,1)+"%";r.append(n,p,btn(x.grade||"—",async()=>{if(x.grade)await navigator.clipboard.writeText(x.grade)}));list.appendChild(r)}}q.oninput=draw;draw();
  }

  function importDialog(){
    const detected=detectExam();if(!detected?.students.length)return alert("No Abitti results detected.");if(!detected.students.some(s=>s.name&&norm(s.name)!=="unnamed student"))return alert("Student names could not be detected. Import stopped.");
    let c=course();if(!c){const n=prompt("Create course:",detected.name.split(":")[0].trim());if(!n?.trim())return;c=createCourse(n.trim())}
    const existing=Object.values(c.assessments).find(a=>a.source?.reviewPath===detected.reviewPath),name=prompt("Assessment name:",existing?.name||detected.name);if(!name?.trim())return;const max=prompt("Maximum possible points:",existing?.maxPoints||"");if(max===null)return;const used=Object.values(c.assessments).reduce((s,a)=>s+(num(a.defaultWeight)||0),0),w=prompt("Assessment weight %:",existing?.defaultWeight??Math.max(0,100-used));if(w===null)return;importExam(c,name.trim(),max,w);
  }

  GM_registerMenuCommand("Open ArviointiApina",()=>{open=true;compact=false;render()});
  GM_registerMenuCommand("Open compact grade panel",()=>{open=true;compact=true;render()});
  GM_registerMenuCommand("Export ArviointiApina backup",backup);

  ensureRoot();render();
})();