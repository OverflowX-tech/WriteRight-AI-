// ──────────────────────────────────────────────
// WriteRight AI — Background Service Worker
// Handles Groq API calls from the content script
// ──────────────────────────────────────────────

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPTS = {
  normal:
    "You are a helpful writing assistant. Fix grammar, spelling, and punctuation. Keep the tone casual, friendly, and natural like a real person texting. Do not make it formal. Return ONLY the corrected message, no explanation.",
  ceo:
    "You are an executive communication coach. Rewrite the message to sound confident, concise, and authoritative like a top-level executive. Fix all grammar and spelling. Remove filler words. Return ONLY the rewritten message, no explanation.",
};

/**
 * Fetch the API key from sync storage.
 * Resolves to the saved string key, or null if not configured.
 */
function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("groqApiKey", (data) => {
      resolve(data.groqApiKey || null);
    });
  });
}

/**
 * Call the Groq chat completions endpoint.
 */
async function callGroq(apiKey, mode, userText) {
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.normal;

  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.4,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorBody}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── Message listener ─────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "WRITERIGHT_IMPROVE") {
    (async () => {
      try {
        const apiKey = await getApiKey();
        if (!apiKey) {
          sendResponse({ error: "NO_API_KEY" });
          return;
        }
        const improved = await callGroq(apiKey, message.mode, message.text);
        sendResponse({ result: improved });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    // Return true to indicate we will respond asynchronously
    return true;
  }

  if (message.type === "WRITERIGHT_CHECK_KEY") {
    getApiKey().then((key) => sendResponse({ hasKey: !!key }));
    return true;
  }

  if (message.type === "WRITERIGHT_OPEN_POPUP") {
    // Open the extension popup programmatically (works in MV3)
    chrome.action.openPopup().catch(() => {
      // Fallback: some browsers don't support openPopup — just log
      console.log("WriteRight: Could not auto-open popup.");
    });
    return false;
  }
});
