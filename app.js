const API = "https://api.openf1.org/v1";
const $ = (id) => document.getElementById(id);
const state = {
  year: new Date().getFullYear(),
  meetings: [], sessions: [], meeting: null, session: null,
  events: [], drivers: new Map(), results: [], duration: 0,
  offset: Number(localStorage.getItem("fh_offset") || 0),
  standby: localStorage.getItem("fh_standby") !== "false",
  enabled: new Set(JSON.parse(localStorage.getItem("fh_enabled") || '["FLAG_GREEN","FLAG_YELLOW","FLAG_RED","FLAG_CHEQUERED","SAFETY_CAR","VSC","PIT_STOP","OVERTAKE","PENALTY","INCIDENT","FASTEST_LAP","TYRE_CHANGE"]')),
  playing: false, anchor: 0, pausedAt: 0, current: 0, fired: new Set(), timer: null, toastTimer: null
};
const EVENT_META = {
  FLAG_GREEN:{label:"Groene vlag",icon:"🟢",tone:"green",color:"#31dc86"},
  FLAG_YELLOW:{label:"Gele vlag",icon:"🟡",tone:"yellow",color:"#ffd34e"},
  FLAG_DOUBLE_YELLOW:{label:"Dubbel geel",icon:"🟡",tone:"yellow",color:"#ffd34e"},
  FLAG_RED:{label:"Rode vlag",icon:"🔴",tone:"red",color:"#ff4d5d"},
  FLAG_BLUE:{label:"Blauwe vlag",icon:"🔵",tone:"blue",color:"#4d87ff"},
  FLAG_BLACK:{label:"Zwarte vlag",icon:"⚫",tone:"orange",color:"#9aa5b5"},
  FLAG_BLACK_WHITE:{label:"Zwart-wit vlag",icon:"◐",tone:"orange",color:"#e5eaf2"},
  FLAG_CHEQUERED:{label:"Finishvlag",icon:"🏁",tone:"orange",color:"#e5eaf2"},
  SAFETY_CAR:{label:"Safety Car",icon:"🚗",tone:"yellow",color:"#ffd34e"},
  VSC:{label:"Virtual Safety Car",icon:"⚠️",tone:"yellow",color:"#ffd34e"},
  PIT_STOP:{label:"Pitstop",icon:"🛠️",tone:"blue",color:"#4d87ff"},
  OVERTAKE:{label:"Inhaalactie",icon:"↗",tone:"green",color:"#31dc86"},
  PENALTY:{label:"Straf / waarschuwing",icon:"⚖️",tone:"red",color:"#ff4d5d"},
  INCIDENT:{label:"Incident",icon:"⚠️",tone:"orange",color:"#ff8a55"},
  FASTEST_LAP:{label:"Snelste ronde",icon:"⏱️",tone:"blue",color:"#4d87ff"},
  TYRE_CHANGE:{label:"Bandenset",icon:"🛞",tone:"blue",color:"#4d87ff"},
  SESSION:{label:"Race Control",icon:"🏁",tone:"orange",color:"#ff8a55"}
};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, params) {
  const url = new URL(API + "/" + path);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k, String(v)));
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 22000);
  try {
    const response = await fetch(url, {signal:controller.signal, headers:{Accept:"application/json"}});
    if (!response.ok) throw new Error("OpenF1 antwoordde met HTTP " + response.status);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
function setStatus(message, busy=false) {
  $("dataStatus").textContent = message;
  $("loadRaceButton").disabled = busy || !state.session;
  $("loadRaceButton").innerHTML = busy ? "⏳ Events ophalen…" : "<span>↗</span> Laad race-events";
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(()=>el.classList.remove("show"), 3100);
}
function formatClock(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds)||0));
  const h = Math.floor(seconds/3600), m = Math.floor((seconds%3600)/60), s = seconds%60;
  return h ? [h,m,s].map(v=>String(v).padStart(2,"0")).join(":") : [m,s].map(v=>String(v).padStart(2,"0")).join(":");
}
function driverName(number) {
  if (number == null) return "Onbekende coureur";
  const d = state.drivers.get(Number(number));
  return d?.full_name || d?.broadcast_name || ("Coureur #" + number);
}
function driverTeam(number) { return state.drivers.get(Number(number))?.team_name || ""; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function raceControlType(item) {
  const flag = String(item.flag||"").toUpperCase().replaceAll(" ","_");
  const msg = String(item.message||"").toUpperCase();
  if (flag.includes("CHEQUERED") || msg.includes("CHEQUERED")) return "FLAG_CHEQUERED";
  if (flag.includes("BLACK_AND_WHITE") || msg.includes("BLACK AND WHITE")) return "FLAG_BLACK_WHITE";
  if (flag.includes("DOUBLE_YELLOW") || msg.includes("DOUBLE YELLOW")) return "FLAG_DOUBLE_YELLOW";
  if (flag === "GREEN" || msg.includes("GREEN FLAG")) return "FLAG_GREEN";
  if (flag === "YELLOW" || msg.includes("YELLOW FLAG")) return "FLAG_YELLOW";
  if (flag === "RED" || msg.includes("RED FLAG")) return "FLAG_RED";
  if (flag === "BLUE" || msg.includes("BLUE FLAG")) return "FLAG_BLUE";
  if (flag === "BLACK" || msg.includes("BLACK FLAG")) return "FLAG_BLACK";
  if (msg.includes("VIRTUAL SAFETY CAR") || msg.includes("VSC")) return "VSC";
  if (msg.includes("SAFETY CAR") || msg.includes("SC DEPLOYED")) return "SAFETY_CAR";
  if (/PENALTY|DRIVE THROUGH|STOP.?GO|TIME PENALTY|DISQUALIF/.test(msg)) return "PENALTY";
  if (/CRASH|COLLISION|SPUN|STOPPED|DEBRIS|TRACK LIMIT|INCIDENT|RETIRED/.test(msg)) return "INCIDENT";
  return "SESSION";
}
function eventSeconds(date, baseDate) {
  const n = (new Date(date).getTime() - new Date(baseDate).getTime()) / 1000;
  return Number.isFinite(n) ? n : null;
}
function addEvent(list, raw, type, sessionStart, extra={}) {
  const sec = eventSeconds(raw.date || raw.date_start, sessionStart);
  if (sec === null || sec < -5) return;
  const meta = EVENT_META[type] || EVENT_META.SESSION;
  const driver = raw.driver_number ?? extra.driver_number;
  list.push({
    id: type+"-"+(raw.date||raw.date_start||"") + "-" + (driver ?? "") + "-" + list.length,
    type, seconds: Math.max(0, sec), date:raw.date||raw.date_start, driver_number:driver,
    label:extra.label || meta.label,
    detail:extra.detail || raw.message || (driver ? driverName(driver) : ""),
    lap:raw.lap_number ?? null, tone:meta.tone, icon:meta.icon, color:meta.color, source:extra.source||"OpenF1"
  });
}
function isVisible(event) {
  if (!state.enabled.has(event.type)) return false;
  const filter = $("eventFilter").value;
  if (filter === "flags") return event.type.startsWith("FLAG_") || ["SAFETY_CAR","VSC","SESSION"].includes(event.type);
  if (filter === "pit") return event.type === "PIT_STOP" || event.type === "TYRE_CHANGE";
  if (filter === "overtake") return event.type === "OVERTAKE";
  if (filter === "other") return !event.type.startsWith("FLAG_") && !["SAFETY_CAR","VSC","SESSION","PIT_STOP","TYRE_CHANGE","OVERTAKE"].includes(event.type);
  return true;
}
async function loadYears() {
  const select = $("yearSelect");
  const max = new Date().getFullYear();
  for (let y=max; y>=2023; y--) {
    const opt=document.createElement("option"); opt.value=y; opt.textContent=y;
    if(y===state.year) opt.selected=true; select.append(opt);
  }
  await loadMeetings(state.year);
}
async function loadMeetings(year) {
  state.year=Number(year); state.meeting=null; state.session=null; state.sessions=[];
  $("meetingSelect").disabled=true; $("sessionSelect").disabled=true;
  $("meetingSelect").innerHTML="<option>Kalender laden…</option>";
  $("sessionSelect").innerHTML="<option>Kies eerst een Grand Prix</option>";
  setStatus("Grand Prix-kalender ophalen…",true);
  try {
    const meetings=await api("meetings",{year});
    state.meetings=meetings.filter(m=>!m.is_cancelled).sort((a,b)=>new Date(b.date_start)-new Date(a.date_start));
    $("meetingSelect").innerHTML='<option value="">Selecteer Grand Prix</option>'+state.meetings.map(m=>'<option value="'+m.meeting_key+'">'+escapeHtml(m.meeting_name)+' · '+escapeHtml(m.location||m.country_name||"")+'</option>').join("");
    $("meetingSelect").disabled=false;
    setStatus(state.meetings.length+" Grand Prix-weekends gevonden");
    if(state.meetings.length) {
      const recent = state.meetings.find(m=>new Date(m.date_start) <= new Date()) || state.meetings[0];
      $("meetingSelect").value=recent.meeting_key; await loadSessions(recent.meeting_key);
    }
  } catch(error) {
    $("meetingSelect").innerHTML='<option value="">Kalender niet bereikbaar</option>';
    setStatus("Fout: "+error.message);
    toast("Kalender laden is niet gelukt. Check je internetverbinding.");
  }
}
async function loadSessions(meetingKey) {
  state.meeting=state.meetings.find(m=>String(m.meeting_key)===String(meetingKey))||null;
  state.session=null; $("sessionSelect").disabled=true; $("sessionSelect").innerHTML="<option>Sessies laden…</option>";
  if(!state.meeting){setStatus("Kies een Grand Prix");return;}
  setStatus("Sessies ophalen…",true);
  try {
    const sessions=await api("sessions",{meeting_key:meetingKey});
    state.sessions=sessions.sort((a,b)=>new Date(b.date_start)-new Date(a.date_start));
    $("sessionSelect").innerHTML='<option value="">Selecteer sessie</option>'+state.sessions.map(s=>'<option value="'+s.session_key+'">'+escapeHtml(s.session_name||s.session_type)+' · '+new Date(s.date_start).toLocaleDateString("nl-NL")+'</option>').join("");
    $("sessionSelect").disabled=false;
    const preferred=state.sessions.find(s=>String(s.session_type).toLowerCase()==="race") || state.sessions.find(s=>String(s.session_type).toLowerCase()==="sprint") || state.sessions[0];
    if(preferred){$("sessionSelect").value=preferred.session_key;selectSession(preferred.session_key);}
    setStatus(state.sessions.length+" sessies beschikbaar · kies en laad");
  } catch(error){$("sessionSelect").innerHTML='<option value="">Geen sessies gevonden</option>';setStatus("Sessies niet beschikbaar: "+error.message);}
}
function selectSession(key) {
  state.session=state.sessions.find(s=>String(s.session_key)===String(key))||null;
  $("loadRaceButton").disabled=!state.session;
  if(state.session){
    $("selectedRaceName").textContent=state.meeting?.meeting_name||"Grand Prix";
    $("selectedSessionName").textContent=state.session.session_name+" · "+state.year+" · "+(state.meeting?.location||"");
    setStatus("Sessie geselecteerd · klaar om te laden");
  }
}
async function loadRaceEvents() {
  if(!state.session)return;
  setStatus("Racegegevens ophalen…",true);
  stopPlayer(true); state.events=[];state.drivers=new Map();state.results=[];
  const key=state.session.session_key;
  const endpoints=["drivers","race_control","pit","overtakes","stints","session_result","laps"];
  const loaded={};
  try {
    for(let i=0;i<endpoints.length;i++){
      const endpoint=endpoints[i];
      try { loaded[endpoint]=await api(endpoint,{session_key:key}); }
      catch(err){ loaded[endpoint]=[]; console.warn("OpenF1 "+endpoint+":",err.message); }
      if(i<endpoints.length-1) await wait(360);
      setStatus("Racegegevens ophalen… "+(i+1)+"/"+endpoints.length,true);
    }
    (loaded.drivers||[]).forEach(d=>state.drivers.set(Number(d.driver_number),d));
    const events=[], start=state.session.date_start;
    (loaded.race_control||[]).forEach(item=>addEvent(events,item,raceControlType(item),start,{detail:item.message||item.flag||"",source:"Race Control"}));
    (loaded.pit||[]).forEach(item=>addEvent(events,item,"PIT_STOP",start,{detail:driverName(item.driver_number)+" · "+(item.stop_duration!=null?Number(item.stop_duration).toFixed(1)+"s stop":"pitstop"),source:"Pit"}));
    (loaded.overtakes||[]).forEach(item=>addEvent(events,item,"OVERTAKE",start,{label:"Inhaalactie",detail:driverName(item.overtaking_driver_number)+" passeert "+driverName(item.overtaken_driver_number),source:"Overtakes"}));
    (loaded.stints||[]).forEach(item=>addEvent(events,{...item,date:item.date_start},"TYRE_CHANGE",start,{detail:driverName(item.driver_number)+" · "+(item.compound||"bandenwissel")+" · stint "+(item.stint_number||""),source:"Stints"}));
    const laps=loaded.laps||[];
    const fastest=laps.filter(l=>Number.isFinite(Number(l.lap_duration)) && l.lap_duration>0).sort((a,b)=>a.lap_duration-b.lap_duration)[0];
    if(fastest)addEvent(events,{...fastest,date:fastest.date_start},"FASTEST_LAP",start,{detail:driverName(fastest.driver_number)+" · "+Number(fastest.lap_duration).toFixed(3)+"s · ronde "+fastest.lap_number,source:"Laps"});
    state.events=events.sort((a,b)=>a.seconds-b.seconds);
    state.results=(loaded.session_result||[]).sort((a,b)=>a.position-b.position);
    const last=state.events.at(-1)?.seconds||0;
    const sessionEnd=new Date(state.session.date_end||start).getTime();
    state.duration=Math.max(last+90,Number.isFinite(sessionEnd)?(sessionEnd-new Date(start).getTime())/1000:0,1800);
    renderStats();renderEvents();renderResults();configurePlayer();
    const missing=endpoints.filter(e=>!loaded[e]?.length);
    setStatus(state.events.length+" events klaar"+(missing.length?" · niet beschikbaar: "+missing.join(", "):""));
    if(!state.events.length)toast("Geen eventdata gevonden voor deze sessie.");
    else toast(state.events.length+" race-events geladen.");
  } catch(error){setStatus("Laden mislukt: "+error.message);toast("De racegegevens konden niet worden geladen.");}
  $("loadRaceButton").disabled=false;
}
function renderStats(){
  $("statEvents").textContent=state.events.length;
  $("statFlags").textContent=state.events.filter(e=>e.type.startsWith("FLAG_")||["SAFETY_CAR","VSC"].includes(e.type)).length;
  $("statPits").textContent=state.events.filter(e=>e.type==="PIT_STOP").length;
  $("statOvertakes").textContent=state.events.filter(e=>e.type==="OVERTAKE").length;
}
function renderEvents(){
  const list=$("eventsList"), items=state.events.filter(isVisible);
  if(!items.length){list.innerHTML='<div class="empty-state"><span class="empty-icon">⌁</span><strong>Geen events in deze weergave</strong><p>Kies een andere filter of laad een andere sessie.</p></div>';return;}
  list.innerHTML=items.map(e=>'<div class="event-row" data-event-id="'+escapeHtml(e.id)+'"><span class="event-time">'+formatClock(e.seconds)+'</span><span class="event-icon '+e.tone+'">'+e.icon+'</span><span class="event-copy"><strong>'+escapeHtml(e.label)+'</strong><span>'+escapeHtml(e.detail||"Race Control")+'</span></span><span class="lap-tag">'+(e.lap?"L"+e.lap:"")+'</span></div>').join("");
  list.querySelectorAll(".event-row").forEach(el=>el.addEventListener("click",()=>{const event=state.events.find(e=>e.id===el.dataset.eventId);if(event)seek(event.seconds);}));
}
function renderResults(){
  const box=$("resultsPanel");
  if(!state.results.length){box.querySelector(".podium-empty")?.remove();if(!box.querySelector(".podium-list"))box.insertAdjacentHTML("beforeend",'<div class="podium-empty">Uitslag nog niet gepubliceerd in de databron.</div>');return;}
  const top=state.results.slice(0,3);
  box.querySelector(".podium-empty")?.remove();box.querySelector(".podium-list")?.remove();
  box.insertAdjacentHTML("beforeend",'<div class="podium-list">'+top.map((r,i)=>'<div class="podium-row"><span class="podium-place">'+(r.position||i+1)+'</span><div><strong>'+escapeHtml(driverName(r.driver_number))+'</strong><small>'+escapeHtml(driverTeam(r.driver_number))+'</small></div></div>').join("")+'</div>');
}
function configurePlayer(){
  $("timelineSlider").disabled=false;$("timelineSlider").max=String(Math.ceil(state.duration));$("timelineSlider").value="0";
  $("timelineEnd").textContent=formatClock(state.duration);$("timelineStart").textContent="00:00";
  $("playButton").disabled=false;$("pauseButton").disabled=false;$("resetButton").disabled=false;$("lightsOutButton").disabled=false;
  $("playerMode").textContent="KLAAR VOOR REPLAY";
  state.current=0;state.fired.clear();updateClock();
}
function updateClock(){
  $("clockDisplay").textContent=formatClock(state.current);
  $("timelineSlider").value=String(Math.min(state.duration,state.current));
}
function currentElapsed(){return state.playing?(Date.now()-state.anchor)/1000:state.pausedAt;}
function startPlayer(){
  if(!state.session||!state.events.length){toast("Laad eerst een race met events.");return;}
  state.anchor=Date.now()-state.current*1000;state.pausedAt=state.current;state.playing=true;
  state.fired=new Set(state.events.filter(e=>e.seconds<=state.current+state.offset).map(e=>e.id));
  $("playerMode").textContent="SYNCHRONISEERT";$("playButton").textContent="▶ Verder";
  if(state.timer)clearInterval(state.timer);
  state.timer=setInterval(tick,100);
  toast("Synchronisatie gestart. Veel kijkplezier!");
}
function pausePlayer(){
  if(!state.playing)return;
  state.pausedAt=currentElapsed();state.current=state.pausedAt;state.playing=false;
  clearInterval(state.timer);state.timer=null;$("playerMode").textContent="GEPAUZEERD";$("playButton").textContent="▶ Verder";updateClock();
}
function stopPlayer(reset=false){
  state.playing=false;clearInterval(state.timer);state.timer=null;
  if(reset){state.current=0;state.pausedAt=0;state.fired.clear();$("playerMode").textContent="WACHT OP RACE";$("playButton").textContent="▶ Start synchronisatie";updateClock();}
}
function tick(){
  state.current=currentElapsed();
  const adjusted=state.current+state.offset;
  state.events.forEach(event=>{
    if(event.seconds<=adjusted&&!state.fired.has(event.id)){
      state.fired.add(event.id);triggerEvent(event);
    }
  });
  updateClock();
  if(state.current>=state.duration){pausePlayer();$("playerMode").textContent="REPLAY VOLTOOID";toast("De sessie is afgelopen.");}
}
function seek(seconds){
  const wasPlaying=state.playing;if(wasPlaying)pausePlayer();
  state.current=Math.max(0,Math.min(state.duration,seconds));state.pausedAt=state.current;
  state.fired=new Set(state.events.filter(e=>e.seconds<=state.current+state.offset).map(e=>e.id));
  updateClock();$("playerMode").textContent="POSITIE GEKOZEN";
  if(wasPlaying)startPlayer();
}
function triggerEvent(event){
  const previewType=event.type==="FLAG_GREEN"?"GREEN":event.type==="FLAG_YELLOW"||event.type==="FLAG_DOUBLE_YELLOW"?"YELLOW":event.type==="FLAG_RED"?"RED":event.type==="FLAG_CHEQUERED"?"CHEQUERED":event.type==="FLAG_BLUE"?"BLUE":event.type==="SAFETY_CAR"||event.type==="VSC"?"YELLOW":event.type==="OVERTAKE"?"GREEN":event.type==="PIT_STOP"?"BLUE":event.type==="PENALTY"||event.type==="INCIDENT"?"RED":"GREEN";
  showPreview(previewType,event.label+" · "+formatClock(event.seconds));
  toast(event.label+": "+(event.detail||"Race Control"));
}
function showPreview(type,caption){
  const colors={GREEN:["#31dc86"],YELLOW:["#ffd34e"],RED:["#ff4d5d"],GREEN_YELLOW:["#31dc86","#ffd34e"],CHEQUERED:["#eaf0f8","#192338"],BLUE:["#4d87ff"]};
  const palette=colors[type]||["#16315c","#e52e42","#16315c"];
  $("lightPreview").querySelectorAll("span").forEach((el,i)=>{el.style.background=palette[i%palette.length];});
  $("previewName").textContent=type.replaceAll("_"," ");
  $("previewCaption").textContent=(caption?caption+" · ":"")+"Visuele preview — Hue Bridge nog niet gekoppeld.";
}
function updateOffset(value){
  state.offset=Math.max(-10,Math.min(10,Number(value)||0));
  $("offsetSlider").value=state.offset;$("offsetValue").textContent=(state.offset>0?"+":"")+state.offset+"s";
  localStorage.setItem("fh_offset",String(state.offset));
}
$("yearSelect").addEventListener("change",e=>loadMeetings(e.target.value));
$("meetingSelect").addEventListener("change",e=>loadSessions(e.target.value));
$("sessionSelect").addEventListener("change",e=>selectSession(e.target.value));
$("loadRaceButton").addEventListener("click",loadRaceEvents);
$("playButton").addEventListener("click",()=>state.playing?pausePlayer():startPlayer());
$("pauseButton").addEventListener("click",pausePlayer);
$("resetButton").addEventListener("click",()=>stopPlayer(true));
$("lightsOutButton").addEventListener("click",()=>{seek(0);startPlayer();toast("Lights out-markering gezet. Dit is het startpunt van je replay.");});
$("timelineSlider").addEventListener("input",e=>seek(Number(e.target.value)));
$("eventFilter").addEventListener("change",renderEvents);
$("offsetSlider").addEventListener("input",e=>updateOffset(e.target.value));
document.querySelectorAll("[data-offset]").forEach(b=>b.addEventListener("click",()=>updateOffset(state.offset+Number(b.dataset.offset))));
document.querySelectorAll("[data-preview]").forEach(b=>b.addEventListener("click",()=>showPreview(b.dataset.preview,"Handmatige effecttest")));
$("standbyToggle").checked=state.standby;
$("standbyToggle").addEventListener("change",e=>{state.standby=e.target.checked;localStorage.setItem("fh_standby",String(state.standby));showPreview(state.standby?"GREEN_YELLOW":"BLUE",state.standby?"Stand-by staat aan":"Stand-by staat uit");});
$("themeButton").addEventListener("click",()=>document.body.classList.toggle("light"));
updateOffset(state.offset);
loadYears();
