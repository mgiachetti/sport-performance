import type { Translator } from '@sport-performance/i18n';
import {
  PAIN_AREAS_MAX,
  PAIN_COMMENT_MAX_LENGTH,
  painCommentLength,
  PAIN_INTENSITY_MAX,
  PAIN_INTENSITY_MIN,
  type PainBodyRegion,
  type PainSide,
} from '@sport-performance/domain';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  BODY_MAP_HEIGHT,
  BODY_MAP_VIEWS,
  BODY_MAP_WIDTH,
  bodyMapPlaces,
  type BodyMapView,
} from '../pain/body-map.ts';
import {
  answer,
  draftProblem,
  intensityBand,
  isMarked,
  keyOf,
  setComment,
  setIntensity,
  togglePlace,
  type PainDraft,
} from '../pain/draft.ts';
import type { PainQuestionState } from '../pain/question.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * "¿Te duele algo?" (B-609, ADR 0078): a step of the wellness check-in. "No"
 * is one tap; "sí" opens the body map (front and back), each marked area
 * takes an intensity from 1 to 10, and an optional comment. Presentation
 * only: the route keeps the draft in memory and queues the answer.
 */

/** "Rodilla, lado izquierdo"; the trunk goes by its region alone. */
export function areaLabel(
  { t }: Pick<Translator, 't'>,
  area: { readonly region: PainBodyRegion; readonly side: PainSide },
): string {
  const region = t(`body.region.${area.region}`);
  return area.side === 'central'
    ? region
    : t('body.area', { region, side: t(`body.side.${area.side}`) });
}

/** What happened to the answer just given. */
export interface PainSentState {
  readonly hasPain: boolean;
  /** Still in the queue of the phone (no connection yet). */
  readonly queued: boolean;
  readonly reviewed: boolean;
}

export interface PainReportScreenProps {
  readonly question: PainQuestionState;
  readonly draft: PainDraft;
  readonly onChange: (draft: PainDraft) => void;
  /** Queues the answer; "no" sends right away. */
  readonly onSubmit: (draft: PainDraft) => void;
  readonly submitting: boolean;
  readonly sent: PainSentState | null;
  readonly onAnswerAgain: () => void;
  readonly error: string | null;
}

