import { useEffect, useState } from "react";
import { resolveImageUrl } from "../lib/upstream";

function initials(name: string): string {
  const parts = name
    .replace(/\b(pandit|acharya|dr\.?|ji)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = (parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return (letters || "ॐ").toUpperCase();
}

type PanditAvatarProps = {
  src?: string;
  name: string;
  className?: string;
};

export default function PanditAvatar({ src, name, className = "" }: PanditAvatarProps) {
  const resolved = resolveImageUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (!resolved || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-[#fff7ed] to-[#ffedd5] font-display text-2xl font-bold text-[#9a3412] ${className}`}
        aria-label={name}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={name}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`bg-[#fff7ed] object-cover object-top ${className}`}
    />
  );
}
