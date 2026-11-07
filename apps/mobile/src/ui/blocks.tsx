import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppText, Button, StatusIcon } from './primitives.tsx';
import { useTheme } from './theme.tsx';

/**
 * Building blocks of the screens (ADR 0098), the app's side of the web's
 * `apps/web/src/ui`: status chips, KPI tiles, list rows, empty states and a
 * segmented control. Every size, color and type role comes from `ui-tokens`.
 */

/**
 * A state inside a row or a summary: a tinted pill with its icon and text,
 * never color alone. Unlike `StatusMessage` it is not announced as it
 * appears (a list of players is not an alert).
 */
export function StatusChip({
  level,
  label,
}: {
  readonly level: StatusLevel;
  readonly label: string;
}) {
  const theme = useTheme();
  const colors = theme.colors.status[level];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.spacing.xs,
        minHeight: theme.sizes.chip,
        paddingLeft: theme.spacing.xs,
        paddingRight: theme.spacing.sm,
        borderRadius: theme.radius.pill,
        borderWidth: theme.borderWidth.hairline,
        borderColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <StatusIcon level={level} size={theme.sizes.statusIcon + theme.spacing.xxs} />
      <Text style={[theme.text.tableHeader, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

/**
 * A key figure: label, the figure in the KPI face with tabular numbers, its
 * unit smaller and muted, and a line that explains it. `highlighted` outlines
 * it in the club color; the caption says why (never the outline alone).
 */
export function KpiTile({
  label,
  value,
  unit,
  caption,
  highlighted = false,
  accessibilityLabel,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string | null;
  readonly caption?: string | null;
  readonly highlighted?: boolean;
  /** The whole tile read as one sentence ("Racha: 11 días seguidos"). */
  readonly accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={
        accessibilityLabel ??
        [label, unit ? `${value} ${unit}` : value, caption].filter(Boolean).join(': ')
      }
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minWidth: theme.sizes.sidebar / 2,
        gap: theme.spacing.xs,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        borderWidth: highlighted ? theme.borderWidth.thick : theme.borderWidth.hairline,
        borderColor: highlighted ? theme.colors.brand.border : theme.colors.border.subtle,
        backgroundColor: highlighted ? theme.colors.brand.subtle : theme.colors.surface,
      }}
    >
      <AppText role="bodySmall" tone="secondary">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.xs }}>
        <Text style={[theme.text.kpi, { color: theme.colors.text.primary }]}>{value}</Text>
        {unit ? (
          <Text style={[theme.text.unit, { color: theme.colors.text.secondary }]}>{unit}</Text>
        ) : null}
      </View>
      {caption ? (
        <AppText role="caption" tone="secondary">
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

/** A row of KPI tiles that wraps on narrow screens. */
export function KpiRow({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
      {children}
    </View>
  );
}

/**
 * A row of a list: an optional leading tile, a title and a line under it, and
 * a trailing element (a chip, a figure). With `onPress` the whole row is one
 * button (≥ 44 pt, focus ring, chevron) named by its title unless told
 * otherwise; without it, plain content. Rows separate with a hairline.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  first = false,
}: {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  /** More content under the title (chips, an alert line). */
  readonly children?: ReactNode;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  /** The first row of a list draws no divider above it. */
  readonly first?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText role="bodyStrong">{title}</AppText>
        {subtitle ? (
          <AppText role="bodySmall" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
        {children}
      </View>
      {trailing}
      {onPress ? (
        <Text
          accessible={false}
          importantForAccessibility="no"
          style={[theme.text.title, { color: theme.colors.text.muted }]}
        >
          ›
        </Text>
      ) : null}
    </>
  );
  const frame = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
    minHeight: theme.sizes.touchTarget + theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  };
  // The divider sits outside the pressable, so its focus ring and pressed tint keep their corners.
  const divider = {
    borderTopWidth: first ? 0 : theme.borderWidth.hairline,
    borderTopColor: theme.colors.border.subtle,
  };
  if (onPress === undefined) {
    // With a label, the row is read as one sentence (the figure at its right included).
    return accessibilityLabel === undefined ? (
      <View style={[frame, divider]}>{body}</View>
    ) : (
      <View accessible accessibilityLabel={accessibilityLabel} style={[frame, divider]}>
        {body}
      </View>
    );
  }
  return (
    <View style={divider}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint ?? subtitle ?? undefined}
        onPress={onPress}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        style={({ pressed }) => ({
          ...frame,
          marginHorizontal: -theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          borderRadius: theme.radius.md,
          borderWidth: theme.borderWidth.thick,
          borderColor: focused ? theme.colors.focus : 'transparent',
          backgroundColor: pressed ? theme.colors.brand.subtle : 'transparent',
        })}
      >
        {body}
      </Pressable>
    </View>
  );
}

/**
 * A square tile with a short mark (a glyph or a test code), as the leading
 * element of a row or the head of an empty state. Decorative.
 */
export function IconTile({
  mark,
  large = false,
  tone = 'brand',
}: {
  readonly mark: string;
  readonly large?: boolean;
  readonly tone?: 'brand' | 'neutral';
}) {
  const theme = useTheme();
  const side = large ? theme.sizes.iconTileLarge : theme.sizes.iconTile;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: side,
        height: side,
        borderRadius: theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'brand' ? theme.colors.brand.subtle : theme.colors.surfaceRaised,
        borderWidth: theme.borderWidth.hairline,
        borderColor: tone === 'brand' ? theme.colors.brand.border : theme.colors.border.subtle,
      }}
    >
      <Text
        numberOfLines={1}
        style={[
          large ? theme.text.cardTitle : theme.text.tableHeader,
          { color: tone === 'brand' ? theme.colors.brand.accent : theme.colors.text.secondary },
        ]}
      >
        {mark}
      </Text>
    </View>
  );
}

/** Nothing to show yet: what it is, why it is empty and, if any, the way forward. */
export function EmptyState({
  title,
  body,
  mark = '—',
  action,
}: {
  readonly title: string;
  readonly body?: string | null;
  readonly mark?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void } | null;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.xl,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <IconTile mark={mark} large tone="neutral" />
      <AppText role="cardTitle" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText role="bodySmall" tone="secondary" align="center">
          {body}
        </AppText>
      ) : null}
      {action ? <Button variant="secondary" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * Pills that read as one radio group with its name: the chosen one filled in
 * the club color with its ink and a check (never color alone). Each option
 * is a 44 pt target; they wrap when they do not fit.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignSelf: 'flex-start',
        gap: theme.spacing.xxs,
        padding: theme.spacing.xxs,
        borderRadius: theme.radius.lg,
        borderWidth: theme.borderWidth.hairline,
        borderColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.surface,
      }}
    >
      {options.map((option) => (
        <Segment
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => {
            onChange(option.value);
          }}
        />
      ))}
    </View>
  );
}

function Segment({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        minHeight: theme.sizes.touchTarget,
        minWidth: theme.sizes.touchTarget,
        paddingHorizontal: theme.spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : selected
            ? theme.colors.brand.solid
            : 'transparent',
        backgroundColor: selected
          ? theme.colors.brand.solid
          : pressed
            ? theme.colors.brand.subtle
            : 'transparent',
      })}
    >
      <Text
        style={[
          theme.text.button,
          { color: selected ? theme.colors.brand.onSolid : theme.colors.text.secondary },
        ]}
      >
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

/** A small label over a group of a screen or a card ("Tests en cancha"). */
export function SectionLabel({ children }: { readonly children: string }) {
  return (
    <AppText role="tableHeader" tone="secondary" accessibilityRole="header">
      {children}
    </AppText>
  );
}
