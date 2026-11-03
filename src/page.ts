// Injected into a page whose body is raw JSON (see detect.ts and background.ts). Replaces the plain text with the
// Brace viewer: tree / raw toggle, search, expand and collapse, copy and download, and the path under the pointer.
// Invalid JSON keeps its text, with the problem marked. A plain (global) script, run after parse.js and viewer.js.
{
  const marker = window as unknown as { braceRendered?: boolean };
  if (!marker.braceRendered) {
    marker.braceRendered = true;
    const original = (document.querySelector("body > pre") ?? document.body).textContent ?? "";
    const text = braceStripPrefix(original);
    const result = braceParse(text);
    const fileName = decodeURIComponent(location.pathname.split("/").pop() || "") || "data.json";

    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", content?: string) => {
      const node = document.createElement(tag);
      node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    };
    const button = (label: string, title: string, onClick: () => void, className = "btn sm ghost") => {
      const b = h("button", className, label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", onClick);
      return b;
    };

    let noticeTimer = 0;
    const status = h("span", "bp-path");
    const hint = "Click a key to copy its path, a value to copy the value";
    const notice = (message: string) => {
      status.textContent = message;
      status.classList.add("bp-notice");
      status.classList.remove("bp-mono");
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        status.classList.remove("bp-notice");
        status.textContent = hint;
      }, 1800);
    };
    status.textContent = hint;

    const treeHost = h("div", "bp-tree");
    const raw = h("pre", "b-raw bp-raw");
    let viewer: BraceViewer | null = null;

    const app = h("div", "bp");
    const bar = h("header", "bp-bar");
    const brand = h("span", "brand");
    const logo = h("span", "logo");
    // Relative URLs in injected CSS resolve against the website, so point at the extension's icon directly.
    logo.style.backgroundImage = `url(${chrome.runtime.getURL("icons/on-48.png")})`;
    brand.append(logo, "Brace");
    bar.append(brand);

    const views = h("div", "segmented");
    const tabs = (["Tree", "Raw"] as const).map((name) => {
      const tab = button(name, `${name} view`, () => setView(name), "");
      views.append(tab);
      return tab;
    });
    const setView = (name: "Tree" | "Raw") => {
      tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.textContent === name)));
      treeHost.hidden = name !== "Tree";
      raw.hidden = name !== "Raw";
      treeTools.hidden = name !== "Tree";
    };
    bar.append(views);

    const treeTools = h("div", "bp-tools");
    const search = braceSearchBox(() => viewer);
    treeTools.append(
      search.root,
      button("Expand all", "Expand everything", () => {
        if (viewer && !viewer.expandAll()) notice("Large file: expanded the first 4 levels");
      }),
      button("Collapse", "Collapse to the top level", () => viewer?.collapseAll()),
    );
    bar.append(treeTools, h("span", "bp-spacer"));

    const main = h("main", "bp-main");
    if (result.ok) {
      bar.append(
        button("Copy", "Copy formatted JSON", () => void braceCopy(braceStringify(result.value, "  ")).then(() => notice("Copied formatted JSON"))),
        button("Download", `Download ${fileName}`, () => {
          const link = h("a");
          link.href = URL.createObjectURL(new Blob([braceStringify(result.value, "  ")], { type: "application/json" }));
          link.download = fileName.endsWith(".json") ? fileName : `${fileName}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        }),
        h("span", "bp-info", `${braceSize(new Blob([original]).size)} · ${result.count.toLocaleString()} values`),
      );
      raw.textContent = original;
      viewer = braceMountViewer(treeHost, result.value, result.count, {
        onPath: (path) => {
          if (status.classList.contains("bp-notice")) return;
          status.textContent = path || hint;
          status.classList.toggle("bp-mono", !!path);
        },
        onNotice: notice,
      });
      main.append(treeHost, raw);
    } else {
      // Keep the text, mark the exact spot, and explain.
      const { message, line, column, offset } = result.error;
      const at = offset + (original.length - text.length);
      const mark = h("span", "b-error-mark", original.slice(at, at + 1) || " ");
      raw.append(original.slice(0, at), mark, original.slice(at + 1));
      const banner = h("div", "b-error");
      banner.append(h("b", "", "Invalid JSON"), h("span", "", `Line ${line}, column ${column}: ${message}. `));
      const jump = button("Show", "Scroll to the problem", () => mark.scrollIntoView({ block: "center" }), "");
      banner.append(jump);
      main.append(banner, raw);
      tabs[0]!.disabled = true;
      status.textContent = "Fix the JSON at the marked spot to see the tree";
    }

    const foot = h("footer", "bp-status");
    foot.append(status, h("span", "bp-keys", ""));
    foot.lastElementChild!.innerHTML = '<span class="kbd">/</span> search · <span class="kbd">↵</span> next match';
    app.append(bar, main, foot);

    document.documentElement.classList.add("bp-root");
    document.body.replaceChildren(app);
    document.title = `${fileName} · Brace`;
    setView(result.ok ? "Tree" : "Raw");

    document.addEventListener("keydown", (event) => {
      const typing = (event.target as HTMLElement).closest("input, textarea");
      if (event.key === "/" && !typing && result.ok) {
        event.preventDefault();
        setView("Tree");
        search.input.focus();
      }
    });
  }
}
