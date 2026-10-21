import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, addDoc, getDocs, getDoc, updateDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const equipmentCollection = "equipos";
let db = null;
let equipment = [];
let toastTimer;

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3300);
}
function today() { return new Date().toLocaleDateString("en-CA"); }
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function dateText(value) {
  if (!value) return "—";
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? escapeHTML(value) : d.toLocaleDateString("es-CO");
}
function statusPill(status) {
  const c = status === "Bueno" ? "pill-green" : status === "Regular" ? "pill-amber" : status === "Dañado" || status === "En mantenimiento" ? "pill-red" : "pill-gray";
  return `<span class="pill ${c}">${escapeHTML(status || "Sin definir")}</span>`;
}
function availabilityPill(available) {
  return available === "si" ? '<span class="pill pill-green">● Disponible</span>' : '<span class="pill pill-red">● No disponible</span>';
}
function currentAssignment(item) {
  const history = item.asignaciones || [];
  return history.length ? history[history.length - 1] : null;
}
function latestReturn(item) {
  const history = item.recepciones || [];
  return history.length ? history[history.length - 1] : null;
}
function openDialog(id) { $(id).showModal(); }
function closeDialog(id) { $(id).close(); }

async function loadEquipment() {
  if (!db) return;
  try {
    const snap = await getDocs(query(collection(db, equipmentCollection), orderBy("updatedAt", "desc")));
    equipment = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    try {
      const snap = await getDocs(collection(db, equipmentCollection));
      equipment = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
    } catch (secondErr) {
      console.error(secondErr); toast("No fue posible leer Firestore. Revisa las reglas y la configuración.");
    }
  }
  renderAll();
}
function renderAll() {
  const total = equipment.length;
  const available = equipment.filter(e => e.disponible === "si").length;
  const assigned = equipment.filter(e => e.disponible !== "si" && currentAssignment(e)).length;
  $("statTotal").textContent = total;
  $("statAvailable").textContent = available;
  $("statAssigned").textContent = assigned;
  $("statOther").textContent = Math.max(0, total - available - assigned);
  renderInventory();
  renderRecent();
  renderAssignments();
  renderReturns();
}
function renderRecent() {
  const rows = equipment.slice(0,5);
  $("recentTable").innerHTML = rows.length ? rows.map(e => {
    const a = currentAssignment(e);
    return `<tr><td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td><td>${escapeHTML(e.tipo)}</td><td>${statusPill(e.estado)}</td><td>${availabilityPill(e.disponible)}</td><td>${escapeHTML(a?.asignadoA || "—")}</td><td><button class="action-btn" data-action="detail" data-id="${e.id}">Ver detalle</button></td></tr>`;
  }).join("") : '<tr><td colspan="6" class="empty-cell">Aún no hay equipos. Registra el primero para comenzar.</td></tr>';
}
function renderInventory() {
  const term = $("searchInput").value.trim().toLowerCase();
  const avail = $("availabilityFilter").value;
  const status = $("statusFilter").value;
  const filtered = equipment.filter(e => {
    const a = currentAssignment(e);
    const text = [e.marca,e.tipo,e.perifericos,e.asignadoPor,a?.asignadoA,a?.area].join(" ").toLowerCase();
    return (!term || text.includes(term)) && (!avail || e.disponible === avail) && (!status || e.estado === status);
  });
  $("inventoryCount").textContent = `${filtered.length} equipo${filtered.length === 1 ? "" : "s"}${filtered.length !== equipment.length ? ` de ${equipment.length}` : ""}`;
  $("inventoryTable").innerHTML = filtered.length ? filtered.map(e => {
    const a = currentAssignment(e);
    return `<tr>
      <td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
      <td>${statusPill(e.estado)}</td><td>${escapeHTML(e.perifericos || "—")}</td><td>${availabilityPill(e.disponible)}</td>
      <td>${escapeHTML(a?.asignadoA || "—")}<span class="subtext">${escapeHTML(a?.area || "")}</span></td><td>${dateText(a?.fecha)}</td>
      <td><div class="actions"><button class="action-btn" data-action="detail" data-id="${e.id}">Ver</button><button class="action-btn" data-action="edit" data-id="${e.id}">Editar</button>${e.disponible === "si" ? `<button class="action-btn" data-action="assign" data-id="${e.id}">Asignar</button>` : `<button class="action-btn" data-action="receive" data-id="${e.id}">Recibir</button>`}</div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">No se encontraron equipos con esos filtros.</td></tr>';
}
function renderAssignments() {
  const rows = [];
  equipment.forEach(e => (e.asignaciones || []).forEach(a => rows.push({e,a})));
  rows.sort((x,y) => (y.a.fecha || "").localeCompare(x.a.fecha || ""));
  $("assignmentsTable").innerHTML = rows.length ? rows.map(({e,a}) => `<tr><td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td><td>${escapeHTML(a.asignadoA)}</td><td>${escapeHTML(a.area)}</td><td>${dateText(a.fecha)}</td><td>${statusPill(a.estado)}</td><td>${escapeHTML(a.recibidoPor || "—")}</td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No hay asignaciones registradas.</td></tr>';
}
function renderReturns() {
  const rows = [];
  equipment.forEach(e => (e.recepciones || []).forEach(r => rows.push({e,r})));
  rows.sort((x,y) => (y.r.fecha || "").localeCompare(x.r.fecha || ""));
  $("returnsTable").innerHTML = rows.length ? rows.map(({e,r}) => `<tr><td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td><td>${escapeHTML(r.recibidoDe)}</td><td>${escapeHTML(r.area)}</td><td>${dateText(r.fecha)}</td><td>${statusPill(r.estado)}</td><td>${r.firma ? `<a href="${r.firma}" target="_blank" rel="noopener">Ver firma</a>` : "—"}</td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No hay recepciones registradas.</td></tr>';
}
function resetEquipmentForm() { $("equipmentForm").reset(); $("equipmentId").value = ""; $("equipmentDialogTitle").textContent = "Registrar equipo"; $("available").value = "si"; $("equipmentStatus").value = "Bueno"; }
function editEquipment(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  resetEquipmentForm();
  $("equipmentId").value = e.id; $("brand").value = e.marca || ""; $("type").value = e.tipo || "";
  $("equipmentStatus").value = e.estado || "Bueno"; $("available").value = e.disponible || "si";
  $("peripherals").value = e.perifericos || ""; $("assignedBy").value = e.asignadoPor || "";
  $("equipmentDialogTitle").textContent = "Editar equipo"; openDialog("equipmentDialog");
}
function prepareAssignment(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  $("assignmentForm").reset(); clearPad("assignmentSignature");
  $("assignmentEquipmentId").value = id; $("assignmentEquipmentLabel").textContent = `${e.marca} · ${e.tipo}`;
  $("assignedDate").value = today(); $("assignedCondition").value = e.estado || "Bueno"; $("assignedPeripherals").value = e.perifericos || "";
  openDialog("assignmentDialog");
}
function prepareReturn(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  const a = currentAssignment(e);
  $("returnForm").reset(); clearPad("returnSignature");
  $("returnEquipmentId").value = id; $("returnEquipmentLabel").textContent = `${e.marca} · ${e.tipo}`;
  $("receivedDate").value = today(); $("receivedFrom").value = a?.asignadoA || "";
  $("receivedArea").value = a?.area || ""; $("receivedPeripherals").value = a?.perifericos || e.perifericos || "";
  $("receivedCondition").value = e.estado || "Bueno"; openDialog("returnDialog");
}
async function saveEquipment(event) {
  event.preventDefault();
  const id = $("equipmentId").value;
  const data = { marca:$("brand").value.trim(), tipo:$("type").value.trim(), estado:$("equipmentStatus").value, disponible:$("available").value, perifericos:$("peripherals").value.trim(), asignadoPor:$("assignedBy").value.trim(), updatedAt:serverTimestamp() };
  try {
    if (id) await updateDoc(doc(db,equipmentCollection,id), data);
    else await addDoc(collection(db,equipmentCollection), {...data, asignaciones:[], recepciones:[], createdAt:serverTimestamp()});
    closeDialog("equipmentDialog"); toast(id ? "Equipo actualizado correctamente." : "Equipo registrado correctamente."); await loadEquipment();
  } catch(err) { console.error(err); toast("No se pudo guardar. Revisa tu conexión y las reglas de Firebase."); }
}
async function saveAssignment(event) {
  event.preventDefault();
  const id = $("assignmentEquipmentId").value; const e = equipment.find(x => x.id === id); if (!e) return;
  const signature = padHasInk("assignmentSignature") ? $("assignmentSignature").toDataURL("image/png") : "";
  const a = { asignadoA:$("assignedTo").value.trim(), area:$("assignedArea").value.trim(), fecha:$("assignedDate").value, perifericos:$("assignedPeripherals").value.trim(), estado:$("assignedCondition").value, firma:signature, recibidoPor:$("assignmentReceivedBy").value.trim(), registradoEn:new Date().toISOString() };
  try {
    await updateDoc(doc(db,equipmentCollection,id), {disponible:"no", asignaciones:[...(e.asignaciones || []),a], estado:a.estado, updatedAt:serverTimestamp()});
    closeDialog("assignmentDialog"); toast("Asignación guardada correctamente."); await loadEquipment();
  } catch(err) { console.error(err); toast("No se pudo guardar la asignación. Verifica Firebase."); }
}
async function saveReturn(event) {
  event.preventDefault();
  const id = $("returnEquipmentId").value; const e = equipment.find(x => x.id === id); if (!e) return;
  const signature = padHasInk("returnSignature") ? $("returnSignature").toDataURL("image/png") : "";
  const r = { recibidoDe:$("receivedFrom").value.trim(), area:$("receivedArea").value.trim(), fecha:$("receivedDate").value, perifericos:$("receivedPeripherals").value.trim(), estado:$("receivedCondition").value, firma:signature, registradoEn:new Date().toISOString() };
  try {
    await updateDoc(doc(db,equipmentCollection,id), {disponible:"si", estado:r.estado, perifericos:r.perifericos, recepciones:[...(e.recepciones || []),r], updatedAt:serverTimestamp()});
    closeDialog("returnDialog"); toast("Recepción guardada. El equipo quedó disponible."); await loadEquipment();
  } catch(err) { console.error(err); toast("No se pudo guardar la recepción. Verifica Firebase."); }
}
function showDetail(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  $("historyTitle").textContent = `${e.marca} · ${e.tipo}`;
  const aList = e.asignaciones || [], rList = e.recepciones || [];
  $("historyContent").innerHTML = `<div class="detail-grid">
    <div class="detail-item"><small>Marca</small><strong>${escapeHTML(e.marca)}</strong></div><div class="detail-item"><small>Tipo</small><strong>${escapeHTML(e.tipo)}</strong></div>
    <div class="detail-item"><small>Estado actual</small><strong>${escapeHTML(e.estado)}</strong></div><div class="detail-item"><small>Disponibilidad</small><strong>${e.disponible === "si" ? "Disponible" : "No disponible"}</strong></div>
    <div class="detail-item"><small>Periféricos actuales</small><strong>${escapeHTML(e.perifericos || "—")}</strong></div><div class="detail-item"><small>Asignado por</small><strong>${escapeHTML(e.asignadoPor || "—")}</strong></div>
  </div>
  <div class="history-block"><h3>Historial de asignaciones (${aList.length})</h3>${aList.length ? [...aList].reverse().map(a => `<div class="history-entry"><strong>${escapeHTML(a.asignadoA)}</strong> · ${escapeHTML(a.area)}<br>Fecha: ${dateText(a.fecha)} · Estado: ${escapeHTML(a.estado)}<br>Periféricos: ${escapeHTML(a.perifericos || "—")}<br>Recibido por: ${escapeHTML(a.recibidoPor || "—")}${a.firma ? `<br><img class="signature-preview" src="${a.firma}" alt="Firma de asignación">` : ""}</div>`).join("") : '<p class="empty-history">Sin asignaciones.</p>'}</div>
  <div class="history-block"><h3>Historial de recepciones (${rList.length})</h3>${rList.length ? [...rList].reverse().map(r => `<div class="history-entry"><strong>Recibido de: ${escapeHTML(r.recibidoDe)}</strong> · ${escapeHTML(r.area)}<br>Fecha: ${dateText(r.fecha)} · Estado: ${escapeHTML(r.estado)}<br>Periféricos: ${escapeHTML(r.perifericos || "—")}${r.firma ? `<br><img class="signature-preview" src="${r.firma}" alt="Firma de recepción">` : ""}</div>`).join("") : '<p class="empty-history">Sin recepciones.</p>'}</div>`;
  openDialog("historyDialog");
}
function clearPad(id) { const c = $(id); const ctx = c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height); ctx.strokeStyle="#222";ctx.lineWidth=2.2;ctx.lineCap="round"; }
function padHasInk(id) { const c=$(id), ctx=c.getContext("2d"), d=ctx.getImageData(0,0,c.width,c.height).data; for(let i=3;i<d.length;i+=4) if(d[i]!==0)return true; return false; }
function setupSignaturePad(id) {
  const canvas=$(id),ctx=canvas.getContext("2d"); let drawing=false;
  function pos(ev){const r=canvas.getBoundingClientRect();const p=ev.touches?ev.touches[0]:ev;return {x:(p.clientX-r.left)*canvas.width/r.width,y:(p.clientY-r.top)*canvas.height/r.height};}
  function start(ev){ev.preventDefault();drawing=true;const p=pos(ev);ctx.beginPath();ctx.moveTo(p.x,p.y);}
  function move(ev){if(!drawing)return;ev.preventDefault();const p=pos(ev);ctx.lineTo(p.x,p.y);ctx.stroke();}
  function end(){drawing=false;}
  canvas.addEventListener("pointerdown",start);canvas.addEventListener("pointermove",move);window.addEventListener("pointerup",end);
  canvas.addEventListener("touchstart",start,{passive:false});canvas.addEventListener("touchmove",move,{passive:false});canvas.addEventListener("touchend",end);
  clearPad(id);
}
function navigate(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active",b.dataset.view===view));
  $(`${view}View`).classList.add("active");
  const titles={dashboard:"Panel general",inventory:"Inventario de equipos",assignments:"Historial de asignaciones",returns:"Historial de recepciones"};
  $("pageTitle").textContent=titles[view]||"Panel general"; $("sidebar").classList.remove("open");
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog(b.dataset.close)));
document.querySelectorAll("[data-clear]").forEach(b=>b.addEventListener("click",()=>clearPad(b.dataset.clear)));
$("newEquipmentBtn").addEventListener("click",()=>{resetEquipmentForm();openDialog("equipmentDialog")});
$("newEquipmentBtn2").addEventListener("click",()=>{resetEquipmentForm();openDialog("equipmentDialog")});
$("equipmentForm").addEventListener("submit",saveEquipment);
$("assignmentForm").addEventListener("submit",saveAssignment);
$("returnForm").addEventListener("submit",saveReturn);
["searchInput","availabilityFilter","statusFilter"].forEach(id=>$(id).addEventListener("input",renderInventory));
document.addEventListener("click",event=>{
  const b=event.target.closest("[data-action]"); if(!b)return;
  const {action,id}=b.dataset;
  if(action==="detail")showDetail(id); if(action==="edit")editEquipment(id);
  if(action==="assign")prepareAssignment(id); if(action==="receive")prepareReturn(id);
});
$("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
["assignmentSignature","returnSignature"].forEach(setupSignaturePad);

const configReady = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PEGA_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("TU-");
if (!configReady) {
  $("connectionText").textContent="Firebase pendiente de configurar";
  $("setupNotice").hidden=false;
  ["statTotal","statAvailable","statAssigned","statOther"].forEach(id=>$(id).textContent="—");
  $("inventoryTable").innerHTML='<tr><td colspan="7" class="empty-cell">Configura Firebase para comenzar a registrar equipos.</td></tr>';
} else {
  try {
    const app=initializeApp(firebaseConfig); db=getFirestore(app);
    $("connectionText").textContent="Conectando a Firebase…";
    $("setupNotice").hidden=true;
    loadEquipment().then(()=>{$("connectionText").textContent="Conectado a Firebase";document.querySelector(".connection-dot").style.background="#31b66a";});
  } catch(err) { console.error(err); $("connectionText").textContent="Error de conexión"; toast("No se pudo inicializar Firebase."); }
}
