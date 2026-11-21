require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { SpeechClient } = require("@google-cloud/speech").v1p1beta1;
const fs = require("fs").promises;
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const credentials = require("./service-account.json");
const speechClient = new SpeechClient({ credentials });

// Gemini API setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // Use environment variable
const genai = new GoogleGenerativeAI(GEMINI_API_KEY);

let recognizeStream = null;
let currentTranscript = "";

app.use(express.static("."));

io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("request-initial-state", async () => {
    const transcript = currentTranscript;
    const summary = await fs
      .readFile("live_bengali_text.txt", { encoding: "utf8" })
      .catch(() => "");
    socket.emit("initial-state", {
      transcript,
      summary,
      status: recognizeStream ? "Status: Listening..." : "Status: Ready",
    });
  });

  socket.on("start-recognition", () => {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
    try {
      recognizeStream = speechClient.streamingRecognize({
        config: {
          encoding: "WEBM_OPUS",
          sampleRateHertz: 16000,
          languageCode: "bn-BD",
          enableAutomaticPunctuation: true,
          model: "latest_long",
          singleUtterance: false,
        },
        interimResults: true,
      });

      let previousTranscript = "";
      recognizeStream
        .on("data", async (data) => {
          if (data.results[0] && data.results[0].alternatives[0]) {
            const transcript = data.results[0].alternatives[0].transcript;
            if (data.results[0].isFinal) {
              // Extract the new turn by removing the previous transcript
              const newTurn = previousTranscript
                ? transcript.replace(previousTranscript, "").trim()
                : transcript.trim();
              currentTranscript += newTurn + "\n";
              previousTranscript = transcript;

              try {
                await fs.appendFile("live_bengali_text.txt", newTurn + "\n", {
                  encoding: "utf8",
                });
              } catch (err) {
                console.error("Error appending to file:", err);
                socket.emit("error", "Failed to append transcript to file");
              }

              // Emit the new turn and the full transcript
              socket.emit("transcript", {
                newTurn: newTurn,
                fullTranscript: currentTranscript,
              });
            } else {
              // For interim results, send the current transcript
              socket.emit("transcript", {
                newTurn: transcript.replace(previousTranscript, "").trim(),
                fullTranscript: currentTranscript + transcript,
              });
            }
          }
        })
        .on("error", (error) => {
          console.error("Stream error:", error.message);
          socket.emit("error", `Recognition error: ${error.message}`);
          recognizeStream = null;
        })
        .on("end", () => {
          socket.emit("stream-ended");
          recognizeStream = null;
        });
    } catch (error) {
      console.error("Failed to start recognition stream:", error);
      socket.emit("error", `Failed to start recognition: ${error.message}`);
    }
  });
  socket.on("audio-chunk", (data) => {
    if (recognizeStream) {
      recognizeStream.write(data);
    } else {
      socket.emit("error", "No active recognition stream");
    }
  });

  socket.on("stop-recognition", () => {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
  });

  socket.on("clear-file", async () => {
    try {
      await fs.writeFile("live_bengali_text.txt", "", { encoding: "utf8" });
      currentTranscript = "";
      socket.emit("file-cleared", "live_bengali_text.txt cleared");
    } catch (err) {
      console.error("Error clearing file:", err);
      socket.emit("error", "Failed to clear live_bengali_text.txt");
    }
  });

  socket.on("disconnect", async () => {
    console.log("Client disconnected");
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
    currentTranscript = "";
    try {
      await fs.writeFile("live_bengali_text.txt", "", { encoding: "utf8" });
    } catch (err) {
      console.error("Error clearing file on disconnect:", err);
    }
  });
});

