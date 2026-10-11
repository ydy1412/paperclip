# 운영 도구 호출

소싱 상품 가공 전용 플러그인은 기존 Auto Sourcing API로 가공 전 상품 조회와
공통 상품 편집을 제공한다. 프로필에 `paperclipai.plugin-sourcing-processing`을
연결해야 실제 도구가 허용된다. 스킬만 배정한 상태는 도구 배정이 아니다.
실행할 때 `/plugins/tools`에서 아래 이름과 스키마를 다시 확인한다.

## 인증과 발견

Paperclip 로컬 실행은 `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`,
`PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID`를 주입한다.
현재 작업의 프로젝트를 사용한다. 키를 출력하거나 보드의 인증 파일을 읽지 않는다.
API 변수나 작업 범위가 없으면 설정 문제로 기록한다.

기본 실행 도우미는 이 스킬의 `scripts/plugin-tools.mjs`다. `list`는 실제 허용된
가공 플러그인 도구와 스키마만 반환한다. `call`은 입력 파일의 `projectId`와
주입된 실제 run 인증으로 호출한다. API 주소의 `/api` 유무는 도우미가 처리한다.
쓰기 실패나 응답 유실을 자동 재시도하지 않는다.

읽은 스킬 디렉터리를 `SOURCING_PROCESSING_SKILL_DIR`로 지정하고 다음과 같이 실행한다.

```sh
node "$SOURCING_PROCESSING_SKILL_DIR/scripts/plugin-tools.mjs" list
node "$SOURCING_PROCESSING_SKILL_DIR/scripts/plugin-tools.mjs" call get-processing-source ./parameters.json
```

입력 JSON은 스크립트/파일로 구성한다. 인증 파일을 읽거나 키를 본문에 넣지 않는다.
MCP 검색이 `requires approval`/`approval policy never`로 거부되더라도 native API는
회사·실제 run·할당 작업·프로필 도구 권한을 별도로 검증한다. 도우미로 실제 도구를
확인하며 승인·샌드박스 설정을 바꾸지 않는다. native API도 거부되면 중단해 원인을
보고한다. 다른 계정이나 보드 인증으로 재시도하지 않는다.

반환된 fully qualified `name`과 `parametersSchema`를 사용한다.
`POST /api/plugins/tools/execute`에는 `tool`, `parameters`, `runContext`를 전달한다.
`runContext`의 `agentId`, `companyId`, `runId`는 주입된 실제 값을, `projectId`는
현재 작업의 프로젝트를 사용한다. 다른 작업/사용자 ID를 만들어 넣지 않는다.
JSON은 스크립트로 구성하거나 파일을 사용하고 토큰은 본문에 넣지 않는다.

## 공통 상품: 참고 조회와 가공 저장

| 발견된 이름의 접미사 | parameters |
| --- | --- |
| `list-sourcing-workspace` | `projectId`, `stage="unprocessed"`, 선택 `query`, `page` |
| `get-processing-source` | `projectId`, 같은 프로젝트 쇼핑몰의 `accountId`, `sourceProvider="taobao"`, 원본 `productId` |
| `start-managed-processing` | `projectId`, `sourceProvider="taobao"`, `sourceProductId` |
| `list-managed-products` | `projectId`, `view="uploads"` 또는 `"source"`, 선택 `query`, `page` |
| `get-managed-product` | `projectId`, `productId` |
| `list-product-stores` | `projectId` |
| `recommend-coupang-category` | `projectId`, `storeId`, `productName` (1~200자) |
| `get-coupang-category-metadata` | `projectId`, `storeId`, `categoryCode` (양의 정수) |
| `save-managed-product` | `projectId`, `productId`, `expectedRevision`, `title`, `mainImage`, `description`, `categoryCode`, `skus`; 필요할 때만 `confirmPriceChanges` |

각 `skus` 원소는 기존 `id`, `name`, `image`, `options`를 포함한다.
현재 `salePrice`가 있으면 같은 값을 포함해 보존한다. `options` 원소는 `name`,
`value`다. 읽은 가격을 생략하거나 임의로 0/null로 바꾸지 않는다. API 조회 결과의
원본·연결·상태 필드는 그대로 보존되며 저장 payload에 임의로 추가하지 않는다.
정확한 허용 필드와 길이 제한은 발견된 스키마와 실제 검증 응답을 따른다.

가공 저장은 로컬 편집본만 바꾼다. 쇼핑몰 전송이나 업로드 큐 처리를 포함하지 않는다.
가공 전 대상은 workspace의 `source.sourceProductId`로 찾고 가공 시작 도구로
공통 상품을 만든 뒤 반환된 32자리 `id`와 `revision`으로 편집한다. 이미 만든
상품이 있으면 기존 결과를 재사용한다. `list(view=source)`는 공통 편집본만
조회하므로 빈 결과가 원본 상품 없음의 근거가 아니다. 참고 상품은 uploads에
키워드 검색하며 페이지/전체 건수를 확인한다. 참고 상품을 수정하지 않는다.
원본의 기부 배너·쇼핑몰 광고 이미지는 대표 사진이나 상세에 포함하지 않는다.
SKU 사진·상품 상세 사진처럼 실제 제품임을 확인한 원본 이미지를 사용한다.

## 원본 기반 초안

