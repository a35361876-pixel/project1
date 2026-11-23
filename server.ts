import 'dotenv/config';
import express, { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const ALLOWED_SUBJECTS = ['영어', '통합과학', '한국사', '수학', '국어', '기타'] as const;
const ALLOWED_CLUSTERS = ['vocab', 'concept', 'formula'] as const;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('모델 응답에서 JSON 형식을 찾을 수 없습니다.');
  }
  const slice = cleaned.slice(firstBrace, lastBrace + 1);
  return JSON.parse(slice) as Record<string, unknown>;
}

function sanitizeSubject(raw: unknown, fallback = '기타'): (typeof ALLOWED_SUBJECTS)[number] {
  const val = String(raw ?? '').trim();
  if ((ALLOWED_SUBJECTS as readonly string[]).includes(val)) {
    return val as (typeof ALLOWED_SUBJECTS)[number];
  }
  if (/영|eng/i.test(val)) return '영어';
  if (/과학|물리|화학|생명|지구/i.test(val)) return '통합과학';
  if (/한국사|역사/i.test(val)) return '한국사';
  if (/수학|미적|기하|확률|삼각|함수/i.test(val)) return '수학';
  if (/국어|문학|비문학|문법/i.test(val)) return '국어';
  return (ALLOWED_SUBJECTS as readonly string[]).includes(fallback)
    ? (fallback as (typeof ALLOWED_SUBJECTS)[number])
    : '기타';
}

function sanitizeCluster(raw: unknown): (typeof ALLOWED_CLUSTERS)[number] {
  const val = String(raw ?? '').trim();
  if ((ALLOWED_CLUSTERS as readonly string[]).includes(val)) {
    return val as (typeof ALLOWED_CLUSTERS)[number];
  }
  if (/어휘|단어|vocab|암기/i.test(val)) return 'vocab';
  if (/수식|풀이|계산|formula|문제/i.test(val)) return 'formula';
  return 'concept';
}