function BodyMap({
  view,
  draft,
  onToggle,
}: {
  readonly view: BodyMapView;
  readonly draft: PainDraft;
  readonly onToggle: (region: PainBodyRegion, side: PainSide) => void;
}) {
  const theme = useTheme();
  const translator = useTranslator();
  const { t } = translator;
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 320,
        alignSelf: 'center',
        aspectRatio: BODY_MAP_WIDTH / BODY_MAP_HEIGHT,
      }}
    >
      {bodyMapPlaces(view).map((place) => {
        const marked = isMarked(draft, place.key);
        const label = areaLabel(translator, place);
        return (
          <Pressable
            key={`${view}:${place.key}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: marked }}
            accessibilityLabel={
              marked
                ? t('pain.map.area.selected', { area: label })
                : t('pain.map.area.select', { area: label })
            }
            onPress={() => {
              onToggle(place.region, place.side);
            }}
            hitSlop={4}
            style={{
              position: 'absolute',
              left: `${String((place.x / BODY_MAP_WIDTH) * 100)}%`,
              top: `${String((place.y / BODY_MAP_HEIGHT) * 100)}%`,
              width: `${String((place.w / BODY_MAP_WIDTH) * 100)}%`,
              height: `${String((place.h / BODY_MAP_HEIGHT) * 100)}%`,
              borderRadius: theme.radius.sm,
              borderWidth: marked ? theme.borderWidth.thick : theme.borderWidth.hairline,
              borderColor: marked ? theme.colors.focus : theme.colors.border.strong,
              backgroundColor: marked ? theme.colors.brand.solid : theme.colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Marked is also told by a mark, not by the color alone. */}
            {marked ? (
              <Text style={[theme.text.caption, { color: theme.colors.brand.onSolid }]}>✓</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function IntensityPicker({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const values = Array.from(
    { length: PAIN_INTENSITY_MAX - PAIN_INTENSITY_MIN + 1 },
    (_, index) => PAIN_INTENSITY_MIN + index,
  );
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ gap: theme.spacing.xs }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {values.map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${t('pain.intensity.value', { value: n })}, ${t(`pain.intensity.${intensityBand(n)}`)}`}
              onPress={() => {
                onChange(n);
              }}
              style={{
                minWidth: theme.sizes.touchTarget,
                minHeight: theme.sizes.touchTarget,
                borderRadius: theme.radius.md,
                borderWidth: theme.borderWidth.thick,
                borderColor: selected ? theme.colors.focus : theme.colors.border.strong,
                backgroundColor: selected ? theme.colors.brand.solid : theme.colors.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={[
                  theme.text.button,
                  { color: selected ? theme.colors.brand.onSolid : theme.colors.text.primary },
                ]}
              >
                {String(n)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {value !== null ? (
        <AppText role="caption" tone="secondary">
          {`${t('pain.intensity.value', { value })} · ${t(`pain.intensity.${intensityBand(value)}`)}`}
        </AppText>
      ) : null}
    </View>
  );
}

export function PainReportScreen({
  question,
  draft,
  onChange,
  onSubmit,
  submitting,
  sent,
  onAnswerAgain,
  error,
}: PainReportScreenProps) {
  const theme = useTheme();
  const translator = useTranslator();
  const { t } = translator;
  const [view, setView] = useState<BodyMapView>('front');

  if (question.kind === 'loading') return <LoadingView label={t('pain.title')} />;

  const header = (
    <>
      <AppText role="title" accessibilityRole="header">
        {t('pain.title')}
      </AppText>
      <AppText tone="secondary">{t('pain.privacy')}</AppText>
    </>
  );

  if (question.kind === 'needs_connection') {
    return (
      <ScreenBody>
        {header}
        <StatusMessage level="warning">{t('pain.needsConnection')}</StatusMessage>
      </ScreenBody>
    );
  }
  if (question.kind === 'unavailable') {
    return (
      <ScreenBody header={<ScreenHeader title={t('pain.title')} />}>
        <StatusMessage level="warning">{t(`pain.unavailable.${question.reason}`)}</StatusMessage>
      </ScreenBody>
    );
  }

  if (sent !== null) {
    return (
      <ScreenBody>
        {header}
        <StatusMessage level="ok">
          {t(sent.hasPain ? 'pain.sent.yes' : 'pain.sent.no')}
        </StatusMessage>
        {sent.queued ? (
          <StatusMessage level="warning">{t('pain.sent.queued')}</StatusMessage>
        ) : null}
        {sent.reviewed ? <StatusMessage level="ok">{t('pain.sent.reviewed')}</StatusMessage> : null}
        {sent.hasPain ? (
          <AppText role="caption" tone="secondary">
            {t('pain.notMedical')}
          </AppText>
        ) : null}
        <Button variant="secondary" label={t('pain.sent.again')} onPress={onAnswerAgain} />
      </ScreenBody>
    );
  }

  const problem = draftProblem(draft);
  const commentLength = painCommentLength(draft.comment.trim());
  const waiting = draft.areas.find((area) => area.intensity === null);
  return (
    <ScreenBody>
      {header}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            variant={draft.hasPain === false ? 'primary' : 'secondary'}
            label={t('pain.answer.no')}
            busy={submitting && draft.hasPain === false}
            disabled={submitting}
            onPress={() => {
              const next = answer(draft, false);
              onChange(next);
              onSubmit(next);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant={draft.hasPain === true ? 'primary' : 'secondary'}
            label={t('pain.answer.yes')}
            disabled={submitting}
            onPress={() => {
              onChange(answer(draft, true));
            }}
          />
        </View>
      </View>
      {error !== null ? <StatusMessage level="critical">{error}</StatusMessage> : null}

      {draft.hasPain === true ? (
        <>
          <Card title={t('pain.map.title')}>
            <AppText role="caption" tone="secondary">
              {t('pain.map.hint')}
            </AppText>
            <View
              accessibilityRole="tablist"
              accessibilityLabel={t('pain.map.views')}
              style={{ flexDirection: 'row', gap: theme.spacing.sm }}
            >
              {BODY_MAP_VIEWS.map((option) => (
                <View key={option} style={{ flex: 1 }}>
                  <Button
                    variant={view === option ? 'primary' : 'secondary'}
                    label={t(option === 'front' ? 'pain.map.front' : 'pain.map.back')}
                    onPress={() => {
                      setView(option);
                    }}
                  />
                </View>
              ))}
            </View>
            <BodyMap
              view={view}
              draft={draft}
              onToggle={(region, side) => {
                onChange(togglePlace(draft, region, side));
              }}
            />
            {draft.areas.length >= PAIN_AREAS_MAX ? (
              <StatusMessage level="warning">
                {t('pain.areas.max', { max: PAIN_AREAS_MAX })}
              </StatusMessage>
            ) : null}
          </Card>

          <Card title={t('pain.areas.title')}>
            {draft.areas.length === 0 ? (
              <AppText tone="secondary">{t('pain.areas.none')}</AppText>
            ) : null}
            {draft.areas.map((area) => {
              const label = areaLabel(translator, area);
              return (
                <View key={keyOf(area)} style={{ gap: theme.spacing.xs }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <AppText role="bodyStrong">{label}</AppText>
                    <Button
                      variant="link"
                      label="✕"
                      accessibilityLabel={t('pain.areas.remove', { area: label })}
                      onPress={() => {
                        onChange(togglePlace(draft, area.region, area.side));
                      }}
                    />
                  </View>
                  <AppText role="caption" tone="secondary">
                    {t('pain.intensity.label')}
                  </AppText>
                  <IntensityPicker
                    label={`${label}: ${t('pain.intensity.label')}`}
                    value={area.intensity}
                    onChange={(value) => {
                      onChange(setIntensity(draft, keyOf(area), value));
                    }}
                  />
                </View>
              );
            })}
          </Card>

          <TextField
            label={t('pain.comment.label')}
            value={draft.comment}
            onChangeText={(value) => {
              onChange(setComment(draft, value));
            }}
            hint={t('pain.comment.hint', { max: PAIN_COMMENT_MAX_LENGTH })}
            error={
              commentLength > PAIN_COMMENT_MAX_LENGTH
                ? t('pain.comment.tooLong', { max: PAIN_COMMENT_MAX_LENGTH })
                : null
            }
            inputProps={{ multiline: true }}
          />
          {waiting !== undefined ? (
            <StatusMessage level="warning">
              {t('pain.intensity.pick', { area: areaLabel(translator, waiting) })}
            </StatusMessage>
          ) : null}
          <Button
            label={t('pain.submit')}
            busy={submitting}
            disabled={problem !== null}
            onPress={() => {
              onSubmit(draft);
            }}
          />
          <AppText role="caption" tone="secondary">
            {t('pain.notMedical')}
          </AppText>
        </>
      ) : null}
    </ScreenBody>
  );
}
