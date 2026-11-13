from pathlib import Path
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUT = Path(__file__).with_name("Aureon_Internship_Project_Report.docx")

NAVY = "17365D"
BLUE = "2F5597"
PALE = "EAF0F8"
LIGHT = "F5F7FA"
BORDER = "D9D9D9"
TEXT = RGBColor(34, 34, 34)
MUTED = RGBColor(90, 90, 90)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=BORDER, size="6"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        node = borders.find(tag)
        if node is None:
            node = OxmlElement(f"w:{edge}")
            borders.append(node)
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), size)
        node.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_font(run, name="Aptos", size=None, bold=None, color=None, italic=None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    if italic is not None:
        run.italic = italic
    return run


def add_field(run, instruction):
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])


def add_para(doc, text="", *, bold_lead=None, style=None, align=None, space_after=7):
    p = doc.add_paragraph(style=style)
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.15
    if bold_lead and text.startswith(bold_lead):
        set_font(p.add_run(bold_lead), bold=True, color=TEXT)
        set_font(p.add_run(text[len(bold_lead):]), color=TEXT)
    else:
        set_font(p.add_run(text), color=TEXT)
    return p


def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.1
        set_font(p.add_run(item), color=TEXT)


def add_numbered(doc, items):
    for number, item in enumerate(items, start=1):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.28)
        p.paragraph_format.first_line_indent = Inches(-0.28)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.1
        set_font(p.add_run(f"{number}."), bold=True, color=TEXT)
        set_font(p.add_run(f"  {item}"), color=TEXT)


def add_heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    p.paragraph_format.left_indent = Inches(0)
    p.paragraph_format.first_line_indent = Inches(0)
    p.paragraph_format.right_indent = Inches(0)
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(6)
    for r in p.runs:
        set_font(r, name="Aptos Display", color=RGBColor(0, 0, 0), bold=True)
    return p


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    hdr = table.rows[0]
    set_repeat_table_header(hdr)
    for i, label in enumerate(headers):
        cell = hdr.cells[i]
        if widths:
            cell.width = Inches(widths[i])
        set_cell_shading(cell, NAVY)
        set_cell_margins(cell)
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        set_font(p.add_run(label), size=9, bold=True, color=RGBColor(255, 255, 255))
    for ri, row in enumerate(rows):
        cells = table.add_row().cells
        for i, value in enumerate(row):
            cell = cells[i]
            if widths:
                cell.width = Inches(widths[i])
            set_cell_margins(cell)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            if ri % 2:
                set_cell_shading(cell, LIGHT)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            if i > 0 and len(str(value)) < 18:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_font(p.add_run(str(value)), size=8.6, color=TEXT)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(0.75)
sec.bottom_margin = Inches(0.82)
sec.left_margin = Inches(0.82)
sec.right_margin = Inches(0.82)

styles = doc.styles
styles["Normal"].font.name = "Aptos"
styles["Normal"]._element.rPr.rFonts.set(qn("w:ascii"), "Aptos")
styles["Normal"]._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos")
styles["Normal"].font.size = Pt(10.4)
styles["Normal"].paragraph_format.space_after = Pt(7)
styles["Normal"].paragraph_format.line_spacing = 1.15

for level, size in ((1, 17), (2, 13), (3, 11)):
    st = styles[f"Heading {level}"]
    st.font.name = "Aptos Display"
    st._element.rPr.rFonts.set(qn("w:ascii"), "Aptos Display")
    st._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos Display")
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor(0, 0, 0)

# Footer with project name and page number.
footer = sec.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(fp.add_run("Aureon Internship Project Report  |  "), size=8, color=MUTED)
page_run = fp.add_run()
set_font(page_run, size=8, color=MUTED)
add_field(page_run, "PAGE")

# Cover page.
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(45)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.add_run("INTERNSHIP PROJECT REPORT"), name="Aptos Display", size=14, bold=True, color=RGBColor(0, 0, 0))

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(22)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.add_run("Aureon"), name="Aptos Display", size=34, bold=True, color=RGBColor(0, 0, 0))

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.add_run("A Requirement Intelligence and Project Scoping Platform"), size=15, color=TEXT)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(26)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.add_run("Project Version 0.1.0"), size=10, bold=True, color=MUTED)

