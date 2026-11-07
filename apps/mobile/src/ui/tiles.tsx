import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { IconTile, SectionLabel } from './blocks.tsx';
import { useTheme } from './theme.tsx';

/**
 * A grid of tool tiles under small headings (ADR 0104): the staff's home
 * opens its tools from here instead of a long list of rows. Two columns,
 * one on a narrow screen or with a large font. Every size, color and type
 * role comes from `ui-tokens`.
 */

export interface ToolTileItem {
  readonly key: string;
  /** Short title: what the tile says and its accessibility label. */
  readonly title: string;
  /** One visible line under the title; `null` draws none. */
  readonly hint: string | null;
  /** The full explanation a screen reader reads as the hint. */
  readonly accessibilityHint: string;
  /** A short mark (a glyph or a test code) in the tile's corner. Decorative. */
  readonly mark: string;
  readonly onPress: () => void;
}

export interface ToolTileGroup {
  readonly key: string;
  readonly title: string;
  readonly tools: readonly ToolTileItem[];
}

/** Below this window width (dp) two tiles do not fit side by side. */
export const TOOL_GRID_MIN_TWO_COLUMN_WIDTH = 340;
/** From this font scale on, a half-width tile cuts its title. */
export const TOOL_GRID_MAX_TWO_COLUMN_FONT_SCALE = 1.3;

/** How many columns the grid uses for a window width (dp) and the system font scale. */
export function toolGridColumns(widthDp: number, fontScale: number): 1 | 2 {
  return widthDp < TOOL_GRID_MIN_TWO_COLUMN_WIDTH ||
    fontScale >= TOOL_GRID_MAX_TWO_COLUMN_FONT_SCALE
    ? 1
    : 2;
}

/** The groups with something to show: a group with no tools disappears with its heading. */
export function visibleToolGroups(groups: readonly ToolTileGroup[]): readonly ToolTileGroup[] {
  return groups.filter((group) => group.tools.length > 0);
}

function rowsOf<T>(items: readonly T[], columns: number): readonly (readonly T[])[] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
}

export function ToolGrid({ groups }: { readonly groups: readonly ToolTileGroup[] }) {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const columns = toolGridColumns(width, fontScale);
  return (
    <View style={{ gap: theme.spacing.lg }}>
      {visibleToolGroups(groups).map((group) => (
        <View key={group.key} style={{ gap: theme.spacing.sm }}>
          <SectionLabel>{group.title}</SectionLabel>
          {rowsOf(group.tools, columns).map((row) => (
            <View
              key={row.map((tool) => tool.key).join('|')}
              style={{ flexDirection: 'row', gap: theme.spacing.sm }}
            >
              {row.map((tool) => (
                <ToolTile key={tool.key} tool={tool} />
              ))}
              {/* An odd last tile keeps its half width. */}
              {row.length < columns ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function ToolTile({ tool }: { readonly tool: ToolTileItem }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tool.title}
      accessibilityHint={tool.accessibilityHint}
      onPress={tool.onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: theme.sizes.touchTarget * 2,
        padding: theme.spacing.md,
        gap: theme.spacing.xs,
        borderRadius: theme.radius.lg,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : theme.colors.border.subtle,
        backgroundColor: pressed ? theme.colors.brand.subtle : theme.colors.surface,
      })}
    >
      <IconTile mark={tool.mark} />
      <Text style={[theme.text.bodyStrong, { color: theme.colors.text.primary }]}>
        {tool.title}
      </Text>
      {tool.hint === null ? null : (
        <Text
          numberOfLines={1}
          style={[theme.text.bodySmall, { color: theme.colors.text.secondary }]}
        >
          {tool.hint}
        </Text>
      )}
    </Pressable>
  );
}
