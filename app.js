let state = {
  profile: {},
  disputes: [],
  integrations: {},
  user: null,
};

let selectedId = "";
let reasonFilter = "all";
let profileSaveTimer = null;
let notesSaveTimer = null;

const els = {
  authOverlay: document.querySelector("#authOverlay"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  storeName: document.querySelector("#storeName"),
  supportEmail: document.querySelector("#supportEmail"),
  policyUrl: document.querySelector("#policyUrl"),
  fulfillmentNote: document.querySelector("#fulfillmentNote"),
  saveState: document.querySelector("#saveState"),
  openCount: document.querySelector("#openCount"),
  dueSoonCount: document.querySelector("#dueSoonCount"),
  riskAmount: document.querySelector("#riskAmount"),
  integrationList: document.querySelector("#integrationList"),
  syncStripe: document.querySelector("#syncStripe"),
  syncShopify: document.querySelector("#syncShopify"),
  reasonFilter: document.querySelector("#reasonFilter"),
  disputeList: document.querySelector("#disputeList"),
  processorLabel: document.querySelector("#processorLabel"),
  caseTitle: document.querySelector("#case-title"),
  statusPill: document.querySelector("#statusPill"),
  caseAmount: document.querySelector("#caseAmount"),
  caseDueDate: document.querySelector("#caseDueDate"),
  caseReason: document.querySelector("#caseReason"),
  factsList: document.querySelector("#factsList"),
  timeline: document.querySelector("#timeline"),
  merchantNotes: document.querySelector("#merchantNotes"),
  evidenceList: document.querySelector("#evidenceList"),
  evidenceScore: document.querySelector("#evidenceScore"),
  evidenceForm: document.querySelector("#evidenceForm"),
  newEvidenceType: document.querySelector("#newEvidenceType"),
  newEvidenceDetail: document.querySelector("#newEvidenceDetail"),
  packetPreview: document.querySelector("#packetPreview"),
  generateResponse: document.querySelector("#generateResponse"),
  printPacket: document.querySelector("#printPacket"),
  copyPacket: document.querySelector("#copyPacket"),
  markReady: document.querySelector("#markReady"),
  resetDemo: document.querySelector("#resetDemo"),
  logoutButton: document.querySelector("#logoutButton"),
};

init();

async function init() {
  bindAuth();
  bindActions();
  await bootstrap();
}

function bindAuth() {
  els.loginEmail.value = "admin@example.com";
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginError.textContent = "";
    setLoading(els.loginForm.querySelector("button"), true, "Signing In");

    try {
      await api("/api/auth/login", {
        method: "POST",
        body: {
          email: els.loginEmail.value,
          password: els.loginPassword.value,
        },
      });
      els.loginPassword.value = "";
      await loadAppState();
      showApp();
    } catch (error) {
      els.loginError.textContent = error.message || "Sign in failed.";
    } finally {
      setLoading(els.loginForm.querySelector("button"), false);
    }
  });
}

function bindActions() {
  for (const key of ["storeName", "supportEmail", "policyUrl", "fulfillmentNote"]) {
    els[key].addEventListener("input", () => {
      state.profile[key] = els[key].value;
      els.saveState.textContent = "Saving";
      clearTimeout(profileSaveTimer);
      profileSaveTimer = setTimeout(saveProfile, 350);
    });
  }

  els.reasonFilter.addEventListener("change", () => {
    reasonFilter = els.reasonFilter.value;
    renderDisputeList();
  });

  els.merchantNotes.addEventListener("input", () => {
    const dispute = currentDispute();
    if (!dispute) return;
    dispute.notes = els.merchantNotes.value;
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => saveNotes(dispute.id, dispute.notes), 350);
  });

  els.generateResponse.addEventListener("click", async () => {
    const dispute = currentDispute();
    if (!dispute) return;
    setLoading(els.generateResponse, true, "Generating");
    try {
      const data = await api(`/api/disputes/${encodeURIComponent(dispute.id)}/generate-response`, { method: "POST" });
      replaceDispute(data.dispute);
      render();
      showToast(data.packet.source === "openai" ? "OpenAI response packet generated." : "Local response packet generated.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(els.generateResponse, false);
    }
  });

  els.evidenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const dispute = currentDispute();
    if (!dispute) return;

    const type = els.newEvidenceType.value.trim();
    const detail = els.newEvidenceDetail.value.trim();
    if (!type || !detail) return;

    setLoading(els.evidenceForm.querySelector("button"), true, "Adding");
    try {
      const data = await api(`/api/disputes/${encodeURIComponent(dispute.id)}/evidence`, {
        method: "POST",
        body: { type, detail },
      });
      els.newEvidenceType.value = "";
      els.newEvidenceDetail.value = "";
      replaceDispute(data.dispute);
      renderEvidence();
      renderPacket();
      showToast("Evidence added to this dispute.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(els.evidenceForm.querySelector("button"), false);
    }
  });

  els.printPacket.addEventListener("click", async () => {
    await ensurePacket();
    window.print();
  });

  els.copyPacket.addEventListener("click", async () => {
    const dispute = await ensurePacket();
    if (!dispute?.packet) return;

    try {
      await navigator.clipboard.writeText(packetToPlainText(dispute.packet));
      showToast("Packet copied to clipboard.");
    } catch {
      showToast("Clipboard unavailable. Select the packet text and copy manually.");
    }
  });

  els.markReady.addEventListener("click", async () => {
    const dispute = currentDispute();
    if (!dispute) return;
    setLoading(els.markReady, true, "Saving");
    try {
      const data = await api(`/api/disputes/${encodeURIComponent(dispute.id)}/ready`, {
        method: "POST",
        body: { ready: true },
      });
      replaceDispute(data.dispute);
      render();
      showToast("Case marked ready for processor upload.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(els.markReady, false);
    }
  });

  els.resetDemo.addEventListener("click", async () => {
    setLoading(els.resetDemo, true, "Resetting");
    try {
      const data = await api("/api/demo/reset", { method: "POST" });
      applyState(data.state);
      render();
      showToast("Demo data reset.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(els.resetDemo, false);
    }
  });

  els.syncStripe.addEventListener("click", () => syncIntegration("stripe"));
  els.syncShopify.addEventListener("click", () => syncIntegration("shopify"));

  els.logoutButton.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });
}

