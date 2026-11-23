import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileImage,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  ClozeQuiz,
  Difficulty,
  GeminiCardAnalysis,
  LearningCluster,
  SubjectCategory,
} from '../types';
import {
  CLUSTER_PROFILES,
  formatDurationKorean,
  getDifficultyLabel,
} from '../lib/mlp';

export interface NewCardPayload {
  subject: SubjectCategory;
  title: string;
  note: string;
  difficulty: Difficulty;
  elapsedDays: number;
  cluster: LearningCluster;
  clusterReason?: string;
  aiDifficultyReason?: string;
  estimatedMinutes: number;
  clozeQuiz?: ClozeQuiz;
}

interface AddCardFormProps {
  onAddCard: (payload: NewCardPayload) => void;
  onCancel?: () => void;
}

const SUBJECT_OPTIONS: SubjectCategory[] = ['영어', '통합과학', '한국사', '수학', '국어', '기타'];
const CLUSTER_OPTIONS: LearningCluster[] = ['vocab', 'concept', 'formula'];

/**
 * Render a realistic high-school study note PNG on an offscreen canvas
 * so users without a photo file can test the real Gemini Vision OCR pipeline.
 */
function createSampleNoteImageDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 760;
  canvas.height = 440;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Notebook paper background
  ctx.fillStyle = '#FFFDF7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle horizontal notebook lines
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  for (let y = 70; y < canvas.height; y += 38) {
    ctx.beginPath();
    ctx.moveTo(32, y);
    ctx.lineTo(canvas.width - 32, y);
    ctx.stroke();
  }

  // Left red margin line
  ctx.strokeStyle = '#FDA4AF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(76, 20);
  ctx.lineTo(76, canvas.height - 20);
  ctx.stroke();

  // Header text
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('[오답 노트] 수학 I — 지수함수와 로그함수의 역함수', 96, 58);

  ctx.fillStyle = '#DC2626';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('★ 자주 틀리는 핵심 포인트:', 96, 102);

  ctx.fillStyle = '#0F172A';
  ctx.font = '20px sans-serif';
  ctx.fillText('1. 지수함수 y = a^x (a > 0, a ≠ 1) 의 역함수는 y = log_a(x) 이다.', 96, 140);
  ctx.fillText('2. 두 함수의 그래프는 직선 y = x 에 대하여 대칭이다.', 96, 178);
  ctx.fillText('3. 로그 방정식 풀이 전 반드시 밑 조건(a > 0, a ≠ 1)과', 96, 216);
  ctx.fillText('   진수 조건(x > 0)을 먼저 확인하지 않아 오답 발생!', 96, 254);

  ctx.fillStyle = '#1D4ED8';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('예제: f(x) = 2^(x-1) + 3 의 역함수를 구하면?', 96, 314);

  ctx.fillStyle = '#334155';
  ctx.font = '19px sans-serif';
  ctx.fillText('풀이: x - 1 = log_2(y - 3) → f^(-1)(x) = log_2(x - 3) + 1 (x > 3)', 96, 354);

  return canvas.toDataURL('image/png');
}

