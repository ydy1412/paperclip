# 최종 이미지 검토와 교정

## 시작 전에

`get-processing-source`의 실제 이미지와 원본 SKU를 읽고 `get-managed-product`의 최초 가격/SKU 스냅샷을 보존한다. 원본의 상품 사진과 사이트 아이콘·로고·광고 배너를 구분한다. 대상의 대표, 각 SKU, 최종 상세에 사용할 이미지 목록을 만든다. 같은 URL을 여러 곳에서 쓰면 하나의 검토 결과로 연결하되 SKU 연결은 모두 기록한다.

원본에 SKU별 사진이 있으면 실제 SKU 사진을 정리하거나 같은 SKU를 보여주는 검증된 컷으로 교체한다. 편집이 실패했다는 이유로 SKU 이미지 필드를 비우고 모든 옵션을 같은 대표 사진으로 돌리지 않는다. 형태가 다른 테이블형/장스탠드나 서로 다른 부품은 사진에서도 구분되어야 한다.

현재 요구는 **흰 바탕(#FFFFFF)에 제품 전체와 포함 부품만 중앙에 배치하고, 어떤 글자도 없는 정사각형 사진**이다. 기존 등록 사진에 배경이 있더라도 최신 요구를 우선한다. 실제 사진과 `inspect-product-image`의 치수를 읽고, 숫자·규격·호환 조건은 먼저 한국어 옵션/상세에 보존한다. 이미지의 영문·숫자·단위·로고도 제거한다. 도구 설명의 기존 '치수 글자 보존'은 이 작업의 출력 이미지에 적용하지 않으며, 치수 사실은 원본과 한국어 상세에 보존한다. 서로 다른 설명이 다른 기능·조건을 추가하는지 실제 모순인지 구분한다. 앱 연동과 음성 기기 별도 준비 안내를 근거 없이 상호 배타적인 기능으로 판단하지 않는다.

최종 파일은 서버의 `remainingText`로 전체 언어/숫자 영역을 확인한다. 추가 OCR이 필요하면 `scripts/inspect-text.mjs <이미지 파일>`을 사용한다. 원본을 가져올 때는 조회된 실제 URL만 사용한다. 이 검사기는 기존 macOS Vision을 실행 폴더 안에서 사용하며, 프로그램 설치·서비스 설정 변경·외부 OCR 전송을 하지 않는다. 결과가 비어 있어도 최종 사진을 확대해 직접 확인한다.

## 서버 작업과 교정 인계

1. 자동 생성과 저장은 서버 이미지 잡이 담당한다. `get-image-processing-jobs`로 대상의 저장 상태를 읽고, 완료된 PNG를 원본과 비교한다. 에이전트가 별도 크롭·생성 요청을 제출하거나 공급자를 폴링하지 않는다.
2. `queued/processing`이면 텍스트 가공을 진행하고 미완료 이미지를 별도로 남긴다. `succeeded`라도 실제 사진을 보지 않고 검토를 통과시키지 않는다.
3. 모든 언어 OCR `remainingText`와 실제 확대 PNG를 대조한다. OCR 실패를 글자 없음으로 취급하지 않는다. 추가 검사는 필요할 때만 `scripts/inspect-text.mjs`를 사용한다.
4. 흰 배경·중앙 배치·제품 전체 보존·글자 제거 중 하나라도 실패하면 기존 상품·잡·asset ID, 최초 원본과 실패 근거를 운영자에게 전달한다. 안전 필터 거절이나 제출 결과 불명확 상태를 새 요청으로 우회하지 않는다.
5. 다른 원본 컷이 더 적합하면 같은 SKU·포함 구성인지 확인해 제안한다. 참고 상품 사진이나 다른 옵션 사진으로 대체하지 않는다. 이미지 참조가 서버에서 바뀔 수 있으므로 텍스트 저장 직전에 최신 상품을 다시 읽고 보존한다.

## 이미지별 통과 기준

- 배경은 순백색이고 제품은 가로·세로 중앙에 충분한 여백으로 위치한다. 정사각형 출력이며 제품·포함 부품이 잘리지 않는다. 다른 소품·사람·생활 배경을 남기지 않는다.
- 원본 대비 제품 전체·색·구성·SKU가 보존되고 숫자/조건의 사실은 한국어 옵션·상세에 옮겨져 있다.
- 실제 출력에 어느 언어의 글자·숫자·단위·로고 글자도 없다. 글자 파편, 빈 광고 배지, 번짐 또는 뭉개진 제품도 없다.
- 크롭 경계가 제품·기능 부품을 침범하지 않는다. 글자 제거를 위해 제품을 잘라 성공을 만들지 않는다.
- 원본이 이미 흰 배경·중앙 배치·정사각형·글자 없음 조건에 적합하면 그대로 사용할 수 있지만 전체 OCR과 실제 사진으로 확인해야 한다. 미처리 글자 있는 사진을 '원본 보존'으로 합격시키지 않는다.
- 결과를 상품에 연결한 뒤 `get-managed-product`를 다시 읽어 대표/SKU/HTML의 최종 참조를 확인한다. 이전 URL을 다음 일반 저장에서 다시 덮어쓰지 않는다.

각 이미지에 원본 URL, 최종 URL, 실제 치수, 파생 assetId/해시(있으면), 시행한 교정, `visualPass`, `noText`, `textReviewPerformed`, `whiteBackgroundPass`, `centeredProductPass`, `completeProductPass` 및 전체 OCR/확대 검토 근거를 기록한다. 숫자가 제거됐으면 한국어 상세의 어느 항목에 옮겼는지 기록한다. 모든 최종 이미지와 모든 SKU 연결이 목록에 있어야 한다. 최종 사진/원본 비교와 검토 파일을 이슈 결과물로 전달한다.

## 운영 재조회 검사 파일

`processing-review.json`의 `projectId`, `accountId`, `products`를 채운다. 각 상품은 `productId`, `sourceProvider`, `sourceProductId`, `sourceHash`, `revision`, 최초 조회의 `originalSkuPrices`(SKU ID → 판매가), `categoryMatchesAllSkus`, `categoryEvidence`(실제 메타데이터와 전체 SKU의 적합성 근거), `images`(최종 `url`, `sourceImageUrl`, 실제 `width`/`height`, `visualPass`, `noText`, `textReviewPerformed`, `whiteBackgroundPass`, `centeredProductPass`, `completeProductPass`, `notes`; 파생 PNG는 `assetId`도), `skuImages`(SKU ID → 최종 URL), `blockingProcessingIssues`를 가진다. SKU에 별도 이미지가 없으면 실제 최종 대표/상세 사진을 명시한다. `referenceStyle`에는 `references`(참고 등록 상품의 `productId`, `revision`, 선택 `reason`)와 `appliedRules`(대상에 실제 적용한 형식 규칙 문자열 배열)를 남긴다. 적합한 참고 상품이 없으면 `referenceStyle`에 `status="no_relevant_reference"`, `catalogComplete=true`, 선택하지 않은 `reason`, 빈 `references`와 실제 `appliedRules`를 기록한다. 불완전 조회로 대체하지 않는다.

```sh
node "<이 스킬 폴더>/scripts/verify-result.mjs" "$PAPERCLIP_RUN_SCRATCH_DIR/processing-review.json"
```

이 검사는 운영 API에서 상품/원본을 다시 읽어 SKU ID·순서·가격과 이미지 검토 목록을 대조한다. 사람이거나 모델이 실제로 본 PNG를 기록한 `visualPass`의 진실성은 사진 검토로 별도 확인한다. 통과 JSON을 이미지 품질의 독립 증거라고 표현하지 않는다. 하나라도 가공 결함이 남으면 전체 가공 완료로 표시하지 않는다.
