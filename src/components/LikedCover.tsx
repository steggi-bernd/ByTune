import { Heart } from "lucide-react";

/**
 * Liked Songs' own cover: a heart on a gradient of the accent colour — the
 * same wherever the list shows up (the library panel and its icon rail, the
 * library page), never one song's artwork standing in for the whole list.
 */
export function LikedCover({ className = "", heartClassName = "w-5 h-5" }: { className?: string; heartClassName?: string }) {
  return (
    <span aria-hidden className={`relative grid place-items-center overflow-hidden bg-[#141418] ${className}`}>
      <span className="absolute inset-0 bg-gradient-to-br from-accent to-accent/25" />
      <Heart className={`relative fill-white text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)] ${heartClassName}`} />
    </span>
  );
}
