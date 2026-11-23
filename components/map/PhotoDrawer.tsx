"use client";

import { useRef, useState } from "react";
import type { Photo } from "@/types/photo";
import PhotoCard from "./PhotoCard";

/** מובייל: הכרטיסייה עולה מלמטה; גרירה למטה (או ×) סוגרת */
export default function PhotoDrawer({ photo, stack, onClose }: { photo: Photo; stack?: Photo[]; onClose: () => void }) {
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  return (
    <div data-photo-drawer className="absolute inset-x-0 bottom-0 z-40 md:hidden">
      <div
        className="mx-2 mb-2 max-h-[85dvh] overflow-y-auto rounded-3xl shadow-2xl transition-transform duration-150"
        style={{ transform: `translateY(${dragY}px)` }}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchMove={(e) => {
          if (startY.current == null) return;
          setDragY(Math.max(0, e.touches[0].clientY - startY.current));
        }}
        onTouchEnd={() => {
          if (dragY > 90) onClose();
          setDragY(0);
          startY.current = null;
        }}
      >
        <div className="relative">
          <span className="absolute inset-x-0 top-2 z-10 mx-auto h-1 w-10 rounded-full bg-white/50" />
          <PhotoCard photo={photo} stack={stack} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
