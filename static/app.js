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

  let currentAudio = null;
  let isListening = false;
  let recognition = null;

  // =================================================================
  // 1. إعداد التعرف على الصوت عبر المتصفح (Web Speech API)
  // =================================================================
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "ar-EG"; // اللهجة المصرية
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
  } else {
    console.warn("Web Speech API غير مدعوم في هذا المتصفح.");
  }

  function startListening() {
    if (!recognition) {
      alert("متصفحك لا يدعم التعرف المباشر على الصوت. يُفضل استخدام متصفح Chrome أو Edge، أو كتابة السؤال بالأسفل.");
      return;
    }
    // إيقاف أي صوت شغال حالياً
    if (currentAudio) {
      currentAudio.pause();
      stopEqualizer();
    }
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

  // زر المايك
  micBtn.addEventListener("click", () => {
    if (isListening) {
      recognition && recognition.stop();
      stopListening();
    } else {
      startListening();
    }
  });

  // =================================================================
  // 2. إرسال الرسالة إلى الـ API مع تدفق النص المباشر (Streaming)
  // =================================================================
  async function handleUserMessage(message) {
    if (!message) return;

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
        buffer = events.pop(); // الاحتفاظ بالبيانات غير المكتملة

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
            } else if (data.type === "done") {
              botMsg.finish(data.reply, data.audio_base64);
              if (data.audio_base64) {
                playAudioBase64(data.audio_base64);
              } else {
                setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
              }
            } else if (data.type === "error") {
              botMsg.showError(data.message || "حدث خطأ أثناء معالجة الطلب.");
              setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
            }
          } catch (e) {
            console.warn("Error parsing SSE data", e, trimmed);
          }
        }
      }

    } catch (err) {
      console.error(err);
      botMsg.showError("عذراً، حدث خطأ أثناء الاتصال بالخادم. يرجى المحاولة مرة أخرى.");
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
      finish(fullText, audioB64) {
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

        if (audioB64) {
          const replayBtn = document.createElement("button");
          replayBtn.className = "replay-audio-btn";
          replayBtn.innerHTML = "🔊 استماع للرد";
          replayBtn.onclick = () => playAudioBase64(audioB64);
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
  // 3. تشغيل الصوت في المتصفح فائق السرعة
  // =================================================================
  function playAudioBase64(b64Data) {
    if (currentAudio) {
      currentAudio.pause();
    }

    currentAudio = new Audio("data:audio/mp3;base64," + b64Data);

    currentAudio.onplay = () => {
      startEqualizer();
      setStatus("speaking", "المساعد يتحدث الآن... 🔊");
    };

    currentAudio.onended = () => {
      stopEqualizer();
      setStatus("ready", "جاهز للاستماع... اضغط على المايك");
    };

    currentAudio.onerror = (e) => {
      console.error("Audio error", e);
      stopEqualizer();
      setStatus("ready", "اضغط على المايك وتحدث باللغة العربية");
    };

    currentAudio.play().catch(e => {
      console.warn("Autoplay was prevented by browser policy", e);
      stopEqualizer();
      setStatus("ready", "اضغط على زر الاستماع بجانب الرسالة لسماع الرد");
    });
  }

  function startEqualizer() {
    equalizer.classList.add("active");
  }

  function stopEqualizer() {
    equalizer.classList.remove("active");
  }

  // =================================================================
  // 4. تحديث حالة الواجهة (Status Pill)
  // =================================================================
  function setStatus(state, text) {
    statusDot.className = "status-dot";
    if (state !== "ready") {
      statusDot.classList.add(state);
    }
    statusText.textContent = text;
  }

  // =================================================================
  // 5. إضافة الرسائل لصندوق المحادثة
  // =================================================================
  function addMessageToChat(sender, text, audioB64 = null) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-message ${sender}-message`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = sender === "user" ? "👤" : "🤖";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // تحويل الأسطر الجديدة إلى فقرات
    const formatted = text.split("\n").filter(l => l.trim() !== "").map(p => `<p>${escapeHTML(p)}</p>`).join("");
    contentDiv.innerHTML = formatted;

    // زر إعادة الاستماع للصوت
    if (audioB64) {
      const replayBtn = document.createElement("button");
      replayBtn.className = "replay-audio-btn";
      replayBtn.innerHTML = "🔊 استماع للرد";
      replayBtn.onclick = () => playAudioBase64(audioB64);
      contentDiv.appendChild(replayBtn);
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentDiv);
    chatBox.appendChild(msgDiv);

    // سكرول للأسفل
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
  // 6. التعامل مع الإدخال الكتابي
  // =================================================================
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = textInput.value.trim();
    if (query) {
      textInput.value = "";
      handleUserMessage(query);
    }
  });

  // =================================================================
  // 7. زر مسح الذاكرة
  // =================================================================
  resetBtn.addEventListener("click", async () => {
    if (confirm("هل ترغب في بدء محادثة جديدة ومسح الذاكرة؟")) {
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