async function bootstrap() {
  try {
    await api("/api/me");
    await loadAppState();
    showApp();
  } catch {
    showLogin();
  }
}

async function loadAppState() {
  const data = await api("/api/app-state");
  applyState(data);
  render();
}

function applyState(data) {
  state = data;
  selectedId = selectedId || state.disputes[0]?.id || "";
  if (!state.disputes.some((dispute) => dispute.id === selectedId)) {
    selectedId = state.disputes[0]?.id || "";
  }
  syncProfileInputs();
}

function showLogin() {
  els.authOverlay.hidden = false;
}

function showApp() {
  els.authOverlay.hidden = true;
}

async function saveProfile() {
  try {
    const data = await api("/api/profile", {
      method: "PUT",
      body: state.profile,
    });
    state.profile = data.profile;
    syncProfileInputs();
    els.saveState.textContent = "Saved";
  } catch (error) {
    els.saveState.textContent = "Error";
    showToast(error.message);
  }
}

async function saveNotes(disputeId, notes) {
  try {
    const data = await api(`/api/disputes/${encodeURIComponent(disputeId)}/notes`, {
      method: "PATCH",
      body: { notes },
    });
    replaceDispute(data.dispute);
    renderPacket();
  } catch (error) {
    showToast(error.message);
  }
}

async function syncIntegration(provider) {
  const button = provider === "stripe" ? els.syncStripe : els.syncShopify;
  setLoading(button, true, "Syncing");
  try {
    const data = await api(`/api/integrations/${provider}/sync`, { method: "POST" });
    if (data.state) {
      applyState(data.state);
      render();
    }
    showToast(data.message || `${providerName(provider)} sync complete. Imported ${data.imported || 0} records.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading(button, false);
  }
}

function render() {
  renderMetrics();
  renderIntegrations();
  renderDisputeList();
  renderCase();
  renderEvidence();
  renderPacket();
}

function renderMetrics() {
  const open = state.disputes.filter((dispute) => !dispute.ready);
  const dueSoon = open.filter((dispute) => daysUntil(dispute.dueDate) <= 3);
  const risk = open.reduce((sum, dispute) => sum + Number(dispute.amount || 0), 0);

  els.openCount.textContent = open.length;
  els.dueSoonCount.textContent = dueSoon.length;
  els.riskAmount.textContent = formatMoney(risk);
}

function renderIntegrations() {
  const integrations = state.integrations || {};
  const rows = [
    ["Stripe API", integrations.stripe?.configured, integrations.stripe?.webhooks ? "Webhook ready" : "Webhook off"],
    ["Shopify API", integrations.shopify?.configured, integrations.shopify?.shop || "Not connected"],
    ["OpenAI", integrations.openai?.configured, integrations.openai?.model || "Local fallback"],
  ];

  els.integrationList.innerHTML = rows
    .map(
      ([name, configured, detail]) => `
        <div class="integration-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p class="source-note">${escapeHtml(detail)}</p>
          </div>
          <span class="${configured ? "tag" : "tag warn"}">${configured ? "On" : "Off"}</span>
        </div>
      `,
    )
    .join("");

  els.syncStripe.disabled = !integrations.stripe?.configured;
  els.syncShopify.disabled = !integrations.shopify?.configured;
}

function renderDisputeList() {
  const filtered =
    reasonFilter === "all" ? state.disputes : state.disputes.filter((dispute) => dispute.reason === reasonFilter);

  if (!filtered.some((dispute) => dispute.id === selectedId) && filtered.length) {
    selectedId = filtered[0].id;
  }

  els.disputeList.innerHTML = "";
  if (!filtered.length) {
    els.disputeList.innerHTML = `<div class="empty-state"><h3>No disputes found</h3><p>Sync Stripe or change the reason filter.</p></div>`;
    return;
  }

  for (const dispute of filtered) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `dispute-card${dispute.id === selectedId ? " active" : ""}`;
    card.innerHTML = `
      <div class="card-topline">
        <strong>${escapeHtml(dispute.customer)}</strong>
        <span class="${tagClass(dispute)}">${dispute.ready ? "Ready" : escapeHtml(dispute.status)}</span>
      </div>
      <div>
        <div>${escapeHtml(dispute.orderId)} - ${escapeHtml(dispute.product)}</div>
        <div class="card-meta">
          <span>${formatMoney(dispute.amount, dispute.currency)}</span>
          <span>Due ${formatDate(dispute.dueDate)}</span>
        </div>
      </div>
      <div class="card-meta">
        <span>${escapeHtml(dispute.processor)}</span>
        <span>${escapeHtml(dispute.reason)}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      selectedId = dispute.id;
      renderCase();
      renderEvidence();
      renderPacket();
      renderDisputeList();
    });
    els.disputeList.appendChild(card);
  }
}

