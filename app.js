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
function equipmentName(e) {
  const s = e?.serial || e?.referencia;
  return [e?.marca, s].filter(Boolean).join(" ");
}
function statusPill(status = "") {
  const norm = String(status).toLowerCase();
  let c = "pill-gray";
  if (norm === "nuevo") c = "pill-blue";
  else if (norm === "bueno") c = "pill-green";
  else if (norm === "regular" || norm === "en mantenimiento") c = "pill-amber";
  else if (norm === "de baja" || norm === "dañado" || norm === "danado") c = "pill-red";
  return `<span class="pill ${c}">${escapeHTML(status || "Sin definir")}</span>`;
}
function availabilityPill(available, status = "") {
  if ((status || "").toLowerCase() === "de baja") {
    return '<span class="pill pill-gray">✕ De baja</span>';
  }
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
  const available = equipment.filter(e => e.disponible === "si" && (e.estado || "").toLowerCase() !== "de baja").length;
  const assigned = equipment.filter(e => e.disponible !== "si" && (e.estado || "").toLowerCase() !== "de baja" && currentAssignment(e)).length;
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
    return `<tr><td><span class="equipment-name">${escapeHTML(equipmentName(e))}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td><td>${escapeHTML(e.tipo)}</td><td>${statusPill(e.estado)}</td><td>${availabilityPill(e.disponible, e.estado)}</td><td>${escapeHTML(a?.asignadoA || "—")}</td><td><button class="action-btn" data-action="detail" data-id="${e.id}">Ver detalle</button></td></tr>`;
  }).join("") : '<tr><td colspan="6" class="empty-cell">Aún no hay equipos. Registra el primero para comenzar.</td></tr>';
}
function renderInventory() {
  const term = $("searchInput").value.trim().toLowerCase();
  const avail = $("availabilityFilter").value;
  const status = $("statusFilter").value.trim().toLowerCase();
  const filtered = equipment.filter(e => {
    const a = currentAssignment(e);
    const text = [e.marca,e.serial,e.referencia,e.tipo,e.perifericos,e.registradoPor || e.asignadoPor,a?.asignadoA,a?.area].filter(Boolean).join(" ").toLowerCase();

    let matchesAvail = true;
    if (avail === "baja") {
      matchesAvail = (e.estado || "").toLowerCase() === "de baja";
    } else if (avail === "si") {
      matchesAvail = e.disponible === "si" && (e.estado || "").toLowerCase() !== "de baja";
    } else if (avail === "no") {
      matchesAvail = e.disponible === "no" && (e.estado || "").toLowerCase() !== "de baja";
    }

    const matchesStatus = !status || (e.estado || "").toLowerCase() === status;
    const matchesTerm = !term || text.includes(term);

    return matchesTerm && matchesAvail && matchesStatus;
  });
  $("inventoryCount").textContent = `${filtered.length} equipo${filtered.length === 1 ? "" : "s"}${filtered.length !== equipment.length ? ` de ${equipment.length}` : ""}`;
  $("inventoryTable").innerHTML = filtered.length ? filtered.map(e => {
    const a = currentAssignment(e);
    const isBaja = (e.estado || "").toLowerCase() === "de baja";
    let actionBtns = `<button class="action-btn" data-action="detail" data-id="${e.id}">Ver</button><button class="action-btn" data-action="edit" data-id="${e.id}">Editar</button>`;
    if (!isBaja) {
      if (e.disponible === "si") {
        actionBtns += `<button class="action-btn" data-action="assign" data-id="${e.id}">Asignar</button>`;
      } else {
        actionBtns += `<button class="action-btn" data-action="receive" data-id="${e.id}">Recibir</button>`;
      }
      actionBtns += `<button class="action-btn btn-baja" data-action="decommission" data-id="${e.id}" title="Dar de baja al equipo">Dar de baja</button>`;
    }
    return `<tr>
      <td><span class="equipment-name">${escapeHTML(equipmentName(e))}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
      <td>${statusPill(e.estado)}</td><td>${escapeHTML(e.perifericos || "—")}</td><td>${availabilityPill(e.disponible, e.estado)}</td>
      <td>${escapeHTML(a?.asignadoA || "—")}<span class="subtext">${escapeHTML(a?.area || "")}</span></td><td>${dateText(a?.fecha)}</td>
      <td><div class="actions">${actionBtns}</div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">No se encontraron equipos con esos filtros.</td></tr>';
}
function renderAssignments() {
  const rows = [];
  equipment.forEach(e => (e.asignaciones || []).forEach(a => rows.push({e,a})));
  rows.sort((x,y) => (y.a.fecha || "").localeCompare(x.a.fecha || ""));
  $("assignmentsTable").innerHTML = rows.length ? rows.map(({e,a}) => `<tr><td><span class="equipment-name">${escapeHTML(equipmentName(e))}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td><td>${escapeHTML(a.asignadoA)}</td><td>${escapeHTML(a.area)}</td><td>${dateText(a.fecha)}</td><td>${statusPill(a.estado)}</td><td>${escapeHTML(a.entregadoPor || a.recibidoPor || "—")}</td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No hay asignaciones registradas.</td></tr>';
}
function renderReturns() {
  const rows = [];
  equipment.forEach(e => (e.recepciones || []).forEach(r => rows.push({e,r})));
  rows.sort((x,y) => (y.r.fecha || "").localeCompare(x.r.fecha || ""));
  $("returnsTable").innerHTML = rows.length ? rows.map(({e,r}) => `<tr><td><span class="equipment-name">${escapeHTML(equipmentName(e))}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td><td>${escapeHTML(r.recibidoDe)}</td><td>${escapeHTML(r.area)}</td><td>${dateText(r.fecha)}</td><td>${statusPill(r.estado)}</td><td>${r.firma ? `<a href="${r.firma}" target="_blank" rel="noopener">Ver firma</a>` : "—"}</td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No hay recepciones registradas.</td></tr>';
}
function updatePeripheralsDisplay() {
  const container = $("peripheralsDisplay");
  if (!container) return;
  const checkboxes = document.querySelectorAll('input[name="peripheralOption"]:checked');
  const values = Array.from(checkboxes).map(cb => cb.value);
  $("peripherals").value = values.join(", ");

  if (values.length === 0) {
    container.innerHTML = '<span class="multiselect-placeholder">Seleccionar periféricos...</span>';
  } else {
    container.innerHTML = values.map(v => `<span class="multiselect-tag">${escapeHTML(v)}</span>`).join("");
  }
}

function setPeripheralsValue(valString = "") {
  const checkboxes = document.querySelectorAll('input[name="peripheralOption"]');
  checkboxes.forEach(cb => cb.checked = false);

  if (valString) {
    const items = valString.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    checkboxes.forEach(cb => {
      if (items.includes(cb.value.toLowerCase())) {
        cb.checked = true;
      }
    });
    const matchedAny = Array.from(checkboxes).some(cb => items.includes(cb.value.toLowerCase()));
    if (!matchedAny && items.length > 0) {
      const otroCb = Array.from(checkboxes).find(cb => cb.value.toLowerCase() === "otro");
      if (otroCb) otroCb.checked = true;
    }
  }
  updatePeripheralsDisplay();
}

function setupPeripheralsSelect() {
  const container = $("peripheralsSelectContainer");
  const trigger = $("peripheralsTrigger");
  const clearBtn = $("clearPeripheralsBtn");
  if (!container || !trigger) return;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    container.classList.toggle("open");
    trigger.setAttribute("aria-expanded", container.classList.contains("open") ? "true" : "false");
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      container.classList.toggle("open");
      trigger.setAttribute("aria-expanded", container.classList.contains("open") ? "true" : "false");
    } else if (e.key === "Escape") {
      container.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  document.querySelectorAll('input[name="peripheralOption"]').forEach(cb => {
    cb.addEventListener("change", updatePeripheralsDisplay);
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setPeripheralsValue("");
    });
  }

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) {
      container.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
}

function resetEquipmentForm() {
  $("equipmentForm").reset();
  $("equipmentId").value = "";
  $("equipmentDialogTitle").textContent = "Registrar equipo";
  $("brand").value = "";
  $("serial").value = "";
  $("available").value = "si";
  $("equipmentStatus").value = "Bueno";
  $("type").value = "";
  setPeripheralsValue("");
  $("assignedBy").value = "";
}

function editEquipment(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  resetEquipmentForm();
  $("equipmentId").value = e.id;
  $("brand").value = e.marca || "";
  $("serial").value = e.serial || e.referencia || "";

  if (e.tipo) {
    const normalizedTarget = e.tipo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const match = Array.from($("type").options).find(opt =>
      opt.value.toLowerCase() === e.tipo.toLowerCase() ||
      opt.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalizedTarget
    );
    if (match) {
      $("type").value = match.value;
    } else {
      const customOpt = new Option(e.tipo, e.tipo, true, true);
      $("type").add(customOpt);
      $("type").value = e.tipo;
    }
  } else {
    $("type").value = "";
  }

  if (e.estado) {
    const match = Array.from($("equipmentStatus").options).find(opt => opt.value.toLowerCase() === e.estado.toLowerCase());
    if (match) {
      $("equipmentStatus").value = match.value;
    } else {
      const customOpt = new Option(e.estado, e.estado, true, true);
      $("equipmentStatus").add(customOpt);
      $("equipmentStatus").value = e.estado;
    }
  } else {
    $("equipmentStatus").value = "Bueno";
  }

  $("available").value = e.disponible || "si";
  setPeripheralsValue(e.perifericos || "");

  const regValue = e.registradoPor || e.asignadoPor || "";
  if (regValue) {
    const match = Array.from($("assignedBy").options).find(opt => opt.value.toLowerCase() === regValue.toLowerCase());
    if (match) {
      $("assignedBy").value = match.value;
    } else {
      const customOpt = new Option(regValue, regValue, true, true);
      $("assignedBy").add(customOpt);
      $("assignedBy").value = regValue;
    }
  } else {
    $("assignedBy").value = "";
  }

  $("equipmentDialogTitle").textContent = "Editar equipo";
  openDialog("equipmentDialog");
}
function prepareAssignment(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  $("assignmentForm").reset();
  clearPad("assignmentSignature");
  clearPad("assignmentDeliverySignature");
  $("assignmentEquipmentId").value = id; $("assignmentEquipmentLabel").textContent = `${equipmentName(e)} · ${e.tipo}`;
  $("assignedDate").value = today(); $("assignedCondition").value = e.estado || "Bueno"; $("assignedPeripherals").value = e.perifericos || "";
  openDialog("assignmentDialog");
}
function prepareReturn(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  const a = currentAssignment(e);
  $("returnForm").reset(); clearPad("returnSignature");
  $("returnEquipmentId").value = id; $("returnEquipmentLabel").textContent = `${equipmentName(e)} · ${e.tipo}`;
  $("receivedDate").value = today(); $("receivedFrom").value = a?.asignadoA || "";
  $("receivedArea").value = a?.area || ""; $("receivedPeripherals").value = a?.perifericos || e.perifericos || "";
  $("receivedCondition").value = e.estado || "Bueno"; openDialog("returnDialog");
}
async function saveEquipment(event) {
  event.preventDefault();
  const id = $("equipmentId").value;
  const data = { marca:$("brand").value.trim(), serial:$("serial").value.trim(), referencia:$("serial").value.trim(), tipo:$("type").value.trim(), estado:$("equipmentStatus").value, disponible:$("available").value, perifericos:$("peripherals").value.trim(), asignadoPor:$("assignedBy").value.trim(), registradoPor:$("assignedBy").value.trim(), updatedAt:serverTimestamp() };
  try {
    if (id) await updateDoc(doc(db,equipmentCollection,id), data);
    else await addDoc(collection(db,equipmentCollection), {...data, asignaciones:[], recepciones:[], createdAt:serverTimestamp()});
    closeDialog("equipmentDialog"); toast(id ? "Equipo actualizado correctamente." : "Equipo registrado correctamente."); await loadEquipment();
  } catch(err) { console.error(err); toast("No se pudo guardar. Revisa tu conexión y las reglas de Firebase."); }
}
async function saveAssignment(event) {
  event.preventDefault();
  const id = $("assignmentEquipmentId").value; const e = equipment.find(x => x.id === id); if (!e) return;
  const signatureReceive = padHasInk("assignmentSignature") ? $("assignmentSignature").toDataURL("image/png") : "";
  const signatureDelivery = padHasInk("assignmentDeliverySignature") ? $("assignmentDeliverySignature").toDataURL("image/png") : "";
  const a = {
    asignadoA: $("assignedTo").value.trim(),
    area: $("assignedArea").value.trim(),
    fecha: $("assignedDate").value,
    perifericos: $("assignedPeripherals").value.trim(),
    estado: $("assignedCondition").value,
    firma: signatureReceive,
    firmaRecibe: signatureReceive,
    firmaEntrega: signatureDelivery,
    entregadoPor: $("assignmentReceivedBy").value.trim(),
    recibidoPor: $("assignmentReceivedBy").value.trim(),
    registradoEn: new Date().toISOString()
  };
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
  $("historyTitle").textContent = `${equipmentName(e)} · ${e.tipo}`;
  const aList = e.asignaciones || [], rList = e.recepciones || [];
  $("historyContent").innerHTML = `<div class="detail-grid">
    <div class="detail-item"><small>Marca</small><strong>${escapeHTML(e.marca)}</strong></div>
    <div class="detail-item"><small>Serial</small><strong>${escapeHTML(e.serial || e.referencia || "—")}</strong></div>
    <div class="detail-item"><small>Tipo</small><strong>${escapeHTML(e.tipo)}</strong></div>
    <div class="detail-item"><small>Estado actual</small><strong>${escapeHTML(e.estado)}</strong></div>
    <div class="detail-item"><small>Disponibilidad</small><strong>${availabilityPill(e.disponible, e.estado)}</strong></div>
    <div class="detail-item"><small>Periféricos actuales</small><strong>${escapeHTML(e.perifericos || "—")}</strong></div>
    <div class="detail-item full"><small>Registrado por</small><strong>${escapeHTML(e.registradoPor || e.asignadoPor || "—")}</strong></div>
  </div>
  <div class="history-block"><h3>Historial de asignaciones (${aList.length})</h3>${aList.length ? [...aList].reverse().map(a => {
    const deliveryImg = a.firmaEntrega ? `<div class="sig-block"><small>Firma de quien entrega:</small><img class="signature-preview" src="${a.firmaEntrega}" alt="Firma de quien entrega"></div>` : "";
    const receiveImg = (a.firmaRecibe || a.firma) ? `<div class="sig-block"><small>Firma de quien recibe:</small><img class="signature-preview" src="${a.firmaRecibe || a.firma}" alt="Firma de quien recibe"></div>` : "";
    const sigs = (deliveryImg || receiveImg) ? `<div class="signatures-preview-row">${deliveryImg}${receiveImg}</div>` : "";
    return `<div class="history-entry"><strong>${escapeHTML(a.asignadoA)}</strong> · ${escapeHTML(a.area)}<br>Fecha: ${dateText(a.fecha)} · Estado: ${escapeHTML(a.estado)}<br>Periféricos: ${escapeHTML(a.perifericos || "—")}<br>Entregado por: ${escapeHTML(a.entregadoPor || a.recibidoPor || "—")}${sigs}</div>`;
  }).join("") : '<p class="empty-history">Sin asignaciones.</p>'}</div>
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
async function decommissionEquipment(id) {
  const e = equipment.find(x => x.id === id);
  if (!e) return;
  const name = equipmentName(e);
  const a = currentAssignment(e);
  const msg = a
    ? `El equipo "${name}" está actualmente asignado a ${a.asignadoA}.\n\n¿Estás seguro de darle de baja? El equipo ya no podrá volver a asignarse pero su registro e historial se conservarán.`
    : `¿Estás seguro de dar de baja el equipo "${name}"?\n\nEl equipo ya no podrá ser asignado pero su registro e historial se conservarán.`;

  if (!confirm(msg)) return;

  try {
    await updateDoc(doc(db, equipmentCollection, id), {
      estado: "De Baja",
      disponible: "no",
      updatedAt: serverTimestamp()
    });
    toast(`El equipo "${name}" fue dado de baja correctamente.`);
    await loadEquipment();
  } catch (err) {
    console.error(err);
    toast("No se pudo dar de baja el equipo. Verifica Firebase.");
  }
}

function exportToExcel() {
  const term = $("searchInput").value.trim().toLowerCase();
  const avail = $("availabilityFilter").value;
  const status = $("statusFilter").value.trim().toLowerCase();

  const itemsToExport = equipment.filter(e => {
    const a = currentAssignment(e);
    const text = [e.marca, e.serial, e.referencia, e.tipo, e.perifericos, e.registradoPor || e.asignadoPor, a?.asignadoA, a?.area].filter(Boolean).join(" ").toLowerCase();

    let matchesAvail = true;
    if (avail === "baja") matchesAvail = (e.estado || "").toLowerCase() === "de baja";
    else if (avail === "si") matchesAvail = e.disponible === "si" && (e.estado || "").toLowerCase() !== "de baja";
    else if (avail === "no") matchesAvail = e.disponible === "no" && (e.estado || "").toLowerCase() !== "de baja";

    const matchesStatus = !status || (e.estado || "").toLowerCase() === status;
    const matchesTerm = !term || text.includes(term);

    return matchesTerm && matchesAvail && matchesStatus;
  });

  if (!itemsToExport.length) {
    toast("No hay equipos para exportar con los filtros actuales.");
    return;
  }

  const headers = [
    "Marca",
    "Serial",
    "Tipo de equipo",
    "Estado",
    "Disponibilidad",
    "Periféricos",
    "Asignado a",
    "Área asignada",
    "Fecha de asignación",
    "Registrado por"
  ];

  const fileName = `Inventario_Supercarnes_JH_${today()}.xlsx`;

  if (typeof XLSX !== "undefined") {
    const rows = itemsToExport.map(e => {
      const a = currentAssignment(e);
      const isBaja = (e.estado || "").toLowerCase() === "de baja";
      const dispText = isBaja ? "De baja" : (e.disponible === "si" ? "Disponible" : "No disponible");
      return [
        e.marca || "",
        e.serial || e.referencia || "",
        e.tipo || "",
        e.estado || "",
        dispText,
        e.perifericos || "",
        a?.asignadoA || "",
        a?.area || "",
        a?.fecha ? dateText(a.fecha) : "",
        e.registradoPor || e.asignadoPor || ""
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
      { wch: 18 },
      { wch: 16 },
      { wch: 30 },
      { wch: 26 },
      { wch: 20 },
      { wch: 18 },
      { wch: 22 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, fileName);
  } else {
    const escapeCSV = val => `"${String(val ?? "").replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const rows = itemsToExport.map(e => {
      const a = currentAssignment(e);
      const isBaja = (e.estado || "").toLowerCase() === "de baja";
      const dispText = isBaja ? "De baja" : (e.disponible === "si" ? "Disponible" : "No disponible");
      return [
        escapeCSV(e.marca),
        escapeCSV(e.serial || e.referencia || ""),
        escapeCSV(e.tipo),
        escapeCSV(e.estado),
        escapeCSV(dispText),
        escapeCSV(e.perifericos || ""),
        escapeCSV(a?.asignadoA || ""),
        escapeCSV(a?.area || ""),
        escapeCSV(a?.fecha || ""),
        escapeCSV(e.registradoPor || e.asignadoPor || "")
      ].join(";");
    });
    const csvContent = "\uFEFFsep=;\r\n" + headers.map(escapeCSV).join(";") + "\r\n" + rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Inventario_Supercarnes_JH_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  toast(`Exportados ${itemsToExport.length} equipo(s) a ${fileName}`);
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
  if(action==="decommission")decommissionEquipment(id);
});
$("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
$("exportExcelBtn")?.addEventListener("click",exportToExcel);
["assignmentSignature","assignmentDeliverySignature","returnSignature"].forEach(setupSignaturePad);
setupPeripheralsSelect();

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
