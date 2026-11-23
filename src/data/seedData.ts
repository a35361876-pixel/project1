import { StudyCard } from '../types';

export const INITIAL_STUDY_CARDS: StudyCard[] = [
  {
    id: 'card-eng-1',
    subject: '영어',
    title: '영어 필수 어휘 — Ubiquitous / Ephemeral',
    note: 'Ubiquitous(어디에나 있는), Ephemeral(일시적인, 덧없는). 수능 빈출 형용사 어휘.',
    difficulty: 2,
    elapsedDays: 1.25,
    reviewCount: 0,
    lastOutcome: null,
    lastReviewedAt: '1일 6시간 전 학습',
    cluster: 'vocab',
    clusterReason: '수능 빈출 영단어 뜻과 문맥 어휘를 단순 인출하는 어휘 중심 항목입니다.',
    aiDifficultyReason: '추상적 라틴어 어원 형용사 2개를 문맥상 반의어처럼 구분해야 하는 보통 난이도입니다.',
    estimatedMinutes: 8,
    clozeQuiz: {
      question:
        'Smartphones have become ______ in modern life, whereas social media trends are often ______ (짧고 일시적인). 두 번째 빈칸에 알맞은 영단어는?',
      answer: 'ephemeral',
      hint: 'e로 시작하는 9글자 형용사 (덧없는, 단명하는)',
      explanation:
        'ubiquitous는 "어디에나 존재하는", ephemeral은 "일시적인, 수명이 짧은"을 뜻합니다.',
    },
  },
  {
    id: 'card-sci-1',
    subject: '통합과학',
    title: '통합과학 화학결합 — 이온 결합과 공유 결합',
    note: '이온 결합은 고체 상태에서 전기가 통하지 않지만 수용액·액체 상태에서 전도성을 가짐. 공유 결합은 비금속 원소 간 전자쌍 공유.',
    difficulty: 3,
    elapsedDays: 1.65,
    reviewCount: 0,
    lastOutcome: 'forgotten',
    lastReviewedAt: '1일 16시간 전 학습',
    cluster: 'concept',
    clusterReason: '물질의 상태(고체/액체)와 입자 구조의 인과관계를 이해해야 하는 개념 원리 유형입니다.',
    aiDifficultyReason: '이온 결합의 상태별 전기 전도성 차이와 공유 결합 분자 결정의 예외 조건이 자주 오답 함정으로 출제됩니다.',
    estimatedMinutes: 14,
    clozeQuiz: {
      question:
        '염화나트륨(NaCl)과 같은 이온 결합 물질은 고체 상태에서는 이온이 자유롭게 이동하지 못해 전기가 통하지 않지만, 액체나 ( ______ ) 상태에서는 전기 전도성이 있다.',
      answer: '수용액',
      hint: '물에 녹인 상태 (ㅅㅇㅇ)',
      explanation:
        '이온 결합 물질은 물에 녹은 수용액이나 용융액(액체) 상태에서 양이온과 음이온이 자유롭게 이동하므로 전류가 흐릅니다.',
    },
  },
  {
    id: 'card-his-1',
    subject: '한국사',
    title: '한국사 근현대사 — 갑오개혁(1894)과 홍범 14조',
    note: '1차 개혁(군국기무처): 신분제·과거제 폐지, 은본위제. 2차 개혁(홍범 14조): 내각제 도입, 재판소 설치, 교육입국조서.',
    difficulty: 2,
    elapsedDays: 0.75,
    reviewCount: 2,
    lastOutcome: 'remembered',
    lastReviewedAt: '18시간 전 학습',
    cluster: 'vocab',
    clusterReason: '1차·2차 개혁 기구, 연도, 세부 조항을 정확히 짝지어 암기해야 하는 사료·fact 인출형입니다.',
    aiDifficultyReason: '1차 개혁(군국기무처·과거제 폐지)과 2차 개혁(홍범 14조·재판소 설치)의 시기 구분이 핵심 출제 포인트입니다.',
    estimatedMinutes: 10,
    clozeQuiz: {
      question:
        '제2차 갑오개혁 당시 고종이 종묘에 서약하며 발표한 근대적 개혁 강령으로, 청에 대한 사대 폐지와 재판소 설치 등을 담은 문서는 ( ______ )이다.',
      answer: '홍범 14조',
      hint: 'ㅎㅂ 14ㅈ (총 14개 조항)',
      explanation:
        '2차 갑오개혁(1894~1895)에서는 김홍집·박영효 연립 내각이 수립되고 홍범 14조가 반포되었습니다.',
    },
  },
  {
    id: 'card-math-1',
    subject: '수학',
    title: '수학 I 삼각함수 — 코사인 법칙과 사인 법칙',
    note: 'a² = b² + c² - 2bc·cosA, a/sinA = b/sinB = c/sinC = 2R (R은 외접원의 반지름).',
    difficulty: 1,
    elapsedDays: 0.95,
    reviewCount: 1,
    lastOutcome: 'remembered',
    lastReviewedAt: '23시간 전 학습',
    cluster: 'formula',
    clusterReason: '삼각형의 변과 각, 외접원 반지름 관계를 수식으로 적용해 계산하는 문제풀이 군집입니다.',
    aiDifficultyReason: '기본 공식 구조 자체는 명확하지만 도형 문제에서 사인 법칙과 코사인 법칙을 연쇄 적용할 때 계산 실수가 발생합니다.',
    estimatedMinutes: 16,
    clozeQuiz: {
      question:
        '삼각형 ABC의 외접원의 반지름 길이를 R이라 할 때, 사인 법칙에 의해 a / sinA = ( ______ ) 가 성립한다.',
      answer: '2R',
      hint: '외접원의 지름에 해당하는 수식',
      explanation:
        '사인 법칙은 a/sinA = b/sinB = c/sinC = 2R(외접원의 지름)입니다.',
    },
  },
];
