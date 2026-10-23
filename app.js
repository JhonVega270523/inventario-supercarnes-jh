import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { LOGO_JH_DATA_URL } from "./logo-data.js";

const $ = id => document.getElementById(id);
const equipmentCollection = "equipos";
let db = null;
let equipment = [];
let currentDetailEquipmentId = null;
let toastTimer;
let equipmentPhotoData = [];
let equipmentPhotoProcessing = false;
const maxEquipmentPhotos = 4;
const pageSize = 20;
const tablePages = { inventory: 1, assignments: 1, returns: 1 };

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3300);
}
function today() { return new Date().toLocaleDateString("en-CA"); }
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function getEquipmentPhotos(e) {
  const photos = Array.isArray(e.fotos) && e.fotos.length ? e.fotos : [e.foto];
  return photos.filter(photo => typeof photo === "string" && photo.startsWith("data:image/jpeg;base64,")).slice(0, maxEquipmentPhotos);
}
function setEquipmentPhotos(photos = []) {
  equipmentPhotoData = photos.slice(0, maxEquipmentPhotos);
  const preview = $("equipmentPhotoPreview");
  preview.innerHTML = equipmentPhotoData.map((photo, index) => `
    <div class="equipment-photo-card">
      <img src="${escapeHTML(photo)}" alt="Foto ${index + 1} del equipo">
      <button type="button" class="btn btn-outline equipment-photo-remove" data-remove-equipment-photo="${index}" aria-label="Quitar foto ${index + 1}">Quitar</button>
    </div>`).join("");
  preview.hidden = equipmentPhotoData.length === 0;
  $("equipmentPhotoPickerText").textContent = `Agregar foto (${equipmentPhotoData.length}/${maxEquipmentPhotos})`;
  $("equipmentPhotoInput").disabled = equipmentPhotoProcessing || equipmentPhotoData.length >= maxEquipmentPhotos;
  $("equipmentPhotoInput").closest(".equipment-photo-picker").classList.toggle("disabled", $("equipmentPhotoInput").disabled);
}
function compressEquipmentPhoto(file) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Selecciona un archivo de imagen válido."));
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement("canvas");
        let scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const maxBytes = 100 * 1024;

        for (let attempt = 0; attempt < 9; attempt++) {
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          const quality = Math.max(0.5, 0.82 - attempt * 0.04);
          const blob = await new Promise((toBlobResolve, toBlobReject) => {
            canvas.toBlob(result => {
              if (result) toBlobResolve(result);
              else toBlobReject(new Error("No fue posible optimizar la foto."));
            }, "image/jpeg", quality);
          });

          if (blob.size <= maxBytes) {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("No fue posible leer la foto optimizada."));
            reader.readAsDataURL(blob);
            return;
          }
          scale *= 0.88;
        }

        reject(new Error("La foto es demasiado grande. Intenta tomarla con menor resolución."));
      } catch (err) {
        reject(err);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No fue posible abrir la foto seleccionada."));
    };
    image.src = objectUrl;
  });
}
async function handleEquipmentPhotoChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (equipmentPhotoData.length >= maxEquipmentPhotos) {
    toast("Cada equipo puede tener máximo cuatro fotos.");
    event.target.value = "";
    return;
  }

  equipmentPhotoProcessing = true;
  setEquipmentPhotos(equipmentPhotoData);
  $("equipmentPhotoStatus").textContent = "Optimizando foto…";
  try {
    setEquipmentPhotos([...equipmentPhotoData, await compressEquipmentPhoto(file)]);
    $("equipmentPhotoStatus").textContent = `Foto ${equipmentPhotoData.length} de ${maxEquipmentPhotos} lista para guardar.`;
  } catch (err) {
    console.error(err);
    $("equipmentPhotoStatus").textContent = "";
    toast(err.message || "No fue posible procesar la foto.");
  } finally {
    equipmentPhotoProcessing = false;
    setEquipmentPhotos(equipmentPhotoData);
    event.target.value = "";
  }
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

function paginateRows(rows, table, paginationId) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  tablePages[table] = Math.min(tablePages[table], pageCount);
  const page = tablePages[table];
  const startIndex = (page - 1) * pageSize;
  const firstRow = rows.length ? startIndex + 1 : 0;
  const lastRow = Math.min(startIndex + pageSize, rows.length);
  const pagination = $(paginationId);

  pagination.innerHTML = `
    <span class="pagination-status">${firstRow}–${lastRow} de ${rows.length}</span>
    <div class="pagination-buttons">
      <button type="button" class="btn btn-outline" data-pagination="${table}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Anterior</button>
      <span class="pagination-current">Página ${page} de ${pageCount}</span>
      <button type="button" class="btn btn-outline" data-pagination="${table}" data-page="${page + 1}" ${page >= pageCount ? "disabled" : ""}>Siguiente</button>
    </div>`;

  return rows.slice(startIndex, startIndex + pageSize);
}

function confirmAction({ title, message, confirmText, destructive = false }) {
  const dialog = $("confirmationDialog");
  const acceptButton = $("confirmationAcceptBtn");
  $("confirmationTitle").textContent = title;
  $("confirmationMessage").textContent = message;
  $("confirmationEyebrow").textContent = destructive ? "ACCIÓN PERMANENTE" : "CONFIRMACIÓN";
  $("confirmationIcon").textContent = destructive ? "!" : "?";
  acceptButton.textContent = confirmText;
  acceptButton.classList.toggle("btn-danger", destructive);
  dialog.dataset.confirmed = "false";
  dialog.showModal();

  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      resolve(dialog.dataset.confirmed === "true");
    }, { once: true });
  });
}

