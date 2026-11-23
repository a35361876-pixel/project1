import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ClozeQuiz,
  Difficulty,
  LearningCluster,
  MLPWeights,
  ReviewOutcome,
  StudyCard,
  SubjectCategory,
  TrainingLogEntry,
  WeaknessPointItem,
  WeaknessSeverity,
} from '../types';
import { INITIAL_STUDY_CARDS } from '../data/seedData';
import { createInitialWeights } from './mlp';
import { OperationType, db, handleFirestoreError } from './firebase';

function sanitizeId(raw: string, prefix = 'id'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  return cleaned.length > 0 ? cleaned : `${prefix}-${Date.now()}`;
}

function flattenW1(w1: number[][]): number[] {
  const flat: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      flat.push(Number((w1[i]?.[j] ?? 0).toFixed(5)));
    }
  }
  return flat;
}

function unflattenW1(flat: number[]): number[][] {
  const w1: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const row: number[] = [];
    for (let j = 0; j < 4; j++) {
      row.push(Number(flat[i * 4 + j] ?? 0));
    }
    w1.push(row);
  }
  return w1;
}

function buildCardPayload(card: StudyCard, uid: string, includeCreatedAt: boolean) {
  const safeId = sanitizeId(card.id, 'card');
  const payload: Record<string, unknown> = {
    id: safeId,
    ownerId: uid,
    subject: card.subject,
    title: card.title.trim().slice(0, 120) || '제목 없음',
    note: card.note.trim().slice(0, 600),
    difficulty: card.difficulty,
    elapsedDays: Math.max(0, Math.min(365, Number(card.elapsedDays) || 0)),
    reviewCount: Math.max(0, Math.min(10000, Math.round(card.reviewCount) || 0)),
    lastOutcome: card.lastOutcome ?? 'none',
    lastReviewedAt: card.lastReviewedAt.slice(0, 60),
    updatedAt: serverTimestamp(),
  };

  if (card.cluster) {
    payload.cluster = card.cluster;
  }
  if (card.clusterReason) {
    payload.clusterReason = card.clusterReason.trim().slice(0, 300);
  }
  if (card.aiDifficultyReason) {
    payload.aiDifficultyReason = card.aiDifficultyReason.trim().slice(0, 300);
  }
  if (typeof card.estimatedMinutes === 'number' && card.estimatedMinutes >= 1) {
    payload.estimatedMinutes = Math.max(1, Math.min(180, Math.round(card.estimatedMinutes)));
  }
  if (card.clozeQuiz?.question && card.clozeQuiz?.answer) {
    payload.clozeQuestion = card.clozeQuiz.question.trim().slice(0, 400);
    payload.clozeAnswer = card.clozeQuiz.answer.trim().slice(0, 120);
    payload.clozeHint = (card.clozeQuiz.hint || '').trim().slice(0, 200);
    payload.clozeExplanation = (card.clozeQuiz.explanation || '').trim().slice(0, 400);
  }
  if (typeof card.unresolvedWeaknessCount === 'number' && card.unresolvedWeaknessCount >= 0) {
    payload.unresolvedWeaknessCount = Math.max(0, Math.min(100, Math.round(card.unresolvedWeaknessCount)));
  }
  if (typeof card.weaknessSeverityScore === 'number' && card.weaknessSeverityScore >= 0) {
    payload.weaknessSeverityScore = Math.max(0, Math.min(200, Number(card.weaknessSeverityScore.toFixed(2))));
  }

  if (includeCreatedAt) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export async function ensureUserInitialized(user: User): Promise<void> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName: (user.displayName || '학습자').slice(0, 100),
        email: (user.email || '').slice(0, 200),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName: (user.displayName || '학습자').slice(0, 100),
        email: (user.email || '').slice(0, 200),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // Initialize MLP state and seed cards if user has none yet
  const mlpPath = `users/${uid}/modelState/mlp`;
  const mlpRef = doc(db, 'users', uid, 'modelState', 'mlp');
  try {
    const mlpSnap = await getDoc(mlpRef);
    if (!mlpSnap.exists()) {
      const initialWeights = createInitialWeights();
      await setDoc(mlpRef, {
        ownerId: uid,
        w1Flat: flattenW1(initialWeights.w1),
        b1: initialWeights.b1.slice(0, 4),
        w2: initialWeights.w2.slice(0, 4),
        b2: initialWeights.b2,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, mlpPath);
  }

  const cardsPath = `users/${uid}/cards`;
  try {
    const existingCards = await getDocs(
      query(collection(db, 'users', uid, 'cards'), where('ownerId', '==', uid))
    );
    if (existingCards.empty) {
      const batch = writeBatch(db);
      for (const seed of INITIAL_STUDY_CARDS) {
        const ref = doc(db, 'users', uid, 'cards', seed.id);
        batch.set(ref, buildCardPayload(seed, uid, true));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, cardsPath);
  }
}

export function subscribeUserCards(
  uid: string,
  onData: (cards: StudyCard[]) => void
): () => void {
  const path = `users/${uid}/cards`;
  const q = query(collection(db, 'users', uid, 'cards'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: (StudyCard & { sortMs: number })[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
        const rawOutcome = String(data.lastOutcome || 'none');
        const lastOutcome: ReviewOutcome | null =
          rawOutcome === 'remembered' || rawOutcome === 'confused' || rawOutcome === 'forgotten'
            ? rawOutcome
            : null;
        const diffNum = Number(data.difficulty);
        const difficulty: Difficulty = diffNum === 1 ? 1 : diffNum === 3 ? 3 : 2;
        const rawCluster = String(data.cluster || '');
        const cluster: LearningCluster | undefined =
          rawCluster === 'vocab' || rawCluster === 'concept' || rawCluster === 'formula'
            ? rawCluster
            : undefined;
        const clozeQuiz: ClozeQuiz | undefined =
          typeof data.clozeQuestion === 'string' && typeof data.clozeAnswer === 'string'
            ? {
                question: data.clozeQuestion,
                answer: data.clozeAnswer,
                hint: typeof data.clozeHint === 'string' ? data.clozeHint : '',
                explanation: typeof data.clozeExplanation === 'string' ? data.clozeExplanation : '',
              }
            : undefined;
        return {
          id: String(data.id || d.id),
          subject: String(data.subject || '기타') as SubjectCategory,
          title: String(data.title || ''),
          note: String(data.note || ''),
          difficulty,
          elapsedDays: Number(data.elapsedDays ?? 0),
          reviewCount: Number(data.reviewCount ?? 0),
          lastOutcome,
          lastReviewedAt: String(data.lastReviewedAt || ''),
          cluster,
          clusterReason:
            typeof data.clusterReason === 'string' ? data.clusterReason : undefined,
          aiDifficultyReason:
            typeof data.aiDifficultyReason === 'string' ? data.aiDifficultyReason : undefined,
          estimatedMinutes:
            typeof data.estimatedMinutes === 'number' ? data.estimatedMinutes : undefined,
          clozeQuiz,
          unresolvedWeaknessCount:
            typeof data.unresolvedWeaknessCount === 'number'
              ? data.unresolvedWeaknessCount
              : undefined,
          weaknessSeverityScore:
            typeof data.weaknessSeverityScore === 'number'
              ? data.weaknessSeverityScore
              : undefined,
          sortMs: createdAt,
        };
      });
      items.sort((a, b) => b.sortMs - a.sortMs);
      onData(items.map(({ sortMs: _ignored, ...card }) => card));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeUserModelState(
  uid: string,
  onData: (weights: MLPWeights) => void
): () => void {
  const path = `users/${uid}/modelState/mlp`;
  const ref = doc(db, 'users', uid, 'modelState', 'mlp');

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const w1Flat = Array.isArray(data.w1Flat) ? data.w1Flat.map(Number) : [];
      const b1 = Array.isArray(data.b1) ? data.b1.map(Number) : [];
      const w2 = Array.isArray(data.w2) ? data.w2.map(Number) : [];
      if (w1Flat.length === 16 && b1.length === 4 && w2.length === 4) {
        onData({
          w1: unflattenW1(w1Flat),
          b1,
          w2,
          b2: Number(data.b2 ?? 0),
        });
      }
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export function subscribeUserLogs(
  uid: string,
  onData: (logs: TrainingLogEntry[]) => void
): () => void {
  const path = `users/${uid}/logs`;
  const q = query(collection(db, 'users', uid, 'logs'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: (TrainingLogEntry & { sortMs: number })[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
        const diffNum = Number(data.difficulty);
        const difficulty: Difficulty = diffNum === 1 ? 1 : diffNum === 3 ? 3 : 2;
        return {
          id: String(data.id || d.id),
          timestamp: String(data.timestamp || ''),
          cardId: String(data.cardId || ''),
          cardTitle: String(data.cardTitle || ''),
          subject: String(data.subject || '기타') as SubjectCategory,
          outcome: String(data.outcome || 'remembered') as ReviewOutcome,
          difficulty,
          elapsedDays: Number(data.elapsedDays ?? 0),
          reviewCountAfter: Number(data.reviewCountAfter ?? 1),
          inputs: (Array.isArray(data.inputs) ? data.inputs.map(Number) : [0, 0, 0, 0]) as [
            number,
            number,
            number,
            number,
          ],
          hiddenActivations: (Array.isArray(data.hiddenActivations)
            ? data.hiddenActivations.map(Number)
            : [0, 0, 0, 0]) as [number, number, number, number],
          outputBefore: Number(data.outputBefore ?? 0),
          outputAfter: Number(data.outputAfter ?? 0),
          target: Number(data.target ?? 0),
          loss: Number(data.loss ?? 0),
          residualPctBefore: Number(data.residualPctBefore ?? 0),
          residualPctAfter: Number(data.residualPctAfter ?? 0),
          optimalDayBefore: Number(data.optimalDayBefore ?? 1),
          optimalDayAfter: Number(data.optimalDayAfter ?? 1),
          deltaW1: [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
          deltaW2: Array.isArray(data.deltaW2) ? data.deltaW2.map(Number) : [0, 0, 0, 0],
          sortMs: createdAt,
        };
      });
      items.sort((a, b) => b.sortMs - a.sortMs);
      onData(items.slice(0, 30).map(({ sortMs: _ignored, ...log }) => log));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createCloudCard(uid: string, card: StudyCard): Promise<void> {
  const safeId = sanitizeId(card.id, 'card');
  const path = `users/${uid}/cards/${safeId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'cards', safeId), buildCardPayload(card, uid, true));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudCard(uid: string, cardId: string): Promise<void> {
  const safeId = sanitizeId(cardId, 'card');
  const path = `users/${uid}/cards/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'cards', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateCloudCardClozeQuiz(
  uid: string,
  cardId: string,
  clozeQuiz: ClozeQuiz
): Promise<void> {
  const safeId = sanitizeId(cardId, 'card');
  const path = `users/${uid}/cards/${safeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'cards', safeId), {
      clozeQuestion: clozeQuiz.question.trim().slice(0, 400),
      clozeAnswer: clozeQuiz.answer.trim().slice(0, 120),
      clozeHint: (clozeQuiz.hint || '').trim().slice(0, 200),
      clozeExplanation: (clozeQuiz.explanation || '').trim().slice(0, 400),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveCloudReviewResult(
  uid: string,
  updatedCard: StudyCard,
  updatedWeights: MLPWeights,
  logEntry: TrainingLogEntry
): Promise<void> {
  const cardId = sanitizeId(updatedCard.id, 'card');
  const logId = sanitizeId(logEntry.id, 'log');
  const batchPath = `users/${uid} (review batch)`;

  try {
    const batch = writeBatch(db);

    const cardRef = doc(db, 'users', uid, 'cards', cardId);
    const cardUpdate: Record<string, unknown> = {
      difficulty: updatedCard.difficulty,
      elapsedDays: Math.max(0, Math.min(365, updatedCard.elapsedDays)),
      reviewCount: Math.max(0, Math.min(10000, Math.round(updatedCard.reviewCount))),
      lastOutcome: updatedCard.lastOutcome ?? 'none',
      lastReviewedAt: updatedCard.lastReviewedAt.slice(0, 60),
      updatedAt: serverTimestamp(),
    };
    if (typeof updatedCard.unresolvedWeaknessCount === 'number') {
      cardUpdate.unresolvedWeaknessCount = Math.max(
        0,
        Math.min(100, Math.round(updatedCard.unresolvedWeaknessCount))
      );
    }
    if (typeof updatedCard.weaknessSeverityScore === 'number') {
      cardUpdate.weaknessSeverityScore = Math.max(
        0,
        Math.min(200, Number(updatedCard.weaknessSeverityScore.toFixed(2)))
      );
    }
    batch.update(cardRef, cardUpdate);

    const mlpRef = doc(db, 'users', uid, 'modelState', 'mlp');
    batch.update(mlpRef, {
      w1Flat: flattenW1(updatedWeights.w1),
      b1: updatedWeights.b1.slice(0, 4),
      w2: updatedWeights.w2.slice(0, 4),
      b2: updatedWeights.b2,
      updatedAt: serverTimestamp(),
    });

    const logRef = doc(db, 'users', uid, 'logs', logId);
    batch.set(logRef, {
      id: logId,
      ownerId: uid,
      cardId,
      cardTitle: logEntry.cardTitle.slice(0, 120),
      subject: logEntry.subject,
      outcome: logEntry.outcome,
      difficulty: logEntry.difficulty,
      elapsedDays: logEntry.elapsedDays,
      reviewCountAfter: Math.round(logEntry.reviewCountAfter),
      inputs: logEntry.inputs.slice(0, 4),
      hiddenActivations: logEntry.hiddenActivations.slice(0, 4),
      outputBefore: logEntry.outputBefore,
      outputAfter: logEntry.outputAfter,
      target: logEntry.target,
      loss: logEntry.loss,
      residualPctBefore: logEntry.residualPctBefore,
      residualPctAfter: logEntry.residualPctAfter,
      optimalDayBefore: logEntry.optimalDayBefore,
      optimalDayAfter: logEntry.optimalDayAfter,
      deltaW2: logEntry.deltaW2.slice(0, 4),
      timestamp: logEntry.timestamp.slice(0, 30),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, batchPath);
  }
}

export async function advanceCloudCardsTime(
  uid: string,
  updatedCards: StudyCard[]
): Promise<void> {
  const path = `users/${uid}/cards`;
  try {
    const batch = writeBatch(db);
    for (const card of updatedCards) {
      const ref = doc(db, 'users', uid, 'cards', sanitizeId(card.id, 'card'));
      batch.update(ref, {
        elapsedDays: Math.max(0, Math.min(365, card.elapsedDays)),
        lastReviewedAt: card.lastReviewedAt.slice(0, 60),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function resetCloudDemo(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const batch = writeBatch(db);

    const existingCards = await getDocs(
      query(collection(db, 'users', uid, 'cards'), where('ownerId', '==', uid))
    );
    for (const d of existingCards.docs) {
      batch.delete(d.ref);
    }

    const existingLogs = await getDocs(
      query(collection(db, 'users', uid, 'logs'), where('ownerId', '==', uid))
    );
    for (const d of existingLogs.docs) {
      batch.delete(d.ref);
    }

    const existingWeakPoints = await getDocs(
      query(collection(db, 'users', uid, 'weakPoints'), where('ownerId', '==', uid))
    );
    for (const d of existingWeakPoints.docs) {
      batch.delete(d.ref);
    }

    for (const seed of INITIAL_STUDY_CARDS) {
      const ref = doc(db, 'users', uid, 'cards', seed.id);
      batch.set(ref, buildCardPayload(seed, uid, true));
    }

    const initialWeights = createInitialWeights();
    const mlpRef = doc(db, 'users', uid, 'modelState', 'mlp');
    batch.update(mlpRef, {
      w1Flat: flattenW1(initialWeights.w1),
      b1: initialWeights.b1.slice(0, 4),
      w2: initialWeights.w2.slice(0, 4),
      b2: initialWeights.b2,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserWeakPoints(
  uid: string,
  onData: (items: WeaknessPointItem[]) => void
): () => void {
  const path = `users/${uid}/weakPoints`;
  const q = query(collection(db, 'users', uid, 'weakPoints'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: (WeaknessPointItem & { sortMs: number })[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
        const severity: WeaknessSeverity = data.severity === 'high' ? 'high' : 'medium';
        return {
          id: String(data.id || d.id),
          cardId: String(data.cardId || ''),
          cardTitle: String(data.cardTitle || ''),
          subject: String(data.subject || '기타') as SubjectCategory,
          concept: String(data.concept || ''),
          detail: String(data.detail || ''),
          severity,
          resolved: Boolean(data.resolved),
          attemptCount: Number(data.attemptCount ?? 0),
          createdAtLabel: String(data.createdAtLabel || ''),
          resolvedAtLabel:
            typeof data.resolvedAtLabel === 'string' ? data.resolvedAtLabel : undefined,
          sortMs: createdAt,
        };
      });
      items.sort((a, b) => b.sortMs - a.sortMs);
      onData(items.map(({ sortMs: _ignored, ...item }) => item));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function saveCloudWeakPointMutations(
  uid: string,
  creates: WeaknessPointItem[],
  updates: WeaknessPointItem[],
  cardSummary?: { cardId: string; unresolvedWeaknessCount: number; weaknessSeverityScore: number }
): Promise<void> {
  if (creates.length === 0 && updates.length === 0 && !cardSummary) return;
  const path = `users/${uid}/weakPoints`;

  try {
    const batch = writeBatch(db);

    for (const item of creates) {
      const safeId = sanitizeId(item.id, 'wp');
      const ref = doc(db, 'users', uid, 'weakPoints', safeId);
      const payload: Record<string, unknown> = {
        id: safeId,
        ownerId: uid,
        cardId: sanitizeId(item.cardId, 'card'),
        cardTitle: (item.cardTitle.trim() || '학습 카드').slice(0, 120),
        subject: item.subject,
        concept: (item.concept.trim() || '보완 필요 개념').slice(0, 160),
        detail: (item.detail.trim() || '부족한 개념을 다시 확인하세요.').slice(0, 500),
        severity: item.severity === 'high' ? 'high' : 'medium',
        resolved: Boolean(item.resolved),
        attemptCount: Math.max(0, Math.min(1000, Math.round(item.attemptCount))),
        createdAtLabel: item.createdAtLabel.slice(0, 40),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (item.resolvedAtLabel) {
        payload.resolvedAtLabel = item.resolvedAtLabel.slice(0, 40);
      }
      batch.set(ref, payload);
    }

    for (const item of updates) {
      const safeId = sanitizeId(item.id, 'wp');
      const ref = doc(db, 'users', uid, 'weakPoints', safeId);
      const patch: Record<string, unknown> = {
        concept: (item.concept.trim() || '보완 필요 개념').slice(0, 160),
        detail: (item.detail.trim() || '부족한 개념을 다시 확인하세요.').slice(0, 500),
        severity: item.severity === 'high' ? 'high' : 'medium',
        resolved: Boolean(item.resolved),
        attemptCount: Math.max(0, Math.min(1000, Math.round(item.attemptCount))),
        updatedAt: serverTimestamp(),
      };
      if (item.resolvedAtLabel) {
        patch.resolvedAtLabel = item.resolvedAtLabel.slice(0, 40);
      }
      batch.update(ref, patch);
    }

    if (cardSummary) {
      const safeCardId = sanitizeId(cardSummary.cardId, 'card');
      const cardRef = doc(db, 'users', uid, 'cards', safeCardId);
      batch.update(cardRef, {
        unresolvedWeaknessCount: Math.max(0, Math.min(100, Math.round(cardSummary.unresolvedWeaknessCount))),
        weaknessSeverityScore: Math.max(0, Math.min(200, Number(cardSummary.weaknessSeverityScore.toFixed(2)))),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudWeakPoint(
  uid: string,
  weakPointId: string,
  cardSummary?: { cardId: string; unresolvedWeaknessCount: number; weaknessSeverityScore: number }
): Promise<void> {
  const safeId = sanitizeId(weakPointId, 'wp');
  const path = `users/${uid}/weakPoints/${safeId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'weakPoints', safeId));
    if (cardSummary) {
      const safeCardId = sanitizeId(cardSummary.cardId, 'card');
      batch.update(doc(db, 'users', uid, 'cards', safeCardId), {
        unresolvedWeaknessCount: Math.max(0, Math.min(100, Math.round(cardSummary.unresolvedWeaknessCount))),
        weaknessSeverityScore: Math.max(0, Math.min(200, Number(cardSummary.weaknessSeverityScore.toFixed(2)))),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
