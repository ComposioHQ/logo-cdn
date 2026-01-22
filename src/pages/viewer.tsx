import { useState, useEffect, useCallback, useMemo } from "react";
import Head from "next/head";
import { cn } from "@/lib/utils";

interface Toolkit {
  slug: string;
  name: string;
  description: string;
  appUrl: string;
  logoUrl: string;
  toolsCount: number;
  hasLocalLogo: boolean;
}

interface LogoAnalysis {
  slug: string;
  isWhiteOnly: boolean;
  isOversized: boolean;
  isNonSquare: boolean;
  width: number | null;
  height: number | null;
}

type FilterType = "all" | "missing" | "white" | "oversized" | "non-square";

export default function Viewer() {
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [analysis, setAnalysis] = useState<Map<string, LogoAnalysis>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Track global drag state
  useEffect(() => {
    const handleDragEnter = () => setIsDragging(true);
    const handleDragEnd = () => setIsDragging(false);
    const handleDrop = () => setIsDragging(false);

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragend", handleDragEnd);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) setIsDragging(false);
    });

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragend", handleDragEnd);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  // Handle paste for selected logo
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!selected) return;

      const text = e.clipboardData?.getData("text/plain");
      if (text && text.trim().startsWith("<svg")) {
        e.preventDefault();
        const currentSelected = selected;
        try {
          const res = await fetch("/api/viewer/replace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: currentSelected, content: text }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to replace");
          }

          setModifiedFiles((prev) => new Set([...prev, currentSelected]));
          setToolkits((prev) =>
            prev.map((t) => (t.slug === currentSelected ? { ...t, hasLocalLogo: true } : t))
          );

          // Refresh analysis
          const analysisRes = await fetch("/api/viewer/analysis");
          const analysisData = await analysisRes.json();
          setAnalysis(
            new Map(analysisData.analysis.map((a: LogoAnalysis) => [a.slug, a]))
          );

          setToast(`Pasted SVG for ${currentSelected}`);
          setTimeout(() => setToast(null), 3000);
        } catch (err) {
          setToast(err instanceof Error ? err.message : "Failed to paste");
          setTimeout(() => setToast(null), 3000);
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [selected]);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const [toolkitsRes, analysisRes, modifiedRes] = await Promise.all([
          fetch("/api/viewer/toolkits"),
          fetch("/api/viewer/analysis"),
          fetch("/api/viewer/modified"),
        ]);

        if (!toolkitsRes.ok || !analysisRes.ok) {
          throw new Error("Failed to fetch data");
        }

        const toolkitsData = await toolkitsRes.json();
        const analysisData = await analysisRes.json();
        const modifiedData = modifiedRes.ok ? await modifiedRes.json() : { modified: [] };

        setToolkits(toolkitsData.toolkits);
        setAnalysis(
          new Map(analysisData.analysis.map((a: LogoAnalysis) => [a.slug, a]))
        );
        setModifiedFiles(new Set(modifiedData.modified));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Show toast
  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Handle file drop
  const handleDrop = useCallback(
    async (slug: string, file: File) => {
      if (!file.name.endsWith(".svg")) {
        showToast("Please drop an SVG file");
        return;
      }

      try {
        const content = await file.text();
        const res = await fetch("/api/viewer/replace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, content }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to replace");
        }

        // Update state
        setModifiedFiles((prev) => new Set([...prev, slug]));
        setToolkits((prev) =>
          prev.map((t) => (t.slug === slug ? { ...t, hasLocalLogo: true } : t))
        );

        // Refresh analysis for this file
        const analysisRes = await fetch("/api/viewer/analysis");
        const analysisData = await analysisRes.json();
        setAnalysis(
          new Map(analysisData.analysis.map((a: LogoAnalysis) => [a.slug, a]))
        );

        showToast(`Replaced ${slug}.svg`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to replace");
      }
    },
    [showToast]
  );

  // Copy SVG to clipboard
  const copySvg = useCallback(
    async (slug: string) => {
      try {
        // Use cache-busting to ensure fresh content
        const res = await fetch(`/api/${slug}?copy=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to fetch SVG");
        const svgContent = await res.text();
        await navigator.clipboard.writeText(svgContent);
        showToast(`Copied ${slug}.svg to clipboard`);
      } catch (err) {
        showToast("Failed to copy SVG");
      }
    },
    [showToast]
  );

  // Filter counts
  const counts = useMemo(() => {
    const missing = toolkits.filter((t) => !t.hasLocalLogo).length;
    const white = toolkits.filter(
      (t) => t.hasLocalLogo && analysis.get(t.slug)?.isWhiteOnly
    ).length;
    const oversized = toolkits.filter(
      (t) => t.hasLocalLogo && analysis.get(t.slug)?.isOversized
    ).length;
    const nonSquare = toolkits.filter(
      (t) => t.hasLocalLogo && analysis.get(t.slug)?.isNonSquare
    ).length;
    return { missing, white, oversized, nonSquare };
  }, [toolkits, analysis]);

  // Filtered toolkits
  const filteredToolkits = useMemo(() => {
    return toolkits.filter((t) => {
      // Search filter
      if (search && !t.slug.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      // Type filter
      const a = analysis.get(t.slug);
      switch (filter) {
        case "missing":
          return !t.hasLocalLogo;
        case "white":
          return t.hasLocalLogo && a?.isWhiteOnly;
        case "oversized":
          return t.hasLocalLogo && a?.isOversized;
        case "non-square":
          return t.hasLocalLogo && a?.isNonSquare;
        default:
          return true;
      }
    });
  }, [toolkits, analysis, search, filter]);

  // Git command
  const gitCommand = useMemo(() => {
    if (modifiedFiles.size === 0) return "";
    const files = Array.from(modifiedFiles)
      .map((s) => `src/assets/${s}.svg`)
      .join(" ");
    return `git add ${files} && git commit -m "fix: update ${modifiedFiles.size} logo(s)"`;
  }, [modifiedFiles]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50">
        <div className="text-sm text-neutral-500">Loading toolkits...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Logo Viewer | Composio</title>
      </Head>

      <div className="min-h-dvh bg-neutral-50">
        {/* Header */}
        <header className="fixed top-0 left-0 right-0 z-20 border-b border-neutral-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2">
            {/* Search */}
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-40 rounded border border-neutral-200 px-2 py-1 text-xs placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
            />

            {/* Filters */}
            <div className="flex gap-px rounded border border-neutral-200 bg-neutral-200">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
                All
              </FilterButton>
              <FilterButton active={filter === "missing"} onClick={() => setFilter("missing")} count={counts.missing}>
                Missing
              </FilterButton>
              <FilterButton active={filter === "white"} onClick={() => setFilter("white")} count={counts.white}>
                White
              </FilterButton>
              <FilterButton active={filter === "oversized"} onClick={() => setFilter("oversized")} count={counts.oversized}>
                Large
              </FilterButton>
              <FilterButton active={filter === "non-square"} onClick={() => setFilter("non-square")} count={counts.nonSquare}>
                Ratio
              </FilterButton>
            </div>

            {/* View toggle */}
            <div className="flex gap-px rounded border border-neutral-200 bg-neutral-200">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium transition-colors",
                  viewMode === "grid" ? "bg-neutral-900 text-white" : "bg-white text-neutral-500 hover:bg-neutral-50"
                )}
                title="Grid view"
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium transition-colors",
                  viewMode === "list" ? "bg-neutral-900 text-white" : "bg-white text-neutral-500 hover:bg-neutral-50"
                )}
                title="List view (3 backgrounds)"
              >
                List
              </button>
            </div>

            {/* Count */}
            <span className="text-[10px] tabular-nums text-neutral-400">
              {filteredToolkits.length}/{toolkits.length}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Selected indicator */}
            {selected && (
              <div className="flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1">
                <span className="text-[10px] font-medium text-violet-700">{selected}</span>
                <span className="text-[10px] text-violet-400">⌘V to paste</span>
                <button onClick={() => setSelected(null)} className="ml-1 text-xs text-violet-400 hover:text-violet-600">×</button>
              </div>
            )}

            {/* Modified indicator */}
            {modifiedFiles.size > 0 && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(gitCommand);
                  showToast("Git command copied!");
                }}
                className="flex items-center gap-1.5 rounded border border-green-200 bg-green-50 px-2 py-1 text-[10px] text-green-700 hover:bg-green-100"
                title={gitCommand}
              >
                <span className="size-1.5 rounded-full bg-green-500" />
                <span className="font-medium tabular-nums">{modifiedFiles.size}</span>
                <span className="text-green-600">modified</span>
              </button>
            )}
          </div>
        </header>

        {/* Grid View */}
        {viewMode === "grid" && (
          <main className="flex flex-wrap gap-px bg-neutral-200 p-px pt-10">
            {filteredToolkits.map((toolkit) => {
              const a = analysis.get(toolkit.slug);
              const isModified = modifiedFiles.has(toolkit.slug);
              const isDragTarget = dragOver === toolkit.slug;

              return (
                <div
                  key={toolkit.slug}
                  className={cn(
                    "group relative cursor-pointer bg-white",
                    selected === toolkit.slug && "ring-2 ring-inset ring-violet-500",
                    isModified && !selected && "ring-2 ring-inset ring-green-500",
                    isDragTarget && "ring-2 ring-inset ring-blue-500"
                  )}
                  onClick={() => setSelected(selected === toolkit.slug ? null : toolkit.slug)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(toolkit.slug);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const file = e.dataTransfer.files[0];
                    if (file) handleDrop(toolkit.slug, file);
                  }}
                >
                  {/* Modified badge */}
                  {isModified && (
                    <div
                      className="absolute right-1.5 top-1.5 z-10 size-2 rounded-full bg-green-500"
                      title="Modified"
                    />
                  )}

                  {/* Logo area */}
                  <div
                    className={cn(
                      "flex size-32 items-center justify-center",
                      toolkit.hasLocalLogo
                        ? a?.isWhiteOnly
                          ? "bg-neutral-800"
                          : "bg-neutral-100"
                        : "bg-neutral-50"
                    )}
                  >
                    {toolkit.hasLocalLogo ? (
                      <div className="flex size-16 items-center justify-center border border-black/10">
                        <img
                          src={`/api/${toolkit.slug}`}
                          alt={toolkit.name}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="flex size-16 items-center justify-center border border-dashed border-neutral-300 text-neutral-300">
                        <svg
                          className="size-6"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4.5v15m7.5-7.5h-15"
                          />
                        </svg>
                      </div>
                    )}

                    {/* Drop overlay - only show when dragging */}
                    {isDragging && (
                      <div
                        className={cn(
                          "absolute inset-0 transition-colors",
                          isDragTarget ? "bg-blue-500/40" : "bg-black/30"
                        )}
                      />
                    )}
                  </div>

                  {/* Issue badges */}
                  {toolkit.hasLocalLogo && (a?.isWhiteOnly || a?.isOversized || a?.isNonSquare) && (
                    <div className="absolute bottom-1.5 right-1.5 flex gap-0.5">
                      {a?.isWhiteOnly && (
                        <span className="size-2 rounded-full bg-red-500" title="White only" />
                      )}
                      {a?.isOversized && (
                        <span className="size-2 rounded-full bg-amber-500" title="Oversized" />
                      )}
                      {a?.isNonSquare && (
                        <span className="size-2 rounded-full bg-blue-500" title="Non-square" />
                      )}
                    </div>
                  )}

                  {/* Hover overlay with actions */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="max-w-full truncate px-2 text-[10px] font-medium text-white">{toolkit.slug}</span>
                    <div className="flex gap-1">
                      {toolkit.hasLocalLogo && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copySvg(toolkit.slug);
                          }}
                          className="flex size-7 items-center justify-center rounded bg-white/90 text-neutral-700 hover:bg-white"
                          title="Copy SVG"
                        >
                          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      )}
                      {toolkit.appUrl && (
                        <a
                          href={toolkit.appUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex size-7 items-center justify-center rounded bg-white/90 text-neutral-700 hover:bg-white"
                          title="Open website"
                        >
                          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </main>
        )}

        {/* List View - 3 backgrounds per logo */}
        {viewMode === "list" && (
          <main className="flex flex-col items-center pt-12">
            {filteredToolkits.filter(t => t.hasLocalLogo).map((toolkit) => {
              const a = analysis.get(toolkit.slug);
              const isModified = modifiedFiles.has(toolkit.slug);
              const isDragTarget = dragOver === toolkit.slug;

              return (
                <div
                  key={toolkit.slug}
                  className={cn(
                    "group relative flex items-center gap-4 border-b border-neutral-200 bg-white px-6 py-4",
                    selected === toolkit.slug && "bg-violet-50",
                    isModified && "bg-green-50"
                  )}
                  onClick={() => setSelected(selected === toolkit.slug ? null : toolkit.slug)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(toolkit.slug);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const file = e.dataTransfer.files[0];
                    if (file) handleDrop(toolkit.slug, file);
                  }}
                >
                  {/* Slug name and actions */}
                  <div className="w-36 shrink-0">
                    <span className="text-xs font-medium text-neutral-900">{toolkit.slug}</span>
                    
                    {/* Actions below name */}
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copySvg(toolkit.slug);
                        }}
                        className="flex size-6 items-center justify-center rounded border border-neutral-200 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
                        title="Copy SVG"
                      >
                        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      {toolkit.appUrl && (
                        <a
                          href={toolkit.appUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex size-6 items-center justify-center rounded border border-neutral-200 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
                          title="Open website"
                        >
                          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      )}
                    </div>

                    {/* Issue badges */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a?.isWhiteOnly && (
                        <span className="rounded bg-red-100 px-1 py-0.5 text-[8px] font-medium text-red-700">White</span>
                      )}
                      {a?.isOversized && (
                        <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-medium text-amber-700">Large</span>
                      )}
                      {a?.isNonSquare && (
                        <span className="rounded bg-blue-100 px-1 py-0.5 text-[8px] font-medium text-blue-700">Ratio</span>
                      )}
                      {isModified && (
                        <span className="rounded bg-green-100 px-1 py-0.5 text-[8px] font-medium text-green-700">Modified</span>
                      )}
                    </div>
                  </div>

                  {/* Three logo previews */}
                  <div className="flex gap-2">
                    {/* Gray background */}
                    <div className="flex size-32 items-center justify-center border border-black/10 bg-neutral-100">
                      <div className="flex size-16 items-center justify-center border border-black/10">
                        <img
                          src={`/api/${toolkit.slug}`}
                          alt={`${toolkit.name} on gray`}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    </div>
                    {/* White background */}
                    <div className="flex size-32 items-center justify-center border border-black/10 bg-white">
                      <div className="flex size-16 items-center justify-center border border-black/10">
                        <img
                          src={`/api/${toolkit.slug}`}
                          alt={`${toolkit.name} on white`}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    </div>
                    {/* Black background */}
                    <div className="flex size-32 items-center justify-center border border-black/10 bg-neutral-900">
                      <div className="flex size-16 items-center justify-center border border-white/10">
                        <img
                          src={`/api/${toolkit.slug}`}
                          alt={`${toolkit.name} on black`}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Drop overlay */}
                  {isDragging && isDragTarget && (
                    <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20">
                      <span className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white">Drop to replace</span>
                    </div>
                  )}
                </div>
              );
            })}
          </main>
        )}

        {/* Toast */}
        <div
          className={cn(
            "pointer-events-none fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg",
            toast ? "opacity-100" : "opacity-0"
          )}
        >
          {toast}
        </div>

        {/* Git command modal */}
        {modifiedFiles.size > 0 && (
          <div className="fixed bottom-4 right-4 z-10 max-w-md rounded-lg border border-neutral-200 bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-medium text-balance text-neutral-900">
              Commit {modifiedFiles.size} modified file(s)
            </h3>
            <code className="mb-3 block overflow-x-auto rounded bg-neutral-100 p-2 text-xs text-pretty text-neutral-700">
              {gitCommand}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(gitCommand);
                showToast("Copied to clipboard!");
              }}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Copy Command
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function FilterButton({
  children,
  active,
  onClick,
  count,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors",
        active
          ? "bg-neutral-900 text-white"
          : "bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={cn("tabular-nums", active ? "text-neutral-400" : "text-neutral-400")}>
          {count}
        </span>
      )}
    </button>
  );
}
