#!/usr/bin/env python3
"""Enrich Canopy community contacts and push the results into Notion."""

from __future__ import annotations

import csv
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv('.env.local')

BASE_DIR = Path(__file__).resolve().parent
INPUT_CSV = BASE_DIR / "input" / "canopy_enriched_contacts.csv"
OUTPUT_CSV = BASE_DIR / "output" / "canopy_results.csv"

NOTION_API_KEY = os.getenv("NOTION_API_KEY")
NOTION_DATABASE_ID = os.getenv("NOTION_DATA_SOURCE_ID")
if not NOTION_DATABASE_ID:
    NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY")
SEARCH_API_KEY = os.getenv("SEARCH_API_KEY")

GOOGLE_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"
NOTION_PAGES_URL = "https://api.notion.com/v1/pages"

EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}")
NAME_PATTERN = re.compile(r"\b[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}\b")

NOTION_VERSION = "2022-06-28"
REQUEST_TIMEOUT_SECONDS = 12
TAVILY_TIMEOUT_SECONDS = 6
PAGE_FETCH_TIMEOUT_SECONDS = 8
MAX_PAGE_BYTES = 1_500_000

OUTPUT_COLUMNS = [
    "company",
    "city",
    "state",
    "full_name",
    "name_confidence",
    "phone",
    "phone_confidence",
    "email",
    "email_confidence",
    "website",
    "notion_page_url",
    "status",
    "error",
]

GENERIC_COMPANY_TOKENS = {
    "a",
    "and",
    "associates",
    "cpa",
    "cpas",
    "co",
    "company",
    "corp",
    "corporation",
    "ftc",
    "group",
    "inc",
    "llc",
    "ltd",
    "pllc",
    "services",
    "service",
    "tax",
    "the",
}

BLOCKED_EMAIL_PARTS = {
    "example.com",
    "domain.com",
    "email.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "sentry.io",
}

BAD_NAME_WORDS = {
    "accounting",
    "advisors",
    "associates",
    "canopy",
    "contact",
    "email",
    "enrolled",
    "facebook",
    "financial",
    "firm",
    "google",
    "group",
    "home",
    "linkedin",
    "manager",
    "office",
    "privacy",
    "service",
    "services",
    "support",
    "tax",
}

SPECIAL_NAME_CANDIDATES = {
    "kherrera": "Kathleen Herrera",
    "lctrevino": "Loryanna Trevino",
    "madi_hensley": "Madi Hensley",
}

SPECIAL_NAME_QUERIES = {
    "kherrera": ['"Kathleen Herrera" "Kathleen J. Herrera CPA LLC" Omaha'],
    "lctrevino": ['"Loryanna Trevino" "Monte R. Barnes FTC Inc"'],
    "madi_hensley": ['"Madi Hensley" "Riley & Associates" Otsego'],
    "agautreau": ['"Ledoux Hankins CPAs" "Baton Rouge" office manager'],
    "sergeih": ['"Schaaf CPA" "Westfield" ops manager'],
    "davem": ['"enrolled agent" "SF Peninsula" OR "San Mateo" OR "Palo Alto" "MT Tax"'],
}


@dataclass
class PlaceLookup:
    phone: str = ""
    website: str = ""
    formatted_address: str = ""
    place_name: str = ""
    low_confidence: bool = False
    error: str = ""


@dataclass
class EnrichedContact:
    full_name: str
    job_title: str
    company: str
    city: str
    state: str
    phone: str
    email: str
    website: str
    name_confidence: str
    email_confidence: str
    phone_confidence: str
    notes: list[str] = field(default_factory=list)


