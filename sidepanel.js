const CENTRAL_URL = "https://central.smartsouth.net/central/";
const STORAGE_KEY = "smartCentralTicketQueue";
const DRAFT_KEY = "smartCentralTicketDraft";
const TEMPLATES_KEY = "smartCentralTicketTemplates";
const CUSTOM_TEMPLATES_KEY = "smartCentralTicketCustomTemplates";
const DELETED_TEMPLATES_KEY = "smartCentralTicketDeletedTemplates";
const CATALOGS_KEY = "smartCentralTicketCatalogs";
const REMOTE_BASE_URL = "https://raw.githubusercontent.com/matiasSerantes/AyudanteGitGlpimat/main";
const REMOTE_CATALOG_URL = `${REMOTE_BASE_URL}/catalogs.json`;
const REMOTE_TEMPLATES_URL = `${REMOTE_BASE_URL}/templates.json`;

const state = {
  queue: [],
  running: false,
  stopRequested: false,
  editingId: null,
  templates: {},
  catalogs: { entities: [], technicians: [], defaults: {} },
};

const $ = (selector) => document.querySelector(selector);
const form = $("#ticketForm");
const toast = $("#toast");

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadCatalogs();
  await restoreState();
  await loadTemplates();
  renderQueue();
  await checkConnection();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  form.addEventListener("submit", addTicket);
  form.addEventListener("input", saveDraft);
  $("#pastAttention").addEventListener("change", toggleAttentionDate);
  $("#attentionDate").addEventListener("change", () => {
    if (form.elements.attentionDate.value) form.elements.pastAttention.checked = true;
    toggleAttentionDate();
  });
  $("#closeAfterCreate").addEventListener("change", toggleCompletionFields);
  $("#applyTemplateButton").addEventListener("click", applySelectedTemplate);
  $("#saveTemplateButton").addEventListener("click", saveCurrentTemplate);
  $("#deleteTemplateButton").addEventListener("click", deleteSelectedTemplate);
  $("#templateSelect").addEventListener("change", () => {
    updateTemplateActions();
    if ($("#templateSelect").value) applySelectedTemplate();
  });
  $("#entity").addEventListener("focus", refreshCatalogsFromCentral);
  $("#technician").addEventListener("focus", refreshCatalogsFromCentral);
  $("#clearFormButton").addEventListener("click", resetForm);
  $("#clearCompletedButton").addEventListener("click", clearCompleted);
  $("#startButton").addEventListener("click", confirmRun);
  $("#pauseButton").addEventListener("click", requestPause);
  $("#openCentralButton").addEventListener("click", openCentral);
  $("#confirmDialog").addEventListener("close", handleConfirmation);
  $("#queueList").addEventListener("click", handleQueueAction);
}

async function restoreState() {
  const data = await chrome.storage.local.get([STORAGE_KEY, DRAFT_KEY]);
  state.queue = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  state.queue = state.queue.map((item) => item.status === "processing" ? { ...item, status: "pending" } : item);
  if (data[DRAFT_KEY]) applyTicketToForm(data[DRAFT_KEY]);
  else applyTicketToForm({
    entity: state.catalogs.defaults.entity || "Smart South > JKS",
    technician: state.catalogs.defaults.technician || "Matias Serantes",
    priority: "Media",
    serviceType: "Soporte remoto",
    ticketType: "Incidente",
    attentionDate: currentLocalDateTime(),
  });
  if (!form.elements.attentionDate.value) form.elements.attentionDate.value = currentLocalDateTime();
  toggleAttentionDate();
  toggleCompletionFields();
}

function readForm() {
  const data = new FormData(form);
  return {
    entity: String(data.get("entity") || "").trim(),
    technician: String(data.get("technician") || "").trim(),
    title: String(data.get("title") || "").trim(),
    description: String(data.get("description") || "").trim(),
    serviceType: String(data.get("serviceType") || "").trim(),
    ticketType: String(data.get("ticketType") || "").trim(),
    category: String(data.get("category") || "").trim(),
    priority: String(data.get("priority") || "Media"),
    pastAttention: data.get("pastAttention") === "on",
    attentionDate: String(data.get("attentionDate") || ""),
    closeAfterCreate: data.get("closeAfterCreate") === "on",
    billableTime: String(data.get("billableTime") || "0,5 h"),
    customerMessage: String(data.get("customerMessage") || "").trim(),
  };
}

