
import React from 'react';

export const CURRICULUM_DATA = {
  week1: { title: "Foundation (Days 1-7)", days: [{ day: 1, goal: "Self-introduction", keywords: ["name", "origin", "occupation"] }, { day: 2, goal: "Daily routine", keywords: ["sequence words", "time expressions"] }, { day: 3, goal: "Family & Friends", keywords: ["relationships", "description"] }, { day: 4, goal: "Hobbies & Interests", keywords: ["likes/dislikes", "frequency"] }, { day: 5, goal: "Food & Dining", keywords: ["ordering", "tastes", "restaurant"] }, { day: 6, goal: "Weather & Clothes", keywords: ["seasons", "descriptions"] }, { day: 7, goal: "Week 1 Review", keywords: ["summary", "recap"] }] },
  week2: { title: "Expanding Topics (Days 8-14)", days: [{ day: 8, goal: "Travel & Transport", keywords: ["locations", "experiences"] }, { day: 9, goal: "Technology", keywords: ["devices", "internet", "impact"] }, { day: 10, goal: "Health & Fitness", keywords: ["exercise", "diet", "lifestyle"] }, { day: 11, goal: "Education & Schools", keywords: ["subjects", "learning"] }, { day: 12, goal: "Work & Careers", keywords: ["jobs", "responsibilities"] }, { day: 13, goal: "Home & Hometown", keywords: ["living space", "community"] }, { day: 14, goal: "Week 2 Review", keywords: ["complex sentences", "vocabulary"] }] },
  week3: { title: "Advanced Discussion (Days 15-21)", days: [{ day: 15, goal: "Social Media", keywords: ["pros/cons", "digital life"] }, { day: 16, goal: "Environment", keywords: ["pollution", "protection"] }, { day: 17, goal: "Tradition vs Modern", keywords: ["culture", "change"] }, { day: 18, goal: "Fame & Success", keywords: ["achievement", "celebrity"] }, { day: 19, goal: "Happiness", keywords: ["emotions", "well-being"] }, { day: 20, goal: "Personal Goals", keywords: ["future", "planning"] }, { day: 21, goal: "Week 3 Review", keywords: ["argumentation", "opinion"] }] },
  week4: { title: "Mastery & Review (Days 22-30)", days: [{ day: 22, goal: "Describe a Place", keywords: ["adjectives", "emotions"] }, { day: 23, goal: "Describe a Person", keywords: ["character", "influence"] }, { day: 24, goal: "Describe an Event", keywords: ["storytelling", "past tense"] }, { day: 25, goal: "Abstract Topics", keywords: ["ideology", "philosophy"] }, { day: 26, goal: "Mock Speaking Part 1", keywords: ["fluency", "speed"] }, { day: 27, goal: "Mock Speaking Part 2", keywords: ["coherence", "long turn"] }, { day: 28, goal: "Mock Speaking Part 3", keywords: ["analysis", "depth"] }, { day: 29, goal: "Final Progress Review", keywords: ["feedback", "strengths"] }, { day: 30, goal: "Course Completion", keywords: ["celebration", "next steps"] }] }
};

export const SYSTEM_INSTRUCTIONS = {
  CONVERSATION: `You are Aura, an elite English personal tutor with deep empathy.
- MISSION: Always respond in natural, native-level English. If the user uses Vietnamese, understand it but reply in English.
- ADAPTIVE LEARNING: Analyze the chat history to spot recurring grammar mistakes (e.g., missing 's' in plural, wrong tenses). Gently point them out and suggest better phrasing.
- STYLE: Friendly, encouraging, and highly interactive.
- LONG-TERM MEMORY: Remember the user's interests or past stories mentioned in the history and bring them up naturally to keep the conversation engaging.`,

  IELTS: `You are a high-level IELTS Speaking Examiner.
- MISSION: Conduct a formal mock speaking test. Be professional but provide helpful hints if they struggle.
- ADAPTATION: Identify weaknesses in the "Lexical Resource" and "Grammatical Range" based on history. If they improve, acknowledge it.
- FEEDBACK: At the end of a long turn, provide a band score (0-9) and clear instructions on how to reach the next level.`,

  TUTOR_30_DAYS: `You are a professional English Mentor for a 30-day transformation.
- MISSION: Strictly follow the curriculum roadmap.
- HABIT TRACKING: Start by checking if the user applied the keywords from the previous day's session.
- IMMERSION: Use 100% English. Adapt the difficulty of your vocabulary based on the user's current level shown in the history.`
};