export const AddCardForm: React.FC<AddCardFormProps> = ({ onAddCard, onCancel }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [subject, setSubject] = useState<SubjectCategory>('영어');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [cluster, setCluster] = useState<LearningCluster>('vocab');
  const [clusterReason, setClusterReason] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [aiDifficultyReason, setAiDifficultyReason] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(10);
  const [elapsedHours, setElapsedHours] = useState<number>(0);
  const [clozeQuiz, setClozeQuiz] = useState<ClozeQuiz | undefined>(undefined);

  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [isAnalyzingNlp, setIsAnalyzingNlp] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const applyGeminiAnalysis = (data: GeminiCardAnalysis) => {
    setSubject(data.subject);
    if (data.title) setTitle(data.title);
    if (data.note) setNote(data.note);
    setCluster(data.cluster);
    setClusterReason(data.clusterReason || '');
    setDifficulty(data.difficulty);
    setAiDifficultyReason(data.difficultyReason || '');
    setEstimatedMinutes(data.estimatedMinutes || CLUSTER_PROFILES[data.cluster].defaultMinutes);
    if (data.clozeQuiz?.question && data.clozeQuiz?.answer) {
      setClozeQuiz(data.clozeQuiz);
    }
    if (data.extractedText) {
      setExtractedText(data.extractedText);
    }
    setFormError('');
  };

  const runOcrScan = async (dataUrl: string, mimeType: string) => {
    setOcrPreviewUrl(dataUrl);
    setIsScanningOcr(true);
    setAiError(null);
    setAiStatusMessage(null);

    try {
      const res = await fetch('/api/ocr-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType,
          subjectHint: subject,
        }),
      });

      const data = (await res.json()) as Partial<GeminiCardAnalysis> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `OCR 분석 오류 (${res.status})`);
      }

      applyGeminiAnalysis(data as GeminiCardAnalysis);
      setAiStatusMessage('Gemini 멀티모달 OCR 스캔 및 군집·난이도·빈칸 퀴즈 생성이 완료되었습니다.');
    } catch (err: unknown) {
      setAiError(
        err instanceof Error ? err.message : '이미지 OCR 분석 중 오류가 발생했습니다.'
      );
    } finally {
      setIsScanningOcr(false);
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void runOcrScan(reader.result, file.type || 'image/png');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSampleOcrTest = () => {
    const sampleDataUrl = createSampleNoteImageDataUrl();
    if (!sampleDataUrl) {
      setAiError('샘플 이미지를 생성할 수 없습니다.');
      return;
    }
    void runOcrScan(sampleDataUrl, 'image/png');
  };

  const handleRunNlpAnalyze = async () => {
    if (!title.trim() && !note.trim()) {
      setFormError('AI 분석을 위해 제목 또는 학습 메모를 먼저 입력해 주세요.');
      return;
    }
    setFormError('');
    setIsAnalyzingNlp(true);
    setAiError(null);
    setAiStatusMessage(null);

    try {
      const res = await fetch('/api/analyze-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          title: title.trim(),
          note: note.trim(),
        }),
      });

      const data = (await res.json()) as Partial<GeminiCardAnalysis> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `NLP 분석 오류 (${res.status})`);
      }

      applyGeminiAnalysis(data as GeminiCardAnalysis);
      setAiStatusMessage('Gemini NLP 난이도 판별 · 군집 추천 · 빈칸 퀴즈 생성이 완료되었습니다.');
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'NLP 분석 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzingNlp(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('학습할 과목 개념이나 단어 제목을 입력해 주세요.');
      return;
    }
    onAddCard({
      subject,
      title: title.trim(),
      note: note.trim(),
      difficulty,
      elapsedDays: Number((elapsedHours / 24).toFixed(2)),
      cluster,
      clusterReason: clusterReason || CLUSTER_PROFILES[cluster].description,
      aiDifficultyReason: aiDifficultyReason || undefined,
      estimatedMinutes,
      clozeQuiz,
    });
    setTitle('');
    setNote('');
    setClusterReason('');
    setAiDifficultyReason('');
    setClozeQuiz(undefined);
    setExtractedText('');
    setOcrPreviewUrl(null);
    setAiStatusMessage(null);
    setAiError(null);
    setElapsedHours(0);
    setFormError('');
  };

  const activeClusterProfile = CLUSTER_PROFILES[cluster];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Gemini Multimodal Vision OCR Section */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <Camera className="w-4 h-4 text-blue-600 shrink-0" />
            <span>오답노트 · 문제집 이미지 OCR 스캔 (Gemini 비전)</span>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          필기 노트나 문제집 사진을 올리면 Gemini 비전이 텍스트와 수식을 인식해 과목·군집·난이도·빈칸 퀴즈를 자동으로 채워 줍니다.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageFileChange}
          className="hidden"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isScanningOcr || isAnalyzingNlp}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
          >
            {isScanningOcr ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>사진 업로드 · 촬영</span>
          </button>

          <button
            type="button"
            disabled={isScanningOcr || isAnalyzingNlp}
            onClick={handleSampleOcrTest}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
          >
            <FileImage className="w-3.5 h-3.5" />
            <span>샘플 오답 이미지로 테스트</span>
          </button>
        </div>

        {isScanningOcr && (
          <div className="flex items-center gap-2 text-xs font-medium text-blue-700 pt-1">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Gemini 비전이 이미지 속 텍스트와 수식을 추출하고 있습니다...</span>
          </div>
        )}

        {ocrPreviewUrl && (
          <div className="pt-1 space-y-2">
            <img
              src={ocrPreviewUrl}
              alt="OCR 스캔 대상 학습 노트 미리보기"
              className="w-full max-h-36 object-contain rounded-xl border border-slate-200 bg-white"
            />
            {extractedText && (
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-600 leading-relaxed max-h-24 overflow-y-auto">
                <span className="font-semibold text-slate-800 block mb-0.5">OCR 추출 원문</span>
                {extractedText}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subject Selection */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-2">과목 선택</label>
        <div className="grid grid-cols-3 gap-2">
          {SUBJECT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                setSubject(opt);
                if (opt === '영어' || opt === '한국사') setCluster('vocab');
                else if (opt === '수학') setCluster('formula');
                else setCluster('concept');
              }}
              className={`py-2 px-3 min-h-[40px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                subject === opt
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Title & Note Inputs */}
      <div>
        <label htmlFor="card-title-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
          학습 개념 / 단어 제목
        </label>
        <input
          id="card-title-input"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (formError) setFormError('');
          }}
          placeholder="예: 생명과학 — 신경계의 흥분 전도와 전달"
          className="w-full px-3.5 py-2.5 min-h-[44px] text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
        />
        {formError && <p className="text-xs text-rose-600 mt-1">{formError}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label htmlFor="card-note-input" className="text-xs font-semibold text-slate-700">
            핵심 요약 / 오답 메모
          </label>
          <button
            type="button"
            disabled={isAnalyzingNlp || isScanningOcr}
            onClick={() => void handleRunNlpAnalyze()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {isAnalyzingNlp ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>AI 난이도 판별 · 빈칸 퀴즈 생성</span>
          </button>
        </div>
        <textarea
          id="card-note-input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="개념 설명이나 틀린 이유를 적고 위 AI 분석 버튼을 누르면 군집·난이도·빈칸 퀴즈가 자동 생성됩니다."
          className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-none"
        />
      </div>

      {/* Gemini Status / Error Feedback */}
      {aiStatusMessage && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{aiStatusMessage}</span>
        </div>
      )}

      {aiError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{aiError}</span>
        </div>
      )}

      {/* Clustering Selection (Cold-Start Curve Initialization) */}
      <div>
        <div className="flex items-center justify-between text-xs mb-2">
          <label className="font-semibold text-slate-700">
            유형 군집 분류 (초기 곡선 가중치 보정)
          </label>
          <span className="font-mono-tabular text-[11px] font-semibold text-blue-700">
            초기 보정 {activeClusterProfile.coldStartPrior >= 0 ? `+${Math.round(activeClusterProfile.coldStartPrior * 100)}%` : `${Math.round(activeClusterProfile.coldStartPrior * 100)}%`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {CLUSTER_OPTIONS.map((cId) => {
            const prof = CLUSTER_PROFILES[cId];
            return (
              <button
                key={cId}
                type="button"
                onClick={() => {
                  setCluster(cId);
                  setEstimatedMinutes(prof.defaultMinutes);
                }}
                className={`py-2 px-2.5 min-h-[44px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                  cluster === cId
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {prof.shortLabel}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
          {clusterReason || activeClusterProfile.decaySignature}
        </p>
      </div>

      {/* Difficulty & Rationale */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-2">
          초기 체감 난이도
        </label>
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as Difficulty[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setDifficulty(level)}
              className={`py-2 px-3 min-h-[44px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                difficulty === level
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {getDifficultyLabel(level)}
            </button>
          ))}
        </div>
        {aiDifficultyReason && (
          <p className="text-[11px] text-blue-800 bg-blue-50/70 border border-blue-200/80 rounded-xl px-3 py-2 mt-2 leading-snug">
            <span className="font-semibold">AI 난이도 판별 근거:</span> {aiDifficultyReason}
          </p>
        )}
      </div>

      {/* Generated Cloze Quiz Preview */}
      {clozeQuiz && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
          <div className="font-bold text-slate-800">생성된 맞춤형 빈칸 퀴즈 미리보기</div>
          <p className="text-slate-700 leading-relaxed">{clozeQuiz.question}</p>
          <div className="text-[11px] text-slate-500">
            정답: <strong className="text-blue-700">{clozeQuiz.answer}</strong> · 힌트: {clozeQuiz.hint}
          </div>
        </div>
      )}

      {/* Estimated Minutes & Initial Elapsed Time */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label htmlFor="minutes-slider" className="font-semibold text-slate-700">
              예상 복습 시간
            </label>
            <span className="font-mono-tabular font-semibold text-slate-900">
              {estimatedMinutes}분
            </span>
          </div>
          <input
            id="minutes-slider"
            type="range"
            min={5}
            max={30}
            step={1}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label htmlFor="elapsed-slider" className="font-semibold text-slate-700">
              초기 경과 시간 (시연용)
            </label>
            <span className="font-mono-tabular font-semibold text-blue-700">
              {elapsedHours === 0 ? '방금 학습 (0시간)' : formatDurationKorean(elapsedHours / 24)}
            </span>
          </div>
          <input
            id="elapsed-slider"
            type="range"
            min={0}
            max={72}
            step={6}
            value={elapsedHours}
            onChange={(e) => setElapsedHours(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </div>
      </div>

      <div className="pt-2 flex items-center gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[46px] px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            취소
          </button>
        )}
        <button
          type="submit"
          className="flex-2 min-h-[46px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer w-full"
        >
          학습 과목 등록하기
        </button>
      </div>
    </form>
  );
};

interface AddCardModalProps {
  onClose: () => void;
  onAddCard: (payload: NewCardPayload) => void;
}

export const AddCardModal: React.FC<AddCardModalProps> = ({ onClose, onAddCard }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-card-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0" />

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <h3 id="add-card-title" className="text-base font-bold text-slate-900">
            새 학습 과목 추가
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <AddCardForm
            onAddCard={(payload) => {
              onAddCard(payload);
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
};