// Summarize endpoint
app.get("/summarize", async (req, res) => {
  try {
    const textToSummarize = await fs.readFile("live_bengali_text.txt", {
      encoding: "utf8",
    });

    if (!textToSummarize.trim() || textToSummarize.trim() === "।") {
      return res.json({ summary: "কোন টেক্সট পাওয়া যায়নি।" });
    }

    const prompt = `
      নীচের লেখাটি একজন ডাক্তার ও একজন রোগীর মধ্যে একটি কথোপকথন।

      এই কথোপকথনের **সংক্ষিপ্ত সারাংশ বাংলায় তৈরি করো**।
      তুমি **শুধুমাত্র তথ্যভিত্তিক সারাংশ দিবে** — **কোনো ব্যাখ্যা, বিশ্লেষণ, পরামর্শ বা অতিরিক্ত মন্তব্য দিবে না**।
      **সারাংশে কেবল মূল উপসর্গ, পর্যবেক্ষণ ও পরবর্তী পদক্ষেপ থাকবে**।

      টেক্সট:
      ${textToSummarize}
    `;

    const model = genai.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    if (!summary || !summary.trim()) {
      return res.json({ summary: "ত্রুটি: কোনো সারাংশ পাওয়া যায়নি।" });
    }

    res.json({ summary: summary.trim() });
  } catch (error) {
    console.error("Summarization error:", error);
    res.json({ error: `সারাংশ তৈরি করতে ব্যর্থ হয়েছে: ${error.message}` });
  }
});
// Suggestion endpoint
app.get("/suggest", async (req, res) => {
  try {
    const textToSuggest = await fs.readFile("live_bengali_text.txt", {
      encoding: "utf8",
    });

    if (!textToSuggest.trim() || textToSuggest.trim() === "।") {
      return res.json({ suggestion: "কোন টেক্সট পাওয়া যায়নি।" });
    }

    const prompt = `
      নীচের লেখাটি একজন ডাক্তার ও একজন রোগীর মধ্যে একটি কথোপকথন বা তার সারাংশ। এই অ্যাপ্লিকেশনটি ডাক্তারদের জন্য তৈরি করা হয়েছে।

      এই কথোপকথনের উপর ভিত্তি করে **চিকিৎসা পরামর্শ এবং ওষুধের সুপারিশ প্রদান করো** বাংলায়। পরামর্শগুলো **শুধুমাত্র রোগীর উপসর্গ, ডাক্তারের পর্যবেক্ষণ এবং কথোপকথনে উল্লিখিত তথ্যের উপর ভিত্তি করে হবে**।

      **ওষুধের সুপারিশ**:
      - যদি ডাক্তার কোনো নির্দিষ্ট ওষুধ উল্লেখ করেন, তবে সেটি স্পষ্টভাবে অন্তর্ভুক্ত করো।
      - যদি ওষুধ উল্লেখ না থাকে, তবে উপসর্গের জন্য উপযুক্ত ওভার-দ্য-কাউন্টার (OTC) ওষুধ (যেমন, জ্বরের জন্য প্যারাসিটামল, বমির জন্য ওন্ডানসেট্রন) বা প্রেসক্রিপশন ওষুধ (যেমন, কাশির জন্য কোডিন, সংক্রমণের জন্য অ্যামোক্সিসিলিন) সুপারিশ করতে পারো।
      - প্রতিটি ওষুধের জন্য:
        - **থেরাপিউটিক প্রভাব** উল্লেখ করো (যেমন, "প্যারাসিটামল জ্বর কমায়")।
        - **সাধারণ পার্শ্বপ্রতিক্রিয়া বা সতর্কতা** উল্লেখ করো (যেমন, "অতিরিক্ত ডোজে লিভারের ক্ষতি হতে পারে")।
        - সাধারণ ডোজের পরামর্শ দাও (যেমন, "প্যারাসিটামল ৫০০ মিগ্রা প্রতি ৬ ঘণ্টায়"), তবে উল্লেখ করো যে ডোজ রোগীর অবস্থা অনুযায়ী নির্ধারণ করতে হবে।
      - গুরুতর উপসর্গ (যেমন, কাশির সাথে রক্ত) থাকলে, বিশেষজ্ঞের সাথে যোগাযোগ বা জরুরি ব্যবস্থার পরামর্শ দাও।

      **অন্যান্য পরামর্শ**:
      - সাধারণ পরামর্শ যেমন বিশ্রাম, পানি পান, বা ডায়েট সুপারিশ করো।
      - পরবর্তী পদক্ষেপ (যেমন, ফলো-আপ বা ডায়াগনস্টিক পরীক্ষা) উল্লেখ করো।

      **শর্ত**:
      - পরামর্শগুলো **সংক্ষিপ্ত, স্পষ্ট এবং তথ্যভিত্তিক হবে**।
      - **কোনো নতুন তথ্য বা অনুমান যোগ করবে না**।
      - গুরুতর উপসর্গ (যেমন, রক্তযুক্ত কাশি) থাকলে, জরুরি ব্যবস্থার উপর জোর দাও।

      টেক্সট:
      ${textToSuggest}
    `;
    // Combine system and user messages into a single prompt for Gemini
    const messages = [
      {
        role: "system",
        content:
          "You are a medical assistant providing concise, evidence-based advice in Bengali.",
      },
      { role: "user", content: prompt },
    ];

    // Concatenate system and user content
    const combinedPrompt = `${messages[0].content}\n\n${messages[1].content}`;
    const model = genai.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const result = await model.generateContent(combinedPrompt);
    const response = await result.response;
    const suggestion = response.text();

    if (!suggestion || !suggestion.trim()) {
      return res.json({ suggestion: "ত্রুটি: কোনো পরামর্শ পাওয়া যায়নি।" });
    }

    res.json({ suggestion: suggestion.trim() });
  } catch (error) {
    console.error("Suggestion error:", error);
    res.json({ error: `পরামর্শ তৈরি করতে ব্যর্থ হয়েছে: ${error.message}` });
  }
});
server.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});
