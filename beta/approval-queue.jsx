/*
 * Civic Sample — Approval Queue (Beta)
 * ----------------------------------------------------------------------------
 * A unified, high-speed triage inbox for reviewing AI-extracted demographic
 * (FDA) and SES/literature records before they reach the public dashboard.
 *
 * Delivery model: this file is plain React + Tailwind, compiled in the browser
 * by Babel-standalone and mounted as a self-contained "island". The host page
 * (index.html / app.js) is a no-build static site, so we follow its existing
 * convention of pulling libraries from a CDN and lazy-loading heavy features
 * only when their tab is first opened. Nothing here touches the original
 * extraction CSVs — every decision lives in local React state (the ledger).
 *
 * Architecture (modular components + hooks, top-to-bottom in this file):
 *   data layer    parseCSV, parseObjectCell, value coercers
 *   normalizers   normalizeFda / normalizeLit  -> unified TriageRecord
 *   tiering       computeTier  (3-tier sorting logic)
 *   hooks         useTriageData, useDecisionsLedger, usePendingQueue
 *   primitives    TierBadge, SourceBadge, ModelTag, ValueBadge, EvidenceQuote …
 *   composites    MetricRow, SesIndicators, RaceBreakdown, TriageCard,
 *                 ProcessedRow, FilterBar, ReviewerSelect, QueueTabs
 *   root          ApprovalQueueApp + window.CivicApprovalQueue.mount()
 *
 * The whole module is wrapped in an IIFE so re-running it (e.g. re-opening the
 * tab) is a no-op once `window.CivicApprovalQueue` is defined.
 */
