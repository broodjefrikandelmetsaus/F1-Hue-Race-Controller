const API = "https://api.openf1.org/v1";
const $ = (id) => document.getElementById(id);
const state = {
  year: new Date().getFullYear(),
  meetings: [], sessions: [], meeting: null, session: null,
  calendarLastChecked: 0, calendarRefreshTimer: null, calendarRefreshing: false,
  events: [], drivers: new Map(), results: [], duration: 0,
  offset: Number(localStorage.getItem("fh_offset") || 0),
  standby: localStorage.getItem("fh_standby") !== "false",
  hueGroups: [], hueLights: [],
  excludedHueLights: new Set(JSON.parse(localStorage.getItem("fh_hue_excluded_lights") || "[]")),
  selectedHueLights: new Set(JSON.parse(localStorage.getItem("fh_hue_selected_lights") || "[]")),
  selectedHueGroupKeys: new Set(JSON.parse(localStorage.getItem("fh_hue_selected_groups") || "[]")),
  hueEffectToken: 0, hueEffectPromise: null, hueRestoring: false,
  resultsRevealed: false,
  selectedHueGroupId: localStorage.getItem("fh_hue_group_id") || "",
  selectedHueGroupType: localStorage.getItem("fh_hue_group_type") || "",
  selectedHueGroupName: localStorage.getItem("fh_hue_group_name") || "",
  selectedHueGroupedLightId: localStorage.getItem("fh_hue_grouped_light_id") || "",
  enabled: new Set(JSON.parse(localStorage.getItem("fh_enabled") || '["FLAG_GREEN","FLAG_YELLOW","FLAG_RED","FLAG_CHEQUERED","SAFETY_CAR","VSC","PIT_STOP","OVERTAKE","PENALTY","INCIDENT","FASTEST_LAP","TYRE_CHANGE"]')),
  effects: JSON.parse(localStorage.getItem("fh_effects") || "null") || {
    GREEN:{enabled:true,colors:["#31dc86"]},
    YELLOW:{enabled:true,colors:["#ffd34e"]},
    RED:{enabled:true,colors:["#ff4d5d"]},
    GREEN_YELLOW:{enabled:true,colors:["#31dc86","#ffd34e"]},
    CHEQUERED:{enabled:true,colors:["#eaf0f8","#192338"]},
    BLUE:{enabled:true,colors:["#4d87ff"]}
  },
  winnerTeamColor: localStorage.getItem("fh_winner_team") || "#e52e42",
  winnerCountryColor: localStorage.getItem("fh_winner_country") || "#ffffff",
  winnerColorMode: localStorage.getItem("fh_winner_mode") || "team",
  winnerTeamCustom: localStorage.getItem("fh_winner_team") !== null,
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
  VSC_END:{label:"VSC beëindigd",icon:"🟢",tone:"green",color:"#31dc86"},
  SAFETY_CAR_END:{label:"Safety Car naar binnen",icon:"🟢",tone:"green",color:"#31dc86"},
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

async function loadHueConnectionStatus() {
  const endpoint = "https://iimpesmlfjqerweuqmsj.supabase.co/functions/v1/hue-connection-status";
  const stateEl = $("hueConnectionState");
  const titleEl = $("hueConnectionTitle");
  const copyEl = $("hueConnectionCopy");
  const buttonEl = $("hueConnectButton");
  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("Hue-status niet bereikbaar");
    const status = await response.json();
    if (status.linked) {
      if (stateEl) { stateEl.textContent = "ACCOUNT GEKOPPELD"; stateEl.classList.add("connected"); }
      if (titleEl) titleEl.textContent = "Je Philips Hue-account is gekoppeld";
      if (copyEl) copyEl.textContent = "De beveiligde Hue-autorisatie is gevonden. Bij het zoeken naar lampen registreert de app automatisch de Bridge via de Remote API.";
      if (buttonEl) { buttonEl.textContent = "Account gekoppeld · bediening volgt"; buttonEl.disabled = true; }
      const deviceButton = $("hueLoadDevicesButton");
      if (deviceButton) deviceButton.disabled = false;
    } else {
      if (stateEl) stateEl.textContent = "NIET GEKOPPELD";
      if (titleEl) titleEl.textContent = "Je Hue-account is nog niet gekoppeld";
      if (copyEl) copyEl.textContent = "Koppel je Philips Hue-account om de beveiligde autorisatie op te slaan.";
      if (buttonEl) { buttonEl.textContent = "Hue-account koppelen"; buttonEl.disabled = false; }
    }
  } catch (error) {
    if (stateEl) stateEl.textContent = "STATUS ONBEKEND";
    if (titleEl) titleEl.textContent = "Hue-verbindingsstatus niet beschikbaar";
    if (copyEl) copyEl.textContent = "Controleer je internetverbinding en probeer de app opnieuw te openen.";
    if (buttonEl) { buttonEl.textContent = "Status opnieuw proberen"; buttonEl.disabled = false; }
  }
}
 
