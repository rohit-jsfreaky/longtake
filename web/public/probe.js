(() => {
  // core/src/dom-path.ts
  var MAX_DEPTH = 15;
  function uniqueSelector(el) {
    const doc = el.ownerDocument;
    if (!doc) return "";
    const matchesOne = (selector) => {
      try {
        return doc.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };
    if (el.id && matchesOne(`#${CSS.escape(el.id)}`)) {
      return `#${CSS.escape(el.id)}`;
    }
    const name = el.getAttribute("name");
    if (name) {
      const byName = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      if (matchesOne(byName)) return byName;
    }
    const parts = [];
    let walker = el;
    while (walker && walker.nodeType === 1 && parts.length < MAX_DEPTH) {
      const tag = walker.tagName.toLowerCase();
      const parent = walker.parentElement;
      if (walker !== el && walker.id && matchesOne(`#${CSS.escape(walker.id)}`)) {
        parts.unshift(`#${CSS.escape(walker.id)}`);
        return parts.join(" > ");
      }
      if (tag === "html" || tag === "body" || !parent) break;
      const siblings = Array.from(parent.children).filter((c) => c.tagName === walker.tagName);
      const index = siblings.indexOf(walker) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      const built = parts.join(" > ");
      if (matchesOne(built)) return built;
      walker = parent;
    }
    return "";
  }
  function deepQueryAll(root, selector) {
    const found = [];
    const seen = /* @__PURE__ */ new Set();
    const visit = (node) => {
      let direct = [];
      try {
        direct = Array.from(node.querySelectorAll(selector));
      } catch {
        return;
      }
      for (const el of direct) {
        if (!seen.has(el)) {
          seen.add(el);
          found.push(el);
        }
      }
      let hosts = [];
      try {
        hosts = Array.from(node.querySelectorAll("*")).filter((el) => el.shadowRoot);
      } catch {
        hosts = [];
      }
      for (const host of hosts) {
        if (host.shadowRoot) visit(host.shadowRoot);
      }
      let frames = [];
      try {
        frames = Array.from(node.querySelectorAll("iframe"));
      } catch {
        frames = [];
      }
      for (const frame of frames) {
        try {
          const doc = frame.contentDocument;
          if (doc) visit(doc);
        } catch {
        }
      }
    };
    visit(root);
    return found;
  }
  function isVisible(el) {
    const html = el;
    if (!html.isConnected) return false;
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
    if (Number(style.opacity) === 0) return false;
    const rect = html.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const view = el.ownerDocument.defaultView;
    const scrollX = view?.scrollX ?? 0;
    const scrollY = view?.scrollY ?? 0;
    if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false;
    return true;
  }

  // core/src/reader.ts
  var CANDIDATE_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable='']",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='spinbutton']"
  ].join(",");
  var NON_ANSWER_TYPES = /* @__PURE__ */ new Set(["submit", "button", "reset", "image", "hidden"]);
  var LONG_FORM_LABEL = /cover letter|why (do|are|would)|tell us|describe|excites|about your|in your own words|summar/i;
  var TRAP_NAME = /honey ?pot|^hp_|_hp$|bot ?(field|check|trap)|leave ?(this )?blank|do ?not ?fill/i;
  var LONG_FORM_MIN_MAXLENGTH = 1e3;
  function textOf(el) {
    if (!el) return "";
    return (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  function labelOf(el) {
    const doc = el.ownerDocument;
    const root = el.getRootNode();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => textOf(root.querySelector(`#${CSS.escape(id)}`) ?? doc?.getElementById(id))).filter(Boolean).join(" ");
      if (text) return text;
    }
    const ariaLabel = el.getAttribute("aria-label")?.trim();
    if (ariaLabel) return ariaLabel;
    if (el.id) {
      const forLabel = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = textOf(forLabel);
      if (text) return text;
    }
    const wrapping = el.closest("label");
    if (wrapping) {
      const text = textOf(wrapping);
      if (text) return text;
    }
    const legend = el.closest("fieldset")?.querySelector("legend");
    const legendText = textOf(legend);
    if (legendText) return legendText;
    const placeholder = el.getAttribute("placeholder")?.trim();
    if (placeholder) return placeholder;
    const title = el.getAttribute("title")?.trim();
    if (title) return title;
    let node = el;
    for (let hops = 0; node && hops < 4; hops++) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        const text = textOf(sibling);
        if (text && text.length <= 120) return text;
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }
  function cleanLabel(raw) {
    return raw.replace(/[\s*✱]+$/g, "").replace(/\s+/g, " ").trim();
  }
  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    if (role === "combobox" || el.getAttribute("aria-haspopup") === "listbox") return "select";
    if (role === "spinbutton") return "number";
    if (tag === "textarea") return "textarea";
    if (tag === "select") {
      return el.multiple ? "multiselect" : "select";
    }
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      switch (type) {
        case "email":
        case "tel":
        case "url":
        case "number":
        case "date":
        case "checkbox":
        case "radio":
        case "file":
          return type;
        case "datetime-local":
        case "month":
        case "week":
          return "date";
        default:
          return "text";
      }
    }
    return "textarea";
  }
  function optionsOf(el) {
    if (el.tagName.toLowerCase() !== "select") return void 0;
    const options = Array.from(el.options).filter((option) => option.value !== "" || textOf(option) !== "").map((option) => ({ value: option.value, label: textOf(option) || option.value }));
    return options.length > 0 ? options : void 0;
  }
  function looksLikeTrap(el, visible) {
    if (!visible) return true;
    const name = `${el.getAttribute("name") ?? ""} ${el.id ?? ""}`;
    if (TRAP_NAME.test(name)) return true;
    if (el.getAttribute("tabindex") === "-1" && el.getAttribute("autocomplete") === "off") {
      return true;
    }
    return false;
  }
  function isLongForm(el, kind, label) {
    if (kind === "textarea") return true;
    if (kind !== "text") return false;
    const maxLength = el.maxLength;
    if (maxLength && maxLength >= LONG_FORM_MIN_MAXLENGTH) return true;
    return LONG_FORM_LABEL.test(label);
  }
  function slugify(raw) {
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  }
  function readForm(root = document, url = root.location?.href ?? "") {
    const candidates = deepQueryAll(root, CANDIDATE_SELECTOR);
    const specs = [];
    const skipped = [];
    const handles = /* @__PURE__ */ new Map();
    const usedIds = /* @__PURE__ */ new Set();
    const groups = /* @__PURE__ */ new Map();
    const takeId = (preferred, index) => {
      const base = slugify(preferred) || `field_${index + 1}`;
      if (!usedIds.has(base)) {
        usedIds.add(base);
        return base;
      }
      for (let n = 2; ; n++) {
        const candidate = `${base}_${n}`;
        if (!usedIds.has(candidate)) {
          usedIds.add(candidate);
          return candidate;
        }
      }
    };
    candidates.forEach((el, index) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "input") {
        const type = (el.type || "text").toLowerCase();
        if (NON_ANSWER_TYPES.has(type)) return;
        if (type === "password") return;
      }
      if (el.disabled) return;
      if (el.readOnly) return;
      const visible = isVisible(el);
      const kind = kindOf(el);
      const label = cleanLabel(labelOf(el));
      const name = el.getAttribute("name") ?? "";
      if (!visible) {
        skipped.push({ label: label || name || kind, reason: "not visible on the page" });
        return;
      }
      if (kind === "file") {
        skipped.push({ label: label || name, reason: "a file cannot be attached by voice" });
        return;
      }
      if ((kind === "radio" || kind === "checkbox") && name) {
        const groupKey = `${kind}:${name}`;
        const siblings = candidates.filter(
          (other) => other.getAttribute("name") === name && kindOf(other) === kind
        );
        const isGroup = kind === "radio" || siblings.length > 1;
        if (isGroup) {
          const existing = groups.get(groupKey);
          const option = {
            value: el.value || label,
            label: label || el.value
          };
          if (existing) {
            existing.options?.push(option);
            return;
          }
          const spec2 = {
            id: takeId(name || label, index),
            label: textOf(el.closest("fieldset")?.querySelector("legend")) || el.closest("[role='radiogroup']")?.getAttribute("aria-label") || name,
            kind: kind === "radio" ? "radio" : "multiselect",
            required: el.required,
            options: [option],
            ...visible ? {} : { suspectedHoneypot: true }
          };
          const selector2 = uniqueSelector(el);
          if (selector2) spec2.selector = selector2;
          groups.set(groupKey, spec2);
          specs.push(spec2);
          handles.set(spec2.id, el);
          return;
        }
      }
      const id = takeId(name || label || el.id, index);
      const spec = {
        id,
        label,
        kind,
        required: Boolean(el.required) || el.getAttribute("aria-required") === "true"
      };
      const selector = uniqueSelector(el);
      if (selector) spec.selector = selector;
      const options = optionsOf(el);
      if (options) spec.options = options;
      const maxLength = el.maxLength;
      if (maxLength && maxLength > 0) spec.maxLength = maxLength;
      const pattern = el.getAttribute("pattern");
      if (pattern) spec.pattern = pattern;
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) spec.placeholder = placeholder;
      if (isLongForm(el, kind, label)) spec.longForm = true;
      if (looksLikeTrap(el, visible)) spec.suspectedHoneypot = true;
      specs.push(spec);
      handles.set(id, el);
    });
    return { specs, handles, skipped, url, readAt: Date.now() };
  }
  async function harvestOptions(read, settleMs = 150) {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return read;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const allOptions = () => Array.from(deepQueryAll(doc, "[role='option']"));
    const poke = (el) => {
      el.scrollIntoView({ block: "center" });
      el.focus();
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
    };
    const close = (el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })
      );
      el.blur();
    };
    for (const spec of read.specs) {
      if (spec.kind !== "select" && spec.kind !== "multiselect") continue;
      if (spec.options && spec.options.length > 0) continue;
      const el = read.handles.get(spec.id);
      if (!el || !el.isConnected) continue;
      const before = new Set(allOptions());
      try {
        poke(el);
        await sleep(settleMs);
        const revealed = allOptions().filter((option) => !before.has(option));
        const options = [];
        const seen = /* @__PURE__ */ new Set();
        for (const option of revealed) {
          const label = cleanLabel(textOf(option));
          if (!label || seen.has(label)) continue;
          seen.add(label);
          options.push({ value: option.getAttribute("data-value") ?? label, label });
        }
        if (options.length > 0) spec.options = options;
      } catch {
      } finally {
        close(el);
        await sleep(40);
      }
    }
    return read;
  }

  // core/src/writer.ts
  function setNativeValue(el, value) {
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  }
  function announce(el, kinds) {
    for (const kind of kinds) {
      el.dispatchEvent(new Event(kind, { bubbles: true }));
    }
  }
  function normalise(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function matchOption(spec, spoken) {
    if (!spec.options || spec.options.length === 0) return null;
    const want = normalise(spoken);
    if (!want) return null;
    const exact = spec.options.find(
      (option) => normalise(option.label) === want || normalise(option.value) === want
    );
    if (exact) return exact.value;
    const partial = spec.options.filter((option) => {
      const label = normalise(option.label);
      return label.length > 0 && (label.includes(want) || want.includes(label));
    });
    if (partial.length === 1) return partial[0].value;
    return null;
  }
  function readBack(el) {
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") return el.checked ? el.value || "on" : "";
      return el.value;
    }
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
    return (el.textContent ?? "").trim();
  }
  function radioGroup(el) {
    const name = el.getAttribute("name");
    const root = el.getRootNode();
    if (!name) return el instanceof HTMLInputElement ? [el] : [];
    return Array.from(
      root.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)
    );
  }
  function writeOne(spec, el, spoken) {
    const { id } = spec;
    if (spec.kind === "file") {
      return {
        fieldId: id,
        status: "refused",
        reason: "A file cannot be attached by voice. Longtake leaves this for the person."
      };
    }
    if (spec.kind === "radio" || spec.kind === "multiselect" && spec.options) {
      const wanted = Array.isArray(spoken.value) ? spoken.value : [String(spoken.value)];
      const chosen = wanted.map((one) => matchOption(spec, one)).filter((v) => v !== null);
      if (chosen.length === 0) {
        return {
          fieldId: id,
          status: "refused",
          reason: `"${wanted.join(", ")}" does not clearly match any option on the page. Asking instead of guessing.`
        };
      }
      if (spec.kind === "radio") {
        const target = radioGroup(el).find((radio) => radio.value === chosen[0]);
        if (!target) {
          return { fieldId: id, status: "refused", reason: "That option is no longer on the page." };
        }
        target.checked = true;
        announce(target, ["input", "change"]);
        return target.checked ? { fieldId: id, status: "written", wrote: target.value } : { fieldId: id, status: "rejected-by-page", wrote: target.value, found: "" };
      }
      const name = el.getAttribute("name");
      const root = el.getRootNode();
      const boxes = name ? Array.from(
        root.querySelectorAll(
          `input[type="checkbox"][name="${CSS.escape(name)}"]`
        )
      ) : [el];
      for (const box of boxes) {
        const shouldCheck = chosen.includes(box.value);
        if (box.checked !== shouldCheck) {
          box.checked = shouldCheck;
          announce(box, ["input", "change"]);
        }
      }
      return { fieldId: id, status: "written", wrote: chosen.join(", ") };
    }
    if (spec.kind === "checkbox") {
      const box = el;
      const yes = typeof spoken.value === "boolean" ? spoken.value : /^(yes|true|agree|accept)/i.test(String(spoken.value));
      box.checked = yes;
      announce(box, ["input", "change"]);
      return { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" };
    }
    if (spec.kind === "select" || spec.kind === "multiselect") {
      const wanted = String(Array.isArray(spoken.value) ? spoken.value[0] : spoken.value);
      const value = matchOption(spec, wanted);
      if (value === null) {
        return {
          fieldId: id,
          status: "refused",
          reason: `"${wanted}" does not clearly match any option on the page. Asking instead of guessing.`
        };
      }
      setNativeValue(el, value);
      announce(el, ["input", "change"]);
      const found2 = readBack(el);
      return found2 === value ? { fieldId: id, status: "written", wrote: value } : { fieldId: id, status: "rejected-by-page", wrote: value, found: found2 };
    }
    if (el.isContentEditable) {
      const text2 = String(spoken.value);
      el.textContent = text2;
      announce(el, ["input", "change"]);
      const found2 = readBack(el);
      return found2 === text2 ? { fieldId: id, status: "written", wrote: text2 } : { fieldId: id, status: "rejected-by-page", wrote: text2, found: found2 };
    }
    let text = String(spoken.value);
    if (spec.maxLength && text.length > spec.maxLength) {
      text = text.slice(0, spec.maxLength);
    }
    setNativeValue(el, text);
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === text ? { fieldId: id, status: "written", wrote: text } : { fieldId: id, status: "rejected-by-page", wrote: text, found };
  }
  function writeValues(specs, handles, values) {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    return values.map((spoken) => {
      const spec = byId.get(spoken.fieldId);
      if (!spec) {
        return {
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "No such field on this page. The page may have changed since it was read."
        };
      }
      if (!spoken.evidence || spoken.evidence.trim() === "") {
        return {
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "Nothing was spoken about this field, so it stays empty."
        };
      }
      if (spec.suspectedHoneypot) {
        return {
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "This field looks like it is there to catch software, not to be answered."
        };
      }
      const el = handles.get(spoken.fieldId);
      if (!el || !el.isConnected) {
        return {
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "That field is no longer on the page."
        };
      }
      return writeOne(spec, el, spoken);
    });
  }

  // core/src/index.ts
  var CORE_VERSION = "0.2.0";

  // tools/probe.ts
  window.__longtake = {
    version: CORE_VERSION,
    readForm,
    writeValues,
    harvestOptions,
    inspect: () => {
      const read = readForm();
      window.__longtake.last = read;
      return { url: read.url, count: read.specs.length, specs: read.specs, skipped: read.skipped };
    },
    inspectDeep: async () => {
      const read = await harvestOptions(readForm());
      window.__longtake.last = read;
      return { url: read.url, count: read.specs.length, specs: read.specs, skipped: read.skipped };
    }
  };
  console.log(`[Longtake] probe ${CORE_VERSION} ready \u2014 window.__longtake`);
})();
