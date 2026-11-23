import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eraser,
  Eye,
  EyeOff,
  Loader2,
  PenTool,
  PlusCircle,
  RotateCcw,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Undo2,
  X,
} from 'lucide-react';
import {
  BlankPageAnalysis,
  BlankPageWeakPointCard,
  Difficulty,
  MLPWeights,
  ReviewOutcome,
  StudyCard,
  TrainingLogEntry,
  WeaknessPointItem,
} from '../types';
import {
  CLUSTER_PROFILES,
  findOptimalReviewDay,
  formatDurationKorean,
  formatReviewDeadline,
  generateCurvePoints,
  getOutcomeLabel,
  inferCardCluster,
} from '../lib/mlp';

type BlankTool = 'text' | 'pen' | 'eraser';
type BlankPageMode = 'full' | 'weakness-retry';

interface StrokePoint {
  x: number;
  y: number;
}

interface StrokeItem {
  tool: 'pen' | 'eraser';
  color: string;
  size: number;
  points: StrokePoint[];
}

export interface BlankPageAppliedSummary {
  logEntry: TrainingLogEntry;
  headline: string;
  compact: string;
  isOverdue: boolean;
  unresolvedCountAfter: number;
  resolvedNowCount: number;
  collectedNowCount: number;
}

interface BlankPageModalProps {
  card: StudyCard;
  weights: MLPWeights;
  initialMode?: BlankPageMode;
  cardWeakPoints: WeaknessPointItem[];
  onClose: () => void;
  onApplyBlankPageResult: (
    cardId: string,
    analysis: BlankPageAnalysis,
    difficulty: Difficulty
  ) => BlankPageAppliedSummary | null;
  onCreateWeakPointCard: (
    sourceCard: StudyCard,
    weakCard: BlankPageWeakPointCard,
    openReviewImmediately: boolean
  ) => void;
}

const LOGICAL_WIDTH = 1200;
const LOGICAL_HEIGHT = 760;

const PEN_COLORS = [
  { id: 'slate', label: '검정', value: '#0F172A' },
  { id: 'blue', label: '파랑', value: '#2563EB' },
  { id: 'red', label: '빨강', value: '#DC2626' },
] as const;

const PEN_SIZES = [
  { label: '얇게', value: 3 },
  { label: '보통', value: 5.5 },
  { label: '굵게', value: 10 },
] as const;

const ERASER_SIZES = [
  { label: '작게', value: 22 },
  { label: '크게', value: 44 },
] as const;

function drawStrokeOnContext(ctx: CanvasRenderingContext2D, stroke: StrokeItem) {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }

  const pts = stroke.points;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

