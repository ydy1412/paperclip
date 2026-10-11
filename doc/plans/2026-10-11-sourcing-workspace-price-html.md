# 소싱 단계·상세 미리보기·옵션 판매가

## 상품 가공 재실행 교정 (2026-10-11)

- 실제 가공 실행에서 원본의 구매 제외 조건이 옵션 번역의 비권장으로 약해졌다. 가공 스킬에 SKU별 금지·제외·비호환 조건의 강도를 보존하고 저장 후 원문과 대조하는 기준을 추가한다.
- 가공 시작 도구는 이미 만든 편집본을 반환하고 작업공간 목록에는 원문 SKU 전체가 없다. 전용 가공 플러그인에도 기존 읽기 전용 `get-processing-source`를 연결하여 수정 후에도 원문·sourceHash를 재조회한다. 기존 회사/프로젝트/판매계정/run 및 원본 접근 검증을 그대로 사용한다.
- 스킬의 native 도구 실행 도우미로 실제 도구 발견, 주입 인증, API 주소 정규화와 호출을 재사용한다. MCP 승인 거부를 도구 부재로 오해하거나 보드 인증·샌드박스 변경으로 처리하지 않는다. 쓰기 자동 재시도는 하지 않는다.
- 검증 기준: 실제 도구 등록·원본 읽기 경계, 로컬 HTTP 실행 도우미의 경로/권한/실패 처리, 기존 native 원본 범위 연동 검사를 통과한다. 프로필의 갱신된 스킬·도구를 적용한 에이전트가 원문과 편집본을 독립적으로 재조회하고 제한 문구를 보존하는지 실제 실행한다. 기존 상품·원본·가격·첨부 이력은 보존한다. 크롭과 필수 고시/속성 보완, 쇼핑몰 업로드는 완료 범위와 구분한다.

승인: 2026-10-11 사용자의 “응 쭉 개발해”. 두 저장소의 dev에서 feature/catalog-sourcing-price-html을 생성했다.

- Dovix는 회사/프로젝트 권한, 계약, 공유 우측 편집 UI를 소유한다. AutoSourcing은 기존 SQLite·수집 큐·가공 원본·업로드 큐와 쿠팡 어댑터를 소유한다.
- 기존 소싱 표의 타오바오 URL·키워드를 운영자가 선택한 프로젝트 후보로 가져온다. 원본 표는 수정하지 않고 provider/product ID로 중복을 제거한다. 후보 → Aside 수집 → 가공 전 → 명시적 가공 시작 → 기존 가공/업로드 단계로 이어진다. 전체/단계 건수와 검색·페이지를 같은 집합에서 계산한다. 실패·진행·결과 미확인 수집을 표시하고 미확인 작업을 자동 재전송하지 않는다.
- 소싱/업로드는 같은 상품 편집기를 사용한다. 상세 설명은 HTML 미리보기와 원문 편집을 제공한다. 이미지·일반 텍스트·HTML을 정규화하고 스크립트 없는 sandbox 영역에 표시한다. 기존 수집/원격 원본은 보존한다.
- 수집 원가와 공통 원화 판매가를 분리한다. 수집 원본과 진행 중인 작업의 누락 가격은 미지정으로 해석한다. 기존 쿠팡 상품의 누락 가격은 보존된 등록 스냅샷과 SKU 매핑으로 읽고 원본을 갱신하지 않는다. 가격 저장에는 기존값/새값/증감 확인이 필요하다. 쇼핑몰 큐 등록에는 실제 옵션 가격과 대상별 차이를 확인하고 버전·스냅샷에 묶는다. 승인된 쿠팡 옵션은 vendorItemId 전용 API와 10원 단위를 사용하고 변경 비율 제한을 자동 해제하지 않는다. 부분 성공·응답 유실은 지속 상태와 GET 재조회로 처리한다.
- 실제 파일·SQLite 재열기/마이그레이션/범위·중복·단계, 로컬 HTTP의 가격 변경/부분 실패/응답 유실·재조회, 공유 UI의 확인·취소·미저장 보존·HTML 격리를 검증한다. 실제 판매 계정 쓰기와 새 수집은 개발 테스트로 실행하지 않는다.
- 각 저장소 PR을 dev로 제출하고 검토·CI 결과를 확인한다. 검증된 dev 서비스만 반영하고 실제 건강 상태·운영 UI·기존 데이터 보존을 확인한다. master는 이번 범위가 아니다. 세 Todoist 항목은 해당 기능의 구현·검증·반영 이후에만 완료한다.

