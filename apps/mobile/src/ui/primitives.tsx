import type { StatusLevel, TextStyleRole } from '@sport-performance/ui-tokens';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTranslator } from './i18n.tsx';
import { useClubMark, useTheme, type ClubMark } from './theme.tsx';

/**
 * The shared pieces of every screen (design system, ADR 0097 and ADR 0098):
 * text by role, stripes, the screen body and its header with the crest,
 * cards, buttons, status messages and fields. Colors, sizes and type come
 * from `ui-tokens` through `useTheme()`; nothing here names a club.
 */

type Tone = 'primary' | 'secondary' | 'muted' | 'accent';

export function AppText({
  role = 'body',
  tone = 'primary',
  align,
  children,
  accessibilityRole,
  accessibilityLabel,
  nativeID,
  numberOfLines,
}: {
  readonly role?: TextStyleRole;
  readonly tone?: Tone;
  readonly align?: 'left' | 'center' | 'right';
  readonly children: ReactNode;
  readonly accessibilityRole?: 'header' | 'text';
  /** What a screen reader says instead of the text (a figure with its unit spelled out). */
  readonly accessibilityLabel?: string;
  readonly nativeID?: string;
  /** Cuts the text at this many lines with an ellipsis. */
  readonly numberOfLines?: number;
}) {
  const theme = useTheme();
  const color = tone === 'accent' ? theme.colors.brand.accent : theme.colors.text[tone];
  return (
    <Text
      style={[theme.text[role], { color }, align === undefined ? null : { textAlign: align }]}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      nativeID={nativeID}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}

/** Jersey stripes: the club's visual seal. Decorative only, hidden from screen readers. */
export function Stripes({ height = 12 }: { readonly height?: number }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ height }}
    >
      {theme.stripes(height, 'sm').map((band, index) => (
        <View key={index} style={{ height: band.height, backgroundColor: band.color }} />
      ))}
    </View>
  );
}

/**
 * The top of a main screen, as in the mockup: the stripes band, then an
 * eyebrow (greeting, club or context), the H1 in the big condensed face and
 * a subtitle, with the club's crest on the right. The title is the screen's
 * heading; the crest is announced once with the club's name.
 */
export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  crest = true,
  club: clubProp,
  children,
}: {
  readonly title: string;
  readonly eyebrow?: string | null;
  readonly subtitle?: string | null;
  /** The active club's crest at the right; off where the screen already shows it. */
  readonly crest?: boolean;
  /** The club to show, when the screen has it (its theme); the active club's by default. */
  readonly club?: ClubMark | null;
  /** Under the titles, inside the header (a context line, a segmented control). */
  readonly children?: ReactNode;
}) {
  const theme = useTheme();
  const activeClub = useClubMark();
  const club = clubProp ?? activeClub;
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderBottomWidth: theme.borderWidth.hairline,
        borderBottomColor: theme.colors.border.subtle,
      }}
    >
      <Stripes height={theme.spacing.xl} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
        }}
      >
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          {eyebrow !== undefined && eyebrow !== null ? (
            <AppText role="bodyStrong" tone="secondary">
              {eyebrow}
            </AppText>
          ) : null}
          <AppText role="pageTitle" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle !== undefined && subtitle !== null ? (
            <AppText role="bodySmall" tone="secondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {crest && club !== null ? (
          <ClubBadge
            name={club.name}
            shortName={club.shortName}
            logoUrl={club.logoUrl}
            size={theme.sizes.clubMark}
          />
        ) : null}
      </View>
      {children !== undefined ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            gap: theme.spacing.sm,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Scrollable screen body on the theme background. With a `header`
 * (`ScreenHeader`) the header scrolls with the content; without one, the
 * stripes band stays on top as the club's seal.
 */
export function ScreenBody({
  children,
  header,
  stripes = true,
}: {
  readonly children: ReactNode;
  readonly header?: ReactNode;
  readonly stripes?: boolean;
}) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      {header === undefined && stripes ? <Stripes /> : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.spacing.xxl }}
      >
        {header}
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * A card: a raised surface with an optional condensed title (the section's
 * heading), a subtitle and an action at the right. `highlight` outlines it
 * in the club color (what the screen asks first); `flush` drops the padding
 * for lists whose rows bring their own.
 */
