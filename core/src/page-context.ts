/**
 * What the page says around the form: the job description beside a Greenhouse application, the
 * introduction at the top of a Google Form. A long answer is written for someone ("why Glean?"),
 * and this is the only place that says who, and what they asked for.
 *
 * It is context, never evidence: a draft may use it to name the company or echo what the role asks,
 * but every claim about the person must stand on their own words (draft.ts). So this errs on the
 * side of leaving things out:
 *   - never the form's own questions, options or help text — that is the form, not the page;
 *   - never navigation, headers, footers, cookie banners, or our own panel and badges;
 *   - never anything hidden, and never the text inside a control.
 *
 * Read as blocks — headings, paragraphs, list items — in page order, each once, capped. A form in
 * another origin's frame reads only its own frame; the extension asks the top frame for this.
 */

import { deepQueryAll } from "./dom-path";
import type { FormRead } from "./types";

export type PageContext = {
  /** The page's own title, without the site's name. */
  title: string;
  /** The page's prose, block by block, in order. */
  text: string;
};

/** Enough for a model to know the company and the role; a long description is cut, not summarised. */
export const PAGE_CONTEXT_MAX = 4000;

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,dd,dt,blockquote,[role='heading']";
/** Places that are about the site, not this page. */
const CHROME = "nav,header,footer,[role='navigation'],[role='banner'],[role='contentinfo'],[aria-modal='true'],dialog";
/** Controls, and anything that is ours. */
const NOT_PROSE = "input,select,textarea,button,option,label,legend,[role='option'],[role='listbox'],[role='combobox'],[role='radiogroup'],[role='button'],[contenteditable='true'],script,style,noscript,template";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Not the page's content: hidden, or floating over it — a cookie banner, a chat bubble, a sticky
 * "Apply" bar are fixed to the screen, and none of them says who is asking.
 */
function notContent(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  for (let at: Element | null = el; at; at = at.parentElement) {
    const style = view?.getComputedStyle(at);
    if (!style) break;
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return true;
    if (at.getAttribute("aria-hidden") === "true") return true;
  }
  return el.getClientRects().length === 0;
}

/** Any control at all — a file upload the reader skips is still the form's, and so is its text. */
const CONTROL = "input,select,textarea,button,[role='combobox'],[role='listbox'],[role='radiogroup'],[contenteditable='true']";

/** Inside the form itself, only prose: its section titles ("Links", "Education (Optional)") are its own furniture. */
const FORM_PROSE_MIN = 40;

/**
 * The page's prose around the form. `read` is the form as read, so its questions can be kept out;
 * `ignore` is our own furniture's selector.
 */
export function pageContext(root: Document | Element, read: FormRead | null, ignore: string): PageContext {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const title = (doc.title ?? "").split(/\s[|·–-]\s/)[0]!.trim().slice(0, 160);

  // The form's own words: every question, option and hint, so none of it reads as the page's.
  const formWords = new Set<string>();
  for (const spec of read?.specs ?? []) {
    for (const text of [spec.label, spec.part, spec.description, spec.placeholder, ...(spec.options ?? []).map((o) => o.label)]) {
      const t = clean(text ?? "").toLowerCase();
      if (t.length > 0) formWords.add(t);
    }
  }
  const longQuestions = [...formWords].filter((words) => words.length >= 8);
  const controls = new Set([...(read?.handles.values() ?? [])]);
  const insideAQuestion = (el: Element) => {
    // A block that holds one of the form's controls is that question's own furniture.
    for (const control of controls) if (el.contains(control)) return true;
    return false;
  };

  const seen = new Set<string>();
  const parts: string[] = [];
  let length = 0;
  // Prose in a bare <div> too — a Google Form writes its introduction that way — when the div says
  // something itself, not only through the blocks inside it.
  const ownText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(" ");
  const candidates = deepQueryAll(doc, `${BLOCKS},div`).filter((el) => el.matches(BLOCKS) || clean(ownText(el)).length >= 40);
  for (const el of candidates) {
    if (length >= PAGE_CONTEXT_MAX) break;
    if (el.closest(CHROME) || el.closest(NOT_PROSE) || (ignore && el.closest(ignore))) continue;
    // A block inside another block is read with it — only the outermost counts.
    const outer = el.parentElement?.closest(BLOCKS);
    if (outer && !outer.closest(CHROME) && !(ignore && outer.closest(ignore))) continue;
    if (insideAQuestion(el) || el.querySelector(CONTROL) || notContent(el)) continue;
    if (el.closest("form") && clean(el.textContent ?? "").length < FORM_PROSE_MIN) continue;
    // A div is read for its own words only; the blocks inside it are read as themselves.
    const text = clean(el.matches(BLOCKS) ? (el.textContent ?? "") : ownText(el));
    const key = text.toLowerCase();
    if (text.length < 2 || seen.has(key) || formWords.has(key)) continue;
    // A question's heading with its star ("First Name *") is still the question.
    if (formWords.has(key.replace(/\s*\*$/, ""))) continue;
    // A block that holds a question in its words — "1. Matriculation Year (If non Oxford…) Required"
    // — is that question, however the form numbers or marks it. Short labels ("Email") are ordinary
    // words, and a page may use them.
    if (longQuestions.some((question) => key.includes(question))) continue;
    seen.add(key);
    const cut = text.slice(0, PAGE_CONTEXT_MAX - length);
    parts.push(cut);
    length += cut.length + 1;
  }
  return { title, text: parts.join("\n") };
}
