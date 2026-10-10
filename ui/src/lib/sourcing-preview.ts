// Synthetic screen examples, never sent to the native plugin or marketplace.
export type PreviewProductImage = { id: string; src: string; alt: string; label: string };
export type PreviewProduct = {
  id: string;
  title: string;
  originalTitle: string;
  source: "Taobao" | "1688";
  category: string;
  sourcePrice: number;
  state: "collected" | "review" | "ready";
  options: { name: string; price: number }[];
  collectedOn: string;
  originalDescription: string;
  images: PreviewProductImage[];
};

export const sourcingPreviewProducts: PreviewProduct[] = [
  { id: "example-product-1", title: "데스크 케이블 정리함", originalTitle: "桌面电线收纳盒", source: "Taobao", category: "데스크 정리", sourcePrice: 18.5, state: "ready", collectedOn: "2026-10-08",
    options: [{ name: "화이트 · 기본형", price: 18.5 }, { name: "그레이 · 기본형", price: 18.5 }, { name: "화이트 · 대형", price: 24 }], originalDescription: "桌面电线收纳盒，多种颜色与尺寸可选。",
    images: [{ id: "cable-box", src: "/sourcing-examples/cable-box.png", alt: "화이트 케이블 정리함 · AI 생성 예시", label: "외관" }, { id: "cable-box-open", src: "/sourcing-examples/cable-box-open.png", alt: "뚜껑을 연 케이블 정리함 · AI 생성 예시", label: "내부" }] },
  { id: "example-product-2", title: "실리콘 컵 홀더", originalTitle: "硅胶杯托", source: "1688", category: "생활용품", sourcePrice: 6.8, state: "review", collectedOn: "2026-10-08",
    options: [{ name: "블랙", price: 6.8 }, { name: "화이트", price: 6.8 }], originalDescription: "硅胶杯托，黑色、白色可选。",
    images: [{ id: "cup-holder", src: "/sourcing-examples/cup-holder.png", alt: "블랙 실리콘 컵 홀더 · AI 생성 예시", label: "외관" }] },
  { id: "example-product-3", title: "미니 데스크 수납함", originalTitle: "桌面迷你收纳盒", source: "Taobao", category: "데스크 정리", sourcePrice: 22, state: "collected", collectedOn: "2026-10-07",
    options: [{ name: "기본형", price: 22 }, { name: "2단형", price: 32 }], originalDescription: "桌面收纳盒，单层与双层可选。",
    images: [{ id: "desk-organizer", src: "/sourcing-examples/desk-organizer.png", alt: "민트색 미니 데스크 수납함 · AI 생성 예시", label: "외관" }] },
  { id: "example-product-4", title: "여행용 파우치 세트", originalTitle: "旅行收纳袋套装", source: "1688", category: "여행용품", sourcePrice: 15.2, state: "ready", collectedOn: "2026-10-07",
    options: [{ name: "그레이 · 3개 세트", price: 15.2 }, { name: "블루 · 3개 세트", price: 15.2 }], originalDescription: "旅行收纳袋，三件套，多色可选。",
    images: [{ id: "travel-pouches", src: "/sourcing-examples/travel-pouches.png", alt: "그레이 여행용 파우치 3개 세트 · AI 생성 예시", label: "세트" }] },
];

export type PreviewUpload = {
  id: string;
  productId: string;
  account: "coupang" | "smartstore";
  price: number;
  checks: { label: string; passed: boolean; note: string }[];
};

export const sourcingPreviewUploads: PreviewUpload[] = [
  { id: "example-upload-1", productId: "example-product-1", account: "coupang", price: 17900,
    checks: [{ label: "상품명", passed: true, note: "예시 상품명 입력" }, { label: "카테고리", passed: true, note: "예시 카테고리 입력" }, { label: "판매 가격", passed: true, note: "예시 판매가 입력" }, { label: "옵션", passed: true, note: "예시 옵션 3개" }, { label: "대표 이미지", passed: false, note: "이미지 미연결" }, { label: "필수 고시", passed: false, note: "고시 정보 미입력" }] },
  { id: "example-upload-2", productId: "example-product-2", account: "coupang", price: 8900,
    checks: [{ label: "상품명", passed: true, note: "예시 상품명 입력" }, { label: "카테고리", passed: false, note: "카테고리 확인 필요" }, { label: "판매 가격", passed: true, note: "예시 판매가 입력" }, { label: "옵션", passed: true, note: "예시 옵션 2개" }, { label: "대표 이미지", passed: false, note: "이미지 미연결" }, { label: "필수 고시", passed: false, note: "고시 정보 미입력" }] },
  { id: "example-upload-3", productId: "example-product-4", account: "smartstore", price: 12900,
    checks: [{ label: "상품명", passed: true, note: "예시 상품명 입력" }, { label: "카테고리", passed: true, note: "예시 카테고리 입력" }, { label: "판매 가격", passed: true, note: "예시 판매가 입력" }, { label: "옵션", passed: true, note: "예시 옵션 2개" }, { label: "대표 이미지", passed: false, note: "이미지 미연결" }, { label: "필수 고시", passed: false, note: "고시 정보 미입력" }] },
];

export const previewSourceStates = { collected: "수집 완료", review: "확인 필요", ready: "초안 준비" };
export const previewAccounts = { coupang: "쿠팡 · 예시 계정", smartstore: "스마트스토어 · 예시 계정" };
export const previewValidationStates = { complete: "입력 완료", incomplete: "보완 필요" };

export function previewImageChecks(upload: PreviewUpload, imageReady: boolean) {
  return upload.checks.map(check => check.label === "대표 이미지" ? {
    ...check, passed: imageReady, note: imageReady ? "AI 생성 예시 이미지 선택 · 실제 상품 사진 아님" : "대표 이미지 미선택 또는 로딩 실패",
  } : check);
}

export function previewValidation(upload: PreviewUpload, imageReady = false) {
  return previewImageChecks(upload, imageReady).every(check => check.passed) ? "complete" : "incomplete";
}
