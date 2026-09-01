import "@/lib/server-only";

/**
 * Normalize the most common shape mistakes free / weaker LLMs make when
 * filling the FinalOutput tool. These are pure transforms; if the input
 * already matches the canonical shape the function is a no-op.
 *
 * Applied BEFORE Zod validation so a model that returns `testing_strategy`
 * as `{ "Auth": { unit, integration, e2e } }` instead of an array can still
 * pass without forcing the user to retry.
 */

interface UnknownObject {
  [key: string]: unknown;
}

function isPlainObject(v: unknown): v is UnknownObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function coerceClientView(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const out: UnknownObject = { ...input };

  // milestones: array<{phase, name, deliverables: string[]}>
  if (Array.isArray(out.milestones)) {
    out.milestones = out.milestones.map((m) => {
      if (!isPlainObject(m)) return m;
      const ms: UnknownObject = { ...m };
      if (typeof ms.deliverables === "string") {
        ms.deliverables = [ms.deliverables];
      }
      return ms;
    });
  }

  // assumptions / open_items: ensure array form
  if (typeof out.assumptions === "string") out.assumptions = [out.assumptions];
  if (typeof out.open_items === "string") out.open_items = [out.open_items];

  // confidence_badge.score + breakdown.* must be integers — free models
  // sometimes emit floats (e.g. 87.5).
  if (isPlainObject(out.confidence_badge)) {
    const cb: UnknownObject = { ...(out.confidence_badge as UnknownObject) };
    if (typeof cb.score === "number") cb.score = Math.round(cb.score);
    if (isPlainObject(cb.breakdown)) {
      const bd: UnknownObject = { ...(cb.breakdown as UnknownObject) };
      for (const k of ["coverage", "llm_quality", "github_validation"]) {
        if (typeof bd[k] === "number") {
          bd[k] = Math.round(bd[k] as number);
        }
      }
      cb.breakdown = bd;
    }
    out.confidence_badge = cb;
  }

  return out;
}

export function coerceEngineerView(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const out: UnknownObject = { ...input };

  // module_table[].dependencies + api_endpoints: string → [string]
  if (Array.isArray(out.module_table)) {
    out.module_table = out.module_table.map((row) => {
      if (!isPlainObject(row)) return row;
      const r: UnknownObject = { ...row };
      if (typeof r.dependencies === "string") r.dependencies = [r.dependencies];
      if (r.dependencies == null) r.dependencies = [];
      if (typeof r.api_endpoints === "string") r.api_endpoints = [r.api_endpoints];
      if (r.api_endpoints == null) r.api_endpoints = [];
      if (typeof r.tech_stack === "string") r.tech_stack = [r.tech_stack];
      if (typeof r.notes !== "string") r.notes = String(r.notes ?? "");
      return r;
    });
  }

  // build_order: string → [string]
  if (typeof out.build_order === "string") out.build_order = [out.build_order];

  // database_sketch[].fields + relations: string → [string]
  if (Array.isArray(out.database_sketch)) {
    out.database_sketch = out.database_sketch.map((t) => {
      if (!isPlainObject(t)) return t;
      const tt: UnknownObject = { ...t };
      if (typeof tt.fields === "string") tt.fields = [tt.fields];
      if (typeof tt.relations === "string") tt.relations = [tt.relations];
      if (tt.relations == null) tt.relations = [];
      return tt;
    });
  }

  // testing_strategy: object map → array of rows
  if (isPlainObject(out.testing_strategy)) {
    const obj = out.testing_strategy;
    out.testing_strategy = Object.entries(obj).map(([module, value]) => {
      if (isPlainObject(value)) {
        return {
          module,
          unit: typeof value.unit === "string" ? value.unit : "—",
          integration:
            typeof value.integration === "string" ? value.integration : "—",
          e2e: typeof value.e2e === "string" ? value.e2e : "—",
        };
      }
      return { module, unit: "—", integration: "—", e2e: "—" };
    });
  }

  // security_per_module: array of {module, items} → record
  if (Array.isArray(out.security_per_module)) {
    const rec: Record<string, string[]> = {};
    for (const item of out.security_per_module) {
      if (!isPlainObject(item)) continue;
      const name =
        typeof item.module === "string"
          ? item.module
          : typeof item.name === "string"
            ? item.name
            : null;
      if (!name) continue;
      const list = Array.isArray(item.items)
        ? item.items
        : Array.isArray(item.concerns)
          ? item.concerns
          : [];
      rec[name] = list.filter((x): x is string => typeof x === "string");
    }
    out.security_per_module = rec;
  }

  // auth_model.permissions_matrix: array → record (occasionally seen)
  if (isPlainObject(out.auth_model)) {
    const am: UnknownObject = { ...(out.auth_model as UnknownObject) };
    if (Array.isArray(am.permissions_matrix)) {
      const rec: Record<string, string[]> = {};
      for (const row of am.permissions_matrix) {
        if (!isPlainObject(row)) continue;
        const role = typeof row.role === "string" ? row.role : null;
        if (!role) continue;
        rec[role] = Array.isArray(row.permissions)
          ? row.permissions.filter((x): x is string => typeof x === "string")
          : [];
      }
      am.permissions_matrix = rec;
    }
    out.auth_model = am;
  }

  // risks: ensure each has a severity in the enum
  if (Array.isArray(out.risks)) {
    out.risks = out.risks.map((r) => {
      if (!isPlainObject(r)) return r;
      const rr: UnknownObject = { ...r };
      const sev = typeof rr.severity === "string" ? rr.severity.toUpperCase() : "NOTE";
      rr.severity = ["CRITICAL", "WARNING", "NOTE"].includes(sev) ? sev : "NOTE";
      return rr;
    });
  }

  // sprint_breakdown[].story_points must be integer.
  if (Array.isArray(out.sprint_breakdown)) {
    out.sprint_breakdown = out.sprint_breakdown.map((s) => {
      if (!isPlainObject(s)) return s;
      const ss: UnknownObject = { ...s };
      if (typeof ss.story_points === "number") {
        ss.story_points = Math.round(ss.story_points);
      }
      return ss;
    });
  }

  // effort_summary.total_sprints + team_size must be integers.
  if (isPlainObject(out.effort_summary)) {
    const es: UnknownObject = { ...(out.effort_summary as UnknownObject) };
    if (typeof es.total_sprints === "number") {
      es.total_sprints = Math.max(1, Math.round(es.total_sprints));
    }
    if (typeof es.team_size === "number") {
      es.team_size = Math.max(1, Math.round(es.team_size));
    }
    out.effort_summary = es;
  }

  return out;
}
