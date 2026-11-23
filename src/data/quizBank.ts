import { QuizBundle } from '../types';

/**
 * Google 검색으로 개념을 검증해 제작한 기본 학습 카드용 난이도별(쉬움·보통·어려움) 퀴즈 뱅크
 */
export const CURATED_QUIZ_BANK: Record<string, QuizBundle> = {
  'card-eng-1': {
    conceptSummary:
      'ubiquitous는 라틴어 ubique(모든 곳에)에서 유래해 공간적으로 "어디에나 존재하는"을 뜻하고, ephemeral은 그리스어 ephēmeros(하루만 지속되는)에서 유래해 시간적으로 "일시적인, 덧없는"을 의미합니다.',
    generatedBy: 'Google 검색 검증 기본 퀴즈 (Gemini로 새 문제 생성 가능)',
    sources: [
      {
        title: 'Cambridge Dictionary — ubiquitous / ephemeral',
        uri: 'https://dictionary.cambridge.org/',
      },
    ],
    questions: [
      {
        id: 'eng-easy-1',
        difficulty: 1,
        question: '다음 중 형용사 "ubiquitous"의 핵심 의미로 가장 알맞은 것은?',
        options: [
          '어디에나 존재하는, 매우 흔한',
          '하루 만에 사라지는, 덧없는',
          '서로 모순되어 양립할 수 없는',
          '선천적으로 타고난, 고유의',
        ],
        correctIndex: 0,
        explanation:
          'ubiquitous는 "어디에나 있는(omnipresent)"이라는 뜻입니다. "일시적인, 덧없는"은 ephemeral의 뜻입니다.',
      },
      {
        id: 'eng-med-1',
        difficulty: 2,
        question:
          '다음 문장의 빈칸에 문맥상 가장 적절한 어휘는?\n"Social media trends are often ______, gaining massive attention and fading within days."',
        options: ['ephemeral', 'ubiquitous', 'omnipresent', 'pervasive'],
        correctIndex: 0,
        explanation:
          '며칠 만에 사라진다(fading within days)는 시간적 단명성을 묘사하므로 "일시적인, 덧없는"을 뜻하는 ephemeral이 정답입니다.',
      },
      {
        id: 'eng-hard-1',
        difficulty: 3,
        question: '수능 어휘 추론: 다음 어휘와 유의어 연결이 잘못된 것은?',
        options: [
          'ubiquitous — scarce (부족한, 드문)',
          'ubiquitous — omnipresent (어디에나 있는)',
          'ephemeral — transitory (일시적인)',
          'ephemeral — fleeting (순식간에 지나가는)',
        ],
        correctIndex: 0,
        explanation:
          'scarce는 "드문, 희귀한"이라는 뜻으로 ubiquitous의 반의어에 가깝습니다. ubiquitous의 유의어는 omnipresent, pervasive 등입니다.',
      },
    ],
  },
  'card-sci-1': {
    conceptSummary:
      '이온 결합 물질(금속+비금속)은 정전기적 인력으로 결합하며 고체 상태에서는 이온이 이동할 수 없어 전기가 통하지 않지만 액체·수용액에서 전기 전도성이 있습니다. 공유 결합 물질(비금속+비금속)은 전자쌍을 공유하며 대부분 전하를 띤 자유 입자가 없어 전기가 통하지 않습니다(산 등 일부 수용액 제외).',
    generatedBy: 'Google 검색 검증 기본 퀴즈 (Gemini로 새 문제 생성 가능)',
    sources: [
      {
        title: '사이언스올 / EBSi 통합과학 — 화학 결합과 전기 전도성',
        uri: 'https://www.scienceall.com/',
      },
    ],
    questions: [
      {
        id: 'sci-easy-1',
        difficulty: 1,
        question:
          '금속 원소가 전자를 잃어 양이온이 되고 비금속 원소가 전자를 얻어 음이온이 된 뒤, 정전기적 인력으로 형성되는 화학 결합과 대표 물질은?',
        options: [
          '이온 결합 — 염화 나트륨(NaCl)',
          '공유 결합 — 물(H₂O)',
          '이온 결합 — 이산화 탄소(CO₂)',
          '공유 결합 — 산화 마그네슘(MgO)',
        ],
        correctIndex: 0,
        explanation:
          '금속(Na)과 비금속(Cl)의 정전기적 인력으로 만들어지는 결합은 이온 결합이며, NaCl·MgO가 대표적입니다.',
      },
      {
        id: 'sci-med-1',
        difficulty: 2,
        question:
          '고체 상태에서는 전기 전도성이 없으나, 액체(용융액)나 수용액 상태에서는 전류가 잘 흐르는 물질의 결합 방식과 그 이유로 옳은 것은?',
        options: [
          '이온 결합 — 액체·수용액에서 양이온과 음이온이 자유롭게 이동하기 때문',
          '공유 결합 — 물에 녹으면 공유 전자쌍이 자유 전자로 분리되기 때문',
          '금속 결합 — 고체 상태에서 자유 전자가 움직이지 못하기 때문',
          '이온 결합 — 고체 상태에서는 원자들이 옥텟 규칙을 만족하지 못하기 때문',
        ],
        correctIndex: 0,
        explanation:
          '이온 결합 물질은 고체에서 이온이 강하게 고정되어 전기가 안 통하지만, 녹거나 물에 녹으면 이온이 자유롭게 이동해 전류가 흐릅니다.',
      },
      {
        id: 'sci-hard-1',
        difficulty: 3,
        question:
          '통합과학 수능형 판별: 다음 설명 중 화학 결합과 전기 전도성에 대한 진술로 옳지 않은 것은?',
        options: [
          '공유 결합 물질은 전자를 공유하므로 예외 없이 어떤 상태에서도 수용액에 전류가 흐르지 않는다.',
          '고체에서 전기가 통하지 않고 수용액에서 전기가 통하는 AB는 금속 A와 비금속 B의 이온 결합 물질일 가능성이 높다.',
          '설탕(C₁₂H₂₂O₁₁)이나 포도당 같은 분자성 공유 결합 물질은 고체·액체·수용액 모두 전기가 통하지 않는다.',
          '금속 결합 물질은 자유 전자의 존재 때문에 고체와 액체 상태 모두에서 전기 전도성이 있다.',
        ],
        correctIndex: 0,
        explanation:
          '염화수소(HCl) 같은 일부 공유 결합 물질은 물에 녹아 이온화되므로 수용액 상태에서 예외적으로 전류가 흐릅니다.',
      },
    ],
  },
  'card-his-1': {
    conceptSummary:
      '제1차 갑오개혁(1894.6)은 군국기무처를 중심으로 신분제·과거제 폐지, 은본위제, 조세 금납화를 추진했습니다. 제2차 갑오개혁(1894.12)은 군국기무처를 폐지하고 김홍집·박영효 내각이 홍범 14조(최초의 근대적 헌법적 문건, 왕실·국정 사무 분리)와 교육입국조서를 반포했습니다.',
    generatedBy: 'Google 검색 검증 기본 퀴즈 (Gemini로 새 문제 생성 가능)',
    sources: [
      {
        title: '한국민족문화대백과사전 — 갑오개혁·홍범 14조·교육입국조서',
        uri: 'https://encykorea.aks.ac.kr/',
      },
    ],
    questions: [
      {
        id: 'his-easy-1',
        difficulty: 1,
        question: '1894년 제1차 갑오개혁을 심의·의결하기 위해 설치되었던 핵심 개혁 기구는?',
        options: ['군국기무처', '독립협회', '교정청', '통리기무아문'],
        correctIndex: 0,
        explanation:
          '제1차 갑오개혁은 1894년 6월 설치된 군국기무처가 주도하였으며, 제2차 갑오개혁 시기에 폐지되었습니다.',
      },
      {
        id: 'his-med-1',
        difficulty: 2,
        question: '다음 중 제1차 갑오개혁의 주요 내용에 해당하지 않는 것은?',
        options: [
          '지방 행정 구역을 8도에서 23부로 개편하고 재판소를 설치하였다.',
          '공사 노비법을 폐지하여 법제상 신분제를 혁파하였다.',
          '과거제를 폐지하고 문벌과 상관없이 인재를 등용하고자 하였다.',
          '은본위 화폐 제도를 채택하고 조세를 화폐로 납부하는 금납화를 실시하였다.',
        ],
        correctIndex: 0,
        explanation:
          '지방 행정 구역 23부 개편과 재판소(사법권 독립) 설치는 군국기무처 폐지 이후인 제2차 갑오개혁의 내용입니다.',
      },
      {
        id: 'his-hard-1',
        difficulty: 3,
        question:
          '다음 두 사료가 발표된 시기에 추진된 개혁으로 옳은 것은?\n(가) 청에 의존하는 생각을 끊고 왕실 사무와 국정 사무를 엄격히 분리한다.\n(나) 교육은 국가를 보존하는 근본이니 덕육·체육·지육을 힘써야 한다.',
        options: [
          '제2차 갑오개혁 시기로, 홍범 14조와 교육입국조서가 반포되었다.',
          '제1차 갑오개혁 시기로, 과부 재가 허용과 조혼 금지가 처음 의결되었다.',
          '광무개혁 시기로, 대한국 국제가 반포되어 황제권이 절대화되었다.',
          '갑신정변 시기로, 14개조 정강을 통해 지조법 개혁이 추진되었다.',
        ],
        correctIndex: 0,
        explanation:
          '(가)는 1895년 1월 홍범 14조, (나)는 1895년 2월 교육입국조서로 모두 제2차 갑오개혁 시기의 대표 문건입니다.',
      },
    ],
  },
  'card-math-1': {
    conceptSummary:
      '사인법칙 a/sinA = b/sinB = c/sinC = 2R은 외접원의 반지름 R이나 대변·대각 관계를 구할 때 사용하며, 코사인법칙 a² = b² + c² - 2bc·cosA는 두 변과 끼인각 또는 세 변이 주어졌을 때 활용합니다.',
    generatedBy: 'Google 검색 검증 기본 퀴즈 (Gemini로 새 문제 생성 가능)',
    sources: [
      {
        title: '고등학교 수학 I — 사인법칙과 코사인법칙 기출 원리',
        uri: 'https://www.ebsi.co.kr/',
      },
    ],
    questions: [
      {
        id: 'math-easy-1',
        difficulty: 1,
        question:
          '삼각형 ABC에서 외접원의 반지름을 R이라 할 때, 사인법칙을 바르게 나타낸 것은?',
        options: [
          'a / sinA = 2R',
          'a / cosA = 2R',
          'a · sinA = R',
          'a² = b² + c² - 2bc·sinA',
        ],
        correctIndex: 0,
        explanation:
          '사인법칙은 a/sinA = b/sinB = c/sinC = 2R (외접원의 지름)입니다.',
      },
      {
        id: 'math-med-1',
        difficulty: 2,
        question:
          '삼각형 ABC에서 AB = 3, AC = 4이고 cos(∠BAC) = 1/4 일 때, 변 BC의 길이는?',
        options: ['√19', '√13', '5', '√21'],
        correctIndex: 0,
        explanation:
          '코사인법칙에 의해 BC² = 3² + 4² - 2·3·4·(1/4) = 9 + 16 - 6 = 19이므로 BC = √19입니다.',
      },
      {
        id: 'math-hard-1',
        difficulty: 3,
        question:
          '삼각형 ABC에서 AB = 3, AC = 4, cosA = 1/4, BC = √19일 때, 이 삼각형의 외접원의 반지름 R의 값은?',
        options: ['2√285 / 15', '√285 / 15', '√19 / 2', '4√15 / 15'],
        correctIndex: 0,
        explanation:
          'sin²A = 1 - (1/4)² = 15/16 이므로 sinA = √15/4입니다. 사인법칙 2R = BC/sinA = √19 / (√15/4) = 4√19/√15 이므로 R = 2√19/√15 = 2√285/15입니다.',
      },
    ],
  },
};