function listenToEquipment() {
  if (!db) return;
  onSnapshot(collection(db, equipmentCollection), { includeMetadataChanges: true }, snapshot => {
    equipment = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
    renderAll();
    if (currentDetailEquipmentId && !equipment.some(e => e.id === currentDetailEquipmentId)) {
      $("historyDialog").close();
      currentDetailEquipmentId = null;
    }
    $("connectionText").textContent = snapshot.metadata.fromCache
      ? "Sincronizando con Firebase…"
      : "Sincronizado en tiempo real";
    document.querySelector(".connection-dot").style.background = snapshot.metadata.fromCache ? "#d99a18" : "#31b66a";
  }, err => {
    console.error(err);
    $("connectionText").textContent = "Error de sincronización";
    document.querySelector(".connection-dot").style.background = "#b5121b";
    toast("No fue posible sincronizar Firestore. Revisa la conexión, las reglas y la configuración.");
  });
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
    return `<tr>
      <td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
      <td><span class="serial-tag">${escapeHTML(e.serial || e.referencia || "—")}</span></td>
      <td>${escapeHTML(e.tipo)}</td>
      <td>${statusPill(e.estado)}</td>
      <td>${availabilityPill(e.disponible, e.estado)}</td>
      <td>${escapeHTML(a?.asignadoA || "—")}</td>
      <td>
        <div class="actions">
          <button class="action-btn action-btn-detail" data-action="detail" data-id="${e.id}" title="Ver detalle del activo" aria-label="Ver detalle">
            <span class="btn-icon">👁</span><span class="btn-text">Ver</span>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">Aún no hay equipos. Registra el primero para comenzar.</td></tr>';
}
function renderInventory() {
  const term = $("searchInput").value.trim().toLowerCase();
  const avail = $("availabilityFilter").value;
  const status = $("statusFilter").value.trim().toLowerCase();
  const filtered = equipment.filter(e => {
    const a = currentAssignment(e);
    const text = [e.marca,e.serial,e.referencia,e.tipo,e.perifericos,e.observaciones,e.registradoPor || e.asignadoPor,a?.asignadoA,a?.area].filter(Boolean).join(" ").toLowerCase();

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
  const pageRows = paginateRows(filtered, "inventory", "inventoryPagination");
  $("inventoryTable").innerHTML = pageRows.length ? pageRows.map(e => {
    const a = currentAssignment(e);
    const isBaja = (e.estado || "").toLowerCase() === "de baja";
    let actionBtns = `
      <button class="action-btn action-btn-detail" data-action="detail" data-id="${e.id}" title="Ver detalle del activo" aria-label="Ver detalle">
        <span class="btn-icon">👁</span><span class="btn-text">Ver</span>
      </button>
      <button class="action-btn action-btn-edit" data-action="edit" data-id="${e.id}" title="Editar equipo" aria-label="Editar">
        <span class="btn-icon">✎</span><span class="btn-text">Editar</span>
      </button>`;
    if (!isBaja) {
      if (e.disponible === "si") {
        actionBtns += `
          <button class="action-btn action-btn-assign" data-action="assign" data-id="${e.id}" title="Asignar equipo" aria-label="Asignar">
            <span class="btn-icon">↗</span><span class="btn-text">Asignar</span>
          </button>`;
      } else {
        actionBtns += `
          <button class="action-btn action-btn-receive" data-action="receive" data-id="${e.id}" title="Recibir equipo devuelto" aria-label="Recibir">
            <span class="btn-icon">↙</span><span class="btn-text">Recibir</span>
          </button>`;
      }
      actionBtns += `
        <button class="action-btn action-btn-baja" data-action="decommission" data-id="${e.id}" title="Dar de baja al equipo" aria-label="Dar de baja">
          <span class="btn-icon">✕</span><span class="btn-text">Dar de baja</span>
        </button>`;
    }
    actionBtns += `
      <button class="action-btn action-btn-delete" data-action="delete" data-id="${e.id}" title="Eliminar permanentemente el equipo" aria-label="Eliminar equipo">
        <span class="btn-icon">🗑</span><span class="btn-text">Eliminar</span>
      </button>`;
    return `<tr>
      <td><span class="equipment-name">${escapeHTML(e.marca || "—")}</span></td>
      <td><span class="serial-tag">${escapeHTML(e.serial || e.referencia || "—")}</span></td>
      <td>${escapeHTML(e.tipo || "—")}</td>
      <td>${statusPill(e.estado)}</td>
      <td>${escapeHTML(e.perifericos || "—")}</td>
      <td>${availabilityPill(e.disponible, e.estado)}</td>
      <td>${escapeHTML(a?.asignadoA || "—")}<span class="subtext">${escapeHTML(a?.area || "")}</span></td>
      <td>${dateText(a?.fecha)}</td>
      <td><div class="actions">${actionBtns}</div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="9" class="empty-cell">No se encontraron equipos con esos filtros.</td></tr>';
}
function renderAssignments() {
  const rows = [];
  equipment.forEach(e => (e.asignaciones || []).forEach(a => rows.push({e,a})));
  rows.sort((x,y) => (y.a.fecha || "").localeCompare(x.a.fecha || ""));
  const pageRows = paginateRows(rows, "assignments", "assignmentsPagination");
  $("assignmentsTable").innerHTML = pageRows.length ? pageRows.map(({e,a}) => `<tr>
    <td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
    <td><span class="serial-tag">${escapeHTML(e.serial || e.referencia || "—")}</span></td>
    <td>${escapeHTML(a.asignadoA)}</td>
    <td>${escapeHTML(a.area)}</td>
    <td>${dateText(a.fecha)}</td>
    <td>${statusPill(a.estado)}</td>
    <td>${escapeHTML(a.entregadoPor || a.recibidoPor || "—")}</td>
  </tr>`).join("") : '<tr><td colspan="7" class="empty-cell">No hay asignaciones registradas.</td></tr>';
}
function renderReturns() {
  const rows = [];
  equipment.forEach(e => (e.recepciones || []).forEach(r => rows.push({e,r})));
  rows.sort((x,y) => (y.r.fecha || "").localeCompare(x.r.fecha || ""));
  const pageRows = paginateRows(rows, "returns", "returnsPagination");
  $("returnsTable").innerHTML = pageRows.length ? pageRows.map(({e,r}) => `<tr>
    <td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
    <td><span class="serial-tag">${escapeHTML(e.serial || e.referencia || "—")}</span></td>
    <td>${escapeHTML(r.recibidoDe)}</td>
    <td>${escapeHTML(r.recibidoPor || "—")}</td>
    <td>${escapeHTML(r.area)}</td>
    <td>${dateText(r.fecha)}</td>
    <td>${statusPill(r.estado)}</td>
  </tr>`).join("") : '<tr><td colspan="7" class="empty-cell">No hay recepciones registradas.</td></tr>';
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
  setEquipmentPhotos();
  $("equipmentPhotoStatus").textContent = "";
  $("equipmentId").value = "";
  $("equipmentDialogTitle").textContent = "Registrar equipo";
  $("brand").value = "";
  $("serial").value = "";
  $("available").value = "si";
  $("equipmentStatus").value = "Bueno";
  $("type").value = "";
  setPeripheralsValue("");
  $("observations").value = "";
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
  setEquipmentPhotos(getEquipmentPhotos(e));
  setPeripheralsValue(e.perifericos || "");
  $("observations").value = e.observaciones || "";

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
  $("assignmentReceivedBy").value = "";
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
  if (equipmentPhotoProcessing) {
    toast("Espera a que termine de procesarse la foto.");
    return;
  }
  const id = $("equipmentId").value;
  const data = {
    marca: $("brand").value.trim(),
    serial: $("serial").value.trim(),
    referencia: $("serial").value.trim(),
    tipo: $("type").value.trim(),
    estado: $("equipmentStatus").value,
    disponible: $("available").value,
    perifericos: $("peripherals").value.trim(),
    observaciones: $("observations").value.trim(),
    fotos: equipmentPhotoData,
    foto: equipmentPhotoData[0] || "",
    asignadoPor: $("assignedBy").value.trim(),
    registradoPor: $("assignedBy").value.trim(),
    updatedAt: serverTimestamp()
  };
  closeDialog("equipmentDialog");
  toast(id ? "Actualizando equipo..." : "Guardando equipo...");
  try {
    if (id) await updateDoc(doc(db,equipmentCollection,id), data);
    else await addDoc(collection(db,equipmentCollection), {...data, asignaciones:[], recepciones:[], createdAt:serverTimestamp()});
    toast(id ? "Equipo actualizado correctamente." : "Equipo registrado correctamente.");
  } catch(err) {
    console.error(err);
    openDialog("equipmentDialog");
    toast("No se pudo guardar. Revisa tu conexión y las reglas de Firebase.");
  }
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
  closeDialog("assignmentDialog");
  toast("Guardando asignación...");
  try {
    await updateDoc(doc(db,equipmentCollection,id), {disponible:"no", asignaciones:[...(e.asignaciones || []),a], estado:a.estado, updatedAt:serverTimestamp()});
    toast("Asignación guardada correctamente.");
  } catch(err) {
    console.error(err);
    openDialog("assignmentDialog");
    toast("No se pudo guardar la asignación. Verifica Firebase.");
  }
}
async function saveReturn(event) {
  event.preventDefault();
  const id = $("returnEquipmentId").value; const e = equipment.find(x => x.id === id); if (!e) return;
  const signature = padHasInk("returnSignature") ? $("returnSignature").toDataURL("image/png") : "";
  const r = { recibidoDe:$("receivedFrom").value.trim(), recibidoPor:$("returnReceivedBy").value, area:$("receivedArea").value.trim(), fecha:$("receivedDate").value, perifericos:$("receivedPeripherals").value.trim(), estado:$("receivedCondition").value, firma:signature, registradoEn:new Date().toISOString() };
  closeDialog("returnDialog");
  toast("Guardando recepción...");
  try {
    await updateDoc(doc(db,equipmentCollection,id), {disponible:"si", estado:r.estado, perifericos:r.perifericos, recepciones:[...(e.recepciones || []),r], updatedAt:serverTimestamp()});
    toast("Recepción guardada. El equipo quedó disponible.");
  } catch(err) {
    console.error(err);
    openDialog("returnDialog");
    toast("No se pudo guardar la recepción. Verifica Firebase.");
  }
}
function showDetail(id) {
  const e = equipment.find(x => x.id === id); if (!e) return;
  currentDetailEquipmentId = id;
  $("historyTitle").textContent = `${equipmentName(e)} · ${e.tipo}`;
  const aList = e.asignaciones || [], rList = e.recepciones || [];
  const hasObs = Boolean(e.observaciones && e.observaciones.trim());
  const photos = getEquipmentPhotos(e);

  $("historyContent").innerHTML = `${photos.length ? `<div class="equipment-detail-photos photos-${photos.length}">${photos.map((photo, index) => `<button type="button" class="equipment-detail-photo" data-view-equipment-photo="${index}" aria-label="Ampliar foto ${index + 1}"><img src="${escapeHTML(photo)}" alt="Foto ${index + 1} de ${escapeHTML(e.marca || "equipo")}"></button>`).join("")}</div>` : ""}<div class="detail-grid">
    <div class="detail-item"><small>Marca</small><strong>${escapeHTML(e.marca)}</strong></div>
    <div class="detail-item"><small>Serial</small><strong>${escapeHTML(e.serial || e.referencia || "—")}</strong></div>
    <div class="detail-item"><small>Tipo</small><strong>${escapeHTML(e.tipo)}</strong></div>
    <div class="detail-item"><small>Estado actual</small><strong>${escapeHTML(e.estado)}</strong></div>
    <div class="detail-item"><small>Disponibilidad</small><strong>${availabilityPill(e.disponible, e.estado)}</strong></div>
    <div class="detail-item"><small>Periféricos actuales</small><strong>${escapeHTML(e.perifericos || "—")}</strong></div>
    <div class="detail-item full"><small>Registrado por</small><strong>${escapeHTML(e.registradoPor || e.asignadoPor || "—")}</strong></div>
    <div class="detail-item full detail-notes-card">
      <div class="detail-notes-header">
        <small>Observaciones del equipo</small>
        <button type="button" class="btn-link-action" id="detailNotesToggleBtn">${hasObs ? "✎ Editar observación" : "＋ Agregar observación"}</button>
      </div>
      <div id="detailNotesView" class="detail-notes-view">
        <p id="detailNotesText" class="detail-notes-text ${hasObs ? 'has-notes' : 'empty-notes'}">${hasObs ? escapeHTML(e.observaciones) : "Sin observaciones registradas para este equipo."}</p>
      </div>
      <div id="detailNotesEdit" class="detail-notes-edit" style="display:none;">
        <textarea id="detailNotesInput" rows="3" placeholder="Escribe aquí las observaciones o notas del equipo...">${escapeHTML(e.observaciones || "")}</textarea>
        <div class="detail-notes-actions">
          <button type="button" class="btn btn-outline btn-sm" id="detailNotesCancelBtn">Cancelar</button>
          <button type="button" class="btn btn-primary btn-sm" id="detailNotesSaveBtn">Guardar observación</button>
        </div>
      </div>
    </div>
  </div>
  <div class="history-block"><h3>Historial de asignaciones (${aList.length})</h3>${aList.length ? [...aList].reverse().map(a => {
    const deliveryImg = a.firmaEntrega ? `<div class="sig-block"><small>Firma de quien entrega:</small><img class="signature-preview" src="${a.firmaEntrega}" alt="Firma de quien entrega"></div>` : "";
    const receiveImg = (a.firmaRecibe || a.firma) ? `<div class="sig-block"><small>Firma de quien recibe:</small><img class="signature-preview" src="${a.firmaRecibe || a.firma}" alt="Firma de quien recibe"></div>` : "";
    const sigs = (deliveryImg || receiveImg) ? `<div class="signatures-preview-row">${deliveryImg}${receiveImg}</div>` : "";
    return `<div class="history-entry"><strong>${escapeHTML(a.asignadoA)}</strong> · ${escapeHTML(a.area)}<br>Fecha: ${dateText(a.fecha)} · Estado: ${escapeHTML(a.estado)}<br>Periféricos: ${escapeHTML(a.perifericos || "—")}<br>Entregado por: ${escapeHTML(a.entregadoPor || a.recibidoPor || "—")}${sigs}</div>`;
  }).join("") : '<p class="empty-history">Sin asignaciones.</p>'}</div>
  <div class="history-block"><h3>Historial de recepciones (${rList.length})</h3>${rList.length ? [...rList].reverse().map(r => `<div class="history-entry"><strong>Recibido de: ${escapeHTML(r.recibidoDe)}</strong> · ${escapeHTML(r.area)}<br>Recibido por: ${escapeHTML(r.recibidoPor || "—")}<br>Fecha: ${dateText(r.fecha)} · Estado: ${escapeHTML(r.estado)}<br>Periféricos: ${escapeHTML(r.perifericos || "—")}${r.firma ? `<br><img class="signature-preview" src="${r.firma}" alt="Firma de recepción">` : ""}</div>`).join("") : '<p class="empty-history">Sin recepciones.</p>'}</div>`;

  setupDetailNotesEvents(e);
  openDialog("historyDialog");
}

