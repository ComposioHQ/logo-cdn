import { useState, useCallback } from "react";
import Head from "next/head";
import { cn } from "@/lib/utils";

export default function Vectorize() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [svgResult, setSvgResult] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file (PNG, JPG, GIF, WebP)");
      return;
    }

    // Don't process SVGs
    if (file.type === "image/svg+xml") {
      setError("File is already an SVG");
      return;
    }

    setError(null);
    setSvgResult(null);
    setFilename(file.name);
    setIsProcessing(true);

    try {
      // Read file as data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setOriginalImage(dataUrl);

      // Call vectorize API
      const res = await fetch("/api/viewer/vectorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, filename: file.name }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to vectorize");
      }

      setSvgResult(data.svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to vectorize");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    },
    [handleFile]
  );

  const copySvg = useCallback(() => {
    if (svgResult) {
      navigator.clipboard.writeText(svgResult);
    }
  }, [svgResult]);

  const downloadSvg = useCallback(() => {
    if (svgResult) {
      const blob = new Blob([svgResult], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\.\w+$/, ".svg") || "vectorized.svg";
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [svgResult, filename]);

  const reset = useCallback(() => {
    setOriginalImage(null);
    setSvgResult(null);
    setError(null);
    setFilename("");
  }, []);

  return (
    <>
      <Head>
        <title>Vectorize | Composio</title>
      </Head>

      <div
        className="flex min-h-dvh flex-col bg-neutral-950 text-white"
        onPaste={handlePaste}
        tabIndex={0}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-medium">PNG → SVG Vectorizer</h1>
            <a
              href="/viewer"
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              ← Back to Viewer
            </a>
          </div>
          {svgResult && (
            <button
              onClick={reset}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              Reset
            </button>
          )}
        </header>

        {/* Main content */}
        <main className="flex flex-1 items-center justify-center p-8">
          {!originalImage ? (
            // Drop zone
            <div
              className={cn(
                "flex h-80 w-full max-w-xl flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors",
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-neutral-700 bg-neutral-900 hover:border-neutral-600"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <div className="mb-4 text-4xl">
                {isDragging ? "📥" : "🖼️"}
              </div>
              <p className="mb-2 text-sm text-neutral-300">
                Drop a PNG, JPG, GIF, or WebP image here
              </p>
              <p className="text-xs text-neutral-500">
                or paste from clipboard (⌘V)
              </p>

              <label className="mt-6 cursor-pointer rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700">
                Choose File
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </label>
            </div>
          ) : (
            // Result view
            <div className="flex w-full max-w-4xl flex-col gap-6">
              {/* Processing state */}
              {isProcessing && (
                <div className="flex flex-col items-center gap-4 py-12">
                  <div className="size-8 animate-spin rounded-full border-2 border-neutral-600 border-t-blue-500" />
                  <p className="text-sm text-neutral-400">
                    Vectorizing with Vectorizer.ai...
                  </p>
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-center">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    onClick={reset}
                    className="mt-3 text-xs text-red-300 hover:text-red-200"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Success state */}
              {svgResult && (
                <>
                  {/* Preview */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Original */}
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-neutral-500">
                        Original ({filename})
                      </span>
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-white p-4">
                        <img
                          src={originalImage}
                          alt="Original"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    </div>

                    {/* SVG Result */}
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-neutral-500">
                        Vectorized SVG (128×128)
                      </span>
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-white p-4">
                        <div className="flex size-32 items-center justify-center border border-black/10">
                          <img
                            src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgResult)))}`}
                            alt="Vectorized"
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={copySvg}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
                    >
                      <svg
                        className="size-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      Copy SVG
                    </button>
                    <button
                      onClick={downloadSvg}
                      className="flex items-center gap-2 rounded-lg bg-neutral-800 px-5 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-700"
                    >
                      <svg
                        className="size-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Download SVG
                    </button>
                    <button
                      onClick={reset}
                      className="rounded-lg border border-neutral-700 px-5 py-2.5 text-sm text-neutral-400 hover:bg-neutral-800"
                    >
                      New Image
                    </button>
                  </div>

                  {/* SVG Code preview */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-neutral-500">
                      SVG Code ({svgResult.length.toLocaleString()} characters)
                    </span>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-neutral-900 p-4 text-xs text-neutral-400">
                      {svgResult.slice(0, 2000)}
                      {svgResult.length > 2000 && "..."}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
