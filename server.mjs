import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";

await loadDotEnv();

const root = process.cwd();
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(root, "data");
const dbFile = join(dataDir, "app.db.json");
const host = process.env.HOST || (process.env.RENDER === "true" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 4173);
const appSecret = process.env.APP_SECRET || "dev-only-change-me";
const isProduction = process.env.NODE_ENV === "production";

const config = {
  adminEmail: process.env.ADMIN_EMAIL || "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me-now",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  shopifyShopDomain: process.env.SHOPIFY_SHOP_DOMAIN || "",
  shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || "",
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
};

if (isProduction) {
  const missing = [];
  if (!process.env.APP_SECRET) missing.push("APP_SECRET");
  if (!process.env.ADMIN_EMAIL) missing.push("ADMIN_EMAIL");
  if (!process.env.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const defaultProfile = {
  storeName: "Harbor & Pine Supply Co.",
  supportEmail: "support@harborpine.example",
  policyUrl: "https://harborpine.example/refund-policy",
  fulfillmentNote:
    "Orders are packed within one business day. Tracking is sent to the customer email on file and delivery events are retained for dispute evidence.",
};

const seedDisputes = [
  {
    id: "dp_1009",
    source: "demo",
    processor: "Stripe",
    customer: "Maya Carter",
    email: "maya.carter@example.com",
    orderId: "HP-1842",
    amount: 287.4,
    currency: "USD",
    reason: "Product not received",
    dueDate: "2026-06-01",
    status: "Needs response",
    product: "Walnut desk organizer set",
    orderDate: "2026-05-08",
    fulfilledAt: "2026-05-09 10:18 AM",
    deliveredAt: "2026-05-10 2:14 PM",
    carrier: "UPS",
    trackingNumber: "1Z784A9Y0392214018",
    deliveryCity: "Austin, TX",
    checkoutIp: "73.42.188.20",
    paymentMethod: "Visa ending 4242",
    disputeOpened: "2026-05-24",
    ready: false,
    notes: "",
    packet: null,
    timeline: [
      ["2026-05-08", "Order placed through Shopify checkout from IP 73.42.188.20."],
      ["2026-05-09", "Order fulfilled and UPS tracking 1Z784A9Y0392214018 issued."],
      ["2026-05-10", "UPS marked package delivered in Austin, TX at 2:14 PM."],
      ["2026-05-13", "Customer emailed: \"Thanks, it arrived faster than expected.\""],
      ["2026-05-24", "Customer disputed the payment as product not received."],
    ],
    evidence: [
      evidence("receipt", "Order receipt", "Shopify order HP-1842 for $287.40 with customer billing and shipping details.", true, true),
      evidence("tracking", "Delivery confirmation", "UPS delivered tracking 1Z784A9Y0392214018 on 2026-05-10 at 2:14 PM.", true, true),
      evidence("communication", "Customer communication", "Customer acknowledged receipt by email on 2026-05-13.", false, true),
      evidence("checkout", "Checkout metadata", "Checkout IP and payment method were recorded at purchase.", false, true),
      evidence("policy", "Store policy", "Refund and shipping policy link available for reviewer context.", false, false),
    ],
  },
  {
    id: "dp_1010",
    source: "demo",
    processor: "Shopify Payments",
    customer: "Jon Bell",
    email: "jon.bell@example.com",
    orderId: "HP-1850",
    amount: 119.0,
    currency: "USD",
    reason: "Fraudulent",
    dueDate: "2026-05-29",
    status: "Due soon",
    product: "Canvas weekend tote",
    orderDate: "2026-05-11",
    fulfilledAt: "2026-05-12 4:42 PM",
    deliveredAt: "2026-05-15 11:06 AM",
    carrier: "USPS",
    trackingNumber: "9405511899223197427401",
    deliveryCity: "Columbus, OH",
    checkoutIp: "98.31.44.102",
    paymentMethod: "Mastercard ending 1881",
    disputeOpened: "2026-05-22",
    ready: false,
    notes: "",
    packet: null,
    timeline: [
      ["2026-05-11", "Order placed with AVS street and ZIP match."],
      ["2026-05-12", "Order fulfilled and USPS tracking 9405511899223197427401 issued."],
      ["2026-05-15", "USPS marked package delivered in Columbus, OH at 11:06 AM."],
      ["2026-05-17", "Customer opened support thread asking about care instructions."],
      ["2026-05-22", "Payment disputed as fraudulent."],
    ],
    evidence: [
      evidence("receipt", "Order receipt", "Shopify order HP-1850 for $119.00 with AVS match and shipping address.", true, true),
      evidence("tracking", "Delivery confirmation", "USPS delivered tracking 9405511899223197427401 on 2026-05-15 at 11:06 AM.", true, true),
      evidence("avs", "Payment verification", "AVS street and ZIP match recorded at checkout.", true, true),
      evidence("support", "Post-purchase support", "Customer asked product care question after delivery.", false, false),
    ],
  },
  {
    id: "dp_1011",
    source: "demo",
    processor: "PayPal",
    customer: "Elena Ruiz",
    email: "elena.ruiz@example.com",
    orderId: "HP-1857",
    amount: 64.5,
    currency: "USD",
    reason: "Not as described",
    dueDate: "2026-06-04",
    status: "Needs response",
    product: "Ceramic catchall tray",
    orderDate: "2026-05-14",
    fulfilledAt: "2026-05-15 9:30 AM",
    deliveredAt: "2026-05-18 3:47 PM",
    carrier: "FedEx",
    trackingNumber: "782669021883",
    deliveryCity: "Denver, CO",
    checkoutIp: "66.91.205.7",
    paymentMethod: "PayPal transaction",
    disputeOpened: "2026-05-25",
    ready: false,
    notes: "",
    packet: null,
    timeline: [
      ["2026-05-14", "Customer purchased ceramic catchall tray from product page."],
      ["2026-05-15", "Order packed and shipped by FedEx."],
      ["2026-05-18", "FedEx marked package delivered in Denver, CO at 3:47 PM."],
      ["2026-05-21", "Customer requested return instructions for color preference."],
      ["2026-05-25", "Customer disputed the payment as not as described."],
    ],
    evidence: [
      evidence("receipt", "Order receipt", "PayPal transaction for order HP-1857 with selected product variant.", true, true),
      evidence("product", "Product page snapshot", "Product description, dimensions, and color photos from purchase date.", true, false),
      evidence("return", "Return communication", "Customer requested return instructions due to color preference.", false, true),
      evidence("tracking", "Delivery confirmation", "FedEx delivered tracking 782669021883 on 2026-05-18 at 3:47 PM.", false, true),
    ],
  },
];

await ensureDb();

createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "internal_error", message: "Something went wrong." });
  }
}).listen(port, host, () => {
  console.log(`Chargeback Killer running at http://${host}:${port}`);
});

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { ok: true, integrations: integrationStatus() });
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await parseJsonBody(request);
    if (!validLogin(body.email, body.password)) {
      return sendJson(response, 401, { error: "invalid_credentials" });
    }

    const db = await readDb();
    const token = randomBytes(32).toString("base64url");
    db.sessions = pruneSessions(db.sessions || []);
    db.sessions.push({
      id: randomBytes(8).toString("hex"),
      tokenHash: tokenHash(token),
      email: config.adminEmail,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    });
    await writeDb(db);

    response.setHeader("Set-Cookie", sessionCookie(token));
    return sendJson(response, 200, { user: { email: config.adminEmail }, integrations: integrationStatus() });
  }

  const webhookResponse = await maybeHandleWebhook(request, response, url);
  if (webhookResponse) return;

  if (url.pathname.startsWith("/api/")) {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    return handleApi(request, response, url, auth.db);
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return sendStatic(response, url.pathname, request.method === "HEAD");
  }

  return sendJson(response, 405, { error: "method_not_allowed" });
}