doc.add_paragraph().paragraph_format.space_before = Pt(40)
cover_rows = [
    ("Student Name", "[Enter your name]"),
    ("Register Number", "[Enter your register number]"),
    ("Institution", "[Enter your college or university]"),
    ("Organisation", "[Enter organisation]"),
    ("Internship Dates", "[Enter start and end dates]"),
    ("Project Guide", "[Enter guide or mentor name]"),
]
table = doc.add_table(rows=0, cols=2)
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.autofit = False
for left, right in cover_rows:
    cells = table.add_row().cells
    cells[0].width = Inches(1.75)
    cells[1].width = Inches(4.55)
    for c in cells:
        set_cell_margins(c, top=95, bottom=95)
    set_font(cells[0].paragraphs[0].add_run(left), size=10, bold=True, color=TEXT)
    set_font(cells[1].paragraphs[0].add_run(right), size=10, color=MUTED)
    cells[0].paragraphs[0].paragraph_format.space_after = Pt(0)
    cells[1].paragraphs[0].paragraph_format.space_after = Pt(0)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(38)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.add_run("October 2026"), size=11, color=TEXT)

doc.add_page_break()

add_heading(doc, "Project Overview", 1)
add_para(doc, "Aureon is a web-based requirement intelligence and project scoping platform. I built it to address a practical problem that appears before software development begins: client requirements are often incomplete, mixed with assumptions, or written without enough technical detail for estimation. The application takes a raw idea or requirements document and turns it into a structured scope that can be reviewed by both a client and an engineering team.")
add_para(doc, "The system does more than summarize text. It checks nine requirement areas, identifies what is present and what is missing, searches public GitHub repositories for useful implementation patterns, computes a confidence score using server-side rules, and asks focused clarification questions when the scope is not ready. When enough information is available, it generates two editable outputs: a client-facing scope and an engineer-facing implementation plan.")
add_para(doc, "My main conclusion from the project is that large language models are useful for interpretation and drafting, but they should not control every decision. In Aureon, the model extracts and explains information, while confidence, blockers, effort, risk rules, access control, rate limits, versioning, and validation remain deterministic application logic. This division made the application easier to test and reduced the effect of inconsistent model responses.")

add_heading(doc, "Objectives", 2)
add_bullets(doc, [
    "Convert vague or unstructured client input into an organized software scope.",
    "Check the project goal, users, features, stack, integrations, non-functional requirements, budget, timeline, and success criteria.",
    "Ask only the clarification questions that can materially improve the scope.",
    "Use public GitHub repositories as supporting evidence without allowing repository content to control the system.",
    "Produce separate client and engineering views with editable sections and export options.",
    "Preserve versions, approvals, share links, actual effort, and calibration data for future projects.",
    "Support local development with minimal setup while retaining a clear path to production deployment.",
])

add_heading(doc, "Scope of the Implemented System", 2)
add_para(doc, "The implemented application covers the full scoping workflow from input to versioned output. It includes text and document import, requirement extraction, GitHub enrichment, clarification rounds, deterministic scoring, final document generation, project history, sharing, approval, exports, and estimate calibration. Live collaboration, billing, vector search, and two-way issue-tracker synchronization are outside the current version.")

add_table(doc,
    ["Area", "Current state", "Comment"],
    [
        ("Requirement extraction", "Implemented", "Nine parameter states with evidence and gaps"),
        ("Clarification rounds", "Implemented", "MCQ, blocker question, and added description paths"),
        ("GitHub enrichment", "Implemented", "Lexical retrieval, README analysis, and folder mining"),
        ("Client and engineer views", "Implemented", "Editable, versioned, and exportable"),
        ("Accounts and workspaces", "Implemented", "Auth.js, Google login, and email magic link support"),
        ("Calibration", "Implemented", "Uses completed-project actuals after five eligible records"),
        ("Vector embeddings", "Not included", "The current retrieval approach is lexical"),
        ("Live co-editing", "Not included", "Sharing and approval are version based"),
        ("Self-service billing", "Not included", "No payment provider is required by Aureon itself"),
    ], [1.75, 1.2, 3.65])

