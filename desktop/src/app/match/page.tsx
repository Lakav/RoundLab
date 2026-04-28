"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import MatchViewer from "./MatchViewer";

function MatchPageInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Missing match id.
      </div>
    );
  }
  return <MatchViewer id={id} />;
}

export default function MatchPage() {
  return (
    <Suspense fallback={null}>
      <MatchPageInner />
    </Suspense>
  );
}
