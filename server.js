import express from "express";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "2mb" }));

// Serve static build files in production
app.use(express.static(path.join(__dirname, "dist")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", provider: "Groq (Free)" });
});

// Summarize endpoint — receives transcript from client (avoids cloud IP blocking)
app.post("/api/summarize", async (req, res) => {
  const { transcript, language } = req.body;

  if (!transcript || !language) {
    return res.status(400).json({ error: "Missing transcript or language" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is not configured. Add GROQ_API_KEY to .env file. Get a free key at https://console.groq.com",
    });
  }

  // Trim transcript to ~12000 words to stay within context limits
  let transcriptText = transcript;
  const words = transcriptText.split(" ");
  if (words.length > 12000) {
    transcriptText = words.slice(0, 12000).join(" ") + "...";
  }

  // Summarize with Groq (Llama 3)
  try {
    const groq = new Groq({ apiKey });

    const prompt = `You are an expert video summarizer. Below is the transcript of a YouTube video. Please provide a comprehensive summary entirely in ${language}.

TRANSCRIPT:
${transcriptText}

Please structure your response in Markdown with the following sections:
1. A concise title as an H1 heading (## Title)
2. ## Overview — A 2-3 paragraph high-level summary
3. ## Key Takeaways — A bulleted list of 5-8 key points
4. ## Tone & Sentiment — A brief note on the video's overall tone

Respond entirely in ${language}. Use proper Markdown formatting.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2048,
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("Empty response from AI");

    res.json({ summary: text });
  } catch (err) {
    console.error("Groq API error:", err);
    if (err.status === 401) {
      return res.status(401).json({
        error: "Invalid Groq API key. Get a free key at https://console.groq.com",
      });
    }
    if (err.status === 429) {
      return res.status(429).json({
        error: "Rate limit reached. Please wait a moment and try again.",
      });
    }
    res.status(500).json({ error: err.message || "An unexpected error occurred." });
  }
});

// Serve React app for all other routes in production
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 YT Summarizer running at http://localhost:${PORT}`);
  console.log(`   ✅ Using: Groq AI (Free) — llama-3.3-70b-versatile`);
  console.log(`   📡 API:   http://localhost:${PORT}/api/summarize\n`);
});
