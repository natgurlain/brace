// The collapsible JSON tree shared by JSON pages and the paste page. Containers render their children only when
// expanded, and long arrays/objects render in chunks, so multi-megabyte documents stay responsive. Click a key to copy
// its path, a value to copy the value; search highlights matches and expands to them. A plain (global) script.

interface BraceViewerOptions {
  /** Called with the path of the row under the pointer ("" when leaving). */
  onPath?: (path: string) => void;
  /** Short confirmation messages ("Copied path"). */
  onNotice?: (message: string) => void;
}

interface BraceViewer {
  expandAll(): boolean;
  collapseAll(): void;
  expandLevels(levels: number): void;
  /** Highlights matches and jumps to the first; returns how many were found (capped). */
  search(query: string): number;
  /** Moves to the next (+1) or previous (-1) match; returns its 1-based position. */
  step(direction: 1 | -1): number;
}

/** Children rendered per batch; the rest sit behind a "Show more" row. */
const BRACE_CHUNK = 250;
const BRACE_MAX_MATCHES = 2000;
/** Above this many values, "Expand all" stops at a few levels to keep the page responsive. */
const BRACE_EXPAND_ALL_LIMIT = 50_000;

/** Path of a child, JavaScript-style: items[3].name, or ["odd key"] when the key isn't an identifier. */
function bracePath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return parent ? `${parent}.${key}` : key;
  return `${parent}[${JSON.stringify(key)}]`;
}

