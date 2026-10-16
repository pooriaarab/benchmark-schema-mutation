import { mkdir, writeFile } from "node:fs/promises";

const PUBLIC_SEED = 20261015;
const KINDS = ["renamedField", "newRequired", "enumChange", "splitEndpoint", "typeChange"];

const S = (d) => ({ type: "string", description: d });
const N = (d) => ({ type: "number", description: d });
const I = (d) => ({ type: "integer", description: d });
const A = (d) => ({ type: "array", items: { type: "string" }, description: d });
const E = (d, v) => ({ type: "string", enum: v, description: d });

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const digits = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join("");
const usd = (r) => int(r, 500, 9999) / 100;
const email = (r) => `${pick(r, ["sam", "lee", "jae", "kim", "pat"])}@${pick(r, ["acme.io", "foo.dev", "bar.io", "baz.dev"])}`;
const phone = (r) => `+1416555${digits(r, 4)}`;
const code = (r) => `Your code is ${digits(r, 4)}.`;

// Base tool catalogue. `vars(rng)` draws the concrete values (ids, amounts,
// names) for one task, so a different seed yields genuinely different tasks.
// `ask(ctx, words)` renders the request; `words` overrides how an enum-valued
// field is phrased. `call(ctx)` is the stale call, valid under the base
// schema. `ops[kind]` lists mutation variants; the seed picks one.
const TOOLS = [
  {
    name: "issues.create", v: "3.2.0", desc: "Create an issue in a repository.",
    props: { repo: S("Repository as owner/name"), title: S("Issue title"), body: S("Markdown body"), labels: A("Label names"), kind: E("Issue kind", ["bug", "feature", "chore"]), visibility: E("Who can see it", ["public", "maintainers"]) },
    req: ["repo", "title", "kind", "visibility"],
    vars: (r) => ({
      repo: pick(r, ["acme/widgets", "northwind/shop", "globex/portal", "initech/billing"]),
      title: pick(r, ["Dark mode", "Export CSV", "SSO login", "Mobile layout"]),
      body: pick(r, ["Add a dark theme.", "See the attached spec.", "Requested by the design team.", "Blocked on the API refresh."]),
      label: pick(r, ["ui", "backend", "billing", "docs"]),
      kind: pick(r, ["feature", "bug", "chore"]),
      visibility: pick(r, ["maintainers", "public"]),
    }),
    ask: (c, w = {}) => `In ${c.repo} open a '${w.kind ?? c.kind}' issue titled '${c.title}' with body '${c.body}', label ${c.label}, visible to ${w.visibility ?? c.visibility}.`,
    call: (c) => ({ repo: c.repo, title: c.title, body: c.body, labels: [c.label], kind: c.kind, visibility: c.visibility }),
    ops: {
      renamedField: [() => ({ field: "title", to: "subject" })],
      newRequired: [() => ({ field: "severity", schema: E("Triage severity", ["low", "medium", "high"]), value: "high" })],
      enumChange: [() => ({ field: "kind", to: ["defect", "enhancement", "task"], map: { bug: "defect", feature: "enhancement", chore: "task" } })],
      splitEndpoint: [() => ({ field: "visibility", children: { public: "issues.create_public", maintainers: "issues.create_team" } })],
      typeChange: [(c) => ({ field: "labels", to: S("Comma-separated label names"), value: c.label })],
    },
  },
  {
    name: "charges.create", v: "2.8.1", desc: "Create a payment charge.",
    props: { customer: S("Customer id"), amount: N("Amount in dollars"), currency: E("Settlement currency", ["usd", "eur", "gbp"]), capture: E("Capture mode", ["auto", "manual"]), description: S("Statement text") },
    req: ["customer", "amount", "currency", "capture"],
    vars: (r) => ({
      customer: `cus_${int(r, 1000, 9999)}`,
      amount: usd(r),
      currency: pick(r, ["usd", "eur", "gbp"]),
      capture: pick(r, ["auto", "manual"]),
      description: `Order ${int(r, 100, 999)}`,
    }),
    ask: (c, w = {}) => `Charge customer ${c.customer} ${c.amount} in '${w.currency ?? c.currency}' for '${c.description}' with ${w.capture ?? c.capture} capture.`,
    call: (c) => ({ customer: c.customer, amount: c.amount, currency: c.currency, capture: c.capture, description: c.description }),
    ops: {
      renamedField: [() => ({ field: "description", to: "memo" })],
      newRequired: [(c, r) => ({ field: "idempotency_key", schema: S("Unique key to retry safely"), value: `req-${int(r, 1000, 9999)}` })],
      enumChange: [() => ({ field: "currency", to: ["USD", "EUR", "GBP", "JPY"], map: { usd: "USD", eur: "EUR", gbp: "GBP" } })],
      splitEndpoint: [() => ({ field: "capture", children: { auto: "charges.create_capture", manual: "charges.authorize" } })],
      typeChange: [(c) => ({ field: "amount", to: I("Amount in cents"), value: Math.round(c.amount * 100) })],
    },
  },
  {
    name: "messages.post", v: "5.1.0", desc: "Post a message to a chat channel.",
    props: { channel: S("Channel name"), text: S("Message text"), attachments: A("Attachment URLs"), priority: E("Delivery priority", ["normal", "high", "urgent"]), audience: E("Who may read it", ["everyone", "admins"]) },
    req: ["channel", "text", "priority", "audience"],
    vars: (r) => ({
      channel: pick(r, ["#ops", "#dev", "#alerts"]),
      text: pick(r, ["Deploy finished.", "The build is green.", "Rollback started.", "Maintenance begins at midnight."]),
      attachment: `https://ci.example/build/${int(r, 2, 98)}`,
      priority: pick(r, ["normal", "high", "urgent"]),
      audience: pick(r, ["everyone", "admins"]),
    }),
    ask: (c, w = {}) => `Post '${c.text}' to ${c.channel} with attachment ${c.attachment} at '${w.priority ?? c.priority}' priority for ${w.audience ?? c.audience}.`,
    call: (c) => ({ channel: c.channel, text: c.text, attachments: [c.attachment], priority: c.priority, audience: c.audience }),
    ops: {
      renamedField: [() => ({ field: "text", to: "body" })],
      newRequired: [(c, r) => ({ field: "team_id", schema: S("Workspace team id"), value: `T${int(r, 2, 9)}${digits(r, 4)}` })],
      enumChange: [() => ({ field: "priority", to: ["low", "elevated", "critical"], map: { normal: "low", high: "elevated", urgent: "critical" } })],
      splitEndpoint: [() => ({ field: "audience", children: { everyone: "messages.post_channel", admins: "messages.post_admins" } })],
      typeChange: [(c) => ({ field: "attachments", to: S("Single attachment URL"), value: c.attachment })],
    },
  },
  {
    name: "events.create", v: "4.0.2", desc: "Create a calendar event.",
    props: { calendar_id: S("Calendar id"), title: S("Event title"), start: S("ISO 8601 start time"), duration_min: I("Length in minutes"), attendees: A("Attendee emails"), status: E("Event status", ["confirmed", "tentative", "cancelled"]), scope: E("Calendar scope", ["personal", "shared"]) },
    req: ["calendar_id", "title", "start", "status", "scope"],
    vars: (r) => ({
      calendar: pick(r, ["cal_main", "cal_team", "cal_ops"]),
      title: pick(r, ["Quarterly review", "Sprint demo", "Board sync"]),
      start: `2026-${pick(r, ["10", "11", "12"])}-${pick(r, ["02", "09", "17", "24"])}T${pick(r, ["09", "14", "15", "18"])}:00:00Z`,
      duration: pick(r, [30, 45, 60, 90]),
      attendees: [email(r), email(r)],
      status: pick(r, ["confirmed", "tentative", "cancelled"]),
      scope: pick(r, ["personal", "shared"]),
    }),
    ask: (c, w = {}) => `On calendar ${c.calendar} create '${c.title}' starting ${c.start} lasting ${c.duration} minutes with attendees ${c.attendees.join(" and ")}, status '${w.status ?? c.status}', on the ${w.scope ?? c.scope} calendar.`,
    call: (c) => ({ calendar_id: c.calendar, title: c.title, start: c.start, duration_min: c.duration, attendees: c.attendees, status: c.status, scope: c.scope }),
    ops: {
      renamedField: [() => ({ field: "title", to: "summary" })],
      newRequired: [(c, r) => ({ field: "timezone", schema: S("IANA timezone"), value: pick(r, ["America/Toronto", "Europe/Berlin", "UTC"]) })],
      enumChange: [() => ({ field: "status", to: ["accepted", "maybe", "declined"], map: { confirmed: "accepted", tentative: "maybe", cancelled: "declined" } })],
      splitEndpoint: [() => ({ field: "scope", children: { personal: "events.create_personal", shared: "events.create_shared" } })],
      typeChange: [(c) => ({ field: "duration_min", to: S("ISO 8601 duration"), value: `PT${c.duration}M` })],
    },
  },
  {
    name: "tickets.open", v: "2.4.0", desc: "Open a support ticket.",
    props: { requester: S("Requester email"), subject: S("Ticket subject"), comment: S("First comment"), tags: A("Tag names"), priority: E("Ticket priority", ["low", "normal", "high", "urgent"]), queue: E("Routing queue", ["support", "billing"]) },
    req: ["requester", "subject", "comment", "priority", "queue"],
    vars: (r) => ({
      requester: email(r),
      subject: pick(r, ["Invoice mismatch", "Login fails", "Refund missing", "Cannot export"]),
      comment: pick(r, ["Billed twice in October.", "Error 500 on sign-in.", "Money never arrived.", "Export stalls at 90%."]),
      tag: pick(r, ["billing", "auth", "refunds"]),
      priority: pick(r, ["low", "normal", "high", "urgent"]),
      queue: pick(r, ["support", "billing"]),
    }),
    ask: (c, w = {}) => `Open a ticket in the '${w.queue ?? c.queue}' queue for ${c.requester} titled '${c.subject}' saying '${c.comment}', tag ${c.tag}, priority '${w.priority ?? c.priority}'.`,
    call: (c) => ({ requester: c.requester, subject: c.subject, comment: c.comment, tags: [c.tag], priority: c.priority, queue: c.queue }),
    ops: {
      renamedField: [() => ({ field: "subject", to: "title" })],
      newRequired: [(c, r) => ({ field: "brand_id", schema: I("Brand to file under"), value: int(r, 3, 9) })],
      enumChange: [() => ({ field: "priority", to: ["p3", "p2", "p1", "p0"], map: { low: "p3", normal: "p2", high: "p1", urgent: "p0" } })],
      splitEndpoint: [() => ({ field: "queue", children: { support: "tickets.open_support", billing: "tickets.open_billing" } })],
      typeChange: [(c) => ({ field: "tags", to: S("Comma-separated tags"), value: c.tag })],
    },
  },
  {
    name: "emails.send", v: "3.0.0", desc: "Send a transactional email.",
    props: { to: S("Recipient address"), subject: S("Subject line"), body: S("Plain text body"), cc: A("CC addresses"), importance: E("Importance flag", ["normal", "high"]), audience: E("Recipient class", ["customer", "internal"]) },
    req: ["to", "subject", "body", "importance", "audience"],
    vars: (r) => ({
      to: email(r),
      subject: pick(r, ["Receipt #311", "Welcome aboard", "Your invoice", "Password reset"]),
      body: pick(r, ["Thanks for your order.", "Here is your receipt.", "Reset instructions inside."]),
      cc: email(r),
      importance: pick(r, ["normal", "high"]),
      audience: pick(r, ["customer", "internal"]),
    }),
    ask: (c, w = {}) => `Email ${c.to} subject '${c.subject}' body '${c.body}', cc ${c.cc}, '${w.importance ?? c.importance}' importance, ${w.audience ?? c.audience} audience.`,
    call: (c) => ({ to: c.to, subject: c.subject, body: c.body, cc: [c.cc], importance: c.importance, audience: c.audience }),
    ops: {
      renamedField: [() => ({ field: "body", to: "html" })],
      newRequired: [(c, r) => ({ field: "campaign_id", schema: S("Campaign tag"), value: `cmp-${int(r, 10, 99)}` })],
      enumChange: [() => ({ field: "importance", to: ["routine", "priority"], map: { normal: "routine", high: "priority" } })],
      splitEndpoint: [() => ({ field: "audience", children: { customer: "emails.send_customer", internal: "emails.send_internal" } })],
      typeChange: [(c) => ({ field: "cc", to: S("Comma-separated CC addresses"), value: c.cc })],
    },
  },
  {
    name: "objects.upload", v: "6.1.3", desc: "Upload an object to a storage bucket.",
    props: { bucket: S("Bucket name"), key: S("Object key"), content_type: S("MIME type"), tags: A("Object tags"), storage: E("Storage class", ["standard", "infrequent", "archive"]), acl: E("Access policy", ["private", "public"]) },
    req: ["bucket", "key", "content_type", "storage", "acl"],
    vars: (r) => ({
      bucket: pick(r, ["assets-prod", "media-eu", "backups", "static"]),
      ...pick(r, [{ key: "img/hero.png", ct: "image/png" }, { key: "docs/guide.pdf", ct: "application/pdf" }, { key: "video/intro.mp4", ct: "video/mp4" }, { key: "css/site.css", ct: "text/css" }]),
      tags: pick(r, [["web", "hero"], ["marketing"], ["assets", "public"], ["img", "hero", "web"]]),
      storage: pick(r, ["standard", "infrequent", "archive"]),
      acl: pick(r, ["private", "public"]),
    }),
    ask: (c, w = {}) => `Upload ${c.key} (${c.ct}) to bucket ${c.bucket}, tags ${c.tags.join(" and ")}, '${w.storage ?? c.storage}' storage, ${w.acl ?? c.acl} acl.`,
    call: (c) => ({ bucket: c.bucket, key: c.key, content_type: c.ct, tags: c.tags, storage: c.storage, acl: c.acl }),
    ops: {
      renamedField: [() => ({ field: "key", to: "path" })],
      newRequired: [(c, r) => ({ field: "checksum", schema: S("Content checksum"), value: `sha256:${digits(r, 4)}` })],
      enumChange: [() => ({ field: "storage", to: ["hot", "cool", "cold"], map: { standard: "hot", infrequent: "cool", archive: "cold" } })],
      splitEndpoint: [() => ({ field: "acl", children: { private: "objects.upload_private", public: "objects.upload_public" } })],
      typeChange: [(c) => ({ field: "tags", to: S("Comma-separated tags"), value: c.tags.join(",") })],
    },
  },
  {
    name: "search.query", v: "1.9.0", desc: "Run a keyword search.",
    props: { q: S("Query text"), limit: I("Max results"), filters: A("Filter expressions"), index: E("Index to search", ["docs", "code", "issues"]), scope: E("Result scope", ["org", "user"]) },
    req: ["q", "limit", "index", "scope"],
    vars: (r) => ({
      q: pick(r, ["refund policy", "uptime sla", "api keys", "rate limits"]),
      limit: int(r, 5, 50),
      filter: `${pick(r, ["country", "lang", "type"])}:${pick(r, ["ca", "us", "de", "en", "docs"])}`,
      index: pick(r, ["docs", "code", "issues"]),
      scope: pick(r, ["org", "user"]),
    }),
    ask: (c, w = {}) => `Search the '${w.index ?? c.index}' index for '${c.q}', limit ${c.limit}, filter ${c.filter}, scope ${w.scope ?? c.scope}.`,
    call: (c) => ({ q: c.q, limit: c.limit, filters: [c.filter], index: c.index, scope: c.scope }),
    ops: {
      renamedField: [() => ({ field: "q", to: "query" })],
      newRequired: [(c, r) => ({ field: "locale", schema: S("Result locale"), value: pick(r, ["en-CA", "en-US", "fr-FR", "de-DE"]) })],
      enumChange: [() => ({ field: "index", to: ["documentation", "source", "tickets"], map: { docs: "documentation", code: "source", issues: "tickets" } })],
      splitEndpoint: [() => ({ field: "scope", children: { org: "search.query_org", user: "search.query_user" } })],
      typeChange: [(c) => ({ field: "filters", to: S("Comma-separated filters"), value: c.filter })],
    },
  },
  {
    name: "sms.send", v: "7.3.1", desc: "Send a text message.",
    props: { to: S("Recipient number"), from: S("Sender number"), body: S("Message body"), media: A("Media URLs"), priority: E("Send priority", ["standard", "express"]), channel: E("Bearer channel", ["sms", "mms"]) },
    req: ["to", "from", "body", "priority", "channel"],
    vars: (r) => ({
      to: phone(r),
      from: phone(r),
      body: pick(r, [code(r), "Your package shipped.", "Appointment reminder.", "Delivery delayed by one day."]),
      media: `https://img.example/${pick(r, ["x", "qr", "photo", "receipt"])}.png`,
      priority: pick(r, ["standard", "express"]),
      channel: pick(r, ["sms", "mms"]),
    }),
    ask: (c, w = {}) => `Text ${c.to} from ${c.from} saying '${c.body}' with media ${c.media}, '${w.priority ?? c.priority}' priority over ${w.channel ?? c.channel}.`,
    call: (c) => ({ to: c.to, from: c.from, body: c.body, media: [c.media], priority: c.priority, channel: c.channel }),
    ops: {
      renamedField: [() => ({ field: "body", to: "message" })],
      newRequired: [(c, r) => ({ field: "app_id", schema: S("Sending application id"), value: `app-${int(r, 100, 999)}` })],
      enumChange: [() => ({ field: "priority", to: ["economy", "flash"], map: { standard: "economy", express: "flash" } })],
      splitEndpoint: [() => ({ field: "channel", children: { sms: "sms.send_text", mms: "sms.send_media" } })],
      typeChange: [(c) => ({ field: "media", to: S("Single media URL"), value: c.media })],
    },
  },
  {
    name: "deploys.trigger", v: "2.2.0", desc: "Trigger a deployment.",
    props: { service: S("Service name"), ref: S("Git ref or tag"), replicas: I("Replica count"), notify: A("Notification channels"), env: E("Target environment", ["staging", "production"]), strategy: E("Rollout strategy", ["rolling", "bluegreen"]) },
    req: ["service", "ref", "replicas", "env", "strategy"],
    vars: (r) => ({
      service: pick(r, ["api-gateway", "web-frontend", "worker-pool", "billing-svc"]),
      ref: `v${int(r, 1, 5)}.${int(r, 0, 20)}.${int(r, 0, 9)}`,
      replicas: int(r, 1, 5),
      notify: pick(r, [["#deploys"], ["#ops", "#deploys"], ["#releases"]]),
      env: pick(r, ["staging", "production"]),
      strategy: pick(r, ["rolling", "bluegreen"]),
    }),
    ask: (c, w = {}) => `Deploy ${c.service} ref ${c.ref} with ${c.replicas} replicas to '${w.env ?? c.env}' using a ${w.strategy ?? c.strategy} strategy; notify ${c.notify.join(" and ")}.`,
    call: (c) => ({ service: c.service, ref: c.ref, replicas: c.replicas, notify: c.notify, env: c.env, strategy: c.strategy }),
    ops: {
      renamedField: [() => ({ field: "ref", to: "revision" })],
      newRequired: [(c, r) => ({ field: "ticket", schema: S("Change ticket id"), value: `CHG-${int(r, 1000, 9999)}` })],
      enumChange: [() => ({ field: "env", to: ["stage", "prod"], map: { staging: "stage", production: "prod" } })],
      splitEndpoint: [() => ({ field: "strategy", children: { rolling: "deploys.trigger_rolling", bluegreen: "deploys.trigger_bluegreen" } })],
      typeChange: [(c) => ({ field: "replicas", to: S("Replica count as a string"), value: String(c.replicas) })],
    },
  },
  {
    name: "contacts.update", v: "4.4.0", desc: "Update a CRM contact.",
    props: { contact_id: S("Contact id"), email: S("Email address"), phone: S("Phone number"), tags: A("Contact tags"), stage: E("Pipeline stage", ["lead", "prospect", "customer"]), owner: E("Owning team", ["sales", "support"]) },
    req: ["contact_id", "email", "stage", "owner"],
    vars: (r) => ({
      contact: `ct-${int(r, 100, 999)}`,
      email: email(r),
      phone: phone(r),
      tag: pick(r, ["vip", "trial", "churned", "enterprise"]),
      stage: pick(r, ["lead", "prospect", "customer"]),
      owner: pick(r, ["sales", "support"]),
    }),
    ask: (c, w = {}) => `Update contact ${c.contact}: email ${c.email}, phone ${c.phone}, tag ${c.tag}, stage '${w.stage ?? c.stage}', owner ${w.owner ?? c.owner}.`,
    call: (c) => ({ contact_id: c.contact, email: c.email, phone: c.phone, tags: [c.tag], stage: c.stage, owner: c.owner }),
    ops: {
      renamedField: [() => ({ field: "phone", to: "phone_number" })],
      newRequired: [(c, r) => ({ field: "source", schema: S("Attribution source"), value: pick(r, ["webinar-oct", "conf-2026", "referral", "ads"]) })],
      enumChange: [() => ({ field: "stage", to: ["new", "qualified", "won"], map: { lead: "new", prospect: "qualified", customer: "won" } })],
      splitEndpoint: [() => ({ field: "owner", children: { sales: "contacts.update_sales", support: "contacts.update_support" } })],
      typeChange: [(c) => ({ field: "tags", to: S("Comma-separated tags"), value: c.tag })],
    },
  },
  {
    name: "payments.refund", v: "1.5.2", desc: "Refund a captured payment.",
    props: { payment_id: S("Payment id"), amount: N("Amount in dollars"), reason: E("Refund reason", ["duplicate", "fraud", "requested"]), method: E("Refund destination", ["card", "balance"]) },
    req: ["payment_id", "amount", "reason", "method"],
    vars: (r) => ({
      payment: `pay_${int(r, 1000, 9999)}`,
      amount: usd(r),
      reason: pick(r, ["duplicate", "fraud", "requested"]),
      method: pick(r, ["card", "balance"]),
    }),
    ask: (c, w = {}) => `Refund payment ${c.payment} for $${c.amount}, reason '${w.reason ?? c.reason}', back to ${w.method ?? c.method}.`,
    call: (c) => ({ payment_id: c.payment, amount: c.amount, reason: c.reason, method: c.method }),
    ops: {
      renamedField: [() => ({ field: "payment_id", to: "transaction_id" })],
      newRequired: [(c, r) => ({ field: "note", schema: S("Refund note"), value: pick(r, ["double charge", "customer request", "fraud review"]) })],
      enumChange: [() => ({ field: "reason", to: ["accidental", "suspected_fraud", "customer_request"], map: { duplicate: "accidental", fraud: "suspected_fraud", requested: "customer_request" } })],
      splitEndpoint: [() => ({ field: "method", children: { card: "payments.refund_card", balance: "payments.refund_balance" } })],
      typeChange: [(c) => ({ field: "amount", to: I("Amount in cents"), value: Math.round(c.amount * 100) })],
    },
  },
];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

