// ──────────────────────────────────────────────
// WriteRight AI — Popup Script
// Manages saving, deleting, and visibility toggling for the Groq API key.
// ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("api-key-input");
  const saveBtn = document.getElementById("save-btn");
  const clearBtn = document.getElementById("clear-btn");
  const toggleVisibilityBtn = document.getElementById("toggle-visibility-btn");
  
  const statusCard = document.getElementById("status-card");
  const statusIcon = document.getElementById("status-icon");
  const statusText = document.getElementById("status-text");
  const statusSub = document.getElementById("status-sub");

  // Load the current key state
  chrome.storage.sync.get("groqApiKey", (data) => {
    const key = data.groqApiKey || "";
    updateUI(key);
  });

  // Save key click handler
  saveBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showTemporaryStatus(saveBtn, "Key cannot be empty!", true);
      return;
    }

    chrome.storage.sync.set({ groqApiKey: key }, () => {
      updateUI(key);
      showTemporaryStatus(saveBtn, "Saved!");
    });
  });

  // Clear key click handler
  clearBtn.addEventListener("click", () => {
    chrome.storage.sync.remove("groqApiKey", () => {
      updateUI("");
      showTemporaryStatus(saveBtn, "Cleared!");
    });
  });

  // Toggle key visibility handler
  toggleVisibilityBtn.addEventListener("click", () => {
    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleVisibilityBtn.textContent = "🙈";
    } else {
      apiKeyInput.type = "password";
      toggleVisibilityBtn.textContent = "👁️";
    }
  });

  // Helper to dynamically update status card & fields based on key presence
  function updateUI(key) {
    if (key) {
      apiKeyInput.value = key;
      clearBtn.classList.remove("hidden");
      
      statusCard.className = "status-card key-active";
      statusIcon.textContent = "✅";
      statusText.textContent = "API Key Active";
      statusSub.textContent = "Groq · Llama 3 · Ready to use";
    } else {
      apiKeyInput.value = "";
      clearBtn.classList.add("hidden");
      
      statusCard.className = "status-card key-missing";
      statusIcon.textContent = "⚠️";
      statusText.textContent = "API Key Missing";
      statusSub.textContent = "Add a Groq API key to activate WriteRight";
    }
  }

  // Visual helper to give users interactive feedback
  function showTemporaryStatus(button, message, isError = false) {
    const originalText = button.textContent;
    button.textContent = message;
    button.disabled = true;
    
    if (isError) {
      button.style.background = "rgba(239, 68, 68, 0.8)";
    }

    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
      button.style.background = "";
    }, 1500);
  }
});
