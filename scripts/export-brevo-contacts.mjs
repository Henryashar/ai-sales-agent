import fs from "node:fs";
import path from "node:path";
import { Client } from "@notionhq/client";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const outDir = path.join(root, "exports");
const outPath = path.join(outDir, "brevo-contacts.csv");
const reportPath = path.join(outDir, "brevo-contacts-report.json");

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function pageIdFromDatabaseId(value) {
  return value.replace(/^collection:\/\//, "");
}

function textValue(prop) {
  if (!prop) return "";
  if (prop.type === "title") return prop.title.map((part) => part.plain_text).join("").trim();
  if (prop.type === "rich_text") return prop.rich_text.map((part) => part.plain_text).join("").trim();
  if (prop.type === "email") return prop.email?.trim() ?? "";
  if (prop.type === "phone_number") return prop.phone_number?.trim() ?? "";
  if (prop.type === "url") return prop.url?.trim() ?? "";
  if (prop.type === "select") return prop.select?.name ?? "";
  if (prop.type === "multi_select") return prop.multi_select.map((item) => item.name).join("|");
  return "";
}

function csvCell(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function splitName(contactName, firmName) {
  const name = (contactName || "").replace(/\s+/g, " ").trim();
  if (!name) return { first: "", last: firmName || "" };

  const cleaned = name.replace(/,\s*(EA|CPA|MBA|JD|Esq\.?)$/i, "").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return {
    first: parts[0],
    last: parts.slice(1).join(" "),
  };
}

function normalizeUsPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return "";
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

async function fetchAllRows(notion, databaseId) {
  const rows = [];
  let start_cursor;

  do {
    const response = await notion.dataSources.query({
      data_source_id: databaseId,
      page_size: 100,
      start_cursor,
    });
    rows.push(...response.results);
    start_cursor = response.has_more ? response.next_cursor : undefined;
  } while (start_cursor);

  return rows;
}

loadEnv(envPath);

const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
const databaseId = pageIdFromDatabaseId(
  process.env.NOTION_LEADS_DATABASE_ID ??
    process.env.NOTION_DATA_SOURCE_ID ??
    "9ef9d607-7468-416b-8253-947c316565ff",
);

if (!notionToken) {
  throw new Error("Missing NOTION_TOKEN or NOTION_API_KEY in .env.local");
}

const notion = new Client({ auth: notionToken });
const pages = await fetchAllRows(notion, databaseId);
const byIdentifier = new Map();
const skipped = [];
const duplicatesRemoved = [];

for (const page of pages) {
  const props = page.properties;
  const firmName = textValue(props["Firm Name"]);
  const contactName = textValue(props["Contact Name"]);
  const email = normalizeEmail(textValue(props.Email));
  const phone = normalizeUsPhone(textValue(props.Phone));
  const source = textValue(props.Source);
  const status = textValue(props.Status);
  const languages = textValue(props["Languages Spoken"]);

  const identifier = email ? `email:${email}` : phone ? `phone:${phone}` : "";

  if (!identifier) {
    skipped.push({
      reason: "missing_identifier",
      firmName,
      contactName,
      phone: textValue(props.Phone),
      notionUrl: page.url,
    });
    continue;
  }

  const { first, last } = splitName(contactName, firmName);
  const interests = ["NILA Sales Pipeline", source, status, ...languages.split("|")]
    .map((item) => item.trim())
    .filter(Boolean);

  const row = {
    "CONTACT ID": "",
    EMAIL: email,
    FIRSTNAME: first,
    LASTNAME: last,
    SMS: phone,
    LANDLINE_NUMBER: phone,
    WHATSAPP: "",
    INTERESTS: `[${interests.map((item) => `'${item.replace(/'/g, "''")}'`).join("|")}]`,
    _source: {
      firmName,
      contactName,
      notionUrl: page.url,
    },
  };

  if (byIdentifier.has(identifier)) {
    duplicatesRemoved.push({
      identifier,
      kept: byIdentifier.get(identifier)._source,
      skipped: row._source,
    });
    continue;
  }

  byIdentifier.set(identifier, row);
}

const headers = [
  "CONTACT ID",
  "EMAIL",
  "FIRSTNAME",
  "LASTNAME",
  "SMS",
  "LANDLINE_NUMBER",
  "WHATSAPP",
  "INTERESTS",
];

const rows = [...byIdentifier.values()].sort((a, b) => {
  const aKey = a.EMAIL || a.SMS;
  const bKey = b.EMAIL || b.SMS;
  return aKey.localeCompare(bKey);
});
const csv = [headers.map(csvCell).join(",")]
  .concat(rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")))
  .join("\r\n");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, `${csv}\r\n`, "utf8");
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      notionRowsRead: pages.length,
      exportedContacts: rows.length,
      skippedWithoutEmailOrPhone: skipped.length,
      duplicatesRemovedCount: duplicatesRemoved.length,
      skipped,
      duplicateRows: duplicatesRemoved,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(
  JSON.stringify(
    {
      outPath,
      reportPath,
      notionRowsRead: pages.length,
      exportedContacts: rows.length,
      skippedWithoutEmailOrPhone: skipped.length,
      duplicatesRemovedCount: duplicatesRemoved.length,
    },
    null,
    2,
  ),
);