async function fetchHueResource(resource) {
  const response = await fetch("https://iimpesmlfjqerweuqmsj.supabase.co/functions/v1/hue-bridge-resources?resource=" + encodeURIComponent(resource), {
    headers: { Accept: "application/json" }, cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Hue-resource kon niet worden geladen.");
    error.code = result.code;
    error.status = result.status;
    throw error;
  }
  return Array.isArray(result.data) ? result.data : [];
}

function saveHueGroupSelections(keys) {
  state.selectedHueGroupKeys = new Set(keys);
  localStorage.setItem("fh_hue_selected_groups", JSON.stringify([...state.selectedHueGroupKeys]));
  const chosen = state.hueGroups.filter(group => state.selectedHueGroupKeys.has(group.kind + ":" + group.id));
  const totalLights = [...new Set(chosen.flatMap(group => group.lightIds || []))].length;
  const copy = $("hueRoomCopy");
  if (copy) copy.textContent = chosen.length
    ? "✓ " + chosen.map(group => group.name).join(", ") + " geselecteerd · " + totalLights + " unieke lamp(en) tegelijk."
    : "Selecteer één of meer kamers of zones. Je kunt ook losse lampen aanvinken.";
}
function renderHueGroups(groups) {
  const picker = $("hueRoomOptions");
  const count = $("hueRoomCount");
  if (!picker || !count) return;
  state.hueGroups = groups;
  count.textContent = groups.length + " kamer(s) / zone(s)";
  if (!groups.length) {
    picker.innerHTML = '<div class="device-empty">Geen Hue-kamers of zones gevonden</div>';
    saveHueGroupSelections([]);
    $("hueRoomCopy").textContent = "De Bridge heeft geen kamers of zones teruggegeven.";
    return;
  }
  const validKeys = new Set(groups.filter(group => group.lightIds?.length).map(group => group.kind + ":" + group.id));
  state.selectedHueGroupKeys = new Set([...state.selectedHueGroupKeys].filter(key => validKeys.has(key)));
  if (!state.selectedHueGroupKeys.size) {
    const preferredTV = groups.find(group => group.lightIds?.length && group.name.trim().toLowerCase() === "tv") ||
      groups.find(group => group.lightIds?.length && group.name.toLowerCase().includes("tv"));
    if (preferredTV) state.selectedHueGroupKeys.add(preferredTV.kind + ":" + preferredTV.id);
  }
  picker.innerHTML = groups.map(group => {
    const key = group.kind + ":" + group.id;
    const label = group.name + (group.kind === "room" ? " · Kamer" : " · Zone");
    const unavailable = !group.lightIds?.length;
    const checked = state.selectedHueGroupKeys.has(key) ? " checked" : "";
    return '<div class="hue-group-card' + (unavailable ? ' is-disabled' : '') + '">' +
      '<label class="hue-room-option"><input type="checkbox" data-hue-group-key="' + escapeHtml(key) + '"' + checked +
      (unavailable ? " disabled" : "") + '><span><b>' + escapeHtml(label) + '</b><small>' +
      (unavailable ? "Geen lampen gevonden" : group.lightIds.length + " apparaat/apparaten") + '</small></span></label>' +
      (unavailable ? "" : '<button type="button" class="hue-group-expand" data-hue-group-expand="' + escapeHtml(key) +
      '" aria-expanded="false">Bekijk apparaten ▾</button><div class="hue-group-members" data-hue-group-members="' + escapeHtml(key) + '" hidden></div>') +
      '</div>';
  }).join("");
  picker.querySelectorAll("[data-hue-group-key]").forEach(input => input.addEventListener("change", () => {
    const keys = new Set(state.selectedHueGroupKeys);
    if (input.checked) keys.add(input.dataset.hueGroupKey); else keys.delete(input.dataset.hueGroupKey);
    saveHueGroupSelections(keys);
    toast(keys.size + " Hue-kamer(s)/zone(s) geselecteerd.");
  }));
  picker.querySelectorAll("[data-hue-group-expand]").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.hueGroupExpand;
    const group = state.hueGroups.find(item => item.kind + ":" + item.id === key);
    const container = picker.querySelector('[data-hue-group-members="' + key + '"]');
    if (!group || !container) return;
    const opening = container.hidden;
    container.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    button.textContent = opening ? "Verberg apparaten ▴" : "Bekijk apparaten ▾";
    if (opening) renderHueGroupLights(group, container);
  }));
  saveHueGroupSelections(state.selectedHueGroupKeys);
}

