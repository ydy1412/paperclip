# Commerce workspace — 2026-10-17

## 승인 범위
소싱과 상품은 왼쪽 목록과 오른쪽 공통 편집기, 주문은 넓은 목록과 선택 상세를 사용한다. 소싱의 확인할 일은 이미지 작업의 검토/실패를 별도 집계하는 보조 보기다. 설정은 사업자·쇼핑몰 / 배송대행지 / 수집 도구 / 자동화·데이터로 구획한다. 기준은 2026-10-17 Chrome 감사 및 승인 시안 2, 주문 시안 1이다. 시안 데이터는 구현에 사용하지 않는다.

## 보존 경계
원본, 인증·세션·쿠키, 상품과 주문의 별도 저장소, 사업자 매핑, 버전 충돌/가격 확인, 중복 전송 방지, 개별 재시도/유료 생성 안내, 백업·복원을 보존한다. 운영 큐/유료 생성/주문 변경은 검증에 사용하지 않는다. 새 검토 완료 상태는 추가하지 않는다.

## 수용 기준
- Commerce에서는 64px 전역 아이콘 레일과160px 문맥 메뉴를 제공하며 다른 영역 내비게이션은 유지한다.
- 프로젝트 선택과 페이지 제목은 한 번 표시한다. 소싱 모든 단계/검색/페이지/수집 큐를 유지한다. 조회 수는 하단 단일 선택이다.
- 상품 편집기를 기본정보, 이미지, 옵션·가격, 쇼핑몰로 나누고 실제 저장 API/보호 로직을 유지한다. 원본/코드/버전은 고급 상세에서 접근한다.
- 이미지 작업은 상품 식별·편집 진입, 원본/결과 비교, 별도 검토·실패 집계를 제공한다.
- 주문 목록의 큰 중복 통계와 제목을 줄이고 상세 필터를 접는다. 일괄 도구는 선택 시 표시한다. 클레임/메모/배송대행 접근을 유지한다.
- 설정은 등록 계정 우선, 제공업체/설치 안내는 추가 흐름에서 보여준다. 상품 연동과 주문 수집 계정이 별개임을 명시한다.
- 토큰 게이트, 타입/테스트/빌드와 Chrome 넓은/좁은 화면, 이미지 로드, 목록→선택→상세 및 격리 주문 동작을 검증한다.

## 진행/검증
1차 구현의 시안 충실도 부족을 교정했고 부모 시각 검토를 통과했다. 전체 검사는 사용자 중단으로 미완료이며 재개하지 않는다. 새 승인 범위는 관련 집중 검사·UI 타입/빌드·토큰 검사 후 PR 검토와 정적 UI 배포다. 기준 origin/dev beb02c11a(PR41). 별도 feature/commerce-workspace 작업트리를 사용한다. 운영 runtime은 별도 baseline이므로 교체하지 않는다.

### 구현 결정
- 두 shell 모두 Commerce에서는 64px 아이콘 레일과160px 문맥 메뉴를 사용한다. 레일의 기존 전체 탐색과 전체 메뉴 진입을 유지한다. Knowledge 및 다른 영역의 기존 탐색은 유지한다.
- 목록과 공통 편집기는 데스크톱에서 각각 스크롤하며 모바일에서는 목록 높이를 제한해 상세 접근을 유지한다. 편집 구획 전환은 draft를 보존한다. 다음 상품은 현재 페이지 안에서만 제공하며 미저장/처리 중에는 차단한다.
- 이미지 확인 필요는 failed/attention 또는 reviewRequired인 **작업 수**다. 소싱 단계의 상품 수와 합산하지 않는다. 20개씩 보여주고 보조 보기를 열 때 현재 페이지 상품만 조회한다. 이미 읽은 상품을 동기적으로 편집기에 전달해 늦은 재조회가 편집을 덮는 경로를 만들지 않는다.
- 검토 완료 상태를 새로 만들지 않았다. 원본과 저장 결과를 비교하고 기존 개별 재시도/유료 생성 분기를 사용한다.
- settingsSection과 orderTab은 URL에서 복구한다. 주문 계정은 사업자·쇼핑몰, 주문 데이터 설정은 자동화·데이터에서 보이며 인증·저장소는 기존 도메인 경계를 유지한다. 숨긴 React 설정 구획은 마운트를 유지해 입력을 보존한다.

