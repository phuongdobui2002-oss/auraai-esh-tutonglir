import express from "express";
import path from "path";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import http from "http";
import { WebSocketServer } from "ws";

// Fix __dirname cho cả ESM lẫn CJS build
const __dirname = process.cwd();

// Import constants
import { SYSTEM_INSTRUCTIONS } from "./constants";

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (clientWs, request) => {
    try {
      const urlStr = request.url || "";
      const queryString = urlStr.includes("?") ? urlStr.split("?")[1] : "";
      const searchParams = new URLSearchParams(queryString);
      const mode = searchParams.get("mode") || "CONVERSATION";
      const currentDay = searchParams.get("currentDay");
      const dayGoal = searchParams.get("dayGoal");

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
      if (!apiKey) {
        clientWs.send(JSON.stringify({ type: "error", error: "GEMINI_API_KEY is not configured on the server." }));
        clientWs.close();
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      let systemInstruction = "";
      if (mode === "conversation" || mode === "CONVERSATION") {
        systemInstruction = SYSTEM_INSTRUCTIONS.CONVERSATION;
      } else if (mode === "ielts" || mode === "IELTS") {
        systemInstruction = SYSTEM_INSTRUCTIONS.IELTS;
      } else {
        systemInstruction = `${SYSTEM_INSTRUCTIONS.TUTOR_30_DAYS}\n\nROADMAP DAY ${currentDay || 1}. GOAL: ${dayGoal || "Self-introduction"}.`;
      }

      systemInstruction += `\n\nCRITICAL ADAPTATION RULE: Analyze the user's past messages in the history. 
- If they repeat grammar mistakes, gently correct them. 
- If they sound bored, change the topic. 
- If they use advanced words correctly, praise them. 
Always respond in English to keep the user immersed. Be a supportive mentor.`;

      systemInstruction += "\nIMPORTANT: Be highly responsive. Do not repeat greeting prompts when interrupted. Keep outputs conversational and natural.";

      console.log(`WebSocket connected: mode=${mode}`);

      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onmessage: (message) => {
            if (clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ type: "message", message }));
            }
          },
          onclose: () => {
            console.log("Gemini live session closed.");
            if (clientWs.readyState === 1 || clientWs.readyState === 0) {
              clientWs.close();
            }
          },
          onerror: (err) => {
            console.error("Gemini live session error:", err);
            if (clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ type: "error", error: err.message || String(err) }));
            }
          }
        },
      });

      clientWs.on("message", (rawMsg) => {
        try {
          const parsed = JSON.parse(rawMsg.toString());
          if (parsed.realtimeInput) {
            const audioData = parsed.realtimeInput.mediaChunks?.[0]?.data || parsed.realtimeInput.audio?.data;
            const mimeType = parsed.realtimeInput.mediaChunks?.[0]?.mimeType || parsed.realtimeInput.audio?.mimeType || "audio/pcm;rate=16000";
            if (audioData) {
              session.sendRealtimeInput({
                audio: { data: audioData, mimeType: mimeType }
              });
            }
          } else if (parsed.clientContent) {
            session.send({ clientContent: parsed.clientContent });
          }
        } catch (err: any) {
          console.error("Error processing client ws message:", err);
        }
      });

      clientWs.on("close", () => {
        console.log("Client disconnected. Closing Gemini session...");
        try { session.close(); } catch (e) {}
      });

    } catch (err: any) {
      console.error("WebSocket bridge failed:", err);
      try {
        if (clientWs.readyState === 1) {
          clientWs.send(JSON.stringify({ type: "error", error: err.message || String(err) }));
        }
        clientWs.close();
      } catch (e) {}
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url || "";
    const pathname = url.split("?")[0];
    if (pathname === "/api/live-ws") {
      wss.handleUpgrade(request, socket, head, (wsConnection) => {
        wss.emit("connection", wsConnection, request);
      });
    } else {
      socket.destroy();
    }
  });

  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/config", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
    res.json({ apiKey });
  });

  app.post("/api/chat", async (req, res) => {
    const { prompt, mode, history, currentDay, dayGoal } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
    }

    const ai = new GoogleGenAI({ apiKey });

    let systemInstruction = "";
    if (mode === "conversation" || mode === "CONVERSATION") {
      systemInstruction = SYSTEM_INSTRUCTIONS.CONVERSATION;
    } else if (mode === "ielts" || mode === "IELTS") {
      systemInstruction = SYSTEM_INSTRUCTIONS.IELTS;
    } else {
      systemInstruction = `${SYSTEM_INSTRUCTIONS.TUTOR_30_DAYS}\n\nROADMAP DAY ${currentDay}. GOAL: ${dayGoal}.`;
    }

    systemInstruction += `\n\nCRITICAL ADAPTATION RULE: Analyze the user's past messages in the history. 
- If they repeat grammar mistakes, gently correct them. 
- If they sound bored, change the topic. 
- If they use advanced words correctly, praise them. 
Always respond in English to keep the user immersed. Be a supportive mentor.`;

    const contents = history.map((msg: any) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    }));

    contents.push({ role: "user", parts: [{ text: prompt }] });

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.9,
        },
      });

      res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate response" });
    }
  });

  app.post("/api/summary", async (req, res) => {
    const { history } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
    }

    const ai = new GoogleGenAI({ apiKey });

    if (!history || history.length === 0) {
      return res.json({ topics: [], vocabulary: [], corrections: [], strengths: [], weaknesses: [] });
    }

    const cleanHistory = history.map((msg: any) => `${msg.role === "user" ? "Learner" : "Aura"}: ${msg.content}`).join("\n");

    const prompt = `Bạn là một trợ lý phân tích học tập. Hãy phân tích đoạn hội thoại học tiếng Anh sau đây giữa người học (Learner) và giáo viên AI Aura.
Trích xuất và tổng hợp thông tin bài học theo định dạng JSON chứa các trường sau:
1. 'topics': danh sách mảng 1-3 chủ đề chính đã trò chuyện (chuỗi tiếng Việt).
2. 'vocabulary': danh sách mảng các từ vựng mới/hay đã thảo luận hoặc học được. Mỗi từ là một đối tượng có:
   - 'word': từ hoặc cụm từ tiếng Anh.
   - 'meaning': nghĩa tiếng Việt giải thích đơn giản, chính xác.
   - 'context': ví dụ câu đặt từ đó trong ngữ cảnh thực tế (tiếng Anh).
3. 'corrections': danh sách các lỗi ngữ pháp hoặc diễn đạt mà Aura đã sửa hoặc phát hiện từ tin nhắn của Learner. Nếu không có thì để mảng rỗng. Mỗi lỗi là một đối tượng:
   - 'mistake': câu gốc sai hoặc chưa tự nhiên của Learner.
   - 'correction': câu đúng, tự nhiên hơn sau khi sửa.
   - 'explanation': giải thích ngắn gọn bằng tiếng Việt vì sao sai hoặc cách dùng từ đó tốt hơn.
4. 'strengths': danh sách 1-2 điểm mạnh trong cách giao tiếp hoặc từ vựng của người dùng (chuỗi tiếng Việt).
5. 'weaknesses': danh sách 1-2 điểm hạn chế hoặc cần lưu ý rèn luyện thêm (chuỗi tiếng Việt).

Hội thoại để phân tích:
${cleanHistory}

LƯU Ý QUAN TRỌNG: Chỉ phản hồi mã JSON hợp lệ khớp với cấu trúc được yêu cầu. Không thêm bất kỳ văn bản giải thích nào ngoài JSON.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topics: { type: Type.ARRAY, items: { type: Type.STRING } },
              vocabulary: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    context: { type: Type.STRING }
                  },
                  required: ["word", "meaning", "context"]
                }
              },
              corrections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    mistake: { type: Type.STRING },
                    correction: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                  },
                  required: ["mistake", "correction", "explanation"]
                }
              },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["topics", "vocabulary", "corrections", "strengths", "weaknesses"]
          }
        }
      });

      const text = response.text || "{}";
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("Summary API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate summary" });
    }
  });

  // Production: serve static files
  const distPath = path.join(__dirname, "dist");

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(distPath));
    // Fix Express 5: dùng /{*path} thay vì *
    app.get("/{*path}", (req: any, res: any) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Development: dùng Vite middleware
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();