async function loadHueDevices() {
  const button = $("hueLoadDevicesButton");
  const list = $("hueDeviceList");
  if (!button || !list) return;
  button.disabled = true;
  button.textContent = "Hue-apparaten zoeken…";
  list.innerHTML = '<div class="device-empty">Verbinding maken met de Hue Bridge…</div>';
  const roomCount = $("hueRoomCount");
  const roomSelect = $("hueRoomOptions");
  if (roomCount) roomCount.textContent = "Kamers ophalen…";
  if (roomSelect) roomSelect.disabled = true;
  try {
    // This first request can perform the one-time Remote API Bridge registration.
    const lights = await fetchHueResource("light");
    state.hueLights = lights;
    if (!lights.length) {
      list.innerHTML = '<div class="device-empty">De Bridge reageert, maar er zijn geen lampen gevonden.</div>';
    } else {
      const validIds = new Set(lights.map(light => light.id).filter(Boolean));
      state.selectedHueLights = new Set([...state.selectedHueLights].filter(id => validIds.has(id)));
      localStorage.setItem("fh_hue_selected_lights", JSON.stringify([...state.selectedHueLights]));
      list.innerHTML = '<div class="device-summary">' + lights.length + ' Hue-lamp(en) gevonden · ' +
        state.selectedHueLights.size + ' geselecteerd</div>' +
        lights.map(light => {
          const caps = light.hasColor ? "Kleur" : (light.hasColorTemperature ? "Wittemperatuur" : "Wit / dimbaar");
          const status = light.on === null ? "Status onbekend" : (light.on ? "Aan" : "Uit");
          const brightness = light.brightness === null ? "" : " · " + Math.round(light.brightness) + "%";
          const checked = state.selectedHueLights.has(light.id) ? " checked" : "";
          return '<label class="hue-device-row hue-device-selectable"><input class="hue-light-checkbox" type="checkbox" data-hue-light-id="' +
            escapeHtml(light.id) + '"' + checked + '><span class="device-bulb">●</span><span class="device-info"><b>' +
            escapeHtml(light.name) + '</b><small>' + caps + ' · ' + status + brightness + '</small></span></label>';
        }).join("");
      list.querySelectorAll("[data-hue-light-id]").forEach(input => input.addEventListener("change", () => {
        const id = input.dataset.hueLightId;
        if (input.checked) state.selectedHueLights.add(id);
        else state.selectedHueLights.delete(id);
        localStorage.setItem("fh_hue_selected_lights", JSON.stringify([...state.selectedHueLights]));
        const summary = list.querySelector(".device-summary");
        if (summary) summary.textContent = lights.length + " Hue-lamp(en) gevonden · " + state.selectedHueLights.size + " geselecteerd";
      }));
    }

    // Load rooms, zones and their grouped-light control resources after registration.
    const [roomsResult, zonesResult, groupedResult, devicesResult] = await Promise.allSettled([
      fetchHueResource("room"), fetchHueResource("zone"),
      fetchHueResource("grouped_light"), fetchHueResource("device")
    ]);
    const rooms = roomsResult.status === "fulfilled" ? roomsResult.value : [];
    const zones = zonesResult.status === "fulfilled" ? zonesResult.value : [];
    const groupedLights = groupedResult.status === "fulfilled" ? groupedResult.value : [];
    const devices = devicesResult.status === "fulfilled" ? devicesResult.value : [];
    // Hue API v2 links resources with rid/rtype (not id/type).
    const linkId = item => item?.rid || item?.id || "";
    const linkType = item => item?.rtype || item?.type || "";
    const deviceLights = new Map(devices.map(device => [
      device.id, (device.services || []).filter(service => linkType(service) === "light").map(linkId).filter(Boolean)
    ]));
    const groupResources = [
      ...rooms.map(group => ({ ...group, kind: "room" })),
      ...zones.map(group => ({ ...group, kind: "zone" }))
    ];
    const groups = groupResources.map(group => {
      const service = Array.isArray(group.services) ? group.services.find(item => linkType(item) === "grouped_light") : null;
      const ownerMatch = groupedLights.find(item => item.owner && linkId(item.owner) === group.id &&
        (!linkType(item.owner) || linkType(item.owner) === group.kind));
      const lightIds = [...new Set((group.children || []).flatMap(child => {
        const id = linkId(child), type = linkType(child);
        if (type === "light") return id ? [id] : [];
        if (type === "device") return deviceLights.get(id) || [];
        return [];
      }))];
      return {
        id: group.id, kind: group.kind,
        name: group.name || (group.kind === "room" ? "Naamloze kamer" : "Naamloze zone"),
        groupedLightId: service?.id || ownerMatch?.id || "", lightIds
      };
    }).sort((a,b) => a.name.localeCompare(b.name, "nl"));
    renderHueGroups(groups);

    const roomLoadFailed = roomsResult.status === "rejected" && zonesResult.status === "rejected";
    if (roomLoadFailed) {
      $("hueRoomCount").textContent = "Niet beschikbaar";
      $("hueRoomCopy").textContent = "De lampen zijn geladen, maar Hue gaf de kamers en zones niet terug. Probeer opnieuw.";
    }
    button.textContent = "Hue-apparaten vernieuwen";
    toast(lights.length + " lamp(en) · " + groups.length + " kamer(s) / zone(s) gevonden.");
  } catch (error) {
    if (error.code === "reauthorize") {
      list.innerHTML = '<div class="device-error">De Hue-toestemming moet opnieuw worden bevestigd. Koppel je account opnieuw.</div>';
    } else if (error.code === "refresh_failed") {
      list.innerHTML = '<div class="device-error">De beveiligde Hue-toegang kon niet worden vernieuwd. Probeer later opnieuw.</div>';
    } else if (error.code === "remote_linkbutton_failed") {
      list.innerHTML = '<div class="device-error">Philips Hue kon de Bridge-autorisatie op afstand niet openen (HTTP ' + error.status + '). Je account blijft gekoppeld; er zijn geen lampen aangestuurd.</div>';
    } else if (["bridge_registration_failed","bridge_registration_rejected","bridge_linkbutton_not_ready"].includes(error.code)) {
      list.innerHTML = '<div class="device-error">Philips Hue heeft de Bridge-registratie nog niet afgerond. Je account blijft gekoppeld; probeer straks opnieuw. Er zijn geen lampen aangestuurd.</div>';
    } else {
      list.innerHTML = '<div class="device-error">' + escapeHtml(error.message || "Hue Bridge niet bereikbaar.") + '</div>';
    }
    button.textContent = "Opnieuw proberen";
    if (roomCount) roomCount.textContent = "Niet geladen";
    if (roomSelect) roomSelect.disabled = true;
  } finally {
    button.disabled = false;
  }
}
function setStatus(message, busy=false) {
  $("dataStatus").textContent = message;
  $("loadRaceButton").disabled = busy || !state.session || sessionStatus(state.session) !== "AFGELOPEN";
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
  if (flag.includes("GREEN_AND_YELLOW") || msg.includes("GREEN AND YELLOW")) return "FLAG_GREEN_YELLOW";
  if (flag === "GREEN" || msg.includes("GREEN FLAG") || msg.includes("GREEN LIGHT")) return "FLAG_GREEN";
  if (flag === "YELLOW" || msg.includes("YELLOW FLAG")) return "FLAG_YELLOW";
  if (flag === "RED" || msg.includes("RED FLAG")) return "FLAG_RED";
  if (flag === "BLUE" || msg.includes("BLUE FLAG")) return "FLAG_BLUE";
  if (flag === "BLACK" || msg.includes("BLACK FLAG")) return "FLAG_BLACK";
  if (msg.includes("VIRTUAL SAFETY CAR END") || msg.includes("VSC END") || msg.includes("VSC ENDING")) return "VSC_END";
  if (msg.includes("VIRTUAL SAFETY CAR") || msg.includes("VSC")) return "VSC";
  if (msg.includes("SAFETY CAR") && /IN THIS LAP|ENDING|WITHDRAWN|END OF/.test(msg)) return "SAFETY_CAR_END";
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
  const filter = $("eventFilter").value;
  if (filter === "flags") return event.type.startsWith("FLAG_") || ["SAFETY_CAR","VSC","SESSION"].includes(event.type);
  if (filter === "pit") return event.type === "PIT_STOP" || event.type === "TYRE_CHANGE";
  if (filter === "overtake") return event.type === "OVERTAKE";
  if (filter === "other") return !event.type.startsWith("FLAG_") && !["SAFETY_CAR","VSC","SESSION","PIT_STOP","TYRE_CHANGE","OVERTAKE"].includes(event.type);
  return true;
}
function sessionStatus(session) {
  if (!session || session.is_cancelled) return "GEANNULEERD";
  const now = Date.now();
  const start = Date.parse(session.date_start || "");
  const end = Date.parse(session.date_end || session.date_start || "");
  if (Number.isFinite(end) && end <= now) return "AFGELOPEN";
  if (Number.isFinite(start) && start <= now && (!Number.isFinite(end) || end > now)) return "BEZIG";
  return "GEPLAND";
}
function sessionStatusIcon(session) {
  const status = sessionStatus(session);
  return status === "AFGELOPEN" ? "✓" : status === "BEZIG" ? "●" : status === "GEPLAN" ? "◷" : "!";
}
function updateCalendarStatus() {
  const el = $("calendarUpdated");
  if (!el) return;
  if (!state.calendarLastChecked) {
    el.textContent = "Automatische controle elke 15 minuten";
    return;
  }
  const time = new Date(state.calendarLastChecked).toLocaleTimeString("nl-NL", {hour:"2-digit",minute:"2-digit"});
  el.textContent = "Laatste controle " + time + " · controleert elke 15 min";
}
async function loadYears() {
  const select = $("yearSelect");
  const max = new Date().getFullYear();
  for (let y=max; y>=2023; y--) {
    const opt=document.createElement("option"); opt.value=y; opt.textContent=y;
    if(y===state.year) opt.selected=true; select.append(opt);
  }
  await loadMeetings(state.year);
  state.calendarLastChecked = Date.now();
  updateCalendarStatus();
  startCalendarAutoRefresh();
}
function startCalendarAutoRefresh() {
  if (state.calendarRefreshTimer) clearInterval(state.calendarRefreshTimer);
  state.calendarRefreshTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshCalendar(true);
  }, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.calendarLastChecked > 5 * 60 * 1000) {
      refreshCalendar(true);
    }
  });
}
async function refreshCalendar(silent=false) {
  if (state.calendarRefreshing) return;
  state.calendarRefreshing = true;
  const button = $("refreshCalendarButton");
  if (button) { button.disabled = true; button.textContent = "⏳ Bijwerken…"; }
  const ok = await loadMeetings(state.year, {preserveSelection:true});
  state.calendarLastChecked = Date.now();
  updateCalendarStatus();
  state.calendarRefreshing = false;
  if (button) { button.disabled = false; button.textContent = "↻ Kalender verversen"; }
  if (ok && !silent) toast("F1-kalender bijgewerkt.");
  if (!ok && !silent) toast("Kalender kon niet worden bijgewerkt. Probeer het opnieuw.");
}
async function loadMeetings(year, options={}) {
  const previousMeetingKey = options.preserveSelection ? state.meeting?.meeting_key : null;
  const previousSessionKey = options.preserveSelection ? state.session?.session_key : null;
  state.year=Number(year); state.meeting=null; state.session=null; state.sessions=[];
  $("meetingSelect").disabled=true; $("sessionSelect").disabled=true;
  $("meetingSelect").innerHTML="<option>Kalender laden…</option>";
  $("sessionSelect").innerHTML="<option>Kies eerst een Grand Prix</option>";
  setStatus("Grand Prix-kalender ophalen…",true);
  try {
    const meetings=await api("meetings",{year});
    // Toon ook de volgende Grands Prix: toekomstige weekends mogen niet verdwijnen.
    state.meetings=meetings.filter(m=>!m.is_cancelled).sort((a,b)=>new Date(b.date_start)-new Date(a.date_start));
    $("meetingSelect").innerHTML='<option value="">Selecteer Grand Prix</option>'+state.meetings.map(m=>{
      const date = m.date_start ? new Date(m.date_start).toLocaleDateString("nl-NL",{day:"2-digit",month:"short"}) : "";
      return '<option value="'+m.meeting_key+'">'+escapeHtml(m.meeting_name)+' · '+escapeHtml(m.location||m.country_name||"")+(date?" · "+date:"")+'</option>';
    }).join("");
    $("meetingSelect").disabled=false;
    const previous = state.meetings.find(m=>String(m.meeting_key)===String(previousMeetingKey));
    const recent = state.meetings.find(m=>new Date(m.date_start).getTime()<=Date.now());
    const next = state.meetings.filter(m=>new Date(m.date_start).getTime()>Date.now()).sort((a,b)=>new Date(a.date_start)-new Date(b.date_start))[0];
    const preferred = previous || recent || next;
    if (preferred) {
      $("meetingSelect").value=String(preferred.meeting_key);
      await loadSessions(preferred.meeting_key,{preferredSessionKey:previousSessionKey});
    } else {
      setStatus("Geen Grand Prix-weekenden gevonden voor "+year);
    }
    return true;
  } catch(error) {
    $("meetingSelect").innerHTML='<option value="">Kalender niet bereikbaar</option>';
    setStatus("Fout: "+error.message);
    if (!options.preserveSelection) toast("Kalender laden is niet gelukt. Check je internetverbinding.");
    return false;
  }
}
async function loadSessions(meetingKey, options={}) {
  state.meeting=state.meetings.find(m=>String(m.meeting_key)===String(meetingKey))||null;
  state.session=null; $("sessionSelect").disabled=true; $("sessionSelect").innerHTML="<option>Sessies laden…</option>";
  if(!state.meeting){setStatus("Kies een Grand Prix");return;}
  setStatus("Sessies ophalen…",true);
  try {
    const sessions=await api("sessions",{meeting_key:meetingKey});
    state.sessions=sessions.filter(s=>!s.is_cancelled).sort((a,b)=>new Date(b.date_start)-new Date(a.date_start));
    $("sessionSelect").innerHTML='<option value="">Selecteer sessie</option>'+state.sessions.map(s=>{
      const date = s.date_start ? new Date(s.date_start).toLocaleDateString("nl-NL",{day:"2-digit",month:"short"}) : "";
      const status = sessionStatus(s);
      return '<option value="'+s.session_key+'">['+status+'] '+escapeHtml(s.session_name||s.session_type)+(date?" · "+date:"")+'</option>';
    }).join("");
    $("sessionSelect").disabled=false;
    const previous = state.sessions.find(s=>String(s.session_key)===String(options.preferredSessionKey));
    const completed = state.sessions.filter(s=>sessionStatus(s)==="AFGELOPEN");
    const completedRace = completed.find(s=>String(s.session_type||"").toLowerCase()==="race");
    const next = state.sessions.filter(s=>sessionStatus(s)!=="AFGELOPEN").sort((a,b)=>new Date(a.date_start)-new Date(b.date_start))[0];
    const preferred = previous || completedRace || completed[0] || next || state.sessions[0];
    if(preferred){$("sessionSelect").value=String(preferred.session_key);selectSession(preferred.session_key);}
    else setStatus("Nog geen sessies gepubliceerd voor dit weekend.");
  } catch(error) {
    $("sessionSelect").innerHTML='<option value="">Geen sessies gevonden</option>';
    setStatus("Sessies niet beschikbaar: "+error.message);
  }
}
function selectSession(key) {
  state.session=state.sessions.find(s=>String(s.session_key)===String(key))||null;
  if(!state.session){setStatus("Selecteer een sessie");return;}
  const status=sessionStatus(state.session);
  $("selectedRaceName").textContent=state.meeting?.meeting_name||"Grand Prix";
  $("selectedSessionName").textContent=state.session.session_name+" · "+state.year+" · "+(state.meeting?.location||"")+" · "+status.toLowerCase();
  if(status==="AFGELOPEN") setStatus("Sessie afgelopen · race-events kunnen worden geladen");
  else if(status==="BEZIG") setStatus("Sessie bezig · race-events komen beschikbaar na afloop");
  else setStatus("Sessie gepland · app toont de events zodra de sessie is afgelopen");
}
async function loadRaceEvents() {
  if(!state.session)return;
  if(sessionStatus(state.session)!=="AFGELOPEN"){toast("Deze sessie is nog niet afgelopen. De race-events zijn na afloop beschikbaar.");return;}
  setStatus("Racegegevens ophalen…",true);
  stopPlayer(true); state.events=[];state.drivers=new Map();state.results=[];state.resultsRevealed=false;
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
    const laps=loaded.laps||[];
    const lapStarts=new Map(laps.filter(l=>l.date_start!=null).map(l=>[String(l.driver_number)+"-"+String(l.lap_number),l]));
    (loaded.stints||[]).forEach(item=>{
      const firstLap=lapStarts.get(String(item.driver_number)+"-"+String(item.lap_start));
      if(firstLap?.date_start)addEvent(events,{...item,date:firstLap.date_start,lap_number:item.lap_start},"TYRE_CHANGE",start,{detail:driverName(item.driver_number)+" · "+(item.compound||"bandenwissel")+" · stint "+(item.stint_number||""),source:"Stints"});
    });
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
  box.querySelector(".podium-empty")?.remove();
  box.querySelector(".podium-list")?.remove();
  box.querySelector(".results-reveal-row")?.remove();
  if(!state.results.length){
    box.insertAdjacentHTML("beforeend",'<div class="podium-empty">Uitslag nog niet gepubliceerd in de databron.</div>');
    return;
  }
  const top=state.results.slice(0,3);
  const podium=top.map((r,i)=>'<div class="podium-row"><span class="podium-place">'+(r.position||i+1)+'</span><div><strong>'+escapeHtml(driverName(r.driver_number))+'</strong><small>'+escapeHtml(driverTeam(r.driver_number))+'</small></div></div>').join("");
  box.insertAdjacentHTML("beforeend",
    '<div class="results-reveal-row"><span class="results-spoiler-note">'+(state.resultsRevealed?"Uitslag onthuld":"Spoiler verborgen")+'</span><button type="button" class="button button-secondary results-reveal-button" id="revealResultsButton">'+(state.resultsRevealed?"Verberg uitslag":"Onthul uitslag")+'</button></div>'+
    '<div class="podium-list'+(state.resultsRevealed?"":" results-blurred")+'" aria-label="Race-uitslag">'+podium+'</div>');
  $("revealResultsButton").addEventListener("click",()=>{
    state.resultsRevealed=!state.resultsRevealed;
    renderResults();
  });
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
  returnHueToStandby();
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
  if(state.current>=state.duration){state.playing=false;clearInterval(state.timer);state.timer=null;$("playerMode").textContent="REPLAY VOLTOOID";$("playButton").textContent="▶ Verder";returnHueToStandby();toast("De sessie is afgelopen. De lampen gaan terug naar stand-by.");}
}
function seek(seconds){
  const wasPlaying=state.playing;if(wasPlaying)pausePlayer();
  state.current=Math.max(0,Math.min(state.duration,seconds));state.pausedAt=state.current;
  state.fired=new Set(state.events.filter(e=>e.seconds<=state.current+state.offset).map(e=>e.id));
  updateClock();$("playerMode").textContent="POSITIE GEKOZEN";
  if(wasPlaying)startPlayer();
}
function triggerEvent(event){
  if(event.type==="FLAG_CHEQUERED" && state.effects.CHEQUERED?.enabled) showWinnerPreview(event);
  else {
    const previewType=event.type==="FLAG_GREEN"?"GREEN":event.type==="FLAG_YELLOW"||event.type==="FLAG_DOUBLE_YELLOW"?"YELLOW":event.type==="FLAG_RED"?"RED":event.type==="FLAG_CHEQUERED"?"CHEQUERED":event.type==="FLAG_GREEN_YELLOW"?"GREEN_YELLOW":event.type==="FLAG_DOUBLE_YELLOW"?"YELLOW":event.type==="FLAG_BLUE"?"BLUE":event.type==="SAFETY_CAR"||event.type==="VSC"?"YELLOW":event.type==="OVERTAKE"?"GREEN":event.type==="PIT_STOP"||event.type==="TYRE_CHANGE"?"BLUE":event.type==="PENALTY"||event.type==="INCIDENT"?"RED":event.type==="VSC_END"||event.type==="SAFETY_CAR_END"?"GREEN":null;
    if(previewType && state.effects[previewType]?.enabled) showPreview(previewType,event.label+" · "+formatClock(event.seconds));
    else $("previewCaption").textContent=event.label+" · Effect uitgeschakeld of nog geen Hue-koppeling.";
  }
  toast(event.label+": "+(event.detail||"Race Control"));
}
function showWinnerPreview(event){
  const winner=state.results.find(result=>Number(result.position)===1)||state.results[0];
  const driver=winner?state.drivers.get(Number(winner.driver_number)):null;
  const name=winner?driverName(winner.driver_number):"Winnaar";
  const team=winner?driverTeam(winner.driver_number):"";
  let color=state.winnerCountryColor;
  if(state.winnerColorMode==="team"){
    const providerColor=driver?.team_colour ? "#"+String(driver.team_colour).replace("#","") : null;
    color=state.winnerTeamCustom?state.winnerTeamColor:(providerColor||state.winnerTeamColor);
  }
  $("lightPreview").querySelectorAll("span").forEach((el,index)=>{
    el.style.background=color;
    el.style.animation="none";
    void el.offsetWidth;
    el.style.animation="lightFlash .42s ease-in-out 3";
    el.style.animationDelay=(index*35)+"ms";
  });
  $("previewName").textContent="WINNAAR · "+name;
  $("previewCaption").textContent=(team?team+" · ":"")+(state.winnerColorMode==="team"?"Teamkleur":"Eigen landkleur")+" · Winnaars-preview op alle geselecteerde lampen.";
  if (state.playing) state.hueEffectPromise = sendHueColors([color],"pulse",true);
}
function renderEffectSettings(){
  const items=[
    ["GREEN","Groene vlag","3× groen knipperen"],
    ["YELLOW","Gele vlag","3× geel knipperen"],
    ["RED","Rode vlag","3× rood knipperen"],
    ["GREEN_YELLOW","Groen / geel","Afwisselend 3×"],
    ["CHEQUERED","Finishvlag","Geblokt zwart / wit"],
    ["BLUE","Blauwe vlag","Blauw pulse-effect"]
  ];
  $("effectList").innerHTML=items.map(([key,label,desc])=>{
    const setting=state.effects[key]||{enabled:true,colors:["#31dc86"]};
    const colors=setting.colors||["#31dc86"];
    const colorInputs=colors.map((color,index)=>'<input type="color" aria-label="'+label+' kleur '+(index+1)+'" data-effect-color="'+key+'" data-color-index="'+index+'" value="'+color+'">').join("");
    return '<div class="effect-row"><span class="effect-swatch '+key.toLowerCase()+'"></span><div class="effect-main"><b>'+label+'</b><small>'+desc+'</small><div class="effect-colors">'+colorInputs+'</div></div><label class="mini-switch"><input type="checkbox" data-effect-enabled="'+key+'" '+(setting.enabled?"checked":"")+'><span></span></label><button data-preview="'+key+'" class="preview-button" aria-label="Preview '+label+'">▶</button></div>';
  }).join("");
  $("effectList").querySelectorAll("[data-effect-enabled]").forEach(input=>input.addEventListener("change",()=>{
    const key=input.dataset.effectEnabled;
    state.effects[key].enabled=input.checked;
    saveEffects();
  }));
  $("effectList").querySelectorAll("[data-effect-color]").forEach(input=>input.addEventListener("input",()=>{
    const key=input.dataset.effectColor,index=Number(input.dataset.colorIndex);
    state.effects[key].colors[index]=input.value;
    saveEffects();
  }));
  $("effectList").querySelectorAll("[data-preview]").forEach(button=>button.addEventListener("click",()=>showPreview(button.dataset.preview,"Handmatige effecttest",true,true)));
}
function saveEffects(){localStorage.setItem("fh_effects",JSON.stringify(state.effects));}
function hexToHueXY(hex){
  const raw=hex.replace("#","");let rgb=[0,2,4].map(i=>parseInt(raw.slice(i,i+2),16)/255);
  rgb=rgb.map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  const X=rgb[0]*0.664511+rgb[1]*0.154324+rgb[2]*0.162028;
  const Y=rgb[0]*0.283881+rgb[1]*0.668433+rgb[2]*0.047685;
  const Z=rgb[0]*0.000088+rgb[1]*0.072310+rgb[2]*0.986039;
  const sum=X+Y+Z;return sum?{x:X/sum,y:Y/sum}:{x:0.3127,y:0.329};
}
async function getHuePin() {
  let pin = localStorage.getItem("fh_hue_pin");
  if (!pin) {
    pin = prompt("Voer eenmalig je 6-cijferige Hue-toegangscode in:");
    if (!pin) return null;
    if (!/^\d{6}$/.test(pin)) { toast("De toegangscode moet uit precies 6 cijfers bestaan."); return null; }
    localStorage.setItem("fh_hue_pin", pin);
  }
  return pin;
}
function changeHuePin() {
  const nextPin = prompt("Voer je nieuwe 6-cijferige Hue-toegangscode in:");
  if (nextPin === null) return;
  if (!/^\d{6}$/.test(nextPin)) {
    toast("De toegangscode moet uit precies 6 cijfers bestaan.");
    return;
  }
  localStorage.setItem("fh_hue_pin", nextPin);
  toast("Toegangscode opgeslagen op dit apparaat.");
}
async function postHueCommand(pin, payload) {
  const response = await fetch("https://iimpesmlfjqerweuqmsj.supabase.co/functions/v1/hue-bridge-resources?resource=light", {
    method: "POST", headers: {"Content-Type":"application/json","Accept":"application/json"},
    body: JSON.stringify({pin, ...payload})
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Hue-commando mislukt");
  }
  return data;
}
function getTargetHueLightIds() {
  const selectedGroups = state.hueGroups.filter(group => state.selectedHueGroupKeys.has(group.kind + ":" + group.id));
  const groupIds = selectedGroups.flatMap(group => group.lightIds || []).filter(id => !state.excludedHueLights.has(id));
  return [...new Set(selectedGroups.length ? groupIds : [...state.selectedHueLights])];
}
function renderHueGroupLights(group, container) {
  const members = (group.lightIds || []).map(id => state.hueLights.find(light => light.id === id)).filter(Boolean);
  if (!members.length) { container.innerHTML = '<div class="device-empty">Geen apparaten in deze kamer of zone gevonden.</div>'; return; }
  container.innerHTML = members.map(light => {
    const excluded = state.excludedHueLights.has(light.id);
    const status = light.on === null ? "Status onbekend" : (light.on ? "Aan" : "Uit");
    const brightness = light.brightness == null ? "" : " · " + Math.round(light.brightness) + "%";
    return '<label class="hue-group-device' + (excluded ? ' is-excluded' : '') + '"><input type="checkbox" data-hue-member-id="' +
      escapeHtml(light.id) + '"' + (excluded ? "" : " checked") + '><span class="device-bulb">●</span><span><b>' +
      escapeHtml(light.name) + '</b><small>' + status + brightness + (excluded ? " · Niet meenemen" : " · Meedoen") + '</small></span></label>';
  }).join("");
  container.querySelectorAll("[data-hue-member-id]").forEach(input => input.addEventListener("change", () => {
    const id = input.dataset.hueMemberId;
    if (input.checked) state.excludedHueLights.delete(id); else state.excludedHueLights.add(id);
    localStorage.setItem("fh_hue_excluded_lights", JSON.stringify([...state.excludedHueLights]));
    renderHueGroupLights(group, container);
    toast(input.checked ? "Lamp doet weer mee." : "Lamp wordt overgeslagen.");
  }));
}
async function captureHueOriginalStates(ids, pin) {
  const snapshot = JSON.parse(localStorage.getItem("fh_hue_original_light_states") || "{}");
  const missing = ids.filter(id => !snapshot[id]);
  if (missing.length) {
    const lights = await fetchHueResource("light");
    for (const light of lights) {
      if (!missing.includes(light.id)) continue;
      snapshot[light.id] = {
        on: light.on,
        brightness: light.brightness,
        color: light.color,
        colorTemperature: light.colorTemperature
      };
    }
    const absent = missing.filter(id => !snapshot[id]);
    if (absent.length) throw new Error("De oorspronkelijke lampstanden konden niet voor alle lampen worden opgeslagen.");
    localStorage.setItem("fh_hue_original_light_states", JSON.stringify(snapshot));
  }
}
async function returnHueToStandby() {
  const activeEffect = state.hueEffectPromise;
  state.hueEffectToken++;
  if (activeEffect) {
    try { await activeEffect; } catch (_) {}
  }
  if (state.standby) {
    try {
      const ids = getTargetHueLightIds();
      if (!ids.length) return;
      const pin = await getHuePin();
      if (!pin) return;
      await postHueCommand(pin, {
        lightIds:ids,
        lightColors:ids.map((id,index)=>({id,color:hexToHueXY(["#e10600","#001f5b","#e10600","#001f5b","#e10600"][index%5])})),
        on:true,brightness:65
      });
      $("playerMode").textContent = state.playing ? "SYNCHRONISEERT" : "STAND-BY";
    } catch (error) {
      toast("Stand-by herstellen lukte niet: " + (error.message || "onbekende fout"));
    }
    return;
  }
  await restoreHueOriginalStates();
}
async function restoreHueOriginalStates() {
  const snapshot = JSON.parse(localStorage.getItem("fh_hue_original_light_states") || "{}");
  const ids = Object.keys(snapshot);
  if (!ids.length || state.hueRestoring) return;
  state.hueRestoring = true;
  state.hueEffectToken++;
  try {
    if (state.hueEffectPromise) await state.hueEffectPromise;
    const pin = await getHuePin();
    if (!pin) return;
    const results = await Promise.all(ids.map(id =>
      postHueCommand(pin, {action:"restore", lightIds:[id], original:snapshot[id]})
    ));
    localStorage.removeItem("fh_hue_original_light_states");
    toast("Alle lampen staan weer op hun oorspronkelijke instellingen.");
  } catch (error) {
    toast("Herstellen is niet helemaal gelukt: " + (error.message || "onbekende fout") + ". De opgeslagen standen zijn bewaard; probeer Stop opnieuw.");
  } finally {
    state.hueRestoring = false;
  }
}
async function sendHueColors(colors, mode="pulse", returnToStandby=false){
  if (state.hueRestoring) return;
  const effectToken = ++state.hueEffectToken;
  const ids = getTargetHueLightIds();
  if(!ids.length){toast("Selecteer eerst één of meer Hue-kamers of lampen.");return;}
  const pin = await getHuePin();
  if(!pin)return;
  try {
    await captureHueOriginalStates(ids, pin);
    const sendAll = (color, brightness, on=true) => {
      const payload = {lightIds:ids, on};
      if (color) payload.color = hexToHueXY(color);
      if (on && brightness != null) payload.brightness = brightness;
      return postHueCommand(pin, payload);
    };
    if(mode==="steady"){
      const lightColors = ids.map((id,index)=>({id, color:hexToHueXY(colors[index%colors.length])}));
      await postHueCommand(pin,{lightIds:ids, lightColors, on:true, brightness:82});
      toast("Rood/blauwe stand-by gelijktijdig toegepast op "+ids.length+" lamp(en).");
      return;
    }
    const pulses=colors.length>1?6:3;
    for(let pulse=0;pulse<pulses;pulse++){
      const flashColor = colors.length>1 ? colors[pulse%colors.length] : colors[0];
      if (effectToken !== state.hueEffectToken) return;
      await sendAll(flashColor,95,true);
      if (effectToken !== state.hueEffectToken) return;
      await wait(0.5);
      if (effectToken !== state.hueEffectToken) return;
      await sendAll(null,null,false);
      if (effectToken !== state.hueEffectToken) return;
      await wait(0.5);
    }
    if (effectToken !== state.hueEffectToken) return;
    await sendAll(colors[(pulses-1)%colors.length],65,true);
    if (effectToken !== state.hueEffectToken) return;
    if (returnToStandby && state.standby) {
      await postHueCommand(pin,{
        lightIds:ids,
        lightColors:ids.map((id,index)=>({id,color:hexToHueXY(["#e10600","#001f5b","#e10600","#001f5b","#e10600"][index%5])})),
        on:true,brightness:65
      });
      $("playerMode").textContent = state.playing ? "SYNCHRONISEERT" : "STAND-BY";
    }
    toast("Gelijktijdige wedstrijdflitsen uitgevoerd op "+ids.length+" lamp(en); daarna terug naar stand-by.");
  }catch(error){
    toast(error.message||"Hue-aansturing mislukt.");
  }
}
function showPreview(type,caption,force=false,physical=false){
  const setting=state.effects[type]||{enabled:true,colors:["#31dc86"]};
  if(!force&&!setting.enabled)return;
  const palette=setting.colors||["#31dc86"];
  $("lightPreview").querySelectorAll("span").forEach((el,index)=>{
    el.style.background=palette[index%palette.length];
    el.style.animation="none";
    void el.offsetWidth;
    el.style.animation="lightFlash .42s ease-in-out 3";
    el.style.animationDelay=(index*35)+"ms";
  });
  $("previewName").textContent=type.replaceAll("_"," ");
  $("previewCaption").textContent=(caption?caption+" · ":"")+"Preview op scherm en geselecteerde Hue-lampen.";
  if(physical || state.playing) state.hueEffectPromise = sendHueColors(palette,"pulse",state.playing);
}
function showStandbyPreview(physical=false){
  const colors=["#e10600","#001f5b","#e10600","#001f5b","#e10600"];
  $("lightPreview").querySelectorAll("span").forEach((el,index)=>{
    el.style.background=colors[index];
    el.style.animation="none";
  });
  $("previewName").textContent="STANDBY · RED BULL";
  $("previewCaption").textContent="Rood/blauwe Red Bull-stand-by, gelijktijdig op alle geselecteerde lampen.";
  if(physical) state.hueEffectPromise = sendHueColors(["#e10600","#001f5b"],"steady");
}
function updateOffset(value){
  state.offset=Math.max(-10,Math.min(10,Number(value)||0));
  $("offsetSlider").value=state.offset;$("offsetValue").textContent=(state.offset>0?"+":"")+state.offset+"s";
  localStorage.setItem("fh_offset",String(state.offset));
}
$("hueLoadDevicesButton")?.addEventListener("click", loadHueDevices);
$("hueChangePinButton")?.addEventListener("click", changeHuePin);
$("yearSelect").addEventListener("change",e=>loadMeetings(e.target.value));
$("refreshCalendarButton").addEventListener("click",()=>refreshCalendar(false));
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
$("applyStandbyButton")?.addEventListener("click",()=>showStandbyPreview(true));
$("standbyToggle").checked=state.standby;
$("standbyToggle").addEventListener("change",e=>{state.standby=e.target.checked;localStorage.setItem("fh_standby",String(state.standby));state.standby?showStandbyPreview(true):restoreHueOriginalStates();});
$("winnerTeamColor").value=state.winnerTeamColor;
$("winnerCountryColor").value=state.winnerCountryColor;
$("winnerTeamColor").addEventListener("input",e=>{state.winnerTeamColor=e.target.value;localStorage.setItem("fh_winner_team",e.target.value);});
$("winnerCountryColor").addEventListener("input",e=>{state.winnerCountryColor=e.target.value;localStorage.setItem("fh_winner_country",e.target.value);});
$("winnerColorMode").value=state.winnerColorMode;
$("winnerColorMode").addEventListener("change",e=>{state.winnerColorMode=e.target.value;localStorage.setItem("fh_winner_mode",e.target.value);});
$("winnerTeamColor").addEventListener("input",e=>{state.winnerTeamCustom=true;});
renderEffectSettings();
if(state.standby)showStandbyPreview();
loadHueConnectionStatus();
$("themeButton").addEventListener("click",()=>document.body.classList.toggle("light"));
updateOffset(state.offset);
loadYears();
