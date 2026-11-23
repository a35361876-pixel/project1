import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  PlusCircle,
  X,
} from 'lucide-react';
import { INITIAL_STUDY_CARDS } from './data/seedData';
import {
  createInitialWeights,
  findOptimalReviewDay,
  formatDurationKorean,
  formatReviewDeadline,
  generateCurvePoints,
  getCardRetentionAtDay,
  getOutcomeLabel,
  inferCardCluster,
  trainResidualMLPStep,
} from './lib/mlp';
import {
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  testFirestoreConnection,
} from './lib/firebase';
import {
  advanceCloudCardsTime,
  createCloudCard,
  deleteCloudCard,
  deleteCloudWeakPoint,
  ensureUserInitialized,
  resetCloudDemo,
  saveCloudReviewResult,
  saveCloudWeakPointMutations,
  subscribeUserCards,
  subscribeUserLogs,
  subscribeUserModelState,
  subscribeUserWeakPoints,
  updateCloudCardClozeQuiz,
} from './lib/firestoreSync';
import {
  BlankPageAnalysis,
  BlankPageWeakPointCard,
  ClozeQuiz,
  Difficulty,
  FeedbackBanner,
  MLPWeights,
  QuizBundle,
  ReviewOutcome,
  StudyCard,
  TrainingLogEntry,
  WeaknessPointItem,
} from './types';
import { ForgettingCurveChart } from './components/ForgettingCurveChart';
import { StudyCardList } from './components/StudyCardList';
import { ReviewModal } from './components/ReviewModal';
import { AddCardForm, AddCardModal, NewCardPayload } from './components/AddCardModal';
import { AIPrinciplePanel, MiniResidualReport } from './components/AIPrinciplePanel';
import { ReviewCalendar } from './components/ReviewCalendar';
import { ExamOptimizerPanel } from './components/ExamOptimizerPanel';
import { BlankPageAppliedSummary, BlankPageModal } from './components/BlankPageModal';
import { WeaknessBankPanel } from './components/WeaknessBankPanel';

const STORAGE_KEYS = {
  CARDS: 'rememberai_residual_cards_v2',
  WEIGHTS: 'rememberai_residual_weights_v2',
  LOGS: 'rememberai_residual_logs_v2',
  QUIZZES: 'rememberai_quizzes_v1',
  WEAK_POINTS: 'rememberai_weak_points_v1',
} as const;

type AppTab = 'dashboard' | 'add' | 'ai';