구현/검증 결과 및 실제 PR·배포 SHA는 완료 후 이 문서와 AutoSourcing의 기존 spec/plan/tasks에 정합화한다.


## 구현·검증 (2026-10-11)

소싱 후보/가공 전 단계와 scoped candidate import/수집 큐/가공 시작, 공유 HTML 미리보기·편집, 옵션 가격 저장 및 쇼핑몰 가격 비교 확인을 구현했다. 가격 확인은 백엔드의 기존 대문자 SHA-256 표현까지 허용한다. 실제 HTTP→공유 계약→SQLite→로컬 HTTPS provider 경로에서 확인값을 검증하고 전용 가격 변경과 GET 재확인까지 통과했다. 이미 성공한 옵션과 실패·응답 유실 옵션의 영속 상태를 구분하며, 부분 실패는 조회로 확정한 뒤 새 의도에서 미반영 옵션만 전송한다.

- AutoSourcing 전체: 177 통과 / 12 live 제외 / 0 실패. 실제 SQLite 후보·범위·검색·전환, 가격 확인·부분 실패·응답 유실·재시작·재조회, 기존 IMAGE 상세/가격 JSON 호환성을 검증했다.
- Dovix 공유 UI·HTML 검사 13개 통과. native worker/host/HTTP/SQLite 3파일 12개 검사 통과 후, 가격 확인값의 실제 HTTP 회귀를 추가한 catalog integration 4개도 통과했다.
- 전체 typecheck/build와 토큰 검사 통과. Dovix 전체 test:run을 실행했으나 기본 sibling checkout의 예전 AutoSourcing 테스트 바이너리로 연동 검사 3개가 실패해 중단했다. 병합된 백엔드를 AUTO_SOURCING_PROJECT_ROOT로 지정한 재검증은 4개 모두 통과했다. 보조 병렬 실행에서 시간 초과가 난 기존 권한/인증 20개와 DB 마이그레이션 3개는 단독 재실행으로 모두 통과했다. shared project 841개도 통과했다. 나머지 전체 검사 그룹과 CI는 완료/성공으로 기록하지 않는다.
- 운영 SQLite 복사본에 새 마이그레이션을 적용하고 기존 48개 테이블의 모든 기존 열/행 digest를 비교해 보존을 확인했다. 신규 옵션 작업의 기본값은 []다.
- 현재 운영 UI의 프로필/Inbox 개선을 보존한 호환 빌드가 통과했다. 실제 운영 반영은 dev 머지 SHA와 연결해 tmp/workspace-catalog-operating의 deployment.json/backend-deployment.json 및 후속 검증 기록으로 확인한다.

운영 전 실행 중 주문/업로드/수집/에이전트 작업을 확인한다. SQLite는 서비스 정지 후 백업·마이그레이션·행 digest 검증을 수행한다. 기존 앱은 새 마이그레이션 이력을 거부하므로 롤백에는 앱과 DB를 함께 복구해야 한다. 재기동 후 새 데이터가 생겼다면 자동 DB 복원을 막고 근거를 남긴다. Dovix는 호환 패키지의 변경된 세 JS 모듈과 최신 호환 UI만 반영하며 기존 hashed assets와 백업을 유지한다.

실제 판매 계정의 상품/가격 쓰기와 새 Aside 유료 수집은 이 검증에서 실행하지 않았다. 구현 완료와 이 두 외부 실행 성공을 구분한다.