export function Card({
  children,
  title,
  subtitle,
  action,
  variant = 'default',
}: {
  readonly children?: ReactNode;
  readonly title?: string;
  readonly subtitle?: string | null;
  readonly action?: ReactNode;
  readonly variant?: 'default' | 'highlight' | 'flush';
}) {
  const theme = useTheme();
  const highlight = variant === 'highlight';
  const flush = variant === 'flush';
  const head =
    title !== undefined ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.spacing.sm,
          ...(flush
            ? {
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.lg,
                paddingBottom: theme.spacing.xs,
              }
            : {}),
        }}
      >
        <View style={{ flex: 1, gap: theme.spacing.xxs }}>
          <AppText role="cardTitle" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle !== undefined && subtitle !== null ? (
            <AppText role="bodySmall" tone="secondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {action}
      </View>
    ) : null;
  return (
    <View
      style={{
        backgroundColor: highlight ? theme.colors.brand.subtle : theme.colors.surface,
        borderColor: highlight ? theme.colors.brand.border : theme.colors.border.subtle,
        borderWidth: highlight ? theme.borderWidth.thick : theme.borderWidth.hairline,
        borderRadius: theme.radius.lg,
        padding: flush ? 0 : theme.spacing.lg,
        gap: flush ? 0 : theme.spacing.md,
        overflow: 'hidden',
      }}
    >
      {head}
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

/**
 * Pressable with a 44 pt minimum target, a visible focus ring (keyboards and
 * switch control) and its busy state announced. `primary` is the club color
 * with its legible ink (one per screen: the action the screen is for),
 * `secondary` an outline, `ghost` (and its older name `link`) text in the
 * club accent for the quiet actions, `danger` for signing out with changes
 * pending. Labels are condensed and in sentence case (`text.button`).
 * `size="lg"` is the thumb-sized submit of a quick form.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  align = 'stretch',
  disabled = false,
  busy = false,
  accessibilityHint,
  accessibilityLabel,
}: {
  readonly label: string;
  /** What a screen reader says, when the visible label is not enough alone ("No llegó" → whose). */
  readonly accessibilityLabel?: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'lg';
  /** `start`: as wide as its label, at the start of its row (an action inside a list row). */
  readonly align?: 'stretch' | 'start';
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly accessibilityHint?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const inactive = disabled || busy;
  const quiet = variant === 'ghost' || variant === 'link';
  const filled = !quiet;
  // Off (not busy): a flat surface with muted ink, not the action's color faded.
  const off = disabled && !busy && filled;
  const colors = off
    ? {
        bg: theme.colors.surfaceRaised,
        fg: theme.colors.text.muted,
        border: theme.colors.border.subtle,
      }
    : {
        primary: {
          bg: theme.colors.brand.solid,
          fg: theme.colors.brand.onSolid,
          border: theme.colors.brand.solid,
        },
        secondary: {
          bg: theme.colors.surfaceRaised,
          fg: theme.colors.text.primary,
          border: theme.colors.border.strong,
        },
        ghost: { bg: 'transparent', fg: theme.colors.brand.accent, border: 'transparent' },
        link: { bg: 'transparent', fg: theme.colors.brand.accent, border: 'transparent' },
        danger: {
          bg: theme.colors.status.critical.bg,
          fg: theme.colors.status.critical.fg,
          border: theme.colors.status.critical.border,
        },
      }[variant];
  const minHeight =
    size === 'lg'
      ? theme.sizes.touchTarget + theme.spacing.md
      : quiet
        ? theme.sizes.touchTarget
        : theme.sizes.touchTarget + theme.spacing.xs;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        minHeight,
        ...(align === 'start' ? { alignSelf: 'flex-start' as const } : {}),
        paddingHorizontal: quiet ? theme.spacing.sm : theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : colors.border,
        backgroundColor: pressed && quiet ? theme.colors.brand.subtle : colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: theme.spacing.sm,
        opacity: disabled && !busy && quiet ? 0.5 : pressed && filled && !inactive ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={colors.fg} /> : null}
      <Text
        style={[
          size === 'lg' ? theme.text.cardTitle : theme.text.button,
          { color: colors.fg, textAlign: 'center' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const STATUS_GLYPHS: Readonly<Record<StatusLevel, string>> = {
  ok: '✓',
  warning: '!',
  critical: '✕',
};

/** The icon of a status: its glyph on the solid status color. Decorative next to its text. */
export function StatusIcon({
  level,
  size,
}: {
  readonly level: StatusLevel;
  readonly size?: number;
}) {
  const theme = useTheme();
  const colors = theme.colors.status[level];
  const side = size ?? theme.sizes.statusIcon + theme.spacing.xs;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: side,
        height: side,
        borderRadius: side / 2,
        backgroundColor: colors.solid,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={[
          theme.text.caption,
          {
            color: colors.onSolid,
            fontFamily: theme.text.button.fontFamily,
            fontSize: Math.round(side * 0.6),
            lineHeight: side,
          },
        ]}
      >
        {STATUS_GLYPHS[level]}
      </Text>
    </View>
  );
}

/**
 * A clock drawn with views (no font glyph to miss on a phone): what waits on
 * the phone to be sent. Decorative next to its text.
 */
export function ClockIcon({ size, color }: { readonly size?: number; readonly color?: string }) {
  const theme = useTheme();
  const side = size ?? theme.sizes.statusIcon;
  const ink = color ?? theme.colors.text.muted;
  const stroke = Math.max(1, Math.round(side / 10));
  const center = side / 2;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: side,
        height: side,
        borderRadius: side / 2,
        borderWidth: stroke,
        borderColor: ink,
      }}
    >
      {/* The hands, from the center: up to twelve and right to three. */}
      <View
        style={{
          position: 'absolute',
          left: center - stroke * 1.5,
          top: side * 0.22 - stroke,
          width: stroke,
          height: center - side * 0.22,
          backgroundColor: ink,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: center - stroke * 1.5,
          top: center - stroke * 1.5,
          width: side * 0.25,
          height: stroke,
          backgroundColor: ink,
        }}
      />
    </View>
  );
}

