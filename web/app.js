const STORAGE_KEY = "arviointiapina_web_v1";

const FINNISH = {"10":90,"9½":85,"9":80,"8½":75,"8":70,"7½":65,"7":60,"6½":55,"6":50,"5½":45,"5":40,"4½":30,"4":0};
const IB = {"7":85,"6":70,"5":55,"4":40,"3":25,"2":10,"1":0};

const $ = (s) => document.querySelector(s);
const uid = (p="id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
const num = (v) => { const n = Number(String(v ?? "").trim().replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim();

function freshDB(){
  return {version:1, activeCourseId:null, courses:{}};
}
function load(){
  try { return {...freshDB(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")}; }
  catch { return freshDB(); }
}
let db = load();
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
const course = () => db.courses[db.activeCourseId] || null;

function createCourse(name){
  const id=uid("course");
  db.courses[id]={id,name:name.trim()||"Untitled course",students:{},assessments:{},grading:{system:"finnish",missingPolicy:"redistribute",finnishBoundaries:{...FINNISH},ibBoundaries:{...IB}},createdAt:new Date().toISOString()};
  db.activeCourseId=id; save(); render();
}
function createStudent(c,name,email=""){
  const id=uid("student");
  c.students[id]={id,canonicalName:name.trim()||email.trim()||"Unnamed student",aliases:[],emails:email.trim()?[email.trim().toLowerCase()]:[],weightingOverrides:{}};
  return c.students[id];
}
function createAssessment(c,name,max=100,weight=0){
  const id=uid("assessment");
  c.assessments[id]={id,name:name.trim()||"Assessment",maxPoints:max,defaultWeight:weight,results:{}};
  return c.assessments[id];
}
function weightFor(student,a){
  return Object.prototype.hasOwnProperty.call(student.weightingOverrides||{},a.id)
    ? Math.max(0,num(student.weightingOverrides[a.id])||0)
    : Math.max(0,num(a.defaultWeight)||0);
}
function gradeFor(c,pct){
  const b=c.grading.system==="ib"?c.grading.ibBoundaries:c.grading.finnishBoundaries;
  return Object.entries(b||{}).map(([grade,t])=>[grade,num(t)]).filter(([,t])=>Number.isFinite(t)).sort((a,b)=>b[1]-a[1]).find(([,t])=>pct>=t)?.[0] || "";
}
function calculate(c,s){
  let total=0, used=0;
  for(const a of Object.values(c.assessments)){
    const w=weightFor(s,a), max=num(a.maxPoints), raw=a.results?.[s.id]?.points, p=num(raw);
    const has=Number.isFinite(p)&&Number.isFinite(max)&&max>0;
    if(has){ total+=(p/max*100)*w; used+=w; }
    else if(c.grading.missingPolicy==="zero"){ used+=w; }
  }
  const pct=used>0?total/used:null;
  return {pct,grade:pct==null?"":gradeFor(c,pct)};
}
function toast(msg){
  const el=$("#toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),1800);
}
function download(name,text,type){
  const u=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement("a"); a.href=u;a.download=name;a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000);
}
function csvCell(v,sep=";"){ const s=String(v??""); return /["\r\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }

function render(){
  ensureCourse();
  const c=course();
  const select=$("#course-select");
  select.innerHTML="";
  for(const item of Object.values(db.courses).sort((a,b)=>a.name.localeCompare(b.name,"fi"))){
    const o=document.createElement("option"); o.value=item.id;o.textContent=item.name;o.selected=item.id===db.activeCourseId;select.append(o);
  }
  if(!c){ $("#course-title").textContent="No course"; $("#course-meta").textContent="Create a course to begin"; $("#summary").innerHTML=""; $("#gradebook thead").innerHTML=""; $("#gradebook tbody").innerHTML=""; return; }
  $("#course-title").textContent=c.name;
  $("#course-meta").textContent=`${Object.keys(c.students).length} students · ${Object.keys(c.assessments).length} assessments`;
  $("#grading-system").value=c.grading.system;
  $("#missing-policy").value=c.grading.missingPolicy;
  renderSummary(c); renderTable(c);
}
function ensureCourse(){
  if(db.activeCourseId && db.courses[db.activeCourseId]) return;
  db.activeCourseId=Object.keys(db.courses)[0]||null; save();
}
function renderSummary(c){
  const students=Object.values(c.students), assessments=Object.values(c.assessments);
  const grads=students.map(s=>calculate(c,s).pct).filter(Number.isFinite);
  const avg=grads.length?grads.reduce((a,b)=>a+b,0)/grads.length:null;
  const totalW=assessments.reduce((n,a)=>n+(num(a.defaultWeight)||0),0);
  $("#summary").innerHTML=[
    ["Students",students.length],["Assessments",assessments.length],
    ["Class weighted avg",avg==null?"—":avg.toFixed(1)+"%"],["Default weights",totalW.toFixed(1)+"%"]
  ].map(([l,v])=>`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join("");
}
function renderTable(c){
  const q=norm($("#student-search").value);
  const students=Object.values(c.students).filter(s=>!q||[s.canonicalName,...(s.aliases||[])].some(n=>norm(n).includes(q))).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,"fi"));
  const assessments=Object.values(c.assessments);
  const totalW=assessments.reduce((n,a)=>n+(num(a.defaultWeight)||0),0);
  const ws=$("#weight-status"); ws.textContent=`Weights ${totalW.toFixed(1)}%`; ws.classList.toggle("bad",Math.abs(totalW-100)>.001);

  const tr=document.createElement("tr");
  tr.innerHTML='<th class="student">Student</th>';
  for(const a of assessments){
    const th=document.createElement("th"); th.className="assessment-head";
    th.innerHTML=`<input data-role="assessment-name" data-id="${a.id}" value="${escapeAttr(a.name)}">
      <div class="assessment-meta">
        <input data-role="assessment-max" data-id="${a.id}" value="${a.maxPoints}" title="Maximum points">
        <input data-role="assessment-weight" data-id="${a.id}" value="${a.defaultWeight}" title="Weight %">
        <button class="icon-btn danger" data-role="assessment-delete" data-id="${a.id}" title="Delete">×</button>
      </div>`;
    tr.append(th);
  }
  tr.insertAdjacentHTML("beforeend","<th>Weighted</th><th>Grade</th><th></th>");
  $("#gradebook thead").replaceChildren(tr);

  const body=$("#gradebook tbody"); body.innerHTML="";
  for(const s of students){
    const row=document.createElement("tr");
    const name=document.createElement("td"); name.className="student"; name.innerHTML=`<span>${escapeHtml(s.canonicalName)}</span>`; row.append(name);
    for(const a of assessments){
      const td=document.createElement("td"), value=a.results?.[s.id]?.points ?? "";
      const input=document.createElement("input"); input.className="cell-input"; input.value=value; input.placeholder="—";
      input.addEventListener("change",()=>{ const v=input.value.trim(); if(!v) delete a.results[s.id]; else { const n=num(v); if(!Number.isFinite(n)){alert("Invalid score");return render();} a.results[s.id]={points:n}; } save(); render(); });
      td.append(input);
      if(Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)){ const b=document.createElement("span");b.className="pill";b.textContent=`${weightFor(s,a)}%`;td.append(b); }
      row.append(td);
    }
    const calc=calculate(c,s);
    const pct=document.createElement("td"); pct.textContent=calc.pct==null?"—":calc.pct.toFixed(1)+"%"; row.append(pct);
    const grade=document.createElement("td"); const gb=document.createElement("button");gb.className="grade-button";gb.textContent=calc.grade||"—";gb.onclick=()=>calc.grade&&navigator.clipboard.writeText(calc.grade).then(()=>toast("Grade copied"));grade.append(gb);row.append(grade);
    const actions=document.createElement("td");
    const wb=document.createElement("button");wb.className="small";wb.textContent="Weights";wb.onclick=()=>openWeights(c,s);
    const dbtn=document.createElement("button");dbtn.className="small danger";dbtn.textContent="Delete";dbtn.onclick=()=>{if(confirm(`Delete ${s.canonicalName} and all course results?`)){delete c.students[s.id]; for(const a of assessments) delete a.results[s.id]; save();render();}};
    actions.append(wb,dbtn);row.append(actions);body.append(row);
  }

  document.querySelectorAll('[data-role="assessment-name"]').forEach(el=>el.onchange=()=>{c.assessments[el.dataset.id].name=el.value.trim()||"Assessment";save();render();});
  document.querySelectorAll('[data-role="assessment-max"]').forEach(el=>el.onchange=()=>{const n=num(el.value);if(!(n>0)){alert("Maximum must be greater than 0");return render();}c.assessments[el.dataset.id].maxPoints=n;save();render();});
  document.querySelectorAll('[data-role="assessment-weight"]').forEach(el=>el.onchange=()=>{const n=num(el.value);if(!(n>=0)){alert("Weight must be 0 or greater");return render();}c.assessments[el.dataset.id].defaultWeight=n;save();render();});
  document.querySelectorAll('[data-role="assessment-delete"]').forEach(el=>el.onclick=()=>{const a=c.assessments[el.dataset.id];if(confirm(`Delete assessment "${a.name}" and its results?`)){delete c.assessments[a.id];for(const s of Object.values(c.students))delete s.weightingOverrides?.[a.id];save();render();}});
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function escapeAttr(s){return escapeHtml(s);}

let weightsStudentId=null;
function openWeights(c,s){
  weightsStudentId=s.id; $("#weights-student").textContent=s.canonicalName; const wrap=$("#weights-fields"); wrap.innerHTML="";
  for(const a of Object.values(c.assessments)){
    const row=document.createElement("label");row.className="weight-row";row.innerHTML=`<span>${escapeHtml(a.name)} <span class="muted">(default ${a.defaultWeight}%)</span></span><input data-weight-id="${a.id}" placeholder="${a.defaultWeight}" value="${Object.prototype.hasOwnProperty.call(s.weightingOverrides||{},a.id)?s.weightingOverrides[a.id]:""}">`;wrap.append(row);
  }
  $("#weights-dialog").showModal();
}
$("#save-weights").onclick=()=>{const c=course(),s=c?.students[weightsStudentId];if(!s)return;s.weightingOverrides={};document.querySelectorAll("[data-weight-id]").forEach(el=>{if(el.value.trim()){const n=num(el.value);if(Number.isFinite(n)&&n>=0)s.weightingOverrides[el.dataset.weightId]=n;}});save();$("#weights-dialog").close();render();};
$("#reset-weights").onclick=()=>{const s=course()?.students[weightsStudentId];if(s){s.weightingOverrides={};save();$("#weights-dialog").close();render();}};

$("#add-course").onclick=()=>{const n=prompt("Course/class name:");if(n?.trim())createCourse(n);};
$("#course-select").onchange=(e)=>{db.activeCourseId=e.target.value;save();render();};
$("#rename-course").onclick=()=>{const c=course();if(!c)return;const n=prompt("Course name:",c.name);if(n?.trim()){c.name=n.trim();save();render();}};
$("#delete-course").onclick=()=>{const c=course();if(c&&confirm(`Delete "${c.name}" and all of its data?`)){delete db.courses[c.id];db.activeCourseId=null;save();render();}};
$("#add-student").onclick=()=>{const c=course();if(!c)return;const n=prompt("Student name:");if(!n?.trim())return;const e=prompt("Email (optional):","")??"";createStudent(c,n,e);save();render();};
$("#add-assessment").onclick=()=>{const c=course();if(!c)return;const n=prompt("Assessment name:");if(!n?.trim())return;const max=num(prompt("Maximum points:","100"));const w=num(prompt("Weight %:","0"));if(!(max>0)||!(w>=0))return alert("Invalid maximum or weight");createAssessment(c,n,max,w);save();render();};
$("#student-search").oninput=()=>renderTable(course());
$("#grading-system").onchange=e=>{const c=course();if(c){c.grading.system=e.target.value;save();render();}};
$("#missing-policy").onchange=e=>{const c=course();if(c){c.grading.missingPolicy=e.target.value;save();render();}};
$("#edit-boundaries").onclick=()=>{const c=course();if(!c)return;$("#boundaries-json").value=JSON.stringify(c.grading.system==="ib"?c.grading.ibBoundaries:c.grading.finnishBoundaries,null,2);$("#boundaries-dialog").showModal();};
$("#save-boundaries").onclick=()=>{const c=course();try{const x=JSON.parse($("#boundaries-json").value);for(const v of Object.values(x))if(!Number.isFinite(num(v)))throw new Error("All thresholds must be numeric.");if(c.grading.system==="ib")c.grading.ibBoundaries=x;else c.grading.finnishBoundaries=x;save();$("#boundaries-dialog").close();render();}catch(e){alert(e.message);}};

$("#export-backup").onclick=()=>download(`arviointiapina-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({type:"ArviointiApina",version:1,database:db},null,2),"application/json");
$("#restore-backup").onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const p=JSON.parse(await f.text());const next=p.database||p;if(!next.courses)throw new Error("Not an ArviointiApina backup");if(confirm("Replace the current local gradebook with this backup?")){db={...freshDB(),...next};save();render();}}catch(err){alert(err.message);}e.target.value="";};

$("#export-csv").onclick=()=>{const c=course();if(!c)return;const as=Object.values(c.assessments);const head=["Student","Email",...as.flatMap(a=>[`${a.name} Points`,`${a.name} Max`,`${a.name} Weight`]),"Weighted %","Final Grade"];const lines=[head.map(csvCell).join(";")];for(const s of Object.values(c.students)){const calc=calculate(c,s),row=[s.canonicalName,s.emails?.[0]||""];for(const a of as){row.push(a.results?.[s.id]?.points??"",a.maxPoints,weightFor(s,a));}row.push(calc.pct==null?"":calc.pct.toFixed(2),calc.grade);lines.push(row.map(csvCell).join(";"));}download(`${c.name.replace(/[^\w-]+/g,"_")}_gradebook.csv`,"\uFEFF"+lines.join("\r\n"),"text/csv;charset=utf-8");};

function parseCSV(text){
  const first=text.split(/\r?\n/)[0]||"", sep=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?";":",";
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=ch;continue;}if(ch==='"')quoted=true;else if(ch===sep){row.push(cell);cell="";}else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);cell="";if(row.some(x=>x.trim()))rows.push(row);row=[];}else cell+=ch;}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
$("#import-csv").onchange=async e=>{const file=e.target.files?.[0],c=course();if(!file||!c)return;try{const rows=parseCSV(await file.text());const h=rows.shift().map(x=>x.trim());const si=h.findIndex(x=>/^student$/i.test(x)),ei=h.findIndex(x=>/^email$/i.test(x));if(si<0)throw new Error('CSV needs a "Student" column.');const cols=[];for(let i=0;i<h.length;i++){const m=h[i].match(/^(.*) Points$/i);if(m)cols.push({name:m[1].trim(),pi:i,mi:h.findIndex(x=>x.toLowerCase()===`${m[1].trim()} max`.toLowerCase()),wi:h.findIndex(x=>x.toLowerCase()===`${m[1].trim()} weight`.toLowerCase())});}if(!cols.length)throw new Error('No "* Points" assessment columns found.');const amap={};for(const col of cols){amap[col.name]=Object.values(c.assessments).find(a=>a.name.toLowerCase()===col.name.toLowerCase())||createAssessment(c,col.name,100,0);}for(const r of rows){const name=String(r[si]||"").trim();if(!name)continue;const email=ei>=0?String(r[ei]||"").trim().toLowerCase():"";let s=Object.values(c.students).find(x=>norm(x.canonicalName)===norm(name))||(email?Object.values(c.students).find(x=>(x.emails||[]).includes(email)):null);if(!s)s=createStudent(c,name,email);else if(norm(s.canonicalName)!==norm(name)&&!(s.aliases||[]).some(a=>norm(a)===norm(name)))s.aliases.push(name);for(const col of cols){const a=amap[col.name],p=num(r[col.pi]),m=col.mi>=0?num(r[col.mi]):NaN,w=col.wi>=0?num(r[col.wi]):NaN;if(m>0)a.maxPoints=m;if(w>=0)a.defaultWeight=w;if(Number.isFinite(p))a.results[s.id]={points:p};}}save();render();toast("CSV imported");}catch(err){alert(err.message);}e.target.value="";};

if(!Object.keys(db.courses).length) createCourse("My course"); else render();
