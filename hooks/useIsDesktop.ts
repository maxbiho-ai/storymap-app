"use client";

import { useEffect, useState } from "react";

/** md של Tailwind (768px) — אותה נקודת שבירה כמו ה-CSS */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}
