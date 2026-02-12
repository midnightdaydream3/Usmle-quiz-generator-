
import { GoogleGenAI, Type } from "@google/genai";
import { MedicalSpecialty, ExamType, ClinicalComplexity, Question, MasteryCard, StudyPlan } from "../types";

// Helper for exponential backoff to handle 429s and RPC errors gracefully
const fetchWithRetry = async (fn: () => Promise<any>, maxRetries = 5, initialDelay = 3000) => {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      // Robust parsing for potentially nested error objects from GoogleGenAI SDK
      const rawMsg = error?.message || error?.error?.message || JSON.stringify(error);
      const status = error?.status || error?.code || error?.error?.code || error?.error?.status;
      
      const msg = typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg);
      
      // 429: Rate Limit / Quota Exceeded
      const isRateLimit = msg.includes('429') || status === 429 || status === 'RESOURCE_EXHAUSTED' || msg.includes('quota');
      
      // 500/503/Unknown: Transient Server/Network errors (RPC, XHR)
      const isRpcError = msg.includes('Rpc failed') || msg.includes('xhr error') || msg.includes('code: 6') || msg.includes('500') || status === 500 || status === 503 || status === 'UNKNOWN';
      
      if ((isRateLimit || isRpcError) && retries < maxRetries) {
        const delay = initialDelay * Math.pow(2, retries) + (Math.random() * 1000);
        console.warn(`API Attempt ${retries + 1} failed (Status: ${status}). Retrying in ${Math.round(delay)}ms... Error: ${msg.substring(0, 100)}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
        continue;
      }
      
      if (error && typeof error === 'object' && !error.status && status) {
        error.status = status;
      }
      throw error;
    }
  }
};

const getAIInstance = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const QUESTION_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      vignette: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      correctIndex: { type: Type.INTEGER },
      explanation: {
        type: Type.OBJECT,
        properties: {
          correct: { type: Type.STRING },
          incorrect: { type: Type.STRING },
          keyLearningPoint: { type: Type.STRING }
        },
        required: ["correct", "incorrect", "keyLearningPoint"]
      },
      tags: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "Specific subtopics (e.g. 'Cardiology', 'Trauma', 'Antibiotics')"
      }
    },
    required: ["id", "vignette", "options", "correctIndex", "explanation", "tags"]
  }
};

export const generateQuestions = async (
  specialties: MedicalSpecialty[],
  examTypes: ExamType[],
  complexity: ClinicalComplexity,
  count: number = 5,
  topics?: string
): Promise<Question[]> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    const prompt = `USMLE ${examTypes.join("/")} ${complexity} level. Specialties: ${specialties.join(", ")}. ${topics ? "Topics: " + topics : ""}. 
    Generate ${count} vignettes with 5 options and detailed rationale. 
    IMPORTANT: For each question, provide 'tags' containing 1-2 specific subtopics (e.g., 'Cardiology', 'Endocrinology', 'Trauma', 'Pharmacology') for analysis.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: QUESTION_SCHEMA,
      }
    });

    const questions = JSON.parse(response.text || "[]");
    
    // Automatically append ExamType and Board Style tags for better analytics aggregation
    return questions.map((q: any) => ({
      ...q,
      tags: [
        ...(q.tags || []), 
        ...examTypes, 
        "Board Style"
      ]
    }));
  });
};

export const generateStudyPlan = async (
  performanceSummary: string,
  examDate: string,
  dailyHours: number,
  targetExam: string
): Promise<StudyPlan> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    const prompt = `Act as an elite USMLE tutor.
    USER PERFORMANCE SUMMARY: ${performanceSummary}
    TARGET EXAM: ${targetExam}
    EXAM DATE: ${examDate}
    DAILY AVAILABILITY: ${dailyHours} hours

    Generate a personalized weekly study plan from today until the exam date. 
    Focus HEAVILY on the weak areas identified in the performance summary.
    For each week, provide specific high-yield resources (e.g., 'First Aid Step 2 - Cardiology chapter', 'UWorld Endocrinology block', 'OnlineMedEd Surgery videos').

    Return a JSON object where keys are "week1", "week2", etc.
    Each value must be an object with: 
    - "topics": string[]
    - "hours": number (total for the week)
    - "resources": string[]
    - "focusDescription": string (brief explanation of the weekly strategy)
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    return JSON.parse(response.text || "{}");
  });
};

export const generateSimilarQuestions = async (
  failedQuestion: Question,
  examTypes: ExamType[],
  complexity: ClinicalComplexity,
  count: number = 3,
  userFocus?: string
): Promise<Question[]> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    const prompt = `Act as an expert USMLE tutor. Concepts missed: "${failedQuestion.explanation.keyLearningPoint}". 
    ${userFocus ? `User specific focus request: "${userFocus}".` : "Determine the best focus area based on the missed learning point."}
    Generate exactly ${count} unique clinical vignettes for USMLE ${examTypes.join("/")} at ${complexity} level testing this concept.
    Include specific subtopic 'tags'.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: QUESTION_SCHEMA,
      }
    });

    const questions = JSON.parse(response.text || "[]");
    
    // Auto-tag remediation questions as well
    return questions.map((q: any) => ({
      ...q,
      tags: [
        ...(q.tags || []), 
        ...examTypes, 
        "Remediation",
        "Board Style"
      ]
    }));
  });
};