add_heading(doc, "Problem Analysis and Design Approach", 1)
add_para(doc, "The central design problem was not simply generating a document. A useful scope must distinguish confirmed information from assumptions, stop when essential information is missing, and explain how its conclusions were reached. A plain chat interface could produce fluent text, but it would be difficult to measure, compare, or audit. I therefore represented the scope as validated structured data before generating any long-form output.")

add_heading(doc, "Requirement Model", 2)
add_para(doc, "Each round evaluates nine fixed parameters. Every parameter is marked as PRESENT, PARTIAL, or MISSING and includes evidence or a gap. The fixed model makes different projects comparable and supports deterministic scoring.")
add_table(doc,
    ["ID", "Parameter", "Purpose"],
    [
        ("P-01", "Project goal", "Defines the problem and intended outcome"),
        ("P-02", "Target users", "Identifies roles and affected user groups"),
        ("P-03", "Core features", "Defines the minimum functional scope"),
        ("P-04", "Technical constraints", "Captures stack, platform, and architecture choices"),
        ("P-05", "Integrations", "Records external systems and providers"),
        ("P-06", "Non-functional requirements", "Covers security, performance, accessibility, and reliability"),
        ("P-07", "Budget", "Provides a commercial delivery constraint"),
        ("P-08", "Timeline", "Sets the expected delivery window"),
        ("P-09", "Success criteria", "Defines measurable acceptance conditions"),
    ], [0.65, 2.05, 3.85])

add_heading(doc, "Why the Score Is Deterministic", 2)
add_para(doc, "The model reports clarity and structured evidence, but it does not decide its own confidence score. The server calculates confidence from coverage, extraction quality, consistency, and a small GitHub evidence bonus. Caps are applied when the project goal, users, core features, or technical constraints are missing. This prevents a fluent response from being mistaken for a complete scope.")
add_para(doc, "The same principle is used for blockers, risk classification, module confidence, effort points, velocity, sprint estimates, and exit rules. The language model writes explanations around these results, while application code remains the source of truth.")

add_heading(doc, "User Workflow", 2)
add_numbered(doc, [
    "The user pastes requirements or imports a TXT, Markdown, PDF, or DOCX file.",
    "The server extracts structured requirements and detects the project domain.",
    "The retrieval stage searches related GitHub repositories and mines useful module patterns.",
    "The server calculates confidence and determines whether the scope is ready, blocked, or needs clarification.",
    "The user answers focused questions or chooses to generate a lower-confidence draft.",
    "The application generates client and engineering documents in parallel.",
    "The user edits, exports, shares, approves, versions, and later records actual effort.",
])

add_heading(doc, "System Architecture", 1)
add_para(doc, "Aureon is implemented as a full-stack Next.js application. The browser handles the interactive workflow, while route handlers validate requests, enforce ownership, and queue background work. Postgres stores durable application data. Redis is used for short-lived coordination data such as locks, rate limits, caches, and live progress. In local development, PGlite and in-memory fallbacks allow the project to run without hosted infrastructure.")

add_table(doc,
    ["Layer", "Main components", "Responsibility"],
    [
        ("Presentation", "Next.js pages, React 19, Tailwind CSS, GSAP", "Chat, pipeline status, editing, project history, sharing, and analytics"),
        ("Application API", "App Router route handlers and Zod", "Validation, authorization, session operations, imports, exports, and job submission"),
        ("Pipeline", "Orchestrator, extraction, retrieval, scoring, clarification, finalization", "Converts input into structured and long-form outputs"),
        ("Model routing", "Gemini and OpenRouter adapters", "Routes main and fast tasks and supports provider fallback"),
        ("Background work", "QStash in production, Next.js after locally", "Runs model work without holding an HTTP request open"),
        ("Data", "Postgres, Drizzle ORM, PGlite", "Stores users, workspaces, projects, versions, shares, decisions, and actuals"),
        ("Coordination", "Upstash Redis or in-memory fallback", "Locks, rate limits, caches, budgets, and session events"),
        ("External retrieval", "GitHub REST API and Octokit", "Searches repositories, reads READMEs, and inspects source folders"),
    ], [1.2, 2.25, 3.15])