async function downloadEquipmentPdf(id) {
  const e = equipment.find(x => x.id === id);
  if (!e) return;
  toast("Generando PDF del activo...");

  const curAssign = currentAssignment(e);
  const aList = e.asignaciones || [];
  const rList = e.recepciones || [];
  const cleanBrand = (e.marca || "JH").replace(/[^\w-]/g, "_");
  const cleanSerial = (e.serial || e.referencia || "SN").replace(/[^\w-]/g, "_");
  const fileName = `Ficha_Activo_${cleanBrand}_${cleanSerial}_${today()}.pdf`;

  // — Sección de asignación actual —
  let assignSection = "";
  if (curAssign) {
    assignSection = `
      <div style="margin-bottom:12px;">
        <h2 style="font-size:12.5px;font-weight:800;color:#b5121b;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #f1f5f9;padding-bottom:5px;margin:0 0 10px;">2. ASIGNACIÓN ACTUAL</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
          <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Asignado actualmente a:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(curAssign.asignadoA)}</strong></div>
          <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Área / Departamento:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(curAssign.area)}</strong></div>
          <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Fecha de asignación:</small><strong style="color:#0f172a;font-size:11.5px;">${dateText(curAssign.fecha)}</strong></div>
          <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Condición al entregar:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(curAssign.estado)}</strong></div>
          <div style="grid-column:1/-1;"><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Periféricos entregados:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(curAssign.perifericos || "—")}</strong></div>
          <div style="grid-column:1/-1;"><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Entregado por:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(curAssign.entregadoPor || curAssign.recibidoPor || "—")}</strong></div>
        </div>
      </div>`;
  } else if ((e.estado || "").toLowerCase() === "de baja") {
    assignSection = `
      <div style="margin-bottom:12px;">
        <h2 style="font-size:12.5px;font-weight:800;color:#b5121b;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #f1f5f9;padding-bottom:5px;margin:0 0 10px;">2. ASIGNACIÓN ACTUAL</h2>
        <p style="font-size:11px;color:#64748b;padding:8px 0;">El equipo se encuentra actualmente dado de baja.</p>
      </div>`;
  } else {
    assignSection = `
      <div style="margin-bottom:12px;">
        <h2 style="font-size:12.5px;font-weight:800;color:#b5121b;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #f1f5f9;padding-bottom:5px;margin:0 0 10px;">2. ASIGNACIÓN ACTUAL</h2>
        <p style="font-size:11px;color:#64748b;padding:8px 0;">El equipo no se encuentra asignado (Disponible en inventario).</p>
      </div>`;
  }

  // — Firmas —
  const activeAssign = curAssign || (aList.length ? aList[aList.length - 1] : null);
  const activeReturn = latestReturn(e);

  let deliverySig = activeAssign?.firmaEntrega || "";
  let receiveSig = activeAssign?.firmaRecibe || activeAssign?.firma || "";

  if (!deliverySig && aList.length) {
    const foundD = aList.slice().reverse().find(x => x.firmaEntrega);
    if (foundD) deliverySig = foundD.firmaEntrega;
  }
  if (!receiveSig && aList.length) {
    const foundR = aList.slice().reverse().find(x => x.firmaRecibe || x.firma);
    if (foundR) receiveSig = foundR.firmaRecibe || foundR.firma;
  }

  const deliveryName = activeAssign?.entregadoPor || activeAssign?.recibidoPor || e.registradoPor || e.asignadoPor || "Responsable de Entrega";
  const deliveryDate = activeAssign?.fecha ? dateText(activeAssign.fecha) : today();
  const receiveName = activeAssign?.asignadoA || (activeReturn ? activeReturn.recibidoDe : "Funcionario Responsable");
  const receiveArea = activeAssign?.area || (activeReturn?.area || "");
  const receiveDate = activeAssign?.fecha ? dateText(activeAssign.fecha) : today();

  let returnName = activeReturn?.recibidoDe || "";
  let returnSig = activeReturn?.firma || "";
  let returnDate = activeReturn?.fecha ? dateText(activeReturn.fecha) : "";

  if (!returnSig && rList.length) {
    const foundRet = rList.slice().reverse().find(x => x.firma);
    if (foundRet) {
      returnSig = foundRet.firma;
      returnName = foundRet.recibidoDe || returnName;
      returnDate = foundRet.fecha ? dateText(foundRet.fecha) : returnDate;
    }
  }

  const sigCardStyle = "flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px 6px;text-align:center;display:flex;flex-direction:column;align-items:center;min-height:112px;justify-content:space-between;break-inside:avoid;page-break-inside:avoid;";
  const sigRoleStyle = "display:block;font-size:9px;font-weight:800;color:#475569;letter-spacing:.6px;text-transform:uppercase;margin-bottom:3px;border-bottom:1px solid #e2e8f0;padding-bottom:3px;width:100%;";
  const sigBoxStyle = "height:44px;display:flex;align-items:center;justify-content:center;width:100%;margin:2px 0;";
  const sigInfoStyle = "width:100%;border-top:1px solid #cbd5e1;padding-top:4px;margin-top:2px;";

  let sigCardsHtml = `
    <div style="${sigCardStyle}">
      <small style="${sigRoleStyle}">ENTREGADO POR (SISTEMAS / TI)</small>
      <div style="${sigBoxStyle}">
        ${deliverySig ? `<img src="${deliverySig}" style="max-height:40px;max-width:210px;object-fit:contain;display:block;" alt="Firma entrega">` : `<div style="width:75%;border-bottom:1.5px dashed #94a3b8;height:28px;margin:0 auto;"></div>`}
      </div>
      <div style="${sigInfoStyle}">
        <p style="margin:0;font-size:11px;font-weight:800;color:#0f172a;">${escapeHTML(deliveryName)}</p>
        <p style="margin:2px 0 0;font-size:9.5px;color:#64748b;font-weight:600;">Área de Sistemas / Soporte</p>
        <p style="margin:2px 0 0;font-size:9px;color:#94a3b8;">Fecha: ${deliveryDate}</p>
      </div>
    </div>
    <div style="${sigCardStyle}">
      <small style="${sigRoleStyle}">RECIBIDO A CONFORMIDAD</small>
      <div style="${sigBoxStyle}">
        ${receiveSig ? `<img src="${receiveSig}" style="max-height:40px;max-width:210px;object-fit:contain;display:block;" alt="Firma recibe">` : `<div style="width:75%;border-bottom:1.5px dashed #94a3b8;height:28px;margin:0 auto;"></div>`}
      </div>
      <div style="${sigInfoStyle}">
        <p style="margin:0;font-size:11px;font-weight:800;color:#0f172a;">${escapeHTML(receiveName)}</p>
        <p style="margin:2px 0 0;font-size:9.5px;color:#64748b;font-weight:600;">${escapeHTML(receiveArea ? `Funcionario (${receiveArea})` : "Funcionario Responsable")}</p>
        <p style="margin:2px 0 0;font-size:9px;color:#94a3b8;">Fecha: ${receiveDate}</p>
      </div>
    </div>`;

  if (returnSig) {
    sigCardsHtml += `
    <div style="${sigCardStyle}">
      <small style="${sigRoleStyle}">RECEPCIÓN DE DEVOLUCIÓN</small>
      <div style="${sigBoxStyle}">
        <img src="${returnSig}" style="max-height:40px;max-width:210px;object-fit:contain;display:block;" alt="Firma devolución">
      </div>
      <div style="${sigInfoStyle}">
        <p style="margin:0;font-size:11px;font-weight:800;color:#0f172a;">${escapeHTML(returnName)}</p>
        <p style="margin:2px 0 0;font-size:9.5px;color:#64748b;font-weight:600;">Devuelto a inventario</p>
        <p style="margin:2px 0 0;font-size:9px;color:#94a3b8;">Fecha: ${returnDate}</p>
      </div>
    </div>`;
  }

  // — Construir HTML completo como string (no depende del DOM para estilos) —
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #fff; color: #1e293b; font-size: 12px; }
</style>
</head>
<body>
<div style="max-width:800px;margin:0 auto;padding:14px 20px;background:#fff;font-family:Arial,sans-serif;color:#1e293b;">

  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #b5121b;padding-bottom:12px;margin-bottom:12px;">
    <img src="${LOGO_JH_DATA_URL}" style="max-width:145px;height:auto;" alt="Supercarnes JH">
    <div style="text-align:right;">
      <h1 style="font-size:19px;color:#b5121b;margin:0 0 4px;">SUPERCARNES JH</h1>
      <p style="font-size:11px;color:#64748b;font-weight:600;margin:0;">FICHA TÉCNICA Y CONTROL DE ACTIVO</p>
      <p style="font-size:11px;color:#64748b;font-weight:600;margin:2px 0 0;">Generado el ${new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
  </div>

  <p style="font-size:11px;line-height:1.5;margin:0 0 10px;color:#334155;">Por medio de este escrito hago constar que se me hace entrega del o los siguientes equipos y herramientas de trabajo:</p>

  <div style="margin-bottom:12px;">
    <h2 style="font-size:12.5px;font-weight:800;color:#b5121b;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #f1f5f9;padding-bottom:5px;margin:0 0 10px;">1. INFORMACIÓN GENERAL DEL EQUIPO</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
      <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Marca:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(e.marca || "—")}</strong></div>
      <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Serial / Referencia:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(e.serial || e.referencia || "—")}</strong></div>
      <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Tipo de equipo:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(e.tipo || "—")}</strong></div>
      <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Estado actual:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(e.estado || "—")}</strong></div>
      <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Disponibilidad:</small><strong style="color:#0f172a;font-size:11.5px;">${(e.estado || "").toLowerCase() === "de baja" ? "De baja" : (e.disponible === "si" ? "Disponible" : "Asignado / No disponible")}</strong></div>
      <div><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Registrado por:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(e.registradoPor || e.asignadoPor || "—")}</strong></div>
      <div style="grid-column:1/-1;"><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Periféricos actuales:</small><strong style="color:#0f172a;font-size:11.5px;">${escapeHTML(e.perifericos || "Ninguno")}</strong></div>
      <div style="grid-column:1/-1;"><small style="display:block;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Observaciones:</small><div style="white-space:pre-wrap;margin-top:2px;color:#334155;font-size:11px;">${escapeHTML(e.observaciones || "Sin observaciones registradas.")}</div></div>
    </div>
  </div>

  ${assignSection}

  <div style="margin-bottom:10px;">
    <h2 style="font-size:12.5px;font-weight:800;color:#b5121b;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #f1f5f9;padding-bottom:5px;margin:0 0 10px;">3. MANIFESTACIÓN DEL COLABORADOR</h2>
    <p style="font-size:11px;line-height:1.5;margin:0 0 8px;color:#334155;">El colaborador manifiesta por medio de este documento que:</p>
    <ol style="font-size:10.5px;line-height:1.5;padding-left:22px;color:#334155;">
      <li style="margin-bottom:5px;">Recibió el o los equipos y herramientas de trabajo anteriormente descritos, en buen estado físico y técnico por parte de la empresa.</li>
      <li style="margin-bottom:5px;">Se compromete a cuidar y hacer buen uso del o los equipos de trabajo entregados por la empresa.</li>
      <li style="margin-bottom:5px;">Se compromete a usar el o los equipos de trabajo exclusivamente para el desarrollo de sus actividades o funciones laborales. En caso de utilizar los equipos para fines distintos a los laborales, estará incumpliendo con el reglamento interno de trabajo de la empresa.</li>
      <li style="margin-bottom:5px;">Será responsable de la pérdida y/o daños sin justificación ocasionados por el mal uso o descuido de los equipos y herramientas de trabajo. Por consiguiente, autoriza a la empresa a descontar de su salario el valor del o los equipos y herramientas de trabajo que por su culpa (sin justificación) se hayan dañado o perdido.</li>
      <li>Los equipos y herramientas de trabajo anteriormente descritos son de propiedad de la compañía. Por consiguiente, en caso de terminación del contrato de trabajo, me comprometo a devolverlos íntegramente y en buen estado.</li>
    </ol>
  </div>

  <div style="margin-top:10px;break-inside:avoid;page-break-inside:avoid;">
    <h2 style="font-size:12.5px;font-weight:800;color:#b5121b;text-transform:uppercase;letter-spacing:.8px;border-bottom:1.5px solid #f1f5f9;padding-bottom:5px;margin:0 0 10px;">4. CONSTANCIA Y FIRMAS DE CONFORMIDAD</h2>
    <div style="display:flex;gap:12px;justify-content:space-between;margin-top:6px;break-inside:avoid;page-break-inside:avoid;">
      ${sigCardsHtml}
    </div>
  </div>

  <div style="border-top:1px solid #e2e8f0;padding-top:6px;margin-top:10px;text-align:center;font-size:9.5px;color:#94a3b8;">
    Supercarnes JH · Sistema de Gestión y Control de Equipos · Documento de Control Interno
  </div>