function renderCase() {
  const dispute = currentDispute();
  if (!dispute) return;

  els.processorLabel.textContent = dispute.processor;
  els.caseTitle.textContent = `${dispute.orderId} - ${dispute.customer}`;
  els.statusPill.textContent = dispute.ready ? "Ready" : dispute.status;
  els.statusPill.classList.toggle("ready", Boolean(dispute.ready));
  els.caseAmount.textContent = formatMoney(dispute.amount, dispute.currency);
  els.caseDueDate.textContent = formatDate(dispute.dueDate);
  els.caseReason.textContent = dispute.reason;
  els.merchantNotes.value = dispute.notes || "";

  const facts = [
    ["Customer", `${dispute.customer || "-"} - ${dispute.email || "No email"}`],
    ["Product", dispute.product || "-"],
    ["Order date", formatDate(dispute.orderDate)],
    ["Fulfilled", dispute.fulfilledAt || "-"],
    ["Delivered", `${dispute.deliveredAt || "-"}${dispute.deliveryCity ? ` - ${dispute.deliveryCity}` : ""}`],
    ["Tracking", `${dispute.carrier || "-"} ${dispute.trackingNumber || ""}`.trim()],
    ["Checkout IP", dispute.checkoutIp || "-"],
    ["Payment", dispute.paymentMethod || "-"],
  ];

  els.factsList.innerHTML = facts
    .map(
      ([label, value]) => `
      <div class="fact">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `,
    )
    .join("");

  els.timeline.innerHTML = (dispute.timeline || [])
    .map(
      ([date, event]) => `
        <li>
          <time datetime="${escapeHtml(date)}">${formatDate(date)}</time>
          <span>${escapeHtml(event)}</span>
        </li>
      `,
    )
    .join("");
}