/** Copies text, falling back to execCommand on plain-http pages where the async clipboard isn't available. */
async function braceCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function braceMountViewer(root: HTMLElement, doc: BraceNode, count: number, options: BraceViewerOptions = {}): BraceViewer {
  interface Place {
    node: BraceNode;
    key: string | number | null;
    path: string;
    depth: number;
    last: boolean;
  }
  type Container = Extract<BraceNode, { kind: "object" | "array" }>;
  const isContainer = (node: BraceNode): node is Container => node.kind === "object" || node.kind === "array";
  const size = (node: Container) => (node.kind === "object" ? node.entries.length : node.items.length);
  const childAt = (node: Container, index: number): { key: string | number; value: BraceNode } =>
    node.kind === "object" ? { key: node.entries[index]!.key, value: node.entries[index]!.value } : { key: index, value: node.items[index]! };

  const expanded = new Set<BraceNode>();
  const shown = new Map<BraceNode, number>();
  const places = new WeakMap<Element, Place>();
  const wrappers = new Map<BraceNode, HTMLElement>();
  let query = "";
  let matches: { node: BraceNode; chain: { parent: Container; index: number }[] }[] = [];
  let current = -1;
  const matchSet = new Set<BraceNode>();

  // Start open: two levels for normal documents, just the root for very large ones.
  const openTo = count > 20_000 ? 1 : count > 2_000 ? 2 : 3;
  walk((node, depth) => {
    if (depth < openTo) expanded.add(node);
  });

  function walk(visit: (node: Container, depth: number) => void): void {
    const stack: [BraceNode, number][] = [[doc, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop()!;
      if (!isContainer(node)) continue;
      visit(node, depth);
      for (let i = size(node) - 1; i >= 0; i--) stack.push([childAt(node, i).value, depth + 1]);
    }
  }

  const el = (tag: string, className: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** Text with the search query wrapped in <mark>. */
  const marked = (className: string, text: string): HTMLElement => {
    const span = el("span", className);
    const lower = query ? text.toLowerCase() : "";
    let from = 0;
    if (query) {
      for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, at + query.length)) {
        span.append(text.slice(from, at), el("mark", "b-mark", text.slice(at, at + query.length)));
        from = at + query.length;
      }
    }
    span.append(text.slice(from));
    return span;
  };

  function primitive(node: BraceNode): HTMLElement {
    switch (node.kind) {
      case "string": {
        const shownText = JSON.stringify(node.value);
        if (/^https?:\/\/\S+$/.test(node.value)) {
          const link = marked("b-value b-string", shownText) as HTMLElement;
          const a = document.createElement("a");
          a.href = node.value;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.className = "b-link";
          a.append(...link.childNodes);
          link.append(a);
          return link;
        }
        return marked("b-value b-string", shownText);
      }
      case "number":
        return marked("b-value b-number", node.raw);
      case "boolean":
        return marked("b-value b-boolean", String(node.value));
      case "null":
        return marked("b-value b-null", "null");
      default:
        return el("span", "");
    }
  }

  function render(place: Place): HTMLElement {
    const { node, key, depth, last } = place;
    const wrapper = el("div", "b-node");
    const row = el("div", "b-row");
    if (matchSet.has(node)) row.classList.add("b-hit");
    places.set(row, place);
    wrappers.set(node, wrapper);

    if (isContainer(node)) {
      const open = expanded.has(node);
      const caret = el("button", "b-caret");
      caret.setAttribute("aria-expanded", String(open));
      caret.setAttribute("aria-label", open ? "Collapse" : "Expand");
      row.append(caret);
    } else {
      row.append(el("span", "b-caret-space"));
    }
    if (key !== null) {
      row.append(typeof key === "number" ? el("span", "b-index", String(key)) : marked("b-key", JSON.stringify(key)), el("span", "b-punc", ": "));
    }

    if (!isContainer(node)) {
      row.append(primitive(node));
      if (!last) row.append(el("span", "b-punc", ","));
      wrapper.append(row);
      return wrapper;
    }

    const [openBracket, closeBracket] = node.kind === "object" ? ["{", "}"] : ["[", "]"];
    const total = size(node);
    const label = node.kind === "object" ? `${total} ${total === 1 ? "key" : "keys"}` : `${total} ${total === 1 ? "item" : "items"}`;
    if (!expanded.has(node) || total === 0) {
      row.append(el("span", "b-punc", openBracket));
      if (total) row.append(el("span", "b-summary", ` ${label} `));
      row.append(el("span", "b-punc", closeBracket + (last ? "" : ",")));
      wrapper.append(row);
      return wrapper;
    }

    row.append(el("span", "b-punc", openBracket), el("span", "b-count", label));
    const children = el("div", "b-children");
    const limit = Math.min(total, shown.get(node) ?? BRACE_CHUNK);
    for (let i = 0; i < limit; i++) {
      const child = childAt(node, i);
      children.append(render({ node: child.value, key: child.key, path: bracePath(place.path, child.key), depth: depth + 1, last: i === total - 1 }));
    }
    if (limit < total) {
      const more = el("button", "b-more", `Show ${Math.min(BRACE_CHUNK, total - limit).toLocaleString()} more · ${(total - limit).toLocaleString()} left`);
      more.addEventListener("click", () => {
        shown.set(node, limit + BRACE_CHUNK);
        rerender(node);
      });
      children.append(more);
    }
    const close = el("div", "b-row b-close");
    close.append(el("span", "b-caret-space"), el("span", "b-punc", closeBracket + (last ? "" : ",")));
    wrapper.append(row, children, close);
    return wrapper;
  }

  function rerender(node: BraceNode): void {
    const old = wrappers.get(node);
    const place = old && places.get(old.firstElementChild!);
    if (!old || !place) return renderAll();
    old.replaceWith(render(place));
  }

  function renderAll(): void {
    wrappers.clear();
    root.replaceChildren(render({ node: doc, key: null, path: "", depth: 0, last: true }));
  }

  function toggle(node: BraceNode): void {
    if (expanded.has(node)) expanded.delete(node);
    else expanded.add(node);
    rerender(node);
  }

  function copyValue(node: BraceNode): string {
    if (node.kind === "string") return node.value;
    return braceStringify(node, "  ");
  }

  root.classList.add("b-tree");
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("a")) return;
    const row = target.closest(".b-row");
    const place = row && places.get(row);
    if (!place) return;
    if (target.closest(".b-caret") || target.closest(".b-summary") || target.closest(".b-count")) {
      toggle(place.node);
    } else if (target.closest(".b-key, .b-index")) {
      void braceCopy(place.path || "(root)").then(() => options.onNotice?.(`Copied path ${place.path || "(root)"}`));
    } else if (target.closest(".b-value")) {
      void braceCopy(copyValue(place.node)).then(() => options.onNotice?.("Copied value"));
    }
  });
  root.addEventListener("mouseover", (event) => {
    const row = (event.target as HTMLElement).closest(".b-row");
    const place = row && places.get(row);
    options.onPath?.(place ? place.path || "(root)" : "");
  });
  root.addEventListener("mouseleave", () => options.onPath?.(""));

  function reveal(index: number): void {
    const match = matches[index];
    if (!match) return;
    for (const { parent, index: childIndex } of match.chain) {
      expanded.add(parent);
      if (childIndex >= (shown.get(parent) ?? BRACE_CHUNK)) shown.set(parent, Math.ceil((childIndex + 1) / BRACE_CHUNK) * BRACE_CHUNK);
    }
    renderAll();
    const row = wrappers.get(match.node)?.querySelector(".b-row");
    root.querySelector(".b-current")?.classList.remove("b-current");
    row?.classList.add("b-current");
    row?.scrollIntoView({ block: "center" });
  }

  renderAll();

  return {
    expandAll() {
      const limited = count > BRACE_EXPAND_ALL_LIMIT;
      walk((node, depth) => {
        if (!limited || depth < 4) expanded.add(node);
      });
      renderAll();
      return !limited;
    },
    collapseAll() {
      expanded.clear();
      expanded.add(doc);
      renderAll();
    },
    expandLevels(levels) {
      expanded.clear();
      walk((node, depth) => {
        if (depth < levels) expanded.add(node);
      });
      renderAll();
    },
    search(text) {
      query = text.trim().toLowerCase();
      matches = [];
      matchSet.clear();
      current = -1;
      if (query) {
        const stack: { node: BraceNode; key: string | number | null; chain: { parent: Container; index: number }[] }[] = [{ node: doc, key: null, chain: [] }];
        while (stack.length && matches.length < BRACE_MAX_MATCHES) {
          const { node, key, chain } = stack.pop()!;
          const keyHit = typeof key === "string" && key.toLowerCase().includes(query);
          const valueText = node.kind === "string" ? JSON.stringify(node.value) : node.kind === "number" ? node.raw : node.kind === "boolean" ? String(node.value) : node.kind === "null" ? "null" : "";
          if (keyHit || (valueText && valueText.toLowerCase().includes(query))) {
            matches.push({ node, chain });
            matchSet.add(node);
          }
          if (isContainer(node)) {
            for (let i = size(node) - 1; i >= 0; i--) {
              const child = childAt(node, i);
              stack.push({ node: child.value, key: child.key, chain: [...chain, { parent: node, index: i }] });
            }
          }
        }
      }
      if (matches.length) {
        current = 0;
        reveal(0);
      } else {
        renderAll();
      }
      return matches.length;
    },
    step(direction) {
      if (!matches.length) return 0;
      current = (current + direction + matches.length) % matches.length;
      reveal(current);
      return current + 1;
    },
  };
}

