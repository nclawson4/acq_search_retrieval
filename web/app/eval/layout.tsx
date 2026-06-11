import { notFound } from "next/navigation";
import { devRoutesEnabled } from "@/lib/env";

export default function EvalLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  return <>{children}</>;
}