async function handleApi(request, response, url, db) {
  if (url.pathname === "/api/me" && request.method === "GET") {
    return sendJson(response, 200, { user: { email: config.adminEmail }, integrations: integrationStatus() });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = parseCookies(request.headers.cookie || "").ck_session;
    if (token) {
      db.sessions = (db.sessions || []).filter((session) => session.tokenHash !== tokenHash(token));
      await writeDb(db);
    }
    response.setHeader("Set-Cookie", clearSessionCookie());
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === "/api/app-state" && request.method === "GET") {
    return sendJson(response, 200, publicState(db));
  }

  if (url.pathname === "/api/demo/reset" && request.method === "POST") {
    db.profile = { ...defaultProfile };
    db.disputes = structuredClone(seedDisputes);
    db.orders = [];
    db.events.push(eventLog("demo.reset", {}));
    await writeDb(db);
    return sendJson(response, 200, { state: publicState(db) });
  }

  if (url.pathname === "/api/profile" && request.method === "PUT") {
    const body = await parseJsonBody(request);
    db.profile = sanitizeProfile(body);
    await writeDb(db);
    return sendJson(response, 200, { profile: db.profile });
  }

  const disputeMatch = url.pathname.match(/^\/api\/disputes\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (disputeMatch) {
    const dispute = db.disputes.find((item) => item.id === decodeURIComponent(disputeMatch[1]));
    if (!dispute) return sendJson(response, 404, { error: "not_found" });

    const action = disputeMatch[2];
    const detail = disputeMatch[3];

    if (!action && request.method === "GET") {
      return sendJson(response, 200, { dispute });
    }

    if (action === "notes" && request.method === "PATCH") {
      const body = await parseJsonBody(request);
      dispute.notes = String(body.notes || "").slice(0, 4000);
      await writeDb(db);
      return sendJson(response, 200, { dispute });
    }

    if (action === "evidence" && request.method === "POST") {
      const body = await parseJsonBody(request);
      const item = evidence(
        `custom_${Date.now()}`,
        String(body.type || "").trim().slice(0, 120),
        String(body.detail || "").trim().slice(0, 1000),
        false,
        true,
        "manual",
      );
      if (!item.type || !item.detail) return sendJson(response, 400, { error: "invalid_evidence" });
      dispute.evidence.push(item);
      dispute.packet = await buildPacket(db.profile, dispute, "local");
      await writeDb(db);
      return sendJson(response, 201, { dispute });
    }

    if (action === "evidence" && detail && request.method === "PATCH") {
      const body = await parseJsonBody(request);
      const item = dispute.evidence.find((candidate) => candidate.id === decodeURIComponent(detail));
      if (!item) return sendJson(response, 404, { error: "not_found" });
      item.included = Boolean(body.included);
      dispute.packet = await buildPacket(db.profile, dispute, "local");
      await writeDb(db);
      return sendJson(response, 200, { dispute });
    }

    if (action === "generate-response" && request.method === "POST") {
      const packet = await buildPacket(db.profile, dispute, "openai");
      dispute.packet = packet;
      await writeDb(db);
      return sendJson(response, 200, { dispute, packet });
    }

    if (action === "ready" && request.method === "POST") {
      const body = await parseJsonBody(request).catch(() => ({}));
      if (!dispute.packet) dispute.packet = await buildPacket(db.profile, dispute, "local");
      dispute.ready = body.ready === undefined ? true : Boolean(body.ready);
      await writeDb(db);
      return sendJson(response, 200, { dispute });
    }
  }

  if (url.pathname === "/api/integrations/stripe/sync" && request.method === "POST") {
    const result = await syncStripeDisputes(db);
    await writeDb(db);
    return sendJson(response, 200, { ...result, state: publicState(db) });
  }

  if (url.pathname === "/api/integrations/shopify/sync" && request.method === "POST") {
    const result = await syncShopifyOrders(db);
    await writeDb(db);
    return sendJson(response, 200, { ...result, state: publicState(db) });
  }

  return sendJson(response, 404, { error: "not_found" });
}

async function maybeHandleWebhook(request, response, url) {
  if (url.pathname === "/api/webhooks/stripe" && request.method === "POST") {
    const rawBody = await readRawBody(request);
    if (!config.stripeWebhookSecret) return sendJson(response, 501, { error: "stripe_webhook_not_configured" });
    if (!verifyStripeWebhook(rawBody, request.headers["stripe-signature"], config.stripeWebhookSecret)) {
      return sendJson(response, 400, { error: "invalid_signature" });
    }
    const eventPayload = JSON.parse(rawBody.toString("utf8"));
    const db = await readDb();
    ingestStripeEvent(db, eventPayload);
    await writeDb(db);
    return sendJson(response, 200, { received: true });
  }

  if (url.pathname === "/api/webhooks/shopify" && request.method === "POST") {
    const rawBody = await readRawBody(request);
    if (!config.shopifyWebhookSecret) return sendJson(response, 501, { error: "shopify_webhook_not_configured" });
    if (!verifyShopifyWebhook(rawBody, request.headers["x-shopify-hmac-sha256"], config.shopifyWebhookSecret)) {
      return sendJson(response, 400, { error: "invalid_signature" });
    }
    const topic = String(request.headers["x-shopify-topic"] || "unknown");
    const shop = String(request.headers["x-shopify-shop-domain"] || "");
    const payload = JSON.parse(rawBody.toString("utf8"));
    const db = await readDb();
    ingestShopifyOrder(db, payload, { topic, shop, source: "webhook" });
    await writeDb(db);
    return sendJson(response, 200, { received: true });
  }

  return false;
}

async function syncStripeDisputes(db) {
  if (!config.stripeSecretKey) {
    return { ok: false, message: "Stripe is not configured. Add STRIPE_SECRET_KEY." };
  }

  const data = await stripeRequest("/v1/disputes?limit=20");
  const disputes = Array.isArray(data.data) ? data.data : [];
  disputes.forEach((stripeDispute) => upsertDispute(db, mapStripeDispute(stripeDispute)));
  db.events.push(eventLog("stripe.sync", { count: disputes.length }));
  return { ok: true, imported: disputes.length };
}

async function syncShopifyOrders(db) {
  if (!config.shopifyShopDomain || !config.shopifyAdminAccessToken) {
    return { ok: false, message: "Shopify is not configured. Add SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN." };
  }

  const query = `
    query RecentFulfilledOrders {
      orders(first: 20, reverse: true, sortKey: CREATED_AT, query: "fulfillment_status:fulfilled") {
        edges {
          node {
            id
            name
            email
            createdAt
            displayFinancialStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { displayName email }
            lineItems(first: 10) { nodes { title quantity } }
            fulfillments(first: 10) {
              status
              createdAt
              deliveredAt
              estimatedDeliveryAt
              trackingInfo(first: 10) { company number url }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql(query);
  const orders = data?.data?.orders?.edges?.map((edge) => edge.node) || [];
  orders.forEach((order) => ingestShopifyOrder(db, order, { source: "sync", shop: config.shopifyShopDomain }));
  db.events.push(eventLog("shopify.sync", { count: orders.length }));
  return { ok: true, imported: orders.length };
}

function ingestStripeEvent(db, eventPayload) {
  db.events.push(eventLog("stripe.webhook", { type: eventPayload.type, id: eventPayload.id }));
  if (!eventPayload.type?.startsWith("charge.dispute.")) return;
  const stripeDispute = eventPayload.data?.object;
  if (!stripeDispute) return;
  upsertDispute(db, mapStripeDispute(stripeDispute));
}

function ingestShopifyOrder(db, order, meta = {}) {
  const orderRecord = normalizeShopifyOrder(order, meta);
  const existingOrderIndex = db.orders.findIndex((item) => item.id === orderRecord.id || item.name === orderRecord.name);
  if (existingOrderIndex >= 0) db.orders[existingOrderIndex] = { ...db.orders[existingOrderIndex], ...orderRecord };
  else db.orders.push(orderRecord);

  for (const dispute of db.disputes) {
    if (!orderRecord.name || !sameOrder(dispute.orderId, orderRecord.name)) continue;
    enrichDisputeFromShopify(dispute, orderRecord);
  }
  db.events.push(eventLog("shopify.order", { topic: meta.topic || "sync", order: orderRecord.name }));
}

function enrichDisputeFromShopify(dispute, order) {
  dispute.email ||= order.email;
  dispute.customer ||= order.customerName || "Shopify customer";
  dispute.product ||= order.products.join(", ");
  dispute.orderDate ||= dateOnly(order.createdAt);

  for (const fulfillment of order.fulfillments) {
    const tracking = fulfillment.trackingInfo?.[0];
    if (!tracking?.number) continue;
    dispute.carrier ||= tracking.company || "Carrier";
    dispute.trackingNumber ||= tracking.number;
    dispute.fulfilledAt ||= prettyDateTime(fulfillment.createdAt);
    dispute.deliveredAt ||= prettyDateTime(fulfillment.deliveredAt || fulfillment.estimatedDeliveryAt);
    addEvidenceOnce(
      dispute,
      `shopify_tracking_${tracking.number}`,
      "Shopify fulfillment tracking",
      `${tracking.company || "Carrier"} tracking ${tracking.number}${tracking.url ? ` (${tracking.url})` : ""}.`,
      true,
      true,
      "shopify",
    );
  }
}

function mapStripeDispute(stripeDispute) {
  const evidenceData = stripeDispute.evidence || {};
  const dueBy = stripeDispute.evidence_details?.due_by;
  const externalId = stripeDispute.id;
  const orderId =
    stripeDispute.metadata?.order_id ||
    stripeDispute.metadata?.order_name ||
    evidenceData.customer_name ||
    stripeDispute.payment_intent ||
    stripeDispute.charge ||
    externalId;

  const dispute = {
    id: `stripe_${externalId}`,
    source: "stripe",
    externalId,
    processor: "Stripe",
    customer: evidenceData.customer_name || "Stripe customer",
    email: evidenceData.customer_email_address || "",
    orderId,
    amount: Number(stripeDispute.amount || 0) / 100,
    currency: String(stripeDispute.currency || "usd").toUpperCase(),
    reason: stripeReason(stripeDispute.reason),
    dueDate: dueBy ? dateOnly(new Date(dueBy * 1000).toISOString()) : "",
    status: stripeStatus(stripeDispute.status),
    product: evidenceData.product_description || "Disputed order",
    orderDate: stripeDispute.created ? dateOnly(new Date(stripeDispute.created * 1000).toISOString()) : "",
    fulfilledAt: evidenceData.shipping_date || "",
    deliveredAt: "",
    carrier: evidenceData.shipping_carrier || "",
    trackingNumber: evidenceData.shipping_tracking_number || "",
    deliveryCity: "",
    checkoutIp: evidenceData.customer_purchase_ip || "",
    paymentMethod: stripeDispute.charge || stripeDispute.payment_intent || "Stripe payment",
    disputeOpened: stripeDispute.created ? dateOnly(new Date(stripeDispute.created * 1000).toISOString()) : "",
    ready: false,
    notes: "",
    packet: null,
    timeline: [
      [dateOnly(new Date((stripeDispute.created || Date.now() / 1000) * 1000).toISOString()), `Stripe dispute ${externalId} opened with status ${stripeDispute.status}.`],
      ...(dueBy ? [[dateOnly(new Date(dueBy * 1000).toISOString()), "Evidence response due to Stripe."]] : []),
    ],
    evidence: [],
  };

  addEvidenceFromStripe(dispute, "customer_name", "Customer name", evidenceData.customer_name);
  addEvidenceFromStripe(dispute, "customer_email_address", "Customer email", evidenceData.customer_email_address);
  addEvidenceFromStripe(dispute, "customer_purchase_ip", "Checkout IP", evidenceData.customer_purchase_ip);
  addEvidenceFromStripe(dispute, "product_description", "Product description", evidenceData.product_description);
  addEvidenceFromStripe(dispute, "shipping_tracking_number", "Shipping tracking", evidenceData.shipping_tracking_number);
  addEvidenceFromStripe(dispute, "shipping_carrier", "Shipping carrier", evidenceData.shipping_carrier);
  addEvidenceFromStripe(dispute, "customer_communication", "Customer communication", evidenceData.customer_communication);
  addEvidenceFromStripe(dispute, "receipt", "Receipt file", evidenceData.receipt);
  addEvidenceFromStripe(dispute, "refund_policy", "Refund policy", evidenceData.refund_policy);
  addEvidenceOnce(dispute, "stripe_dispute_record", "Stripe dispute record", `Reason: ${dispute.reason}. Status: ${dispute.status}.`, true, true, "stripe");

  return dispute;
}

function addEvidenceFromStripe(dispute, id, type, value) {
  if (!value) return;
  addEvidenceOnce(dispute, `stripe_${id}`, type, String(value), false, true, "stripe");
}

function upsertDispute(db, incoming) {
  const index = db.disputes.findIndex((item) => item.id === incoming.id || item.externalId === incoming.externalId);
  if (index < 0) {
    db.disputes.push(incoming);
    return;
  }

  const existing = db.disputes[index];
  db.disputes[index] = {
    ...existing,
    ...incoming,
    ready: existing.ready || incoming.ready,
    notes: existing.notes || incoming.notes,
    packet: existing.packet || incoming.packet,
    evidence: mergeEvidence(existing.evidence || [], incoming.evidence || []),
    timeline: mergeTimeline(existing.timeline || [], incoming.timeline || []),
  };
}

async function buildPacket(profile, dispute, preferredSource) {
  const includedEvidence = dispute.evidence.filter((item) => item.included);
  let letter = "";
  let source = "local";
  let openaiRequestId = null;

  if (preferredSource === "openai" && config.openaiApiKey) {
    try {
      const openai = await generateOpenAiLetter(profile, dispute, includedEvidence);
      letter = openai.text;
      source = "openai";
      openaiRequestId = openai.requestId;
    } catch (error) {
      console.error("OpenAI generation failed, falling back locally:", error.message);
    }
  }

  if (!letter) letter = buildLocalLetter(profile, dispute, includedEvidence);

  return {
    generatedAt: new Date().toISOString(),
    source,
    openaiRequestId,
    storeName: profile.storeName,
    supportEmail: profile.supportEmail,
    policyUrl: profile.policyUrl,
    disputeId: dispute.id,
    processor: dispute.processor,
    customer: dispute.customer,
    orderId: dispute.orderId,
    amount: dispute.amount,
    currency: dispute.currency || "USD",
    reason: dispute.reason,
    dueDate: dispute.dueDate,
    evidence: includedEvidence,
    timeline: dispute.timeline,
    letter,
    notes: dispute.notes || "",
  };
}

async function generateOpenAiLetter(profile, dispute, includedEvidence) {
  const payload = {
    model: config.openaiModel,
    store: false,
    instructions:
      "You prepare concise, factual payment-dispute evidence letters for ecommerce merchants. Do not promise a win. Use only the provided facts. Write in a professional tone for Stripe, PayPal, Shopify Payments, or bank reviewers.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                merchant: profile,
                dispute: {
                  processor: dispute.processor,
                  customer: dispute.customer,
                  orderId: dispute.orderId,
                  amount: dispute.amount,
                  currency: dispute.currency,
                  reason: dispute.reason,
                  product: dispute.product,
                  orderDate: dispute.orderDate,
                  fulfilledAt: dispute.fulfilledAt,
                  deliveredAt: dispute.deliveredAt,
                  carrier: dispute.carrier,
                  trackingNumber: dispute.trackingNumber,
                  checkoutIp: dispute.checkoutIp,
                  paymentMethod: dispute.paymentMethod,
                  timeline: dispute.timeline,
                  notes: dispute.notes,
                },
                includedEvidence,
                output: "Return only the response letter text, 3-6 short paragraphs.",
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const requestId = response.headers.get("x-request-id");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed with ${response.status}`);
  }

  return {
    text: extractOpenAiText(data),
    requestId,
  };
}