### 확인한 결과
- 최종 집중 회귀8파일112테스트 통과(`/tmp/dovix-commerce-correction-focused-final.log`). 조회수 변경, 부분실패/readback, 진행 중 이동 차단, 가격 확인 취소, 편집 보존, 공개된 설정 URL 복구, 접힌 이미지 상품 조회 방지를 포함한다.
- Dobi 도메인 71통과/1skip. skip은 별도 opt-in 실계정 검사다. 송장 필수·보류 발송 차단·일괄 롤백·동시 수정 보호를 확인한다.
- 교정 전 전체 타입/production UI build가 통과했고, 교정 후 UI 타입 및 token gate가 통과했다. 최종 확인은 승인된 UI 범위의 타입/빌드/토큰 검사로 한정한다.
- Chrome 후보 Vite 화면을 운영 API에 읽기 전용으로 연결했다. 운영 저장/큐 추가/이미지 생성/계정 변경은 실행하지 않았다.
- 교정 후1488×1080, 1440×900, 1280×800, 390×844에서 목록/상세와 저장 바를 확인했다. 모바일 DOM 폭은 스크롤바 제외 375이며 문서 가로 overflow가 없었다. 가져오기 폼286px 확인은 교정 전 기록이며 실제 가져오기를 실행하지 않았다.
- 실제 상품 사진 및 이미지 작업 원본/가공 결과의 complete+naturalWidth를 확인했다. 미저장 상품명을 편집 구획 사이에 보존하고 다음 이동을 차단한 뒤 취소했다. 수집 기기 이름의 임시 입력은 설정 구획 이동 후 유지됐고 원래 값으로 되돌렸으며 제출하지 않았다.
- 격리 in-memory 주문 3건에서 선택→일괄 송장 입력→저장→표/상세 재조회와 변경이력을 확인했다. 클레임 1건, CS메모 1건 및 검색 빈 결과를 확인했다. 운영 주문 데이터는 사용하지 않았다.
- 실제 후보 탭의 확인한 콘솔 error는0건이었다. 격리 harness는 파일 HMR 때 createRoot 중복 경고1건이 있었으며 reload 후 저장/복구 흐름의 새 콘솔 오류는 없었다. 임시 viewport는 복구했다.
- 최종 시각 증거는 작업트리 tmp/commerce-workspace의 sourcing-unprocessed-correction2-1488.jpg, sourcing-unprocessed-1280.jpg, products-correction-final-1488.jpg, products-correction-final-1440.jpg, products-correction-final-narrow.jpg에 보관한다. 주문/설정/이미지 보조보기의 이전 기능 캡처도 같은 폴더에 보존한다. Git에는 민감정보 없는 소스·문서·테스트만 포함한다.
- 모바일 sticky 저장 바와 고급상세의 겹침을 실제 발견해 하단 여유 토큰으로 해결했다. 최종 고급상세 bottom477.59 < 저장바 top521.59, 가로 overflow0.1280×800 source-only 가공 시작은 y697~737로 접근 가능하다.
- 브라우저 임시 저장은 company/project/product와 baseRevision을 구분한다. 같은 버전은 복구하고 다른 버전은 명시적 복구/폐기 선택을 제공한다. 복구는 현재 소유/등록/revision을 유지하고 등록 상품의 카테고리를 바꾸지 않는다. 쓰기와 읽기는 같은 검증 계약으로 제한하며 실패는 성공 문구를 표시하지 않는다.247옵션/20만자 초과 설명/미완성 입력/권한 거절/quota 실패 회귀를 포함한다.
- 저장하고 다음은 저장 응답의 실제 편집 계약값을 대조한 뒤만 이동한다. 객체 키 순서와 가격undefined/null은 동일값으로 정규화한다.200응답이라도 가격 등 편집값이 빠지면 초안·오류를 보존하고 이동하지 않는다.

