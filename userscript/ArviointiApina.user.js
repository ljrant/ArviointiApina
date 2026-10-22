// ==UserScript==
// @name         ArviointiApina BETA
// @namespace    https://github.com/ljrant/ArviointiApina
// @version      0.5.0-beta.4
// @description  BETA: OmaAbitti + Google Forms result collector and weighted course gradebook.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// @homepageURL  https://ljrant.github.io/ArviointiApina/
// @supportURL   https://github.com/ljrant/ArviointiApina/issues
// @downloadURL  https://raw.githubusercontent.com/ljrant/ArviointiApina/beta/userscript/ArviointiApina.user.js
// @updateURL    https://raw.githubusercontent.com/ljrant/ArviointiApina/beta/userscript/ArviointiApina.user.js
// ==/UserScript==

(() => {
  "use strict";

  const KEY="arviointiapina_userscript_beta_v1";
  const FINNISH={"10":90,"9½":85,"9":80,"8½":75,"8":70,"7½":65,"7":60,"6½":55,"6":50,"5½":45,"5":40,"4½":30,"4":0};
  const IB={"7":85,"6":70,"5":55,"4":40,"3":25,"2":10,"1":0};
  const IS_ABITTI=location.hostname==="oma.abitti.fi"&&location.pathname.startsWith("/school/review/");
  const IS_GOOGLE_FORMS=location.hostname==="docs.google.com"&&location.pathname.includes("/forms/");
  const AUTO=.93,SUGGEST=.80;
  const uid=(p="id")=>p+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
  const now=()=>new Date().toISOString();
  const num=v=>{const n=Number(String(v??"").trim().replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:NaN};
  const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim();
  const email=s=>String(s||"").trim().toLowerCase();
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt=(n,d=1)=>Number.isFinite(n)?String(Math.round(n*10**d)/10**d).replace(".",","):"";

  function fresh(){return{version:1,settings:{activeCourseId:null,activeTab:"gradebook",panelOpen:null,panelCompact:null},courses:{}}}
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

  function detectMaxPointsFromPage(){
    const labels=[...document.querySelectorAll("td,th")].filter(el=>{
      const t=String(el.textContent||"").replace(/\s+/g," ").trim().toLowerCase();
      return t==="maksimipisteet"||t==="maximum points"||t==="max points";
    });

    for(const label of labels){
      const parent=label.parentElement;
      if(!parent)continue;
      const siblings=[...parent.children].filter(el=>el!==label);
      for(const el of siblings){
        const direct=num(el.matches("input,select,textarea")?el.value:el.textContent);
        if(Number.isFinite(direct)&&direct>0)return{value:direct,source:"labelled-row"};
        for(const input of el.querySelectorAll("input,select,textarea")){
          const v=num(input.value);
          if(Number.isFinite(v)&&v>0)return{value:v,source:"labelled-row-input"};
        }
      }
    }

    const bodyText=String(document.body?.innerText||"").replace(/\s+/g," ");
    const match=bodyText.match(/(?:Maksimipisteet|Maximum points|Max points)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)/i);
    if(match){
      const v=num(match[1]);
      if(Number.isFinite(v)&&v>0)return{value:v,source:"labelled-page-text"};
    }
    return null;
  }


  function parseAnswerPaperMax(doc){
    if(!doc)return null;

    // IMPORTANT:
    // "Yhteensä 44 p." on an individual answer paper is the student's earned
    // total, not the exam's maximum. Never use that value as max points.
    //
    // The maximum is instead calculated from the denominators of OmaAbitti's
    // per-answer score counters, e.g. "0 / 3 p.", "2 / 2 p.", "1 / 1 p.".
    // Only the primary .e-result-scorecount.e-float-right elements are used
    // so wrapper copies are not counted twice.
    let sum=0,count=0;
    const maxima=[];

    for(const el of doc.querySelectorAll(".e-result-scorecount.e-float-right")){
      const text=String(el.textContent||"").replace(/\s+/g," ").trim();
      const m=text.match(/\/\s*(\d+(?:[.,]\d+)?)\s*p\.?/i);
      if(!m)continue;

      const max=num(m[1]);
      if(!Number.isFinite(max)||max<0)continue;

      maxima.push(max);
      sum+=max;
      count++;
    }

    if(count>0&&sum>0){
      return{
        value:sum,
        source:"omaabitti-answer-denominator-sum",
        items:count,
        maxima
      };
    }

    return null;
  }

  function detectMaxPointsFromAnswerPaper(detected){
    return new Promise(resolve=>{
      const href=detected?.answerURL;
      if(!href)return resolve(null);

      const iframe=document.createElement("iframe");
      iframe.setAttribute("aria-hidden","true");
      iframe.tabIndex=-1;
      iframe.style.cssText="position:fixed!important;width:1px!important;height:1px!important;left:-99999px!important;top:-99999px!important;opacity:0!important;pointer-events:none!important;border:0!important;";
      let done=false,timer=null,timeout=null;

      const finish=value=>{
        if(done)return;
        done=true;
        if(timer)clearInterval(timer);
        if(timeout)clearTimeout(timeout);
        iframe.remove();
        resolve(value);
      };

      const inspect=()=>{
        try{
          const doc=iframe.contentDocument;
          if(!doc)return;
          const found=parseAnswerPaperMax(doc);
          if(found)finish(found);
        }catch(_){}
      };

      iframe.addEventListener("load",inspect);
      document.body.appendChild(iframe);
      iframe.src=href;

      timer=setInterval(inspect,250);
      timeout=setTimeout(()=>finish(null),15000);
    });
  }

  async function resolveDetectedMaxPoints(detected){
    // Do not depend on AbixApuri's injected summary-row value.
    // Calculate from a real rendered OmaAbitti answer paper first.
    const answer=await detectMaxPointsFromAnswerPaper(detected);
    if(answer)return answer;

    // Fallback only if the page itself exposes a labelled value.
    const local=detectMaxPointsFromPage();
    return local||null;
  }

  const hasParts=a=>Array.isArray(a?.parts)&&a.parts.length>0;

  function effectiveMax(a){
    if(hasParts(a)){
      return a.parts.reduce((sum,p)=>sum+(num(p.maxPoints)||0),0);
    }
    return num(a.maxPoints);
  }

  function effectiveResult(a,studentId){
    if(!hasParts(a))return a.results?.[studentId]||null;
    let any=false,total=0,completed=0;
    for(const p of a.parts){
      const r=p.results?.[studentId],points=num(r?.points);
      if(Number.isFinite(points)){any=true;total+=points;completed++}
    }
    if(!any)return null;
    return{points:total,completedParts:completed,totalParts:a.parts.length};
  }

  function assessmentResultCount(a){
    if(!hasParts(a))return Object.keys(a.results||{}).length;
    const ids=new Set();
    for(const p of a.parts)for(const id of Object.keys(p.results||{}))ids.add(id);
    return ids.size;
  }

  function ensureParts(a){
    if(hasParts(a))return a.parts;
    const first={
      id:uid("part"),
      name:a.name+" — Part 1",
      maxPoints:num(a.maxPoints)||0,
      source:a.source?{...a.source}:{type:"legacy"},
      results:{...(a.results||{})},
      createdAt:a.createdAt||now(),
      updatedAt:now()
    };
    a.parts=[first];
    a.results={};
    a.source={type:"composite"};
    a.maxPoints=first.maxPoints;
    return a.parts;
  }

  function syncCompositeMax(a){
    if(hasParts(a))a.maxPoints=effectiveMax(a);
  }

  function findReviewTarget(c,reviewPath){
    for(const a of Object.values(c.assessments)){
      if(a.source?.reviewPath===reviewPath)return{assessment:a,part:null};
      if(hasParts(a)){
        const part=a.parts.find(p=>p.source?.reviewPath===reviewPath);
        if(part)return{assessment:a,part};
      }
    }
    return null;
  }

  function detectExam(){
    if(!IS_ABITTI)return null;
    const name=document.querySelector("h1.exam-name")?.textContent?.trim()||document.querySelector(".exam-name")?.textContent?.trim()||document.title||"OmaAbitti exam";
    const students=[...document.querySelectorAll("#scoreTable tbody tr.student")].map(row=>{
      const g=row.querySelector(".gradingText");
      return{name:studentNameFromRow(row),email:row.querySelector(".email")?.textContent?.trim()||"",uuid:g?.getAttribute("data-student-uuid")||"",answerPaperId:g?.getAttribute("data-answer-paper-id")||"",points:num(row.querySelector(".totalScore")?.textContent)};
    }).filter(x=>x.name||x.email||x.uuid||Number.isFinite(x.points));
    const firstAnswer=document.querySelector("#scoreTable .answerPaperLink");
    const answerURL=firstAnswer?.href||firstAnswer?.getAttribute("href")||"";
    return{name,reviewPath:location.pathname,students,answerURL,maxPoints:null,maxSource:null};
  }

  function confirmMatch(incoming,m){
    const detail=m.method==="fuzzy-name"?"Name similarity: "+Math.round(m.score*100)+"%":"Only a historical Abitti UUID matched. UUIDs are not treated as stable.";
    return confirm("Possible student match:\n\nImported: "+(incoming.name||incoming.email||"(unknown)")+"\nExisting: "+m.student.canonicalName+"\n\n"+detail+"\n\nSame student?");
  }


  function matchLabel(m){
    if(!m)return "New student";
    if(m.method==="exact-name")return "Existing: "+m.student.canonicalName+" · exact name";
    if(m.method==="email")return "Existing: "+m.student.canonicalName+" · email";
    if(m.method==="fuzzy-name")return "Possible: "+m.student.canonicalName+" · fuzzy "+Math.round(m.score*100)+"%"+(m.confirm?" · confirm":"");
    return "Possible: "+m.student.canonicalName+" · UUID hint · confirm";
  }

  function chooseImportStudents(c,detected){
    return new Promise(resolve=>{
      const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
      const modal=document.createElement("div");modal.className="aa-modal";
      const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Choose OmaAbitti students to import";
      const body=document.createElement("div");body.className="aa-modal-body";
      const note=document.createElement("div");note.className="aa-muted aa-small";note.textContent="Only checked students will be imported or updated. Unselected existing exam results stay unchanged.";
      body.appendChild(note);

      const controls=document.createElement("div");controls.className="aa-toolbar";
      const existingLabel=document.createElement("label");
      const existingOnly=document.createElement("input");existingOnly.type="checkbox";
      existingLabel.append(existingOnly,document.createTextNode(" Only students already on this course"));
      const rows=[];
      controls.append(existingLabel,btn("Select all",()=>rows.forEach(r=>{if(!r.cb.disabled)r.cb.checked=true})),btn("Select none",()=>rows.forEach(r=>r.cb.checked=false)));
      body.appendChild(controls);

      const wrap=document.createElement("div");wrap.className="aa-table-wrap";
      const table=document.createElement("table");table.className="aa-table aa-import-table";
      table.innerHTML="<thead><tr><th></th><th>OmaAbitti student</th><th>Email</th><th>Points</th><th>Course match</th></tr></thead>";
      const tbody=document.createElement("tbody");

      detected.students.forEach((incoming,index)=>{
        const m=matchStudent(c,incoming);
        const tr=document.createElement("tr");
        const a=document.createElement("td"),b=document.createElement("td"),d=document.createElement("td"),e=document.createElement("td"),g=document.createElement("td");
        const cb=document.createElement("input");cb.type="checkbox";
        const hasScore=Number.isFinite(num(incoming.points));cb.checked=hasScore;cb.disabled=!hasScore;a.appendChild(cb);
        b.textContent=incoming.name||"(no name)";
        d.textContent=incoming.email||"";
        e.textContent=hasScore?fmt(num(incoming.points),2):"—";
        g.textContent=matchLabel(m)+(hasScore?"":" · no score");
        if(!hasScore)tr.classList.add("aa-row-disabled");
        tr.append(a,b,d,e,g);tbody.appendChild(tr);
        rows.push({index,m,cb,tr,status:g,base:matchLabel(m),hasScore});
      });

      const refresh=()=>rows.forEach(r=>{
        const disabled=!r.hasScore||(existingOnly.checked&&!r.m);
        r.cb.disabled=disabled;if(disabled)r.cb.checked=false;
        r.tr.classList.toggle("aa-row-disabled",disabled);
        r.status.textContent=r.base+(existingOnly.checked&&!r.m?" · skipped in existing-only mode":(!r.hasScore?" · no score":""));
      });
      existingOnly.onchange=refresh;

      table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
      const foot=document.createElement("div");foot.className="aa-modal-foot";
      const close=v=>{overlay.remove();resolve(v)};
      foot.append(btn("Cancel",()=>close(null)),btn("Import selected",()=>{
        const selected=rows.filter(r=>r.cb.checked&&!r.cb.disabled).map(r=>r.index);
        if(!selected.length)return alert("Select at least one student.");
        close({selected,existingOnly:existingOnly.checked});
      },"primary"));
      modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);
      overlay.onclick=ev=>{if(ev.target===overlay)close(null)};
    });
  }

  function importSelectedIntoResults(c,results,selected,existingOnly,detected){
    let created=0,matched=0,imported=0,skipped=0,skippedNotOnCourse=0;
    detected.students.forEach((incoming,index)=>{
      if(!selected.has(index))return;
      if(!Number.isFinite(num(incoming.points))){skipped++;return}
      let m=matchStudent(c,incoming),student=null;
      if(m&&(!m.confirm||confirmMatch(incoming,m))){student=m.student;matched++}
      if(!student){
        if(existingOnly){skippedNotOnCourse++;return}
        student=createStudent(c,incoming);created++;
      }
      attachIdentity(student,incoming);
      results[student.id]={points:num(incoming.points),answerPaperId:incoming.answerPaperId||null,sourceName:incoming.name||"",sourceEmail:incoming.email||"",sourceAbittiUuid:incoming.uuid||"",importedAt:now()};
      imported++;
    });
    return{created,matched,imported,skipped,skippedNotOnCourse};
  }

  function importExam(c,examName,maxPoints,weight,selectedIndexes=null,existingOnly=false){
    const detected=detectExam();maxPoints=num(maxPoints);weight=num(weight);
    if(!detected?.students.length)return alert("No OmaAbitti results detected.");
    if(!(maxPoints>0))return alert("Enter a valid maximum score.");
    if(!(weight>=0))return alert("Enter a valid weight.");
    const selected=new Set(Array.isArray(selectedIndexes)?selectedIndexes:detected.students.map((_,i)=>i));

    let a=Object.values(c.assessments).find(x=>x.source?.reviewPath===detected.reviewPath)||Object.values(c.assessments).find(x=>x.name.toLowerCase()===examName.toLowerCase());
    if(a){
      if(!confirm('"'+a.name+'" already exists. Update only the selected students?\n\nUnselected existing results will be kept.'))return;
      a.name=examName;a.maxPoints=maxPoints;a.defaultWeight=weight;a.updatedAt=now();
    }else{
      const id=uid("assessment");
      a=c.assessments[id]={id,name:examName,maxPoints,defaultWeight:weight,type:"exam",source:{type:"omaabitti",reviewPath:detected.reviewPath},results:{},createdAt:now(),updatedAt:now()};
    }

    const stats=importSelectedIntoResults(c,a.results,selected,existingOnly,detected);
    c.updatedAt=now();save();render();
    alert("Import complete.\nImported/updated: "+stats.imported+"\nMatched existing students: "+stats.matched+"\nNew students: "+stats.created+"\nSkipped (not on course): "+stats.skippedNotOnCourse+"\nOther skipped: "+stats.skipped);
  }

  function importExamAsPart(c,a,partName,maxPoints,selectedIndexes=null,existingOnly=false){
    const detected=detectExam();maxPoints=num(maxPoints);
    if(!detected?.students.length)return alert("No OmaAbitti results detected.");
    if(!(maxPoints>0))return alert("Enter a valid maximum score.");
    const selected=new Set(Array.isArray(selectedIndexes)?selectedIndexes:detected.students.map((_,i)=>i));
    const parts=ensureParts(a);
    let part=parts.find(p=>p.source?.reviewPath===detected.reviewPath);
    if(part){
      if(!confirm('"'+part.name+'" is already part of "'+a.name+'". Update only the selected students?'))return;
      part.name=partName;part.maxPoints=maxPoints;part.updatedAt=now();
    }else{
      part={id:uid("part"),name:partName,maxPoints,source:{type:"omaabitti",reviewPath:detected.reviewPath},results:{},createdAt:now(),updatedAt:now()};
      parts.push(part);
    }
    const stats=importSelectedIntoResults(c,part.results,selected,existingOnly,detected);
    syncCompositeMax(a);a.updatedAt=now();c.updatedAt=now();save();render();
    alert("Exam part imported.\nAssessment: "+a.name+"\nPart: "+part.name+"\nCombined max: "+effectiveMax(a)+"\nImported/updated: "+stats.imported+"\nMatched existing students: "+stats.matched+"\nNew students: "+stats.created+"\nSkipped (not on course): "+stats.skippedNotOnCourse);
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
      const max=effectiveMax(a),r=effectiveResult(a,s.id),p=num(r?.points),w=weightFor(s,a),has=Number.isFinite(p)&&Number.isFinite(max)&&max>0;
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
      for(const a of as){const ar=effectiveResult(a,s.id);r.push(ar?.points??"",effectiveMax(a),weightFor(s,a));}
      r.push(x.pct==null?"":x.pct.toFixed(2),x.grade);lines.push(r.map(csvEscape).join(";"));
    }
    download(c.name.replace(/[^\w-]+/g,"_")+"_gradebook.csv","\uFEFF"+lines.join("\r\n"),"text/csv;charset=utf-8");
  }

  function parseDelimited(text){
    text=String(text||"").replace(/^\uFEFF/,"");
    const first=(text.split(/\r?\n/)[0]||"");
    const candidates=[",",";","\t"];
    const counts=candidates.map(sep=>[sep,(first.split(sep).length-1)]);
    const sep=counts.sort((a,b)=>b[1]-a[1])[0][0];

    const rows=[];let row=[],cell="",quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'){
          if(text[i+1]==='"'){cell+='"';i++}
          else quoted=false;
        } else cell+=ch;
        continue;
      }
      if(ch==='"')quoted=true;
      else if(ch===sep){row.push(cell);cell=""}
      else if(ch==="\n"||ch==="\r"){
        if(ch==="\r"&&text[i+1]==="\n")i++;
        row.push(cell);cell="";
        if(row.some(v=>String(v).trim()))rows.push(row);
        row=[];
      } else cell+=ch;
    }
    row.push(cell);
    if(row.some(v=>String(v).trim()))rows.push(row);
    return rows;
  }

  function headerIndex(headers,candidates){
    const normalized=headers.map(h=>norm(h));
    for(const candidate of candidates){
      const target=norm(candidate);
      const exact=normalized.findIndex(h=>h===target);
      if(exact>=0)return exact;
    }
    for(const candidate of candidates){
      const target=norm(candidate);
      const partial=normalized.findIndex(h=>h.includes(target)||target.includes(h));
      if(partial>=0)return partial;
    }
    return -1;
  }

  function parseQuizScore(value){
    const raw=String(value??"").trim();
    if(!raw)return{points:NaN,maxPoints:NaN};

    const slash=raw.match(/(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)/);
    if(slash)return{points:num(slash[1]),maxPoints:num(slash[2])};

    const outOf=raw.match(/(-?\\d+(?:[.,]\\d+)?)\\s*(?:out of|of|pistettä|max(?:imum)?(?: points?)?)\\s*(-?\\d+(?:[.,]\\d+)?)/i);
    if(outOf)return{points:num(outOf[1]),maxPoints:num(outOf[2])};

    return{points:num(raw),maxPoints:NaN};
  }

  async function importGoogleFormsCSV(file){
    const text=await file.text();
    const rows=parseDelimited(text);
    if(rows.length<2)throw new Error("CSV-tiedostossa ei ole vastauksia.");

    const headers=rows.shift().map(v=>String(v||"").trim());
    const nameCol=headerIndex(headers,[
      "Name","Student","Student name","Full name","Nimi","Opiskelija","Oppilas","Nimi ja sukunimi"
    ]);
    const emailCol=headerIndex(headers,[
      "Email Address","Email","E-mail","Sähköposti","Sähköpostiosoite"
    ]);
    const scoreCol=headerIndex(headers,[
      "Score","Quiz score","Points","Total points","Pisteet","Pistemäärä","Kokonaispisteet"
    ]);

    if(scoreCol<0){
      throw new Error('Pistesaraketta ei löytynyt. Odotettu otsikko esimerkiksi "Score", "Points" tai "Pisteet".');
    }
    if(nameCol<0&&emailCol<0){
      throw new Error("Opiskelijan nimeä tai sähköpostisaraketta ei löytynyt.");
    }

    const parsed=rows.map(row=>{
      const score=parseQuizScore(row[scoreCol]);
      return{
        name:nameCol>=0?String(row[nameCol]||"").trim():"",
        email:emailCol>=0?String(row[emailCol]||"").trim():"",
        points:score.points,
        maxPoints:score.maxPoints
      };
    }).filter(x=>(x.name||x.email)&&Number.isFinite(x.points));

    if(!parsed.length)throw new Error("CSV:stä ei löytynyt yhtään tunnistettavaa opiskelijan pistetulosta.");

    const detectedMax=[...new Set(parsed.map(x=>x.maxPoints).filter(Number.isFinite))];
    let maxPoints=detectedMax.length===1?detectedMax[0]:NaN;
    if(!Number.isFinite(maxPoints)||!(maxPoints>0)){
      maxPoints=num(prompt("Google Forms -kyselyn maksimipisteet:", ""));
      if(!(maxPoints>0))throw new Error("Maksimipisteet tarvitaan.");
    }

    let c=course();
    if(!c){
      const courseName=prompt("Luo kurssi / ryhmä:", "Google Forms");
      if(!courseName?.trim())return;
      c=createCourse(courseName.trim());
    }

    const defaultName=String(file.name||"Google Forms quiz").replace(/\.(csv|tsv|txt)$/i,"");
    const assessmentName=prompt("Arvioinnin nimi:", defaultName);
    if(!assessmentName?.trim())return;

    const used=Object.values(c.assessments).reduce((sum,a)=>sum+(num(a.defaultWeight)||0),0);
    const weight=num(prompt("Arvioinnin paino %:", String(Math.max(0,100-used))));
    if(!(weight>=0))throw new Error("Virheellinen paino.");

    let a=Object.values(c.assessments).find(x=>
      x.name.trim().toLowerCase()===assessmentName.trim().toLowerCase()
    );
    if(a){
      if(!confirm('"'+a.name+'" on jo olemassa. Päivitetäänkö tulokset?'))return;
      a.maxPoints=maxPoints;
      a.defaultWeight=weight;
      a.source={type:"google-forms-csv",fileName:file.name||""};
    }else{
      const id=uid("assessment");
      a=c.assessments[id]={
        id,
        name:assessmentName.trim(),
        maxPoints,
        defaultWeight:weight,
        type:"quiz",
        source:{type:"google-forms-csv",fileName:file.name||""},
        results:{},
        createdAt:now()
      };
    }

    let created=0,matched=0,skipped=0;
    for(const incoming of parsed){
      const identity={name:incoming.name,email:incoming.email,uuid:""};
      let m=matchStudent(c,identity),student=null;
      if(m){
        if(!m.confirm||confirmMatch(identity,m)){student=m.student;matched++}
      }
      if(!student){student=createStudent(c,identity);created++}
      attachIdentity(student,identity);

      if(!Number.isFinite(incoming.points)){skipped++;continue}
      a.results[student.id]={
        points:incoming.points,
        sourceName:incoming.name||"",
        sourceEmail:incoming.email||"",
        importedAt:now(),
        sourceType:"google-forms-csv"
      };
    }

    c.updatedAt=now();
    save();
    render();
    alert(
      "Google Forms -tuonti valmis.\n"+
      "Tuloksia: "+parsed.length+"\n"+
      "Yhdistetty olemassa oleviin: "+matched+"\n"+
      "Uusia opiskelijoita: "+created+
      (skipped?"\nOhitettu: "+skipped:"")
    );
  }

  function chooseGoogleFormsCSV(){
    choose(".csv,.tsv,text/csv,text/tab-separated-values",file=>{
      importGoogleFormsCSV(file).catch(error=>alert("Google Forms -tuonti epäonnistui:\n"+error.message));
    });
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
  .aa-mini{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:6px 2px;border-bottom:1px solid #edf1ef}.aa-mini-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aa-empty{text-align:center;color:#6a7871;padding:25px}\n  .aa-modal-overlay{position:fixed;inset:0;z-index:2147483647;background:#0007;display:flex;align-items:center;justify-content:center;padding:18px}\n  .aa-modal{width:min(920px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#172026;border:1px solid #87958f;border-radius:10px;box-shadow:0 18px 60px #0006;overflow:hidden}\n  .aa-modal-head{padding:10px 12px;font-weight:800;border-bottom:1px solid #dde4e0;background:#f5f8f6}.aa-modal-body{padding:10px 12px;overflow:auto}.aa-modal-foot{padding:9px 12px;display:flex;justify-content:flex-end;gap:6px;border-top:1px solid #dde4e0;background:#fafcfb}\n  .aa-import-table td,.aa-import-table th{white-space:normal}.aa-row-disabled{opacity:.48}.aa-result-input{width:85px}\n  `);

  let open=db.settings.panelOpen==null?IS_ABITTI:!!db.settings.panelOpen;
  let compact=db.settings.panelCompact==null?!IS_ABITTI:!!db.settings.panelCompact;
  let root=null;

  // Persist panel state in GM storage so navigation/reloads do not close the gradebook.
  // GM storage belongs to the userscript, so this state follows the user across matched sites.
  if(db.settings.panelOpen==null||db.settings.panelCompact==null){
    db.settings.panelOpen=open;
    db.settings.panelCompact=compact;
    save();
  }

  function setPanelState(nextOpen=open,nextCompact=compact){
    open=!!nextOpen;
    compact=!!nextCompact;
    db.settings.panelOpen=open;
    db.settings.panelCompact=compact;
    save();
  }

  function btn(t,fn,cls=""){const b=document.createElement("button");b.type="button";b.className="aa-btn "+cls;b.textContent=t;b.onclick=fn;return b}
  function ensureRoot(){
    if(root)return;
    root=document.createElement("div");root.id="aa-root";
    const l=document.createElement("button");l.id="aa-launch";l.textContent="Grades";
    l.title="Open/close ArviointiApina gradebook";
    l.onclick=()=>{setPanelState(!open,compact);render()};
    root.appendChild(l);document.body.appendChild(root)
  }
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
    const h=document.createElement("div");h.className="aa-head";const title=document.createElement("div");title.className="aa-title";title.textContent="ArviointiApina BETA";h.appendChild(title);
    const s=document.createElement("select");s.className="aa-select";for(const c of Object.values(db.courses).sort((a,b)=>a.name.localeCompare(b.name,"fi"))){const o=document.createElement("option");o.value=c.id;o.textContent=c.name;o.selected=c.id===db.settings.activeCourseId;s.appendChild(o)}s.onchange=()=>{db.settings.activeCourseId=s.value;save();render()};h.appendChild(s);
    h.appendChild(btn("+ Course",()=>{const n=prompt("Course/class name:");if(n?.trim()){createCourse(n);render()}}));
    if(IS_ABITTI)h.appendChild(btn("Import OmaAbitti",importDialog,"primary"));
    h.appendChild(btn(compact?"Full":"Compact",()=>{setPanelState(true,!compact);render()}));h.appendChild(btn("×",()=>{setPanelState(false,compact);render()}));p.appendChild(h);
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
    for(const a of as){const th=document.createElement("th");th.innerHTML=esc(a.name)+'<div class="aa-muted aa-small">'+a.defaultWeight+'% · max '+effectiveMax(a)+(hasParts(a)?" · "+a.parts.length+" parts":"")+"</div>";hr.appendChild(th)}hr.insertAdjacentHTML("beforeend","<th>Weighted</th><th>Grade</th><th></th>");thead.appendChild(hr);table.appendChild(thead);const body=document.createElement("tbody");
    for(const s of ss){const x=calc(c,s),tr=document.createElement("tr"),name=document.createElement("td");name.className="student";name.textContent=s.canonicalName;tr.appendChild(name);
      for(const a of as){const td=document.createElement("td"),r=effectiveResult(a,s.id),sp=document.createElement("span");sp.className="aa-score";sp.textContent=r?fmt(num(r.points),2)+"/"+fmt(effectiveMax(a),2)+(hasParts(a)?" ("+(r.completedParts||0)+"/"+a.parts.length+" parts)":""):"—";sp.onclick=()=>hasParts(a)?editCompositeStudentResults(c,s,a):editResult(c,s,a);td.appendChild(sp);if(Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)){const b=document.createElement("span");b.className="aa-muted aa-small";b.textContent="  "+weightFor(s,a)+"%";td.appendChild(b)}tr.appendChild(td)}
      const pct=document.createElement("td");pct.textContent=x.pct==null?"—":fmt(x.pct,1)+"%";tr.appendChild(pct);const gt=document.createElement("td");gt.appendChild(btn(x.grade||"—",async()=>{if(x.grade)await navigator.clipboard.writeText(x.grade)}));tr.appendChild(gt);const act=document.createElement("td");act.appendChild(btn("Weights",()=>editWeights(c,s)));tr.appendChild(act);body.appendChild(tr)}
    table.appendChild(body);wrap.appendChild(table);parent.appendChild(wrap);
  }

  function editResult(c,s,a){const current=a.results?.[s.id]?.points??"",v=prompt(s.canonicalName+"\n"+a.name+"\n\nPoints (blank removes result):",current);if(v===null)return;if(!v.trim())delete a.results[s.id];else{const p=num(v);if(!Number.isFinite(p))return alert("Invalid score.");a.results[s.id]={...(a.results[s.id]||{}),points:p,editedAt:now()}}save();render()}
  function editWeights(c,s){const as=Object.values(c.assessments),lines=as.map((a,i)=>(i+1)+". "+a.name+": "+weightFor(s,a)+"%"+(Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)?" [override]":"")),choice=prompt(s.canonicalName+"\n\nSelect assessment number.\nType RESET to clear all overrides.\n\n"+lines.join("\n"));if(choice===null)return;if(choice.trim().toUpperCase()==="RESET"){s.weightingOverrides={};save();return render()}const i=Number(choice)-1;if(!Number.isInteger(i)||i<0||i>=as.length)return alert("Invalid assessment.");const a=as[i],old=Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)?s.weightingOverrides[a.id]:"",v=prompt("Individual weight for "+a.name+".\n0 = exclude. Blank = course default.",old);if(v===null)return;s.weightingOverrides||={};if(!v.trim())delete s.weightingOverrides[a.id];else{const w=num(v);if(!(w>=0))return alert("Invalid weight.");s.weightingOverrides[a.id]=w}save();render()}


  function editCompositeStudentResults(c,st,a){
    const parts=ensureParts(a);
    const lines=parts.map((p,i)=>{
      const value=p.results?.[st.id]?.points;
      return (i+1)+". "+p.name+": "+(value??"—")+" / "+p.maxPoints;
    });
    const choice=prompt(st.canonicalName+"\n"+a.name+"\n\nChoose part number to edit:\n\n"+lines.join("\n"));
    if(choice===null)return;
    const i=Number(choice)-1;
    if(!Number.isInteger(i)||i<0||i>=parts.length)return alert("Invalid part.");
    const p=parts[i],current=p.results?.[st.id]?.points??"";
    const v=prompt(p.name+"\nPoints (blank removes this part result):",current);
    if(v===null)return;
    p.results||={};
    if(!v.trim())delete p.results[st.id];
    else{
      const points=num(v);if(!Number.isFinite(points))return alert("Invalid score.");
      p.results[st.id]={...(p.results[st.id]||{}),points,editedAt:now()};
    }
    p.updatedAt=now();a.updatedAt=now();c.updatedAt=now();save();render();
  }

  function manageCompositeStudents(c,a){
    const parts=ensureParts(a);
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
    const modal=document.createElement("div");modal.className="aa-modal";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Edit students / part results · "+a.name;
    const body=document.createElement("div");body.className="aa-modal-body";
    const wrap=document.createElement("div");wrap.className="aa-table-wrap";
    const table=document.createElement("table");table.className="aa-table";
    const thead=document.createElement("thead"),hr=document.createElement("tr");hr.innerHTML="<th>Student</th>";
    for(const p of parts){const th=document.createElement("th");th.textContent=p.name+" / "+p.maxPoints;hr.appendChild(th)}
    thead.appendChild(hr);table.appendChild(thead);
    const tbody=document.createElement("tbody"),rows=[];
    for(const st of Object.values(c.students).sort((x,y)=>x.canonicalName.localeCompare(y.canonicalName,"fi"))){
      const tr=document.createElement("tr"),name=document.createElement("td");name.textContent=st.canonicalName;tr.appendChild(name);
      const inputs=[];
      for(const p of parts){
        const td=document.createElement("td"),inp=document.createElement("input");inp.className="aa-input aa-result-input";inp.value=p.results?.[st.id]?.points??"";inp.placeholder="blank = no result";td.appendChild(inp);tr.appendChild(td);inputs.push({p,inp});
      }
      tbody.appendChild(tr);rows.push({st,inputs});
    }
    table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
    const foot=document.createElement("div");foot.className="aa-modal-foot";const close=()=>overlay.remove();
    foot.append(btn("Cancel",close),btn("Save results",()=>{
      for(const row of rows){
        for(const item of row.inputs){
          const raw=item.inp.value.trim();item.p.results||={};
          if(!raw){delete item.p.results[row.st.id];continue}
          const points=num(raw);if(!Number.isFinite(points)){alert("Invalid points for "+row.st.canonicalName+" / "+item.p.name);item.inp.focus();return}
          item.p.results[row.st.id]={...(item.p.results[row.st.id]||{}),points,editedAt:now()};
        }
      }
      for(const p of parts)p.updatedAt=now();a.updatedAt=now();c.updatedAt=now();save();close();render();
    },"primary"));
    modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);overlay.onclick=ev=>{if(ev.target===overlay)close()};
  }

  function manageAssessmentParts(c,a){
    const parts=ensureParts(a);
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
    const modal=document.createElement("div");modal.className="aa-modal";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Exam parts · "+a.name;
    const body=document.createElement("div");body.className="aa-modal-body";
    const note=document.createElement("div");note.className="aa-muted aa-small";note.textContent="Each part maximum is editable. The assessment maximum is their sum.";body.appendChild(note);
    const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>Part</th><th>Max</th><th>Results</th><th>Source</th><th></th></tr></thead>";
    const tbody=document.createElement("tbody");
    for(const p of parts){
      const tr=document.createElement("tr"),td1=document.createElement("td"),td2=document.createElement("td"),td3=document.createElement("td"),td4=document.createElement("td"),td5=document.createElement("td");
      const n=document.createElement("input");n.className="aa-input";n.value=p.name;n.onchange=()=>{if(n.value.trim())p.name=n.value.trim()};
      const m=document.createElement("input");m.className="aa-input aa-result-input";m.value=p.maxPoints;
      m.onchange=()=>{const v=num(m.value);if(v>0)p.maxPoints=v;else{alert("Invalid maximum.");m.value=p.maxPoints}syncCompositeMax(a);save();render()};
      td1.appendChild(n);td2.appendChild(m);td3.textContent=Object.keys(p.results||{}).length;td4.textContent=p.source?.reviewPath||p.source?.type||"";
      td5.appendChild(btn("Delete part",()=>{
        if(!confirm('Delete part "'+p.name+'" and all its results?'))return;
        a.parts=a.parts.filter(x=>x.id!==p.id);syncCompositeMax(a);a.updatedAt=now();c.updatedAt=now();save();overlay.remove();render();
      },"danger"));
      tr.append(td1,td2,td3,td4,td5);tbody.appendChild(tr);
    }
    table.appendChild(tbody);body.appendChild(table);
    const foot=document.createElement("div");foot.className="aa-modal-foot";const close=()=>overlay.remove();
    foot.append(btn("Close",()=>{for(const p of a.parts||[])p.updatedAt=now();syncCompositeMax(a);a.updatedAt=now();save();close();render()}));
    modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);overlay.onclick=ev=>{if(ev.target===overlay)close()};
  }

  function manageAssessmentStudents(c,a){
    if(hasParts(a))return manageCompositeStudents(c,a);
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
    const modal=document.createElement("div");modal.className="aa-modal";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Edit students / results · "+a.name;
    const body=document.createElement("div");body.className="aa-modal-body";
    const note=document.createElement("div");note.className="aa-muted aa-small";note.textContent="Unchecking a student removes only this exam result. The student remains on the course.";
    body.appendChild(note);
    const controls=document.createElement("div");controls.className="aa-toolbar";body.appendChild(controls);
    const wrap=document.createElement("div");wrap.className="aa-table-wrap";
    const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>In exam</th><th>Student</th><th>Email</th><th>Points</th></tr></thead>";
    const tbody=document.createElement("tbody"),rows=[];
    for(const st of Object.values(c.students).sort((x,y)=>x.canonicalName.localeCompare(y.canonicalName,"fi"))){
      const r=a.results?.[st.id],tr=document.createElement("tr");
      const td0=document.createElement("td"),td1=document.createElement("td"),td2=document.createElement("td"),td3=document.createElement("td");
      const cb=document.createElement("input");cb.type="checkbox";cb.checked=!!r;td0.appendChild(cb);
      td1.textContent=st.canonicalName;td2.textContent=st.emails?.[0]||"";
      const inp=document.createElement("input");inp.className="aa-input aa-result-input";inp.value=r?.points??"";inp.disabled=!cb.checked;inp.placeholder="0-"+a.maxPoints;td3.appendChild(inp);
      cb.onchange=()=>{inp.disabled=!cb.checked;if(cb.checked&&!inp.value.trim())inp.focus()};
      tr.append(td0,td1,td2,td3);tbody.appendChild(tr);rows.push({st,cb,inp});
    }
    controls.append(btn("Include all",()=>rows.forEach(r=>{r.cb.checked=true;r.inp.disabled=false})),btn("Remove all results",()=>rows.forEach(r=>{r.cb.checked=false;r.inp.disabled=true}),"danger"));
    table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
    const foot=document.createElement("div");foot.className="aa-modal-foot";const close=()=>overlay.remove();
    foot.append(btn("Cancel",close),btn("Save student list",()=>{
      const changes=[];
      for(const r of rows){
        if(!r.cb.checked){changes.push({st:r.st,include:false});continue}
        const points=num(r.inp.value);if(!Number.isFinite(points)){alert("Enter valid points for "+r.st.canonicalName+".");r.inp.focus();return}
        changes.push({st:r.st,include:true,points});
      }
      a.results||={};
      for(const ch of changes){
        if(!ch.include){delete a.results[ch.st.id];continue}
        a.results[ch.st.id]={...(a.results[ch.st.id]||{}),points:ch.points,editedAt:now()};
      }
      a.updatedAt=now();c.updatedAt=now();save();close();render();
    },"primary"));
    modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);overlay.onclick=ev=>{if(ev.target===overlay)close()};
  }


  function assessments(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";
    bar.appendChild(btn("+ Manual assessment",()=>{
      const n=prompt("Assessment name:");if(!n?.trim())return;
      const m=num(prompt("Maximum points:","100")),w=num(prompt("Weight %:","0"));
      if(!(m>0)||!(w>=0))return alert("Invalid maximum or weight.");
      const id=uid("assessment");c.assessments[id]={id,name:n.trim(),maxPoints:m,defaultWeight:w,type:"manual",source:{type:"manual"},results:{},createdAt:now(),updatedAt:now()};save();render();
    }));
    if(IS_ABITTI)bar.appendChild(btn("Import current OmaAbitti exam",importDialog,"primary"));
    parent.appendChild(bar);

    const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>Assessment</th><th>Max</th><th>Weight %</th><th>Results</th><th></th></tr></thead>";
    const body=document.createElement("tbody");let total=0;

    for(const a of Object.values(c.assessments)){
      total+=num(a.defaultWeight)||0;
      const tr=document.createElement("tr"),n=document.createElement("input"),m=document.createElement("input"),w=document.createElement("input");
      n.className=m.className=w.className="aa-input";n.value=a.name;m.value=effectiveMax(a);w.value=a.defaultWeight;m.style.width=w.style.width="70px";if(hasParts(a)){m.readOnly=true;m.title="Combined maximum = sum of part maxima. Edit the parts instead."}
      n.onchange=()=>{a.name=n.value.trim()||a.name;a.updatedAt=now();save();render()};
      m.onchange=()=>{if(hasParts(a))return render();const x=num(m.value);if(x>0){a.maxPoints=x;a.updatedAt=now();save()}render()};
      w.onchange=()=>{const x=num(w.value);if(x>=0){a.defaultWeight=x;a.updatedAt=now();save()}render()};
      const td1=document.createElement("td"),td2=document.createElement("td"),td3=document.createElement("td"),td4=document.createElement("td"),td5=document.createElement("td");
      td1.appendChild(n);td2.appendChild(m);td3.appendChild(w);td4.textContent=assessmentResultCount(a);
      if(hasParts(a))td5.appendChild(btn("Parts ("+a.parts.length+")",()=>manageAssessmentParts(c,a)));
      td5.append(btn("Edit students",()=>manageAssessmentStudents(c,a)),btn("Delete exam",()=>{
        if(!confirm('Delete "'+a.name+'" and all its results?'))return;
        delete c.assessments[a.id];for(const st of Object.values(c.students))delete st.weightingOverrides?.[a.id];c.updatedAt=now();save();render();
      },"danger"));
      tr.append(td1,td2,td3,td4,td5);body.appendChild(tr);
    }

    const tr=document.createElement("tr");tr.innerHTML="<td><strong>Total</strong></td><td></td><td><strong>"+fmt(total,1)+"%</strong></td><td colspan='2'>"+(Math.abs(total-100)<.001?"OK":"Weights are normalized when calculating.")+"</td>";
    body.appendChild(tr);table.appendChild(body);parent.appendChild(table);
  }

  function students(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";bar.appendChild(btn("+ Student",()=>{const n=prompt("Student name:");if(n?.trim()){createStudent(c,{name:n,email:"",uuid:""});save();render()}}));parent.appendChild(bar);
    const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>Student</th><th>Email</th><th>Aliases</th><th>Abitti IDs seen</th><th></th></tr></thead>";const body=document.createElement("tbody");
    for(const s of Object.values(c.students).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){const tr=document.createElement("tr");tr.innerHTML="<td>"+esc(s.canonicalName)+"</td><td>"+esc((s.emails||[]).join(", "))+"</td><td>"+esc((s.aliases||[]).join(", "))+"</td><td>"+(s.abittiUuids||[]).length+"</td>";const td=document.createElement("td");td.appendChild(btn("Edit",()=>{const n=prompt("Canonical student name:",s.canonicalName);if(n?.trim()){if(norm(n)!==norm(s.canonicalName)&&norm(s.canonicalName)!=="unnamed student"){s.aliases||=[];s.aliases.push(s.canonicalName)}s.canonicalName=n.trim()}const a=prompt("Aliases separated by |",(s.aliases||[]).join(" | "));if(a!==null)s.aliases=a.split("|").map(x=>x.trim()).filter(Boolean);save();render()}));td.appendChild(btn("Delete",()=>{if(confirm("Delete "+s.canonicalName+" and all their results?")){delete c.students[s.id];for(const a of Object.values(c.assessments)){delete a.results?.[s.id];for(const p of a.parts||[])delete p.results?.[s.id]}save();render()}},"danger"));tr.appendChild(td);body.appendChild(tr)}table.appendChild(body);parent.appendChild(table);
  }

  function data(parent,c){
    const a=document.createElement("div");a.className="aa-card";a.innerHTML="<h3>Course data</h3>";
    a.appendChild(btn("Import Google Forms CSV (BETA)",chooseGoogleFormsCSV,"primary"));
    a.appendChild(btn("Export course CSV",()=>exportCSV(c)));
    if(IS_GOOGLE_FORMS){
      const hint=document.createElement("div");
      hint.className="aa-muted aa-small";
      hint.style.marginTop="7px";
      hint.textContent="Google Forms -sivu havaittu. Beta käyttää toistaiseksi CSV-vientiä, jotta tuonti ei riipu Googlen muuttuvasta editori-DOM:sta.";
      a.appendChild(hint);
    }
    parent.appendChild(a);
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


  async function importDialog(){
    const detected=detectExam();
    if(!detected?.students.length)return alert("No OmaAbitti results detected.");
    if(!detected.students.some(st=>st.name&&norm(st.name)!=="unnamed student"))return alert("Student names could not be detected. Import stopped.");

    let c=course();
    if(!c){
      const n=prompt("Create course:",detected.name.split(":")[0].trim());
      if(!n?.trim())return;
      c=createCourse(n.trim());
    }

    const maxInfo=await resolveDetectedMaxPoints(detected);
    detected.maxPoints=maxInfo?.value??null;
    detected.maxSource=maxInfo?.source||null;

    const existingTarget=findReviewTarget(c,detected.reviewPath);
    if(existingTarget?.part){
      const part=existingTarget.part,a=existingTarget.assessment;
      const partName=prompt("Exam part name:",part.name);if(!partName?.trim())return;
      const max=prompt((detected.maxPoints?"Maximum possible points (calculated from question maxima):":"Maximum possible points (automatic calculation failed; enter manually):"),part.maxPoints||detected.maxPoints||"");if(max===null)return;
      const selection=await chooseImportStudents(c,detected);if(!selection)return;
      return importExamAsPart(c,a,partName.trim(),max,selection.selected,selection.existingOnly);
    }

    if(existingTarget?.assessment&&!hasParts(existingTarget.assessment)){
      const a=existingTarget.assessment;
      const name=prompt("Assessment name:",a.name);if(!name?.trim())return;
      const max=prompt((detected.maxPoints?"Maximum possible points (calculated from OmaAbitti answer paper):":"Maximum possible points (automatic calculation failed; enter manually):"),a.maxPoints||detected.maxPoints||"");if(max===null)return;
      const w=prompt("Assessment weight %:",a.defaultWeight??0);if(w===null)return;
      const selection=await chooseImportStudents(c,detected);if(!selection)return;
      return importExam(c,name.trim(),max,w,selection.selected,selection.existingOnly);
    }

    const assessments=Object.values(c.assessments);
    let target=null;
    if(assessments.length){
      const lines=assessments.map((a,i)=>(i+1)+". "+a.name+(hasParts(a)?" ("+a.parts.length+" parts)":""));
      const choice=prompt(
        "How should this OmaAbitti exam be added?\n\n"+
        "Type NEW for a new course assessment, or choose an existing assessment number to add it as another exam part.\n\n"+
        lines.join("\n"),
        "NEW"
      );
      if(choice===null)return;
      if(choice.trim().toUpperCase()!=="NEW"){
        const i=Number(choice)-1;
        if(!Number.isInteger(i)||i<0||i>=assessments.length)return alert("Invalid assessment selection.");
        target=assessments[i];
      }
    }

    if(target){
      const partName=prompt("Exam part name:",detected.name);if(!partName?.trim())return;
      const max=prompt((detected.maxPoints?"Maximum possible points (calculated from OmaAbitti answer paper):":"Maximum possible points (automatic calculation failed; enter manually):"),detected.maxPoints||"");if(max===null)return;
      const selection=await chooseImportStudents(c,detected);if(!selection)return;
      return importExamAsPart(c,target,partName.trim(),max,selection.selected,selection.existingOnly);
    }

    const name=prompt("Assessment name:",detected.name);if(!name?.trim())return;
    const max=prompt((detected.maxPoints?"Maximum possible points (calculated from OmaAbitti answer paper):":"Maximum possible points (automatic calculation failed; enter manually):"),detected.maxPoints||"");if(max===null)return;
    const used=Object.values(c.assessments).reduce((sum,a)=>sum+(num(a.defaultWeight)||0),0);
    const w=prompt("Assessment weight %:",Math.max(0,100-used));if(w===null)return;
    const selection=await chooseImportStudents(c,detected);if(!selection)return;
    importExam(c,name.trim(),max,w,selection.selected,selection.existingOnly);
  }

  GM_registerMenuCommand("Open ArviointiApina",()=>{setPanelState(true,false);render()});
  GM_registerMenuCommand("Open compact grade panel",()=>{setPanelState(true,true);render()});
  GM_registerMenuCommand("Import Google Forms quiz CSV (BETA)",chooseGoogleFormsCSV);
  GM_registerMenuCommand("Export ArviointiApina backup",backup);

  ensureRoot();render();
})();