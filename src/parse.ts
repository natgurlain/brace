// A lossless JSON parser and formatter. Numbers keep their original text (so 2^53+ IDs and 0.10 survive), duplicate
// keys are kept in order, and errors carry a line and column. A plain (global) script: it is injected into JSON pages
// next to viewer.js and page.js, and loaded with a <script> tag by the paste page.

type BraceNode =
  | { kind: "object"; entries: { key: string; value: BraceNode }[] }
  | { kind: "array"; items: BraceNode[] }
  | { kind: "string"; value: string }
  | { kind: "number"; raw: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" };

interface BraceError {
  message: string;
  /** Character offset in the input. */
  offset: number;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

type BraceResult = { ok: true; value: BraceNode; count: number } | { ok: false; error: BraceError };

const BRACE_MAX_DEPTH = 5000;

/** Anti-hijacking prefixes some APIs put before JSON, e.g. )]}' (Google) or while(1); */
const BRACE_XSSI_PREFIX = /^\s*(\)\]\}'[^\n]*\n|while\s*\(1\);|for\s*\(;;\);)/;

function braceStripPrefix(text: string): string {
  return text.replace(/^﻿/, "").replace(BRACE_XSSI_PREFIX, "");
}

function braceParse(text: string): BraceResult {
  let i = 0;
  let count = 0;
  const n = text.length;

  class Failure extends Error {
    constructor(readonly at: number, message: string) {
      super(message);
    }
  }
  const fail = (message: string, at = i): never => {
    throw new Failure(at, message);
  };
  const describe = (at: number) => (at >= n ? "the end of the input" : `'${text[at]}'`);

  const skip = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else if (c === 47 && (text[i + 1] === "/" || text[i + 1] === "*")) fail("Comments are not allowed in JSON");
      else break;
    }
  };

  const parseString = (): string => {
    const start = ++i; // after the opening quote
    let out = "";
    let chunk = start;
    while (true) {
      if (i >= n) fail("Unterminated string", start - 1);
      const c = text.charCodeAt(i);
      if (c === 34) {
        out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (c < 32) fail(c === 10 ? "Line break inside a string (use \\n)" : "Control character inside a string");
      if (c === 92) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e !== undefined && e in simple) {
          out += simple[e];
          i += 2;
        } else if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape (needs 4 hex digits)");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          fail(`Invalid escape \\${e ?? ""}`);
        }
        chunk = i;
      } else {
        i++;
      }
    }
  };

  const parseNumber = (): string => {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") {
      i++;
      if (/[0-9]/.test(text[i] ?? "")) fail("Numbers can't have leading zeros");
    } else if (/[1-9]/.test(text[i] ?? "")) {
      while (/[0-9]/.test(text[i] ?? "")) i++;
    } else {
      fail(`Unexpected ${describe(i)}`);
    }
    if (text[i] === ".") {
      i++;
      if (!/[0-9]/.test(text[i] ?? "")) fail("Expected a digit after the decimal point");
      while (/[0-9]/.test(text[i] ?? "")) i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!/[0-9]/.test(text[i] ?? "")) fail("Expected a digit in the exponent");
      while (/[0-9]/.test(text[i] ?? "")) i++;
    }
    return text.slice(start, i);
  };

  const literal = (word: string): void => {
    if (text.startsWith(word, i)) i += word.length;
    else fail(`Unexpected ${describe(i)}`);
  };

  const parseValue = (depth: number): BraceNode => {
    if (depth > BRACE_MAX_DEPTH) fail("Nesting is too deep");
    skip();
    count++;
    const c = text[i];
    if (c === "{") {
      i++;
      const entries: { key: string; value: BraceNode }[] = [];
      skip();
      if (text[i] === "}") {
        i++;
        return { kind: "object", entries };
      }
      while (true) {
        skip();
        if (text[i] === "'") fail("Property names need double quotes, not single quotes");
        if (text[i] === "}") fail("Trailing comma is not allowed in JSON");
        if (text[i] === ",") fail("Unexpected ',' (extra comma?)");
        if (text[i] !== '"') fail(i >= n ? "Unexpected end of input inside an object" : "Property names must be in double quotes");
        const key = parseString();
        skip();
        if (text[i] !== ":") fail(`Expected ':' after the property name, found ${describe(i)}`);
        i++;
        entries.push({ key, value: parseValue(depth + 1) });
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return { kind: "object", entries };
        }
        fail(i >= n ? "Unexpected end of input: missing '}'" : `Expected ',' or '}', found ${describe(i)}`);
      }
    }
    if (c === "[") {
      i++;
      const items: BraceNode[] = [];
      skip();
      if (text[i] === "]") {
        i++;
        return { kind: "array", items };
      }
      while (true) {
        skip();
        if (text[i] === "]") fail("Trailing comma is not allowed in JSON");
        items.push(parseValue(depth + 1));
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return { kind: "array", items };
        }
        fail(i >= n ? "Unexpected end of input: missing ']'" : `Expected ',' or ']', found ${describe(i)}`);
      }
    }
    if (c === '"') return { kind: "string", value: parseString() };
    if (c === "'") fail("Strings need double quotes, not single quotes");
    if (c === "t") {
      literal("true");
      return { kind: "boolean", value: true };
    }
    if (c === "f") {
      literal("false");
      return { kind: "boolean", value: false };
    }
    if (c === "n") {
      literal("null");
      return { kind: "null" };
    }
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return { kind: "number", raw: parseNumber() };
    if (c === undefined) return fail(i === 0 || !text.trim() ? "The input is empty" : "Unexpected end of input");
    return fail(`Unexpected ${describe(i)}`);
  };

  try {
    const value = parseValue(0);
    skip();
    if (i < n) fail(`Unexpected ${describe(i)} after the end of the JSON value`);
    return { ok: true, value, count };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    const before = text.slice(0, error.at);
    const line = before.split("\n").length;
    const column = error.at - before.lastIndexOf("\n");
    return { ok: false, error: { message: error.message, offset: error.at, line, column } };
  }
}

/** JSON text for a node. `indent` "" minifies; otherwise e.g. "  ", "    " or "\t". Numbers are written as parsed. */
function braceStringify(node: BraceNode, indent = "  "): string {
  const out: string[] = [];
  const nl = indent ? "\n" : "";
  const colon = indent ? ": " : ":";
  const write = (value: BraceNode, pad: string): void => {
    switch (value.kind) {
      case "string":
        out.push(JSON.stringify(value.value));
        return;
      case "number":
        out.push(value.raw);
        return;
      case "boolean":
        out.push(String(value.value));
        return;
      case "null":
        out.push("null");
        return;
      case "array": {
        if (!value.items.length) return void out.push("[]");
        const inner = pad + indent;
        out.push("[", nl);
        value.items.forEach((item, index) => {
          out.push(inner);
          write(item, inner);
          if (index < value.items.length - 1) out.push(",");
          out.push(nl);
        });
        out.push(pad, "]");
        return;
      }
      case "object": {
        if (!value.entries.length) return void out.push("{}");
        const inner = pad + indent;
        out.push("{", nl);
        value.entries.forEach((entry, index) => {
          out.push(inner, JSON.stringify(entry.key), colon);
          write(entry.value, inner);
          if (index < value.entries.length - 1) out.push(",");
          out.push(nl);
        });
        out.push(pad, "}");
        return;
      }
    }
  };
  write(node, "");
  return out.join("");
}

/** Human-readable byte size. */
function braceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
