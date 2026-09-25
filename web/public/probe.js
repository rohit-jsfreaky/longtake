"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // core/src/types.ts
  function fieldName(spec) {
    const question = (spec.label || spec.id).replace(/\s*\*\s*$/, "").trim();
    return spec.part ? `${question} \u2014 ${spec.part}` : question;
  }

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
      const siblings = Array.from(parent.children).filter((c2) => c2.tagName === walker.tagName);
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
  function choiceGroup(el) {
    const input = el;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type !== "radio" && type !== "checkbox") return [input];
    const name = el.getAttribute("name");
    const root = el.getRootNode();
    let byName = [input];
    if (name) {
      const base = arrayBase(name);
      const group = base ? namedGroupOf(el) : null;
      byName = Array.from(root.querySelectorAll(`input[type="${type}"]`)).filter((other) => {
        const otherName = other.getAttribute("name");
        if (otherName === name) return true;
        return group !== null && otherName !== null && arrayBase(otherName) === base && namedGroupOf(other) === group;
      });
    }
    if (type === "radio" || byName.length > 1) return byName;
    const set = el.parentElement?.closest("fieldset, [role='group']");
    if (!set) return byName;
    const controls = Array.from(set.querySelectorAll(ANSWERING));
    const onlyBoxes = controls.every((control) => control.localName === "input" && (control.getAttribute("type") ?? "").toLowerCase() === "checkbox");
    return onlyBoxes && controls.length > 1 ? controls : byName;
  }
  function toggleGroup(el) {
    const holder = el.hasAttribute("aria-pressed") ? el.parentElement : el;
    const toggles = Array.from(holder?.children ?? []).filter(
      (node) => node.hasAttribute("aria-pressed") && (node.localName === "button" || node.getAttribute("role") === "button")
    );
    return toggles.length >= 2 ? toggles : [];
  }
  var ANSWERING = "input:not([type='hidden']), select, textarea, [role='checkbox'], [role='radio'], [role='switch'], [role='combobox'], [role='listbox'], [role='textbox'], [contenteditable='true']";
  function choiceKey(box, group = choiceGroup(box)) {
    const apart = (read) => {
      const all = group.map(read);
      return all.every((one) => one !== null && one !== "") && new Set(all).size === all.length;
    };
    const value = (member) => member.value;
    if (apart(value)) return value(box);
    if (apart((member) => member.getAttribute("name"))) return box.getAttribute("name");
    if (apart((member) => member.id || null)) return box.id;
    return String(group.indexOf(box));
  }
  function arrayBase(name) {
    const bracket = name.indexOf("[");
    return bracket > 0 ? name.slice(0, bracket) : null;
  }
  function namedGroupOf(el) {
    for (let node = el.parentElement?.closest("fieldset, [role='radiogroup'], [role='group']"); node; node = node.parentElement?.closest("fieldset, [role='radiogroup'], [role='group']")) {
      if (node.hasAttribute("aria-labelledby") || node.hasAttribute("aria-label")) return node;
      if (node.localName === "fieldset" && node.querySelector(":scope > legend")) return node;
    }
    return null;
  }
  function isVisible(el) {
    if (paintedOnScreen(el)) return true;
    if (declaresItselfInteractive(el) && ownOpacity(el) === 0) {
      const holder = sizedAncestor(el);
      return holder !== null && paintedOnScreen(holder);
    }
    const input = el;
    if (el.localName !== "input" || input.type !== "checkbox" && input.type !== "radio") return false;
    return Array.from(input.labels ?? []).some((label) => paintedOnScreen(label));
  }
  function ownOpacity(el) {
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    return style ? Number(style.opacity) : 1;
  }
  function sizedAncestor(el) {
    let ancestor = el.parentElement;
    for (let hops = 0; ancestor && hops < 3; hops++) {
      const box = ancestor.getBoundingClientRect();
      if (box.width > 0 || box.height > 0) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return null;
  }
  function paintedOnScreen(el) {
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
    let scrollX = 0;
    let scrollY = 0;
    for (let node = html.parentElement; node; node = node.parentElement) {
      scrollX += node.scrollLeft;
      scrollY += node.scrollTop;
    }
    if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false;
    return true;
  }
  var widgetQueue = Promise.resolve();
  function exclusively(work) {
    const run = widgetQueue.then(work, work);
    widgetQueue = run.catch(() => void 0);
    return run;
  }
  function ownsOptions(trigger, option) {
    const list = option.closest("[role='listbox'],[role='menu'],[role='tree'],[role='grid']");
    const controls = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`.split(/\s+/).filter(Boolean);
    const labelledBy = trigger.getAttribute("aria-labelledby");
    const listLabel = list?.getAttribute("aria-labelledby");
    if (list?.id && controls.includes(list.id)) return true;
    if (option.id && controls.includes(option.id)) return true;
    if (labelledBy && listLabel === labelledBy) return true;
    if (labelledBy && listLabel && listLabel !== labelledBy) return false;
    if (controls.length > 0 && list?.id && !controls.includes(list.id)) return false;
    return null;
  }
  function openWidget(el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
    if (el.getAttribute("aria-expanded") === "true") return;
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window })
      );
    }
  }
  function closeWidget(el, shown2) {
    const open = () => !shown2 || shown2.some((option) => option.isConnected && isVisible(option));
    if (!open()) return;
    el.blur();
    const dialog = el.closest("[role='dialog'], dialog, [aria-modal='true']");
    const outside = el.closest("form") ?? dialog ?? el.ownerDocument?.body;
    if (outside) {
      for (const type of ["pointerdown", "mousedown"]) {
        outside.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
      }
    }
    if (!open()) return;
    if (!dialog) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, composed: true }));
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
      const target = "body" in root ? root.body : root;
      if (!target) {
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
      observer.observe(target, { childList: true, subtree: true, attributes: true });
    });
  }

  // node_modules/dom-accessibility-api/dist/polyfills/array.from.mjs
  var toStr = Object.prototype.toString;
  function isCallable(fn) {
    return typeof fn === "function" || toStr.call(fn) === "[object Function]";
  }
  function toInteger(value) {
    var number = Number(value);
    if (isNaN(number)) {
      return 0;
    }
    if (number === 0 || !isFinite(number)) {
      return number;
    }
    return (number > 0 ? 1 : -1) * Math.floor(Math.abs(number));
  }
  var maxSafeInteger = Math.pow(2, 53) - 1;
  function toLength(value) {
    var len = toInteger(value);
    return Math.min(Math.max(len, 0), maxSafeInteger);
  }
  function arrayFrom(arrayLike, mapFn) {
    var C = Array;
    var items = Object(arrayLike);
    if (arrayLike == null) {
      throw new TypeError("Array.from requires an array-like object - not null or undefined");
    }
    if (typeof mapFn !== "undefined") {
      if (!isCallable(mapFn)) {
        throw new TypeError("Array.from: when provided, the second argument must be a function");
      }
    }
    var len = toLength(items.length);
    var A = isCallable(C) ? Object(new C(len)) : new Array(len);
    var k = 0;
    var kValue;
    while (k < len) {
      kValue = items[k];
      if (mapFn) {
        A[k] = mapFn(kValue, k);
      } else {
        A[k] = kValue;
      }
      k += 1;
    }
    A.length = len;
    return A;
  }

  // node_modules/dom-accessibility-api/dist/polyfills/SetLike.mjs
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }
  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
    }
  }
  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    Object.defineProperty(Constructor, "prototype", { writable: false });
    return Constructor;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return "symbol" == _typeof(i) ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if ("object" != _typeof(t) || !t) return t;
    var e = t[Symbol.toPrimitive];
    if (void 0 !== e) {
      var i = e.call(t, r || "default");
      if ("object" != _typeof(i)) return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return ("string" === r ? String : Number)(t);
  }
  var SetLike = /* @__PURE__ */ (function() {
    function SetLike2() {
      var items = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : [];
      _classCallCheck(this, SetLike2);
      _defineProperty(this, "items", void 0);
      this.items = items;
    }
    return _createClass(SetLike2, [{
      key: "add",
      value: function add(value) {
        if (this.has(value) === false) {
          this.items.push(value);
        }
        return this;
      }
    }, {
      key: "clear",
      value: function clear() {
        this.items = [];
      }
    }, {
      key: "delete",
      value: function _delete(value) {
        var previousLength = this.items.length;
        this.items = this.items.filter(function(item) {
          return item !== value;
        });
        return previousLength !== this.items.length;
      }
    }, {
      key: "forEach",
      value: function forEach(callbackfn) {
        var _this = this;
        this.items.forEach(function(item) {
          callbackfn(item, item, _this);
        });
      }
    }, {
      key: "has",
      value: function has(value) {
        return this.items.indexOf(value) !== -1;
      }
    }, {
      key: "size",
      get: function get() {
        return this.items.length;
      }
    }]);
  })();
  var SetLike_default = typeof Set === "undefined" ? Set : SetLike;

  // node_modules/dom-accessibility-api/dist/getRole.mjs
  function getLocalName(element) {
    var _element$localName;
    return (
      // eslint-disable-next-line no-restricted-properties -- actual guard for environments without localName
      (_element$localName = element.localName) !== null && _element$localName !== void 0 ? _element$localName : (
        // eslint-disable-next-line no-restricted-properties -- required for the fallback
        element.tagName.toLowerCase()
      )
    );
  }
  var localNameToRoleMappings = {
    article: "article",
    aside: "complementary",
    button: "button",
    datalist: "listbox",
    dd: "definition",
    details: "group",
    dialog: "dialog",
    dt: "term",
    fieldset: "group",
    figure: "figure",
    // WARNING: Only with an accessible name
    form: "form",
    footer: "contentinfo",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    header: "banner",
    hr: "separator",
    html: "document",
    legend: "legend",
    li: "listitem",
    math: "math",
    main: "main",
    menu: "list",
    nav: "navigation",
    ol: "list",
    optgroup: "group",
    // WARNING: Only in certain context
    option: "option",
    output: "status",
    progress: "progressbar",
    // WARNING: Only with an accessible name
    section: "region",
    summary: "button",
    table: "table",
    tbody: "rowgroup",
    textarea: "textbox",
    tfoot: "rowgroup",
    // WARNING: Only in certain context
    td: "cell",
    th: "columnheader",
    thead: "rowgroup",
    tr: "row",
    ul: "list"
  };
  var prohibitedAttributes = {
    caption: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    code: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    deletion: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    emphasis: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    generic: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby", "aria-roledescription"]),
    insertion: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    none: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    paragraph: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    presentation: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    strong: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    subscript: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"]),
    superscript: /* @__PURE__ */ new Set(["aria-label", "aria-labelledby"])
  };
  function hasGlobalAriaAttributes(element, role) {
    return [
      "aria-atomic",
      "aria-busy",
      "aria-controls",
      "aria-current",
      "aria-description",
      "aria-describedby",
      "aria-details",
      // "disabled",
      "aria-dropeffect",
      // "errormessage",
      "aria-flowto",
      "aria-grabbed",
      // "haspopup",
      "aria-hidden",
      // "invalid",
      "aria-keyshortcuts",
      "aria-label",
      "aria-labelledby",
      "aria-live",
      "aria-owns",
      "aria-relevant",
      "aria-roledescription"
    ].some(function(attributeName) {
      var _prohibitedAttributes;
      return element.hasAttribute(attributeName) && !((_prohibitedAttributes = prohibitedAttributes[role]) !== null && _prohibitedAttributes !== void 0 && _prohibitedAttributes.has(attributeName));
    });
  }
  function ignorePresentationalRole(element, implicitRole) {
    return hasGlobalAriaAttributes(element, implicitRole);
  }
  function getRole(element) {
    var explicitRole = getExplicitRole(element);
    if (explicitRole === null || presentationRoles.indexOf(explicitRole) !== -1) {
      var implicitRole = getImplicitRole(element);
      if (presentationRoles.indexOf(explicitRole || "") === -1 || ignorePresentationalRole(element, implicitRole || "")) {
        return implicitRole;
      }
    }
    return explicitRole;
  }
  function getImplicitRole(element) {
    var mappedByTag = localNameToRoleMappings[getLocalName(element)];
    if (mappedByTag !== void 0) {
      return mappedByTag;
    }
    switch (getLocalName(element)) {
      case "a":
      case "area":
      case "link":
        if (element.hasAttribute("href")) {
          return "link";
        }
        break;
      case "img":
        if (element.getAttribute("alt") === "" && !ignorePresentationalRole(element, "img")) {
          return "presentation";
        }
        return "img";
      case "input": {
        var _ref = element, type = _ref.type;
        switch (type) {
          case "button":
          case "image":
          case "reset":
          case "submit":
            return "button";
          case "checkbox":
          case "radio":
            return type;
          case "range":
            return "slider";
          case "email":
          case "tel":
          case "text":
          case "url":
            if (element.hasAttribute("list")) {
              return "combobox";
            }
            return "textbox";
          case "search":
            if (element.hasAttribute("list")) {
              return "combobox";
            }
            return "searchbox";
          case "number":
            return "spinbutton";
          default:
            return null;
        }
      }
      case "select":
        if (element.hasAttribute("multiple") || element.size > 1) {
          return "listbox";
        }
        return "combobox";
    }
    return null;
  }
  function getExplicitRole(element) {
    var role = element.getAttribute("role");
    if (role !== null) {
      var explicitRole = role.trim().split(" ")[0];
      if (explicitRole.length > 0) {
        return explicitRole;
      }
    }
    return null;
  }

  // node_modules/dom-accessibility-api/dist/util.mjs
  var presentationRoles = ["presentation", "none"];
  function isElement(node) {
    return node !== null && node.nodeType === node.ELEMENT_NODE;
  }
  function isHTMLTableCaptionElement(node) {
    return isElement(node) && getLocalName(node) === "caption";
  }
  function isHTMLInputElement(node) {
    return isElement(node) && getLocalName(node) === "input";
  }
  function isHTMLOptGroupElement(node) {
    return isElement(node) && getLocalName(node) === "optgroup";
  }
  function isHTMLSelectElement(node) {
    return isElement(node) && getLocalName(node) === "select";
  }
  function isHTMLTableElement(node) {
    return isElement(node) && getLocalName(node) === "table";
  }
  function isHTMLTextAreaElement(node) {
    return isElement(node) && getLocalName(node) === "textarea";
  }
  function safeWindow(node) {
    var _ref = node.ownerDocument === null ? node : node.ownerDocument, defaultView = _ref.defaultView;
    if (defaultView === null) {
      throw new TypeError("no window available");
    }
    return defaultView;
  }
  function isHTMLFieldSetElement(node) {
    return isElement(node) && getLocalName(node) === "fieldset";
  }
  function isHTMLLegendElement(node) {
    return isElement(node) && getLocalName(node) === "legend";
  }
  function isHTMLSlotElement(node) {
    return isElement(node) && getLocalName(node) === "slot";
  }
  function isSVGElement(node) {
    return isElement(node) && node.ownerSVGElement !== void 0;
  }
  function isSVGSVGElement(node) {
    return isElement(node) && getLocalName(node) === "svg";
  }
  function isSVGTitleElement(node) {
    return isSVGElement(node) && getLocalName(node) === "title";
  }
  function queryIdRefs(node, attributeName) {
    if (isElement(node) && node.hasAttribute(attributeName)) {
      var ids = node.getAttribute(attributeName).split(" ");
      var root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
      return ids.map(function(id) {
        return root.getElementById(id);
      }).filter(
        function(element) {
          return element !== null;
        }
        // TODO: why does this not narrow?
      );
    }
    return [];
  }
  function hasAnyConcreteRoles(node, roles) {
    if (isElement(node)) {
      return roles.indexOf(getRole(node)) !== -1;
    }
    return false;
  }

  // node_modules/dom-accessibility-api/dist/accessible-name-and-description.mjs
  function asFlatString(s) {
    return s.trim().replace(/\s\s+/g, " ");
  }
  function isHidden(node, getComputedStyleImplementation) {
    if (!isElement(node)) {
      return false;
    }
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") {
      return true;
    }
    var style = getComputedStyleImplementation(node);
    return style.getPropertyValue("display") === "none" || style.getPropertyValue("visibility") === "hidden";
  }
  function isControl(node) {
    return hasAnyConcreteRoles(node, ["button", "combobox", "listbox", "textbox"]) || hasAbstractRole(node, "range");
  }
  function hasAbstractRole(node, role) {
    if (!isElement(node)) {
      return false;
    }
    switch (role) {
      case "range":
        return hasAnyConcreteRoles(node, ["meter", "progressbar", "scrollbar", "slider", "spinbutton"]);
      default:
        throw new TypeError("No knowledge about abstract role '".concat(role, "'. This is likely a bug :("));
    }
  }
  function querySelectorAllSubtree(element, selectors) {
    var elements = arrayFrom(element.querySelectorAll(selectors));
    queryIdRefs(element, "aria-owns").forEach(function(root) {
      elements.push.apply(elements, arrayFrom(root.querySelectorAll(selectors)));
    });
    return elements;
  }
  function querySelectedOptions(listbox) {
    if (isHTMLSelectElement(listbox)) {
      return listbox.selectedOptions || querySelectorAllSubtree(listbox, "[selected]");
    }
    return querySelectorAllSubtree(listbox, '[aria-selected="true"]');
  }
  function isMarkedPresentational(node) {
    return hasAnyConcreteRoles(node, presentationRoles);
  }
  function isNativeHostLanguageTextAlternativeElement(node) {
    return isHTMLTableCaptionElement(node);
  }
  function allowsNameFromContent(node) {
    return hasAnyConcreteRoles(node, ["button", "cell", "checkbox", "columnheader", "gridcell", "heading", "label", "legend", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "row", "rowheader", "switch", "tab", "tooltip", "treeitem"]);
  }
  function isDescendantOfNativeHostLanguageTextAlternativeElement(node) {
    return false;
  }
  function getValueOfTextbox(element) {
    if (isHTMLInputElement(element) || isHTMLTextAreaElement(element)) {
      return element.value;
    }
    return element.textContent || "";
  }
  function getTextualContent(declaration) {
    var content = declaration.getPropertyValue("content");
    if (/^["'].*["']$/.test(content)) {
      return content.slice(1, -1);
    }
    return "";
  }
  function isLabelableElement(element) {
    var localName = getLocalName(element);
    return localName === "button" || localName === "input" && element.getAttribute("type") !== "hidden" || localName === "meter" || localName === "output" || localName === "progress" || localName === "select" || localName === "textarea";
  }
  function findLabelableElement(element) {
    if (isLabelableElement(element)) {
      return element;
    }
    var labelableElement = null;
    element.childNodes.forEach(function(childNode) {
      if (labelableElement === null && isElement(childNode)) {
        var descendantLabelableElement = findLabelableElement(childNode);
        if (descendantLabelableElement !== null) {
          labelableElement = descendantLabelableElement;
        }
      }
    });
    return labelableElement;
  }
  function getControlOfLabel(label) {
    if (label.control !== void 0) {
      return label.control;
    }
    var htmlFor = label.getAttribute("for");
    if (htmlFor !== null) {
      return label.ownerDocument.getElementById(htmlFor);
    }
    return findLabelableElement(label);
  }
  function getLabels(element) {
    var labelsProperty = element.labels;
    if (labelsProperty === null) {
      return labelsProperty;
    }
    if (labelsProperty !== void 0) {
      return arrayFrom(labelsProperty);
    }
    if (!isLabelableElement(element)) {
      return null;
    }
    var document2 = element.ownerDocument;
    return arrayFrom(document2.querySelectorAll("label")).filter(function(label) {
      return getControlOfLabel(label) === element;
    });
  }
  function getSlotContents(slot) {
    var assignedNodes = slot.assignedNodes();
    if (assignedNodes.length === 0) {
      return arrayFrom(slot.childNodes);
    }
    return assignedNodes;
  }
  function computeTextAlternative(root) {
    var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    var consultedNodes = new SetLike_default();
    var computedStyles = typeof Map === "undefined" ? void 0 : /* @__PURE__ */ new Map();
    var window2 = safeWindow(root);
    var _options$compute = options.compute, compute = _options$compute === void 0 ? "name" : _options$compute, _options$computedStyl = options.computedStyleSupportsPseudoElements, computedStyleSupportsPseudoElements = _options$computedStyl === void 0 ? options.getComputedStyle !== void 0 : _options$computedStyl, _options$getComputedS = options.getComputedStyle, uncachedGetComputedStyle = _options$getComputedS === void 0 ? window2.getComputedStyle.bind(window2) : _options$getComputedS, _options$hidden = options.hidden, hidden = _options$hidden === void 0 ? false : _options$hidden;
    var getComputedStyle = function getComputedStyle2(el, pseudoElement) {
      if (pseudoElement !== void 0) {
        throw new Error("use uncachedGetComputedStyle directly for pseudo elements");
      }
      if (computedStyles === void 0) {
        return uncachedGetComputedStyle(el);
      }
      var cachedStyles = computedStyles.get(el);
      if (cachedStyles) {
        return cachedStyles;
      }
      var style = uncachedGetComputedStyle(el, pseudoElement);
      computedStyles.set(el, style);
      return style;
    };
    function computeMiscTextAlternative(node, context) {
      var accumulatedText = "";
      if (isElement(node) && computedStyleSupportsPseudoElements) {
        var pseudoBefore = uncachedGetComputedStyle(node, "::before");
        var beforeContent = getTextualContent(pseudoBefore);
        accumulatedText = "".concat(beforeContent, " ").concat(accumulatedText);
      }
      var childNodes = isHTMLSlotElement(node) ? getSlotContents(node) : arrayFrom(node.childNodes).concat(queryIdRefs(node, "aria-owns"));
      childNodes.forEach(function(child) {
        var result = computeTextAlternative2(child, {
          isEmbeddedInLabel: context.isEmbeddedInLabel,
          isReferenced: false,
          recursion: true
        });
        var display = isElement(child) ? getComputedStyle(child).getPropertyValue("display") : "inline";
        var separator = display !== "inline" ? " " : "";
        accumulatedText += "".concat(separator).concat(result).concat(separator);
      });
      if (isElement(node) && computedStyleSupportsPseudoElements) {
        var pseudoAfter = uncachedGetComputedStyle(node, "::after");
        var afterContent = getTextualContent(pseudoAfter);
        accumulatedText = "".concat(accumulatedText, " ").concat(afterContent);
      }
      return accumulatedText.trim();
    }
    function useAttribute(element, attributeName) {
      var attribute = element.getAttributeNode(attributeName);
      if (attribute !== null && !consultedNodes.has(attribute) && attribute.value.trim() !== "") {
        consultedNodes.add(attribute);
        return attribute.value;
      }
      return null;
    }
    function computeTooltipAttributeValue(node) {
      if (!isElement(node)) {
        return null;
      }
      return useAttribute(node, "title");
    }
    function computeElementTextAlternative(node) {
      if (!isElement(node)) {
        return null;
      }
      if (isHTMLFieldSetElement(node)) {
        consultedNodes.add(node);
        var children = arrayFrom(node.childNodes);
        for (var i = 0; i < children.length; i += 1) {
          var child = children[i];
          if (isHTMLLegendElement(child)) {
            return computeTextAlternative2(child, {
              isEmbeddedInLabel: false,
              isReferenced: false,
              recursion: false
            });
          }
        }
      } else if (isHTMLTableElement(node)) {
        consultedNodes.add(node);
        var _children = arrayFrom(node.childNodes);
        for (var _i = 0; _i < _children.length; _i += 1) {
          var _child = _children[_i];
          if (isHTMLTableCaptionElement(_child)) {
            return computeTextAlternative2(_child, {
              isEmbeddedInLabel: false,
              isReferenced: false,
              recursion: false
            });
          }
        }
      } else if (isSVGSVGElement(node)) {
        consultedNodes.add(node);
        var _children2 = arrayFrom(node.childNodes);
        for (var _i2 = 0; _i2 < _children2.length; _i2 += 1) {
          var _child2 = _children2[_i2];
          if (isSVGTitleElement(_child2)) {
            return _child2.textContent;
          }
        }
        return null;
      } else if (getLocalName(node) === "img" || getLocalName(node) === "area") {
        var nameFromAlt = useAttribute(node, "alt");
        if (nameFromAlt !== null) {
          return nameFromAlt;
        }
      } else if (isHTMLOptGroupElement(node)) {
        var nameFromLabel = useAttribute(node, "label");
        if (nameFromLabel !== null) {
          return nameFromLabel;
        }
      }
      if (isHTMLInputElement(node) && (node.type === "button" || node.type === "submit" || node.type === "reset")) {
        var nameFromValue = useAttribute(node, "value");
        if (nameFromValue !== null) {
          return nameFromValue;
        }
        if (node.type === "submit") {
          return "Submit";
        }
        if (node.type === "reset") {
          return "Reset";
        }
      }
      var labels = getLabels(node);
      if (labels !== null && labels.length !== 0) {
        consultedNodes.add(node);
        return arrayFrom(labels).map(function(element) {
          return computeTextAlternative2(element, {
            isEmbeddedInLabel: true,
            isReferenced: false,
            recursion: true
          });
        }).filter(function(label) {
          return label.length > 0;
        }).join(" ");
      }
      if (isHTMLInputElement(node) && node.type === "image") {
        var _nameFromAlt = useAttribute(node, "alt");
        if (_nameFromAlt !== null) {
          return _nameFromAlt;
        }
        var nameFromTitle = useAttribute(node, "title");
        if (nameFromTitle !== null) {
          return nameFromTitle;
        }
        return "Submit Query";
      }
      if (hasAnyConcreteRoles(node, ["button"])) {
        var nameFromSubTree = computeMiscTextAlternative(node, {
          isEmbeddedInLabel: false,
          isReferenced: false
        });
        if (nameFromSubTree !== "") {
          return nameFromSubTree;
        }
      }
      return null;
    }
    function computeTextAlternative2(current, context) {
      if (consultedNodes.has(current)) {
        return "";
      }
      if (!hidden && isHidden(current, getComputedStyle) && !context.isReferenced) {
        consultedNodes.add(current);
        return "";
      }
      var labelAttributeNode = isElement(current) ? current.getAttributeNode("aria-labelledby") : null;
      var labelElements = labelAttributeNode !== null && !consultedNodes.has(labelAttributeNode) ? queryIdRefs(current, "aria-labelledby") : [];
      if (compute === "name" && !context.isReferenced && labelElements.length > 0) {
        consultedNodes.add(labelAttributeNode);
        return labelElements.map(function(element) {
          return computeTextAlternative2(element, {
            isEmbeddedInLabel: context.isEmbeddedInLabel,
            isReferenced: true,
            // this isn't recursion as specified, otherwise we would skip
            // `aria-label` in
            // <input id="myself" aria-label="foo" aria-labelledby="myself"
            recursion: false
          });
        }).join(" ");
      }
      var skipToStep2E = context.recursion && isControl(current) && compute === "name";
      if (!skipToStep2E) {
        var ariaLabel = (isElement(current) && current.getAttribute("aria-label") || "").trim();
        if (ariaLabel !== "" && compute === "name") {
          consultedNodes.add(current);
          return ariaLabel;
        }
        if (!isMarkedPresentational(current)) {
          var elementTextAlternative = computeElementTextAlternative(current);
          if (elementTextAlternative !== null) {
            consultedNodes.add(current);
            return elementTextAlternative;
          }
        }
      }
      if (hasAnyConcreteRoles(current, ["menu"])) {
        consultedNodes.add(current);
        return "";
      }
      if (skipToStep2E || context.isEmbeddedInLabel || context.isReferenced) {
        if (hasAnyConcreteRoles(current, ["combobox", "listbox"])) {
          consultedNodes.add(current);
          var selectedOptions = querySelectedOptions(current);
          if (selectedOptions.length === 0) {
            return isHTMLInputElement(current) ? current.value : "";
          }
          return arrayFrom(selectedOptions).map(function(selectedOption) {
            return computeTextAlternative2(selectedOption, {
              isEmbeddedInLabel: context.isEmbeddedInLabel,
              isReferenced: false,
              recursion: true
            });
          }).join(" ");
        }
        if (hasAbstractRole(current, "range")) {
          consultedNodes.add(current);
          if (current.hasAttribute("aria-valuetext")) {
            return current.getAttribute("aria-valuetext");
          }
          if (current.hasAttribute("aria-valuenow")) {
            return current.getAttribute("aria-valuenow");
          }
          return current.getAttribute("value") || "";
        }
        if (hasAnyConcreteRoles(current, ["textbox"])) {
          consultedNodes.add(current);
          return getValueOfTextbox(current);
        }
      }
      if (allowsNameFromContent(current) || isElement(current) && context.isReferenced || isNativeHostLanguageTextAlternativeElement(current) || isDescendantOfNativeHostLanguageTextAlternativeElement(current)) {
        var accumulatedText2F = computeMiscTextAlternative(current, {
          isEmbeddedInLabel: context.isEmbeddedInLabel,
          isReferenced: false
        });
        if (accumulatedText2F !== "") {
          consultedNodes.add(current);
          return accumulatedText2F;
        }
      }
      if (current.nodeType === current.TEXT_NODE) {
        consultedNodes.add(current);
        return current.textContent || "";
      }
      if (context.recursion) {
        consultedNodes.add(current);
        return computeMiscTextAlternative(current, {
          isEmbeddedInLabel: context.isEmbeddedInLabel,
          isReferenced: false
        });
      }
      var tooltipAttributeValue = computeTooltipAttributeValue(current);
      if (tooltipAttributeValue !== null) {
        consultedNodes.add(current);
        return tooltipAttributeValue;
      }
      consultedNodes.add(current);
      return "";
    }
    return asFlatString(computeTextAlternative2(root, {
      isEmbeddedInLabel: false,
      // by spec computeAccessibleDescription starts with the referenced elements as roots
      isReferenced: compute === "description",
      recursion: false
    }));
  }

  // node_modules/dom-accessibility-api/dist/accessible-description.mjs
  function _typeof2(o) {
    "@babel/helpers - typeof";
    return _typeof2 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof2(o);
  }
  function ownKeys(e, r) {
    var t = Object.keys(e);
    if (Object.getOwnPropertySymbols) {
      var o = Object.getOwnPropertySymbols(e);
      r && (o = o.filter(function(r2) {
        return Object.getOwnPropertyDescriptor(e, r2).enumerable;
      })), t.push.apply(t, o);
    }
    return t;
  }
  function _objectSpread(e) {
    for (var r = 1; r < arguments.length; r++) {
      var t = null != arguments[r] ? arguments[r] : {};
      r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
        _defineProperty2(e, r2, t[r2]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
        Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
      });
    }
    return e;
  }
  function _defineProperty2(obj, key, value) {
    key = _toPropertyKey2(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey2(t) {
    var i = _toPrimitive2(t, "string");
    return "symbol" == _typeof2(i) ? i : i + "";
  }
  function _toPrimitive2(t, r) {
    if ("object" != _typeof2(t) || !t) return t;
    var e = t[Symbol.toPrimitive];
    if (void 0 !== e) {
      var i = e.call(t, r || "default");
      if ("object" != _typeof2(i)) return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return ("string" === r ? String : Number)(t);
  }
  function computeAccessibleDescription(root) {
    var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    var description = queryIdRefs(root, "aria-describedby").map(function(element) {
      return computeTextAlternative(element, _objectSpread(_objectSpread({}, options), {}, {
        compute: "description"
      }));
    }).join(" ");
    if (description === "") {
      var ariaDescription = root.getAttribute("aria-description");
      description = ariaDescription === null ? "" : ariaDescription;
    }
    if (description === "") {
      var title = root.getAttribute("title");
      description = title === null ? "" : title;
    }
    return description;
  }

  // node_modules/dom-accessibility-api/dist/accessible-name.mjs
  function prohibitsNaming(node) {
    return hasAnyConcreteRoles(node, ["caption", "code", "deletion", "emphasis", "generic", "insertion", "none", "paragraph", "presentation", "strong", "subscript", "superscript"]);
  }
  function computeAccessibleName(root) {
    var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    if (prohibitsNaming(root)) {
      return "";
    }
    return computeTextAlternative(root, options);
  }

  // core/src/accname.ts
  var OPTIONS = { computedStyleSupportsPseudoElements: true };
  var flat = (text4) => text4.replace(/\s+/g, " ").trim();
  function accessibleName(el) {
    try {
      return flat(computeAccessibleName(el, OPTIONS));
    } catch {
      return "";
    }
  }
  function accessibleDescription(el) {
    try {
      return flat(computeAccessibleDescription(el, OPTIONS));
    } catch {
      return "";
    }
  }

  // core/src/shapes.ts
  var DATE_MASK = /^(mm|dd|yyyy)([/.\-\s])(mm|dd)\2(yyyy|mm|dd)$/i;
  var DIGIT_MASK = /^[\s()+\-./]*[09#](?:[\s()+\-./]*[09#])*[\s()+\-./]*$/;
  function calendarDay(value) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    const parsed = new Date(value.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1"));
    if (Number.isNaN(parsed.getTime())) return null;
    return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
  }

  // core/src/phones.ts
  var DIAL_CODE = /\+\d{1,4}\b/;
  var PHONE_WHOLE = "contact.phone";
  var PHONE_NUMBER = "contact.phone.number";
  var PHONE_CODE = "contact.phone.country_code";
  function phoneFields(specs) {
    const pairs = /* @__PURE__ */ new Map();
    for (const tel of specs.filter((spec) => spec.kind === "tel")) {
      const code = specs.find(
        (spec) => spec !== tel && spec.kind === "select" && (spec.section ?? "") === (tel.section ?? "") && (/country code|dial(ling)? code|^code$/i.test(spec.label) || (spec.options?.length ?? 0) > 0 && spec.options.filter((o) => DIAL_CODE.test(o.label)).length >= spec.options.length / 2)
      );
      if (code) {
        pairs.set(tel.id, code.id);
        pairs.set(code.id, tel.id);
      }
    }
    return pairs;
  }
  function dialCodeOf(value) {
    return /^\s*\+\s*(\d{1,4})\b/.exec(value)?.[1] ?? null;
  }
  function dialCodeIn(text4) {
    return /\+\s*(\d{1,4})\b/.exec(text4)?.[1] ?? null;
  }
  function withoutDialCode(value) {
    return value.replace(/^\s*\+\s*\d{1,4}[\s.-]*/, "");
  }
  function optionForDialCode(spec, code) {
    const pattern = new RegExp(`\\+\\s*${code}\\b`);
    const matches = (spec.options ?? []).filter((o) => pattern.test(o.label));
    return matches.length === 1 ? matches[0].label : null;
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
    // A slider built from divs — rating scales, "how many years", salary bands.
    "[role='slider']",
    // Dropdowns that are not `<select>`. `role="combobox"` covers Radix and React-Select;
    // `aria-haspopup` covers Headless UI and every hand-rolled menu, whose trigger is usually a
    // plain `role="button"` and would otherwise be completely invisible to this file.
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='menu']",
    // Choices built out of divs. The group is the question; its children are the answers.
    "[role='radiogroup']",
    // Toggle buttons side by side are one question too (`toggleGroup`) — Ashby's Yes and No.
    "button[aria-pressed]",
    "[role='button'][aria-pressed]",
    "[role='checkbox']",
    "[role='switch']"
  ].join(",");
  var NON_ANSWER_TYPES = /* @__PURE__ */ new Set(["submit", "button", "reset", "image", "hidden"]);
  function isAField(node) {
    if (node.tagName === "INPUT" && NON_ANSWER_TYPES.has((node.type || "text").toLowerCase())) return false;
    if (node.getAttribute("tabindex") === "-1" && node.closest("[aria-hidden='true']")) return false;
    return isVisible(node);
  }
  var LONG_FORM_LABEL = /cover letter|why (do|are|would)|tell us|describe|excites|about your|in your own words|summar/i;
  var TRAP_NAME = /honey ?pot|\bhp\b|bot ?(field|check|trap)|leave (this )?blank|do not fill/i;
  var LONG_FORM_MIN_MAXLENGTH = 1e3;
  var SEARCH_NOT_SCROLL = 50;
  function tidy(raw) {
    return raw.replace(/\s+/g, " ").replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, "");
  }
  function textOf(el) {
    if (!el) return "";
    return tidy(el.innerText ?? el.textContent ?? "");
  }
  function labelTextWithoutControls(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll(
      "input, textarea, select, option, [role='combobox'], [role='listbox'], [role='option'], [role='menu'], [contenteditable]"
    ).forEach((node) => node.remove());
    return tidy(clone.textContent ?? "");
  }
  var WIDGETS = "input, textarea, select, option, [role='combobox'], [role='listbox'], [role='option'], [role='menu'], [contenteditable]";
  function shownText(node) {
    const parent = node.parentElement;
    return Boolean(parent) && !(parent.checkVisibility && !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  }
  function wrappingLabelText(label, control) {
    const type = (control.getAttribute("type") ?? "").toLowerCase();
    const checkable = control.tagName === "INPUT" && (type === "checkbox" || type === "radio");
    const parts = [];
    const walker = label.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const widget = node.parentElement?.closest(WIDGETS);
      if (widget && label.contains(widget)) continue;
      if (!shownText(node)) continue;
      if (!checkable && !(control.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      const text4 = tidy(node.textContent ?? "");
      if (text4) parts.push(text4);
    }
    return parts.join(" ").trim() || labelTextWithoutControls(label);
  }
  function ownBlockLabel(members, isOtherField) {
    const none = { text: "", from: [] };
    const first = members[0];
    if (!first) return none;
    const ours = (node) => members.some((member) => member === node || member.contains(node) || node instanceof Element && node.contains(member) && node.tagName === "LABEL");
    const before = (node) => (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    const labelsAChoice = (label) => members.some((member) => label.contains(member) || member.id !== "" && label.htmlFor === member.id);
    let block = first.parentElement;
    while (block && !members.every((member) => block.contains(member))) block = block.parentElement;
    for (let hops = 0; block && hops < 4; hops++, block = block.parentElement) {
      if (Array.from(block.querySelectorAll(CANDIDATE_SELECTOR)).some((node) => isOtherField(node) && !ours(node))) return none;
      const orphan = Array.from(block.querySelectorAll("label")).find((label) => before(label) && !labelsAChoice(label) && textOf(label));
      if (orphan) return { text: textOf(orphan), from: [orphan] };
      const clickable = (node) => node.parentElement?.closest("a[href], button, [role='button'], [role='link'], [onclick]") ?? null;
      const counts = (node) => before(node) && !ours(node) && shownText(node) && tidy(node.textContent ?? "") !== "" && !(clickable(node) && block.contains(clickable(node)));
      const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let first2 = null;
      for (let node = walker.nextNode(); node && !first2; node = walker.nextNode()) if (counts(node)) first2 = node;
      if (first2) {
        const view = block.ownerDocument.defaultView;
        let holder = first2.parentElement;
        while (holder !== block && holder.parentElement && /^(inline|contents)/.test(view?.getComputedStyle(holder).display ?? "")) holder = holder.parentElement;
        const parts = [];
        const inner = block.ownerDocument.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
        for (let node = inner.nextNode(); node; node = inner.nextNode()) if (counts(node)) parts.push(tidy(node.textContent ?? ""));
        const text4 = parts.join(" ").trim();
        if (text4) return { text: text4.slice(0, 400), from: [holder] };
      }
    }
    return none;
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
    const own = ownLabelOf(el);
    const piece = (text4) => text4 !== "" && PART_ONLY.test(cleanLabel(text4));
    if (!piece(own.text)) {
      const labels = Array.from(el.labels ?? []).map(textOf);
      const part = (labels.length > 1 ? labels.find(piece) : void 0) ?? sharedQuestionPiece(el, own.text);
      return part ? { ...own, part: cleanLabel(part) } : own;
    }
    const whole = wholeQuestion(el);
    if (!whole) return own;
    return whole.boxes > 1 ? { text: whole.text, from: whole.from, part: cleanLabel(own.text) } : { text: whole.text, from: whole.from };
  }
  function sharedQuestionPiece(el, question) {
    const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
    if (ids.length < 2) return void 0;
    const root = el.getRootNode();
    const shared = (id) => root.querySelectorAll(`[aria-labelledby~="${CSS.escape(id)}"]`).length > 1;
    if (!ids.some(shared)) return void 0;
    const own = ids.filter((id) => !shared(id)).map((id) => root.querySelector(`#${CSS.escape(id)}`)).filter((node) => node !== null && isVisible(node) && textOf(node) !== "" && !question.includes(textOf(node)));
    return own.length === 1 ? textOf(own[0]) : void 0;
  }
  function calendarChoices(options, part) {
    const piece = part.toLowerCase();
    const keep = (fits, least) => {
      const real = options.filter((option) => fits(option.label.trim()));
      return real.length >= least && real.length === options.length - 1 ? real : options;
    };
    if (/^(day|dd)$/.test(piece)) return keep((label) => /^\d{1,2}$/.test(label) && Number(label) >= 1 && Number(label) <= 31, 28);
    if (/^(year|yyyy)$/.test(piece)) return keep((label) => /^\d{4}$/.test(label), 2);
    if (/^(month|mm)$/.test(piece)) return options.length === 13 ? options.slice(1) : options;
    return options;
  }
  var MOST_PARTS = 4;
  function wholeQuestion(el) {
    const fieldsIn = (node) => Array.from(node.querySelectorAll(CANDIDATE_SELECTOR)).filter(isAField);
    const whole = (text4) => text4 !== "" && !PART_ONLY.test(cleanLabel(text4));
    const group = el.parentElement?.closest("[aria-labelledby], [aria-label], fieldset");
    if (group) {
      const boxes = fieldsIn(group).length;
      const named2 = boxes <= MOST_PARTS ? labelOf(group) : null;
      if (named2 && whole(named2.text)) return { text: named2.text, from: named2.from, boxes };
    }
    let block = el.parentElement;
    while (block && fieldsIn(block).length < 2) block = block.parentElement;
    if (!block) return null;
    const fields = fieldsIn(block);
    if (fields.length > MOST_PARTS) return null;
    const before = (node) => (fields[0].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    const label = Array.from(block.querySelectorAll("label, legend")).find((node) => before(node) && whole(textOf(node)));
    return label ? { text: textOf(label), from: [label], boxes: fields.length } : null;
  }
  function ownLabelOf(el) {
    const doc = el.ownerDocument;
    const root = el.getRootNode();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map((id) => root.querySelector(`#${CSS.escape(id)}`) ?? doc?.getElementById(id)).filter((part) => part !== null && textOf(part) !== "");
      const before = (part) => (el.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
      const worded = (part) => !/^[\s\d.):#-]*$/.test(textOf(part));
      const question = parts.filter((part) => isVisible(part) && before(part) && worded(part));
      const shown2 = parts.filter((part) => isVisible(part) && worded(part));
      const chosen = question.length > 0 ? question : shown2.length > 0 ? shown2 : parts;
      const text4 = chosen.map(textOf).join(" ");
      if (text4) return { text: text4, from: chosen };
    }
    const ariaLabel = tidy(el.getAttribute("aria-label") ?? "");
    if (ariaLabel) return { text: ariaLabel, from: [] };
    if (el.id) {
      const forLabel = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text4 = textOf(forLabel);
      if (text4) return { text: text4, from: [forLabel] };
    }
    const wrapping = el.closest("label");
    if (wrapping) {
      const text4 = wrappingLabelText(wrapping, el);
      if (text4) return { text: text4, from: [wrapping] };
    }
    if (el.isContentEditable) {
      const standsFor = hiddenTextareaBeside(el);
      if (standsFor) {
        const named2 = ownLabelOf(standsFor);
        if (named2.text) return named2;
      }
    }
    const legend = el.closest("fieldset")?.querySelector("legend");
    const legendText = textOf(legend);
    if (legendText) return { text: legendText, from: [legend] };
    const own = ownBlockLabel([el], isAField);
    if (own.text) return own;
    const placeholder = tidy(el.getAttribute("placeholder") ?? "");
    if (placeholder) return { text: placeholder, from: [] };
    const title = tidy(el.getAttribute("title") ?? "");
    if (title) return { text: title, from: [] };
    let node = el;
    for (let hops = 0; node && hops < 4; hops++) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        const text4 = textOf(sibling);
        if (text4 && text4.length <= 120) return { text: text4, from: [sibling] };
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    const standard = accessibleName(el);
    return { text: standard, from: [] };
  }
  function hiddenTextareaBeside(editor) {
    let block = editor.parentElement;
    for (let hops = 0; block && hops < 3; hops++, block = block.parentElement) {
      const textarea = Array.from(block.querySelectorAll("textarea")).find((node) => node !== editor && !isVisible(node));
      if (textarea) return textarea;
    }
    return null;
  }
  function isMenuButton(el) {
    const popup = el.getAttribute("aria-haspopup");
    const role = el.getAttribute("role");
    return (popup === "menu" || popup === "true") && role !== "combobox" && role !== "listbox";
  }
  var GROUP_CONTAINER = "fieldset, [role='radiogroup'], [role='group']";
  function groupQuestion(el) {
    let container = el.parentElement?.closest(GROUP_CONTAINER) ?? null;
    for (let hops = 0; container && hops < 2; hops++) {
      const name = containerName(container);
      if (name) return name;
      container = container.parentElement?.closest(GROUP_CONTAINER) ?? null;
    }
    return "";
  }
  function containerName(container) {
    const root = container.getRootNode();
    const labelledBy = container.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text4 = labelledBy.split(/\s+/).map((id) => textOf(root.querySelector(`#${CSS.escape(id)}`) ?? container.ownerDocument?.getElementById(id))).filter(Boolean).join(" ");
      if (text4) return text4;
    }
    const ariaLabel = tidy(container.getAttribute("aria-label") ?? "");
    if (ariaLabel) return ariaLabel;
    return container.localName === "fieldset" ? textOf(container.querySelector(":scope > legend")) : "";
  }
  function groupRequired(el, question) {
    const container = el.parentElement?.closest(GROUP_CONTAINER);
    return container?.getAttribute("aria-required") === "true" || STARRED.test(question);
  }
  function choicesSayRequired(el) {
    return el.getAttribute("role") === "radiogroup" && el.querySelector("[role='radio'][aria-required='true'], input[type='radio'][required]") !== null;
  }
  function describe(el, label) {
    const text4 = accessibleDescription(el);
    if (!text4 || comparableText(text4) === comparableText(label)) return "";
    return text4.length > 160 ? `${text4.slice(0, 157)}\u2026` : text4;
  }
  var comparableText = (text4) => text4.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  var PART_ONLY = /^(date|time|day|month|year|hour|minute|dd|mm|yyyy|hh)$/i;
  var STARRED = /^[\s\p{Cf}]*[*✱]|[*✱][\s\p{Cf}]*$/u;
  function starBeside(sources, control) {
    return sources.some((source) => {
      let line = source.parentElement;
      for (let hops = 0; line && hops < 3; hops++, line = line.parentElement) {
        if (line.contains(control) || Array.from(line.querySelectorAll(CANDIDATE_SELECTOR)).some(isAField)) return false;
        if (STARRED.test(textOf(line))) return true;
      }
      return false;
    });
  }
  function drawsAStar(sources) {
    const starAlone = /^[\s\p{Cf}]*[*✱][\s\p{Cf}]*$/u;
    return sources.some((source) => {
      const view = source.ownerDocument.defaultView;
      if (!view) return false;
      const nodes = [source, ...Array.from(source.querySelectorAll("*")).slice(0, 60)];
      return nodes.some(
        (node) => ["::before", "::after"].some((pseudo) => {
          const drawn = /^"(.*)"$/.exec(view.getComputedStyle(node, pseudo).content)?.[1] ?? "";
          return starAlone.test(drawn) && node.checkVisibility?.() !== false;
        })
      );
    });
  }
  function cleanLabel(raw) {
    return tidy(
      raw.replace(/[\s\p{Cf}*✱]+$/u, "").replace(/^[\s\p{Cf}*✱]+/u, "").replace(/^\s*\d{1,3}[.)]\s+(?=\S)/, "")
    );
  }
  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const popup = el.getAttribute("aria-haspopup");
    const typed = tag === "input" ? (el.type || "").toLowerCase() : "";
    if (typed === "tel" || typed === "email" || typed === "url" || typed === "number") return typed;
    if (tag === "textarea") return "textarea";
    if (role === "combobox" || popup === "listbox" || popup === "menu") return "select";
    if (role === "radiogroup") return "radio";
    if (role === "checkbox" || role === "switch") return "checkbox";
    if (role === "spinbutton" || role === "slider") return "number";
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
          return DATE_MASK.test((el.getAttribute("placeholder") ?? "").trim()) ? "date" : "text";
      }
    }
    return "textarea";
  }
  function optionsOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const all = Array.from(el.options).filter((option) => option.value !== "" || textOf(option) !== "");
      const picks = all.filter((option) => option.value !== "" && !option.disabled && !option.hidden);
      const options = (picks.length > 0 ? picks : all).map((option) => ({ value: option.value, label: textOf(option) || option.value }));
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
  function ownerDocumentOf(root) {
    return "ownerDocument" in root && root.ownerDocument ? root.ownerDocument : root;
  }
  function readForm(root = document, url = ownerDocumentOf(root).location?.href ?? "", ignore = "[data-longtake-ignore]") {
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
    const formsHoldFields = candidates.some((el) => el.closest("form") && !isMenuButton(el));
    candidates.forEach((el, index) => {
      const tag = el.tagName.toLowerCase();
      if (formsHoldFields && isMenuButton(el) && !el.closest("form")) return;
      const typed = tag === "textarea" || tag === "input" && !/^(radio|checkbox)$/i.test(el.type);
      if (typed && el.parentElement?.closest("[role='radiogroup']")) return;
      if (el.getAttribute("role") === "radiogroup" && !el.querySelector("[role='radio']") && el.querySelector("input[type='radio']")) {
        return;
      }
      if (el.hasAttribute("aria-pressed")) {
        const toggles = toggleGroup(el);
        if (toggles[0] !== el || !isVisible(el)) return;
        const { text: question2, from } = ownBlockLabel(toggles, isAField);
        const label2 = cleanLabel(question2);
        const spec2 = {
          id: takeId(label2 || "choice", index),
          label: label2,
          kind: "radio",
          required: STARRED.test(question2) || drawsAStar(from),
          options: toggles.map((toggle) => {
            const text4 = tidy(toggle.textContent ?? "");
            return { value: text4, label: text4 };
          }),
          custom: true
        };
        const holder = el.parentElement ?? el;
        const selector2 = uniqueSelector(holder, ownerDocumentOf(root));
        if (selector2) spec2.selector = selector2;
        specs.push(spec2);
        handles.set(spec2.id, holder);
        return;
      }
      if (tag === "input") {
        const type = (el.type || "text").toLowerCase();
        if (NON_ANSWER_TYPES.has(type)) return;
        if (type === "password") return;
      }
      if (el.disabled) return;
      if (el.readOnly && kindOf(el) !== "select") return;
      if (el.getAttribute("tabindex") === "-1" && el.closest("[aria-hidden='true']")) {
        skipped.push({ label: el.getAttribute("name") || kindOf(el), reason: "hidden from keyboard and screen readers" });
        return;
      }
      const visible = isVisible(el);
      const kind = kindOf(el);
      const { text: rawLabel, from: labelledFrom, part } = labelOf(el);
      const label = cleanLabel(rawLabel);
      const starred = STARRED.test(rawLabel) || drawsAStar(labelledFrom) || starBeside(labelledFrom, el);
      const name = el.getAttribute("name") ?? "";
      if (!visible) {
        skipped.push({ label: label || name || kind, reason: "not visible on the page" });
        return;
      }
      if (kind === "file") {
        skipped.push({ label: label || name, reason: "a file cannot be attached by voice" });
        return;
      }
      const members = (kind === "radio" || kind === "checkbox") && tag === "input" ? choiceGroup(el) : [];
      if ((kind === "radio" || kind === "checkbox") && (name || members.length > 1)) {
        const groupKey = members[0] ?? `${kind}:${name}`;
        const siblings = tag === "input" ? members.filter((other) => candidates.includes(other) && kindOf(other) === kind) : candidates.filter((other) => other.getAttribute("name") === name && kindOf(other) === kind);
        const isGroup = kind === "radio" || siblings.length > 1;
        if (isGroup) {
          const existing = groups.get(groupKey);
          const option = {
            // What tells this box from the others in its group — the writer finds it by the same.
            value: tag === "input" ? choiceKey(el, members) : el.value || label,
            label: label || el.value
          };
          if (existing) {
            existing.options?.push(option);
            if (el.required) existing.required = true;
            return;
          }
          const question2 = groupQuestion(el) || ownBlockLabel(siblings.length > 0 ? siblings : [el], isAField).text;
          const groupLabel = cleanLabel(question2 || name);
          const spec2 = {
            id: takeId(groupLabel || name, index),
            label: groupLabel,
            kind: kind === "radio" ? "radio" : "multiselect",
            required: el.required || groupRequired(el, question2),
            options: [option],
            ...visible ? {} : { suspectedHoneypot: true }
          };
          const selector2 = uniqueSelector(el, ownerDocumentOf(root));
          if (selector2) spec2.selector = selector2;
          groups.set(groupKey, spec2);
          specs.push(spec2);
          handles.set(spec2.id, el);
          return;
        }
      }
      let question = label;
      let ticking = "";
      if (kind === "checkbox" && tag === "input") {
        const container = el.parentElement?.closest(GROUP_CONTAINER);
        const named2 = container && container.querySelectorAll(ANSWERING).length === 1 ? cleanLabel(containerName(container)) : "";
        if (named2 && named2 !== label) {
          question = named2;
          ticking = label;
        }
      }
      const id = takeId(part && question ? `${question} ${part}` : question || name || el.id, index);
      const spec = {
        id,
        label: question,
        kind,
        required: Boolean(el.required) || el.getAttribute("aria-required") === "true" || starred || choicesSayRequired(el)
      };
      if (part) spec.part = part;
      spec.nameSource = labelledFrom.some((node) => isVisible(node)) ? "shown" : "attribute";
      const selector = uniqueSelector(el, ownerDocumentOf(root));
      if (selector) spec.selector = selector;
      const options = optionsOf(el);
      if (options) spec.options = part ? calendarChoices(options, part) : options;
      const description = [ticking, describe(el, question)].filter(Boolean).join(" \u2014 ");
      if (description) spec.description = description;
      const maxLength = el.maxLength;
      if (maxLength && maxLength > 0) spec.maxLength = maxLength;
      const pattern = el.getAttribute("pattern");
      if (pattern) spec.pattern = pattern;
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) spec.placeholder = placeholder;
      if (isLongForm(el, kind, label)) spec.longForm = true;
      if (isCustom(el, kind)) spec.custom = true;
      const isRange = tag === "input" && el.type === "range";
      if (isRange || el.getAttribute("role") === "slider") {
        const read = (attr, aria, fallback) => {
          const raw = el.getAttribute(aria) ?? el.getAttribute(attr);
          const n = raw === null ? NaN : Number(raw);
          return Number.isFinite(n) ? n : fallback;
        };
        spec.range = { min: read("min", "aria-valuemin", 0), max: read("max", "aria-valuemax", 100), step: read("step", "aria-valuestep", 1) || 1 };
        if (!isRange) spec.custom = true;
      }
      if (looksLikeTrap(el, visible)) spec.suspectedHoneypot = true;
      specs.push(spec);
      handles.set(id, el);
    });
    placeInSections(root, specs, handles, usedIds);
    for (const [id, partner] of phoneFields(specs)) {
      const spec = specs.find((s) => s.id === id);
      const tel = specs.find((s) => s.id === partner);
      if (!spec || !tel || spec.kind === "tel" || spec.nameSource !== "attribute" || spec.part || !tel.label) continue;
      spec.part = spec.label;
      spec.label = tel.label;
    }
    return { specs, handles, skipped, url, readAt: Date.now() };
  }
  var HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,legend,[role='heading']";
  function titleOf(read, root = document) {
    const FOLLOWING = 4;
    const firstField = [...read.handles.values()].sort(
      (a, b) => a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1
    )[0];
    if (firstField) {
      const above = deepQueryAll(root, "h1,h2,h3,h4,[role='heading']").filter(isVisible).filter((heading) => heading.compareDocumentPosition(firstField) & FOLLOWING);
      const nearest = above[above.length - 1];
      const text4 = nearest ? cleanLabel(textOf(nearest)) : "";
      if (text4) return text4.slice(0, 80);
    }
    const doc = ownerDocumentOf(root);
    return (doc.title ?? "").split(/\s[|·–-]\s/)[0].trim().slice(0, 80);
  }
  function placeInSections(root, specs, handles, usedIds) {
    const FOLLOWING = 4;
    const byPosition = (a, b) => a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1;
    const first = [...handles.values()].sort(byPosition)[0];
    if (!first) return;
    const isTitle = (heading) => heading.tagName.toLowerCase() !== "legend" && Boolean(heading.compareDocumentPosition(first) & FOLLOWING);
    const headings = deepQueryAll(root, HEADING_SELECTOR).filter(isVisible).filter((heading) => !isTitle(heading)).sort(byPosition);
    const groupName = (el) => {
      const group = el.parentElement?.closest("fieldset, [role='group']");
      if (!group) return "";
      const inside = specs.filter((spec) => {
        const field = handles.get(spec.id);
        return field !== void 0 && group.contains(field);
      });
      if (inside.length < 2) return "";
      const name = cleanLabel(containerName(group));
      return inside.some((spec) => spec.label === name) ? "" : name;
    };
    const sectionOf = (el, label) => {
      let found = "";
      for (const heading of headings) {
        if (heading.contains(el)) continue;
        const governs = heading.tagName.toLowerCase() === "legend" ? Boolean(heading.parentElement?.contains(el)) : Boolean(heading.compareDocumentPosition(el) & FOLLOWING);
        if (governs) found = cleanLabel(textOf(heading));
      }
      if (!found) found = groupName(el);
      return found && found !== label ? found : "";
    };
    for (const spec of specs) {
      const el = handles.get(spec.id);
      if (!el) continue;
      const section = sectionOf(el, spec.label);
      if (section) spec.section = section;
    }
    const count2 = /* @__PURE__ */ new Map();
    for (const spec of specs) count2.set(spec.label, (count2.get(spec.label) ?? 0) + 1);
    for (const spec of specs) {
      if (!spec.section || (count2.get(spec.label) ?? 0) < 2) continue;
      const base = slugify(`${spec.section} ${spec.label}`);
      if (!base || base === spec.id) continue;
      let candidate = base;
      for (let n = 2; usedIds.has(candidate); n++) candidate = `${base}_${n}`;
      const el = handles.get(spec.id);
      handles.delete(spec.id);
      usedIds.delete(spec.id);
      usedIds.add(candidate);
      spec.id = candidate;
      handles.set(candidate, el);
    }
  }
  function harvestOptions(read, settleMs = 150) {
    return exclusively(() => harvestAll(read, settleMs));
  }
  var MENU_TIMEOUT_MS = 2e3;
  async function harvestAll(read, settleMs) {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return read;
    const sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const allOptions = () => optionNodes(doc);
    const pressAndRead = async (spec, el, lastTry) => {
      const before = new Set(allOptions());
      const opened = () => allOptions().some((option) => !before.has(option)) || el.getAttribute("aria-expanded") === "true";
      let revealed = [];
      try {
        openWidget(el);
        await whenSettled(doc, settleMs, MENU_TIMEOUT_MS, opened);
        if (!opened() && !lastTry) return false;
        revealed = allOptions().filter((option) => !before.has(option));
        if (revealed.length === 0 && el.getAttribute("aria-expanded") === "true") {
          revealed = allOptions().filter((option) => ownsOptions(el, option) === true);
        }
        const options = [];
        const seen = /* @__PURE__ */ new Set();
        for (const option of revealed) {
          const label = cleanLabel(textOf(option));
          if (!label || seen.has(label)) continue;
          seen.add(label);
          options.push({ value: option.getAttribute("data-value") ?? label, label });
        }
        if (options.length > 0) spec.options = options;
        const list = revealed[0]?.closest("[role='listbox']");
        if (list?.getAttribute("aria-multiselectable") === "true") spec.kind = "multiselect";
        const typesToSearch = el.tagName.toLowerCase() === "input" || Boolean(el.getAttribute("aria-autocomplete")) || Boolean(el.querySelector("input"));
        if (typesToSearch && (options.length === 0 || options.length >= SEARCH_NOT_SCROLL)) spec.searchable = true;
      } catch {
      } finally {
        closeWidget(el, revealed.length > 0 ? revealed : void 0);
        await sleep2(40);
      }
      return true;
    };
    const silent = [];
    for (const spec of read.specs) {
      if (spec.kind !== "select" && spec.kind !== "multiselect") continue;
      if (spec.options && spec.options.length > 0) continue;
      const el = read.handles.get(spec.id);
      if (!el || !el.isConnected) continue;
      if (!await pressAndRead(spec, el, false)) silent.push([spec, el]);
    }
    if (silent.length > 0) {
      await whenSettled(doc, 350, 3e3);
      for (const [spec, el] of silent) if (el.isConnected) await pressAndRead(spec, el, true);
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

  // core/src/choices.ts
  function normalise(text4) {
    return text4.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  var MEANS_NO = /\b(no|not|false|never|decline|disagree|refuse|nahi|nahin)\b/i;
  var MEANS_YES = /\b(yes|true|agree|agreed|accept|confirm|ok|okay|sure|haan|han|ji|sahi)\b/i;
  function readAsYesOrNo(value) {
    if (typeof value === "boolean") return value;
    const text4 = String(value);
    if (MEANS_NO.test(text4)) return false;
    return MEANS_YES.test(text4);
  }
  function bareName(label) {
    return normalise(label.replace(/\s*\+\d[\d\s-]*$/, "").replace(/\s*\([^)]*\)\s*$/, ""));
  }
  function showsChoice(showing, chosen) {
    const shown2 = normalise(showing);
    const wanted = normalise(chosen);
    if (!shown2) return false;
    return shown2.includes(wanted) || shown2.length >= 2 && ` ${wanted} `.includes(` ${shown2} `);
  }
  function matchAmong(candidates, spoken) {
    const want = normalise(spoken);
    if (!want) return null;
    const exact = candidates.findIndex((candidate) => normalise(candidate) === want);
    if (exact >= 0) return exact;
    const plain = candidates.map(bareName);
    if (plain.filter((text4) => text4 === want).length === 1) return plain.indexOf(want);
    const whole = [];
    candidates.forEach((candidate, index) => {
      if (` ${normalise(candidate)} `.includes(` ${want} `)) whole.push(index);
    });
    if (whole.length === 1) return whole[0];
    const partial = [];
    candidates.forEach((candidate, index) => {
      const text4 = normalise(candidate);
      if (text4.length > 0 && (text4.includes(want) || want.includes(text4))) partial.push(index);
    });
    return partial.length === 1 ? partial[0] : null;
  }
  function optionNamedIn(spec, evidence) {
    const heard = ` ${normalise(evidence ?? "")} `;
    if (!heard.trim()) return null;
    const names = (spec.options ?? []).filter((option) => option.value !== "").flatMap((option) => [normalise(option.label), bareName(option.label)].filter((label) => label.length >= 2).map((label) => ({ option, label }))).sort((a, b) => b.label.length - a.label.length);
    let rest = heard;
    const named2 = /* @__PURE__ */ new Set();
    for (const { option, label } of names) {
      if (!rest.includes(` ${label} `)) continue;
      named2.add(option);
      rest = rest.split(` ${label} `).join("  ");
    }
    return named2.size === 1 ? [...named2][0] : null;
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
  var MOST_CHOICES_TO_SAY = 10;
  function realChoices(options) {
    const real = (options ?? []).filter((option) => option.value !== "");
    return (real.length > 0 ? real : options ?? []).map((option) => option.label).filter(Boolean);
  }
  function sayableChoices(labels) {
    const clean = labels.map((label) => label.trim()).filter(Boolean);
    const shown2 = clean.slice(0, MOST_CHOICES_TO_SAY);
    const rest = clean.length - shown2.length;
    return rest > 0 ? `${shown2.join(", ")}, and ${rest} more` : shown2.join(", ");
  }

  // core/src/adapters/kit.ts
  var WIDGET_OPEN_MS = 400;
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var CONFIRM_MS = 1500;
  function confirmed(done, timeoutMs = CONFIRM_MS) {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (done()) resolve(true);
        else if (Date.now() - started >= timeoutMs) resolve(false);
        else setTimeout(check, 16);
      };
      check();
    });
  }
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
  function pressChoice(box, want) {
    if (box.checked !== want) box.click();
  }
  function announce(el, kinds) {
    for (const kind of kinds) {
      el.dispatchEvent(new Event(kind, { bubbles: true }));
    }
  }
  function press(el) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
    }
  }
  function leave(el) {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    el.dispatchEvent(new FocusEvent("blur", { composed: true }));
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
    const own = el.tagName.toLowerCase() === "input" ? (el.value ?? "").trim() : "";
    let node = el.parentElement;
    for (let hops = 0; node && hops < 5; hops++) {
      const text4 = shownWithoutChoices(node);
      if (text4) return own ? `${own} ${text4}` : text4;
      node = node.parentElement;
    }
    return own;
  }
  var CHOICE_LIST = "[role='listbox'], [role='option'], [role='menu'], [role='menuitem']";
  function shownWithoutChoices(block) {
    if (!block.querySelector(CHOICE_LIST)) return (block.innerText ?? "").replace(/\s+/g, " ").trim();
    const parts = [];
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const list = parent?.closest(CHOICE_LIST);
      if (!parent || list && block.contains(list)) continue;
      if (parent.checkVisibility && !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const text4 = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text4) parts.push(text4);
    }
    return parts.join(" ");
  }
  function radioGroup(el) {
    if (el.tagName.toLowerCase() !== "input") return [];
    return choiceGroup(el);
  }
  function notAChoice(spec, wanted, unread = ". Ask the person to fill this one in themselves.") {
    const labels = realChoices(spec.options);
    return {
      fieldId: spec.id,
      status: "refused",
      reason: labels.length ? `"${wanted}" is not one of the choices. This field only accepts: ${sayableChoices(labels)}. Read those out to the person and ask which one fits.` : `"${wanted}" does not match anything this field offers${unread}`,
      choices: labels
    };
  }
  var PLACEHOLDER = /^(select|choose|pick|please (select|choose)|none selected)\b|^-+.*-+$|(\.\.\.|…)$/i;
  function readText(el) {
    const text4 = readBack(el).trim();
    return text4 ? text4 : null;
  }
  function readShown(spec, el) {
    const own = el.tagName.toLowerCase() === "input" ? "" : (el.innerText ?? "").replace(/\s+/g, " ").trim();
    const shown2 = (own || renderedText(el)).replace(/\s*×\s*$/, "").trim();
    if (!shown2) return null;
    const choices = realChoices(spec.options);
    const heard = ` ${normalise(shown2)} `;
    const onShow = choices.filter((choice) => {
      const word = normalise(choice);
      return word.length > 0 && heard.includes(` ${word} `);
    }).sort((a, b) => b.length - a.length);
    if (onShow.length > 0) return spec.kind === "multiselect" ? onShow : onShow[0];
    if (PLACEHOLDER.test(shown2) || choices.length > 0 && !spec.searchable) return null;
    return shown2;
  }
  var CLEAR_CONTROL = "[aria-label*='clear' i], [title*='clear' i], [class*='clear-indicator'], [class*='clearIndicator'], [class*='ClearIndicator']";
  var cannot = (spec, reason) => ({ fieldId: spec.id, status: "cannot-clear", reason });
  async function clearShown(spec, el) {
    const before = renderedText(el);
    let host = el.parentElement;
    let control = null;
    for (let hops = 0; host && !control && hops < 3; hops++) {
      control = host.querySelector(CLEAR_CONTROL);
      host = host.parentElement;
    }
    if (control) {
      press(control);
    } else {
      el.focus();
      for (const key of ["Backspace", "Delete"]) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, composed: true }));
      }
    }
    await sleep(150);
    closeWidget(el);
    return renderedText(el) !== before ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "This dropdown has no way to empty it \u2014 once picked, the form keeps a choice.");
  }
  async function clearText(spec, el) {
    if (el.isContentEditable) {
      el.textContent = "";
      announce(el, ["input", "change"]);
      return readBack(el) === "" ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The page put the text back.");
    }
    setNativeValue(el, "");
    announce(el, ["input", "change"]);
    return readBack(el) === "" ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The page put the text back.");
  }

  // core/src/adapters/choosing.ts
  function chosenFrom(spec, spoken) {
    const wanted = Array.isArray(spoken.value) ? spoken.value : [String(spoken.value)];
    let chosen = wanted.map((one) => matchOption(spec, one)).filter((v) => v !== null);
    if (chosen.length === 0 && spec.kind === "radio") {
      const named2 = optionNamedIn(spec, spoken.evidence);
      if (named2) chosen = [named2];
    }
    return chosen.length > 0 ? { chosen, wanted } : notAChoice(spec, wanted.join(", "));
  }
  function readAriaRadio(_spec, el) {
    const on = el.querySelector("[aria-checked='true']");
    return on ? (on.getAttribute("aria-label") ?? on.textContent ?? "").trim() || null : null;
  }
  var ariaRadiogroup = {
    name: "aria-radiogroup",
    matches: (spec, el) => spec.kind === "radio" && el.getAttribute("role") === "radiogroup",
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      const first = decided.chosen[0];
      const want = normalise(first.label);
      const target = deepQueryAll(el, "[role='radio']").find(
        (radio) => normalise(radio.getAttribute("aria-label") ?? radio.textContent ?? "") === want || radio.getAttribute("data-value") === first.value
      );
      if (!target) return { fieldId: spec.id, status: "refused", reason: "That option is no longer on the page." };
      const native = target.querySelector("input[type='radio']");
      if (native) pressChoice(native, true);
      else if (target.getAttribute("aria-checked") !== "true") target.click();
      return await confirmed(() => target.getAttribute("aria-checked") === "true" || Boolean(native?.checked)) ? { fieldId: spec.id, status: "written", wrote: first.label } : { fieldId: spec.id, status: "rejected-by-page", wrote: first.label, found: "" };
    },
    read: readAriaRadio,
    clear: clearShown
  };
  var toggleButtons = {
    name: "toggle-buttons",
    matches: (spec, el) => spec.kind === "radio" && toggleGroup(el).length > 0,
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      const first = decided.chosen[0];
      const target = toggleGroup(el).find((toggle) => normalise(toggle.textContent ?? "") === normalise(first.label));
      if (!target) return { fieldId: spec.id, status: "refused", reason: "That option is no longer on the page." };
      if (target.getAttribute("aria-pressed") !== "true") target.click();
      return await confirmed(() => target.getAttribute("aria-pressed") === "true") ? { fieldId: spec.id, status: "written", wrote: first.label } : { fieldId: spec.id, status: "rejected-by-page", wrote: first.label, found: "" };
    },
    read(_spec, el) {
      const on = toggleGroup(el).find((toggle) => toggle.getAttribute("aria-pressed") === "true");
      return on ? (on.textContent ?? "").trim() || null : null;
    },
    async clear(spec, el) {
      const on = toggleGroup(el).find((toggle) => toggle.getAttribute("aria-pressed") === "true");
      if (on) {
        on.click();
        await confirmed(() => on.getAttribute("aria-pressed") !== "true");
      }
      return on?.getAttribute("aria-pressed") === "true" ? cannot(spec, "The form will not let this be left unanswered once picked.") : { fieldId: spec.id, status: "cleared" };
    }
  };
  var customRadio = {
    name: "custom-radio",
    matches: (spec) => spec.kind === "radio" && Boolean(spec.custom),
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      return pickFromWidget(spec, el, decided.chosen[0], decided.wanted.join(", "));
    },
    read: readAriaRadio,
    clear: clearShown
  };
  var nativeRadio = {
    name: "native-radio",
    matches: (spec) => spec.kind === "radio",
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      const first = decided.chosen[0];
      const radios = radioGroup(el);
      const target = radios.find((radio) => choiceKey(radio, radios) === first.value);
      if (!target) return { fieldId: spec.id, status: "refused", reason: "That option is no longer on the page." };
      pressChoice(target, true);
      return target.checked ? { fieldId: spec.id, status: "written", wrote: first.label } : { fieldId: spec.id, status: "rejected-by-page", wrote: first.label, found: "" };
    },
    read(spec, el) {
      if (el.tagName.toLowerCase() !== "input") return readAriaRadio(spec, el);
      const radios = radioGroup(el);
      const on = radios.find((radio) => radio.checked);
      if (!on) return null;
      return spec.options?.find((option) => option.value === choiceKey(on, radios))?.label ?? on.value;
    },
    async clear(spec, el) {
      if (el.tagName.toLowerCase() !== "input") return clearShown(spec, el);
      for (const radio of radioGroup(el)) {
        if (!radio.checked) continue;
        radio.checked = false;
        announce(radio, ["input", "change"]);
      }
      return radioGroup(el).some((radio) => radio.checked) ? cannot(spec, "The form put the choice back \u2014 it will not let this be left unanswered.") : { fieldId: spec.id, status: "cleared" };
    }
  };
  var checkboxGroup = {
    name: "checkbox-group",
    matches: (spec) => spec.kind === "multiselect" && Boolean(spec.options),
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      const boxes = choiceGroup(el);
      const wantedValues = decided.chosen.map((c2) => c2.value);
      const wants = (box) => wantedValues.includes(choiceKey(box, boxes));
      for (const box of boxes) {
        const shouldCheck = wants(box);
        if (box.checked !== shouldCheck) pressChoice(box, shouldCheck);
      }
      const wrote = decided.chosen.map((c2) => c2.label).join(", ");
      const off = boxes.filter((box) => box.checked !== wants(box));
      return off.length === 0 && boxes.length > 0 ? { fieldId: spec.id, status: "written", wrote } : { fieldId: spec.id, status: "rejected-by-page", wrote, found: boxes.filter((box) => box.checked).map((box) => box.value).join(", ") };
    },
    read(spec, el) {
      const boxes = choiceGroup(el);
      const ticked = boxes.filter((box) => box.checked).map((box) => spec.options?.find((option) => option.value === choiceKey(box, boxes))?.label ?? box.value);
      return ticked.length > 0 ? ticked : null;
    },
    async clear(spec, el) {
      const boxes = choiceGroup(el);
      for (const box of boxes) pressChoice(box, false);
      return boxes.some((box) => box.checked) ? cannot(spec, "The form would not let this be unticked.") : { fieldId: spec.id, status: "cleared" };
    }
  };
  var ariaCheckbox = {
    name: "aria-checkbox",
    matches: (spec) => spec.kind === "checkbox" && Boolean(spec.custom),
    async write(spec, el, spoken) {
      const yes = readAsYesOrNo(spoken.value);
      const already = el.getAttribute("aria-checked") === "true";
      if (already !== yes) {
        openWidget(el);
        await confirmed(() => el.getAttribute("aria-checked") === "true" === yes);
      }
      const now = el.getAttribute("aria-checked") === "true";
      return now === yes ? { fieldId: spec.id, status: "written", wrote: yes ? "checked" : "unchecked" } : { fieldId: spec.id, status: "rejected-by-page", wrote: yes ? "checked" : "unchecked", found: `aria-checked=${el.getAttribute("aria-checked")}` };
    },
    read: (_spec, el) => el.getAttribute("aria-checked") === "true" ? true : null,
    async clear(spec, el) {
      if (el.getAttribute("aria-checked") === "true") {
        openWidget(el);
        await confirmed(() => el.getAttribute("aria-checked") !== "true");
      }
      return el.getAttribute("aria-checked") === "true" ? cannot(spec, "The switch would not turn off.") : { fieldId: spec.id, status: "cleared" };
    }
  };
  var checkbox = {
    name: "checkbox",
    matches: (spec) => spec.kind === "checkbox",
    async write(spec, el, spoken) {
      const yes = readAsYesOrNo(spoken.value);
      const box = el;
      pressChoice(box, yes);
      return box.checked === yes ? { fieldId: spec.id, status: "written", wrote: yes ? "checked" : "unchecked" } : { fieldId: spec.id, status: "rejected-by-page", wrote: String(yes), found: String(box.checked) };
    },
    read: (_spec, el) => el.checked ? true : null,
    clear: checkboxGroup.clear
  };

  // core/src/adapters/dropdowns.ts
  async function pickFromWidget(spec, el, want, spoken) {
    const before = new Set(optionNodes());
    const wasShowing = renderedText(el);
    const openAlready = optionNodes().filter((option) => ownsOptions(el, option) === true && isVisible(option));
    if (openAlready.length === 0) {
      openWidget(el);
      await sleep(WIDGET_OPEN_MS);
    }
    let candidates = openAlready.length > 0 ? openAlready : optionNodes().filter((option) => !before.has(option));
    if (candidates.length === 0) {
      candidates = optionNodes().filter((option) => ownsOptions(el, option) !== false);
    }
    const labels = candidates.map((option) => (option.innerText ?? "").trim());
    const index = want ? matchAmong(labels, want.label) : matchAmong(labels, spoken);
    const target = index !== null ? candidates[index] : void 0;
    const chosen = index !== null ? labels[index] : want?.label ?? spoken;
    if (!target) {
      closeWidget(el, candidates);
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
        reason: `"${spoken}" is not one of the choices. This field only accepts: ${sayableChoices(labels)}. Read those out to the person and ask which one fits.`,
        choices: labels.filter(Boolean)
      };
    }
    pressOption(target);
    await sleep(200);
    const showing = renderedText(el);
    const took = showsChoice(showing, chosen) && showing !== wasShowing;
    if (!took) {
      closeWidget(el, candidates);
      return { fieldId: spec.id, status: "rejected-by-page", wrote: chosen, found: showing };
    }
    return { fieldId: spec.id, status: "written", wrote: chosen };
  }
  var SEARCH_WAIT_MS = 2e3;
  var GENERIC_WORD = /^(university|college|institute|school|academy|technology|the|and|of|in|at|for|city)$/i;
  function distinctiveWords(spoken) {
    return spoken.split(/[\s,]+/).filter((word) => word.length >= 4 && !GENERIC_WORD.test(word)).sort((a, b) => b.length - a.length).slice(0, 2);
  }
  function everyWordIn(candidates, spoken) {
    const words3 = normalise(spoken).split(" ").filter(Boolean);
    if (words3.length === 0) return null;
    const hits = candidates.map((candidate, index) => ({ text: normalise(candidate), index })).filter(({ text: text4 }) => words3.every((word) => text4.includes(word)));
    return hits.length === 1 ? hits[0].index : null;
  }
  async function typeAndPick(spec, el, spoken) {
    const input = el.tagName.toLowerCase() === "input" ? el : el.querySelector("input");
    if (!input) return pickFromWidget(spec, el, null, spoken);
    const queries = [spoken.trim(), spoken.split(",")[0].trim(), ...distinctiveWords(spoken)].filter(
      (q, i, all) => q && all.indexOf(q) === i
    );
    let lastLabels = [];
    let lastShown = [];
    for (const query of queries) {
      const before = new Set(optionNodes());
      openWidget(el);
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      setNativeValue(input, query);
      announce(input, ["input"]);
      let candidates = [];
      for (let waited = 0; waited < SEARCH_WAIT_MS; waited += 100) {
        await sleep(100);
        candidates = optionNodes().filter((o) => !before.has(o) && ownsOptions(el, o) !== false);
        if (candidates.length > 0) break;
      }
      lastShown = candidates;
      const labels = candidates.map((o) => (o.innerText ?? "").trim());
      const whole = query === spoken.trim() || query === spoken.split(",")[0].trim();
      const index = matchAmong(labels, spoken) ?? (whole ? matchAmong(labels, query) : null) ?? everyWordIn(labels, spoken);
      if (index !== null) {
        const chosen = labels[index];
        pressOption(candidates[index]);
        await sleep(200);
        const showing = renderedText(el);
        if (showsChoice(showing, chosen)) return { fieldId: spec.id, status: "written", wrote: chosen };
        closeWidget(el, candidates);
        return { fieldId: spec.id, status: "rejected-by-page", wrote: chosen, found: showing };
      }
      if (labels.length > 0) lastLabels = labels;
    }
    setNativeValue(input, "");
    announce(input, ["input"]);
    closeWidget(el, lastShown);
    if (lastLabels.length > 0) {
      return {
        fieldId: spec.id,
        status: "refused",
        reason: `"${spoken}" matches more than one result. The search offers: ${sayableChoices(lastLabels)}. Ask which one.`,
        choices: lastLabels
      };
    }
    return { fieldId: spec.id, status: "rejected-by-page", wrote: spoken, found: `no result for "${spoken}"` };
  }
  var said = (spoken) => String(Array.isArray(spoken.value) ? spoken.value[0] : spoken.value);
  var wantOf = (spec, spoken) => matchOption(spec, said(spoken)) ?? optionNamedIn(spec, spoken.evidence);
  function readDropdown(spec, el) {
    if (el.tagName.toLowerCase() === "select") {
      const select = el;
      if (!select.value) return null;
      return (select.selectedOptions[0]?.textContent ?? "").trim() || select.value;
    }
    return spec.custom ? readShown(spec, el) : readText(el);
  }
  async function clearDropdown(spec, el) {
    if (el.tagName.toLowerCase() === "select") {
      const select = el;
      const blank = Array.from(select.options).find((option) => option.value === "");
      if (!blank) return cannot(spec, "This dropdown has no empty choice, so one of its options has to stay picked.");
      setNativeValue(select, "");
      announce(select, ["input", "change"]);
      return select.value === "" ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The form put the choice back.");
    }
    return spec.custom ? clearShown(spec, el) : clearText(spec, el);
  }
  var nativeSelect = {
    name: "native-select",
    matches: (spec) => spec.kind === "select" && !spec.custom && !spec.searchable,
    async write(spec, el, spoken) {
      const want = wantOf(spec, spoken);
      if (!want) return notAChoice(spec, said(spoken), ", and its choices could not be read. Ask the person to fill this one in themselves.");
      setNativeValue(el, want.value);
      announce(el, ["input", "change"]);
      const found = readBack(el);
      return found === want.value ? { fieldId: spec.id, status: "written", wrote: want.label } : { fieldId: spec.id, status: "rejected-by-page", wrote: want.label, found };
    },
    read: readDropdown,
    clear: clearDropdown
  };
  var customDropdown = {
    name: "custom-dropdown",
    matches: (spec) => spec.kind === "select" && Boolean(spec.custom) && !spec.searchable,
    async write(spec, el, spoken) {
      const want = wantOf(spec, spoken);
      if (!want && !spec.options?.length) return pickFromWidget(spec, el, null, said(spoken));
      if (!want) return notAChoice(spec, said(spoken), ", and its choices could not be read. Ask the person to fill this one in themselves.");
      return pickFromWidget(spec, el, want, said(spoken));
    },
    read: readDropdown,
    clear: clearDropdown
  };
  var searchableCombobox = {
    name: "searchable-combobox",
    matches: (spec) => spec.kind === "select" && Boolean(spec.searchable),
    async write(spec, el, spoken) {
      const searched = await typeAndPick(spec, el, said(spoken));
      if (searched.status !== "rejected-by-page" || !spec.options?.length || searched.wrote !== said(spoken)) return searched;
      return (spec.custom ? customDropdown : nativeSelect).write(spec, el, spoken);
    },
    read: readDropdown,
    clear: clearDropdown
  };
  var nativeSelectMultiple = {
    name: "native-select-multiple",
    matches: (spec, el) => spec.kind === "multiselect" && Boolean(spec.options) && el.tagName.toLowerCase() === "select" && el.multiple,
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      const select = el;
      const wantedValues = new Set(decided.chosen.map((c2) => c2.value));
      for (const option of Array.from(select.options)) option.selected = wantedValues.has(option.value);
      announce(select, ["input", "change"]);
      const now = Array.from(select.selectedOptions);
      const wrote = decided.chosen.map((c2) => c2.label).join(", ");
      return now.length === wantedValues.size && now.every((option) => wantedValues.has(option.value)) ? { fieldId: spec.id, status: "written", wrote } : { fieldId: spec.id, status: "rejected-by-page", wrote, found: now.map((option) => option.textContent?.trim() ?? "").join(", ") };
    },
    read(_spec, el) {
      const picked = Array.from(el.selectedOptions).map((option) => option.textContent?.trim() || option.value);
      return picked.length > 0 ? picked : null;
    },
    async clear(spec, el) {
      const select = el;
      for (const option of Array.from(select.options)) option.selected = false;
      announce(select, ["input", "change"]);
      return select.selectedOptions.length === 0 ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The form put a choice back.");
    }
  };
  var tagPicker = {
    name: "tag-picker",
    matches: (spec) => spec.kind === "multiselect" && Boolean(spec.options) && Boolean(spec.custom),
    async write(spec, el, spoken) {
      const decided = chosenFrom(spec, spoken);
      if ("status" in decided) return decided;
      const already = readShown(spec, el);
      const onShow = new Set(Array.isArray(already) ? already.map(normalise) : []);
      const picked = [];
      for (const option of decided.chosen) {
        if (onShow.has(normalise(option.label))) {
          picked.push(option.label);
          continue;
        }
        const outcome = await pickFromWidget(spec, el, option, option.label);
        if (outcome.status !== "written") return outcome;
        picked.push(option.label);
      }
      closeWidget(el, optionNodes().filter((option) => ownsOptions(el, option) !== false));
      return { fieldId: spec.id, status: "written", wrote: picked.join(", ") };
    },
    read: readShown,
    clear: clearShown
  };

  // core/src/adapters/typing.ts
  var readTyped = (spec, el) => spec.custom ? readShown(spec, el) : readText(el);
  var clearTyped = (spec, el) => spec.custom ? clearShown(spec, el) : clearText(spec, el);
  var file = {
    name: "file",
    matches: (spec) => spec.kind === "file",
    write: async (spec) => ({ fieldId: spec.id, status: "refused", reason: "A file cannot be attached by voice. Longtake leaves this for the person." }),
    read: (_spec, el) => readText(el),
    clear: async (spec) => cannot(spec, "A file upload cannot be cleared by voice.")
  };
  async function stepSlider(spec, el, spoken) {
    const target = Number(String(spoken.value).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(target)) {
      return { fieldId: spec.id, status: "refused", reason: `"${spoken.value}" is not a number this slider can go to.` };
    }
    const { min, max, step } = spec.range ?? { min: 0, max: 100, step: 1 };
    const goal = Math.min(max, Math.max(min, target));
    const now = () => Number(el.getAttribute("aria-valuenow"));
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
    for (let presses = 0; presses < 500 && Math.abs(now() - goal) >= step / 2; presses++) {
      const key = now() < goal ? "ArrowRight" : "ArrowLeft";
      el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, bubbles: true }));
      if (presses % 20 === 19) await sleep(0);
    }
    const landed = now();
    return Math.abs(landed - goal) < step / 2 ? { fieldId: spec.id, status: "written", wrote: String(landed) } : { fieldId: spec.id, status: "rejected-by-page", wrote: String(goal), found: String(landed) };
  }
  var slider = {
    name: "slider",
    matches: (_spec, el) => el.getAttribute("role") === "slider",
    write: stepSlider,
    // A div slider carries its value in ARIA; there is nothing else to read.
    read: (_spec, el) => el.getAttribute("aria-valuenow"),
    clear: clearTyped
  };
  var contentEditable = {
    name: "contenteditable",
    matches: (_spec, el) => el.isContentEditable,
    async write(spec, el, spoken) {
      const text4 = String(spoken.value);
      el.textContent = text4;
      announce(el, ["input", "change"]);
      const found = readBack(el);
      return found === text4 ? { fieldId: spec.id, status: "written", wrote: text4 } : { fieldId: spec.id, status: "rejected-by-page", wrote: text4, found };
    },
    read: readTyped,
    clear: clearTyped
  };
  function asFieldDate(value, spec, el) {
    const isNative = el.tagName.toLowerCase() === "input" && el.type === "date";
    const mask = DATE_MASK.exec((spec.placeholder ?? "").trim());
    if (!isNative && !mask) return value;
    const day = calendarDay(value);
    if (!day) return value;
    const { y, m, d } = day;
    const two = (n) => String(n).padStart(2, "0");
    if (isNative || !mask) return `${y}-${two(m)}-${two(d)}`;
    const [, first, sep, second, third] = mask;
    const part = (token) => /y/i.test(token) ? String(y) : /m/i.test(token) ? two(m) : two(d);
    return [first, second, third].map(part).join(sep);
  }
  function asFieldShape(value, spec) {
    const shape = (spec.placeholder ?? "").trim();
    if (!DIGIT_MASK.test(shape)) return value;
    const digits = value.replace(/\D/g, "");
    const places = shape.replace(/[^09#]/g, "").length;
    if (digits.length !== places) return value;
    let next = 0;
    return shape.replace(/[09#]/g, () => digits[next++]);
  }
  function sameCharacters(a, b) {
    const flat2 = (v) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return flat2(a) !== "" && flat2(a) === flat2(b);
  }
  var text = {
    name: "text",
    matches: () => true,
    async write(spec, el, spoken) {
      let value = asFieldShape(asFieldDate(String(spoken.value), spec, el), spec);
      if (spec.maxLength && value.length > spec.maxLength) value = value.slice(0, spec.maxLength);
      setNativeValue(el, value);
      announce(el, ["input", "change"]);
      leave(el);
      const found = readBack(el);
      return found === value || sameCharacters(found, value) ? { fieldId: spec.id, status: "written", wrote: found } : { fieldId: spec.id, status: "rejected-by-page", wrote: value, found };
    },
    read: readTyped,
    clear: clearTyped
  };

  // core/src/adapters/index.ts
  var ADAPTERS = [
    file,
    searchableCombobox,
    customDropdown,
    nativeSelect,
    nativeSelectMultiple,
    tagPicker,
    ariaRadiogroup,
    toggleButtons,
    customRadio,
    nativeRadio,
    checkboxGroup,
    ariaCheckbox,
    checkbox,
    slider,
    contentEditable,
    text
  ];
  function adapterFor(spec, el) {
    return ADAPTERS.find((adapter) => adapter.matches(spec, el)) ?? text;
  }

  // core/src/writer.ts
  var RETRY_AFTER_MS = 250;
  function readValue(spec, el) {
    return adapterFor(spec, el).read(spec, el);
  }
  function isFilled(spec, el) {
    return readValue(spec, el) !== null;
  }
  function writeValues(specs, handles, values) {
    return exclusively(() => writeAll(specs, handles, values));
  }
  async function writeAll(specs, handles, values) {
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
      let outcome = await adapterFor(spec, el).write(spec, el, spoken);
      if (outcome.status === "rejected-by-page") {
        await sleep(RETRY_AFTER_MS);
        const fresh = handles.get(spoken.fieldId);
        const target = fresh && fresh.isConnected ? fresh : el.isConnected ? el : null;
        outcome = target ? await adapterFor(spec, target).write(spec, target, spoken) : { ...outcome, found: "the field left the page before it could be written" };
        if (outcome.status === "rejected-by-page") outcome = { ...outcome, retried: true };
      }
      outcomes.push(outcome);
    }
    return outcomes;
  }
  function clearValues(specs, handles, ids) {
    return exclusively(async () => {
      const byId = new Map(specs.map((spec) => [spec.id, spec]));
      const outcomes = [];
      for (const id of ids) {
        const spec = byId.get(id);
        const el = handles.get(id);
        if (!spec || !el || !el.isConnected) {
          outcomes.push({ fieldId: id, status: "cannot-clear", reason: "That field is not on the page." });
          continue;
        }
        outcomes.push(await adapterFor(spec, el).clear(spec, el));
      }
      return outcomes;
    });
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
        if (spec.searchable) {
          return {
            type: "string",
            description: "A list that searches as you type (a place, a school). Put what the person said, as they said it; it is searched for, and only a clear match goes in."
          };
        }
        if (options.length > 0) {
          return {
            type: "string",
            enum: options,
            description: "Pick the closest of these. If none of them is what the person said, leave this field out."
          };
        }
        return {
          type: "string",
          description: spec.searchable ? "A list that searches as you type (a place, a school). Put what the person said, as they said it; it is searched for, and only a clear match goes in." : "This dropdown's choices could not be read in advance. Put what the person said; it will be matched against the real options, and left blank if it does not match one."
        };
      }
      case "multiselect":
        return {
          type: "array",
          items: options.length > 0 ? { type: "string", enum: options } : { type: "string" },
          description: "One entry per thing the person named. Leave out anything they did not say."
        };
      case "number":
        return spec.range ? { type: "number", description: `A number from ${spec.range.min} to ${spec.range.max}.` } : { type: "number", description: FORMAT_HINTS.number.hint };
      default: {
        const hint = FORMAT_HINTS[spec.kind];
        const schema = {
          type: "string",
          description: hint?.hint ?? "What the person said, tidied into the form's own language."
        };
        if (hint?.format) schema.format = hint.format;
        if (hint?.examples) schema.examples = hint.examples;
        if (spec.maxLength) schema.maxLength = spec.maxLength;
        if (spec.placeholder && /\d|mm|dd|yy|0{3}|x{2,}/i.test(spec.placeholder)) {
          schema.description = `${schema.description} Written the way the form shows it: "${spec.placeholder}".`;
        }
        if (spec.pattern) schema.pattern = spec.pattern;
        return schema;
      }
    }
  }
  function fieldSchema(spec) {
    const parts = [fieldName(spec)];
    if (spec.section) parts.push(`(in the "${spec.section}" section)`);
    if (spec.required) parts.push("(the form marks this required)");
    if (spec.longForm) parts.push("(a long answer \u2014 several sentences are welcome)");
    if (spec.description) parts.push(`(the form adds: "${spec.description}")`);
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
  var CLEAR_TOOL_NAME = "clear_fields";
  function buildClearTool(specs) {
    const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
    return {
      type: "function",
      name: CLEAR_TOOL_NAME,
      description: "Empty fields the person asked you to clear, remove or undo. Only when they ask for it. Never pick another option as a way of clearing one.",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            description: "The fields to empty.",
            items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" }
          },
          evidence: {
            type: "string",
            description: "The person's own words asking for this, quoted exactly."
          }
        },
        required: ["fields", "evidence"],
        additionalProperties: false
      },
      execution_mode: EXECUTION_MODE,
      timeout_seconds: TIMEOUT_SECONDS
    };
  }
  var CONFIRM_TOOL_NAME = "confirm_answer";
  function buildConfirmTool(specs) {
    const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
    return {
      type: "function",
      name: CONFIRM_TOOL_NAME,
      description: "After you asked about an answer waiting for their yes, report their reply. agreed: true if they accepted it in any words or language, false if they said no or wanted something else. Only for fields waiting for their yes.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            description: "The field that was waiting.",
            ...ids.length > 0 ? { enum: ids } : {}
          },
          agreed: { type: "boolean", description: "Did they accept the answer you offered?" },
          evidence: { type: "string", description: "Their reply, quoted exactly." }
        },
        required: ["field", "agreed", "evidence"],
        additionalProperties: false
      },
      execution_mode: EXECUTION_MODE,
      timeout_seconds: TIMEOUT_SECONDS
    };
  }
  var LATER_TOOL_NAME = "skip_for_now";
  function buildLaterTool(specs) {
    const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
    return {
      type: "function",
      name: LATER_TOOL_NAME,
      description: "Put fields off until the end when the person says skip it, later, come back to it, or do the rest first. Nothing is filled or cleared; they are asked again once everything else is done.",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            description: "The fields to come back to.",
            items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" }
          },
          evidence: {
            type: "string",
            description: "The person's own words asking to skip it, quoted exactly."
          }
        },
        required: ["fields", "evidence"],
        additionalProperties: false
      },
      execution_mode: EXECUTION_MODE,
      timeout_seconds: TIMEOUT_SECONDS
    };
  }
  var SAVE_TOOL_NAME = "save_for_next_time";
  function buildSaveTool(specs) {
    const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
    return {
      type: "function",
      name: SAVE_TOOL_NAME,
      description: "Only after DO NEXT had you ask about next time (keep a new answer, forget a cleared one, remember a personal one): report their reply. agreed: true if they said yes in any words or language, false if not. Changes nothing on this form.",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            description: "The fields you asked about.",
            items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" }
          },
          agreed: { type: "boolean", description: "Did they say yes?" },
          evidence: { type: "string", description: "Their reply, quoted exactly." }
        },
        required: ["fields", "agreed", "evidence"],
        additionalProperties: false
      },
      execution_mode: EXECUTION_MODE,
      timeout_seconds: TIMEOUT_SECONDS
    };
  }
  var PRESS_TOOL_NAME = "press_form_button";
  function buildPressTool(actions) {
    if (actions.length === 0) return null;
    return {
      type: "function",
      name: PRESS_TOOL_NAME,
      description: "Press a button on the form when the person asks: add another entry to a section, or go to the next page. Only when they ask for it. There is no submit button here \u2014 the person always submits themselves.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: actions.map((a) => a.id),
            description: `Which button: ${actions.map((a) => `${a.id} = "${a.label}"`).join("; ")}.`
          },
          evidence: { type: "string", description: "The person's own words asking for it, quoted exactly." }
        },
        required: ["action", "evidence"],
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
      const bits = [`- ${fieldName(spec)}`];
      if (spec.section) bits.push(`[${spec.section}]`);
      if (spec.required) bits.push("(required)");
      if (spec.options?.length) {
        const shown2 = spec.options.slice(0, 6).map((o) => o.label).join(", ");
        bits.push(`\u2014 choose from: ${shown2}${spec.options.length > 6 ? ", \u2026" : ""}`);
      }
      return bits.join(" ");
    });
    const where = url ? ` at ${url}` : "";
    return [
      `The form in front of the person${where} has ${usable.length} fields:`,
      ...lines
    ].join("\n");
  }
  function stillOptional(specs, filledIds) {
    const filled = new Set(filledIds);
    return specs.filter(
      (spec) => !spec.required && !filled.has(spec.id) && !spec.suspectedHoneypot && spec.kind !== "file"
    );
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
  function normalise2(text4) {
    return text4.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function words(text4) {
    return normalise2(text4).split(" ").filter(Boolean);
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
  function clip(text4, max) {
    return text4.length <= max ? text4 : text4.slice(0, max);
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
    const question = fieldName(spec);
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
    const question = fieldName(spec);
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

  // core/src/hesitation.ts
  var ANOTHER_LOOK = "Want another look at this one?";
  var FILLERS = [
    "um",
    "uh",
    "erm",
    "er",
    "ah",
    "hmm",
    "mm",
    "like",
    "you know",
    "i mean",
    "sort of",
    "kind of",
    "basically",
    "actually",
    "matlab",
    "yaani",
    "arre",
    "haan to",
    "\u092E\u0924\u0932\u092C",
    "\u092F\u093E\u0928\u0940",
    "\u0905\u0930\u0947"
  ];
  var HEAVILY_EDITED_RATIO = 0.25;
  var SLOW_START_SECONDS = 2.5;
  var FILLER_THRESHOLD = 2;
  function normalise3(text4) {
    return text4.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function countFillers(verbatim) {
    const text4 = ` ${normalise3(verbatim)} `;
    const found = [];
    let count2 = 0;
    for (const filler of FILLERS) {
      const matches = text4.split(` ${filler} `).length - 1;
      if (matches > 0) {
        count2 += matches;
        found.push(filler);
      }
    }
    return { count: count2, words: found };
  }
  function countRestarts(verbatim) {
    const words3 = normalise3(verbatim).split(" ").filter(Boolean);
    const examples = [];
    let count2 = 0;
    for (let i = 1; i < words3.length; i++) {
      if (words3[i] && words3[i] === words3[i - 1] && words3[i].length > 1) {
        count2++;
        if (examples.length < 3) examples.push(words3[i]);
      }
    }
    return { count: count2, examples };
  }
  function readHesitation(fieldId, verbatim, clean, secondsBeforeSpeaking) {
    const marks = [];
    const fillers = countFillers(verbatim);
    if (fillers.count >= FILLER_THRESHOLD) {
      marks.push({ kind: "filler", count: fillers.count, words: fillers.words });
    }
    const restarts = countRestarts(verbatim);
    if (restarts.count > 0) {
      marks.push({ kind: "restart", count: restarts.count, examples: restarts.examples });
    }
    const spoken = normalise3(verbatim).length;
    const written = normalise3(clean).length;
    if (spoken > 0 && written < spoken) {
      const removedRatio = (spoken - written) / spoken;
      if (removedRatio >= HEAVILY_EDITED_RATIO) {
        marks.push({ kind: "heavily-edited", removedRatio: Number(removedRatio.toFixed(2)) });
      }
    }
    if (secondsBeforeSpeaking !== void 0 && secondsBeforeSpeaking >= SLOW_START_SECONDS) {
      marks.push({ kind: "slow-start", seconds: Number(secondsBeforeSpeaking.toFixed(1)) });
    }
    const worthAnotherLook = marks.length > 0;
    return {
      fieldId,
      marks,
      worthAnotherLook,
      // The only sentence, and only when there is a reason for it.
      ...worthAnotherLook ? { prompt: ANOTHER_LOOK } : {}
    };
  }
  function describeMarks(hesitation) {
    return hesitation.marks.map((mark) => {
      switch (mark.kind) {
        case "filler":
          return `${mark.count} filler ${mark.count === 1 ? "word" : "words"} in the recording`;
        case "restart":
          return `${mark.count} ${mark.count === 1 ? "restart" : "restarts"} while speaking`;
        case "heavily-edited":
          return `${Math.round(mark.removedRatio * 100)}% shorter once tidied`;
        case "slow-start":
          return `${mark.seconds}s before the answer started`;
      }
    });
  }

  // core/src/memory.ts
  var KEYS = [
    // ── identity ──────────────────────────────────────────────────────────────
    {
      key: "first_name",
      match: /^(first|given|fore)[ ]?name$|^first$/,
      // "Preferred first name" is a different question with a different answer.
      never: /preferred|maiden|previous|former|parent|guardian|emergency|referrer|referee|alternate|secondary/
    },
    {
      key: "last_name",
      match: /^(last|sur|family)[ ]?name$|^surname$/,
      never: /preferred|maiden|previous|former|parent|guardian|emergency|referrer|referee|alternate|secondary/
    },
    {
      key: "full_name",
      match: /^(full|legal|your)?[ ]?name$/,
      never: /first|last|sur|family|preferred|maiden|previous|former|user|company|employer|school|parent|guardian|emergency|referee|alternate|secondary|organi[sz]ation/
    },
    {
      key: "preferred_name",
      match: /preferred[ ]?(first)?[ ]?name|nickname|what should we call you/
    },
    // ── contact ───────────────────────────────────────────────────────────────
    {
      key: "email",
      match: /e[ -]?mail/,
      // A referrer's email is not yours.
      never: /confirm|repeat|verify|parent|guardian|emergency|referrer|referee|manager|alternate|secondary/
    },
    {
      key: "phone",
      match: /phone|mobile|telephone|contact number|cell/,
      never: /confirm|parent|guardian|emergency|referrer|referee|alternate|secondary|work phone/
    },
    // ── where you are ─────────────────────────────────────────────────────────
    {
      key: "city",
      // "Location (City)" arrives here as "location city" — the parens are gone by now.
      match: /^(current )?(city|town)$|city of residence|location city|^location$|where are you based/,
      never: /birth|company|office|preferred work|desired|willing|organi[sz]ation|business/
    },
    { key: "country", match: /^country$|country of residence/, never: /birth|citizenship|company|organi[sz]ation|business/ },
    { key: "postal_code", match: /post(al)? ?code|zip ?code|pin ?code/, never: /company|organi[sz]ation|business/ },
    // ── links ─────────────────────────────────────────────────────────────────
    { key: "linkedin", match: /linked ?in/ },
    { key: "github", match: /git ?hub/ },
    { key: "portfolio", match: /portfolio|personal (web)?site|^website$/, never: /company|employer|organi[sz]ation|business/ },
    // ── work ──────────────────────────────────────────────────────────────────
    {
      key: "current_employer",
      match: /current (employer|company)|present employer|who do you work for|name of your current/,
      // "Previous employer" is a different job and a different answer.
      never: /previous|former|last employer|first employer|desired|target/
    },
    { key: "current_title", match: /current (job )?title|current role|present title/, never: /desired|target/ },
    {
      key: "years_experience",
      match: /years? of (relevant )?experience|how (many|much) (years|experience)|total experience/
    },
    { key: "notice_period", match: /notice period|when can you (start|join)|availability to start/ },
    { key: "expected_salary", match: /(expected|desired|target) (salary|compensation|ctc)|salary expectation/ },
    { key: "current_salary", match: /current (salary|compensation|ctc)/, never: /expected|desired|target/ },
    // ── the yes/no ones every job form asks ───────────────────────────────────
    { key: "willing_to_relocate", match: /relocat/ },
    { key: "work_authorization", match: /authoriz(ed|ation) to work|legally (authorized|able) to work|right to work/ },
    { key: "needs_sponsorship", match: /sponsorship|require.*visa|visa.*require/ },
    // ── the long ones ─────────────────────────────────────────────────────────
    { key: "about_you", match: /tell us about your ?self|about you|introduce yourself|summary|bio/ }
  ];
  function normalise4(label) {
    return label.toLowerCase().replace(/\*/g, " ").replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function canonicalKey(spec) {
    if (spec.part) return null;
    const label = normalise4(spec.label || spec.id.replace(/_/g, " "));
    if (!label) return null;
    const context = spec.section ? `${normalise4(spec.section)} ${label}` : label;
    const hits = KEYS.filter((entry) => {
      if (entry.never?.test(context)) return false;
      return entry.match.test(label);
    });
    return hits.length === 1 ? hits[0].key : null;
  }

  // core/src/dispatch.ts
  var MAX_HOLD_MS = 2500;
  var ToolResultQueue = class {
    constructor() {
      this.waiting = [];
      /** True between `reply.started` and `reply.done` — the one window we must not send in. */
      this.speaking = false;
      /** When the oldest waiting result arrived, for the deadline. */
      this.since = null;
    }
    /**
     * Tell the queue what the agent just did.
     *
     * Only the two reply events change anything. Everything else — a transcript, a new turn, an
     * audio frame — is deliberately ignored, because reacting to those is what shut the window
     * before the tool could reach it.
     */
    note(type) {
      if (type === "reply.started") {
        this.speaking = true;
        return;
      }
      if (type === "reply.done") this.speaking = false;
    }
    /** A tool has finished. `now` is only read to start the deadline. */
    add(item, now) {
      this.waiting.push(item);
      if (this.since === null) this.since = now;
    }
    /**
     * What should be sent right now, removed from the queue.
     *
     * Empty while the agent is mid-reply — unless it has been mid-reply for longer than a reply
     * can plausibly last, in which case the events we were waiting on are not coming.
     */
    due(now) {
      if (this.waiting.length === 0) return [];
      if (this.speaking && !this.overdue(now)) return [];
      const ready = this.waiting;
      this.waiting = [];
      this.since = null;
      return ready;
    }
    /** Has the oldest waiting result been held past the point of trusting the protocol? */
    overdue(now) {
      return this.since !== null && now - this.since >= MAX_HOLD_MS;
    }
    /**
     * Throw away everything waiting, without sending it.
     *
     * Deliberately not called by `note`. The only safe time to use this is when the socket itself
     * is gone and there is nobody left to answer — see the note on `reply.done`.
     */
    clear() {
      this.waiting = [];
      this.since = null;
    }
    /** How many results are waiting. */
    get size() {
      return this.waiting.length;
    }
    /** Whether the agent is believed to be mid-reply. Exposed for tests and the on-screen log. */
    get isSpeaking() {
      return this.speaking;
    }
  };

  // core/src/concepts.ts
  var c = (id, say, valueKind, scope, volatility, extra = {}) => ({
    id,
    say,
    valueKind,
    scope,
    volatility,
    ...extra
  });
  var CONCEPTS = [
    // ── Who they are ──────────────────────────────────────────────────────────────────────
    c("identity.full_name", "full name", "text", "remember", "stable", { group: "name" }),
    c("identity.first_name", "first name", "text", "remember", "stable", { group: "name" }),
    c("identity.middle_name", "middle name", "text", "remember", "stable", { group: "name" }),
    c("identity.last_name", "last name", "text", "remember", "stable", { group: "name" }),
    c("identity.preferred_name", "preferred name", "text", "remember", "stable"),
    c("identity.name_prefix", "title (Mr, Ms, Dr)", "choice", "remember", "stable"),
    c("identity.name_pronunciation", "how the name is said", "text", "remember", "stable"),
    c("identity.pronouns", "pronouns", "choice", "remember", "stable"),
    c("identity.date_of_birth", "date of birth", "date", "remember", "stable", { group: "date_of_birth" }),
    c("identity.age", "age", "number", "this_form", "volatile"),
    c("identity.sex", "sex", "choice", "sensitive", "stable"),
    c("identity.nationality", "nationality", "choice", "remember", "stable"),
    c("identity.marital_status", "marital status", "choice", "sensitive", "slow"),
    c("identity.signature", "signature", "text", "never", "stable"),
    // ── How to reach them ────────────────────────────────────────────────────────────────
    c("contact.email", "email", "email", "remember", "slow"),
    c("contact.phone", "phone number", "phone", "remember", "slow", { group: "phone" }),
    c("contact.phone.country_code", "phone country code", "choice", "remember", "slow", { group: "phone" }),
    c("contact.phone.area_code", "phone area code", "phone", "remember", "slow", { group: "phone" }),
    c("contact.phone.number", "phone number (without its codes)", "phone", "remember", "slow", { group: "phone" }),
    c("contact.preferred_method", "best way to reach them", "choice", "remember", "slow"),
    // ── Where ────────────────────────────────────────────────────────────────────────────
    c("address.full", "address", "long", "remember", "slow", { group: "address" }),
    c("address.street", "street address", "text", "remember", "slow", { group: "address" }),
    c("address.street2", "address line 2", "text", "remember", "slow", { group: "address" }),
    c("address.city", "city", "text", "remember", "slow", { group: "address" }),
    c("address.state", "state or region", "text", "remember", "slow", { group: "address" }),
    c("address.postal_code", "postal code", "text", "remember", "slow", { group: "address" }),
    c("address.country", "country", "choice", "remember", "slow", { group: "address" }),
    c("address.current_location", "where they are based", "text", "remember", "slow"),
    c("address.country_of_residence", "country they live in", "choice", "remember", "slow"),
    // ── Documents ────────────────────────────────────────────────────────────────────────
    c("document.passport_number", "passport number", "text", "sensitive", "slow"),
    c("document.passport_country", "passport country", "choice", "remember", "stable"),
    c("document.passport_expiry", "passport expiry", "date", "sensitive", "slow"),
    c("document.national_id", "national ID number", "text", "sensitive", "stable"),
    c("document.tax_id", "tax number", "text", "sensitive", "stable"),
    c("document.health_insurance_number", "health insurance number", "text", "sensitive", "slow"),
    c("document.drivers_license", "driving licence number", "text", "sensitive", "slow"),
    // ── Education (one entry per school) ─────────────────────────────────────────────────
    c("education.school", "school or university", "choice", "remember", "stable", { group: "education", repeatable: true }),
    c("education.degree", "degree", "choice", "remember", "stable", { group: "education", repeatable: true }),
    c("education.field_of_study", "field of study", "choice", "remember", "stable", { group: "education", repeatable: true }),
    c("education.start_date", "study start date", "month", "remember", "stable", { group: "education", repeatable: true }),
    c("education.graduation_date", "graduation date", "month", "remember", "stable", { group: "education", repeatable: true }),
    c("education.gpa", "grade average", "text", "remember", "stable", { group: "education", repeatable: true }),
    c("education.highest_level", "highest level of education", "choice", "remember", "slow"),
    c("education.student_type", "kind of student", "choice", "this_form", "slow"),
    c("education.interests", "subjects of interest", "choice", "this_form", "slow"),
    // ── Work history (one entry per job) ─────────────────────────────────────────────────
    c("employment.current_employer", "current company", "text", "remember", "slow"),
    c("employment.current_title", "current job title", "text", "remember", "slow"),
    c("employment.employer", "company", "text", "remember", "stable", { group: "employment", repeatable: true }),
    c("employment.title", "job title", "text", "remember", "stable", { group: "employment", repeatable: true }),
    c("employment.start_date", "job start date", "month", "remember", "stable", { group: "employment", repeatable: true }),
    c("employment.end_date", "job end date", "month", "remember", "stable", { group: "employment", repeatable: true }),
    c("employment.description", "what they did there", "long", "remember", "stable", { group: "employment", repeatable: true }),
    c("employment.years_experience", "years of experience", "number", "remember", "slow"),
    c("employment.headline", "professional headline", "text", "remember", "slow"),
    c("employment.notice_period", "notice period", "text", "this_form", "volatile"),
    c("employment.earliest_start", "earliest start date", "text", "this_form", "volatile"),
    c("employment.expected_salary", "expected salary", "text", "this_form", "volatile"),
    c("employment.current_salary", "current salary", "text", "sensitive", "volatile"),
    c("employment.interviewing_elsewhere", "other interviews under way", "long", "this_form", "volatile"),
    // ── Links ────────────────────────────────────────────────────────────────────────────
    c("links.linkedin", "LinkedIn", "url", "remember", "slow"),
    c("links.github", "GitHub", "url", "remember", "slow"),
    c("links.portfolio", "portfolio", "url", "remember", "slow"),
    c("links.website", "website", "url", "remember", "slow"),
    c("links.twitter", "X / Twitter", "url", "remember", "slow"),
    c("links.other", "other links", "url", "remember", "slow"),
    // ── The job, the place, the terms ──────────────────────────────────────────────────────
    // Authorisation and sponsorship are kept: they are the person's standing, asked the same way on
    // form after form (the old memory kept them too). The rest depends on this job and this place.
    c("work.authorized", "authorised to work there", "yesno", "remember", "slow"),
    c("work.needs_sponsorship", "needs visa sponsorship", "yesno", "remember", "slow"),
    c("work.willing_to_relocate", "willing to relocate", "yesno", "this_form", "volatile"),
    c("work.relocation_plans", "relocation plans", "long", "this_form", "volatile"),
    c("work.lives_near_office", "lives near the office", "yesno", "this_form", "volatile"),
    c("work.office_attendance", "able to work from the office", "yesno", "this_form", "volatile"),
    c("work.remote_preference", "remote or office preference", "choice", "remember", "slow"),
    c("work.travel", "comfortable with travel", "yesno", "this_form", "volatile"),
    c("work.security_clearance", "security clearance", "choice", "sensitive", "slow"),
    c("work.compensation_ok", "fine with the pay range", "yesno", "this_form", "volatile"),
    c("work.languages", "languages spoken", "choice", "remember", "stable"),
    c("work.language_level", "level in a language", "choice", "remember", "slow"),
    // ── How they found this ──────────────────────────────────────────────────────────────
    c("source.how_heard", "how they heard about this", "choice", "this_form", "volatile"),
    c("source.referrer_name", "who referred them", "text", "this_form", "volatile"),
    c("source.referrer_email", "referrer's email", "email", "this_form", "volatile"),
    // ── Consents (always asked fresh) ────────────────────────────────────────────────────
    c("consent.privacy", "privacy notice agreement", "yesno", "never", "volatile"),
    c("consent.terms", "terms agreement", "yesno", "never", "volatile"),
    c("consent.marketing", "marketing messages", "yesno", "never", "volatile"),
    c("consent.background_check", "background check consent", "yesno", "never", "volatile"),
    c("consent.recording", "recording or AI notetaker consent", "yesno", "never", "volatile"),
    c("consent.future_contact", "being contacted later", "yesno", "never", "volatile"),
    c("consent.data_processing", "data processing consent", "yesno", "never", "volatile"),
    // ── Equal-opportunity questions (sensitive, always optional to answer) ───────────────
    c("eeo.gender", "gender", "choice", "sensitive", "stable"),
    c("eeo.gender_identity", "gender identity", "choice", "sensitive", "stable"),
    c("eeo.transgender", "transgender experience", "choice", "sensitive", "stable"),
    c("eeo.sexual_orientation", "sexual orientation", "choice", "sensitive", "stable"),
    c("eeo.lgbtq", "LGBTQ+ community", "choice", "sensitive", "stable"),
    c("eeo.race_ethnicity", "race or ethnicity", "choice", "sensitive", "stable"),
    c("eeo.hispanic_latino", "Hispanic or Latino", "choice", "sensitive", "stable"),
    c("eeo.veteran_status", "veteran status", "choice", "sensitive", "slow"),
    c("eeo.disability_status", "disability status", "choice", "sensitive", "slow"),
    // ── Health (sensitive) ───────────────────────────────────────────────────────────────
    c("health.allergies", "allergies", "long", "sensitive", "slow"),
    c("health.medications", "current medications", "long", "sensitive", "volatile"),
    c("health.conditions", "health conditions", "long", "sensitive", "slow"),
    c("health.history", "medical history", "long", "sensitive", "slow"),
    c("health.family_history", "family medical history", "long", "sensitive", "stable"),
    c("health.symptoms", "current symptoms", "long", "sensitive", "volatile"),
    c("health.lifestyle", "lifestyle (sleep, diet, exercise, smoking)", "long", "sensitive", "slow"),
    c("health.mental", "psychological history", "long", "sensitive", "slow"),
    c("health.doctor", "their doctor", "text", "sensitive", "slow"),
    // ── An organisation's own details (subject: organization) ───────────────────────────
    c("organization.name", "organisation name", "text", "remember", "slow"),
    c("organization.type", "kind of organisation", "choice", "remember", "slow"),
    // ── Answers written for this form ────────────────────────────────────────────────────
    c("text.about_you", "about them", "long", "remember", "slow"),
    c("text.cover_letter", "cover letter", "long", "this_form", "volatile"),
    c("text.why_this", "why this company or role", "long", "this_form", "volatile"),
    c("text.additional_info", "anything else", "long", "this_form", "volatile"),
    // ── The form itself ──────────────────────────────────────────────────────────────────
    c("meta.today", "today's date", "date", "never", "volatile"),
    c("meta.signature_date", "date signed", "date", "never", "volatile"),
    c("meta.search", "a search box, not a question", "text", "never", "volatile"),
    // Anything else: the form's own question. Its `gist` (from the model) says what it asks.
    c("other", "this form's own question", "text", "this_form", "volatile")
  ];
  var BY_ID = new Map(CONCEPTS.map((concept) => [concept.id, concept]));
  function conceptById(id) {
    return BY_ID.get(id);
  }
  var RELATED_CONCEPTS = {
    "address.current_location": ["address.city"],
    "address.city": ["address.current_location"],
    "address.country_of_residence": ["address.country"],
    "address.country": ["address.country_of_residence"],
    "links.website": ["links.portfolio"],
    "links.portfolio": ["links.website"]
  };
  var LEGACY_KEY_TO_CONCEPT = {
    first_name: "identity.first_name",
    last_name: "identity.last_name",
    full_name: "identity.full_name",
    preferred_name: "identity.preferred_name",
    email: "contact.email",
    phone: "contact.phone",
    city: "address.city",
    country: "address.country",
    postal_code: "address.postal_code",
    linkedin: "links.linkedin",
    github: "links.github",
    portfolio: "links.portfolio",
    current_employer: "employment.current_employer",
    current_title: "employment.current_title",
    years_experience: "employment.years_experience",
    notice_period: "employment.notice_period",
    expected_salary: "employment.expected_salary",
    current_salary: "employment.current_salary",
    willing_to_relocate: "work.willing_to_relocate",
    work_authorization: "work.authorized",
    needs_sponsorship: "work.needs_sponsorship",
    about_you: "text.about_you"
  };

  // core/src/conversation.ts
  var MOST_CHOICES_TO_READ_OUT = 6;
  var EASY = [
    {
      keys: ["first_name", "last_name", "full_name", "preferred_name"],
      concepts: ["identity.first_name", "identity.last_name", "identity.middle_name", "identity.full_name", "identity.preferred_name"],
      say: "your name"
    },
    { keys: ["email"], concepts: ["contact.email"], say: "email" },
    { keys: ["phone"], concepts: ["contact.phone", "contact.phone.number", "contact.phone.country_code", "contact.phone.area_code"], say: "phone number" },
    {
      keys: ["city", "country", "postal_code"],
      concepts: ["address.city", "address.country", "address.postal_code", "address.current_location", "address.country_of_residence"],
      say: "where you're based"
    },
    { keys: ["linkedin"], concepts: ["links.linkedin"], say: "LinkedIn" },
    { keys: ["github"], concepts: ["links.github"], say: "GitHub" },
    { keys: ["portfolio"], concepts: ["links.portfolio", "links.website"], say: "website" }
  ];
  function easyGroupOf(spec) {
    const understood = spec.understood;
    if (understood && understood.confidence !== "low") {
      if (understood.subject !== "self") return void 0;
      return EASY.find((group) => group.concepts.includes(understood.concept));
    }
    const key = canonicalKey(spec);
    return key === null ? void 0 : EASY.find((group) => group.keys.includes(key));
  }
  var MOST_EASY_TO_NAME = 5;
  function isEasy(spec) {
    return easyGroupOf(spec) !== void 0;
  }
  function spokenList(items, last = "and") {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
  }
  function isChoice(spec) {
    return spec.kind === "select" || spec.kind === "radio" || spec.kind === "multiselect";
  }
  function answerable(specs) {
    return specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file");
  }
  function openingLine(specs, title = "", {
    filled = [],
    remembered = false,
    toConfirm = []
  } = {}) {
    const fields = answerable(specs);
    if (fields.length === 0) {
      return "I can't find anything to fill in on this page yet.";
    }
    const name = title.trim();
    const what = name ? `Right, this is ${name}` : "Right";
    if (fields.length <= 2 && fields.every(isChoice)) {
      return `${what}. It opens with one question: ${howToAsk(fields[0])} The rest appears once you answer.`;
    }
    const size = `${fields.length} ${fields.length === 1 ? "question" : "questions"}`;
    const intro = name ? `${what} \u2014 ${size}.` : `Right \u2014 this form has ${size}.`;
    const done = new Set(filled);
    const easyGroups = EASY.map((group) => ({
      say: group.say,
      fields: fields.filter((spec) => easyGroupOf(spec) === group)
    })).filter((group) => group.fields.length > 0);
    const alreadyIn = easyGroups.filter((group) => {
      const needed = group.fields.filter((spec) => spec.required);
      return (needed.length > 0 ? needed : group.fields).every((spec) => done.has(spec.id));
    });
    const toSay = easyGroups.filter((group) => !alreadyIn.includes(group)).map((group) => group.say).slice(0, MOST_EASY_TO_NAME);
    const kept = alreadyIn.length ? ` I've already put in ${spokenList(alreadyIn.map((group) => group.say).slice(0, MOST_EASY_TO_NAME))}${remembered ? " from last time" : ""} \u2014 give ${alreadyIn.length === 1 ? "it" : "them"} a quick look.` : "";
    if (toConfirm.length > 0) {
      const named2 = toConfirm.slice(0, 3);
      const more = toConfirm.length > named2.length ? ` and ${toConfirm.length - named2.length} more` : "";
      return `${intro}${kept} From last time I also have ${spokenList(named2)}${more} \u2014 they're on screen. Still right?`;
    }
    if (toSay.length > 0) {
      return `${intro}${kept} Easy ones first: ${spokenList(toSay)}. Say them all at once if you like.`;
    }
    if (alreadyIn.length > 0) {
      return `${intro}${kept} The rest needs you \u2014 ready when you are.`;
    }
    return `${intro} Tell me whatever you know and I'll put it in the right places.`;
  }
  function howToAsk(spec) {
    const label = fieldName(spec);
    const question = spec.section ? `${label} (under "${spec.section}")` : label;
    if (spec.kind === "checkbox") {
      return `${question} \u2014 a yes or no.`;
    }
    if (isChoice(spec)) {
      const choices = realChoices(spec.options);
      if (choices.length === 0) return question;
      if (choices.length <= MOST_CHOICES_TO_READ_OUT) {
        return spec.kind === "multiselect" ? `${question} \u2014 any of: ${spokenList(choices)}.` : `${question} \u2014 ${spokenList(choices, "or")}?`;
      }
      return `${question} \u2014 there are ${choices.length} options, so ask them to look at the list on screen before they answer.`;
    }
    if (spec.longForm) {
      return `${question} \u2014 a longer answer; tell them a few sentences is fine.`;
    }
    return question;
  }
  function inAskingOrder(specs) {
    const fields = answerable(specs);
    return [...fields.filter(isEasy), ...fields.filter((spec) => !isEasy(spec))];
  }
  var ADDRESS_PART = /street|address|city|town|state|province|county|post(al)? ?code|zip|pin ?code|country/i;
  function addressFields(specs) {
    const known = (spec) => spec.understood && spec.understood.confidence !== "low";
    const isPart = (spec) => known(spec) ? conceptById(spec.understood.concept)?.group === "address" : ADDRESS_PART.test(spec.label);
    const isStreet = (spec) => known(spec) ? ["address.street", "address.full"].includes(spec.understood.concept) : /street|address/i.test(spec.label);
    const bySection = /* @__PURE__ */ new Map();
    for (const spec of specs) {
      if (!isPart(spec)) continue;
      const key = `${spec.section ?? ""}\0${spec.understood?.subject ?? ""}`;
      bySection.set(key, [...bySection.get(key) ?? [], spec]);
    }
    const grouped = /* @__PURE__ */ new Set();
    for (const parts of bySection.values()) {
      const hasStreet = parts.some(isStreet);
      if (hasStreet && parts.length >= 2) for (const spec of parts) grouped.add(spec.id);
    }
    return grouped;
  }
  function questionOf(spec) {
    return fieldName(spec);
  }
  function factsOf(spec, all = [spec]) {
    const facts = {
      field: spec.id,
      question: questionOf(spec),
      answer_type: spec.kind === "checkbox" ? "yes or no" : spec.kind === "multiselect" ? "pick any" : isChoice(spec) ? "pick one" : spec.longForm ? "long answer" : "text",
      required: spec.required
    };
    if (spec.section) facts.section = spec.section;
    if (isChoice(spec)) {
      const choices = realChoices(spec.options);
      if (choices.length > 0 && choices.length <= MOST_CHOICES_TO_READ_OUT) facts.choices = choices;
      else if (choices.length > 0) facts.choice_count = choices.length;
    }
    if (addressFields(all).has(spec.id)) facts.group = "address";
    else if (phoneFields(all).has(spec.id)) facts.group = "phone";
    if (spec.searchable) facts.searchable = true;
    if (spec.range) facts.range = { min: spec.range.min, max: spec.range.max };
    return facts;
  }
  var MOST_VALUE_TO_ECHO = 60;
  var MOST_TO_LIST = 8;
  function summarise({
    specs,
    before = specs,
    filled,
    outcomes,
    claimed = [],
    reshaped = null,
    declined = []
  }) {
    const byId = new Map([...before, ...specs].map((spec) => [spec.id, spec]));
    const present = new Set(specs.map((spec) => spec.id));
    const done = new Set(filled);
    const question = (id) => {
      const spec = byId.get(id);
      return spec ? questionOf(spec) : id;
    };
    const just_filled = outcomes.filter((o) => o.status === "written").map((o) => ({
      field: o.fieldId,
      question: question(o.fieldId),
      value: o.wrote.length > MOST_VALUE_TO_ECHO ? `${o.wrote.slice(0, MOST_VALUE_TO_ECHO)}\u2026` : o.wrote
    }));
    const not_filled = outcomes.filter((o) => o.status !== "written").map((o) => {
      const spec = byId.get(o.fieldId);
      let why;
      if (o.status === "rejected-by-page") {
        why = o.retried ? "page_refused_twice" : "page_refused";
      } else if (o.status === "refused" && o.choices?.length) {
        why = "not_an_option";
      } else if (!present.has(o.fieldId)) {
        why = "gone";
      } else if (spec?.kind === "file") {
        why = "needs_the_person";
      } else {
        const quote = claimed.find((c2) => c2.fieldId === o.fieldId)?.evidence?.trim() ?? "";
        why = quote.length >= 2 && !spec?.suspectedHoneypot ? "quote_not_found" : "not_heard";
      }
      const tried = claimed.find((c2) => c2.fieldId === o.fieldId)?.value;
      return {
        field: o.fieldId,
        question: question(o.fieldId),
        why,
        ...why === "not_an_option" && tried !== void 0 ? { tried: String(tried) } : {},
        ...o.status === "refused" && why === "not_an_option" ? { choices: o.choices } : {}
      };
    });
    const skip = new Set(declined);
    const notDeclined = (spec) => !skip.has(spec.id);
    const requiredLeft = inAskingOrder(stillMissing(specs, done)).filter(notDeclined);
    const optionalLeft = inAskingOrder(stillOptional(specs, done)).filter(notDeclined);
    const all = answerable(specs);
    const summary = {
      just_filled,
      not_filled,
      progress: {
        filled: all.filter((spec) => done.has(spec.id)).length,
        total: all.length,
        required_left: requiredLeft.length,
        optional_left: optionalLeft.length
      },
      next_required: requiredLeft.slice(0, MOST_TO_LIST).map((spec) => factsOf(spec, specs)),
      submitted: false
    };
    if (requiredLeft.length === 0 && optionalLeft.length > 0) {
      summary.optional = optionalLeft.slice(0, MOST_TO_LIST * 2).map((spec) => factsOf(spec, specs));
    }
    if (reshaped && (reshaped.appeared.length > 0 || reshaped.disappeared.length > 0)) {
      summary.form_changed = {
        new_questions: inAskingOrder(reshaped.appeared).map((spec) => factsOf(spec, specs)),
        gone: reshaped.disappeared.map((spec) => questionOf(spec)),
        kept: reshaped.restored,
        ...reshaped.maybeSame.length > 0 ? { maybe_same_answer: reshaped.maybeSame } : {}
      };
    }
    return summary;
  }

  // core/src/reconcile.ts
  function slug(raw) {
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  }
  function signature(spec) {
    return `${spec.kind}|${spec.section ?? ""}|${spec.label}|${spec.part ?? ""}`;
  }
  var FieldRegistry = class {
    constructor() {
      /** The element a field was found at. Weak, so a page that throws its DOM away is not held. */
      this.idByElement = /* @__PURE__ */ new WeakMap();
      /** Ids by what they ask, for the page that rebuilds a field rather than hiding it. */
      this.idsBySignature = /* @__PURE__ */ new Map();
      /** Every id ever handed out. A new field never gets one of these. */
      this.used = /* @__PURE__ */ new Set();
      this.current = null;
    }
    /** The latest read this registry has adopted. */
    get read() {
      return this.current;
    }
    /**
     * Take a fresh read of the page and give its fields their session ids.
     *
     * The first call just establishes the ids, and reports nothing as having appeared — the whole
     * form is new then, which is not a change.
     */
    adopt(next) {
      const previous = this.current;
      const taken = /* @__PURE__ */ new Set();
      const finalIds = /* @__PURE__ */ new Map();
      for (const spec of next.specs) {
        const el = next.handles.get(spec.id);
        const known = el ? this.idByElement.get(el) : void 0;
        if (known && !taken.has(known)) {
          finalIds.set(spec, known);
          taken.add(known);
        }
      }
      for (const spec of next.specs) {
        if (finalIds.has(spec)) continue;
        const earlier = (this.idsBySignature.get(signature(spec)) ?? []).find((id) => !taken.has(id));
        if (earlier) {
          finalIds.set(spec, earlier);
          taken.add(earlier);
        }
      }
      for (const spec of next.specs) {
        if (finalIds.has(spec)) continue;
        const free = (id2) => !this.used.has(id2) && !taken.has(id2);
        const base = free(spec.id) || !spec.section ? spec.id : `${slug(spec.section)}_${spec.id}`.slice(0, 64);
        let id = base;
        for (let n = 2; !free(id); n++) id = `${base}_${n}`;
        finalIds.set(spec, id);
        taken.add(id);
      }
      const before = new Map(previous?.specs.map((spec) => [spec.id, spec]) ?? []);
      const handles = /* @__PURE__ */ new Map();
      for (const spec of next.specs) {
        const el = next.handles.get(spec.id);
        const id = finalIds.get(spec);
        spec.id = id;
        if (el) {
          handles.set(id, el);
          this.idByElement.set(el, id);
        }
        this.used.add(id);
        const ids = this.idsBySignature.get(signature(spec)) ?? [];
        if (!ids.includes(id)) this.idsBySignature.set(signature(spec), [...ids, id]);
        const old = before.get(id);
        if (!spec.options?.length && old?.options?.length) spec.options = old.options;
        if (old?.searchable) spec.searchable = true;
        if (old?.kind === "multiselect" && spec.kind === "select") spec.kind = "multiselect";
      }
      const read = { ...next, handles };
      this.current = read;
      if (!previous) return { read, appeared: [], disappeared: [] };
      const now = new Set(read.specs.map((spec) => spec.id));
      return {
        read,
        appeared: read.specs.filter((spec) => !before.has(spec.id)),
        disappeared: previous.specs.filter((spec) => !now.has(spec.id))
      };
    }
  };

  // core/src/persona.ts
  var BANNED_PHRASES = [
    "Great question",
    "Happy to help",
    "Certainly",
    "Absolutely",
    "Please provide",
    "Could you please tell me",
    "I have submitted",
    // Both from a live run where the agent stopped leading and left the person talking to silence.
    "Let me know when you're ready",
    "Still here"
  ];
  function systemPrompt(formBrief) {
    return [
      // ── 1. Identity, and the rule that matters most ────────────────────────────────
      "You're Longtake: the calm, quick, slightly dry assistant sitting beside someone while they fill in a form they didn't write. They talk; you type. Keep every reply to one or two short sentences \u2014 this matters more than anything except the next line.",
      "You never submit anything and never say you have. You type into a form they are looking at; they read it and send it themselves. Never say submitted, sent, applied or filed.",
      "",
      // ── 2. Tone ────────────────────────────────────────────────────────────────────
      "You lead. Every reply that isn't the last one ends by asking for the next thing \u2014 never hand the conversation back with nothing to answer. Say what's done before you ask for what's missing. You can be dry, and a little funny now and then \u2014 never about their answers. Match their length: clipped when they're clipped, warmer when they chat. Once you know their first name, use it now and then, not every line. Never call them sir or ma'am.",
      `Never say: ${BANNED_PHRASES.map((phrase) => `"${phrase}"`).join(", ")}.`,
      "",
      // Live: this example once read "Twitter's not on their list — Social Media's closest", and on a
      // form where "How did you hear about this job?" was a plain text box, the agent said exactly
      // that to someone who said Twitter, and tried to put Social Media in. It was copying the
      // example, not reading the form. So the example is tied to the result that justifies it.
      "Only when a result says not_an_option (a fixed list without their answer):",
      "  Bad: asking the same question again.",
      `  Good: "BTech isn't on their list \u2014 Bachelor's Degree is closest. That one?"`,
      "A box they type into takes their words as they said them. If they say Twitter, Twitter goes in. Never swap their answer for another.",
      "When several answers land at once:",
      '  Bad: "I have filled your first name, last name, email and phone number."',
      '  Good: "Got all four. LinkedIn?"',
      "",
      // ── 3. What you can and cannot do ──────────────────────────────────────────────
      "You can: type into this form, clear what's in it when they ask, tell them what a field accepts, and remember answers from a form they filled before. You cannot: submit, attach files, sign, or see anything outside this form.",
      "Only say something is done when the result says it is. If it didn't happen, say so.",
      "",
      // ── 4. The form, the plan, and the tools ───────────────────────────────────────
      "FORM NOW, at the end of this prompt, is the form exactly as it is at this moment \u2014 updated after everything you do. Trust it over your memory of the conversation: if it says a field is answered, it is. DO NEXT is what to do next; do that, in your own words.",
      "When DO NEXT lists several questions, ask them together in one short sentence \u2014 people answer a short list in one go.",
      "Call fill_fields the moment you hear an answer, and again whenever you hear more \u2014 several answers in one call. Fill only what they actually said, even for required fields; never work one answer out from another.",
      "Every answer's evidence is their own words, copied exactly, in the language they said them. They may mix English and Hindi; the value goes in English, in the Latin alphabet, never Devanagari. Evidence that isn't in what they said is thrown away.",
      "Each result says what went in, what didn't and why. Acknowledge what went in in a few words, not a readback. waiting_for_yes: nothing went in yet \u2014 ask, then report their reply with confirm_answer; you decide whether it was a yes. Never say everything is in while FORM NOW lists anything waiting for their yes. not_an_option: tried is what you sent; check the choices before saying anything is missing. quote_not_found: they did say it, so call again quoting their exact words \u2014 don't ask again. page_refused: ask them to say it once more. page_refused_twice: say plainly they'll need to type that one. not_heard: you sent none of their words, so nothing went in \u2014 say so and ask again. gone: say nothing. If you realise you got something wrong, fix it with a call straight away rather than just apologising.",
      "When they ask to add another entry, like another job or school, or to go to the next page, call press_form_button with their words, then carry on with what appears. page_did_not_change means the form refused to move on: tell them what it asked for. There is no button for submitting: that one is always theirs.",
      "When they say skip it, later, or do the rest first, call skip_for_now with their words and move on. Any field can wait; never tell them the form makes them answer in order.",
      "When they ask to remove, clear or undo an answer, call clear_fields with their words. Never pick another option, like a decline choice, as a way of clearing one. If it can't be emptied, tell them why.",
      "",
      // ── 5. Speaking, not writing ───────────────────────────────────────────────────
      "Everything you say is spoken. No markdown, no lists, no asterisks \u2014 they would be read aloud. Say emails and links the way a person does: rohit at example dot com. Round numbers.",
      "",
      // ── 6. Reading the room ────────────────────────────────────────────────────────
      "While they're giving their long first answer, stay out of the way. If they're in a hurry, be brief. If they ask what a field means, explain it from its question and choices. If they're chatty, you can be too \u2014 then get back to it.",
      "",
      formBrief
    ].join("\n");
  }

  // core/src/ledger.ts
  var Ledger = class {
    constructor() {
      this.written = /* @__PURE__ */ new Map();
      this.declined = /* @__PURE__ */ new Set();
      /** Put off by the person: asked again only once everything else is done. */
      this.later = /* @__PURE__ */ new Set();
      this.pending = /* @__PURE__ */ new Map();
      /** Fields that already had something in them when the session opened. */
      this.atOpen = /* @__PURE__ */ new Set();
      this.toSettle = /* @__PURE__ */ new Map();
    }
    /** Record something we wrote. A later write to the same field replaces it — they corrected it. */
    wrote(id, entry, now = Date.now()) {
      this.written.set(id, { ...entry, at: now });
      this.declined.delete(id);
      this.pending.delete(id);
    }
    entry(id) {
      return this.written.get(id);
    }
    /** Every answer we put in, including ones whose field is currently hidden. */
    entries() {
      return [...this.written.entries()];
    }
    /** The person asked for this to be empty. It is not asked for again. */
    decline(id) {
      this.written.delete(id);
      this.pending.delete(id);
      this.declined.add(id);
    }
    isDeclined(id) {
      return this.declined.has(id);
    }
    /**
     * "Skip this, we'll do it at the end." Not declined — it will be asked again — just not now.
     * Nothing is written or cleared; the field keeps whatever it has.
     */
    setAside(id) {
      this.later.add(id);
    }
    isSetAside(id) {
      return this.later.has(id);
    }
    hold(id, pending) {
      this.pending.set(id, pending);
    }
    pendingFor(id) {
      return this.pending.get(id);
    }
    release(id) {
      this.pending.delete(id);
    }
    /** Something to ask about next time, for this field. A newer one replaces it. */
    ask(id, ask) {
      this.toSettle.set(id, ask);
    }
    askFor(id) {
      return this.toSettle.get(id);
    }
    asks() {
      return [...this.toSettle.entries()];
    }
    /** Asked and answered — or no longer true. */
    settle(id) {
      this.toSettle.delete(id);
    }
    /** Mark what was already on the form before anybody spoke — autofill, the page's own defaults. */
    markAtOpen(ids) {
      for (const id of ids) this.atOpen.add(id);
    }
    wasThereAtOpen(id) {
      return this.atOpen.has(id);
    }
  };

  // core/src/errors.ts
  var ERROR_CLASS = /(^|[\s_-])(error|invalid|danger|field-error|error-message|help-block-error)([\s_-]|$)/i;
  function text2(el) {
    return (el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  function readError(el) {
    const doc = el.ownerDocument;
    if (el.getAttribute("aria-invalid") === "true") {
      const ids = `${el.getAttribute("aria-errormessage") ?? ""} ${el.getAttribute("aria-describedby") ?? ""}`.split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const node = doc?.getElementById(id);
        if (node && isVisible(node) && text2(node)) return text2(node);
      }
    }
    let block = el.parentElement;
    for (let hops = 0; block && hops < 3; hops++) {
      const others = Array.from(block.querySelectorAll("input,select,textarea,[role='combobox']")).filter(
        (other) => other !== el && !el.contains(other) && !other.contains(el)
      );
      if (others.length > 0) break;
      const found = Array.from(block.querySelectorAll("[role='alert'], [class]")).find(
        (node) => node !== el && !node.contains(el) && (node.getAttribute("role") === "alert" || ERROR_CLASS.test(node.className?.toString() ?? "")) && isVisible(node) && text2(node).length > 0
      );
      if (found) return text2(found);
      block = block.parentElement;
    }
    const input = el;
    if (typeof input.validity === "object" && input.value) {
      const v = input.validity;
      if (v.typeMismatch || v.patternMismatch || v.tooShort || v.tooLong || v.rangeOverflow || v.rangeUnderflow || v.badInput) {
        return input.validationMessage || "The form does not accept this value.";
      }
    }
    return null;
  }

  // core/src/form-state.ts
  function sameAnswer(written, onPage) {
    if (onPage === null) return false;
    const flat2 = (v) => (Array.isArray(v) ? v.join(" ") : String(v)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (typeof onPage === "boolean") return onPage === Boolean(written);
    const a = flat2(written);
    const b = flat2(onPage);
    return a === b || a.length > 0 && (b.startsWith(a) || a.startsWith(b) || b.length >= 2 && a.endsWith(b));
  }
  function isOpen(field) {
    return field.value === null && !field.declined;
  }
  function snapshot(read, ledger, title = "", buttons) {
    const fields = [];
    for (const spec of read.specs) {
      if (spec.suspectedHoneypot || spec.kind === "file") continue;
      const el = read.handles.get(spec.id);
      const value = el && el.isConnected ? readValue(spec, el) : null;
      const entry = ledger.entry(spec.id);
      let source;
      if (value === null) source = "empty";
      else if (entry && sameAnswer(entry.value, value)) source = entry.source;
      else if (!entry && ledger.wasThereAtOpen(spec.id)) source = "page";
      else source = "typed";
      const state = { spec, value, source, declined: ledger.isDeclined(spec.id) };
      if (ledger.isSetAside(spec.id)) state.later = true;
      if ((source === "spoken" || source === "memory") && entry) state.evidence = entry.evidence;
      const pending = ledger.pendingFor(spec.id);
      if (pending && value === null) state.pending = pending;
      const error = el && el.isConnected ? readError(el) : null;
      if (error) state.error = error;
      fields.push(state);
    }
    const theirs = read.skipped.filter((skipped) => /file|upload/i.test(skipped.reason)).map((skipped) => skipped.label).filter(Boolean);
    const bySpec = new Map(read.specs.map((spec) => [spec.id, spec]));
    const asks = ledger.asks().flatMap(([id, ask]) => {
      const spec = bySpec.get(id) ?? ledger.entry(id)?.spec;
      return spec ? [{ spec, ask }] : [];
    });
    return {
      title,
      fields,
      theirs,
      asks,
      actions: buttons?.actions ?? [],
      ...buttons?.submitLabel ? { submitLabel: buttons.submitLabel } : {},
      progress: {
        filled: fields.filter((f) => f.value !== null).length,
        total: fields.length,
        requiredLeft: fields.filter((f) => f.spec.required && isOpen(f)).length,
        optionalLeft: fields.filter((f) => !f.spec.required && isOpen(f)).length
      }
    };
  }

  // core/src/gate.ts
  var NUMBER_RANGE = /\d+(\.\d+)?(\s+and\s+a\s+half)?\s+(or|to|ya)\s+\d|\d\s*[-–]\s*\d+\s*(years?|yrs?|months?|weeks?|days?|lakhs?|k)\b/i;
  var ABOUT_A_NUMBER = /\b(about|around|roughly|approximately|approx|nearly|almost|lagbhag|kareeb|takriban)\s+\d/i;
  var UNSURE = /\b(maybe|perhaps|probably|not sure|i guess|shayad|pata nahi)\b/i;
  function isYesNo(spec) {
    const labels = (spec.options ?? []).map((o) => o.label);
    const yes = labels.find((l) => /^\s*yes\b/i.test(l));
    const no = labels.find((l) => /^\s*no\b/i.test(l));
    return yes || no ? { yes, no } : null;
  }
  function named(spec, evidence) {
    const byName = optionNamedIn(spec, evidence);
    if (byName) return byName.label;
    const yesNo = isYesNo(spec);
    if (yesNo) {
      if (MEANS_NO.test(evidence) && yesNo.no) return yesNo.no;
      if (MEANS_YES.test(evidence) && yesNo.yes) return yesNo.yes;
    }
    return null;
  }
  function isChoice2(spec) {
    return spec.kind === "select" || spec.kind === "radio";
  }
  function gate(spec, claim, held) {
    const evidence = claim.evidence ?? "";
    const value = Array.isArray(claim.value) ? claim.value.join(", ") : String(claim.value);
    if (held?.reason === "hedged" && !hedged(spec, evidence)) return { write: true };
    if (isChoice2(spec) && spec.options?.length) {
      const want = matchOption(spec, value);
      const said2 = named(spec, evidence);
      if (UNSURE.test(evidence) && !(held && MEANS_YES.test(evidence))) {
        return { write: false, pending: { suggestion: want?.label ?? value, heard: evidence, reason: "hedged" } };
      }
      if (!want) return { write: true };
      if (said2 === want.label || sameText(evidence, want.label)) return { write: true };
      return { write: false, pending: { suggestion: want.label, heard: evidence, reason: "not_named" } };
    }
    if (!isLongAnswer(spec) && hedged(spec, evidence) && /\d/.test(value)) {
      return { write: false, pending: { suggestion: value, heard: evidence, reason: "hedged" } };
    }
    return { write: true };
  }
  function isLongAnswer(spec) {
    return Boolean(spec.longForm);
  }
  function hedged(spec, evidence) {
    if (NUMBER_RANGE.test(evidence) || ABOUT_A_NUMBER.test(evidence)) return true;
    return isChoice2(spec) && UNSURE.test(evidence);
  }
  function sameText(a, b) {
    const flat2 = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return flat2(a) === flat2(b);
  }

  // core/src/profile.ts
  var PROFILE_VERSION = 2;
  var HISTORY = 12;
  var VOLATILE_DAYS = 30;
  var DAY_MS = 864e5;
  function emptyProfile() {
    return { version: 2, facts: {}, answers: {}, settings: { rememberSensitive: false } };
  }
  function factId(key) {
    return `${key.concept}${key.part ? `#${key.part}` : ""}${key.entry ? `@${key.entry}` : ""}`;
  }
  function asPart(text4) {
    const part = (text4 ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
    return part || void 0;
  }
  function factKeys(specs, meanings) {
    const keys = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Map();
    const boxes = /* @__PURE__ */ new Map();
    for (const spec of specs) {
      const meaning = meanings[spec.id];
      if (meaning?.subject === "self") boxes.set(meaning.concept, (boxes.get(meaning.concept) ?? 0) + 1);
    }
    for (const spec of specs) {
      const meaning = meanings[spec.id];
      if (!meaning || meaning.subject !== "self" || meaning.concept === "other") continue;
      const split = (boxes.get(meaning.concept) ?? 0) > 1 && !conceptById(meaning.concept)?.repeatable;
      const named2 = asPart(meaning.part) ?? (split ? asPart(spec.part) : void 0);
      const part = named2 && !meaning.concept.endsWith(`.${named2}`) ? named2 : void 0;
      const concept = conceptById(meaning.concept);
      let entry;
      if (concept?.repeatable) {
        const base = `${meaning.concept}#${part ?? ""}`;
        entry = meaning.entry?.index ?? seen.get(base) ?? 0;
        seen.set(base, entry + 1);
      }
      keys.set(spec.id, { concept: meaning.concept, ...part ? { part } : {}, ...entry ? { entry } : {} });
    }
    return keys;
  }
  function sameValue(a, b) {
    if (typeof a === "boolean" || typeof b === "boolean") return a === b;
    const flat2 = (v) => (Array.isArray(v) ? [...v].map((x) => normalise(String(x))).sort() : [normalise(v)]).join("|");
    return flat2(a) === flat2(b);
  }
  function isEmpty(value) {
    if (typeof value === "boolean") return false;
    if (Array.isArray(value)) return value.length === 0;
    return value.trim() === "";
  }
  function keepable(concept) {
    const known = conceptById(concept);
    if (!known || concept === "other") return "no";
    if (known.scope === "remember") return "yes";
    if (known.scope === "sensitive") return "sensitive";
    return "no";
  }
  function withTelling(fact, from, value, now) {
    return {
      ...fact,
      value,
      history: [...fact.history, { ...from, value }].slice(-HISTORY),
      updatedAt: now
    };
  }
  function applyChanges(profile, changes, now = Date.now()) {
    let next = { ...profile, facts: { ...profile.facts }, answers: { ...profile.answers }, settings: { ...profile.settings } };
    const questions = [];
    let changed = false;
    for (const change of changes) {
      switch (change.type) {
        case "observe": {
          const kept = keepable(change.key.concept);
          if (kept === "no" || isEmpty(change.value)) break;
          if (kept === "sensitive" && !next.settings.rememberSensitive && !change.allowSensitive) break;
          const trusted = change.from.source === "spoken" || change.from.source === "confirmed";
          if (trusted && !change.from.evidence.trim()) break;
          const id = factId(change.key);
          const known = next.facts[id];
          if (!known) {
            next.facts[id] = {
              id,
              ...change.key,
              gist: change.gist,
              value: change.value,
              history: [{ ...change.from, value: change.value }],
              sensitive: kept === "sensitive",
              createdAt: now,
              updatedAt: now,
              useCount: 1
            };
            changed = true;
            break;
          }
          if (sameValue(known.value, change.value)) {
            next.facts[id] = { ...withTelling(known, change.from, known.value, now), useCount: known.useCount + 1 };
            changed = true;
            break;
          }
          const last = known.history[known.history.length - 1];
          const correction = !!change.from.session && last?.session === change.from.session && last.field === change.from.field;
          if (correction) {
            next.facts[id] = withTelling(known, change.from, change.value, now);
            changed = true;
            break;
          }
          questions.push({ id, key: change.key, gist: known.gist || change.gist, was: known.value, now: change.value, from: change.from });
          break;
        }
        case "replace": {
          const known = next.facts[change.id];
          if (known) {
            next.facts[change.id] = withTelling(known, change.from, change.value, now);
            changed = true;
          } else if (change.key && keepable(change.key.concept) !== "no") {
            next.facts[change.id] = {
              id: change.id,
              ...change.key,
              gist: change.gist ?? "",
              value: change.value,
              history: [{ ...change.from, value: change.value }],
              sensitive: keepable(change.key.concept) === "sensitive",
              createdAt: now,
              updatedAt: now,
              useCount: 1
            };
            changed = true;
          }
          break;
        }
        case "unobserve": {
          const known = next.facts[change.id];
          if (!known) break;
          const history = known.history.filter((h) => !(h.session === change.session && h.field === change.field));
          if (history.length === known.history.length) break;
          if (history.length === 0) delete next.facts[change.id];
          else next.facts[change.id] = { ...known, history, value: history[history.length - 1].value, updatedAt: now };
          changed = true;
          break;
        }
        case "used":
          for (const id of change.ids) {
            const known = next.facts[id];
            if (known) next.facts[id] = { ...known, useCount: known.useCount + 1 };
          }
          changed = change.ids.length > 0 || changed;
          break;
        case "delete":
          if (next.facts[change.id]) {
            delete next.facts[change.id];
            changed = true;
          }
          break;
        case "deleteAll":
          next = { ...emptyProfile(), settings: next.settings };
          changed = true;
          break;
        case "saveAnswer":
          next.answers[change.answer.id] = change.answer;
          changed = true;
          break;
        case "deleteAnswer":
          if (next.answers[change.id]) {
            delete next.answers[change.id];
            changed = true;
          }
          break;
        case "settings":
          next.settings = { ...next.settings, ...change.settings };
          changed = true;
          break;
        case "import":
          for (const fact of Object.values(change.profile.facts)) {
            const known = next.facts[fact.id];
            if (!known || fact.updatedAt > known.updatedAt) next.facts[fact.id] = fact;
          }
          for (const answer of Object.values(change.profile.answers)) {
            const known = next.answers[answer.id];
            if (!known || answer.at > known.at) next.answers[answer.id] = answer;
          }
          changed = true;
          break;
      }
    }
    return { profile: next, questions, changed };
  }
  var CHOICE_KINDS = /* @__PURE__ */ new Set(["select", "radio", "multiselect", "checkbox"]);
  function bestTelling(fact) {
    const same = fact.history.filter((h) => sameValue(h.value, fact.value));
    const trusted = [...same].reverse().find((h) => h.source === "spoken" || h.source === "confirmed" || h.source === "edited");
    return trusted ?? same[same.length - 1] ?? fact.history[fact.history.length - 1];
  }
  function evidenceOf(fact) {
    const telling = bestTelling(fact);
    if (telling.evidence.trim()) return telling.evidence;
    const where = telling.host ? ` on ${telling.host}` : "";
    return telling.source === "edited" ? `saved by you in Longtake: ${shownValue(fact.value)}` : `typed by you${where}: ${shownValue(fact.value)}`;
  }
  function shownValue(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return Array.isArray(value) ? value.join(", ") : value;
  }
  function fitsChoices(spec, value, evidence) {
    if (!CHOICE_KINDS.has(spec.kind) || !spec.options?.length) return "fits";
    if (typeof value === "boolean") return "fits";
    const wanted = Array.isArray(value) ? value : [value];
    let closest = false;
    for (const item of wanted) {
      const option = matchOption(spec, item);
      if (!option) return "no";
      const exact = normalise(option.label) === normalise(item) || optionNamedIn(spec, evidence)?.label === option.label;
      if (!exact) closest = true;
    }
    return closest ? "closest" : "fits";
  }
  function recallFor(specs, meanings, profile, now = Date.now()) {
    const keys = factKeys(specs, meanings);
    const found = [];
    for (const spec of specs) {
      if (spec.suspectedHoneypot || spec.kind === "file") continue;
      const meaning = meanings[spec.id];
      const key = keys.get(spec.id);
      if (!meaning || !key) continue;
      const concept = conceptById(meaning.concept);
      if (!concept || concept.scope !== "remember" && concept.scope !== "sensitive") continue;
      const answer = answerFor(key, spec, profile);
      if (!answer) continue;
      const { fact, value, evidence } = answer;
      let why = answer.why;
      const fit = fitsChoices(spec, value, evidence);
      if (fit === "no") continue;
      const telling = bestTelling(fact);
      if (!why) why = reasonToAsk(meaning, fact, telling, fit, now);
      found.push({
        fieldId: spec.id,
        factId: answer.id,
        value,
        evidence,
        sure: !why,
        ...why ? { why } : {}
      });
    }
    return found;
  }
  function datePiece(day, part, spec) {
    const which = /^(d|dd|day|date)$/.test(part) ? "d" : /^(m|mm|month)$/.test(part) ? "m" : /^(y|yy|yyyy|year)$/.test(part) ? "y" : null;
    if (!which) return null;
    const n = day[which];
    const choices = realChoices(spec.options);
    if (choices.length === 0) return which === "y" ? String(n) : String(n).padStart(2, "0");
    if (which === "m" && choices.length === 12) return choices[n - 1] ?? null;
    if (which === "d" && choices.length === 31) return choices[n - 1] ?? null;
    return choices.find((choice) => Number(choice.trim()) === n) ?? null;
  }
  function answerFor(key, spec, profile) {
    const get = (concept) => profile.facts[factId({ concept })];
    const own = profile.facts[factId(key)];
    if (key.concept === PHONE_CODE && !key.part && !key.entry) {
      for (const fact of [own, get(PHONE_WHOLE)]) {
        const code = typeof fact?.value === "string" ? dialCodeIn(fact.value) : null;
        const option = code ? optionForDialCode(spec, code) : null;
        if (fact && option) return { id: fact.id, fact, value: option, evidence: evidenceOf(fact) };
      }
    }
    if (own) return { id: own.id, fact: own, value: own.value, evidence: evidenceOf(own) };
    if (key.part && !key.entry && conceptById(key.concept)?.valueKind === "date") {
      const whole = get(key.concept);
      const day = typeof whole?.value === "string" ? calendarDay(whole.value) : null;
      const piece = whole && day ? datePiece(day, key.part, spec) : null;
      return whole && piece ? { id: whole.id, fact: whole, value: piece, evidence: evidenceOf(whole) } : null;
    }
    if (key.part || key.entry) return null;
    if (conceptById(key.concept)?.valueKind === "date") {
      const [d, m, y] = ["day", "month", "year"].map((part) => profile.facts[factId({ concept: key.concept, part })]);
      if (!d || !m || !y) return null;
      const month = String(m.value);
      const two = (n) => n.padStart(2, "0");
      const iso = /^\d{1,2}$/.test(month) ? `${y.value}-${two(month)}-${two(String(d.value))}` : null;
      const day = calendarDay(iso ?? `${d.value} ${month} ${y.value}`);
      if (!day) return null;
      const value = `${day.y}-${two(String(day.m))}-${two(String(day.d))}`;
      return { id: y.id, fact: y, value, evidence: [d, m, y].map(evidenceOf).join(" \u2014 "), why: "put_together" };
    }
    if (key.concept === "identity.first_name" || key.concept === "identity.last_name") {
      const full = get("identity.full_name");
      const words3 = typeof full?.value === "string" ? full.value.trim().split(/\s+/) : [];
      if (full && words3.length === 2) {
        return { id: full.id, fact: full, value: key.concept === "identity.first_name" ? words3[0] : words3[1], evidence: evidenceOf(full), why: "taken_apart" };
      }
    }
    if (key.concept === PHONE_NUMBER || key.concept === PHONE_CODE) {
      const whole = get(PHONE_WHOLE);
      if (!whole || typeof whole.value !== "string") return null;
      if (key.concept === PHONE_NUMBER) return { id: whole.id, fact: whole, value: withoutDialCode(whole.value), evidence: evidenceOf(whole) };
      const code = dialCodeOf(whole.value);
      const option = code ? optionForDialCode(spec, code) : null;
      return option ? { id: whole.id, fact: whole, value: option, evidence: evidenceOf(whole) } : null;
    }
    if (key.concept === PHONE_WHOLE) {
      const number = get(PHONE_NUMBER);
      if (!number || typeof number.value !== "string") return null;
      const code = get(PHONE_CODE);
      const dial = typeof code?.value === "string" ? dialCodeIn(code.value) : null;
      return {
        id: number.id,
        fact: number,
        value: dial ? `+${dial} ${number.value}` : number.value,
        evidence: code ? `${evidenceOf(code)} \u2014 ${evidenceOf(number)}` : evidenceOf(number),
        why: "put_together"
      };
    }
    if (key.concept === "identity.full_name") {
      const first = get("identity.first_name");
      const last = get("identity.last_name");
      if (!first || !last || typeof first.value !== "string" || typeof last.value !== "string") return null;
      return { id: factId({ concept: "identity.full_name" }), fact: first, value: `${first.value} ${last.value}`, evidence: `${evidenceOf(first)} \u2014 ${evidenceOf(last)}`, why: "put_together" };
    }
    for (const near of RELATED_CONCEPTS[key.concept] ?? []) {
      const fact = get(near);
      if (fact) return { id: fact.id, fact, value: fact.value, evidence: evidenceOf(fact), why: "not_sure_same_question" };
    }
    return null;
  }
  function reasonToAsk(meaning, fact, telling, fit, now) {
    if (fact.sensitive || meaning.scope === "sensitive") return "sensitive";
    if (meaning.source !== "model" || meaning.confidence !== "high") return "not_sure_same_question";
    if (telling.source === "typed") return "typed_last_time";
    if (telling.source === "migrated" || telling.source === "imported") return "carried_over";
    const concept = conceptById(fact.concept);
    if (concept?.volatility === "volatile" && now - fact.updatedAt > VOLATILE_DAYS * DAY_MS) return "from_a_while_ago";
    if (fit === "closest") return "closest_choice";
    return void 0;
  }
  var RECALL_WHY_WORDS = {
    sensitive: "a personal detail, so it's checked every time",
    typed_last_time: "they typed it last time rather than said it",
    not_sure_same_question: "this question may not be quite the same one",
    from_a_while_ago: "it was a while ago and may have changed",
    carried_over: "saved by an older version of Longtake",
    closest_choice: "the closest of this form's choices",
    put_together: "put together from pieces they gave on another form",
    taken_apart: "taken from their full name \u2014 which part is which is theirs to say"
  };
  function migrateV1(memory) {
    const changes = [];
    for (const answer of Object.values(memory)) {
      const concept = LEGACY_KEY_TO_CONCEPT[answer.key];
      if (!concept) continue;
      let host = "";
      try {
        host = new URL(answer.sourceUrl).host;
      } catch {
      }
      changes.push({
        type: "observe",
        key: { concept },
        gist: answer.askedAs,
        value: answer.value,
        allowSensitive: true,
        from: {
          value: answer.value,
          evidence: answer.evidence,
          source: "migrated",
          host,
          url: answer.sourceUrl,
          askedAs: answer.askedAs,
          formTitle: "",
          at: answer.savedAt
        }
      });
    }
    return changes;
  }
  function exportProfile(profile) {
    return JSON.stringify({ longtake: "profile", version: PROFILE_VERSION, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), facts: profile.facts, answers: profile.answers }, null, 2);
  }
  var isValue = (v) => typeof v === "string" || typeof v === "boolean" || Array.isArray(v) && v.every((x) => typeof x === "string");
  function parseProfile(text4) {
    let raw;
    try {
      raw = JSON.parse(text4);
    } catch {
      return null;
    }
    if (!raw || raw.longtake !== "profile" || raw.version !== PROFILE_VERSION) return null;
    const profile = emptyProfile();
    for (const item of Object.values(raw.facts ?? {})) {
      if (!item || typeof item.concept !== "string" || keepable(item.concept) === "no" || !isValue(item.value)) continue;
      const key = {
        concept: item.concept,
        ...typeof item.part === "string" && item.part ? { part: asPart(item.part) } : {},
        ...Number.isInteger(item.entry) && item.entry > 0 ? { entry: item.entry } : {}
      };
      const id = factId(key);
      const history = (Array.isArray(item.history) ? item.history : []).filter((h) => !!h && isValue(h.value) && typeof h.evidence === "string").map((h) => ({
        value: h.value,
        evidence: h.evidence.slice(0, 2e3),
        source: ["spoken", "confirmed", "typed", "edited", "migrated", "imported"].includes(h.source) ? h.source : "imported",
        host: String(h.host ?? "").slice(0, 200),
        url: String(h.url ?? "").slice(0, 500),
        askedAs: String(h.askedAs ?? "").slice(0, 300),
        formTitle: String(h.formTitle ?? "").slice(0, 200),
        at: Number(h.at) || 0
      })).slice(-HISTORY);
      const at = Number(item.updatedAt) || Date.now();
      profile.facts[id] = {
        id,
        ...key,
        gist: String(item.gist ?? "").slice(0, 120),
        value: item.value,
        history: history.length ? history : [{ value: item.value, evidence: "", source: "imported", host: "", url: "", askedAs: "", formTitle: "", at }],
        sensitive: keepable(item.concept) === "sensitive",
        createdAt: Number(item.createdAt) || at,
        updatedAt: at,
        useCount: Number(item.useCount) || 0
      };
    }
    for (const item of Object.values(raw.answers ?? {})) {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string") continue;
      profile.answers[item.id] = {
        id: item.id.slice(0, 120),
        gist: String(item.gist ?? "").slice(0, 120),
        question: String(item.question ?? "").slice(0, 300),
        text: item.text.slice(0, 1e4),
        said: Array.isArray(item.said) ? item.said.filter((s) => typeof s === "string").slice(0, 20) : [],
        host: String(item.host ?? "").slice(0, 200),
        at: Number(item.at) || 0,
        uses: Number(item.uses) || 0
      };
    }
    return profile;
  }
  var CATEGORY_NAMES = {
    identity: "About you",
    contact: "Contact",
    address: "Address",
    links: "Links",
    document: "Documents",
    education: "Education",
    employment: "Work history",
    work: "Work",
    eeo: "Equal-opportunity questions",
    health: "Health",
    text: "In your own words"
  };
  var ORDINALS = ["", "second", "third", "fourth", "fifth", "sixth"];
  function sayFact(fact) {
    const concept = conceptById(fact.concept);
    const base = concept?.say ?? fact.gist ?? fact.concept;
    const part = fact.part ? ` \u2014 ${fact.part.replace(/_/g, " ")}` : "";
    const entry = fact.entry ? ` (${ORDINALS[fact.entry] ?? `#${fact.entry + 1}`})` : "";
    return `${base}${part}${entry}`;
  }
  function groupFacts(profile) {
    const groups = /* @__PURE__ */ new Map();
    for (const fact of Object.values(profile.facts)) {
      const category = fact.concept.split(".")[0];
      groups.set(category, [...groups.get(category) ?? [], fact]);
    }
    const order = Object.keys(CATEGORY_NAMES);
    return [...groups.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(([category, facts]) => ({
      category,
      name: CATEGORY_NAMES[category] ?? category,
      facts: facts.sort((a, b) => a.id.localeCompare(b.id))
    }));
  }
  function knownFacts(profile) {
    return Object.values(profile.facts).sort((a, b) => b.updatedAt - a.updatedAt).map((fact) => {
      const telling = fact.history[fact.history.length - 1];
      return {
        id: fact.id,
        say: sayFact(fact),
        value: shownValue(fact.value),
        evidence: telling.evidence,
        source: telling.source,
        host: telling.host,
        at: telling.at,
        sensitive: fact.sensitive
      };
    });
  }

  // core/src/planner.ts
  var RECALLED_AT_ONCE = 4;
  var UPDATES_AT_ONCE = 3;
  var ASK_AT_ONCE = 4;
  function batch(facts) {
    const [first] = facts;
    if (!first) return [];
    if (alone(first)) return [first];
    const out = [];
    for (const f of facts) {
      if (out.length >= ASK_AT_ONCE || alone(f)) break;
      out.push(f);
    }
    return out;
  }
  function alone(facts) {
    return facts.answer_type === "long answer" || facts.choice_count !== void 0;
  }
  function nextMove(state, plan) {
    const specs = state.fields.map((f) => f.spec);
    const waiting = state.fields.find((f) => f.pending && f.pending.reason !== "from_last_time");
    if (waiting?.pending && waiting.pending.reason !== "from_last_time") {
      return {
        kind: "confirm",
        field: factsOf(waiting.spec, specs),
        suggestion: waiting.pending.suggestion,
        heard: waiting.pending.heard,
        reason: waiting.pending.reason
      };
    }
    const recalled = state.fields.filter((f) => f.pending?.reason === "from_last_time").slice(0, RECALLED_AT_ONCE);
    if (recalled.length > 0) {
      return {
        kind: "confirm_recalled",
        fields: recalled.map((f) => ({
          field: factsOf(f.spec, specs),
          suggestion: f.pending.suggestion,
          ...f.pending.why ? { why: f.pending.why } : {}
        }))
      };
    }
    const wrong = state.fields.find((f) => f.error && f.value !== null);
    if (wrong?.error) {
      return { kind: "resolve", field: factsOf(wrong.spec, specs), problem: wrong.error, value: shown(wrong.value) };
    }
    const updates = state.asks.filter((a) => a.ask.kind !== "sensitive").slice(0, UPDATES_AT_ONCE);
    if (updates.length > 0) {
      return {
        kind: "update_profile",
        asks: updates.map(({ spec, ask }) => ({
          field: spec.id,
          question: fieldName(spec),
          kind: ask.kind === "changed" ? "changed" : "forget",
          was: ask.kind === "sensitive" ? "" : shownValue(ask.was),
          ...ask.kind === "changed" ? { now: shownValue(ask.now) } : {}
        }))
      };
    }
    const open = state.fields.filter(isOpen);
    const later = new Set(open.filter((f) => f.later).map((f) => f.spec.id));
    const lastIfLater = (specs2) => [
      ...specs2.filter((spec) => !later.has(spec.id)),
      ...specs2.filter((spec) => later.has(spec.id))
    ];
    const marksNone = state.fields.every((f) => !f.spec.required);
    const toAsk = (f) => f.spec.required || marksNone;
    const required = lastIfLater(inAskingOrder(open.filter(toAsk).map((f) => f.spec)));
    if (required.length > 0) {
      const first = factsOf(required[0], specs);
      if (first.group) {
        const together = open.filter((f) => later.has(first.field) || !later.has(f.spec.id)).map((f) => factsOf(f.spec, specs)).filter((facts) => facts.group === first.group && facts.section === first.section);
        return { kind: "ask", fields: together };
      }
      return { kind: "ask", fields: batch(required.map((spec) => factsOf(spec, specs)).filter((f) => !f.group || f.field === first.field)) };
    }
    const optional = lastIfLater(inAskingOrder(open.filter((f) => !toAsk(f)).map((f) => f.spec))).map(
      (spec) => factsOf(spec, specs)
    );
    const next = state.actions.find((a) => a.kind === "next");
    const personal = state.asks.filter((a) => a.ask.kind === "sensitive");
    const keep = personal.length ? { keep: { fields: personal.map((a) => a.spec.id), questions: personal.map((a) => fieldName(a.spec)) } } : {};
    if (optional.length > 0) {
      if (!plan.optionalOffered) return { kind: "offer_optional", fields: optional };
      if (next) return { kind: "optional", fields: optional, next: next.label, ...keep };
      return state.submitLabel ? { kind: "optional", fields: optional, submit: state.submitLabel, ...keep } : { kind: "optional", fields: optional, ...keep };
    }
    if (next) return { kind: "next_page", label: next.label, ...keep };
    return state.submitLabel ? { kind: "handover", theirs: state.theirs, submit: state.submitLabel, ...keep } : { kind: "handover", theirs: state.theirs, ...keep };
  }
  var SOURCE_WORDS = {
    spoken: "they said it",
    memory: "from their last form",
    typed: "they typed it",
    page: "was already there",
    empty: ""
  };
  function shown(value) {
    const text4 = value === true ? "ticked" : Array.isArray(value) ? value.join(", ") : String(value);
    return text4.length > 48 ? `${text4.slice(0, 48)}\u2026` : text4;
  }
  function describe2(facts) {
    const where = facts.section ? ` (under "${facts.section}")` : "";
    if (facts.searchable) return `${facts.question}${where} \u2014 a searchable list; whatever they say is looked up, and if several match they'll be offered`;
    if (facts.range) return `${facts.question}${where} \u2014 a number from ${facts.range.min} to ${facts.range.max}`;
    if (facts.choices) return `${facts.question}${where} \u2014 choices: ${facts.choices.join(", ")}`;
    if (facts.choice_count) return `${facts.question}${where} \u2014 ${facts.choice_count} options; ask them to look at the list on screen`;
    if (facts.answer_type === "yes or no") return `${facts.question}${where} \u2014 yes or no`;
    if (facts.answer_type === "long answer") return `${facts.question}${where} \u2014 a longer answer`;
    return `${facts.question}${where}`;
  }
  function waitingCount(state) {
    const n = state.fields.filter((f) => f.pending).length;
    return n > 0 ? `, ${n} waiting for their yes` : "";
  }
  function askFor(fields) {
    const now = batch(fields);
    return now.length > 1 ? `these together, in one question: ${now.map(describe2).join("; ")}` : describe2(now[0]);
  }
  function keepFirst(keep) {
    if (!keep) return "";
    return `First, once: ask whether to remember their answers to ${keep.questions.join(", ")} for next time \u2014 they stay on this device \u2014 and call save_for_next_time for ${keep.fields.join(", ")} with agreed true or false. Then: `;
  }
  function doNext(move) {
    switch (move.kind) {
      case "confirm":
        return move.reason === "hedged" ? `They weren't sure for "${move.field.question}" (they said: "${move.heard}"). Ask which it is before anything goes in.` : `"${move.field.question}" is waiting for their yes: they said "${move.heard}", and the closest the form offers is "${move.suggestion}". Ask if that's right, then call confirm_answer for ${move.field.field} with agreed true or false \u2014 you judge their reply, in whatever words. If not, offer the other choices.`;
      case "confirm_recalled": {
        const list = move.fields.map((f) => `${f.field.question}: "${f.suggestion}"`).join("; ");
        return `From their last form, ready to go in on their yes: ${list}. Say them briefly and ask if they are still right. For each, call confirm_answer with agreed true if they accept it, in any words, or false if not; if they give a new answer, fill it with fill_fields instead.`;
      }
      case "update_profile": {
        const each = move.asks.map(
          (a) => a.kind === "changed" ? `"${a.question}" was "${a.was}" last time and is "${a.now}" now \u2014 keep the new one for next time?` : `they cleared "${a.question}", which came from last time \u2014 forget it for next time too?`
        ).join(" ");
        return `Before the next question, one thing about next time: ${each} Ask in a few words, then call save_for_next_time for ${move.asks.map((a) => a.field).join(", ")} with agreed true or false \u2014 you judge their reply.`;
      }
      case "resolve":
        return `The form won't accept "${move.value}" for "${move.field.question}" \u2014 it says: "${move.problem}". Tell them in a few words and ask for it again.`;
      case "ask": {
        if (move.fields.length > 1 && move.fields.every((f) => f.group === "address")) {
          const where = move.fields[0].section ? ` under "${move.fields[0].section}"` : "";
          return `Ask for their address${where} as one question \u2014 ${move.fields.map((f) => f.question).join(", ")}.`;
        }
        if (move.fields.length > 1 && move.fields.every((f) => f.group === "phone")) {
          return `Ask for their phone number, with its country code, as one question.`;
        }
        if (move.fields.length > 1) {
          return `Ask for these together in one short question \u2014 they can answer them all at once: ${move.fields.map(describe2).join("; ")}.`;
        }
        return `Ask for ${describe2(move.fields[0])}.`;
      }
      case "offer_optional":
        return `Every required field is in. Say so, and ask if they want to do the ${move.fields.length} optional ones or hear what they are: ${move.fields.map((f) => f.question).join("; ")}.`;
      case "optional":
        return keepFirst(move.keep) + (move.next ? `If they wanted the optional ones, ask for ${askFor(move.fields)}. If they didn't, ask if they're ready for the next page, and press "${move.next}" with press_form_button only on their yes.` : `If they wanted the optional ones, ask for ${askFor(move.fields)}. If they didn't, hand over: everything they told you is in, and they should ${move.submit ? `look it over and press "${move.submit}" themselves` : "look it over and send it themselves"}.`);
      case "next_page":
        return keepFirst(move.keep) + `Everything needed on this page is in. Ask if they're ready for the next page, and press "${move.label}" with press_form_button only on their yes.`;
      case "handover": {
        const send = move.submit ? `look it over and press "${move.submit}" themselves` : "look it over and send it themselves";
        return keepFirst(move.keep) + (move.theirs.length > 0 ? `Nothing left for you. Say everything they told you is in, that ${move.theirs.join(" and ")} is theirs to do by hand, and that they should ${send}.` : `Nothing left for you. Say everything they told you is in, and that they should ${send}.`);
      }
    }
  }
  function brief(state, move) {
    const { progress } = state;
    const specs = state.fields.map((f) => f.spec);
    const lines = [];
    lines.push(
      `FORM NOW${state.title ? ` \u2014 ${state.title}` : ""}: ${progress.filled} of ${progress.total} answered, ${progress.requiredLeft} required left, ${progress.optionalLeft} optional left${waitingCount(state)}.`
    );
    const answered = state.fields.filter((f) => f.value !== null);
    if (answered.length > 0) {
      lines.push("Answered:");
      for (const f of answered) {
        lines.push(`  ${factsOf(f.spec, specs).question}: ${shown(f.value)} (${SOURCE_WORDS[f.source]})`);
      }
    }
    const left = state.fields.filter((f) => isOpen(f) && !f.pending && !f.later);
    if (left.length > 0) {
      lines.push("Still empty:");
      for (const f of left) {
        lines.push(`  ${describe2(factsOf(f.spec, specs))}${f.spec.required ? " [required]" : ""}`);
      }
    }
    const putOff = state.fields.filter((f) => isOpen(f) && f.later);
    if (putOff.length > 0) {
      lines.push(
        `Set aside for later, at their request \u2014 ask again only once everything else is done: ${putOff.map((f) => factsOf(f.spec, specs).question).join(", ")}`
      );
    }
    const declined = state.fields.filter((f) => f.declined && f.value === null);
    if (declined.length > 0) {
      lines.push(`Left empty on purpose (do not ask again): ${declined.map((f) => factsOf(f.spec, specs).question).join(", ")}`);
    }
    const waiting = state.fields.filter((f) => f.pending);
    for (const f of waiting) {
      lines.push(
        f.pending.reason === "from_last_time" ? `Waiting for their yes: ${factsOf(f.spec, specs).question} \u2192 "${f.pending.suggestion}" (from their last form)` : `Waiting for their yes: ${factsOf(f.spec, specs).question} \u2192 "${f.pending.suggestion}" (they said "${f.pending.heard}")`
      );
    }
    const problems = state.fields.filter((f) => f.error && f.value !== null);
    for (const f of problems) {
      lines.push(`The form rejects: ${factsOf(f.spec, specs).question} = "${shown(f.value)}" \u2014 "${f.error}"`);
    }
    if (state.theirs.length > 0) lines.push(`Theirs to do by hand: ${state.theirs.join(", ")}`);
    if (state.actions.length > 0) {
      lines.push(`Buttons you can press when they ask: ${state.actions.map((a) => `"${a.label}"`).join(", ")}`);
    }
    if (state.submitLabel) lines.push(`"${state.submitLabel}" sends the form \u2014 only they press it, never you.`);
    lines.push("", `DO NEXT: ${doNext(move)}`);
    return lines.join("\n");
  }
  function resumeLine(state, move) {
    const { filled, total } = state.progress;
    const where = `Sorry, lost the line for a second. ${filled} of ${total} are in`;
    switch (move.kind) {
      case "confirm":
        return move.reason === "hedged" ? `${where}. For ${move.field.question}, which was it?` : `${where}. For ${move.field.question}, is ${move.suggestion} right?`;
      case "confirm_recalled":
        return `${where}. From last time I have ${move.fields.map((f) => f.field.question).join(", ")} \u2014 still right?`;
      case "update_profile": {
        const [first] = move.asks;
        return `${where}. Quick one for next time: ${first.kind === "changed" ? `keep the new ${first.question}?` : `forget ${first.question} for next time too?`}`;
      }
      case "resolve":
        return `${where}. The form won't take ${move.value} for ${move.field.question} \u2014 can you say it again?`;
      case "ask": {
        const [first] = move.fields;
        const what = move.fields.length > 1 && first?.group === "address" ? "your address" : move.fields.length > 1 && first?.group === "phone" ? "your phone number" : move.fields.length > 1 ? move.fields.map((f) => f.question).join(", ") : first?.question ?? "the next one";
        return `${where}. Next up: ${what}.`;
      }
      case "offer_optional":
        return `${where} \u2014 all the required ones. Want to do the ${move.fields.length} optional ones too?`;
      case "optional":
        return `${where}. Shall we carry on with the optional ones?`;
      case "next_page":
        return `${where} \u2014 this page is done. Ready for the next one?`;
      case "handover":
        return `${where} \u2014 that's everything. Have a look and ${move.submit ? `press ${move.submit}` : "send it"} yourself.`;
    }
  }

  // core/src/actions.ts
  var BUTTONS = "button, input[type='submit'], input[type='button'], [role='button'], a[role='button']";
  var SUBMIT = /\b(submit|apply|send|finish|complete|pay|payment|checkout|place order|purchase|confirm|sign up|register|done)\b/i;
  var NEXT = /^\s*(next|continue|save (and|&) continue|save & next|proceed|next (page|step|section))\b/i;
  var ADD_ANOTHER = /(^\s*\+\s*add\b)|\b(add (another|more|one more|a new)|add (an? )?(education|experience|job|position|school|degree|reference|link|entry|employer|language|certification|project))/i;
  function wordsOf(el) {
    const own = el.tagName.toLowerCase() === "input" ? el.value : el.innerText ?? el.textContent ?? "";
    return (own || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  }
  function classify(words3) {
    if (!words3) return null;
    if (SUBMIT.test(words3)) return "submit";
    if (NEXT.test(words3)) return "next";
    if (ADD_ANOTHER.test(words3)) return "add-another";
    return null;
  }
  function slug2(raw) {
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  }
  function readActions(root, ignore = "[data-longtake-ignore]") {
    const actions = [];
    const handles = /* @__PURE__ */ new Map();
    let submitLabel;
    for (const node of deepQueryAll(root, BUTTONS)) {
      const el = node;
      if (ignore && el.closest(ignore)) continue;
      if (el.disabled && classify(wordsOf(el)) !== "submit") continue;
      if (!isVisible(el)) continue;
      const words3 = wordsOf(el);
      const kind = classify(words3);
      if (kind === "submit") {
        if (submitLabel === void 0) submitLabel = words3;
        continue;
      }
      if (!kind) continue;
      let id = slug2(`${kind === "next" ? "next" : "add"} ${words3}`) || kind;
      for (let n = 2; handles.has(id); n++) id = `${slug2(`${kind} ${words3}`)}_${n}`;
      actions.push({ id, kind, label: words3 });
      handles.set(id, el);
    }
    return { actions, handles, ...submitLabel ? { submitLabel } : {} };
  }
  function pressAction(el) {
    if (!el.isConnected) return { pressed: false, reason: "That button is no longer on the page." };
    const kind = classify(wordsOf(el));
    if (kind === "submit") return { pressed: false, reason: "That button submits the form. Only the person presses that." };
    if (!kind) return { pressed: false, reason: "That button is not one Longtake presses." };
    el.scrollIntoView({ block: "nearest" });
    el.click();
    return { pressed: true };
  }

  // core/src/profile-store.ts
  function memoryProfileStore(initial = emptyProfile()) {
    let profile = initial;
    const listeners = /* @__PURE__ */ new Set();
    const cache = /* @__PURE__ */ new Map();
    return {
      current: () => profile,
      load: async () => profile,
      apply: async (changes) => {
        const applied = applyChanges(profile, changes);
        if (applied.changed) {
          profile = applied.profile;
          for (const listener of listeners) listener(profile);
        }
        return applied;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      meanings: {
        get: async (key) => cache.get(key) ?? null,
        put: async (key, meanings) => void cache.set(key, meanings)
      }
    };
  }

  // core/src/understand.ts
  var FIRST_CHOICES = 12;
  function snapshotOf(specs, page) {
    return {
      host: page.host,
      title: page.title.slice(0, 120),
      fields: specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => ({
        id: spec.id,
        question: fieldName(spec).slice(0, 240),
        kind: spec.kind,
        required: spec.required,
        ...spec.section ? { section: spec.section.slice(0, 120) } : {},
        ...spec.description ? { description: spec.description.slice(0, 160) } : {},
        ...spec.placeholder ? { placeholder: spec.placeholder.slice(0, 60) } : {},
        ...spec.options?.length ? { options: spec.options.slice(0, FIRST_CHOICES).map((o) => o.label) } : {}
      }))
    };
  }
  async function structureKey(snapshot2) {
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot2.fields));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return `${snapshot2.host}#${hex.slice(0, 24)}`;
  }
  var SUBJECTS = ["self", "other_person", "organization", "none"];
  var CONFIDENCES = ["high", "medium", "low"];
  var KEEPS = { remember: 3, sensitive: 2, this_form: 1, never: 0 };
  function narrower(a, b) {
    return KEEPS[a] <= KEEPS[b] ? a : b;
  }
  var text3 = (value, cap) => typeof value === "string" ? value.trim().slice(0, cap) : "";
  function validateMeanings(raw, specs) {
    const ids = new Set(specs.map((spec) => spec.id));
    const list = raw && typeof raw === "object" && Array.isArray(raw.fields) ? raw.fields : [];
    const meanings = {};
    for (const item of list) {
      const id = text3(item?.id, 120);
      if (!ids.has(id) || meanings[id]) continue;
      const concept = conceptById(text3(item.concept, 80))?.id ?? "other";
      const defaults = conceptById(concept);
      const subject = concept.startsWith("organization.") ? "organization" : SUBJECTS.includes(item.subject) ? item.subject : "self";
      const scope = subject === "self" ? defaults.scope : narrower(defaults.scope, "this_form");
      const confidence = CONFIDENCES.includes(item.confidence) ? item.confidence : "low";
      const part = text3(item.part, 40);
      const entry = item.entry;
      meanings[id] = {
        concept,
        subject,
        scope,
        ...part ? { part } : {},
        ...entry && typeof entry.set === "string" && Number.isInteger(entry.index) ? { entry: { set: entry.set, index: entry.index } } : {},
        gist: text3(item.gist, 80),
        confidence,
        source: "model"
      };
    }
    phoneStructure(meanings, specs);
    const partOf = new Map(specs.map((spec) => [spec.id, spec.part ?? ""]));
    const theirs = /* @__PURE__ */ new Map();
    for (const [id, meaning] of Object.entries(meanings)) {
      if (meaning.subject !== "self" || meaning.concept === "other" || conceptById(meaning.concept)?.repeatable) continue;
      const key = `${meaning.concept}|${partOf.get(id) || meaning.part || ""}`;
      theirs.set(key, [...theirs.get(key) ?? [], id]);
    }
    for (const ids2 of theirs.values()) {
      if (ids2.length < 2) continue;
      for (const id of ids2) if (meanings[id].confidence === "high") meanings[id].confidence = "medium";
    }
    return meanings;
  }
  function phoneStructure(meanings, specs) {
    const pairs = phoneFields(specs);
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    for (const [id, partner] of pairs) {
      const meaning = meanings[id];
      const spec = byId.get(id);
      if (!meaning || !spec) continue;
      const isBox = spec.kind === "tel";
      if (isBox && meaning.concept !== PHONE_WHOLE) continue;
      const box = isBox ? meaning : meanings[partner];
      const concept = isBox ? PHONE_NUMBER : PHONE_CODE;
      const subject = box?.subject ?? meaning.subject;
      const defaults = conceptById(concept);
      meanings[id] = {
        ...meaning,
        concept,
        subject,
        scope: subject === "self" ? defaults.scope : narrower(defaults.scope, "this_form"),
        ...!isBox && box ? { confidence: box.confidence } : {}
      };
    }
  }
  function applyMeaningHints(specs, meanings) {
    let changed = false;
    for (const spec of specs) {
      const meaning = meanings[spec.id];
      if (!meaning || meaning.source !== "model") continue;
      const understood = { concept: meaning.concept, subject: meaning.subject, confidence: meaning.confidence };
      if (JSON.stringify(spec.understood) !== JSON.stringify(understood)) {
        spec.understood = understood;
        changed = true;
      }
      const date = conceptById(meaning.concept)?.valueKind === "date";
      if (date && spec.kind === "text" && !spec.part && meaning.confidence !== "low") {
        spec.kind = "date";
        changed = true;
      }
    }
    return changed;
  }
  function fallbackMeanings(specs) {
    const meanings = {};
    for (const spec of specs) {
      if (spec.suspectedHoneypot || spec.kind === "file") continue;
      const key = canonicalKey(spec);
      const concept = key && LEGACY_KEY_TO_CONCEPT[key] || "other";
      const defaults = conceptById(concept);
      meanings[spec.id] = {
        concept,
        subject: "self",
        scope: defaults.scope,
        gist: fieldName(spec).slice(0, 80),
        confidence: "low",
        source: "fallback"
      };
    }
    phoneStructure(meanings, specs);
    return meanings;
  }

  // core/src/session.ts
  var CHOICE_KINDS2 = /* @__PURE__ */ new Set(["select", "radio", "multiselect", "checkbox"]);
  var UNDERSTAND_WAIT_MS = 4e3;
  var LongtakeSession = class {
    constructor(options) {
      this.options = options;
      this.ledger = new Ledger();
      this.registry = new FieldRegistry();
      this.current = null;
      this.profile = emptyProfile();
      /** What each field means: the offline reading until the model's arrives, then the model's. */
      this.meanings = {};
      this.understanding = null;
      /** Answers given before the model said what their fields mean — learned once it has. */
      this.unlearned = [];
      this.recalled = false;
      /** This call, for the profile's history: a correction within one call replaces, it does not ask. */
      this.call = Math.random().toString(36).slice(2, 10);
      this.plan = { optionalOffered: false };
      this.title = "";
      this.chain = Promise.resolve();
      this.prefilled = Promise.resolve();
      this.writing = false;
      this.movedWhileWriting = false;
      this.store = options.profile ?? memoryProfileStore();
    }
    // ── Reading ──────────────────────────────────────────────────────────────────────
    get read() {
      return this.current;
    }
    /** The form as it is right now. The only answer to "what is filled" anywhere in the product. */
    state() {
      if (!this.current) {
        return { title: "", fields: [], theirs: [], actions: [], asks: [], progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 } };
      }
      return snapshot(this.current, this.ledger, this.title, this.buttons());
    }
    /** What to do next. Offering the optional fields is a one-time move, so it is recorded. */
    move() {
      const move = nextMove(this.state(), this.plan);
      if (move.kind === "offer_optional") this.plan.optionalOffered = true;
      return move;
    }
    /** The agent's whole prompt: who it is, the form as it is, and what to do next. */
    prompt() {
      return systemPrompt(brief(this.state(), this.move()));
    }
    tools() {
      const specs = this.current?.specs ?? [];
      const press2 = this.current ? buildPressTool(this.buttons().actions) : null;
      const always = [buildFillTool(specs), buildConfirmTool(specs), buildClearTool(specs), buildLaterTool(specs), buildSaveTool(specs)];
      return press2 ? [...always, press2] : always;
    }
    /**
     * The `confirm_answer` tool: their reply to "is that right?", as the agent understood it.
     *
     * Agreed: the answer that was waiting goes in, through the same write, record and re-read as a
     * fill — its evidence is their original words plus their yes. Not agreed: it stops waiting, and
     * the plan goes back to asking the question.
     */
    async confirm(args, heard) {
      const read = this.current;
      if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
      const id = typeof args.field === "string" ? args.field : "";
      const agreed = args.agreed === true;
      const evidence = typeof args.evidence === "string" ? args.evidence : "";
      const spec = read.specs.find((s) => s.id === id);
      const pending = this.ledger.pendingFor(id);
      if (!spec || !pending) {
        return { result: { error: `Nothing is waiting for a yes on "${id}".`, do_next: doNext(this.move()), submitted: false }, outcomes: [], spoken: [] };
      }
      if (!checkEvidence(heard, evidence).ok) {
        return { result: { confirmed: false, why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
      }
      const question = fieldName(spec);
      if (!agreed) {
        this.ledger.release(id);
        const state = this.state();
        this.options.onChange?.();
        return {
          result: { not_confirmed: { field: id, question }, progress: state.progress, do_next: doNext(this.move()), submitted: false },
          outcomes: [],
          spoken: []
        };
      }
      const recalled = pending.reason === "from_last_time";
      const claim = { fieldId: id, value: pending.value ?? pending.suggestion, evidence: `${pending.heard} \u2014 ${evidence}` };
      this.writing = true;
      this.movedWhileWriting = false;
      let results;
      try {
        results = await writeValues(read.specs, read.handles, [claim]);
      } finally {
        this.writing = false;
      }
      await this.record(results, [claim], read, recalled ? "memory" : "spoken", recalled && pending.factId ? { [id]: pending.factId } : {});
      if (recalled) await this.learn([{ ...claim, value: pending.value ?? pending.suggestion }], read, "confirmed");
      const reshaped = results[0]?.status === "written" && CHOICE_KINDS2.has(spec.kind) || this.movedWhileWriting ? await this.pageChanged() : null;
      const result = this.report(results, [claim], reshaped, { waiting_for_yes: [] });
      this.options.onChange?.();
      return { result, outcomes: results, spoken: [claim] };
    }
    /**
     * The `skip_for_now` tool: "leave that, we'll do it at the end". Needs their words, like
     * everything else; changes nothing on the page — only the order things are asked in.
     */
    setAside(args, heard) {
      const read = this.current;
      if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
      const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
      const evidence = typeof args.evidence === "string" ? args.evidence : "";
      if (!checkEvidence(heard, evidence).ok) {
        return { result: { set_aside: [], why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
      }
      const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
      const moved = fields.filter((id) => byId.has(id));
      for (const id of moved) this.ledger.setAside(id);
      const state = this.state();
      const result = {
        set_aside: moved.map((id) => {
          const spec = byId.get(id);
          return spec ? fieldName(spec) : id;
        }),
        progress: state.progress,
        do_next: doNext(this.move()),
        submitted: false
      };
      this.options.onChange?.();
      return { result, outcomes: [], spoken: [] };
    }
    /** The form's buttons as they are right now — read fresh, since a page can rename them. */
    buttons() {
      return readActions(this.scope(), this.options.ignore);
    }
    /**
     * The `press_form_button` tool: "Add another", or "Next" — never a submit button.
     *
     * Needs the person's words like everything else. After a Next the form is a new page: the
     * optional offer is owed again, and the agent gets new tools and a new brief straight away.
     */
    async press(args, heard) {
      const id = typeof args.action === "string" ? args.action : "";
      const evidence = typeof args.evidence === "string" ? args.evidence : "";
      if (!checkEvidence(heard, evidence).ok) {
        return { result: { not_pressed: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
      }
      const buttons = this.buttons();
      const action = buttons.actions.find((a) => a.id === id);
      const el = buttons.handles.get(id);
      if (!action || !el) {
        return { result: { not_pressed: "That button is not on the page.", submitted: false }, outcomes: [], spoken: [] };
      }
      this.writing = true;
      let pressed;
      try {
        pressed = await exclusively(async () => pressAction(el));
      } finally {
        this.writing = false;
      }
      if (!pressed.pressed) {
        return { result: { not_pressed: pressed.reason, submitted: false }, outcomes: [], spoken: [] };
      }
      const reshaped = await this.pageChanged();
      this.options.onReshape?.();
      const stayed = action.kind === "next" && !reshaped;
      if (action.kind === "next" && !stayed) this.plan = { optionalOffered: false };
      const state = this.state();
      const says = state.fields.filter((f) => f.error).map((f) => ({ question: fieldName(f.spec), form_says: f.error }));
      const result = {
        pressed: action.label,
        ...stayed ? { page_did_not_change: true, ...says.length ? { the_form_says: says } : {} } : {},
        ...reshaped ? { form_changed: this.changeFacts(reshaped) } : {},
        progress: state.progress,
        do_next: doNext(this.move()),
        submitted: false
      };
      this.options.onChange?.();
      return { result, outcomes: [], spoken: [] };
    }
    /** Problems with the tools, checked before they are ever sent — the API accepts bad ones silently. */
    toolProblems() {
      return this.tools().flatMap((tool) => validateTool(tool));
    }
    /** The first thing the agent says, built from the form as it is — remembered answers included. */
    greeting() {
      const state = this.state();
      return openingLine(
        state.fields.map((f) => f.spec),
        this.title,
        {
          filled: state.fields.filter((f) => f.value !== null).map((f) => f.spec.id),
          remembered: state.fields.some((f) => f.source === "memory"),
          toConfirm: state.fields.filter((f) => f.pending?.reason === "from_last_time").map((f) => fieldName(f.spec))
        }
      );
    }
    /** The first words of a new session after the line dropped — where things stand, then the next ask. */
    resumeGreeting() {
      return resumeLine(this.state(), this.move());
    }
    /** Everything known about the person, newest first — for a surface to show and let them change. */
    known() {
      return knownFacts(this.profile);
    }
    /** The profile changed somewhere else — a settings page, another tab. */
    profileChanged(profile) {
      this.profile = profile;
      this.options.onChange?.();
    }
    // ── Opening ──────────────────────────────────────────────────────────────────────
    scope() {
      return this.options.root();
    }
    readNow() {
      const scope = this.scope();
      const url = ("ownerDocument" in scope && scope.ownerDocument ? scope.ownerDocument : scope).location?.href ?? "";
      return readForm(scope, url, this.options.ignore);
    }
    /**
     * Bring back answers from an earlier form, before anybody speaks.
     *
     * Runs at page load. Every value carries the words originally used, so the writer applies its
     * usual rules — memory gets no special permission.
     */
    prefill() {
      this.prefilled = (async () => {
        this.profile = await this.store.load().catch(() => emptyProfile());
        if (Object.keys(this.profile.facts).length === 0) return 0;
        await waitForForm();
        const read = await harvestOptions(this.registry.adopt(this.readNow()).read);
        this.current = read;
        applyMeaningHints(read.specs, this.meanings);
        this.title = titleOf(read, this.scope());
        const understood = this.understandForm(read);
        await Promise.race([understood, new Promise((done) => setTimeout(done, UNDERSTAND_WAIT_MS))]);
        return this.recall(read);
      })();
      return this.prefilled;
    }
    /**
     * Answers from last time, for fields still empty and untouched: the sure ones go in, the rest wait
     * for a yes with their reason. Runs at open, and again when the form's meanings arrive late.
     */
    async recall(read) {
      this.recalled = true;
      const state = this.state();
      const free = new Set(
        state.fields.filter((f) => f.value === null && (!f.pending || f.pending.reason === "from_last_time") && !f.declined && !this.ledger.entry(f.spec.id)).map((f) => f.spec.id)
      );
      const found = recallFor(read.specs, this.meanings, this.profile).filter((r) => free.has(r.fieldId));
      if (found.length === 0) return 0;
      const sure = found.filter((r) => r.sure);
      const values = sure.map((r) => ({ fieldId: r.fieldId, value: r.value, evidence: r.evidence }));
      this.writing = true;
      let results = [];
      try {
        results = values.length > 0 ? await writeValues(read.specs, read.handles, values) : [];
      } finally {
        this.writing = false;
      }
      await this.record(results, values, read, "memory", Object.fromEntries(sure.map((r) => [r.fieldId, r.factId])));
      const wentIn = results.filter((r) => r.status === "written").map((r) => r.fieldId);
      if (wentIn.length > 0) {
        const ids = sure.filter((r) => wentIn.includes(r.fieldId)).map((r) => r.factId);
        void this.store.apply([{ type: "used", ids }]).catch(() => void 0);
      }
      const refused = new Set(results.filter((r) => r.status !== "written").map((r) => r.fieldId));
      for (const r of found.filter((r2) => !r2.sure || refused.has(r2.fieldId))) {
        this.ledger.hold(r.fieldId, {
          reason: "from_last_time",
          suggestion: shownValue(r.value),
          value: r.value,
          heard: r.evidence,
          factId: r.factId,
          why: RECALL_WHY_WORDS[r.why ?? "closest_choice"]
        });
      }
      this.options.log?.(`from last time: ${wentIn.length} in, ${found.length - wentIn.length} waiting for a yes`);
      this.options.onChange?.();
      return wentIn.length;
    }
    // ── What the form means ──────────────────────────────────────────────────────────
    /**
     * Ask what each field means — once per form structure, and cached on the device. A field already
     * understood keeps its meaning; a field the form grew gets its own. A late answer upgrades the
     * call: answers from last time go in, and what was said before it arrived is learned.
     */
    understandForm(read) {
      for (const [id, meaning] of Object.entries(fallbackMeanings(read.specs))) {
        if (!this.meanings[id]) this.meanings[id] = meaning;
      }
      const ask = this.options.understand;
      if (!ask) return Promise.resolve();
      const run = async () => {
        const unknown = read.specs.filter((spec) => this.meanings[spec.id]?.source !== "model");
        if (unknown.length === 0) return;
        const scope = this.scope();
        const doc = "ownerDocument" in scope && scope.ownerDocument ? scope.ownerDocument : scope;
        const snapshot2 = snapshotOf(read.specs, { host: doc.location?.host ?? "", title: this.title });
        if (snapshot2.fields.length === 0) return;
        const key = await structureKey(snapshot2).catch(() => null);
        let meanings = key ? await this.store.meanings?.get(key).catch(() => null) : null;
        if (!meanings) {
          meanings = validateMeanings(await ask(snapshot2), read.specs);
          if (key && Object.keys(meanings).length > 0) await this.store.meanings?.put(key, meanings).catch(() => void 0);
        }
        await this.adopt(meanings);
      };
      const next = (this.understanding ?? Promise.resolve()).then(run).catch((cause) => {
        this.options.log?.(`could not understand the form: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
      this.understanding = next;
      return next;
    }
    async adopt(meanings) {
      const present = new Set(this.current?.specs.map((spec) => spec.id));
      let fresh = 0;
      for (const [id, meaning] of Object.entries(meanings)) {
        if (!present.has(id) || this.meanings[id]?.source === "model") continue;
        this.meanings[id] = meaning;
        fresh++;
      }
      if (fresh === 0 || !this.current) return;
      this.options.log?.(`understood ${fresh} field(s)`);
      if (applyMeaningHints(this.current.specs, this.meanings)) this.options.onReshape?.();
      const waiting = this.unlearned;
      this.unlearned = [];
      for (const how of ["spoken", "confirmed"]) {
        const values = waiting.filter((w) => w.how === how).map((w) => w.value);
        if (values.length > 0) await this.learn(values, this.current, how);
      }
      if (this.recalled && Object.keys(this.profile.facts).length > 0) {
        const wentIn = await this.recall(this.current);
        if (wentIn > 0 || this.state().fields.some((f) => f.pending?.reason === "from_last_time")) this.options.onPromptStale?.();
      }
    }
    /** Read the form, completely, before the conversation starts. */
    async open() {
      await Promise.race([this.prefilled, new Promise((done) => setTimeout(done, 15e3))]);
      await waitForForm();
      const read = await harvestOptions(this.registry.adopt(this.readNow()).read);
      this.current = read;
      applyMeaningHints(read.specs, this.meanings);
      this.title = titleOf(read, this.scope());
      this.plan = { optionalOffered: false };
      void this.understandForm(read);
      this.ledger.markAtOpen(
        this.state().fields.filter((f) => f.value !== null && !this.ledger.entry(f.spec.id)).map((f) => f.spec.id)
      );
      this.options.log?.(`read ${read.specs.length} fields, ${read.skipped.length} skipped`);
      this.options.onChange?.();
    }
    // ── Filling ──────────────────────────────────────────────────────────────────────
    /** Write down what went in, for the ledger — and learn what was said, for next time. */
    async record(results, values, read, source, facts = {}, wholePhones = /* @__PURE__ */ new Map()) {
      const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
      const said2 = [];
      for (const result of results) {
        if (result.status !== "written") continue;
        const spec = byId.get(result.fieldId);
        const claim = values.find((v) => v.fieldId === result.fieldId);
        if (!spec || !claim) continue;
        this.ledger.wrote(result.fieldId, {
          source,
          value: result.wrote,
          evidence: claim.evidence,
          spec,
          ...facts[result.fieldId] ? { factId: facts[result.fieldId] } : {}
        });
        const whole = wholePhones.get(result.fieldId);
        said2.push(whole ? { ...claim, value: whole } : claim);
      }
      if (source === "spoken" && said2.length > 0) await this.learn(said2, read, "spoken");
    }
    /** Where an answer was given, for its history. */
    provenance(value, read, how) {
      const spec = read.specs.find((s) => s.id === value.fieldId);
      let host = "";
      try {
        host = new URL(read.url).host;
      } catch {
      }
      return {
        value: value.value,
        evidence: value.evidence,
        source: how,
        host,
        url: read.url,
        askedAs: spec ? fieldName(spec).slice(0, 300) : value.fieldId,
        formTitle: this.title.slice(0, 200),
        at: Date.now(),
        session: this.call,
        field: value.fieldId
      };
    }
    /**
     * Keep what they said for next time — only their own answers, to questions that are asked the
     * same way everywhere, on a meaning the model named with at least some confidence. Something
     * already known, said differently, is not overwritten: it becomes a question for them. A
     * personal answer is kept only if they say so, asked once at the end.
     */
    async learn(values, read, how) {
      const keys = factKeys(read.specs, this.meanings);
      const changes = [];
      const personal = [];
      for (const value of values) {
        const meaning = this.meanings[value.fieldId];
        if (!meaning || meaning.source !== "model") {
          if (how !== "typed" && this.options.understand) this.unlearned.push({ value, how });
          continue;
        }
        let key = keys.get(value.fieldId);
        if (key?.concept === PHONE_NUMBER && typeof value.value === "string" && dialCodeOf(value.value)) key = { concept: PHONE_WHOLE };
        const concept = key ? conceptById(key.concept) : void 0;
        if (!key || !concept || meaning.confidence === "low") continue;
        if (concept.scope !== "remember" && concept.scope !== "sensitive") continue;
        const change = {
          type: "observe",
          key,
          gist: meaning.gist || concept.say,
          value: value.value,
          from: this.provenance(value, read, how)
        };
        if (concept.scope === "sensitive" && !this.profile.settings.rememberSensitive) {
          personal.push({ id: value.fieldId, change });
          continue;
        }
        changes.push(change);
      }
      if (how !== "typed") {
        for (const { id, change } of personal) {
          this.ledger.ask(id, { kind: "sensitive", key: change.key, gist: change.gist, value: change.value, from: change.from });
        }
      }
      if (changes.length === 0) return;
      try {
        const applied = await this.store.apply(changes);
        this.profile = applied.profile;
        const asked = /* @__PURE__ */ new Set();
        for (const question of applied.questions) {
          const field = question.from.field;
          if (!field || how === "typed") continue;
          asked.add(field);
          this.ledger.ask(field, { kind: "changed", factId: question.id, key: question.key, gist: question.gist, was: question.was, now: question.now, from: question.from });
        }
        for (const change of changes) {
          const field = change.type === "observe" ? change.from.field : void 0;
          if (field && !asked.has(field) && this.ledger.askFor(field)?.kind === "changed") this.ledger.settle(field);
        }
      } catch (cause) {
        this.options.log?.(`could not keep answers for next time: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    /** The `fill_fields` tool. `heard` is everything the person has said so far, turn in progress included. */
    async fill(args, heard) {
      const read = this.current;
      if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
      const claimed = [];
      for (const [fieldId, raw] of Object.entries(args)) {
        if (!raw || typeof raw !== "object") continue;
        const { value, evidence } = raw;
        if (value === void 0 || value === null) continue;
        claimed.push({ fieldId, value, evidence: typeof evidence === "string" ? evidence : "" });
      }
      const { spoken, unsupported } = keepOnlyWhatWasSaid(heard, claimed);
      const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
      const phones = this.splitPhones(spoken, read.specs);
      const toWrite = [...phones.extra];
      const held = [];
      for (const claim of spoken) {
        const spec = byId.get(claim.fieldId);
        const verdict = spec ? gate(spec, claim, this.ledger.pendingFor(claim.fieldId)) : { write: true };
        if (verdict.write) {
          toWrite.push(claim);
        } else {
          this.ledger.hold(claim.fieldId, verdict.pending);
          held.push({
            field: claim.fieldId,
            question: spec ? fieldName(spec) : claim.fieldId,
            suggestion: verdict.pending.suggestion,
            they_said: verdict.pending.heard
          });
        }
      }
      this.writing = true;
      this.movedWhileWriting = false;
      let results;
      try {
        results = await writeValues(read.specs, read.handles, toWrite);
      } finally {
        this.writing = false;
      }
      await this.record(results, toWrite, read, "spoken", {}, phones.whole);
      const invented = unsupported.map((item) => ({
        fieldId: item.fieldId,
        status: "refused",
        reason: item.reason
      }));
      const picked = results.some((r) => r.status === "written" && CHOICE_KINDS2.has(byId.get(r.fieldId)?.kind ?? ""));
      const reshaped = picked || this.movedWhileWriting ? await this.pageChanged() : null;
      const outcomes = [...results, ...invented];
      const result = this.report(outcomes, claimed, reshaped, { waiting_for_yes: held });
      this.options.onChange?.();
      return { result, outcomes, spoken: toWrite };
    }
    /**
     * "+91 98765 43210" on a form that splits the country code into its own picker.
     *
     * The code goes into the picker — they said it, in those words — and the number box gets the
     * number without it, because a box next to a code picker will not take a second code. Only when
     * the code names exactly one option: "+1" is the United States AND Canada, and picking one of them
     * would be a guess, so that picker is left to be asked about.
     *
     * Mutates the claims it is given (strips the code from the number); returns the extra claims.
     */
    splitPhones(spoken, specs) {
      const pairs = phoneFields(specs);
      const byId = new Map(specs.map((spec) => [spec.id, spec]));
      const extra = [];
      const whole = /* @__PURE__ */ new Map();
      for (const claim of spoken) {
        const codeId = pairs.get(claim.fieldId);
        if (byId.get(claim.fieldId)?.kind !== "tel" || !codeId) continue;
        if (spoken.some((c2) => c2.fieldId === codeId)) continue;
        const value = String(claim.value);
        const code = dialCodeOf(value) ?? /\+\s*(\d{1,4})\b/.exec(claim.evidence)?.[1];
        if (!code) continue;
        claim.value = withoutDialCode(value);
        whole.set(claim.fieldId, `+${code} ${claim.value}`);
        const option = optionForDialCode(byId.get(codeId), code);
        if (option) extra.push({ fieldId: codeId, value: option, evidence: claim.evidence });
      }
      return { extra, whole };
    }
    /** The `clear_fields` tool. */
    async clear(args, heard) {
      const read = this.current;
      if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
      const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
      const evidence = typeof args.evidence === "string" ? args.evidence : "";
      const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
      const question = (id) => {
        const spec = byId.get(id);
        return spec ? fieldName(spec) : id;
      };
      if (!checkEvidence(heard, evidence).ok) {
        return {
          result: { cleared: [], not_cleared: fields.map((id) => ({ field: id, question: question(id), why: "quote_not_found" })), submitted: false },
          outcomes: [],
          spoken: []
        };
      }
      this.writing = true;
      this.movedWhileWriting = false;
      let results;
      try {
        results = await clearValues(read.specs, read.handles, fields);
      } finally {
        this.writing = false;
      }
      const cleared = results.filter((r) => r.status === "cleared").map((r) => r.fieldId);
      const keys = factKeys(read.specs, this.meanings);
      const undo = [];
      const fromLastTime = [];
      for (const id of cleared) {
        const entry = this.ledger.entry(id);
        this.ledger.decline(id);
        if (this.ledger.askFor(id)?.kind !== "forget") this.ledger.settle(id);
        if (entry?.source === "memory" && entry.factId) {
          this.ledger.ask(id, { kind: "forget", factId: entry.factId, was: this.profile.facts[entry.factId]?.value ?? entry.value });
          fromLastTime.push({ field: id, question: question(id) });
        } else if (entry?.source === "spoken") {
          const key = keys.get(id);
          if (key) undo.push({ type: "unobserve", id: factId(key), session: this.call, field: id });
        }
      }
      if (undo.length > 0) {
        await this.store.apply(undo).then((applied) => void (this.profile = applied.profile)).catch(() => void 0);
      }
      const reshaped = cleared.some((id) => CHOICE_KINDS2.has(byId.get(id)?.kind ?? "")) || this.movedWhileWriting ? await this.pageChanged() : null;
      const state = this.state();
      const move = this.move();
      const result = {
        cleared: cleared.map((id) => ({ field: id, question: question(id) })),
        not_cleared: results.filter((r) => r.status === "cannot-clear").map((r) => ({ field: r.fieldId, question: question(r.fieldId), why: r.reason })),
        ...fromLastTime.length > 0 ? { was_from_last_time: fromLastTime } : {},
        progress: state.progress,
        ...reshaped ? { form_changed: this.changeFacts(reshaped) } : {},
        do_next: doNext(move),
        submitted: false
      };
      this.options.onChange?.();
      return { result, outcomes: [], spoken: [] };
    }
    /**
     * The `save_for_next_time` tool: their reply to a question about next time. A yes keeps the new
     * answer, forgets the cleared one, or remembers the personal one; a no leaves what was saved as
     * it was. Needs their words, like everything else. Nothing on the page changes.
     */
    async saveForNextTime(args, heard) {
      const read = this.current;
      if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
      const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
      const agreed = args.agreed === true;
      const evidence = typeof args.evidence === "string" ? args.evidence : "";
      if (!checkEvidence(heard, evidence).ok) {
        return { result: { saved: [], why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
      }
      const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
      const changes = [];
      const settled = [];
      const nothingAsked = [];
      for (const id of fields) {
        const ask = this.ledger.askFor(id);
        if (!ask) {
          nothingAsked.push(id);
          continue;
        }
        if (agreed) {
          if (ask.kind === "changed") changes.push({ type: "replace", id: ask.factId, value: ask.now, from: { ...ask.from, evidence: `${ask.from.evidence} \u2014 ${evidence}` }, key: ask.key, gist: ask.gist });
          if (ask.kind === "forget") changes.push({ type: "delete", id: ask.factId });
          if (ask.kind === "sensitive") changes.push({ type: "observe", key: ask.key, gist: ask.gist, value: ask.value, from: ask.from, allowSensitive: true });
        }
        this.ledger.settle(id);
        settled.push(id);
      }
      if (changes.length > 0) {
        try {
          this.profile = (await this.store.apply(changes)).profile;
        } catch (cause) {
          this.options.log?.(`could not save for next time: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
      const name = (id) => {
        const spec = byId.get(id);
        return spec ? fieldName(spec) : id;
      };
      const state = this.state();
      const result = {
        ...agreed ? { kept_for_next_time: settled.map(name) } : { left_as_before: settled.map(name) },
        ...nothingAsked.length > 0 ? { nothing_to_settle: nothingAsked.map(name) } : {},
        progress: state.progress,
        do_next: doNext(this.move()),
        submitted: false
      };
      this.options.onChange?.();
      return { result, outcomes: [], spoken: [] };
    }
    /**
     * The call is over. What they typed by hand into their own answers is kept — but only ever offered
     * back for a yes, since nobody heard them say it.
     */
    async finish() {
      const read = this.current;
      if (!read) return;
      const typed = this.state().fields.filter((f) => f.source === "typed" && f.value !== null).map((f) => ({ fieldId: f.spec.id, value: f.value, evidence: "" }));
      const keys = factKeys(read.specs, this.meanings);
      const fresh = typed.filter((t) => {
        const key = keys.get(t.fieldId);
        return key && !this.profile.facts[factId(key)];
      });
      if (fresh.length > 0) await this.learn(fresh, read, "typed");
    }
    /** Replace an answer with a better-shaped version of the same words (the Dictation pass). */
    async rewrite(fieldId, value, evidence) {
      const read = this.current;
      if (!read) return;
      const values = [{ fieldId, value, evidence }];
      const results = await writeValues(read.specs, read.handles, values);
      await this.record(results, values, read, "spoken");
      this.options.onChange?.();
    }
    /** What the agent is told after a fill: facts about this call, and the next move. */
    report(outcomes, claimed, reshaped, extra) {
      const state = this.state();
      const facts = summarise({
        specs: state.fields.map((f) => f.spec),
        before: this.current?.specs,
        filled: state.fields.filter((f) => f.value !== null).map((f) => f.spec.id),
        outcomes,
        claimed,
        reshaped
      });
      const move = this.move();
      return {
        just_filled: facts.just_filled,
        not_filled: facts.not_filled,
        ...extra,
        progress: state.progress,
        ...facts.form_changed ? { form_changed: facts.form_changed } : {},
        do_next: doNext(move),
        // Always false, always here — rule 5b. Read at the exact moment the model once claimed to
        // have submitted an application it had only typed into.
        submitted: false
      };
    }
    changeFacts(reshaped) {
      return {
        new_questions: reshaped.appeared.map(fieldName),
        gone: reshaped.disappeared.map(fieldName),
        kept: reshaped.restored
      };
    }
    // ── The form changing shape ──────────────────────────────────────────────────────
    /** A write is running; the page watcher should leave the form alone and let the write re-read. */
    get isWriting() {
      return this.writing;
    }
    noteMoveDuringWrite() {
      this.movedWhileWriting = true;
    }
    /**
     * Read the form again, and bring everything in line with what is on the page now.
     *
     * A field that comes back empty gets back what was said for it. A new field that asks what a
     * departed one asked is offered, never filled — it is a different question. Serialised: two
     * re-reads never adopt at once.
     */
    pageChanged() {
      const run = async () => {
        if (!this.current) return null;
        await whenSettled(this.scope(), 200, 1200);
        const change = this.registry.adopt(this.readNow());
        await harvestOptions({ ...change.read, specs: change.appeared });
        const read = change.read;
        this.current = read;
        applyMeaningHints(read.specs, this.meanings);
        if (change.appeared.length === 0 && change.disappeared.length === 0) {
          this.options.onChange?.();
          return null;
        }
        const state = this.state();
        const empty = new Set(state.fields.filter((f) => f.value === null).map((f) => f.spec.id));
        const restorable = change.appeared.filter((spec) => empty.has(spec.id)).flatMap((spec) => {
          const entry = this.ledger.entry(spec.id);
          return entry ? [{ fieldId: spec.id, value: entry.value, evidence: entry.evidence }] : [];
        });
        const restored = change.appeared.filter((spec) => !empty.has(spec.id) && this.ledger.entry(spec.id)).map(fieldName);
        if (restorable.length > 0) {
          const results = await writeValues(read.specs, read.handles, restorable);
          for (const r of results) {
            if (r.status === "written") {
              const spec = read.specs.find((s) => s.id === r.fieldId);
              restored.push(spec ? fieldName(spec) : r.fieldId);
            }
          }
        }
        const present = new Set(read.specs.map((s) => s.id));
        const maybeSame = change.appeared.filter((spec) => empty.has(spec.id) && !this.ledger.entry(spec.id)).flatMap((spec) => {
          const earlier = this.ledger.entries().find(([id, e]) => id !== spec.id && !present.has(id) && e.spec.kind === spec.kind && e.spec.label === spec.label && e.spec.part === spec.part);
          if (!earlier) return [];
          return [{
            field: spec.id,
            question: fieldName(spec),
            earlier_answer: String(earlier[1].value),
            earlier_question: fieldName(earlier[1].spec)
          }];
        });
        if (change.appeared.length > 0) void this.understandForm(read);
        this.options.log?.(`form changed: +${change.appeared.length} \u2212${change.disappeared.length}, restored ${restored.length}`);
        this.options.onReshape?.();
        this.options.onChange?.();
        return { appeared: change.appeared, disappeared: change.disappeared, restored, maybeSame };
      };
      const next = this.chain.then(run, run);
      this.chain = next.catch(() => void 0);
      return next;
    }
    // ── What is known about them ─────────────────────────────────────────────────────
    async forgetOne(id) {
      this.profile = (await this.store.apply([{ type: "delete", id }])).profile;
      this.options.onChange?.();
    }
    async forgetEverything() {
      this.profile = (await this.store.apply([{ type: "deleteAll" }])).profile;
      this.options.onChange?.();
    }
    /** What each field means, as far as is known now — for tests and the review panel. */
    meaningOf(id) {
      return this.meanings[id];
    }
    /** Specs as they are now — for callers that still need the raw field list. */
    specs() {
      return this.current?.specs ?? [];
    }
  };

  // core/src/clip.ts
  var COMMON = /* @__PURE__ */ new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "i",
    "im",
    "me",
    "my",
    "mine",
    "it",
    "its",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "from",
    "with",
    "as",
    "so",
    "that",
    "this",
    "uh",
    "um",
    "like",
    "yeah",
    "yes",
    "no",
    "hai",
    "hain",
    "ka",
    "ki",
    "ke",
    "mera",
    "meri",
    "main",
    "se",
    "aur",
    "toh"
  ]);
  function words2(text4) {
    return text4.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/).filter(Boolean);
  }
  function markers(quote) {
    const all = words2(quote);
    const rare = all.filter((w) => !COMMON.has(w));
    return rare.length > 0 ? rare : all;
  }
  function count(text4, word) {
    return words2(text4).filter((w) => w === word).length;
  }
  function clipFor(quote, timeline, totalSamples, sampleRate = 24e3) {
    const marks = markers(quote);
    if (marks.length === 0 || timeline.length === 0) return null;
    const first = marks[0];
    const last = marks[marks.length - 1];
    let startIndex = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (count(timeline[i].text, first) > 0) {
        startIndex = i;
        break;
      }
    }
    if (startIndex === -1) return null;
    let endIndex = -1;
    for (let i = startIndex; i < timeline.length; i++) {
      const text4 = timeline[i].text;
      if (marks.every((w) => count(text4, w) > 0) && count(text4, last) > 0) {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1) return null;
    const LEAD = Math.round(0.6 * sampleRate);
    const TAIL = Math.round(0.35 * sampleRate);
    const before = startIndex > 0 ? timeline[startIndex - 1].sample : 0;
    const start = Math.max(0, before - LEAD);
    const end = Math.min(totalSamples, timeline[endIndex].sample + TAIL);
    if (end - start < sampleRate / 2) return null;
    return { start, end };
  }

  // core/src/reconnect.ts
  var RESUME_WINDOW_MS = 25e3;
  var RECONNECT_DELAYS_MS = [0, 1e3, 2e3, 4e3, 8e3];
  function nextReconnect(drop, now) {
    if (drop.attempts >= RECONNECT_DELAYS_MS.length) {
      return { action: "give-up", reason: `Lost the connection and could not get it back after ${drop.attempts} tries.` };
    }
    const delayMs = RECONNECT_DELAYS_MS[drop.attempts];
    const resumable = drop.sessionId !== null && !drop.ended && now + delayMs - drop.droppedAt < RESUME_WINDOW_MS;
    return { action: resumable ? "resume" : "fresh", delayMs };
  }
  var RESUME_REFUSED = /* @__PURE__ */ new Set(["session_not_found", "session_forbidden", "session_expired"]);

  // core/src/voice.ts
  var WS_URL = "wss://agents.assemblyai.com/v1/ws";
  var TARGET_SAMPLE_RATE = 24e3;
  var SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE / 20;
  var LONG_TAKE_MODE = "max_accuracy";
  var CONVERSATION_MODE = "balanced";
  var HINGLISH_LANGUAGES = ["en", "hi"];
  var VoiceStartError = class extends Error {
    constructor(problem, message) {
      super(message);
      this.problem = problem;
      this.name = "VoiceStartError";
    }
  };
  var PROBLEM_WORDS = {
    "mic-denied": "The microphone is blocked for this page. Click the icon at the left of the address bar, allow the microphone, and try again.",
    "no-mic": "No microphone was found. Plug one in or turn it on, then try again.",
    "mic-busy": "Another app is using the microphone. Close it (a call, a recorder), then try again.",
    insecure: "The microphone only works on a secure page. Open this page over https.",
    unsupported: "This browser cannot record audio here. Try a recent Chrome, Edge, Firefox or Safari.",
    token: "Could not start a voice session.",
    other: "The microphone could not be started."
  };
  function explainMicFailure(cause, secure = true) {
    if (cause instanceof VoiceStartError) return cause;
    const name = cause?.name ?? "";
    const problem = !secure ? "insecure" : name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError" ? "mic-denied" : name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" ? "no-mic" : name === "NotReadableError" || name === "TrackStartError" || name === "AbortError" ? "mic-busy" : "other";
    const detail = problem === "other" && cause instanceof Error ? ` (${cause.message})` : "";
    return new VoiceStartError(problem, `${PROBLEM_WORDS[problem]}${detail}`);
  }
  var TOOL_DEADLINE_MS = 12e3;
  function withDeadline(work, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({
          error: "Filling the form took too long and was abandoned. Tell the person that one did not go in and ask them to type it themselves."
        }),
        ms
      );
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (cause) => {
          clearTimeout(timer);
          reject(cause);
        }
      );
    });
  }
  function toBase64(samples) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    const CHUNK = 32768;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  async function startVoiceSession(options) {
    const {
      voice = "alba",
      languageCodes = HINGLISH_LANGUAGES,
      getToken,
      workletUrl,
      wsUrl = WS_URL,
      freshStart,
      onEvent,
      onReady,
      onUserPartial,
      onUserTranscript,
      onAgentTranscript,
      onSpeechStart,
      onError,
      onClosed,
      onReconnecting,
      onReconnected,
      onResultsSent,
      onToolCall
    } = options;
    let transcriptionMode = options.transcriptionMode ?? LONG_TAKE_MODE;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const secure = typeof isSecureContext === "undefined" || isSecureContext;
      throw secure ? new VoiceStartError("unsupported", PROBLEM_WORDS.unsupported) : explainMicFailure(null, false);
    }
    const audioReady = (async () => {
      let audioCtx2 = null;
      try {
        audioCtx2 = new AudioContext();
        await audioCtx2.resume();
        await audioCtx2.audioWorklet.addModule(workletUrl);
        const stream2 = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            // stops the agent interrupting itself
            noiseSuppression: false,
            // server-side Voice Focus already does this; stacking hurts ASR
            autoGainControl: true
          }
        });
        const source2 = audioCtx2.createMediaStreamSource(stream2);
        const worklet2 = new AudioWorkletNode(audioCtx2, "pcm-processor", {
          processorOptions: { inputSampleRate: audioCtx2.sampleRate, targetSampleRate: TARGET_SAMPLE_RATE }
        });
        source2.connect(worklet2).connect(audioCtx2.destination);
        return { audioCtx: audioCtx2, stream: stream2, source: source2, worklet: worklet2 };
      } catch (cause) {
        void audioCtx2?.close();
        throw explainMicFailure(cause);
      }
    })();
    const firstToken = getToken().catch((cause) => {
      throw new VoiceStartError("token", `${PROBLEM_WORDS.token} ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    const [audio, token] = await Promise.all([
      audioReady,
      // If the token fails we still have to release the microphone, or the browser keeps showing
      // a recording indicator for a session that never happened.
      firstToken.catch(async (cause) => {
        const held = await audioReady.catch(() => null);
        if (held) {
          for (const track of held.stream.getTracks()) track.stop();
          void held.audioCtx.close();
        }
        throw cause;
      })
    ]).catch(async (cause) => {
      firstToken.catch(() => void 0);
      throw cause;
    });
    const { audioCtx, stream, source, worklet } = audio;
    let nextStartTime = 0;
    const liveSources = /* @__PURE__ */ new Set();
    function playReplyAudio(base64) {
      const raw = atob(base64);
      const pcm16 = new Int16Array(raw.length / 2);
      for (let i = 0; i < pcm16.length; i++) {
        pcm16[i] = raw.charCodeAt(i * 2) | raw.charCodeAt(i * 2 + 1) << 8;
      }
      const buffer = audioCtx.createBuffer(1, pcm16.length, TARGET_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i] / 32768;
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      const startAt = Math.max(audioCtx.currentTime, nextStartTime);
      src.start(startAt);
      src.onended = () => liveSources.delete(src);
      liveSources.add(src);
      nextStartTime = startAt + buffer.duration;
    }
    function flushPlayback() {
      for (const src of liveSources) {
        try {
          src.onended = null;
          src.stop(0);
          src.disconnect();
        } catch {
        }
      }
      liveSources.clear();
      nextStartTime = audioCtx.currentTime;
    }
    let ws = null;
    let ready = false;
    let closing = false;
    let sessionId = null;
    let ended = false;
    let drop = null;
    let reconnectTimer;
    let opening = "first";
    const send = (message) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(message));
      if (message.type !== "input.audio") onEvent?.("out", message);
    };
    let pending = new Int16Array(0);
    function enqueue(samples) {
      const merged = new Int16Array(pending.length + samples.length);
      merged.set(pending, 0);
      merged.set(samples, pending.length);
      pending = merged;
      while (pending.length >= SAMPLES_PER_CHUNK) {
        const chunk = pending.slice(0, SAMPLES_PER_CHUNK);
        pending = pending.slice(SAMPLES_PER_CHUNK);
        send({ type: "input.audio", audio: toBase64(chunk) });
      }
    }
    const PREBUFFER_MAX_SAMPLES = TARGET_SAMPLE_RATE * 20;
    let prebuffer = [];
    let prebufferedSamples = 0;
    function flushPrebuffer() {
      if (prebuffer.length === 0) return 0;
      const held = prebuffer;
      const heldSamples = prebufferedSamples;
      prebuffer = [];
      prebufferedSamples = 0;
      for (const block of held) enqueue(block);
      return heldSamples;
    }
    const MAX_TURN_SAMPLES = TARGET_SAMPLE_RATE * 110;
    let turnAudio = [];
    let turnSamples = 0;
    let timeline = [];
    const resetTurnAudio = () => {
      turnAudio = [];
      turnSamples = 0;
      timeline = [];
    };
    const takeTurnAudio = () => {
      if (turnSamples === 0) return null;
      const joined = new Int16Array(turnSamples);
      let at = 0;
      for (const block of turnAudio) {
        joined.set(block, at);
        at += block.length;
      }
      return joined;
    };
    worklet.port.onmessage = (event) => {
      const incoming = new Int16Array(event.data);
      if (turnSamples < MAX_TURN_SAMPLES) {
        turnAudio.push(incoming);
        turnSamples += incoming.length;
      }
      if (!ready) {
        prebuffer.push(incoming);
        prebufferedSamples += incoming.length;
        while (prebufferedSamples > PREBUFFER_MAX_SAMPLES && prebuffer.length > 1) {
          prebufferedSamples -= prebuffer.shift().length;
        }
        return;
      }
      enqueue(incoming);
    };
    let results = new ToolResultQueue();
    const flushResults = () => {
      if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return;
      const due = results.due(Date.now());
      for (const held of due) {
        send({ type: "tool.result", call_id: held.call_id, result: JSON.stringify(held.result) });
      }
      if (due.length > 0) onResultsSent?.();
    };
    const heartbeat = setInterval(flushResults, 500);
    const runTool = async (message) => {
      const callId = String(message.call_id ?? "");
      const name = String(message.name ?? "");
      const args = message.arguments ?? {};
      let result;
      try {
        result = onToolCall ? await withDeadline(onToolCall(name, args), TOOL_DEADLINE_MS) : { error: `No handler for "${name}" in this client.` };
      } catch (cause) {
        result = { error: cause instanceof Error ? cause.message : String(cause) };
      }
      results.add({ call_id: callId, result }, Date.now());
      flushResults();
    };
    const sessionConfig = (config) => ({
      system_prompt: config.systemPrompt,
      greeting: config.greeting,
      input: {
        format: { encoding: "audio/pcm" },
        // No `turn_detection`: its defaults are the semantic end-of-turn and barge-in.
        transcription_mode: transcriptionMode,
        ...languageCodes.length > 0 ? { language_codes: languageCodes } : {}
      },
      output: { voice, format: { encoding: "audio/pcm" }, volume: 100 },
      ...config.tools.length > 0 ? { tools: config.tools } : {}
    });
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "reply.audio") onEvent?.("in", message);
      results.note(message.type);
      switch (message.type) {
        case "session.ready": {
          ready = true;
          sessionId = String(message.session_id ?? "") || sessionId;
          ended = false;
          const how = opening;
          drop = null;
          if (how !== "first") results.note("reply.done");
          if (how === "resumed" && freshStart) {
            const now = freshStart();
            send({ type: "session.update", session: { system_prompt: now.systemPrompt, tools: now.tools } });
          }
          const heldSamples = flushPrebuffer();
          if (heldSamples > 0) {
            onEvent?.("out", {
              type: "longtake.prebuffer.flushed",
              seconds: Number((heldSamples / TARGET_SAMPLE_RATE).toFixed(2))
            });
          }
          flushResults();
          if (how === "first") onReady?.(sessionId ?? "");
          else onReconnected?.(how);
          break;
        }
        case "reply.audio":
          playReplyAudio(String(message.data));
          break;
        case "tool.call":
          void runTool(message);
          break;
        case "input.speech.started":
          onSpeechStart?.();
          flushPlayback();
          flushResults();
          break;
        case "reply.done":
          if (message.status === "interrupted") flushPlayback();
          flushResults();
          break;
        case "transcript.user.delta": {
          const running = String(message.text ?? message.delta ?? "");
          timeline.push({ text: running, sample: turnSamples });
          onUserPartial?.(running);
          break;
        }
        case "transcript.user": {
          const turn = takeTurnAudio();
          const heard = timeline;
          resetTurnAudio();
          onUserTranscript?.(String(message.text ?? ""), turn, heard);
          break;
        }
        case "transcript.agent":
          onAgentTranscript?.(String(message.text ?? ""));
          break;
        case "session.ended":
          ended = true;
          break;
        case "session.error":
        case "error": {
          const code = String(message.code ?? "");
          if (drop && RESUME_REFUSED.has(code)) {
            sessionId = null;
            break;
          }
          onError?.(String(message.message ?? JSON.stringify(message)));
          break;
        }
      }
    };
    const connect = async (how, firstToken2) => {
      const socketToken = firstToken2 ?? await getToken();
      if (closing) return;
      opening = how;
      const url = new URL(wsUrl);
      url.searchParams.set("token", socketToken);
      const socket = new WebSocket(url);
      ws = socket;
      socket.addEventListener("open", () => {
        if (how === "resumed" && sessionId) {
          send({ type: "session.resume", session_id: sessionId });
          return;
        }
        if (how === "fresh") results = new ToolResultQueue();
        const config = how === "fresh" && freshStart ? freshStart() : { systemPrompt: options.systemPrompt, greeting: options.greeting, tools: options.tools ?? [] };
        send({ type: "session.update", session: sessionConfig(config) });
      });
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", () => {
        if (!closing && how === "first" && !sessionId) onError?.("Could not connect to the voice service. Check the network and try again.");
      });
      socket.addEventListener("close", (event) => {
        if (socket !== ws) return;
        ready = false;
        flushPlayback();
        if (closing) {
          onClosed?.();
          return;
        }
        if (how === "first" && !sessionId) {
          if (event.code === 1008) onError?.("Unauthorized (close 1008). The token was bad or already used.");
          onClosed?.();
          return;
        }
        lineDropped();
      });
    };
    const lineDropped = () => {
      if (!freshStart && (ended || !sessionId)) {
        onClosed?.();
        return;
      }
      drop = drop ?? { sessionId, droppedAt: Date.now(), attempts: 0, ended };
      drop.sessionId = sessionId;
      drop.ended = ended;
      const step = nextReconnect(drop, Date.now());
      if (step.action === "give-up" || step.action === "fresh" && !freshStart) {
        onError?.(step.action === "give-up" ? step.reason : "The connection dropped and the session could not be resumed.");
        closing = true;
        teardown();
        onClosed?.();
        return;
      }
      drop.attempts += 1;
      onReconnecting?.(drop.attempts);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connect(step.action === "resume" ? "resumed" : "fresh").catch(() => lineDropped());
      }, step.delayMs);
    };
    const teardown = () => {
      clearInterval(heartbeat);
      clearTimeout(reconnectTimer);
      flushPlayback();
      worklet.port.onmessage = null;
      try {
        worklet.disconnect();
        source.disconnect();
      } catch {
      }
      for (const track of stream.getTracks()) track.stop();
      void audioCtx.close();
    };
    await connect("first", token);
    return {
      setTranscriptionMode: (next) => {
        transcriptionMode = next;
        send({ type: "session.update", session: { input: { transcription_mode: next } } });
      },
      setTools: (next) => {
        send({ type: "session.update", session: { tools: next } });
      },
      setSystemPrompt: (prompt) => {
        send({ type: "session.update", session: { system_prompt: prompt } });
      },
      stop: async () => {
        closing = true;
        clearTimeout(reconnectTimer);
        const socket = ws;
        if (socket && socket.readyState === WebSocket.OPEN) {
          send({ type: "session.end" });
          await new Promise((resolve) => {
            const done = () => resolve();
            socket.addEventListener("close", done, { once: true });
            setTimeout(done, 1e3);
          });
        }
        try {
          socket?.close();
        } catch {
        }
        teardown();
      }
    };
  }

  // core/src/notices.ts
  var WHY = {
    not_an_option: "that isn't one of its choices",
    quote_not_found: "Longtake couldn't match it to what you said",
    page_refused: "the page didn't keep it",
    page_refused_twice: "the page won't take it \u2014 type it yourself",
    needs_the_person: "only you can do this one",
    // The agent sent it without any of the person's words — not a hearing problem.
    not_heard: "Longtake had none of your words for it"
  };
  function missesIn(result) {
    const notFilled = result?.not_filled;
    if (!Array.isArray(notFilled)) return [];
    return notFilled.filter((item) => item.why !== "gone").map((item) => ({
      fieldId: item.field,
      question: item.question,
      why: WHY[item.why] ?? item.why.replace(/_/g, " ")
    }));
  }

  // core/src/conductor.ts
  var EMPTY_FORM = {
    title: "",
    fields: [],
    theirs: [],
    asks: [],
    actions: [],
    progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 }
  };
  var LOG_LIMIT = 400;
  var SHAPE_SETTLE_MS = 500;
  var TYPING_SETTLE_MS = 1200;
  function pcmToBase64(samples) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    const CHUNK = 32768;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  var Conductor = class {
    constructor(options) {
      this.options = options;
      this.voice = null;
      this.listeners = /* @__PURE__ */ new Set();
      this.prepared = null;
      // ── Per call ───────────────────────────────────────────────────────────────────────
      this.stopped = true;
      this.transcript = "";
      /**
       * The turn being spoken, before it is final. The agent calls `fill_fields` mid-sentence, so a
       * quote is checked against what has been said so far INCLUDING this — otherwise the longest
       * answers were thrown away as invented, because their words were not in the transcript yet.
       */
      this.partial = "";
      this.switchedMode = false;
      this.sentPrompt = "";
      this.missed = /* @__PURE__ */ new Map();
      /** The last few finished turns: audio, words, and when each word arrived. */
      this.turnAudio = [];
      /** Long answers filled mid-sentence, waiting for their turn to end so their audio exists. */
      this.pendingClips = /* @__PURE__ */ new Map();
      this.askedAt = null;
      this.detach = null;
      const session = new LongtakeSession({
        root: options.root,
        ignore: options.ignore,
        ...options.profile ? { profile: options.profile } : {},
        ...options.services.understand ? { understand: options.services.understand } : {},
        log: (line) => this.note("app", line),
        onChange: () => this.update({ form: session.state(), known: session.known() }),
        // Answers from last time went in after the call had opened: the agent hears about it now.
        onPromptStale: () => {
          this.refresh();
          this.syncPrompt();
        },
        // The form's questions changed under the call: new tools and a new prompt, straight away.
        onReshape: () => {
          const problems = session.toolProblems();
          if (problems.length > 0) {
            this.note("app", `form changed but the new tools are invalid: ${problems.join("; ")}`);
            return;
          }
          this.voice?.setTools(session.tools());
          this.sentPrompt = session.prompt();
          this.voice?.setSystemPrompt(this.sentPrompt);
        }
      });
      this.session = session;
      options.profile?.subscribe?.((profile) => session.profileChanged(profile));
      this.current = {
        status: "idle",
        error: null,
        problem: null,
        form: EMPTY_FORM,
        outcomes: [],
        missed: [],
        turns: [],
        partial: "",
        shaped: {},
        hesitations: {},
        known: [],
        log: []
      };
    }
    // ── Watching ───────────────────────────────────────────────────────────────────────
    view() {
      return this.current;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    /** The whole call as JSON — every tool call and result in full — for a bug report. */
    copyLog(page = typeof location === "undefined" ? "" : location.href) {
      return JSON.stringify({ page, turns: this.current.turns, log: this.current.log }, null, 2);
    }
    update(patch) {
      this.current = { ...this.current, ...patch };
      for (const listener of this.listeners) listener(this.current);
    }
    note(kind, text4) {
      const log = [...this.current.log.slice(-(LOG_LIMIT - 1)), { at: (/* @__PURE__ */ new Date()).toISOString(), kind, text: text4 }];
      this.update({ log });
    }
    /** Redraw the form, and drop "didn't go in" notices for fields that now have something in them. */
    refresh() {
      const form = this.session.state();
      for (const field of form.fields) if (field.value !== null) this.missed.delete(field.spec.id);
      this.update({ form, known: this.session.known(), missed: [...this.missed.values()] });
    }
    // ── Before the call ────────────────────────────────────────────────────────────────
    /** Remembered answers go in when the page opens, before anybody presses anything. Once. */
    prepare() {
      if (!this.prepared) this.prepared = this.session.prefill().then(() => this.refresh());
      return this.prepared;
    }
    forgetOne(id) {
      return this.session.forgetOne(id);
    }
    forgetEverything() {
      return this.session.forgetEverything();
    }
    get running() {
      return !this.stopped;
    }
    // ── The call ───────────────────────────────────────────────────────────────────────
    async start() {
      if (!this.stopped) return;
      this.stopped = false;
      this.transcript = "";
      this.partial = "";
      this.switchedMode = false;
      this.missed = /* @__PURE__ */ new Map();
      this.turnAudio = [];
      this.pendingClips = /* @__PURE__ */ new Map();
      this.askedAt = null;
      this.pauseBeforeAnswer = void 0;
      this.update({ status: "reading", error: null, problem: null, turns: [], partial: "", missed: [], log: [] });
      this.options.onActive?.(true);
      try {
        await this.prepare();
        await this.session.open();
        this.refresh();
        const problems = this.session.toolProblems();
        if (problems.length > 0) throw new Error(`This form produced a tool the voice service would reject: ${problems[0]}`);
        const greeting = this.session.greeting();
        this.note("app", `opening line: ${greeting}`);
        this.update({ status: "connecting" });
        const { services } = this.options;
        const startVoice = services.startVoice ?? startVoiceSession;
        this.sentPrompt = this.session.prompt();
        const voice = await startVoice({
          voice: services.voice ?? "charles",
          systemPrompt: this.sentPrompt,
          greeting,
          tools: this.session.tools(),
          getToken: services.getToken,
          workletUrl: services.workletUrl,
          ...services.wsUrl ? { wsUrl: services.wsUrl } : {},
          // The line dropped past saving: a new agent, told the form as it is and where to pick up.
          freshStart: () => {
            this.sentPrompt = this.session.prompt();
            return { systemPrompt: this.sentPrompt, greeting: this.session.resumeGreeting(), tools: this.session.tools() };
          },
          onToolCall: (name, args) => this.runTool(name, args),
          // After results are out, the agent's prompt catches up with the form — so even a turn with
          // no tool call ("hello?", "what's left?") is answered from the form as it is.
          onResultsSent: () => {
            this.sentPrompt = this.session.prompt();
            this.voice?.setSystemPrompt(this.sentPrompt);
          },
          ...this.options.logFrames ? { onEvent: (direction, message) => this.note(direction, JSON.stringify(message).slice(0, 260)) } : {},
          onReady: () => {
            this.update({ status: "live" });
            this.note("app", "session.ready \u2014 speak now");
          },
          onReconnecting: (attempt) => {
            this.update({ status: "reconnecting" });
            this.note("app", `line dropped \u2014 reconnecting (try ${attempt})`);
          },
          onReconnected: (how) => {
            this.update({ status: "live" });
            this.note("app", how === "resumed" ? "reconnected \u2014 same conversation" : "reconnected \u2014 new session, picked up from the form");
          },
          onUserPartial: (text4) => {
            this.partial = text4;
            this.update({ partial: text4 });
          },
          onUserTranscript: (text4, audio, timeline) => this.heardTurn(text4, audio, timeline),
          onAgentTranscript: (text4) => {
            this.askedAt = Date.now();
            this.note("agent", text4);
            this.update({ turns: [...this.current.turns, { who: "agent", text: text4 }] });
          },
          onSpeechStart: () => {
            const now = Date.now();
            this.pauseBeforeAnswer = this.askedAt ? (now - this.askedAt) / 1e3 : void 0;
          },
          onError: (message) => {
            if (this.stopped) return;
            this.finish();
            this.update({ status: "error", error: message });
          },
          onClosed: () => {
            if (this.stopped) return;
            this.finish();
            this.update({ status: "stopped" });
          }
        });
        this.voice = voice;
        if (this.stopped) {
          await voice.stop();
          return;
        }
        this.watchPage();
      } catch (cause) {
        this.finish();
        this.update({
          status: "error",
          problem: cause instanceof VoiceStartError ? cause.problem : null,
          error: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
    async stop() {
      if (this.stopped) return;
      this.finish();
      this.update({ status: "stopped", partial: "" });
      await this.voice?.stop();
      this.voice = null;
    }
    finish() {
      const wasLive = !this.stopped;
      this.stopped = true;
      this.detach?.();
      this.detach = null;
      this.options.onActive?.(false);
      if (wasLive) void this.session.finish().then(() => this.refresh(), () => void 0);
    }
    /** Everything said so far, the turn still being spoken included. */
    heard() {
      return `${this.transcript}
${this.partial}`.trim();
    }
    heardTurn(text4, audio, timeline) {
      if (audio && audio.length > 0) {
        this.turnAudio = [...this.turnAudio.slice(-5), { text: text4, audio, timeline }];
        for (const [fieldId, evidence] of this.pendingClips) {
          if (this.placeClip(fieldId, evidence)) this.pendingClips.delete(fieldId);
        }
      }
      this.partial = "";
      this.transcript = `${this.transcript}
${text4}`.trim();
      this.note("you", text4);
      this.update({ partial: "", turns: [...this.current.turns, { who: "you", text: text4 }] });
    }
    // ── The tools ──────────────────────────────────────────────────────────────────────
    /** Runs one tool call and returns what goes back to the agent. Public so replays can drive it. */
    async runTool(name, args) {
      this.note("tool", `call ${name} ${JSON.stringify(args)}`);
      const result = await this.route(name, args);
      this.note("tool", `result ${name} ${JSON.stringify(result)}`);
      for (const miss of missesIn(result)) this.missed.set(miss.fieldId, miss);
      this.refresh();
      return result;
    }
    async route(name, args) {
      const session = this.session;
      const heard = this.heard();
      if (name === FILL_TOOL_NAME) {
        const done = await session.fill(args, heard);
        this.update({ outcomes: [...this.current.outcomes, ...done.outcomes] });
        const landed = done.outcomes.filter((o) => o.status === "written").map((o) => o.fieldId);
        if (landed.length > 0) {
          for (const said2 of done.spoken) {
            if (!landed.includes(said2.fieldId)) continue;
            if (!this.placeClip(said2.fieldId, said2.evidence)) this.pendingClips.set(said2.fieldId, said2.evidence);
          }
          if (!this.switchedMode) {
            this.switchedMode = true;
            this.voice?.setTranscriptionMode(CONVERSATION_MODE);
            this.note("app", "switched to conversation timing");
          }
        }
        return done.result;
      }
      if (name === CLEAR_TOOL_NAME) {
        const done = await session.clear(args, heard);
        const cleared = new Set((done.result.cleared ?? []).map((c2) => c2.field));
        if (cleared.size > 0) {
          for (const id of cleared) this.pendingClips.delete(id);
          const without = (record) => Object.fromEntries(Object.entries(record).filter(([id]) => !cleared.has(id)));
          this.update({
            outcomes: this.current.outcomes.filter((o) => !cleared.has(o.fieldId)),
            hesitations: without(this.current.hesitations),
            shaped: without(this.current.shaped)
          });
        }
        return done.result;
      }
      if (name === CONFIRM_TOOL_NAME) {
        const done = await session.confirm(args, heard);
        this.update({ outcomes: [...this.current.outcomes, ...done.outcomes] });
        return done.result;
      }
      if (name === PRESS_TOOL_NAME) return (await session.press(args, heard)).result;
      if (name === LATER_TOOL_NAME) return session.setAside(args, heard).result;
      if (name === SAVE_TOOL_NAME) return (await session.saveForNextTime(args, heard)).result;
      return { error: `Unknown tool "${name}".` };
    }
    // ── Watching the page ──────────────────────────────────────────────────────────────
    /**
     * Changes nobody told us about: a person clicking an option themselves, or typing into a box.
     * Shape changes re-read the form; typing only redraws, since `state()` reads values off the page.
     * Left alone while a tool call is writing — that call re-reads before it answers. Anything inside
     * our own furniture (`ignore`) is not the form, so it never triggers a re-read.
     */
    watchPage() {
      const scope = this.options.root();
      const target = "body" in scope ? scope.body : scope;
      if (!target) return;
      const ignore = this.options.ignore;
      const ours = (node) => {
        const element = node instanceof Element ? node : node?.parentElement;
        return Boolean(ignore && element?.closest(ignore));
      };
      let shapeTimer;
      let typeTimer;
      const observer = new MutationObserver((records) => {
        if (records.every((record) => ours(record.target))) return;
        if (this.session.isWriting) {
          this.session.noteMoveDuringWrite();
          return;
        }
        clearTimeout(shapeTimer);
        shapeTimer = setTimeout(() => {
          void this.session.pageChanged().then(() => {
            this.refresh();
            this.syncPrompt();
          });
        }, SHAPE_SETTLE_MS);
      });
      observer.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-checked", "aria-selected"]
      });
      const onInput = (event) => {
        if (ours(event.target) || this.session.isWriting) return;
        this.refresh();
        clearTimeout(typeTimer);
        typeTimer = setTimeout(() => this.syncPrompt(), TYPING_SETTLE_MS);
      };
      target.addEventListener("input", onInput, true);
      target.addEventListener("change", onInput, true);
      this.detach = () => {
        observer.disconnect();
        target.removeEventListener("input", onInput, true);
        target.removeEventListener("change", onInput, true);
        clearTimeout(shapeTimer);
        clearTimeout(typeTimer);
      };
    }
    /**
     * Give the agent the form as it is now — if it changed since it last heard. After tool results
     * the agent is caught up anyway; this is for what happens without one: the person typing, or
     * picking an option themselves. Without it the agent asked for a field typed in front of it.
     */
    syncPrompt() {
      if (!this.voice || this.session.isWriting || this.stopped) return;
      const prompt = this.session.prompt();
      if (prompt === this.sentPrompt) return;
      this.sentPrompt = prompt;
      this.voice.setSystemPrompt(prompt);
      this.note("app", "form changed without a tool call \u2014 agent brought up to date");
    }
    // ── A long answer's own audio: the clip, and the Dictation pass that uses it ─────────
    /**
     * Find the words a long answer came from in the recent turns, and send just those seconds to
     * Dictation. Newest turn first. Where the words are in a turn but cannot be pinned to a moment,
     * the whole turn is sent. False when the turn has not finished yet — the caller waits for it.
     */
    placeClip(fieldId, evidence) {
      if (!this.options.services.dictate) return true;
      for (const turn of [...this.turnAudio].reverse()) {
        if (!checkEvidence(turn.text, evidence).ok) continue;
        const clip2 = clipFor(evidence, turn.timeline, turn.audio.length);
        const audio = clip2 ? turn.audio.subarray(clip2.start, clip2.end) : turn.audio;
        void this.shapeLongAnswer(fieldId, audio);
        return true;
      }
      return false;
    }
    /** One Dictation pass over one long answer, then the tidy text replaces what the agent typed. */
    async shapeLongAnswer(fieldId, audio) {
      const dictate = this.options.services.dictate;
      const read = this.session.read;
      if (!dictate || !read || audio.length === 0) return;
      const [spec] = fieldsWorthShaping(read.specs, [fieldId]);
      if (!spec) return;
      const known = {};
      for (const field of this.session.state().fields) {
        if (typeof field.value === "string" && field.value.length < 60) known[field.spec.id] = field.value;
      }
      try {
        const payload = await dictate(configForField(spec, { specs: read.specs, known }), pcmToBase64(audio));
        const result = shapeResult(spec.id, payload);
        this.update({ shaped: { ...this.current.shaped, [spec.id]: result } });
        const hesitation = readHesitation(spec.id, result.verbatim, result.clean, this.pauseBeforeAnswer);
        if (hesitation.worthAnotherLook) this.update({ hesitations: { ...this.current.hesitations, [spec.id]: hesitation } });
        if (result.clean) await this.session.rewrite(spec.id, result.clean, result.verbatim);
        this.note(
          "app",
          result.rewritten ? `dictation shaped ${spec.id}, verbatim kept (${result.verbatim.length} chars)` : `dictation returned verbatim only for ${spec.id} \u2014 ${result.note}`
        );
      } catch (cause) {
        this.note("app", `dictation for ${spec.id} errored: ${String(cause)}`);
      }
    }
  };

  // core/src/index.ts
  var CORE_VERSION = "0.9.0";

  // tools/replay/fake-voice.ts
  var FakeVoice = class {
    constructor() {
      __publicField(this, "options", null);
      __publicField(this, "sent", []);
      /** The opening config the call was started with. */
      __publicField(this, "opening", null);
      __publicField(this, "start", async (options) => {
        this.options = options;
        this.opening = { systemPrompt: options.systemPrompt, greeting: options.greeting, tools: options.tools ?? [], voice: options.voice };
        setTimeout(() => options.onReady?.("fake-session"), 0);
        return {
          stop: async () => {
            this.sent.push({ kind: "stop" });
          },
          setSystemPrompt: (value) => this.sent.push({ kind: "systemPrompt", value }),
          setTools: (value) => this.sent.push({ kind: "tools", value }),
          setTranscriptionMode: (value) => this.sent.push({ kind: "transcriptionMode", value })
        };
      });
    }
    get o() {
      if (!this.options) throw new Error("FakeVoice: the call has not started");
      return this.options;
    }
    /** The person finished a turn. */
    userSays(text4) {
      this.o.onSpeechStart?.();
      this.o.onUserPartial?.(text4);
      this.o.onUserTranscript?.(text4, null, [{ text: text4, sample: 0 }]);
    }
    /** The person is mid-sentence: a running partial, not yet final. */
    partial(text4) {
      this.o.onUserPartial?.(text4);
    }
    /** The agent calls a tool; resolves with what would go back to it. */
    async toolCall(name, args) {
      if (!this.o.onToolCall) throw new Error("FakeVoice: no tool handler");
      const result = await this.o.onToolCall(name, args);
      this.o.onResultsSent?.();
      return result;
    }
    /** The agent said something. */
    agentSays(text4) {
      this.o.onAgentTranscript?.(text4);
    }
    /** The latest system prompt the agent has — the opening one until something replaced it. */
    get prompt() {
      const last = [...this.sent].reverse().find((s) => s.kind === "systemPrompt");
      return last?.kind === "systemPrompt" ? last.value : this.opening?.systemPrompt ?? "";
    }
  };

  // tools/replay/run-script.ts
  async function runScript(conductor, fake, script, resolve = (ref) => ref.replace(/^\$/, "")) {
    const failures = [];
    const results = [];
    let checks = 0;
    let last = null;
    const fail = (index, what) => failures.push(`step ${index + 1}: ${what}`);
    const ids = (list) => (list ?? []).map((item) => item.field).sort();
    const resolveArgs = (args) => {
      const out = {};
      for (const [key, value] of Object.entries(args)) {
        out[key.startsWith("$") ? resolve(key) : key] = typeof value === "string" && value.startsWith("$") ? resolve(value) : value;
      }
      if (Array.isArray(out.fields)) out.fields = out.fields.map((f) => f.startsWith("$") ? resolve(f) : f);
      return out;
    };
    for (const [index, step] of script.steps.entries()) {
      if ("user" in step) fake.userSays(step.user);
      else if ("partial" in step) fake.partial(step.partial);
      else if ("agentSays" in step) fake.agentSays(step.agentSays);
      else if ("wait" in step) await new Promise((r) => setTimeout(r, step.wait));
      else if ("tool" in step) {
        last = await fake.toolCall(step.tool, resolveArgs(step.args));
        results.push(last);
      } else if ("expectResult" in step) {
        const want = step.expectResult;
        if (!last) {
          checks++;
          fail(index, "no tool result to check");
          continue;
        }
        if (want.justFilled) {
          checks++;
          const expected = want.justFilled.map(resolve).sort();
          if (JSON.stringify(ids(last.just_filled)) !== JSON.stringify(expected)) {
            fail(index, `just_filled ${JSON.stringify(ids(last.just_filled))}, expected ${JSON.stringify(expected)}`);
          }
        }
        if (want.notFilled) {
          for (const item of want.notFilled) {
            checks++;
            const found = (last.not_filled ?? []).find((n) => n.field === resolve(item.field));
            if (!found) fail(index, `expected ${item.field} not filled`);
            else if (item.why && found.why !== item.why) fail(index, `${item.field} not filled because ${found.why}, expected ${item.why}`);
          }
        }
        if (want.waiting) {
          checks++;
          const expected = want.waiting.map(resolve).sort();
          if (JSON.stringify(ids(last.waiting_for_yes)) !== JSON.stringify(expected)) {
            fail(index, `waiting ${JSON.stringify(ids(last.waiting_for_yes))}, expected ${JSON.stringify(expected)}`);
          }
        }
        if (want.doNextHas) checks++;
        if (want.doNextLacks) checks++;
        if (want.doNextHas && !String(last.do_next ?? "").includes(want.doNextHas)) {
          fail(index, `do_next "${last.do_next}" lacks "${want.doNextHas}"`);
        }
        if (want.doNextLacks && String(last.do_next ?? "").includes(want.doNextLacks)) {
          fail(index, `do_next "${last.do_next}" should not mention "${want.doNextLacks}"`);
        }
      } else if ("expectFinal" in step) {
        const fields = conductor.session.state().fields;
        const value = (ref) => {
          const field = fields.find((f) => f.spec.id === resolve(ref));
          return field ? field.value : void 0;
        };
        for (const [ref, want] of Object.entries(step.expectFinal.values ?? {})) {
          checks++;
          const got = value(ref);
          if (got === void 0) fail(index, `no field ${ref}`);
          else if (!String(Array.isArray(got) ? got.join(", ") : got).includes(want)) {
            fail(index, `${ref} is ${JSON.stringify(got)}, expected it to contain ${JSON.stringify(want)}`);
          }
        }
        for (const ref of step.expectFinal.empty ?? []) {
          checks++;
          const got = value(ref);
          if (got !== null) fail(index, `${ref} should be empty, is ${JSON.stringify(got)}`);
        }
        for (const words3 of step.expectFinal.promptHas ?? []) {
          checks++;
          if (!fake.prompt.includes(words3)) fail(index, `the agent's prompt lacks "${words3}"`);
        }
      }
    }
    return { ok: failures.length === 0, failures, results, checks };
  }

  // tools/replay/fake-understand.ts
  function fakeUnderstanding(overrides = {}) {
    const calls = [];
    const understand = async (snapshot2) => {
      calls.push(snapshot2);
      return {
        fields: snapshot2.fields.map((field) => {
          const key = canonicalKey({
            id: field.id,
            label: field.question,
            kind: field.kind,
            required: field.required,
            ...field.section ? { section: field.section } : {}
          });
          const concept = key && LEGACY_KEY_TO_CONCEPT[key] || "other";
          return { id: field.id, concept, subject: "self", gist: field.question, confidence: "high", ...overrides[field.id] };
        })
      };
    };
    return Object.assign(understand, { calls });
  }

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
    readHesitation,
    describeMarks,
    canonicalKey,
    applyChanges,
    recallFor,
    factKeys,
    emptyProfile,
    memoryProfileStore,
    migrateV1,
    parseProfile,
    exportProfile,
    knownFacts,
    groupFacts,
    ToolResultQueue,
    openingLine,
    howToAsk,
    inAskingOrder,
    FieldRegistry,
    titleOf,
    isFilled,
    summarise,
    stillOptional,
    systemPrompt,
    factsOf,
    BANNED_PHRASES,
    clearValues,
    buildClearTool,
    readValue,
    Ledger,
    snapshot,
    gate,
    nextMove,
    brief,
    doNext,
    LongtakeSession,
    clipFor,
    readError,
    classify,
    readActions,
    pressAction,
    buildPressTool,
    startVoiceSession,
    explainMicFailure,
    VoiceStartError,
    nextReconnect,
    resumeLine,
    matchOption,
    accessibleName,
    accessibleDescription,
    fallbackMeanings,
    validateMeanings,
    applyMeaningHints,
    Conductor,
    FakeVoice,
    runScript,
    fakeUnderstanding,
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
