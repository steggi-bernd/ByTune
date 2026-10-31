/** butterchurn (Milkdrop on WebGL 2) ships no types; this is the part ByTune uses. */
declare module "butterchurn" {
  export interface Visualizer {
    connectAudio(node: AudioNode): void;
    disconnectAudio(node: AudioNode): void;
    loadPreset(preset: object, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }
  const butterchurn: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: { width: number; height: number; pixelRatio?: number; textureRatio?: number }
    ): Visualizer;
  };
  export default butterchurn;
}

/** The presets with their equations compiled at build time (scripts/vite-milkdrop.ts). */
declare module "virtual:milkdrop" {
  export function equation(source: string): (a: object) => object;
  export const presets: Record<string, object>;
}