function applyTicketToForm(ticket) {
  for (const key of ["entity", "technician", "title", "description", "serviceType", "ticketType", "category", "priority", "attentionDate", "billableTime", "customerMessage"]) {
    if (ticket[key] !== undefined && form.elements[key]) setFieldValue(form.elements[key], ticket[key]);
  }
  form.elements.pastAttention.checked = Boolean(ticket.pastAttention);
  form.elements.closeAfterCreate.checked = Boolean(ticket.closeAfterCreate);
  toggleAttentionDate();
  toggleCompletionFields();
}

function setFieldValue(control, value) {
  const normalizedValue = String(value ?? "");
  if (control instanceof HTMLSelectElement && normalizedValue && ![...control.options].some((option) => option.value === normalizedValue)) {
    const option = document.createElement("option");
    option.value = normalizedValue;
    option.textContent = normalizedValue;
    control.appendChild(option);
  }
  control.value = normalizedValue;
}

async function loadCatalogs() {
  const bundledResponse = await fetch(chrome.runtime.getURL("catalogs.json"));
  state.catalogs = mergeCatalogs(state.catalogs, await bundledResponse.json());

  const stored = await chrome.storage.local.get(CATALOGS_KEY);
  if (stored[CATALOGS_KEY] && typeof stored[CATALOGS_KEY] === "object") {
    state.catalogs = mergeCatalogs(state.catalogs, stored[CATALOGS_KEY]);
  }

  await refreshCatalogsFromRepository();
  await persistCatalogs();
  renderCatalogSelects();
}

