// ==UserScript==
// @name         ArviointiApina BETA
// @namespace    https://github.com/ljrant/ArviointiApina
// @version      0.13.0-beta.1
// @description  BETA: OmaAbitti + Google Forms result collector and weighted course gradebook.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @connect      oma.abitti.fi
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
  const APP_VERSION="0.13.0-beta.1";
  const APP_NAME="ArviointiApina BETA";
  const FINNISH={"10":90,"9½":85,"9":80,"8½":75,"8":70,"7½":65,"7":60,"6½":55,"6":50,"5½":45,"5":40,"4½":30,"4":0};
  const IB={"7":85,"6":70,"5":55,"4":40,"3":25,"2":10,"1":0};
  const GRADE_PRESETS={
    finnish:{name:"Finnish 4–10",system:"finnish",passGrade:"5",passThreshold:40,boundaries:{...FINNISH}},
    ib:{name:"IB 1–7",system:"ib",passGrade:"4",passThreshold:40,boundaries:{...IB}},
    pass50:{name:"Pass / Fail",system:"custom",passGrade:"Pass",passThreshold:50,boundaries:{"Pass":50,"Fail":0}}
  };
  const IS_ABITTI=location.hostname==="oma.abitti.fi"&&location.pathname.startsWith("/school/review/");
  const IS_GRADING_LIST=location.hostname==="oma.abitti.fi"&&/^\/school\/grading\/?$/.test(location.pathname);
  const IS_GOOGLE_FORMS=location.hostname==="docs.google.com"&&location.pathname.includes("/forms/");
  const AUTO=.93,SUGGEST=.80;
  const uid=(p="id")=>p+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
  const now=()=>new Date().toISOString();
  const num=v=>{const n=Number(String(v??"").trim().replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:NaN};
  const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim();
  const email=s=>String(s||"").trim().toLowerCase();
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt=(n,d=1)=>Number.isFinite(n)?String(Math.round(n*10**d)/10**d).replace(".",","):"";

  function gmRequest(url,responseType="text"){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:"GET",
        url,
        responseType,
        withCredentials:true,
        onload:r=>{
          if(r.status>=200&&r.status<300)resolve(r.responseType==="json"?r.response:r.responseText);
          else reject(new Error("HTTP "+r.status));
        },
        onerror:()=>reject(new Error("Network request failed"))
      });
    });
  }

  async function abittiJson(path){
    if(location.hostname==="oma.abitti.fi"){
      const r=await fetch(path,{credentials:"same-origin"});
      if(!r.ok)throw new Error("HTTP "+r.status);
      return r.json();
    }
    return gmRequest("https://oma.abitti.fi"+path,"json");
  }


  function fresh(){return{version:1,settings:{activeCourseId:null,activeTab:"gradebook",panelOpen:null,panelCompact:null,gradingListSort:"date-desc",gradingListSchoolYear:null,gradingListNameFilter:"",gradingManagerCollapsed:false,launcherDocked:false},courses:{}}}
  function load(){try{const raw=GM_getValue(KEY,"");if(!raw)return fresh();const x=typeof raw==="string"?JSON.parse(raw):raw;return{...fresh(),...x,settings:{...fresh().settings,...(x.settings||{})},courses:x.courses||{}}}catch(e){console.error(e);return fresh()}}
  let db=load();
  const save=()=>GM_setValue(KEY,JSON.stringify(db));
  const course=()=>db.courses[db.settings.activeCourseId]||null;

  function validateBoundaries(boundaries){
    if(!boundaries||typeof boundaries!=="object"||Array.isArray(boundaries))throw new Error("Grade boundaries must be an object.");
    const entries=Object.entries(boundaries);
    if(!entries.length)throw new Error("At least one grade boundary is required.");
    const out={};
    for(const [grade,threshold] of entries){
      const label=String(grade||"").trim(),value=num(threshold);
      if(!label)throw new Error("Every grade needs a label.");
      if(!Number.isFinite(value)||value<0||value>100)throw new Error("Every threshold must be between 0 and 100.");
      out[label]=value;
    }
    return out;
  }

  function inferredPassGrade(boundaries){
    const entries=Object.entries(boundaries||{}).map(([g,t])=>[g,num(t)]).filter(([,t])=>Number.isFinite(t)&&t>0).sort((a,b)=>a[1]-b[1]);
    return entries[0]?.[0]||Object.keys(boundaries||{})[0]||"";
  }

  function passThresholdForCourse(c){
    const map=currentBoundaries(c),key=c?.grading?.presetKey;
    const preset=GRADE_PRESETS[key];
    const grade=preset?.passGrade||c?.grading?.passGrade||inferredPassGrade(map);
    const v=num(map?.[grade]);
    return Number.isFinite(v)?v:50;
  }

  function adjustBoundariesToPass(boundaries,passGrade,newPass){
    const original=validateBoundaries(boundaries);
    const oldPass=num(original[passGrade]);
    if(!Number.isFinite(oldPass)||oldPass<=0||oldPass>=100)throw new Error("A pass reference grade could not be determined.");
    const target=Math.max(0,Math.min(100,num(newPass)));
    if(!Number.isFinite(target))throw new Error("Invalid pass percentage.");
    const out={};
    for(const [grade,raw] of Object.entries(original)){
      const t=num(raw);
      let v;
      if(t<=oldPass)v=oldPass===0?t:(t/oldPass)*target;
      else v=target+((t-oldPass)/(100-oldPass))*(100-target);
      out[grade]=Math.round(v*100)/100;
    }
    out[passGrade]=target;
    return out;
  }

  function presetForCourse(c){
    const g=c?.grading||{};
    for(const [key,preset] of Object.entries(GRADE_PRESETS)){
      if(g.system!==preset.system)continue;
      const current=JSON.stringify(currentBoundaries(c));
      if(current===JSON.stringify(preset.boundaries))return key;
    }
    return "custom";
  }

  function currentBoundaries(c){
    const g=c?.grading||{};
    if(g.system==="ib")return g.ibBoundaries||IB;
    if(g.system==="custom")return g.customBoundaries||{};
    return g.finnishBoundaries||FINNISH;
  }

  function applyGradePreset(c,key){
    const preset=GRADE_PRESETS[key];
    if(!preset)return;
    c.grading.system=preset.system;
    c.grading.presetKey=key;
    if(preset.system==="finnish")c.grading.finnishBoundaries={...preset.boundaries};
    else if(preset.system==="ib")c.grading.ibBoundaries={...preset.boundaries};
    else c.grading.customBoundaries={...preset.boundaries};
    c.grading.customName=preset.name;
    c.grading.passGrade=preset.passGrade||inferredPassGrade(preset.boundaries);
  }

  function createCourse(name,options={}){
    const id=uid("course");
    const presetKey=options.presetKey&&GRADE_PRESETS[options.presetKey]?options.presetKey:"finnish";
    const preset=GRADE_PRESETS[presetKey];
    db.courses[id]={
      id,
      name:String(name||"New course").trim(),
      students:{},
      detachedStudents:{},
      assessments:{},
      grading:{
        system:preset.system,
        presetKey,
        missingPolicy:options.missingPolicy==="zero"?"zero":"redistribute",
        finnishBoundaries:{...FINNISH},
        ibBoundaries:{...IB},
        customBoundaries:preset.system==="custom"?{...preset.boundaries}:{},
        customName:preset.name,
        passGrade:preset.passGrade||inferredPassGrade(preset.boundaries)
      },
      createdAt:now(),
      updatedAt:now()
    };
    if(options.boundaries){
      const custom=validateBoundaries(options.boundaries);
      db.courses[id].grading.system="custom";
      db.courses[id].grading.presetKey="custom";
      db.courses[id].grading.customBoundaries=custom;
      db.courses[id].grading.customName=options.customName||"Custom";
      db.courses[id].grading.passGrade=inferredPassGrade(custom);
    }
    db.settings.activeCourseId=id;save();return db.courses[id];
  }

  function createCourseDialog(defaultName=""){
    return new Promise(resolve=>{
      const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
      const modal=document.createElement("div");modal.className="aa-modal";
      const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Create course";
      const body=document.createElement("div");body.className="aa-modal-body";

      const form=document.createElement("div");form.className="aa-course-form";
      const nameLabel=document.createElement("label");nameLabel.textContent="Course name";
      const name=document.createElement("input");name.className="aa-input";name.value=defaultName;name.placeholder="e.g. BIO HL";
      nameLabel.appendChild(name);

      const presetLabel=document.createElement("label");presetLabel.textContent="Grading / grade boundaries";
      const preset=document.createElement("select");preset.className="aa-select";
      for(const [key,p] of Object.entries(GRADE_PRESETS)){const o=document.createElement("option");o.value=key;o.textContent=p.name;preset.appendChild(o)}
      const customOption=document.createElement("option");customOption.value="custom";customOption.textContent="Custom";preset.appendChild(customOption);
      presetLabel.appendChild(preset);

      const missingLabel=document.createElement("label");missingLabel.textContent="Missing assessment result";
      const missing=document.createElement("select");missing.className="aa-select";
      missing.innerHTML='<option value="redistribute">Redistribute missing weight</option><option value="zero">Missing counts as zero</option>';
      missingLabel.appendChild(missing);

      const passLabel=document.createElement("label");passLabel.textContent="Pass threshold %";
      const passRow=document.createElement("div");passRow.className="aa-pass-row";
      const passSlider=document.createElement("input");passSlider.type="range";passSlider.min="0";passSlider.max="100";passSlider.step="1";
      const passNumber=document.createElement("input");passNumber.type="number";passNumber.min="0";passNumber.max="100";passNumber.step="1";passNumber.className="aa-input aa-pass-number";
      passRow.append(passSlider,passNumber);passLabel.appendChild(passRow);

      const boundaryLabel=document.createElement("label");boundaryLabel.textContent="Grade boundaries (%)";
      const area=document.createElement("textarea");area.className="aa-area aa-boundary-area";boundaryLabel.appendChild(area);

      const importRow=document.createElement("div");importRow.className="aa-toolbar";
      const importBtn=btn("Import boundary JSON",()=>choose(".json,application/json",async file=>{
        try{
          const parsed=JSON.parse(await file.text());
          const boundaries=validateBoundaries(parsed.boundaries||parsed);
          area.value=JSON.stringify(boundaries,null,2);
          preset.value="custom";
        }catch(e){alert("Could not import grade boundaries: "+e.message)}
      }));
      importRow.appendChild(importBtn);

      const refresh=()=>{
        const p=preset.value==="custom"?null:GRADE_PRESETS[preset.value];
        if(preset.value==="custom"){
          if(!area.value.trim())area.value=JSON.stringify(GRADE_PRESETS.finnish.boundaries,null,2);
        }else area.value=JSON.stringify(p.boundaries,null,2);
        let boundaries={};
        try{boundaries=validateBoundaries(JSON.parse(area.value))}catch(_){}
        const passGrade=p?.passGrade||inferredPassGrade(boundaries);
        const threshold=num(boundaries?.[passGrade]);
        const pass=Number.isFinite(threshold)?threshold:(p?.passThreshold??50);
        passSlider.value=String(Math.round(pass));passNumber.value=String(Math.round(pass));
      };
      const applyPass=value=>{
        try{
          const boundaries=validateBoundaries(JSON.parse(area.value));
          const p=preset.value==="custom"?null:GRADE_PRESETS[preset.value];
          const passGrade=p?.passGrade||inferredPassGrade(boundaries);
          const adjusted=adjustBoundariesToPass(boundaries,passGrade,value);
          area.value=JSON.stringify(adjusted,null,2);
          preset.value="custom";
          passSlider.value=String(value);passNumber.value=String(value);
        }catch(e){alert("Could not adjust pass threshold: "+e.message)}
      };
      passSlider.oninput=()=>{passNumber.value=passSlider.value};
      passSlider.onchange=()=>applyPass(num(passSlider.value));
      passNumber.onchange=()=>{const v=Math.max(0,Math.min(100,num(passNumber.value)));passSlider.value=String(v);applyPass(v)};
      preset.onchange=refresh;refresh();
      form.append(nameLabel,presetLabel,missingLabel,passLabel,boundaryLabel,importRow);body.appendChild(form);

      const foot=document.createElement("div");foot.className="aa-modal-foot";
      const close=v=>{overlay.remove();resolve(v)};
      foot.append(btn("Cancel",()=>close(null)),btn("Create course",()=>{
        if(!name.value.trim())return alert("Enter a course name.");
        try{
          const boundaries=validateBoundaries(JSON.parse(area.value));
          const selectedPreset=preset.value;
          let c;
          if(selectedPreset!=="custom"&&JSON.stringify(boundaries)===JSON.stringify(GRADE_PRESETS[selectedPreset].boundaries)){
            c=createCourse(name.value.trim(),{presetKey:selectedPreset,missingPolicy:missing.value});
          }else{
            c=createCourse(name.value.trim(),{presetKey:"finnish",missingPolicy:missing.value,boundaries,customName:selectedPreset==="custom"?"Custom":GRADE_PRESETS[selectedPreset]?.name+" (edited)"});
          }
          close(c);
        }catch(e){alert("Invalid grade boundaries: "+e.message)}
      },"primary"));
      modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);name.focus();
      overlay.onclick=ev=>{if(ev.target===overlay)close(null)};
    });
  }

  function createStudent(c,incoming){
    const id=uid("student"),e=email(incoming.email),n=String(incoming.name||"").trim();
    c.students[id]={id,canonicalName:n||e||"Unnamed student",aliases:[],emails:e?[e]:[],abittiUuids:incoming.uuid?[incoming.uuid]:[],weightingOverrides:{},createdAt:now(),updatedAt:now()};
    return c.students[id];
  }

  function ensureStudentPools(c){c.students||={};c.detachedStudents||={}}
  function allKnownStudents(c){ensureStudentPools(c);return{...c.detachedStudents,...c.students}}
  function isStudentOnCourse(c,id){return !!c.students?.[id]}
  function activateStudent(c,st){ensureStudentPools(c);if(!st)return null;delete c.detachedStudents[st.id];c.students[st.id]=st;st.updatedAt=now();c.updatedAt=now();return st}
  function detachStudent(c,id){ensureStudentPools(c);const st=c.students[id];if(!st)return;delete c.students[id];c.detachedStudents[id]=st;st.updatedAt=now();c.updatedAt=now()}
  function deleteStudentPermanently(c,id){ensureStudentPools(c);delete c.students[id];delete c.detachedStudents[id];for(const a of Object.values(c.assessments||{})){delete a.results?.[id];for(const p of a.parts||[])delete p.results?.[id]}c.updatedAt=now()}
  function studentHasAssessmentResult(a,id){return hasParts(a)?a.parts.some(p=>Object.prototype.hasOwnProperty.call(p.results||{},id)):Object.prototype.hasOwnProperty.call(a.results||{},id)}
  function removeStudentFromAssessment(a,id){delete a.results?.[id];for(const p of a.parts||[])delete p.results?.[id];a.updatedAt=now()}

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
    const students=Object.values(allKnownStudents(c)),n=norm(incoming.name),e=email(incoming.email),u=String(incoming.uuid||"").trim();

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

  function detectedExamFromReviewDocument(doc,reviewPath,titleFallback="OmaAbitti exam"){
    if(!doc)return null;
    const name=doc.querySelector("h1.exam-name")?.textContent?.trim()||doc.querySelector(".exam-name")?.textContent?.trim()||titleFallback;
    const students=[...doc.querySelectorAll("#scoreTable tbody tr.student")].map(row=>{
      const g=row.querySelector(".gradingText");
      const cell=row.querySelector(".studentName");
      let studentName="";
      if(cell){
        const source=cell.querySelector(".answerPaperLink")||cell,clone=source.cloneNode(true);
        clone.querySelectorAll("i,svg,img,button").forEach(el=>el.remove());
        studentName=clone.textContent.replace(/\s+/g," ").trim();
      }
      return{
        name:studentName,
        email:row.querySelector(".email")?.textContent?.trim()||"",
        uuid:g?.getAttribute("data-student-uuid")||"",
        answerPaperId:g?.getAttribute("data-answer-paper-id")||"",
        points:num(row.querySelector(".totalScore")?.textContent)
      };
    }).filter(x=>x.name||x.email||x.uuid||Number.isFinite(x.points));
    const firstAnswer=doc.querySelector("#scoreTable .answerPaperLink");
    const href=firstAnswer?.getAttribute("href")||"";
    const answerURL=href?new URL(href,location.origin).href:"";
    return{name,reviewPath,students,answerURL,maxPoints:null,maxSource:null};
  }

  function loadRenderedSameOriginPage(url,readySelector,timeoutMs=15000){
    return new Promise(resolve=>{
      const iframe=document.createElement("iframe");
      iframe.setAttribute("aria-hidden","true");iframe.tabIndex=-1;
      iframe.style.cssText="position:fixed!important;width:1px!important;height:1px!important;left:-99999px!important;top:-99999px!important;opacity:0!important;pointer-events:none!important;border:0!important;";
      let done=false,timer=null,timeout=null;
      const finish=value=>{
        if(done)return;done=true;
        if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);
        iframe.remove();resolve(value);
      };
      const inspect=()=>{
        try{
          const doc=iframe.contentDocument;
          if(doc&&(!readySelector||doc.querySelector(readySelector)))finish(doc.cloneNode(true));
        }catch(_){}
      };
      iframe.addEventListener("load",inspect);
      document.body.appendChild(iframe);iframe.src=url;
      timer=setInterval(inspect,250);
      timeout=setTimeout(()=>finish(null),timeoutMs);
    });
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

  function partEffect(p){const x=num(p?.effect);return Number.isFinite(x)&&x>=0?x:1}

  function effectiveMax(a){
    if(hasParts(a)){
      return a.parts.reduce((sum,p)=>sum+(num(p.maxPoints)||0)*partEffect(p),0);
    }
    return num(a.maxPoints);
  }

  function effectiveResult(a,studentId){
    if(!hasParts(a))return a.results?.[studentId]||null;
    let any=false,total=0,completed=0;
    for(const p of a.parts){
      const r=p.results?.[studentId],points=num(r?.points);
      if(Number.isFinite(points)){any=true;total+=points*partEffect(p);completed++}
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

  function isPhantomCompositePart(a,p){
    return !!p
      && p.source?.type==="composite"
      && (num(p.maxPoints)||0)===0
      && Object.keys(p.results||{}).length===0
      && (p.name===a.name+" — Part 1"||/\s—\sPart 1$/.test(String(p.name||"")));
  }

  function ensureParts(a){
    if(Array.isArray(a.parts)){
      // Remove the placeholder created by older beta builds for an empty
      // composite assessment. Real imported parts have their own OmaAbitti
      // source and are preserved.
      a.parts=a.parts.filter(p=>!isPhantomCompositePart(a,p));
      return a.parts;
    }

    // Legacy single-exam assessment: migrate the real exam into Part 1 only
    // when a multipart assessment is actually requested.
    const first={
      id:uid("part"),
      name:a.name+" — Part 1",
      maxPoints:num(a.maxPoints)||0,
      effect:1,
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

  function cleanupPhantomCompositeParts(){
    let changed=false;
    for(const c of Object.values(db.courses||{})){
      for(const a of Object.values(c.assessments||{})){
        if(!Array.isArray(a.parts))continue;
        const before=a.parts.length;
        a.parts=a.parts.filter(p=>!isPhantomCompositePart(a,p));
        if(a.parts.length!==before){
          syncCompositeMax(a);
          a.updatedAt=now();c.updatedAt=now();changed=true;
        }
      }
    }
    if(changed)save();
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
      ensureStudentPools(c);
      const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
      const modal=document.createElement("div");modal.className="aa-modal aa-modal-wide";
      const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Choose students for "+detected.name;
      const body=document.createElement("div");body.className="aa-modal-body";
      const note=document.createElement("div");note.className="aa-muted aa-small";note.textContent=detected.students.length+" students detected. Checked students will be added to this course (or restored if previously removed) and their assessment result imported.";
      const count=document.createElement("div");count.className="aa-muted aa-small";count.style.marginTop="4px";
      body.append(note,count);

      const controls=document.createElement("div");controls.className="aa-toolbar";
      const existingLabel=document.createElement("label"),existingOnly=document.createElement("input");existingOnly.type="checkbox";
      existingLabel.append(existingOnly,document.createTextNode(" Only students already on this course"));
      const rows=[];
      controls.append(existingLabel,
        btn("Select all",()=>{rows.forEach(r=>{if(!r.cb.disabled)r.cb.checked=true});refresh()}),
        btn("Select none",()=>{rows.forEach(r=>r.cb.checked=false);refresh()})
      );
      body.appendChild(controls);

      const wrap=document.createElement("div");wrap.className="aa-table-wrap aa-student-picker-scroll";
      const table=document.createElement("table");table.className="aa-table aa-import-table";
      table.innerHTML="<thead><tr><th></th><th>OmaAbitti student</th><th>Email</th><th>Points</th><th>Course status / match</th></tr></thead>";
      const tbody=document.createElement("tbody");

      detected.students.forEach((incoming,index)=>{
        const m=matchStudent(c,incoming),hasScore=Number.isFinite(num(incoming.points));
        const tr=document.createElement("tr"),a=document.createElement("td"),b=document.createElement("td"),d=document.createElement("td"),e=document.createElement("td"),g=document.createElement("td");
        const cb=document.createElement("input");cb.type="checkbox";cb.checked=hasScore;cb.disabled=!hasScore;cb.onchange=()=>refresh();a.appendChild(cb);
        b.textContent=incoming.name||"(no name)";d.textContent=incoming.email||"";e.textContent=hasScore?fmt(num(incoming.points),2):"—";
        const base=m?(isStudentOnCourse(c,m.student.id)?"On course: ":"Removed from course: ")+m.student.canonicalName:matchLabel(m);
        g.textContent=base+(hasScore?"":" · no score");
        tr.append(a,b,d,e,g);tbody.appendChild(tr);rows.push({index,m,cb,tr,status:g,base,hasScore});
      });

      function refresh(){
        for(const r of rows){
          const alreadyOnCourse=!!(r.m&&isStudentOnCourse(c,r.m.student.id));
          const disabled=!r.hasScore||(existingOnly.checked&&!alreadyOnCourse);
          r.cb.disabled=disabled;if(disabled)r.cb.checked=false;
          r.tr.classList.toggle("aa-row-disabled",disabled);
          r.status.textContent=r.base+(disabled&&existingOnly.checked&&!alreadyOnCourse?" · skipped by course-only filter":(!r.hasScore?" · no score":""));
        }
        count.textContent=rows.filter(r=>r.cb.checked&&!r.cb.disabled).length+" selected of "+rows.length;
      }
      existingOnly.onchange=refresh;refresh();

      table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
      const foot=document.createElement("div");foot.className="aa-modal-foot";
      const close=v=>{overlay.remove();resolve(v)};
      foot.append(btn("Cancel",()=>close(null)),btn("Add/import selected",()=>{
        const selected=rows.filter(r=>r.cb.checked&&!r.cb.disabled).map(r=>r.index);
        if(!selected.length)return alert("Select at least one student.");
        close({selected,existingOnly:existingOnly.checked});
      },"primary"));
      modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);overlay.onclick=ev=>{if(ev.target===overlay)close(null)};
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
      }else if(!isStudentOnCourse(c,student.id)){
        if(existingOnly){skippedNotOnCourse++;return}
        activateStudent(c,student);
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
      part={id:uid("part"),name:partName,maxPoints,effect:1,source:{type:"omaabitti",reviewPath:detected.reviewPath},results:{},createdAt:now(),updatedAt:now()};
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
    const map=currentBoundaries(c);
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
      c=await createCourseDialog("Google Forms");
      if(!c)return;
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
  #aa-launch-dock{position:fixed;right:12px;bottom:12px;z-index:2147483647!important;display:flex;align-items:stretch;box-shadow:0 5px 20px #0003;border-radius:999px;overflow:hidden}#aa-launch{display:block!important;visibility:visible!important;opacity:1!important;border:0;background:#24362f;color:#fff;padding:11px 14px;font-weight:700;cursor:pointer}#aa-dock-toggle{border:0;border-left:1px solid #ffffff33;background:#24362f;color:#fff;padding:0 7px;cursor:pointer;font-weight:800}#aa-launch-dock.docked{right:0;border-radius:10px 0 0 10px}#aa-launch-dock.docked #aa-launch{padding:10px 7px}#aa-launch-dock.docked #aa-dock-toggle{padding:0 4px}
  #aa-panel{position:fixed;right:10px;top:10px;bottom:10px;width:min(900px,calc(100vw - 20px));z-index:2147483647;background:#fff;color:#172026;border:1px solid #cfd8d4;border-radius:12px;box-shadow:0 18px 50px #0004;display:flex;flex-direction:column;overflow:hidden;font-size:13px}
  #aa-panel.compact{width:340px;top:56px}.aa-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:9px;border-bottom:1px solid #dde4e0;background:#f5f8f6}.aa-title{font-weight:800;margin-right:auto}
  .aa-btn,.aa-input,.aa-select,.aa-area{border:1px solid #bbc8c2;border-radius:7px;background:#fff;color:#172026;padding:6px 8px;font-size:12px}.aa-btn{cursor:pointer}.aa-btn.primary{background:#275d4e;border-color:#275d4e;color:#fff}.aa-btn.danger{color:#9a2626}
  .aa-tabs{display:flex;gap:3px;padding:6px 8px 0;border-bottom:1px solid #dde4e0;background:#fafcfb}.aa-tab{border:0;background:transparent;padding:7px 9px;cursor:pointer}.aa-tab.active{font-weight:700;background:#fff;border:1px solid #dde4e0;border-bottom-color:#fff;border-radius:6px 6px 0 0;margin-bottom:-1px}
  .aa-content{flex:1;overflow:auto;padding:9px}.aa-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.aa-muted{color:#6a7871}.aa-small{font-size:11px}.aa-table-wrap{overflow:auto}
  .aa-table{width:100%;border-collapse:collapse}.aa-table th,.aa-table td{border:1px solid #dde4e0;padding:5px 6px;white-space:nowrap;background:#fff}.aa-table th{position:sticky;top:0;background:#f4f7f5;z-index:2;text-align:left}.aa-table .student{position:sticky;left:0;z-index:1}.aa-table th.student{z-index:3}
  .aa-score{cursor:pointer;text-decoration:underline dotted}.aa-card{border:1px solid #dde4e0;background:#fafcfb;border-radius:9px;padding:9px;margin-bottom:8px}.aa-card h3{margin:0 0 7px;font-size:14px}.aa-area{width:100%;min-height:170px;font-family:ui-monospace,Consolas,monospace}
  .aa-mini{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:6px 2px;border-bottom:1px solid #edf1ef}.aa-mini-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aa-empty{text-align:center;color:#6a7871;padding:25px}\n  .aa-modal-overlay{position:fixed;inset:0;z-index:2147483647;background:#0007;display:flex;align-items:center;justify-content:center;padding:18px}\n  .aa-modal{width:min(920px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#172026;border:1px solid #87958f;border-radius:10px;box-shadow:0 18px 60px #0006;overflow:hidden}\n  .aa-modal-head{padding:10px 12px;font-weight:800;border-bottom:1px solid #dde4e0;background:#f5f8f6}.aa-modal-body{padding:10px 12px;overflow:auto}.aa-modal-foot{padding:9px 12px;display:flex;justify-content:flex-end;gap:6px;border-top:1px solid #dde4e0;background:#fafcfb}\n  .aa-import-table td,.aa-import-table th{white-space:normal}.aa-row-disabled{opacity:.48}.aa-result-input{width:85px}
  .aa-destination-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:10px}.aa-destination-card{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid #bbc8c2;border-radius:9px;background:#fff;color:#172026;padding:12px;cursor:pointer}.aa-destination-card:hover{background:#f5f8f6;border-color:#7f938a}.aa-destination-card strong{font-size:13px}.aa-destination-card span{font-size:11px;color:#6a7871}
  #aa-grading-manager{margin:10px 0 14px;border:1px solid #aebbb5;border-radius:8px;background:#fff;color:#172026;font:12px system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden}.aa-manager-bar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px;background:#f5f8f6;border-bottom:1px solid #d7dfdb}.aa-manager-table{width:100%;border-collapse:collapse}.aa-manager-table th,.aa-manager-table td{padding:7px 8px;border-bottom:1px solid #e1e6e3;text-align:left;vertical-align:middle}.aa-manager-table th{background:#fafcfb}.aa-manager-exam{min-width:260px;font-weight:600}.aa-manager-select{min-width:185px}.aa-manager-select .aa-batch-check{margin-right:8px}.aa-add-group-select{min-width:145px}.aa-manager-select .aa-batch-check{margin-right:7px}.aa-manager-courses{min-width:280px}.aa-course-chip{display:inline-block;margin:2px 5px 2px 0;padding:4px 7px;border:1px solid #9dafaa;border-radius:999px;background:#f7faf8;color:#24362f;cursor:pointer;font-size:11px}.aa-course-chip:hover{background:#edf4f0}.aa-placement-table{margin-top:10px}.aa-placement-card{margin-top:10px}.aa-placement-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}.aa-placement-title label{display:flex;align-items:center;gap:6px}.aa-sortable-head{cursor:pointer;user-select:none}.aa-sortable-head:hover{background:#eef4f1!important}.aa-sortable-head.active{font-weight:800}.aa-sort-arrow{font-size:10px;white-space:nowrap}.aa-gradebook-search{min-width:190px}.aa-gradebook-head-row{display:flex;align-items:center;justify-content:space-between;gap:5px}.aa-sort-icon{border:0;background:transparent;color:#52635b;cursor:pointer;font-size:10px;padding:1px 2px;line-height:1}.aa-sort-icon:hover{color:#111}.aa-table th.active-sort{background:#eef4f1}.aa-header-weight{width:52px;margin:2px 3px 0;padding:2px 3px;border:1px solid #b7c4be;border-radius:4px;font-size:10px}.aa-student-weight-wrap{display:flex;align-items:center;gap:3px;margin-top:3px}.aa-student-weight{width:48px;padding:2px 3px;border:1px solid #c6d0cb;border-radius:4px;font-size:10px}.aa-exam-name-filter{min-width:180px}.aa-direct-suggestions{margin-top:10px;display:flex;flex-direction:column;gap:6px}.aa-direct-suggestion{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px;border:1px solid #dde4e0;border-radius:7px;background:#fafcfb}.aa-student-picker-scroll{max-height:55vh;overflow:auto}.aa-modal-wide{width:min(1100px,94vw)!important}.aa-assessment-chip{display:inline-flex;align-items:center;gap:4px;margin:2px 5px 2px 0;padding:3px 5px;border:1px solid #ccd7d2;border-radius:999px;background:#f7faf8}.aa-assessment-chip button{border:0;background:transparent;color:#a33;cursor:pointer;font-weight:700;padding:0 2px}.aa-removed-student{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #e5ebe8}.aa-removed-student>span{flex:1}.aa-course-form{display:grid;gap:10px}.aa-pass-row{display:flex;align-items:center;gap:8px}.aa-pass-row input[type=range]{flex:1}.aa-pass-number{width:72px}.aa-pass-settings{display:grid;gap:5px;max-width:420px}.aa-add-exam-scroll{max-height:55vh;overflow:auto}.aa-add-exam-table th{position:sticky;top:0;background:#fff;z-index:1}.aa-manager-body[hidden]{display:none!important}.aa-course-form label{display:grid;gap:5px;font-weight:600}.aa-boundary-area{min-height:180px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important}

  #aa-grading-batchbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0;padding:9px;border:1px solid #9eaaa4;border-radius:8px;background:#f5f8f6;color:#172026;font:12px system-ui,-apple-system,Segoe UI,sans-serif}#aa-grading-batchbar .aa-batch-hint{flex:1 1 320px;color:#53615a}.aa-batch-col{width:120px;min-width:120px;text-align:center!important}.aa-batch-cell{vertical-align:middle}.aa-batch-check{margin-right:6px}.aa-batch-group{width:48px;padding:3px 5px;border:1px solid #aebbb5;border-radius:5px;text-transform:uppercase}.aa-batch-head .aa-batch-sub{font-size:10px;font-weight:400;color:#66746d}\n  `);

  let open=db.settings.panelOpen==null?IS_ABITTI:!!db.settings.panelOpen;
  let compact=db.settings.panelCompact==null?!IS_ABITTI:!!db.settings.panelCompact;
  let launcherDocked=!!db.settings.launcherDocked;
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
    const dock=document.createElement("div");dock.id="aa-launch-dock";
    const l=document.createElement("button");l.id="aa-launch";l.textContent="Grades";
    l.title="Open/close ArviointiApina gradebook";
    l.onclick=()=>{setPanelState(!open,compact);render()};
    const d=document.createElement("button");d.id="aa-dock-toggle";d.type="button";d.title="Minimize/restore launcher";
    d.onclick=e=>{e.stopPropagation();launcherDocked=!launcherDocked;db.settings.launcherDocked=launcherDocked;save();render()};
    dock.append(l,d);root.appendChild(dock);document.body.appendChild(root)
  }
  function ensureCourse(){if(db.settings.activeCourseId&&db.courses[db.settings.activeCourseId])return;db.settings.activeCourseId=Object.keys(db.courses)[0]||null;save()}

  function render(){
    ensureRoot();ensureCourse();
    const launcher=root.querySelector("#aa-launch");
    if(launcher){
      launcher.style.display="block";
      launcher.setAttribute("aria-pressed",open?"true":"false");
      launcher.textContent=launcherDocked?"G":(open?"Grades ✓":"Grades");
      root.querySelector("#aa-launch-dock")?.classList.toggle("docked",launcherDocked);
      const dockToggle=root.querySelector("#aa-dock-toggle");
      if(dockToggle)dockToggle.textContent=launcherDocked?"‹":"›";
    }
    root.querySelector("#aa-panel")?.remove();
    if(!open){
      if(IS_GRADING_LIST)setTimeout(()=>setupGradingListPicker(true).catch(()=>{}),0);
      return;
    }
    const p=document.createElement("div");p.id="aa-panel";p.classList.toggle("compact",compact);root.appendChild(p);header(p);
    if(compact)return compactView(p);
    tabs(p);const content=document.createElement("div");content.className="aa-content";p.appendChild(content);const c=course();if(!c)return noCourse(content);
    const tab=db.settings.activeTab;
    if(tab==="assessments")assessments(content,c);else if(tab==="students")students(content,c);else if(tab==="data")data(content,c);else if(tab==="settings")settings(content,c);else gradebook(content,c);

    if(IS_GRADING_LIST){
      setTimeout(()=>setupGradingListPicker(true).catch(error=>console.error("ArviointiApina grading-list refresh failed",error)),0);
    }
  }

  function header(p){
    const h=document.createElement("div");h.className="aa-head";const title=document.createElement("div");title.className="aa-title";title.textContent=APP_NAME;h.appendChild(title);

    const s=document.createElement("select");s.className="aa-select";
    for(const c of Object.values(db.courses).sort((a,b)=>a.name.localeCompare(b.name,"fi"))){
      const o=document.createElement("option");o.value=c.id;o.textContent=c.name;o.selected=c.id===db.settings.activeCourseId;s.appendChild(o)
    }
    s.onchange=()=>{db.settings.activeCourseId=s.value;save();render()};
    h.appendChild(s);

    const active=course();
    if(active){
      const nameInput=document.createElement("input");
      nameInput.className="aa-input";
      nameInput.value=active.name;
      nameInput.placeholder="Course name";
      nameInput.style.width="180px";
      const commitName=()=>{
        const next=nameInput.value.trim();
        if(!next){nameInput.value=active.name;return}
        if(next!==active.name){
          active.name=next;
          active.updatedAt=now();
          save();
          render();
        }
      };
      nameInput.onchange=commitName;
      nameInput.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();commitName();nameInput.blur()}};
      h.appendChild(nameInput);
    }

    h.appendChild(btn("+ Course",async()=>{const c=await createCourseDialog();if(c)render()}));
    if(IS_ABITTI)h.appendChild(btn("Import OmaAbitti",importDialog,"primary"));
    h.appendChild(btn(compact?"Full":"Compact",()=>{setPanelState(true,!compact);render()}));h.appendChild(btn("×",()=>{setPanelState(false,compact);render()}));p.appendChild(h);
  }

  function tabs(p){
    const t=document.createElement("div");t.className="aa-tabs";
    for(const [id,label] of [["gradebook","Gradebook"],["assessments","Assessments"],["students","Students"],["data","Data"],["settings","Settings"]]){const b=document.createElement("button");b.className="aa-tab "+(db.settings.activeTab===id?"active":"");b.textContent=label;b.onclick=()=>{db.settings.activeTab=id;save();render()};t.appendChild(b)}p.appendChild(t);
  }

  function noCourse(parent){const d=document.createElement("div");d.className="aa-empty";d.textContent="Create a course before importing results.";d.append(document.createElement("br"),btn("Create course",async()=>{const c=await createCourseDialog();if(c)render()},"primary"));parent.appendChild(d)}

  async function detectedExamFromHeldExamCode(code,titleFallback="OmaAbitti exam"){
    const studentsRaw=await abittiJson("/exam-api/grading/"+encodeURIComponent(code)+"/student-answers-return");
    let exam={};
    try{exam=await abittiJson("/exam-api/exams/held-exam/"+encodeURIComponent(code)+"/exam")}catch(_){}
    const students=(Array.isArray(studentsRaw)?studentsRaw:[]).map(st=>{
      const total=(st.answers||[]).reduce((sum,a)=>sum+(Number.isFinite(num(a?.scoreValue))?num(a.scoreValue):0),0);
      return{
        name:[st.lastName,st.firstNames].filter(Boolean).join(", "),
        email:st.email||"",
        uuid:st.studentUuid||"",
        answerPaperId:st.answerPaperId||"",
        points:total
      };
    });
    return{
      name:exam.title||titleFallback,
      reviewPath:"/school/review/"+encodeURIComponent(code),
      students,
      answerURL:"",
      maxPoints:null,
      maxSource:null
    };
  }

  function extractHeldExamCode(value){
    const raw=String(value||"").trim();
    if(!raw)return"";
    try{
      const u=new URL(raw,"https://oma.abitti.fi");
      const m=u.pathname.match(/^\/school\/(?:review|grading)\/([^/]+)/);
      if(m)return decodeURIComponent(m[1]);
    }catch(_){}
    if(/^[A-Za-z0-9-]{12,}$/.test(raw))return raw;
    return"";
  }

  async function addHeldExamDirectly(c,code,titleFallback="OmaAbitti exam"){
    if(!code)return alert("Enter a valid OmaAbitti review or grading URL.");
    const detected=await detectedExamFromHeldExamCode(code,titleFallback);
    if(!detected.students.length)return alert("No student results were found for this exam.");

    let maxPoints=null;
    if(location.hostname==="oma.abitti.fi"){
      try{
        const doc=await loadRenderedSameOriginPage(detected.reviewPath,"#scoreTable tbody tr.student",15000);
        const rendered=detectedExamFromReviewDocument(doc,detected.reviewPath,detected.name);
        if(rendered?.answerURL){
          detected.answerURL=rendered.answerURL;
          const maxInfo=await resolveDetectedMaxPoints(detected);
          maxPoints=maxInfo?.value??null;
        }
      }catch(_){}
    }
    if(!(maxPoints>0)){
      const manual=prompt('Maximum points for "'+detected.name+'":',"");
      if(manual===null)return;
      maxPoints=num(manual);
      if(!(maxPoints>0))return alert("Invalid maximum points.");
    }

    const selection=await chooseImportStudents(c,detected);
    if(!selection)return;
    const selectedIndexes=new Set(selection.selected);

    const existing=findReviewTarget(c,detected.reviewPath);
    if(existing){
      if(!confirm('"'+detected.name+'" is already in this course. Update its results?'))return;
      const targetResults=existing.part?existing.part.results:existing.assessment.results;
      const stats=importSelectedIntoResults(c,targetResults,selectedIndexes,selection.existingOnly,detected);
      if(existing.part){existing.part.maxPoints=maxPoints;existing.part.updatedAt=now();syncCompositeMax(existing.assessment)}
      else{existing.assessment.maxPoints=maxPoints;existing.assessment.updatedAt=now()}
      c.updatedAt=now();save();render();
      return alert("Updated "+stats.imported+" results.");
    }

    const destination=await chooseAssessmentDestination(c);
    if(!destination)return;
    if(destination.type==="existing"){
      const a=destination.assessment,parts=ensureParts(a);
      const weightInput=prompt('Course-grade weight % for "'+a.name+'":',String(Math.max(0,num(a.defaultWeight)||0)));
      if(weightInput===null)return;
      const weight=num(weightInput);if(!(weight>=0))return alert("Invalid weight.");
      a.defaultWeight=weight;
      const part={id:uid("part"),name:detected.name,maxPoints,effect:1,source:{type:"omaabitti",reviewPath:detected.reviewPath},results:{},createdAt:now(),updatedAt:now()};
      const stats=importSelectedIntoResults(c,part.results,selectedIndexes,selection.existingOnly,detected);
      parts.push(part);syncCompositeMax(a);a.updatedAt=now();c.updatedAt=now();save();render();
      return alert("Added as a part of "+a.name+". Imported "+stats.imported+" results.");
    }

    const weightInput=prompt('Course-grade weight % for "'+detected.name+'":',"0");
    if(weightInput===null)return;
    const weight=num(weightInput);if(!(weight>=0))return alert("Invalid weight.");
    const id=uid("assessment");
    const a=c.assessments[id]={id,name:detected.name,maxPoints,defaultWeight:weight,type:"exam",source:{type:"omaabitti",reviewPath:detected.reviewPath},results:{},createdAt:now(),updatedAt:now()};
    const stats=importSelectedIntoResults(c,a.results,selectedIndexes,selection.existingOnly,detected);
    c.updatedAt=now();save();render();
    alert("Added "+detected.name+". Imported "+stats.imported+" results. Weight: "+weight+"%.");
  }

  async function openAddExamDialog(c){
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
    const modal=document.createElement("div");modal.className="aa-modal aa-modal-wide";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Add OmaAbitti exams";
    const body=document.createElement("div");body.className="aa-modal-body";
    const note=document.createElement("div");note.className="aa-muted aa-small";
    note.textContent="Select one or more held exams. Use Multipart 1–3 to combine selected exams into the same assessment. You can also paste a review/grading URL.";
    body.appendChild(note);

    const manual=document.createElement("div");manual.className="aa-toolbar";manual.style.marginTop="10px";
    const urlInput=document.createElement("input");urlInput.className="aa-input";urlInput.style.flex="1";urlInput.placeholder="https://oma.abitti.fi/school/review/…";
    const addManual=btn("Add URL",async()=>{
      const code=extractHeldExamCode(urlInput.value);if(!code)return alert("Enter a valid OmaAbitti exam URL.");
      addManual.disabled=true;try{await addHeldExamDirectly(c,code)}catch(e){alert("Could not add exam: "+e.message)}finally{addManual.disabled=false}
      overlay.remove();
    },"primary");
    manual.append(urlInput,addManual);body.appendChild(manual);

    const controls=document.createElement("div");controls.className="aa-toolbar";
    const examSearch=document.createElement("input");examSearch.className="aa-input aa-exam-name-filter";examSearch.placeholder="Filter exams by name, e.g. HL";
    const schoolYear=document.createElement("select");schoolYear.className="aa-select";
    controls.append(examSearch,schoolYear);body.appendChild(controls);

    const wrap=document.createElement("div");wrap.className="aa-table-wrap aa-add-exam-scroll";
    const table=document.createElement("table");table.className="aa-table aa-add-exam-table";
    table.innerHTML="<thead><tr><th></th><th>Exam</th><th>Date</th><th>Add / multipart</th></tr></thead>";
    const tbody=document.createElement("tbody");table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);

    const foot=document.createElement("div");foot.className="aa-modal-foot";const close=()=>overlay.remove();
    const addSelected=btn("Add selected",async()=>{},"primary");
    foot.append(btn("Close",close),addSelected);modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);
    overlay.onclick=ev=>{if(ev.target===overlay)close()};

    try{
      const meta=await gradingHeldExamMeta(),currentYear=schoolYearForTimestamp(Date.now());
      const candidates=[...meta.values()].map(x=>{
        const dateValue=parseGradingListDate(x.eventDate);
        const code=String(x.schoolAnonCode||x.uuid||"").trim();
        return{x,code,dateValue,year:schoolYearForTimestamp(dateValue),score:similarity(c.name,x.title||"")};
      }).filter(v=>v.code);

      const years=[...new Set(candidates.map(v=>v.year).filter(Boolean))].sort((a,b)=>b.localeCompare(a,"fi"));
      const all=document.createElement("option");all.value="__all__";all.textContent="All school years";schoolYear.appendChild(all);
      for(const y of years){const o=document.createElement("option");o.value=y;o.textContent=y;schoolYear.appendChild(o)}
      schoolYear.value=years.includes(currentYear)?currentYear:(years[0]||"__all__");

      const states=candidates.map(r=>{
        const cb=document.createElement("input");cb.type="checkbox";
        const add=document.createElement("select");add.className="aa-select aa-add-group-select";
        const separate=document.createElement("option");separate.value="new";separate.textContent="New assessment";add.appendChild(separate);
        for(let i=1;i<=3;i++){const o=document.createElement("option");o.value="group:"+i;o.textContent="Multipart "+i;add.appendChild(o)}
        return{r,cb,add};
      });

      const draw=()=>{
        tbody.innerHTML="";
        const needle=norm(examSearch.value),year=schoolYear.value;
        const shown=states.filter(st=>{
          const nameOk=!needle||norm(st.r.x.title||"").includes(needle);
          const yearOk=year==="__all__"||st.r.year===year;
          return nameOk&&yearOk;
        }).sort((a,b)=>(b.r.score-a.r.score)||((b.r.dateValue||0)-(a.r.dateValue||0)));
        for(const st of shown){
          const tr=document.createElement("tr"),pick=document.createElement("td"),name=document.createElement("td"),date=document.createElement("td"),dest=document.createElement("td");
          pick.appendChild(st.cb);name.textContent=st.r.x.title||"OmaAbitti exam";date.textContent=formatGradingListDate(st.r.dateValue,"—");dest.appendChild(st.add);
          tr.append(pick,name,date,dest);tbody.appendChild(tr);
        }
        if(!shown.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.className="aa-empty";td.textContent="No exams match the current filters.";tr.appendChild(td);tbody.appendChild(tr)}
      };
      examSearch.oninput=draw;schoolYear.onchange=draw;draw();

      addSelected.onclick=async()=>{
        const selected=states.filter(st=>st.cb.checked).map(st=>({
          title:st.r.x.title||"OmaAbitti exam",
          reviewPath:"/school/review/"+encodeURIComponent(st.r.code),
          group:st.add.value.startsWith("group:")?st.add.value.slice(6):""
        }));
        if(!selected.length)return alert("Select at least one exam.");
        addSelected.disabled=true;addSelected.textContent="Adding…";
        try{await importGradingListBatch(selected,c);overlay.remove()}
        catch(e){alert("Could not add selected exams: "+e.message)}
        finally{addSelected.disabled=false;addSelected.textContent="Add selected"}
      };
    }catch(e){
      tbody.innerHTML="<tr><td colspan='4' class='aa-empty'>Could not load held exams. You can still paste an exam URL above.</td></tr>";
    }
  }

  function gradebook(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";
    const info=document.createElement("span");info.className="aa-muted aa-small";
    info.textContent=Object.keys(c.students).length+" students · "+Object.keys(c.assessments).length+" assessments";
    const search=document.createElement("input");search.className="aa-input aa-gradebook-search";search.placeholder="Search student…";
    bar.append(info,search,btn("+ Add exam",()=>openAddExamDialog(c),"primary"));
    if(IS_ABITTI)bar.appendChild(btn("Import current exam",importDialog));
    bar.appendChild(btn("Export CSV",()=>exportCSV(c)));parent.appendChild(bar);

    const allStudents=Object.values(c.students);
    const as=Object.values(c.assessments);
    if(!allStudents.length){const e=document.createElement("div");e.className="aa-empty";e.textContent="No students yet.";return parent.appendChild(e)}

    let sortKey="student",sortDir="asc";
    const wrap=document.createElement("div");wrap.className="aa-table-wrap";
    const table=document.createElement("table");table.className="aa-table aa-gradebook-table";
    const thead=document.createElement("thead"),hr=document.createElement("tr");

    const sortableHeader=(label,key)=>{
      const th=document.createElement("th");
      const row=document.createElement("div");row.className="aa-gradebook-head-row";
      const text=document.createElement("span");text.textContent=label;
      const icon=document.createElement("button");icon.type="button";icon.className="aa-sort-icon";icon.title="Sort by "+label;
      icon.onclick=e=>{e.stopPropagation();if(sortKey===key)sortDir=sortDir==="asc"?"desc":"asc";else{sortKey=key;sortDir="asc"}draw()};
      row.append(text,icon);th.appendChild(row);
      th.dataset.sortKey=key;return th;
    };

    const studentTh=sortableHeader("Student","student");studentTh.classList.add("student");hr.appendChild(studentTh);

    for(const a of as){
      const th=document.createElement("th");th.dataset.sortKey="assessment:"+a.id;
      const row=document.createElement("div");row.className="aa-gradebook-head-row";
      const title=document.createElement("span");title.textContent=a.name;
      const icon=document.createElement("button");icon.type="button";icon.className="aa-sort-icon";icon.title="Sort by "+a.name+" result";
      icon.onclick=e=>{e.stopPropagation();const key="assessment:"+a.id;if(sortKey===key)sortDir=sortDir==="asc"?"desc":"asc";else{sortKey=key;sortDir="desc"}draw()};
      row.append(title,icon);th.appendChild(row);

      const meta=document.createElement("div");meta.className="aa-muted aa-small";
      meta.append(document.createTextNode("max "+fmt(effectiveMax(a),2)+(hasParts(a)?" · "+a.parts.length+" parts · ":" · ")));
      const weight=document.createElement("input");weight.className="aa-header-weight";weight.type="number";weight.min="0";weight.step="0.1";weight.value=a.defaultWeight;
      weight.title="Default course weight %. Individual student overrides still take priority.";
      weight.onchange=()=>{
        const v=num(weight.value);
        if(!(v>=0)){alert("Invalid weight.");weight.value=a.defaultWeight;return}
        a.defaultWeight=v;a.updatedAt=now();c.updatedAt=now();save();draw();
      };
      meta.append(weight,document.createTextNode("%"));th.appendChild(meta);hr.appendChild(th);
    }

    hr.append(sortableHeader("Weighted","weighted"),sortableHeader("Grade","grade"));
    const actionTh=document.createElement("th");hr.appendChild(actionTh);
    thead.appendChild(hr);table.appendChild(thead);
    const body=document.createElement("tbody");table.appendChild(body);wrap.appendChild(table);parent.appendChild(wrap);

    const sortValue=(st)=>{
      if(sortKey==="student")return norm(st.canonicalName);
      if(sortKey==="weighted"){const x=calc(c,st);return x.pct==null?null:x.pct}
      if(sortKey==="grade"){const x=calc(c,st),n=num(x.grade);return Number.isFinite(n)?n:String(x.grade||"")}
      if(sortKey.startsWith("assessment:")){
        const id=sortKey.slice("assessment:".length),a=c.assessments[id];
        if(!a)return null;
        const r=effectiveResult(a,st.id),max=effectiveMax(a),p=num(r?.points);
        return Number.isFinite(p)&&max>0?p/max:null;
      }
      return null;
    };

    function draw(){
      for(const th of thead.querySelectorAll("[data-sort-key]")){
        const icon=th.querySelector(".aa-sort-icon");if(!icon)continue;
        icon.textContent=th.dataset.sortKey===sortKey?(sortDir==="asc"?"▲":"▼"):"↕";
        th.classList.toggle("active-sort",th.dataset.sortKey===sortKey);
      }

      body.innerHTML="";
      const needle=norm(search.value);
      const ss=allStudents
        .filter(st=>!needle||names(st).some(n=>norm(n).includes(needle))||(st.emails||[]).some(e=>norm(e).includes(needle)))
        .sort((a,b)=>{
          const av=sortValue(a),bv=sortValue(b);
          const aMissing=av===null||av===undefined||av==="",bMissing=bv===null||bv===undefined||bv==="";
          if(aMissing!==bMissing)return aMissing?1:-1;
          let v;
          if(typeof av==="number"&&typeof bv==="number")v=av-bv;
          else v=String(av??"").localeCompare(String(bv??""),"fi",{numeric:true,sensitivity:"base"});
          if(v===0)v=a.canonicalName.localeCompare(b.canonicalName,"fi");
          return sortDir==="asc"?v:-v;
        });

      for(const st of ss){
        const x=calc(c,st),tr=document.createElement("tr"),name=document.createElement("td");name.className="student";name.textContent=st.canonicalName;tr.appendChild(name);
        for(const a of as){
          const td=document.createElement("td"),r=effectiveResult(a,st.id),sp=document.createElement("span");sp.className="aa-score";
          sp.textContent=r?fmt(num(r.points),2)+"/"+fmt(effectiveMax(a),2)+(hasParts(a)?" ("+(r.completedParts||0)+"/"+a.parts.length+" parts)":""):"—";
          sp.onclick=()=>hasParts(a)?editCompositeStudentResults(c,st,a):editResult(c,st,a);td.appendChild(sp);

          const weightWrap=document.createElement("div");weightWrap.className="aa-student-weight-wrap";
          const label=document.createElement("span");label.className="aa-muted aa-small";label.textContent="w";
          const wi=document.createElement("input");wi.className="aa-student-weight";wi.type="number";wi.min="0";wi.step="0.1";
          const hasOverride=Object.prototype.hasOwnProperty.call(st.weightingOverrides||{},a.id);
          wi.value=hasOverride?st.weightingOverrides[a.id]:"";
          wi.placeholder=String(a.defaultWeight);
          wi.title="Individual weight %. Blank = course default ("+a.defaultWeight+"%). 0 = exclude.";
          wi.onchange=()=>{
            st.weightingOverrides||={};
            const raw=wi.value.trim();
            if(!raw)delete st.weightingOverrides[a.id];
            else{
              const v=num(raw);if(!(v>=0)){alert("Invalid individual weight.");wi.value=hasOverride?st.weightingOverrides[a.id]:"";return}
              st.weightingOverrides[a.id]=v;
            }
            st.updatedAt=now();save();draw();
          };
          weightWrap.append(label,wi);td.appendChild(weightWrap);tr.appendChild(td);
        }
        const pct=document.createElement("td");pct.textContent=x.pct==null?"—":fmt(x.pct,1)+"%";tr.appendChild(pct);
        const gt=document.createElement("td");gt.appendChild(btn(x.grade||"—",async()=>{if(x.grade)await navigator.clipboard.writeText(x.grade)}));tr.appendChild(gt);
        const act=document.createElement("td");act.appendChild(btn("Weights",()=>editWeights(c,st)));tr.appendChild(act);body.appendChild(tr);
      }
      if(!ss.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=as.length+4;td.className="aa-empty";td.textContent="No students match the search.";tr.appendChild(td);body.appendChild(tr)}
    }
    search.oninput=draw;draw();
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
    ensureStudentPools(c);const parts=ensureParts(a),all=allKnownStudents(c);
    const relevant=Object.values(all).filter(st=>isStudentOnCourse(c,st.id)||parts.some(p=>Object.prototype.hasOwnProperty.call(p.results||{},st.id)));
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";const modal=document.createElement("div");modal.className="aa-modal aa-modal-wide";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Students / results · "+a.name;
    const body=document.createElement("div");body.className="aa-modal-body";
    const note=document.createElement("div");note.className="aa-muted aa-small";note.textContent=relevant.length+" known students. Use On course to add removed participants back to the course.";body.appendChild(note);
    const wrap=document.createElement("div");wrap.className="aa-table-wrap aa-student-picker-scroll";const table=document.createElement("table");table.className="aa-table";
    const thead=document.createElement("thead"),hr=document.createElement("tr");hr.innerHTML="<th>On course</th><th>Student</th>";for(const p of parts){const th=document.createElement("th");th.textContent=p.name+" / "+p.maxPoints;hr.appendChild(th)}thead.appendChild(hr);table.appendChild(thead);
    const tbody=document.createElement("tbody"),rows=[];
    for(const st of relevant.sort((x,y)=>x.canonicalName.localeCompare(y.canonicalName,"fi"))){
      const tr=document.createElement("tr"),onTd=document.createElement("td"),on=document.createElement("input");on.type="checkbox";on.checked=isStudentOnCourse(c,st.id);onTd.appendChild(on);
      const name=document.createElement("td");name.textContent=st.canonicalName;tr.append(onTd,name);const inputs=[];
      for(const p of parts){const td=document.createElement("td"),inp=document.createElement("input");inp.className="aa-input aa-result-input";inp.value=p.results?.[st.id]?.points??"";inp.placeholder="blank = no result";td.appendChild(inp);tr.appendChild(td);inputs.push({p,inp})}
      tbody.appendChild(tr);rows.push({st,on,inputs});
    }
    table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
    const foot=document.createElement("div");foot.className="aa-modal-foot";const close=()=>overlay.remove();
    foot.append(btn("Cancel",close),btn("Save",()=>{
      for(const row of rows){
        if(row.on.checked)activateStudent(c,row.st);else if(isStudentOnCourse(c,row.st.id))detachStudent(c,row.st.id);
        for(const item of row.inputs){const raw=item.inp.value.trim();item.p.results||={};if(!raw){delete item.p.results[row.st.id];continue}const points=num(raw);if(!Number.isFinite(points))return alert("Invalid points for "+row.st.canonicalName+" / "+item.p.name);item.p.results[row.st.id]={...(item.p.results[row.st.id]||{}),points,editedAt:now()}}
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
    ensureStudentPools(c);const all=allKnownStudents(c);
    const relevant=Object.values(all).filter(st=>isStudentOnCourse(c,st.id)||Object.prototype.hasOwnProperty.call(a.results||{},st.id));
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";const modal=document.createElement("div");modal.className="aa-modal";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Students / results · "+a.name;
    const body=document.createElement("div");body.className="aa-modal-body";const note=document.createElement("div");note.className="aa-muted aa-small";note.textContent=relevant.length+" known students. On course restores removed students; In assessment controls this result.";body.appendChild(note);
    const wrap=document.createElement("div");wrap.className="aa-table-wrap aa-student-picker-scroll";const table=document.createElement("table");table.className="aa-table";table.innerHTML="<thead><tr><th>On course</th><th>In assessment</th><th>Student</th><th>Email</th><th>Points</th></tr></thead>";
    const tbody=document.createElement("tbody"),rows=[];
    for(const st of relevant.sort((x,y)=>x.canonicalName.localeCompare(y.canonicalName,"fi"))){
      const r=a.results?.[st.id],tr=document.createElement("tr"),td0=document.createElement("td"),tdA=document.createElement("td"),td1=document.createElement("td"),td2=document.createElement("td"),td3=document.createElement("td");
      const on=document.createElement("input");on.type="checkbox";on.checked=isStudentOnCourse(c,st.id);td0.appendChild(on);
      const cb=document.createElement("input");cb.type="checkbox";cb.checked=!!r;tdA.appendChild(cb);td1.textContent=st.canonicalName;td2.textContent=st.emails?.[0]||"";
      const inp=document.createElement("input");inp.className="aa-input aa-result-input";inp.value=r?.points??"";inp.disabled=!cb.checked;inp.placeholder="0-"+a.maxPoints;td3.appendChild(inp);cb.onchange=()=>{inp.disabled=!cb.checked};
      tr.append(td0,tdA,td1,td2,td3);tbody.appendChild(tr);rows.push({st,on,cb,inp});
    }
    table.appendChild(tbody);wrap.appendChild(table);body.appendChild(wrap);
    const foot=document.createElement("div");foot.className="aa-modal-foot";const close=()=>overlay.remove();
    foot.append(btn("Cancel",close),btn("Save",()=>{
      a.results||={};
      for(const r of rows){if(r.on.checked)activateStudent(c,r.st);else if(isStudentOnCourse(c,r.st.id))detachStudent(c,r.st.id);if(!r.cb.checked){delete a.results[r.st.id];continue}const points=num(r.inp.value);if(!Number.isFinite(points))return alert("Enter valid points for "+r.st.canonicalName+".");a.results[r.st.id]={...(a.results[r.st.id]||{}),points,editedAt:now()}}
      a.updatedAt=now();c.updatedAt=now();save();close();render();
    },"primary"));
    modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);overlay.onclick=ev=>{if(ev.target===overlay)close()};
  }


  function assessmentAsParts(a){
    if(hasParts(a))return a.parts.map(p=>({...p,results:{...(p.results||{})}}));
    return[{id:uid("part"),name:a.name,maxPoints:num(a.maxPoints)||0,effect:1,source:a.source?{...a.source}:{type:"manual"},results:{...(a.results||{})},createdAt:a.createdAt||now(),updatedAt:now()}];
  }

  function mergeAssessments(c,target,sources){
    const parts=ensureParts(target);
    for(const source of sources){
      if(!source||source.id===target.id)continue;
      for(const p of assessmentAsParts(source)){
        if(p.source?.reviewPath&&parts.some(x=>x.source?.reviewPath===p.source.reviewPath))continue;
        parts.push(p);
      }
      for(const st of Object.values(allKnownStudents(c))){
        st.weightingOverrides||={};
        if(Object.prototype.hasOwnProperty.call(st.weightingOverrides,source.id)&&!Object.prototype.hasOwnProperty.call(st.weightingOverrides,target.id))st.weightingOverrides[target.id]=st.weightingOverrides[source.id];
        delete st.weightingOverrides[source.id];
      }
      delete c.assessments[source.id];
    }
    target.source={type:"composite"};target.results={};syncCompositeMax(target);target.updatedAt=now();c.updatedAt=now();save();
  }

  function assessments(parent,c){
    const bar=document.createElement("div");bar.className="aa-toolbar";
    bar.appendChild(btn("+ Manual assessment",()=>{
      const n=prompt("Assessment name:");if(!n?.trim())return;
      const m=num(prompt("Maximum points:","100")),w=num(prompt("Weight %:","0"));
      if(!(m>0)||!(w>=0))return alert("Invalid maximum or weight.");
      const id=uid("assessment");c.assessments[id]={id,name:n.trim(),maxPoints:m,defaultWeight:w,type:"manual",source:{type:"manual"},results:{},createdAt:now(),updatedAt:now()};save();render();
    }));
    bar.appendChild(btn("+ Add exam",()=>openAddExamDialog(c),"primary"));
    if(IS_ABITTI)bar.appendChild(btn("Import current OmaAbitti exam",importDialog));
    const selected=new Set();
    bar.appendChild(btn("Combine selected as multipart",()=>{
      const list=[...selected].map(id=>c.assessments[id]).filter(Boolean);
      if(list.length<2)return alert("Select at least two assessments.");
      const target=list[0];
      if(!confirm('Combine '+list.length+' assessments into "'+target.name+'"? The first selected assessment keeps its name and course weight.'))return;
      mergeAssessments(c,target,list.slice(1));render();
    }));
    parent.appendChild(bar);

    const table=document.createElement("table");table.className="aa-table";
    table.innerHTML="<thead><tr><th></th><th>Assessment</th><th>Max</th><th>Weight %</th><th>Results</th><th></th></tr></thead>";
    const body=document.createElement("tbody");let total=0;
    for(const a of Object.values(c.assessments)){
      total+=num(a.defaultWeight)||0;
      const tr=document.createElement("tr"),pickTd=document.createElement("td"),pick=document.createElement("input");pick.type="checkbox";pick.onchange=()=>pick.checked?selected.add(a.id):selected.delete(a.id);pickTd.appendChild(pick);
      const n=document.createElement("input"),m=document.createElement("input"),w=document.createElement("input");
      n.className=m.className=w.className="aa-input";n.value=a.name;m.value=effectiveMax(a);w.value=a.defaultWeight;m.style.width=w.style.width="70px";
      if(hasParts(a)){m.readOnly=true;m.title="Combined maximum = sum of part maxima."}
      n.onchange=()=>{a.name=n.value.trim()||a.name;a.updatedAt=now();save();render()};
      m.onchange=()=>{if(hasParts(a))return render();const x=num(m.value);if(x>0){a.maxPoints=x;a.updatedAt=now();save()}render()};
      w.onchange=()=>{const x=num(w.value);if(x>=0){a.defaultWeight=x;a.updatedAt=now();save()}render()};
      const td1=document.createElement("td"),td2=document.createElement("td"),td3=document.createElement("td"),td4=document.createElement("td"),td5=document.createElement("td");
      td1.appendChild(n);td2.appendChild(m);td3.appendChild(w);td4.textContent=assessmentResultCount(a);
      if(hasParts(a))td5.appendChild(btn("Parts ("+a.parts.length+")",()=>manageAssessmentParts(c,a)));
      td5.append(btn("Students",()=>manageAssessmentStudents(c,a)),btn("Delete",()=>{
        if(!confirm('Delete "'+a.name+'" and all its results?'))return;
        delete c.assessments[a.id];for(const st of Object.values(allKnownStudents(c)))delete st.weightingOverrides?.[a.id];c.updatedAt=now();save();render();
      },"danger"));
      tr.append(pickTd,td1,td2,td3,td4,td5);body.appendChild(tr);
    }
    const tr=document.createElement("tr");tr.innerHTML="<td></td><td><strong>Total</strong></td><td></td><td><strong>"+fmt(total,1)+"%</strong></td><td colspan='2'>"+(Math.abs(total-100)<.001?"OK":"Weights are normalized when calculating.")+"</td>";
    body.appendChild(tr);table.appendChild(body);parent.appendChild(table);
  }

  function students(parent,c){
    ensureStudentPools(c);
    const bar=document.createElement("div");bar.className="aa-toolbar";
    bar.appendChild(btn("+ Student",()=>{const n=prompt("Student name:");if(n?.trim()){createStudent(c,{name:n,email:"",uuid:""});save();render()}}));
    const search=document.createElement("input");search.className="aa-input";search.placeholder="Filter students…";
    const selected=new Set();
    bar.append(search,btn("Remove selected from course",()=>{
      if(!selected.size)return alert("Select students first.");
      if(!confirm("Remove "+selected.size+" selected students from this course? Their assessment results will be kept so they can be restored."))return;
      for(const id of selected)detachStudent(c,id);save();render();
    },"danger"));parent.appendChild(bar);

    const table=document.createElement("table");table.className="aa-table";
    table.innerHTML="<thead><tr><th></th><th>Student</th><th>Email</th><th>Assessments</th><th>Assessment participation</th><th></th></tr></thead>";
    const body=document.createElement("tbody");table.appendChild(body);parent.appendChild(table);

    function draw(){
      body.innerHTML="";selected.clear();const needle=norm(search.value);
      const list=Object.values(c.students).filter(st=>!needle||names(st).some(n=>norm(n).includes(needle))||(st.emails||[]).some(e=>norm(e).includes(needle))).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"));
      for(const st of list){
        const tr=document.createElement("tr"),pickTd=document.createElement("td"),pick=document.createElement("input");pick.type="checkbox";pick.onchange=()=>pick.checked?selected.add(st.id):selected.delete(st.id);pickTd.appendChild(pick);
        const n=document.createElement("td");n.textContent=st.canonicalName;
        const e=document.createElement("td");e.textContent=(st.emails||[]).join(", ");
        const aas=Object.values(c.assessments).filter(a=>studentHasAssessmentResult(a,st.id));
        const count=document.createElement("td");count.textContent=aas.length+" / "+Object.keys(c.assessments).length;
        const chips=document.createElement("td");
        for(const a of aas){
          const chip=document.createElement("span");chip.className="aa-assessment-chip";
          const label=document.createElement("span");label.textContent=a.name;
          const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.title="Remove this assessment result";remove.onclick=()=>{if(confirm('Remove "'+a.name+'" from '+st.canonicalName+'?')){removeStudentFromAssessment(a,st.id);save();render()}};
          chip.append(label,remove);chips.appendChild(chip);
        }
        if(!aas.length){const none=document.createElement("span");none.className="aa-muted";none.textContent="None";chips.appendChild(none)}
        const actions=document.createElement("td");
        actions.append(btn("Edit",()=>{
          const nn=prompt("Canonical student name:",st.canonicalName);if(nn?.trim()){if(norm(nn)!==norm(st.canonicalName)&&norm(st.canonicalName)!=="unnamed student"){st.aliases||=[];st.aliases.push(st.canonicalName)}st.canonicalName=nn.trim()}
          const aa=prompt("Aliases separated by |",(st.aliases||[]).join(" | "));if(aa!==null)st.aliases=aa.split("|").map(x=>x.trim()).filter(Boolean);save();render();
        }),btn("Remove course",()=>{if(confirm("Remove "+st.canonicalName+" from this course? Results will be retained.")){detachStudent(c,st.id);save();render()}},"danger"));
        tr.append(pickTd,n,e,count,chips,actions);body.appendChild(tr);
      }
    }
    search.oninput=draw;draw();

    const detached=Object.values(c.detachedStudents||{});
    if(detached.length){
      const card=document.createElement("div");card.className="aa-card";card.innerHTML="<h3>Removed from course ("+detached.length+")</h3><div class='aa-muted aa-small'>Stored assessment results are retained.</div>";
      const list=document.createElement("div");list.className="aa-student-picker-scroll";
      for(const st of detached.sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){
        const row=document.createElement("div");row.className="aa-removed-student";
        const aas=Object.values(c.assessments).filter(a=>studentHasAssessmentResult(a,st.id));
        const info=document.createElement("span");info.textContent=st.canonicalName+" · "+aas.length+" assessment"+(aas.length===1?"":"s");
        row.append(info,btn("Add back",()=>{activateStudent(c,st);save();render()},"primary"),btn("Delete permanently",()=>{if(confirm("Permanently delete "+st.canonicalName+" and all stored results?")){deleteStudentPermanently(c,st.id);save();render()}},"danger"));list.appendChild(row);
      }
      card.appendChild(list);parent.appendChild(card);
    }
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
    c.grading||={};
    c.grading.finnishBoundaries||={...FINNISH};
    c.grading.ibBoundaries||={...IB};
    c.grading.customBoundaries||={};

    const calcCard=document.createElement("div");calcCard.className="aa-card";calcCard.innerHTML="<h3>Grade calculation</h3>";
    const preset=document.createElement("select");preset.className="aa-select";
    for(const [key,p] of Object.entries(GRADE_PRESETS)){const o=document.createElement("option");o.value=key;o.textContent=p.name;preset.appendChild(o)}
    const custom=document.createElement("option");custom.value="custom";custom.textContent="Custom";preset.appendChild(custom);
    preset.value=presetForCourse(c);

    const miss=document.createElement("select");miss.className="aa-select";
    miss.innerHTML='<option value="redistribute">Redistribute missing weight</option><option value="zero">Missing counts as zero</option>';
    miss.value=c.grading.missingPolicy||"redistribute";
    miss.onchange=()=>{c.grading.missingPolicy=miss.value;c.updatedAt=now();save();render()};

    calcCard.append("Boundary preset: ",preset,document.createElement("br"),document.createElement("br"),"Missing result: ",miss);

    const passWrap=document.createElement("div");passWrap.className="aa-pass-settings";
    const passTitle=document.createElement("div");passTitle.textContent="Pass threshold %";
    const passRow=document.createElement("div");passRow.className="aa-pass-row";
    const passSlider=document.createElement("input");passSlider.type="range";passSlider.min="0";passSlider.max="100";passSlider.step="1";
    const passNumber=document.createElement("input");passNumber.type="number";passNumber.min="0";passNumber.max="100";passNumber.step="1";passNumber.className="aa-input aa-pass-number";
    const syncPass=()=>{const v=Math.round(passThresholdForCourse(c));passSlider.value=String(v);passNumber.value=String(v)};
    const applyPass=value=>{
      try{
        const boundaries=currentBoundaries(c),p=GRADE_PRESETS[c.grading.presetKey],passGrade=p?.passGrade||c.grading.passGrade||inferredPassGrade(boundaries);
        c.grading.customBoundaries=adjustBoundariesToPass(boundaries,passGrade,value);
        c.grading.system="custom";c.grading.presetKey="custom";c.grading.passGrade=passGrade;c.grading.customName="Custom";
        c.updatedAt=now();save();render();
      }catch(e){alert("Could not adjust pass threshold: "+e.message)}
    };
    passSlider.oninput=()=>{passNumber.value=passSlider.value};
    passSlider.onchange=()=>applyPass(num(passSlider.value));
    passNumber.onchange=()=>applyPass(Math.max(0,Math.min(100,num(passNumber.value))));
    syncPass();passRow.append(passSlider,passNumber);passWrap.append(passTitle,passRow);calcCard.append(document.createElement("br"),passWrap);
    parent.appendChild(calcCard);

    const boundaryCard=document.createElement("div");boundaryCard.className="aa-card";
    boundaryCard.innerHTML="<h3>Grade boundaries</h3><div class='aa-muted aa-small'>Grade label → minimum percentage. Presets can be edited; edited presets become Custom.</div>";
    const area=document.createElement("textarea");area.className="aa-area aa-boundary-area";
    const loadArea=()=>{area.value=JSON.stringify(currentBoundaries(c),null,2)};
    loadArea();boundaryCard.appendChild(area);

    preset.onchange=()=>{
      if(preset.value==="custom"){
        c.grading.system="custom";c.grading.presetKey="custom";
        if(!Object.keys(c.grading.customBoundaries||{}).length)c.grading.customBoundaries={...currentBoundaries(c)};
      }else applyGradePreset(c,preset.value);
      c.updatedAt=now();save();loadArea();render();
    };

    const actions=document.createElement("div");actions.className="aa-toolbar";
    actions.append(
      btn("Save boundaries",()=>{
        try{
          const boundaries=validateBoundaries(JSON.parse(area.value));
          const key=preset.value;
          if(key!=="custom"&&JSON.stringify(boundaries)===JSON.stringify(GRADE_PRESETS[key].boundaries)){
            applyGradePreset(c,key);
          }else{
            c.grading.system="custom";c.grading.presetKey="custom";c.grading.customBoundaries=boundaries;c.grading.customName="Custom";preset.value="custom";
          }
          c.updatedAt=now();save();render();
        }catch(e){alert("Invalid grade boundaries: "+e.message)}
      },"primary"),
      btn("Export boundaries",()=>{
        const payload={format:"ArviointiApina-grade-boundaries-v1",name:c.grading.customName||GRADE_PRESETS[presetForCourse(c)]?.name||"Custom",boundaries:currentBoundaries(c)};
        download((c.name.replace(/[^\w-]+/g,"_")||"course")+"_grade-boundaries.json",JSON.stringify(payload,null,2),"application/json");
      }),
      btn("Import boundaries",()=>choose(".json,application/json",async file=>{
        try{
          const parsed=JSON.parse(await file.text());
          const boundaries=validateBoundaries(parsed.boundaries||parsed);
          c.grading.system="custom";c.grading.presetKey="custom";c.grading.customBoundaries=boundaries;c.grading.customName=String(parsed.name||file.name||"Custom");c.grading.passGrade=inferredPassGrade(boundaries);
          c.updatedAt=now();save();render();
        }catch(e){alert("Could not import grade boundaries: "+e.message)}
      }))
    );
    boundaryCard.appendChild(actions);parent.appendChild(boundaryCard);
  }

  function compactView(p){
    const content=document.createElement("div");content.className="aa-content";p.appendChild(content);const c=course();if(!c)return noCourse(content);const q=document.createElement("input");q.className="aa-input";q.placeholder="Search student...";q.style.width="100%";q.style.marginBottom="7px";content.appendChild(q);const list=document.createElement("div");content.appendChild(list);
    function draw(){list.innerHTML="";const needle=norm(q.value);for(const s of Object.values(c.students).filter(s=>!needle||names(s).some(n=>norm(n).includes(needle))).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){const x=calc(c,s),r=document.createElement("div");r.className="aa-mini";const n=document.createElement("div");n.className="aa-mini-name";n.textContent=s.canonicalName;const p=document.createElement("div");p.className="aa-muted aa-small";p.textContent=x.pct==null?"":fmt(x.pct,1)+"%";r.append(n,p,btn(x.grade||"—",async()=>{if(x.grade)await navigator.clipboard.writeText(x.grade)}));list.appendChild(r)}}q.oninput=draw;draw();
  }



  function nextGroupCode(index){
    const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return index<letters.length?letters[index]:"G"+(index+1);
  }

  function placementsForReviewPath(reviewPath){
    const out=[];
    for(const c of Object.values(db.courses)){
      for(const a of Object.values(c.assessments||{})){
        if(a.source?.reviewPath===reviewPath)out.push({course:c,assessment:a,part:null});
        for(const p of a.parts||[])if(p.source?.reviewPath===reviewPath)out.push({course:c,assessment:a,part:p});
      }
    }
    return out;
  }

  function placementEffect(x){
    return x.part?partEffect(x.part):1;
  }

  function removeAssessmentCompletely(c,a){
    delete c.assessments[a.id];
    for(const st of Object.values(c.students||{}))delete st.weightingOverrides?.[a.id];
  }

  function removeExamPlacement(c,x){
    if(x.part){
      x.assessment.parts=(x.assessment.parts||[]).filter(p=>p.id!==x.part.id);
      if(!x.assessment.parts.length)removeAssessmentCompletely(c,x.assessment);
      else{
        syncCompositeMax(x.assessment);
        x.assessment.updatedAt=now();
      }
    }else{
      removeAssessmentCompletely(c,x.assessment);
    }
    c.updatedAt=now();
  }

  function partFromPlacement(x,title){
    if(x.part)return x.part;
    return{
      id:uid("part"),
      name:x.assessment.name||title||"Exam part",
      maxPoints:num(x.assessment.maxPoints)||0,
      effect:1,
      source:x.assessment.source?{...x.assessment.source}:{type:"omaabitti"},
      results:{...(x.assessment.results||{})},
      createdAt:x.assessment.createdAt||now(),
      updatedAt:now()
    };
  }

  function movePlacementIntoAssessment(c,x,target,title){
    if(x.assessment.id===target.id){
      const parts=ensureParts(target);
      return x.part||parts.find(p=>p.source?.reviewPath===x.assessment.source?.reviewPath)||parts[0];
    }
    const part=partFromPlacement(x,title);
    if(x.part){
      x.assessment.parts=(x.assessment.parts||[]).filter(p=>p.id!==x.part.id);
      if(!x.assessment.parts.length)removeAssessmentCompletely(c,x.assessment);
      else syncCompositeMax(x.assessment);
    }else{
      removeAssessmentCompletely(c,x.assessment);
    }
    const parts=ensureParts(target);
    if(!parts.some(p=>p.source?.reviewPath===part.source?.reviewPath))parts.push(part);
    syncCompositeMax(target);target.updatedAt=now();c.updatedAt=now();
    return part;
  }

  function editPartScores(c,a,p){
    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
    const modal=document.createElement("div");modal.className="aa-modal";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Edit scores · "+p.name;
    const body=document.createElement("div");body.className="aa-modal-body";
    const table=document.createElement("table");table.className="aa-table";
    table.innerHTML="<thead><tr><th>Student</th><th>Points</th></tr></thead>";
    const tbody=document.createElement("tbody"),rows=[];
    for(const st of Object.values(c.students||{}).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"))){
      const tr=document.createElement("tr"),n=document.createElement("td"),v=document.createElement("td");
      n.textContent=st.canonicalName;
      const input=document.createElement("input");input.className="aa-input aa-result-input";input.value=p.results?.[st.id]?.points??"";input.placeholder="blank = no result";
      v.appendChild(input);tr.append(n,v);tbody.appendChild(tr);rows.push({st,input});
    }
    table.appendChild(tbody);body.appendChild(table);
    const foot=document.createElement("div");foot.className="aa-modal-foot";
    const close=()=>overlay.remove();
    foot.append(btn("Cancel",close),btn("Save scores",()=>{
      p.results||={};
      for(const {st,input} of rows){
        const raw=input.value.trim();
        if(!raw){delete p.results[st.id];continue}
        const points=num(raw);if(!Number.isFinite(points))return alert("Invalid score for "+st.canonicalName+".");
        p.results[st.id]={...(p.results[st.id]||{}),points,editedAt:now()};
      }
      p.updatedAt=now();a.updatedAt=now();c.updatedAt=now();save();close();render();setupGradingListPicker(true);
    },"primary"));
    modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);
    overlay.onclick=ev=>{if(ev.target===overlay)close()};
  }

  function editExamPlacements(reviewPath,title){
    const placements=placementsForReviewPath(reviewPath);
    if(!placements.length)return alert("This exam has not been added to any course yet.");

    const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
    const modal=document.createElement("div");modal.className="aa-modal";
    const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Exam / assessment settings · "+title;
    const body=document.createElement("div");body.className="aa-modal-body";
    const note=document.createElement("div");note.className="aa-muted aa-small";
    note.textContent="Each course is independent. For multi-part assessments, all related exams are shown here. Edit assessment weight, per-exam maximum/effect, student scores, or remove an exam from that course.";
    body.appendChild(note);

    const blocks=[];
    const seen=new Set();
    for(const placement of placements){
      const key=placement.course.id+"|"+placement.assessment.id;
      if(seen.has(key))continue;seen.add(key);
      const c=placement.course,a=placement.assessment;
      const card=document.createElement("div");card.className="aa-card aa-placement-card";
      const h=document.createElement("div");h.className="aa-placement-title";
      const name=document.createElement("strong");name.textContent=c.name+" · "+a.name;
      const weightLabel=document.createElement("label");weightLabel.textContent="Assessment weight % ";
      const weight=document.createElement("input");weight.className="aa-input aa-result-input";weight.value=a.defaultWeight??0;
      weightLabel.appendChild(weight);h.append(name,weightLabel);card.appendChild(h);

      const table=document.createElement("table");table.className="aa-table aa-placement-table";
      table.innerHTML="<thead><tr><th>Exam / part</th><th>Max</th><th>Effect</th><th>Results</th><th></th></tr></thead>";
      const tbody=document.createElement("tbody"),partEdits=[];

      if(hasParts(a)){
        for(const p of a.parts){
          const tr=document.createElement("tr");
          const n=document.createElement("td");n.textContent=p.name;
          if(p.source?.reviewPath===reviewPath)n.innerHTML="<strong>"+esc(p.name)+"</strong> <span class='aa-muted'>(selected)</span>";
          const mtd=document.createElement("td"),etd=document.createElement("td"),rtd=document.createElement("td"),actions=document.createElement("td");
          const max=document.createElement("input");max.className="aa-input aa-result-input";max.value=p.maxPoints;
          const effect=document.createElement("input");effect.className="aa-input aa-result-input";effect.value=partEffect(p);
          mtd.appendChild(max);etd.appendChild(effect);rtd.textContent=Object.keys(p.results||{}).length;
          actions.append(
            btn("Edit scores",()=>editPartScores(c,a,p)),
            btn("Remove from course",()=>{
              if(!confirm('Remove "'+p.name+'" from '+c.name+'? Student results for this exam in this course will be removed.'))return;
              removeExamPlacement(c,{course:c,assessment:a,part:p});save();overlay.remove();render();setupGradingListPicker(true);
            },"danger")
          );
          tr.append(n,mtd,etd,rtd,actions);tbody.appendChild(tr);partEdits.push({p,max,effect});
        }
      }else{
        const tr=document.createElement("tr");
        const n=document.createElement("td");n.innerHTML="<strong>"+esc(a.name)+"</strong> <span class='aa-muted'>(selected)</span>";
        const mtd=document.createElement("td"),etd=document.createElement("td"),rtd=document.createElement("td"),actions=document.createElement("td");
        const max=document.createElement("input");max.className="aa-input aa-result-input";max.value=a.maxPoints;
        mtd.appendChild(max);etd.textContent="—";rtd.textContent=Object.keys(a.results||{}).length;
        actions.append(
          btn("Edit scores",()=>manageAssessmentStudents(c,a)),
          btn("Remove from course",()=>{
            if(!confirm('Remove "'+a.name+'" from '+c.name+'?'))return;
            removeExamPlacement(c,{course:c,assessment:a,part:null});save();overlay.remove();render();setupGradingListPicker(true);
          },"danger")
        );
        tr.append(n,mtd,etd,rtd,actions);tbody.appendChild(tr);partEdits.push({p:null,max,effect:null});
      }

      table.appendChild(tbody);card.appendChild(table);body.appendChild(card);
      blocks.push({c,a,weight,partEdits});
    }

    const foot=document.createElement("div");foot.className="aa-modal-foot";
    const close=()=>overlay.remove();
    foot.append(btn("Cancel",close),btn("Save changes",()=>{
      for(const block of blocks){
        const w=num(block.weight.value);if(!(w>=0))return alert("Invalid assessment weight for "+block.c.name+".");
        block.a.defaultWeight=w;
        for(const edit of block.partEdits){
          const max=num(edit.max.value);if(!(max>0))return alert("Invalid maximum.");
          if(edit.p){
            const effect=num(edit.effect.value);if(!(effect>=0))return alert("Invalid exam effect.");
            edit.p.maxPoints=max;edit.p.effect=effect;edit.p.updatedAt=now();
          }else block.a.maxPoints=max;
        }
        syncCompositeMax(block.a);block.a.updatedAt=now();block.c.updatedAt=now();
      }
      save();close();render();setupGradingListPicker(true);
    },"primary"));
    modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);
    overlay.onclick=ev=>{if(ev.target===overlay)close()};
  }

  async function importGradingListBatch(selected,c){
    if(!selected.length)return;
    let importedExams=0,failed=0,studentsImported=0;

    const groupedSelections=new Map();
    for(const item of selected){
      const group=item.group.trim().toUpperCase();
      const key=group?"group:"+group:"exam:"+item.reviewPath;
      const arr=groupedSelections.get(key)||[];arr.push({...item,group});groupedSelections.set(key,arr);
    }

    for(const [key,items] of groupedSelections){
      const isGroup=key.startsWith("group:");
      let target=null;

      if(isGroup){
        // An already-imported selected exam anchors the group to its existing
        // assessment. This makes "existing exam + new exam = multipart" work.
        const existingPlacements=items.map(item=>({item,x:findReviewTarget(c,item.reviewPath)})).filter(v=>v.x);
        if(existingPlacements.length)target=existingPlacements[0].x.assessment;

        if(!target){
          const group=items[0].group;
          const id=uid("assessment");
          target=c.assessments[id]={
            id,name:"Multipart "+group,maxPoints:0,defaultWeight:0,type:"exam",
            source:{type:"composite"},results:{},parts:[],createdAt:now(),updatedAt:now()
          };
        }else{
          ensureParts(target);
        }

        // If other selected exams already live in separate assessments, merge
        // them into the anchored target because the shared group explicitly
        // requests one multipart assessment.
        for(const {item,x} of existingPlacements){
          if(x.assessment.id!==target.id)movePlacementIntoAssessment(c,x,target,item.title);
        }
      }

      const currentWeight=target?Math.max(0,num(target.defaultWeight)||0):0;
      const weightLabel=isGroup?("Multipart "+items[0].group):items[0].title;
      const weightInput=prompt('Course-grade weight % for "'+weightLabel+'":',String(currentWeight));
      if(weightInput===null){failed+=items.length;continue}
      const importWeight=num(weightInput);
      if(!(importWeight>=0)){alert("Invalid weight for "+weightLabel+".");failed+=items.length;continue}
      if(target)target.defaultWeight=importWeight;

      for(const item of items){
        let existing=findReviewTarget(c,item.reviewPath);

        if(!isGroup&&existing){
          // Already present as its own assessment: refresh its scores/max rather
          // than silently failing.
          target=existing.assessment;
          target.defaultWeight=importWeight;
        }

        let detected=null;
        if(location.hostname==="oma.abitti.fi"){
          const doc=await loadRenderedSameOriginPage(item.reviewPath,"#scoreTable tbody tr.student",15000);
          detected=detectedExamFromReviewDocument(doc,item.reviewPath,item.title);
        }else{
          const code=decodeURIComponent(item.reviewPath.split("/").filter(Boolean).pop()||"");
          try{detected=await detectedExamFromHeldExamCode(code,item.title)}catch(_){}
        }
        if(!detected?.students.length){failed++;continue}

        const studentSelection=await chooseImportStudents(c,detected);
        if(!studentSelection){failed++;continue}
        const selectedIndexes=new Set(studentSelection.selected);

        const maxInfo=await resolveDetectedMaxPoints(detected);
        let maxPoints=maxInfo?.value;
        if(!(maxPoints>0)){
          const manual=prompt('Could not calculate maximum points for "'+item.title+'". Enter maximum points:',"");
          if(manual===null){failed++;continue}
          maxPoints=num(manual);
          if(!(maxPoints>0)){failed++;continue}
        }

        if(isGroup){
          ensureParts(target);
          existing=findReviewTarget(c,item.reviewPath);
          let part=null;
          if(existing){
            if(existing.assessment.id!==target.id)part=movePlacementIntoAssessment(c,existing,target,item.title);
            else part=existing.part||target.parts.find(p=>p.source?.reviewPath===item.reviewPath);
          }
          if(!part){
            part={
              id:uid("part"),name:item.title,maxPoints,effect:1,
              source:{type:"omaabitti",reviewPath:item.reviewPath},results:{},
              createdAt:now(),updatedAt:now()
            };
            target.parts.push(part);
          }
          part.name=item.title;part.maxPoints=maxPoints;part.updatedAt=now();part.results||={};
          const stats=importSelectedIntoResults(c,part.results,selectedIndexes,studentSelection.existingOnly,detected);
          studentsImported+=stats.imported;syncCompositeMax(target);target.updatedAt=now();
        }else{
          existing=findReviewTarget(c,item.reviewPath);
          if(existing){
            if(existing.part){
              existing.part.name=item.title;existing.part.maxPoints=maxPoints;existing.part.updatedAt=now();
              const stats=importSelectedIntoResults(c,existing.part.results,selectedIndexes,studentSelection.existingOnly,detected);
              studentsImported+=stats.imported;syncCompositeMax(existing.assessment);
            }else{
              existing.assessment.name=item.title;existing.assessment.maxPoints=maxPoints;existing.assessment.updatedAt=now();
              const stats=importSelectedIntoResults(c,existing.assessment.results,selectedIndexes,studentSelection.existingOnly,detected);
              studentsImported+=stats.imported;
            }
          }else{
            const id=uid("assessment");
            const a=c.assessments[id]={
              id,name:item.title,maxPoints,defaultWeight:importWeight,type:"exam",
              source:{type:"omaabitti",reviewPath:item.reviewPath},results:{},createdAt:now(),updatedAt:now()
            };
            const stats=importSelectedIntoResults(c,a.results,selectedIndexes,studentSelection.existingOnly,detected);
            studentsImported+=stats.imported;
          }
        }
        importedExams++;
      }
    }

    c.updatedAt=now();save();render();
    alert(
      "Batch import complete.\n"+
      "Exams imported/updated: "+importedExams+
      "\nStudent results imported/updated: "+studentsImported+
      (failed?"\nSkipped/failed exams: "+failed:"")
    );
    setupGradingListPicker(true);
  }

  function parseGradingListDate(raw){
    const text=String(raw||"").replace(/\s+/g," ").trim();
    let m=text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if(m)return Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]));
    m=text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m)return Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]));
    const parsed=Date.parse(text);
    return Number.isFinite(parsed)?parsed:NaN;
  }

  function schoolYearForTimestamp(timestamp){
    if(!Number.isFinite(timestamp))return "";
    const d=new Date(timestamp),year=d.getUTCFullYear(),month=d.getUTCMonth()+1;
    const start=month>=8?year:year-1;
    return start+"–"+String(start+1).slice(-2);
  }

  function formatGradingListDate(timestamp,fallback=""){
    if(!Number.isFinite(timestamp))return fallback||"—";
    const d=new Date(timestamp);
    return String(d.getUTCDate()).padStart(2,"0")+"."+String(d.getUTCMonth()+1).padStart(2,"0")+"."+d.getUTCFullYear();
  }

  let gradingHeldExamMetaPromise=null;
  async function gradingHeldExamMeta(){
    if(gradingHeldExamMetaPromise)return gradingHeldExamMetaPromise;
    gradingHeldExamMetaPromise=(async()=>{
      try{
        const data=await abittiJson("/kurko-api/exam/held-exams");
        const map=new Map();
        for(const x of Array.isArray(data)?data:[]){
          const key=String(x.schoolAnonCode||x.uuid||"").trim();
          if(key)map.set(key,x);
        }
        return map;
      }catch(error){
        console.warn("ArviointiApina: could not load held-exam metadata",error);
        return new Map();
      }
    })();
    return gradingHeldExamMetaPromise;
  }

  async function setupGradingListPicker(force=false){
    if(!IS_GRADING_LIST)return;
    const nativeTable=document.querySelector("#held-exams");
    if(!nativeTable)return;

    if(force)document.querySelector("#aa-grading-manager")?.remove();

    const rawRows=[...nativeTable.querySelectorAll("tbody tr")];
    if(!rawRows.length)return;

    const heldMeta=await gradingHeldExamMeta();
    const items=[];
    rawRows.forEach((tr,index)=>{
      const reviewLink=[...tr.querySelectorAll("a[href]")].find(a=>{
        try{return new URL(a.getAttribute("href"),location.origin).pathname.startsWith("/school/review/")}catch(_){return false}
      });
      const gradingLink=[...tr.querySelectorAll("a[href]")].find(a=>{
        try{return /^\/school\/grading\/[^/]+\/?$/.test(new URL(a.getAttribute("href"),location.origin).pathname)}catch(_){return false}
      });

      let reviewPath="";
      if(reviewLink)reviewPath=new URL(reviewLink.getAttribute("href"),location.origin).pathname;
      else if(gradingLink){
        const p=new URL(gradingLink.getAttribute("href"),location.origin).pathname;
        const code=p.split("/").filter(Boolean).pop()||"";
        if(code)reviewPath="/school/review/"+encodeURIComponent(decodeURIComponent(code));
      }else{
        const visibleCode=tr.querySelector(".schoolAnonCode")?.textContent?.trim()||"";
        if(visibleCode)reviewPath="/school/review/"+encodeURIComponent(visibleCode);
      }
      if(!reviewPath)return;

      const code=decodeURIComponent(reviewPath.split("/").filter(Boolean).pop()||"");
      const meta=heldMeta.get(code)||null;
      const title=meta?.title||tr.querySelector(".examName")?.textContent?.trim()||"OmaAbitti exam";
      const dateCell=tr.querySelector(".examDate")||tr.querySelector("td");
      const nativeDate=dateCell?.textContent?.trim()||"";
      const dateSource=
        meta?.eventDate||
        dateCell?.querySelector("time")?.getAttribute("datetime")||
        dateCell?.getAttribute("datetime")||
        dateCell?.getAttribute("data-date")||
        dateCell?.getAttribute("title")||
        nativeDate;
      const dateValue=parseGradingListDate(dateSource);
      const date=formatGradingListDate(dateValue,nativeDate);
      const schoolYear=schoolYearForTimestamp(dateValue);
      items.push({tr,index,title,date,dateValue,schoolYear,reviewPath});
    });
    if(!items.length)return;

    const signature=items.map(x=>x.reviewPath+"|"+x.title+"|"+x.date).join("||");
    const existing=document.querySelector("#aa-grading-manager");
    if(!force&&existing?.dataset.signature===signature)return;
    existing?.remove();

    const manager=document.createElement("div");manager.id="aa-grading-manager";manager.dataset.signature=signature;
    const bar=document.createElement("div");bar.className="aa-manager-bar";
    const brand=document.createElement("strong");brand.textContent=APP_NAME;
    const managerBody=document.createElement("div");managerBody.className="aa-manager-body";
    const toggleManager=btn(db.settings.gradingManagerCollapsed?"Show":"Hide",()=>{
      db.settings.gradingManagerCollapsed=!db.settings.gradingManagerCollapsed;save();setupGradingListPicker(true);
    });
    const courseSelect=document.createElement("select");courseSelect.className="aa-select";
    for(const crs of Object.values(db.courses).sort((a,b)=>a.name.localeCompare(b.name,"fi"))){
      const o=document.createElement("option");o.value=crs.id;o.textContent=crs.name;o.selected=crs.id===db.settings.activeCourseId;courseSelect.appendChild(o);
    }
    courseSelect.onchange=()=>{db.settings.activeCourseId=courseSelect.value;save();render();setupGradingListPicker(true)};

    const addCourseBtn=btn("+ Course",async()=>{
      const c=await createCourseDialog();
      if(!c)return;
      render();
      setupGradingListPicker(true);
    });

    const schoolYearSelect=document.createElement("select");schoolYearSelect.className="aa-select";
    const allYears=document.createElement("option");allYears.value="__all__";allYears.textContent="All school years";schoolYearSelect.appendChild(allYears);
    const years=[...new Set(items.map(x=>x.schoolYear).filter(Boolean))].sort((a,b)=>b.localeCompare(a,"fi"));
    for(const year of years){const o=document.createElement("option");o.value=year;o.textContent=year;schoolYearSelect.appendChild(o)}
    const currentSchoolYear=schoolYearForTimestamp(Date.now());
    let preferred=db.settings.gradingListSchoolYear;
    if(preferred==null||preferred==="")preferred=years.includes(currentSchoolYear)?currentSchoolYear:(years[0]||"__all__");
    schoolYearSelect.value=[...schoolYearSelect.options].some(o=>o.value===preferred)?preferred:"__all__";
    db.settings.gradingListSchoolYear=schoolYearSelect.value;save();
    schoolYearSelect.onchange=()=>{db.settings.gradingListSchoolYear=schoolYearSelect.value;save();draw()};

    const examNameFilter=document.createElement("input");
    examNameFilter.className="aa-input aa-exam-name-filter";
    examNameFilter.placeholder="Filter exam name…";
    examNameFilter.value=db.settings.gradingListNameFilter||"";
    examNameFilter.oninput=()=>{db.settings.gradingListNameFilter=examNameFilter.value;save();draw()};

    const importBtn=btn("Add selected to gradebook",async()=>{
      let targetCourse=course();
      if(!targetCourse){
        targetCourse=await createCourseDialog("New course");
        if(!targetCourse)return;
      }
      const selected=rowStates.filter(r=>r.cb.checked).map(r=>({
        title:r.item.title,
        reviewPath:r.item.reviewPath,
        group:r.add.value.startsWith("group:")?r.add.value.slice(6):""
      }));
      if(!selected.length)return alert("Select at least one exam.");
      const summary=selected.map(x=>"• "+x.title+(x.group?" → multipart "+x.group.toUpperCase():" → separate assessment")).join("\n");
      if(!confirm("Add these exams to "+targetCourse.name+"?\n\n"+summary))return;
      importBtn.disabled=true;importBtn.textContent="Importing…";
      try{await importGradingListBatch(selected,targetCourse)}
      finally{importBtn.disabled=false;importBtn.textContent="Add selected to gradebook"}
    },"primary");

    bar.append(brand,toggleManager,document.createTextNode("Course:"),courseSelect,addCourseBtn,document.createTextNode("School year:"),schoolYearSelect,examNameFilter,importBtn);
    manager.appendChild(bar);
    managerBody.hidden=!!db.settings.gradingManagerCollapsed;
    manager.appendChild(managerBody);

    const table=document.createElement("table");table.className="aa-manager-table";
    const thead=document.createElement("thead"),headRow=document.createElement("tr");
    const sortableHeaders={};
    const makeSortHeader=(key,label)=>{
      const th=document.createElement("th");th.className="aa-sortable-head";th.dataset.sortKey=key;
      const text=document.createElement("span");text.textContent=label;
      const arrow=document.createElement("span");arrow.className="aa-sort-arrow";
      th.append(text,arrow);
      th.onclick=()=>{
        const current=db.settings.gradingListSort||"date-desc";
        const split=current.lastIndexOf("-");
        const currentKey=split>0?current.slice(0,split):current;
        const currentDir=split>0?current.slice(split+1):"desc";
        let dir;
        if(currentKey===key)dir=currentDir==="asc"?"desc":"asc";
        else dir=key==="date"?"desc":"asc";
        db.settings.gradingListSort=key+"-"+dir;save();draw();
      };
      sortableHeaders[key]={th,arrow};
      return th;
    };
    headRow.append(
      makeSortHeader("name","Exam"),
      makeSortHeader("date","Date"),
      Object.assign(document.createElement("th"),{textContent:"Add / group"}),
      makeSortHeader("added","Added to courses")
    );
    thead.appendChild(headRow);table.appendChild(thead);
    const tbody=document.createElement("tbody");table.appendChild(tbody);managerBody.appendChild(table);

    const rowStates=items.map(item=>{
      const cb=document.createElement("input");cb.type="checkbox";cb.className="aa-batch-check";
      const add=document.createElement("select");add.className="aa-select aa-add-group-select";
      const separate=document.createElement("option");separate.value="new";separate.textContent="New assessment";add.appendChild(separate);
      for(let i=1;i<=3;i++){
        const o=document.createElement("option");
        o.value="group:"+i;o.textContent="Multipart "+i;add.appendChild(o);
      }
      return{item,cb,add,row:null};
    });

    function draw(){
      const mode=db.settings.gradingListSort||"date-desc";
      const split=mode.lastIndexOf("-");
      const key=split>0?mode.slice(0,split):"date";
      const dir=split>0?mode.slice(split+1):"desc";
      const sign=dir==="asc"?1:-1;

      for(const [headerKey,obj] of Object.entries(sortableHeaders)){
        obj.th.classList.toggle("active",headerKey===key);
        obj.arrow.textContent=headerKey===key?(dir==="asc"?" ▲":" ▼"):"";
        obj.th.setAttribute("aria-sort",headerKey===key?(dir==="asc"?"ascending":"descending"):"none");
      }

      const selectedSchoolYear=schoolYearSelect.value;
      const examNameNeedle=norm(examNameFilter.value);
      const sorted=rowStates.filter(state=>{
        const schoolYearMatch=selectedSchoolYear==="__all__"||state.item.schoolYear===selectedSchoolYear;
        const nameMatch=!examNameNeedle||norm(state.item.title).includes(examNameNeedle);
        return schoolYearMatch&&nameMatch;
      }).sort((a,b)=>{
        let v=0;
        if(key==="name"){
          v=a.item.title.localeCompare(b.item.title,"fi",{sensitivity:"base"});
        }else if(key==="added"){
          const av=placementsForReviewPath(a.item.reviewPath).length;
          const bv=placementsForReviewPath(b.item.reviewPath).length;
          v=av-bv;
          if(v===0)v=a.item.title.localeCompare(b.item.title,"fi",{sensitivity:"base"});
        }else{
          const av=Number.isFinite(a.item.dateValue)?a.item.dateValue:-Infinity;
          const bv=Number.isFinite(b.item.dateValue)?b.item.dateValue:-Infinity;
          v=av-bv;
          if(v===0)v=a.item.title.localeCompare(b.item.title,"fi",{sensitivity:"base"});
        }
        return v*sign;
      });

      tbody.innerHTML="";
      for(const state of sorted){
        const item=state.item,tr=document.createElement("tr");state.row=tr;
        const n=document.createElement("td");n.className="aa-manager-exam";n.textContent=item.title;
        const d=document.createElement("td");d.textContent=item.date||"—";
        const sel=document.createElement("td");sel.className="aa-manager-select";
        sel.append(state.cb,state.add);

        const courses=document.createElement("td");courses.className="aa-manager-courses";
        const placements=placementsForReviewPath(item.reviewPath);
        if(!placements.length){
          const none=document.createElement("span");none.className="aa-muted";none.textContent="Not added";courses.appendChild(none);
        }else{
          const grouped=new Map();
          for(const x of placements){
            const arr=grouped.get(x.course.id)||[];arr.push(x);grouped.set(x.course.id,arr);
          }
          for(const arr of grouped.values()){
            const x=arr[0],chip=document.createElement("button");chip.type="button";chip.className="aa-course-chip";
            const effect=x.part?" · effect "+fmt(partEffect(x.part),2):"";
            chip.textContent=x.course.name+" · "+fmt(num(x.assessment.defaultWeight)||0,1)+"% · "+x.assessment.name+effect;
            chip.title="Open assessment: edit weight, related exam parts, scores, or remove from course";
            chip.onclick=()=>editExamPlacements(item.reviewPath,item.title);
            courses.appendChild(chip);
          }
        }

        tr.append(n,d,sel,courses);tbody.appendChild(tr);
      }
    }

    draw();
    nativeTable.parentElement?.insertBefore(manager,nativeTable);
  }

  function chooseAssessmentDestination(c){
    return new Promise(resolve=>{
      const overlay=document.createElement("div");overlay.className="aa-modal-overlay";
      const modal=document.createElement("div");modal.className="aa-modal";
      const head=document.createElement("div");head.className="aa-modal-head";head.textContent="Add OmaAbitti exam";
      const body=document.createElement("div");body.className="aa-modal-body";
      const note=document.createElement("div");note.className="aa-muted aa-small";
      note.textContent="Choose whether this exam becomes a new assessment or another part of an existing assessment.";
      body.appendChild(note);

      const options=document.createElement("div");options.className="aa-destination-options";

      const newCard=document.createElement("button");
      newCard.type="button";newCard.className="aa-destination-card";
      newCard.innerHTML="<strong>New assessment</strong><span>Create a separate weighted assessment for this OmaAbitti exam.</span>";
      options.appendChild(newCard);

      const close=v=>{overlay.remove();resolve(v)};
      newCard.onclick=()=>close({type:"new"});

      const assessments=Object.values(c.assessments).sort((a,b)=>a.name.localeCompare(b.name,"fi"));
      for(const a of assessments){
        const card=document.createElement("button");card.type="button";card.className="aa-destination-card";
        const parts=hasParts(a)?a.parts.length:1;
        card.innerHTML="<strong>"+esc(a.name)+"</strong><span>Add as another exam part · "+parts+" existing part"+(parts===1?"":"s")+"</span>";
        card.onclick=()=>close({type:"existing",assessment:a});
        options.appendChild(card);
      }

      body.appendChild(options);
      const foot=document.createElement("div");foot.className="aa-modal-foot";
      foot.appendChild(btn("Cancel",()=>close(null)));
      modal.append(head,body,foot);overlay.appendChild(modal);document.body.appendChild(overlay);
      overlay.onclick=ev=>{if(ev.target===overlay)close(null)};
    });
  }

  async function importDialog(){
    const detected=detectExam();
    if(!detected?.students.length)return alert("No OmaAbitti results detected.");
    if(!detected.students.some(st=>st.name&&norm(st.name)!=="unnamed student"))return alert("Student names could not be detected. Import stopped.");

    let c=course();
    if(!c){
      c=await createCourseDialog(detected.name.split(":")[0].trim());
      if(!c)return;
    }

    const maxInfo=await resolveDetectedMaxPoints(detected);
    detected.maxPoints=maxInfo?.value??null;
    detected.maxSource=maxInfo?.source||null;

    const existingTarget=findReviewTarget(c,detected.reviewPath);
    if(existingTarget?.part){
      const part=existingTarget.part,a=existingTarget.assessment;
      const partName=prompt("Exam part name:",part.name);if(!partName?.trim())return;
      const max=prompt((detected.maxPoints?"Maximum possible points (calculated from question maxima):":"Maximum possible points (automatic calculation failed; enter manually):"),part.maxPoints||detected.maxPoints||"");if(max===null)return;
      const weightInput=prompt("Course-grade weight % for "+a.name+":",String(Math.max(0,num(a.defaultWeight)||0)));if(weightInput===null)return;
      const weight=num(weightInput);if(!(weight>=0))return alert("Invalid weight.");a.defaultWeight=weight;
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

    let target=null;
    if(Object.keys(c.assessments).length){
      const destination=await chooseAssessmentDestination(c);
      if(!destination)return;
      if(destination.type==="existing")target=destination.assessment;
    }

    if(target){
      const partName=prompt("Exam part name:",detected.name);if(!partName?.trim())return;
      const max=prompt((detected.maxPoints?"Maximum possible points (calculated from OmaAbitti answer paper):":"Maximum possible points (automatic calculation failed; enter manually):"),detected.maxPoints||"");if(max===null)return;
      const weightInput=prompt("Course-grade weight % for "+target.name+":",String(Math.max(0,num(target.defaultWeight)||0)));if(weightInput===null)return;
      const weight=num(weightInput);if(!(weight>=0))return alert("Invalid weight.");target.defaultWeight=weight;
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

  cleanupPhantomCompositeParts();

  if(typeof GM_addValueChangeListener==="function"){
    GM_addValueChangeListener(KEY,(_name,_oldValue,newValue,remote)=>{
      if(!remote)return;
      try{
        const parsed=typeof newValue==="string"?JSON.parse(newValue):newValue;
        if(parsed&&typeof parsed==="object"){
          db={...fresh(),...parsed,settings:{...fresh().settings,...(parsed.settings||{})},courses:parsed.courses||{}};
          cleanupPhantomCompositeParts();
          render();
          if(IS_GRADING_LIST)setTimeout(()=>setupGradingListPicker(true).catch(()=>{}),0);
        }
      }catch(error){
        console.warn("ArviointiApina: could not sync remote gradebook changes",error);
      }
    });
  }

  ensureRoot();render();

  if(IS_GRADING_LIST){
    let gradingPickerTimer=null;
    const installPicker=()=>{setupGradingListPicker(false).catch(error=>console.error("ArviointiApina grading-list setup failed",error))};
    installPicker();
    const observer=new MutationObserver(()=>{
      clearTimeout(gradingPickerTimer);
      gradingPickerTimer=setTimeout(()=>{
        const table=document.querySelector("#held-exams");
        if(!table)return;
        const hasRows=!!table.querySelector("tbody tr");
        const hasControls=!!table.querySelector("tbody tr > .aa-batch-cell");
        const hasBar=!!document.querySelector("#aa-grading-batchbar");
        if(hasRows&&(!hasControls||!hasBar||table.dataset.aaBatch!=="1"))installPicker();
      },120);
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
})();