const spec = (name, desc, props, req, v) => ({
  name, description: desc, schema_version: v,
  parameters: { type: "object", properties: props, required: req, additionalProperties: false },
});

const OPERATORS = {
  renamedField(t, c, m, v) {
    const { field, to } = m;
    const props = Object.fromEntries(Object.entries(t.props).map(([k, s]) => [k === field ? to : k, s]));
    const args = Object.fromEntries(Object.entries(t.call(c)).map(([k, x]) => [k === field ? to : k, x]));
    return { schemas: [spec(t.name, t.desc, props, t.req.map((r) => (r === field ? to : r)), v)], ask: t.ask(c), expected: { name: t.name, arguments: args } };
  },
  newRequired(t, c, m, v) {
    return {
      schemas: [spec(t.name, t.desc, { ...t.props, [m.field]: m.schema }, [...t.req, m.field], v)],
      ask: `${t.ask(c)} New required field '${m.field}': set it to ${JSON.stringify(m.value)}.`, expected: { name: t.name, arguments: { ...t.call(c), [m.field]: m.value } },
    };
  },
  enumChange(t, c, m, v) {
    const props = { ...t.props, [m.field]: { ...t.props[m.field], enum: m.to } };
    const use = m.map[t.call(c)[m.field]];
    return { schemas: [spec(t.name, t.desc, props, t.req, v)], ask: t.ask(c, { [m.field]: use }), expected: { name: t.name, arguments: { ...t.call(c), [m.field]: use } } };
  },
  splitEndpoint(t, c, m, v) {
    const { field, children } = m;
    const schemas = Object.entries(children).map(([value, name]) => {
      const props = clone(t.props); delete props[field];
      return spec(name, `${t.desc} (${field}: ${value})`, props, t.req.filter((r) => r !== field), v);
    });
    const args = clone(t.call(c)); const chosen = args[field]; delete args[field];
    return { schemas, ask: t.ask(c), expected: { name: children[chosen], arguments: args } };
  },
  typeChange(t, c, m, v) {
    const value = typeof m.value === "function" ? m.value(c) : m.value;
    return { schemas: [spec(t.name, t.desc, { ...t.props, [m.field]: m.to }, t.req, v)], ask: t.ask(c), expected: { name: t.name, arguments: { ...t.call(c), [m.field]: value } } };
  },
};

