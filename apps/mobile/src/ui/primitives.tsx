import type { StatusLevel, TextStyleRole } from '@sport-performance/ui-tokens';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTranslator } from './i18n.tsx';
import { useTheme } from './theme.tsx';

type Tone = 'primary' | 'secondary' | 'muted' | 'accent';

export function AppText({
  role = 'body',
  tone = 'primary',
  children,
  accessibilityRole,
  nativeID,
}: {
  readonly role?: TextStyleRole;
  readonly tone?: Tone;
  readonly children: ReactNode;
  readonly accessibilityRole?: 'header' | 'text';
  readonly nativeID?: string;
}) {
  const theme = useTheme();
  const color = tone === 'accent' ? theme.colors.brand.accent : theme.colors.text[tone];
  return (
    <Text
      style={[theme.text[role], { color }]}
      accessibilityRole={accessibilityRole}
      nativeID={nativeID}
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

/** Scrollable screen body on the theme background, with the stripes on top. */
export function ScreenBody({
  children,
  stripes = true,
}: {
  readonly children: ReactNode;
  readonly stripes?: boolean;
}) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      {stripes ? <Stripes /> : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.xl,
          gap: theme.spacing.lg,
          flexGrow: 1,
        }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Card({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border.subtle,
        borderWidth: theme.borderWidth.hairline,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'link';

/**
 * Pressable with a 44 pt minimum target, a visible focus ring (keyboards and
 * switch control) and its busy state announced.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
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
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly accessibilityHint?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const inactive = disabled || busy;
  const colors = {
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
    link: { bg: 'transparent', fg: theme.colors.brand.accent, border: 'transparent' },
  }[variant];
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
        minHeight: theme.sizes.touchTarget,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : colors.border,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: theme.spacing.sm,
        opacity: inactive && !busy ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={colors.fg} /> : null}
      <Text
        style={[
          variant === 'link' ? theme.text.bodyStrong : theme.text.button,
          { color: colors.fg, textAlign: 'center' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const STATUS_GLYPHS: Readonly<Record<StatusLevel, string>> = {
  ok: '✓',
  warning: '!',
  critical: '✕',
};

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
  const size = theme.sizes.statusIcon + theme.spacing.xs;
  return (
    <View
      accessible
      accessibilityRole={level === 'ok' ? 'text' : 'alert'}
      accessibilityLiveRegion={level === 'ok' ? 'polite' : 'assertive'}
      accessibilityLabel={`${t(`status.${level}`)}: ${children}`}
      style={[
        styles.status,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.solid,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[theme.text.caption, { color: colors.onSolid, fontWeight: '700' }]}>
          {STATUS_GLYPHS[level]}
        </Text>
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
        accessibilityLabel={label}
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
      <Text style={[theme.text.heading, { color: theme.colors.brand.onSolid }]}>{shortName}</Text>
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

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
});
