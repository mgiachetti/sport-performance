import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './theme.tsx';

/**
 * One option of a quick scale (wellness, RPE): a 44 pt target with a
 * visible focus ring, announced as a radio with its full name ("Sueño: Bien")
 * and its selected state. The selection is told by a thicker border, a fill
 * and a check mark, never by color alone.
 */
export function ChoiceButton({
  label,
  accessibilityLabel,
  selected,
  onPress,
  disabled = false,
  children,
  minWidth,
}: {
  /** What is written on it (a number); omit when `children` draw it (a face). */
  readonly label?: string;
  readonly accessibilityLabel: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
  readonly minWidth?: number;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        minHeight: theme.sizes.touchTarget,
        minWidth: minWidth ?? theme.sizes.touchTarget,
        flexGrow: 1,
        flexBasis: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.md,
        borderWidth: selected ? theme.borderWidth.thick * 2 : theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : selected
            ? theme.colors.brand.solid
            : theme.colors.border.strong,
        backgroundColor: selected ? theme.colors.surfaceRaised : theme.colors.surface,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {children}
      {label !== undefined ? (
        <Text
          style={[
            theme.text.metricSmall,
            { color: selected ? theme.colors.brand.accent : theme.colors.text.primary },
          ]}
        >
          {selected ? `✓ ${label}` : label}
        </Text>
      ) : selected ? (
        <Text style={[theme.text.caption, { color: theme.colors.brand.accent }]}>✓</Text>
      ) : null}
    </Pressable>
  );
}

/** A row of options that reads as one radio group with its name. */
export function ChoiceGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
    >
      {children}
    </View>
  );
}

/**
 * A drawn face for the wellness of M13/M14 (1 = very bad … 5 = very good):
 * the mouth goes from a frown to a smile. Decorative: the button around it
 * carries the name ("Fatiga: Bien") and the caption under it the word.
 */
export function Face({
  level,
  size = 36,
}: {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly size?: number;
}) {
  const theme = useTheme();
  const color = theme.colors.text.primary;
  const stroke = Math.max(2, Math.round(size / 14));
  const eye = Math.max(3, Math.round(size / 9));
  const mouthWidth = size * (level === 3 ? 0.4 : 0.5);
  const curve = level === 1 || level === 5 ? size * 0.22 : size * 0.12;
  const mouth =
    level === 3
      ? { height: stroke, backgroundColor: color }
      : level > 3
        ? {
            height: curve,
            borderBottomWidth: stroke,
            borderLeftWidth: stroke,
            borderRightWidth: stroke,
            borderColor: color,
            borderBottomLeftRadius: curve,
            borderBottomRightRadius: curve,
            borderTopWidth: 0,
          }
        : {
            height: curve,
            borderTopWidth: stroke,
            borderLeftWidth: stroke,
            borderRightWidth: stroke,
            borderColor: color,
            borderTopLeftRadius: curve,
            borderTopRightRadius: curve,
            borderBottomWidth: 0,
          };
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: stroke,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        gap: size * 0.12,
      }}
    >
      <View style={{ flexDirection: 'row', gap: size * 0.22 }}>
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
      </View>
      <View style={{ width: mouthWidth, ...mouth }} />
    </View>
  );
}