`get-processing-source`, `create-processing-draft`, `list-processing-drafts`,
`get-processing-draft`, `save-processing-draft`, `validate-processing-draft`는
프로젝트·판매 계정 바인딩과 원본 상품 allowlist를 요구한다.
`sourcing-product-processing`의 절차와 발견된 schemas를 따른다.
공통 상품 ID, 타오바오 원본 productId, draftId와 각각의 revision을 혼동하지 않는다.
전용 가공 플러그인에서도 `get-processing-source`를 제공한다. `list-product-stores`의
실제 `accountId`를 사용하며 sourceHash와 원문 옵션을 읽는다. `start-managed-processing`
은 기존 편집본을 반환할 수 있으므로 원본 재조회 도구를 대신하지 않는다. 나머지
초안 도구는 별도로 발견되고 허용된 경우에만 사용한다.

## 쿠팡 카테고리

`list-product-stores`의 `stores`에서 `provider="coupang"`, `enabled=true`,
`hasCredentials=true`인 등록 쇼핑몰의 `id`를 `storeId`로 사용한다. 여러 쇼핑몰이
있으면 현재 작업의 대상 쇼핑몰을 사용하고 선택 근거를 기록한다. 임의 판매 계정이나
URL·자격증명을 입력하지 않는다. 추천 결과는 `{code,name}`이다. 추천된 `code`로
메타정보를 조회하면 `attributes`, `notices`, `certifications`, `documents`,
`allowSingleItem`을 받는다. `required`와 조건부 서류의 `condition`을 함께 확인한다.
메타정보 API가 이름을 반환하지 않으면 빈 `name`은 추천 이름과 구분해서 기록한다.
두 도구는 상품을 저장하지 않는다. 저장은 검토한 결과를 기존 저장 도구에 전달한다.
다른 회사·프로젝트의 쇼핑몰, 비활성 쇼핑몰, 쿠팡 이외 공급자는 거부된다.

`inspect-product-image`와 `process-product-image`가 실제 이미지 처리 도구다. HTML 편집·크롭 계획 저장을 실제 이미지 생성으로,
카테고리 추천·메타정보 조회를 상품의 필수 사실 검증이나 업로드 완료로 표현하지 않는다.

## 실행 폴더에서 첨부

Paperclip의 `paperclip-upload-artifact.sh`를 사용할 때 샌드박스에서 쓰기 가능한
`PAPERCLIP_RUN_SCRATCH_DIR`를 해당 호출의 `TMPDIR`로 지정한다. 기본 macOS 임시
폴더는 실행의 허용 경로에 없을 수 있다. 제공된 폴더가 실제 존재하는지 확인하며
권한·샌드박스 설정을 변경하지 않는다. 읽은 Paperclip 스킬의 helper와 실제 결과
파일 경로를 사용한다.

```sh
test -n "$PAPERCLIP_RUN_SCRATCH_DIR" && test -d "$PAPERCLIP_RUN_SCRATCH_DIR" || exit 1
TMPDIR="$PAPERCLIP_RUN_SCRATCH_DIR" bash "$PAPERCLIP_SKILL_DIR/scripts/paperclip-upload-artifact.sh" ./results/result.md --output json
```

`mkstemp` 실패로 첨부 요청 전에 중단됐으면 임시 경로를 확인한 뒤 한 번 다시
시도한다. 업로드 응답이 불명확하면 첨부 목록·해시부터 확인하고 helper의 기존
중복 확인 절차를 사용한다. 등록된 첨부·결과물 링크와 실제 내용 조회를 확인한 뒤
`result` 문서에 반영한다. 쓰기 가능한 폴더가 없거나 첨부가 계속 실패하면 실행
workspace 파일 결과물로 등록하고 실제 실패 단계와 남은 전달 한계를 기록한다.


## 실제 이미지 처리

- `inspect-product-image`: `projectId`, 공통 `productId`, 편집 전 원본 `imageUrl`. 실제 upright 픽셀 크기와 중국어 글자 영역을 반환한다.
- `process-product-image`: 위 식별자와 `expectedRevision`, 새 UUID `requestId`, 선택 `removeChinese`, `crop={x,y,width,height}`, `outputSize={width,height}`. 하나 이상의 작업을 선택한다. API가 원본을 보존하고 실제 PNG 생성 후 해당 원본을 가리키는 대표·SKU·HTML 참조만 갱신한다.
- 좌표는 원본 이미지의 좌측 상단 기준이다. 제품 일부를 잘라내지 않는다. 중국어 헤더를 제품 손실 없이 크롭할 수 있으면 그 영역을 제외한다. 제품 위의 글자는 로컬 인페인팅을 사용하고 결과를 검토한다. 숫자·단위까지 제거할 영역을 임의로 잡지 않는다.
- 동일 입력 재시도는 같은 requestId만 사용한다. 응답 유실은 상품을 재조회하고 같은 요청의 결과를 확인한다. 다른 입력에는 새 requestId가 필요하다. 오래된 expectedRevision으로 덮어쓰지 않는다.
- 결과에 imageUrl, PNG 해시·실제 치수, 원본 해시, productRevision, removedRegions, remainingChinese, reviewRequired가 있다. 미제거 중국어는 그대로 보고한다. 제품 위 배경 복원은 완벽한 재구성을 보장하지 않는다.
- 파생 imageUrl은 Dovix의 인증된 로컬 미리보기다. 이미지 공개 호스팅 전에는 쇼핑몰 업로드 준비 완료로 보고하지 않는다. 이미지 처리 후 저장할 때 이전 mainImage/SKU image를 다시 보내 덮어쓰지 않는다.

- `get-product-image`: `projectId`, `productId`, `assetId`. 실행 도우미로 `call get-product-image parameters.json`을 호출하면 PNG를 현재 `PAPERCLIP_RUN_SCRATCH_DIR`에 저장하고 filePath/sha256만 출력한다. 반환된 실제 파일을 이미지 보기 도구로 확인하고 기존 첨부 도우미로 전달한다. base64를 직접 출력하거나 결과 문서에 붙이지 않는다.