async function refreshCatalogsFromRepository() {
  try {
    const response = await fetch(`${REMOTE_CATALOG_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const remoteCatalogs = normalizeCatalogs(await response.json());
    if (!remoteCatalogs.entities.length && !remoteCatalogs.technicians.length) return false;
    state.catalogs = mergeCatalogs(state.catalogs, remoteCatalogs);
    return true;
  } catch (_) {
    return false;
  }
}

async function persistCatalogs() {
  await chrome.storage.local.set({ [CATALOGS_KEY]: state.catalogs });
}

function renderCatalogSelects() {
  fillSelect($("#entity"), state.catalogs.entities, "Selecciona una entidad");
  fillSelect($("#technician"), state.catalogs.technicians, "Selecciona un tecnico");
}

function fillSelect(select, values, placeholder) {
  const current = select.value;
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.appendChild(empty);
  uniqueSorted(values).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  setFieldValue(select, current);
}

function mergeCatalogs(left, right) {
  const normalizedRight = normalizeCatalogs(right);
  return {
    entities: uniqueSorted([...(left.entities || []), ...normalizedRight.entities]),
    technicians: uniqueSorted([...(left.technicians || []), ...normalizedRight.technicians]),
    defaults: { ...(left.defaults || {}), ...normalizedRight.defaults },
  };
}

function normalizeCatalogs(catalogs) {
  if (!catalogs || typeof catalogs !== "object") return { entities: [], technicians: [], defaults: {} };
  return {
    entities: catalogs.entities || catalogs.entidades || [],
    technicians: catalogs.technicians || catalogs.tecnicos || catalogs.usuarios || [],
    defaults: catalogs.defaults || catalogs.predeterminados || {},
  };
}

function uniqueSorted(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es"));
}

async function refreshCatalogsFromCentral() {
  if (refreshCatalogsFromCentral.running) return;
  refreshCatalogsFromCentral.running = true;
  try {
    const tabs = await chrome.tabs.query({ url: "https://central.smartsouth.net/*" });
    const tab = tabs.find((candidate) => candidate.active) || tabs[0];
    if (!tab) return;
    const result = await sendToTab(tab.id, { type: "central.catalogs" });
    if (!result?.ok) return;
    const nextCatalogs = mergeCatalogs(state.catalogs, result.catalogs || {});
    if (
      nextCatalogs.entities.length !== state.catalogs.entities.length
      || nextCatalogs.technicians.length !== state.catalogs.technicians.length
    ) {
      state.catalogs = nextCatalogs;
      const current = readForm();
      renderCatalogSelects();
      applyTicketToForm(current);
      await persistCatalogs();
    }
  } finally {
    refreshCatalogsFromCentral.running = false;
  }
}

async function addTicket(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const ticket = readForm();
  if (ticket.pastAttention && !ticket.attentionDate) {
    showToast("Indica el dia y hora del ticket.", true);
    form.elements.attentionDate.focus();
    return;
  }
  if (ticket.closeAfterCreate && !ticket.customerMessage) {
    showToast("Escribe el mensaje al cliente antes de cerrar el ticket.", true);
    form.elements.customerMessage.focus();
    return;
  }

  if (state.editingId) {
    const index = state.queue.findIndex((item) => item.id === state.editingId);
    if (index >= 0) state.queue[index] = { ...state.queue[index], ...ticket, status: "pending", error: "" };
    state.editingId = null;
    $("#addButton").textContent = "Agregar a la cola";
    showToast("Ticket actualizado.");
  } else {
    state.queue.push({ ...ticket, id: crypto.randomUUID(), status: "pending", error: "", createdAt: Date.now() });
    showToast("Ticket agregado a la cola.");
  }

  await persistQueue();
  renderQueue();
}

async function saveDraft() {
  await chrome.storage.local.set({ [DRAFT_KEY]: readForm() });
}

async function persistQueue() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state.queue });
}

async function loadTemplates() {
  const bundledResponse = await fetch(chrome.runtime.getURL("templates.json"));
  const bundledTemplates = normalizeTemplates(await bundledResponse.json());
  const stored = await chrome.storage.local.get([TEMPLATES_KEY, CUSTOM_TEMPLATES_KEY, DELETED_TEMPLATES_KEY]);
  const cachedTemplates = stored[TEMPLATES_KEY] && typeof stored[TEMPLATES_KEY] === "object"
    ? normalizeTemplates(stored[TEMPLATES_KEY])
    : {};
  const customTemplates = stored[CUSTOM_TEMPLATES_KEY] && typeof stored[CUSTOM_TEMPLATES_KEY] === "object"
    ? normalizeTemplates(stored[CUSTOM_TEMPLATES_KEY])
    : {};
  const remoteTemplates = await fetchTemplatesFromRepository();
  state.templates = remoteTemplates
    ? { ...bundledTemplates, ...remoteTemplates, ...customTemplates }
    : { ...cachedTemplates, ...bundledTemplates, ...customTemplates };
  for (const name of stored[DELETED_TEMPLATES_KEY] || []) delete state.templates[name];
  await persistTemplates();
  renderTemplateSelect();
}

async function fetchTemplatesFromRepository() {
  try {
    const response = await fetch(`${REMOTE_TEMPLATES_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const remoteTemplates = normalizeTemplates(await response.json());
    return Object.keys(remoteTemplates).length ? remoteTemplates : null;
  } catch (_) {
    return null;
  }
}

async function persistTemplates() {
  await chrome.storage.local.set({ [TEMPLATES_KEY]: state.templates });
}

function renderTemplateSelect(selectedName = "") {
  const select = $("#templateSelect");
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Sin plantilla";
  select.appendChild(empty);
  Object.keys(state.templates).sort((left, right) => left.localeCompare(right, "es")).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = selectedName in state.templates ? selectedName : "";
  updateTemplateActions();
}

function reusableTemplateData() {
  const ticket = readForm();
  return {
    title: ticket.title,
    description: ticket.description,
    serviceType: ticket.serviceType,
    ticketType: ticket.ticketType,
    category: ticket.category,
    priority: ticket.priority,
    closeAfterCreate: ticket.closeAfterCreate,
    billableTime: ticket.billableTime,
    customerMessage: ticket.customerMessage,
  };
}

function applySelectedTemplate() {
  const name = $("#templateSelect").value;
  const template = normalizeTemplate(state.templates[name]);
  if (!template) return showToast("Selecciona una plantilla para aplicarla.", true);
  applyTicketToForm({
    ...readForm(),
    ...template,
    title: template.title ?? "",
    description: template.description ?? "",
    category: template.category ?? "",
    customerMessage: template.customerMessage ?? "",
  });
  saveDraft();
  showToast(`Plantilla aplicada: ${name}`);
}

function normalizeTemplates(templates) {
  return Object.fromEntries(Object.entries(templates || {}).map(([name, template]) => [name, normalizeTemplate(template)]));
}

function normalizeTemplate(template) {
  if (!template || typeof template !== "object") return template;
  const read = (...keys) => {
    const found = keys.find((key) => template[key] !== undefined && template[key] !== null);
    return found ? template[found] : undefined;
  };
  return {
    ...template,
    entity: read("entity", "Entidad") ?? template.entity,
    technician: read("technician", "Tecnico", "Técnico", "Asignado") ?? template.technician,
    title: read("title", "Titulo", "Título") ?? template.title,
    description: read("description", "Descripcion", "Descripción") ?? template.description,
    serviceType: read("serviceType", "Tipo de Servicio") ?? template.serviceType,
    ticketType: read("ticketType", "Tipo") ?? template.ticketType,
    category: read("category", "Categoria", "Categoría") ?? template.category,
    priority: read("priority", "Prioridad") ?? template.priority,
    customerMessage: read("customerMessage", "Mensaje al cliente", "Mensaje al cliente / solucion", "Seguimiento", "Solucion", "Solución") ?? template.customerMessage,
  };
}

async function saveCurrentTemplate() {
  const selected = $("#templateSelect").value;
  const name = window.prompt("Nombre de la plantilla:", selected || form.elements.title.value.trim());
  if (!name?.trim()) return;
  const cleanName = name.trim();
  if (state.templates[cleanName] && !window.confirm(`La plantilla "${cleanName}" ya existe. ¿Reemplazarla?`)) return;
  state.templates[cleanName] = reusableTemplateData();
  const stored = await chrome.storage.local.get([CUSTOM_TEMPLATES_KEY, DELETED_TEMPLATES_KEY]);
  const customTemplates = stored[CUSTOM_TEMPLATES_KEY] && typeof stored[CUSTOM_TEMPLATES_KEY] === "object"
    ? stored[CUSTOM_TEMPLATES_KEY]
    : {};
  customTemplates[cleanName] = state.templates[cleanName];
  const deletedTemplates = (stored[DELETED_TEMPLATES_KEY] || []).filter((item) => item !== cleanName);
  await chrome.storage.local.set({
    [CUSTOM_TEMPLATES_KEY]: customTemplates,
    [DELETED_TEMPLATES_KEY]: deletedTemplates,
  });
  await persistTemplates();
  renderTemplateSelect(cleanName);
  showToast(`Plantilla guardada: ${cleanName}`);
}

async function deleteSelectedTemplate() {
  const name = $("#templateSelect").value;
  if (!name) return showToast("Selecciona una plantilla para eliminarla.", true);
  if (!window.confirm(`¿Eliminar la plantilla "${name}"?`)) return;
  delete state.templates[name];
  const stored = await chrome.storage.local.get([CUSTOM_TEMPLATES_KEY, DELETED_TEMPLATES_KEY]);
  const customTemplates = stored[CUSTOM_TEMPLATES_KEY] && typeof stored[CUSTOM_TEMPLATES_KEY] === "object"
    ? stored[CUSTOM_TEMPLATES_KEY]
    : {};
  delete customTemplates[name];
  const deletedTemplates = [...new Set([...(stored[DELETED_TEMPLATES_KEY] || []), name])];
  await chrome.storage.local.set({
    [CUSTOM_TEMPLATES_KEY]: customTemplates,
    [DELETED_TEMPLATES_KEY]: deletedTemplates,
  });
  await persistTemplates();
  renderTemplateSelect();
  showToast(`Plantilla eliminada: ${name}`);
}

function updateTemplateActions() {
  const hasSelection = Boolean($("#templateSelect").value);
  $("#applyTemplateButton").disabled = !hasSelection;
  $("#deleteTemplateButton").disabled = !hasSelection;
}

function renderQueue() {
  const list = $("#queueList");
  list.textContent = "";
  for (const item of state.queue) {
    const row = document.createElement("li");
    row.className = `queue-item ${item.status}`;
    row.dataset.id = item.id;
    const completedLabel = item.closeAfterCreate ? "Cerrado" : "Enviado";
    const sentStatus = item.ticketReference ? `${completedLabel} ${item.ticketReference}` : completedLabel;
    const status = ({ pending: "Pendiente", processing: "Enviando", done: sentStatus, error: `Error: ${item.error || "sin detalle"}` })[item.status] || item.status;
    row.innerHTML = `
      <span class="status-dot" aria-hidden="true"></span>
      <div class="ticket-main"><strong></strong><span></span></div>
      <div class="item-actions">
        <button class="icon-button" data-action="duplicate" title="Duplicar" aria-label="Duplicar">+</button>
        <button class="icon-button" data-action="edit" title="Editar" aria-label="Editar">&#9998;</button>
        <button class="icon-button" data-action="delete" title="Eliminar" aria-label="Eliminar">&times;</button>
      </div>`;
    row.querySelector("strong").textContent = item.title;
    const workflow = item.closeAfterCreate ? " | Crear y cerrar" : "";
    row.querySelector(".ticket-main span").textContent = `${item.entity} | ${status}${workflow}`;
    list.appendChild(row);
  }

  const pending = state.queue.filter((item) => item.status === "pending" || item.status === "error").length;
  const done = state.queue.filter((item) => item.status === "done").length;
  $("#queueCount").textContent = state.queue.length;
  $("#queueSummary").textContent = `${pending} pendiente${pending === 1 ? "" : "s"}${done ? `, ${done} enviado${done === 1 ? "" : "s"}` : ""}`;
  $("#emptyQueue").classList.toggle("hidden", state.queue.length > 0);
  $("#startButton").disabled = pending === 0 || state.running;
  $("#clearCompletedButton").disabled = done === 0 || state.running;
}

async function handleQueueAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || state.running) return;
  const row = button.closest(".queue-item");
  const item = state.queue.find((ticket) => ticket.id === row.dataset.id);
  if (!item) return;

  if (button.dataset.action === "delete") {
    state.queue = state.queue.filter((ticket) => ticket.id !== item.id);
  } else if (button.dataset.action === "duplicate") {
    const index = state.queue.findIndex((ticket) => ticket.id === item.id);
    state.queue.splice(index + 1, 0, { ...item, id: crypto.randomUUID(), status: "pending", error: "", createdAt: Date.now() });
  } else if (button.dataset.action === "edit") {
    applyTicketToForm(item);
    state.editingId = item.id;
    $("#addButton").textContent = "Guardar cambios";
    showView("editor");
    form.elements.description.focus();
    return;
  }
  await persistQueue();
  renderQueue();
}

