import { mkdir, writeFile } from "node:fs/promises";

const PUBLIC_SEED = 20261015;
const KINDS = ["renamedField", "newRequired", "enumChange", "splitEndpoint", "typeChange"];

const S = (d) => ({ type: "string", description: d });
const N = (d) => ({ type: "number", description: d });
const I = (d) => ({ type: "integer", description: d });
const A = (d) => ({ type: "array", items: { type: "string" }, description: d });
const E = (d, v) => ({ type: "string", enum: v, description: d });

// Base tool catalogue. `call` is the stale call: valid under the base schema.
// `ask` must mention every value in `call`; enumChange asks use `enumUp.ask`,
// which phrases the request with the NEW enum concept while `call` keeps the
// old nearest value, so a memorizer emits `call` and a schema-reader emits `use`.
const TOOLS = [
  {
    name: "issues.create", v: "3.2.0", desc: "Create an issue in a repository.",
    props: { repo: S("Repository as owner/name"), title: S("Issue title"), body: S("Markdown body"), labels: A("Label names"), kind: E("Issue kind", ["bug", "feature", "chore"]), visibility: E("Who can see it", ["public", "maintainers"]) },
    req: ["repo", "title", "kind", "visibility"],
    ask: "In acme/widgets open a feature issue titled 'Dark mode' with body 'Add a dark theme.', label ui, visible to maintainers.",
    call: { repo: "acme/widgets", title: "Dark mode", body: "Add a dark theme.", labels: ["ui"], kind: "feature", visibility: "maintainers" },
    rename: { field: "title", to: "subject" },
    addReq: { field: "severity", schema: E("Triage severity", ["low", "medium", "high"]), value: "high", phrase: "Set severity to high." },
    enumUp: { field: "kind", to: ["defect", "enhancement", "task"], use: "enhancement", ask: "In acme/widgets file an enhancement titled 'Dark mode' with body 'Add a dark theme.', label ui, visible to maintainers." },
    reType: { field: "labels", to: S("Comma-separated label names"), value: "ui" },
    split: { field: "visibility", children: { public: "issues.create_public", maintainers: "issues.create_team" } },
  },
  {
    name: "charges.create", v: "2.8.1", desc: "Create a payment charge.",
    props: { customer: S("Customer id"), amount: N("Amount in dollars"), currency: E("Settlement currency", ["usd", "eur", "gbp"]), capture: E("Capture mode", ["auto", "manual"]), description: S("Statement text") },
    req: ["customer", "amount", "currency", "capture"],
    ask: "Charge customer cus_4821 $45.50 USD for 'Order 991' with automatic capture.",
    call: { customer: "cus_4821", amount: 45.5, currency: "usd", capture: "auto", description: "Order 991" },
    rename: { field: "description", to: "memo" },
    addReq: { field: "idempotency_key", schema: S("Unique key to retry safely"), value: "req-5541", phrase: "Use idempotency key req-5541." },
    enumUp: { field: "currency", to: ["USD", "EUR", "GBP", "JPY"], use: "USD", ask: "Charge customer cus_4821 $45.50 in the USD currency for 'Order 991' with automatic capture." },
    reType: { field: "amount", to: I("Amount in cents"), value: 4550 },
    split: { field: "capture", children: { auto: "charges.create_capture", manual: "charges.authorize" } },
  },
  {
    name: "messages.post", v: "5.1.0", desc: "Post a message to a chat channel.",
    props: { channel: S("Channel name"), text: S("Message text"), attachments: A("Attachment URLs"), priority: E("Delivery priority", ["normal", "high", "urgent"]), audience: E("Who may read it", ["everyone", "admins"]) },
    req: ["channel", "text", "priority", "audience"],
    ask: "Post 'Deploy finished.' to #ops with attachment https://ci.example/build/9 at high priority for everyone.",
    call: { channel: "#ops", text: "Deploy finished.", attachments: ["https://ci.example/build/9"], priority: "high", audience: "everyone" },
    rename: { field: "text", to: "body" },
    addReq: { field: "team_id", schema: S("Workspace team id"), value: "T09ALPHA", phrase: "The workspace team id is T09ALPHA." },
    enumUp: { field: "priority", to: ["low", "elevated", "critical"], use: "elevated", ask: "Post 'Deploy finished.' to #ops with attachment https://ci.example/build/9 at elevated priority for everyone." },
    reType: { field: "attachments", to: S("Single attachment URL"), value: "https://ci.example/build/9" },
    split: { field: "audience", children: { everyone: "messages.post_channel", admins: "messages.post_admins" } },
  },
  {
    name: "events.create", v: "4.0.2", desc: "Create a calendar event.",
    props: { calendar_id: S("Calendar id"), title: S("Event title"), start: S("ISO 8601 start time"), duration_min: I("Length in minutes"), attendees: A("Attendee emails"), status: E("Event status", ["confirmed", "tentative", "cancelled"]), scope: E("Calendar scope", ["personal", "shared"]) },
    req: ["calendar_id", "title", "start", "status", "scope"],
    ask: "On calendar cal_main create 'Quarterly review' starting 2026-11-02T15:00:00Z lasting 45 minutes with attendees a@x.io and b@x.io, status tentative, on the shared calendar.",
    call: { calendar_id: "cal_main", title: "Quarterly review", start: "2026-11-02T15:00:00Z", duration_min: 45, attendees: ["a@x.io", "b@x.io"], status: "tentative", scope: "shared" },
    rename: { field: "title", to: "summary" },
    addReq: { field: "timezone", schema: S("IANA timezone"), value: "America/Toronto", phrase: "The timezone is America/Toronto." },
    enumUp: { field: "status", to: ["accepted", "maybe", "declined"], use: "maybe", ask: "On calendar cal_main create 'Quarterly review' starting 2026-11-02T15:00:00Z lasting 45 minutes with attendees a@x.io and b@x.io, status maybe, on the shared calendar." },
    reType: { field: "duration_min", to: S("ISO 8601 duration"), value: "PT45M" },
    split: { field: "scope", children: { personal: "events.create_personal", shared: "events.create_shared" } },
  },
  {
    name: "tickets.open", v: "2.4.0", desc: "Open a support ticket.",
    props: { requester: S("Requester email"), subject: S("Ticket subject"), comment: S("First comment"), tags: A("Tag names"), priority: E("Ticket priority", ["low", "normal", "high", "urgent"]), queue: E("Routing queue", ["support", "billing"]) },
    req: ["requester", "subject", "comment", "priority", "queue"],
    ask: "Open a billing ticket for sam@acme.io titled 'Invoice mismatch' saying 'Billed twice in October.', tag billing, priority high.",
    call: { requester: "sam@acme.io", subject: "Invoice mismatch", comment: "Billed twice in October.", tags: ["billing"], priority: "high", queue: "billing" },
    rename: { field: "subject", to: "title" },
    addReq: { field: "brand_id", schema: I("Brand to file under"), value: 7, phrase: "Route it to brand 7." },
    enumUp: { field: "priority", to: ["p3", "p2", "p1", "p0"], use: "p1", ask: "Open a billing ticket for sam@acme.io titled 'Invoice mismatch' saying 'Billed twice in October.', tag billing, priority p1." },
    reType: { field: "tags", to: S("Comma-separated tags"), value: "billing" },
    split: { field: "queue", children: { support: "tickets.open_support", billing: "tickets.open_billing" } },
  },
  {
    name: "emails.send", v: "3.0.0", desc: "Send a transactional email.",
    props: { to: S("Recipient address"), subject: S("Subject line"), body: S("Plain text body"), cc: A("CC addresses"), importance: E("Importance flag", ["normal", "high"]), audience: E("Recipient class", ["customer", "internal"]) },
    req: ["to", "subject", "body", "importance", "audience"],
    ask: "Email lee@acme.io subject 'Receipt #311' body 'Thanks for your order.', cc ops@acme.io, high importance, customer audience.",
    call: { to: "lee@acme.io", subject: "Receipt #311", body: "Thanks for your order.", cc: ["ops@acme.io"], importance: "high", audience: "customer" },
    rename: { field: "body", to: "html" },
    addReq: { field: "campaign_id", schema: S("Campaign tag"), value: "cmp-88", phrase: "Tag it to campaign cmp-88." },
    enumUp: { field: "importance", to: ["routine", "priority"], use: "priority", ask: "Email lee@acme.io subject 'Receipt #311' body 'Thanks for your order.', cc ops@acme.io, priority importance, customer audience." },
    reType: { field: "cc", to: S("Comma-separated CC addresses"), value: "ops@acme.io" },
    split: { field: "audience", children: { customer: "emails.send_customer", internal: "emails.send_internal" } },
  },
  {
    name: "objects.upload", v: "6.1.3", desc: "Upload an object to a storage bucket.",
    props: { bucket: S("Bucket name"), key: S("Object key"), content_type: S("MIME type"), tags: A("Object tags"), storage: E("Storage class", ["standard", "infrequent", "archive"]), acl: E("Access policy", ["private", "public"]) },
    req: ["bucket", "key", "content_type", "storage", "acl"],
    ask: "Upload img/hero.png (image/png) to bucket assets-prod, tags web and hero, standard storage, private acl.",
    call: { bucket: "assets-prod", key: "img/hero.png", content_type: "image/png", tags: ["web", "hero"], storage: "standard", acl: "private" },
    rename: { field: "key", to: "path" },
    addReq: { field: "checksum", schema: S("Content checksum"), value: "sha256:9f2c", phrase: "Declare checksum sha256:9f2c." },
    enumUp: { field: "storage", to: ["hot", "cool", "cold"], use: "cool", ask: "Upload img/hero.png (image/png) to bucket assets-prod, tags web and hero, cool storage, private acl." },
    reType: { field: "tags", to: S("Comma-separated tags"), value: "web,hero" },
    split: { field: "acl", children: { private: "objects.upload_private", public: "objects.upload_public" } },
  },
  {
    name: "search.query", v: "1.9.0", desc: "Run a keyword search.",
    props: { q: S("Query text"), limit: I("Max results"), filters: A("Filter expressions"), index: E("Index to search", ["docs", "code", "issues"]), scope: E("Result scope", ["org", "user"]) },
    req: ["q", "limit", "index", "scope"],
    ask: "Search org-wide docs index for 'refund policy', limit 20, filter country:ca.",
    call: { q: "refund policy", limit: 20, filters: ["country:ca"], index: "docs", scope: "org" },
    rename: { field: "q", to: "query" },
    addReq: { field: "locale", schema: S("Result locale"), value: "en-CA", phrase: "Use locale en-CA." },
    enumUp: { field: "index", to: ["documentation", "source", "tickets"], use: "documentation", ask: "Search org-wide documentation index for 'refund policy', limit 20, filter country:ca." },
    reType: { field: "filters", to: S("Comma-separated filters"), value: "country:ca" },
    split: { field: "scope", children: { org: "search.query_org", user: "search.query_user" } },
  },
  {
    name: "sms.send", v: "7.3.1", desc: "Send a text message.",
    props: { to: S("Recipient number"), from: S("Sender number"), body: S("Message body"), media: A("Media URLs"), priority: E("Send priority", ["standard", "express"]), channel: E("Bearer channel", ["sms", "mms"]) },
    req: ["to", "from", "body", "priority", "channel"],
    ask: "Text +14165550100 from +14165550199 saying 'Your code is 4110.' with media https://img.example/x.png, express priority over sms.",
    call: { to: "+14165550100", from: "+14165550199", body: "Your code is 4110.", media: ["https://img.example/x.png"], priority: "express", channel: "sms" },
    rename: { field: "body", to: "message" },
    addReq: { field: "app_id", schema: S("Sending application id"), value: "app-221", phrase: "Send under app id app-221." },
    enumUp: { field: "priority", to: ["economy", "flash"], use: "flash", ask: "Text +14165550100 from +14165550199 saying 'Your code is 4110.' with media https://img.example/x.png, flash priority over sms." },
    reType: { field: "media", to: S("Single media URL"), value: "https://img.example/x.png" },
    split: { field: "channel", children: { sms: "sms.send_text", mms: "sms.send_media" } },
  },
  {
    name: "deploys.trigger", v: "2.2.0", desc: "Trigger a deployment.",
    props: { service: S("Service name"), ref: S("Git ref or tag"), replicas: I("Replica count"), notify: A("Notification channels"), env: E("Target environment", ["staging", "production"]), strategy: E("Rollout strategy", ["rolling", "bluegreen"]) },
    req: ["service", "ref", "replicas", "env", "strategy"],
    ask: "Deploy api-gateway ref v2.14.0 with 3 replicas to production using a rolling strategy; notify #deploys.",
    call: { service: "api-gateway", ref: "v2.14.0", replicas: 3, notify: ["#deploys"], env: "production", strategy: "rolling" },
    rename: { field: "ref", to: "revision" },
    addReq: { field: "ticket", schema: S("Change ticket id"), value: "CHG-1024", phrase: "Reference change ticket CHG-1024." },
    enumUp: { field: "env", to: ["stage", "prod"], use: "prod", ask: "Deploy api-gateway ref v2.14.0 with 3 replicas to prod using a rolling strategy; notify #deploys." },
    reType: { field: "replicas", to: S("Replica count as a string"), value: "3" },
    split: { field: "strategy", children: { rolling: "deploys.trigger_rolling", bluegreen: "deploys.trigger_canary" } },
  },
  {
    name: "contacts.update", v: "4.4.0", desc: "Update a CRM contact.",
    props: { contact_id: S("Contact id"), email: S("Email address"), phone: S("Phone number"), tags: A("Contact tags"), stage: E("Pipeline stage", ["lead", "prospect", "customer"]), owner: E("Owning team", ["sales", "support"]) },
    req: ["contact_id", "email", "stage", "owner"],
    ask: "Update contact ct-904: email jae@foo.dev, phone +14165550011, tag vip, stage prospect, owner sales.",
    call: { contact_id: "ct-904", email: "jae@foo.dev", phone: "+14165550011", tags: ["vip"], stage: "prospect", owner: "sales" },
    rename: { field: "phone", to: "phone_number" },
    addReq: { field: "source", schema: S("Attribution source"), value: "webinar-oct", phrase: "Set source to webinar-oct." },
    enumUp: { field: "stage", to: ["new", "qualified", "won"], use: "qualified", ask: "Update contact ct-904: email jae@foo.dev, phone +14165550011, tag vip, stage qualified, owner sales." },
    reType: { field: "tags", to: S("Comma-separated tags"), value: "vip" },
    split: { field: "owner", children: { sales: "contacts.update_sales", support: "contacts.update_support" } },
  },
  {
    name: "payments.refund", v: "1.5.2", desc: "Refund a captured payment.",
    props: { payment_id: S("Payment id"), amount: N("Amount in dollars"), reason: E("Refund reason", ["duplicate", "fraud", "requested"]), method: E("Refund destination", ["card", "balance"]) },
    req: ["payment_id", "amount", "reason", "method"],
    ask: "Refund payment pay_7712 for $19.99, reason duplicate, back to card.",
    call: { payment_id: "pay_7712", amount: 19.99, reason: "duplicate", method: "card" },
    rename: { field: "payment_id", to: "transaction_id" },
    addReq: { field: "note", schema: S("Refund note"), value: "double charge", phrase: "Attach note 'double charge'." },
    enumUp: { field: "reason", to: ["accidental", "suspected_fraud", "customer_request"], use: "customer_request", ask: "Refund payment pay_7712 for $19.99, reason customer_request, back to card." },
    reType: { field: "amount", to: I("Amount in cents"), value: 1999 },
    split: { field: "method", children: { card: "payments.refund_card", balance: "payments.refund_balance" } },
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
  renamedField(t, v) {
    const { field, to } = t.rename;
    const props = Object.fromEntries(Object.entries(t.props).map(([k, s]) => [k === field ? to : k, s]));
    const args = Object.fromEntries(Object.entries(t.call).map(([k, x]) => [k === field ? to : k, x]));
    return { schemas: [spec(t.name, t.desc, props, t.req.map((r) => (r === field ? to : r)), v)], ask: t.ask, expected: { name: t.name, arguments: args } };
  },
  newRequired(t, v) {
    const { field, schema, value, phrase } = t.addReq;
    return {
      schemas: [spec(t.name, t.desc, { ...t.props, [field]: schema }, [...t.req, field], v)],
      ask: `${t.ask} ${phrase}`, expected: { name: t.name, arguments: { ...t.call, [field]: value } },
    };
  },
  enumChange(t, v) {
    const { field, to, use, ask } = t.enumUp;
    const props = { ...t.props, [field]: { ...t.props[field], enum: to } };
    return { schemas: [spec(t.name, t.desc, props, t.req, v)], ask, expected: { name: t.name, arguments: { ...t.call, [field]: use } } };
  },
  splitEndpoint(t, v) {
    const { field, children } = t.split;
    const schemas = Object.entries(children).map(([value, name]) => {
      const props = clone(t.props); delete props[field];
      return spec(name, `${t.desc} (${field}: ${value})`, props, t.req.filter((r) => r !== field), v);
    });
    const args = clone(t.call); const pick = args[field]; delete args[field];
    return { schemas, ask: t.ask, expected: { name: children[pick], arguments: args } };
  },
  typeChange(t, v) {
    const { field, to, value } = t.reType;
    return { schemas: [spec(t.name, t.desc, { ...t.props, [field]: to }, t.req, v)], ask: t.ask, expected: { name: t.name, arguments: { ...t.call, [field]: value } } };
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
      const major = Number(t.v.split(".")[0]) + 1;
      const v = `${major}.${Math.floor(rng() * 3)}.${Math.floor(rng() * 5)}`;
      const { schemas, ask, expected } = OPERATORS[kind](t, v);
      const stale = { name: t.name, arguments: t.call };
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
await writeFile(file, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks (seed ${seed}) -> ${file}`);