### 외부 native fixture와 운영 대응 검증
- 기본 외부 auto-sourcing fixture는 기존 dirty 작업트리의10/15 DLL이며 가격/price-preview 계약이 빠져 있다. 이번 UI와 무관한 직접 HTTP에서도 가격12000 요청→200/revision 증가→가격null 재조회가 재현됐다. 현재 작업트리와 clean base61c388c79에서 동일 catalog integration4실패/1통과를 실제 재현했다. 해당 dirty 소스는 수정하지 않았다.
- 실제 운영3115가 로드한 릴리스는6cd480793c4205bbf7daaf790d74a64c51ba7f33이다. 같은 HEAD의 clean auto-sourcing-chrome-capture를 공식 AUTO_SOURCING_PROJECT_ROOT로 지정하면 catalog integration5/5통과(23.29초)다.
- 테스트 호스트 별도 사본에 설치 릴리스 API/Core DLL을 복사했다. 설치/격리 SHA256이 각각 일치하며 이 정확한 바이너리의 synthetic DB integration도5/5통과(25.77초)다. 운영 DB/자격/실제 쇼핑몰 호출은 사용하지 않았다.
- 같은 DLL 기반 Chrome 격리 검증에서 브라우저 초안→reload 복구, 가격10000→12000 확인취소/보존→확인저장→다음 이동을 수행했다. catalog-browser-readback-runtime-exact.json은 저장된 title/revision2/판매가[12000]와 바이너리 해시를 기록한다. 이전 catalog-browser-readback.json은 오래된 fixture의 title/revision 증거만이며 가격 저장 성공 근거가 아니다.
- 격리 실제 동시 저장으로409충돌을 일으켜 초안 보존을 확인했다. reload 뒤 다른revision 초안을 자동 적용하지 않고 복구 선택→변경취소 정리를 확인했다.
- 중단된 공식 전체 검사는 대응clean6cd 환경을 사용했다. general-server778파일4shard, serialized151파일4shard, workspace-a(UI704+CLI63파일), workspace-b12프로젝트를 최대2lane/워크스페이스2worker/서버1worker로 시도했으나 중단했다. 당시 상태는 tmp/commerce-workspace/final-test-results.json 및 /tmp/dovix-commerce-final-*.log에 남아 있다. 미실행 그룹이 있으며 다시 실행하지 않는다.


### 한계와 배포 경계
- 운영 API 상품 저장·쇼핑몰 업로드·유료 재생성·주문 수집/발송은 실행하지 않았다. 기존 저장 API/가격·버전·중복 전송 보호는 회귀 테스트로 확인했다.
- 기존 설치형 compatible runtime은 이 작업에서 변경하지 않았다. 머지/배포는 PR 검토 이후 별도 단계다.
- 최초 전체 검사 병렬 실행은 후보 Chrome의 응답 지연을 유발해 본 작업의 검사 프로세스만 중단했다. 이후 실행도 사용자 중단으로 종료했으며 다시 실행하지 않는다. 최초 UI 타입 검사의 plugin-sdk/ui 미빌드 의존 문제는 의존 빌드로 해결했다.


## PR 이후 정적 UI 반영 준비 (읽기 전용 확인)

현재 설치 UI entry `/assets/index-DhP2jgWE.js`는 2026-10-16 Knowledge navigation 정적 overlay 영수증과 일치한다. 기존 Dobi 통합 당시의 오래된 compatible src 스냅샷으로 UI를 되돌리지 않는다. 최신 절차 근거는 `doc/plans/2026-10-15-personal-brain-knowledge.md`의 static UI overlay 및 해당 작업트리 `tmp/knowledge-navigation-speed/deploy-ui.mjs`다.

- 배포 범위: 검토·병합한 dev SHA를 stamp한 `ui/dist/assets`, `index.html`, `sw.js`. Dobi frontend 모듈과 raw 스타일은 이 UI 번들에 포함된다. 설치 코어, 서버 API, 마이그레이션 journal, 도메인 DB, 인증/자격 정보는 교체할 필요가 없다.
- 현재 설치 경로는 CLI current가 가리키는 `@paperclipai/server/ui-dist`다. 기존 해시 자산과 Chrome 수집 확장 다운로드를 보존한다. entry와 stylesheet/hash, core baseline을 반영 직전에 다시 확인한다.
- 2026-10-17 11:10:39 KST 읽기 전용 snapshot: heartbeat running/queued/scheduled_retry 0, plugin running 0, 배송대행 로그인 검증 0, 현재 소싱 image queued/processing 0, publication queued/preparing/sending 0. 서비스 active/health 정상, core `8f8a0ab7e` 유지. 이 snapshot은 이후 재시작이나 데이터 작업의 허가가 아니며 반영 직전에 다시 확인한다.
- 변경 전 `index.html`과 `sw.js`를 별도 mode-0700 백업 폴더에 저장하고 이전 entry·CSS·보호파일 SHA256과 merged dev SHA를 영수증에 남긴다. 서버 app/heartbeat/catalog/knowledge 관련 모듈, DB journal, 확장 ZIP을 보호파일로 잡는다.
- assets를 추가 복사한 뒤 entry 두 파일만 원자 교체한다. 기존 파일을 일괄 삭제하지 않는다. 정적 overlay는 서버 재시작이 필요 없으며 현재 실행 중인 에이전트와 DB를 그대로 둔다.
- 전달된 HTML/JS/CSS 해시와 build commit stamp, health/processStartedAt, 보호파일 불변을 확인하고 Chrome에서 소싱·상품·주문·설정 및 기존 Knowledge 진입을 다시 확인한다.
- 복구는 백업한 entry 두 파일을 원자적으로 복원하고 전달 해시/health를 재확인한다. 이전 hashed assets를 남겨두므로 DB 복원이나 core downgrade가 필요 없다.
- 정적 overlay 범위를 넘어 재시작·서버 변경이 필요해지면 기존 compatible runtime 절차로 범위를 재검토한다. 이 경우 활성 작업 재확인 및 DB 백업/읽기 검증이 선행되어야 한다.