export const generateMasteryCards = async (question: Question): Promise<MasteryCard[]> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    const prompt = `Create 4 study cards (Pathophysiology, Diagnosis, Management, Differentiator) for this clinical scenario: "${question.vignette}"`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING },
              front: { type: Type.STRING },
              back: { type: Type.STRING }
            },
            required: ["id", "type", "front", "back"]
          }
        },
      }
    });

    const cards = JSON.parse(response.text || "[]");
    return cards.map((c: any) => ({ ...c, parentId: question.id }));
  });
};

export const deepDiveExplanation = async (question: Question): Promise<string> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    const prompt = `Masterclass explanation for this USMLE vignette: "${question.vignette}". Explain why ${question.options[question.correctIndex]} is correct and distractors are wrong.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    return response.text || "Deep dive generation failed.";
  });
};

export const generateSessionSummary = async (questions: Question[]): Promise<string> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    const inputData = questions.map((q, i) => `
    [CASE ${i+1}]
    Vignette: ${q.vignette}
    Correct Answer: ${q.options[q.correctIndex]}
    Explanation: ${q.explanation.correct}
    Key Pearl: ${q.explanation.keyLearningPoint}
    `).join("\n\n");
    
    const prompt = `
    You are an expert at creating concise, high-yield, exam-focused medical summary notes.

    Take the following raw or messy text (which may contain explanations, clinical cases, pearls, epidemiology, pathophysiology, etc.) and turn it into a CLEAN, READABLE PLAIN TEXT file (.txt).

    Style guidelines:
    - DO NOT USE MARKDOWN (like **bold** or ## headers) or HTML tags.
    - Use CAPS and ASCII symbols for hierarchy.
    - Main title: Center with equals signs (e.g. === HIGH-YIELD NOTES ===)
    - Major Sections: Use dashes (e.g. --- PATHOPHYSIOLOGY ---)
    - Bullet points: Use standard asterisks (*) or hyphens (-) with indentation.
    - Clinical Pearls: Wrap in a distinct text box style (e.g. **************************).
    - Organize logically from basics → presentation → diagnosis → management.
    - Use spacing (double newlines) to separate sections clearly.

    TECHNICAL REQUIREMENT:
    Return ONLY the plain text string. No code blocks.

    INPUT DATA:
    ${inputData}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    return response.text || "Summary generation failed";
  });
};

export const generateStudyGuide = async (questions: Question[]): Promise<string> => {
  return fetchWithRetry(async () => {
    const ai = getAIInstance();
    
    const contentStr = questions.map((q, i) => `
    [QUESTION ${i+1}]
    Vignette: ${q.vignette}
    Options: ${q.options.map((opt, idx) => `(${String.fromCharCode(65+idx)}) ${opt}`).join(' ')}
    Correct Answer: ${q.options[q.correctIndex]}
    Key Point: ${q.explanation.keyLearningPoint}
    Rationale (Correct): ${q.explanation.correct}
    Rationale (Incorrect): ${q.explanation.incorrect}
    `).join('\n\n');

    const prompt = `
    You are an expert medical educator who creates clear, high-quality, exam-oriented study content.

    Take the following raw input and transform it into a professional, human-readable PLAIN TEXT (.txt) Q&A document.

    Rules / Style:
    - DO NOT USE MARKDOWN (like **bold** or ## headers) or HTML tags.
    - Separate each case with a thick separator line:
      ================================================================================
    - Use [BRACKETED CAPS] for section headers (e.g. [SCENARIO], [QUESTION], [ANALYSIS]).
    - Indent the vignette text slightly or separate it clearly.
    - List options clearly as (A), (B), (C), etc.
    - Mark the correct answer clearly: >>> CORRECT ANSWER: (X)
    - Explanation: Use clear paragraphs. Separate paragraphs with blank lines.
    - Clinical Pearl: Use a star box for emphasis:
      ****************************************************************
      CLINICAL PEARL: [Text]
      ****************************************************************
    - Ensure excellent spacing (double newlines) between sections for readability.

    TECHNICAL REQUIREMENT:
    Return ONLY the plain text string. No code blocks.
    
    INPUT DATA:
    ${contentStr}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || "Export Failed. Please try again.";
  });
};