(function () {
  "use strict";
  if (window.CivicApprovalQueue) return; // already initialised

  const { useState, useEffect, useMemo, useReducer, useCallback, useRef } = React;

  // ──────────────────────────────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────────────────────────────
  const NOT_REPORTED = "Not Reported";
  const NCT_RE = /^NCT\d{8}$/i;
  // candidate_score combines a +30 temporal bonus and +10 NCT-match bonus in
  // the literature extractor; >= 30 means at least the strong temporal signal
  // fired, so we treat it as a high-confidence match.
  const HIGH_CONFIDENCE_THRESHOLD = 30;
  const DEFAULT_REVIEWERS = ["Michael", "Maryam", "Agent_v1"];

  // Full Tailwind class strings (no dynamic concatenation, so the Play CDN JIT
  // can see every utility it must generate).
  const TIER_META = {
    1: { label: "Tier 1", sub: "Explicit Match", badge: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-600/30", bar: "border-l-emerald-500", dot: "bg-emerald-500" },
    2: { label: "Tier 2", sub: "High Confidence", badge: "bg-amber-100 text-amber-800 ring-1 ring-amber-600/30", bar: "border-l-amber-500", dot: "bg-amber-500" },
    3: { label: "Tier 3", sub: "Low Confidence", badge: "bg-rose-100 text-rose-800 ring-1 ring-rose-600/30", bar: "border-l-rose-500", dot: "bg-rose-500" },
  };
  const SOURCE_META = {
    fda: { label: "FDA Submission", short: "FDA", badge: "bg-sky-100 text-sky-800 ring-1 ring-sky-600/30" },
    lit: { label: "Literature", short: "LIT", badge: "bg-violet-100 text-violet-800 ring-1 ring-violet-600/30" },
  };

  function providerBadgeClass(model) {
    const m = (model || "").toLowerCase();
    if (m.includes("gemini")) return "bg-blue-50 text-blue-700 ring-1 ring-blue-600/20";
    if (/(claude|opus|sonnet|haiku)/.test(m)) return "bg-orange-50 text-orange-700 ring-1 ring-orange-600/20";
    return "bg-slate-100 text-slate-700 ring-1 ring-slate-500/20";
  }

  // ──────────────────────────────────────────────────────────────────────
  // Data layer — CSV + cell parsing
  // ──────────────────────────────────────────────────────────────────────

  // RFC-4180-ish CSV parser: handles quoted fields, embedded commas/newlines,
  // and doubled "" escapes. Returns an array of row objects keyed by header.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    text = String(text || "").replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else if (c !== "\r") {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1)
      .filter((r) => !(r.length === 1 && r[0] === ""))
      .map((r) => {
        const obj = {};
        header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ""; });
        return obj;
      });
  }

  // Nested object cells (sex / race) may arrive as JSON (our derivation) OR as
  // a Python dict repr (`{'male': 12, ...}` from pandas in the real pipeline).
  // Try JSON first, then normalise Python literals and retry.
  function parseObjectCell(s) {
    if (s && typeof s === "object") return s;
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t || t.toLowerCase() === "not reported") return null;
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    try {
      const j = t.replace(/'/g, '"')
        .replace(/\bNone\b/g, "null")
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        .replace(/\bnan\b/gi, "null");
      return JSON.parse(j);
    } catch (e) { return null; }
  }

  // Missing-integer sentinel (-1) in either numeric or stringified form.
  function isMissingInt(v) {
    if (typeof v === "number") return v === -1;
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim()) === -1;
    return false;
  }
  function isNotReported(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === "string") {
      const s = v.trim();
      if (s === "" || s.toLowerCase() === "not reported" || s.toLowerCase() === "none") return true;
    }
    return isMissingInt(v);
  }
  function toInt(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : -1;
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
    return -1;
  }
  function toBool(v) { return /^true$/i.test(String(v).trim()) || v === true; }
  function cleanStr(v) { return isNotReported(v) ? NOT_REPORTED : String(v).trim(); }
  function cleanEvidence(v) { return isNotReported(v) ? NOT_REPORTED : String(v).trim(); }

  // ──────────────────────────────────────────────────────────────────────
  // Normalizers — raw CSV row -> unified TriageRecord
  //   { source, id, key, title, subtitle, model, modelLabel, provider,
  //     tier, tierMeta, candidateScore, metrics:[…], raw }
  // A "metric" is { label, evidence, render(): ReactNode, kind }.
  // ──────────────────────────────────────────────────────────────────────

  function normalizeFda(row) {
    const sex = parseObjectCell(row.sex) || {};
    const race = parseObjectCell(row.race) || {};
    const id = cleanStr(row.submission_number);
    const rec = {
      source: "fda",
      id,
      key: "fda:" + id,
      title: cleanStr(row.device_name),
      subtitle: id,
      decisionDate: cleanStr(row.decision_date),
      sourceUrl: cleanStr(row.source_url),
      model: cleanStr(row.model),
      modelLabel: cleanStr(row.model_label) !== NOT_REPORTED ? cleanStr(row.model_label) : cleanStr(row.model),
      provider: cleanStr(row.provider),
      candidateScore: null,
      tierMeta: "",
      raw: row,
      metrics: [
        { label: "Device", kind: "scalar", value: cleanStr(row.device_name), evidence: cleanEvidence(row.device_name_evidence) },
        { label: "FDA Panel", kind: "scalar", value: cleanStr(row.panel), evidence: cleanEvidence(row.panel_evidence) },
        { label: "Total Participants", kind: "int", value: toInt(row.total_participants), evidence: cleanEvidence(row.total_participants_evidence) },
        { label: "Sex", kind: "breakdown", value: { male: toInt(sex.male), female: toInt(sex.female) }, labels: { male: "Male", female: "Female" }, evidence: cleanEvidence(row.sex_evidence) },
        { label: "Race", kind: "race", value: race, evidence: cleanEvidence(row.race_evidence) },
        { label: "Age Range", kind: "scalar", value: cleanStr(row.age_range), evidence: cleanEvidence(row.age_range_evidence) },
      ],
    };
    rec.tier = computeTier(rec);
    return rec;
  }

  function normalizeLit(row) {
    const doi = cleanStr(row.doi);
    const nct = cleanStr(row.nct_id);
    const nctEvidence = cleanEvidence(row.nct_id_evidence);
    const id = doi !== NOT_REPORTED ? doi : nct;
    const scoreRaw = (row.candidate_score || "").toString().trim();
    const candidateScore = scoreRaw !== "" && !isNaN(Number(scoreRaw)) ? Number(scoreRaw) : null;
    const studyName = cleanStr(row.study_name);
    const studyTitle = cleanStr(row.study_title);
    const rec = {
      source: "lit",
      id,
      key: "lit:" + id,
      title: studyName !== NOT_REPORTED ? studyName : (studyTitle !== NOT_REPORTED ? studyTitle : id),
      subtitle: [doi !== NOT_REPORTED ? "DOI " + doi : null, nct !== NOT_REPORTED ? nct : null].filter(Boolean).join(" · ") || id,
      doi, nct, nctEvidence,
      hasExplicitNct: NCT_RE.test(nct) && nctEvidence !== NOT_REPORTED,
      hasDoi: doi !== NOT_REPORTED,
      candidateScore,
      tierMeta: cleanStr(row.tier) !== NOT_REPORTED ? cleanStr(row.tier) : "",
      status: cleanStr(row.status),
      model: cleanStr(row.model),
      modelLabel: cleanStr(row.model_label) !== NOT_REPORTED ? cleanStr(row.model_label) : cleanStr(row.model),
      provider: cleanStr(row.provider),
      raw: row,
      metrics: [
        { label: "NCT ID", kind: "nct", value: nct, evidence: nctEvidence },
        { label: "Study", kind: "scalar", value: studyTitle !== NOT_REPORTED ? studyTitle : studyName, evidence: cleanEvidence(row.study_name_evidence) },
        { label: "SES Indicators", kind: "ses", value: { income: toBool(row.income_reported), education: toBool(row.education_reported), insurance: toBool(row.insurance_status_reported) }, notes: cleanStr(row.ses_notes), evidence: cleanEvidence(row.ses_indicators_evidence) },
        { label: "Race Breakdown", kind: "scalar", value: cleanStr(row.detailed_race_breakdown), evidence: cleanEvidence(row.detailed_race_breakdown_evidence) },
      ],
    };
    rec.tier = computeTier(rec);
    return rec;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3-Tier sorting logic
  //   FDA  -> always Tier 1.
  //   LIT  -> precedence:
  //     1. manuscript explicitly contains the NCT ID  -> Tier 1
  //     2. candidate_score >= threshold               -> Tier 2
  //     3. candidate_score present but below threshold -> Tier 3
  //     4. (no score) real match-tier metadata present -> map Tier 1/2/3
  //     5. missing DOI / no signal                     -> Tier 3
  // Steps 2-3 & 5 follow the spec for first-party pipeline CSVs (DOI +
  // candidate_score, no tier column); step 4 lets the derived data fall back
  // to the genuine match-tier metadata it carries instead.
  // ──────────────────────────────────────────────────────────────────────
  function computeTier(rec) {
    if (rec.source === "fda") return 1;
    if (rec.hasExplicitNct) return 1;
    if (rec.candidateScore != null) {
      return rec.candidateScore >= HIGH_CONFIDENCE_THRESHOLD ? 2 : 3;
    }
    const m = /tier\s*([123])/i.exec(rec.tierMeta || "");
    if (m) return Number(m[1]);
    return 3; // low-confidence / missing DOI
  }

  // ──────────────────────────────────────────────────────────────────────
  // Hooks
  // ──────────────────────────────────────────────────────────────────────

  // Fetch + parse both extraction streams into a unified record list.
  function useTriageData(config) {
    const [state, setState] = useState({ records: [], loading: true, error: null });
    const reload = useCallback(() => {
      let cancelled = false;
      setState((s) => ({ ...s, loading: true, error: null }));
      const bust = "?v=" + Date.now();
      const grab = (url, normalize) =>
        fetch(url + bust)
          .then((r) => { if (!r.ok) throw new Error(url + " → HTTP " + r.status); return r.text(); })
          .then((t) => parseCSV(t).map(normalize))
          .catch((e) => { console.warn("[ApprovalQueue]", e.message); return []; });
      Promise.all([
        grab(config.fdaUrl, normalizeFda),
        grab(config.litUrl, normalizeLit),
      ]).then(([fda, lit]) => {
        if (cancelled) return;
        // The same NCT can appear across several candidate manuscripts (and a
        // missing DOI collapses an id to its NCT), so de-duplicate the internal
        // key — otherwise distinct rows would collide in the ledger and React.
        // The spec'd `id` field is left untouched; only `key` is disambiguated.
        const seen = new Map();
        const records = [...fda, ...lit]
          .filter((r) => r.id && r.id !== NOT_REPORTED)
          .map((r) => {
            const n = (seen.get(r.key) || 0) + 1;
            seen.set(r.key, n);
            return n > 1 ? { ...r, key: r.key + "#" + n } : r;
          });
        setState({ records, loading: false, error: records.length ? null : "empty" });
      });
      return () => { cancelled = true; };
    }, [config.fdaUrl, config.litUrl]);
    useEffect(() => reload(), [reload]);
    return { ...state, reload };
  }

  // The decisions ledger: append-only local React state. Never persisted to
  // the source CSVs. Each entry: { key, id, source, decision_status,
  // reviewer_name, timestamp }.
  function ledgerReducer(state, action) {
    switch (action.type) {
      case "DECIDE":
        return [...state.filter((e) => e.key !== action.entry.key), action.entry];
      case "UNDO":
        return state.filter((e) => e.key !== action.key);
      default:
        return state;
    }
  }
  function useDecisionsLedger() {
    const [ledger, dispatch] = useReducer(ledgerReducer, []);
    const decide = useCallback((record, decision_status, reviewer_name) => {
      dispatch({
        type: "DECIDE",
        entry: {
          key: record.key,
          id: record.id,
          source: record.source,
          decision_status,
          reviewer_name,
          timestamp: new Date().toISOString(),
        },
      });
    }, []);
    const undo = useCallback((key) => dispatch({ type: "UNDO", key }), []);
    return { ledger, decide, undo };
  }

  // Cross-reference the base extraction records against the ledger to split
  // them into the live inbox vs. the processed logs. This is the utility hook
  // the spec asks for: previously-reviewed items drop out of "pending".
  function usePendingQueue(records, ledger) {
    return useMemo(() => {
      const byKey = new Map(ledger.map((e) => [e.key, e]));
      const recByKey = new Map(records.map((r) => [r.key, r]));
      const pending = records.filter((r) => !byKey.has(r.key));
      const join = (status) =>
        ledger
          .filter((e) => e.decision_status === status)
          .map((e) => ({ entry: e, record: recByKey.get(e.key) }))
          .filter((x) => x.record)
          .sort((a, b) => b.entry.timestamp.localeCompare(a.entry.timestamp));
      return { pending, approved: join("approved"), rejected: join("rejected") };
    }, [records, ledger]);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Presentational primitives
  // ──────────────────────────────────────────────────────────────────────
  const Pill = ({ className, children, title }) => (
    <span title={title} className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold " + className}>{children}</span>
  );

  const TierBadge = ({ tier }) => {
    const m = TIER_META[tier] || TIER_META[3];
    return <Pill className={m.badge} title={m.label + " — " + m.sub}><span className={"h-1.5 w-1.5 rounded-full " + m.dot} />{m.label} · {m.sub}</Pill>;
  };
  const SourceBadge = ({ source }) => {
    const m = SOURCE_META[source] || SOURCE_META.lit;
    return <Pill className={m.badge}>{m.label}</Pill>;
  };
  const ModelTag = ({ model, label }) => (
    <Pill className={providerBadgeClass(model)} title={"Extracted by " + (model || "unknown model")}>
      <svg viewBox="0 0 8 8" className="h-1.5 w-1.5 fill-current opacity-70"><circle cx="4" cy="4" r="4" /></svg>
      {label || model || "model"}
    </Pill>
  );

  const MissingBadge = () => <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-500" title="Coded -1: not present in the source document">N/A</span>;
  const NotReportedBadge = () => <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-300">Not Reported</span>;
  const UnknownBadge = ({ children }) => <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-300" title="Document explicitly stated the value was unknown (an explicit entry, not missing data)">{children || "Explicit Unknown"}</span>;

  // Verbatim AI evidence quote shown beneath every value for auditing.
  const EvidenceQuote = ({ text }) => {
    if (isNotReported(text)) {
      return <p className="mt-1 text-[11px] italic text-slate-400">— no supporting quote —</p>;
    }
    return (
      <blockquote className="mt-1 border-l-2 border-slate-300 bg-slate-50 px-2 py-1 text-[11px] leading-snug text-slate-600">
        <span className="mr-1 select-none text-slate-400">“</span>{text}<span className="ml-0.5 select-none text-slate-400">”</span>
      </blockquote>
    );
  };

  function ScalarValue({ value }) {
    if (isMissingInt(value)) return <MissingBadge />;
    if (isNotReported(value)) return <NotReportedBadge />;
    if (typeof value === "number") return <span className="font-semibold text-slate-900">{value.toLocaleString()}</span>;
    return <span className="font-medium text-slate-900">{String(value)}</span>;
  }

  // Integer breakdown (e.g. sex). Collapses to Not Reported when every bucket
  // is missing; otherwise lists the reported buckets.
  function IntBreakdown({ value, labels }) {
    const entries = Object.entries(value).filter(([, v]) => !isMissingInt(v) && !isNotReported(v));
    if (!entries.length) return <NotReportedBadge />;
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {entries.map(([k, v]) => (
          <span key={k} className="text-sm"><span className="text-slate-500">{(labels && labels[k]) || k}:</span> <span className="font-semibold text-slate-900">{Number(v).toLocaleString()}</span></span>
        ))}
      </div>
    );
  }

  // Race breakdown with the spec's crucial rule: the `unknown` bucket is an
  // EXPLICIT entry (the document said race was unknown), visually distinct from
  // a not-reported gap.
  const RACE_LABELS = { white: "White", black: "Black", asian: "Asian", hispanic: "Hispanic", native_american: "Native American", other: "Other", unknown: "Unknown" };
  function RaceBreakdown({ value }) {
    if (!value || typeof value !== "object") return <NotReportedBadge />;
    const reported = Object.entries(value).filter(([, v]) => !isMissingInt(v) && !isNotReported(v));
    if (!reported.length) return <NotReportedBadge />;
    const nonUnknown = reported.filter(([k]) => k !== "unknown");
    if (!nonUnknown.length) {
      const uv = value.unknown;
      return <UnknownBadge>Explicit Unknown{typeof uv === "number" && uv >= 0 ? ": " + uv.toLocaleString() : ""}</UnknownBadge>;
    }
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {reported.map(([k, v]) => (
          <span key={k} className={"text-sm " + (k === "unknown" ? "rounded bg-amber-50 px-1 ring-1 ring-amber-200" : "")}>
            <span className={k === "unknown" ? "text-amber-700" : "text-slate-500"}>{RACE_LABELS[k] || k}:</span>{" "}
            <span className="font-semibold text-slate-900">{Number(v).toLocaleString()}</span>
          </span>
        ))}
      </div>
    );
  }

  function NctValue({ value, explicit }) {
    if (isNotReported(value)) return <NotReportedBadge />;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-sm font-semibold text-slate-900">{value}</span>
        {explicit
          ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-300">explicit in manuscript</span>
          : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-300">linked by matcher</span>}
      </span>
    );
  }

  function SesIndicators({ value, notes }) {
    const items = [["income", "Income"], ["education", "Education"], ["insurance", "Insurance"]];
    return (
      <div>
        <div className="flex flex-wrap gap-1.5">
          {items.map(([k, lbl]) => (
            <span key={k} className={"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 " + (value[k] ? "bg-emerald-50 text-emerald-700 ring-emerald-300" : "bg-slate-100 text-slate-400 ring-slate-200")}>
              <span>{value[k] ? "✓" : "—"}</span>{lbl}
            </span>
          ))}
        </div>
        {notes && !isNotReported(notes) && notes !== "None" && (
          <p className="mt-1 text-xs text-slate-500">{notes}</p>
        )}
      </div>
    );
  }

  // One labelled metric: value on top, verbatim evidence quote beneath.
  function MetricRow({ metric }) {
    let valueNode;
    switch (metric.kind) {
      case "int": valueNode = <ScalarValue value={metric.value} />; break;
      case "breakdown": valueNode = <IntBreakdown value={metric.value} labels={metric.labels} />; break;
      case "race": valueNode = <RaceBreakdown value={metric.value} />; break;
      case "nct": valueNode = <NctValue value={metric.value} explicit={!isNotReported(metric.evidence)} />; break;
      case "ses": valueNode = <SesIndicators value={metric.value} notes={metric.notes} />; break;
      default: valueNode = <ScalarValue value={metric.value} />;
    }
    return (
      <div className="border-t border-slate-100 px-3 py-2 first:border-t-0 sm:grid sm:grid-cols-[8.5rem,1fr] sm:gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{metric.label}</div>
        <div className="mt-0.5 sm:mt-0">
          {valueNode}
          <EvidenceQuote text={metric.evidence} />
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cards & rows
  // ──────────────────────────────────────────────────────────────────────
  function CardHeader({ record }) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <TierBadge tier={record.tier} />
            <SourceBadge source={record.source} />
            <ModelTag model={record.model} label={record.modelLabel} />
          </div>
          <h3 className="truncate text-sm font-semibold text-slate-900" title={record.title}>{record.title}</h3>
          <p className="truncate text-xs text-slate-500" title={record.subtitle}>{record.subtitle}</p>
        </div>
      </div>
    );
  }

  function TriageCard({ record, onApprove, onReject, canDecide }) {
    const tm = TIER_META[record.tier] || TIER_META[3];
    return (
      <div className={"overflow-hidden rounded-lg border border-slate-200 border-l-4 bg-white shadow-sm transition hover:shadow-md " + tm.bar}>
        <CardHeader record={record} />
        <div className="divide-y divide-slate-100">
          {record.metrics.map((m, i) => <MetricRow key={i} metric={m} />)}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2">
          <span className="text-[11px] text-slate-400">{record.candidateScore != null ? "candidate score " + record.candidateScore : (record.tierMeta || "")}</span>
          <div className="flex gap-2">
            <button
              type="button" disabled={!canDecide} onClick={() => onReject(record)}
              className="rounded-md border border-rose-200 bg-white px-3 py-1 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
              ✕ Reject
            </button>
            <button
              type="button" disabled={!canDecide} onClick={() => onApprove(record)}
              className="rounded-md border border-emerald-600 bg-emerald-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
              ✓ Approve
            </button>
          </div>
        </div>
      </div>
    );
  }

  function ProcessedRow({ item, onUndo }) {
    const { entry, record } = item;
    const approved = entry.decision_status === "approved";
    const when = new Date(entry.timestamp);
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold " + (approved ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{approved ? "✓" : "✕"}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceBadge source={record.source} />
              <TierBadge tier={record.tier} />
              <span className="truncate text-sm font-medium text-slate-800" title={record.title}>{record.title}</span>
            </div>
            <p className="text-xs text-slate-500">
              <span className="font-mono">{record.id}</span> · {approved ? "Approved" : "Rejected"} by <span className="font-semibold text-slate-700">{entry.reviewer_name}</span> · {when.toLocaleString()}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => onUndo(entry.key)} className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">↺ Undo</button>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Controls
  // ──────────────────────────────────────────────────────────────────────
  function ReviewerSelect({ reviewers, value, onChange }) {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-slate-600">Reviewer</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500">
          {reviewers.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
    );
  }

  function Select({ label, value, onChange, options }) {
    return (
      <label className="flex items-center gap-1.5 text-xs">
        <span className="font-medium uppercase tracking-wide text-slate-400">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }

  function FilterBar({ filters, setFilters, modelOptions }) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Select label="Tier" value={filters.tier} onChange={(v) => setFilters((f) => ({ ...f, tier: v }))}
          options={[{ value: "all", label: "All tiers" }, { value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }, { value: "3", label: "Tier 3" }]} />
        <Select label="Source" value={filters.source} onChange={(v) => setFilters((f) => ({ ...f, source: v }))}
          options={[{ value: "all", label: "All sources" }, { value: "fda", label: "FDA" }, { value: "lit", label: "Literature" }]} />
        <Select label="Model" value={filters.model} onChange={(v) => setFilters((f) => ({ ...f, model: v }))}
          options={[{ value: "all", label: "All models" }, ...modelOptions.map((m) => ({ value: m, label: m }))]} />
      </div>
    );
  }

  function QueueTabs({ active, onChange, counts }) {
    const tabs = [["pending", "Pending", counts.pending], ["approved", "Approved", counts.approved], ["rejected", "Rejected", counts.rejected]];
    return (
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => onChange(key)}
            className={"relative -mb-px border-b-2 px-3 py-2 text-sm font-semibold transition " + (active === key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
            {label}
            <span className={"ml-1.5 rounded-full px-1.5 py-0.5 text-xs " + (active === key ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500")}>{count}</span>
          </button>
        ))}
      </div>
    );
  }

  function TierSummary({ records }) {
    const counts = { 1: 0, 2: 0, 3: 0 };
    records.forEach((r) => { counts[r.tier] = (counts[r.tier] || 0) + 1; });
    return (
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3].map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            <span className={"h-2 w-2 rounded-full " + (TIER_META[t].dot)} />{TIER_META[t].label}<span className="font-bold text-slate-800">{counts[t]}</span>
          </span>
        ))}
      </div>
    );
  }

  function EmptyState({ icon, title, hint }) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
        <div className="text-3xl">{icon}</div>
        <p className="mt-2 text-sm font-semibold text-slate-700">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{hint}</p>}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Root
  // ──────────────────────────────────────────────────────────────────────
  function applyFilters(list, filters, getRecord) {
    return list.filter((x) => {
      const r = getRecord(x);
      if (filters.tier !== "all" && String(r.tier) !== filters.tier) return false;
      if (filters.source !== "all" && r.source !== filters.source) return false;
      if (filters.model !== "all" && (r.modelLabel || r.model) !== filters.model) return false;
      return true;
    });
  }

  function ApprovalQueueApp({ config }) {
    const reviewers = config.reviewers && config.reviewers.length ? config.reviewers : DEFAULT_REVIEWERS;
    const { records, loading, error, reload } = useTriageData(config);
    const { ledger, decide, undo } = useDecisionsLedger();
    const { pending, approved, rejected } = usePendingQueue(records, ledger);

    const [reviewer, setReviewer] = useState(reviewers[0]);
    const [tab, setTab] = useState("pending");
    const [filters, setFilters] = useState({ tier: "all", source: "all", model: "all" });

    const modelOptions = useMemo(() => {
      const s = new Set(records.map((r) => r.modelLabel || r.model).filter(Boolean));
      return Array.from(s).sort();
    }, [records]);

    const onApprove = useCallback((r) => decide(r, "approved", reviewer), [decide, reviewer]);
    const onReject = useCallback((r) => decide(r, "rejected", reviewer), [decide, reviewer]);

    const visiblePending = useMemo(() => {
      const f = applyFilters(pending, filters, (r) => r);
      const order = { fda: 0, lit: 1 };
      return f.sort((a, b) => a.tier - b.tier || order[a.source] - order[b.source] || a.id.localeCompare(b.id));
    }, [pending, filters]);
    const visibleApproved = useMemo(() => applyFilters(approved, filters, (x) => x.record), [approved, filters]);
    const visibleRejected = useMemo(() => applyFilters(rejected, filters, (x) => x.record), [rejected, filters]);

    return (
      <div className="text-slate-800">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg border border-slate-200 bg-white px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Approval Queue</h2>
            <p className="text-xs text-slate-500">Unified triage inbox · review extracted records before they reach the dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <ReviewerSelect reviewers={reviewers} value={reviewer} onChange={setReviewer} />
            <button type="button" onClick={reload} title="Re-fetch the extraction files" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-50">↻ Refresh</button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-x border-slate-200 bg-slate-50 px-4 py-2">
          <FilterBar filters={filters} setFilters={setFilters} modelOptions={modelOptions} />
          <TierSummary records={pending} />
        </div>

        {/* Tabs */}
        <div className="border-x border-slate-200 bg-white px-4">
          <QueueTabs active={tab} onChange={setTab} counts={{ pending: pending.length, approved: approved.length, rejected: rejected.length }} />
        </div>

        {/* Body */}
        <div className="space-y-3 rounded-b-lg border border-t-0 border-slate-200 bg-slate-50 p-4">
          {loading && <EmptyState icon="⏳" title="Loading extraction files…" />}

          {!loading && error === "empty" && (
            <EmptyState icon="📭" title="No extraction records found"
              hint="The triage inbox reads data/fda_extracted_latest.csv and data/lit_extracted_latest.csv. Run the extraction pipeline (or scripts/build_triage_latest.py) to populate them." />
          )}

          {!loading && error !== "empty" && tab === "pending" && (
            visiblePending.length
              ? <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{visiblePending.map((r) => <TriageCard key={r.key} record={r} onApprove={onApprove} onReject={onReject} canDecide={!!reviewer} />)}</div>
              : <EmptyState icon="✅" title="Inbox zero" hint={pending.length ? "No items match the current filters." : "Every extracted record has been triaged."} />
          )}

          {!loading && tab === "approved" && (
            visibleApproved.length
              ? <div className="space-y-2">{visibleApproved.map((x) => <ProcessedRow key={x.entry.key} item={x} onUndo={undo} />)}</div>
              : <EmptyState icon="🗂️" title="No approved items yet" hint="Approved records appear here with the reviewer and timestamp. Use Undo to send one back to Pending." />
          )}

          {!loading && tab === "rejected" && (
            visibleRejected.length
              ? <div className="space-y-2">{visibleRejected.map((x) => <ProcessedRow key={x.entry.key} item={x} onUndo={undo} />)}</div>
              : <EmptyState icon="🗑️" title="No rejected items yet" hint="Rejected records appear here with the reviewer and timestamp. Use Undo to send one back to Pending." />
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Public mount API
  // ──────────────────────────────────────────────────────────────────────
  window.CivicApprovalQueue = {
    mount(rootEl, config) {
      if (!rootEl) return;
      const root = ReactDOM.createRoot(rootEl);
      root.render(<ApprovalQueueApp config={config || {}} />);
      return root;
    },
  };
})();