def main() -> None:
    require_env()

    rows = read_input_rows()
    results: list[dict[str, str]] = []
    skipped_count = 0
    pushed_count = 0
    error_count = 0
    full_enrichment_count = 0
    partial_enrichment_count = 0
    no_enrichment_count = 0

    for index, row in enumerate(rows, start=1):
        company = clean(row.get("company"))
        city = clean(row.get("city"))
        state = clean(row.get("state"))
        confidence = clean(row.get("confidence")).upper()

        if not company or confidence == "NOT_FOUND":
            skipped_count += 1
            results.append(
                output_row(
                    company=company,
                    city=city,
                    state=state,
                    status="skipped",
                    error="company blank or confidence NOT_FOUND",
                )
            )
            continue

        print(f"[{index}/{len(rows)}] Enriching {company} ({city}, {state})")
        try:
            contact = enrich_contact(row)
            notion_page_url = push_to_notion(contact)
            pushed_count += 1

            level = enrichment_level(contact)
            if level == "full":
                full_enrichment_count += 1
            elif level == "partial":
                partial_enrichment_count += 1
            else:
                no_enrichment_count += 1

            results.append(
                output_row(
                    company=contact.company,
                    city=contact.city,
                    state=contact.state,
                    full_name=contact.full_name,
                    name_confidence=contact.name_confidence,
                    phone=contact.phone,
                    phone_confidence=contact.phone_confidence,
                    email=contact.email,
                    email_confidence=contact.email_confidence,
                    website=contact.website,
                    notion_page_url=notion_page_url,
                    status="pushed",
                )
            )
        except Exception as exc:
            error_count += 1
            results.append(
                output_row(
                    company=company,
                    city=city,
                    state=state,
                    status="error",
                    error=str(exc),
                )
            )
        finally:
            time.sleep(1)

    write_output_rows(results)

    print(f"Total contacts: {len(rows)}")
    print(f"Skipped (no company or NOT_FOUND): {skipped_count}")
    print(f"Pushed to Notion: {pushed_count}")
    print(f"  - Full enrichment (name + email + phone): {full_enrichment_count}")
    print(f"  - Partial enrichment: {partial_enrichment_count}")
    print(f"  - No enrichment found (pushed with blanks): {no_enrichment_count}")
    print(f"Errors: {error_count}")
    print(f"Results written to {OUTPUT_CSV.relative_to(BASE_DIR).as_posix()}")


def require_env() -> None:
    missing = [
        name
        for name, value in [
            ("NOTION_API_KEY", NOTION_API_KEY),
            ("NOTION_DATA_SOURCE_ID", NOTION_DATABASE_ID),
            ("GOOGLE_PLACES_API_KEY", GOOGLE_PLACES_API_KEY),
            ("SEARCH_API_KEY", SEARCH_API_KEY),
        ]
        if not value
    ]

    if missing:
        raise RuntimeError(f"Missing required environment values in .env.local: {', '.join(missing)}")


def read_input_rows() -> list[dict[str, str]]:
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_output_rows(rows: list[dict[str, str]]) -> None:
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def enrich_contact(row: dict[str, str]) -> EnrichedContact:
    company = clean(row.get("company"))
    city = clean(row.get("city"))
    state = clean(row.get("state"))
    job_title = clean(row.get("job_title"))
    notes = clean(row.get("notes"))

    place = google_places_lookup(company, city, state)
    website = normalize_url(place.website or clean(row.get("website")))

    full_name, name_confidence, name_note = resolve_full_name(row)
    phone = clean(row.get("phone")) or place.phone
    phone_confidence = "confirmed" if phone else "not_found"
    email = clean(row.get("email"))
    email_confidence = "confirmed" if email else "not_found"

    contact_notes: list[str] = []
    if name_note:
        contact_notes.append(name_note)
    if place.low_confidence:
        contact_notes.append(f"Google Places result discarded as low confidence: {place.place_name}")
    if place.error:
        contact_notes.append(f"Google Places lookup issue: {place.error}")

    email_result = find_email(company, city, full_name, website)
    if email_result["email"]:
        email = email_result["email"]
        email_confidence = email_result["confidence"]
        contact_notes.extend(email_result["notes"])
        if email_result["website"] and not website:
            website = email_result["website"]

    if website:
        page_contact = crawl_website_contact_pages(website)
        if page_contact["email"]:
            email = page_contact["email"]
            email_confidence = "confirmed"
        if page_contact["phone"] and not phone:
            phone = page_contact["phone"]
            phone_confidence = "confirmed"
        contact_notes.extend(page_contact["notes"])

    if email_confidence == "not_found" and website:
        inferred_email = infer_email(full_name, website)
        if inferred_email:
            email = inferred_email
            email_confidence = "inferred"
            contact_notes.append("Email inferred from website domain pattern.")

    if notes:
        contact_notes.append(f"Canopy notes: {notes}")

    return EnrichedContact(
        full_name=full_name,
        job_title=job_title,
        company=company,
        city=city,
        state=state,
        phone=phone,
        email=email,
        website=website,
        name_confidence=name_confidence,
        email_confidence=email_confidence,
        phone_confidence=phone_confidence,
        notes=contact_notes,
    )


