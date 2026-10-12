# Auto Sourcing의 힉스필드 이미지 처리

1. 현재 native 도구 목록에서 `get-image-provider-status`와 `process-product-image`를 확인한다. 연결 상태는 프로젝트 범위로 읽는다. `connected=true`는 실제 계정·모델 조회 성공이며 이미지 품질 검증과는 별개다. `configured=false`면 Auto Sourcing 서버 전용 MCP 인증 설정이 필요한 차단 요인으로 보고한다. 중국어 전용 로컬 제거를 모든 글자 제거 완료로 대신하지 않는다.
2. 원본 사진과 SKU별 숫자·단위·호환성·구매 제한을 확보하고 한국어 옵션/상세에 보존한다. 선택한 원본 URI는 해당 편집본의 대표/SKU/상세 이미지 중 하나에 연결돼 있어야 한다. 원본과 기존 파생 이미지를 혼동하지 않는다.
3. 실제 원본의 전 언어 OCR과 눈으로 본 글자를 대조한 뒤 `process-product-image`에 `provider: "higgsfield"`, `removeAllText: true`, 최신 `expectedRevision`, 고유한 `requestId`를 전달한다. `removeChinese`는 false로 두고 crop/cleanupRegions는 함께 보내지 않는다. outputSize는 비율을 보존한 최종 맞춤 크기다. 모델·품질·해상도와 MCP 인증은 Auto Sourcing 내부 도구가 담당한다. 에이전트에 원격 Higgsfield MCP를 추가하거나 자격증명을 요청하지 않는다.
4. 요청과 응답을 현재 실행 폴더에 기록한다. `{status:"pending", nextCheckSeconds:3}`이면 기다렸다가 **처음의 모든 입력을 그대로** 다시 호출한다. requestId와 expectedRevision을 바꾸지 않는다. 대기 간격은 3초부터 최대 10초까지 늘리고 이미지를 직렬 처리한다. 응답 유실/네트워크 오류도 기존 요청부터 확인한다. 같은 복구를 위해 새 생성 요청을 만들지 않는다. `higgsfield_submission_unknown`이면 서버가 job ID를 받지 못한 상태이므로 재제출하지 말고 기존 생성 여부 확인이 필요하다고 보고한다.
5. 서버가 최종 PNG에서 읽은 전 언어 OCR `remainingText`를 먼저 확인한다. 중국어 전용 `remainingChinese`와 구분한다. 소유 PNG를 `get-product-image`로 저장해 원본과 확대 비교한다. 제품 모양·부품·수량·색상·경계가 보존됐는지, 모든 언어·숫자·단위·로고 글자와 잔흔이 없어졌는지 확인한다. 원본에 SKU별 사진이 있으면 SKU 사진을 비워 공통 대표 사진으로 대신하지 않는다. OCR 빈 결과나 `allTextRemovalRequested=true`만으로 글자가 없다고 판정하지 않는다. `remainingText`가 없으면 OCR 검증 미완료로 처리하며 스킬의 별도 검토 절차를 사용한다. `reviewRequired=true`는 실제 검토가 필요하다는 뜻이다.
6. 입력·인증·크레딧·모델·결과·revision 실패를 구분한다. `higgsfield_generation_failed/nsfw/canceled`는 같은 요청으로 재생성되지 않는다. 실패한 사진은 그대로 보존하고 문제를 기록한다. 인증/크레딧 실패는 운영자에게 필요한 설정만 보고하며 키·원문 오류를 노출하지 않는다. 더 좋은 결과를 위한 새 생성은 명시한 교정 범위 안에서만 한다.
7. 상품/원본/SKU ID와 해시, 처음 요청 ID, providerRequestId, 결과 assetId/해시/revision, 실제 사진 검토·전 언어 OCR 및 미완료 항목을 작업 결과에 기록한다. 키·토큰·전체 MCP 응답은 결과물에 넣지 않는다.
8. 최종 사진을 실제 확인했을 때만 완료로 보고한다. 가공 결함이 있으면 blocked로 인계한다. 상품 등록·가격 변경·외부 쇼핑몰 전송은 별도 요청 범위다.
