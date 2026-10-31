import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "./components";
import { shared, tokens } from "./theme";
import type { Option } from "./options";

/**
 * Form primitives for the Phase 25 write workflows, built
 * only on the ITG theme tokens.
 *
 * Rules these components exist to uphold:
 * - Inputs hold RAW text. The only conversions are text →
 *   number / text → ISO timestamp at submit time; no financial
 *   value is ever computed in the app.
 * - Client validation is presence/format only. The server
 *   schema is authoritative — its error message is shown
 *   verbatim via <FormError /> and always wins.
 * - Submits are single-flight: <SubmitBar /> disables and
 *   spins while a request is in flight (double-submit
 *   protection on every form).
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={shared.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  multiline = false,
  keyboardType,
  autoCapitalize = "sentences",
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  keyboardType?: "default" | "decimal-pad" | "number-pad" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  maxLength?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.textMuted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        maxLength={maxLength}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </Field>
  );
}

/** Single-choice chip row; tapping the selected chip clears it when allowClear. */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  allowClear = false,
  hint,
}: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  allowClear?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              onPress={() => onChange(selected && allowClear ? null : option.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/** Multi-choice chip row (order follows the options list). */
export function ChipMultiSelect<T extends string>({
  label,
  options,
  values,
  onChange,
  hint,
}: {
  label: string;
  options: Option<T>[];
  values: T[];
  onChange: (values: T[]) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              onPress={() =>
                onChange(
                  selected
                    ? values.filter((v) => v !== option.value)
                    : options
                        .filter((o) => values.includes(o.value) || o.value === option.value)
                        .map((o) => o.value),
                )
              }
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/**
 * Date + time text inputs composing one local timestamp.
 * Date/time entry is text-based on purpose: expo-image-picker
 * is the only dependency Phase 25 adds, so no native picker
 * is pulled in for this.
 */
export function DateTimeField({
  label,
  date,
  time,
  onChangeDate,
  onChangeTime,
  hint,
}: {
  label: string;
  date: string;
  time: string;
  onChangeDate: (value: string) => void;
  onChangeTime: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <View style={styles.row}>
        <TextInput
          value={date}
          onChangeText={onChangeDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={tokens.textMuted}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, styles.flex]}
        />
        <TextInput
          value={time}
          onChangeText={onChangeTime}
          placeholder="HH:MM"
          placeholderTextColor={tokens.textMuted}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { width: 96 }]}
        />
      </View>
    </Field>
  );
}

/** Server error banner — the message is shown verbatim. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/** Success line — only ever set AFTER the server confirms. */
export function FormSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.successText}>{message}</Text>;
}

export function SubmitBar({
  label,
  onPress,
  submitting,
  error,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  submitting: boolean;
  error: string | null;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 10 }}>
      <FormError message={error} />
      <PrimaryButton
        label={label}
        onPress={onPress}
        loading={submitting}
        disabled={disabled}
      />
    </View>
  );
}

/* ---------------- parsing helpers (format only) ---------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateText(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && toDateText(parsed) === value;
}

export function isTimeText(value: string): boolean {
  return TIME_RE.test(value);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateText(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeText(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Split a stored ISO timestamp into local date/time field text. */
export function isoToParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return { date: toDateText(d), time: toTimeText(d) };
}

export function nowParts(): { date: string; time: string } {
  return isoToParts(new Date().toISOString());
}

/** Compose local date/time field text into an ISO timestamp; null when malformed. */
export function partsToIso(date: string, time: string): string | null {
  if (!isDateText(date) || !isTimeText(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Monday (YYYY-MM-DD) of the week containing a date — calendar math only. */
export function mondayOfWeek(dateText: string): string {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateText(d);
}

export function shiftDate(dateText: string, days: number): string {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  d.setDate(d.getDate() + days);
  return toDateText(d);
}

/**
 * Parse a numeric field: "" → null (field left blank),
 * malformed → NaN (caller treats as a format error). This is
 * text conversion only — never arithmetic on values.
 */
export function parseNumberText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function isValidNumberText(text: string): boolean {
  const value = parseNumberText(text);
  return value !== null && !Number.isNaN(value);
}

/** Blank text → null; otherwise the trimmed text. */
export function textOrNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  hint: {
    color: tokens.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    backgroundColor: tokens.glass,
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusSm,
    color: tokens.textPrimary,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    backgroundColor: tokens.glass,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipSelected: {
    backgroundColor: tokens.blueBright,
    borderColor: tokens.glassBorderBright,
  },
  chipText: {
    color: tokens.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: tokens.textPrimary,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  flex: {
    flex: 1,
  },
  errorBox: {
    backgroundColor: "rgba(255, 77, 114, 0.12)",
    borderColor: tokens.loss,
    borderWidth: 1,
    borderRadius: tokens.radiusSm,
    padding: 12,
  },
  errorText: {
    color: tokens.loss,
    fontSize: 14,
    lineHeight: 19,
  },
  successText: {
    color: tokens.profit,
    fontSize: 14,
    fontWeight: "600",
  },
});