def google_places_lookup(company: str, city: str, state: str) -> PlaceLookup:
    if not GOOGLE_PLACES_API_KEY:
        return PlaceLookup(error="GOOGLE_PLACES_API_KEY not set")

    data = request_json(
        "GET",
        GOOGLE_TEXT_SEARCH_URL,
        params={
            "query": " ".join(part for part in [company, city, state] if part),
            "key": GOOGLE_PLACES_API_KEY,
        },
        fail_silently=True,
    )
    if not data:
        return PlaceLookup(error="empty Google Places Text Search response")

    results = data.get("results") or []
    if not results:
        return PlaceLookup(error=f"Text Search status {data.get('status', 'ZERO_RESULTS')}")

    first = results[0]
    place_name = clean(first.get("name"))
    if not loosely_matches_company(company, place_name):
        return PlaceLookup(place_name=place_name, low_confidence=True)

    place_id = clean(first.get("place_id"))
    details: dict[str, Any] = {}
    if place_id:
        details_payload = request_json(
            "GET",
            GOOGLE_PLACE_DETAILS_URL,
            params={
                "place_id": place_id,
                "fields": "name,formatted_phone_number,website,formatted_address",
                "key": GOOGLE_PLACES_API_KEY,
            },
            fail_silently=True,
        )
        details = details_payload.get("result", {}) if details_payload else {}

    return PlaceLookup(
        phone=clean(details.get("formatted_phone_number") or first.get("formatted_phone_number")),
        website=normalize_url(clean(details.get("website") or first.get("website"))),
        formatted_address=clean(details.get("formatted_address") or first.get("formatted_address")),
        place_name=clean(details.get("name") or place_name),
    )


def resolve_full_name(row: dict[str, str]) -> tuple[str, str, str]:
    existing_name = clean(row.get("full_name"))
    if existing_name:
        return existing_name, "confirmed", "Name provided by source CSV."

    username = clean(row.get("username"))
    username_key = username.lower()
    company = clean(row.get("company"))
    city = clean(row.get("city"))
    job_title = clean(row.get("job_title"))
    inferred_candidate = SPECIAL_NAME_CANDIDATES.get(username_key)
    inferred_note = ""

    if not inferred_candidate:
        inferred_candidate = name_hint_from_notes(row) or name_hint_from_username(username)
    if inferred_candidate:
        inferred_note = f"Name inferred from username or notes: {inferred_candidate}."

    queries = [f'"{company}" "{city}" "{job_title}"']
    queries.extend(SPECIAL_NAME_QUERIES.get(username_key, []))

    for query in queries:
        results = tavily_search(query)
        candidate = extract_person_name(results, company, job_title)
        if candidate:
            return candidate, "confirmed", f"Name found in public search snippets for query: {query}"

    if inferred_candidate:
        return inferred_candidate, "inferred", inferred_note

    return "", "not_found", "Name not found."


def find_email(company: str, city: str, full_name: str, website: str) -> dict[str, Any]:
    notes: list[str] = []
    query = f'"{company}" "{city}" email contact'
    results = tavily_search(query)
    snippet_emails = clean_emails(
        email
        for result in results
        for email in EMAIL_PATTERN.findall(" ".join([result.get("title", ""), result.get("content", ""), result.get("url", "")]))
    )
    best_snippet_email = choose_best_email(snippet_emails, website, company)
    if best_snippet_email:
        return {
            "email": best_snippet_email,
            "confidence": "confirmed",
            "website": "",
            "notes": [f"Email found in Tavily snippets for query: {query}"],
        }

    candidate_websites = [website] if website else build_domain_guesses(company)
    for candidate_website in candidate_websites:
        page = fetch_html(candidate_website, fail_silently=True)
        if not page:
            continue
        emails = clean_emails(extract_emails_from_html(page["body"]))
        best_page_email = choose_best_email(emails, candidate_website, company)
        if best_page_email:
            notes.append(f"Email found on website homepage: {candidate_website}")
            return {
                "email": best_page_email,
                "confidence": "confirmed",
                "website": normalize_url(candidate_website) if website else "",
                "notes": notes,
            }

    inferred = infer_email(full_name, website)
    if inferred:
        return {
            "email": inferred,
            "confidence": "inferred",
            "website": "",
            "notes": ["Email inferred from website domain pattern."],
        }

    return {"email": "", "confidence": "not_found", "website": "", "notes": notes}