/** Search field with a match counter and previous/next buttons; Enter / Shift+Enter step, Escape clears. */
function braceSearchBox(getViewer: () => BraceViewer | null): { root: HTMLElement; input: HTMLInputElement } {
  const root = document.createElement("div");
  root.className = "b-search";
  root.innerHTML =
    '<svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
    '<input class="input" type="search" placeholder="Search" spellcheck="false" aria-label="Search">' +
    '<div class="b-search-nav"><span class="b-search-count"></span>' +
    '<button type="button" aria-label="Previous match">↑</button><button type="button" aria-label="Next match">↓</button></div>';
  const input = root.querySelector("input")!;
  const counter = root.querySelector<HTMLElement>(".b-search-count")!;
  const [prev, next] = root.querySelectorAll("button");
  let total = 0;
  let timer = 0;
  const show = (position: number) => (counter.textContent = input.value.trim() ? (total ? `${position}/${total >= BRACE_MAX_MATCHES ? `${total}+` : total}` : "0") : "");
  const run = () => {
    total = getViewer()?.search(input.value) ?? 0;
    show(total ? 1 : 0);
  };
  const step = (direction: 1 | -1) => {
    if (total) show(getViewer()?.step(direction) ?? 0);
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 180);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") step(event.shiftKey ? -1 : 1);
    if (event.key === "Escape") {
      input.value = "";
      run();
    }
  });
  prev!.addEventListener("click", () => step(-1));
  next!.addEventListener("click", () => step(1));
  return { root, input };
}