add_heading(doc, "Request and Job Flow", 2)
add_para(doc, "Long model calls are not executed inside the user-facing HTTP request. The run, answer, and finalize endpoints validate the request, acquire a per-session lock, persist the next state, and return HTTP 202. A background job continues the work. The browser receives stage changes through Server-Sent Events and falls back to polling when the stream is unavailable.")
add_para(doc, "In production, QStash delivers signed job requests to dedicated job routes. Locally, Next.js after() executes the job in the same process. Finalization is split into client and engineering jobs so one completed document can be displayed even if the other is still running. Session locks and idempotent job claims prevent duplicate button clicks or repeated deliveries from starting duplicate model work.")

add_heading(doc, "Storage Model", 2)
add_para(doc, "Durable records are stored in Postgres through Drizzle ORM. This includes accounts, workspaces, project sessions, extracted rounds, final output, immutable versions, approvals, share links, and actual effort. Redis does not act as the project database; it only stores data that may safely expire. Local development automatically uses a file-backed PGlite database when DATABASE_URL is absent.")

add_heading(doc, "Requirement Intelligence Pipeline", 1)
add_heading(doc, "Extraction", 2)
add_para(doc, "The first model call converts the user brief into a validated extraction object. Prompts require evidence for each parameter, domain information, modules, assumptions, open questions, and blocker status. Zod validates the tool output. If the response is truncated or invalid, the structured-call wrapper retries once with a repair instruction. Untrusted input is bounded before it enters the prompt.")

add_heading(doc, "GitHub Retrieval and Enrichment", 2)
add_para(doc, "The retrieval stage builds several search variants from the domain, important features, and stack hints. Results from the variants are combined, ranked using lexical signals, and narrowed before the system fetches README and folder information. BM25 is used to select the candidates that deserve deeper inspection. This approach provides useful references without requiring an embedding model or vector database.")
add_para(doc, "The original implementation deep-scored six READMEs per round. During live testing this created unnecessary latency and consumed the limited free-model quota quickly. I reduced the deep analysis to the two strongest candidates while keeping real folder evidence from the remaining repositories. One normal first round therefore uses about four model calls instead of up to eight. If GitHub's anonymous rate limit is exhausted, ranked search links are still returned with a clear search-only label.")

add_heading(doc, "Scoring and Clarification", 2)
add_para(doc, "After retrieval, the application merges supported module signals, calculates module confidence, and evaluates whether the project can move forward. A blocker is raised when the goal or core functionality is too unclear. Otherwise the server either marks the project ready or asks targeted multiple-choice questions. Clarification rounds are capped to avoid an endless conversation.")

add_heading(doc, "Final Documents", 2)
add_para(doc, "When the scope is ready, two background jobs generate different views of the same structured project. The client view uses accessible language and focuses on outcomes, modules, exclusions, and open items. The engineering view adds architecture, technical constraints, implementation modules, dependencies, risks, story points, sprint planning, and estimation details. The user can edit every section, and each saved change creates a version that can be compared with earlier versions.")

add_heading(doc, "Model Routing", 2)
add_para(doc, "The provider layer supports separate main and fast routes. Extraction, clarification, and final documents use the main route. GitHub README interpretation uses the fast route. Gemini and OpenRouter implement the same internal client interface, so pipeline code does not depend on provider-specific response formats. Tier-specific OpenRouter keys allow heavy and lightweight tasks to use different quotas, and an optional fallback provider can be tried when the selected provider fails.")

add_heading(doc, "Frontend and Interaction Design", 1)
add_para(doc, "The interface follows a dark blueprint visual style. The main screen keeps the requirements conversation in the larger content area and uses a compact pipeline panel on the left. The user always sees which stage is running, what has completed, and whether attention is required.")

add_heading(doc, "Progress Experience", 2)
add_para(doc, "An earlier version used a tall animated roadmap that occupied too much horizontal and vertical space. It looked decorative but made the actual brief difficult to read, and a long-running call appeared frozen. I replaced it with five compact stage cards, a progress bar, an elapsed timer, and an active-stage message. After 35 seconds the interface explains that free providers may be slow; after 90 seconds it reports that automatic retries are still running. This change does not hide latency, but it makes the system state understandable.")