async function clearCompleted() {
  state.queue = state.queue.filter((item) => item.status !== "done");
  await persistQueue();
  renderQueue();
}

function confirmRun() {
  const ready = state.queue.filter((item) => item.status === "pending" || item.status === "error");
  if (!ready.length) return;
  const toClose = ready.filter((item) => item.closeAfterCreate).length;
  const closeText = toClose ? ` ${toClose} tambien se cerrara${toClose === 1 ? "" : "n"} con horas y solucion.` : "";
  $("#confirmText").textContent = `Se enviaran ${ready.length} ticket${ready.length === 1 ? "" : "s"}, uno por uno.${closeText} La cola se detendra ante cualquier error.`;
  const preview = $("#confirmPreview");
  preview.textContent = "";
  ready.slice(0, 5).forEach((item) => {
    const row = document.createElement("div");
    row.className = "confirm-row";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const entity = document.createElement("span");
    entity.textContent = item.closeAfterCreate ? `${item.billableTime} | Cerrar` : item.entity;
    row.append(title, entity);
    preview.appendChild(row);
  });
  if (ready.length > 5) {
    const row = document.createElement("div");
    row.className = "confirm-row";
    row.textContent = `Y ${ready.length - 5} mas...`;
    preview.appendChild(row);
  }
  $("#confirmDialog").showModal();
}

