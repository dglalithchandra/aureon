import type Anthropic from "@anthropic-ai/sdk";

/* ──────────────────────────────────────────────────────────────
 *  Client view tool
 * ────────────────────────────────────────────────────────────── */

export const submitClientViewTool: Anthropic.Tool = {
  name: "submit_client_view",
  description:
    "Submit the client-facing scope document. Plain English, no jargon, every assumption explicit.",
  input_schema: {
    type: "object",
    required: [
      "project_summary",
      "modules",
      "milestones",
      "assumptions",
      "open_items",
      "confidence_badge",
    ],
    properties: {
      project_summary: {
        type: "string",
        maxLength: 1000,
        description:
          "2-3 sentences describing what the system does and who it serves. No tech terms (no 'API', 'webhook', 'middleware'). Plain English a non-technical client would read aloud.",
      },
      modules: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          required: ["name", "description", "size", "github_validated"],
          properties: {
            name: { type: "string", maxLength: 80 },
            description: {
              type: "string",
              maxLength: 400,
              description: "One sentence in plain English. No tech jargon.",
            },
            size: { type: "string", enum: ["SMALL", "MEDIUM", "LARGE"] },
            github_validated: { type: "boolean" },
          },
        },
      },
      milestones: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        description:
          "Phased delivery plan (typically 3-5 milestones). Each names a phase like 'Month 1' or 'Phase 1' and lists concrete deliverables in plain English.",
        items: {
          type: "object",
          required: ["phase", "name", "deliverables"],
          properties: {
            phase: { type: "string", maxLength: 40 },
            name: { type: "string", maxLength: 120 },
            deliverables: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", maxLength: 200 },
            },
          },
        },
      },
      assumptions: {
        type: "array",
        maxItems: 40,
        items: { type: "string", maxLength: 400 },
        description:
          "Every assumption made because something was MISSING or PARTIAL. Phrase each one so the client can correct it: 'We assume X. Tell us if Y instead.'",
      },
      open_items: {
        type: "array",
        maxItems: 40,
        items: { type: "string", maxLength: 400 },
        description:
          "Things still unresolved. Phrase each as a question the client can answer.",
      },
      confidence_badge: {
        type: "object",
        required: ["score", "breakdown"],
        description:
          "Placeholder only: the server computes the real score and its components and replaces this object. Send your rough read; do not agonise over it.",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          breakdown: {
            type: "object",
            required: ["coverage"],
            properties: {
              coverage: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
        },
      },
    },
  },
};

export const CLIENT_VIEW_SYSTEM_PROMPT = `You write the CLIENT-FACING scope document for Aureon.

The reader is a non-technical project sponsor who is approving (or rejecting) the project as described. They will not read tech jargon. They will read every word.

Rules:
  - 2-3 sentence project summary in plain English. No "API", "REST", "OAuth", "JWT", "middleware", "schema". Use "the system", "users sign in", "data is stored securely".
  - Modules are described in business terms. "Auth" → "User accounts and sign-in". "Webhooks" → "Real-time updates from connected services".
  - Milestones are calendar-friendly (Month 1, Month 2 / Phase 1, Phase 2). Include concrete deliverables ("Launch private beta to 5 users").
  - Every assumption you make MUST be explicit. The reader will use these to spot misunderstandings.
  - Open items are phrased as questions, not statements. The client will answer them.
  - Confidence breakdown: coverage = how much of the 9 parameters were filled in; llm_quality = how clear and specific the input was; github_validation = how many modules were corroborated by similar real-world projects (0 if no GitHub matches).

Always call submit_client_view exactly once. No free-form text.`;

/* ──────────────────────────────────────────────────────────────
 *  Engineer view tool
 * ────────────────────────────────────────────────────────────── */

