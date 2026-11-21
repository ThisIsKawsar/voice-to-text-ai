const socket = io();
const recordToggleBtn = document.getElementById("record-toggle");
const refreshBtn = document.getElementById("refresh-btn");
const summaryBtn = document.getElementById("summary");
const transcriptSpan = document.getElementById("transcript");
const status = document.getElementById("status");
const transcriptsWrapper = document.querySelector(".transcripts-wrapper");
const summaryDiv = document.getElementById("summary_div");
const loadingOverlay = document.getElementById("loading-overlay");
let mediaRecorder = null;
let isRecording = false;

const toggleButtonState = (toRecording) => {
  if (toRecording) {
    recordToggleBtn.classList.remove("record");
    recordToggleBtn.classList.add("stop");
    recordToggleBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" id="stop_icon" viewBox="0 0 384 512" width="20" height="20" style="margin-right: 0px;">
        <path fill="#ffffff" d="M0 128C0 92.65 28.65 64 64 64H320C355.3 64 384 92.65 384 128V384C384 419.3 355.3 448 320 448H64C28.65 448 0 419.3 0 384V128z"></path>
      </svg>
    `;
    summaryDiv.style.display = "none";
  } else {
    recordToggleBtn.classList.remove("stop");
    recordToggleBtn.classList.add("record");
    recordToggleBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" id="microphone_icon" viewBox="0 0 384 512" width="20" height="20" style="margin-right: 0px;">
        <path fill="#ffffff" d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z"></path>
      </svg>
    `;
    summaryDiv.style.display = "block";
  }
};

const initializeMediaRecorder = (stream) => {
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "audio/webm;codecs=opus",
  });

  mediaRecorder.ondataavailable = (event) => {
    if (isRecording && event.data.size > 0) {
      socket.emit("audio-chunk", event.data);
    }
  };

  mediaRecorder.onstop = () => {
    console.log("MediaRecorder stopped");
    stream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null; // Clear mediaRecorder
  };

  mediaRecorder.start(100);
  mediaRecorder.pause();
};

const initializeMicrophone = (retries = 3, delay = 2000) => {
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      initializeMediaRecorder(stream);
      status.textContent = "Status: Microphone initialized";
    })
    .catch((err) => {
      if (retries > 0) {
        status.textContent = `Microphone error: ${err.message}. Retrying...`;
        setTimeout(() => initializeMicrophone(retries - 1, delay), delay);
      } else {
        status.textContent = `Microphone initialization failed: ${err.message}`;
        console.error("Microphone initialization error:", err);
        recordToggleBtn.disabled = true;
      }
    });
};

// Check microphone permission
navigator.permissions.query({ name: "microphone" }).then((result) => {
  if (result.state === "denied") {
    status.textContent =
      "Microphone access denied. Please enable it in your browser settings.";
    recordToggleBtn.disabled = true;
  } else {
    initializeMicrophone();
  }
});

const startRecording = () => {
  if (!mediaRecorder) {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        initializeMediaRecorder(stream);
        mediaRecorder.resume();
        isRecording = true;
        socket.emit("start-recognition");
        status.textContent = "Status: Listening...";
        toggleButtonState(true);
        transcriptsWrapper.style.display = "block";
      })
      .catch((err) => {
        status.textContent = `Microphone error: ${err.message}`;
        console.error("Microphone error:", err);
      });
  } else {
    mediaRecorder.resume();
    isRecording = true;
    socket.emit("start-recognition");
    status.textContent = "Status: Listening...";
    toggleButtonState(true);
    transcriptsWrapper.style.display = "block";
  }
};

const stopRecording = () => {
  if (mediaRecorder) {
    mediaRecorder.stop(); // This will trigger onstop and clean up tracks
  }
  isRecording = false;
  socket.emit("stop-recognition");
  status.textContent = "Status: Stopped";
  toggleButtonState(false);
};

recordToggleBtn.addEventListener("click", () => {
  if (!isRecording) {
    console.log("Start recording");

    startRecording();
  } else {
    stopRecording();
  }
  refreshBtn.disabled = false;
  summaryBtn.disabled = false;
});

refreshBtn.addEventListener("click", () => {
  socket.emit("clear-file");
});

summaryBtn.addEventListener("click", async () => {
  loadingOverlay.style.display = "flex";

  try {
    // Fetch summary
    const summaryResponse = await fetch("/summarize");
    const summaryData = await summaryResponse.json();

    if (summaryData.summary) {
      document.getElementById("summaryOutput").textContent =
        summaryData.summary;

      // summaryDiv.style.display = "block";

      // Fetch suggestion after summary is received
      const suggestionResponse = await fetch("/suggest");
      const suggestionData = await suggestionResponse.json();

      if (suggestionData.suggestion) {
        document.getElementById("suggestionOutput").textContent =
          suggestionData.suggestion;
      } else if (suggestionData.error) {
        status.textContent = `Suggestion Error: ${suggestionData.error}`;
        console.error("Suggestion error:", suggestionData.error);
        document.getElementById("suggestionOutput").textContent =
          "পরামর্শ তৈরি করতে ব্যর্থ হয়েছে।";
      }
    } else if (summaryData.error) {
      status.textContent = `Summary Error: ${summaryData.error}`;
      console.error("Summarization error:", summaryData.error);
      document.getElementById("summaryOutput").textContent =
        "সারাংশ তৈরি করতে ব্যর্থ হয়েছে।";
    }
  } catch (error) {
    status.textContent = `Error: Failed to fetch summary or suggestion`;
    console.error("Fetch error:", error);
    document.getElementById("summaryOutput").textContent =
      "সারাংশ তৈরি করতে ব্যর্থ হয়েছে।";
    document.getElementById("suggestionOutput").textContent =
      "পরামর্শ তৈরি করতে ব্যর্থ হয়েছে।";
  } finally {
    loadingOverlay.style.display = "none";
  }
});
socket.on("connect", () => {
  socket.emit("request-initial-state");
});

socket.on("initial-state", (data) => {
  transcriptSpan.textContent = data.transcript || "";
  document.getElementById("summaryOutput").textContent = data.summary || "";
  transcriptsWrapper.style.display = data.transcript ? "block" : "none";
  summaryDiv.style.display = data.summary ? "block" : "none";
  status.textContent = data.status || "Status: Ready";
});

socket.on("file-cleared", (message) => {
  transcriptSpan.textContent = "";
  document.getElementById("summaryOutput").textContent = "";
  transcriptsWrapper.style.display = "none";
  summaryDiv.style.display = "none";
  status.textContent = "Status: File cleared";
  window.location.reload();
});

socket.on("transcript", (data) => {
  if (data.newTurn || data.fullTranscript) {
    // Split full transcript into turns for display
    const turns = data.fullTranscript.split("\n").filter((turn) => turn.trim());
    transcriptSpan.innerHTML = turns
      .map((turn, index) => `<div><strong>:</strong> ${turn}</div>`)
      .join("");
    transcriptsWrapper.style.display = "block";
  }
});

socket.on("error", (error) => {
  status.textContent = `Error: ${error}`;
  console.error("Socket error:", error);
  if (mediaRecorder) {
    stopRecording();
  }
});

socket.on("stream-ended", () => {
  status.textContent = "Status: Stream ended, restarting...";

  if (isRecording) {
    socket.emit("start-recognition");
  }
});

socket.on("reconnect", () => {
  if (isRecording) {
    socket.emit("start-recognition");
  }
});