def crawl_website_contact_pages(website: str) -> dict[str, Any]:
    origin = url_origin(website)
    if not origin:
        return {"email": "", "phone": "", "notes": []}

    notes: list[str] = []
    best_email = ""
    best_phone = ""
    for path in ["/contact", "/about"]:
        time.sleep(1)
        url = urllib.parse.urljoin(origin, path)
        page = fetch_html(url, fail_silently=True)
        if not page:
            continue

        emails = clean_emails(extract_emails_from_html(page["body"]))
        phones = clean_phones(PHONE_PATTERN.findall(html_to_text(page["body"])))
        if emails and not best_email:
            best_email = choose_best_email(emails, website, "") or emails[0]
            notes.append(f"Email found on {url}")
        if phones and not best_phone:
            best_phone = phones[0]
            notes.append(f"Phone found on {url}")
        if best_email and best_phone:
            break

    return {"email": best_email, "phone": best_phone, "notes": notes}


def tavily_search(query: str) -> list[dict[str, str]]:
    if not SEARCH_API_KEY:
        return []

    payload = {
        "query": query,
        "search_depth": "basic",
        "max_results": 5,
        "include_answer": False,
        "include_raw_content": False,
    }
    data = request_json(
        "POST",
        TAVILY_SEARCH_URL,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SEARCH_API_KEY}",
        },
        payload=payload,
        timeout=TAVILY_TIMEOUT_SECONDS,
        fail_silently=True,
    )
    if not data:
        return []

    deduped: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for result in data.get("results") or []:
        title = clean(result.get("title"))
        url = clean(result.get("url"))
        content = clean(result.get("content"))
        if not title or not url:
            continue
        url_key = url.rstrip("/")
        if url_key in seen_urls:
            continue
        seen_urls.add(url_key)
        deduped.append({"title": title, "url": url, "content": content})

    return deduped


def extract_person_name(results: list[dict[str, str]], company: str, job_title: str) -> str:
    for result in results:
        candidate = extract_linkedin_name(result)
        if candidate and is_plausible_person_name(candidate, company):
            return candidate

        text = " ".join([result.get("title", ""), result.get("content", "")])
        candidates = []
        candidates.extend(names_near_job_title(text, job_title))
        candidates.extend(names_from_contact_patterns(text))

        for candidate in candidates:
            if is_plausible_person_name(candidate, company):
                return candidate

    return ""


def extract_linkedin_name(result: dict[str, str]) -> str:
    title = result.get("title", "")
    url = result.get("url", "")
    if "linkedin.com/in/" not in url.lower() and "linkedin" not in title.lower():
        return ""

    first_title_segment = re.split(r"\s[-|]\s|\|", title)[0].strip()
    if is_name_like(first_title_segment):
        return normalize_person_name(first_title_segment)

    match = re.search(r"linkedin\.com/in/([^/?#]+)", url, re.IGNORECASE)
    if not match:
        return ""

    slug = urllib.parse.unquote(match.group(1))
    slug = re.sub(r"[-_]+", " ", slug)
    slug = re.sub(r"\b\d+\b", "", slug).strip()
    if is_name_like(slug):
        return normalize_person_name(slug)

    return ""


def names_near_job_title(text: str, job_title: str) -> list[str]:
    if not job_title:
        return []

    escaped_title = re.escape(job_title)
    patterns = [
        rf"({NAME_PATTERN.pattern})\s+(?:is\s+)?(?:the\s+)?{escaped_title}\b",
        rf"({NAME_PATTERN.pattern})\s*[-,:|]\s*{escaped_title}\b",
        rf"{escaped_title}\s*[-,:|]\s*({NAME_PATTERN.pattern})",
    ]
    return [normalize_person_name(match) for pattern in patterns for match in re.findall(pattern, text, re.IGNORECASE)]


