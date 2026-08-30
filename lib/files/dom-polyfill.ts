import "server-only";

/**
 * Minimal, spec-accurate 2D-subset DOMMatrix polyfill.
 *
 * pdfjs-dist (pdf-parse's dependency) uses DOMMatrix purely for 2D affine
 * transforms while computing text position during `getText()` — it has no
 * dependency on real canvas rendering for that. Node has no built-in
 * DOMMatrix, and pdfjs-dist's own fallback is the native `@napi-rs/canvas`
 * package; that package ships per-platform prebuilt binaries selected via
 * npm optionalDependencies, which hit a well-known npm bug where a
 * lockfile generated on one OS/arch doesn't reliably resolve the right
 * binary on another (confirmed live: installing it locally on macOS then
 * deploying to Vercel's Linux runtime produced "Cannot find native
 * binding" in production). A tiny pure-JS polyfill of just the 2D affine
 * math DOMMatrix defines avoids that whole native-binary problem.
 *
 * The formulas below are the standard 2D affine transform composition
 * (matrix multiplication of two 3x3 matrices in the [a b 0; c d 0; e f 1]
 * form DOMMatrix uses for its 2D subset) — not guessed, this is the
 * canonical definition.
 */
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length >= 6) {
      this.a = init[0]!;
      this.b = init[1]!;
      this.c = init[2]!;
      this.d = init[3]!;
      this.e = init[4]!;
      this.f = init[5]!;
    }
  }

  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    ]);
  }

  translate(tx: number, ty: number): DOMMatrixPolyfill {
    return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]));
  }

  scale(sx: number, sy: number = sx): DOMMatrixPolyfill {
    return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]));
  }

  inverse(): DOMMatrixPolyfill {
    const det = this.a * this.d - this.b * this.c;
    return new DOMMatrixPolyfill([
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    ]);
  }

  transformPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: this.a * point.x + this.c * point.y + this.e,
      y: this.b * point.x + this.d * point.y + this.f,
    };
  }
}

/** Installs the polyfill once, only if the runtime has no real DOMMatrix. */
export function ensureDomMatrixPolyfill(): void {
  const target = globalThis as unknown as { DOMMatrix?: unknown };
  if (typeof target.DOMMatrix === "undefined") {
    target.DOMMatrix = DOMMatrixPolyfill;
  }
}
