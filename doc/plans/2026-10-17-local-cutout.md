# 로컬 상품 누끼 전환

사용자는 실제 BiRefNet 결과를 확인하고 기존 자동 이미지 처리를 대체하도록
승인했다. Auto Sourcing이 추론·대기열·파일·원본 보호를 소유한다. 한 번에
한 모델, 스레드 1개, 작업 후 종료, 2560MiB RSS 감시와 시간 제한을 사용한다.
상품 위 글자·로고는 배경 제거만으로 지워졌다고 주장하지 않는다.

Dovix는 기존 local PNG/이미지 잡 API를 그대로 사용한다. 새 DB나 자동 유료
fallback, 모델 직접 연결, 에이전트의 생성/폴링을 추가하지 않는다. 기존
Higgsfield 수동 도구와 이미 제출한 요청은 호환성을 위해 보존한다.

- 새 메모리/모델/도구 오류를 한국어로 안내한다.
- 재시도 버튼을 생성 대신 가공으로 표현한다.
- 기존 가공 스킬의 서버 이미지 잡 설명을 로컬 누끼로 맞춘다.
- 실제 native HTTP/SQLite/PNG와 격리 Dovix 브라우저로 결과를 확인한다.
- Native dev PR30 검증·반영 후 Dovix dev PR의 UI를 정적으로 반영한다.
  실행 중인 Dovix 코어·에이전트는 재시작하지 않는다.

원본·성공 이미지·공지·가격·옵션·기존 provider 요청을 보존한다. Native의
정본과 검증은 `specs/005-product-publishing/local-cutout-evaluation.md`다.

검증: 이미지 작업 UI5개 테스트, UI typecheck 통과. 실제 native ONNX/SQLite/
HTTPS와 격리 Dovix bridge를 연결한 Chrome에서 저장 완료·원본/결과 비교·
상품 편집 대표 이미지의 실제 로드를 확인했고 콘솔/요청 오류가 없었다.
증거는 native `tmp/local-cutout/{browser-proof.json,browser-before-after.png}`.
전체/stress 검사는 하지 않았다. 운영 반영은 각 merged dev SHA와
`tmp/local-cutout/{deployment,static-ui-deployment}.json` receipt로 확인한다.
