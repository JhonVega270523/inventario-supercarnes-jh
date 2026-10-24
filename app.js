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
function clearSignatureError(form) {
  const error = form.querySelector(".signature-error");
  error.textContent = "";
  error.hidden = true;
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
function findDuplicateEquipmentSerial(serial, currentId = "") {
  const normalizedSerial = serial.trim().toLowerCase();
  return equipment.find(item =>
    item.id !== currentId &&
    (String(item.serial || "").trim() || String(item.referencia || "").trim()).toLowerCase() === normalizedSerial
  );
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
  const available = equipment.filter(e => {
    const status = (e.estado || "").trim().toLowerCase();
    return e.disponible === "si" && status !== "de baja" && status !== "en mantenimiento";
  }).length;
  const assigned = equipment.filter(e => {
    const status = (e.estado || "").trim().toLowerCase();
    return e.disponible !== "si" && status !== "de baja" && status !== "en mantenimiento" && currentAssignment(e);
  }).length;
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
  equipment.forEach(e => (e.asignaciones || []).forEach((a,index) => rows.push({e,a,index})));
  rows.sort((x,y) => (y.a.fecha || "").localeCompare(x.a.fecha || ""));
  const pageRows = paginateRows(rows, "assignments", "assignmentsPagination");
  $("assignmentsTable").innerHTML = pageRows.length ? pageRows.map(({e,a,index}) => `<tr>
    <td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
    <td><span class="serial-tag">${escapeHTML(e.serial || e.referencia || "—")}</span></td>
    <td>${escapeHTML(a.asignadoA)}</td>
    <td>${escapeHTML(a.area)}</td>
    <td>${dateText(a.fecha)}</td>
    <td>${statusPill(a.estado)}</td>
    <td>${escapeHTML(a.entregadoPor || a.recibidoPor || "—")}</td>
    <td><button class="action-btn action-btn-pdf" data-action="print-assignment" data-id="${e.id}" data-record-index="${index}" title="Reimprimir asignación en PDF">PDF</button></td>
  </tr>`).join("") : '<tr><td colspan="8" class="empty-cell">No hay asignaciones registradas.</td></tr>';
}
function renderReturns() {
  const rows = [];
  equipment.forEach(e => (e.recepciones || []).forEach((r,index) => rows.push({e,r,index})));
  rows.sort((x,y) => (y.r.fecha || "").localeCompare(x.r.fecha || ""));
  const pageRows = paginateRows(rows, "returns", "returnsPagination");
  $("returnsTable").innerHTML = pageRows.length ? pageRows.map(({e,r,index}) => `<tr>
    <td><span class="equipment-name">${escapeHTML(e.marca)}</span><span class="subtext">${escapeHTML(e.tipo)}</span></td>
    <td><span class="serial-tag">${escapeHTML(e.serial || e.referencia || "—")}</span></td>
    <td>${escapeHTML(r.recibidoDe)}</td>
    <td>${escapeHTML(r.recibidoPor || "—")}</td>
    <td>${escapeHTML(r.area)}</td>
    <td>${dateText(r.fecha)}</td>
    <td>${statusPill(r.estado)}</td>
    <td><button class="action-btn action-btn-pdf" data-action="print-return" data-id="${e.id}" data-record-index="${index}" title="Reimprimir recepción en PDF">PDF</button></td>
  </tr>`).join("") : '<tr><td colspan="8" class="empty-cell">No hay recepciones registradas.</td></tr>';
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
  $("serial").setCustomValidity("");
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
  clearSignatureError($("assignmentForm"));
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
  $("returnForm").reset(); clearSignatureError($("returnForm")); clearPad("returnSignature");
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
  const serialInput = $("serial");
  const duplicate = findDuplicateEquipmentSerial(serialInput.value, id);
  if (duplicate) {
    const registeredFor = duplicate.marca ? ` para ${duplicate.marca}` : "";
    serialInput.setCustomValidity(`Este serial ya está registrado${registeredFor}.`);
    serialInput.reportValidity();
    return;
  }
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
  const missingSignature = ["assignmentDeliverySignature", "assignmentSignature"].find(id => !padHasInk(id));
  if (missingSignature) {
    const error = $("assignmentSignatureError");
    error.textContent = missingSignature === "assignmentDeliverySignature"
      ? "La firma de quien entrega es obligatoria."
      : "La firma de quien recibe / acepta es obligatoria.";
    error.hidden = false;
    $(missingSignature).focus();
    return;
  }
  clearSignatureError($("assignmentForm"));
  const id = $("assignmentEquipmentId").value; const e = equipment.find(x => x.id === id); if (!e) return;
  const signatureReceive = $("assignmentSignature").toDataURL("image/png");
  const signatureDelivery = $("assignmentDeliverySignature").toDataURL("image/png");
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
  if (!padHasInk("returnSignature")) {
    const error = $("returnSignatureError");
    error.textContent = "La firma de quien recibe el equipo es obligatoria.";
    error.hidden = false;
    $("returnSignature").focus();
    return;
  }
  clearSignatureError($("returnForm"));
  const id = $("returnEquipmentId").value; const e = equipment.find(x => x.id === id); if (!e) return;
  const signature = $("returnSignature").toDataURL("image/png");
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

  let returnName = activeReturn?.recibidoPor || activeReturn?.recibidoDe || "";
  let returnSig = activeReturn?.firma || "";
  let returnDate = activeReturn?.fecha ? dateText(activeReturn.fecha) : "";

  if (!returnSig && rList.length) {
    const foundRet = rList.slice().reverse().find(x => x.firma);
    if (foundRet) {
      returnSig = foundRet.firma;
      returnName = foundRet.recibidoPor || foundRet.recibidoDe || returnName;
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
        <p style="margin:2px 0 0;font-size:9.5px;color:#64748b;font-weight:600;">${escapeHTML(receiveArea ? `Área: ${receiveArea}` : "Área no especificada")}</p>
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
        <p style="margin:2px 0 0;font-size:9.5px;color:#64748b;font-weight:600;">Área de Sistemas / Soporte</p>
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

function recordPdfHtml(title, e, fields, signatures) {
  const serial = e.serial || e.referencia || "—";
  const fieldHtml = fields.map(([label, value]) => `
    <div class="pdf-field"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value || "—")}</strong></div>
  `).join("");
  const signatureHtml = signatures.map(({role,name,subtitle,date,signature}) => {
    const image = /^data:image\/(?:png|jpe?g|webp);base64,/i.test(signature || "")
      ? `<img src="${escapeHTML(signature)}" alt="Firma ${escapeHTML(role)}">`
      : '<div class="empty-signature"></div>';
    return `<div class="signature"><small class="signature-role">${escapeHTML(role)}</small><div class="signature-image">${image}</div><div class="signature-info"><p class="signature-name">${escapeHTML(name || "—")}</p><p class="signature-subtitle">${escapeHTML(subtitle || "")}</p><p class="signature-date">Fecha: ${escapeHTML(date || "—")}</p></div></div>`;
  }).join("");
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1e293b;font-size:10px;margin:0}
    .document{max-width:800px;margin:0 auto;padding:10px;background:#fff}
    .header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #b5121b;padding-bottom:6px;margin-bottom:8px}
    .logo{max-width:105px;max-height:48px;height:auto;object-fit:contain}.header-info{text-align:right}.header-info h1{font-size:15px;color:#b5121b;margin:0 0 2px}
    .header-info p{font-size:9px;color:#64748b;margin:2px 0}
    h2{font-size:12px;color:#b5121b;margin:0 0 5px}
    .section{margin-bottom:8px;break-inside:avoid;page-break-inside:avoid}.section-title{font-size:10px;font-weight:bold;color:#b5121b;border-bottom:1px solid #e2e8f0;padding-bottom:3px;margin-bottom:5px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:7px 9px}
    .pdf-field small{display:block;color:#64748b;font-size:7px;font-weight:bold;text-transform:uppercase;margin-bottom:1px}
    .pdf-field strong{font-size:9px;color:#0f172a;overflow-wrap:anywhere}
    .signatures{display:flex;gap:10px;margin-top:5px;break-inside:avoid;page-break-inside:avoid}
    .signature{flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px 6px;text-align:center;display:flex;flex-direction:column;align-items:center;min-height:112px;justify-content:space-between;break-inside:avoid;page-break-inside:avoid}
    .signature-role{display:block;width:100%;font-size:9px;font-weight:800;color:#475569;letter-spacing:.6px;text-transform:uppercase;margin-bottom:3px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}
    .signature-image{height:44px;display:flex;align-items:center;justify-content:center;width:100%;margin:2px 0}
    .signature img{max-height:40px;max-width:210px;object-fit:contain;display:block}
    .empty-signature{width:75%;height:28px;border-bottom:1.5px dashed #94a3b8}
    .signature-info{width:100%;border-top:1px solid #cbd5e1;padding-top:4px;margin-top:2px}
    .signature-info p{margin:0}
    .signature-name{font-size:11px;font-weight:800;color:#0f172a}
    .signature-subtitle{margin-top:2px!important;font-size:9.5px;color:#64748b;font-weight:600}
    .signature-date{margin-top:2px!important;font-size:9px;color:#94a3b8}
    .footer{border-top:1px solid #e2e8f0;padding-top:4px;margin-top:8px;text-align:center;color:#94a3b8;font-size:7px}
    @media print{@page{size:8.5in 5.5in;margin:7mm}body{padding:0}.document{padding:0}.section,.signatures{break-inside:avoid;page-break-inside:avoid}}
  </style></head><body><main class="document">
    <header class="header"><img class="logo" src="${LOGO_JH_DATA_URL}" alt="Supercarnes JH"><div class="header-info"><h1>SUPERCARNES JH</h1><p>${escapeHTML(title)}</p><p>Generado el ${new Date().toLocaleDateString("es-CO")}</p></div></header>
    <h2>${escapeHTML(title)}</h2>
    <section class="section"><div class="section-title">INFORMACIÓN DEL EQUIPO</div><div class="grid">
      <div class="pdf-field"><small>Marca</small><strong>${escapeHTML(e.marca || "—")}</strong></div>
      <div class="pdf-field"><small>Serial / referencia</small><strong>${escapeHTML(serial)}</strong></div>
      <div class="pdf-field"><small>Tipo de equipo</small><strong>${escapeHTML(e.tipo || "—")}</strong></div>
      ${fieldHtml}
    </div></section>
    <section class="section"><div class="section-title">FIRMAS</div><div class="signatures">${signatureHtml}</div></section>
    <footer class="footer">Supercarnes JH · Sistema de Gestión y Control de Equipos · Documento de Control Interno</footer>
  </main></body></html>`;
}

async function downloadRecordPdf(htmlContent, fileName) {
  toast("Generando PDF...");
  const printFallback = () => {
    const printWin = window.open("", "_blank");
    if (!printWin) {
      toast("Permite las ventanas emergentes para imprimir o guardar el PDF.");
      return;
    }
    printWin.document.write(htmlContent);
    printWin.document.close();
    printWin.onload = () => setTimeout(() => printWin.print(), 400);
    toast("Abriendo ventana de impresión para guardar como PDF.");
  };

  if (typeof window.html2pdf === "undefined") {
    printFallback();
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.id = "recordPdfRenderWrapper";
  wrapper.style.cssText = "position:fixed;top:0;left:0;width:800px;background:#fff;z-index:2147483647;pointer-events:none;visibility:hidden;";
  wrapper.innerHTML = htmlContent;
  document.body.appendChild(wrapper);
  try {
    await window.html2pdf().set({
      margin: [7, 7, 7, 7],
      filename: fileName,
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: clonedDocument => {
          const clonedWrapper = clonedDocument.getElementById("recordPdfRenderWrapper");
          if (clonedWrapper) clonedWrapper.style.visibility = "visible";
        }
      },
      jsPDF: { unit: "mm", format: [215.9, 139.7], orientation: "landscape" }
    }).from(wrapper.querySelector(".document")).save();
    toast("PDF descargado correctamente.");
  } catch (err) {
    console.error("Error al generar PDF del registro:", err);
    printFallback();
  } finally {
    wrapper.remove();
  }
}

function downloadAssignmentPdf(id, index) {
  const e = equipment.find(item => item.id === id);
  const assignment = e?.asignaciones?.[index];
  if (!e || !assignment) {
    toast("No se encontró la asignación para imprimir.");
    return;
  }
  const serial = String(e.serial || e.referencia || "equipo").replace(/[^\w-]/g, "_");
  const fileName = `Asignacion_${serial}_${assignment.fecha || today()}.pdf`;
  const html = recordPdfHtml("COMPROBANTE DE ASIGNACIÓN", e, [
    ["Asignado a", assignment.asignadoA],
    ["Área asignada", assignment.area],
    ["Fecha de asignación", dateText(assignment.fecha)],
    ["Estado al asignar", assignment.estado],
    ["Periféricos entregados", assignment.perifericos],
    ["Entregado por", assignment.entregadoPor || assignment.recibidoPor]
  ], [
    { role: "Entregado por (Sistemas / TI)", name: assignment.entregadoPor || assignment.recibidoPor, subtitle: "Área de Sistemas / Soporte", date: dateText(assignment.fecha), signature: assignment.firmaEntrega },
    { role: "Recibido a conformidad", name: assignment.asignadoA, subtitle: assignment.area ? `Área: ${assignment.area}` : "Área no especificada", date: dateText(assignment.fecha), signature: assignment.firmaRecibe || assignment.firma }
  ]);
  downloadRecordPdf(html, fileName);
}

function downloadReturnPdf(id, index) {
  const e = equipment.find(item => item.id === id);
  const receipt = e?.recepciones?.[index];
  if (!e || !receipt) {
    toast("No se encontró la recepción para imprimir.");
    return;
  }
  const serial = String(e.serial || e.referencia || "equipo").replace(/[^\w-]/g, "_");
  const fileName = `Recepcion_${serial}_${receipt.fecha || today()}.pdf`;
  const html = recordPdfHtml("COMPROBANTE DE RECEPCIÓN", e, [
    ["Recibido de", receipt.recibidoDe],
    ["Recibido por", receipt.recibidoPor],
    ["Área", receipt.area],
    ["Fecha de recepción", dateText(receipt.fecha)],
    ["Estado recibido", receipt.estado],
    ["Periféricos recibidos", receipt.perifericos]
  ], [
    { role: "Recepción de devolución", name: receipt.recibidoPor || receipt.recibidoDe, subtitle: "Área de Sistemas / Soporte", date: dateText(receipt.fecha), signature: receipt.firma }
  ]);
  downloadRecordPdf(html, fileName);
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
  function start(ev){ev.preventDefault();clearSignatureError(canvas.closest("form"));drawing=true;const p=pos(ev);ctx.beginPath();ctx.moveTo(p.x,p.y);}
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

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createExcelFile(headers, rows, title, subtitle, sheetName = "Inventario") {
  const columnName = index => {
    let name = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + (value - 1) % 26) + name;
    }
    return name;
  };
  const cellXml = (reference, value, style) =>
    `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  const lastColumn = columnName(headers.length - 1);
  const lastRow = rows.length + 4;
  const columnWidths = [18, 22, 22, 18, 16, 30, 32, 26, 20, 18, 22];
  const sheetRows = [
    `<row r="1" ht="34" customHeight="1">${cellXml("A1", title, 1)}</row>`,
    `<row r="2" ht="24" customHeight="1">${cellXml("A2", subtitle, 2)}</row>`,
    `<row r="3" ht="8" customHeight="1"/>`,
    `<row r="4" ht="38" customHeight="1">${headers.map((header, index) => cellXml(`${columnName(index)}4`, header, 3)).join("")}</row>`,
    ...rows.map((row, rowIndex) =>
      `<row r="${rowIndex + 5}">${row.map((value, columnIndex) =>
        cellXml(`${columnName(columnIndex)}${rowIndex + 5}`, value, rowIndex % 2 ? 5 : 4)
      ).join("")}</row>`
    )
  ].join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>
<cols>${columnWidths.slice(0, headers.length).map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${sheetRows}</sheetData>
<autoFilter ref="A4:${lastColumn}${lastRow}"/>
<mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC00000"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", worksheet]
  ];
  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const crc32 = bytes => {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value, true);
  const concat = parts => {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  };
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    write32(localView, 0, 0x04034B50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write32(localView, 14, crc);
    write32(localView, 18, data.length);
    write32(localView, 22, data.length);
    write16(localView, 26, nameBytes.length);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    write32(centralView, 0, 0x02014B50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write32(centralView, 16, crc);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, nameBytes.length);
    write32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralDirectory = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054B50);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralDirectory.length);
  write32(endView, 16, offset);
  return new Blob([concat([...localParts, centralDirectory, end])], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
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
  const fileName = `Inventario_Supercarnes_JH_${today()}.xlsx`;
  const blob = createExcelFile(
    headers,
    rows,
    "INVENTARIO DE EQUIPOS - SUPERCARNES JH",
    `Registros exportados: ${itemsToExport.length} | Fecha: ${today()}`
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  toast(`Exportados ${itemsToExport.length} equipo(s) a ${fileName}`);
}

function downloadExcelExport(headers, rows, title, prefix, sheetName, recordName) {
  if (!rows.length) {
    toast(`No hay ${recordName} para exportar.`);
    return;
  }
  const fileName = `${prefix}_Supercarnes_JH_${today()}.xlsx`;
  const blob = createExcelFile(headers, rows, title, `Registros exportados: ${rows.length} | Fecha: ${today()}`, sheetName);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Exportados ${rows.length} ${recordName} a ${fileName}`);
}

function exportAssignmentsToExcel() {
  const rows = equipment.flatMap(e => (e.asignaciones || []).map(a => [
    e.marca || "",
    e.serial || e.referencia || "",
    e.tipo || "",
    a.asignadoA || "",
    a.area || "",
    a.fecha || "",
    a.estado || "",
    a.perifericos || "",
    a.entregadoPor || a.recibidoPor || "",
    a.firmaEntrega ? "Sí" : "No",
    a.firmaRecibe || a.firma ? "Sí" : "No"
  ])).sort((a,b) => b[5].localeCompare(a[5]));
  downloadExcelExport(
    ["Marca", "Serial", "Tipo de equipo", "Asignado a", "Área", "Fecha", "Estado al asignar", "Periféricos entregados", "Entregado por", "Firma de entrega", "Firma de recibido"],
    rows,
    "HISTORIAL DE ASIGNACIONES - SUPERCARNES JH",
    "Asignaciones",
    "Asignaciones",
    "asignaciones"
  );
}

function exportReturnsToExcel() {
  const rows = equipment.flatMap(e => (e.recepciones || []).map(r => [
    e.marca || "",
    e.serial || e.referencia || "",
    e.tipo || "",
    r.recibidoDe || "",
    r.recibidoPor || "",
    r.area || "",
    r.fecha || "",
    r.estado || "",
    r.perifericos || "",
    r.firma ? "Sí" : "No"
  ])).sort((a,b) => b[6].localeCompare(a[6]));
  downloadExcelExport(
    ["Marca", "Serial", "Tipo de equipo", "Recibido de", "Recibido por", "Área", "Fecha", "Estado recibido", "Periféricos recibidos", "Firma registrada"],
    rows,
    "HISTORIAL DE RECEPCIONES - SUPERCARNES JH",
    "Recepciones",
    "Recepciones",
    "recepciones"
  );
}

function navigate(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active",b.dataset.view===view));
  $(`${view}View`).classList.add("active");
  const titles={dashboard:"Panel general",inventory:"Inventario de equipos",assignments:"Historial de asignaciones",returns:"Historial de recepciones"};
  $("pageTitle").textContent=titles[view]||"Panel general";
  $("newEquipmentBtn").hidden = view !== "dashboard";
  $("sidebar").classList.remove("open");
  $("mobileMenu").setAttribute("aria-expanded", "false");
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
});
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog(b.dataset.close)));
$("brandLogoButton").addEventListener("click", () => $("brandLogoViewer").showModal());
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
$("serial").addEventListener("input", event => event.currentTarget.setCustomValidity(""));
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
  if(action==="print-assignment")downloadAssignmentPdf(id,Number(b.dataset.recordIndex));
  if(action==="print-return")downloadReturnPdf(id,Number(b.dataset.recordIndex));
});
$("mobileMenu").addEventListener("click", () => {
  const isOpen = $("sidebar").classList.toggle("open");
  $("mobileMenu").setAttribute("aria-expanded", String(isOpen));
});
document.addEventListener("click", event => {
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  const sidebar = $("sidebar");
  if (!sidebar.classList.contains("open")) return;
  if (sidebar.contains(event.target) || $("mobileMenu").contains(event.target)) return;
  sidebar.classList.remove("open");
  $("mobileMenu").setAttribute("aria-expanded", "false");
});
$("exportExcelBtn")?.addEventListener("click",exportToExcel);
$("exportAssignmentsBtn")?.addEventListener("click",exportAssignmentsToExcel);
$("exportReturnsBtn")?.addEventListener("click",exportReturnsToExcel);
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
