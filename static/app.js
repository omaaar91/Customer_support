document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const micBtn = document.getElementById("micBtn");
  const visualizerContainer = document.getElementById("visualizerContainer");
  const equalizer = document.getElementById("equalizer");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const chatBox = document.getElementById("chatBox");
  const chatForm = document.getElementById("chatForm");
  const textInput = document.getElementById("textInput");
  const voiceSelect = document.getElementById("voiceSelect");
  const resetBtn = document.getElementById("resetBtn");

  let isListening = false;
  let recognition = null;
  let activeAudio = null;

  // فك حظر تشغيل الصوت في المتصفح تلقائياً عند أول نقرة
  function unlockAudioContext() {
    try {
      const silentAudio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
      silentAudio.play().catch(() => {});
    } catch (e) {}
  }
  document.addEventListener("click", unlockAudioContext, { once: true });

  // =================================================================
  // 1. نظام تشغيل الصوت الذكي (يدعم البث السريع + الصوت الكامل كأمان)
  // =================================================================
  class VoicePlaybackManager {
    constructor() {
      this.queue = [];
      this.isPlaying = false;
      this.chunksReceived = 0;
      this.hasPlayedAnyChunk = false;
    }

    reset() {
      this.stop();
      this.queue = [];
      this.chunksReceived = 0;
      this.hasPlayedAnyChunk = false;
    }

    stop() {
      this.isPlaying = false;
      if (activeAudio) {
        try {
          activeAudio.pause();
          activeAudio.currentTime = 0;
        } catch (e) {}
        activeAudio = null;
      }
      this.queue = [];
      stopEqualizer();
    }

    enqueueChunk(b64Audio) {
      if (!b64Audio) return;
      this.chunksReceived++;
      this.queue.push(b64Audio);
      if (!this.isPlaying) {
        this.playNext();
      }
    }

    playNext() {
      if (this.queue.length === 0) {
        this.isPlaying = false;
        activeAudio = null;
        stopEqualizer();
        setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
        return;
      }

      this.isPlaying = true;
      const b64 = this.queue.shift();

      try {
        if (activeAudio) {
          activeAudio.pause();
        }

        activeAudio = new Audio("data:audio/mp3;base64," + b64);
        startEqualizer();
        setStatus("speaking", "المساعد يتحدث الآن... 🔊");

        activeAudio.onended = () => {
          this.hasPlayedAnyChunk = true;
          this.playNext();
        };

        activeAudio.onerror = (err) => {
          console.warn("Chunk playback error:", err);
          this.playNext();
        };

        activeAudio.play().then(() => {
          this.hasPlayedAnyChunk = true;
        }).catch((err) => {
          console.warn("Autoplay blocked for chunk, skipping:", err);
          this.playNext();
        });
      } catch (err) {
        console.error("Audio error:", err);
        this.playNext();
      }
    }

    // تشغيل ملف صوتي كامل (سواء في حالة عدم وصول أجزاء أو عند الضغط على إعادة الاستماع)
    playFull(b64Audio) {
      if (!b64Audio) return;
      this.stop();

      try {
        activeAudio = new Audio("data:audio/mp3;base64," + b64Audio);
        startEqualizer();
        setStatus("speaking", "المساعد يتحدث الآن... 🔊");

        activeAudio.onended = () => {
          stopEqualizer();
          setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
          activeAudio = null;
        };

        activeAudio.onerror = (e) => {
          console.error("Full audio error", e);
          stopEqualizer();
          setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
          activeAudio = null;
        };

        activeAudio.play().catch((err) => {
          console.warn("Autoplay prevented:", err);
          stopEqualizer();
          setStatus("ready", "اضغط على زر 🔊 استماع للرد لسماع الصوت");
        });
      } catch (e) {
        console.error("Error playing full audio:", e);
      }
    }
  }

  const voiceManager = new VoicePlaybackManager();

  // =================================================================
  // 2. إعداد التعرف على الصوت عبر المتصفح (Web Speech API)
  // =================================================================
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "ar-EG";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isListening = true;
      setStatus("listening", "جاري الاستماع إليك... تحدث الآن");
      visualizerContainer.classList.add("listening");
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript) {
        handleUserMessage(transcript);
      }
    };

    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      stopListening();
      if (event.error === "no-speech") {
        setStatus("ready", "لم يتم التقاط صوت. اضغط على المايك للمحاولة مجدداً.");
      } else {
        setStatus("ready", "تعذر التعرف على الصوت. يمكنك الكتابة بالأسفل.");
      }
    };

    recognition.onend = () => {
      stopListening();
    };
  }

  function startListening() {
    unlockAudioContext();
    if (!recognition) {
      alert("متصفحك لا يدعم التعرف المباشر على الصوت. يُفضل استخدام Chrome أو Edge، أو كتابة السؤال بالأسفل.");
      return;
    }
    voiceManager.stop();

    try {
      recognition.start();
    } catch (e) {
      console.warn("Recognition already started", e);
    }
  }

  function stopListening() {
    isListening = false;
    visualizerContainer.classList.remove("listening");
    if (statusDot.classList.contains("listening")) {
      setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
    }
  }

  micBtn.addEventListener("click", () => {
    unlockAudioContext();
    if (isListening) {
      recognition && recognition.stop();
      stopListening();
    } else {
      startListening();
    }
  });

  // =================================================================
  // 3. إرسال الرسالة إلى الـ API مع تدفق النص والصوت الفوري
  // =================================================================
  async function handleUserMessage(message) {
    if (!message) return;

    unlockAudioContext();
    voiceManager.reset();

    // إضافة رسالة المستخدم في الشات
    addMessageToChat("user", message);
    setStatus("thinking", "المساعد يراجع البيانات ويجهز الرد...");

    // إنشاء بالون الرد المباشر مع مؤشر الكتابة
    const botMsg = createBotStreamingMessage();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message,
          voice: voiceSelect.value,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error("فشل الاتصال بالخادم");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let receivedFirstToken = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();

        for (const event of events) {
          const trimmed = event.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.type === "token") {
              if (!receivedFirstToken) {
                receivedFirstToken = true;
                setStatus("thinking", "المساعد يكتب الرد الآن... ⚡");
              }
              botMsg.appendToken(data.content);
            } else if (data.type === "audio_chunk") {
              // مقطع صوتي سريع للجملة الحالية
              if (data.audio_base64) {
                voiceManager.enqueueChunk(data.audio_base64);
              }
            } else if (data.type === "done") {
              botMsg.finish(data.reply, data.audio_base64);

              // إذا لم تكن الأجزاء قد تم تشغيلها، شغل الصوت الكامل كـ Fallback فوري
              if (!voiceManager.hasPlayedAnyChunk && !voiceManager.isPlaying && data.audio_base64) {
                voiceManager.playFull(data.audio_base64);
              } else if (!voiceManager.isPlaying) {
                setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
              }
            } else if (data.type === "error") {
              botMsg.showError(data.message || "حدث خطأ أثناء معالجة الطلب.");
              voiceManager.stop();
              setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
            }
          } catch (e) {
            console.warn("Error parsing SSE data", e, trimmed);
          }
        }
      }

    } catch (err) {
      console.error("Chat error:", err);
      botMsg.showError("عذراً، حدث خطأ أثناء الاتصال بالخادم. يرجى المحاولة مرة أخرى.");
      voiceManager.stop();
      setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
    }
  }

  function createBotStreamingMessage() {
    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-message bot-message";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "🤖";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    const textBody = document.createElement("span");
    textBody.className = "stream-body";

    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    cursor.textContent = "▋";

    contentDiv.appendChild(textBody);
    contentDiv.appendChild(cursor);

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentDiv);
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    let accumulatedText = "";

    return {
      element: msgDiv,
      appendToken(token) {
        accumulatedText += token;
        const formatted = accumulatedText
          .split("\n")
          .map(p => escapeHTML(p))
          .join("<br>");
        textBody.innerHTML = formatted;
        chatBox.scrollTop = chatBox.scrollHeight;
      },
      finish(fullText, fullAudioB64) {
        if (cursor.parentNode) {
          cursor.remove();
        }
        const textToUse = fullText || accumulatedText;
        const formatted = textToUse
          .split("\n")
          .filter(l => l.trim() !== "")
          .map(p => `<p>${escapeHTML(p)}</p>`)
          .join("");
        textBody.innerHTML = formatted;

        // زر إعادة الاستماع لكامل الرد
        if (fullAudioB64) {
          const replayBtn = document.createElement("button");
          replayBtn.className = "replay-audio-btn";
          replayBtn.innerHTML = "🔊 استماع للرد";
          replayBtn.onclick = () => {
            unlockAudioContext();
            voiceManager.playFull(fullAudioB64);
          };
          contentDiv.appendChild(replayBtn);
        }
        chatBox.scrollTop = chatBox.scrollHeight;
      },
      showError(errMsg) {
        if (cursor.parentNode) {
          cursor.remove();
        }
        textBody.innerHTML = `<p style="color: var(--accent-red);">${escapeHTML(errMsg)}</p>`;
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    };
  }

  // =================================================================
  // 4. التحكم في مظهر موجات الصوت (Equalizer)
  // =================================================================
  function startEqualizer() {
    equalizer.classList.add("active");
  }

  function stopEqualizer() {
    equalizer.classList.remove("active");
  }

  // =================================================================
  // 5. تحديث حالة الواجهة (Status Pill)
  // =================================================================
  function setStatus(state, text) {
    statusDot.className = "status-dot";
    if (state !== "ready") {
      statusDot.classList.add(state);
    }
    statusText.textContent = text;
  }

  // =================================================================
  // 6. إضافة الرسائل لصندوق المحادثة
  // =================================================================
  function addMessageToChat(sender, text, audioB64 = null) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-message ${sender}-message`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = sender === "user" ? "👤" : "🤖";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    const formatted = text.split("\n").filter(l => l.trim() !== "").map(p => `<p>${escapeHTML(p)}</p>`).join("");
    contentDiv.innerHTML = formatted;

    if (audioB64) {
      const replayBtn = document.createElement("button");
      replayBtn.className = "replay-audio-btn";
      replayBtn.innerHTML = "🔊 استماع للرد";
      replayBtn.onclick = () => {
        unlockAudioContext();
        voiceManager.playFull(audioB64);
      };
      contentDiv.appendChild(replayBtn);
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentDiv);
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // =================================================================
  // 7. التعامل مع الإدخال الكتابي
  // =================================================================
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = textInput.value.trim();
    if (query) {
      unlockAudioContext();
      textInput.value = "";
      voiceManager.stop();
      handleUserMessage(query);
    }
  });

  // =================================================================
  // 8. زر مسح الذاكرة
  // =================================================================
  resetBtn.addEventListener("click", async () => {
    if (confirm("هل ترغب في بدء محادثة جديدة ومسح الذاكرة؟")) {
      voiceManager.stop();
      try {
        await fetch("/api/reset", { method: "POST" });
        chatBox.innerHTML = `
          <div class="chat-message bot-message">
            <div class="avatar">🤖</div>
            <div class="message-content">
              <p>تم بدء محادثة جديدة بنجاح! كيف يمكنني مساعدتك اليوم؟</p>
            </div>
          </div>
        `;
        setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
      } catch (e) {
        console.error("Reset error", e);
      }
    }
  });
});
