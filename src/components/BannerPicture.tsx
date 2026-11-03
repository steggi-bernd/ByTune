import { useEffect, useState } from "react";

/**
 * An artist banner's picture: the best of the candidates that has loaded — a
 * sharper one fades in over it once it has loaded too, one that fails is
 * passed over (offline: the stored photo, else a cover).
 */
export function BannerPicture({ candidates }: { candidates: string[] }) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [layers, setLayers] = useState<string[]>([]);
  const wanted = candidates.join("\n");
  useEffect(() => {
    const images = candidates.map((src) => {
      const img = new Image();
      img.onload = () => setLoaded((s) => (s.has(src) ? s : new Set(s).add(src)));
      img.src = src;
      return img;
    });
    return () => {
      for (const img of images) img.onload = null;
    };
    // The list is rebuilt every render; its contents are what count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const best = candidates.find((c) => loaded.has(c)) ?? null;
  useEffect(() => {
    if (best) setLayers((l) => (l[l.length - 1] === best ? l : [...l.slice(-1), best]));
  }, [best]);
  if (!layers.length) return <div className="absolute inset-0 bg-ink-hi/[0.06]" />;
  return (
    <>
      {layers.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover object-[center_25%] ${i === layers.length - 1 ? "animate-fade-in" : ""}`}
          style={{ animationDuration: "500ms" }}
        />
      ))}
    </>
  );
}
