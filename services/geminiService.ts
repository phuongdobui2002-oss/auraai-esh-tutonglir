
import { TutorMode, Message, SessionSummary } from "../types";

export const getGeminiResponse = async (
  prompt: string,
  mode: TutorMode,
  history: Message[],
  currentDay?: number,
  dayGoal?: string
): Promise<string> => {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        mode,
        history,
        currentDay,
        dayGoal,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.text || "I'm sorry, my connection flickered. Could you say that again?";
  } catch (error) {
    console.error("Client fetch Gemini error:", error);
    return "Oops! I seem to be having a bit of trouble hearing you clearly. Can we try that again?";
  }
};

export const generateSessionSummary = async (
  history: Message[]
): Promise<SessionSummary> => {
  if (!history || history.length === 0) {
    return {
      topics: [],
      vocabulary: [],
      corrections: [],
      strengths: [],
      weaknesses: []
    };
  }

  try {
    const response = await fetch("/api/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ history }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Client fetch session summary error:", error);
    return {
      topics: ["Gặp lỗi khi tạo sơ đồ phân tích"],
      vocabulary: [],
      corrections: [],
      strengths: ["Cố gắng duy trì giao tiếp đều đặn"],
      weaknesses: ["Chưa đủ dữ liệu phân tích chi tiết"]
    };
  }
};


