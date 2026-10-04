import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

export function Knowledge() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge" }]);
  }, [setBreadcrumbs]);

  return <section aria-label="Knowledge" />;
}
