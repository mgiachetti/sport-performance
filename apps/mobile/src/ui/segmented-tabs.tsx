import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslator } from './i18n.tsx';
import { rememberSegment, rememberedSegment } from './segment-memory.ts';
import { useTheme } from './theme.tsx';

/**
 * A count next to a segment's label ("Próximos 2"): `count` is what is drawn,
 * `label` says it in words for the screen reader ("2 días de test"), and a
 * `critical` badge (an error in that segment) carries a "!" besides its
 * color: never color alone.
 */
export interface TabBadge {
  readonly count: number;
  readonly label: string;
  readonly tone?: 'brand' | 'critical';
}

export interface TabSegment<T extends string> {
  readonly value: T;
  readonly label: string;
  /** `null` or a count of 0: no badge. */
  readonly badge?: TabBadge | null;
}

export { forgetRememberedSegments, segmentKey } from './segment-memory.ts';

function storedOr<T extends string>(key: string, values: readonly T[], initial: T): T {
  const stored = rememberedSegment(key);
  if (stored !== undefined && (values as readonly string[]).includes(stored)) return stored as T;
  return values.includes(initial) ? initial : (values[0] ?? initial);
}

/**
 * The selected segment of a screen, kept for the app session under `key`
 * (`segmentKey`). A remembered value that the screen no longer offers (the
 * contacts tab of a sport without contacts) falls back to `initial`. A new
 * key (another club, another session) reads its own value even when the
 * screen stays mounted.
 */
export function useRememberedSegment<T extends string>(
  key: string,
  values: readonly T[],
  initial: T,
): readonly [T, (value: T) => void] {
  const [state, setState] = useState<{ readonly key: string; readonly value: T }>(() => ({
    key,
    value: storedOr(key, values, initial),
  }));
  const chosen = state.key === key ? state.value : storedOr(key, values, initial);
  const value = values.includes(chosen) ? chosen : storedOr(key, values, initial);
  const select = useCallback(
    (next: T) => {
      rememberSegment(key, next);
      setState({ key, value: next });
    },
    [key],
  );
  return [value, select] as const;
}

/**
 * Segmented tabs at the top of a screen, under its header (ADR 0104): 2 to 4
 * segments that split one long screen into its parts. Never a bottom bar
 * (that is the app's navigation). Read as a tab list with its name; each
 * segment is a tab with its selected state, a 48 dp target with a visible
 * focus ring, filled in the club color with its ink and a check when chosen.
 * The badge goes into the tab's accessible name too.
 */
export function SegmentedTabs<T extends string>({
  label,
  segments,
  value,
  onChange,
}: {
  /** Name of the tab list ("Secciones de mis tests"). */
  readonly label: string;
  readonly segments: readonly TabSegment<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        gap: theme.spacing.xxs,
        padding: theme.spacing.xxs,
        borderRadius: theme.radius.lg,
        borderWidth: theme.borderWidth.hairline,
        borderColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.surface,
      }}
    >
      {segments.map((segment) => (
        <Tab
          key={segment.value}
          segment={segment}
          selected={segment.value === value}
          onPress={() => {
            onChange(segment.value);
          }}
        />
      ))}
    </View>
  );
}

function Tab<T extends string>({
  segment,
  selected,
  onPress,
}: {
  readonly segment: TabSegment<T>;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const [focused, setFocused] = useState(false);
  const badge =
    segment.badge !== undefined && segment.badge !== null && segment.badge.count > 0
      ? segment.badge
      : null;
  const ink = selected ? theme.colors.brand.onSolid : theme.colors.text.secondary;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={
        badge !== null
          ? t('tabs.withBadge', { label: segment.label, badge: badge.label })
          : segment.label
      }
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        // 48 dp, the Android minimum (over the 44 pt of iOS): a thumb on the field.
        minHeight: theme.sizes.touchTarget + theme.spacing.xs,
        minWidth: theme.sizes.touchTarget,
        flexWrap: 'wrap',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
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
      {/* Wraps instead of truncating at large font scales. */}
      <Text style={[theme.text.button, { color: ink, flexShrink: 1, textAlign: 'center' }]}>
        {selected ? `✓ ${segment.label}` : segment.label}
      </Text>
      {badge !== null ? <Badge badge={badge} selected={selected} /> : null}
    </Pressable>
  );
}

function Badge({ badge, selected }: { readonly badge: TabBadge; readonly selected: boolean }) {
  const theme = useTheme();
  const critical = badge.tone === 'critical';
  const background = critical
    ? theme.colors.status.critical.solid
    : selected
      ? theme.colors.brand.onSolid
      : theme.colors.brand.solid;
  const ink = critical
    ? theme.colors.status.critical.onSolid
    : selected
      ? theme.colors.brand.solid
      : theme.colors.brand.onSolid;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        minWidth: theme.sizes.statusIcon + theme.spacing.xs,
        minHeight: theme.sizes.statusIcon + theme.spacing.xs,
        paddingHorizontal: theme.spacing.xs,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
      }}
    >
      <Text style={[theme.text.tableHeader, { color: ink }]}>
        {critical ? `! ${String(badge.count)}` : String(badge.count)}
      </Text>
    </View>
  );
}

/** The content of the selected tab, named by it. */
export function TabPanel({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View role="tabpanel" aria-label={label} style={{ gap: theme.spacing.md }}>
      {children}
    </View>
  );
}