export const BlankPageModal: React.FC<BlankPageModalProps> = ({
  card,
  weights,
  initialMode = 'full',
  cardWeakPoints,
  onClose,
  onApplyBlankPageResult,
  onCreateWeakPointCard,
}) => {
  const unresolvedWeakPoints = useMemo(
    () => cardWeakPoints.filter((wp) => !wp.resolved),
    [cardWeakPoints]
  );

  const [mode, setMode] = useState<BlankPageMode>(
    initialMode === 'weakness-retry' && unresolvedWeakPoints.length > 0
      ? 'weakness-retry'
      : 'full'
  );
  const [activeTool, setActiveTool] = useState<BlankTool>('pen');
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0].value);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1].value);
  const [eraserSize, setEraserSize] = useState<number>(ERASER_SIZES[0].value);
  const [typedText, setTypedText] = useState('');
  const [strokeCount, setStrokeCount] = useState(0);
  const [showReferenceNote, setShowReferenceNote] = useState(false);

  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<BlankPageAnalysis | null>(null);
  const [appliedSummary, setAppliedSummary] = useState<BlankPageAppliedSummary | null>(null);
  const [weakCardCreated, setWeakCardCreated] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const strokesRef = useRef<StrokeItem[]>([]);
  const activeStrokeRef = useRef<StrokeItem | null>(null);
  const isDrawingRef = useRef(false);

  const clusterProfile = CLUSTER_PROFILES[inferCardCluster(card)];

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) {
      drawStrokeOnContext(ctx, stroke);
    }
  }, []);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'text' || isChecking) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const pt = getCanvasPoint(e);
    const newStroke: StrokeItem = {
      tool: activeTool,
      color: penColor,
      size: activeTool === 'eraser' ? eraserSize : penSize,
      points: [pt],
    };
    activeStrokeRef.current = newStroke;
    isDrawingRef.current = true;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      drawStrokeOnContext(ctx, newStroke);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !activeStrokeRef.current || activeTool === 'text') return;
    e.preventDefault();
    const pt = getCanvasPoint(e);
    const pts = activeStrokeRef.current.points;
    const prev = pts[pts.length - 1];
    const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
    if (dist < 1.5) return;

    pts.push(pt);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const stroke of strokesRef.current) {
        drawStrokeOnContext(ctx, stroke);
      }
      drawStrokeOnContext(ctx, activeStrokeRef.current);
    }
  };

  const finishStroke = () => {
    if (!isDrawingRef.current || !activeStrokeRef.current) return;
    isDrawingRef.current = false;
    strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
    activeStrokeRef.current = null;
    setStrokeCount(strokesRef.current.length);
  };

  const handleUndo = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redrawCanvas();
  };

  const handleClearAll = () => {
    strokesRef.current = [];
    activeStrokeRef.current = null;
    isDrawingRef.current = false;
    setStrokeCount(0);
    setTypedText('');
    setCheckError(null);
    redrawCanvas();
  };

  const handleSwitchTool = (tool: BlankTool) => {
    setActiveTool(tool);
    if (tool === 'text') {
      window.setTimeout(() => textareaRef.current?.focus(), 20);
    }
  };

  const exportCanvasImageBase64 = (): string | undefined => {
    const inkCanvas = canvasRef.current;
    if (!inkCanvas || strokesRef.current.length === 0) return undefined;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = LOGICAL_WIDTH;
    exportCanvas.height = LOGICAL_HEIGHT;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.drawImage(inkCanvas, 0, 0);
    return exportCanvas.toDataURL('image/png');
  };

  const handleInspect = async () => {
    const hasText = typedText.trim().length > 0;
    const hasInk = strokesRef.current.length > 0;
    if (!hasText && !hasInk) {
      setCheckError('백지에 텍스트를 입력하거나 펜으로 필기한 뒤 [검사하기]를 눌러주세요.');
      return;
    }

    const activeMode: BlankPageMode =
      mode === 'weakness-retry' && unresolvedWeakPoints.length > 0 ? 'weakness-retry' : 'full';

    setIsChecking(true);
    setCheckError(null);

    try {
      const canvasImageBase64 = exportCanvasImageBase64();
      const res = await fetch('/api/blank-page-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: card.subject,
          title: card.title,
          note: card.note,
          difficulty: card.difficulty,
          typedText,
          canvasImageBase64,
          mimeType: 'image/png',
          mode: activeMode,
          targetWeakPoints:
            activeMode === 'weakness-retry'
              ? unresolvedWeakPoints.map((wp) => ({
                  id: wp.id,
                  concept: wp.concept,
                  detail: wp.detail,
                  severity: wp.severity,
                }))
              : [],
        }),
      });

      const data = (await res.json()) as Partial<BlankPageAnalysis> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `서버 응답 오류 (${res.status})`);
      }

      if (typeof data.score !== 'number' || !data.feedbackSummary) {
        throw new Error('백지 인출 분석 응답 형식이 올바르지 않습니다.');
      }

      const result: BlankPageAnalysis = {
        mode: data.mode ?? activeMode,
        score: data.score,
        gradeLabel: data.gradeLabel ?? (data.score >= 80 ? '상' : data.score >= 50 ? '중' : '하'),
        recommendedOutcome:
          data.recommendedOutcome ??
          (data.score >= 78 ? 'remembered' : data.score >= 45 ? 'confused' : 'forgotten'),
        rememberedPoints: Array.isArray(data.rememberedPoints) ? data.rememberedPoints : [],
        missingPoints: Array.isArray(data.missingPoints) ? data.missingPoints : [],
        structuredMissingPoints: Array.isArray(data.structuredMissingPoints)
          ? data.structuredMissingPoints
          : [],
        resolvedWeakPointIds: Array.isArray(data.resolvedWeakPointIds)
          ? data.resolvedWeakPointIds
          : [],
        remainingWeakPoints: Array.isArray(data.remainingWeakPoints)
          ? data.remainingWeakPoints
          : [],
        feedbackSummary: data.feedbackSummary,
        weakPointCard: data.weakPointCard,
        generatedBy: data.generatedBy || 'gemini-4-hydrogen (Blank Page Retrieval)',
      };

      setAnalysis(result);
      setWeakCardCreated(false);

      const applied = onApplyBlankPageResult(card.id, result, card.difficulty);
      setAppliedSummary(applied);
    } catch (err: unknown) {
      setCheckError(
        err instanceof Error ? err.message : '백지 인출 내용을 검사하는 중 오류가 발생했습니다.'
      );
    } finally {
      setIsChecking(false);
    }
  };

  const resetForNextAttempt = (nextMode: BlankPageMode) => {
    handleClearAll();
    setAnalysis(null);
    setAppliedSummary(null);
    setWeakCardCreated(false);
    setShowReferenceNote(false);
    setMode(nextMode);
  };

  const currentDeadline = formatReviewDeadline(
    findOptimalReviewDay(generateCurvePoints(weights, card, 70)),
    card.elapsedDays
  );

  const isRetryMode = mode === 'weakness-retry' && unresolvedWeakPoints.length > 0;
  const remainingCountAfterResult = appliedSummary
    ? appliedSummary.unresolvedCountAfter
    : unresolvedWeakPoints.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/55 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="blank-page-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[94vh] flex flex-col bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-3 pb-3 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
              <span className="font-semibold text-blue-700 shrink-0">{card.subject}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{clusterProfile.shortLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums shrink-0">
                {card.elapsedDays < 0.04
                  ? '방금 학습'
                  : `${formatDurationKorean(card.elapsedDays)} 경과`}
              </span>
            </div>
            <h3
              id="blank-page-modal-title"
              className="text-sm sm:text-base font-bold text-slate-900 truncate mt-0.5"
            >
              {isRetryMode
                ? `약점 재도전 (${unresolvedWeakPoints.length}개): ${card.title}`
                : `백지 인출: ${card.title}`}
            </h3>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowReferenceNote((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              {showReferenceNote ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {showReferenceNote ? '정답 숨기기' : '정답 보기'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="백지 인출 닫기"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto">
          {/* Mode Banner: Weakness Retry Prompt vs Switch Prompt */}
          {isRetryMode ? (
            <div className="p-3.5 rounded-2xl bg-rose-50/75 border border-rose-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-rose-900">
                  부족했던 점 집중 재도전 주제 ({unresolvedWeakPoints.length}개)
                </span>
                {!analysis && (
                  <button
                    type="button"
                    onClick={() => setMode('full')}
                    className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 underline cursor-pointer"
                  >
                    전체 내용 백지 인출로 전환
                  </button>
                )}
              </div>
              <ul className="space-y-1 text-xs text-rose-950">
                {unresolvedWeakPoints.map((wp, idx) => (
                  <li key={wp.id} className="flex items-start gap-1.5">
                    <span className="font-mono-tabular font-semibold text-rose-700 shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="font-medium">{wp.concept}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-rose-800">
                위 부족했던 개념들만 백지에 정확히 떠올려 적거나 그려보세요.
              </p>
            </div>
          ) : (
            unresolvedWeakPoints.length > 0 &&
            !analysis && (
              <div className="px-3.5 py-2.5 rounded-xl bg-rose-50/60 border border-rose-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-rose-900 font-medium">
                  이 카드에 모아진 미해결 약점이 <strong>{unresolvedWeakPoints.length}개</strong> 있습니다.
                </span>
                <button
                  type="button"
                  onClick={() => setMode('weakness-retry')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>약점만 재도전하기</span>
                </button>
              </div>
            )
          )}

          {showReferenceNote && (
            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-slate-800 leading-relaxed space-y-1.5">
              <div>
                <span className="font-semibold text-amber-900 block mb-0.5">
                  원래 핵심 개념 (참고용 — 가리고 인출할수록 기억이 강화됩니다)
                </span>
                {card.note || '등록된 세부 메모가 없습니다.'}
              </div>
              {isRetryMode && (
                <div className="pt-1.5 border-t border-amber-200/70 space-y-1">
                  <span className="font-semibold text-amber-900 block">약점 보완 기준</span>
                  {unresolvedWeakPoints.map((wp, i) => (
                    <p key={wp.id} className="text-slate-700">
                      {i + 1}. {wp.detail}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Top Toolbar: [텍스트] [펜] [지우개] + Minimal Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-2xl bg-slate-100 border border-slate-200/80">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleSwitchTool('text')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTool === 'text'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TypeIcon className="w-4 h-4" />
                <span>텍스트</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTool('pen')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTool === 'pen'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PenTool className="w-4 h-4" />
                <span>펜</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTool('eraser')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTool === 'eraser'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Eraser className="w-4 h-4" />
                <span>지우개</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeTool === 'pen' && (
                <>
                  <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-xl border border-slate-200">
                    {PEN_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-label={`${c.label} 잉크`}
                        onClick={() => setPenColor(c.value)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-transform ${
                          penColor === c.value ? 'ring-2 ring-offset-1 ring-blue-600 scale-105' : ''
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
                    {PEN_SIZES.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => setPenSize(s.value)}
                        className={`px-2 py-1 text-[11px] font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                          penSize === s.value
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {activeTool === 'eraser' && (
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
                  {ERASER_SIZES.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => setEraserSize(s.value)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                        eraserSize === s.value
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={strokeCount === 0}
                  onClick={handleUndo}
                  aria-label="필기 실행 취소"
                  className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 rounded-xl border border-slate-200 whitespace-nowrap cursor-pointer disabled:cursor-default"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">되돌리기</span>
                </button>
                <button
                  type="button"
                  disabled={strokeCount === 0 && !typedText}
                  onClick={handleClearAll}
                  className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-40 rounded-xl border border-slate-200 whitespace-nowrap cursor-pointer disabled:cursor-default"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>전체 지우기</span>
                </button>
              </div>
            </div>
          </div>

          {/* Blank Paper Canvas + Overlaid Text Layer */}
          <div className="space-y-1.5">
            <div
              className="relative w-full h-[260px] sm:h-[320px] rounded-2xl border-2 border-slate-200 bg-white overflow-hidden shadow-inner"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, transparent 0px, transparent 27px, #F1F5F9 27px, #F1F5F9 28px)',
              }}
            >
              <textarea
                ref={textareaRef}
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                placeholder={
                  isRetryMode
                    ? activeTool === 'text'
                      ? '위의 부족했던 점들에 대해 기억나는 핵심 내용을 보완해 적어보세요...'
                      : '약점 재도전 모드입니다. 펜으로 도식/키워드를 적거나 [텍스트]를 눌러 타이핑하세요.'
                    : activeTool === 'text'
                      ? '기억나는 핵심 키워드, 정의, 공식, 인과관계를 자유롭게 적어보세요...'
                      : '펜/지우개 모드입니다. 손이나 마우스로 필기·도식을 그리거나 [텍스트] 버튼을 눌러 타이핑하세요.'
                }
                className={`absolute inset-0 w-full h-full bg-transparent resize-none p-4 text-sm sm:text-[15px] leading-7 text-slate-900 placeholder:text-slate-400 focus:outline-none ${
                  activeTool === 'text'
                    ? 'z-20 pointer-events-auto'
                    : 'z-10 pointer-events-none select-none'
                }`}
              />

              <canvas
                ref={canvasRef}
                width={LOGICAL_WIDTH}
                height={LOGICAL_HEIGHT}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                className={`absolute inset-0 w-full h-full touch-none ${
                  activeTool === 'text'
                    ? 'z-10 pointer-events-none'
                    : activeTool === 'eraser'
                      ? 'z-20 pointer-events-auto cursor-cell'
                      : 'z-20 pointer-events-auto cursor-crosshair'
                }`}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
              <span>
                현재 도구:{' '}
                <strong className="text-slate-700">
                  {activeTool === 'text'
                    ? '텍스트 입력'
                    : activeTool === 'pen'
                      ? '펜 필기'
                      : '지우개'}
                </strong>
                {' · '}텍스트와 손글씨를 함께 작성할 수 있습니다.
              </span>
              <span className="tabular-nums font-mono-tabular">
                필기 {strokeCount}획 · 글자 {typedText.trim().length}자
              </span>
            </div>
          </div>

          {/* Error Alert */}
          {checkError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start justify-between gap-3 text-xs text-rose-800"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed">{checkError}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleInspect()}
                className="px-2.5 py-1.5 bg-rose-700 hover:bg-rose-800 text-white font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                다시 시도
              </button>
            </div>
          )}

          {/* Primary Action: [검사하기] */}
          {!analysis && (
            <button
              type="button"
              disabled={isChecking}
              onClick={() => void handleInspect()}
              className={`w-full min-h-[46px] px-4 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                isRetryMode ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isRetryMode
                      ? 'Gemini가 약점 보완 여부를 판정 중입니다...'
                      : 'Gemini가 백지 인출 내용을 채점·분석 중입니다...'}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {isRetryMode
                      ? '검사하기 (약점 해결 판정 + 망각곡선 갱신)'
                      : '검사하기 (Gemini AI 채점 + 약점 자동 수집)'}
                  </span>
                </>
              )}
            </button>
          )}

          {/* Gemini Analysis & Weakness Loop Report */}
          {analysis && (
            <div className="space-y-3.5 pt-1">
              {/* Score + Weakness Loop Status + MLP Curve Update */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-medium text-slate-300 block">
                      {analysis.mode === 'weakness-retry'
                        ? '③ 약점 재도전 이해도 점수'
                        : '③ 이해도 · 인출 정답률 평가'}
                    </span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-2xl font-bold font-mono-tabular text-white">
                        {analysis.score}점
                      </span>
                      <span className="text-sm font-bold text-blue-300">
                        ({analysis.gradeLabel} · {getOutcomeLabel(analysis.recommendedOutcome)})
                      </span>
                    </div>
                  </div>

                  <div className="text-right text-xs">
                    <span className="text-slate-300 block">다음 골든타임 복습 시점</span>
                    <span className="font-bold text-blue-300">
                      {appliedSummary ? appliedSummary.headline : currentDeadline.headline}
                    </span>
                  </div>
                </div>

                {appliedSummary && (
                  <div className="pt-2 border-t border-slate-700/80 text-xs text-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-emerald-300">
                      {analysis.mode === 'weakness-retry'
                        ? appliedSummary.resolvedNowCount > 0
                          ? `기존 약점 ${appliedSummary.resolvedNowCount}개 해결됨! (남은 약점 ${appliedSummary.unresolvedCountAfter}개)`
                          : `약점 재도전 완료 (남은 약점 ${appliedSummary.unresolvedCountAfter}개)`
                        : appliedSummary.collectedNowCount > 0
                          ? `부족했던 점 ${appliedSummary.collectedNowCount}개가 약점 목록에 자동 저장되었습니다.`
                          : '빠뜨린 핵심 개념 없이 인출되었습니다.'}
                    </span>
                    <span className="font-mono-tabular text-blue-300">
                      MLP 보정 ΔR:{' '}
                      {appliedSummary.logEntry.residualPctAfter >= 0
                        ? `+${appliedSummary.logEntry.residualPctAfter}%p`
                        : `${appliedSummary.logEntry.residualPctAfter}%p`}
                    </span>
                  </div>
                )}

                <p className="text-xs text-slate-200 leading-relaxed">{analysis.feedbackSummary}</p>
              </div>

              {/* 1. Remembered Points & 2. Missing Points */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      {analysis.mode === 'weakness-retry'
                        ? '① 이번에 보완·기억한 점'
                        : '① 잘 기억한 점'}
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-emerald-950 leading-relaxed">
                    {analysis.rememberedPoints.map((pt, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="font-mono-tabular font-semibold text-emerald-700 shrink-0">
                          {idx + 1}.
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {analysis.mode === 'weakness-retry'
                        ? '② 여전히 남은 약점 · 보완 포인트'
                        : '② 부족했던 점 (약점 목록 수집)'}
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-amber-950 leading-relaxed">
                    {analysis.missingPoints.map((pt, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="font-mono-tabular font-semibold text-amber-700 shrink-0">
                          {idx + 1}.
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Weakness Retry & Follow-Up Loop Actions */}
              <div className="p-3.5 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-2.5">
                <div className="text-xs">
                  <span className="font-bold text-slate-900 block">
                    {remainingCountAfterResult > 0
                      ? `부족했던 점 ${remainingCountAfterResult}개 — [약점 재도전]으로 바로 보완하기`
                      : '약점 보완 완료 — 다음 복습 이어가기'}
                  </span>
                  <span className="text-slate-600">
                    {remainingCountAfterResult > 0
                      ? '약점 재도전을 누르면 모아진 부족한 점만을 주제로 백지 캔버스가 새로 열립니다.'
                      : '모든 약점이 해결되어 망각곡선 보정값(ΔR)과 복습 주기가 긍정적으로 갱신되었습니다.'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {remainingCountAfterResult > 0 && (
                    <button
                      type="button"
                      onClick={() => resetForNextAttempt('weakness-retry')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[42px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>약점 재도전 ({remainingCountAfterResult}개)</span>
                    </button>
                  )}

                  {analysis.weakPointCard && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (!analysis.weakPointCard) return;
                          onCreateWeakPointCard(card, analysis.weakPointCard, true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>취약점 빈칸 퀴즈 풀기</span>
                      </button>

                      <button
                        type="button"
                        disabled={weakCardCreated}
                        onClick={() => {
                          if (!analysis.weakPointCard) return;
                          onCreateWeakPointCard(card, analysis.weakPointCard, false);
                          setWeakCardCreated(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 disabled:opacity-60 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        <PlusCircle className="w-3.5 h-3.5 text-blue-600" />
                        <span>
                          {weakCardCreated ? '집중 카드 등록됨' : '집중 카드 추가'}
                        </span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => resetForNextAttempt('full')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-100/70 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>전체 백지 인출 다시하기</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
