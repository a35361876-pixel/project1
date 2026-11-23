import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  FileEdit,
  HelpCircle,
  Lightbulb,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ClozeQuiz,
  Difficulty,
  MLPWeights,
  QuizBundle,
  ReviewOutcome,
  StudyCard,
} from '../types';
import {
  CLUSTER_PROFILES,
  formatDurationKorean,
  getCardRetentionAtDay,
  getDifficultyLabel,
  inferCardCluster,
} from '../lib/mlp';
import { CURATED_QUIZ_BANK } from '../data/quizBank';

interface ReviewModalProps {
  card: StudyCard;
  weights: MLPWeights;
  cachedQuiz?: QuizBundle;
  onSaveQuizCache: (cardId: string, bundle: QuizBundle) => void;
  onAttachClozeQuiz?: (cardId: string, clozeQuiz: ClozeQuiz) => void;
  onSwitchToBlankPage?: (card: StudyCard) => void;
  onClose: () => void;
  onSubmitReview: (cardId: string, outcome: ReviewOutcome, difficulty: Difficulty) => void;
}

function normalizeClozeAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.,'"`()[\]{}]/g, '');
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  card,
  weights,
  cachedQuiz,
  onSaveQuizCache,
  onAttachClozeQuiz,
  onSwitchToBlankPage,
  onClose,
  onSubmitReview,
}) => {
  const [mode, setMode] = useState<'cloze' | 'quiz' | 'manual'>(
    card.clozeQuiz ? 'cloze' : 'quiz'
  );
  const [difficulty, setDifficulty] = useState<Difficulty>(card.difficulty);

  // Cloze quiz state
  const [clozeQuiz, setClozeQuiz] = useState<ClozeQuiz | null>(() => card.clozeQuiz ?? null);
  const [clozeInput, setClozeInput] = useState('');
  const [clozeGraded, setClozeGraded] = useState<'correct' | 'wrong' | null>(null);
  const [showClozeHint, setShowClozeHint] = useState(false);
  const [isLoadingCloze, setIsLoadingCloze] = useState(false);
  const [clozeError, setClozeError] = useState<string | null>(null);

  // 4-choice Google Search quiz state
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showConceptSummary, setShowConceptSummary] = useState(false);
  const [showNote, setShowNote] = useState(false);

  const [quizBundle, setQuizBundle] = useState<QuizBundle | null>(
    () => cachedQuiz ?? CURATED_QUIZ_BANK[card.id] ?? null
  );
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  const { aiRetention } = getCardRetentionAtDay(weights, card, card.elapsedDays);
  const retentionPct = (aiRetention * 100).toFixed(1);
  const clusterProfile = CLUSTER_PROFILES[inferCardCluster(card)];

  const fetchGeminiCloze = useCallback(async () => {
    setIsLoadingCloze(true);
    setClozeError(null);
    setClozeInput('');
    setClozeGraded(null);
    setShowClozeHint(false);

    try {
      const res = await fetch('/api/cloze-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: card.subject,
          title: card.title,
          note: card.note,
          difficulty,
        }),
      });
      const data = (await res.json()) as Partial<ClozeQuiz> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `서버 응답 오류 (${res.status})`);
      }
      if (!data.question || !data.answer) {
        throw new Error('유효한 빈칸 문제를 생성하지 못했습니다.');
      }
      const nextCloze: ClozeQuiz = {
        question: data.question,
        answer: data.answer,
        hint: data.hint || '핵심 용어를 입력해 보세요.',
        explanation: data.explanation || '',
      };
      setClozeQuiz(nextCloze);
      onAttachClozeQuiz?.(card.id, nextCloze);
    } catch (err: unknown) {
      setClozeError(
        err instanceof Error ? err.message : '빈칸 퀴즈를 생성하는 중 오류가 발생했습니다.'
      );
    } finally {
      setIsLoadingCloze(false);
    }
  }, [card.id, card.note, card.subject, card.title, difficulty, onAttachClozeQuiz]);

  const fetchGeminiQuiz = useCallback(
    async (targetDifficulty: Difficulty | 'all' = 'all') => {
      setIsLoadingQuiz(true);
      setQuizError(null);
      setSelectedOption(null);

      try {
        const res = await fetch('/api/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: card.subject,
            title: card.title,
            note: card.note,
            difficulty: targetDifficulty,
          }),
        });

        const data = (await res.json()) as Partial<QuizBundle> & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || `서버 응답 오류 (${res.status})`);
        }
        if (!data.questions || data.questions.length === 0) {
          throw new Error('생성된 퀴즈 문항이 없습니다.');
        }

        const bundle: QuizBundle = {
          conceptSummary: data.conceptSummary || '',
          questions: data.questions,
          sources: Array.isArray(data.sources) ? data.sources : [],
          generatedBy: data.generatedBy || 'gemini-4-hydrogen + Google Search',
        };

        setQuizBundle(bundle);
        onSaveQuizCache(card.id, bundle);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : '구글 검색 기반 퀴즈를 불러오는 데 실패했습니다.';
        setQuizError(msg);
      } finally {
        setIsLoadingQuiz(false);
      }
    },
    [card.id, card.note, card.subject, card.title, onSaveQuizCache]
  );

  // Automatically fetch Gemini + Google Search quiz for newly added custom cards in quiz mode
  useEffect(() => {
    if (!cachedQuiz && !CURATED_QUIZ_BANK[card.id] && mode === 'quiz' && !quizBundle && !isLoadingQuiz) {
      void fetchGeminiQuiz('all');
    }
  }, [cachedQuiz, card.id, fetchGeminiQuiz, isLoadingQuiz, mode, quizBundle]);

  // Automatically fetch Cloze quiz if user switches to cloze mode on a card without one
  useEffect(() => {
    if (mode === 'cloze' && !clozeQuiz && !isLoadingCloze && !clozeError) {
      void fetchGeminiCloze();
    }
  }, [clozeError, clozeQuiz, fetchGeminiCloze, isLoadingCloze, mode]);

  const activeQuestion = useMemo(() => {
    if (!quizBundle || quizBundle.questions.length === 0) return null;
    return (
      quizBundle.questions.find((q) => q.difficulty === difficulty) ??
      quizBundle.questions[0]
    );
  }, [quizBundle, difficulty]);

  const handleSelectDifficulty = (level: Difficulty) => {
    setDifficulty(level);
    setSelectedOption(null);
  };

  const handleGradeCloze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clozeQuiz || !clozeInput.trim()) return;
    const isMatch =
      normalizeClozeAnswer(clozeInput) === normalizeClozeAnswer(clozeQuiz.answer);
    setClozeGraded(isMatch ? 'correct' : 'wrong');
  };

  const isChoiceAnswered = selectedOption !== null && activeQuestion !== null;
  const isChoiceCorrect = isChoiceAnswered && selectedOption === activeQuestion.correctIndex;

  const isAnyGraded =
    (mode === 'cloze' && clozeGraded !== null) || (mode === 'quiz' && isChoiceAnswered);
  const isAnyCorrect =
    (mode === 'cloze' && clozeGraded === 'correct') || (mode === 'quiz' && isChoiceCorrect);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0 truncate">
            <span className="font-semibold text-blue-700 shrink-0">{card.subject}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{clusterProfile.shortLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums shrink-0">
              {card.elapsedDays < 0.04 ? '방금 학습' : `${formatDurationKorean(card.elapsedDays)} 경과`}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular shrink-0">예측 {retentionPct}%</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="review-modal-title" className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                {card.title}
              </h3>
              {card.aiDifficultyReason && (
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                  AI 분석 근거: {card.aiDifficultyReason}
                </p>
              )}
            </div>
            {onSwitchToBlankPage && (
              <button
                type="button"
                onClick={() => onSwitchToBlankPage(card)}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileEdit className="w-3.5 h-3.5" />
                <span>백지 인출하기</span>
              </button>
            )}
          </div>

          {/* 3-Mode Segmented Toggle: Cloze vs 4-Choice vs Manual */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setMode('cloze')}
              className={`py-2 px-2 min-h-[40px] text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'cloze' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              맞춤 빈칸 퀴즈
            </button>
            <button
              type="button"
              onClick={() => setMode('quiz')}
              className={`py-2 px-2 min-h-[40px] text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'quiz' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              난이도별 4지선다
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`py-2 px-2 min-h-[40px] text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'manual'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              직접 자가 점검
            </button>
          </div>

          {/* Difficulty Selector */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-xs font-semibold text-slate-700">
                체감 난이도 (신경망 입력 x₂)
              </label>
              {mode === 'cloze' && (
                <button
                  type="button"
                  disabled={isLoadingCloze}
                  onClick={() => void fetchGeminiCloze()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isLoadingCloze ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>AI 새 빈칸 문제</span>
                </button>
              )}
              {mode === 'quiz' && (
                <button
                  type="button"
                  disabled={isLoadingQuiz}
                  onClick={() => void fetchGeminiQuiz('all')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isLoadingQuiz ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>구글 검색 AI 새 문제</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 3] as Difficulty[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleSelectDifficulty(level)}
                  className={`py-2 px-3 min-h-[42px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                    difficulty === level
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {getDifficultyLabel(level)}
                </button>
              ))}
            </div>
          </div>

          {/* MODE 1: Custom Cloze Quiz */}
          {mode === 'cloze' && (
            <div className="space-y-3">
              {isLoadingCloze && (
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
                  <p className="text-xs sm:text-sm font-semibold text-slate-800">
                    Gemini가 핵심 개념의 빈칸 퀴즈를 출제 중입니다...
                  </p>
                </div>
              )}

              {!isLoadingCloze && clozeError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2.5">
                  <div className="flex items-start gap-2 text-rose-800 text-xs sm:text-sm font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{clozeError}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchGeminiCloze()}
                      className="px-3 py-1.5 min-h-[36px] text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg cursor-pointer"
                    >
                      다시 시도
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('manual')}
                      className="px-3 py-1.5 min-h-[36px] text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                    >
                      직접 자가 점검
                    </button>
                  </div>
                </div>
              )}

              {!isLoadingCloze && clozeQuiz && (
                <form
                  onSubmit={handleGradeCloze}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-blue-700">맞춤형 빈칸 채우기 문제</span>
                    <button
                      type="button"
                      onClick={() => setShowClozeHint((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-700 cursor-pointer"
                    >
                      <Lightbulb className="w-3.5 h-3.5" />
                      <span>{showClozeHint ? '힌트 숨기기' : '힌트 보기'}</span>
                    </button>
                  </div>

                  <p className="text-sm font-bold text-slate-900 leading-relaxed whitespace-pre-line">
                    {clozeQuiz.question}
                  </p>

                  {showClozeHint && clozeQuiz.hint && (
                    <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      힌트: {clozeQuiz.hint}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={clozeInput}
                      disabled={clozeGraded === 'correct'}
                      onChange={(e) => {
                        setClozeInput(e.target.value);
                        if (clozeGraded) setClozeGraded(null);
                      }}
                      placeholder="빈칸에 들어갈 정답을 입력하세요"
                      className="flex-1 px-3.5 py-2.5 min-h-[44px] text-sm bg-white rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="submit"
                      disabled={!clozeInput.trim() || clozeGraded === 'correct'}
                      className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      채점하기
                    </button>
                  </div>

                  {clozeGraded && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs leading-relaxed space-y-1.5 ${
                        clozeGraded === 'correct'
                          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                          : 'bg-rose-50/80 border-rose-200 text-rose-950'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold">
                          {clozeGraded === 'correct'
                            ? `정답입니다! (${clozeQuiz.answer})`
                            : `아쉽습니다. 모범 정답은 "${clozeQuiz.answer}" 입니다.`}
                        </p>
                        {clozeGraded === 'wrong' && (
                          <button
                            type="button"
                            onClick={() => setClozeGraded('correct')}
                            className="text-[11px] font-semibold text-blue-700 hover:underline shrink-0 cursor-pointer"
                          >
                            유사 답안 정답 인정
                          </button>
                        )}
                      </div>
                      {clozeQuiz.explanation && (
                        <p className="text-slate-700">{clozeQuiz.explanation}</p>
                      )}
                    </div>
                  )}
                </form>
              )}
            </div>
          )}

          {/* MODE 2: Google Search-Grounded 4-Choice Quiz */}
          {mode === 'quiz' && (
            <div className="space-y-4">
              {isLoadingQuiz && (
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
                  <p className="text-xs sm:text-sm font-semibold text-slate-800">
                    Google 검색으로 개념을 확인해 난이도별 퀴즈를 생성 중입니다...
                  </p>
                  <p className="text-xs text-slate-500">
                    Gemini API가 최신 교육과정 개념을 검색해 4지선다 문항을 출제합니다.
                  </p>
                </div>
              )}

              {!isLoadingQuiz && quizError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2.5">
                  <div className="flex items-start gap-2 text-rose-800 text-xs sm:text-sm font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{quizError}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchGeminiQuiz('all')}
                      className="px-3 py-1.5 min-h-[36px] text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg cursor-pointer"
                    >
                      다시 시도
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('manual')}
                      className="px-3 py-1.5 min-h-[36px] text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      직접 자가 점검으로 전환
                    </button>
                  </div>
                </div>
              )}

              {!isLoadingQuiz && activeQuestion && (
                <>
                  {quizBundle?.conceptSummary && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowConceptSummary((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-700 cursor-pointer"
                      >
                        {showConceptSummary ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {showConceptSummary ? '검색 개념 요약 숨기기' : '구글 검색 개념 요약 보기'}
                        </span>
                      </button>

                      {showConceptSummary && (
                        <div className="mt-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed space-y-2">
                          <p>{quizBundle.conceptSummary}</p>
                          {quizBundle.sources.length > 0 && (
                            <div className="pt-2 border-t border-slate-200/70 space-y-1">
                              <span className="text-[11px] font-semibold text-slate-500 block">
                                참고 검색 출처
                              </span>
                              {quizBundle.sources.map((src, i) => (
                                <a
                                  key={`${src.uri}-${i}`}
                                  href={src.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[11px] text-blue-700 hover:underline truncate"
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{src.title}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-blue-700">
                        난이도 {getDifficultyLabel(activeQuestion.difficulty)} 문제
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        {quizBundle?.generatedBy}
                      </span>
                    </div>

                    <p className="text-sm font-bold text-slate-900 leading-relaxed whitespace-pre-line">
                      {activeQuestion.question}
                    </p>

                    <div className="space-y-2">
                      {activeQuestion.options.map((opt, idx) => {
                        const isPicked = selectedOption === idx;
                        const isOptionCorrect = idx === activeQuestion.correctIndex;

                        let optionClass =
                          'bg-white border-slate-200 text-slate-800 hover:border-blue-400';
                        if (isChoiceAnswered) {
                          if (isOptionCorrect) {
                            optionClass =
                              'bg-emerald-50 border-emerald-500 text-emerald-950 font-semibold';
                          } else if (isPicked && !isOptionCorrect) {
                            optionClass = 'bg-rose-50 border-rose-400 text-rose-900';
                          } else {
                            optionClass = 'bg-white border-slate-200 text-slate-400';
                          }
                        }

                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={isChoiceAnswered}
                            onClick={() => setSelectedOption(idx)}
                            className={`w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-xl border text-xs sm:text-sm transition-colors flex items-start gap-2.5 cursor-pointer disabled:cursor-default ${optionClass}`}
                          >
                            <span className="font-mono-tabular font-semibold shrink-0 mt-0.5">
                              {idx + 1}.
                            </span>
                            <span className="leading-snug">{opt}</span>
                          </button>
                        );
                      })}
                    </div>

                    {isChoiceAnswered && (
                      <div
                        className={`mt-3 p-3.5 rounded-xl border text-xs leading-relaxed ${
                          isChoiceCorrect
                            ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                            : 'bg-rose-50/80 border-rose-200 text-rose-950'
                        }`}
                      >
                        <p className="font-bold mb-1">
                          {isChoiceCorrect
                            ? '정답입니다! 아래 버튼을 눌러 AI 곡선에 반영하세요.'
                            : `오답입니다. 정답은 ${activeQuestion.correctIndex + 1}번입니다.`}
                        </p>
                        <p className="text-slate-700">{activeQuestion.explanation}</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* MODE 3: Manual Self-Test Fallback */}
          {mode === 'manual' && (
            <div>
              <button
                type="button"
                onClick={() => setShowNote((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer"
              >
                {showNote ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span>{showNote ? '핵심 내용 숨기기' : '핵심 내용 / 정답 확인'}</span>
              </button>

              {showNote && (
                <div className="mt-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-relaxed">
                  {card.note || '등록된 세부 메모가 없습니다.'}
                </div>
              )}
            </div>
          )}

          {/* Neural Network Learning Confirmation Actions */}
          <div className="pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-700 mb-2">
              {isAnyGraded
                ? isAnyCorrect
                  ? '퀴즈 정답 확인 완료 — 신경망 기억 상태 반영하기'
                  : '오답 복습 완료 — 신경망 기억 상태 반영하기'
                : '학습 상태 선택 (즉시 MLP 잔차 곡선 보정)'}
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => onSubmitReview(card.id, 'remembered', difficulty)}
                className={`w-full min-h-[46px] px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                  !isAnyGraded || isAnyCorrect
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>완벽히 기억남</span>
                </span>
                <span
                  className={`font-mono-tabular text-xs ${
                    !isAnyGraded || isAnyCorrect ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  곡선 위로 보정
                </span>
              </button>

              <button
                type="button"
                onClick={() => onSubmitReview(card.id, 'confused', difficulty)}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-amber-700" />
                  <span>헷갈림</span>
                </span>
                <span className="font-mono-tabular text-xs text-amber-700">미세 보정</span>
              </button>

              <button
                type="button"
                onClick={() => onSubmitReview(card.id, 'forgotten', difficulty)}
                className={`w-full min-h-[46px] px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                  isAnyGraded && !isAnyCorrect
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200'
                }`}
              >
                <span className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  <span>잊어버림</span>
                </span>
                <span
                  className={`font-mono-tabular text-xs ${
                    isAnyGraded && !isAnyCorrect ? 'text-rose-100' : 'text-rose-700'
                  }`}
                >
                  복습 주기 단축
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