function handleConfirmation() {
  if ($("#confirmDialog").returnValue === "confirm") runQueue();
}

async function runQueue() {
  if (state.running) return;
  state.running = true;
  state.stopRequested = false;
  setRunningUi(true);

  try {
    const tab = await ensureCentralTab();
    const probe = await sendToTab(tab.id, { type: "central.probe" });
    if (!probe?.ready) {
      showLoginState(probe?.reason || "Abre la mesa de ayuda e inicia sesion.");
      throw new Error(probe?.reason || "No se encontro la sesion iniciada.");
    }

    showConnected();
    for (const item of state.queue) {
      if (state.stopRequested) break;
      if (!["pending", "error"].includes(item.status)) continue;
      item.status = "processing";
      item.error = "";
      await persistQueue();
      renderQueue();
      $("#runStatus").textContent = `Creando: ${item.title}`;

      try {
        const result = item.ticketReference
          ? { ok: true, reference: item.ticketReference, recovered: true }
          : await sendToTab(tab.id, { type: "central.create", ticket: item });
        if (!result?.ok) {
          throw new Error(result?.error || "La pagina no confirmo la creacion.");
        }

        item.ticketReference = result.reference || item.ticketReference || "";
        await persistQueue();

        if (item.closeAfterCreate) {
          $("#runStatus").textContent = `Registrando trabajo y cerrando ${item.ticketReference || "el ticket"}...`;
          const finalizeResult = await sendToTab(tab.id, { type: "central.finalize", ticket: item });
          if (!finalizeResult?.ok) {
            throw new Error(finalizeResult?.error || "No se pudo registrar el trabajo y cerrar el ticket.");
          }
        } else {
          $("#runStatus").textContent = "Volviendo a la lista de tickets...";
          const returnResult = await sendToTab(tab.id, { type: "central.return" });
          if (!returnResult?.ok) {
            throw new Error(returnResult?.error || "El ticket fue creado, pero no se pudo volver a la lista.");
          }
          await waitForTicketList(tab.id);
        }

        item.status = "done";
        item.error = "";
        await persistQueue();
        renderQueue();
        await delay(700);
      } catch (error) {
        item.status = "error";
        item.error = error.message || "La pagina no completo el ticket.";
        await persistQueue();
        renderQueue();
        throw error;
      }
    }
  } catch (error) {
    showToast(error.message || "La cola se detuvo.", true);
  } finally {
    state.running = false;
    setRunningUi(false);
    const remains = state.queue.some((item) => item.status === "pending" || item.status === "error");
    $("#runStatus").textContent = state.stopRequested ? "Cola pausada." : remains ? "Cola detenida. Revisa el ticket marcado." : "Todos los tickets fueron enviados.";
  }
}