def names_from_contact_patterns(text: str) -> list[str]:
    patterns = [
        rf"Contact(?:\s+Name)?\s*[:\-]\s*({NAME_PATTERN.pattern})",
        rf"Owner\s*[:\-]\s*({NAME_PATTERN.pattern})",
        rf"Partner\s*[:\-]\s*({NAME_PATTERN.pattern})",
        rf"Manager\s*[:\-]\s*({NAME_PATTERN.pattern})",
    ]
    return [normalize_person_name(match) for pattern in patterns for match in re.findall(pattern, text)]


def name_hint_from_notes(row: dict[str, str]) -> str:
    notes = clean(row.get("notes"))
    username = clean(row.get("username"))
    username_last = last_name_hint_from_username(username)

    for pattern in [
        r"Signature is ([A-Z][A-Za-z'.-]+)",
        r"Username suggests ([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)?)",
        r"Partial name(?: only)? ([A-Z][A-Za-z'.-]+)",
    ]:
        match = re.search(pattern, notes)
        if match:
            name = normalize_person_name(match.group(1))
            if len(name.split()) == 1 and username_last:
                name = f"{name} {username_last}"
            return name

    return ""


def name_hint_from_username(username: str) -> str:
    raw = clean(username)
    if not raw or raw.lower().startswith("user"):
        return ""

    cleaned = re.sub(r"\d+", "", raw).strip("_ -")
    if not cleaned:
        return ""

    if "_" in cleaned:
        parts = [part for part in re.split(r"_+", cleaned) if part]
        if len(parts) >= 2:
            return normalize_person_name(" ".join(parts))

    if " " in cleaned:
        return normalize_person_name(cleaned)

    if cleaned.islower() and len(cleaned) > 4:
        match = re.match(r"^([a-z])([a-z]{4,})$", cleaned)
        if match:
            return normalize_person_name(f"{match.group(1)} {match.group(2)}")
        return normalize_person_name(cleaned)

    parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)", cleaned)
    parts = [
        part
        for part in parts
        if part.lower() not in {"cpa", "cpas", "llc", "htc"} and not part.lower().endswith(("cpa", "cpas"))
    ]
    if parts:
        return normalize_person_name(" ".join(parts))

    return ""


def last_name_hint_from_username(username: str) -> str:
    cleaned = re.sub(r"\d+", "", clean(username)).strip("_ -")
    if "_" in cleaned:
        parts = [part for part in cleaned.split("_") if part]
        if len(parts) > 1:
            return normalize_person_name(parts[-1])

    camel_parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)", cleaned)
    if len(camel_parts) > 1:
        return normalize_person_name(camel_parts[-1])

    if cleaned.islower() and len(cleaned) > 4:
        return normalize_person_name(cleaned[1:])

    return ""


def infer_email(full_name: str, website: str) -> str:
    domain = domain_from_url(website)
    if not domain:
        return ""

    patterns: list[str] = []
    name_parts = [part for part in re.split(r"\s+", normalize_person_name(full_name).lower()) if part]
    if name_parts:
        first_name = clean_name_token(name_parts[0])
        if first_name:
            patterns.append(f"{first_name}@{domain}")
        if len(name_parts) >= 2:
            last_name = clean_name_token(name_parts[-1])
            if first_name and last_name:
                patterns.append(f"{first_name[0]}{last_name}@{domain}")

    patterns.extend([f"info@{domain}", f"contact@{domain}"])
    return next((email for email in patterns if email), "")


def push_to_notion(contact: EnrichedContact) -> str:
    properties: dict[str, Any] = {
        "Firm Name": title_property(contact.company),
        "Contact Name": rich_text_property(contact.full_name if contact.name_confidence == "confirmed" else ""),
        "City": rich_text_property(contact.city),
        "State": select_property(contact.state),
        "Source": select_property("Canopy Community"),
        "Status": select_property("Cold List"),
        "Call Notes": rich_text_property(build_call_notes(contact)),
    }

    if contact.phone and contact.phone_confidence == "confirmed":
        properties["Phone"] = {"type": "phone_number", "phone_number": contact.phone}
    if contact.email and contact.email_confidence == "confirmed":
        properties["Email"] = {"type": "email", "email": contact.email}
    if contact.website:
        properties["Website"] = {"type": "url", "url": contact.website}

    parent_id = normalize_notion_id(NOTION_DATABASE_ID or "")
    payload = {"parent": {"database_id": parent_id}, "properties": properties}

    try:
        response = notion_post_page(payload)
    except RuntimeError as first_error:
        fallback_payload = {"parent": {"type": "data_source_id", "data_source_id": parent_id}, "properties": properties}
        try:
            response = notion_post_page(fallback_payload)
        except RuntimeError:
            raise first_error

    return clean(response.get("url"))


