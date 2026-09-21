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
  function labelTextWithoutControls(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, option, [role='combobox'], [contenteditable]").forEach((node) => node.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  function isInside(el, selector) {
    let node = el;
    while (node) {
      try {
        if (node.matches(selector)) return true;
      } catch {
        return false;
      }
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
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
      const text = labelTextWithoutControls(wrapping);
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
  function readForm(root = document, url = root.location?.href ?? "", ignore = "[data-longtake-ignore]") {
    const candidates = deepQueryAll(root, CANDIDATE_SELECTOR).filter(
      (el) => !ignore || !isInside(el, ignore)
    );
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
  function matchAmong(candidates, spoken) {
    const want = normalise(spoken);
    if (!want) return null;
    const exact = candidates.findIndex((candidate) => normalise(candidate) === want);
    if (exact >= 0) return exact;
    const partial = [];
    candidates.forEach((candidate, index) => {
      const text = normalise(candidate);
      if (text.length > 0 && (text.includes(want) || want.includes(text))) partial.push(index);
    });
    return partial.length === 1 ? partial[0] : null;
  }
  function matchOption(spec, spoken) {
    if (!spec.options || spec.options.length === 0) return null;
    const labels = spec.options.map((option) => option.label);
    const byLabel = matchAmong(labels, spoken);
    if (byLabel !== null) return spec.options[byLabel];
    const values = spec.options.map((option) => option.value);
    const byValue = matchAmong(values, spoken);
    return byValue !== null ? spec.options[byValue] : null;
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
  async function pickFromWidget(spec, el, want, spoken) {
    const before = new Set(optionNodes());
    const wasShowing = renderedText(el);
    openWidget(el);
    await sleep(WIDGET_OPEN_MS);
    let candidates = optionNodes().filter((option) => !before.has(option));
    if (candidates.length === 0) candidates = optionNodes();
    const labels = candidates.map((option) => (option.innerText ?? "").trim());
    const index = want ? matchAmong(labels, want.label) : matchAmong(labels, spoken);
    const target = index !== null ? candidates[index] : void 0;
    const chosen = index !== null ? labels[index] : want?.label ?? spoken;
    if (!target) {
      closeWidget(el);
      if (candidates.length === 0) {
        return {
          fieldId: spec.id,
          status: "rejected-by-page",
          wrote: chosen,
          found: "the dropdown did not open"
        };
      }
      return {
        fieldId: spec.id,
        status: "refused",
        reason: `"${spoken}" does not clearly match any of the choices this dropdown offers. Asking instead of guessing.`
      };
    }
    pressOption(target);
    await sleep(200);
    const showing = renderedText(el);
    const took = normalise(showing).includes(normalise(chosen)) && showing !== wasShowing;
    if (!took) {
      closeWidget(el);
      return { fieldId: spec.id, status: "rejected-by-page", wrote: chosen, found: showing };
    }
    return { fieldId: spec.id, status: "written", wrote: chosen };
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
      if (!want && spec.custom && !spec.options?.length) {
        return pickFromWidget(spec, el, null, wanted);
      }
      if (!want) {
        return {
          fieldId: id,
          status: "refused",
          reason: `"${wanted}" does not clearly match any option on the page. Asking instead of guessing.`
        };
      }
      if (spec.custom) return pickFromWidget(spec, el, want, wanted);
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
      if (spec.custom) return pickFromWidget(spec, el, chosen[0], wanted.join(", "));
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

  // core/src/binder.ts
  var FILL_TOOL_NAME = "fill_fields";
  var EXECUTION_MODE = "interactive";
  var TIMEOUT_SECONDS = 60;
  var TOOL_DESCRIPTION = [
    "Write answers into the form the person is looking at.",
    "Call this as soon as you have heard even one answer, and call it again each time you hear more \u2014",
    "you do not need to wait until the person has finished.",
    "Include ONLY fields the person actually spoke about.",
    "Leaving a field out is always correct and costs nothing; the form will ask about it later.",
    "Filling one they did not mention is never acceptable, even if the answer seems obvious from",
    "something else they said, and even if the field is required.",
    "Every answer carries the person's own words in `evidence`, quoted as they said them."
  ].join(" ");
  var FORMAT_HINTS = {
    email: { format: "email", hint: "A full email address, lowercase.", examples: ["rohit@example.com"] },
    tel: {
      hint: "A phone number in the format the person said it, digits and an optional country code. No brackets or dashes.",
      examples: ["+91 98765 43210"]
    },
    url: { format: "uri", hint: "A full URL including https://", examples: ["https://example.com/in/name"] },
    date: { format: "date", hint: "ISO-8601 date, YYYY-MM-DD.", examples: ["2026-10-01"] },
    number: { hint: "A plain number, no units, no commas." }
  };
  function valueSchema(spec) {
    const options = spec.options?.map((option) => option.label).filter(Boolean) ?? [];
    switch (spec.kind) {
      case "checkbox":
        return { type: "boolean", description: "true if the person agreed, false if they declined." };
      case "select":
      case "radio": {
        if (options.length > 0) {
          return {
            type: "string",
            enum: options,
            description: "Pick the closest of these. If none of them is what the person said, leave this field out."
          };
        }
        return {
          type: "string",
          description: "This dropdown's choices could not be read in advance. Put what the person said; it will be matched against the real options, and left blank if it does not match one."
        };
      }
      case "multiselect":
        return {
          type: "array",
          items: options.length > 0 ? { type: "string", enum: options } : { type: "string" },
          description: "One entry per thing the person named. Leave out anything they did not say."
        };
      case "number":
        return { type: "number", description: FORMAT_HINTS.number.hint };
      default: {
        const hint = FORMAT_HINTS[spec.kind];
        const schema = {
          type: "string",
          description: hint?.hint ?? "What the person said, tidied into the form's own language."
        };
        if (hint?.format) schema.format = hint.format;
        if (hint?.examples) schema.examples = hint.examples;
        if (spec.maxLength) schema.maxLength = spec.maxLength;
        if (spec.pattern) schema.pattern = spec.pattern;
        return schema;
      }
    }
  }
  function fieldSchema(spec) {
    const parts = [spec.label || spec.id];
    if (spec.required) parts.push("(the form marks this required)");
    if (spec.longForm) parts.push("(a long answer \u2014 several sentences are welcome)");
    return {
      type: "object",
      description: parts.join(" "),
      properties: {
        value: valueSchema(spec),
        evidence: {
          type: "string",
          description: "The person's own words that this answer came from, quoted. Not a paraphrase. If you cannot quote them, you did not hear this answer and the field must be left out."
        }
      },
      // Both, always. This is what makes an unsupported answer unrepresentable rather than merely
      // discouraged — there is no shape of this object that carries a value without its source.
      required: ["value", "evidence"],
      additionalProperties: false
    };
  }
  function buildFillTool(specs) {
    const properties = {};
    for (const spec of specs) {
      if (spec.suspectedHoneypot) continue;
      if (spec.kind === "file") continue;
      properties[spec.id] = fieldSchema(spec);
    }
    return {
      type: "function",
      name: FILL_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties,
        // Deliberately empty. Marking the form's required fields as required *here* would make the
        // agent interrogate the person for them before it could call the tool at all — which is
        // precisely the form-shaped questioning Longtake exists to remove. What is still missing
        // is reported back in the tool's result, and asked about afterwards, one at a time.
        required: [],
        additionalProperties: false
      },
      execution_mode: EXECUTION_MODE,
      timeout_seconds: TIMEOUT_SECONDS
    };
  }
  function validateTool(tool) {
    const problems = [];
    if (tool.type !== "function") problems.push('type must be "function"');
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) problems.push(`name "${tool.name}" must be snake_case`);
    if (!tool.description.trim()) problems.push("description is empty, so the agent has no reason to call it");
    if (tool.timeout_seconds < 1 || tool.timeout_seconds > 300) {
      problems.push("timeout_seconds must be between 1 and 300");
    }
    const walk = (schema, path) => {
      if (!schema.type) {
        problems.push(`${path}: missing "type"`);
        return;
      }
      if (schema.enum) {
        if (schema.enum.length === 0) problems.push(`${path}: enum is empty, so nothing can satisfy it`);
        if (new Set(schema.enum).size !== schema.enum.length) {
          problems.push(`${path}: enum has duplicate entries`);
        }
        if (schema.enum.some((value) => typeof value !== "string" || value === "")) {
          problems.push(`${path}: enum contains a blank entry`);
        }
      }
      if (schema.type === "object") {
        for (const name of schema.required ?? []) {
          if (!schema.properties || !(name in schema.properties)) {
            problems.push(`${path}: "${name}" is required but not defined`);
          }
        }
        for (const [name, child] of Object.entries(schema.properties ?? {})) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            problems.push(`${path}.${name}: property name is not a plain identifier`);
          }
          walk(child, `${path}.${name}`);
        }
      }
      if (schema.type === "array" && schema.items) walk(schema.items, `${path}[]`);
    };
    if (tool.parameters.type !== "object") {
      problems.push('parameters must be an object schema \u2014 a missing type: "object" silently breaks tool calling');
    }
    walk(tool.parameters, "parameters");
    return problems;
  }
  function describeForm(specs, url = "") {
    const usable = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file");
    if (usable.length === 0) return "There is no form on this page yet.";
    const lines = usable.map((spec) => {
      const bits = [`- ${spec.label || spec.id}`];
      if (spec.required) bits.push("(required)");
      if (spec.options?.length) {
        const shown = spec.options.slice(0, 6).map((o) => o.label).join(", ");
        bits.push(`\u2014 choose from: ${shown}${spec.options.length > 6 ? ", \u2026" : ""}`);
      }
      return bits.join(" ");
    });
    const where = url ? ` at ${url}` : "";
    return [
      `The form in front of the person${where} has ${usable.length} fields:`,
      ...lines
    ].join("\n");
  }
  function stillMissing(specs, filledIds) {
    const filled = new Set(filledIds);
    return specs.filter(
      (spec) => spec.required && !filled.has(spec.id) && !spec.suspectedHoneypot && spec.kind !== "file"
    );
  }

  // core/src/evidence.ts
  var MIN_WORD_OVERLAP = 0.7;
  var MIN_QUOTE_CHARS = 2;
  function normalise2(text) {
    return text.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function words(text) {
    return normalise2(text).split(" ").filter(Boolean);
  }
  function checkEvidence(transcript, evidence) {
    const quote = (evidence ?? "").trim();
    if (quote.length < MIN_QUOTE_CHARS) {
      return { ok: false, reason: "Nothing was spoken about this field, so it stays empty." };
    }
    const heard = normalise2(transcript);
    if (!heard) {
      return { ok: false, reason: "Nothing has been said yet, so there is nothing to go on." };
    }
    const normalisedQuote = normalise2(quote);
    if (normalisedQuote.length < MIN_QUOTE_CHARS) {
      return { ok: false, reason: "Nothing was spoken about this field, so it stays empty." };
    }
    if (heard.includes(normalisedQuote)) return { ok: true };
    const quoteWords = words(quote);
    if (quoteWords.length === 0) {
      return { ok: false, reason: "Nothing was spoken about this field, so it stays empty." };
    }
    const heardWords = new Set(words(transcript));
    const found = quoteWords.filter((word) => heardWords.has(word)).length;
    if (found / quoteWords.length >= MIN_WORD_OVERLAP) return { ok: true };
    return {
      ok: false,
      reason: `Those words were not in what was said, so this field stays empty. Quote the person exactly, or leave the field out.`
    };
  }
  function keepOnlyWhatWasSaid(transcript, values) {
    const spoken = [];
    const unsupported = [];
    for (const value of values) {
      const check = checkEvidence(transcript, value.evidence);
      if (check.ok) spoken.push(value);
      else unsupported.push({ fieldId: value.fieldId, reason: check.reason });
    }
    return { spoken, unsupported };
  }

  // core/src/dictation.ts
  var MAX_STT_PROMPT = 6e3;
  var MAX_INSTRUCTION = 2048;
  var MAX_KEYTERMS = 100;
  var MAX_KEYTERMS_CHARS = 8e3;
  var MAX_CALLS_PER_UTTERANCE = 3;
  function clip(text, max) {
    return text.length <= max ? text : text.slice(0, max);
  }
  function keytermsFrom(specs, known) {
    const terms = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (raw) => {
      const term = (raw ?? "").trim();
      if (!term || term.length < 2 || term.length > 60) return;
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      terms.push(term);
    };
    for (const value of Object.values(known)) {
      add(value);
      for (const word of value.split(/\s+/)) {
        if (/^[A-Z]/.test(word)) add(word);
      }
    }
    for (const spec of specs) {
      for (const option of spec.options ?? []) add(option.label);
    }
    const capped = [];
    let chars = 0;
    for (const term of terms) {
      if (capped.length >= MAX_KEYTERMS) break;
      if (chars + term.length > MAX_KEYTERMS_CHARS) break;
      capped.push(term);
      chars += term.length;
    }
    return capped;
  }
  function configForField(spec, options = {}) {
    const { specs = [], known = {}, languageCodes = ["en", "hi"], sampleRate = 24e3 } = options;
    const question = spec.label || spec.id;
    const config = {
      sample_rate: sampleRate,
      channels: 1,
      language_codes: languageCodes,
      stt_prompt: clip(
        `Someone is filling in a form and speaking their answer to the question "${question}" out loud, in their own words, the way they would tell a friend. They may pause, restart, or switch between English and Hindi mid-sentence.`,
        MAX_STT_PROMPT
      ),
      llm_instruction: clip(instructionForField(spec), MAX_INSTRUCTION)
    };
    const keyterms = keytermsFrom(specs, known);
    if (keyterms.length > 0) config.keyterms_prompt = keyterms;
    return config;
  }
  function instructionForField(spec) {
    const question = spec.label || spec.id;
    const parts = [
      `This is somebody's spoken answer to "${question}" on a form.`,
      "Write it as the person would have typed it: remove filler words and false starts, resolve self-corrections to what they landed on, and punctuate it properly.",
      "Keep their own words, their own phrasing and their own tone.",
      "Keep hedges like I think or probably \u2014 those change the meaning and are not filler.",
      "Do not add anything they did not say. Do not answer the question for them. Do not make them sound more certain, more formal or more impressive than they were.",
      "Return only the answer itself, with no preamble and no quotation marks."
    ];
    if (spec.maxLength) {
      parts.push(`It must fit in ${spec.maxLength} characters.`);
    }
    return parts.join(" ");
  }
  function fieldsWorthShaping(specs, filledIds, limit = MAX_CALLS_PER_UTTERANCE) {
    const filled = new Set(filledIds);
    return specs.filter((spec) => spec.longForm && filled.has(spec.id) && !spec.suspectedHoneypot).slice(0, limit);
  }
  function shapeResult(fieldId, result) {
    const verbatim = (result.text ?? "").trim();
    const rewrite = (result.llm_response ?? "").trim();
    if (rewrite) {
      return { fieldId, verbatim, clean: rewrite, rewritten: true };
    }
    return {
      fieldId,
      verbatim,
      clean: verbatim,
      rewritten: false,
      note: result.llm_error ? `The tidy-up did not finish (${result.llm_error}), so this is exactly what you said.` : "The tidy-up did not run, so this is exactly what you said."
    };
  }

  // core/src/index.ts
  var CORE_VERSION = "0.5.0";

  // tools/probe.ts
  window.__longtake = {
    version: CORE_VERSION,
    readForm,
    writeValues,
    harvestOptions,
    whenSettled,
    waitForForm,
    buildFillTool,
    validateTool,
    describeForm,
    stillMissing,
    checkEvidence,
    keepOnlyWhatWasSaid,
    configForField,
    instructionForField,
    keytermsFrom,
    fieldsWorthShaping,
    shapeResult,
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