add_heading(doc, "Animation Decisions", 2)
add_bullets(doc, [
    "Stage cards enter with a short staggered motion instead of a long page animation.",
    "Only the current stage receives a breathing highlight and pulse, which draws attention without making the whole page move.",
    "The progress bar changes smoothly when a server stage update arrives.",
    "Completed, pending, running, and error states use different icons and color treatments.",
    "The interface respects the reduced-motion operating-system preference.",
    "The desktop pipeline column is constrained to 320 to 360 pixels so the requirements remain readable.",
])

add_heading(doc, "Editing and Output Experience", 2)
add_para(doc, "Generated sections are editable rather than presented as a fixed answer. The application includes an unsaved-changes guard, local autosave behavior, section copy buttons, version comparison, sharing, approval or change requests, and exports to Markdown, PDF, Word, Jira CSV, and Linear CSV. Imported files are converted to text and placed back into the input box for review before a session is created.")

add_heading(doc, "Responsive Behavior", 2)
add_para(doc, "Desktop layouts use a fixed-width pipeline column and a flexible content area. On smaller screens the pipeline becomes a compact panel above the conversation. Inputs, question cards, dialogs, and export controls are designed for keyboard and touch use, although a complete accessibility audit and physical-device test pass are still required before production sign-off.")

doc.add_page_break()
add_heading(doc, "Security Privacy and Reliability", 1)
add_para(doc, "A project brief can contain confidential commercial information, so security controls are part of the application architecture rather than a final add-on. Server-side environment validation prevents unsupported production configurations. Secrets remain in server variables and are never placed in NEXT_PUBLIC settings.")

add_heading(doc, "Implemented Controls", 2)
add_table(doc,
    ["Control", "Implementation"],
    [
        ("Ownership", "Anonymous ownership cookies and signed-in workspace access checks"),
        ("Validation", "Zod schemas for API input, model output, stored data, and exports"),
        ("Concurrency", "Per-session locks and idempotent job claims"),
        ("Rate limiting", "Separate limits for general, model, import, share, and auth routes"),
        ("Content Security Policy", "Per-request nonce with additional response security headers"),
        ("Prompt safety", "Input length limits, delimiters, output validation, and untrusted README filtering"),
        ("Budget control", "Daily logical model-call counter with a server-side limit"),
        ("Retention", "Raw input is cleared after the configured inactive period; deletion is a hard delete"),
        ("Share safety", "Version-specific links, expiry and revocation support, and read-only access"),
        ("Production guard", "Refuses unsafe storage or free-model production setups unless explicitly allowed"),
    ], [1.7, 4.9])

add_heading(doc, "Privacy Behavior", 2)
add_para(doc, "Imported files are read in memory for one request and are not stored as files. The extracted text is shown to the user for correction before submission. Raw project input is retained separately from generated documents and can be cleared according to workspace retention settings. The privacy page lists the processors that may receive data, including the chosen model provider, GitHub, hosting, storage, queue, and email services.")

add_heading(doc, "Failure Handling", 2)
add_para(doc, "Model transport errors are converted into stored session errors with a retryable flag. Completed answers and enriched input are preserved so a retry does not start from zero. GitHub enrichment is non-fatal: a GitHub problem reduces the supporting evidence but does not prevent scope generation. Server-Sent Events fall back to polling, and stale jobs can be retried after the lock expires.")

doc.add_page_break()
add_heading(doc, "Testing and Results", 1)
add_para(doc, "I used unit, integration, browser, evaluation, and live smoke-test layers. Automated tests replace provider credentials with dummy values and block non-local network access, so the normal test suite cannot accidentally spend quota or send project text to an external service.")