def notion_post_page(payload: dict[str, Any]) -> dict[str, Any]:
    return request_json(
        "POST",
        NOTION_PAGES_URL,
        headers={
            "Authorization": f"Bearer {NOTION_API_KEY}",
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION,
        },
        payload=payload,
        fail_silently=False,
    )


def request_json(
    method: str,
    url: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
    fail_silently: bool,
) -> dict[str, Any]:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        if fail_silently:
            return {}
        raise RuntimeError(f"{method} {url} failed with {exc.code}: {truncate(error_body)}") from exc
    except Exception as exc:
        if fail_silently:
            return {}
        raise RuntimeError(f"{method} {url} failed: {exc}") from exc


def fetch_html(url: str, *, fail_silently: bool) -> dict[str, str]:
    normalized = normalize_url(url)
    if not normalized:
        return {}

    request = urllib.request.Request(
        normalized,
        headers={
            "User-Agent": "Mozilla/5.0 Canopy contact enrichment lookup",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=PAGE_FETCH_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", 200)
            content_type = response.headers.get("content-type", "")
            if status != 200 or "text/html" not in content_type.lower():
                return {}
            body = response.read(MAX_PAGE_BYTES).decode(read_charset(content_type), errors="replace")
            return {"url": response.geturl(), "body": body}
    except urllib.error.HTTPError:
        if fail_silently:
            return {}
        raise
    except Exception:
        if fail_silently:
            return {}
        raise


def build_call_notes(contact: EnrichedContact) -> str:
    lines = [contact.job_title]
    lines.extend(contact.notes)
    return "\n".join(line for line in lines if line)


def output_row(**kwargs: str) -> dict[str, str]:
    return {column: clean(kwargs.get(column)) for column in OUTPUT_COLUMNS}


def enrichment_level(contact: EnrichedContact) -> str:
    found = [
        bool(contact.full_name and contact.name_confidence != "not_found"),
        bool(contact.email and contact.email_confidence != "not_found"),
        bool(contact.phone and contact.phone_confidence != "not_found"),
    ]
    if all(found):
        return "full"
    if any(found):
        return "partial"
    return "none"


def title_property(content: str) -> dict[str, Any]:
    return {"type": "title", "title": [{"type": "text", "text": {"content": content}}]}


def rich_text_property(content: str) -> dict[str, Any]:
    return {
        "type": "rich_text",
        "rich_text": [{"type": "text", "text": {"content": content}}] if content else [],
    }


def select_property(name: str) -> dict[str, Any]:
    return {"type": "select", "select": {"name": name}} if name else {"type": "select", "select": None}


def normalize_notion_id(value: str) -> str:
    collection_id = value.strip().replace("collection://", "")
    dashed = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", collection_id, re.I)
    if dashed:
        return dashed.group(0)
    compact = re.search(r"[0-9a-f]{32}", collection_id, re.I)
    if compact:
        return compact.group(0)
    return collection_id


def loosely_matches_company(input_company: str, result_name: str) -> bool:
    if not result_name:
        return False

    normalized_input = normalize_alnum(input_company)
    normalized_result = normalize_alnum(result_name)
    if normalized_input and (normalized_input in normalized_result or normalized_result in normalized_input):
        return True

    tokens = company_tokens(input_company)
    if not tokens:
        return bool(normalized_input and normalized_input in normalized_result)

    matches = sum(1 for token in tokens if token in normalized_result)
    return matches >= min(2, len(tokens))


def company_tokens(value: str) -> list[str]:
    return [
        normalize_alnum(token)
        for token in re.split(r"[^A-Za-z0-9]+", value.lower())
        if len(token) > 2 and token not in GENERIC_COMPANY_TOKENS
    ]


def choose_best_email(emails: list[str], website: str, company: str) -> str:
    if not emails:
        return ""

    website_domain = domain_from_url(website)
    if website_domain:
        for email in emails:
            if email.endswith(f"@{website_domain}") or email.split("@")[-1] == website_domain:
                return email

    tokens = company_tokens(company)
    for email in emails:
        domain = normalize_alnum(email.split("@")[-1])
        if tokens and any(token in domain for token in tokens):
            return email

    return emails[0]


def clean_emails(values: Any) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        email_value = clean(str(value)).lower().strip(".,;:)]}>")
        if not email_value or "@" not in email_value:
            continue
        if any(blocked in email_value for blocked in BLOCKED_EMAIL_PARTS):
            continue
        if email_value in seen:
            continue
        seen.add(email_value)
        cleaned.append(email_value)
    return cleaned


def clean_phones(values: Any) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        digits = re.sub(r"\D", "", str(value))
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10 or not re.match(r"^[2-9]\d{2}[2-9]\d{6}$", digits):
            continue
        formatted = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        if formatted in seen:
            continue
        seen.add(formatted)
        cleaned.append(formatted)
    return cleaned


def extract_emails_from_html(body: str) -> list[str]:
    decoded = html.unescape(body)
    mailto_matches = re.findall(r"mailto:([^\"'?\s>]+)", decoded, re.IGNORECASE)
    text_matches = EMAIL_PATTERN.findall(decoded)
    return [*mailto_matches, *text_matches]


def html_to_text(body: str) -> str:
    no_script = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", body)
    text = re.sub(r"(?s)<[^>]+>", " ", no_script)
    return html.unescape(re.sub(r"\s+", " ", text))


def build_domain_guesses(company: str) -> list[str]:
    tokens = [
        token
        for token in re.split(r"[^a-z0-9]+", company.lower())
        if len(token) > 1 and token not in GENERIC_COMPANY_TOKENS
    ]
    compact = "".join(tokens)
    hyphenated = "-".join(tokens)
    guesses = []
    for value in [compact, hyphenated]:
        if len(value) >= 8:
            guesses.extend([f"https://{value}.com", f"https://www.{value}.com"])
    return list(dict.fromkeys(guesses))


def normalize_url(value: str) -> str:
    url = clean(value)
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = f"https://{url}"
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.netloc:
            return ""
        return urllib.parse.urlunparse(parsed._replace(fragment=""))
    except Exception:
        return ""


def url_origin(value: str) -> str:
    url = normalize_url(value)
    if not url:
        return ""
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def domain_from_url(value: str) -> str:
    url = normalize_url(value)
    if not url:
        return ""
    host = urllib.parse.urlparse(url).netloc.lower().split("@")[-1].split(":")[0]
    return host[4:] if host.startswith("www.") else host


def read_charset(content_type: str) -> str:
    match = re.search(r"charset=([^;\s]+)", content_type, re.IGNORECASE)
    return match.group(1) if match else "utf-8"


def is_plausible_person_name(candidate: str, company: str) -> bool:
    normalized = normalize_person_name(candidate)
    if not is_name_like(normalized):
        return False
    if normalize_alnum(normalized) in normalize_alnum(company):
        return False
    words = [word.lower().strip(".") for word in normalized.split()]
    return not any(word in BAD_NAME_WORDS for word in words)


def is_name_like(value: str) -> bool:
    words = [word for word in re.split(r"\s+", clean(value)) if word]
    if len(words) < 1 or len(words) > 4:
        return False
    return all(re.match(r"^[A-Za-z][A-Za-z'.-]*$", word) for word in words)


def normalize_person_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z'.\-\s]", " ", clean(value))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    words = []
    for word in cleaned.split():
        if len(word) == 1:
            words.append(word.upper())
        elif word.isupper() and len(word) <= 3:
            words.append(" ".join(word))
        else:
            words.append(word[:1].upper() + word[1:].lower())
    return re.sub(r"\s+", " ", " ".join(words)).strip()


def clean_name_token(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


def normalize_alnum(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def clean(value: Any) -> str:
    return str(value or "").strip()


def truncate(value: str, max_length: int = 500) -> str:
    return value if len(value) <= max_length else f"{value[:max_length]}..."


if __name__ == "__main__":
    main()