이 작업에서는 배포·재시작·DB 백업·복구를 실행하지 않았다. 부모 에이전트의 PR 최종 확인 및 후속 지시 이후 수행한다. 현재 사전 확인 영수증은 `tmp/commerce-workspace/read-only-preflight.json`이다.

## 승인 시안 2 교정 (2026-10-17 재개)

실제 차이: 240px 단일 메뉴와 40/60 분할, 작은 이미지 옆 세로 폼, 채워진 편집 탭 및 두 줄 저장 바가 승인 시안의 공간 배분·정보 계층과 달랐다. 이전 캡처는 교정 완료 근거로 사용하지 않는다.

- 전역 64px 레일 + Commerce 160px 메뉴(목표 합계224px), 프로젝트 선택 한 번, 작은 제목과 네 개 기본 단계 및 더 보기. 이미지 검토는 작은 보조 진입점.
- 목록32%/편집68%, 목록 내부 검색·페이지 도구, 얇은 구분선과 회색 선택 행. 실제 가공 전 원본과 관리 상품의 저장 경계를 유지한다. 선택만으로 상품 생성·가공을 시작하지 않는다.
- 편집 상단 실제 사진240px와 정보, 밑줄 탭, 사진 아래 전체 너비 설명, 실제 옵션/가격 및 쇼핑몰 상태 요약, 원본 고급 상세. 없는 카테고리명이나 검토 완료 상태를 만들지 않는다.
- 저장 상태 왼쪽/취소·저장·저장하고 다음 오른쪽 한 줄 바. 성공한 저장만 다음 이동, 가격 확인 취소/충돌/실패는 편집 유지. 브라우저 임시 저장 표시는 실제 scope/revision 기반 저장·복구를 구현한 경우에만 사용한다.
- 첫 검증은 Chrome1488×1080 실제 가공 전 상품 선택 캡처와 시안 비교다. 부모 시각 검토 전 긴 전체 검사를 실행하지 않는다. 이후 집중 회귀·격리 저장 행동·좁은 화면/키보드/이미지를 검증했다. 전체 검사는 중단했고 최종 UI 빌드만 수행한다.
- PR 검토 후 dev 병합 및 정적 UI overlay만 반영한다. 코어/API/journal은 보존하고 배포 직전 활성 작업·백업·원자 교체·보호 해시·실서비스 Chrome을 검증한다.

### 교정 시각 검토 및 실제 데이터 경계
- Chrome1488×1080 실제 가공 전 선택에서 전역64+Commerce160=224px, 목록383.67/편집815.33=32/68, 대표240×240 로드 확인. 부모 시각 검토 통과. source-only는 원본 조회와 명시적 가공 시작만 제공하며 임의 저장/이미지 승인/카테고리명을 표시하지 않는다.
- 실제 긴 이미지 HTML 상품도 기존 설명을 sandbox iframe 안에 보존하며 본문 스크롤과 하단 저장 바를 분리한다.
- 카테고리 API 실제 읽기: category-metadata, categoryCode77904는 성공했으나 응답 name이 빈 문자열. 기존 schema와 실제 응답 code/name shape가 일치하며 이름 미제공 안내로 구분한다. 임의 이름을 보완하지 않는다.
- composer-draft는 문자열 보관·실패 무시 계약이라 상품의 버전 및 실패 상태를 표현하지 못한다. 별도 sourcing-product-draft 모듈은 기존 책임 범위 안에서 상품 편집 필드만 복구하고 현재 서버 revision/listings/소유 정보를 유지한다.