add_table(doc,
    ["Test activity", "Result", "Evidence"],
    [
        ("TypeScript type check", "Passed", "tsc --noEmit completed without errors"),
        ("ESLint", "Passed", "Repository lint completed without errors"),
        ("Vitest suite", "Passed", "70 files and 1,035 tests passed on 23 October 2026"),
        ("Focused UI and routing tests", "Passed", "Pipeline, polling, GSAP, provider-routing, and adapter checks"),
        ("Live extraction", "Passed", "OpenRouter returned a valid structured extraction"),
        ("Live full scope round", "Passed", "17.4 seconds, ready state, confidence 91"),
        ("Live finalization", "Passed", "Client and engineering outputs completed in 72.6 seconds"),
        ("End-to-end smoke checks", "Passed", "10 of 10 checks passed; API responses stayed below two seconds"),
        ("Deep GitHub access", "Partially verified", "Search works; authenticated token is needed after anonymous quota is exhausted"),
        ("Production deployment", "Pending", "Requires hosted Postgres, Redis, durable queue, auth, and production provider settings"),
    ], [2.2, 1.25, 3.15])

add_heading(doc, "What the Automated Tests Cover", 2)
add_bullets(doc, [
    "Confidence calculation, blocker gates, effort estimation, risk rules, and module confidence.",
    "Provider routing, structured output repair, budgets, timeouts, and OpenRouter response conversion.",
    "GitHub query construction, BM25 ranking, request budgets, cache behavior, and untrusted README filtering.",
    "Session creation, ownership, authorization, rate limits, locks, background jobs, recovery, and retention.",
    "Imports, exports, sharing, approvals, version history, diffing, actuals, and calibration.",
    "Chat progress states, error messages, low-confidence generation, editing, autosave, and output controls.",
])

add_heading(doc, "Performance Observation", 2)
add_para(doc, "The first live round completed well within the 45-second smoke-test target. Finalization was slower because the engineering document is much larger and the free OpenRouter endpoint was busy. The client document completed first, while the engineering job continued independently. The results show that the background-job design works, but a stable production model tier is required for predictable latency.")

doc.add_page_break()
add_heading(doc, "Problems Encountered and Resolutions", 1)
add_table(doc,
    ["Problem", "Cause", "Resolution"],
    [
        ("AI service returned HTTP 500", "Provider denial, unavailable free model, quota pressure, or malformed tool output", "Added provider routing, tier-specific keys, fallback handling, strict tool validation, body timeout handling, and retries"),
        ("Pipeline appeared frozen", "A long free-provider call had no useful visible timing information", "Added stage-specific status, elapsed time, saved-progress messages, and clearer retry states"),
        ("One cycle used too many calls", "Six README analyses were added to extraction and clarification calls", "Reduced deep README analysis to two while preserving folder-based evidence"),
        ("GitHub enrichment returned no matches", "Anonymous GitHub request limit produced 403 responses for README and tree fetches", "Kept ranked search-only references and documented GITHUB_TOKEN for full enrichment"),
        ("Gemini key did not work", "The related Google project was denied API access", "Moved local testing to OpenRouter without changing pipeline code"),
        ("Free model returned protocol variations", "Some models returned JSON as content instead of a formal tool call", "Added conservative JSON recovery followed by the same schema validation"),
        ("Long requests risked duplicate work", "Retries, double clicks, and at-least-once queue delivery can repeat a job", "Used session locks, job claims, stored stages, and idempotent decisions"),
    ], [1.65, 2.2, 2.75])

add_heading(doc, "Key Learning", 2)
add_para(doc, "The most important lesson was that model quality is only one part of an AI-enabled application. Reliability depended more on timeouts, structured validation, state persistence, clear failure messages, quotas, provider behavior, and deterministic business rules. I also learned that an animated loading screen is not enough; users need to know what the system is doing, how long it has been running, and whether their progress is safe.")

doc.add_page_break()
add_heading(doc, "Limitations and Future Work", 1)
add_heading(doc, "Current Limitations", 2)
add_bullets(doc, [
    "Free provider latency and availability are inconsistent, so the present local configuration is suitable for testing rather than a production service-level target.",
    "GitHub anonymous access is limited to 60 requests per hour. Repeated deep testing needs an authenticated token.",
    "The retrieval layer is lexical and has no semantic vector index.",
    "Scanned image-only PDFs are not processed because OCR is not implemented.",
    "Jira and Linear support is export-only; there is no ongoing synchronization.",
    "Sharing supports approval decisions but not simultaneous collaborative editing or comments.",
    "The evaluation dataset contains draft labels and still needs review with a mentor or domain expert.",
    "A full accessibility audit and physical-phone test pass are pending.",
])

