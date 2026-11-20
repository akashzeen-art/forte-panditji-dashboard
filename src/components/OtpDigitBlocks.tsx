import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

type OtpDigitBlocksProps = {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export default function OtpDigitBlocks({
  length = 6,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: OtpDigitBlocksProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  useEffect(() => {
    if (!autoFocus || disabled) return;
    inputsRef.current[0]?.focus();
  }, [autoFocus, disabled]);

  const setDigitAt = (index: number, char: string) => {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join("").replace(/\D/g, "").slice(0, length));
  };

  const focusAt = (index: number) => {
    const el = inputsRef.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, "");
    if (!cleaned) {
      setDigitAt(index, "");
      return;
    }

    // Support paste / multi-digit insert into one box
    if (cleaned.length > 1) {
      const merged = (value.slice(0, index) + cleaned + value.slice(index + 1))
        .replace(/\D/g, "")
        .slice(0, length);
      onChange(merged);
      focusAt(Math.min(length - 1, index + cleaned.length));
      return;
    }

    setDigitAt(index, cleaned);
    if (index < length - 1) focusAt(index + 1);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        setDigitAt(index, "");
      } else if (index > 0) {
        setDigitAt(index - 1, "");
        focusAt(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focusAt(Math.min(length - 1, pasted.length));
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-2 sm:gap-2.5" role="group" aria-label="OTP digits">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputsRef.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of ${length}`}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className="h-12 w-10 rounded-xl border border-[#e8d9c8] bg-white text-center text-xl font-bold text-stone-900 outline-none transition focus:border-[#c2410c] focus:ring-2 focus:ring-[#fdba74]/50 disabled:opacity-50 sm:h-14 sm:w-12 sm:text-2xl"
        />
      ))}
    </div>
  );
}