export const submitEngineerViewTool: Anthropic.Tool = {
  name: "submit_engineer_view",
  description:
    "Submit the engineering-facing build document. Specific tech choices, concrete API surfaces, sprint math.",
  input_schema: {
    type: "object",
    required: [
      "module_table",
      "build_order",
      "database_sketch",
      "auth_model",
      "third_party_checklist",
      "sprint_breakdown",
      "testing_strategy",
      "security_per_module",
      "risks",
      "github_references",
      "effort_summary",
    ],
    properties: {
      module_table: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          required: [
            "name",
            "tech_stack",
            "size",
            "dependencies",
            "api_endpoints",
            "notes",
          ],
          properties: {
            name: { type: "string", maxLength: 80 },
            tech_stack: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", maxLength: 60 },
            },
            size: { type: "string", enum: ["SMALL", "MEDIUM", "LARGE"] },
            dependencies: {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 80 },
              description: "Names of OTHER modules this depends on.",
            },
            api_endpoints: {
              type: "array",
              maxItems: 40,
              items: {
                type: "string",
                maxLength: 160,
                description:
                  "Format: 'METHOD /path  — purpose'. Example: 'POST /api/auth/login — issue session'.",
              },
            },
            notes: { type: "string", maxLength: 400 },
          },
        },
      },
      build_order: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: { type: "string", maxLength: 80 },
        description:
          "Module names in topological order — what must be built first. Independent modules go in roughly the order an engineer would tackle them.",
      },
      database_sketch: {
        type: "array",
        maxItems: 40,
        items: {
          type: "object",
          required: ["table", "fields", "relations"],
          properties: {
            table: { type: "string", maxLength: 60 },
            fields: {
              type: "array",
              minItems: 1,
              maxItems: 40,
              items: {
                type: "string",
                maxLength: 120,
                description:
                  "Format: 'name TYPE [constraints]'. Example: 'id UUID PRIMARY KEY', 'email TEXT UNIQUE NOT NULL'.",
              },
            },
            relations: {
              type: "array",
              maxItems: 20,
              items: {
                type: "string",
                maxLength: 160,
                description:
                  "Format: 'FK <field> -> <table>.<field>'. Example: 'FK user_id -> users.id'.",
              },
            },
          },
        },
      },
      auth_model: {
        type: "object",
        required: ["roles", "permissions_matrix"],
        properties: {
          roles: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "string", maxLength: 40 },
          },
          permissions_matrix: {
            type: "object",
            description:
              "Map role name → array of allowed scopes/actions like 'modules:read', 'billing:write'.",
            additionalProperties: {
              type: "array",
              maxItems: 40,
              items: { type: "string", maxLength: 160 },
            },
          },
        },
      },
      third_party_checklist: {
        type: "array",
        maxItems: 30,
        items: {
          type: "string",
          maxLength: 160,
          description:
            "Service + concrete prerequisite. 'Stripe — create account, set up webhooks endpoint'. 'AWS S3 — provision bucket and CORS'.",
        },
      },
      sprint_breakdown: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          required: ["sprint", "focus", "story_points", "modules"],
          properties: {
            sprint: { type: "string", maxLength: 40 },
            focus: { type: "string", maxLength: 200 },
            story_points: { type: "integer", minimum: 0, maximum: 200 },
            modules: {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 80 },
            },
          },
        },
      },
      testing_strategy: {
        type: "array",
        maxItems: 40,
        items: {
          type: "object",
          required: ["module", "unit", "integration", "e2e"],
          properties: {
            module: { type: "string", maxLength: 80 },
            unit: { type: "string", maxLength: 200 },
            integration: { type: "string", maxLength: 200 },
            e2e: { type: "string", maxLength: 200 },
          },
        },
      },
      security_per_module: {
        type: "object",
        description:
          "Map module name → array of security concerns. Example: 'Billing': ['PCI scope', 'webhook signature verification', 'idempotency keys'].",
        additionalProperties: {
          type: "array",
          maxItems: 20,
          items: { type: "string", maxLength: 200 },
        },
      },
      risks: {
        type: "array",
        maxItems: 40,
        items: {
          type: "object",
          required: ["severity", "description"],
          properties: {
            severity: {
              type: "string",
              enum: ["CRITICAL", "WARNING", "NOTE"],
            },
            description: { type: "string", maxLength: 400 },
          },
        },
      },
      github_references: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          required: ["repo", "url", "why_relevant"],
          properties: {
            repo: { type: "string", maxLength: 140 },
            url: { type: "string", maxLength: 240 },
            why_relevant: { type: "string", maxLength: 300 },
          },
        },
      },
      effort_summary: {
        type: "object",
        required: ["total_sprints", "team_size", "confidence_band"],
        properties: {
          total_sprints: { type: "integer", minimum: 1, maximum: 60 },
          team_size: { type: "integer", minimum: 1, maximum: 30 },
          confidence_band: {
            type: "string",
            maxLength: 60,
            description: "Phrase like '±20%' or 'low — improve scope first'.",
          },
        },
      },
    },
  },
};

export const ENGINEER_VIEW_SYSTEM_PROMPT = `You write the ENGINEERING build document for Aureon.

The reader is a senior engineer who will start work on day 1. They want concrete tech, concrete endpoints, concrete tables, concrete order.

Rules:
  - tech_stack per module names actual frameworks/libraries: 'Next.js 15', 'PostgreSQL', 'BullMQ', 'Stripe SDK', 'NextAuth.js'. Match the project's stated stack when given; otherwise pick a sensible default for the domain.
  - api_endpoints in 'METHOD /path — purpose' format. Aim for 3-8 per module unless clearly single-page UI.
  - database_sketch fields use 'name TYPE [constraints]'. Relations as 'FK <field> -> <table>.<field>'.
  - permissions_matrix uses 'resource:action' scopes ('modules:read', 'billing:write').
  - sprint_breakdown: each sprint focuses on a coherent vertical (auth + sessions, billing + webhooks, dashboard + queries). Use 2-week sprints. Story points target the team velocity table: solo=13, 2-3 people=26, 4-6=45.
  - third_party_checklist names the service + concrete prereq, not just 'Stripe'.
  - security_per_module is keyed by module name and lists the 2-5 concerns specific to that module (input validation, auth required, encryption at rest, rate limit, idempotency).
  - risks: CRITICAL = could block ship; WARNING = needs decision soon; NOTE = good to know.
  - effort_summary.confidence_band reflects the input's overall confidence: <60% = 'low — improve scope first', 60-80% = '±35%', >80% = '±20%'.
  - github_references list the 3-5 most relevant repos from the enrichment matches if any.

Always call submit_engineer_view exactly once. No free-form text.`;