Aside 실제 브라우저 검증: HTML 표시/sandbox/script 비실행, 10,000→12,000원 비교·취소 draft 보존·저장, 쇼핑몰 기존 가격 비교와 큐 등록, 후보 1개 불러오기, 가공 전 1→0·가공 중 0→1 전환, 최종 alert 0. 실제 fixture 작업은 별도 HTTP 조회에서 succeeded/반영 버전 2를 확인했다. 증거: tmp/workspace-catalog-operating/browser-full.log 및 browser-backend-proof.json. 새 Aside 수집/실제 판매 계정 쓰기는 수행하지 않았다.


## dev 반영·인계 (2026-10-11 07:03 KST)

- 기능 PR: [Dovix #11](https://github.com/ydy1412/paperclip/pull/11), [AutoSourcing #8](https://github.com/ydy1412/auto-sourcing/pull/8)를 검토 후 dev에 병합했다. 두 PR에 등록된 CI check는 없었으며 CI 통과를 주장하지 않는다.
- 실행 버전: Dovix 선택 모듈/호환 UI는 dev `197c2b5b5c9d635f8c6ee52d9098803aacab0a97`, AutoSourcing release는 dev `f1e6b1f8d9426ac3b4911accb136f047dbc3c5bd`에 연결된다. 후속 문서/테스트 전용 커밋은 배포된 앱 변경으로 간주하지 않는다.
- Dovix는 실행 중 heartbeat/plugin/marketing 작업이 모두 0일 때 세 JS 모듈과 UI만 반영했다. 재시작 후 health, 익명 접근 거부, 프로필 4개, Codex 모델 목록, UI assets 48개 hash를 확인했다. 기존 프로필 옵션·Inbox를 포함한 호환 UI entry는 `/assets/index-CwvJfHrP.js`다.
- AutoSourcing 운영 DB 마이그레이션 및 무결성/FK 확인, 기존 48개 테이블의 기존 열/행 digest 보존을 확인했다. 첫 시도는 Homebrew Python의 plist XML 모듈 오류로 앱/DB를 복구했고, 시스템 Python으로 재시도해 성공했다. 백업의 앱/DB/plist를 함께 복구하며 재시작 후 새 쓰기가 있으면 DB 자동 복원을 중단한다.
- 기록된 후보 3,879개를 범위가 지정된 후보 테이블에 가져왔다. 두 번째 가져오기는 0건이며 기존 다른 48개 테이블은 그대로다. 화면은 소싱 후보 3,877개, 가공 전 2개를 표시한다. 기존 등록 상품 244개/옵션 468개에서 판매가가 보이고 IMAGE 상세 243개는 HTML 미리보기로 읽힌다.
- Aside u1 실제 운영 UI에서 대표 이미지 로드, 기존 가격 입력값, HTML 편집/미리보기와 sandbox, 새 단계/count, alert 0을 확인했다. 개발 fixture에서는 가격 확인/취소/저장/큐/GET 완료와 가공 시작까지 검증했다. 운영 상품 가격 변경과 새 유료 수집은 실행하지 않았다.
- Todoist 세 항목은 07:03 KST에 완료했다. 완료 조회의 checked=true 3개, completed activity 3개, 해당 프로젝트의 열린 항목 0개를 확인했다.

로컬 증거: `tmp/workspace-catalog-operating/{deployment,backend-deployment,operating-catalog-proof,todoist-completion-proof}.json`, `artifacts/operating-browser-proof.json`, `pr11-review.json`. 복구 경로는 배포 receipt의 backup을 따른다. paired 연동 실행 시 `AUTO_SOURCING_PROJECT_ROOT`에 새 백엔드를 빌드한 checkout을 지정한다. master 반영, 실제 판매 계정 쓰기, 새 Aside 수집, 나머지 전체 검사 그룹은 이 인계의 성공 범위에 포함하지 않는다.
