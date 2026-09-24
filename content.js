const CONTROL_TIMEOUT = 12000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "central.probe") {
    sendResponse(probePage());
    return;
  }
  if (message.type === "central.create") {
    createTicket(message.ticket).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "central.return") {
    sendResponse(startReturnToTicketList());
  }
  if (message.type === "central.finalize") {
    finalizeTicket(message.ticket).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "central.listReady") {
    const formOpen = findControl("titulo", "input") || findControl("descripcion", "textarea");
    sendResponse({ ready: Boolean(findButton(["nuevo ticket"])) && !formOpen && !readTicketSuccess() });
  }
  if (message.type === "central.catalogs") {
    sendResponse(readCatalogsFromOpenForm());
  }
});

function probePage() {
  const canOpen = findButton(["nuevo ticket", "crear ticket", "new ticket"]);
  const formOpen = findControl("titulo", "input") || findControl("descripcion", "textarea");
  if (canOpen || formOpen) return { ready: true };
  if (isLoginPage()) return { ready: false, reason: "Inicia sesion en Central para continuar." };
  return { ready: false, reason: "Abre la seccion Mesa de ayuda y activos para continuar." };
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

  return [...document.querySelectorAll('[role="option"], option, li')]
    .filter(isVisible)
    .map((option) => (option.textContent || option.value || "").trim())
    .filter(Boolean);
}

async function createTicket(ticket) {
  if (isLoginPage()) throw new Error("La sesion se cerro. Inicia sesion y reintenta.");

  const existingSuccess = readTicketSuccess(ticket.title);
  if (existingSuccess) {
    if (!existingSuccess.titleMatches) {
      throw new Error(`Esta abierto otro ticket (${existingSuccess.reference}). Cerralo antes de continuar.`);
    }
    return { ok: true, reference: existingSuccess.reference, recovered: true };
  }

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

  submit.click();
  const result = await waitForSubmission(ticket.title);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function startReturnToTicketList() {
  const success = readTicketSuccess();
  const formOpen = findControl("titulo", "input") || findControl("descripcion", "textarea");
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
  await openTicketDetail(ticket);
  await setSelect("tiempo facturable", ticket.billableTime);
  setCustomerMessage(ticket.customerMessage);

  const closeButton = findOperationalCloseButton();
  if (!closeButton) throw new Error("No se encontro el boton operativo Cerrar del ticket.");
  if (closeButton.disabled) throw new Error("El boton Cerrar no se habilito despues de completar el trabajo.");
  closeButton.click();

  await waitForTicketClosure(ticket.ticketReference);
  return { ok: true, reference: ticket.ticketReference };
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
  const control = findControl("mensaje al cliente / solucion", "textarea")
    || [...document.querySelectorAll("textarea")].find((textarea) => {
      const placeholder = normalize(textarea.placeholder);
      return placeholder.includes("resultado o respuesta para el cliente");
    });
  if (!control) throw new Error("No se encontro el campo Mensaje al cliente / solucion.");
  setNativeValue(control, value);
}

function findOperationalCloseButton() {
  return [...document.querySelectorAll("button, [role=button], input[type=submit]")]
    .filter(isVisible)
    .filter((button) => normalize(button.textContent || button.value) === "cerrar")
    .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0] || null;
}

async function waitForTicketClosure(reference) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const detail = readTicketDetail();
    if (!detail && findButton(["nuevo ticket"])) return;

    const visibleText = document.body.innerText;
    const closedState = visibleText.split(/\r?\n/).some((line) => normalize(line) === "cerrado")
      || Boolean(findButton(["reabrir"]))
      || normalize(visibleText).includes("ticket cerrado");
    if (closedState) {
      const dismiss = findTicketCloseButton();
      if (dismiss) dismiss.click();
      await waitUntil(
        () => Boolean(findButton(["nuevo ticket"])) && !readTicketDetail(),
        CONTROL_TIMEOUT,
        `El ticket ${reference || ""} se cerro, pero no se pudo volver a la lista.`
      );
      return;
    }

    const error = [...document.querySelectorAll('[role="alert"], .alert-danger, .error, .toast')]
      .find((node) => /error|obligatorio|invalido|no se pudo/.test(normalize(node.textContent)));
    if (error) throw new Error(error.textContent.trim().slice(0, 240));
    await delay(350);
  }
  throw new Error(`No hubo confirmacion de cierre para el ticket ${reference || ""}. Revisalo antes de reintentar.`);
}

async function openTicketForm() {
  if (findControl("titulo", "input") && findControl("descripcion", "textarea")) return;
  const openButton = findButton(["nuevo ticket"]);
  if (!openButton) throw new Error("No se encontro el boton Nuevo ticket.");
  openButton.click();
  await waitUntil(() => findControl("titulo", "input") && findControl("descripcion", "textarea"), CONTROL_TIMEOUT, "No se abrio el formulario de nuevo ticket.");
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

  const candidates = [...document.querySelectorAll(preferredTag || "input, textarea, select, [role=combobox]")];
  return candidates.find((control) => {
    const haystack = [control.name, control.id, control.placeholder, control.getAttribute("aria-label")].filter(Boolean).map(normalize).join(" ");
    return haystack.includes(target);
  }) || null;
}

function setText(label, value, tag) {
  const control = findControl(label, tag);
  if (!control) throw new Error(`No se encontro el campo ${label}.`);
  setNativeValue(control, value);
}

async function setSelect(label, visibleValue) {
  const wanted = normalize(visibleValue);
  const started = Date.now();
  let customControl = null;

  while (Date.now() - started < 8000) {
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

async function waitForSubmission(expectedTitle) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const success = readTicketSuccess(expectedTitle);
    if (success?.titleMatches) {
      return { ok: true, reference: success.reference };
    }

    const error = [...document.querySelectorAll('[role="alert"], .alert-danger, .error, .toast')]
      .find((node) => /error|obligatorio|invalido|no se pudo/.test(normalize(node.textContent)));
    if (error) return { ok: false, error: error.textContent.trim().slice(0, 240) };

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
  const actions = [...document.querySelectorAll("button, [role=button], input[type=submit], a[href]")];
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
