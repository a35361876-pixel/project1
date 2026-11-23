import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { MLPWeights, StudyCard } from '../types';
import {
  buildReviewSchedule,
  ScheduledReviewItem,
  toDateKey,
} from '../lib/mlp';

interface ReviewCalendarProps {
  cards: StudyCard[];
  weights: MLPWeights;
  selectedCardId: string;
  onSelectCard: (cardId: string) => void;
  onStartReview: (card: StudyCard) => void;
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

function buildCalendarDays(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startDayOfWeek = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startDayOfWeek);

  const lastOfMonth = new Date(year, month + 1, 0);
  const totalCells = startDayOfWeek + lastOfMonth.getDate() > 35 ? 42 : 35;

  const days: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    days.push(
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    );
  }
  return days;
}

function formatDateHeading(dateKey: string, todayKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const weekday = WEEKDAYS_KO[dateObj.getDay()];
  const base = `${m}월 ${d}일 (${weekday})`;
  return dateKey === todayKey ? `${base} · 오늘` : base;
}

export const ReviewCalendar: React.FC<ReviewCalendarProps> = ({
  cards,
  weights,
  selectedCardId,
  onSelectCard,
  onStartReview,
}) => {
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const now = useMemo(() => new Date(nowTick), [nowTick]);
  const todayKey = useMemo(() => toDateKey(now), [now]);

  const [viewedMonth, setViewedMonth] = useState<{ year: number; month: number }>(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }));
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => todayKey);

  // Refresh clock every 30 seconds so concrete review times stay accurate
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Refresh timestamp immediately when cards/weights update after review or time-pass demo
  useEffect(() => {
    setNowTick(Date.now());
  }, [cards, weights]);

  const scheduleItems = useMemo(
    () => buildReviewSchedule(cards, weights, now),
    [cards, weights, now]
  );

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ScheduledReviewItem[]>();
    for (const item of scheduleItems) {
      const existing = map.get(item.dateKey);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.dateKey, [item]);
      }
    }
    return map;
  }, [scheduleItems]);

  const todayItems = itemsByDate.get(todayKey) ?? [];
  const todayOverdueCount = useMemo(
    () => todayItems.filter((item) => item.isOverdue).length,
    [todayItems]
  );

  const selectedItems = itemsByDate.get(selectedDateKey) ?? [];

  const calendarDays = useMemo(
    () => buildCalendarDays(viewedMonth.year, viewedMonth.month),
    [viewedMonth.year, viewedMonth.month]
  );

  const nextScheduledItem = useMemo(
    () => scheduleItems.find((item) => item.dateKey !== selectedDateKey) ?? scheduleItems[0] ?? null,
    [scheduleItems, selectedDateKey]
  );

  const handlePrevMonth = () => {
    setViewedMonth((prev) =>
      prev.month === 0
        ? { year: prev.year - 1, month: 11 }
        : { year: prev.year, month: prev.month - 1 }
    );
  };

  const handleNextMonth = () => {
    setViewedMonth((prev) =>
      prev.month === 11
        ? { year: prev.year + 1, month: 0 }
        : { year: prev.year, month: prev.month + 1 }
    );
  };

  const handleJumpToDate = (date: Date) => {
    setViewedMonth({ year: date.getFullYear(), month: date.getMonth() });
    setSelectedDateKey(toDateKey(date));
  };

  const handleJumpToday = () => {
    handleJumpToDate(now);
  };

  const isViewingTodayMonth =
    viewedMonth.year === now.getFullYear() && viewedMonth.month === now.getMonth();

  return (
    <section
      aria-label="다음 복습 일정 달력"
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              복습 일정 달력
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            AI 보정 망각곡선 70% 도달 시점을 기준으로 날짜와 구체적인 복습 시간을 안내합니다.
          </p>
        </div>

        {/* Month Navigation Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="이전 달"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="px-2.5 text-sm font-bold text-slate-900 font-mono-tabular whitespace-nowrap">
            {viewedMonth.year}년 {viewedMonth.month + 1}월
          </span>

          <button
            type="button"
            onClick={handleNextMonth}
            aria-label="다음 달"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {(!isViewingTodayMonth || selectedDateKey !== todayKey) && (
            <button
              type="button"
              onClick={handleJumpToday}
              className="ml-1 px-3 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              오늘
            </button>
          )}
        </div>
      </div>

      {/* Today Review Emphasis Banner */}
      {todayItems.length > 0 ? (
        <div
          role="region"
          aria-label="오늘 할 복습 알림"
          className={`rounded-xl border px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            todayOverdueCount > 0
              ? 'bg-rose-50/75 border-rose-200 text-rose-950'
              : 'bg-amber-50/80 border-amber-200 text-amber-950'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {todayOverdueCount > 0 ? (
              <AlertTriangle
                className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                aria-hidden="true"
              />
            ) : (
              <CalendarClock
                className="w-4 h-4 text-amber-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold leading-snug">
                {todayOverdueCount > 0
                  ? `오늘 복습해야 할 항목 ${todayItems.length}건 (즉시 복습 ${todayOverdueCount}건)`
                  : `오늘 예정된 복습 항목 ${todayItems.length}건`}
              </div>
              <div className="text-xs opacity-90 mt-0.5 truncate tabular-nums">
                {todayItems
                  .slice(0, 3)
                  .map(
                    (item) =>
                      `${item.card.subject}(${item.isOverdue ? '지금 바로' : item.timeKor})`
                  )
                  .join(' · ')}
                {todayItems.length > 3 ? ` 외 ${todayItems.length - 3}건` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {selectedDateKey !== todayKey && (
              <button
                type="button"
                onClick={handleJumpToday}
                className="px-3 py-2 min-h-[40px] text-xs font-semibold bg-white/90 hover:bg-white text-slate-800 border border-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                오늘 일정 보기
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const first = todayItems[0];
                onSelectCard(first.card.id);
                onStartReview(first.card);
              }}
              className={`px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                todayOverdueCount > 0
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              우선 항목 복습하기
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            오늘 예정된 복습이 없습니다.
            {nextScheduledItem && (
              <>
                {' '}
                다음 복습:{' '}
                <strong className="text-slate-900">
                  {nextScheduledItem.calendarDate.getMonth() + 1}월{' '}
                  {nextScheduledItem.calendarDate.getDate()}일 {nextScheduledItem.timeKor}
                </strong>{' '}
                ({nextScheduledItem.card.subject})
              </>
            )}
          </span>
          {nextScheduledItem && selectedDateKey !== nextScheduledItem.dateKey && (
            <button
              type="button"
              onClick={() => handleJumpToDate(nextScheduledItem.calendarDate)}
              className="text-blue-700 hover:text-blue-800 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              날짜 보기
            </button>
          )}
        </div>
      )}

      {/* Calendar Grid + Selected Day Time Agenda */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
        {/* Monthly Grid */}
        <div className="lg:col-span-7">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1.5 text-center text-[11px] font-semibold">
            {WEEKDAYS_KO.map((dayName, idx) => (
              <div
                key={dayName}
                className={`py-1 ${
                  idx === 0
                    ? 'text-rose-600'
                    : idx === 6
                      ? 'text-blue-600'
                      : 'text-slate-500'
                }`}
              >
                {dayName}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {calendarDays.map((day) => {
              const key = toDateKey(day);
              const inCurrentMonth = day.getMonth() === viewedMonth.month;
              const isToday = key === todayKey;
              const isSelected = key === selectedDateKey;
              const dayItems = itemsByDate.get(key) ?? [];
              const hasItems = dayItems.length > 0;
              const hasOverdue = dayItems.some((item) => item.isOverdue);
              const firstItem = dayItems[0];

              let cellSurface = 'bg-white border-slate-200/80 hover:border-slate-300';
              if (!inCurrentMonth) {
                cellSurface = 'bg-slate-50/50 border-slate-100 hover:border-slate-200';
              }
              if (isToday && hasItems) {
                cellSurface = hasOverdue
                  ? 'bg-rose-50/85 border-rose-400 hover:border-rose-500'
                  : 'bg-amber-50/90 border-amber-400 hover:border-amber-500';
              } else if (isToday) {
                cellSurface = 'bg-blue-50/45 border-blue-300 hover:border-blue-400';
              } else if (hasItems) {
                cellSurface = 'bg-blue-50/30 border-blue-200 hover:border-blue-300';
              }

              const selectedRing = isSelected
                ? 'ring-2 ring-blue-600 border-blue-600'
                : '';

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedDateKey(key);
                    if (!inCurrentMonth) {
                      setViewedMonth({ year: day.getFullYear(), month: day.getMonth() });
                    }
                  }}
                  aria-label={`${day.getMonth() + 1}월 ${day.getDate()}일${
                    isToday ? ' 오늘' : ''
                  }${hasItems ? `, 복습 ${dayItems.length}건` : ''}`}
                  aria-pressed={isSelected}
                  className={`min-h-[58px] sm:min-h-[82px] p-1.5 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition-colors cursor-pointer ${cellSurface} ${selectedRing}`}
                >
                  <div className="flex items-center justify-between gap-0.5 w-full">
                    <span
                      className={`text-xs font-mono-tabular font-semibold leading-none ${
                        !inCurrentMonth
                          ? 'text-slate-300'
                          : isToday
                            ? hasOverdue
                              ? 'text-rose-700 font-bold'
                              : 'text-amber-800 font-bold'
                            : day.getDay() === 0
                              ? 'text-rose-600'
                              : day.getDay() === 6
                                ? 'text-blue-600'
                                : 'text-slate-800'
                      }`}
                    >
                      {day.getDate()}
                    </span>

                    {isToday && (
                      <span
                        className={`text-[10px] font-bold leading-none ${
                          hasOverdue
                            ? 'text-rose-700'
                            : hasItems
                              ? 'text-amber-800'
                              : 'text-blue-700'
                        }`}
                      >
                        오늘
                      </span>
                    )}
                    {!isToday && dayItems.length > 1 && (
                      <span className="hidden sm:inline text-[10px] font-semibold font-mono-tabular text-blue-700">
                        {dayItems.length}건
                      </span>
                    )}
                  </div>

                  {/* Desktop / Tablet Concrete Times */}
                  {hasItems && (
                    <div className="hidden sm:flex flex-col gap-0.5 mt-1 w-full overflow-hidden">
                      {dayItems.slice(0, 2).map((item) => (
                        <div
                          key={item.card.id}
                          className={`text-[10px] leading-tight truncate font-mono-tabular ${
                            item.isOverdue
                              ? 'text-rose-700 font-semibold'
                              : 'text-blue-800 font-medium'
                          }`}
                        >
                          {item.isOverdue ? '지금' : item.time24} {item.card.subject}
                        </div>
                      ))}
                      {dayItems.length > 2 && (
                        <div className="text-[10px] leading-tight text-slate-500 font-medium">
                          +{dayItems.length - 2}건 더
                        </div>
                      )}
                    </div>
                  )}

                  {/* Mobile Compact Time */}
                  {hasItems && firstItem && (
                    <div className="sm:hidden mt-1 w-full overflow-hidden">
                      <div
                        className={`text-[10px] font-mono-tabular font-semibold leading-tight truncate ${
                          hasOverdue ? 'text-rose-700' : 'text-blue-700'
                        }`}
                      >
                        {firstItem.isOverdue ? '지금' : firstItem.time24}
                      </div>
                      {dayItems.length > 1 && (
                        <div className="text-[9px] text-slate-500 leading-none mt-0.5">
                          외 {dayItems.length - 1}건
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Date Schedule Detail */}
        <div className="lg:col-span-5 lg:border-l lg:border-slate-100 lg:pl-5 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100 flex flex-col">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {formatDateHeading(selectedDateKey, todayKey)}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {selectedDateKey === todayKey
                  ? '오늘 진행해야 할 복습 시간표'
                  : '선택한 날짜의 AI 권장 복습 시간표'}
              </p>
            </div>
            <span className="text-xs font-semibold font-mono-tabular text-slate-600 shrink-0">
              {selectedItems.length}건
            </span>
          </div>

          {selectedItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-3">
              <Clock className="w-5 h-5 text-slate-300 mb-2" aria-hidden="true" />
              <p className="text-xs font-medium text-slate-600">
                이 날짜에 예정된 복습 항목이 없습니다.
              </p>
              {nextScheduledItem && (
                <button
                  type="button"
                  onClick={() => handleJumpToDate(nextScheduledItem.calendarDate)}
                  className="mt-3 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer"
                >
                  다음 일정 보기 ({nextScheduledItem.calendarDate.getMonth() + 1}/
                  {nextScheduledItem.calendarDate.getDate()} {nextScheduledItem.timeKor})
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 mt-1">
              {selectedItems.map((item) => {
                const isCardSelected = item.card.id === selectedCardId;
                return (
                  <div
                    key={item.card.id}
                    onClick={() => onSelectCard(item.card.id)}
                    className={`py-3 px-2.5 -mx-2.5 rounded-xl transition-colors cursor-pointer ${
                      isCardSelected ? 'bg-blue-50/55' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        {/* Time & Urgency Line */}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                          <span
                            className={`font-bold font-mono-tabular ${
                              item.isOverdue ? 'text-rose-700' : 'text-blue-700'
                            }`}
                          >
                            {item.isOverdue
                              ? '지금 바로 복습'
                              : `${item.timeKor} (${item.time24})`}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {item.deadline.sublabel}
                          </span>
                        </div>

                        {/* Subject & Title */}
                        <div className="text-sm font-semibold text-slate-900 mt-1 leading-snug">
                          <span className="text-slate-500 font-medium mr-1.5">
                            {item.card.subject}
                          </span>
                          {item.card.title}
                        </div>

                        {/* Retention Metadata */}
                        <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
                          현재 AI 잔존율{' '}
                          <span
                            className={`font-semibold ${
                              item.aiRetentionPct <= 70 ? 'text-rose-700' : 'text-slate-800'
                            }`}
                          >
                            {item.aiRetentionPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCard(item.card.id);
                          onStartReview(item.card);
                        }}
                        className={`px-3 py-2 min-h-[40px] text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          item.isOverdue
                            ? 'bg-rose-600 text-white hover:bg-rose-700'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                      >
                        복습하기
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