function buildPrompt(schemas, version, ask) {
  return [
    `The tools below are the current interface. They were migrated to schema version ${version}; earlier versions used different names, fields, types, or endpoints. Follow the current schema exactly, even if you remember a different version.`,
    "", "CURRENT TOOLS:", JSON.stringify({ tools: schemas }, null, 2), "",
    "USER REQUEST:", ask, "",
    'Respond with a single JSON object and nothing else: {"name": "<tool name>", "arguments": { ... }}',
  ].join("\n");
}

function generate(seed, split) {
  const rng = mulberry32(seed);
  const prefix = split === "hidden" ? "smh" : "smu";
  const tasks = [];
  for (const [ti, t] of TOOLS.entries()) {
    for (const [ki, kind] of KINDS.entries()) {
      const ctx = t.vars(rng);
      const variants = t.ops[kind];
      const mutation = variants[Math.floor(rng() * variants.length)](ctx, rng);
      const major = Number(t.v.split(".")[0]) + 1;
      const v = `${major}.${Math.floor(rng() * 3)}.${Math.floor(rng() * 5)}`;
      const { schemas, ask, expected } = OPERATORS[kind](t, ctx, mutation, v);
      const stale = { name: t.name, arguments: t.call(ctx) };
      if (canon(expected) === canon(stale)) throw new Error(`${t.name}/${kind}: expected equals stale`);
      tasks.push({
        id: `${prefix}-${String(ti * 5 + ki + 1).padStart(2, "0")}`, kind: "single",
        prompt: buildPrompt(schemas, v, ask), expected: canon(expected),
        metadata: { seed, mutationKind: kind, tool: t.name, baseVersion: t.v, schemaVersion: v, stale: canon(stale) },
      });
    }
  }
  return tasks;
}

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const split = flag("--split") ?? "public";
if (!["public", "hidden"].includes(split)) throw new Error("--split must be public or hidden");
const seed = Number(flag("--seed") ?? (split === "hidden" ? NaN : PUBLIC_SEED));
if (!Number.isInteger(seed)) throw new Error("hidden split requires --seed <n>");
if (split === "hidden" && seed === PUBLIC_SEED) throw new Error("hidden split must not reuse the public seed");

const tasks = generate(seed, split);
const file = split === "hidden" ? "data/tasks-hidden.jsonl" : "data/tasks.jsonl";
await mkdir("data", { recursive: true });
await writeFile(file, tasks.map((task) => JSON.stringify(task)).join("\n") + "\n");
console.log(`wrote ${tasks.length} ${split} tasks to ${file}`);
