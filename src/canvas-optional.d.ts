/**
 * Minimal ambient declaration for the optional `canvas` package.
 * This lets TypeScript typecheck `render.ts` without requiring the native
 * module to be installed in devDependencies.
 *
 * The real types are provided at runtime when the user installs canvas.
 */
declare module 'canvas' {
  export interface Canvas {
    width: number
    height: number
    getContext(type: '2d'): unknown
    toBuffer(type: string): Buffer
  }

  export function createCanvas(width: number, height: number): Canvas
}
