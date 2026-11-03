// The paste-and-format page: input on the left, a tree or formatted text on the right, validated as you type.
// Parsing and the tree come from parse.js and viewer.js (global scripts loaded before this module).

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>("input");

type View = "tree" | "text";
type Indent = "2" | "4" | "tab" | "min";

let view: View = (read("view") as View) ?? "tree";
let indent: Indent = (read("indent") as Indent) ?? "2";
let parsed: BraceResult | null = null;
let viewer: BraceViewer | null = null;
let timer = 0;
let noticeTimer = 0;

const SAMPLE = `{"user":{"id":12345678901234567890,"name":"Ada Lovelace","email":"ada@example.com","verified":true,"profile":"https://example.com/ada"},"plan":{"name":"Pro","price":9.90,"currency":"EUR","renews":"2026-12-01T00:00:00Z"},"projects":[{"id":1,"name":"Analytical Engine","stars":1843,"tags":["math","history"],"archived":false},{"id":2,"name":"Notes on the Engine","stars":962,"tags":["writing"],"archived":false},{"id":3,"name":"Bernoulli numbers","stars":407,"tags":[],"archived":true}],"limits":{"requests_per_minute":600,"burst":null}}`;

// localStorage holds the draft and view choices; it can be unavailable, so every access is guarded.
function read(key: string): string | null {
  try {
    return localStorage.getItem(`brace:${key}`);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(`brace:${key}`, value);
  } catch {
    // Too large or unavailable: the draft just isn't remembered.
  }
}

function indentText(): string {
  return indent === "tab" ? "\t" : indent === "min" ? "" : " ".repeat(Number(indent));
}

function notice(message: string): void {
  const path = $("path");
  path.textContent = message;
  path.classList.add("notice");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    path.textContent = "";
    path.classList.remove("notice");
  }, 1800);
}

function update(): void {
  const text = input.value;
  write("draft", text.length < 2_000_000 ? text : "");
  const status = $("status");
  const statusText = $("status-text");
  status.querySelector("button")?.remove();

  if (!text.trim()) {
    parsed = null;
    status.className = "status";
    statusText.textContent = "Waiting for JSON";
    render();
    return;
  }
  parsed = braceParse(braceStripPrefix(text));
  if (parsed.ok) {
    status.className = "status valid";
    statusText.textContent = `Valid JSON · ${braceSize(new Blob([text]).size)} · ${parsed.count.toLocaleString()} values`;
  } else {
    const { message, line, column, offset } = parsed.error;
    status.className = "status invalid";
    statusText.textContent = `Line ${line}, column ${column}: ${message}`;
    const jump = document.createElement("button");
    jump.className = "btn sm";
    jump.textContent = "Show me";
    jump.addEventListener("click", () => select(offset + (text.length - braceStripPrefix(text).length), line));
    status.append(jump);
  }
  render();
}

/** Selects the character at `offset` in the input and scrolls its line into view. */
function select(offset: number, line: number): void {
  input.focus();
  input.setSelectionRange(offset, Math.min(offset + 1, input.value.length));
  const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 20;
  input.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

function render(): void {
  for (const button of $("view").querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-pressed", String(button.dataset.view === view));
  for (const button of $("indent").querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-pressed", String(button.dataset.indent === indent));
  const ok = parsed?.ok === true;
  $("empty").hidden = ok;
  $("tree-host").hidden = !ok || view !== "tree";
  $("text-out").hidden = !ok || view !== "text";
  $("tree-tools").hidden = view !== "tree";
  $("indent").hidden = view !== "text";
  document.querySelector<HTMLElement>(".spacer")!.hidden = view === "tree";
  for (const id of ["copy", "download", "apply"]) $<HTMLButtonElement>(id).disabled = !ok;
  $("empty").lastChild!.textContent = parsed && !parsed.ok ? "Fix the error on the left to see the result." : "Your formatted JSON shows up here.";
  if (!parsed?.ok) {
    viewer = null;
    return;
  }
  if (view === "tree") {
    viewer = braceMountViewer($("tree-host"), parsed.value, parsed.count, {
      onPath: (path) => {
        if (!$("path").classList.contains("notice")) $("path").textContent = path;
      },
      onNotice: notice,
    });
    const query = search.input.value;
    if (query.trim()) search.input.dispatchEvent(new Event("input"));
  } else {
    $("text-out").textContent = braceStringify(parsed.value, indentText());
  }
}

function output(): string {
  return parsed?.ok ? braceStringify(parsed.value, view === "text" ? indentText() : "  ") : "";
}

function load(text: string): void {
  input.value = text;
  update();
}

async function openFile(file: File): Promise<void> {
  load(await file.text());
  notice(`Opened ${file.name}`);
}

const search = braceSearchBox(() => viewer);
$("tree-tools").append(search.root);

input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(update, input.value.length > 1_000_000 ? 450 : 150);
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && parsed?.ok) {
    event.preventDefault();
    load(braceStringify(parsed.value, indentText() || "  "));
    notice("Formatted the input");
  } else if (event.key === "Tab" && !event.metaKey && !event.ctrlKey) {
    // Indent inside the editor instead of leaving it; execCommand keeps undo working.
    event.preventDefault();
    document.execCommand("insertText", false, "  ");
  }
});

$("view").addEventListener("click", (event) => {
  const next = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.view as View | undefined;
  if (!next || next === view) return;
  view = next;
  write("view", view);
  render();
});
$("indent").addEventListener("click", (event) => {
  const next = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.indent as Indent | undefined;
  if (!next) return;
  indent = next;
  write("indent", indent);
  render();
});
$("copy").addEventListener("click", () => void braceCopy(output()).then(() => notice("Copied")));
$("download").addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([output()], { type: "application/json" }));
  link.download = "formatted.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$("apply").addEventListener("click", () => {
  if (!parsed?.ok) return;
  load(output());
  notice("Input replaced");
});
$("sample").addEventListener("click", () => load(SAMPLE));
$("clear").addEventListener("click", () => {
  load("");
  input.focus();
});
$("open").addEventListener("click", () => $<HTMLInputElement>("file").click());
$<HTMLInputElement>("file").addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void openFile(file);
});

// Drop a file anywhere on the page.
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  $("drop").hidden = false;
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("drop").hidden = true;
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("drop").hidden = true;
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

load(read("draft") ?? "");
if (!input.value) input.focus();
