"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  GitCompareArrows,
  Loader2,
  LogOut,
  Search,
  Send,
  RotateCcw,
  UserRound,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AuthUser } from "@/lib/auth/session";
import type {
  DedupeResponse,
  LeadSource,
  LeadStatus,
  NormalizeResponse,
  EnrichmentResponse,
  NotionExportResponse,
  Owner,
} from "@/lib/leads/schemas";
import { getTimezoneFromPhone, type USPhoneTimezone } from "@/lib/timezone";

type ExportDestination = "hubspot" | "notion";
type ExportActionFilter = "inserted" | "updated" | "skipped";

type HubSpotExportRecord = {
  success: boolean;
  hubspotId: string;
  action: ExportActionFilter;
  leadId?: string;
  contactName?: string;
  firmName?: string;
};

const samplePaste = `Profile Picture
MaryJane Link
The Tax Link

Seal Beach, CA 90740-4522
United States`;

const owners: Owner[] = ["Lisa", "Tamar", "Dawn", "Henry"];
const statuses: LeadStatus[] = ["Cold List", "Lead"];
const sources: LeadSource[] = ["NAEA", "IRS RPO", "Cold", "Referral", "Chamber", "Other"];

export default function Home() {
  const [signedInUser, setSignedInUser] = useState<AuthUser | null>(null);
  const [rawText, setRawText] = useState(samplePaste);
  const [owner, setOwner] = useState<Owner>("Henry");
  const [status, setStatus] = useState<LeadStatus>("Cold List");
  const [source, setSource] = useState<LeadSource>("NAEA");
  const [batchLabel, setBatchLabel] = useState("");
  const [result, setResult] = useState<NormalizeResponse | null>(null);
  const [dedupeResult, setDedupeResult] = useState<DedupeResponse | null>(null);
  const [exportDestination, setExportDestination] = useState<ExportDestination>("hubspot");
  const [exportResult, setExportResult] = useState<NotionExportResponse | null>(null);
  const [hubSpotExportResult, setHubSpotExportResult] = useState<HubSpotExportRecord[] | null>(null);
  const [exportActionFilter, setExportActionFilter] = useState<ExportActionFilter | null>(null);
  const [enrichmentResults, setEnrichmentResults] = useState<EnrichmentResponse[]>([]);
  const [error, setError] = useState("");
  const [dedupeError, setDedupeError] = useState("");
  const [exportError, setExportError] = useState("");
  const [enrichmentError, setEnrichmentError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDedupeLoading, setIsDedupeLoading] = useState(false);
  const [isExportLoading, setIsExportLoading] = useState(false);
  const [isEnrichmentLoading, setIsEnrichmentLoading] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadSession() {
      const response = await fetch("/api/auth/session", { cache: "no-store" });

      if (response.status === 401) {
        window.location.assign("/sign-in");
        return;
      }

      const payload = (await response.json()) as { user?: AuthUser };

      if (isActive) {
        setSignedInUser(payload.user ?? null);
      }
    }

    loadSession().catch(() => {
      if (isActive) {
        setSignedInUser(null);
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  const summary = useMemo(() => {
    const leads = result?.leads ?? [];
    const needsReview = leads.filter((lead) => lead.issues.length > 0 || lead.parseConfidence < 85).length;

    return {
      total: leads.length,
      highConfidence: leads.filter((lead) => lead.parseConfidence >= 85 && lead.issues.length === 0).length,
      needsReview,
      rejected: result?.rejectedBlocks.length ?? 0,
    };
  }, [result]);

  const phoneByLeadId = useMemo(() => {
    const phones = new Map<string, string>();

    for (const entry of enrichmentResults) {
      const candidate = [...entry.candidates]
        .filter((item) => item.confidenceScore >= 70)
        .filter((item) => item.phone || item.email || item.website)
        .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];

      if (candidate?.phone) {
        phones.set(entry.leadId, candidate.phone);
      }
    }

    return phones;
  }, [enrichmentResults]);

  const timezoneByLeadId = useMemo(() => {
    const timezones = new Map<string, USPhoneTimezone>();

    for (const lead of result?.leads ?? []) {
      const phone = phoneByLeadId.get(lead.id) ?? "";
      timezones.set(lead.id, phone ? getTimezoneFromPhone(phone) : "Unknown");
    }

    return timezones;
  }, [phoneByLeadId, result?.leads]);

  async function normalizeLeads() {
    setError("");
    setIsLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          rawText,
          owner,
          status,
          source,
          batchLabel: batchLabel || undefined,
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Normalize request failed.");
      }

      setResult(payload);
      setDedupeResult(null);
      setExportResult(null);
      setHubSpotExportResult(null);
      setExportActionFilter(null);
      setEnrichmentResults([]);
      setDedupeError("");
      setExportError("");
      setEnrichmentError("");
    } catch (requestError) {
      setError(toRequestErrorMessage(requestError, "Normalize request timed out or failed."));
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }

  function resetWorkflow() {
    setRawText("");
    setBatchLabel("");
    setResult(null);
    setDedupeResult(null);
    setExportResult(null);
    setHubSpotExportResult(null);
    setExportActionFilter(null);
    setEnrichmentResults([]);
    setError("");
    setDedupeError("");
    setExportError("");
    setEnrichmentError("");
  }

  async function dedupeAgainstCrm() {
    if (!result?.leads.length) {
      return;
    }

    setDedupeError("");
    setIsDedupeLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("/api/dedupe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          leads: result.leads,
          destination: exportDestination,
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        const issueSummary = Array.isArray(payload.issues)
          ? payload.issues
              .map((issue: { path?: string; message?: string }) =>
                [issue.path, issue.message].filter(Boolean).join(": "),
              )
              .filter(Boolean)
              .join("; ")
          : "";
        throw new Error(
          [payload.detail ?? payload.error ?? "Dedupe request failed.", issueSummary]
            .filter(Boolean)
            .join(" "),
        );
      }

      setDedupeResult(payload);
      setExportResult(null);
      setHubSpotExportResult(null);
      setExportActionFilter(null);
      setEnrichmentResults([]);
      setExportError("");
      setEnrichmentError("");
    } catch (requestError) {
      setDedupeError(toRequestErrorMessage(requestError, "Dedupe request timed out or failed."));
    } finally {
      window.clearTimeout(timeoutId);
      setIsDedupeLoading(false);
    }
  }

  async function exportLeads() {
    if (!dedupeResult || !result) {
      return;
    }

    setExportError("");
    setIsExportLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(`/api/${exportDestination}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          decisions: dedupeResult.decisions,
          defaults: result.defaults,
          enrichments: enrichmentResults,
          minConfidenceScore: 70,
          confirm: true,
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.detail ?? payload.error ?? "Export request failed.");
      }

      if (exportDestination === "hubspot") {
        const records = Array.isArray(payload.results) ? payload.results : [payload];
        setHubSpotExportResult(records as HubSpotExportRecord[]);
        setExportResult(null);
        setExportActionFilter(null);
      } else {
        setExportResult(payload as NotionExportResponse);
        setHubSpotExportResult(null);
        setExportActionFilter(null);
      }
    } catch (requestError) {
      setExportError(toRequestErrorMessage(requestError, "Export request timed out or failed."));
    } finally {
      window.clearTimeout(timeoutId);
      setIsExportLoading(false);
    }
  }

  const insertableCount = dedupeResult?.decisions.filter((decision) => decision.action === "insert").length ?? 0;
  const updateableCount = dedupeResult?.decisions.filter((decision) => decision.action === "update_existing").length ?? 0;
  const exportableCount =
    exportDestination === "hubspot"
      ? (dedupeResult?.decisions.length ?? 0)
      : insertableCount + updateableCount;
  const enrichableDecisions = useMemo(
    () =>
      dedupeResult?.decisions.filter((decision) =>
        exportDestination === "hubspot"
          ? true
          : decision.action === "insert" || decision.action === "update_existing",
      ) ?? [],
    [dedupeResult, exportDestination],
  );
  const enrichableLeads = useMemo(
    () => enrichableDecisions.map((decision) => decision.incomingLead),
    [enrichableDecisions],
  );

  async function enrichInsertCandidates() {
    if (!enrichableLeads.length) {
      return;
    }

    setEnrichmentError("");
    setIsEnrichmentLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120_000);

    try {
      const responses = await Promise.all(
        enrichableLeads.map(async (lead) => {
          const response = await fetch("/api/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
            body: JSON.stringify({ lead }),
          });
          const payload = await parseJsonResponse(response);

          if (!response.ok) {
            throw new Error(payload.error ?? `Enrichment failed for ${lead.firmName}.`);
          }

          return payload as EnrichmentResponse;
        }),
      );

      setEnrichmentResults(responses);
      setExportResult(null);
      setHubSpotExportResult(null);
      setExportActionFilter(null);
    } catch (requestError) {
      setEnrichmentError(toRequestErrorMessage(requestError, "Enrichment request timed out or failed."));
    } finally {
      window.clearTimeout(timeoutId);
      setIsEnrichmentLoading(false);
    }
  }

  const normalizeComplete = Boolean(result);
  const dedupeComplete = Boolean(dedupeResult);
  const enrichComplete =
    enrichmentResults.length > 0 || (Boolean(dedupeResult) && enrichableLeads.length === 0);
  const exportComplete = Boolean(exportResult || hubSpotExportResult);
  const isWorking = isLoading || isDedupeLoading || isEnrichmentLoading || isExportLoading;
  const workflowError = error || dedupeError || enrichmentError || exportError;

  const hubSpotSummary = useMemo(() => {
    if (!hubSpotExportResult) {
      return null;
    }

    return {
      inserted: hubSpotExportResult.filter((record) => record.action === "inserted").length,
      updated: hubSpotExportResult.filter((record) => record.action === "updated").length,
      skipped: hubSpotExportResult.filter((record) => record.action === "skipped").length,
    };
  }, [hubSpotExportResult]);

  const filteredLeads = useMemo(() => {
    const leads = result?.leads ?? [];

    if (!exportActionFilter || !hubSpotExportResult) {
      return leads;
    }

    const matchingIds = new Set(
      hubSpotExportResult
        .filter((record) => record.action === exportActionFilter && record.leadId)
        .map((record) => record.leadId as string),
    );

    return leads.filter((lead) => matchingIds.has(lead.id));
  }, [exportActionFilter, hubSpotExportResult, result?.leads]);

  const workflowSteps = [
    {
      key: "normalize",
      label: "Normalize",
      icon: Wand2,
      complete: normalizeComplete,
      enabled: rawText.trim().length > 0,
      loading: isLoading,
      run: normalizeLeads,
    },
    {
      key: "dedupe",
      label: "Dedupe",
      icon: GitCompareArrows,
      complete: dedupeComplete,
      enabled: Boolean(result?.leads.length),
      loading: isDedupeLoading,
      run: dedupeAgainstCrm,
    },
    {
      key: "enrich",
      label: "Enrich",
      icon: Search,
      complete: enrichComplete,
      enabled: Boolean(dedupeResult) && enrichableLeads.length > 0,
      loading: isEnrichmentLoading,
      run: enrichInsertCandidates,
    },
    {
      key: "export",
      label: "Export",
      icon: Send,
      complete: exportComplete,
      enabled: Boolean(dedupeResult) && enrichComplete && exportableCount > 0,
      loading: isExportLoading,
      run: exportLeads,
    },
  ] as const;

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700">NAEA Import</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
              Lead enrichment console
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Paste directory output, review the dedupe and enrichment evidence, then export a clean contact list to your CRM.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <div className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3">
              <ClipboardList className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              Vercel-ready portal
            </div>
            <div className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3">
              <UserRound className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              {signedInUser ? signedInUser.name : "Signed in"}
            </div>
            <form action="/api/auth/sign-out" method="post">
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Owner
                  <select
                    value={owner}
                    onChange={(event) => setOwner(event.target.value as Owner)}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  >
                    {owners.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Status
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as LeadStatus)}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  >
                    {statuses.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Source
                  <select
                    value={source}
                    onChange={(event) => setSource(event.target.value as LeadSource)}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  >
                    {sources.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Batch
                  <input
                    value={batchLabel}
                    onChange={(event) => setBatchLabel(event.target.value)}
                    placeholder="Seal Beach May 2026"
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
              </div>
            </div>

            <div className="flex min-h-[430px] flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <label className="flex flex-1 flex-col">
                <span className="text-sm font-semibold text-slate-800">
                  {source === "IRS RPO" ? "Raw IRS RPO text" : "Raw NAEA text"}
                </span>
                <textarea
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  className="mt-3 min-h-[340px] flex-1 resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-sm leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                  placeholder={
                    source === "IRS RPO"
                      ? "Paste IRS RPO directory results..."
                      : "Paste one or more copied NAEA directory records..."
                  }
                />
              </label>
              {source === "IRS RPO" ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Search irs.treasury.gov/rpo/rpo.jsf by zip code, copy all results, paste here.
                </p>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Workflow</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Run each step when you are ready. Review the tables on the right before exporting.
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {workflowSteps.map((step, index) => {
                  const Icon = step.icon;
                  const disabled = isWorking || !step.enabled;

                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={step.run}
                      disabled={disabled}
                      className={`rounded-md border px-2 py-3 text-center text-xs font-semibold transition ${
                        step.loading
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : step.complete
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : step.enabled
                              ? "border-slate-300 bg-white text-slate-950 hover:bg-slate-50"
                              : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                      }`}
                    >
                      <span className="block text-[10px] font-medium text-slate-500">Step {index + 1}</span>
                      <span className="mt-1 inline-flex items-center justify-center gap-1">
                        {step.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                        {step.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <fieldset className="mt-4">
                <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Export to</legend>
                <div className="mt-2 inline-flex rounded-md border border-slate-300 bg-slate-50 p-1">
                  {(["hubspot", "notion"] as const).map((destination) => (
                    <label
                      key={destination}
                      className={`cursor-pointer rounded px-3 py-1.5 text-sm font-semibold transition ${
                        exportDestination === destination
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-slate-600 hover:text-slate-950"
                      }`}
                    >
                      <input
                        type="radio"
                        name="export-destination"
                        value={destination}
                        checked={exportDestination === destination}
                        onChange={() => {
                          setExportDestination(destination);
                          setDedupeResult(null);
                          setExportResult(null);
                          setHubSpotExportResult(null);
                          setExportActionFilter(null);
                          setEnrichmentResults([]);
                        }}
                        className="sr-only"
                      />
                      {destination === "hubspot" ? "HubSpot" : "Notion"}
                    </label>
                  ))}
                </div>
              </fieldset>

              <button
                type="button"
                onClick={resetWorkflow}
                className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                Start a new batch
              </button>

              <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  {insertableCount} insert{insertableCount === 1 ? "" : "s"}
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  {updateableCount} update{updateableCount === 1 ? "" : "s"}
                </div>
              </div>

              {hubSpotSummary ? (
                <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <span className="mr-1 text-emerald-700" aria-hidden="true">
                    ✓
                  </span>
                  <SummaryAction
                    count={hubSpotSummary.inserted}
                    label="inserted"
                    active={exportActionFilter === "inserted"}
                    onClick={() =>
                      setExportActionFilter((current) => (current === "inserted" ? null : "inserted"))
                    }
                  />
                  <span className="mx-2 text-emerald-700">·</span>
                  <SummaryAction
                    count={hubSpotSummary.updated}
                    label="updated"
                    active={exportActionFilter === "updated"}
                    onClick={() =>
                      setExportActionFilter((current) => (current === "updated" ? null : "updated"))
                    }
                  />
                  <span className="mx-2 text-emerald-700">·</span>
                  <SummaryAction
                    count={hubSpotSummary.skipped}
                    label="skipped"
                    active={exportActionFilter === "skipped"}
                    onClick={() =>
                      setExportActionFilter((current) => (current === "skipped" ? null : "skipped"))
                    }
                  />
                </div>
              ) : null}

              {workflowError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
                  {workflowError}
                </div>
              ) : null}
              {exportResult ? (
                <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">
                  Exported {exportResult.inserted.length + exportResult.updated.length} lead
                  {exportResult.inserted.length + exportResult.updated.length === 1 ? "" : "s"}.
                  {` Inserted ${exportResult.inserted.length}, updated ${exportResult.updated.length}.`}
                  {exportResult.skipped.length ? ` Skipped ${exportResult.skipped.length}.` : ""}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Parsed" value={summary.total} />
              <Metric label="High confidence" value={summary.highConfidence} />
              <Metric label="Review" value={summary.needsReview} />
              <Metric label="Rejected" value={summary.rejected} />
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Normalize preview</h2>
                  {exportActionFilter ? (
                    <button
                      type="button"
                      onClick={() => setExportActionFilter(null)}
                      className="mt-1 text-xs font-semibold text-emerald-700 underline-offset-2 hover:underline"
                    >
                      Showing {exportActionFilter} · Clear filter
                    </button>
                  ) : null}
                </div>
                {result ? (
                  <span className="text-sm text-slate-500">
                    Defaults: {result.defaults.owner} / {result.defaults.status} / {result.defaults.source}
                  </span>
                ) : null}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Contact</th>
                      <th className="px-4 py-3 font-semibold">Firm</th>
                      <th className="px-4 py-3 font-semibold">Credential</th>
                      <th className="px-4 py-3 font-semibold">Location</th>
                      <th className="px-4 py-3 font-semibold">Timezone</th>
                      <th className="px-4 py-3 font-semibold">Confidence</th>
                      <th className="px-4 py-3 font-semibold">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLeads.map((lead) => (
                      <tr key={lead.id} className="align-top">
                        <td className="px-4 py-3 font-medium text-slate-950">{lead.contactName}</td>
                        <td className="px-4 py-3 text-slate-700">{lead.firmName}</td>
                        <td className="px-4 py-3 text-slate-700">{lead.credential ?? "-"}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {lead.city}, {lead.state} {lead.zip}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {timezoneByLeadId.get(lead.id) ?? "Unknown"}
                        </td>
                        <td className="px-4 py-3">
                          <ConfidenceBadge score={lead.parseConfidence} />
                        </td>
                        <td className="px-4 py-3">
                          {lead.issues.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" />
                              Clear
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {lead.issues.map((issue) => (
                                <span key={issue} className="inline-flex items-center gap-1 text-amber-700">
                                  <AlertTriangle className="h-4 w-4" />
                                  {issue}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!result ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                          Normalize pasted records to preview structured leads.
                        </td>
                      </tr>
                    ) : null}
                    {result && filteredLeads.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                          {exportActionFilter
                            ? `No ${exportActionFilter} contacts in this batch.`
                            : "No valid leads were parsed from this paste."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            {result?.rejectedBlocks.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-950">Rejected blocks</h3>
                <div className="mt-3 flex flex-col gap-3">
                  {result.rejectedBlocks.map((block, index) => (
                    <div key={`${block.rawSourceText}-${index}`} className="rounded-md bg-white p-3 text-sm">
                      <p className="font-medium text-amber-900">{block.issues.join(", ")}</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-slate-600">
                        {block.rawSourceText}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {dedupeResult ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold text-slate-950">Dedupe decisions</h2>
                  <span className="text-sm text-slate-500">
                    Compared against {dedupeResult.existingCount}{" "}
                    {exportDestination === "hubspot" ? "HubSpot contacts" : "Notion records"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Incoming lead</th>
                        <th className="px-4 py-3 font-semibold">Decision</th>
                        <th className="px-4 py-3 font-semibold">Matched CRM record</th>
                        <th className="px-4 py-3 font-semibold">Score</th>
                        <th className="px-4 py-3 font-semibold">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dedupeResult.decisions.map((decision) => (
                        <tr key={decision.incomingLead.id} className="align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-950">{decision.incomingLead.contactName}</div>
                            <div className="text-slate-600">{decision.incomingLead.firmName}</div>
                          </td>
                          <td className="px-4 py-3">
                            <ActionBadge action={decision.action} />
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {decision.matchedLead ? (
                              <>
                                <div className="font-medium text-slate-950">{decision.matchedLead.contactName ?? "-"}</div>
                                <div>{decision.matchedLead.firmName}</div>
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <ConfidenceBadge score={decision.matchScore} />
                          </td>
                          <td className="px-4 py-3 text-slate-700">{decision.matchReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {exportResult ? (
              <div className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
                <div className="flex flex-col gap-1 border-b border-emerald-100 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold text-emerald-950">Notion export receipt</h2>
                  <span className="text-sm text-emerald-800">
                    {exportResult.inserted.length} inserted, {exportResult.updated.length} updated
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Action</th>
                        <th className="px-4 py-3 font-semibold">Contact</th>
                        <th className="px-4 py-3 font-semibold">Firm</th>
                        <th className="px-4 py-3 font-semibold">Fields</th>
                        <th className="px-4 py-3 font-semibold">Notion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...exportResult.inserted, ...exportResult.updated].map((record) => (
                        <tr key={`${record.leadId}:${record.pageId}`} className="align-top">
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                              {exportResult.inserted.some((inserted) => inserted.pageId === record.pageId) ? "Inserted" : "Updated"}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-950">{record.contactName}</td>
                          <td className="px-4 py-3 text-slate-700">{record.firmName}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {record.enrichmentFields.length ? record.enrichmentFields.join(", ") : "Base record only"}
                          </td>
                          <td className="px-4 py-3">
                            {record.url ? (
                              <a
                                href={record.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                              >
                                Open page
                              </a>
                            ) : (
                              <span className="text-slate-500">Page ID {record.pageId}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {exportResult.skipped.length ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-3 text-slate-600">
                            Skipped {exportResult.skipped.length}:{" "}
                            {exportResult.skipped.map((item) => item.reason).join("; ")}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {hubSpotExportResult ? (
              <div className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
                <div className="flex flex-col gap-1 border-b border-emerald-100 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold text-emerald-950">HubSpot export receipt</h2>
                  <span className="text-sm text-emerald-800">{hubSpotExportResult.length} processed</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {hubSpotExportResult.map((record, index) => (
                    <div
                      key={`${record.leadId ?? index}:${record.hubspotId}`}
                      className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <div>
                        <div className="font-medium text-slate-950">{record.contactName ?? "Contact"}</div>
                        <div className="text-slate-600">{record.firmName ?? "-"}</div>
                      </div>
                      <div className="text-slate-700">
                        HubSpot contact ID: {record.hubspotId || "No matching contact"}
                      </div>
                      <span className="inline-flex h-fit w-fit rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold capitalize text-emerald-700 ring-1 ring-emerald-200">
                        {record.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {enrichmentResults.length ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold text-slate-950">Enrichment review</h2>
                  <span className="text-sm text-slate-500">
                    {enrichmentResults.length} lead{enrichmentResults.length === 1 ? "" : "s"} checked
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {enrichmentResults.map((entry) => {
                    const decision = enrichableDecisions.find((candidate) => candidate.incomingLead.id === entry.leadId);
                    const lead = decision?.incomingLead;
                    const exportCandidate = [...entry.candidates]
                      .filter((candidate) => candidate.confidenceScore >= 70)
                      .filter((candidate) => candidate.phone || candidate.email || candidate.website)
                      .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];

                    return (
                      <div key={entry.leadId} className="p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-950">{lead?.firmName ?? entry.leadId}</h3>
                            <p className="text-sm text-slate-600">{lead?.contactName}</p>
                          </div>
                          <span className="text-sm text-slate-500">
                            {entry.candidates.length} candidate{entry.candidates.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {entry.candidates.length ? (
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                              <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Candidate</th>
                                  <th className="px-3 py-2 font-semibold">Source</th>
                                  <th className="px-3 py-2 font-semibold">Phone</th>
                                  <th className="px-3 py-2 font-semibold">Email</th>
                                  <th className="px-3 py-2 font-semibold">Website</th>
                                  <th className="px-3 py-2 font-semibold">Confidence</th>
                                  <th className="px-3 py-2 font-semibold">Reason</th>
                                  <th className="px-3 py-2 font-semibold">Export</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {entry.candidates.map((candidate) => (
                                  <tr key={candidate.placeId} className="align-top">
                                    <td className="px-3 py-3">
                                      <div className="font-medium text-slate-950">{candidate.displayName}</div>
                                      <div className="text-slate-600">{candidate.formattedAddress ?? "-"}</div>
                                    </td>
                                    <td className="px-3 py-3 text-slate-700">{formatSourceType(candidate.sourceType)}</td>
                                    <td className="px-3 py-3 text-slate-700">{candidate.phone ?? "-"}</td>
                                    <td className="px-3 py-3 text-slate-700">{candidate.email ?? "-"}</td>
                                    <td className="px-3 py-3">
                                      {candidate.website ? (
                                        <a
                                          href={candidate.website}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-emerald-700 underline-offset-2 hover:underline"
                                        >
                                          Website
                                        </a>
                                      ) : (
                                        <span className="text-slate-500">-</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-3">
                                      <ConfidenceBadge score={candidate.confidenceScore} />
                                    </td>
                                    <td className="px-3 py-3 text-slate-700">{candidate.confidenceReason}</td>
                                    <td className="px-3 py-3">
                                      {exportCandidate?.placeId === candidate.placeId ? (
                                        <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                                          Will export
                                        </span>
                                      ) : (
                                        <span className="text-xs text-slate-500">Reference</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                            No public contact candidates found.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryAction({
  count,
  label,
  active,
  onClick,
}: {
  count: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-semibold underline-offset-2 hover:underline ${
        active ? "text-emerald-950 underline" : "text-emerald-900"
      }`}
    >
      {count} {label}
    </button>
  );
}

function ActionBadge({ action }: { action: DedupeResponse["decisions"][number]["action"] }) {
  const labels = {
    insert: "Insert",
    update_existing: "Update existing",
    skip: "Skip",
    review: "Review",
  };
  const tone = {
    insert: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    update_existing: "bg-sky-50 text-sky-700 ring-sky-200",
    skip: "bg-slate-100 text-slate-700 ring-slate-200",
    review: "bg-amber-50 text-amber-700 ring-amber-200",
  };

  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ring-1 ${tone[action]}`}>
      {labels[action]}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : score >= 70
        ? "bg-sky-50 text-sky-700 ring-sky-200"
        : "bg-amber-50 text-amber-700 ring-amber-200";

  return (
    <span className={`inline-flex min-w-14 justify-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ${tone}`}>
      {score}
    </span>
  );
}

function formatSourceType(sourceType: string) {
  const labels: Record<string, string> = {
    google_places: "Google",
    web_search: "Search",
    official_site: "Site",
    website_contact_page: "Contact page",
  };

  return labels[sourceType] ?? sourceType;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function toRequestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
