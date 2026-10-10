export const sourcingViews = [
  {
    id: "sourcing",
    label: "소싱",
    listLabel: "소싱 상품 목록",
    columns: ["상품", "원가", "옵션", "수집일", "상태"],
    unavailable: "상품 데이터 미연결",
  },
  {
    id: "uploads",
    label: "상품 업로드",
    listLabel: "업로드 초안 목록",
    columns: ["상품", "판매 계정", "예정 가격", "검증 상태", "등록 상태"],
    unavailable: "업로드 초안 데이터 미연결",
  },
  {
    id: "orders",
    label: "주문",
    listLabel: "주문 목록",
    columns: ["주문번호", "판매 계정", "상태", "수량", "금액"],
    unavailable: "주문 데이터 미연결",
  },
  {
    id: "settings",
    label: "쇼핑몰 관리 설정",
    listLabel: "쇼핑몰 관리 설정",
    columns: [],
    unavailable: "프로젝트 선택",
  },
] as const;

export function getSourcingView(value: string | null) {
  return sourcingViews.find(view => view.id === value) ?? sourcingViews[0];
}