add_heading(doc, "Recommended Next Steps", 2)
add_numbered(doc, [
    "Add a read-only GitHub personal access token and record a repeatable retrieval baseline.",
    "Use a stable paid or reserved-capacity model for production latency and availability tests.",
    "Deploy a staging environment with Postgres, Upstash Redis, QStash, HTTPS, and at least one sign-in method.",
    "Run the complete Playwright browser suite and test the application on a physical phone.",
    "Review the 30 evaluation cases with the project guide, then run the real provider evaluation and record accuracy, latency, and cost.",
    "Correct and verify the scheduled retention integration in staging before relying on automated cleanup.",
    "Add OCR only if scanned client documents are a real project requirement.",
    "Collect actual delivery data from at least five completed projects to validate the calibration loop.",
])

add_heading(doc, "Conclusion", 1)
add_para(doc, "Aureon demonstrates a complete workflow for turning uncertain requirements into a reviewable software scope. The project combines a modern full-stack application, structured model calls, public-code retrieval, deterministic scoring, background processing, secure storage, editable outputs, and a substantial automated test suite.")
add_para(doc, "The implementation is functional for internal testing. The live pipeline completed successfully with the current OpenRouter routing, and the automated baseline now passes 1,035 tests. The remaining work is mainly operational: authenticated GitHub access, stable production model capacity, hosted infrastructure, browser and device testing, and a reviewed real-provider evaluation baseline.")
add_para(doc, "From an engineering perspective, the project met its main objective. It does not treat generated text as the product by itself. It builds a controlled process around that text so users can understand what is known, what is missing, why a decision was made, and how the scope changes over time.")

doc.add_page_break()
add_heading(doc, "Appendix A Local Setup", 1)
add_para(doc, "The minimum local development environment requires Node.js 22 or newer, the project dependencies, and one working model provider key. PGlite, in-memory rate limiting, and local after() jobs are used automatically when hosted services are absent.")
add_numbered(doc, [
    "Install dependencies with npm install.",
    "Copy .env.example to .env.local.",
    "Configure LLM_PROVIDER and a valid server-side provider key.",
    "Optionally add GITHUB_TOKEN for repeated GitHub enrichment tests.",
    "Start the application with npm run dev -- --port 3210.",
    "Open http://localhost:3210/chat and submit a detailed project brief.",
])

add_heading(doc, "Minimum Testing Commands", 2)
commands = [
    "npm run typecheck",
    "npm run lint",
    "npm test",
    "npm run build",
    "$env:SCOPEAI_BASE_URL='http://localhost:3210'; npx tsx scripts/test-flow.ts",
]
for command in commands:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.28)
    p.paragraph_format.space_after = Pt(4)
    set_font(p.add_run(command), name="Consolas", size=9.2, color=TEXT)

doc.add_page_break()
add_heading(doc, "Appendix B Main Technologies", 1)
add_table(doc,
    ["Technology", "Use in the project"],
    [
        ("Next.js 16.3.8", "Full-stack routing, server rendering, route handlers, and local background work"),
        ("React 19.2.4", "Interactive chat, editing, project views, and progress UI"),
        ("TypeScript", "Strict types across client, server, schemas, and tests"),
        ("Tailwind CSS 4", "Responsive layout and visual styling"),
        ("GSAP and Framer Motion", "Stage transitions and interface motion"),
        ("Zod 4", "Runtime validation of requests, model outputs, configuration, and stored data"),
        ("Drizzle ORM", "Typed Postgres schema and database access"),
        ("PGlite", "File-backed local Postgres fallback"),
        ("Upstash Redis and QStash", "Distributed coordination and durable production jobs"),
        ("Octokit", "GitHub repository search and content access"),
        ("Vitest and Playwright", "Unit, integration, and browser testing"),
    ], [2.0, 4.6])

# Keep metadata neutral and do not expose a workstation user name.
doc.core_properties.title = "Aureon Internship Project Report"
doc.core_properties.subject = "Requirement intelligence and project scoping platform"
doc.core_properties.author = "Student"
doc.core_properties.keywords = "Aureon, internship, Next.js, project scoping, requirement analysis"

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print(OUT)