function buildLocalLetter(profile, dispute, evidenceItems) {
  const evidenceTypes = evidenceItems.map((item) => item.type.toLowerCase());
  const hasDelivery = evidenceTypes.some((type) => type.includes("delivery") || type.includes("tracking"));
  const hasCommunication = evidenceTypes.some((type) => type.includes("communication") || type.includes("support") || type.includes("return"));
  const hasVerification = evidenceTypes.some((type) => type.includes("verification") || type.includes("checkout") || type.includes("metadata") || type.includes("ip"));

  return [
    `We are submitting evidence to contest this ${String(dispute.reason).toLowerCase()} dispute for order ${dispute.orderId}. ${profile.storeName} fulfilled the order for ${dispute.customer} and retained the order, fulfillment, and customer communication records below.`,
    hasDelivery
      ? `The order was fulfilled on ${dispute.fulfilledAt || "the recorded fulfillment date"}. ${dispute.carrier || "Carrier"} tracking ${dispute.trackingNumber || "is attached"} shows shipment and delivery details${dispute.deliveredAt ? `, including delivery on ${dispute.deliveredAt}` : ""}.`
      : "The order fulfillment records should be reviewed with any available carrier documentation before final submission.",
    hasVerification
      ? `Checkout and payment metadata were captured at purchase${dispute.checkoutIp ? `, including IP address ${dispute.checkoutIp}` : ""}${dispute.paymentMethod ? ` and ${dispute.paymentMethod}` : ""}.`
      : "Available checkout metadata should be attached if the processor requests buyer verification details.",
    hasCommunication ? "Customer communication records are included to support fulfillment and post-purchase engagement." : "No customer communication has been included yet; add support emails or messages if available.",
    profile.policyUrl ? `The store policy is available at ${profile.policyUrl}. ${profile.fulfillmentNote}` : profile.fulfillmentNote,
    dispute.notes ? `Merchant note: ${dispute.notes}` : "",
    "Based on the attached evidence, we request that the dispute be resolved in the merchant's favor.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractOpenAiText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function stripeRequest(path) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Stripe request failed with ${response.status}`);
  return data;
}

async function shopifyGraphql(query, variables = {}) {
  const response = await fetch(`https://${config.shopifyShopDomain}/admin/api/${config.shopifyApiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.shopifyAdminAccessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errors) {
    throw new Error(data.errors?.[0]?.message || `Shopify request failed with ${response.status}`);
  }
  return data;
}

function verifyStripeWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    String(signatureHeader)
      .split(",")
      .map((part) => part.split("="))
      .filter((part) => part.length === 2),
  );
  if (!parts.t || !parts.v1) return false;
  const timestampAge = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(timestampAge) || timestampAge > 300) return false;
  const signedPayload = `${parts.t}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return safeEqual(expected, parts.v1);
}

function verifyShopifyWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(expected, String(signatureHeader));
}

async function requireAuth(request, response) {
  const token = parseCookies(request.headers.cookie || "").ck_session;
  if (!token) {
    sendJson(response, 401, { error: "unauthorized" });
    return null;
  }

  const db = await readDb();
  db.sessions = pruneSessions(db.sessions || []);
  const session = db.sessions.find((item) => item.tokenHash === tokenHash(token));
  if (!session) {
    await writeDb(db);
    sendJson(response, 401, { error: "unauthorized" });
    return null;
  }

  return { session, db };
}

function validLogin(email, password) {
  if (String(email || "").toLowerCase() !== config.adminEmail.toLowerCase()) return false;
  const input = createHmac("sha256", appSecret).update(String(password || "")).digest();
  const expected = createHmac("sha256", appSecret).update(config.adminPassword).digest();
  return timingSafeEqual(input, expected);
}

function sessionCookie(token) {
  const secure = isProduction ? "; Secure" : "";
  return `ck_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`;
}

function clearSessionCookie() {
  const secure = isProduction ? "; Secure" : "";
  return `ck_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function tokenHash(token) {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

function pruneSessions(sessions) {
  const now = Date.now();
  return sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
}

function sendStatic(response, requestPath, headOnly = false) {
  const requestedPath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = normalize(join(root, requestedPath));
  const resolvedRoot = resolve(root);

  if (!filePath.startsWith(resolvedRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return sendText(response, 404, "Not found");
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  if (headOnly) return response.end();
  createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  response.end(payload);
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
}

async function parseJsonBody(request) {
  const raw = await readRawBody(request);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8"));
}

function readRawBody(request, limit = 2_000_000) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

async function ensureDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbFile)) {
    await writeDb({
      version: 1,
      profile: defaultProfile,
      disputes: seedDisputes,
      orders: [],
      sessions: [],
      events: [],
    });
    return;
  }

  const db = await readDb();
  db.profile ||= defaultProfile;
  db.disputes ||= seedDisputes;
  db.orders ||= [];
  db.sessions ||= [];
  db.events ||= [];
  await writeDb(db);
}

async function readDb() {
  return JSON.parse(await readFile(dbFile, "utf8"));
}

async function writeDb(db) {
  const tmp = `${dbFile}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`);
  await rename(tmp, dbFile);
}

async function loadDotEnv() {
  const envFile = join(process.cwd(), ".env");
  if (!existsSync(envFile)) return;
  const content = await readFile(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function publicState(db) {
  return {
    profile: db.profile,
    disputes: db.disputes,
    integrations: integrationStatus(),
    user: { email: config.adminEmail },
  };
}

function integrationStatus() {
  return {
    stripe: {
      configured: Boolean(config.stripeSecretKey),
      webhooks: Boolean(config.stripeWebhookSecret),
    },
    shopify: {
      configured: Boolean(config.shopifyShopDomain && config.shopifyAdminAccessToken),
      webhooks: Boolean(config.shopifyWebhookSecret),
      shop: config.shopifyShopDomain || null,
      apiVersion: config.shopifyApiVersion,
    },
    openai: {
      configured: Boolean(config.openaiApiKey),
      model: config.openaiModel,
    },
    production: isProduction,
  };
}

function sanitizeProfile(body) {
  return {
    storeName: String(body.storeName || defaultProfile.storeName).trim().slice(0, 120),
    supportEmail: String(body.supportEmail || defaultProfile.supportEmail).trim().slice(0, 160),
    policyUrl: String(body.policyUrl || "").trim().slice(0, 300),
    fulfillmentNote: String(body.fulfillmentNote || "").trim().slice(0, 1200),
  };
}

function evidence(id, type, detail, required = false, included = false, source = "demo") {
  return { id, type, detail, required, included, source };
}

function addEvidenceOnce(dispute, id, type, detail, required = false, included = true, source = "integration") {
  if (!detail || dispute.evidence.some((item) => item.id === id)) return;
  dispute.evidence.push(evidence(id, type, detail, required, included, source));
}

function mergeEvidence(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, { ...item, ...byId.get(item.id), detail: byId.get(item.id)?.detail || item.detail });
  }
  return [...byId.values()];
}

function mergeTimeline(existing, incoming) {
  const seen = new Set(existing.map(([date, text]) => `${date}:${text}`));
  const merged = [...existing];
  for (const entry of incoming) {
    const key = `${entry[0]}:${entry[1]}`;
    if (!seen.has(key)) merged.push(entry);
  }
  return merged;
}

function eventLog(type, payload) {
  return {
    id: randomBytes(8).toString("hex"),
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function normalizeShopifyOrder(order, meta) {
  const fulfillments = order.fulfillments?.nodes || order.fulfillments || [];
  const lineItems = order.lineItems?.nodes || order.line_items || [];
  const customer = order.customer || {};
  return {
    id: order.id || `shopify_${order.admin_graphql_api_id || order.name || Date.now()}`,
    name: order.name || `#${order.order_number || order.id}`,
    email: order.email || customer.email || "",
    customerName: customer.displayName || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
    createdAt: order.createdAt || order.created_at || "",
    total: order.totalPriceSet?.shopMoney?.amount || order.total_price || "",
    currency: order.totalPriceSet?.shopMoney?.currencyCode || order.currency || "USD",
    products: lineItems.map((item) => `${item.quantity || 1}x ${item.title}`).filter(Boolean),
    fulfillments: fulfillments.map((fulfillment) => ({
      status: fulfillment.status || "",
      createdAt: fulfillment.createdAt || fulfillment.created_at || "",
      deliveredAt: fulfillment.deliveredAt || "",
      estimatedDeliveryAt: fulfillment.estimatedDeliveryAt || "",
      trackingInfo: fulfillment.trackingInfo || fulfillment.tracking_info || [],
    })),
    source: meta.source || "shopify",
    shop: meta.shop || "",
  };
}

function sameOrder(left, right) {
  const normalizeOrder = (value) => String(value || "").replace(/^#/, "").trim().toLowerCase();
  return normalizeOrder(left) === normalizeOrder(right);
}

function stripeReason(reason) {
  const map = {
    product_not_received: "Product not received",
    product_unacceptable: "Not as described",
    fraudulent: "Fraudulent",
    unrecognized: "Unrecognized",
    duplicate: "Duplicate",
    credit_not_processed: "Credit not processed",
  };
  return map[reason] || titleize(reason || "general");
}

function stripeStatus(status) {
  const map = {
    needs_response: "Needs response",
    warning_needs_response: "Needs response",
    under_review: "Under review",
    warning_under_review: "Under review",
    won: "Won",
    lost: "Lost",
    warning_closed: "Closed",
  };
  return map[status] || titleize(status || "open");
}

function titleize(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateOnly(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function prettyDateTime(value) {
  if (!value) return "";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
