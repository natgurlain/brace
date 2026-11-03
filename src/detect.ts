// Runs on every page at document_end and does almost nothing: if the page is raw JSON (a JSON content type, or plain
// text that starts with { or [), it asks the background to inject the viewer. A plain script.
{
  const type = document.contentType;
  const jsonType = /[/+]json\b/i.test(type);
  if (jsonType || type === "text/plain") {
    const pre = document.body?.querySelector(":scope > pre");
    // Chrome shows raw text as a lone <pre> (plus its own "pretty print" control for JSON types).
    const onlyText = pre && [...document.body.children].every((child) => child === pre || !child.matches("pre, div:not([class*='json-formatter']), main, table"));
    const sample = pre?.textContent?.slice(0, 200).replace(/^﻿/, "").replace(/^\s*(\)\]\}'[^\n]*\n|while\s*\(1\);|for\s*\(;;\);)/, "").trimStart() ?? "";
    const looksJson = /^[[{]/.test(sample) || (jsonType && sample.length > 0);
    if (onlyText && looksJson && (pre.textContent?.length ?? 0) < 50 * 1024 * 1024) {
      void chrome.runtime.sendMessage({ type: "brace-render" });
    }
  }
}