function renderEvidence() {
  const dispute = currentDispute();
  if (!dispute) return;

  const evidence = dispute.evidence || [];
  const includedCount = evidence.filter((item) => item.included).length;
  const score = evidence.length ? Math.round((includedCount / evidence.length) * 100) : 0;

  els.evidenceScore.textContent = `${score}%`;
  els.evidenceList.innerHTML = "";

  evidence.forEach((item) => {
    const row = document.createElement("label");
    row.className = "evidence-item";
    row.innerHTML = `
      <input type="checkbox" ${item.included ? "checked" : ""} aria-label="Include ${escapeHtml(item.type)}" />
      <span class="evidence-copy">
        <h3>${escapeHtml(item.type)}${item.required ? " - required" : ""}</h3>
        <p>${escapeHtml(item.detail)}</p>
      </span>
    `;
    row.querySelector("input").addEventListener("change", async (event) => {
      const checked = event.target.checked;
      item.included = checked;
      renderEvidence();
      try {
        const data = await api(`/api/disputes/${encodeURIComponent(dispute.id)}/evidence/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: { included: checked },
        });
        replaceDispute(data.dispute);
        renderPacket();
      } catch (error) {
        showToast(error.message);
      }
    });
    els.evidenceList.appendChild(row);
  });
}

function renderPacket() {
  const dispute = currentDispute();
  const packet = dispute?.packet;

  if (!packet) {
    els.packetPreview.innerHTML = `
      <div class="empty-state">
        <h3>No packet generated yet</h3>
        <p>Confirm the evidence for the selected dispute, then generate the response letter.</p>
      </div>
    `;
    return;
  }

  els.packetPreview.innerHTML = packetToHtml(packet);
}

async function ensurePacket() {
  let dispute = currentDispute();
  if (dispute?.packet) return dispute;

  const data = await api(`/api/disputes/${encodeURIComponent(dispute.id)}/generate-response`, { method: "POST" });
  replaceDispute(data.dispute);
  renderPacket();
  dispute = currentDispute();
  return dispute;
}

function replaceDispute(dispute) {
  const index = state.disputes.findIndex((item) => item.id === dispute.id);
  if (index >= 0) state.disputes[index] = dispute;
  else state.disputes.push(dispute);
}

function currentDispute() {
  return state.disputes.find((dispute) => dispute.id === selectedId) || state.disputes[0];
}

function syncProfileInputs() {
  for (const key of ["storeName", "supportEmail", "policyUrl", "fulfillmentNote"]) {
    els[key].value = state.profile?.[key] || "";
  }
}

function packetToHtml(packet) {
  return `
    <div class="packet-document">
      <header>
        <div>
          <p class="eyebrow">Chargeback evidence response</p>
          <h3>${escapeHtml(packet.storeName)}</h3>
          <p class="source-note">Generated by ${packet.source === "openai" ? "OpenAI" : "local fallback"}</p>
        </div>
        <div class="packet-meta">
          <span>${escapeHtml(packet.processor)}</span>
          <span>Order ${escapeHtml(packet.orderId)}</span>
          <span>${escapeHtml(packet.reason)}</span>
          <span>Due ${formatDate(packet.dueDate)}</span>
        </div>
      </header>

      <h4>Response Letter</h4>
      <p class="letter-body">${escapeHtml(packet.letter)}</p>

      <h4>Evidence Included</h4>
      <ul>
        ${packet.evidence.map((item) => `<li><strong>${escapeHtml(item.type)}:</strong> ${escapeHtml(item.detail)}</li>`).join("")}
      </ul>

      <h4>Order Timeline</h4>
      <ul>
        ${packet.timeline.map(([date, event]) => `<li><strong>${formatDate(date)}:</strong> ${escapeHtml(event)}</li>`).join("")}
      </ul>

      <h4>Submission Details</h4>
      <ul>
        <li><strong>Customer:</strong> ${escapeHtml(packet.customer)}</li>
        <li><strong>Amount:</strong> ${formatMoney(packet.amount, packet.currency)}</li>
        <li><strong>Merchant contact:</strong> ${escapeHtml(packet.supportEmail)}</li>
        <li><strong>Generated:</strong> ${formatDateTime(packet.generatedAt)}</li>
      </ul>
    </div>
  `;
}

function packetToPlainText(packet) {
  return [
    "CHARGEBACK EVIDENCE RESPONSE",
    packet.storeName,
    "",
    `Processor: ${packet.processor}`,
    `Order: ${packet.orderId}`,
    `Customer: ${packet.customer}`,
    `Amount: ${formatMoney(packet.amount, packet.currency)}`,
    `Reason: ${packet.reason}`,
    `Due: ${formatDate(packet.dueDate)}`,
    `Generated by: ${packet.source === "openai" ? "OpenAI" : "local fallback"}`,
    "",
    "RESPONSE LETTER",
    packet.letter,
    "",
    "EVIDENCE INCLUDED",
    ...packet.evidence.map((item) => `- ${item.type}: ${item.detail}`),
    "",
    "ORDER TIMELINE",
    ...packet.timeline.map(([date, event]) => `- ${formatDate(date)}: ${event}`),
  ].join("\n");
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const init = {
    method: options.method || "GET",
    headers,
    credentials: "same-origin",
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401) showLogin();
    const message = typeof data === "string" ? data : data.message || data.error || "Request failed";
    throw new Error(message.replaceAll("_", " "));
  }

  return data;
}

function tagClass(dispute) {
  if (dispute.ready) return "tag";
  if (daysUntil(dispute.dueDate) <= 1) return "tag danger";
  if (daysUntil(dispute.dueDate) <= 3) return "tag warn";
  return "tag";
}

function daysUntil(date) {
  if (!date) return 999;
  const today = new Date();
  const target = new Date(`${date}T12:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function formatMoney(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(Number(value || 0));
}

function formatDate(date) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function providerName(provider) {
  return provider === "stripe" ? "Stripe" : "Shopify";
}

function setLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || "Working";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}