</div>
</body>
</html>`;

  try {
    if (typeof window.html2pdf !== "undefined") {
      const opt = {
        margin: [4, 10, 10, 10],
        filename: fileName,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          onclone: clonedDocument => {
            const clonedWrapper = clonedDocument.getElementById("equipmentPdfRenderWrapper");
            if (clonedWrapper) clonedWrapper.style.visibility = "visible";
          }
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      };

      // html2canvas no captura de forma fiable elementos ubicados fuera del viewport.
      const wrapper = document.createElement("div");
      wrapper.id = "equipmentPdfRenderWrapper";
      wrapper.style.cssText = "position:fixed;top:0;left:0;width:800px;background:#fff;z-index:2147483647;pointer-events:none;visibility:hidden;";
      wrapper.innerHTML = htmlContent;
      document.body.appendChild(wrapper);

      const target = wrapper.querySelector("div") || wrapper;
      try {
        await window.html2pdf().set(opt).from(target).save();
        toast("PDF descargado correctamente.");
      } finally {
        wrapper.remove();
      }
    } else {
      const printWin = window.open("", "_blank");
      if (!printWin) { toast("Permite ventanas emergentes para ver el PDF."); return; }
      printWin.document.write(htmlContent);
      printWin.document.close();
      printWin.onload = () => { setTimeout(() => { printWin.print(); }, 400); };
      toast("Abriendo ventana de impresión para guardar como PDF.");
    }
  } catch (err) {
    console.error("Error al exportar PDF:", err);
    const printWin = window.open("", "_blank");
    if (!printWin) { toast("No se pudo generar el PDF."); return; }
    printWin.document.write(htmlContent);
    printWin.document.close();
    printWin.onload = () => { setTimeout(() => { printWin.print(); }, 400); };
    toast("Abriendo ventana de impresión para guardar como PDF.");
  }
}

function fallbackPrintPdf(container, fileName) {
  const printWin = window.open("", "_blank");
  if (!printWin) {
    toast("Permite las ventanas emergentes en tu navegador para ver el PDF.");
    return;
  }
  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHTML(fileName)}</title>
      <style>
        body { font-family: Inter, system-ui, sans-serif; background: white; margin: 0; padding: 20px; color: #1e293b; }
        .pdf-container { max-width: 800px; margin: 0 auto; }
        .pdf-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #b5121b; padding-bottom: 14px; margin-bottom: 18px; }
        .pdf-logo { max-width: 145px; height: auto; }
        .pdf-header-info { text-align: right; }
        .pdf-header-info h1 { margin: 0 0 4px; font-size: 19px; color: #b5121b; }
        .pdf-header-info p { margin: 0; font-size: 11px; color: #64748b; font-weight: 600; }
        .pdf-section { margin-bottom: 18px; page-break-inside: avoid; }
        .pdf-section-title { font-size: 12.5px; font-weight: 800; color: #b5121b; text-transform: uppercase; letter-spacing: .8px; border-bottom: 1.5px solid #f1f5f9; padding-bottom: 5px; margin: 0 0 10px; }
        .pdf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
        .pdf-field small { display: block; color: #64748b; font-size: 9.5px; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
        .pdf-field strong { color: #0f172a; font-size: 11.5px; }
        .pdf-full { grid-column: 1 / -1; }
        .pdf-signatures-section { margin-top: 22px; page-break-inside: avoid; }
        .pdf-signatures-grid { display: flex; gap: 16px; justify-content: space-between; margin-top: 10px; }
        .pdf-sig-card { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px 10px; text-align: center; display: flex; flex-direction: column; align-items: center; min-height: 165px; justify-content: space-between; box-sizing: border-box; }
        .pdf-sig-role { display: block; font-size: 9.5px; font-weight: 800; color: #475569; letter-spacing: .6px; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; width: 100%; }
        .pdf-sig-box { height: 75px; display: flex; align-items: center; justify-content: center; width: 100%; margin: 4px 0; }
        .pdf-signature-drawn { max-height: 68px; max-width: 210px; object-fit: contain; display: block; }
        .pdf-sig-empty-line { width: 75%; border-bottom: 1.5px dashed #94a3b8; height: 40px; margin: 0 auto; }
        .pdf-sig-info { width: 100%; border-top: 1px solid #cbd5e1; padding-top: 6px; margin-top: 4px; }
        .pdf-sig-name { margin: 0; font-size: 11px; font-weight: 800; color: #0f172a; }
        .pdf-sig-sub { margin: 2px 0 0; font-size: 9.5px; color: #64748b; font-weight: 600; }
        .pdf-sig-date { margin: 2px 0 0; font-size: 9px; color: #94a3b8; }
        .pdf-footer { border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 22px; text-align: center; font-size: 9.5px; color: #94a3b8; }
        @media print {
          body { padding: 0; }
          @page { margin: 10mm; }
        }
      </style>
    </head>
    <body>
      ${container.outerHTML}
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 350);
        };
      <\/script>
    </body>
    </html>
  `);
  printWin.document.close();
  toast("Abriendo ventana de impresión para guardar como PDF.");
}

