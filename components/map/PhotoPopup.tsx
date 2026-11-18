"use client";

import { Popup } from "react-map-gl";
import type { Photo } from "@/types/photo";
import PhotoCard from "./PhotoCard";

/** דסקטופ: הכרטיסייה צפה מעל ה-Pin */
export default function PhotoPopup({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  return (
    <Popup
      longitude={photo.longitude}
      latitude={photo.latitude}
      anchor="bottom"
      offset={70}
      closeButton={false}
      closeOnClick={false}
      onClose={onClose}
      maxWidth="340px"
      className="storymap-popup"
    >
      <div className="w-[340px] shadow-2xl">
        <PhotoCard photo={photo} onClose={onClose} />
      </div>
    </Popup>
  );
}
