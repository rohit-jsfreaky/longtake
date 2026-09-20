(() => {
  // core/src/dom-path.ts
  var MAX_DEPTH = 15;
  var MIN_INTERACTIVE_PX = 10;
  var SELF_DECLARED_ROLES = /* @__PURE__ */ new Set([
    "combobox",
    "textbox",
    "searchbox",
    "spinbutton",
    "listbox",
    "radiogroup",
    "checkbox",
    "switch"
  ]);
  function declaresItselfInteractive(el) {
    const role = el.getAttribute("role");
    if (role && SELF_DECLARED_ROLES.has(role)) return true;
    return el.hasAttribute("aria-haspopup");
  }
  function uniqueSelector(el, within) {
    const doc = el.ownerDocument;
    if (!doc) return "";
    if (within && doc !== within) return "";
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
    const check = html.checkVisibility;
    if (typeof check === "function") {
      const visible = check.call(html, {
        checkOpacity: true,
        checkVisibilityCSS: true,
        contentVisibilityAuto: true
      });
      if (!visible) return false;
    }
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
    if (Number(style.opacity) === 0) return false;
    const rect = html.getBoundingClientRect();
    if (rect.width < MIN_INTERACTIVE_PX || rect.height < MIN_INTERACTIVE_PX) {
      if (!declaresItselfInteractive(el)) return false;
      let ancestor = html.parentElement;
      for (let hops = 0; ancestor && hops < 3; hops++) {
        const box = ancestor.getBoundingClientRect();
        if (box.width > 0 || box.height > 0) {
          return box.width >= MIN_INTERACTIVE_PX && box.height >= MIN_INTERACTIVE_PX;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    }
    const view = el.ownerDocument.defaultView;
    const scrollX = view?.scrollX ?? 0;
    const scrollY = view?.scrollY ?? 0;
    if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false;
    return true;
  }
  function openWidget(el) {
    el.scrollIntoView({ block: "center" });
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window })
      );
    }
  }
  function closeWidget(el) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, composed: true })
    );
    el.blur();
    const doc = el.ownerDocument;
    if (doc?.body) {
      for (const type of ["pointerdown", "mousedown"]) {
        doc.body.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, composed: true })
        );
      }
    }
  }
  function pressOption(option) {
    option.scrollIntoView({ block: "nearest" });
    for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      option.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window })
      );
    }
  }
  function optionNodes(root = document) {
    return deepQueryAll(root, "[role='option'],[role='menuitem'],[role='menuitemradio']").filter(
      (el) => isVisible(el)
    );
  }
  function whenSettled(root = document, quietMs = 350, timeoutMs = 5e3, until) {
    return new Promise((resolve) => {
      if (!root.body) {
        resolve();
        return;
      }
      let quiet;
      const observer = new MutationObserver(() => {
        clearTimeout(quiet);
        quiet = setTimeout(maybeFinish, quietMs);
      });
      const maybeFinish = () => {
        if (until && !until()) return;
        finish();
      };
      const finish = () => {
        clearTimeout(quiet);
        clearTimeout(hardStop);
        observer.disconnect();
        resolve();
      };
      const hardStop = setTimeout(finish, timeoutMs);
      quiet = setTimeout(maybeFinish, quietMs);
      observer.observe(root.body, { childList: true, subtree: true, attributes: true });
    });
  }

  // core/src/reader.ts
  var CANDIDATE_SELECTOR = [
    // Real form elements.
    "input",
    "textarea",
    "select",
    // Something a person types into that is not an input.
    "[contenteditable='']",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='searchbox']",
    "[role='spinbutton']",
    // Dropdowns that are not `<select>`. `role="combobox"` covers Radix and React-Select;
    // `aria-haspopup` covers Headless UI and every hand-rolled menu, whose trigger is usually a
    // plain `role="button"` and would otherwise be completely invisible to this file.
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='menu']",
    // Choices built out of divs. The group is the question; its children are the answers.
    "[role='radiogroup']",
    "[role='checkbox']",
    "[role='switch']"
  ].join(",");
  var NON_ANSWER_TYPES = /* @__PURE__ */ new Set(["submit", "button", "reset", "image", "hidden"]);
  var LONG_FORM_LABEL = /cover letter|why (do|are|would)|tell us|describe|excites|about your|in your own words|summar/i;
  var TRAP_NAME = /honey ?pot|\bhp\b|bot ?(field|check|trap)|leave (this )?blank|do not fill/i;
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
    const popup = el.getAttribute("aria-haspopup");
    if (role === "combobox" || popup === "listbox" || popup === "menu") return "select";
    if (role === "radiogroup") return "radio";
    if (role === "checkbox" || role === "switch") return "checkbox";
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
        case "range":
          return "number";
        default:
          return "text";
      }
    }
    return "textarea";
  }
  function optionsOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const options = Array.from(el.options).filter((option) => option.value !== "" || textOf(option) !== "").map((option) => ({ value: option.value, label: textOf(option) || option.value }));
      return options.length > 0 ? options : void 0;
    }
    if (el.getAttribute("role") === "radiogroup") {
      const options = deepQueryAll(el, "[role='radio']").map((radio) => {
        const label = cleanLabel(radio.getAttribute("aria-label") ?? textOf(radio));
        return { value: radio.getAttribute("value") ?? label, label };
      }).filter((option) => option.label !== "");
      return options.length > 0 ? options : void 0;
    }
    return void 0;
  }
  function isCustom(el, kind) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return false;
    if (tag !== "input" && tag !== "textarea") return true;
    return kind === "select" || kind === "multiselect";
  }
  function looksLikeTrap(el, visible) {
    if (!visible) return true;
    const name = `${el.getAttribute("name") ?? ""} ${el.id ?? ""}`.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
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
          const groupLabel = cleanLabel(
            textOf(el.closest("fieldset")?.querySelector("legend")) || el.closest("[role='radiogroup']")?.getAttribute("aria-label") || name
          );
          const spec2 = {
            id: takeId(groupLabel || name, index),
            label: groupLabel,
            kind: kind === "radio" ? "radio" : "multiselect",
            required: el.required,
            options: [option],
            ...visible ? {} : { suspectedHoneypot: true }
          };
          const selector2 = uniqueSelector(el, root);
          if (selector2) spec2.selector = selector2;
          groups.set(groupKey, spec2);
          specs.push(spec2);
          handles.set(spec2.id, el);
          return;
        }
      }
      const id = takeId(label || name || el.id, index);
      const spec = {
        id,
        label,
        kind,
        required: Boolean(el.required) || el.getAttribute("aria-required") === "true"
      };
      const selector = uniqueSelector(el, root);
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
      if (isCustom(el, kind)) spec.custom = true;
      if (looksLikeTrap(el, visible)) spec.suspectedHoneypot = true;
      specs.push(spec);
      handles.set(id, el);
    });
    return { specs, handles, skipped, url, readAt: Date.now() };
  }
  async function harvestOptions(read, settleMs = 150) {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return read;
    const sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const allOptions = () => optionNodes(doc);
    for (const spec of read.specs) {
      if (spec.kind !== "select" && spec.kind !== "multiselect") continue;
      if (spec.options && spec.options.length > 0) continue;
      const el = read.handles.get(spec.id);
      if (!el || !el.isConnected) continue;
      const before = new Set(allOptions());
      try {
        openWidget(el);
        await sleep2(settleMs);
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
        closeWidget(el);
        await sleep2(40);
      }
    }
    return read;
  }
  function waitForForm(root = document, timeoutMs = 5e3) {
    return whenSettled(
      root,
      350,
      timeoutMs,
      () => deepQueryAll(root, CANDIDATE_SELECTOR).some((el) => isVisible(el))
    );
  }

  // core/src/writer.ts
  var WIDGET_OPEN_MS = 400;
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function setNativeValue(el, value) {
    const view = el.ownerDocument?.defaultView ?? window;
    const tag = el.tagName.toLowerCase();
    const prototype = tag === "textarea" ? view.HTMLTextAreaElement.prototype : tag === "select" ? view.HTMLSelectElement.prototype : view.HTMLInputElement.prototype;
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
  var MEANS_NO = /\b(no|not|false|never|decline|disagree|refuse|nahi|nahin)\b/i;
  var MEANS_YES = /\b(yes|true|agree|agreed|accept|confirm|ok|okay|sure|haan|han|ji|sahi)\b/i;
  function readAsYesOrNo(value) {
    if (typeof value === "boolean") return value;
    const text = String(value);
    if (MEANS_NO.test(text)) return false;
    return MEANS_YES.test(text);
  }
  function matchOption(spec, spoken) {
    if (!spec.options || spec.options.length === 0) return null;
    const want = normalise(spoken);
    if (!want) return null;
    const exact = spec.options.find(
      (option) => normalise(option.label) === want || normalise(option.value) === want
    );
    if (exact) return exact;
    const partial = spec.options.filter((option) => {
      const label = normalise(option.label);
      return label.length > 0 && (label.includes(want) || want.includes(label));
    });
    if (partial.length === 1) return partial[0];
    return null;
  }
  function readBack(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const input = el;
      if (input.type === "checkbox" || input.type === "radio") {
        return input.checked ? input.value || "on" : "";
      }
      return input.value;
    }
    if (tag === "textarea" || tag === "select") return el.value;
    return (el.textContent ?? "").trim();
  }
  function renderedText(el) {
    let node = el.parentElement;
    for (let hops = 0; node && hops < 5; hops++) {
      const text = (node.innerText ?? "").replace(/\s+/g, " ").trim();
      if (text) return text;
      node = node.parentElement;
    }
    return "";
  }
  function radioGroup(el) {
    const name = el.getAttribute("name");
    const root = el.getRootNode();
    if (!name) return el.tagName.toLowerCase() === "input" ? [el] : [];
    return Array.from(
      root.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)
    );
  }
  async function pickFromWidget(spec, el, want) {
    const before = new Set(optionNodes());
    const wasShowing = renderedText(el);
    openWidget(el);
    await sleep(WIDGET_OPEN_MS);
    let candidates = optionNodes().filter((option) => !before.has(option));
    if (candidates.length === 0) candidates = optionNodes();
    const target = candidates.find(
      (option) => normalise((option.innerText ?? "").trim()) === normalise(want.label)
    );
    if (!target) {
      closeWidget(el);
      return {
        fieldId: spec.id,
        status: "rejected-by-page",
        wrote: want.label,
        found: candidates.length === 0 ? "the dropdown did not open" : "that choice was not offered"
      };
    }
    pressOption(target);
    await sleep(200);
    const showing = renderedText(el);
    const took = normalise(showing).includes(normalise(want.label)) && showing !== wasShowing;
    if (!took) {
      closeWidget(el);
      return { fieldId: spec.id, status: "rejected-by-page", wrote: want.label, found: showing };
    }
    return { fieldId: spec.id, status: "written", wrote: want.label };
  }
  async function writeOne(spec, el, spoken) {
    const { id } = spec;
    if (spec.kind === "file") {
      return {
        fieldId: id,
        status: "refused",
        reason: "A file cannot be attached by voice. Longtake leaves this for the person."
      };
    }
    if (spec.kind === "select") {
      const wanted = String(Array.isArray(spoken.value) ? spoken.value[0] : spoken.value);
      const want = matchOption(spec, wanted);
      if (!want) {
        return {
          fieldId: id,
          status: "refused",
          reason: `"${wanted}" does not clearly match any option on the page. Asking instead of guessing.`
        };
      }
      if (spec.custom) return pickFromWidget(spec, el, want);
      setNativeValue(el, want.value);
      announce(el, ["input", "change"]);
      const found2 = readBack(el);
      return found2 === want.value ? { fieldId: id, status: "written", wrote: want.label } : { fieldId: id, status: "rejected-by-page", wrote: want.label, found: found2 };
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
      if (spec.custom) return pickFromWidget(spec, el, chosen[0]);
      if (spec.kind === "radio") {
        const target = radioGroup(el).find((radio) => radio.value === chosen[0].value);
        if (!target) {
          return { fieldId: id, status: "refused", reason: "That option is no longer on the page." };
        }
        target.checked = true;
        announce(target, ["input", "change"]);
        return target.checked ? { fieldId: id, status: "written", wrote: chosen[0].label } : { fieldId: id, status: "rejected-by-page", wrote: chosen[0].label, found: "" };
      }
      const name = el.getAttribute("name");
      const root = el.getRootNode();
      const boxes = name ? Array.from(
        root.querySelectorAll(
          `input[type="checkbox"][name="${CSS.escape(name)}"]`
        )
      ) : [el];
      const wantedValues = chosen.map((c) => c.value);
      for (const box of boxes) {
        const shouldCheck = wantedValues.includes(box.value);
        if (box.checked !== shouldCheck) {
          box.checked = shouldCheck;
          announce(box, ["input", "change"]);
        }
      }
      return { fieldId: id, status: "written", wrote: chosen.map((c) => c.label).join(", ") };
    }
    if (spec.kind === "checkbox") {
      const yes = readAsYesOrNo(spoken.value);
      if (spec.custom) {
        const already = el.getAttribute("aria-checked") === "true";
        if (already !== yes) {
          openWidget(el);
          await sleep(120);
        }
        const now = el.getAttribute("aria-checked") === "true";
        return now === yes ? { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" } : {
          fieldId: id,
          status: "rejected-by-page",
          wrote: yes ? "checked" : "unchecked",
          found: `aria-checked=${el.getAttribute("aria-checked")}`
        };
      }
      const box = el;
      box.checked = yes;
      announce(box, ["input", "change"]);
      return box.checked === yes ? { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" } : { fieldId: id, status: "rejected-by-page", wrote: String(yes), found: String(box.checked) };
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
  async function writeValues(specs, handles, values) {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    const outcomes = [];
    for (const spoken of values) {
      const spec = byId.get(spoken.fieldId);
      if (!spec) {
        outcomes.push({
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "No such field on this page. The page may have changed since it was read."
        });
        continue;
      }
      if (!spoken.evidence || spoken.evidence.trim() === "") {
        outcomes.push({
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "Nothing was spoken about this field, so it stays empty."
        });
        continue;
      }
      if (spec.suspectedHoneypot) {
        outcomes.push({
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "This field looks like it is there to catch software, not to be answered."
        });
        continue;
      }
      const el = handles.get(spoken.fieldId);
      if (!el || !el.isConnected) {
        outcomes.push({
          fieldId: spoken.fieldId,
          status: "refused",
          reason: "That field is no longer on the page."
        });
        continue;
      }
      outcomes.push(await writeOne(spec, el, spoken));
    }
    return outcomes;
  }

  // core/src/index.ts
  var CORE_VERSION = "0.2.0";

  // tools/probe.ts
  window.__longtake = {
    version: CORE_VERSION,
    readForm,
    writeValues,
    harvestOptions,
    whenSettled,
    inspect: () => {
      const read = readForm();
      window.__longtake.last = read;
      return { url: read.url, count: read.specs.length, specs: read.specs, skipped: read.skipped };
    },
    inspectDeep: async () => {
      await waitForForm();
      const read = await harvestOptions(readForm());
      window.__longtake.last = read;
      return { url: read.url, count: read.specs.length, specs: read.specs, skipped: read.skipped };
    }
  };
  console.log(`[Longtake] probe ${CORE_VERSION} ready \u2014 window.__longtake`);
})();