function setupDetailNotesEvents(e) {
  const toggleBtn = $("detailNotesToggleBtn");
  const cancelBtn = $("detailNotesCancelBtn");
  const saveBtn = $("detailNotesSaveBtn");
  const viewDiv = $("detailNotesView");
  const editDiv = $("detailNotesEdit");
  const input = $("detailNotesInput");
  const textP = $("detailNotesText");

  if (!toggleBtn || !editDiv || !viewDiv) return;

  toggleBtn.onclick = () => {
    viewDiv.style.display = "none";
    editDiv.style.display = "block";
    toggleBtn.style.display = "none";
    input.value = e.observaciones || "";
    input.focus();
  };

  cancelBtn.onclick = () => {
    editDiv.style.display = "none";
    viewDiv.style.display = "block";
    toggleBtn.style.display = "";
    input.value = e.observaciones || "";
  };

  saveBtn.onclick = async () => {
    const newNotes = input.value.trim();
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";
    try {
      if (db) {
        await updateDoc(doc(db, equipmentCollection, e.id), {
          observaciones: newNotes,
          updatedAt: serverTimestamp()
        });
      }
      e.observaciones = newNotes;
      textP.textContent = newNotes || "Sin observaciones registradas para este equipo.";
      textP.className = newNotes ? "detail-notes-text has-notes" : "detail-notes-text empty-notes";
      toggleBtn.textContent = newNotes ? "✎ Editar observación" : "＋ Agregar observación";
      editDiv.style.display = "none";
      viewDiv.style.display = "block";
      toggleBtn.style.display = "";
      toast("Observaciones actualizadas correctamente.");
      renderInventory();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar la observación. Verifica la conexión.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar observación";
    }
  };
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

  if (!await confirmAction({
    title: "¿Dar de baja este equipo?",
    message: msg,
    confirmText: "Dar de baja"
  })) return;

  try {
    await updateDoc(doc(db, equipmentCollection, id), {
      estado: "De Baja",
      disponible: "no",
      updatedAt: serverTimestamp()
    });
    toast(`El equipo "${name}" fue dado de baja correctamente.`);
  } catch (err) {
    console.error(err);
    toast("No se pudo dar de baja el equipo. Verifica Firebase.");
  }
}