function loadFromStorage<T>(key: string, fallback: () => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback();
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

function formatWeakPointTimeLabel(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  const timePart = now.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart} ${timePart}`.slice(0, 40);
}

function normalizeConceptKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.,'"`()[\]{}]/g, '');
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);

  const [cards, setCards] = useState<StudyCard[]>(() =>
    loadFromStorage(STORAGE_KEYS.CARDS, () => INITIAL_STUDY_CARDS)
  );
  const [weights, setWeights] = useState<MLPWeights>(() =>
    loadFromStorage(STORAGE_KEYS.WEIGHTS, createInitialWeights)
  );
  const [logs, setLogs] = useState<TrainingLogEntry[]>(() =>
    loadFromStorage(STORAGE_KEYS.LOGS, () => [])
  );
  const [quizCache, setQuizCache] = useState<Record<string, QuizBundle>>(() =>
    loadFromStorage(STORAGE_KEYS.QUIZZES, () => ({}))
  );
  const [weakPoints, setWeakPoints] = useState<WeaknessPointItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.WEAK_POINTS, () => [])
  );

  const [selectedCardId, setSelectedCardId] = useState<string>(() => cards[0]?.id ?? '');
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [reviewingCard, setReviewingCard] = useState<StudyCard | null>(null);
  const [blankPageSession, setBlankPageSession] = useState<{
    card: StudyCard;
    mode: 'full' | 'weakness-retry';
  } | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackBanner | null>(null);

  // Startup connection check & Auth state listener
  useEffect(() => {
    void testFirestoreConnection();
    const unsub = subscribeToAuth((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // Firestore real-time sync when signed in
  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      setCloudReady(false);
      setCards(loadFromStorage(STORAGE_KEYS.CARDS, () => INITIAL_STUDY_CARDS));
      setWeights(loadFromStorage(STORAGE_KEYS.WEIGHTS, createInitialWeights));
      setLogs(loadFromStorage(STORAGE_KEYS.LOGS, () => []));
      setWeakPoints(loadFromStorage(STORAGE_KEYS.WEAK_POINTS, () => []));
      return;
    }

    let cancelled = false;
    let unsubCards: (() => void) | undefined;
    let unsubWeights: (() => void) | undefined;
    let unsubLogs: (() => void) | undefined;
    let unsubWeakPoints: (() => void) | undefined;

    (async () => {
      try {
        await ensureUserInitialized(user);
        if (cancelled) return;

        unsubCards = subscribeUserCards(user.uid, (cloudCards) => {
          setCards(cloudCards);
          setSelectedCardId((prev) =>
            cloudCards.some((c) => c.id === prev) ? prev : (cloudCards[0]?.id ?? '')
          );
          setCloudReady(true);
        });
        unsubWeights = subscribeUserModelState(user.uid, (cloudWeights) => {
          setWeights(cloudWeights);
        });
        unsubLogs = subscribeUserLogs(user.uid, (cloudLogs) => {
          setLogs(cloudLogs);
        });
        unsubWeakPoints = subscribeUserWeakPoints(user.uid, (cloudWeakPoints) => {
          setWeakPoints(cloudWeakPoints);
        });
      } catch (err) {
        if (!cancelled) {
          setAuthError(
            err instanceof Error ? err.message : '클라우드 동기화 초기화 중 오류가 발생했습니다.'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubCards?.();
      unsubWeights?.();
      unsubLogs?.();
      unsubWeakPoints?.();
    };
  }, [user, authReady]);

  // LocalStorage persistence for guest/demo mode
  useEffect(() => {
    if (user) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(cards));
    } catch {
      // Ignore storage quota errors
    }
  }, [cards, user]);

  useEffect(() => {
    if (user) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.WEIGHTS, JSON.stringify(weights));
    } catch {
      // Ignore storage quota errors
    }
  }, [weights, user]);

  useEffect(() => {
    if (user) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
    } catch {
      // Ignore storage quota errors
    }
  }, [logs, user]);

  useEffect(() => {
    if (user) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.WEAK_POINTS, JSON.stringify(weakPoints));
    } catch {
      // Ignore storage quota errors
    }
  }, [weakPoints, user]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.QUIZZES, JSON.stringify(quizCache));
    } catch {
      // Ignore storage quota errors
    }
  }, [quizCache]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 6500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? cards[0] ?? null,
    [cards, selectedCardId]
  );

  const avgRetentionPct = useMemo(() => {
    if (cards.length === 0) return null;
    const sum = cards.reduce(
      (acc, c) => acc + getCardRetentionAtDay(weights, c, c.elapsedDays).aiRetention,
      0
    );
    return (sum / cards.length) * 100;
  }, [cards, weights]);

  const selectedOptDay = useMemo(
    () =>
      selectedCard
        ? findOptimalReviewDay(generateCurvePoints(weights, selectedCard, 70))
        : 0,
    [weights, selectedCard]
  );

  const selectedDeadline = useMemo(
    () =>
      selectedCard
        ? formatReviewDeadline(selectedOptDay, selectedCard.elapsedDays)
        : null,
    [selectedOptDay, selectedCard]
  );

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '로그인에 실패했습니다.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Google 로그인 팝업을 열지 못했습니다. 팝업 차단을 해제한 뒤 다시 시도해 주세요.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signOutUser();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleReviewSubmit = (
    cardId: string,
    outcome: ReviewOutcome,
    difficulty: Difficulty
  ) => {
    const targetCard = cards.find((c) => c.id === cardId);
    if (!targetCard) return;

    const { updatedWeights, updatedCard, logEntry } = trainResidualMLPStep(
      weights,
      targetCard,
      outcome,
      difficulty
    );

    setWeights(updatedWeights);
    setLogs((prev) => [logEntry, ...prev].slice(0, 30));
    setCards((prev) => prev.map((c) => (c.id === cardId ? updatedCard : c)));
    setSelectedCardId(cardId);
    setReviewingCard(null);

    setFeedback({
      id: logEntry.id,
      cardTitle: targetCard.title,
      outcome,
      residualPctAfter: logEntry.residualPctAfter,
      optimalDayBefore: logEntry.optimalDayBefore,
      optimalDayAfter: logEntry.optimalDayAfter,
    });

    if (user) {
      void saveCloudReviewResult(user.uid, updatedCard, updatedWeights, logEntry);
    }
  };

  const handleBlankPageSubmit = (
    cardId: string,
    analysis: BlankPageAnalysis,
    difficulty: Difficulty
  ): BlankPageAppliedSummary | null => {
    const targetCard = cards.find((c) => c.id === cardId);
    if (!targetCard) return null;

    const nowLabel = formatWeakPointTimeLabel();
    let nextWeakPoints = [...weakPoints];
    const creates: WeaknessPointItem[] = [];
    const updates: WeaknessPointItem[] = [];
    let resolvedNowCount = 0;
    let collectedNowCount = 0;

    if (analysis.mode === 'weakness-retry') {
      const resolvedSet = new Set(analysis.resolvedWeakPointIds);

      nextWeakPoints = nextWeakPoints.map((wp) => {
        if (wp.cardId !== cardId || wp.resolved) return wp;

        if (resolvedSet.has(wp.id)) {
          resolvedNowCount += 1;
          const updated: WeaknessPointItem = {
            ...wp,
            resolved: true,
            attemptCount: wp.attemptCount + 1,
            resolvedAtLabel: nowLabel,
          };
          updates.push(updated);
          return updated;
        }

        const matchedRemaining = analysis.remainingWeakPoints.find(
          (rem) =>
            (rem.id && rem.id === wp.id) ||
            normalizeConceptKey(rem.concept) === normalizeConceptKey(wp.concept)
        );
        const updated: WeaknessPointItem = {
          ...wp,
          detail: matchedRemaining?.detail || wp.detail,
          severity: matchedRemaining?.severity || wp.severity,
          attemptCount: wp.attemptCount + 1,
        };
        updates.push(updated);
        return updated;
      });

      analysis.remainingWeakPoints.forEach((draft, idx) => {
        const draftKey = normalizeConceptKey(draft.concept);
        const alreadyExists = nextWeakPoints.some(
          (wp) =>
            wp.cardId === cardId &&
            !wp.resolved &&
            ((draft.id && wp.id === draft.id) || normalizeConceptKey(wp.concept) === draftKey)
        );
        if (!alreadyExists && draft.concept.trim()) {
          const created: WeaknessPointItem = {
            id: `wp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            cardId,
            cardTitle: targetCard.title,
            subject: targetCard.subject,
            concept: draft.concept.trim().slice(0, 160),
            detail: draft.detail.trim().slice(0, 500),
            severity: draft.severity === 'high' ? 'high' : 'medium',
            resolved: false,
            attemptCount: 1,
            createdAtLabel: nowLabel,
          };
          creates.push(created);
          nextWeakPoints = [created, ...nextWeakPoints];
          collectedNowCount += 1;
        }
      });
    } else {
      analysis.structuredMissingPoints.forEach((draft, idx) => {
        const draftKey = normalizeConceptKey(draft.concept);
        if (!draftKey) return;

        const existingIdx = nextWeakPoints.findIndex(
          (wp) =>
            wp.cardId === cardId &&
            !wp.resolved &&
            normalizeConceptKey(wp.concept) === draftKey
        );

        if (existingIdx >= 0) {
          const existing = nextWeakPoints[existingIdx];
          const refreshed: WeaknessPointItem = {
            ...existing,
            detail: draft.detail.trim().slice(0, 500) || existing.detail,
            severity: draft.severity === 'high' ? 'high' : existing.severity,
          };
          nextWeakPoints[existingIdx] = refreshed;
          updates.push(refreshed);
          collectedNowCount += 1;
        } else {
          const created: WeaknessPointItem = {
            id: `wp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            cardId,
            cardTitle: targetCard.title,
            subject: targetCard.subject,
            concept: draft.concept.trim().slice(0, 160),
            detail: draft.detail.trim().slice(0, 500),
            severity: draft.severity === 'high' ? 'high' : 'medium',
            resolved: false,
            attemptCount: 0,
            createdAtLabel: nowLabel,
          };
          creates.push(created);
          nextWeakPoints = [created, ...nextWeakPoints];
          collectedNowCount += 1;
        }
      });
    }

    const unresolvedForCard = nextWeakPoints.filter(
      (wp) => wp.cardId === cardId && !wp.resolved
    );
    const unresolvedCountAfter = unresolvedForCard.length;
    const highSeverityCount = unresolvedForCard.filter((wp) => wp.severity === 'high').length;

    const { updatedWeights, updatedCard, logEntry } = trainResidualMLPStep(
      weights,
      targetCard,
      analysis.recommendedOutcome,
      difficulty,
      analysis.score,
      {
        unresolvedCount: unresolvedCountAfter,
        highSeverityCount,
        resolvedInRetryCount: resolvedNowCount,
        isWeaknessRetry: analysis.mode === 'weakness-retry',
      }
    );

    setWeights(updatedWeights);
    setLogs((prev) => [logEntry, ...prev].slice(0, 30));
    setCards((prev) => prev.map((c) => (c.id === cardId ? updatedCard : c)));
    setWeakPoints(nextWeakPoints);
    setBlankPageSession((prev) =>
      prev && prev.card.id === cardId ? { ...prev, card: updatedCard } : prev
    );
    setSelectedCardId(cardId);

    setFeedback({
      id: logEntry.id,
      cardTitle: `${targetCard.title} (${
        analysis.mode === 'weakness-retry' ? '약점 재도전' : '백지 인출'
      } ${Math.round(analysis.score)}점)`,
      outcome: analysis.recommendedOutcome,
      residualPctAfter: logEntry.residualPctAfter,
      optimalDayBefore: logEntry.optimalDayBefore,
      optimalDayAfter: logEntry.optimalDayAfter,
    });

    if (user) {
      void saveCloudReviewResult(user.uid, updatedCard, updatedWeights, logEntry);
      if (creates.length > 0 || updates.length > 0) {
        void saveCloudWeakPointMutations(user.uid, creates, updates);
      }
    }

    const deadline = formatReviewDeadline(logEntry.optimalDayAfter, 0);
    return {
      logEntry,
      headline: deadline.headline,
      compact: deadline.compact,
      isOverdue: deadline.isOverdue,
      unresolvedCountAfter,
      resolvedNowCount,
      collectedNowCount,
    };
  };

  const handleDeleteWeakPoint = (weakPointId: string) => {
    const target = weakPoints.find((wp) => wp.id === weakPointId);
    const nextWeakPoints = weakPoints.filter((wp) => wp.id !== weakPointId);
    setWeakPoints(nextWeakPoints);

    if (!target) return;

    const remainingForCard = nextWeakPoints.filter(
      (wp) => wp.cardId === target.cardId && !wp.resolved
    );
    const unresolvedCount = remainingForCard.length;
    const highCount = remainingForCard.filter((wp) => wp.severity === 'high').length;
    const severityScore = Number(
      (highCount * 1.4 + Math.max(0, unresolvedCount - highCount) * 0.8).toFixed(2)
    );

    setCards((prev) =>
      prev.map((c) =>
        c.id === target.cardId
          ? {
              ...c,
              unresolvedWeaknessCount: unresolvedCount,
              weaknessSeverityScore: severityScore,
            }
          : c
      )
    );
    setBlankPageSession((prev) =>
      prev && prev.card.id === target.cardId
        ? {
            ...prev,
            card: {
              ...prev.card,
              unresolvedWeaknessCount: unresolvedCount,
              weaknessSeverityScore: severityScore,
            },
          }
        : prev
    );

    if (user) {
      const cardExists = cards.some((c) => c.id === target.cardId);
      void deleteCloudWeakPoint(
        user.uid,
        weakPointId,
        cardExists
          ? {
              cardId: target.cardId,
              unresolvedWeaknessCount: unresolvedCount,
              weaknessSeverityScore: severityScore,
            }
          : undefined
      );
    }
  };

  const handleCreateWeakPointCard = (
    sourceCard: StudyCard,
    weakCard: BlankPageWeakPointCard,
    openReviewImmediately: boolean
  ) => {
    const existing = cards.find(
      (c) => c.subject === sourceCard.subject && c.title === weakCard.title
    );

    let targetCard: StudyCard;
    if (existing) {
      targetCard = existing;
    } else {
      targetCard = {
        id: `card-${Date.now()}`,
        subject: sourceCard.subject,
        title: weakCard.title,
        note: weakCard.note,
        difficulty: weakCard.difficulty,
        elapsedDays: 0,
        reviewCount: 0,
        lastOutcome: null,
        lastReviewedAt: '방금 등록',
        cluster: inferCardCluster(sourceCard),
        clusterReason: '백지 인출에서 부족했던 개념을 집중 보완하기 위해 생성된 카드입니다.',
        aiDifficultyReason: '백지 인출 오답·누락 분석 결과를 반영한 집중 복습 난이도입니다.',
        estimatedMinutes: 10,
        clozeQuiz: weakCard.clozeQuiz,
      };
      setCards((prev) => [targetCard, ...prev]);
      if (user) {
        void createCloudCard(user.uid, targetCard);
      }
    }

    setSelectedCardId(targetCard.id);
    if (openReviewImmediately) {
      setBlankPageSession(null);
      setActiveTab('dashboard');
      setReviewingCard(targetCard);
    }
  };

  const handleAddCard = (payload: NewCardPayload) => {
    const newCard: StudyCard = {
      id: `card-${Date.now()}`,
      subject: payload.subject,
      title: payload.title,
      note: payload.note,
      difficulty: payload.difficulty,
      elapsedDays: payload.elapsedDays,
      reviewCount: 0,
      lastOutcome: null,
      lastReviewedAt:
        payload.elapsedDays === 0
          ? '방금 등록'
          : `${formatDurationKorean(payload.elapsedDays)} 전 학습`,
      cluster: payload.cluster,
      clusterReason: payload.clusterReason,
      aiDifficultyReason: payload.aiDifficultyReason,
      estimatedMinutes: payload.estimatedMinutes,
      clozeQuiz: payload.clozeQuiz,
    };
    setCards((prev) => [newCard, ...prev]);
    setSelectedCardId(newCard.id);
    setActiveTab('dashboard');

    if (user) {
      void createCloudCard(user.uid, newCard);
    }
  };

  const handleAttachClozeQuiz = (cardId: string, clozeQuiz: ClozeQuiz) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, clozeQuiz } : c))
    );
    setReviewingCard((prev) =>
      prev && prev.id === cardId ? { ...prev, clozeQuiz } : prev
    );
    if (user) {
      void updateCloudCardClozeQuiz(user.uid, cardId, clozeQuiz);
    }
  };

  const handleDeleteCard = (cardId: string) => {
    const orphanedWeakPoints = weakPoints.filter((wp) => wp.cardId === cardId);
    setCards((prev) => {
      const next = prev.filter((c) => c.id !== cardId);
      if (selectedCardId === cardId) {
        setSelectedCardId(next[0]?.id ?? '');
      }
      return next;
    });
    setWeakPoints((prev) => prev.filter((wp) => wp.cardId !== cardId));
    setReviewingCard((prev) => (prev?.id === cardId ? null : prev));
    setBlankPageSession((prev) => (prev?.card.id === cardId ? null : prev));

    if (user) {
      void deleteCloudCard(user.uid, cardId);
      orphanedWeakPoints.forEach((wp) => {
        void deleteCloudWeakPoint(user.uid, wp.id);
      });
    }
  };

  const handleSimulateTimePass = (hours: number) => {
    const addDays = hours / 24;
    const nextCards = cards.map((c) => {
      const nextDays = Number((c.elapsedDays + addDays).toFixed(2));
      return {
        ...c,
        elapsedDays: nextDays,
        lastReviewedAt: `${formatDurationKorean(nextDays)} 전 학습`,
      };
    });
    setCards(nextCards);

    if (user) {
      void advanceCloudCardsTime(user.uid, nextCards);
    }
  };

  const handleResetDemo = () => {
    setCards(INITIAL_STUDY_CARDS);
    setWeights(createInitialWeights());
    setLogs([]);
    setQuizCache({});
    setWeakPoints([]);
    setSelectedCardId(INITIAL_STUDY_CARDS[0].id);
    setFeedback(null);

    if (user) {
      void resetCloudDemo(user.uid);
    }
  };

  const handleSaveQuizCache = (cardId: string, bundle: QuizBundle) => {
    setQuizCache((prev) => ({ ...prev, [cardId]: bundle }));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 lg:pb-12">
      {/* Clean 3-Zone Top Navigation Header */}
      <header className="sticky top-0 z-30 h-[52px] lg:h-16 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('dashboard');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Remember<span className="text-blue-600">AI</span>
          </a>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'text-blue-700 font-semibold border-b-2 border-blue-600'
                  : 'hover:text-slate-900'
              }`}
            >
              대시보드
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('add')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'add'
                  ? 'text-blue-700 font-semibold border-b-2 border-blue-600'
                  : 'hover:text-slate-900'
              }`}
            >
              과목 추가
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'ai'
                  ? 'text-blue-700 font-semibold border-b-2 border-blue-600'
                  : 'hover:text-slate-900'
              }`}
            >
              AI 원리 보기
            </button>
          </nav>

          {/* Zone 3: Auth & Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            {!authReady ? (
              <span className="text-xs text-slate-400 whitespace-nowrap">확인 중...</span>
            ) : user ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-xs font-medium text-slate-700 max-w-[110px] truncate">
                  {user.displayName || user.email}
                </span>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => void handleLogout()}
                  className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>로그아웃</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={authLoading}
                onClick={() => void handleGoogleLogin()}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {authLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LogIn className="w-3.5 h-3.5" />
                )}
                <span>Google 로그인</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="px-3 py-2 min-h-[38px] text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              + 과목 추가
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-5">
        {/* Login / Cloud Sync Info Strip (single Google login button remains in header) */}
        {authReady && !user && (
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-slate-600">
            <span className="font-semibold text-slate-900">현재 체험 모드(로컬 저장)</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span>상단 Google 로그인 시 나만의 학습 카드·약점 목록·신경망 가중치가 클라우드에 저장됩니다.</span>
          </div>
        )}

        {authReady && user && (
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              로그인 계정: <strong className="text-slate-800">{user.displayName || user.email}</strong>{' '}
              ({user.email})
            </span>
            <span className="font-medium text-blue-700">
              {cloudReady ? '클라우드 실시간 동기화 중' : '클라우드 데이터 불러오는 중...'}
            </span>
          </div>
        )}

        {authError && (
          <div
            role="alert"
            className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs"
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-rose-600 hover:text-rose-900 font-semibold shrink-0 cursor-pointer"
            >
              닫기
            </button>
          </div>
        )}

        {/* Live Neural Residual Update Banner */}
        {feedback && (
          <div
            role="status"
            aria-live="polite"
            className="bg-slate-900 text-white rounded-2xl px-4 py-3.5 flex items-start justify-between gap-3 shadow-sm"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm leading-snug">
                <p className="font-semibold">
                  신경망 곡선 보정 완료 —{' '}
                  <span className="text-blue-300">
                    {formatReviewDeadline(feedback.optimalDayAfter, 0).headline} 복습하세요
                  </span>
                </p>
                <p className="text-slate-300 text-xs mt-0.5 font-mono-tabular">
                  {feedback.cardTitle} · {getOutcomeLabel(feedback.outcome)} · 잔차 보정량 ΔR:{' '}
                  {feedback.residualPctAfter >= 0
                    ? `+${feedback.residualPctAfter}%p`
                    : `${feedback.residualPctAfter}%p`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="알림 닫기"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white rounded-lg cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Top Summary KPI Bar */}
        <section aria-label="학습 요약 지표" className="grid grid-cols-3 gap-2.5 sm:gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500">평균 기억 잔존율</div>
            <div className="text-lg sm:text-2xl font-bold font-mono-tabular text-slate-900 mt-0.5">
              {avgRetentionPct === null ? '—' : `${avgRetentionPct.toFixed(1)}%`}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500">선택 과목 복습 기한</div>
            <div
              className={`text-sm sm:text-lg font-bold mt-1 leading-tight ${
                !selectedDeadline
                  ? 'text-slate-400'
                  : selectedDeadline.isOverdue
                    ? 'text-rose-600'
                    : 'text-blue-700'
              }`}
            >
              {selectedDeadline ? selectedDeadline.compact : '과목 없음'}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500">누적 신경망 학습</div>
            <div className="text-lg sm:text-2xl font-bold font-mono-tabular text-slate-900 mt-0.5">
              {logs.length}회
            </div>
          </div>
        </section>

        {/* Tab Views */}
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            <ReviewCalendar
              cards={cards}
              weights={weights}
              selectedCardId={selectedCard?.id ?? ''}
              onSelectCard={(id) => setSelectedCardId(id)}
              onStartReview={(card) => setReviewingCard(card)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-7 space-y-5">
                {selectedCard ? (
                  <>
                    <ForgettingCurveChart
                      weights={weights}
                      selectedCard={selectedCard}
                      onOpenReview={(card) => setReviewingCard(card)}
                      onOpenBlankPage={(card) =>
                        setBlankPageSession({ card, mode: 'full' })
                      }
                    />
                    <MiniResidualReport
                      weights={weights}
                      selectedCard={selectedCard}
                      latestLog={logs[0] || null}
                      onOpenAiTab={() => setActiveTab('ai')}
                    />
                  </>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
                    <p className="text-sm font-bold text-slate-900">
                      등록된 학습 과목이 없습니다.
                    </p>
                    <p className="text-xs text-slate-500">
                      새 학습 과목을 추가하면 에빙하우스 기준선과 AI 신경망 보정 곡선이 표시됩니다.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-4 py-2.5 min-h-[40px] text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer"
                      >
                        + 새 과목 추가하기
                      </button>
                      <button
                        type="button"
                        onClick={handleResetDemo}
                        className="px-4 py-2.5 min-h-[40px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        샘플 과목 다시 불러오기
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-5">
                <StudyCardList
                  cards={cards}
                  weights={weights}
                  weakPoints={weakPoints}
                  selectedCardId={selectedCard?.id ?? ''}
                  onSelectCard={(id) => setSelectedCardId(id)}
                  onStartReview={(card) => setReviewingCard(card)}
                  onStartBlankPage={(card) =>
                    setBlankPageSession({ card, mode: 'full' })
                  }
                  onStartWeaknessRetry={(card) =>
                    setBlankPageSession({ card, mode: 'weakness-retry' })
                  }
                  onDeleteCard={handleDeleteCard}
                  onOpenAddTab={() => setActiveTab('add')}
                />
              </div>
            </div>

            <WeaknessBankPanel
              cards={cards}
              weakPoints={weakPoints}
              onStartWeaknessRetry={(card) => {
                setSelectedCardId(card.id);
                setBlankPageSession({ card, mode: 'weakness-retry' });
              }}
              onStartBlankPage={(card) => {
                setSelectedCardId(card.id);
                setBlankPageSession({ card, mode: 'full' });
              }}
              onDeleteWeakPoint={handleDeleteWeakPoint}
            />

            <ExamOptimizerPanel
              cards={cards}
              weights={weights}
              selectedCardId={selectedCard?.id ?? ''}
              onSelectCard={(id) => setSelectedCardId(id)}
              onStartReview={(card) => setReviewingCard(card)}
            />
          </div>
        )}

        {activeTab === 'add' && (
          <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">새 학습 과목 추가</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                이미지 OCR 스캔 또는 개념 입력 후 Gemini AI가 군집·난이도·빈칸 퀴즈를 자동 분석합니다.
              </p>
            </div>
            <AddCardForm onAddCard={handleAddCard} />
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="max-w-4xl mx-auto">
            <AIPrinciplePanel
              cards={cards}
              weights={weights}
              selectedCard={selectedCard ?? INITIAL_STUDY_CARDS[0]}
              logs={logs}
              onSimulateTimePass={handleSimulateTimePass}
              onResetDemo={handleResetDemo}
            />
          </div>
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="하단 내비게이션"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-[60px] bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 items-center"
      >
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'dashboard' ? 'text-blue-600' : 'text-slate-500'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span className="text-[11px] font-semibold tracking-tight">대시보드</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('add')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'add' ? 'text-blue-600' : 'text-slate-500'
          }`}
        >
          <PlusCircle className="w-5 h-5" />
          <span className="text-[11px] font-semibold tracking-tight">과목 추가</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ai')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'ai' ? 'text-blue-600' : 'text-slate-500'
          }`}
        >
          <BrainCircuit className="w-5 h-5" />
          <span className="text-[11px] font-semibold tracking-tight">AI 원리 보기</span>
        </button>
      </nav>

      {/* Modals */}
      {reviewingCard && (
        <ReviewModal
          card={reviewingCard}
          weights={weights}
          cachedQuiz={quizCache[reviewingCard.id]}
          onSaveQuizCache={handleSaveQuizCache}
          onAttachClozeQuiz={handleAttachClozeQuiz}
          onSwitchToBlankPage={(card) => {
            setReviewingCard(null);
            setBlankPageSession({ card, mode: 'full' });
          }}
          onClose={() => setReviewingCard(null)}
          onSubmitReview={handleReviewSubmit}
        />
      )}

      {blankPageSession && (
        <BlankPageModal
          key={`${blankPageSession.card.id}-${blankPageSession.mode}`}
          card={blankPageSession.card}
          weights={weights}
          initialMode={blankPageSession.mode}
          cardWeakPoints={weakPoints.filter((wp) => wp.cardId === blankPageSession.card.id)}
          onClose={() => setBlankPageSession(null)}
          onApplyBlankPageResult={handleBlankPageSubmit}
          onCreateWeakPointCard={handleCreateWeakPointCard}
        />
      )}

      {isAddModalOpen && (
        <AddCardModal
          onClose={() => setIsAddModalOpen(false)}
          onAddCard={handleAddCard}
        />
      )}
    </div>
  );
}
