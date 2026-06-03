// ──────────────────────────────────────────────
// WriteRight AI — Content Script
// Detects text inputs, shows floating UI, and
// orchestrates the improvement flow.
// ──────────────────────────────────────────────

(function () {
  "use strict";

  // Guard against double-injection
  if (window.__WRITERIGHT_INJECTED__) return;
  window.__WRITERIGHT_INJECTED__ = true;

  // ── DOM scaffold ────────────────────────────
  const root = document.createElement("div");
  root.id = "writeright-root";

  // Floating button
  const btn = document.createElement("button");
  btn.id = "writeright-btn";
  btn.innerHTML = `
    <span class="wr-sparkle">✨</span>
    <span class="wr-label">Fix</span>
    <span class="wr-spinner"></span>
  `;

  // Mode menu
  const menu = document.createElement("div");
  menu.id = "writeright-menu";
  menu.innerHTML = `
    <div class="wr-menu-title">Choose style</div>
    <button class="wr-mode-btn" data-mode="normal">
      <span class="wr-mode-icon">👤</span>
      <span class="wr-mode-info">
        <span class="wr-mode-name">Normal Human <kbd class="wr-kbd">Ctrl+1</kbd></span>
        <span class="wr-mode-desc">Casual, friendly, natural</span>
      </span>
    </button>
    <button class="wr-mode-btn" data-mode="ceo">
      <span class="wr-mode-icon">💼</span>
      <span class="wr-mode-info">
        <span class="wr-mode-name">CEO Mode <kbd class="wr-kbd">Ctrl+2</kbd></span>
        <span class="wr-mode-desc">Confident, concise, executive</span>
      </span>
    </button>
  `;

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.id = "writeright-tooltip";
  tooltip.textContent = "Type something first";

  // Toast
  const toast = document.createElement("div");
  toast.id = "writeright-toast";

  root.append(btn, menu, tooltip, toast);
  document.documentElement.appendChild(root);

  // ── State ────────────────────────────────────
  let activeElement = null;
  let isLoading = false;
  let hideTimeout = null;
  let tooltipTimeout = null;
  let toastTimeout = null;

  // ── Helpers ──────────────────────────────────

  /**
   * Check if an element is a text-input we should enhance.
   */
  function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();

    // Standard textarea
    if (tag === "textarea") return true;

    // Text-type input (not checkbox, radio, submit, etc.)
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel"].includes(type);
    }

    // Contenteditable (Gmail, Slack, WhatsApp Web, etc.)
    if (el.isContentEditable) return true;

    // Some sites nest the contenteditable deeper — walk up a little
    if (el.closest && el.closest('[contenteditable="true"]')) return true;

    return false;
  }

  /**
   * Find the actual editable element (walk up for contenteditable).
   */
  function resolveEditable(el) {
    if (!el) return null;
    if (el.tagName?.toLowerCase() === "textarea") return el;
    if (el.tagName?.toLowerCase() === "input") return el;
    // Walk up to the closest contenteditable
    const ce = el.closest
      ? el.closest('[contenteditable="true"]')
      : null;
    return ce || (el.isContentEditable ? el : null);
  }

  /**
   * Get text from any input element.
   */
  function getText(el) {
    if (!el) return "";
    const tag = el.tagName?.toLowerCase();
    if (tag === "textarea" || tag === "input") return el.value || "";
    // contenteditable — use innerText to preserve line breaks
    return el.innerText || el.textContent || "";
  }

  /**
   * Set text in any input element, dispatching events so
   * frameworks (React, Angular, etc.) pick up the change.
   */
  function setText(el, text) {
    if (!el) return;
    const tag = el.tagName?.toLowerCase();

    if (tag === "textarea" || tag === "input") {
      // Use native setter to bypass React's synthetic wrapper
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement?.prototype || window.HTMLInputElement?.prototype,
        "value"
      )?.set || Object.getOwnPropertyDescriptor(
        tag === "textarea"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        "value"
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // contenteditable
      el.focus();
      // Select all content
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      // Use execCommand for undo support + framework compat
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /**
   * Get the pixel coordinates of the caret (text cursor) inside an element.
   * Returns { top, left } in page coordinates, or null if unavailable.
   */
  function getCaretCoords(el) {
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const tag = el.tagName?.toLowerCase();

    // ── Contenteditable: use Selection API ───
    if (el.isContentEditable || (el.closest && el.closest('[contenteditable="true"]'))) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0).cloneRange();
        range.collapse(false); // collapse to end
        // Insert a zero-width span to measure position
        const marker = document.createElement("span");
        marker.textContent = "\u200B"; // zero-width space
        range.insertNode(marker);
        const markerRect = marker.getBoundingClientRect();
        const coords = {
          top: markerRect.top + scrollY,
          left: markerRect.left + scrollX,
          lineHeight: markerRect.height || 20,
        };
        marker.remove();
        // Restore selection
        try { sel.collapseToEnd(); } catch (_) { }
        return coords;
      }
    }

    // ── Textarea / Input: mirror-div technique ───
    if (tag === "textarea" || tag === "input") {
      const mirror = document.createElement("div");
      const style = window.getComputedStyle(el);

      // Copy relevant styles to the mirror
      const props = [
        "fontFamily", "fontSize", "fontWeight", "fontStyle",
        "letterSpacing", "wordSpacing", "lineHeight", "textTransform",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "boxSizing", "textIndent", "direction",
      ];
      props.forEach((p) => (mirror.style[p] = style[p]));

      if (tag === "textarea") {
        mirror.style.width = style.width;
        mirror.style.whiteSpace = "pre-wrap";
        mirror.style.wordWrap = "break-word";
        mirror.style.overflowWrap = "break-word";
      } else {
        mirror.style.whiteSpace = "nowrap";
      }

      mirror.style.position = "absolute";
      mirror.style.top = "-9999px";
      mirror.style.left = "-9999px";
      mirror.style.visibility = "hidden";
      mirror.style.overflow = "hidden";
      mirror.style.height = "auto";

      // Text up to caret
      const text = el.value || "";
      const caretPos = el.selectionEnd ?? text.length;
      const textBefore = text.substring(0, caretPos);

      // Use a span at the caret position to measure
      const textNode = document.createTextNode(textBefore);
      const caretMarker = document.createElement("span");
      caretMarker.textContent = "|";
      mirror.appendChild(textNode);
      mirror.appendChild(caretMarker);

      document.body.appendChild(mirror);

      const elRect = el.getBoundingClientRect();
      const markerRect = caretMarker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();

      const coords = {
        top: elRect.top + scrollY + (markerRect.top - mirrorRect.top) - el.scrollTop,
        left: elRect.left + scrollX + (markerRect.left - mirrorRect.left) - el.scrollLeft,
        lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 20,
      };

      mirror.remove();
      return coords;
    }

    return null;
  }

  /**
   * Fallback: position near the element's bottom-right.
   */
  function positionFallback(target, el) {
    const rect = target.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    el.style.top = (rect.bottom + scrollY + 6) + "px";
    el.style.left = (rect.right + scrollX - el.offsetWidth) + "px";
  }

  // ── Show / Hide UI ──────────────────────────

  function showBtnAtCaret() {
    if (!activeElement) return;
    clearTimeout(hideTimeout);

    const coords = getCaretCoords(activeElement);

    if (coords) {
      // Position ABOVE the caret line
      const btnH = btn.offsetHeight || 30;
      let top = coords.top - btnH - 6;
      let left = coords.left + 4;

      // Keep within viewport
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const vw = document.documentElement.clientWidth;

      if (left + (btn.offsetWidth || 70) > vw + scrollX)
        left = vw + scrollX - (btn.offsetWidth || 70) - 8;
      if (left < scrollX + 4) left = scrollX + 4;
      if (top < scrollY + 4) {
        // If no room above, place below the caret
        top = coords.top + (coords.lineHeight || 20) + 6;
      }

      btn.style.top = top + "px";
      btn.style.left = left + "px";
    } else {
      positionFallback(activeElement, btn);
    }

    // Force reflow before adding class so transition fires
    btn.classList.remove("visible");
    void btn.offsetWidth;
    btn.classList.add("visible");
  }

  function hideBtn() {
    btn.classList.remove("visible");
    hideMenu();
  }

  function showMenu() {
    const rect = btn.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    menu.style.display = "flex";
    // Need to layout first to get correct width
    void menu.offsetWidth;

    let top = rect.bottom + scrollY + 6;
    let left = rect.right + scrollX - menu.offsetWidth;
    const vw = document.documentElement.clientWidth;
    if (left + menu.offsetWidth > vw + scrollX) left = vw + scrollX - menu.offsetWidth - 8;
    if (left < scrollX + 4) left = scrollX + 4;

    menu.style.top = top + "px";
    menu.style.left = left + "px";

    void menu.offsetWidth;
    menu.classList.add("visible");
  }

  function hideMenu() {
    menu.classList.remove("visible");
    setTimeout(() => {
      if (!menu.classList.contains("visible")) menu.style.display = "none";
    }, 220);
  }

  function showTooltip(target) {
    clearTimeout(tooltipTimeout);
    const coords = getCaretCoords(target);
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    if (coords) {
      tooltip.style.top = (coords.top - 34) + "px";
      tooltip.style.left = (coords.left + 4) + "px";
    } else {
      const rect = target.getBoundingClientRect();
      tooltip.style.top = (rect.bottom + scrollY + 8) + "px";
      tooltip.style.left = (rect.right + scrollX - tooltip.offsetWidth) + "px";
    }
    tooltip.classList.add("visible");
    tooltipTimeout = setTimeout(() => tooltip.classList.remove("visible"), 2000);
  }

  function showToast(message, type = "error") {
    clearTimeout(toastTimeout);
    toast.textContent = type === "error" ? `⚠ ${message}` : `✓ ${message}`;
    toast.className = `${type} visible`;
    toast.style.display = "flex";
    toastTimeout = setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => (toast.style.display = "none"), 300);
    }, 3500);
  }

  function setLoading(loading) {
    isLoading = loading;
    btn.classList.toggle("loading", loading);
  }

  function flashSuccess(el) {
    el.classList.add("writeright-success-flash");
    setTimeout(() => el.classList.remove("writeright-success-flash"), 900);
  }

  // ── Core flow ────────────────────────────────

  async function improve(mode) {
    hideMenu();

    if (!activeElement) return;
    const text = getText(activeElement).trim();

    if (!text) {
      showTooltip(activeElement);
      return;
    }

    setLoading(true);

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "WRITERIGHT_IMPROVE", mode, text },
          (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!res) {
              reject(new Error("No response from background"));
              return;
            }
            resolve(res);
          }
        );
      });

      if (response.error === "NO_API_KEY") {
        showToast("API key missing — click the WriteRight extension icon to add it.", "error");
        // Also try to open the popup
        chrome.runtime.sendMessage({ type: "WRITERIGHT_OPEN_POPUP" });
        return;
      }

      if (response.error) {
        showToast(response.error, "error");
        return;
      }

      if (response.result) {
        setText(activeElement, response.result);
        flashSuccess(activeElement);
        showToast("Text improved!", "success");
      }
    } catch (err) {
      showToast(err.message || "Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Event wiring ────────────────────────────

  /**
   * Check if a DOM event target belongs to our activeElement.
   * For contenteditable, events fire on inner spans/divs,
   * so we check containment as well as identity.
   */
  function isInsideActive(target) {
    if (!activeElement || !target) return false;
    if (target === activeElement) return true;
    // target is a child of activeElement (contenteditable inner nodes)
    if (activeElement.contains && activeElement.contains(target)) return true;
    // target resolves to the same editable
    const resolved = resolveEditable(target);
    return resolved && resolved === activeElement;
  }

  // Focus into text fields — track and show if already has text
  document.addEventListener(
    "focusin",
    (e) => {
      const el = resolveEditable(e.target);
      if (el && isTextInput(el)) {
        activeElement = el;
        // If field already has text, show the button
        if (getText(el).trim()) {
          setTimeout(() => {
            if (activeElement === el) showBtnAtCaret();
          }, 120);
        }
      }
    },
    true
  );

  // Input event — show/reposition button when user types
  document.addEventListener(
    "input",
    (e) => {
      if (!isInsideActive(e.target)) return;
      const text = getText(activeElement).trim();
      if (text) {
        setTimeout(() => showBtnAtCaret(), 30);
      } else {
        hideBtn();
      }
    },
    true
  );

  // Keyup fallback — some sites (Slack, WhatsApp) suppress input events
  document.addEventListener(
    "keyup",
    (e) => {
      // Ignore modifier-only presses
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      if (!isInsideActive(e.target)) return;
      const text = getText(activeElement).trim();
      if (text && !btn.classList.contains("visible")) {
        setTimeout(() => showBtnAtCaret(), 50);
      } else if (!text) {
        hideBtn();
      }
    },
    true
  );

  // Click outside → hide
  document.addEventListener(
    "mousedown",
    (e) => {
      // If clicking the button, menu, or inside the active element, ignore
      if (root.contains(e.target)) return;
      const el = resolveEditable(e.target);
      if (el && el === activeElement) return;

      hideTimeout = setTimeout(() => {
        hideBtn();
        activeElement = null;
      }, 150);
    },
    true
  );

  // Button click → check for text and show menu
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (isLoading) return;

    if (!activeElement || !getText(activeElement).trim()) {
      showTooltip(activeElement || btn);
      return;
    }

    if (menu.classList.contains("visible")) {
      hideMenu();
    } else {
      showMenu();
    }
  });

  // Mode selection
  menu.addEventListener("click", (e) => {
    const modeBtn = e.target.closest(".wr-mode-btn");
    if (!modeBtn) return;
    e.stopPropagation();
    e.preventDefault();
    const mode = modeBtn.dataset.mode;
    improve(mode);
  });

  // Reposition on scroll / resize
  const reposition = () => {
    if (activeElement && btn.classList.contains("visible")) {
      showBtnAtCaret();
    }
  };
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });

  // ── Keyboard shortcuts ──────────────────────
  // Ctrl+1 → Normal Human mode
  // Ctrl+2 → CEO Mode
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.ctrlKey || isLoading) return;

      if (e.key === "1") {
        e.preventDefault();
        e.stopPropagation();
        improve("normal");
      } else if (e.key === "2") {
        e.preventDefault();
        e.stopPropagation();
        improve("ceo");
      }
    },
    true
  );
})();
