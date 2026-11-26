if (!globalThis.centralContentLoaded) {
globalThis.centralContentLoaded = true;
const CONTROL_TIMEOUT = 60000;
const WORK_SAVE_TIMEOUT = 60000;
const TICKET_CLOSURE_TIMEOUT = 60000;
const POST_CLOSURE_RETURN_TIMEOUT = 60000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "central.probe") {
    sendResponse(probePage());
    return;
  }
  if (message.type === "central.create") {
    createTicket(message.ticket).then(sendResponse).catch(async (error) => {
      await centralLog("error", "operation.failed", { operation: message.type, message: error.message,
        stack: error.stack, loginPage: isLoginPage(), formOpen: isTicketFormOpen(), readyState: document.readyState });
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  if (message.type === "central.return") {
    sendResponse(startReturnToTicketList());
  }
  if (message.type === "central.finalize") {
    finalizeTicket(message.ticket).then(sendResponse).catch(async (error) => {
      await centralLog("error", "operation.failed", { operation: message.type, message: error.message,
        stack: error.stack, loginPage: isLoginPage(), formOpen: isTicketFormOpen(), readyState: document.readyState });
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  if (message.type === "central.listReady") {
    sendResponse({ ready: Boolean(findButton(["nuevo ticket"])) && !isTicketFormOpen() && !readTicketSuccess() });
  }
  if (message.type === "central.catalogs") {
    collectCatalogs(message.openForm).then(sendResponse).catch(error => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
});

function probePage() {
  const canOpen = findButton(["nuevo ticket", "crear ticket", "new ticket"]);
  const formOpen = isTicketFormOpen();
  if (canOpen || formOpen) return { ready: true };
  if (isLoginPage()) return { ready: false, reason: "Inicia sesion en Central para continuar." };
  return { ready: false, reason: "Abre la seccion Mesa de ayuda y activos para continuar." };
}

async function collectCatalogs(openForm = false) {
  if (isLoginPage()) throw new Error("Inicia sesion en Central para actualizar las entidades.");
  if (openForm && !isTicketFormOpen()) await openTicketForm();
  if (!isTicketFormOpen()) {
    return { ok: false, error: "Abre Nuevo ticket en Central o pulsa Actualizar desde Central." };
  }
  let previous = "";
  let stableSince = Date.now();
  const started = Date.now();
  while (Date.now() - started < CONTROL_TIMEOUT) {
    const result = readCatalogsFromOpenForm();
    const signature = JSON.stringify(result.catalogs);
    if (signature !== previous) { previous = signature; stableSince = Date.now(); }
    if (result.catalogs.entities.length && Date.now() - stableSince >= 800) return result;
    await delay(200);
  }
  throw new Error("Central no mostro las entidades. Revisa que el selector Entidad / cliente tenga opciones y vuelve a actualizar.");
}

function readCatalogsFromOpenForm() {
  const entityControl = findControl("entidad / cliente");
  const technicianControl = findControl("tecnico responsable") || findControl("técnico responsable");
  return {
    ok: Boolean(entityControl || technicianControl),
    catalogs: {
      entities: readControlOptions(entityControl),
      technicians: readControlOptions(technicianControl),
    },
  };
}

function readControlOptions(control) {
  if (!control) return [];
  if (control.tagName === "SELECT") {
    return [...control.options]
      .map((option) => option.textContent.trim())
      .filter((text) => text && !/selecciona una?/i.test(text));
  }

  const id = control.getAttribute("aria-controls") || control.getAttribute("list");
  const list = id ? document.getElementById(id) : null;
  if (list) {
    return [...list.querySelectorAll("option, [role='option'], li")]
      .map((option) => (option.textContent || option.value || "").trim())
      .filter(Boolean);
  }

  return [];
}

async function createTicket(ticket) {
  await centralLog("info", "create.start", { id: ticket.id, loginPage: isLoginPage(), formOpen: isTicketFormOpen() });
  if (isLoginPage()) throw new Error("La sesion se cerro. Inicia sesion y reintenta.");

  const existingSuccess = readTicketSuccess(ticket.title);
  if (existingSuccess) {
    if (!existingSuccess.titleMatches) {
      throw new Error(`Esta abierto otro ticket (${existingSuccess.reference}). Cerralo antes de continuar.`);
    }
    return { ok: true, reference: existingSuccess.reference, recovered: true };
  }

  await centralLog("info", "create.openForm");
  await openTicketForm();

  await setSelect("entidad / cliente", ticket.entity);
  await setSelect("tecnico responsable", ticket.technician);
  setText("titulo", ticket.title, "input");
  setText("descripcion", ticket.description, "textarea");
  await setSelect("tipo de servicio", ticket.serviceType);
  setCheckbox("cargar una atencion realizada anteriormente", ticket.pastAttention);
  if (ticket.pastAttention && ticket.attentionDate) setDateTime(ticket.attentionDate);
  await setSelect("tipo", ticket.ticketType);
  await setSelect("categoria glpi", ticket.category);
  await setSelect("prioridad", ticket.priority);

  const submit = findButton(["crear ticket"]);
  if (!submit) throw new Error("No se encontro el boton Crear ticket.");
  if (submit.disabled) throw new Error("El formulario no habilito Crear ticket. Revisa los valores elegidos.");

  await centralLog("info", "create.submit");
  const previousErrors = new Set(readVisibleErrors());
  submit.click();
  const result = await waitForSubmission(ticket.title, previousErrors);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function startReturnToTicketList() {
  const success = readTicketSuccess();
  const formOpen = isTicketFormOpen();
  if (!success && !formOpen && findButton(["nuevo ticket"])) {
    return { ok: true, alreadyAtList: true };
  }
  const backButton = findButton(["volver"]);
  const confirmationClose = success?.kind === "confirmation" ? findButton(["cerrar"]) : null;
  const closeButton = findTicketCloseButton();
  const returnAction = backButton || confirmationClose || closeButton;
  if (!returnAction) {
    return { ok: false, error: "El ticket fue creado, pero no se encontro Volver ni el boton para cerrar el detalle." };
  }

  // Respond before clicking because the action may perform a full page navigation.
  setTimeout(() => returnAction.click(), 60);
  return { ok: true };
}

async function finalizeTicket(ticket) {
  await centralLog("info", "finalize.start", { id: ticket.id, reference: ticket.ticketReference });
  const warnings = [];
  await openTicketDetail(ticket);
  if (findButton(["reintentar guardado"])) {
    throw new Error("Central tiene un guardado pendiente. Usa Reintentar guardado en Central antes de reanudar la cola.");
  }
  if (isTicketCompleted(ticket.ticketReference)) {
    await returnAfterCompletion(ticket.ticketReference);
    return { ok: true, reference: ticket.ticketReference, warnings };
  }
  // Central now requires a reason for every intervention, including zero hours.
  // Older queued tickets may only contain the customer solution.
  ticket = { ...ticket, workDetail: ticket.workDetail?.trim() || ticket.customerMessage?.trim() || "" };
  if (!ticket.workDetail) throw new Error("Completa el detalle del trabajo o la solucion antes de cerrar el ticket.");
  await setSelect("tiempo facturable", ticket.billableTime);
  setCustomerMessage(ticket.customerMessage);
  for (const [field, label] of [["workDetail", "detalle para el cliente / motivo"], ["internalNote", "nota interna"], ["customerMessage", "mensaje al cliente / solucion"]]) {
    const images = ticket.attachments?.[field] || [];
    if (!ticket[field] && !images.length) continue;
    const control = findControl(label, "textarea");
    if (!control) {
      if (ticket[field]) throw new Error(`No se encontro el campo ${label}.`);
      warnings.push(`Imagen opcional: no se encontro el campo ${label}.`);
      continue;
    }
    if (field !== "customerMessage") setNativeValue(control, ticket[field] || "");
    try {
      await attachFieldImages(control, images, label);
    } catch (error) {
      warnings.push(`Imagen opcional: ${error.message}`);
    }
  }

  const closeButton = await waitForOperationalCloseButton();
  await centralLog("info", "finalize.close");
  const previousErrors = new Set(readVisibleErrors());
  closeButton.click();

  await waitForTicketClosure(ticket.ticketReference, previousErrors);
  return { ok: true, reference: ticket.ticketReference, warnings };
}

async function openTicketDetail(ticket) {
  let detail = readTicketDetail(ticket.title);
  if (detail) {
    if (!detail.titleMatches) throw new Error(`Esta abierto otro ticket (${detail.reference}). Cerralo antes de continuar.`);
    return;
  }

  const confirmation = readTicketSuccess(ticket.title);
  let openButton = confirmation?.kind === "confirmation" ? findButton(["ver ticket"]) : null;
  if (!openButton && ticket.ticketReference) {
    openButton = findActionByReference(ticket.ticketReference);
  }
  if (!openButton) throw new Error(`No se encontro como abrir el ticket ${ticket.ticketReference || "creado"}.`);

  openButton.click();
  await waitUntil(() => {
    detail = readTicketDetail(ticket.title);
    return Boolean(detail?.titleMatches);
  }, CONTROL_TIMEOUT, `No se abrio el detalle del ticket ${ticket.ticketReference || "creado"}.`);
}

function findActionByReference(reference) {
  const wanted = normalize(reference);
  return [...document.querySelectorAll("button, [role=button], a[href]")]
    .filter(isVisible)
    .find((action) => normalize(action.textContent).includes(wanted)) || null;
}

function setCustomerMessage(value) {
  const control = findControl("mensaje al cliente / solucion", "textarea");
  if (!control) throw new Error("No se encontro el campo Mensaje al cliente / solucion.");
  setNativeValue(control, value);
}

function findOperationalCloseButton() {
  return [...document.querySelectorAll("button, [role=button], input[type=submit]")]
    .filter(isVisible)
    .filter((button) => normalize(button.textContent || button.value) === "cerrar")
    .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0] || null;
}

async function waitForOperationalCloseButton() {
  const started = Date.now();
  await centralLog("info", "finalize.waitForWorkSave");
  while (Date.now() - started < WORK_SAVE_TIMEOUT) {
    if (isLoginPage()) throw new Error("La sesion se cerro. Inicia sesion y reintenta.");
    if (findButton(["reintentar guardado"])) {
      throw new Error("Central no confirmo el guardado del trabajo. Usa Reintentar guardado en Central antes de reanudar la cola.");
    }
    // Central may replace the footer while saving; read the current button each time.
    const button = findOperationalCloseButton();
    if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
      await centralLog("info", "finalize.workSaveReady", { elapsedMs: Date.now() - started });
      return button;
    }
    await delay(200);
  }
  await centralLog("warn", "finalize.workSaveTimeout", { elapsedMs: Date.now() - started });
  throw new Error("Central no habilito Cerrar en 60 segundos despues de completar el trabajo. Revisa el guardado y los campos obligatorios antes de reanudar la cola.");
}

function isTicketCompleted(reference) {
  const detail = readTicketDetail();
  if (!detail || (reference && detail.reference !== reference)) return false;
  // Read the current header status, excluding history and editable work fields.
  const header = document.body.innerText.split(/datos del ticket|historial y evidencias|trabajo y horas/i)[0];
  return header.split(/\r?\n/).some((line) => ["cerrado", "resuelto"].includes(normalize(line)))
    && !findButton(["reintentar guardado"]);
}

async function returnAfterCompletion(reference) {
  const dismiss = findTicketCloseButton();
  if (dismiss) dismiss.click();
  await waitUntil(
    () => Boolean(findButton(["nuevo ticket"])) && !readTicketDetail(),
    POST_CLOSURE_RETURN_TIMEOUT,
    `El ticket ${reference || ""} se completo, pero no se pudo volver a la lista.`
  );
}

async function waitForTicketClosure(reference, previousErrors = new Set()) {
  const started = Date.now();
  while (Date.now() - started < TICKET_CLOSURE_TIMEOUT) {
    const detail = readTicketDetail();
    if (!detail && findButton(["nuevo ticket"])) return;

    if (isTicketCompleted(reference)) {
      await returnAfterCompletion(reference);
      return;
    }

    if (findButton(["reintentar guardado"])) {
      throw new Error("Central no confirmo el guardado. Usa Reintentar guardado en Central antes de reanudar la cola.");
    }
    const error = readOperationError(previousErrors);
    if (error) throw new Error(error);
    await delay(350);
  }
  throw new Error(`No hubo confirmacion de estado Resuelto o Cerrado para el ticket ${reference || ""}. Revisalo antes de reintentar.`);
}

async function openTicketForm() {
  if (isTicketFormOpen()) return;
  const openButton = findButton(["nuevo ticket"]);
  if (!openButton) throw new Error("No se encontro el boton Nuevo ticket.");
  openButton.click();
  await waitUntil(isTicketFormOpen, CONTROL_TIMEOUT, "No se abrio el formulario de nuevo ticket.");
}

function isTicketFormOpen() {
  const title = findControl("titulo", "input");
  const description = findControl("descripcion", "textarea");
  return Boolean(title && description && isVisible(title) && isVisible(description));
}

function findControl(labelText, preferredTag) {
  const target = normalize(labelText);
  const labels = [...document.querySelectorAll("label")];
  const label = labels.find((candidate) => normalize(candidate.textContent) === target)
    || labels.find((candidate) => normalize(candidate.textContent).includes(target));
  if (label) {
    if (label.htmlFor) {
      const linked = document.getElementById(label.htmlFor);
      if (linked && (!preferredTag || linked.matches(preferredTag))) return linked;
    }
    const inside = label.querySelector(preferredTag || "input, textarea, select, [role=combobox]");
    if (inside) return inside;
    const container = label.parentElement;
    const nearby = container?.querySelector(preferredTag || "input, textarea, select, [role=combobox]");
    if (nearby) return nearby;
  }

  // Central also renders field captions as headings with an attachment button.
  // Walk only within a container containing one matching control.
  const selector = preferredTag || "input, textarea, select, [role=combobox]";
  const captions = [...document.querySelectorAll("label, h1, h2, h3, h4, h5, h6, span, p, div")]
    .filter((node) => isVisible(node)
      && normalize(node.textContent).replace(/\s*\(opcional\)$/, "").split("·")[0].trim() === target);
  for (const caption of captions) {
    let container = caption;
    while (container && container !== document.body) {
      const controls = [...container.querySelectorAll(selector)].filter(isVisible);
      if (controls.length > 1) break;
      if (controls.length === 1) return controls[0];
      container = container.parentElement;
    }
  }

  const candidates = [...document.querySelectorAll(preferredTag || "input, textarea, select, [role=combobox]")];
  return candidates.find((control) => {
    const haystack = [control.name, control.id, control.placeholder, control.getAttribute("aria-label")].filter(Boolean).map(normalize).join(" ");
    return isVisible(control) && (haystack.includes(target)
      || (target === "mensaje al cliente / solucion" && normalize(control.placeholder).includes("resultado o respuesta para el cliente")));
  }) || null;
}

function setText(label, value, tag) {
  centralLog("info", "field.text", { field: label });
  const control = findControl(label, tag);
  if (!control) throw new Error(`No se encontro el campo ${label}.`);
  setNativeValue(control, value);
}

async function setSelect(label, visibleValue) {
  await centralLog("info", "field.select", { field: label });
  const wanted = normalize(visibleValue);
  const started = Date.now();
  let customControl = null;

  while (Date.now() - started < CONTROL_TIMEOUT) {
    const control = findControl(label);
    if (control?.tagName === "SELECT") {
      const options = [...control.options];
      const option = options.find((item) => normalize(item.textContent) === wanted)
        || options.find((item) => normalize(item.textContent).includes(wanted));
      if (option) {
        control.value = option.value;
        dispatchInput(control);
        await delay(250);
        return;
      }
    } else if (control) {
      if (customControl !== control) {
        customControl = control;
        control.click();
      }
      const options = [...document.querySelectorAll('[role="option"], option, li')];
      const option = options.find((item) => normalize(item.textContent) === wanted);
      if (option) {
        option.click();
        await delay(250);
        return;
      }
    }
    await delay(200);
  }

  if (!findControl(label)) throw new Error(`No se encontro el campo ${label}.`);
  throw new Error(`No aparecio la opcion "${visibleValue}" en ${label} despues de esperar su carga.`);
}

function setCheckbox(label, checked) {
  const control = findControl(label, 'input[type="checkbox"]');
  if (!control) {
    if (checked) throw new Error(`No se encontro la opcion ${label}.`);
    return;
  }
  if (control.checked !== checked) control.click();
}

function setDateTime(value) {
  const control = document.querySelector('input[type="datetime-local"]') || findControl("fecha y hora", "input");
  if (!control) throw new Error("No se encontro la fecha y hora de atencion.");
  setNativeValue(control, value);
}

function setNativeValue(control, value) {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
  dispatchInput(control);
}

function dispatchInput(control) {
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.dispatchEvent(new Event("blur", { bubbles: true }));
}

function readVisibleErrors() {
  return [...document.querySelectorAll('[role="alert"], .alert-danger, .error, .toast')]
    .filter(isVisible)
    .map(node => node.textContent.trim())
    .filter(text => /error|obligatorio|invalido|no se pudo|no se guardo ningun cambio|completa el detalle/.test(normalize(text)));
}

function readOperationError(previousErrors) {
  return readVisibleErrors().find(text => !previousErrors.has(text)
    // An uncertain response can be followed by successful creation/closure.
    // Keep observing the result; never submit the operation a second time.
    && !normalize(text).includes("no se pudo confirmar la operacion"))?.slice(0, 240) || "";
}

async function waitForSubmission(expectedTitle, previousErrors = new Set()) {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    const success = readTicketSuccess(expectedTitle);
    if (success?.titleMatches) {
      return { ok: true, reference: success.reference };
    }

    const error = readOperationError(previousErrors);
    if (error) return { ok: false, error };

    const backButton = findButton(["volver"]);
    const viewButton = findButton(["ver ticket"]);
    if (backButton && viewButton) {
      const reference = document.body.innerText.match(/#\d{3,}/)?.[0] || "";
      return { ok: true, reference };
    }
    await delay(350);
  }
  return { ok: false, error: "No hubo confirmacion de creacion. Revisa la pagina antes de reintentar para evitar duplicados." };
}

function readTicketSuccess(expectedTitle = "") {
  const detail = readTicketDetail(expectedTitle);
  if (detail) return { ...detail, kind: "detail" };

  const visibleText = document.body.innerText;
  if (!normalize(visibleText).includes("ticket creado y asignado en glpi")) return null;
  const match = visibleText.match(/Ticket\s+#\s*(\d+)/i);
  if (!match) return null;

  const expected = normalize(expectedTitle);
  const titleControl = findControl("titulo", "input");
  const titleMatches = !expected
    || normalize(titleControl?.value) === expected
    || visibleText.split(/\r?\n/).some((line) => normalize(line) === expected);
  return { reference: `#${match[1]}`, titleMatches, kind: "confirmation" };
}

function readTicketDetail(expectedTitle = "") {
  const visibleText = document.body.innerText;
  const match = visibleText.match(/TICKET\s+GLPI\s+#\s*(\d+)/i);
  if (!match) return null;

  const expected = normalize(expectedTitle);
  const titleMatches = !expected || visibleText
    .split(/\r?\n/)
    .some((line) => normalize(line) === expected);
  return { reference: `#${match[1]}`, titleMatches };
}

function findTicketCloseButton() {
  if (!readTicketDetail()) return null;
  const buttons = [...document.querySelectorAll("button, [role=button]")].filter(isVisible);
  const named = buttons.find((button) => {
    const text = normalize(button.textContent);
    const accessibleName = normalize([
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
    ].filter(Boolean).join(" "));
    return text === "x" || text === "×" || accessibleName === "close" || accessibleName.includes("cerrar detalle");
  });
  if (named) return named;

  const iconButton = buttons.find((button) => button.querySelector('[data-lucide="x"], svg[class*="lucide-x"], .icon-x'));
  if (iconButton) return iconButton;

  return buttons
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.top < 150 && rect.right > window.innerWidth - 180;
    })
    .sort((left, right) => right.getBoundingClientRect().right - left.getBoundingClientRect().right)[0] || null;
}

function findButton(texts) {
  const wanted = texts.map(normalize);
  const actions = [...document.querySelectorAll("button, [role=button], input[type=submit], a[href]")].filter(isVisible);
  return actions.find((button) => {
    const text = normalize(button.textContent || button.value || button.getAttribute("aria-label") || "");
    return wanted.some((item) => text === item);
  }) || actions.find((button) => {
    const text = normalize(button.textContent || button.value || button.getAttribute("aria-label") || "");
    return wanted.some((item) => text.includes(item));
  }) || null;
}

function isLoginPage() {
  const path = normalize(location.pathname);
  const hasVisiblePassword = [...document.querySelectorAll('input[type="password"]')]
    .some((control) => isVisible(control));
  return hasVisiblePassword || path.includes("login") || path.includes("signin");
}

function isVisible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity) !== 0
    && rect.width > 0
    && rect.height > 0;
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function waitUntil(check, timeout, message) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start >= timeout) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 200);
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


async function attachFieldImages(control, images, label) {
  if (!images?.length) return;
  if (!control) throw new Error(`No se encontro el campo ${label} para adjuntar imagenes.`);
  // Only use a file input belonging to this field, never another field's picker.
  let container = control.parentElement;
  let picker = null;
  while (container && container !== document.body) {
    if (container.querySelectorAll("textarea").length > 1) break;
    const candidates = [...container.querySelectorAll('input[type="file"]')];
    if (candidates.length === 1) { picker = candidates[0]; break; }
    container = container.parentElement;
  }
  if (!picker) throw new Error(`No se encontro el selector de imagenes de ${label}. La cola se pausa antes de enviar; revisa el formulario de Central.`);
  for (const attachment of images) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(attachment.dataUrl || "");
    if (!match) throw new Error(`Imagen invalida en ${label}.`);
    const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], attachment.name, { type: match[1] }));
    const previousValue = control.value;
    const previousImages = readImportedImageSources(container);
    const currentControl = () => findControl(label, "textarea") || control;
    picker.value = "";
    picker.files = transfer.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    // Central's image importer inserts the image into the associated text.
    // Do not submit while an import is still pending or unconfirmed.
    await waitUntil(() => currentControl().value !== previousValue
      || [...readImportedImageSources(container.isConnected === false ? findImageFieldContainer(currentControl()) : container)]
        .some((source) => !previousImages.has(source)), 60000,
      `Central no confirmo la imagen ${attachment.name} en ${label}. Revisa el ticket antes de reintentar.`);
  }
}

function readImportedImageSources(container) {
  return new Set([...container.querySelectorAll("img[src], a[href]")]
    .map((node) => node.getAttribute(node.tagName === "IMG" ? "src" : "href"))
    .filter((source) => source && (/^(data:image\/|blob:)/i.test(source)
      || /\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.test(source))));
}

function findImageFieldContainer(control) {
  let container = control.parentElement;
  while (container && container !== document.body) {
    if (container.querySelectorAll("textarea").length > 1) break;
    if (container.querySelectorAll('input[type="file"]').length === 1) return container;
    container = container.parentElement;
  }
  return control.parentElement;
}

}