### 중단된 전체 검사 이력 (재실행하지 않음)
- workspace-a: UI704파일 중703통과/1실패,7631테스트 통과/1실패(518.55초). 실패는 clipboard-usage의 기존 SourcingCaptureSettings 직접 clipboard 호출이다. 기본61c388c79에도 같은 호출이 있었다. 이번에 변경한 설정 화면 안의 규칙 위반이므로 기존 공용 copyTextToClipboard를 재사용해 수정했다. 복사 대기/성공/후속실패 및 clipboard-usage 집중 재검증은 아래 최종 결과로 해결했다.704파일 전체반복 및 미실행 CLI 재시도는 취소했다.
- workspace-b: shared85파일845개, skills-catalog5파일20개, db46파일161개 통과. adapter-utils는67파일1445통과/11skip,1파일1실패(설치 Claude2.1.81 < 요구2.1.207). 전역 CLI를 변경하지 않는다. clean base 대조 및 이후8프로젝트 재시도는 사용자 중단으로 취소했다.
- general-server1:196파일 중193통과/1실패/2skip,2999테스트 통과/1실패/18skip. Dobi 브라우저 연결 audit 조회가 vi.waitFor의 대기 안에 도착하지 않았다. route는 response finish에서 비동기 logActivity를 시작한다. 추가 대조는 취소했고 기존 실패로 확정하지 않는다.
- general-server0:178파일 중175통과/2실패/1skip,4894테스트 통과/2실패/14skip. chat lost_scheduler_receipt의 wakeup 호출1회 기대가0회였고, real Git40,000파일 스트리밍 검사는300초 timeout이었다. 해당 사례의 추가 대조는 사용자 중단으로 취소했으며 원인을 확정하지 않는다.
- general-server2는200파일3793테스트 통과/1파일skip. general-server3는200파일3732테스트 통과,2파일3테스트 실패(준비 중 DB deadlock, 이미지 worker 선행환경 미설정). serialized0/1 진행 중 사용자 중단으로 종료했다. 미실행 coverage가 있으며 전체 통과가 아니다.

정적 overlay의 활성 작업은 반영 직전/직후 기록·확인 대상이다. 코어/DB/프로세스를 바꾸지 않는 이 절차에 작업0 강제 gate를 추가하지 않는다. 기존 entry/dev SHA/build stamp/보호 해시/processStartedAt 불변과 즉시 복구가 핵심 gate이며 작업을 자동 취소하지 않는다.


## 2026-10-17 사용자 중단 및 테스트 정리

- 사용자의 명시적 중단 요청으로 전체 검사와 임시 서버를 종료했다. 앞의 전체 검사 재개·미실행 그룹 재시도 계획은 취소한다. 중간 결과는 완료나 전체 통과가 아니다.
- 전체 검사 실행 스크립트 2개, 그룹 계획, 격리 native 빌드 사본 및 일회성 fixture를 삭제했다. 스크린샷·실제 검증 영수증과 기존 로그는 근거로 보존했다.
- 탭 전환 시 편집 유지 검사는 기존 초안 복구 흐름에 통합했다. 저장·충돌·가격 응답 누락·초안 복구를 보호하는 검사는 유지한다.
- 대용량 Git 파일 검사는 별도 테스트 정리 변경에서 명시적 opt-in으로 제한한다. 이 정리가 UI 개발·전체 검사·병합·배포 재개를 의미하지 않는다.
- 정리 후 집중 확인: SourcingCatalog 및 sourcing-product-draft 2파일 22개 통과(6.09초). Git stress 기본 실행은 1개 skip/본문 실행 0ms(1.31초). 전체 검사는 다시 실행하지 않았다.
- 별도 테스트 정리 PR: https://github.com/ydy1412/paperclip/pull/41 (`feature/test-scope-cleanup` → `dev`, 3f6e2f1ba). 서버 stress opt-in 및 프로젝트 검증 지침 3파일만 포함한다. UI 변경은 기존 작업트리에 보존했다. 이후 PR41은 부모가 dev에 병합했다(beb02c11a). UI 배포는 아직 실행하지 않았다.

## 배포 마무리 재개 및 최종 범위 검증

사용자가 “배포하고 바뀐 레이아웃 이미지로 보내줘”를 요청했다. PR41의 검증 범위 지침과 opt-in stress 변경을 byte 대조 후 origin/dev beb02c11a로 반영했다. 기존 UI 변경·시각/격리 저장 근거는 보존했다. 전체·서버·stress·baseline 대조는 재개하지 않았다.

