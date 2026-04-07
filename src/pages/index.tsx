import { GetServerSideProps } from "next";
import { existsSync } from "fs";
import { join } from "path";
import { useState } from "react";

interface Toolkit {
  slug: string;
  name: string;
  logo: string | null;
  hasLocalSvg: boolean;
}

interface Props {
  toolkits: Toolkit[];
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  const res = await fetch(
    "https://backend.composio.dev/api/v3/toolkits?sort_by=usage&limit=1000",
    { headers: { "x-api-key": "y4ru2vrbb1ms91rowhcelk" } }
  );
  const data = await res.json();
  const assetsDir = join(process.cwd(), "src", "assets");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolkits: Toolkit[] = (data.items ?? []).map((item: any) => {
    const slug = item.slug as string;
    return {
      slug,
      name: item.name as string,
      logo: item.meta?.logo ?? null,
      hasLocalSvg: existsSync(join(assetsDir, `${slug}.svg`)),
    };
  });

  return { props: { toolkits } };
};

export default function LogoGallery({ toolkits }: Props) {
  const [filter, setFilter] = useState<"all" | "local" | "missing">("all");

  const filtered = toolkits.filter((t) => {
    if (filter === "local") return t.hasLocalSvg;
    if (filter === "missing") return !t.hasLocalSvg;
    return true;
  });

  const localCount = toolkits.filter((t) => t.hasLocalSvg).length;
  const missingCount = toolkits.filter((t) => !t.hasLocalSvg).length;

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Logo Gallery</h1>
      <p style={{ marginBottom: "1rem", opacity: 0.6 }}>
        {toolkits.length} toolkits sorted by popularity &middot; {localCount}{" "}
        local &middot; {missingCount} missing
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {(["all", "local", "missing"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: 6,
              border: "1px solid #444",
              background: filter === f ? "#444" : "transparent",
              color: filter === f ? "#fff" : "inherit",
              cursor: "pointer",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "1rem",
        }}
      >
        {filtered.map((t, i) => (
          <div
            key={t.slug}
            style={{
              border: "1px solid #333",
              borderRadius: 8,
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.5rem",
              opacity: t.hasLocalSvg ? 1 : 0.4,
            }}
          >
            <span
              style={{ fontSize: 11, opacity: 0.4, alignSelf: "flex-start" }}
            >
              #{i + 1}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={t.hasLocalSvg ? `/api/${t.slug}?theme=dark` : (t.logo ?? "")}
              alt={t.name}
              style={{ width: 48, height: 48, objectFit: "contain" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span
              style={{
                fontSize: 12,
                textAlign: "center",
                wordBreak: "break-word",
              }}
            >
              {t.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