function requestPause() {
  state.stopRequested = true;
  $("#runStatus").textContent = "Pausando al terminar el ticket actual...";
}

function setRunningUi(running) {
  $("#pauseButton").classList.toggle("hidden", !running);
  $("#startButton").classList.toggle("hidden", running);
  document.querySelectorAll(".item-actions button").forEach((button) => button.disabled = running);
  renderQueue();
}

async function ensureCentralTab() {
  const tabs = await chrome.tabs.query({ url: "https://central.smartsouth.net/*" });
  let tab = tabs.find((candidate) => candidate.active) || tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: CENTRAL_URL, active: true });
  else await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  await waitForTab(tab.id);
  return await chrome.tabs.get(tab.id);
}

async function openCentral() {
  await ensureCentralTab();
  showToast("Inicia sesion y luego vuelve a la cola.");
}

async function checkConnection() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://central.smartsouth.net/*" });
    if (!tabs.length) return showDisconnected("Central no esta abierto");
    const probe = await sendToTab(tabs[0].id, { type: "central.probe" });
    if (probe?.ready) showConnected();
    else showLoginState(probe?.reason || "Sesion no disponible");
  } catch (_) {
    showDisconnected("Sin comprobar");
  }
}

function showConnected() {
  const badge = $("#connectionBadge");
  badge.textContent = "Sesion disponible";
  badge.className = "badge ok";
  $("#loginNotice").classList.add("hidden");
}

function showDisconnected(text) {
  const badge = $("#connectionBadge");
  badge.textContent = text;
  badge.className = "badge neutral";
}

function showLoginState(reason) {
  const badge = $("#connectionBadge");
  badge.textContent = "Requiere acceso";
  badge.className = "badge warn";
  $("#loginNotice").classList.remove("hidden");
  $("#loginNotice p").textContent = reason;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (_) {
      throw new Error("No se pudo conectar con la pagina. Recargala y vuelve a intentar.");
    }
  }
}

async function waitForTicketList(tabId) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "central.listReady" });
      if (result?.ready) return;
    } catch (_) {
      // The page can briefly have no content script while Volver is navigating.
    }
    await delay(350);
  }
  throw new Error("El ticket fue creado, pero no reaparecio el boton Nuevo ticket. La cola quedo pausada.");
}

function waitForTab(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
    const listener = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function showView(name) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
}

function toggleAttentionDate() {
  const enabled = form.elements.pastAttention.checked;
  form.elements.attentionDate.required = enabled;
  if (enabled && !form.elements.attentionDate.value) form.elements.attentionDate.value = currentLocalDateTime();
}

function toggleCompletionFields() {
  const enabled = form.elements.closeAfterCreate.checked;
  $("#completionFields").classList.toggle("hidden", !enabled);
  form.elements.customerMessage.required = enabled;
  form.elements.billableTime.required = enabled;
}

async function resetForm() {
  const keep = { entity: form.elements.entity.value, technician: form.elements.technician.value, serviceType: form.elements.serviceType.value, ticketType: form.elements.ticketType.value, priority: form.elements.priority.value, attentionDate: currentLocalDateTime() };
  form.reset();
  applyTicketToForm(keep);
  state.editingId = null;
  $("#addButton").textContent = "Agregar a la cola";
  await saveDraft();
}

function currentLocalDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = "toast", 4200);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