async function deleteEquipment(id, button) {
  const e = equipment.find(x => x.id === id);
  if (!e) return;

  const name = equipmentName(e) || e.tipo || "equipo";
  const warning = e.asignaciones?.length || e.recepciones?.length
    ? "\n\nTambién se eliminará todo el historial de asignaciones y recepciones de este equipo."
    : "";
  if (!await confirmAction({
    title: "¿Eliminar este equipo?",
    message: `Se eliminará permanentemente "${name}". Esta acción no se puede deshacer.${warning}`,
    confirmText: "Eliminar equipo",
    destructive: true
  })) return;

  if (button) button.disabled = true;
  try {
    await deleteDoc(doc(db, equipmentCollection, id));
    toast(`El equipo "${name}" fue eliminado permanentemente.`);
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar el equipo. Verifica la conexión y los permisos de Firebase.");
  } finally {
    if (button) button.disabled = false;
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
    "Observaciones",
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
        e.observaciones || "",
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
      { wch: 32 },
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
        escapeCSV(e.observaciones || ""),
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
  $("pageTitle").textContent=titles[view]||"Panel general";
  $("newEquipmentBtn").hidden = view !== "dashboard";
  $("sidebar").classList.remove("open");
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
});
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog(b.dataset.close)));
$("historyContent").addEventListener("click", event => {
  const photoButton = event.target.closest("[data-view-equipment-photo]");
  if (!photoButton) return;
  const photo = photoButton.querySelector("img");
  const viewer = $("equipmentPhotoViewer");
  const viewerImage = $("equipmentPhotoViewerImage");
  viewerImage.src = photo.src;
  viewerImage.alt = photo.alt;
  viewer.showModal();
});
$("equipmentPhotoViewer").addEventListener("close", () => {
  $("equipmentPhotoViewerImage").removeAttribute("src");
});
document.querySelectorAll("[data-clear]").forEach(b=>b.addEventListener("click",()=>clearPad(b.dataset.clear)));
$("confirmationCancelBtn").addEventListener("click", () => closeDialog("confirmationDialog"));
$("confirmationAcceptBtn").addEventListener("click", () => {
  $("confirmationDialog").dataset.confirmed = "true";
  closeDialog("confirmationDialog");
});
$("newEquipmentBtn").addEventListener("click",()=>{resetEquipmentForm();openDialog("equipmentDialog")});
$("newEquipmentBtn2").addEventListener("click",()=>{resetEquipmentForm();openDialog("equipmentDialog")});
$("equipmentForm").addEventListener("submit",saveEquipment);
$("equipmentPhotoInput").addEventListener("change",handleEquipmentPhotoChange);
$("equipmentPhotoPreview").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-equipment-photo]");
  if (!button || equipmentPhotoProcessing) return;
  const index = Number(button.dataset.removeEquipmentPhoto);
  setEquipmentPhotos(equipmentPhotoData.filter((_, photoIndex) => photoIndex !== index));
  $("equipmentPhotoStatus").textContent = "La foto se quitará al guardar los cambios.";
});
$("assignmentForm").addEventListener("submit",saveAssignment);
$("returnForm").addEventListener("submit",saveReturn);
["searchInput","availabilityFilter","statusFilter"].forEach(id=>$(id).addEventListener("input",()=>{
  tablePages.inventory = 1;
  renderInventory();
}));
document.addEventListener("click", event => {
  const button = event.target.closest("[data-pagination]");
  if (!button || button.disabled) return;
  const table = button.dataset.pagination;
  tablePages[table] = Number(button.dataset.page);
  if (table === "inventory") renderInventory();
  else if (table === "assignments") renderAssignments();
  else if (table === "returns") renderReturns();
});
const scrollToTopButton = $("scrollToTopBtn");
window.addEventListener("scroll", () => {
  scrollToTopButton.hidden = window.scrollY < 300;
}, { passive: true });
scrollToTopButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.addEventListener("click",event=>{
  const b=event.target.closest("[data-action]"); if(!b)return;
  const {action,id}=b.dataset;
  if(action==="detail")showDetail(id); if(action==="edit")editEquipment(id);
  if(action==="assign")prepareAssignment(id); if(action==="receive")prepareReturn(id);
  if(action==="decommission")decommissionEquipment(id);
  if(action==="delete")deleteEquipment(id,b);
});
$("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
$("exportExcelBtn")?.addEventListener("click",exportToExcel);
$("downloadPdfBtn")?.addEventListener("click", () => {
  if (currentDetailEquipmentId) downloadEquipmentPdf(currentDetailEquipmentId);
});
$("downloadPdfBtn2")?.addEventListener("click", () => {
  if (currentDetailEquipmentId) downloadEquipmentPdf(currentDetailEquipmentId);
});
["assignmentSignature","assignmentDeliverySignature","returnSignature"].forEach(setupSignaturePad);
setupPeripheralsSelect();

const configReady = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PEGA_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("TU-");
if (!configReady) {
  $("connectionText").textContent="Firebase pendiente de configurar";
  $("setupNotice").hidden=false;
  ["statTotal","statAvailable","statAssigned","statOther"].forEach(id=>$(id).textContent="—");
  $("inventoryTable").innerHTML='<tr><td colspan="9" class="empty-cell">Configura Firebase para comenzar a registrar equipos.</td></tr>';
} else {
  try {
    const app=initializeApp(firebaseConfig); db=getFirestore(app);
    $("connectionText").textContent="Conectando a Firebase…";
    $("setupNotice").hidden=true;
    listenToEquipment();
  } catch(err) { console.error(err); $("connectionText").textContent="Error de conexión"; toast("No se pudo inicializar Firebase."); }
}
