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

```sh
PAPERCLIP_API_BASE="${PAPERCLIP_API_URL%/}"
PAPERCLIP_API_BASE="${PAPERCLIP_API_BASE%/api}"
curl --fail-with-body -sS \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_BASE/api/plugins/tools"
```

반환된 fully qualified `name`과 `parametersSchema`를 사용한다.
`POST /api/plugins/tools/execute`에는 `tool`, `parameters`, `runContext`를 전달한다.
`runContext`의 `agentId`, `companyId`, `runId`는 주입된 실제 값을, `projectId`는
현재 작업의 프로젝트를 사용한다. 다른 작업/사용자 ID를 만들어 넣지 않는다.
JSON은 스크립트로 구성하거나 파일을 사용하고 토큰은 본문에 넣지 않는다.

## 공통 상품: 참고 조회와 가공 저장

| 발견된 이름의 접미사 | parameters |
| --- | --- |
| `list-sourcing-workspace` | `projectId`, `stage="unprocessed"`, 선택 `query`, `page` |
| `start-managed-processing` | `projectId`, `sourceProvider="taobao"`, `sourceProductId` |
| `list-managed-products` | `projectId`, `view="uploads"` 또는 `"source"`, 선택 `query`, `page` |
| `get-managed-product` | `projectId`, `productId` |
| `list-product-stores` | `projectId` |
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

현재 발견된 도구에는 픽셀 크롭과 카테고리 메타데이터 검증 도구가 없다.
공통 상품의 상세 HTML 편집과 원본 초안의 크롭 계획 저장을 실제 이미지 생성이나
카테고리 검증으로 표현하지 않는다.