function sanitizeDifficulty(raw: unknown): 1 | 2 | 3 {
  const n = Number(raw);
  if (n === 1) return 1;
  if (n === 3) return 3;
  return 2;
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  retries = 2
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: unknown) {
      lastError = err;
      const msg = (err as { message?: string })?.message || '';
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE');
      if (!isTransient || attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 700 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

function sendGeminiError(res: Response, err: unknown) {
  const errorObj = err as { status?: number; message?: string };
  let status = typeof errorObj?.status === 'number' ? errorObj.status : 500;
  const rawMessage = errorObj?.message || 'Gemini API 호출 중 오류가 발생했습니다.';

  if (rawMessage.includes('429') || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    res.status(429).json({
      error:
        'Gemini API 요청 할당량(429)이 초과되었습니다. 잠시 후 다시 시도하거나 Settings > Secrets 패널에서 API 키 할당량을 확인해 주세요.',
    });
    return;
  }

  if (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')) {
    res.status(503).json({
      error:
        'Gemini AI 서버에 일시적으로 요청이 몰리고 있습니다(503). 잠시 후 다시 시도해 주세요.',
    });
    return;
  }

  if (
    rawMessage.includes('403') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('API_KEY_INVALID')
  ) {
    res.status(403).json({
      error:
        'Gemini API 키가 유효하지 않거나 권한이 없습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인해 주세요.',
    });
    return;
  }

  status = status >= 400 && status < 600 ? status : 500;
  res.status(status).json({ error: rawMessage });
}

const CARD_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    extractedText: {
      type: Type.STRING,
      description: '이미지에서 OCR로 추출한 원문 텍스트 및 수식(이미지 스캔 시에만 해당).',
    },
    subject: {
      type: Type.STRING,
      description: '과목명: 영어, 통합과학, 한국사, 수학, 국어, 기타 중 하나.',
    },
    title: {
      type: Type.STRING,
      description: '간결하고 명확한 학습 카드 제목 (한국어, 60자 이내).',
    },
    note: {
      type: Type.STRING,
      description: '핵심 개념과 오답 주의 포인트를 정리한 요약 메모 (2~4문장, 한국어).',
    },
    cluster: {
      type: Type.STRING,
      description:
        '학습 유형 군집: vocab(암기·어휘), concept(이해·개념), formula(수식·문제풀이) 중 하나.',
    },
    clusterReason: {
      type: Type.STRING,
      description: '왜 해당 학습 유형 군집으로 분류했는지에 대한 1문장 근거.',
    },
    difficulty: {
      type: Type.INTEGER,
      description: '학습 난이도: 1(쉬움), 2(보통), 3(어려움).',
    },
    difficultyReason: {
      type: Type.STRING,
      description: '텍스트의 개념 밀도·추론 복잡도·오답 함정 기반의 난이도 판별 근거 1~2문장.',
    },
    estimatedMinutes: {
      type: Type.INTEGER,
      description: '이 카드를 1회 복습하고 퀴즈를 푸는 데 걸리는 예상 소요 시간(분, 5~30).',
    },
    clozeQuiz: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: '핵심 용어나 수식 자리에 ______ 빈칸이 뚫린 맞춤형 복습 문제 문장.',
        },
        answer: {
          type: Type.STRING,
          description: '빈칸에 들어갈 정확한 정답 단어 또는 짧은 수식.',
        },
        hint: {
          type: Type.STRING,
          description: '초성 힌트나 짧은 연상 단서.',
        },
        explanation: {
          type: Type.STRING,
          description: '정답에 대한 1~2문장 해설.',
        },
      },
      required: ['question', 'answer', 'hint', 'explanation'],
    },
  },
  required: [
    'subject',
    'title',
    'note',
    'cluster',
    'clusterReason',
    'difficulty',
    'difficultyReason',
    'estimatedMinutes',
    'clozeQuiz',
  ],
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const geminiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    res.json({ ok: true, geminiConfigured });
  });

  /**
   * 1. Google Search-Grounded Multiple-Choice Quiz Generator
   */
  app.post('/api/quiz', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY가 설정되지 않았습니다. AI Studio의 Settings > Secrets 패널에서 GEMINI_API_KEY를 설정해 주세요.',
      });
      return;
    }

    const { subject, title, note, difficulty } = req.body as {
      subject?: string;
      title?: string;
      note?: string;
      difficulty?: 1 | 2 | 3 | 'all';
    };

    if (!subject || !title) {
      res.status(400).json({ error: '과목명(subject)과 개념 제목(title)이 필요합니다.' });
      return;
    }

    const difficultyPrompt =
      difficulty === 1
        ? '쉬움(difficulty: 1) 난이도 2문항을 포함해 총 3문항(쉬움 2, 보통 1)'
        : difficulty === 2
          ? '보통(difficulty: 2) 난이도 2문항을 포함해 총 3문항(쉬움 1, 보통 1, 어려움 1)'
          : difficulty === 3
            ? '어려움(difficulty: 3) 난이도 2문항을 포함해 총 3문항(보통 1, 어려움 2)'
            : '쉬움(1), 보통(2), 어려움(3) 각 1문항씩 총 3문항';

    const prompt = `
한국 고등학교 교육과정 기준으로 아래 학습 항목에 대한 정확한 개념을 Google 검색으로 먼저 확인하고, 암기 내용을 점검할 수 있는 4지선다 퀴즈를 출제해 주세요.

- 과목: ${subject}
- 학습 개념/단어: ${title}
- 사용자 메모: ${note || '없음'}
- 출제 구성: ${difficultyPrompt}

반드시 아래 JSON 형식으로만 응답하세요 (설명 문장이나 코드블록 마크다운 없이 순수 JSON 객체만 반환):
{
  "conceptSummary": "구글 검색으로 확인한 핵심 개념 요약 (2~3문장, 한국어)",
  "questions": [
    {
      "id": "q1",
      "difficulty": 1,
      "question": "문제 본문 (명확하고 구체적인 고등학교 수준 문항)",
      "options": ["선지1", "선지2", "선지3", "선지4"],
      "correctIndex": 0,
      "explanation": "왜 정답인지와 오답 함정을 설명하는 친절한 해설"
    }
  ]
}

규칙:
1. difficulty 값은 반드시 숫자 1(쉬움), 2(보통), 3(어려움) 중 하나여야 합니다.
2. 쉬움(1)은 핵심 용어·정의 확인, 보통(2)은 개념 비교·원리 적용, 어려움(3)은 수능/모의고사형 심화 추론 및 함정 선지 구별 문항으로 만드세요.
3. options는 반드시 4개 문자열 배열, correctIndex는 0~3 정수여야 합니다.
4. 사실 오류가 없도록 Google 검색 결과를 근거로 출제하세요.
`.trim();

    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction:
            '당신은 대한민국 고등학교 내신·수능 전문 교사입니다. Google 검색으로 개념의 정확성을 검증한 뒤 JSON 형식으로만 4지선다 문제를 반환하세요.',
        },
      });

      const rawText = response.text ?? '';
      const parsed = extractJsonObject(rawText);

      const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
      const sanitizedQuestions = rawQuestions
        .map((q, idx) => {
          const item = q as Record<string, unknown>;
          const options = Array.isArray(item.options)
            ? item.options.map((o) => String(o)).slice(0, 4)
            : [];
          if (options.length < 4 || !item.question) return null;
          const safeDiff = sanitizeDifficulty(item.difficulty);
          const rawCorrect = Number(item.correctIndex);
          const safeCorrect =
            Number.isInteger(rawCorrect) && rawCorrect >= 0 && rawCorrect <= 3 ? rawCorrect : 0;
          return {
            id: String(item.id || `gemini-q-${Date.now()}-${idx}`),
            difficulty: safeDiff,
            question: String(item.question),
            options,
            correctIndex: safeCorrect,
            explanation: String(item.explanation || '핵심 개념을 다시 확인해 보세요.'),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (sanitizedQuestions.length === 0) {
        res.status(502).json({
          error: 'Gemini 응답에서 유효한 4지선다 문항을 생성하지 못했습니다. 다시 시도해 주세요.',
        });
        return;
      }

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .map((chunk) => {
          const web = (chunk as { web?: { uri?: string; title?: string } }).web;
          if (!web?.uri) return null;
          return {
            uri: web.uri,
            title: web.title || web.uri,
          };
        })
        .filter((s): s is { uri: string; title: string } => s !== null)
        .slice(0, 5);

      res.json({
        conceptSummary: String(
          parsed.conceptSummary || `${subject} — ${title} 관련 Google 검색 기반 개념 점검 문제입니다.`
        ),
        questions: sanitizedQuestions,
        sources,
        generatedBy: 'gemini-4-hydrogen + Google Search',
      });
    } catch (err: unknown) {
      sendGeminiError(res, err);
    }
  });

  /**
   * 2. Gemini NLP Difficulty Assessment, Cluster Classification & Custom Cloze Quiz Generator
   */
  app.post('/api/analyze-card', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY가 설정되지 않았습니다. AI Studio의 Settings > Secrets 패널에서 GEMINI_API_KEY를 설정해 주세요.',
      });
      return;
    }

    const { subject, title, note } = req.body as {
      subject?: string;
      title?: string;
      note?: string;
    };

    const combinedText = `${title ?? ''}\n${note ?? ''}`.trim();
    if (!combinedText) {
      res.status(400).json({ error: '분석할 개념 제목 또는 학습 메모를 입력해 주세요.' });
      return;
    }

    const prompt = `
사용자가 입력한 고등학교 학습 개념/오답 노트를 NLP로 분석하여 다음 항목을 구조화된 JSON으로 생성해 주세요.
- 사용자가 선택한 과목(참고): ${subject || '자동 판별'}
- 개념 제목 입력: ${title || '(제목 미입력 - 내용에서 추출)'}
- 학습 메모 / 오답 텍스트: ${note || '(없음)'}

분석 기준:
1. cluster: 단순 단어·연표·고유명사 인출이면 'vocab', 인과관계·과학/인문 원리 이해면 'concept', 수학/과학 공식 대입 및 계산 문제면 'formula'로 분류하고 1문장 이유(clusterReason)를 작성하세요.
2. difficulty: 개념의 추상성, 선수 지식 요구도, 시험 오답 함정 빈도를 평가해 1(쉬움), 2(보통), 3(어려움) 중 하나를 판별하고 구체적인 근거(difficultyReason)를 설명하세요.
3. estimatedMinutes: 1회 복습 및 퀴즈 점검에 필요한 현실적 예상 시간(분, 5~30).
4. clozeQuiz: 핵심 키워드나 수식을 '______' 빈칸으로 뚫어 놓은 맞춤형 빈칸 채우기 문제, 단답형 정답(answer), 초성/개념 힌트(hint), 해설(explanation)을 만드세요.
`.trim();

    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            '당신은 한국 고등학교 교육과정과 인지학습 공학에 정통한 AI 튜터입니다. 정확하고 간결한 한국어 JSON만 반환하세요.',
          responseMimeType: 'application/json',
          responseSchema: CARD_ANALYSIS_SCHEMA,
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const rawCloze = (parsed.clozeQuiz ?? {}) as Record<string, unknown>;

      res.json({
        subject: sanitizeSubject(parsed.subject, subject || '기타'),
        title: String(parsed.title || title || '새 학습 개념').slice(0, 120),
        note: String(parsed.note || note || '').slice(0, 600),
        cluster: sanitizeCluster(parsed.cluster),
        clusterReason: String(
          parsed.clusterReason || '입력된 학습 내용의 인출·적용 패턴을 기준으로 군집을 분류했습니다.'
        ).slice(0, 300),
        difficulty: sanitizeDifficulty(parsed.difficulty),
        difficultyReason: String(
          parsed.difficultyReason || '핵심 개념의 난이도와 오답 유발 가능성을 분석했습니다.'
        ).slice(0, 300),
        estimatedMinutes: Math.max(5, Math.min(30, Math.round(Number(parsed.estimatedMinutes) || 12))),
        clozeQuiz: {
          question: String(
            rawCloze.question || `${String(parsed.title || title)}의 핵심 개념은 ( ______ )이다.`
          ).slice(0, 400),
          answer: String(rawCloze.answer || '').slice(0, 120),
          hint: String(rawCloze.hint || '핵심 키워드를 떠올려 보세요.').slice(0, 200),
          explanation: String(rawCloze.explanation || parsed.note || '').slice(0, 400),
        },
        generatedBy: 'gemini-4-hydrogen (NLP Analysis)',
      });
    } catch (err: unknown) {
      sendGeminiError(res, err);
    }
  });

  /**
   * 3. Gemini Multimodal Vision OCR Scan for Workbook / Study Notes
   */
  app.post('/api/ocr-scan', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY가 설정되지 않았습니다. AI Studio의 Settings > Secrets 패널에서 GEMINI_API_KEY를 설정해 주세요.',
      });
      return;
    }

    const { imageBase64, mimeType, subjectHint } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      subjectHint?: string;
    };

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: '업로드된 이미지 데이터가 필요합니다.' });
      return;
    }

    const normalizedMime = (mimeType || 'image/png').toLowerCase();
    const safeMime = ALLOWED_IMAGE_MIMES.has(normalizedMime)
      ? normalizedMime === 'image/jpg'
        ? 'image/jpeg'
        : normalizedMime
      : 'image/png';

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/i, '').trim();
    if (!cleanBase64 || cleanBase64.length > 14_000_000) {
      res.status(400).json({ error: '유효하지 않거나 용량이 너무 큰 이미지입니다(10MB 이하 권장).' });
      return;
    }

    const textPrompt = `
첨부된 문제집·오답노트·필기 이미지를 정밀하게 OCR 판독(텍스트 및 수식 포함)한 뒤 학습 카드로 구조화해 주세요.
- 참고 과목 힌트: ${subjectHint || '이미지 내용에서 자동 판별'}

요구사항:
1. extractedText: 사진에 보이는 텍스트, 영어 문장, 한국사 사료, 수학 수식(기호 유지)을 빠짐없이 정확하게 추출하세요.
2. subject: 영어, 통합과학, 한국사, 수학, 국어, 기타 중 가장 적합한 과목을 선택하세요.
3. title: 핵심 개념을 한눈에 알아볼 수 있는 제목(60자 이내)으로 정리하세요.
4. note: 이미지 속 핵심 개념과 실수하기 쉬운 오답 포인트를 2~4문장으로 깔끔하게 요약하세요.
5. cluster & clusterReason: 'vocab'(암기·어휘), 'concept'(이해·개념), 'formula'(수식·문제풀이) 중 하나로 분류하고 근거를 적으세요.
6. difficulty & difficultyReason: 1(쉬움), 2(보통), 3(어려움) 난이도를 판별하고 이유를 적으세요.
7. estimatedMinutes: 복습 예상 소요 시간(5~30분).
8. clozeQuiz: 추출한 내용에서 가장 중요한 핵심 개념/수식 자리에 '______' 빈칸을 뚫은 빈칸 퀴즈(question, answer, hint, explanation)를 만드세요.
`.trim();

    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: safeMime,
                data: cleanBase64,
              },
            },
            { text: textPrompt },
          ],
        },
        config: {
          systemInstruction:
            '당신은 한국 고등학교 필기·문제집 이미지 OCR 및 학습 카드 구조화 전문가입니다. 이미지 속 수식과 텍스트를 정확히 읽고 지정된 JSON 스키마로만 응답하세요.',
          responseMimeType: 'application/json',
          responseSchema: CARD_ANALYSIS_SCHEMA,
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const rawCloze = (parsed.clozeQuiz ?? {}) as Record<string, unknown>;

      res.json({
        extractedText: String(parsed.extractedText || '').slice(0, 1200),
        subject: sanitizeSubject(parsed.subject, subjectHint || '기타'),
        title: String(parsed.title || '스캔된 학습 개념').slice(0, 120),
        note: String(parsed.note || parsed.extractedText || '').slice(0, 600),
        cluster: sanitizeCluster(parsed.cluster),
        clusterReason: String(
          parsed.clusterReason || '스캔된 문제·필기 유형을 기준으로 군집을 자동 분류했습니다.'
        ).slice(0, 300),
        difficulty: sanitizeDifficulty(parsed.difficulty),
        difficultyReason: String(
          parsed.difficultyReason || '추출된 개념의 난이도를 분석했습니다.'
        ).slice(0, 300),
        estimatedMinutes: Math.max(5, Math.min(30, Math.round(Number(parsed.estimatedMinutes) || 12))),
        clozeQuiz: {
          question: String(
            rawCloze.question || `${String(parsed.title || '핵심 개념')}의 핵심 내용은 ( ______ )이다.`
          ).slice(0, 400),
          answer: String(rawCloze.answer || '').slice(0, 120),
          hint: String(rawCloze.hint || '스캔한 노트의 핵심어를 입력해 보세요.').slice(0, 200),
          explanation: String(rawCloze.explanation || parsed.note || '').slice(0, 400),
        },
        generatedBy: 'gemini-4-hydrogen (Multimodal OCR)',
      });
    } catch (err: unknown) {
      sendGeminiError(res, err);
    }
  });

  /**
   * 4. Custom Cloze Quiz Generator for an existing study card
   */
  app.post('/api/cloze-quiz', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY가 설정되지 않았습니다. AI Studio의 Settings > Secrets 패널에서 GEMINI_API_KEY를 설정해 주세요.',
      });
      return;
    }

    const { subject, title, note, difficulty } = req.body as {
      subject?: string;
      title?: string;
      note?: string;
      difficulty?: 1 | 2 | 3;
    };

    if (!title) {
      res.status(400).json({ error: '개념 제목(title)이 필요합니다.' });
      return;
    }

    const diffText = difficulty === 1 ? '쉬움' : difficulty === 3 ? '어려움' : '보통';

    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: `
과목: ${subject || '기타'}
제목: ${title}
메모: ${note || '없음'}
목표 난이도: ${diffText}

위 학습 내용에서 핵심 개념이나 수식 자리에 '______' 빈칸을 뚫은 맞춤형 빈칸 채우기 복습 문제 1개를 생성하세요.
정답(answer)은 한 단어나 짧은 핵심 구/수식으로 명확히 채점 가능해야 합니다.
`.trim(),
        config: {
          systemInstruction:
            '고등학교 교사로서 학습자의 암기·이해 여부를 정확히 테스트하는 빈칸 채우기 문제 1개를 JSON으로 출제하세요.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING },
              hint: { type: Type.STRING },
              explanation: { type: Type.STRING },
            },
            required: ['question', 'answer', 'hint', 'explanation'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      if (!parsed.question || !parsed.answer) {
        res.status(502).json({ error: '빈칸 퀴즈 생성 응답이 비어 있습니다.' });
        return;
      }

      res.json({
        question: String(parsed.question).slice(0, 400),
        answer: String(parsed.answer).slice(0, 120),
        hint: String(parsed.hint || '핵심 용어를 떠올려 보세요.').slice(0, 200),
        explanation: String(parsed.explanation || note || '').slice(0, 400),
      });
    } catch (err: unknown) {
      sendGeminiError(res, err);
    }
  });

  /**
   * 5. Multimodal Blank Page Retrieval (백지 인출 & 약점 재도전) Evaluator
   */
  app.post('/api/blank-page-check', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY가 설정되지 않았습니다. AI Studio의 Settings > Secrets 패널에서 GEMINI_API_KEY를 설정해 주세요.',
      });
      return;
    }

    const {
      subject,
      title,
      note,
      difficulty,
      typedText,
      canvasImageBase64,
      mimeType,
      mode = 'full',
      targetWeakPoints = [],
    } = req.body as {
      subject?: string;
      title?: string;
      note?: string;
      difficulty?: 1 | 2 | 3;
      typedText?: string;
      canvasImageBase64?: string;
      mimeType?: string;
      mode?: 'full' | 'weakness-retry';
      targetWeakPoints?: Array<{
        id: string;
        concept: string;
        detail: string;
        severity: 'high' | 'medium';
      }>;
    };

    if (!title || !String(title).trim()) {
      res.status(400).json({ error: '원래 학습 개념 제목(title)이 필요합니다.' });
      return;
    }

    const isWeaknessRetry = mode === 'weakness-retry' && Array.isArray(targetWeakPoints) && targetWeakPoints.length > 0;
    const trimmedText = String(typedText ?? '').trim();
    const cleanBase64 =
      typeof canvasImageBase64 === 'string'
        ? canvasImageBase64.replace(/^data:[^;]+;base64,/i, '').trim()
        : '';

    if (!trimmedText && !cleanBase64) {
      res.status(400).json({
        error: '백지에 텍스트를 입력하거나 펜으로 필기한 뒤 [검사하기]를 눌러주세요.',
      });
      return;
    }

    if (cleanBase64.length > 14_000_000) {
      res.status(400).json({ error: '캔버스 이미지 용량이 너무 큽니다.' });
      return;
    }

    const normalizedMime = (mimeType || 'image/png').toLowerCase();
    const safeMime = ALLOWED_IMAGE_MIMES.has(normalizedMime)
      ? normalizedMime === 'image/jpg'
        ? 'image/jpeg'
        : normalizedMime
      : 'image/png';

    const weakPointListText = isWeaknessRetry
      ? targetWeakPoints
          .map(
            (wp, idx) =>
              `${idx + 1}. [id: ${wp.id}] 주제: ${wp.concept} | 보완 기준: ${wp.detail} (심각도: ${wp.severity})`
          )
          .join('\n')
      : '';

    const promptText = isWeaknessRetry
      ? `
학생이 이전 백지 인출에서 부족했던 점들만 모아 **[약점 재도전]** 백지 인출을 수행했습니다.
아래 [집중 점검 대상 약점 목록]을 기준으로 [학생의 약점 재도전 답안(텍스트 및 첨부 캔버스 필기/도식)]을 채점하고, 기존 약점들이 보완·해결되었는지 판정해 주세요.

[학습 카드 정보]
- 과목: ${subject || '기타'}
- 개념 제목: ${title}
- 전체 참고 개념: ${note || '(표준 고등학교 교육과정 기준)'}
- 난이도: ${difficulty === 1 ? '쉬움(1)' : difficulty === 3 ? '어려움(3)' : '보통(2)'}

[집중 점검 대상 약점 목록]
${weakPointListText}

[학생이 백지에 타이핑한 텍스트]
${trimmedText ? trimmedText : '(타이핑 입력 없음 — 첨부된 캔버스 손글씨/도식 이미지를 직접 판독해 평가하세요)'}

평가 및 JSON 생성 규칙:
1. resolvedWeakPointIds: 위 [집중 점검 대상 약점 목록]의 id 중 학생이 이번에 정확하게 보완·인출해 낸 항목의 id 배열. (아직 불충분하면 포함하지 마세요.)
2. remainingWeakPoints: 아직 완전히 해결되지 않았거나 여전히 혼동한 약점 항목 배열. 기존 항목이 미해결이면 반드시 해당 id를 유지하고, concept(짧은 약점 주제 40자 이내), detail(구체적으로 무엇이 부족/오개념인지 1~2문장), severity('high' 또는 'medium')를 작성하세요.
3. structuredMissingPoints: remainingWeakPoints와 동일하게 미해결 약점 요약.
4. score (0~100 정수): 대상 약점들을 얼마나 정확히 보완했는지 점수화.
5. gradeLabel: 80점 이상 '상', 50~79점 '중', 49점 미만 '하'.
6. recommendedOutcome: 78점 이상 'remembered', 45~77점 'confused', 44점 이하 'forgotten'.
7. rememberedPoints: 이번 약점 재도전에서 잘 보완해 낸 핵심 포인트 목록(1~5개).
8. missingPoints: 여전히 부족하거나 더 다듬어야 할 부분 목록(해결 완료 시 심화 확인 포인트 1개).
9. feedbackSummary: 약점 극복 현황 및 다음 복습 전략 1~2문장.
10. weakPointCard: 남은 약점이 있다면 이를 복습할 집중 카드(title, note, difficulty, clozeQuiz).
`.trim()
      : `
학생이 '백지 인출(Blank Page Retrieval)' 복습을 수행했습니다.
아래 [원래 학습해야 할 핵심 개념]과 [학생이 백지에 작성한 내용(텍스트 및 첨부 캔버스 필기/도식 이미지)]을 비교하여 정밀하게 채점·분석해 주세요.

[원래 학습해야 할 핵심 개념]
- 과목: ${subject || '기타'}
- 개념 제목: ${title}
- 핵심 개념/정답 내용: ${note || '(세부 메모 없음 - 고등학교 표준 교육과정 핵심 개념 기준으로 평가하세요)'}
- 기존 난이도: ${difficulty === 1 ? '쉬움(1)' : difficulty === 3 ? '어려움(3)' : '보통(2)'}

[학생이 백지에 타이핑한 텍스트]
${trimmedText ? trimmedText : '(타이핑 입력 없음 — 첨부된 캔버스 손글씨/도식 이미지를 직접 판독해 평가하세요)'}

평가 및 JSON 생성 규칙:
1. score (0~100 정수): 핵심 키워드·원리·인과관계·수식 포함 정도와 정확도를 종합해 엄정하고 공정하게 점수화하세요. 백지가 주제와 무관하거나 거의 비어 있으면 낮은 점수(0~35)를 부여하세요.
2. gradeLabel: 80점 이상 '상', 50~79점 '중', 49점 미만 '하'.
3. recommendedOutcome: 78점 이상 'remembered', 45~77점 'confused', 44점 이하 'forgotten'.
4. rememberedPoints: 학생이 정확하게 기억해 낸 핵심 포인트 목록 (1~5개, 한국어 문장).
5. missingPoints: 부족했던 점, 빠뜨린 핵심 개념, 틀리거나 혼동한 부분 문장 목록 (1~5개).
6. structuredMissingPoints: 부족했던 점을 [약점 재도전]용 항목으로 구조화한 배열 (1~4개, 단 95점 이상으로 빠뜨린 핵심 개념이 전혀 없다면 빈 배열 [] 가능).
   - concept: 재도전 시 학생에게 제시할 짧은 약점 주제명 (예: "공유 결합의 '전자쌍' 용어 및 옥텟 규칙", 정답을 통째로 적지 말고 떠올릴 주제 키워드 형태로 50자 이내 작성).
   - detail: 실제로 무엇을 빠뜨렸는지/틀렸는지 구체적 설명 (1~2문장).
   - severity: 핵심 원리 누락·오개념이면 'high', 세부 용어·보충 설명 누락이면 'medium'.
7. resolvedWeakPointIds: [] (최초 검사에서는 빈 배열).
8. remainingWeakPoints: structuredMissingPoints와 동일하게 반환.
9. feedbackSummary: 전체 이해도 총평 및 다음 복습 전략 1~2문장.
10. weakPointCard: 부족했던 핵심 개념을 집중 복습할 수 있는 맞춤형 취약점 카드(title, note, difficulty 1~3, clozeQuiz{question, answer, hint, explanation}).
`.trim();

    const parts: Array<
      { inlineData: { mimeType: string; data: string } } | { text: string }
    > = [];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: safeMime,
          data: cleanBase64,
        },
      });
    }
    parts.push({ text: promptText });

    const weakPointDraftSchema = {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        concept: { type: Type.STRING },
        detail: { type: Type.STRING },
        severity: { type: Type.STRING },
      },
      required: ['concept', 'detail', 'severity'],
    };

    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction:
            '당신은 대한민국 고등학교 메타인지 학습 코치입니다. 학생의 백지 인출 텍스트와 손글씨·도식 이미지를 꼼꼼히 판독해 원래 핵심 개념 또는 약점 목록과 대조하고, 정확한 JSON 스키마로만 채점 결과를 반환하세요.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.INTEGER },
              gradeLabel: { type: Type.STRING },
              recommendedOutcome: { type: Type.STRING },
              rememberedPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              missingPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              structuredMissingPoints: {
                type: Type.ARRAY,
                items: weakPointDraftSchema,
              },
              resolvedWeakPointIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              remainingWeakPoints: {
                type: Type.ARRAY,
                items: weakPointDraftSchema,
              },
              feedbackSummary: { type: Type.STRING },
              weakPointCard: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  note: { type: Type.STRING },
                  difficulty: { type: Type.INTEGER },
                  clozeQuiz: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      answer: { type: Type.STRING },
                      hint: { type: Type.STRING },
                      explanation: { type: Type.STRING },
                    },
                    required: ['question', 'answer', 'hint', 'explanation'],
                  },
                },
                required: ['title', 'note', 'difficulty', 'clozeQuiz'],
              },
            },
            required: [
              'score',
              'gradeLabel',
              'recommendedOutcome',
              'rememberedPoints',
              'missingPoints',
              'structuredMissingPoints',
              'resolvedWeakPointIds',
              'remainingWeakPoints',
              'feedbackSummary',
              'weakPointCard',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const rawScore = Number(parsed.score);
      const safeScore = Number.isFinite(rawScore)
        ? Math.max(0, Math.min(100, Math.round(rawScore)))
        : 50;

      const gradeLabel: '상' | '중' | '하' =
        safeScore >= 80 ? '상' : safeScore >= 50 ? '중' : '하';

      const rawOutcome = String(parsed.recommendedOutcome ?? '').trim();
      const recommendedOutcome: 'remembered' | 'confused' | 'forgotten' =
        rawOutcome === 'remembered' || rawOutcome === 'confused' || rawOutcome === 'forgotten'
          ? rawOutcome
          : safeScore >= 78
            ? 'remembered'
            : safeScore >= 45
              ? 'confused'
              : 'forgotten';

      const rememberedPoints = Array.isArray(parsed.rememberedPoints)
        ? parsed.rememberedPoints.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
        : [];
      const missingPoints = Array.isArray(parsed.missingPoints)
        ? parsed.missingPoints.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
        : [];

      const sanitizeDraftList = (raw: unknown) => {
        if (!Array.isArray(raw)) return [];
        return raw
          .map((item) => {
            const obj = item as Record<string, unknown>;
            const concept = String(obj.concept ?? '').trim().slice(0, 160);
            const detail = String(obj.detail ?? '').trim().slice(0, 500);
            if (!concept && !detail) return null;
            const severity: 'high' | 'medium' = obj.severity === 'high' ? 'high' : 'medium';
            const id = obj.id ? String(obj.id).trim() : undefined;
            return {
              ...(id ? { id } : {}),
              concept: concept || detail.slice(0, 60),
              detail: detail || concept,
              severity,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .slice(0, 5);
      };

      const validTargetIds = new Set(targetWeakPoints.map((w) => w.id));
      const resolvedWeakPointIds = isWeaknessRetry && Array.isArray(parsed.resolvedWeakPointIds)
        ? parsed.resolvedWeakPointIds
            .map((id) => String(id).trim())
            .filter((id) => validTargetIds.has(id))
        : [];

      let remainingWeakPoints = sanitizeDraftList(parsed.remainingWeakPoints);
      let structuredMissingPoints = sanitizeDraftList(parsed.structuredMissingPoints);

      if (!isWeaknessRetry && structuredMissingPoints.length === 0 && safeScore < 92 && missingPoints.length > 0) {
        structuredMissingPoints = missingPoints.slice(0, 3).map((mp) => ({
          concept: mp.slice(0, 60),
          detail: mp.slice(0, 480),
          severity: safeScore < 55 ? 'high' : 'medium',
        }));
      }
      if (!isWeaknessRetry && remainingWeakPoints.length === 0) {
        remainingWeakPoints = structuredMissingPoints;
      }
      if (isWeaknessRetry && remainingWeakPoints.length === 0) {
        const resolvedSet = new Set(resolvedWeakPointIds);
        remainingWeakPoints = targetWeakPoints
          .filter((wp) => !resolvedSet.has(wp.id))
          .map((wp) => ({
            id: wp.id,
            concept: wp.concept,
            detail: wp.detail,
            severity: wp.severity,
          }));
      }

      const rawWeak = (parsed.weakPointCard ?? {}) as Record<string, unknown>;
      const rawCloze = (rawWeak.clozeQuiz ?? {}) as Record<string, unknown>;

      res.json({
        mode: isWeaknessRetry ? 'weakness-retry' : 'full',
        score: safeScore,
        gradeLabel,
        recommendedOutcome,
        rememberedPoints:
          rememberedPoints.length > 0
            ? rememberedPoints
            : ['핵심 개념의 일부를 인출하려 시도했습니다.'],
        missingPoints:
          missingPoints.length > 0
            ? missingPoints
            : ['핵심 용어와 원리의 세부 연결 고리를 한 번 더 점검해 보세요.'],
        structuredMissingPoints: isWeaknessRetry ? remainingWeakPoints : structuredMissingPoints,
        resolvedWeakPointIds,
        remainingWeakPoints,
        feedbackSummary: String(
          parsed.feedbackSummary ||
            `백지 인출 점수 ${safeScore}점(${gradeLabel})으로 분석되었습니다.`
        ).slice(0, 500),
        weakPointCard: {
          title: String(rawWeak.title || `${title} — 취약점 집중 보완`).slice(0, 120),
          note: String(
            rawWeak.note ||
              missingPoints.join(' ') ||
              note ||
              `${title}의 핵심 개념을 다시 정리한 집중 복습 카드입니다.`
          ).slice(0, 600),
          difficulty: sanitizeDifficulty(rawWeak.difficulty ?? difficulty),
          clozeQuiz: {
            question: String(
              rawCloze.question || `${title}에서 특히 주의해야 할 핵심 개념은 ( ______ )이다.`
            ).slice(0, 400),
            answer: String(rawCloze.answer || title).slice(0, 120),
            hint: String(rawCloze.hint || '부족했던 포인트를 떠올려 보세요.').slice(0, 200),
            explanation: String(
              rawCloze.explanation || rawWeak.note || missingPoints[0] || note || ''
            ).slice(0, 400),
          },
        },
        generatedBy: isWeaknessRetry
          ? 'gemini-4-hydrogen (Weakness Retry)'
          : 'gemini-4-hydrogen (Blank Page Retrieval)',
      });
    } catch (err: unknown) {
      sendGeminiError(res, err);
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RememberAI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