/**
 * The quiet mark of something still missing on the phone (ADR 0103): an item
 * waiting to be sent ("Sin enviar", the default) or a sheet not downloaded yet
 * (`text`). A small clock and a short text, muted, inline; when all is well
 * nothing shows.
 */
export function PendingMark({
  accessibilityLabel,
  text,
}: {
  readonly accessibilityLabel?: string;
  /** The visible text; "Sin enviar" by default. */
  readonly text?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const visible = text ?? t('sync.item.pending');
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? visible}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.spacing.xs,
      }}
    >
      <ClockIcon size={theme.sizes.statusIcon - theme.spacing.xxs} />
      <Text style={[theme.text.caption, { color: theme.colors.text.muted }]}>{visible}</Text>
    </View>
  );
}

/**
 * A status message: always an icon and a text, never color alone (CLAUDE.md).
 * Warnings and errors are announced to screen readers as they appear.
 */
export function StatusMessage({
  level,
  children,
}: {
  readonly level: StatusLevel;
  readonly children: string;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const colors = theme.colors.status[level];
  return (
    <View
      accessible
      accessibilityRole={level === 'ok' ? 'text' : 'alert'}
      accessibilityLiveRegion={level === 'ok' ? 'polite' : 'assertive'}
      accessibilityLabel={`${t(`status.${level}`)}: ${children}`}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: theme.borderWidth.hairline,
        borderLeftWidth: theme.spacing.xs,
        borderLeftColor: colors.solid,
        borderRadius: theme.radius.md,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ paddingTop: theme.spacing.xxs }}>
        <StatusIcon level={level} />
      </View>
      <Text style={[theme.text.bodySmall, { color: colors.fg, flex: 1 }]}>{children}</Text>
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  inputProps,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly error?: string | null;
  readonly hint?: string;
  readonly inputProps?: Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const hasError = error !== undefined && error !== null;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={[theme.text.bodyStrong, { color: theme.colors.text.primary }]}>{label}</Text>
      <TextInput
        {...inputProps}
        // A list of similar fields names each one ("Minutos de Pérez, Juan"); the visible label stays short.
        accessibilityLabel={inputProps?.accessibilityLabel ?? label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.colors.text.muted}
        onFocus={(event) => {
          setFocused(true);
          inputProps?.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps?.onBlur?.(event);
        }}
        style={[
          theme.text.body,
          {
            minHeight: theme.sizes.touchTarget + theme.spacing.xs,
            color: theme.colors.text.primary,
            backgroundColor: theme.colors.surfaceRaised,
            borderRadius: theme.radius.md,
            borderWidth: theme.borderWidth.thick,
            borderColor: focused
              ? theme.colors.focus
              : hasError
                ? theme.colors.status.critical.border
                : theme.colors.border.strong,
            paddingHorizontal: theme.spacing.md,
          },
        ]}
      />
      {hint !== undefined && !hasError ? (
        <Text style={[theme.text.caption, { color: theme.colors.text.secondary }]}>{hint}</Text>
      ) : null}
      {hasError ? <StatusMessage level="critical">{error}</StatusMessage> : null}
    </View>
  );
}

/** The club crest, or its short name when it has none or the image cannot load. */
export function ClubBadge({
  name,
  shortName,
  logoUrl,
  size = 56,
}: {
  readonly name: string;
  readonly shortName: string;
  readonly logoUrl: string | null;
  readonly size?: number;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const [failed, setFailed] = useState(false);
  if (logoUrl !== null && !failed) {
    return (
      <Image
        source={{ uri: logoUrl }}
        accessibilityLabel={t('club.logoAlt', { clubName: name })}
        onError={() => {
          setFailed(true);
        }}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={t('club.logoAlt', { clubName: name })}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.brand.solid,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={[
          size < theme.sizes.avatarLarge ? theme.text.button : theme.text.heading,
          { color: theme.colors.brand.onSolid },
        ]}
      >
        {shortName}
      </Text>
    </View>
  );
}

export function LoadingView({ label }: { readonly label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.background,
      }}
    >
      <ActivityIndicator size="large" color={theme.colors.brand.accent} />
    </View>
  );
}
