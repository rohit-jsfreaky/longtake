/**
 * Says why Longtake could not open on this page, in words a person can act on.
 *
 * The popup is set for this one tab only, just before it opens; clearing it straight away means
 * the next click on the icon tries the page again instead of showing this again.
 */

const REASONS = {
  // Browser pages, the extension store, the PDF viewer: no extension may run on these.
  blocked: {
    lead: "Longtake can't run on this page.",
    detail: "Browser pages, the extension store and PDFs don't allow extensions. Open the form on a normal web page and click Longtake there.",
    reload: false,
  },
  // Injection failed for a reason we did not expect: a reload is the one thing that always helps.
  failed: {
    lead: "Longtake couldn't start on this page.",
    detail: "Reload the page, then click Longtake again.",
    reload: true,
  },
};

const params = new URLSearchParams(location.search);
const reason = REASONS[params.get("why")] ?? REASONS.failed;
const tabId = Number(params.get("tab"));

document.getElementById("lead").textContent = reason.lead;
document.getElementById("detail").textContent = reason.detail;

const reload = document.getElementById("reload");
if (reason.reload && Number.isFinite(tabId)) {
  reload.hidden = false;
  reload.addEventListener("click", async () => {
    await chrome.tabs.reload(tabId);
    window.close();
  });
}

if (Number.isFinite(tabId)) {
  void chrome.action.setPopup({ tabId, popup: "" });
  void chrome.action.setBadgeText({ tabId, text: "" });
}