- 마지막 Layout/CaptureSettings/clipboard-usage 집중3파일43테스트 통과(2.94초): `/tmp/dovix-commerce-final-ui-focus.log`.
- 부모의 최종 Catalog/draft2파일22테스트 통과(6.09초), 앞선112개 집중 결과 및 실제 Chrome/격리 저장 영수증을 재사용한다.
- UI typecheck, UI production build, token gates, diff whitespace 검사 통과. 로그는 `/tmp/dovix-commerce-final-ui-{types,build}.log`, `/tmp/dovix-commerce-final-token-gates.log`. 빌드의 기존 큰 chunk/혼합 dynamic import 경고는 남는다.
- 기존 설치 core8f8a0ab7e 및 entry index-DhP2jgWE.js 일치 확인. 코어/DB/API/서버 재시작 없이 검토된 merged dev UI만 정적 반영한다. PR 검토 전에는 병합/배포하지 않는다.
- 운영 Chrome 최종 소싱/상품/주문 캡처는 부모 에이전트가 수행한다.

## 후속 승인: 쇼핑몰 카테고리·상세 공지/배너 (2026-10-17)

새 feature/commerce-category-details와 별도 AutoSourcing feature에서 구현한다. 공통 상품/기존 카테고리 호환을 보존하고 쇼핑몰 탭에서 각 store의 실제 taxonomy 검색·계층·필수정보를 선택·저장한다. CategorySupported와 발행 CatalogSupported를 분리하며 네이버 발행을 지원한다고 표시하지 않는다.

공통공지 기본값은 설정에서 관리하고 managed 상품에 명시적 적용/재정의한다. 상단·하단 이미지 URL/순서/삭제/실제 미리보기는 원본문과 별도 저장, 동일 조합을 발행에도 사용한다. source-only 선택은 생성/저장/유료 작업을 일으키지 않으며 읽기 미리보기와 명시적 가공 시작을 구분한다. 부모가 실제 기존공지 이미지 근거를 전달한다. 임의 이미지를 만들지 않는다.

초안 복구/저장readback/다음이동 비교에 새 편집필드를 포함하고 가격취소·충돌/등록category불변/회사projectstore scope를 검증한다. 관련 집중검사·UI/API빌드·token gates 및 Chrome 후보 화면만 검증하고 전체/stress/baseline 반복은 금지한다. 두 저장소 dev PR 제출 후 부모 검토 전 병합·배포하지 않는다.


### 직접 구현 전환 및 검증 결과 (2026-10-17)

사용자 요청으로 Sol 위임을 중단하고 부모가 직접 마무리했다. 카테고리는 쇼핑몰 탭에서 각각 설정하며 공통 코드 수동 입력을 제거했다. 구매 옵션은 기존 SKU별 값을 사용한다. 기본 공지는 쇼핑몰별 저장·버전 보호하며 가공 전 미리보기, 명시적 초안 복사, 상품별 재정의를 지원한다. 기존 공지는 썸네일에서 직접 선택하고 동일 URL 재삽입·상하단 각각20개 초과 선택을 막는다. 공지를 펼친 쇼핑몰 카드는 전체 너비로 확장하고 좁은 화면에서 잘리던 fieldset을 수정했다.

- UI Catalog/draft/실제 공지 조합 23개 통과. Host/HTTP/SQLite 기존 경로 5개 통과. Native actual SQLite/HTTPS store 구성4개 및 기존 category/catalog9개 결과를 확인했다. 전체/stress 검사는 실행하지 않았다.
- Shared build, UI typecheck/build, token gates 통과. 기존 Vite CSS highlight/큰 chunk 경고는 남는다.
- Chrome 격리 DB에서 공지 선택·저장, 실제 PNG 크기/로드, source-only 상단→본문→하단 미리보기와 명시적 생성, 쿠팡·네이버 카테고리 각각 저장, 옵션별 값 보존을 확인했다. 390px에서 visible input/section/fieldset이 편집기 밖으로 넘치지 않음을 확인하고 viewport를 복구했다.
- 증거: tmp/commerce-category-details/{settings-notice,source-notice-preview,product-categories-wide,product-categories-narrow,naver-category}.jpg. 개인정보·원본문·운영 계정 상태를 변경한 테스트는 없다. 실제 네이버 계정과 판매 상품 전송은 미검증이다.
- 운영은 기존 core8f8 호환 절차를 따른다. AutoSourcing additive migration/DB backup → Dovix scoped shared/bridge/UI 순서로 반영하며 운영 DB journal 전체 교체는 금지한다. PR·운영 결과는 실제 실행 후 별도로 기록한다.
